package com.chainlesschain.android.remote.webrtc

import com.chainlesschain.android.core.did.manager.DIDManager
import com.chainlesschain.android.feature.familyguard.domain.permission.PermissionDecision
import java.util.Collections
import java.util.UUID
import java.util.concurrent.atomic.AtomicLong
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import org.json.JSONObject
import timber.log.Timber

/** family.call.* 控制面消息类型（FAMILY-34）。 */
enum class FamilyCallType(val wire: String) {
    INVITE("chainlesschain:family:call:invite"),
    ACCEPT("chainlesschain:family:call:accept"),
    REJECT("chainlesschain:family:call:reject"),
    SILENT_OBSERVE("chainlesschain:family:call:silent_observe"),
    URGENT_FORCE("chainlesschain:family:call:urgent_force"),
    HANGUP("chainlesschain:family:call:hangup");

    companion object {
        private val byWire = entries.associateBy { it.wire }
        fun fromWire(s: String?): FamilyCallType? = s?.let { byWire[it] }
    }
}

/** 入向 family.call.* 事件（dispatch 给 UI / call coordinator）。 */
data class FamilyCallEvent(
    val type: FamilyCallType,
    val callId: String,
    val fromPeerId: String?,
    val callKind: CallKind?,
    val seq: Long,
    val reason: String? = null,
    /** 邀请方算出的本端建议角色（responder 端据此调 WebRTCClient.connect(isInitiator)）。 */
    val inviterRole: CallRole? = null,
)

class CallPermissionDeniedException(val kind: CallKind, val decision: PermissionDecision) :
    Exception("call $kind denied: $decision")

/**
 * family.call.* RPC 客户端（FAMILY-34，TerminalRpcClient 模板派生）。
 *
 * 6 控制面方法走 signaling forward 通道（[SignalClient.sendForwardedMessage]，type:"message"
 * 路由），**先于** WebRTC 媒体握手：
 *   - invite(AUDIO/VIDEO) / silentObserve / urgentForce — 发起前过 [CallKindGate] 权限闸；
 *     envelope 带 [CallNegotiator] 算出的 inviterRole 供对端定 initiator/responder。
 *   - accept / reject / hangup — 对已有 callId 的控制。
 *
 * 入向：订阅 [SignalClient.forwardedMessages]，解 family.call.* → [FamilyCallEvent] emit；
 * **LRU 去重 callId|seq**（同 TerminalRpcClient 的 LinkedHashMap access-order 模式）防信令
 * 重发重复 dispatch。
 *
 * SOS_BROADCAST 不在此 6 方法（走 FAMILY-40 SOS 通道）；本类只管亲子通话控制面。
 */
@Singleton
class FamilyCallRpcClient @Inject constructor(
    private val signalClient: SignalClient,
    private val didManager: DIDManager,
    private val negotiator: CallNegotiator,
    private val kindGate: CallKindGate,
) {
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val seqCounter = AtomicLong(0)

    @Volatile
    private var listenerJob: Job? = null

    private val _callEvents = MutableSharedFlow<FamilyCallEvent>(extraBufferCapacity = 64)
    fun observeCallEvents(): SharedFlow<FamilyCallEvent> = _callEvents.asSharedFlow()

    // LRU 去重 callId|seq（access-order + 自动淘汰，同 TerminalRpcClient 模式）。
    private val recentKeys: MutableSet<String> = Collections.newSetFromMap(
        Collections.synchronizedMap(
            object : LinkedHashMap<String, Boolean>(256, 0.75f, true) {
                override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Boolean>): Boolean =
                    size > 256
            },
        ),
    )

    fun start() {
        if (listenerJob?.isActive == true) return
        listenerJob = signalClient.forwardedMessages
            .onEach { raw -> handleForwarded(raw) }
            .launchIn(scope)
    }

    fun stop() {
        listenerJob?.cancel()
        listenerJob = null
    }

    // ─── 出向 6 方法 ───

    /** 发起普通通话（AUDIO/VIDEO）。@return callId。Deny 时 failure。 */
    suspend fun invite(targetPeerId: String, targetDid: String, callKind: CallKind): Result<String> {
        require(callKind == CallKind.AUDIO || callKind == CallKind.VIDEO) {
            "invite 仅限 AUDIO/VIDEO；SILENT_OBSERVE/URGENT 用 silentObserve()/urgentForce()"
        }
        return gatedSend(FamilyCallType.INVITE, targetPeerId, targetDid, callKind)
    }

    suspend fun silentObserve(targetPeerId: String, targetDid: String): Result<String> =
        gatedSend(FamilyCallType.SILENT_OBSERVE, targetPeerId, targetDid, CallKind.SILENT_OBSERVE)

    suspend fun urgentForce(targetPeerId: String, targetDid: String): Result<String> =
        gatedSend(FamilyCallType.URGENT_FORCE, targetPeerId, targetDid, CallKind.URGENT)

    suspend fun accept(targetPeerId: String, callId: String): Result<Unit> =
        sendControl(FamilyCallType.ACCEPT, targetPeerId, callId)

    suspend fun reject(targetPeerId: String, callId: String, reason: String? = null): Result<Unit> =
        sendControl(FamilyCallType.REJECT, targetPeerId, callId) {
            if (reason != null) put("reason", reason)
        }

    suspend fun hangup(targetPeerId: String, callId: String): Result<Unit> =
        sendControl(FamilyCallType.HANGUP, targetPeerId, callId)

    // ─── 内部 ───

    private suspend fun gatedSend(
        type: FamilyCallType,
        targetPeerId: String,
        targetDid: String,
        callKind: CallKind,
    ): Result<String> {
        val decision = kindGate.authorize(callKind, targetDid)
        if (decision !is PermissionDecision.Allow) {
            Timber.w("[FamilyCall] $type denied for $targetDid: $decision")
            return Result.failure(CallPermissionDeniedException(callKind, decision))
        }
        val callId = "call-${UUID.randomUUID()}"
        val localPeerId = didManager.getCurrentDID()
        val inviterRole = runCatching {
            localPeerId?.let { negotiator.decideRole(it, targetPeerId) }
        }.getOrNull()
        val env = envelope(type, callId, localPeerId).apply {
            put("callKind", callKind.name)
            if (inviterRole != null) put("inviterRole", inviterRole.name)
        }
        return signalClient.sendForwardedMessage(targetPeerId, env).map { callId }
    }

    private suspend fun sendControl(
        type: FamilyCallType,
        targetPeerId: String,
        callId: String,
        extra: JSONObject.() -> Unit = {},
    ): Result<Unit> {
        val env = envelope(type, callId, didManager.getCurrentDID()).apply(extra)
        return signalClient.sendForwardedMessage(targetPeerId, env)
    }

    private fun envelope(type: FamilyCallType, callId: String, fromPeerId: String?): JSONObject =
        JSONObject().apply {
            put("type", type.wire)
            put("callId", callId)
            put("from", fromPeerId ?: "")
            put("seq", seqCounter.incrementAndGet())
            put("ts", System.currentTimeMillis())
        }

    // internal: 提取解析+去重+emit 供单测直驱（listener 跑在 IO scope，runTest 不控；
    // 直测 handleForwarded 避时序 flaky，同 CentralTelemetryDispatcher.process 模式）。
    internal fun handleForwarded(raw: String) {
        val json = runCatching { JSONObject(raw) }.getOrNull() ?: return
        val type = FamilyCallType.fromWire(json.optString("type", null)) ?: return // 非 family.call.* 忽略
        val callId = json.optString("callId", "")
        if (callId.isEmpty()) {
            Timber.w("[FamilyCall] $type missing callId, drop")
            return
        }
        val seq = json.optLong("seq", 0L)
        if (!recentKeys.add("$callId|$seq")) {
            Timber.d("[FamilyCall] dup $callId|$seq dropped (LRU)")
            return
        }
        val event = FamilyCallEvent(
            type = type,
            callId = callId,
            fromPeerId = json.optString("from", null),
            callKind = json.optString("callKind", null)
                ?.let { runCatching { CallKind.valueOf(it) }.getOrNull() },
            seq = seq,
            reason = json.optString("reason", null),
            inviterRole = json.optString("inviterRole", null)
                ?.let { runCatching { CallRole.valueOf(it) }.getOrNull() },
        )
        _callEvents.tryEmit(event)
    }
}

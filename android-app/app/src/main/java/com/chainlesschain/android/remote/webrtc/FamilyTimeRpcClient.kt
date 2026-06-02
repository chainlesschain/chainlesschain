package com.chainlesschain.android.remote.webrtc

import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import timber.log.Timber

/**
 * family.time.* RPC 客户端（FAMILY-60，FamilyCallRpcClient 模板派生）。
 *
 * 向家长端（已配对对端）拉一次权威 wall-clock epoch ms，供
 * [com.chainlesschain.android.feature.familyguard.data.time.CristianTimeAuthority]
 * 锚定（防孩子改设备钟绕过时间约束）。请求-响应经 signaling-forward 通道
 * （[SignalClient.sendForwardedMessage] 出 + [SignalClient.forwardedMessages] 入，
 * 同 FamilyCallRpcClient / TerminalRpcClient 传输），按 requestId 关联 + 超时：
 *   - 出: {type: [REQUEST_TYPE], requestId} → 家长端 peer
 *   - 入: {type: [RESPONSE_TYPE], requestId, parentEpochMs} ← 家长端 peer
 *
 * 桌面 responder: `mobile-bridge.js` handleP2PMessage 收 [REQUEST_TYPE] → 回
 * {parentEpochMs: Date.now()}。家长端不可达 / 超时 / 响应畸形 → [fetchParentEpochMs]
 * 返 null，调用方按"未同步"处理（CristianTimeAuthority 保持 NEVER_SYNCED 温和档）。
 */
@Singleton
class FamilyTimeRpcClient @Inject constructor(
    private val signalClient: SignalClient,
) {
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    @Volatile
    private var listenerJob: Job? = null

    // requestId → 等待者。ConcurrentHashMap: listener 协程与发起协程并发安全。
    private val pending = ConcurrentHashMap<String, CompletableDeferred<Long>>()

    @Synchronized
    fun start() {
        if (listenerJob?.isActive == true) return // 幂等
        listenerJob = signalClient.forwardedMessages
            .onEach { raw -> handleForwarded(raw) }
            .launchIn(scope)
    }

    fun stop() {
        listenerJob?.cancel()
        listenerJob = null
        // 取消在途等待者，调用方不挂死。
        pending.values.forEach { it.completeExceptionally(CancellationException("FamilyTimeRpcClient stopped")) }
        pending.clear()
    }

    /**
     * 向 [parentPeerId] 拉一次当前 epoch ms。超时 / 发送失败 / 响应畸形返 null。
     * 幂等触发 [start] 确保 listener 已装。
     */
    suspend fun fetchParentEpochMs(
        parentPeerId: String,
        timeoutMs: Long = DEFAULT_TIMEOUT_MS,
    ): Long? {
        start()
        val requestId = UUID.randomUUID().toString()
        val waiter = CompletableDeferred<Long>()
        pending[requestId] = waiter
        try {
            val payload = JSONObject()
                .put("type", REQUEST_TYPE)
                .put("requestId", requestId)
            val sent = signalClient.sendForwardedMessage(parentPeerId, payload)
            if (sent.isFailure) {
                Timber.w(sent.exceptionOrNull(), "[FamilyTime] request send failed")
                return null
            }
            return withTimeoutOrNull(timeoutMs) { waiter.await() }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Timber.w(e, "[FamilyTime] request failed")
            return null
        } finally {
            pending.remove(requestId)
        }
    }

    // internal: 解析+匹配+complete 供单测直驱（listener 跑 IO scope，runTest 不控；
    // 直测 handleForwarded 避时序 flaky，同 FamilyCallRpcClient.handleForwarded 模式）。
    internal fun handleForwarded(raw: String) {
        val json = runCatching { JSONObject(raw) }.getOrNull() ?: return
        if (json.optString("type", null) != RESPONSE_TYPE) return // 非 family.time 响应忽略
        val requestId = json.optString("requestId", "")
        if (requestId.isEmpty()) return
        val epochMs = json.optLong("parentEpochMs", -1L)
        if (epochMs <= 0L) {
            Timber.w("[FamilyTime] response missing/invalid parentEpochMs (reqId=%s)", requestId)
            return
        }
        // 无匹配 requestId（迟到 / 重发）→ remove 返 null，安全丢弃。
        pending.remove(requestId)?.complete(epochMs)
    }

    companion object {
        const val REQUEST_TYPE = "chainlesschain:family:time:request"
        const val RESPONSE_TYPE = "chainlesschain:family:time:response"
        const val DEFAULT_TIMEOUT_MS = 5_000L
    }
}

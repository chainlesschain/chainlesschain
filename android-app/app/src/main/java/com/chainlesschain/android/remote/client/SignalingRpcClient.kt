package com.chainlesschain.android.remote.client

import com.chainlesschain.android.core.did.manager.DIDManager
import com.chainlesschain.android.core.p2p.config.SignalingConfig
import com.chainlesschain.android.core.p2p.pairing.PairingSignalingGate
import com.chainlesschain.android.remote.webrtc.P2PConnectionState
import com.chainlesschain.android.remote.webrtc.SignalClient
import com.chainlesschain.android.remote.webrtc.WebRTCClient
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.withTimeout
import org.json.JSONObject
import timber.log.Timber
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import javax.inject.Inject
import javax.inject.Singleton

/**
 * RPC 客户端 — v1.3+ issue #21 plan C 起步，Plan A.1 起加 DC fast path。
 *
 * 协议（与 desktop `handleMobileCommand` 兼容）：
 *   - 请求：`{type:"chainlesschain:command:request", payload:{id, method, params, auth?}}`
 *   - 响应：`{type:"chainlesschain:command:response", payload:{jsonrpc, id, result, error}}`
 *   - requestId 关联 deferred，30s 超时
 *
 * Transport 选择（Plan A.1）：
 *   1. 优先 WebRTC DataChannel — 当 [WebRTCClient.connectionState] 是 READY
 *      时直接 `webRTCClient.sendMessage(envelope)`。1 跳直连，绕开信令转发的
 *      4 跳链路 + NAT idle / cell carrier 间歇杀 TCP 的连环问题。
 *   2. Fallback signaling forward — DC 不 ready 或 send 抛异常时走原 LAN
 *      signaling + 公网中继路径（pairing-gate-driven）。
 *
 * Response 监听：DC 入响应和 signaling 入响应**都** complete 同一 pending pool
 * 的 deferred（按 requestId 索引）。两条 listener 并存：
 *   - [SignalClient.forwardedMessages] — signaling-forward 路径
 *   - [WebRTCClient.messages] — DC 路径（也包含 signaling, 因 WebRTCClient
 *     initialize 的 callback 把 forward msg 也 emit 到此 flow；重复响应被
 *     CompletableDeferred 二次 complete 自然忽略，安全）
 *
 * 入口 [invoke] 阻塞到响应返回；调用方完全无感哪条 transport 跑的。
 *
 * 历史背景：详见 memory `android_remote_operate_plan_c_first.md` +
 * docs/design/Android_Remote_Terminal_Plan_A1.md。
 */
@Singleton
class SignalingRpcClient @Inject constructor(
    private val signalingGate: PairingSignalingGate,
    private val signalClient: SignalClient,
    private val didManager: DIDManager,
    private val signalingConfig: SignalingConfig,
    @Suppress("unused") // Plan A.1 — ice:config 拦截搬回 WebRTCClient.initialize；构造参数保留避免改 Hilt 注入图
    private val pairedPeersStore: com.chainlesschain.android.core.p2p.pairing.PairedPeersStore,
    // Plan A.1 — DC fast-path transport + DC-path response listener
    private val webRTCClient: WebRTCClient,
) {

    private val pending = ConcurrentHashMap<String, CompletableDeferred<JSONObject>>()
    @Volatile private var responseListenerInstalled = false
    @Volatile private var signalingListenerJob: Job? = null
    @Volatile private var dcListenerJob: Job? = null

    /**
     * Plan A.1 §3.6 feature flag — DC fast path 总开关。默认 true。
     *
     * 当前 in-memory；Phase 3 接 SharedPreferences("plan_a1_flags")
     * `terminal.preferDataChannel`。诊断用 — 关掉时所有 invoke 都走 signaling。
     */
    @Volatile var preferDataChannel: Boolean = true

    // Plan A.1 — Dispatchers.Main.immediate 让 listener job 跟随 Dispatchers.setMain
    // 在测试里走 TestDispatcher 受 runCurrent 控制。生产下处理量小（JSON parse +
    // deferred complete），跑 Main 无压力。
    private val scope = CoroutineScope(Dispatchers.Main.immediate + SupervisorJob())

    /**
     * Plan A.1 — DC ready 谓词。WebRTCClient.connectionState == READY 才意味着
     * DataChannel 真 OPEN（不是 DATA_CHANNEL_OPEN 字面 — 那只是 ICE 通了）。
     *
     * 同时被 feature flag gate（默认 true），允许 runtime 关 DC fast path 用于诊断。
     */
    private fun isDcReady(): Boolean =
        webRTCClient.connectionState.value == P2PConnectionState.READY &&
            preferDataChannel

    /**
     * 调用桌面命令。method/params 与 desktop AICommands/SystemCommands 期望一致。
     *
     * @param pcPeerId 已配对桌面的 peerId（PairedPeersStore 拿）
     * @param method 命令方法名（e.g. "system.status" / "ai.chat"）
     * @param params 参数 map
     * @param timeoutMs 超时（默认 30s）
     * @return 响应 result JSON / 失败带 error
     */
    suspend fun invoke(
        pcPeerId: String,
        method: String,
        params: Map<String, Any?> = emptyMap(),
        timeoutMs: Long = 30_000L,
    ): Result<JSONObject> {
        ensureResponseListener()
        val identity = didManager.currentIdentity.value
            ?: return Result.failure(IllegalStateException("本地无 DID"))

        val requestId = UUID.randomUUID().toString()
        val deferred = CompletableDeferred<JSONObject>()
        pending[requestId] = deferred

        // wire shape 必须对齐 desktop handleMobileCommand:
        //   {type:"chainlesschain:command:request", payload:{id, method, params}}
        // 桌面会解 `message.payload` (可能是 string JSON 或 object) 取 id/method/params
        val request = JSONObject().apply {
            put("type", "chainlesschain:command:request")
            put("payload", JSONObject().apply {
                put("id", requestId)
                put("method", method)
                put("params", JSONObject(params))
                put("auth", JSONObject().apply { put("did", identity.did) })
                put("timestamp", System.currentTimeMillis())
            })
        }

        return try {
            // Plan A.1 — DC fast path 优先。失败 silent fallback signaling。
            val dcSent = trySendViaDataChannel(request, requestId, method)
            if (!dcSent) {
                // 先 ensureRegistered（用自身 DID 注册），再 sendForwarded
                signalingGate.ensureRegistered(identity.did).getOrThrow()
                val payload = mutableMapOf<String, Any?>()
                for (k in request.keys()) payload[k] = request.get(k)
                var sendRes = signalingGate.sendAck(pcPeerId, payload)
                // v1.3+: LAN signaling 不通时自动 fallback 到公网中继再试一次，
                // 模式与 ScanDesktopPairingViewModel 配对路径一致：reset gate →
                // switch URL → re-register → resend。桌面 outbound 也连同一中
                // 继，pcPeerId 两处都登记，无需切换目标地址。
                if (sendRes.isFailure) {
                    val lanErr = sendRes.exceptionOrNull()?.message ?: "?"
                    Timber.w("[SignalingRpc] LAN sendForwarded failed ($lanErr), falling back to relay")
                    signalingGate.reset()
                    val relayUrl = signalingConfig.getRelayUrl()
                    signalingConfig.setCustomSignalingUrl(relayUrl)
                    Timber.i("[SignalingRpc] switching to relay: $relayUrl")
                    signalingGate.ensureRegistered(identity.did).getOrThrow()
                    sendRes = signalingGate.sendAck(pcPeerId, payload)
                    if (sendRes.isFailure) {
                        pending.remove(requestId)
                        return Result.failure(
                            sendRes.exceptionOrNull() ?: Exception("信令转发失败 (LAN+relay)"),
                        )
                    }
                    Timber.i("[SignalingRpc] ✓ relay sendForwarded succeeded — remote mode")
                }
                Timber.i("[SignalingRpc.metric] path=signaling → $pcPeerId $method (rid=${requestId.take(8)}…)")
            }

            val response = withTimeout(timeoutMs) { deferred.await() }
            val err = response.opt("error")
            if (err != null && err != JSONObject.NULL) {
                Result.failure(Exception("远程错误: $err"))
            } else {
                // result 字段可能是 object / scalar / null。包成 JSONObject 兜底，
                // scalar 时把整个 response 返回让调用方自己挑。
                val resultRaw = response.opt("result")
                val result = when (resultRaw) {
                    is JSONObject -> resultRaw
                    null, JSONObject.NULL -> JSONObject()
                    else -> JSONObject().put("value", resultRaw)
                }
                Result.success(result)
            }
        } catch (_: TimeoutCancellationException) {
            pending.remove(requestId)
            Result.failure(Exception("远程命令超时 (${timeoutMs / 1000}s)"))
        } catch (e: Exception) {
            pending.remove(requestId)
            Timber.e(e, "[SignalingRpc] invoke failed: $method")
            Result.failure(e)
        }
    }

    /**
     * 安装响应 listener — **双路监听**：
     *   1. [SignalClient.forwardedMessages] — signaling-forward 路径
     *   2. [WebRTCClient.messages] — DC 直连路径（也含 signaling 入，因
     *      WebRTCClient.initialize 的 ice:config callback 把 forward msg 也
     *      emit 到此 flow）
     *
     * 同 requestId 的响应到任一路 → complete pending pool 里同一 deferred。
     * 二次 complete 被 CompletableDeferred 安全忽略，无需显式去重。
     *
     * Plan A.1 — 改订阅 SharedFlow 替代旧的 setOnForwardedMessageReceived 单
     * callback（被 TerminalRpcClient.start 覆盖造成 RPC 响应永远到不了，Trap 1）。
     * ice:config 拦截 **不再** 在本类做——由 WebRTCClient.initialize 的
     * canonical handler 独占。
     *
     * 一次性安装（idempotent），多次 invoke 复用同一 collect job。
     */
    private fun ensureResponseListener() {
        if (responseListenerInstalled) return
        signalingListenerJob = signalClient.forwardedMessages
            .onEach { raw -> handleForwardedMessage(raw) }
            .launchIn(scope)
        dcListenerJob = webRTCClient.messages
            .onEach { raw -> handleForwardedMessage(raw) }
            .launchIn(scope)
        responseListenerInstalled = true
        Timber.i("[SignalingRpc] response listener installed (forwardedMessages + webRTCClient.messages)")
    }

    /**
     * Plan A.1 — DC fast path 发送尝试。
     *
     * 仅当 [isDcReady] 时尝试。成功返 true 让 caller 跳过 signaling；失败
     * (throws / DC not OPEN) 返 false 让 caller fallback signaling。
     *
     * 注意：成功"发出"不代表"对端收到"。如果对端没回响应，30s timeout 触发，
     * caller 的 deferred.await() 会抛 TimeoutCancellationException。
     * Phase 4 加 Android 端反向去重 (response twin from DC + signaling) 在
     * [handleForwardedMessage] 通过 pending.remove 的天然原子性已经搞定。
     */
    private fun trySendViaDataChannel(request: JSONObject, requestId: String, method: String): Boolean {
        if (!isDcReady()) return false
        return try {
            webRTCClient.sendMessage(request.toString())
            Timber.i("[SignalingRpc.metric] path=dc → $method (rid=${requestId.take(8)}…)")
            true
        } catch (e: Exception) {
            // DC send 抛通常是 IllegalStateException("Data channel not open") — 状态
            // 在 isDcReady 检查和 sendMessage 之间漂走了。fallback signaling。
            Timber.w(e, "[SignalingRpc] DC send failed, will fallback signaling: ${e.message}")
            false
        }
    }

    private fun handleForwardedMessage(raw: String) {
        try {
            val msg = JSONObject(raw)
            val msgType = msg.optString("type")

            // 桌面响应 wire shape (handleMobileCommand → sendToMobile):
            //   {type:"chainlesschain:command:response", payload: stringified JSON-RPC 2.0
            //     containing {jsonrpc, id, result, error}}
            if (msgType != "chainlesschain:command:response") {
                return
            }
            val payloadRaw = msg.opt("payload")
            val rpcResponse = when (payloadRaw) {
                is String -> try { JSONObject(payloadRaw) } catch (_: Exception) { null }
                is JSONObject -> payloadRaw
                else -> null
            } ?: return
            val rid = rpcResponse.optString("id", null) ?: return
            val deferred = pending.remove(rid) ?: run {
                Timber.w("[SignalingRpc] response for unknown rid=$rid")
                return
            }
            // 把 jsonrpc-2.0 response 暴露给调用方：result+error
            val out = JSONObject().apply {
                if (rpcResponse.has("result")) put("result", rpcResponse.opt("result"))
                if (rpcResponse.has("error") && !rpcResponse.isNull("error")) {
                    put("error", rpcResponse.opt("error"))
                }
            }
            deferred.complete(out)
            Timber.i("[SignalingRpc] ← response (rid=${rid.take(8)}…)")
        } catch (e: Exception) {
            Timber.w(e, "[SignalingRpc] onForwardedMessage parse failed")
        }
    }
}

package com.chainlesschain.android.remote.client

import com.chainlesschain.android.core.did.manager.DIDManager
import com.chainlesschain.android.core.p2p.config.SignalingConfig
import com.chainlesschain.android.core.p2p.pairing.PairingSignalingGate
import com.chainlesschain.android.remote.webrtc.SignalClient
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.withTimeout
import org.json.JSONObject
import timber.log.Timber
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 走 signaling forward 的 RPC 客户端 — v1.3+ issue #21 plan C。
 *
 * 不依赖 WebRTC peer connection，命令直接经信令服务器（LAN ws://192.168.*:9001
 * 或公网中继 wss://signaling.chainlesschain.com）转发给桌面 pcPeerId。
 *
 * 协议（与 desktop `index.js` `handleMobileCommand` 兼容）：
 *   - 请求：`{type:"chainlesschain:command:request", requestId, command:{method, params}, auth?}`
 *   - 响应：`{type:"chainlesschain:command:response", requestId, result, error}`
 *   - requestId 关联 deferred，30s 超时
 *
 * 入口 [invoke] 阻塞到响应返回；外层 RemoteCommandClient/RemoteControlViewModel
 * 直接换它即可。
 *
 * Why C 先行：A (WebRTC 透传) + B (STUN/TURN) 需要更多 plumbing；C 协议已通
 * (pair-ack 同款 forward 路径) + 桌面端 handleMobileCommand 已 wired，缺 Android
 * 接入。详见 memory `android_remote_operate_plan_c_first.md`。
 */
@Singleton
class SignalingRpcClient @Inject constructor(
    private val signalingGate: PairingSignalingGate,
    private val signalClient: SignalClient,
    private val didManager: DIDManager,
    private val signalingConfig: SignalingConfig,
) {

    private val pending = ConcurrentHashMap<String, CompletableDeferred<JSONObject>>()
    @Volatile private var responseListenerInstalled = false

    /**
     * 调用桌面命令。method/params 与 desktop AICommands/SystemCommands 期望一致。
     *
     * @param pcPeerId 已配对桌面的 peerId（PairedDesktopsStore 拿）
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
            Timber.i("[SignalingRpc] → $pcPeerId $method (rid=${requestId.take(8)}…)")

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
     * 安装信令响应 listener：收到 type=chainlesschain:command:response 的
     * forward message 时按 requestId 查 pending → complete deferred。
     *
     * 一次性安装（idempotent），signalClient 内部以 callback 形式触发。
     */
    private fun ensureResponseListener() {
        if (responseListenerInstalled) return
        signalClient.setOnForwardedMessageReceived { raw ->
            try {
                val msg = JSONObject(raw)
                // 桌面响应 wire shape (handleMobileCommand → sendToMobile):
                //   {type:"chainlesschain:command:response", payload: stringified JSON-RPC 2.0
                //     containing {jsonrpc, id, result, error}}
                if (msg.optString("type") != "chainlesschain:command:response") {
                    return@setOnForwardedMessageReceived
                }
                val payloadRaw = msg.opt("payload")
                val rpcResponse = when (payloadRaw) {
                    is String -> try { JSONObject(payloadRaw) } catch (_: Exception) { null }
                    is JSONObject -> payloadRaw
                    else -> null
                } ?: return@setOnForwardedMessageReceived
                val rid = rpcResponse.optString("id", null) ?: return@setOnForwardedMessageReceived
                val deferred = pending.remove(rid) ?: run {
                    Timber.w("[SignalingRpc] response for unknown rid=$rid")
                    return@setOnForwardedMessageReceived
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
        responseListenerInstalled = true
        Timber.i("[SignalingRpc] response listener installed")
    }
}

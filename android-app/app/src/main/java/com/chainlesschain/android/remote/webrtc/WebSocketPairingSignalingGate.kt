package com.chainlesschain.android.remote.webrtc

import com.chainlesschain.android.core.p2p.pairing.PairingSignalingGate
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * `PairingSignalingGate` 默认实现 — Android v1.1 W3.6 (issue #19)。
 *
 * 包 [SignalClient]（默认 [WebSocketSignalClient] impl）的 connect + register
 * 调用，提供 idempotent ensureRegistered 给 DesktopPairingViewModel 用，让
 * mobile signaling WS 在 startPairing 时就连上来，能监听 desktop 经信令发
 * 的 `pairing:confirmation`。
 *
 * **Why @Singleton + Mutex**: 同时多个 caller 调 ensureRegistered (例如用户
 * 反复点 startPairing) 会引发 race condition 多次连接；Mutex 串行化 + state
 * flag 让重复调是真 no-op。
 *
 * 与正常 WebRTC pairing 流程 (P2PClient.connect → WebRTCClient.connect →
 * signalClient.connect) 共存：那条路径 idempotent 路过同一 SignalClient，
 * 后续 connect 调用走 `isConnected` 早返成功。
 */
@Singleton
class WebSocketPairingSignalingGate @Inject constructor(
    private val signalClient: SignalClient,
) : PairingSignalingGate {

    private val mutex = Mutex()

    @Volatile
    private var registeredPeerId: String? = null

    override suspend fun ensureRegistered(localPeerId: String): Result<Unit> =
        mutex.withLock {
            try {
                // short-circuit 仅在还连着原始 socket 时有效。WebSocketSignalClient
                // 的 reconnect 路径会在 onOpen 自动重发上次 register（见
                // WebSocketSignalClient.kt 的 onOpen handler）。所以这里 short-circuit
                // 安全 — 即使 WS 断过、reconnect 后 server 仍认得这个 peer。
                if (registeredPeerId == localPeerId) {
                    Timber.d("[PairingSignalingGate] already registered as $localPeerId — no-op")
                    return@withLock Result.success(Unit)
                }

                Timber.i("[PairingSignalingGate] ensureRegistered($localPeerId) — connecting signaling")
                val connectResult = signalClient.connect()
                if (connectResult.isFailure) {
                    val err = connectResult.exceptionOrNull()
                        ?: Exception("signal connect failed")
                    Timber.e("[PairingSignalingGate] connect failed: ${err.message}")
                    return@withLock Result.failure(err)
                }

                Timber.i("[PairingSignalingGate] connected, registering as $localPeerId")
                signalClient.register(
                    localPeerId,
                    mapOf(
                        "name" to android.os.Build.MODEL,
                        "platform" to "android",
                        "version" to android.os.Build.VERSION.RELEASE,
                        "role" to "pairing-listener",
                    ),
                )
                registeredPeerId = localPeerId
                Timber.i("[PairingSignalingGate] ✓ registered, ready to receive pairing:confirmation")
                Result.success(Unit)
            } catch (e: Exception) {
                Timber.e(e, "[PairingSignalingGate] ensureRegistered failed")
                Result.failure(e)
            }
        }

    /**
     * v1.1 W3.7 Flow B: phone 扫桌面 QR 完成后经信令发 pair-ack 给 desktop。
     * 内部先 ensureRegistered 保证 signaling 已连（含 self peer-id），再调
     * SignalClient.sendForwardedMessage。
     */
    override suspend fun sendAck(
        toPeerId: String,
        ackPayload: Map<String, Any?>,
    ): Result<Unit> {
        // 自己 register peer-id 优先级：
        //   1. ackPayload.mobileDid — pair-ack 路径会带（W3.7 Flow B）
        //   2. registeredPeerId — 已经注册过就复用（避免每次 invoke 都产生新 mobile-${ts}）
        //   3. 兜底 mobile-${ts} — 首次且无 DID 的极少数情况
        // 之前 bug: SignalingRpcClient.invoke() 走 command request 路径，payload 没
        // mobileDid → fallback 每次拉新 timestamp peerId，desktop signaling server 上同
        // 一个 socket 反复被 register 不同 peerId，最后 socket.peerId 被最新 register 覆盖，
        // 旧的 mobile-${ts} 在 registry 里的 socket reference 跟 socket.peerId 不一致，
        // server isOnline() 查不到匹配 → response forward 失败 → Android UI spinner 永转。
        val selfPeerId = ackPayload["mobileDid"]?.toString()
            ?: registeredPeerId
            ?: "mobile-${System.currentTimeMillis()}"
        val regResult = ensureRegistered(selfPeerId)
        if (regResult.isFailure) {
            return Result.failure(
                regResult.exceptionOrNull() ?: Exception("ensureRegistered failed"),
            )
        }
        return try {
            val jsonPayload = org.json.JSONObject()
            for ((k, v) in ackPayload) {
                when (v) {
                    is Map<*, *> -> {
                        val sub = org.json.JSONObject()
                        for ((sk, sv) in v) {
                            sub.put(sk.toString(), sv ?: org.json.JSONObject.NULL)
                        }
                        jsonPayload.put(k, sub)
                    }
                    null -> jsonPayload.put(k, org.json.JSONObject.NULL)
                    else -> jsonPayload.put(k, v)
                }
            }
            val sendResult = signalClient.sendForwardedMessage(toPeerId, jsonPayload)
            if (sendResult.isFailure) {
                return Result.failure(
                    sendResult.exceptionOrNull() ?: Exception("sendForwardedMessage failed"),
                )
            }
            Timber.i("[PairingSignalingGate] ✓ pair-ack sent to $toPeerId")
            Result.success(Unit)
        } catch (e: Exception) {
            Timber.e(e, "[PairingSignalingGate] sendAck failed")
            Result.failure(e)
        }
    }

    /**
     * 切 URL 前清掉 signaling client 的连接 + 本类缓存，确保下次
     * ensureRegistered 真的重连新 URL（不被 registeredPeerId 短路）。
     */
    override suspend fun reset() {
        mutex.withLock {
            try {
                signalClient.disconnect()
            } catch (e: Exception) {
                Timber.w(e, "[PairingSignalingGate] disconnect threw (ok)")
            }
            registeredPeerId = null
            Timber.i("[PairingSignalingGate] reset — cleared cache, signaling disconnected")
        }
    }
}

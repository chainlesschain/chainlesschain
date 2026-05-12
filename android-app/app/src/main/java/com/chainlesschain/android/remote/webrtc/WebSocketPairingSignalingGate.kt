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
        // 自己 register peer-id 用 ack 里的 mobileDid（如果有）— signaling 服务器
        // 要 client 已 register 才接受 forward 请求。
        val selfPeerId = ackPayload["mobileDid"]?.toString()
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
}

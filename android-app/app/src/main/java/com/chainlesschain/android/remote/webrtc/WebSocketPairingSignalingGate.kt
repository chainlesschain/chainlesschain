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
}

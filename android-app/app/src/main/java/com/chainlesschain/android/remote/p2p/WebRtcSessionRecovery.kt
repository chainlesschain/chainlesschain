package com.chainlesschain.android.remote.p2p

import com.chainlesschain.android.core.e2ee.session.PersistentSessionManager
import com.chainlesschain.android.feature.p2p.recovery.SessionRecovery
import com.chainlesschain.android.sync.FriendSessionHandshake
import timber.log.Timber
import java.util.concurrent.ConcurrentHashMap
import javax.inject.Inject
import javax.inject.Singleton

/**
 * [SessionRecovery] 生产实现 —— 解密失败时自愈式重建 E2EE 会话。
 *
 * 流程（[recover]）：
 * 1. **去抖**：同 peer 在 [DEBOUNCE_MS] 内多次触发只重建一次（MAC 失败风暴 → 一次握手）。
 * 2. **删旧会话**：`PersistentSessionManager.deleteSession(peerId)` 抹掉已发散的棘轮状态
 *    （否则 [FriendSessionHandshake.initiate] 会因「会话已存在」skip，无法重建）。
 * 3. **重跑握手**：`FriendSessionHandshake.initiate(peerId)` 重新 X3DH，建立全新对齐会话。
 *
 * ⚠️ **协调点（设计 §6）**：本实现修好**收端**的会话；**发端**收到重建握手时，其
 * `E2EEHandshakeCommandRouter` 必须也**删旧会话再建新**（否则发端旧发散会话不被覆盖、仍解不开
 * 收端回信）。该 force-overwrite 在握手协议层（并行 session 域），见
 * `docs/internal/p2p-self-healing-e2ee-sessions.md`。
 *
 * 时间用 `System.currentTimeMillis()`（app 运行时无 workflow 限制）。
 */
@Singleton
class WebRtcSessionRecovery @Inject constructor(
    private val sessionManager: PersistentSessionManager,
    private val handshake: FriendSessionHandshake,
) : SessionRecovery {

    /** 去抖：peerId → 上次重建发起时刻(ms)。 */
    private val lastAttempt = ConcurrentHashMap<String, Long>()

    override suspend fun recover(peerId: String): Boolean {
        val now = System.currentTimeMillis()
        val last = lastAttempt[peerId] ?: 0L
        if (now - last < DEBOUNCE_MS) {
            Timber.d("[SessionRecovery] 去抖跳过 ${peerId.take(20)}…（${now - last}ms < ${DEBOUNCE_MS}ms）")
            return false
        }
        lastAttempt[peerId] = now

        return runCatching {
            Timber.w("[SessionRecovery] 检测到会话发散 → 重建与 ${peerId.take(20)}… 的 E2EE 会话")
            sessionManager.deleteSession(peerId)
            val ok = handshake.initiate(peerId)
            Timber.i("[SessionRecovery] 重建握手 ${if (ok) "成功" else "未完成(将由后台重试)"}: ${peerId.take(20)}…")
            ok
        }.onFailure {
            Timber.w(it, "[SessionRecovery] 重建失败 ${peerId.take(20)}…")
        }.getOrDefault(false)
    }

    companion object {
        /** 同 peer 重建去抖窗口。 */
        private const val DEBOUNCE_MS = 10_000L
    }
}

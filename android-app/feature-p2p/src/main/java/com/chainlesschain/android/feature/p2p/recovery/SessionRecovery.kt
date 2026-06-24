package com.chainlesschain.android.feature.p2p.recovery

/**
 * E2EE 会话自愈 seam（依赖倒置）——好友聊天健壮性。
 *
 * 当收端解密一条消息抛 `MAC verification failed`（DoubleRatchet 棘轮发散：通常因多次重启 /
 * 传输乱序 / 重连握手覆盖了会话）时，该 peer 的后续消息会**全部解不开、永久卡死**。
 *
 * 此 seam 让 [com.chainlesschain.android.feature.p2p.repository.P2PMessageRepository] 在检测到
 * 解密失败时**自动触发会话重建**（删旧发散会话 + 重跑 X3DH 握手），用户无需手动重新配对。
 *
 * 生产实现在 app 层（`WebRtcSessionRecovery`），包 `PersistentSessionManager.deleteSession` +
 * `FriendSessionHandshake.initiate`，并自带**去抖**（同 peer 限速，避免 MAC 失败风暴触发握手风暴）。
 *
 * 依赖方向：app → feature-p2p（repository 不能直接调 app 层 handshake），故用 seam。
 * 可选注入：未 attach 时 repository 行为与之前完全一致（无回归）。
 *
 * 设计：`docs/internal/p2p-self-healing-e2ee-sessions.md`。
 */
interface SessionRecovery {

    /**
     * 触发与 [peerId]（对端 DID）的会话重建：删除已发散的旧会话 + 重新握手。
     * 实现**必须去抖**（同 peer 短时间内多次调用只重建一次）。
     * @return true=本次触发了重建；false=被去抖跳过 / 重建失败。
     */
    suspend fun recover(peerId: String): Boolean
}

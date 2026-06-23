package com.chainlesschain.android.core.p2p.connection

import com.chainlesschain.android.core.p2p.model.P2PMessage
import kotlinx.coroutines.flow.Flow

/**
 * 远程消息中继 seam（依赖倒置）——健壮性兜底。
 *
 * [P2PConnectionManager] 自带的是 **LAN-only 栈**（mDNS 发现 + 裸 TCP 端口 9999 信令 +
 * 直连 IP），AP 客户端隔离 / 跨网 / 跨 NAT 时根本建不起直连。此 seam 让消息在**没有直连
 * P2P 连接**时，仍能经一个**可达的远程信令链路**送达对端。
 *
 * 生产实现在 app 层（`WebRtcSignalingMessageRelay`），复用 `WebRTCClient.sendForwardedMessage`
 * / `forwardedMessages` 走生产信令服务器 `wss://signaling.chainlesschain.com`（通话/RPC 同款
 * 链路，已验证跨网可达）。文字消息很小，信令中继完全够用——这正是「程序健壮、经得起测试」的关键：
 * P2P 能直连就走直连（快），连不上就走信令中继（稳），不再死等 DataChannel。
 *
 * **端到端加密不变**：传入的 [P2PMessage.payload] 已是密文，远程信令服务器只转发密文。
 *
 * 可选注入：未 attach 时 [P2PConnectionManager] 行为与之前完全一致（无回归）。
 */
interface RemoteMessageRelay {

    /**
     * 把 [message] 经远程信令中继投递给 [peerId]（对端 DID）。
     * @return true=已成功投递到中继链路；false=中继不可用（调用方按发送失败处理）。
     */
    suspend fun relay(peerId: String, message: P2PMessage): Boolean

    /** 经远程信令中继**收到**的对端消息流（上层按 [P2PMessage.id] 去重）。 */
    val incoming: Flow<P2PMessage>
}

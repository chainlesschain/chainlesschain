package com.chainlesschain.android.wear.sync

import kotlinx.serialization.Serializable

/**
 * v1.2 #20 P0.2 Wear Phase 1 — phone → watch 推送 payload。
 *
 * 协议：手机 NotificationCenter / AutoPushBus 把 Marketplace / SystemAlert 类
 * 通知 forward 到 wear 时，序列化此结构走 `MessageClient.sendMessage(nodeId,
 * "/cc/push", JSON)`。watch 端 [CcWearListenerService] 反序列化后 emit 到
 * [WearApprovalStore]。
 *
 * 字段最少子集 — wear 屏幕极小，只显示用户做决策所必需信息（domain + summary +
 * amount + proposalId）。完整 payload 留手机端审计。
 *
 * @property id            稳定标识（多签：proposalId；非多签：notification id 的 hex）
 * @property kind          "multisig.purchase" | "multisig.did" | "system.alert" | ...
 * @property title         一行标题（Approval / SystemAlert 标题）
 * @property summary       一行摘要（订单详情 / 警报内容）
 * @property amountFen     可选，仅 multisig.purchase 类
 * @property severity      可选，仅 system.alert 类（"info" | "warning" | "critical"）
 * @property createdAtMs   推送到达 watch 的时间戳（用于 Tile 排序 + 过期清理）
 * @property needsBiometric 是否高风险 (sign 类)，Phase 2 触发 BiometricPrompt
 */
@Serializable
data class ApprovalRequest(
    val id: String,
    val kind: String,
    val title: String,
    val summary: String,
    val amountFen: Long? = null,
    val severity: String? = null,
    val createdAtMs: Long,
    val needsBiometric: Boolean = false,
) {
    companion object {
        /** Wearable Data Layer message path — phone → watch 推送。 */
        const val PATH_PUSH = "/cc/push"
        /** watch → phone 用户决策回传。 */
        const val PATH_DECISION = "/cc/decision"
    }
}

/**
 * Watch → phone 用户决策回传 payload。phone 端把 approved 喂 multisig.sign /
 * AutoPushBus.userDecision 等。
 */
@Serializable
data class ApprovalDecision(
    val requestId: String,
    val approved: Boolean,
    val decidedAtMs: Long,
    /** 可选 biometric attestation token（Phase 2+） */
    val biometricToken: String? = null,
)

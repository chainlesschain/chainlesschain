package com.chainlesschain.android.feature.familyguard.domain.model.permissions

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * 陪伴 tab (M6) 摘要可见性 (FAMILY-12).
 *
 * 主文档 §3.1 v0.2 + §3.6:
 *   - NEVER: 完全黑盒 (即使统计也不上报)
 *   - STATS_ONLY: 仅上报"对话频次 / 情绪标签 / 7 天低落信号" 统计, 不含原文。
 *   - 没有 "FULL" 选项 — 主文档 §3.6 明确陪伴 tab 走 Companion TEE Vault,
 *     家长端**永远拿不到 decrypt key**, 任何 "FULL" 都是技术上不可达。
 */
@Serializable
enum class CompanionSummaryAccess {
    @SerialName("never") NEVER,
    @SerialName("stats_only") STATS_ONLY,
}

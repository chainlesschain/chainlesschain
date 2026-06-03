package com.chainlesschain.android.feature.familyguard.domain.lifecycle

/**
 * 数据生命周期保留策略 (FAMILY-28). 主文档 §4.6 数据生命周期表 v0 子集 —
 * 仅覆盖 family_guard.db 当前已落地的表; 录音 / 屏幕缓存 / 错题本 / 任务 / 积分 /
 * AI 陪伴 等表随对应 ticket 落地后再扩 (各自保留期见 §4.6)。
 *
 * **不删** (永久 / 不可删, 故不在本策略): SOS 事件 (仅 resolved 后用户申请) /
 * Audit log (2y 不可删, 法律要求)。本 cleaner 永不碰这两类。
 *
 * v0 删除策略一律**硬删**; §4.6 标"归档"的 (L0/L1/任务/围栏) 暂等同硬删, 归档管线
 * (聚合后存月度统计) 留 v0.2。
 *
 * @property telemetryL0RetentionDays L0 聚合 (§4.6: 1y 归档)
 * @property telemetryL1RetentionDays L1 app+时长 (§4.6: 90d 归档)
 * @property telemetryL2RetentionDays L2 内容 (§4.6: 30d)
 * @property telemetryL3RetentionDays L3 屏幕 (§4.6: 7d)
 * @property locationRetentionDays 位置历史 (§4.6: 30d)
 * @property anomalyRetentionDays 异常事件 (§4.6 表未单列; v0 取 1y 与 L0 对齐)
 * @property unboundRelationshipRetentionDays 解绑后历史 (§4.6: 90d 后硬删)
 */
data class DataLifecyclePolicy(
    val telemetryL0RetentionDays: Int = 365,
    val telemetryL1RetentionDays: Int = 90,
    val telemetryL2RetentionDays: Int = 30,
    val telemetryL3RetentionDays: Int = 7,
    val locationRetentionDays: Int = 30,
    val anomalyRetentionDays: Int = 365,
    val unboundRelationshipRetentionDays: Int = 90,
)

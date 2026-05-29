package com.chainlesschain.android.feature.familyguard.domain.model.permissions

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Telemetry 上行权限分级 (FAMILY-12).
 *
 * 主文档 §3.2:
 *   - L0: 聚合 ("今天用了 X 小时游戏")
 *   - L1: app + 时长 (每 app 启动 / 时长 / 切换次数)
 *   - L2: 内容 (聊天文本 / 订单详情 / 浏览历史)
 *   - L3: 屏幕 (截图 / 录屏)
 *
 * 默认家长→孩子 = L1; L2/L3 需家长申请 + 孩子端弹窗同意 + 审计 (FAMILY-25
 * 上行权限过滤层落地); FAMILY-12 仅定义 enum 不实装权限决策。
 */
@Serializable
enum class TelemetryLevel(val ordinalLevel: Int) {
    @SerialName("L0") L0(0),
    @SerialName("L1") L1(1),
    @SerialName("L2") L2(2),
    @SerialName("L3") L3(3),
    ;

    /** L 越高粒度越细; 此 level >= other → 可以上报对方要求的级别。 */
    fun encompasses(other: TelemetryLevel): Boolean = ordinalLevel >= other.ordinalLevel
}

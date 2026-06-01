package com.chainlesschain.android.feature.familyguard.domain.sos

/**
 * SOS 事件状态机 (FAMILY-40). 主文档 §3.7:
 *
 *   PENDING ──acknowledge──▶ ACKNOWLEDGED ──resolve──▶ RESOLVED
 *      │                          │
 *      ├──resolve────────────────▶ RESOLVED
 *      └──cancel (5min 误触撤销)──▶ FALSE_ALARM
 *
 * [storageValue] 写入 sos_event.status 列; 不许改值。5min 撤销窗口 + 60s 兜底升级
 * 是 FAMILY-44/45 的范围; 本枚举 + Repository 仅实现状态转换 + 守卫。
 */
enum class SosStatus(val storageValue: String) {
    /** 刚触发, 等家长 acknowledge。 */
    PENDING("pending"),

    /** 已有 guardian 接通/确认。 */
    ACKNOWLEDGED("acknowledged"),

    /** 已处理结束。 */
    RESOLVED("resolved"),

    /** 误触撤销。 */
    FALSE_ALARM("false_alarm"),

    ;

    companion object {
        fun fromStorage(value: String): SosStatus? =
            entries.firstOrNull { it.storageValue == value }
    }
}

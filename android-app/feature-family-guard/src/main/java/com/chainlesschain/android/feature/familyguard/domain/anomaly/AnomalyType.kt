package com.chainlesschain.android.feature.familyguard.domain.anomaly

/**
 * 异常事件类型 (FAMILY-27 AnomalyDetector v0). 主文档 §3.2 异常事件触发 5 条 v0 规则。
 *
 * [storageValue] 写入 anomaly.type 列; 改值会破坏 on-disk 已记录的异常, 不许改。
 * GEOFENCE_DWELL (FAMILY-55, M8 联动) 已追加。
 */
enum class AnomalyType(val storageValue: String) {
    /** 单 app 连续使用 > 阈值 (默认 90min)。 */
    SINGLE_APP_OVERUSE("single_app_overuse"),

    /** 凌晨 0:00-6:00 亮屏使用。 */
    LATE_NIGHT_SCREEN("late_night_screen"),

    /** 单日游戏类 app 累计 > 阈值 (默认 180min)。 */
    DAILY_GAME_OVERUSE("daily_game_overuse"),

    /** 30 天内首次进入未知 app (不在白名单且 30 天历史未见)。 */
    UNKNOWN_APP_FIRST_SEEN("unknown_app_first_seen"),

    /** 单日充值类 intent 次数 ≥ 阈值 (默认 3)。 */
    RECHARGE_INTENT_SPIKE("recharge_intent_spike"),

    /** 在非安全区域 / 禁入区连续停留 > 阈值 (默认 30min); FAMILY-55 M8 联动。 */
    GEOFENCE_DWELL("geofence_dwell"),

    ;

    companion object {
        fun fromStorage(value: String): AnomalyType? =
            entries.firstOrNull { it.storageValue == value }
    }
}

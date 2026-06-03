package com.chainlesschain.android.feature.familyguard.domain.merger

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * 多家长冲突解决 (FAMILY-17) 用到的可序列化 enforce_rules.config 子类型.
 *
 * 主文档 §3.4 v0.2 的 enforce_rules.config JSON 示例:
 *   - app_time_limit: package + daily_max_sec + weekday/weekend window
 *   - payment_cap: per_day / per_month / per_tx_approval_threshold
 *   - app_blocklist: packages 列表
 *
 * 各 *Config 暴露解析 / 序列化 helper (codec); RuleMerger 走类型化对象 merge,
 * 而不是裸 JSON 字段拼接, 让单测在静态 / 编译期就能锁定结构。
 */

@Serializable
data class TimeWindow(
    @SerialName("start") val start: String,
    @SerialName("end") val end: String,
) {
    init {
        require(start.matches(HH_MM)) { "TimeWindow.start must be HH:mm, got '$start'" }
        require(end.matches(HH_MM)) { "TimeWindow.end must be HH:mm, got '$end'" }
    }

    fun startMinutes(): Int = toMinutes(start)
    fun endMinutes(): Int = toMinutes(end)

    /** 持续分钟; 跨午夜 (end < start) 返负值 → 由 [RuleMerger] 决定是否合法。 */
    fun durationMinutes(): Int {
        val s = startMinutes()
        val e = endMinutes()
        return if (e < s) e + DAY_MINUTES - s else e - s
    }

    private fun toMinutes(hhmm: String): Int =
        hhmm.split(":").let { it[0].toInt() * 60 + it[1].toInt() }

    companion object {
        const val DAY_MINUTES = 24 * 60
        val HH_MM = Regex("^([01]\\d|2[0-3]):([0-5]\\d)$")
    }
}

@Serializable
data class AppTimeLimitConfig(
    @SerialName("package") val packageName: String,
    @SerialName("daily_max_sec") val dailyMaxSec: Int,
    @SerialName("weekday_window") val weekdayWindow: TimeWindow? = null,
    @SerialName("weekend_window") val weekendWindow: TimeWindow? = null,
)

@Serializable
data class PaymentCapConfig(
    @SerialName("per_day") val perDay: Double,
    @SerialName("per_month") val perMonth: Double,
    @SerialName("per_tx_approval_threshold") val perTxApprovalThreshold: Double,
)

@Serializable
data class AppBlocklistConfig(
    @SerialName("packages") val packages: List<String>,
)

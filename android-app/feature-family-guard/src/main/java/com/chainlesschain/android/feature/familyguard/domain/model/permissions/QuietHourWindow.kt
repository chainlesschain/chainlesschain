package com.chainlesschain.android.feature.familyguard.domain.model.permissions

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * 私有时段窗口 (FAMILY-12).
 *
 * 主文档 §3.2 v0.2: "孩子端可声明私有时段, 期间 L0 仍上报; L1/L2/L3 全停采;
 * M3 通话默认拒接; M4 规则继续生效。"
 *
 * @property start HH:mm 24h 制 ('20:00'); 凌晨用 '00:00'
 * @property end HH:mm; end < start 时跨午夜处理 ('22:00'-'06:00' = 22:00 当天到 06:00 次日)
 * @property weekdayOnly true 仅工作日生效 (Mon-Fri); false 全周
 *
 * 单日累计窗口上限由 [FamilyPermissions._quietHoursMaxPerDayMin] 控制 (默认 240min),
 * 防孩子设全天滥用。
 */
@Serializable
data class QuietHourWindow(
    @SerialName("start") val start: String,
    @SerialName("end") val end: String,
    @SerialName("weekday_only") val weekdayOnly: Boolean = false,
) {
    init {
        require(start.matches(HH_MM)) { "start must be HH:mm, got $start" }
        require(end.matches(HH_MM)) { "end must be HH:mm, got $end" }
    }

    /** 该窗口持续分钟数; 跨午夜窗口加 24h。 */
    fun durationMinutes(): Int {
        val startMin = start.toMinutes()
        val endMin = end.toMinutes()
        val raw = endMin - startMin
        return if (raw < 0) raw + DAY_MINUTES else raw
    }

    private fun String.toMinutes(): Int {
        val parts = split(":")
        return parts[0].toInt() * 60 + parts[1].toInt()
    }

    companion object {
        const val DAY_MINUTES = 24 * 60
        private val HH_MM = Regex("^([01]\\d|2[0-3]):([0-5]\\d)$")
    }
}

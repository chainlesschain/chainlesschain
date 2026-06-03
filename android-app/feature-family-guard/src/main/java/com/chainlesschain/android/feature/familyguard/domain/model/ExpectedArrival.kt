package com.chainlesschain.android.feature.familyguard.domain.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import java.time.LocalTime
import java.time.format.DateTimeParseException

/**
 * geofence.expected_arrival 列的解码模型 (FAMILY-54，主文档 §3.8)。
 *
 * JSON 形如 `{"days":[1,2,3,4,5],"time":"08:00","grace_minutes":10}`:
 *   - [days]         ISO weekday (1=周一 .. 7=周日)；空 = 每天适用
 *   - [time]         "HH:mm" 本地应到时间（按 DI 注入的设备时区比对，见 GeofenceActionEngine）
 *   - [graceMinutes] 宽限分钟；实际到达晚于 time+grace 才算迟到
 *
 * 走 kotlinx.serialization（同 [ForegroundAppPayload] 模式，自动正确转义/容忍未知键）。
 * [parseOrNull] 解析失败 / 字段非法（time 非 HH:mm、weekday 越界）→ null（引擎据此判"无
 * 迟到规则"，ENTER 只走 on_enter，不会误报迟到）。
 */
@Serializable
data class ExpectedArrival(
    val days: List<Int> = emptyList(),
    val time: String,
    @SerialName("grace_minutes") val graceMinutes: Int = 0,
) {
    /** 解析 [time] 为 [LocalTime]；非 HH:mm 返 null。 */
    fun localTimeOrNull(): LocalTime? =
        runCatching { LocalTime.parse(time) }.getOrNull()

    private fun isValid(): Boolean =
        localTimeOrNull() != null &&
            graceMinutes >= 0 &&
            days.all { it in 1..7 }

    companion object {
        private val decoder = Json { ignoreUnknownKeys = true }

        fun parseOrNull(raw: String?): ExpectedArrival? =
            raw?.takeIf { it.isNotBlank() }
                ?.let { runCatching { decoder.decodeFromString<ExpectedArrival>(it) }.getOrNull() }
                ?.takeIf { it.isValid() }
    }
}

package com.chainlesschain.android.feature.familyguard.domain.telemetry

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/**
 * FOREGROUND_APP source 的 telemetry payload (FAMILY-20/21).
 *
 * 走 kotlinx.serialization 而非手拼 JSON 字符串: 自动正确转义所有反斜杠 / 引号 /
 * 控制字符 (手写 escape 只盖 `\` 和 `"`, 漏 \n \t 等)。source (FAMILY-21) 与
 * [com.chainlesschain.android.feature.familyguard.data.repository.ChildEventRepositoryImpl]
 * .saveForegroundAppRun (FAMILY-20) 共用 [encode] 这一个 encoder, 保证两条写入路径的
 * payload 字节一致, 消费方可统一 parse。
 *
 * 字段顺序 = 声明顺序; 默认 [Json] 无空格 → 输出 `{"package":"...","duration_ms":...}`,
 * 与原手拼字面量字节一致 (现有测试断言依赖此 shape)。
 */
@Serializable
data class ForegroundAppPayload(
    @SerialName("package") val packageName: String,
    @SerialName("duration_ms") val durationMs: Long,
) {
    companion object {
        private val json = Json

        /** decode 容忍未知键 (跨版本字段增减不炸)。 */
        private val decoder = Json { ignoreUnknownKeys = true }

        /** 编码为 child_event.payload 列的 JSON 字面量。 */
        fun encode(packageName: String, durationMs: Long): String =
            json.encodeToString(ForegroundAppPayload(packageName, durationMs))

        /**
         * 解析 child_event.payload 取包名; 非 foreground_app payload / 解析失败返 null
         * (FAMILY-27 AnomalyDetector + AnomalyScanTimer 消费前台事件包名时复用)。
         */
        fun decodePackageOrNull(payload: String): String? =
            runCatching { decoder.decodeFromString<ForegroundAppPayload>(payload).packageName }
                .getOrNull()
    }
}

package com.chainlesschain.android.feature.familyguard.domain.task

import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/**
 * 任务内一次 AI 调用记录 (主文档 §3.5 ai_call_log 元素)。
 *
 * **只存元数据**, 不含 prompt 原文 (与陪伴 tab 隐私取向一致): 时间 + 类别 +
 * prompt 哈希 (家长 review 能看"孩子借 AI 几次 / 是否反复想骗 AI 直接给答案",
 * 但看不到具体问了什么)。
 */
@Serializable
data class AiCallLogEntry(
    val timestampMs: Long,
    /** "normal" | "answer_seeking" (与 :app StudyTaskContext 的 AiCallKind 对齐)。 */
    val kind: String,
    val promptHash: String = "",
)

/** ai_call_log JSON 数组 ↔ List 的纯逻辑编解码 (防作弊审计可单测)。 */
object AiCallLogCodec {

    private val json = Json { ignoreUnknownKeys = true }

    fun decode(raw: String?): List<AiCallLogEntry> {
        if (raw.isNullOrBlank()) return emptyList()
        return runCatching { json.decodeFromString<List<AiCallLogEntry>>(raw) }.getOrDefault(emptyList())
    }

    fun encode(entries: List<AiCallLogEntry>): String = json.encodeToString(entries)

    /** 追加一条并返回新的 JSON 数组字符串 (损坏的旧值按空处理, 不丢新条目)。 */
    fun append(raw: String?, entry: AiCallLogEntry): String = encode(decode(raw) + entry)
}

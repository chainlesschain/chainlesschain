package com.chainlesschain.android.feature.familyguard.domain.sos

import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json

/**
 * SOS 兜底外部紧急联系人 (FAMILY-45，主文档 §3.7)。
 *
 * 存于 family_relationship.emergency_contacts 列（child→guardian 关系），JSON 数组形如
 * `[{"name":"外婆","phone":"13800000000","relation":"亲属"}]`。60s 内无任何 guardian
 * acknowledge → 经 SMS 推给这些联系人（含孩子位置 + 联系方式，FAMILY-45）。
 *
 * 走 kotlinx.serialization（同 [ForegroundAppPayload]/[ExpectedArrival] 模式，容忍未知键）。
 * [parseList] 解析失败 / 缺 name|phone 的项 → 丢弃该项（不让脏数据阻断兜底，但空 phone 无法
 * 触达故剔除）；整体非法 → 空列表（上层据"无有效联系人"决定 Hold）。
 */
@Serializable
data class EmergencyContact(
    val name: String,
    val phone: String,
    val relation: String? = null,
) {
    companion object {
        private val decoder = Json { ignoreUnknownKeys = true }

        fun parseList(json: String?): List<EmergencyContact> =
            json?.takeIf { it.isNotBlank() }
                ?.let { runCatching { decoder.decodeFromString<List<EmergencyContact>>(it) }.getOrNull() }
                ?.filter { it.name.isNotBlank() && it.phone.isNotBlank() }
                ?: emptyList()
    }
}

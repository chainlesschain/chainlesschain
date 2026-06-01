package com.chainlesschain.android.feature.familyguard.domain.telemetry

import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json

/**
 * SNAPSHOT_WRITER source 的 child_event.payload 编解码 (FAMILY-22).
 *
 * 走 kotlinx.serialization (而非手拼 JSON) 正确转义所有控制字符 (姓名 / 短信地址可能含
 * 引号 / 换行)。payload = [SnapshotRecord.fields] 的 JSON 对象 (Map<String,String>)。
 * source 写入与消费方解析共用本 encoder/decoder 保证字节一致。
 */
object SnapshotPayload {

    private val json = Json
    private val decoder = Json { ignoreUnknownKeys = true }
    private val mapSerializer = MapSerializer(String.serializer(), String.serializer())

    /** 编码字段 map 为 child_event.payload JSON 字面量。 */
    fun encode(fields: Map<String, String>): String =
        json.encodeToString(mapSerializer, fields)

    /** 解析 payload 还原字段 map; 失败返空 map。 */
    fun decodeOrEmpty(payload: String): Map<String, String> =
        runCatching { decoder.decodeFromString(mapSerializer, payload) }.getOrDefault(emptyMap())
}

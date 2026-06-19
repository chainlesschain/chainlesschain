package com.chainlesschain.android.presentation.aistudy

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/**
 * [PointsEvent] 的 P2P 同步线格式 (FAMILY-67 积分同步)。
 *
 * 镜像 telemetry 的 `TelemetrySyncData` 模式。积分流水是**追加型**资源 (child→parent earn/spend,
 * parent→child grant)，去重靠 `id` (DAO `INSERT … OnConflictStrategy.IGNORE` + 读侧
 * [PointsLedgerMerge]); 故只有 CREATE、无 UPDATE/DELETE。本类只管编解码。
 *
 * type 用 [PointsEventType] name 落线 (EARN/SPEND/GRANT/REVOKE/EXPIRE)；未知 type 解码即抛
 * (积分语义不能容错回落 —— 错算余额比丢一条更糟，调用方应捕获并丢弃该条)。
 */
@Serializable
data class PointsEventSyncData(
    val id: String,
    val childDid: String,
    val type: String,
    val amount: Int,
    val reason: String,
    val relatedTaskId: String? = null,
    val relatedRewardId: String? = null,
    val granterDid: String? = null,
    val timestamp: Long,
) {
    fun toEvent(): PointsEvent = PointsEvent(
        id = id,
        childDid = childDid,
        type = PointsEventType.valueOf(type),
        amount = amount,
        reason = reason,
        relatedTaskId = relatedTaskId,
        relatedRewardId = relatedRewardId,
        granterDid = granterDid,
        timestamp = timestamp,
    )

    companion object {
        private val json = Json { ignoreUnknownKeys = true }

        fun fromEvent(event: PointsEvent): PointsEventSyncData = PointsEventSyncData(
            id = event.id,
            childDid = event.childDid,
            type = event.type.name,
            amount = event.amount,
            reason = event.reason,
            relatedTaskId = event.relatedTaskId,
            relatedRewardId = event.relatedRewardId,
            granterDid = event.granterDid,
            timestamp = event.timestamp,
        )

        fun encode(event: PointsEvent): String = json.encodeToString(fromEvent(event))

        /**
         * 解码线格式 → 领域模型。malformed JSON / 未知 type 抛异常 (调用方捕获后丢弃该条，
         * 不写库 —— 积分宁缺勿错)。
         */
        fun decode(data: String): PointsEvent = json.decodeFromString<PointsEventSyncData>(data).toEvent()
    }
}

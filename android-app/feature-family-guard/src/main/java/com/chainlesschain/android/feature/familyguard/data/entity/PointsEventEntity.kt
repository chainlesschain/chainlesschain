package com.chainlesschain.android.feature.familyguard.data.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * M9 积分流水 (主文档 §3.9 `points_event`).
 *
 * 追加不可变流水 (append-only): earn/grant 为正, spend/revoke/expire 为负, 余额由折叠
 * 得出 (无 balance 表, 防双写漂移)。id 为 TEXT PK (调用方生成 UUID, 便于 P2P 同步去重)。
 * type 存 :app PointsEventType.name 小写 (earn/spend/grant/revoke/expire)。
 */
@Entity(
    tableName = "points_event",
    indices = [
        Index(value = ["child_did", "type"], name = "idx_points_event_child_type"),
        Index(value = ["child_did", "related_task_id"], name = "idx_points_event_child_task"),
        Index(value = ["timestamp"], name = "idx_points_event_ts"),
    ],
)
data class PointsEventEntity(
    @PrimaryKey
    @ColumnInfo(name = "id")
    val id: String,

    @ColumnInfo(name = "child_did")
    val childDid: String,

    @ColumnInfo(name = "type")
    val type: String,

    /** 带符号: earn/grant 正, spend/revoke/expire 负。 */
    @ColumnInfo(name = "amount")
    val amount: Int,

    @ColumnInfo(name = "reason")
    val reason: String,

    @ColumnInfo(name = "related_task_id")
    val relatedTaskId: String?,

    @ColumnInfo(name = "related_reward_id")
    val relatedRewardId: String?,

    @ColumnInfo(name = "granter_did")
    val granterDid: String?,

    @ColumnInfo(name = "timestamp")
    val timestamp: Long,
)

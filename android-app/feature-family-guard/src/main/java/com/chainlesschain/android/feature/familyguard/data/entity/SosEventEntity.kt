package com.chainlesschain.android.feature.familyguard.data.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * SOS 紧急求助事件 (FAMILY-02 placeholder schema, populated in FAMILY-40).
 *
 * 主文档 §3.7. 5 触发途径:
 *   'volume_button' | 'lock_screen' | 'in_app' | 'codeword' | 'watch_gesture'
 *
 * status 状态机:
 *   pending → acknowledged → resolved | false_alarm
 *   pending → false_alarm (5min 内孩子撤销)
 *
 * 30s 录音 / 高频位置上报 / broadcast call 走 family.call.* envelope
 * (FAMILY-43); audio_recording_ref 指向 SQLCipher 加密的本地文件路径。
 */
@Entity(
    tableName = "sos_event",
    indices = [
        Index(value = ["child_did", "triggered_at"], name = "idx_sos_child_time"),
        Index(value = ["family_group_id"]),
        Index(value = ["status"]),
    ],
)
data class SosEventEntity(
    @PrimaryKey
    @ColumnInfo(name = "id")
    val id: String,

    @ColumnInfo(name = "child_did")
    val childDid: String,

    @ColumnInfo(name = "family_group_id")
    val familyGroupId: String,

    @ColumnInfo(name = "triggered_at")
    val triggeredAt: Long,

    @ColumnInfo(name = "trigger_source")
    val triggerSource: String,

    @ColumnInfo(name = "location_snapshot")
    val locationSnapshot: String? = null,

    @ColumnInfo(name = "audio_recording_ref")
    val audioRecordingRef: String? = null,

    @ColumnInfo(name = "status")
    val status: String = "pending",

    @ColumnInfo(name = "acknowledged_by")
    val acknowledgedBy: String? = null,

    @ColumnInfo(name = "acknowledged_at")
    val acknowledgedAt: Long? = null,

    @ColumnInfo(name = "resolved_at")
    val resolvedAt: Long? = null,

    @ColumnInfo(name = "resolution_note")
    val resolutionNote: String? = null,

    @ColumnInfo(name = "cancelled_at")
    val cancelledAt: Long? = null,

    @ColumnInfo(name = "cancel_reason")
    val cancelReason: String? = null,
)

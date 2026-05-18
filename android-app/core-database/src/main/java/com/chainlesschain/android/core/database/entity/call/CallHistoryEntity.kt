package com.chainlesschain.android.core.database.entity.call

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * 通话历史记录实体
 *
 * 存储所有音视频通话记录，包括呼出、接听和未接来电
 *
 * @property id 唯一标识符
 * @property peerDid 对方DID
 * @property peerName 对方名称
 * @property peerAvatar 对方头像URL
 * @property callType 通话类型（OUTGOING, INCOMING, MISSED）
 * @property mediaType 媒体类型（AUDIO, VIDEO）
 * @property startTime 通话开始时间戳（毫秒）
 * @property endTime 通话结束时间戳（毫秒）
 * @property duration 通话时长（秒）
 * @property status 通话状态（COMPLETED, FAILED, CANCELLED）
 * @property failureReason 失败原因（如果适用）
 * @property createdAt 记录创建时间
 *
 * @since v0.32.0
 */
@Entity(
    tableName = "call_history",
    indices = [
        Index(value = ["peer_did"]),
        Index(value = ["start_time"]),
        Index(value = ["call_type"]),
        Index(value = ["media_type"])
    ]
)
data class CallHistoryEntity(
    @PrimaryKey
    @ColumnInfo(name = "id")
    val id: String,

    @ColumnInfo(name = "peer_did")
    val peerDid: String,

    @ColumnInfo(name = "peer_name")
    val peerName: String,

    @ColumnInfo(name = "peer_avatar")
    val peerAvatar: String? = null,

    @ColumnInfo(name = "call_type")
    val callType: CallType,

    @ColumnInfo(name = "media_type")
    val mediaType: MediaType,

    @ColumnInfo(name = "start_time")
    val startTime: Long,

    @ColumnInfo(name = "end_time")
    val endTime: Long? = null,

    @ColumnInfo(name = "duration")
    val duration: Long = 0, // 秒

    @ColumnInfo(name = "status")
    val status: CallStatus = CallStatus.COMPLETED,

    @ColumnInfo(name = "failure_reason")
    val failureReason: String? = null,

    @ColumnInfo(name = "created_at")
    val createdAt: Long = System.currentTimeMillis()
)

/**
 * 通话类型
 */
enum class CallType {
    /** 呼出 */
    OUTGOING,

    /** 接听 */
    INCOMING,

    /** 未接 */
    MISSED
}

/**
 * 媒体类型
 */
enum class MediaType {
    /** 音频 */
    AUDIO,

    /** 视频 */
    VIDEO
}

/**
 * 通话状态
 */
enum class CallStatus {
    /** 已完成 */
    COMPLETED,

    /** 失败 */
    FAILED,

    /** 已取消 */
    CANCELLED
}

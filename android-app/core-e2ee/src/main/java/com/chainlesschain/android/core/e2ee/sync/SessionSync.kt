package com.chainlesschain.android.core.e2ee.sync

import kotlinx.serialization.Serializable

/**
 * 会话同步数据
 *
 * 用于多设备会话同步
 */
@Serializable
data class SessionSyncData(
    /** 同步ID */
    val syncId: String,

    /** 会话ID（peerId） */
    val sessionId: String,

    /** 同步类型 */
    val type: SyncType,

    /** 同步数据负载 */
    val payload: SyncPayload,

    /** 时间戳 */
    val timestamp: Long,

    /** 设备ID */
    val deviceId: String
)

/**
 * 同步类型
 */
enum class SyncType {
    /** 会话创建 */
    SESSION_CREATED,

    /** 会话更新 */
    SESSION_UPDATED,

    /** 会话删除 */
    SESSION_DELETED,

    /** 消息发送 */
    MESSAGE_SENT,

    /** 消息接收 */
    MESSAGE_RECEIVED,

    /** 已读状态 */
    READ_STATUS,

    /** 撤回状态 */
    RECALL_STATUS
}

/**
 * 同步负载
 */
@Serializable
sealed class SyncPayload {
    /** 会话元数据同步 */
    @Serializable
    data class SessionMetadata(
        val sendMessageNumber: Int,
        val receiveMessageNumber: Int,
        val lastMessageTimestamp: Long
    ) : SyncPayload()

    /** 消息同步 */
    @Serializable
    data class Message(
        val messageId: String,
        val content: ByteArray,  // 加密内容
        val timestamp: Long,
        val isSent: Boolean
    ) : SyncPayload()

    /** 已读状态同步 */
    @Serializable
    data class ReadStatus(
        val messageIds: List<String>,
        val timestamp: Long
    ) : SyncPayload()

    /** 撤回状态同步 */
    @Serializable
    data class RecallStatus(
        val messageId: String,
        val timestamp: Long,
        val replacementText: String?
    ) : SyncPayload()
}

/**
 * 同步策略
 */
data class SyncPolicy(
    /** 是否启用多设备同步 */
    val enabled: Boolean = false,

    /** 同步间隔（毫秒） */
    val syncInterval: Long = 30 * 1000L, // 30秒

    /** 是否同步消息内容 */
    val syncMessageContent: Boolean = true,

    /** 是否同步已读状态 */
    val syncReadStatus: Boolean = true,

    /** 是否同步撤回状态 */
    val syncRecallStatus: Boolean = true,

    /** 最大同步历史数量 */
    val maxSyncHistory: Int = 1000
)

/**
 * 设备信息
 */
@Serializable
data class DeviceInfo(
    /** 设备ID */
    val deviceId: String,

    /** 设备名称 */
    val deviceName: String,

    /** 设备类型 */
    val deviceType: DeviceType,

    /** 最后活跃时间 */
    var lastActiveAt: Long,

    /** 是否在线 */
    var isOnline: Boolean
)

/**
 * 设备类型
 */
enum class DeviceType {
    ANDROID,
    IOS,
    DESKTOP,
    WEB
}

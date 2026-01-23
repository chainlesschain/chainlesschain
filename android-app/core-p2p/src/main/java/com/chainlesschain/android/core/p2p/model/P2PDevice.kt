package com.chainlesschain.android.core.p2p.model

import kotlinx.serialization.Serializable

/**
 * P2P设备模型
 *
 * 表示一个P2P网络中的设备
 */
@Serializable
data class P2PDevice(
    /** 设备唯一标识符（DID） */
    val deviceId: String,

    /** 设备名称 */
    val deviceName: String,

    /** 设备类型 */
    val deviceType: DeviceType = DeviceType.MOBILE,

    /** 连接状态 */
    val status: ConnectionStatus = ConnectionStatus.DISCOVERED,

    /** 网络地址（IP:Port） */
    val address: String? = null,

    /** 最后活跃时间 */
    val lastSeen: Long = System.currentTimeMillis(),

    /** 设备公钥（用于加密） */
    val publicKey: String? = null,

    /** 是否信任的设备 */
    val isTrusted: Boolean = false,

    /** 设备元数据（JSON） */
    val metadata: Map<String, String> = emptyMap()
)

/**
 * 设备类型
 */
@Serializable
enum class DeviceType {
    /** 移动设备（手机/平板） */
    MOBILE,

    /** 桌面设备（PC/Mac） */
    DESKTOP,

    /** Web设备（浏览器） */
    WEB,

    /** 其他设备 */
    OTHER
}

/**
 * 连接状态
 */
@Serializable
enum class ConnectionStatus {
    /** 已发现（未连接） */
    DISCOVERED,

    /** 连接中 */
    CONNECTING,

    /** 已连接 */
    CONNECTED,

    /** 已断开 */
    DISCONNECTED,

    /** 连接失败 */
    FAILED,

    /** 离线 */
    OFFLINE
}

/**
 * P2P消息模型
 */
@Serializable
data class P2PMessage(
    /** 消息ID */
    val id: String,

    /** 发送方设备ID */
    val fromDeviceId: String,

    /** 接收方设备ID */
    val toDeviceId: String,

    /** 消息类型 */
    val type: MessageType,

    /** 消息内容（加密后的） */
    val payload: String,

    /** 创建时间 */
    val timestamp: Long = System.currentTimeMillis(),

    /** 是否需要确认 */
    val requiresAck: Boolean = true,

    /** 是否已确认 */
    val isAcknowledged: Boolean = false
)

/**
 * 消息类型
 */
@Serializable
enum class MessageType {
    /** 文本消息 */
    TEXT,

    /** 知识库数据同步 */
    KNOWLEDGE_SYNC,

    /** 对话历史同步 */
    CONVERSATION_SYNC,

    /** 设备认证 */
    DEVICE_AUTH,

    /** 密钥交换 */
    KEY_EXCHANGE,

    /** 心跳包 */
    HEARTBEAT,

    /** 确认包 */
    ACK,

    // File Transfer Message Types

    /** 文件传输请求 */
    FILE_TRANSFER_REQUEST,

    /** 接受文件传输 */
    FILE_TRANSFER_ACCEPT,

    /** 拒绝文件传输 */
    FILE_TRANSFER_REJECT,

    /** 文件数据块 */
    FILE_TRANSFER_CHUNK,

    /** 数据块确认 */
    FILE_TRANSFER_ACK,

    /** 暂停传输 */
    FILE_TRANSFER_PAUSE,

    /** 恢复传输 */
    FILE_TRANSFER_RESUME,

    /** 取消传输 */
    FILE_TRANSFER_CANCEL,

    /** 传输完成 */
    FILE_TRANSFER_COMPLETE,

    // Social Feature Real-time Message Types

    /** 好友请求 */
    FRIEND_REQUEST,

    /** 好友请求响应 */
    FRIEND_RESPONSE,

    /** 好友状态更新 */
    FRIEND_STATUS_UPDATE,

    /** 在线状态变更 */
    PRESENCE_UPDATE,

    /** 动态发布通知 */
    POST_NOTIFICATION,

    /** 点赞通知 */
    LIKE_NOTIFICATION,

    /** 评论通知 */
    COMMENT_NOTIFICATION,

    /** 提及通知 */
    MENTION_NOTIFICATION,

    /** 实时聊天消息 */
    CHAT_MESSAGE,

    /** 正在输入指示 */
    TYPING_INDICATOR
}

/**
 * 同步状态
 */
@Serializable
data class SyncStatus(
    /** 最后同步时间 */
    val lastSyncTime: Long,

    /** 待同步消息数 */
    val pendingMessages: Int,

    /** 同步进度（0-100） */
    val progress: Int,

    /** 是否正在同步 */
    val isSyncing: Boolean
)

/**
 * 网络服务信息（用于NSD发现）
 */
data class NetworkServiceInfo(
    /** 服务名称 */
    val serviceName: String,

    /** 服务类型 */
    val serviceType: String,

    /** 主机地址 */
    val host: String,

    /** 端口号 */
    val port: Int,

    /** 附加属性 */
    val attributes: Map<String, String> = emptyMap()
)

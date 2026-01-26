package com.chainlesschain.android.core.p2p.realtime

import android.util.Log
import com.chainlesschain.android.core.p2p.model.MessageType
import com.chainlesschain.android.core.p2p.model.P2PMessage
import com.chainlesschain.android.core.p2p.sync.MessageQueue
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.*
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 实时事件管理器
 *
 * 负责处理实时事件的分发和监听：
 * - 好友请求和响应
 * - 在线状态更新
 * - 实时通知（点赞、评论、提及）
 * - 正在输入指示
 */
@Singleton
class RealtimeEventManager @Inject constructor(
    private val messageQueue: MessageQueue,
    private val presenceManager: PresenceManager
) {

    companion object {
        private const val TAG = "RealtimeEventManager"
    }

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val json = Json { ignoreUnknownKeys = true }

    // 实时事件流
    private val _realtimeEvents = MutableSharedFlow<RealtimeEvent>(
        replay = 0,
        extraBufferCapacity = 100,
        onBufferOverflow = BufferOverflow.DROP_OLDEST
    )
    val realtimeEvents: SharedFlow<RealtimeEvent> = _realtimeEvents.asSharedFlow()

    // 特定类型的事件流
    private val _friendRequestEvents = MutableSharedFlow<FriendRequestEvent>(replay = 0, extraBufferCapacity = 10)
    val friendRequestEvents: SharedFlow<FriendRequestEvent> = _friendRequestEvents.asSharedFlow()

    private val _notificationEvents = MutableSharedFlow<NotificationEvent>(replay = 0, extraBufferCapacity = 50)
    val notificationEvents: SharedFlow<NotificationEvent> = _notificationEvents.asSharedFlow()

    private val _typingEvents = MutableSharedFlow<TypingEvent>(replay = 0, extraBufferCapacity = 10)
    val typingEvents: SharedFlow<TypingEvent> = _typingEvents.asSharedFlow()

    private var isListening = false

    /**
     * 启动实时事件监听
     */
    fun startListening() {
        if (isListening) {
            Log.w(TAG, "Already listening to realtime events")
            return
        }

        isListening = true
        Log.i(TAG, "Starting realtime event listening")

        // TODO: 监听消息队列中的实时消息 (需要实现MessageQueue.incomingMessages)
        // scope.launch {
        //     messageQueue.incomingMessages
        //         .filter { isRealtimeMessage(it.type) }
        //         .collect { message ->
        //             try {
        //                 handleRealtimeMessage(message)
        //             } catch (e: Exception) {
        //                 Log.e(TAG, "Failed to handle realtime message: ${message.id}", e)
        //             }
        //         }
        // }

        // 启动在线状态管理
        presenceManager.startBroadcasting()
    }

    /**
     * 停止实时事件监听
     */
    fun stopListening() {
        isListening = false
        presenceManager.stopBroadcasting()
        Log.i(TAG, "Stopped realtime event listening")
    }

    /**
     * 发送好友请求
     */
    suspend fun sendFriendRequest(targetDid: String, message: String?) {
        val payload = FriendRequestPayload(
            message = message,
            timestamp = System.currentTimeMillis()
        )

        sendRealtimeMessage(
            toDeviceId = targetDid,
            type = MessageType.FRIEND_REQUEST,
            payload = json.encodeToString(FriendRequestPayload.serializer(), payload)
        )

        Log.d(TAG, "Friend request sent to: $targetDid")
    }

    /**
     * 响应好友请求
     */
    suspend fun respondToFriendRequest(targetDid: String, accepted: Boolean) {
        val payload = FriendResponsePayload(
            accepted = accepted,
            timestamp = System.currentTimeMillis()
        )

        sendRealtimeMessage(
            toDeviceId = targetDid,
            type = MessageType.FRIEND_RESPONSE,
            payload = json.encodeToString(FriendResponsePayload.serializer(), payload)
        )

        Log.d(TAG, "Friend request response sent to: $targetDid, accepted: $accepted")
    }

    /**
     * 发送实时通知
     */
    suspend fun sendNotification(
        targetDid: String,
        notificationType: NotificationType,
        title: String,
        content: String,
        targetId: String? = null
    ) {
        val payload = NotificationPayload(
            type = notificationType,
            title = title,
            content = content,
            targetId = targetId,
            timestamp = System.currentTimeMillis()
        )

        val messageType = when (notificationType) {
            NotificationType.LIKE -> MessageType.LIKE_NOTIFICATION
            NotificationType.COMMENT -> MessageType.COMMENT_NOTIFICATION
            NotificationType.MENTION -> MessageType.MENTION_NOTIFICATION
            NotificationType.POST -> MessageType.POST_NOTIFICATION
        }

        sendRealtimeMessage(
            toDeviceId = targetDid,
            type = messageType,
            payload = json.encodeToString(NotificationPayload.serializer(), payload)
        )

        Log.d(TAG, "Notification sent to: $targetDid, type: $notificationType")
    }

    /**
     * 发送正在输入指示
     */
    suspend fun sendTypingIndicator(targetDid: String, isTyping: Boolean) {
        val payload = TypingPayload(
            isTyping = isTyping,
            timestamp = System.currentTimeMillis()
        )

        sendRealtimeMessage(
            toDeviceId = targetDid,
            type = MessageType.TYPING_INDICATOR,
            payload = json.encodeToString(TypingPayload.serializer(), payload),
            requiresAck = false // 不需要确认，丢失也无妨
        )
    }

    /**
     * 处理实时消息
     */
    private suspend fun handleRealtimeMessage(message: P2PMessage) {
        when (message.type) {
            MessageType.FRIEND_REQUEST -> handleFriendRequest(message)
            MessageType.FRIEND_RESPONSE -> handleFriendResponse(message)
            MessageType.PRESENCE_UPDATE -> handlePresenceUpdate(message)
            MessageType.LIKE_NOTIFICATION,
            MessageType.COMMENT_NOTIFICATION,
            MessageType.MENTION_NOTIFICATION,
            MessageType.POST_NOTIFICATION -> handleNotification(message)
            MessageType.TYPING_INDICATOR -> handleTypingIndicator(message)
            else -> Log.w(TAG, "Unhandled realtime message type: ${message.type}")
        }
    }

    private suspend fun handleFriendRequest(message: P2PMessage) {
        val payload = json.decodeFromString(FriendRequestPayload.serializer(), message.payload)
        val event = FriendRequestEvent(
            fromDid = message.fromDeviceId,
            message = payload.message,
            timestamp = payload.timestamp
        )
        _friendRequestEvents.emit(event)
        _realtimeEvents.emit(RealtimeEvent.FriendRequest(event))
        Log.d(TAG, "Friend request received from: ${message.fromDeviceId}")
    }

    private suspend fun handleFriendResponse(message: P2PMessage) {
        val payload = json.decodeFromString(FriendResponsePayload.serializer(), message.payload)
        val event = FriendResponseEvent(
            fromDid = message.fromDeviceId,
            accepted = payload.accepted,
            timestamp = payload.timestamp
        )
        _realtimeEvents.emit(RealtimeEvent.FriendResponse(event))
        Log.d(TAG, "Friend response received from: ${message.fromDeviceId}, accepted: ${payload.accepted}")
    }

    private suspend fun handlePresenceUpdate(message: P2PMessage) {
        val payload = json.decodeFromString(PresencePayload.serializer(), message.payload)
        val event = PresenceUpdateEvent(
            did = message.fromDeviceId,
            status = payload.status,
            lastActiveAt = payload.lastActiveAt
        )
        _realtimeEvents.emit(RealtimeEvent.PresenceUpdate(event))
        Log.d(TAG, "Presence update received: ${message.fromDeviceId} -> ${payload.status}")
    }

    private suspend fun handleNotification(message: P2PMessage) {
        val payload = json.decodeFromString(NotificationPayload.serializer(), message.payload)
        val event = NotificationEvent(
            fromDid = message.fromDeviceId,
            type = payload.type,
            title = payload.title,
            content = payload.content,
            targetId = payload.targetId,
            timestamp = payload.timestamp
        )
        _notificationEvents.emit(event)
        _realtimeEvents.emit(RealtimeEvent.Notification(event))
        Log.d(TAG, "Notification received: ${payload.type} from ${message.fromDeviceId}")
    }

    private suspend fun handleTypingIndicator(message: P2PMessage) {
        val payload = json.decodeFromString(TypingPayload.serializer(), message.payload)
        val event = TypingEvent(
            fromDid = message.fromDeviceId,
            isTyping = payload.isTyping,
            timestamp = payload.timestamp
        )
        _typingEvents.emit(event)
        Log.d(TAG, "Typing indicator: ${message.fromDeviceId} -> ${payload.isTyping}")
    }

    /**
     * 发送实时消息（不经过队列，直接发送）
     */
    private suspend fun sendRealtimeMessage(
        toDeviceId: String,
        type: MessageType,
        payload: String,
        requiresAck: Boolean = true
    ) {
        val message = P2PMessage(
            id = java.util.UUID.randomUUID().toString(),
            fromDeviceId = "", // 将由发送方填充
            toDeviceId = toDeviceId,
            type = type,
            payload = payload,
            requiresAck = requiresAck
        )

        messageQueue.enqueue(message)
    }

    /**
     * 判断是否为实时消息
     */
    private fun isRealtimeMessage(type: MessageType): Boolean {
        return when (type) {
            MessageType.FRIEND_REQUEST,
            MessageType.FRIEND_RESPONSE,
            MessageType.FRIEND_STATUS_UPDATE,
            MessageType.PRESENCE_UPDATE,
            MessageType.POST_NOTIFICATION,
            MessageType.LIKE_NOTIFICATION,
            MessageType.COMMENT_NOTIFICATION,
            MessageType.MENTION_NOTIFICATION,
            MessageType.CHAT_MESSAGE,
            MessageType.TYPING_INDICATOR -> true
            else -> false
        }
    }
}

// ===== 实时事件模型 =====

/**
 * 实时事件基类
 */
sealed class RealtimeEvent {
    data class FriendRequest(val event: FriendRequestEvent) : RealtimeEvent()
    data class FriendResponse(val event: FriendResponseEvent) : RealtimeEvent()
    data class PresenceUpdate(val event: PresenceUpdateEvent) : RealtimeEvent()
    data class Notification(val event: NotificationEvent) : RealtimeEvent()
}

/**
 * 好友请求事件
 */
data class FriendRequestEvent(
    val fromDid: String,
    val message: String?,
    val timestamp: Long
)

/**
 * 好友响应事件
 */
data class FriendResponseEvent(
    val fromDid: String,
    val accepted: Boolean,
    val timestamp: Long
)

/**
 * 在线状态更新事件
 */
data class PresenceUpdateEvent(
    val did: String,
    val status: PresenceStatus,
    val lastActiveAt: Long
)

/**
 * 通知事件
 */
data class NotificationEvent(
    val fromDid: String,
    val type: NotificationType,
    val title: String,
    val content: String,
    val targetId: String?,
    val timestamp: Long
)

/**
 * 正在输入事件
 */
data class TypingEvent(
    val fromDid: String,
    val isTyping: Boolean,
    val timestamp: Long
)

// ===== 消息负载模型 =====

@Serializable
data class FriendRequestPayload(
    val message: String?,
    val timestamp: Long
)

@Serializable
data class FriendResponsePayload(
    val accepted: Boolean,
    val timestamp: Long
)

@Serializable
data class PresencePayload(
    val status: PresenceStatus,
    val lastActiveAt: Long
)

@Serializable
data class NotificationPayload(
    val type: NotificationType,
    val title: String,
    val content: String,
    val targetId: String?,
    val timestamp: Long
)

@Serializable
data class TypingPayload(
    val isTyping: Boolean,
    val timestamp: Long
)

// ===== 枚举类型 =====

@Serializable
enum class PresenceStatus {
    ONLINE,
    AWAY,
    BUSY,
    OFFLINE
}

@Serializable
enum class NotificationType {
    LIKE,
    COMMENT,
    MENTION,
    POST
}

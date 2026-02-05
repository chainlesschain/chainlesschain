package com.chainlesschain.android.feature.p2p.webrtc.queue

import android.content.Context
import androidx.room.*
import com.chainlesschain.android.feature.p2p.webrtc.channel.DataChannelManager
import com.chainlesschain.android.feature.p2p.webrtc.connection.PeerConnectionState
import com.chainlesschain.android.feature.p2p.webrtc.connection.WebRTCConnectionManager
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.serialization.Serializable
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Offline message queue for P2P messaging
 *
 * Features:
 * - Queue messages when peer is offline
 * - Automatic flush when peer comes online
 * - Message ordering guarantees
 * - Persistent storage (survives app restarts)
 * - Retry with exponential backoff
 */
@Singleton
class OfflineMessageQueue @Inject constructor(
    @ApplicationContext private val context: Context,
    private val connectionManager: WebRTCConnectionManager,
    private val dataChannelManager: DataChannelManager
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val database: OfflineMessageDatabase by lazy {
        Room.databaseBuilder(
            context,
            OfflineMessageDatabase::class.java,
            "offline_messages.db"
        ).build()
    }

    private val messageDao by lazy { database.offlineMessageDao() }

    private val _queueStats = MutableStateFlow<Map<String, QueueStats>>(emptyMap())
    val queueStats: StateFlow<Map<String, QueueStats>> = _queueStats.asStateFlow()

    companion object {
        private const val MAX_RETRIES = 5
        private const val INITIAL_RETRY_DELAY_MS = 1_000L
        private const val MAX_QUEUE_SIZE_PER_PEER = 1000
    }

    init {
        // Monitor connection state changes
        scope.launch {
            connectionManager.connectionStates.collect { states ->
                states.forEach { (peerId, state) ->
                    if (state == PeerConnectionState.CONNECTED) {
                        // Peer came online, flush queue
                        flushQueue(peerId)
                    }
                }
            }
        }

        // Load initial queue statistics
        scope.launch {
            updateQueueStatistics()
        }
    }

    /**
     * Queue a message for later delivery
     *
     * @param peerId Target peer's DID
     * @param data Message data
     * @param priority Message priority (higher = more important)
     */
    suspend fun queueMessage(
        peerId: String,
        data: ByteArray,
        priority: MessagePriority = MessagePriority.NORMAL
    ): Result<Long> {
        return withContext(Dispatchers.IO) {
            try {
                // Check queue size limit
                val currentSize = messageDao.getQueueSizeForPeer(peerId)
                if (currentSize >= MAX_QUEUE_SIZE_PER_PEER) {
                    Timber.w("Queue full for $peerId, dropping message")
                    return@withContext Result.failure(
                        IllegalStateException("Queue full for peer $peerId")
                    )
                }

                val message = OfflineMessageEntity(
                    peerId = peerId,
                    data = data,
                    priority = priority,
                    timestamp = System.currentTimeMillis(),
                    retryCount = 0,
                    status = MessageStatus.PENDING
                )

                val messageId = messageDao.insertMessage(message)
                Timber.d("Queued message $messageId for $peerId (priority: $priority)")

                updateQueueStatistics()
                Result.success(messageId)
            } catch (e: Exception) {
                Timber.e(e, "Failed to queue message for $peerId")
                Result.failure(e)
            }
        }
    }

    /**
     * Flush message queue for a peer
     */
    suspend fun flushQueue(peerId: String) {
        withContext(Dispatchers.IO) {
            try {
                // Check if peer is actually connected
                if (!dataChannelManager.isReady(peerId)) {
                    Timber.w("Cannot flush queue for $peerId - not ready")
                    return@withContext
                }

                val messages = messageDao.getPendingMessages(peerId)
                if (messages.isEmpty()) {
                    Timber.d("No pending messages for $peerId")
                    return@withContext
                }

                Timber.i("Flushing ${messages.size} messages for $peerId")

                // Sort by priority (HIGH > NORMAL > LOW) and timestamp
                val sortedMessages = messages.sortedWith(
                    compareByDescending<OfflineMessageEntity> { it.priority.ordinal }
                        .thenBy { it.timestamp }
                )

                for (message in sortedMessages) {
                    try {
                        // Send message
                        val result = dataChannelManager.sendReliable(peerId, message.data)

                        if (result.isSuccess) {
                            // Mark as sent
                            messageDao.updateStatus(message.id, MessageStatus.SENT)
                            Timber.d("Sent queued message ${message.id} to $peerId")

                            // Small delay to avoid overwhelming receiver
                            delay(50)
                        } else {
                            // Failed to send, increment retry count
                            val newRetryCount = message.retryCount + 1
                            if (newRetryCount >= MAX_RETRIES) {
                                messageDao.updateStatus(message.id, MessageStatus.FAILED)
                                Timber.e("Message ${message.id} failed after $newRetryCount retries")
                            } else {
                                messageDao.updateRetryCount(message.id, newRetryCount)
                                Timber.w("Failed to send message ${message.id}, retry $newRetryCount/$MAX_RETRIES")

                                // Exponential backoff
                                val delayMs = INITIAL_RETRY_DELAY_MS * (1 shl (newRetryCount - 1))
                                delay(delayMs)
                            }
                        }
                    } catch (e: Exception) {
                        Timber.e(e, "Error sending queued message ${message.id}")
                    }
                }

                updateQueueStatistics()
            } catch (e: Exception) {
                Timber.e(e, "Failed to flush queue for $peerId")
            }
        }
    }

    /**
     * Get queue size for a peer
     */
    suspend fun getQueueSize(peerId: String): Int {
        return withContext(Dispatchers.IO) {
            messageDao.getQueueSizeForPeer(peerId)
        }
    }

    /**
     * Clear sent messages from queue
     */
    suspend fun clearSentMessages(peerId: String) {
        withContext(Dispatchers.IO) {
            val deleted = messageDao.deleteSentMessages(peerId)
            Timber.i("Cleared $deleted sent messages for $peerId")
            updateQueueStatistics()
        }
    }

    /**
     * Clear all messages for a peer
     */
    suspend fun clearAllMessages(peerId: String) {
        withContext(Dispatchers.IO) {
            val deleted = messageDao.deleteAllMessages(peerId)
            Timber.i("Cleared $deleted messages for $peerId")
            updateQueueStatistics()
        }
    }

    /**
     * Get pending messages for a peer
     */
    suspend fun getPendingMessages(peerId: String): List<OfflineMessageEntity> {
        return withContext(Dispatchers.IO) {
            messageDao.getPendingMessages(peerId)
        }
    }

    /**
     * Update queue statistics
     */
    private suspend fun updateQueueStatistics() {
        withContext(Dispatchers.IO) {
            try {
                val allMessages = messageDao.getAllMessages()
                val statsByPeer = allMessages
                    .groupBy { it.peerId }
                    .mapValues { (_, messages) ->
                        QueueStats(
                            totalMessages = messages.size,
                            pendingMessages = messages.count { it.status == MessageStatus.PENDING },
                            sentMessages = messages.count { it.status == MessageStatus.SENT },
                            failedMessages = messages.count { it.status == MessageStatus.FAILED }
                        )
                    }

                _queueStats.value = statsByPeer
            } catch (e: Exception) {
                Timber.e(e, "Failed to update queue statistics")
            }
        }
    }

    /**
     * Cleanup old messages (sent messages older than 7 days)
     */
    suspend fun cleanupOldMessages() {
        withContext(Dispatchers.IO) {
            try {
                val cutoffTime = System.currentTimeMillis() - (7 * 24 * 60 * 60 * 1000L) // 7 days
                val deleted = messageDao.deleteOldSentMessages(cutoffTime)
                Timber.i("Cleaned up $deleted old messages")
                updateQueueStatistics()
            } catch (e: Exception) {
                Timber.e(e, "Failed to cleanup old messages")
            }
        }
    }

    /**
     * Cleanup resources
     */
    fun cleanup() {
        scope.cancel()
        database.close()
    }
}

/**
 * Queue statistics
 */
data class QueueStats(
    val totalMessages: Int,
    val pendingMessages: Int,
    val sentMessages: Int,
    val failedMessages: Int
)

/**
 * Message priority
 */
enum class MessagePriority {
    LOW,
    NORMAL,
    HIGH
}

/**
 * Message status
 */
enum class MessageStatus {
    PENDING,
    SENT,
    FAILED
}

/**
 * Offline message entity
 */
@Entity(
    tableName = "offline_messages",
    indices = [
        Index(value = ["peer_id", "status"]),
        Index(value = ["timestamp"])
    ]
)
data class OfflineMessageEntity(
    @PrimaryKey(autoGenerate = true)
    @ColumnInfo(name = "id")
    val id: Long = 0,

    @ColumnInfo(name = "peer_id")
    val peerId: String,

    @ColumnInfo(name = "data", typeAffinity = ColumnInfo.BLOB)
    val data: ByteArray,

    @ColumnInfo(name = "priority")
    val priority: MessagePriority,

    @ColumnInfo(name = "timestamp")
    val timestamp: Long,

    @ColumnInfo(name = "retry_count")
    val retryCount: Int,

    @ColumnInfo(name = "status")
    val status: MessageStatus
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (javaClass != other?.javaClass) return false

        other as OfflineMessageEntity

        if (id != other.id) return false
        if (peerId != other.peerId) return false
        if (!data.contentEquals(other.data)) return false
        if (priority != other.priority) return false
        if (timestamp != other.timestamp) return false
        if (retryCount != other.retryCount) return false
        if (status != other.status) return false

        return true
    }

    override fun hashCode(): Int {
        var result = id.hashCode()
        result = 31 * result + peerId.hashCode()
        result = 31 * result + data.contentHashCode()
        result = 31 * result + priority.hashCode()
        result = 31 * result + timestamp.hashCode()
        result = 31 * result + retryCount
        result = 31 * result + status.hashCode()
        return result
    }
}

/**
 * Offline message DAO
 */
@Dao
interface OfflineMessageDao {
    @Query("SELECT * FROM offline_messages WHERE peer_id = :peerId AND status = 'PENDING' ORDER BY priority DESC, timestamp ASC")
    suspend fun getPendingMessages(peerId: String): List<OfflineMessageEntity>

    @Query("SELECT * FROM offline_messages")
    suspend fun getAllMessages(): List<OfflineMessageEntity>

    @Query("SELECT COUNT(*) FROM offline_messages WHERE peer_id = :peerId AND status = 'PENDING'")
    suspend fun getQueueSizeForPeer(peerId: String): Int

    @Insert
    suspend fun insertMessage(message: OfflineMessageEntity): Long

    @Query("UPDATE offline_messages SET status = :status WHERE id = :id")
    suspend fun updateStatus(id: Long, status: MessageStatus)

    @Query("UPDATE offline_messages SET retry_count = :retryCount WHERE id = :id")
    suspend fun updateRetryCount(id: Long, retryCount: Int)

    @Query("DELETE FROM offline_messages WHERE peer_id = :peerId AND status = 'SENT'")
    suspend fun deleteSentMessages(peerId: String): Int

    @Query("DELETE FROM offline_messages WHERE peer_id = :peerId")
    suspend fun deleteAllMessages(peerId: String): Int

    @Query("DELETE FROM offline_messages WHERE status = 'SENT' AND timestamp < :cutoffTime")
    suspend fun deleteOldSentMessages(cutoffTime: Long): Int
}

/**
 * Offline message database
 */
@Database(entities = [OfflineMessageEntity::class], version = 1, exportSchema = false)
abstract class OfflineMessageDatabase : RoomDatabase() {
    abstract fun offlineMessageDao(): OfflineMessageDao
}

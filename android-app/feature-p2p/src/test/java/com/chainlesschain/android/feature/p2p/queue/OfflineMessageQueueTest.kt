package com.chainlesschain.android.feature.p2p.queue

import com.chainlesschain.android.core.database.dao.OfflineQueueDao
import com.chainlesschain.android.core.database.dao.PeerQueueCount
import com.chainlesschain.android.core.database.entity.MessagePriority
import com.chainlesschain.android.core.database.entity.OfflineQueueEntity
import com.chainlesschain.android.core.database.entity.QueueStatus
import io.mockk.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.*
import org.junit.After
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * OfflineMessageQueue 单元测试
 */
@OptIn(ExperimentalCoroutinesApi::class)
class OfflineMessageQueueTest {

    private lateinit var offlineMessageQueue: OfflineMessageQueue
    private lateinit var offlineQueueDao: OfflineQueueDao

    private val testDispatcher = StandardTestDispatcher()
    private val testPeerId = "did:key:test-peer-123"

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        offlineQueueDao = mockk(relaxed = true)
        offlineMessageQueue = OfflineMessageQueue(offlineQueueDao)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
        offlineMessageQueue.stop()
    }

    // ===== 入队测试 =====

    @Test
    fun `enqueue should insert message to database`() = runTest {
        // Given
        coEvery { offlineQueueDao.insert(any()) } returns 1L

        // When
        val messageId = offlineMessageQueue.enqueue(
            peerId = testPeerId,
            messageType = "TEXT",
            payload = """{"content": "Hello"}""",
            priority = MessagePriority.NORMAL,
            requireAck = true
        )

        // Then
        assertTrue(messageId.startsWith("offline-"))
        coVerify {
            offlineQueueDao.insert(match {
                it.peerId == testPeerId &&
                it.messageType == "TEXT" &&
                it.priority == MessagePriority.NORMAL &&
                it.status == QueueStatus.PENDING
            })
        }
    }

    @Test
    fun `enqueue with high priority should be inserted correctly`() = runTest {
        // Given
        coEvery { offlineQueueDao.insert(any()) } returns 1L

        // When
        offlineMessageQueue.enqueue(
            peerId = testPeerId,
            messageType = "KNOWLEDGE_SYNC",
            payload = "{}",
            priority = MessagePriority.HIGH
        )

        // Then
        coVerify {
            offlineQueueDao.insert(match {
                it.priority == MessagePriority.HIGH
            })
        }
    }

    @Test
    fun `enqueue with expiration should set expiresAt`() = runTest {
        // Given
        coEvery { offlineQueueDao.insert(any()) } returns 1L
        val expiresInMs = 60_000L // 1 minute

        // When
        offlineMessageQueue.enqueue(
            peerId = testPeerId,
            messageType = "TEXT",
            payload = "{}",
            expiresInMs = expiresInMs
        )

        // Then
        coVerify {
            offlineQueueDao.insert(match {
                it.expiresAt != null && it.expiresAt!! > System.currentTimeMillis()
            })
        }
    }

    // ===== 查询测试 =====

    @Test
    fun `getPendingMessagesSync should filter expired messages`() = runTest {
        // Given
        val validMessage = createTestEntity("msg1", status = QueueStatus.PENDING)
        val expiredMessage = createTestEntity(
            "msg2",
            status = QueueStatus.PENDING,
            expiresAt = System.currentTimeMillis() - 1000 // 已过期
        )

        coEvery { offlineQueueDao.getPendingMessagesSync(testPeerId) } returns listOf(validMessage, expiredMessage)

        // When
        val result = offlineMessageQueue.getPendingMessagesSync(testPeerId)

        // Then
        assertEquals(1, result.size)
        assertEquals("msg1", result[0].id)
    }

    @Test
    fun `getAllPendingMessagesSync should return non-expired messages`() = runTest {
        // Given
        val messages = listOf(
            createTestEntity("msg1", status = QueueStatus.PENDING),
            createTestEntity("msg2", status = QueueStatus.RETRYING)
        )
        coEvery { offlineQueueDao.getAllPendingMessagesSync() } returns messages

        // When
        val result = offlineMessageQueue.getAllPendingMessagesSync()

        // Then
        assertEquals(2, result.size)
    }

    // ===== 状态更新测试 =====

    @Test
    fun `markAsSent should update status to SENT`() = runTest {
        // Given
        val messageId = "msg1"
        val message = createTestEntity(messageId, status = QueueStatus.PENDING)
        coEvery { offlineQueueDao.getMessageById(messageId) } returns message

        // When
        offlineMessageQueue.markAsSent(messageId)

        // Then
        coVerify { offlineQueueDao.markAsSent(messageId) }
    }

    @Test
    fun `markAsFailed with retry should update to RETRYING`() = runTest {
        // Given
        val messageId = "msg1"
        val message = createTestEntity(
            messageId,
            status = QueueStatus.PENDING,
            retryCount = 0,
            maxRetries = 5
        )
        coEvery { offlineQueueDao.getMessageById(messageId) } returns message

        // When
        offlineMessageQueue.markAsFailed(messageId, shouldRetry = true)

        // Then
        coVerify { offlineQueueDao.updateRetry(messageId) }
        coVerify(exactly = 0) { offlineQueueDao.markAsFailed(any()) }
    }

    @Test
    fun `markAsFailed at max retries should mark as permanently failed`() = runTest {
        // Given
        val messageId = "msg1"
        val message = createTestEntity(
            messageId,
            status = QueueStatus.RETRYING,
            retryCount = 5,
            maxRetries = 5
        )
        coEvery { offlineQueueDao.getMessageById(messageId) } returns message

        // When
        offlineMessageQueue.markAsFailed(messageId, shouldRetry = true)

        // Then
        coVerify { offlineQueueDao.markAsFailed(messageId) }
        coVerify(exactly = 0) { offlineQueueDao.updateRetry(any()) }
    }

    @Test
    fun `markAsFailed without retry should mark as failed`() = runTest {
        // Given
        val messageId = "msg1"
        val message = createTestEntity(messageId, status = QueueStatus.PENDING)
        coEvery { offlineQueueDao.getMessageById(messageId) } returns message

        // When
        offlineMessageQueue.markAsFailed(messageId, shouldRetry = false)

        // Then
        coVerify { offlineQueueDao.markAsFailed(messageId) }
    }

    // ===== 重试队列测试 =====

    @Test
    fun `processRetryQueue should emit ready messages`() = runTest {
        // Given
        val message = createTestEntity(
            "msg1",
            status = QueueStatus.RETRYING,
            retryCount = 1,
            lastRetryAt = System.currentTimeMillis() - 5000 // 5秒前
        )
        coEvery { offlineQueueDao.getRetryReadyMessages(any()) } returns listOf(message)

        val emittedMessages = mutableListOf<OfflineQueueEntity>()

        // Collect emissions in background
        val job = backgroundScope.launch {
            offlineMessageQueue.retryReadyMessages.collect {
                emittedMessages.add(it)
            }
        }

        // When
        offlineMessageQueue.processRetryQueue()
        advanceUntilIdle()

        // Then
        job.cancel()
        assertEquals(1, emittedMessages.size)
        assertEquals("msg1", emittedMessages[0].id)
    }

    // ===== 过期清理测试 =====

    @Test
    fun `cleanupExpiredMessages should mark expired messages`() = runTest {
        // Given
        val expiredMessage = createTestEntity(
            "msg1",
            status = QueueStatus.PENDING,
            expiresAt = System.currentTimeMillis() - 1000
        )
        coEvery { offlineQueueDao.getExpiredMessages(any()) } returns listOf(expiredMessage)

        // When
        offlineMessageQueue.cleanupExpiredMessages()
        advanceUntilIdle()

        // Then
        coVerify { offlineQueueDao.markAsExpired("msg1") }
    }

    // ===== 队列清理测试 =====

    @Test
    fun `clearQueue should delete messages for peer`() = runTest {
        // When
        offlineMessageQueue.clearQueue(testPeerId)

        // Then
        coVerify { offlineQueueDao.clearQueue(testPeerId) }
    }

    @Test
    fun `clearAllQueues should delete all messages`() = runTest {
        // When
        offlineMessageQueue.clearAllQueues()

        // Then
        coVerify { offlineQueueDao.clearAll() }
    }

    // ===== 统计测试 =====

    @Test
    fun `getStatistics should return correct counts`() = runTest {
        // Given
        val stats = listOf(
            PeerQueueCount("peer1", 5),
            PeerQueueCount("peer2", 3)
        )
        val pendingMessages = listOf(
            createTestEntity("msg1", status = QueueStatus.PENDING),
            createTestEntity("msg2", status = QueueStatus.PENDING),
            createTestEntity("msg3", status = QueueStatus.RETRYING)
        )

        coEvery { offlineQueueDao.getQueueStats() } returns stats
        coEvery { offlineQueueDao.getAllPendingMessagesSync() } returns pendingMessages

        // When
        val result = offlineMessageQueue.getStatistics()

        // Then
        assertEquals(2, result.totalPending)
        assertEquals(1, result.totalRetrying)
        assertEquals(3, result.total)
        assertEquals(5, result.byPeer["peer1"])
        assertEquals(3, result.byPeer["peer2"])
    }

    // ===== OfflineQueueEntity 测试 =====

    @Test
    fun `OfflineQueueEntity isExpired should return true for expired message`() {
        // Given
        val expiredEntity = createTestEntity(
            "msg1",
            expiresAt = System.currentTimeMillis() - 1000
        )

        // Then
        assertTrue(expiredEntity.isExpired())
    }

    @Test
    fun `OfflineQueueEntity isExpired should return false for non-expired message`() {
        // Given
        val validEntity = createTestEntity(
            "msg1",
            expiresAt = System.currentTimeMillis() + 60_000
        )

        // Then
        assertFalse(validEntity.isExpired())
    }

    @Test
    fun `OfflineQueueEntity isExpired should return false for null expiresAt`() {
        // Given
        val noExpiryEntity = createTestEntity("msg1", expiresAt = null)

        // Then
        assertFalse(noExpiryEntity.isExpired())
    }

    @Test
    fun `OfflineQueueEntity canRetry should return true when under max retries`() {
        // Given
        val entity = createTestEntity("msg1", retryCount = 2, maxRetries = 5)

        // Then
        assertTrue(entity.canRetry())
    }

    @Test
    fun `OfflineQueueEntity canRetry should return false at max retries`() {
        // Given
        val entity = createTestEntity("msg1", retryCount = 5, maxRetries = 5)

        // Then
        assertFalse(entity.canRetry())
    }

    @Test
    fun `OfflineQueueEntity canRetry should return false when expired`() {
        // Given
        val expiredEntity = createTestEntity(
            "msg1",
            retryCount = 0,
            maxRetries = 5,
            expiresAt = System.currentTimeMillis() - 1000
        )

        // Then
        assertFalse(expiredEntity.canRetry())
    }

    @Test
    fun `OfflineQueueEntity getRetryDelay should return correct delay`() {
        // Given & Then
        assertEquals(1000L, createTestEntity("msg1", retryCount = 0).getRetryDelay())
        assertEquals(1000L, createTestEntity("msg1", retryCount = 1).getRetryDelay())
        assertEquals(2000L, createTestEntity("msg1", retryCount = 2).getRetryDelay())
        assertEquals(5000L, createTestEntity("msg1", retryCount = 3).getRetryDelay())
        assertEquals(10000L, createTestEntity("msg1", retryCount = 4).getRetryDelay())
        assertEquals(30000L, createTestEntity("msg1", retryCount = 5).getRetryDelay())
        assertEquals(30000L, createTestEntity("msg1", retryCount = 10).getRetryDelay()) // 超出范围取最大值
    }

    // ===== Helper Functions =====

    private fun createTestEntity(
        id: String,
        peerId: String = testPeerId,
        messageType: String = "TEXT",
        payload: String = "{}",
        priority: String = MessagePriority.NORMAL,
        status: String = QueueStatus.PENDING,
        retryCount: Int = 0,
        maxRetries: Int = 5,
        lastRetryAt: Long? = null,
        expiresAt: Long? = null
    ) = OfflineQueueEntity(
        id = id,
        peerId = peerId,
        messageType = messageType,
        payload = payload,
        priority = priority,
        requireAck = true,
        retryCount = retryCount,
        maxRetries = maxRetries,
        lastRetryAt = lastRetryAt,
        expiresAt = expiresAt,
        status = status,
        createdAt = System.currentTimeMillis(),
        updatedAt = System.currentTimeMillis()
    )
}

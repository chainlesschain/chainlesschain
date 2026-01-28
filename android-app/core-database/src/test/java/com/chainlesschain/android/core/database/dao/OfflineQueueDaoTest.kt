package com.chainlesschain.android.core.database.dao

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import app.cash.turbine.test
import com.chainlesschain.android.core.database.ChainlessChainDatabase
import com.chainlesschain.android.core.database.entity.MessagePriority
import com.chainlesschain.android.core.database.entity.OfflineQueueEntity
import com.chainlesschain.android.core.database.entity.QueueStatus
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * OfflineQueueDao Unit Tests
 *
 * Comprehensive tests for offline message queue DAO
 *
 * Coverage:
 * - CRUD operations
 * - Priority-based ordering (HIGH > NORMAL > LOW)
 * - FIFO within same priority
 * - Retry logic with exponential backoff
 * - Expiration handling
 * - Batch operations
 * - Queue statistics
 *
 * Target: 90% code coverage for OfflineQueueDao.kt
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class OfflineQueueDaoTest {

    private lateinit var database: ChainlessChainDatabase
    private lateinit var offlineQueueDao: OfflineQueueDao

    @Before
    fun setup() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        database = Room.inMemoryDatabaseBuilder(
            context,
            ChainlessChainDatabase::class.java
        )
            .allowMainThreadQueries()
            .build()

        offlineQueueDao = database.offlineQueueDao()
    }

    @After
    fun tearDown() {
        database.close()
    }

    // ========================================
    // CRUD Tests (3 tests)
    // ========================================

    @Test
    fun `insert and retrieve offline message`() = runTest {
        // Given
        val message = createTestMessage(
            id = "msg-1",
            peerId = "peer-123",
            messageType = "TEXT",
            payload = """{"text": "Hello"}"""
        )

        // When
        val insertId = offlineQueueDao.insert(message)
        val retrieved = offlineQueueDao.getMessageById("msg-1")

        // Then
        assertTrue(insertId > 0)
        assertNotNull(retrieved)
        assertEquals("msg-1", retrieved.id)
        assertEquals("peer-123", retrieved.peerId)
    }

    @Test
    fun `insertAll batch inserts multiple messages`() = runTest {
        // Given
        val messages = (1..10).map { index ->
            createTestMessage(
                id = "msg-$index",
                peerId = "peer-123",
                payload = """{"text": "Message $index"}"""
            )
        }

        // When
        offlineQueueDao.insertAll(messages)
        val pending = offlineQueueDao.getPendingMessagesSync("peer-123")

        // Then
        assertEquals(10, pending.size)
    }

    @Test
    fun `deleteById removes message from queue`() = runTest {
        // Given
        val message = createTestMessage(id = "msg-1")
        offlineQueueDao.insert(message)

        // When
        offlineQueueDao.deleteById("msg-1")
        val retrieved = offlineQueueDao.getMessageById("msg-1")

        // Then
        assertTrue(retrieved == null)
    }

    // ========================================
    // Priority & FIFO Tests (2 tests)
    // ========================================

    @Test
    fun `getPendingMessages orders by priority then createdAt ASC`() = runTest {
        // Given: Messages with different priorities
        val now = System.currentTimeMillis()
        offlineQueueDao.insertAll(listOf(
            createTestMessage(id = "msg-1", priority = MessagePriority.NORMAL, createdAt = now - 3000),
            createTestMessage(id = "msg-2", priority = MessagePriority.HIGH, createdAt = now - 2000),
            createTestMessage(id = "msg-3", priority = MessagePriority.LOW, createdAt = now - 1000),
            createTestMessage(id = "msg-4", priority = MessagePriority.HIGH, createdAt = now - 4000)
        ))

        // When
        val pending = offlineQueueDao.getPendingMessagesSync("peer-123")

        // Then: HIGH priority first (FIFO within priority), then NORMAL, then LOW
        assertEquals(4, pending.size)
        assertEquals("msg-4", pending[0].id) // HIGH, oldest
        assertEquals("msg-2", pending[1].id) // HIGH, newer
        assertEquals("msg-1", pending[2].id) // NORMAL
        assertEquals("msg-3", pending[3].id) // LOW
    }

    @Test
    fun `messages with same priority are ordered FIFO by createdAt`() = runTest {
        // Given: All NORMAL priority
        val now = System.currentTimeMillis()
        offlineQueueDao.insertAll(listOf(
            createTestMessage(id = "msg-1", createdAt = now - 5000),
            createTestMessage(id = "msg-2", createdAt = now - 2000),
            createTestMessage(id = "msg-3", createdAt = now - 8000)
        ))

        // When
        val pending = offlineQueueDao.getPendingMessagesSync("peer-123")

        // Then: Oldest first (FIFO)
        assertEquals("msg-3", pending[0].id) // Oldest
        assertEquals("msg-1", pending[1].id)
        assertEquals("msg-2", pending[2].id) // Newest
    }

    // ========================================
    // Retry Logic Tests (2 tests)
    // ========================================

    @Test
    fun `updateRetry increments retry count and updates lastRetryAt`() = runTest {
        // Given
        val message = createTestMessage(id = "msg-1", retryCount = 0)
        offlineQueueDao.insert(message)

        // When
        val retryTime = System.currentTimeMillis()
        offlineQueueDao.updateRetry(messageId = "msg-1", lastRetryAt = retryTime)
        val retrieved = offlineQueueDao.getMessageById("msg-1")

        // Then
        assertNotNull(retrieved)
        assertEquals(1, retrieved.retryCount)
        assertEquals(QueueStatus.RETRYING, retrieved.status)
        assertEquals(retryTime, retrieved.lastRetryAt)
    }

    @Test
    fun `getRetryReadyMessages filters by minimum delay`() = runTest {
        // Given
        val now = System.currentTimeMillis()
        offlineQueueDao.insertAll(listOf(
            createTestMessage(id = "msg-1", status = QueueStatus.RETRYING, lastRetryAt = now - 3000), // Ready
            createTestMessage(id = "msg-2", status = QueueStatus.RETRYING, lastRetryAt = now - 500),  // Too soon
            createTestMessage(id = "msg-3", status = QueueStatus.RETRYING, lastRetryAt = null)       // Never retried
        ))

        // When: Min delay = 1000ms
        val retryReady = offlineQueueDao.getRetryReadyMessages(now, minDelay = 1000)

        // Then: Only messages ready for retry
        assertEquals(2, retryReady.size)
        assertTrue(retryReady.any { it.id == "msg-1" })
        assertTrue(retryReady.any { it.id == "msg-3" })
    }

    // ========================================
    // Status Management Tests (3 tests)
    // ========================================

    @Test
    fun `markAsSent changes status to SENT`() = runTest {
        // Given
        val message = createTestMessage(id = "msg-1", status = QueueStatus.PENDING)
        offlineQueueDao.insert(message)

        // When
        offlineQueueDao.markAsSent("msg-1")
        val retrieved = offlineQueueDao.getMessageById("msg-1")

        // Then
        assertNotNull(retrieved)
        assertEquals(QueueStatus.SENT, retrieved.status)
    }

    @Test
    fun `markAsFailed changes status to FAILED`() = runTest {
        // Given
        val message = createTestMessage(id = "msg-1", status = QueueStatus.RETRYING)
        offlineQueueDao.insert(message)

        // When
        offlineQueueDao.markAsFailed("msg-1")
        val retrieved = offlineQueueDao.getMessageById("msg-1")

        // Then
        assertNotNull(retrieved)
        assertEquals(QueueStatus.FAILED, retrieved.status)
    }

    @Test
    fun `markAsExpired changes status to EXPIRED`() = runTest {
        // Given
        val message = createTestMessage(id = "msg-1", status = QueueStatus.PENDING)
        offlineQueueDao.insert(message)

        // When
        offlineQueueDao.markAsExpired("msg-1")
        val retrieved = offlineQueueDao.getMessageById("msg-1")

        // Then
        assertNotNull(retrieved)
        assertEquals(QueueStatus.EXPIRED, retrieved.status)
    }

    // ========================================
    // Expiration Tests (1 test)
    // ========================================

    @Test
    fun `getExpiredMessages returns messages past expiration time`() = runTest {
        // Given
        val now = System.currentTimeMillis()
        offlineQueueDao.insertAll(listOf(
            createTestMessage(id = "msg-1", expiresAt = now - 5000, status = QueueStatus.PENDING), // Expired
            createTestMessage(id = "msg-2", expiresAt = now + 10000, status = QueueStatus.PENDING), // Not expired
            createTestMessage(id = "msg-3", expiresAt = now - 1000, status = QueueStatus.PENDING)  // Expired
        ))

        // When
        val expired = offlineQueueDao.getExpiredMessages(now)

        // Then
        assertEquals(2, expired.size)
        assertTrue(expired.any { it.id == "msg-1" })
        assertTrue(expired.any { it.id == "msg-3" })
    }

    // ========================================
    // Cleanup Tests (2 tests)
    // ========================================

    @Test
    fun `clearSentMessages removes only sent messages`() = runTest {
        // Given
        offlineQueueDao.insertAll(listOf(
            createTestMessage(id = "msg-1", status = QueueStatus.SENT),
            createTestMessage(id = "msg-2", status = QueueStatus.PENDING),
            createTestMessage(id = "msg-3", status = QueueStatus.SENT)
        ))

        // When
        offlineQueueDao.clearSentMessages()
        val remaining = offlineQueueDao.getAllPendingMessagesSync()

        // Then
        assertEquals(1, remaining.size)
        assertEquals("msg-2", remaining[0].id)
    }

    @Test
    fun `clearQueue removes all messages for specific peer`() = runTest {
        // Given
        offlineQueueDao.insertAll(listOf(
            createTestMessage(id = "msg-1", peerId = "peer-A"),
            createTestMessage(id = "msg-2", peerId = "peer-B"),
            createTestMessage(id = "msg-3", peerId = "peer-A")
        ))

        // When
        offlineQueueDao.clearQueue("peer-A")
        val remainingA = offlineQueueDao.getPendingMessagesSync("peer-A")
        val remainingB = offlineQueueDao.getPendingMessagesSync("peer-B")

        // Then
        assertEquals(0, remainingA.size)
        assertEquals(1, remainingB.size)
    }

    // ========================================
    // Statistics Tests (1 test)
    // ========================================

    @Test
    fun `getQueueStats groups messages by peer`() = runTest {
        // Given
        offlineQueueDao.insertAll(listOf(
            createTestMessage(id = "msg-1", peerId = "peer-A", status = QueueStatus.PENDING),
            createTestMessage(id = "msg-2", peerId = "peer-A", status = QueueStatus.PENDING),
            createTestMessage(id = "msg-3", peerId = "peer-B", status = QueueStatus.PENDING),
            createTestMessage(id = "msg-4", peerId = "peer-A", status = QueueStatus.SENT) // Not counted
        ))

        // When
        val stats = offlineQueueDao.getQueueStats()

        // Then
        assertEquals(2, stats.size)
        val peerAStats = stats.find { it.peerId == "peer-A" }
        val peerBStats = stats.find { it.peerId == "peer-B" }

        assertEquals(2, peerAStats?.count) // Only pending/retrying
        assertEquals(1, peerBStats?.count)
    }

    // ========================================
    // Flow Response Tests (1 test)
    // ========================================

    @Test
    fun `getTotalPendingCount emits updates on insert`() = runTest {
        offlineQueueDao.getTotalPendingCount().test {
            val initial = awaitItem()
            assertEquals(0, initial)

            // Insert pending message
            offlineQueueDao.insert(createTestMessage(id = "msg-1", status = QueueStatus.PENDING))

            val updated = awaitItem()
            assertEquals(1, updated)

            cancelAndIgnoreRemainingEvents()
        }
    }

    // ========================================
    // Peer Filtering Tests (1 test)
    // ========================================

    @Test
    fun `getPendingMessages filters by peerId`() = runTest {
        // Given
        offlineQueueDao.insertAll(listOf(
            createTestMessage(id = "msg-1", peerId = "peer-A"),
            createTestMessage(id = "msg-2", peerId = "peer-B"),
            createTestMessage(id = "msg-3", peerId = "peer-A")
        ))

        // When
        val peerAMessages = offlineQueueDao.getPendingMessagesSync("peer-A")

        // Then
        assertEquals(2, peerAMessages.size)
        assertTrue(peerAMessages.all { it.peerId == "peer-A" })
    }

    // ========================================
    // Helper Functions
    // ========================================

    private fun createTestMessage(
        id: String = "msg-${System.currentTimeMillis()}",
        peerId: String = "peer-123",
        messageType: String = "TEXT",
        payload: String = """{"text": "test"}""",
        priority: String = MessagePriority.NORMAL,
        requireAck: Boolean = true,
        retryCount: Int = 0,
        maxRetries: Int = 5,
        lastRetryAt: Long? = null,
        expiresAt: Long? = null,
        status: String = QueueStatus.PENDING,
        createdAt: Long = System.currentTimeMillis(),
        updatedAt: Long = System.currentTimeMillis()
    ): OfflineQueueEntity {
        return OfflineQueueEntity(
            id = id,
            peerId = peerId,
            messageType = messageType,
            payload = payload,
            priority = priority,
            requireAck = requireAck,
            retryCount = retryCount,
            maxRetries = maxRetries,
            lastRetryAt = lastRetryAt,
            expiresAt = expiresAt,
            status = status,
            createdAt = createdAt,
            updatedAt = updatedAt
        )
    }
}

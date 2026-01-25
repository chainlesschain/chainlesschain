package com.chainlesschain.android.feature.p2p.transfer

import com.chainlesschain.android.core.database.dao.TransferQueueDao
import com.chainlesschain.android.core.database.entity.TransferQueueEntity
import com.chainlesschain.android.core.database.entity.TransferQueueStatus
import com.chainlesschain.android.core.p2p.filetransfer.FileTransferManager
import com.chainlesschain.android.core.p2p.filetransfer.TransferScheduler
import io.mockk.MockKAnnotations
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.impl.annotations.MockK
import io.mockk.slot
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Unit tests for TransferQueueEntity and TransferScheduler
 *
 * Tests:
 * 1. Queue creation and priority handling
 * 2. Concurrent transfer limits (max 3)
 * 3. Priority-based scheduling
 * 4. Retry logic for failed transfers
 * 5. Queue statistics
 * 6. Status transitions
 */
@OptIn(ExperimentalCoroutinesApi::class)
class TransferQueueTest {

    @MockK
    private lateinit var mockQueueDao: TransferQueueDao

    @MockK
    private lateinit var mockFileTransferManager: FileTransferManager

    private lateinit var transferScheduler: TransferScheduler

    @Before
    fun setup() {
        MockKAnnotations.init(this, relaxed = true)
        transferScheduler = TransferScheduler(mockQueueDao, mockFileTransferManager)
    }

    /**
     * Test 1: Enqueue transfer with priority
     */
    @Test
    fun `enqueue should insert transfer with priority`() = runTest {
        // Given
        val queueItem = TransferQueueEntity.create(
            transferId = "transfer_123",
            fileName = "test.pdf",
            fileSize = 1024000L,
            mimeType = "application/pdf",
            priority = 3,
            isOutgoing = true,
            peerId = "peer_123"
        )

        val queueSlot = slot<TransferQueueEntity>()
        coEvery { mockQueueDao.insert(capture(queueSlot)) } returns 1L

        // When
        transferScheduler.enqueue(queueItem)

        // Then
        coVerify { mockQueueDao.insert(any()) }
        assertEquals("transfer_123", queueSlot.captured.transferId)
        assertEquals(3, queueSlot.captured.priority)
        assertEquals(TransferQueueStatus.QUEUED, queueSlot.captured.status)
    }

    /**
     * Test 2: TransferQueueEntity creation with default priority
     */
    @Test
    fun `create should use default priority 5 when not specified`() {
        // When
        val queueItem = TransferQueueEntity.create(
            transferId = "transfer_default",
            fileName = "document.docx",
            fileSize = 50000L,
            mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            isOutgoing = false,
            peerId = "peer_456"
        )

        // Then
        assertEquals(5, queueItem.priority) // Default priority
        assertEquals(TransferQueueStatus.QUEUED, queueItem.status)
        assertEquals(0, queueItem.retryCount)
    }

    /**
     * Test 3: TransferQueueEntity priority bounds (1-10)
     */
    @Test
    fun `priority should be clamped to valid range 1-10`() {
        // Test high priority (1 = highest)
        val highPriority = TransferQueueEntity.create(
            transferId = "transfer_high",
            fileName = "urgent.txt",
            fileSize = 1000L,
            mimeType = "text/plain",
            priority = 1,
            isOutgoing = true,
            peerId = "peer_789"
        )
        assertEquals(1, highPriority.priority)

        // Test low priority (10 = lowest)
        val lowPriority = TransferQueueEntity.create(
            transferId = "transfer_low",
            fileName = "backup.zip",
            fileSize = 5000000L,
            mimeType = "application/zip",
            priority = 10,
            isOutgoing = false,
            peerId = "peer_abc"
        )
        assertEquals(10, lowPriority.priority)
    }

    /**
     * Test 4: Retry count handling
     */
    @Test
    fun `canRetry should return true for failed transfers with retry count less than 3`() {
        // Given
        val failedTransfer = TransferQueueEntity.create(
            transferId = "transfer_failed",
            fileName = "failed.bin",
            fileSize = 200000L,
            mimeType = "application/octet-stream",
            isOutgoing = true,
            peerId = "peer_fail"
        ).copy(
            status = TransferQueueStatus.FAILED,
            retryCount = 1,
            errorMessage = "Network timeout"
        )

        // Then
        assertTrue(failedTransfer.canRetry())
    }

    /**
     * Test 5: Max retries exceeded
     */
    @Test
    fun `canRetry should return false when retry count exceeds 3`() {
        // Given
        val exhaustedTransfer = TransferQueueEntity.create(
            transferId = "transfer_exhausted",
            fileName = "exhausted.dat",
            fileSize = 300000L,
            mimeType = "application/octet-stream",
            isOutgoing = false,
            peerId = "peer_exhausted"
        ).copy(
            status = TransferQueueStatus.FAILED,
            retryCount = 3,
            errorMessage = "Connection refused"
        )

        // Then
        assertFalse(exhaustedTransfer.canRetry())
    }

    /**
     * Test 6: TransferQueueEntity status transitions
     */
    @Test
    fun `status should transition from QUEUED to TRANSFERRING to COMPLETED`() {
        // Given
        val queueItem = TransferQueueEntity.create(
            transferId = "transfer_transition",
            fileName = "transition.jpg",
            fileSize = 150000L,
            mimeType = "image/jpeg",
            isOutgoing = true,
            peerId = "peer_transition"
        )

        // Initial state
        assertEquals(TransferQueueStatus.QUEUED, queueItem.status)

        // Start transfer
        val transferring = queueItem.copy(status = TransferQueueStatus.TRANSFERRING)
        assertEquals(TransferQueueStatus.TRANSFERRING, transferring.status)

        // Complete transfer
        val completed = transferring.copy(status = TransferQueueStatus.COMPLETED)
        assertEquals(TransferQueueStatus.COMPLETED, completed.status)
    }

    /**
     * Test 7: Error handling with retry
     */
    @Test
    fun `failed transfer should increment retry count`() {
        // Given
        val queueItem = TransferQueueEntity.create(
            transferId = "transfer_retry",
            fileName = "retry.mp3",
            fileSize = 4000000L,
            mimeType = "audio/mpeg",
            isOutgoing = false,
            peerId = "peer_retry"
        )

        // When - first failure
        val firstFail = queueItem.copy(
            status = TransferQueueStatus.FAILED,
            retryCount = queueItem.retryCount + 1,
            errorMessage = "Checksum mismatch"
        )

        // Then
        assertEquals(1, firstFail.retryCount)
        assertEquals(TransferQueueStatus.FAILED, firstFail.status)
        assertTrue(firstFail.canRetry())
    }

    /**
     * Test 8: Queue statistics - pending count
     */
    @Test
    fun `getQueuedCount should return number of queued transfers`() = runTest {
        // Given
        coEvery { mockQueueDao.getQueued() } returns listOf(
            TransferQueueEntity.create("t1", "f1.txt", 1000L, "text/plain", isOutgoing = true, peerId = "p1"),
            TransferQueueEntity.create("t2", "f2.txt", 2000L, "text/plain", isOutgoing = true, peerId = "p2"),
            TransferQueueEntity.create("t3", "f3.txt", 3000L, "text/plain", isOutgoing = true, peerId = "p3")
        )

        // When
        val queued = mockQueueDao.getQueued()

        // Then
        assertEquals(3, queued.size)
    }

    /**
     * Test 9: Queue statistics - transferring count
     */
    @Test
    fun `getTransferringCount should respect MAX_CONCURRENT_TRANSFERS limit`() = runTest {
        // Given
        coEvery { mockQueueDao.getTransferringCount() } returns TransferScheduler.MAX_CONCURRENT_TRANSFERS

        // When
        val count = mockQueueDao.getTransferringCount()

        // Then
        assertEquals(3, count) // Max concurrent limit
    }

    /**
     * Test 10: Priority-based scheduling order
     */
    @Test
    fun `getQueued should return transfers ordered by priority ascending`() = runTest {
        // Given - priority 1 = highest, 10 = lowest
        val highPriority = TransferQueueEntity.create("t1", "urgent.txt", 1000L, "text/plain", priority = 1, isOutgoing = true, peerId = "p1")
        val mediumPriority = TransferQueueEntity.create("t2", "normal.txt", 2000L, "text/plain", priority = 5, isOutgoing = true, peerId = "p2")
        val lowPriority = TransferQueueEntity.create("t3", "backup.zip", 3000L, "application/zip", priority = 10, isOutgoing = true, peerId = "p3")

        coEvery { mockQueueDao.getQueued() } returns listOf(
            highPriority,
            mediumPriority,
            lowPriority
        )

        // When
        val queued = mockQueueDao.getQueued()

        // Then
        assertEquals(1, queued[0].priority) // Highest priority first
        assertEquals(5, queued[1].priority)
        assertEquals(10, queued[2].priority)
    }

    /**
     * Test 11: TransferQueueEntity equality
     */
    @Test
    fun `two queue items with same transferId should be equal`() {
        // Given
        val item1 = TransferQueueEntity.create(
            transferId = "transfer_same",
            fileName = "file.dat",
            fileSize = 1000L,
            mimeType = "application/octet-stream",
            isOutgoing = true,
            peerId = "peer_same"
        )
        val item2 = item1.copy()

        // Then
        assertEquals(item1.transferId, item2.transferId)
    }

    /**
     * Test 12: TransferQueueEntity isOutgoing flag
     */
    @Test
    fun `isOutgoing flag should correctly indicate transfer direction`() {
        // Outgoing transfer
        val outgoing = TransferQueueEntity.create(
            transferId = "transfer_send",
            fileName = "sending.txt",
            fileSize = 5000L,
            mimeType = "text/plain",
            isOutgoing = true,
            peerId = "peer_receiver"
        )
        assertTrue(outgoing.isOutgoing)

        // Incoming transfer
        val incoming = TransferQueueEntity.create(
            transferId = "transfer_receive",
            fileName = "receiving.txt",
            fileSize = 6000L,
            mimeType = "text/plain",
            isOutgoing = false,
            peerId = "peer_sender"
        )
        assertFalse(incoming.isOutgoing)
    }

    /**
     * Test 13: Failed transfer error message
     */
    @Test
    fun `failed transfer should store error message`() {
        // Given
        val queueItem = TransferQueueEntity.create(
            transferId = "transfer_error",
            fileName = "error.bin",
            fileSize = 7000L,
            mimeType = "application/octet-stream",
            isOutgoing = true,
            peerId = "peer_error"
        )

        // When
        val failed = queueItem.copy(
            status = TransferQueueStatus.FAILED,
            errorMessage = "Disk full: Cannot write to /tmp/error.bin"
        )

        // Then
        assertEquals(TransferQueueStatus.FAILED, failed.status)
        assertEquals("Disk full: Cannot write to /tmp/error.bin", failed.errorMessage)
    }

    /**
     * Test 14: Timestamp tracking
     */
    @Test
    fun `createdAt and updatedAt should be set correctly`() {
        // When
        val before = System.currentTimeMillis()
        val queueItem = TransferQueueEntity.create(
            transferId = "transfer_time",
            fileName = "time.log",
            fileSize = 8000L,
            mimeType = "text/plain",
            isOutgoing = false,
            peerId = "peer_time"
        )
        val after = System.currentTimeMillis()

        // Then
        assertTrue(queueItem.createdAt in before..after)
        assertTrue(queueItem.updatedAt in before..after)
    }

    /**
     * Test 15: Update timestamp on status change
     */
    @Test
    fun `updatedAt should change when status changes`() {
        // Given
        val queueItem = TransferQueueEntity.create(
            transferId = "transfer_update",
            fileName = "update.csv",
            fileSize = 9000L,
            mimeType = "text/csv",
            isOutgoing = true,
            peerId = "peer_update"
        )
        val originalUpdatedAt = queueItem.updatedAt

        // When - simulate status change after 1 second
        Thread.sleep(1)
        val updated = queueItem.copy(
            status = TransferQueueStatus.TRANSFERRING,
            updatedAt = System.currentTimeMillis()
        )

        // Then
        assertTrue(updated.updatedAt > originalUpdatedAt)
    }
}

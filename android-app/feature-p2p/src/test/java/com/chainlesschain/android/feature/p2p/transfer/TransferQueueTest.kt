package com.chainlesschain.android.feature.p2p.transfer

import com.chainlesschain.android.core.database.dao.TransferQueueDao
import com.chainlesschain.android.core.database.entity.TransferQueueEntity
import com.chainlesschain.android.core.database.entity.TransferQueueStatus
import com.chainlesschain.android.feature.p2p.filetransfer.FileTransferManager
import com.chainlesschain.android.feature.p2p.filetransfer.TransferScheduler
import io.mockk.MockKAnnotations
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.impl.annotations.MockK
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
        val transferId = "transfer_123"
        val fileName = "test.pdf"
        val priority = 3

        coEvery { mockQueueDao.insert(any()) } returns 1L

        // When
        transferScheduler.enqueue(
            transferId = transferId,
            fileName = fileName,
            priority = priority,
            isOutgoing = true
        )

        // Then
        coVerify {
            mockQueueDao.insert(match {
                it.transferId == transferId &&
                it.priority == priority &&
                it.status == TransferQueueStatus.QUEUED
            })
        }
    }

    /**
     * Test 2: Priority-based scheduling (higher priority first)
     */
    @Test
    fun `scheduleNext should start highest priority transfer first`() = runTest {
        // Given
        val queuedTransfers = listOf(
            createQueuedTransfer("low_priority", priority = 8),
            createQueuedTransfer("high_priority", priority = 2),
            createQueuedTransfer("medium_priority", priority = 5)
        )

        coEvery { mockQueueDao.getTransferringCount() } returns 0
        coEvery { mockQueueDao.getQueued() } returns queuedTransfers.sortedBy { it.priority }
        coEvery { mockQueueDao.updateStatus(any(), any()) } returns Unit
        coEvery { mockFileTransferManager.startTransfer(any()) } returns Unit

        // When
        transferScheduler.scheduleNext()

        // Then - Should start high_priority (priority=2) first
        coVerify {
            mockFileTransferManager.startTransfer(match {
                it.transferId == "high_priority"
            })
        }
    }

    /**
     * Test 3: Enforce max 3 concurrent transfers
     */
    @Test
    fun `should not exceed MAX_CONCURRENT_TRANSFERS limit`() = runTest {
        // Given - Already 3 transfers running
        val queuedTransfers = listOf(
            createQueuedTransfer("transfer_4", priority = 1),
            createQueuedTransfer("transfer_5", priority = 2)
        )

        coEvery { mockQueueDao.getTransferringCount() } returns 3 // Already at max
        coEvery { mockQueueDao.getQueued() } returns queuedTransfers

        // When
        transferScheduler.scheduleNext()

        // Then - Should NOT start new transfers
        coVerify(exactly = 0) { mockFileTransferManager.startTransfer(any()) }
    }

    /**
     * Test 4: Start multiple transfers to fill available slots
     */
    @Test
    fun `should start multiple transfers to fill available slots`() = runTest {
        // Given - 1 transfer running, 2 slots available
        val queuedTransfers = listOf(
            createQueuedTransfer("transfer_1", priority = 1),
            createQueuedTransfer("transfer_2", priority = 2),
            createQueuedTransfer("transfer_3", priority = 3)
        )

        coEvery { mockQueueDao.getTransferringCount() } returns 1 // 1 running
        coEvery { mockQueueDao.getQueued() } returns queuedTransfers
        coEvery { mockQueueDao.updateStatus(any(), any()) } returns Unit
        coEvery { mockFileTransferManager.startTransfer(any()) } returns Unit

        // When
        transferScheduler.scheduleNext()

        // Then - Should start 2 transfers (filling available slots)
        coVerify(exactly = 2) { mockFileTransferManager.startTransfer(any()) }
    }

    /**
     * Test 5: Retry logic for failed transfers
     */
    @Test
    fun `canRetry should return true for failed transfers under retry limit`() {
        // Given
        val retryableTransfer = createQueuedTransfer("transfer_123", priority = 5).copy(
            status = TransferQueueStatus.FAILED,
            retryCount = 2 // Under limit (max 3)
        )

        val exhaustedTransfer = retryableTransfer.copy(
            retryCount = 3 // At limit
        )

        // When/Then
        assertTrue(retryableTransfer.canRetry())
        assertFalse(exhaustedTransfer.canRetry())
    }

    /**
     * Test 6: Retry failed transfer
     */
    @Test
    fun `retryTransfer should increment retry count and requeue`() = runTest {
        // Given
        val failedTransfer = createQueuedTransfer("transfer_123", priority = 5).copy(
            id = 1,
            status = TransferQueueStatus.FAILED,
            retryCount = 1
        )

        coEvery { mockQueueDao.getById(1) } returns failedTransfer
        coEvery { mockQueueDao.update(any()) } returns Unit

        // When
        transferScheduler.retryTransfer(1)

        // Then
        coVerify {
            mockQueueDao.update(match {
                it.status == TransferQueueStatus.QUEUED &&
                it.retryCount == 2 &&
                it.error == null
            })
        }
    }

    /**
     * Test 7: Get queue statistics
     */
    @Test
    fun `getQueueStats should return correct counts`() = runTest {
        // Given
        coEvery { mockQueueDao.getQueuedCount() } returns 5
        coEvery { mockQueueDao.getTransferringCount() } returns 2
        coEvery { mockQueueDao.getFailedCount() } returns 1

        // When
        val stats = transferScheduler.getQueueStats()

        // Then
        assertEquals(5, stats.queuedCount)
        assertEquals(2, stats.transferringCount)
        assertEquals(1, stats.failedCount)
        assertEquals(8, stats.totalCount)
    }

    /**
     * Test 8: Cancel queued transfer
     */
    @Test
    fun `cancelTransfer should remove from queue`() = runTest {
        // Given
        val transferId = "transfer_123"
        coEvery { mockQueueDao.deleteByTransferId(transferId) } returns Unit

        // When
        transferScheduler.cancelTransfer(transferId)

        // Then
        coVerify { mockQueueDao.deleteByTransferId(transferId) }
    }

    /**
     * Test 9: Pause transfer
     */
    @Test
    fun `pauseTransfer should update status to PAUSED`() = runTest {
        // Given
        val transferId = "transfer_123"
        coEvery { mockQueueDao.updateStatus(transferId, TransferQueueStatus.PAUSED) } returns Unit

        // When
        transferScheduler.pauseTransfer(transferId)

        // Then
        coVerify { mockQueueDao.updateStatus(transferId, TransferQueueStatus.PAUSED) }
    }

    /**
     * Test 10: Resume paused transfer
     */
    @Test
    fun `resumeTransfer should change status to QUEUED and schedule`() = runTest {
        // Given
        val transferId = "transfer_123"
        coEvery { mockQueueDao.updateStatus(transferId, TransferQueueStatus.QUEUED) } returns Unit
        coEvery { mockQueueDao.getTransferringCount() } returns 0
        coEvery { mockQueueDao.getQueued() } returns listOf(
            createQueuedTransfer(transferId, priority = 5)
        )
        coEvery { mockFileTransferManager.startTransfer(any()) } returns Unit

        // When
        transferScheduler.resumeTransfer(transferId)

        // Then
        coVerify {
            mockQueueDao.updateStatus(transferId, TransferQueueStatus.QUEUED)
            mockFileTransferManager.startTransfer(any())
        }
    }

    /**
     * Test 11: Mark transfer as completed
     */
    @Test
    fun `markCompleted should update status and remove from queue`() = runTest {
        // Given
        val transferId = "transfer_123"
        coEvery { mockQueueDao.updateStatus(transferId, TransferQueueStatus.COMPLETED) } returns Unit

        // When
        transferScheduler.markCompleted(transferId)

        // Then
        coVerify { mockQueueDao.updateStatus(transferId, TransferQueueStatus.COMPLETED) }
    }

    /**
     * Test 12: Mark transfer as failed with error message
     */
    @Test
    fun `markFailed should update status and store error`() = runTest {
        // Given
        val transferId = "transfer_123"
        val errorMessage = "Network timeout"

        val queueItem = createQueuedTransfer(transferId, priority = 5).copy(
            status = TransferQueueStatus.TRANSFERRING
        )

        coEvery { mockQueueDao.getByTransferId(transferId) } returns queueItem
        coEvery { mockQueueDao.update(any()) } returns Unit

        // When
        transferScheduler.markFailed(transferId, errorMessage)

        // Then
        coVerify {
            mockQueueDao.update(match {
                it.status == TransferQueueStatus.FAILED &&
                it.error == errorMessage
            })
        }
    }

    /**
     * Test 13: Clear completed transfers
     */
    @Test
    fun `clearCompleted should delete all completed transfers`() = runTest {
        // Given
        coEvery { mockQueueDao.deleteCompleted() } returns Unit

        // When
        transferScheduler.clearCompleted()

        // Then
        coVerify { mockQueueDao.deleteCompleted() }
    }

    /**
     * Test 14: Clear failed transfers
     */
    @Test
    fun `clearFailed should delete all failed transfers`() = runTest {
        // Given
        coEvery { mockQueueDao.deleteFailed() } returns Unit

        // When
        transferScheduler.clearFailed()

        // Then
        coVerify { mockQueueDao.deleteFailed() }
    }

    /**
     * Test 15: Auto-schedule after transfer completion
     */
    @Test
    fun `onTransferComplete should schedule next transfer`() = runTest {
        // Given
        val completedTransferId = "transfer_1"
        val nextTransfer = createQueuedTransfer("transfer_2", priority = 5)

        coEvery { mockQueueDao.updateStatus(completedTransferId, TransferQueueStatus.COMPLETED) } returns Unit
        coEvery { mockQueueDao.getTransferringCount() } returns 2 // Now 2 running (was 3)
        coEvery { mockQueueDao.getQueued() } returns listOf(nextTransfer)
        coEvery { mockFileTransferManager.startTransfer(any()) } returns Unit

        // When
        transferScheduler.onTransferComplete(completedTransferId)

        // Then - Should auto-start next queued transfer
        coVerify {
            mockFileTransferManager.startTransfer(match {
                it.transferId == "transfer_2"
            })
        }
    }

    // Helper function
    private fun createQueuedTransfer(
        transferId: String,
        priority: Int = 5
    ): TransferQueueEntity {
        return TransferQueueEntity(
            id = 0,
            transferId = transferId,
            fileName = "test_$transferId.pdf",
            fileSize = 1024000L,
            priority = priority,
            status = TransferQueueStatus.QUEUED,
            isOutgoing = true,
            peerId = "peer_123",
            retryCount = 0,
            error = null,
            createdAt = System.currentTimeMillis(),
            updatedAt = System.currentTimeMillis()
        )
    }
}

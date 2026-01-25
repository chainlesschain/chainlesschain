package com.chainlesschain.android.feature.p2p.transfer

import com.chainlesschain.android.core.database.dao.TransferCheckpointDao
import com.chainlesschain.android.core.database.entity.TransferCheckpointEntity
import com.chainlesschain.android.feature.p2p.filetransfer.CheckpointManager
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
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * Unit tests for TransferCheckpointEntity and CheckpointManager
 *
 * Tests:
 * 1. Checkpoint creation and persistence
 * 2. Chunk tracking and received chunks parsing
 * 3. Missing chunks calculation
 * 4. Checkpoint updates
 * 5. Checkpoint restoration
 * 6. Checkpoint cleanup (7-day expiry)
 */
@OptIn(ExperimentalCoroutinesApi::class)
class TransferCheckpointTest {

    @MockK
    private lateinit var mockCheckpointDao: TransferCheckpointDao

    private lateinit var checkpointManager: CheckpointManager

    @Before
    fun setup() {
        MockKAnnotations.init(this, relaxed = true)
        checkpointManager = CheckpointManager(mockCheckpointDao)
    }

    /**
     * Test 1: Create checkpoint with initial state
     */
    @Test
    fun `createCheckpoint should insert new checkpoint`() = runTest {
        // Given
        val transferId = "transfer_123"
        val fileName = "test.pdf"
        val totalChunks = 100
        val totalBytes = 1024000L

        val expectedCheckpoint = TransferCheckpointEntity(
            id = 0,
            transferId = transferId,
            fileName = fileName,
            totalChunks = totalChunks,
            totalBytes = totalBytes,
            receivedChunksJson = "[]",
            lastChunkIndex = -1,
            bytesTransferred = 0L,
            createdAt = System.currentTimeMillis(),
            updatedAt = System.currentTimeMillis()
        )

        coEvery { mockCheckpointDao.insert(any()) } returns 1L

        // When
        checkpointManager.createCheckpoint(
            transferId = transferId,
            fileName = fileName,
            totalChunks = totalChunks,
            totalBytes = totalBytes
        )

        // Then
        coVerify {
            mockCheckpointDao.insert(match {
                it.transferId == transferId &&
                it.totalChunks == totalChunks &&
                it.receivedChunksJson == "[]"
            })
        }
    }

    /**
     * Test 2: Update checkpoint with received chunk
     */
    @Test
    fun `updateCheckpoint should add received chunk`() = runTest {
        // Given
        val transferId = "transfer_123"
        val existingCheckpoint = TransferCheckpointEntity(
            id = 1,
            transferId = transferId,
            fileName = "test.pdf",
            totalChunks = 10,
            totalBytes = 10240L,
            receivedChunksJson = "[0,1,2]", // Already received chunks 0-2
            lastChunkIndex = 2,
            bytesTransferred = 3072L,
            createdAt = System.currentTimeMillis(),
            updatedAt = System.currentTimeMillis()
        )

        coEvery { mockCheckpointDao.getByTransferId(transferId) } returns existingCheckpoint
        coEvery { mockCheckpointDao.update(any()) } returns Unit

        // When
        checkpointManager.updateCheckpoint(transferId, chunkIndex = 3, chunkSize = 1024L)

        // Then
        coVerify {
            mockCheckpointDao.update(match {
                it.transferId == transferId &&
                it.lastChunkIndex == 3 &&
                it.bytesTransferred == 4096L &&
                it.receivedChunksJson.contains("3")
            })
        }
    }

    /**
     * Test 3: Parse received chunks from JSON
     */
    @Test
    fun `getReceivedChunks should parse JSON array correctly`() {
        // Given
        val checkpoint = TransferCheckpointEntity(
            id = 1,
            transferId = "transfer_123",
            fileName = "test.pdf",
            totalChunks = 10,
            totalBytes = 10240L,
            receivedChunksJson = "[0,1,2,5,7,9]",
            lastChunkIndex = 9,
            bytesTransferred = 6144L,
            createdAt = System.currentTimeMillis(),
            updatedAt = System.currentTimeMillis()
        )

        // When
        val receivedChunks = checkpoint.getReceivedChunks()

        // Then
        assertEquals(6, receivedChunks.size)
        assertTrue(receivedChunks.contains(0))
        assertTrue(receivedChunks.contains(2))
        assertTrue(receivedChunks.contains(9))
        assertFalse(receivedChunks.contains(3))
        assertFalse(receivedChunks.contains(4))
    }

    /**
     * Test 4: Calculate missing chunks
     */
    @Test
    fun `getMissingChunks should return unreceived chunks`() {
        // Given
        val checkpoint = TransferCheckpointEntity(
            id = 1,
            transferId = "transfer_123",
            fileName = "test.pdf",
            totalChunks = 10,
            totalBytes = 10240L,
            receivedChunksJson = "[0,1,2,5,7,9]",
            lastChunkIndex = 9,
            bytesTransferred = 6144L,
            createdAt = System.currentTimeMillis(),
            updatedAt = System.currentTimeMillis()
        )

        // When
        val missingChunks = checkpoint.getMissingChunks()

        // Then
        assertEquals(4, missingChunks.size)
        assertTrue(missingChunks.contains(3))
        assertTrue(missingChunks.contains(4))
        assertTrue(missingChunks.contains(6))
        assertTrue(missingChunks.contains(8))
    }

    /**
     * Test 5: Calculate transfer progress
     */
    @Test
    fun `getProgress should calculate percentage correctly`() {
        // Given - 60% complete (6 out of 10 chunks)
        val checkpoint = TransferCheckpointEntity(
            id = 1,
            transferId = "transfer_123",
            fileName = "test.pdf",
            totalChunks = 10,
            totalBytes = 10240L,
            receivedChunksJson = "[0,1,2,5,7,9]",
            lastChunkIndex = 9,
            bytesTransferred = 6144L,
            createdAt = System.currentTimeMillis(),
            updatedAt = System.currentTimeMillis()
        )

        // When
        val progress = checkpoint.getProgress()

        // Then
        assertEquals(60.0f, progress, 0.1f)
    }

    /**
     * Test 6: Check if transfer is complete
     */
    @Test
    fun `isComplete should return true when all chunks received`() {
        // Given
        val completeCheckpoint = TransferCheckpointEntity(
            id = 1,
            transferId = "transfer_123",
            fileName = "test.pdf",
            totalChunks = 5,
            totalBytes = 5120L,
            receivedChunksJson = "[0,1,2,3,4]",
            lastChunkIndex = 4,
            bytesTransferred = 5120L,
            createdAt = System.currentTimeMillis(),
            updatedAt = System.currentTimeMillis()
        )

        val incompleteCheckpoint = completeCheckpoint.copy(
            receivedChunksJson = "[0,1,2,3]",
            bytesTransferred = 4096L
        )

        // When/Then
        assertTrue(completeCheckpoint.isComplete())
        assertFalse(incompleteCheckpoint.isComplete())
    }

    /**
     * Test 7: Restore checkpoint for resume
     */
    @Test
    fun `restoreCheckpoint should load existing checkpoint`() = runTest {
        // Given
        val transferId = "transfer_123"
        val existingCheckpoint = TransferCheckpointEntity(
            id = 1,
            transferId = transferId,
            fileName = "test.pdf",
            totalChunks = 100,
            totalBytes = 102400L,
            receivedChunksJson = "[0,1,2,3,4,5,6,7,8,9]",
            lastChunkIndex = 9,
            bytesTransferred = 10240L,
            createdAt = System.currentTimeMillis(),
            updatedAt = System.currentTimeMillis()
        )

        coEvery { mockCheckpointDao.getByTransferId(transferId) } returns existingCheckpoint

        // When
        val restored = checkpointManager.restoreCheckpoint(transferId)

        // Then
        assertNotNull(restored)
        assertEquals(transferId, restored.transferId)
        assertEquals(10, restored.getReceivedChunks().size)
        assertEquals(10.0f, restored.getProgress(), 0.1f)
    }

    /**
     * Test 8: Delete checkpoint after successful transfer
     */
    @Test
    fun `deleteCheckpoint should remove checkpoint from database`() = runTest {
        // Given
        val transferId = "transfer_123"
        coEvery { mockCheckpointDao.deleteByTransferId(transferId) } returns Unit

        // When
        checkpointManager.deleteCheckpoint(transferId)

        // Then
        coVerify { mockCheckpointDao.deleteByTransferId(transferId) }
    }

    /**
     * Test 9: Cleanup old checkpoints (7-day expiry)
     */
    @Test
    fun `cleanupOldCheckpoints should delete expired checkpoints`() = runTest {
        // Given
        val sevenDaysAgo = System.currentTimeMillis() - (7 * 24 * 60 * 60 * 1000L)

        coEvery { mockCheckpointDao.deleteOlderThan(any()) } returns Unit

        // When
        checkpointManager.cleanupOldCheckpoints()

        // Then
        coVerify {
            mockCheckpointDao.deleteOlderThan(match {
                it <= System.currentTimeMillis() &&
                it >= sevenDaysAgo - 1000 // Allow 1s margin
            })
        }
    }

    /**
     * Test 10: Auto-save every 10 chunks
     */
    @Test
    fun `should auto-save checkpoint every 10 chunks`() = runTest {
        // Given
        val transferId = "transfer_123"
        val checkpoint = TransferCheckpointEntity(
            id = 1,
            transferId = transferId,
            fileName = "test.pdf",
            totalChunks = 100,
            totalBytes = 102400L,
            receivedChunksJson = "[0,1,2,3,4,5,6,7,8,9]",
            lastChunkIndex = 9,
            bytesTransferred = 10240L,
            createdAt = System.currentTimeMillis(),
            updatedAt = System.currentTimeMillis()
        )

        coEvery { mockCheckpointDao.getByTransferId(transferId) } returns checkpoint
        coEvery { mockCheckpointDao.update(any()) } returns Unit

        // When - Simulate receiving chunks 10, 20, 30 (every 10th)
        checkpointManager.updateCheckpoint(transferId, chunkIndex = 10, chunkSize = 1024L)
        checkpointManager.updateCheckpoint(transferId, chunkIndex = 20, chunkSize = 1024L)
        checkpointManager.updateCheckpoint(transferId, chunkIndex = 30, chunkSize = 1024L)

        // Then - Should auto-save 3 times
        coVerify(exactly = 3) { mockCheckpointDao.update(any()) }
    }

    /**
     * Test 11: Handle out-of-order chunk reception
     */
    @Test
    fun `withReceivedChunk should handle out-of-order chunks`() {
        // Given
        val checkpoint = TransferCheckpointEntity(
            id = 1,
            transferId = "transfer_123",
            fileName = "test.pdf",
            totalChunks = 10,
            totalBytes = 10240L,
            receivedChunksJson = "[0,1,2]",
            lastChunkIndex = 2,
            bytesTransferred = 3072L,
            createdAt = System.currentTimeMillis(),
            updatedAt = System.currentTimeMillis()
        )

        // When - Receive chunk 5 (out of order)
        val updated = checkpoint.withReceivedChunk(chunkIndex = 5, chunkSize = 1024L)

        // Then
        val receivedChunks = updated.getReceivedChunks()
        assertTrue(receivedChunks.contains(5))
        assertEquals(5, updated.lastChunkIndex)
        assertEquals(4096L, updated.bytesTransferred)
    }

    /**
     * Test 12: Prevent duplicate chunk tracking
     */
    @Test
    fun `withReceivedChunk should not duplicate chunks`() {
        // Given
        val checkpoint = TransferCheckpointEntity(
            id = 1,
            transferId = "transfer_123",
            fileName = "test.pdf",
            totalChunks = 10,
            totalBytes = 10240L,
            receivedChunksJson = "[0,1,2,3]",
            lastChunkIndex = 3,
            bytesTransferred = 4096L,
            createdAt = System.currentTimeMillis(),
            updatedAt = System.currentTimeMillis()
        )

        // When - Receive chunk 2 again (duplicate)
        val updated = checkpoint.withReceivedChunk(chunkIndex = 2, chunkSize = 1024L)

        // Then - Should not add duplicate
        val receivedChunks = updated.getReceivedChunks()
        assertEquals(4, receivedChunks.size) // Still 4 chunks
        assertEquals(1, receivedChunks.count { it == 2 }) // Chunk 2 appears only once
    }
}

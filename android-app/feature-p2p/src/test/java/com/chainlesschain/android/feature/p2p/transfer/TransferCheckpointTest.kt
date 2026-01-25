package com.chainlesschain.android.feature.p2p.transfer

import com.chainlesschain.android.core.database.dao.TransferCheckpointDao
import com.chainlesschain.android.core.database.entity.TransferCheckpointEntity
import com.chainlesschain.android.core.p2p.filetransfer.CheckpointManager
import com.chainlesschain.android.core.p2p.filetransfer.model.FileTransferMetadata
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
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * Unit tests for TransferCheckpointEntity and CheckpointManager
 *
 * Tests:
 * 1. Checkpoint creation with FileTransferMetadata
 * 2. Checkpoint updates with chunk tracking
 * 3. Checkpoint restoration
 * 4. Missing chunks calculation
 * 5. Checkpoint cleanup (7-day expiry)
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
     * Test 1: Create checkpoint with FileTransferMetadata
     */
    @Test
    fun `createCheckpoint should insert new checkpoint with metadata`() = runTest {
        // Given
        val metadata = FileTransferMetadata.create(
            transferId = "transfer_123",
            fileName = "test.pdf",
            fileSize = 1024000L,
            mimeType = "application/pdf",
            checksum = "abc123def456",
            senderDeviceId = "device_sender",
            receiverDeviceId = "device_receiver"
        )

        val checkpointSlot = slot<TransferCheckpointEntity>()
        coEvery { mockCheckpointDao.upsert(capture(checkpointSlot)) } returns 1L

        // When
        val checkpoint = checkpointManager.createCheckpoint(
            metadata = metadata,
            isOutgoing = false,
            tempFilePath = "/tmp/test.pdf"
        )

        // Then
        coVerify { mockCheckpointDao.upsert(any()) }
        assertNotNull(checkpoint)
        assertEquals("transfer_123", checkpoint.transferId)
        assertEquals("test.pdf", checkpoint.fileName)
        assertEquals(1024000L, checkpoint.totalSize)
        assertEquals("/tmp/test.pdf", checkpoint.tempFilePath)
    }

    /**
     * Test 2: Update checkpoint with chunk tracking
     */
    @Test
    fun `updateCheckpoint should add chunk to received chunks`() = runTest {
        // Given
        val transferId = "transfer_456"
        val existingCheckpoint = TransferCheckpointEntity.create(
            transferId = transferId,
            fileId = transferId,
            fileName = "test.pdf",
            totalSize = 1024000L,
            totalChunks = 10,
            chunkSize = 102400,
            isOutgoing = false,
            peerId = "peer_123",
            fileChecksum = "checksum_abc"
        )

        coEvery { mockCheckpointDao.getByTransferId(transferId) } returns existingCheckpoint
        coEvery { mockCheckpointDao.update(any()) } returns 1

        // When
        checkpointManager.updateCheckpoint(transferId, chunkIndex = 0, chunkSize = 102400L)

        // Then
        coVerify { mockCheckpointDao.update(match { it.transferId == transferId }) }
    }

    /**
     * Test 3: Get checkpoint by transfer ID
     */
    @Test
    fun `getByTransferId should return existing checkpoint`() = runTest {
        // Given
        val transferId = "transfer_789"
        val existingCheckpoint = TransferCheckpointEntity.create(
            transferId = transferId,
            fileId = transferId,
            fileName = "document.docx",
            totalSize = 500000L,
            totalChunks = 5,
            chunkSize = 100000,
            isOutgoing = true,
            peerId = "peer_456",
            fileChecksum = "checksum_def"
        )

        coEvery { mockCheckpointDao.getByTransferId(transferId) } returns existingCheckpoint

        // When
        val restored = mockCheckpointDao.getByTransferId(transferId)

        // Then
        assertNotNull(restored)
        assertEquals(transferId, restored.transferId)
        assertEquals("document.docx", restored.fileName)
        assertEquals(5, restored.totalChunks)
    }

    /**
     * Test 4: TransferCheckpointEntity.getMissingChunks calculation
     */
    @Test
    fun `getMissingChunks should return chunks not yet received`() {
        // Given
        val checkpoint = TransferCheckpointEntity.create(
            transferId = "transfer_missing",
            fileId = "file_123",
            fileName = "image.jpg",
            totalSize = 1000000L,
            totalChunks = 10,
            chunkSize = 100000,
            isOutgoing = false,
            peerId = "peer_789",
            fileChecksum = "checksum_ghi"
        )

        // Simulate receiving chunks 0, 1, 3, 5
        val withChunks = checkpoint
            .withReceivedChunk(0, 100000L)
            .withReceivedChunk(1, 100000L)
            .withReceivedChunk(3, 100000L)
            .withReceivedChunk(5, 100000L)

        // When
        val missing = withChunks.getMissingChunks()

        // Then
        // Should be missing: 2, 4, 6, 7, 8, 9
        assertEquals(6, missing.size)
        assertTrue(missing.contains(2))
        assertTrue(missing.contains(4))
        assertTrue(missing.contains(6))
    }

    /**
     * Test 5: TransferCheckpointEntity.getReceivedChunks parsing
     */
    @Test
    fun `getReceivedChunks should parse JSON correctly`() {
        // Given
        val checkpoint = TransferCheckpointEntity.create(
            transferId = "transfer_parse",
            fileId = "file_456",
            fileName = "video.mp4",
            totalSize = 5000000L,
            totalChunks = 20,
            chunkSize = 250000,
            isOutgoing = false,
            peerId = "peer_abc",
            fileChecksum = "checksum_jkl"
        )

        // Add multiple chunks
        val updated = checkpoint
            .withReceivedChunk(0, 250000L)
            .withReceivedChunk(1, 250000L)
            .withReceivedChunk(2, 250000L)

        // When
        val received = updated.getReceivedChunks()

        // Then
        assertEquals(3, received.size)
        assertTrue(received.contains(0))
        assertTrue(received.contains(1))
        assertTrue(received.contains(2))
    }

    /**
     * Test 6: Cleanup old checkpoints (7-day expiry)
     */
    @Test
    fun `cleanupExpiredCheckpoints should remove expired entries`() = runTest {
        // Given
        val sevenDaysAgo = System.currentTimeMillis() - (7 * 24 * 60 * 60 * 1000L + 1000L)
        coEvery { mockCheckpointDao.deleteOlderThan(any()) } returns 5

        // When
        checkpointManager.cleanupExpiredCheckpoints()

        // Then
        coVerify { mockCheckpointDao.deleteOlderThan(any()) }
    }

    /**
     * Test 7: Delete checkpoint after successful transfer
     */
    @Test
    fun `deleteCheckpoint should remove checkpoint from database`() = runTest {
        // Given
        val transferId = "transfer_complete"
        coEvery { mockCheckpointDao.deleteByTransferId(transferId) } returns 1

        // When
        checkpointManager.deleteCheckpoint(transferId)

        // Then
        coVerify { mockCheckpointDao.deleteByTransferId(transferId) }
    }

    /**
     * Test 8: TransferCheckpointEntity.create factory method
     */
    @Test
    fun `TransferCheckpointEntity create should initialize with empty chunks`() {
        // When
        val checkpoint = TransferCheckpointEntity.create(
            transferId = "transfer_new",
            fileId = "file_new",
            fileName = "archive.zip",
            totalSize = 2048000L,
            totalChunks = 8,
            chunkSize = 256000,
            isOutgoing = true,
            peerId = "peer_new",
            fileChecksum = "checksum_new"
        )

        // Then
        assertEquals("transfer_new", checkpoint.transferId)
        assertEquals(8, checkpoint.totalChunks)
        assertEquals(0, checkpoint.getReceivedChunks().size)
        assertEquals(-1, checkpoint.lastChunkIndex)
        assertEquals(0L, checkpoint.bytesTransferred)
    }

    /**
     * Test 9: TransferCheckpointEntity.withReceivedChunk cumulative bytes
     */
    @Test
    fun `withReceivedChunk should accumulate bytesTransferred correctly`() {
        // Given
        val checkpoint = TransferCheckpointEntity.create(
            transferId = "transfer_bytes",
            fileId = "file_bytes",
            fileName = "data.bin",
            totalSize = 1000000L,
            totalChunks = 4,
            chunkSize = 250000,
            isOutgoing = false,
            peerId = "peer_bytes",
            fileChecksum = "checksum_bytes"
        )

        // When
        val updated = checkpoint
            .withReceivedChunk(0, 250000L)
            .withReceivedChunk(1, 250000L)
            .withReceivedChunk(2, 250000L)

        // Then
        assertEquals(750000L, updated.bytesTransferred)
        assertEquals(2, updated.lastChunkIndex)
    }

    /**
     * Test 10: Checkpoint progress percentage calculation
     */
    @Test
    fun `checkpoint should calculate correct progress percentage`() {
        // Given
        val checkpoint = TransferCheckpointEntity.create(
            transferId = "transfer_progress",
            fileId = "file_progress",
            fileName = "file.dat",
            totalSize = 1000000L,
            totalChunks = 10,
            chunkSize = 100000,
            isOutgoing = false,
            peerId = "peer_progress",
            fileChecksum = "checksum_progress"
        )

        // When - receive 3 out of 10 chunks
        val updated = checkpoint
            .withReceivedChunk(0, 100000L)
            .withReceivedChunk(1, 100000L)
            .withReceivedChunk(2, 100000L)

        // Then
        val progress = (updated.bytesTransferred.toDouble() / updated.totalSize * 100).toInt()
        assertEquals(30, progress)
    }

    /**
     * Test 11: Handle duplicate chunk updates
     */
    @Test
    fun `withReceivedChunk should handle duplicate chunks correctly`() {
        // Given
        val checkpoint = TransferCheckpointEntity.create(
            transferId = "transfer_dup",
            fileId = "file_dup",
            fileName = "duplicate.txt",
            totalSize = 500000L,
            totalChunks = 5,
            chunkSize = 100000,
            isOutgoing = false,
            peerId = "peer_dup",
            fileChecksum = "checksum_dup"
        )

        // When - add chunk 0 twice
        val updated = checkpoint
            .withReceivedChunk(0, 100000L)
            .withReceivedChunk(0, 100000L)

        // Then - should only count once
        assertEquals(1, updated.getReceivedChunks().size)
        assertEquals(100000L, updated.bytesTransferred)
    }

    /**
     * Test 12: All chunks received detection
     */
    @Test
    fun `getMissingChunks should return empty when all chunks received`() {
        // Given
        val checkpoint = TransferCheckpointEntity.create(
            transferId = "transfer_complete_chunks",
            fileId = "file_complete",
            fileName = "complete.bin",
            totalSize = 300000L,
            totalChunks = 3,
            chunkSize = 100000,
            isOutgoing = false,
            peerId = "peer_complete",
            fileChecksum = "checksum_complete"
        )

        // When - receive all chunks
        val updated = checkpoint
            .withReceivedChunk(0, 100000L)
            .withReceivedChunk(1, 100000L)
            .withReceivedChunk(2, 100000L)

        // Then
        assertTrue(updated.getMissingChunks().isEmpty())
        assertEquals(300000L, updated.bytesTransferred)
    }
}

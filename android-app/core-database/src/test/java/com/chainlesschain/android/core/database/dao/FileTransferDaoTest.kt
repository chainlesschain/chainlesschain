package com.chainlesschain.android.core.database.dao

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import app.cash.turbine.test
import com.chainlesschain.android.core.database.ChainlessChainDatabase
import com.chainlesschain.android.core.database.entity.FileTransferEntity
import com.chainlesschain.android.core.database.entity.FileTransferStatusEnum
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
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * FileTransferDao Unit Tests
 *
 * Comprehensive tests for file transfer DAO
 *
 * Coverage:
 * - CRUD operations
 * - Progress tracking (completedChunks, bytesTransferred)
 * - State management (PENDING → TRANSFERRING → COMPLETED)
 * - Checkpointing for resumable uploads/downloads
 * - Retry logic and error handling
 * - Active/Completed/Failed filtering
 *
 * Target: 90% code coverage for FileTransferDao.kt
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class FileTransferDaoTest {

    private lateinit var database: ChainlessChainDatabase
    private lateinit var fileTransferDao: FileTransferDao

    @Before
    fun setup() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        database = Room.inMemoryDatabaseBuilder(
            context,
            ChainlessChainDatabase::class.java
        )
            .allowMainThreadQueries()
            .build()

        fileTransferDao = database.fileTransferDao()
    }

    @After
    fun tearDown() {
        database.close()
    }

    // ========================================
    // CRUD Tests (4 tests)
    // ========================================

    @Test
    fun `insert and retrieve file transfer`() = runTest {
        // Given
        val transfer = createTestTransfer(
            id = "transfer-1",
            peerId = "peer-123",
            fileName = "document.pdf",
            fileSize = 1024 * 1024
        )

        // When
        val insertId = fileTransferDao.insert(transfer)
        val retrieved = fileTransferDao.getById("transfer-1")

        // Then
        assertTrue(insertId > 0)
        assertNotNull(retrieved)
        assertEquals("transfer-1", retrieved.id)
        assertEquals("document.pdf", retrieved.fileName)
        assertEquals(1024 * 1024, retrieved.fileSize)
    }

    @Test
    fun `update file transfer modifies record`() = runTest {
        // Given
        val original = createTestTransfer(id = "transfer-1", status = FileTransferStatusEnum.PENDING)
        fileTransferDao.insert(original)

        // When
        val updated = original.copy(
            status = FileTransferStatusEnum.TRANSFERRING,
            completedChunks = 5,
            bytesTransferred = 50000
        )
        fileTransferDao.update(updated)
        val retrieved = fileTransferDao.getById("transfer-1")

        // Then
        assertNotNull(retrieved)
        assertEquals(FileTransferStatusEnum.TRANSFERRING, retrieved.status)
        assertEquals(5, retrieved.completedChunks)
        assertEquals(50000, retrieved.bytesTransferred)
    }

    @Test
    fun `delete file transfer removes record`() = runTest {
        // Given
        val transfer = createTestTransfer(id = "transfer-1")
        fileTransferDao.insert(transfer)

        // When
        fileTransferDao.delete(transfer)
        val retrieved = fileTransferDao.getById("transfer-1")

        // Then
        assertNull(retrieved)
    }

    @Test
    fun `deleteById removes transfer`() = runTest {
        // Given
        val transfer = createTestTransfer(id = "transfer-1")
        fileTransferDao.insert(transfer)

        // When
        fileTransferDao.deleteById("transfer-1")
        val retrieved = fileTransferDao.getById("transfer-1")

        // Then
        assertNull(retrieved)
    }

    // ========================================
    // Progress Tracking Tests (3 tests)
    // ========================================

    @Test
    fun `updateProgress updates chunks and bytes`() = runTest {
        // Given
        val transfer = createTestTransfer(
            id = "transfer-1",
            totalChunks = 100,
            completedChunks = 0,
            bytesTransferred = 0
        )
        fileTransferDao.insert(transfer)

        // When
        fileTransferDao.updateProgress(
            transferId = "transfer-1",
            completedChunks = 25,
            bytesTransferred = 250000
        )
        val retrieved = fileTransferDao.getById("transfer-1")

        // Then
        assertNotNull(retrieved)
        assertEquals(25, retrieved.completedChunks)
        assertEquals(250000, retrieved.bytesTransferred)
    }

    @Test
    fun `markCompleted sets status and finalizes transfer`() = runTest {
        // Given
        val transfer = createTestTransfer(
            id = "transfer-1",
            status = FileTransferStatusEnum.TRANSFERRING,
            totalChunks = 10,
            fileSize = 100000
        )
        fileTransferDao.insert(transfer)

        // When
        fileTransferDao.markCompleted(
            transferId = "transfer-1",
            localFilePath = "/storage/document.pdf"
        )
        val retrieved = fileTransferDao.getById("transfer-1")

        // Then
        assertNotNull(retrieved)
        assertEquals(FileTransferStatusEnum.COMPLETED, retrieved.status)
        assertEquals(10, retrieved.completedChunks)
        assertEquals(100000, retrieved.bytesTransferred)
        assertEquals("/storage/document.pdf", retrieved.localFilePath)
        assertNull(retrieved.tempFilePath)
        assertNotNull(retrieved.completedAt)
    }

    @Test
    fun `markFailed increments retry count and sets error message`() = runTest {
        // Given
        val transfer = createTestTransfer(
            id = "transfer-1",
            status = FileTransferStatusEnum.TRANSFERRING,
            retryCount = 0
        )
        fileTransferDao.insert(transfer)

        // When
        fileTransferDao.markFailed(
            transferId = "transfer-1",
            errorMessage = "Network timeout"
        )
        val retrieved = fileTransferDao.getById("transfer-1")

        // Then
        assertNotNull(retrieved)
        assertEquals(FileTransferStatusEnum.FAILED, retrieved.status)
        assertEquals(1, retrieved.retryCount)
        assertEquals("Network timeout", retrieved.errorMessage)
    }

    // ========================================
    // State Management Tests (3 tests)
    // ========================================

    @Test
    fun `updateStatus changes transfer status`() = runTest {
        // Given
        val transfer = createTestTransfer(
            id = "transfer-1",
            status = FileTransferStatusEnum.PENDING
        )
        fileTransferDao.insert(transfer)

        // When: Progress through states
        fileTransferDao.updateStatus("transfer-1", FileTransferStatusEnum.REQUESTING)
        val requesting = fileTransferDao.getById("transfer-1")

        fileTransferDao.updateStatus("transfer-1", FileTransferStatusEnum.TRANSFERRING)
        val transferring = fileTransferDao.getById("transfer-1")

        fileTransferDao.updateStatus("transfer-1", FileTransferStatusEnum.PAUSED)
        val paused = fileTransferDao.getById("transfer-1")

        // Then
        assertEquals(FileTransferStatusEnum.REQUESTING, requesting?.status)
        assertEquals(FileTransferStatusEnum.TRANSFERRING, transferring?.status)
        assertEquals(FileTransferStatusEnum.PAUSED, paused?.status)
    }

    @Test
    fun `getActive returns only non-terminal transfers`() = runTest {
        // Given
        fileTransferDao.insertAll(listOf(
            createTestTransfer(id = "t1", status = FileTransferStatusEnum.PENDING),
            createTestTransfer(id = "t2", status = FileTransferStatusEnum.TRANSFERRING),
            createTestTransfer(id = "t3", status = FileTransferStatusEnum.COMPLETED),
            createTestTransfer(id = "t4", status = FileTransferStatusEnum.PAUSED),
            createTestTransfer(id = "t5", status = FileTransferStatusEnum.FAILED)
        ))

        // When
        val active = fileTransferDao.getActive().first()

        // Then
        assertEquals(3, active.size)
        assertTrue(active.any { it.id == "t1" }) // PENDING
        assertTrue(active.any { it.id == "t2" }) // TRANSFERRING
        assertTrue(active.any { it.id == "t4" }) // PAUSED
    }

    @Test
    fun `getCompleted returns only completed transfers`() = runTest {
        // Given
        fileTransferDao.insertAll(listOf(
            createTestTransfer(id = "t1", status = FileTransferStatusEnum.COMPLETED, completedAt = 1000L),
            createTestTransfer(id = "t2", status = FileTransferStatusEnum.TRANSFERRING),
            createTestTransfer(id = "t3", status = FileTransferStatusEnum.COMPLETED, completedAt = 2000L)
        ))

        // When
        val completed = fileTransferDao.getCompleted().first()

        // Then
        assertEquals(2, completed.size)
        assertEquals("t3", completed[0].id) // Most recent first (completedAt DESC)
        assertEquals("t1", completed[1].id)
    }

    // ========================================
    // Peer Filtering Tests (2 tests)
    // ========================================

    @Test
    fun `getByPeer filters transfers by peerId`() = runTest {
        // Given
        fileTransferDao.insertAll(listOf(
            createTestTransfer(id = "t1", peerId = "peer-A"),
            createTestTransfer(id = "t2", peerId = "peer-B"),
            createTestTransfer(id = "t3", peerId = "peer-A")
        ))

        // When
        val peerATransfers = fileTransferDao.getByPeer("peer-A").first()

        // Then
        assertEquals(2, peerATransfers.size)
        assertTrue(peerATransfers.all { it.peerId == "peer-A" })
    }

    @Test
    fun `getActiveByPeer filters active transfers for peer`() = runTest {
        // Given
        fileTransferDao.insertAll(listOf(
            createTestTransfer(id = "t1", peerId = "peer-A", status = FileTransferStatusEnum.TRANSFERRING),
            createTestTransfer(id = "t2", peerId = "peer-A", status = FileTransferStatusEnum.COMPLETED),
            createTestTransfer(id = "t3", peerId = "peer-B", status = FileTransferStatusEnum.TRANSFERRING)
        ))

        // When
        val peerAActive = fileTransferDao.getActiveByPeer("peer-A").first()

        // Then
        assertEquals(1, peerAActive.size)
        assertEquals("t1", peerAActive[0].id)
    }

    // ========================================
    // Incoming Request Tests (2 tests)
    // ========================================

    @Test
    fun `getPendingIncomingRequests returns requesting incoming transfers`() = runTest {
        // Given
        fileTransferDao.insertAll(listOf(
            createTestTransfer(id = "t1", isOutgoing = false, status = FileTransferStatusEnum.REQUESTING),
            createTestTransfer(id = "t2", isOutgoing = true, status = FileTransferStatusEnum.REQUESTING),
            createTestTransfer(id = "t3", isOutgoing = false, status = FileTransferStatusEnum.TRANSFERRING)
        ))

        // When
        val pendingRequests = fileTransferDao.getPendingIncomingRequests().first()

        // Then
        assertEquals(1, pendingRequests.size)
        assertEquals("t1", pendingRequests[0].id)
        assertTrue(!pendingRequests[0].isOutgoing)
    }

    @Test
    fun `getPendingRequestsByPeer filters requests by peer`() = runTest {
        // Given
        fileTransferDao.insertAll(listOf(
            createTestTransfer(id = "t1", peerId = "peer-A", isOutgoing = false, status = FileTransferStatusEnum.REQUESTING),
            createTestTransfer(id = "t2", peerId = "peer-B", isOutgoing = false, status = FileTransferStatusEnum.REQUESTING)
        ))

        // When
        val peerARequests = fileTransferDao.getPendingRequestsByPeer("peer-A").first()

        // Then
        assertEquals(1, peerARequests.size)
        assertEquals("t1", peerARequests[0].id)
    }

    // ========================================
    // Retry Logic Tests (2 tests)
    // ========================================

    @Test
    fun `multiple failures increment retry count`() = runTest {
        // Given
        val transfer = createTestTransfer(id = "transfer-1", retryCount = 0)
        fileTransferDao.insert(transfer)

        // When: Fail 3 times
        fileTransferDao.markFailed("transfer-1", "Error 1")
        val after1 = fileTransferDao.getById("transfer-1")

        fileTransferDao.markFailed("transfer-1", "Error 2")
        val after2 = fileTransferDao.getById("transfer-1")

        fileTransferDao.markFailed("transfer-1", "Error 3")
        val after3 = fileTransferDao.getById("transfer-1")

        // Then
        assertEquals(1, after1?.retryCount)
        assertEquals(2, after2?.retryCount)
        assertEquals(3, after3?.retryCount)
    }

    @Test
    fun `resetRetryCount clears retry count and error message`() = runTest {
        // Given
        val transfer = createTestTransfer(
            id = "transfer-1",
            retryCount = 5,
            errorMessage = "Previous error"
        )
        fileTransferDao.insert(transfer)

        // When
        fileTransferDao.resetRetryCount("transfer-1")
        val retrieved = fileTransferDao.getById("transfer-1")

        // Then
        assertNotNull(retrieved)
        assertEquals(0, retrieved.retryCount)
        assertNull(retrieved.errorMessage)
    }

    // ========================================
    // Cleanup Tests (3 tests)
    // ========================================

    @Test
    fun `deleteOldCompleted removes transfers before cutoff time`() = runTest {
        // Given
        val now = System.currentTimeMillis()
        val cutoff = now - 86400000L // 24 hours ago

        fileTransferDao.insertAll(listOf(
            createTestTransfer(id = "old-1", status = FileTransferStatusEnum.COMPLETED, completedAt = now - 90000000L),
            createTestTransfer(id = "old-2", status = FileTransferStatusEnum.COMPLETED, completedAt = now - 87000000L),
            createTestTransfer(id = "new-1", status = FileTransferStatusEnum.COMPLETED, completedAt = now - 3600000L)
        ))

        // When
        fileTransferDao.deleteOldCompleted(cutoff)
        val remaining = fileTransferDao.getCompleted().first()

        // Then
        assertEquals(1, remaining.size)
        assertEquals("new-1", remaining[0].id)
    }

    @Test
    fun `clearCompleted removes all completed transfers`() = runTest {
        // Given
        fileTransferDao.insertAll(listOf(
            createTestTransfer(id = "t1", status = FileTransferStatusEnum.COMPLETED),
            createTestTransfer(id = "t2", status = FileTransferStatusEnum.TRANSFERRING),
            createTestTransfer(id = "t3", status = FileTransferStatusEnum.COMPLETED)
        ))

        // When
        fileTransferDao.clearCompleted()
        val all = fileTransferDao.getAll().first()

        // Then
        assertEquals(1, all.size)
        assertEquals("t2", all[0].id)
    }

    @Test
    fun `clearFailed removes failed and cancelled transfers`() = runTest {
        // Given
        fileTransferDao.insertAll(listOf(
            createTestTransfer(id = "t1", status = FileTransferStatusEnum.FAILED),
            createTestTransfer(id = "t2", status = FileTransferStatusEnum.CANCELLED),
            createTestTransfer(id = "t3", status = FileTransferStatusEnum.COMPLETED)
        ))

        // When
        fileTransferDao.clearFailed()
        val remaining = fileTransferDao.getAll().first()

        // Then
        assertEquals(1, remaining.size)
        assertEquals("t3", remaining[0].id)
    }

    // ========================================
    // Flow Response Tests (2 tests)
    // ========================================

    @Test
    fun `observeById emits updates on status change`() = runTest {
        // Given
        val transfer = createTestTransfer(id = "transfer-1", status = FileTransferStatusEnum.PENDING)
        fileTransferDao.insert(transfer)

        // When
        fileTransferDao.observeById("transfer-1").test {
            val initial = awaitItem()
            assertEquals(FileTransferStatusEnum.PENDING, initial?.status)

            // Update status
            fileTransferDao.updateStatus("transfer-1", FileTransferStatusEnum.TRANSFERRING)

            val updated = awaitItem()
            assertEquals(FileTransferStatusEnum.TRANSFERRING, updated?.status)

            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `getActive emits updates when new active transfer added`() = runTest {
        fileTransferDao.getActive().test {
            val initial = awaitItem()
            assertEquals(0, initial.size)

            // Add active transfer
            fileTransferDao.insert(createTestTransfer(id = "t1", status = FileTransferStatusEnum.TRANSFERRING))

            val updated = awaitItem()
            assertEquals(1, updated.size)

            cancelAndIgnoreRemainingEvents()
        }
    }

    // ========================================
    // Count Tests (2 tests)
    // ========================================

    @Test
    fun `countActive returns correct count`() = runTest {
        // Given
        fileTransferDao.insertAll(listOf(
            createTestTransfer(id = "t1", status = FileTransferStatusEnum.TRANSFERRING),
            createTestTransfer(id = "t2", status = FileTransferStatusEnum.PAUSED),
            createTestTransfer(id = "t3", status = FileTransferStatusEnum.COMPLETED)
        ))

        // When
        val count = fileTransferDao.countActive()

        // Then
        assertEquals(2, count)
    }

    @Test
    fun `countActiveByPeer returns count for specific peer`() = runTest {
        // Given
        fileTransferDao.insertAll(listOf(
            createTestTransfer(id = "t1", peerId = "peer-A", status = FileTransferStatusEnum.TRANSFERRING),
            createTestTransfer(id = "t2", peerId = "peer-A", status = FileTransferStatusEnum.COMPLETED),
            createTestTransfer(id = "t3", peerId = "peer-B", status = FileTransferStatusEnum.TRANSFERRING)
        ))

        // When
        val count = fileTransferDao.countActiveByPeer("peer-A")

        // Then
        assertEquals(1, count)
    }

    // ========================================
    // Helper Functions
    // ========================================

    private fun createTestTransfer(
        id: String = "transfer-${System.currentTimeMillis()}",
        peerId: String = "peer-123",
        fileName: String = "test_file.pdf",
        fileSize: Long = 1024 * 1024,
        mimeType: String = "application/pdf",
        fileChecksum: String = "abc123",
        isOutgoing: Boolean = true,
        status: String = FileTransferStatusEnum.PENDING,
        chunkSize: Int = 65536,
        totalChunks: Int = 16,
        completedChunks: Int = 0,
        bytesTransferred: Long = 0,
        retryCount: Int = 0,
        errorMessage: String? = null,
        completedAt: Long? = null,
        localFilePath: String? = null,
        tempFilePath: String? = "/tmp/$id"
    ): FileTransferEntity {
        return FileTransferEntity(
            id = id,
            peerId = peerId,
            fileName = fileName,
            fileSize = fileSize,
            mimeType = mimeType,
            fileChecksum = fileChecksum,
            localFilePath = localFilePath,
            tempFilePath = tempFilePath,
            isOutgoing = isOutgoing,
            status = status,
            chunkSize = chunkSize,
            totalChunks = totalChunks,
            completedChunks = completedChunks,
            bytesTransferred = bytesTransferred,
            retryCount = retryCount,
            errorMessage = errorMessage,
            completedAt = completedAt
        )
    }
}

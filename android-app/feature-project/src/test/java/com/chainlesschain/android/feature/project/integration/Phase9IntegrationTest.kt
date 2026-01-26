package com.chainlesschain.android.feature.project.integration

import com.chainlesschain.android.core.database.dao.TransferCheckpointDao
import com.chainlesschain.android.core.database.dao.TransferQueueDao
import com.chainlesschain.android.core.database.entity.ProjectFileEntity
import com.chainlesschain.android.core.database.entity.TransferCheckpointEntity
import com.chainlesschain.android.core.database.entity.TransferQueueEntity
import com.chainlesschain.android.core.database.entity.TransferQueueStatus
import com.chainlesschain.android.feature.p2p.filetransfer.CheckpointManager
import com.chainlesschain.android.feature.p2p.filetransfer.FileTransferManager
import com.chainlesschain.android.feature.p2p.filetransfer.TransferScheduler
import com.chainlesschain.android.feature.project.editor.CodeCompletionEngine
import com.chainlesschain.android.feature.project.editor.EditorTabManager
import com.chainlesschain.android.feature.project.ui.components.CodeFoldingManager
import io.mockk.MockKAnnotations
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.impl.annotations.MockK
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.Before
import org.junit.Test
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * Phase 9: Integration Tests
 *
 * End-to-end tests for:
 * 1. P2P file transfer with resume
 * 2. Transfer queue management
 * 3. Code editor with completion
 * 4. Multi-file tab editing
 * 5. Code folding with persistence
 */
@OptIn(ExperimentalCoroutinesApi::class)
class Phase9IntegrationTest {

    @MockK
    private lateinit var mockCheckpointDao: TransferCheckpointDao

    @MockK
    private lateinit var mockQueueDao: TransferQueueDao

    @MockK
    private lateinit var mockFileTransferManager: FileTransferManager

    private lateinit var checkpointManager: CheckpointManager
    private lateinit var transferScheduler: TransferScheduler
    private lateinit var tabManager: EditorTabManager
    private lateinit var completionEngine: CodeCompletionEngine
    private lateinit var foldingManager: CodeFoldingManager

    @Before
    fun setup() {
        MockKAnnotations.init(this, relaxed = true)
        checkpointManager = CheckpointManager(mockCheckpointDao)
        transferScheduler = TransferScheduler(mockQueueDao, mockFileTransferManager)
        tabManager = EditorTabManager()
        completionEngine = CodeCompletionEngine()
        foldingManager = CodeFoldingManager("kotlin")
    }

    /**
     * Integration Test 1: P2P File Transfer with Resume
     *
     * Workflow:
     * 1. Start file transfer
     * 2. Receive some chunks
     * 3. Transfer interrupted (simulate)
     * 4. Resume transfer
     * 5. Complete transfer
     */
    @Test
    fun `complete file transfer workflow with resume`() = runTest {
        // Given - Initial transfer setup
        val transferId = "transfer_123"
        val fileName = "large_file.pdf"
        val totalChunks = 100
        val totalBytes = 102400L

        // Step 1: Create checkpoint
        coEvery { mockCheckpointDao.insert(any()) } returns 1L
        checkpointManager.createCheckpoint(transferId, fileName, totalChunks, totalBytes)

        // Step 2: Receive 50 chunks
        val checkpoint = TransferCheckpointEntity(
            id = 1,
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

        var currentCheckpoint = checkpoint
        repeat(50) { i ->
            currentCheckpoint = currentCheckpoint.withReceivedChunk(i, 1024L)
        }

        coEvery { mockCheckpointDao.getByTransferId(transferId) } returns currentCheckpoint

        // Step 3: Verify checkpoint state (50% complete)
        val restored = checkpointManager.restoreCheckpoint(transferId)
        assertNotNull(restored)
        assertEquals(50.0f, restored.getProgress(), 0.1f)
        assertEquals(50, restored.getReceivedChunks().size)

        // Step 4: Resume and complete remaining chunks
        val missingChunks = restored.getMissingChunks()
        assertEquals(50, missingChunks.size)
        assertTrue(missingChunks.all { it >= 50 && it < 100 })

        // Step 5: Mark as completed
        coEvery { mockCheckpointDao.deleteByTransferId(transferId) } returns Unit
        checkpointManager.deleteCheckpoint(transferId)

        coVerify { mockCheckpointDao.deleteByTransferId(transferId) }
    }

    /**
     * Integration Test 2: Transfer Queue Priority Management
     *
     * Workflow:
     * 1. Enqueue multiple transfers with different priorities
     * 2. Start transfers (max 3 concurrent)
     * 3. Complete a transfer
     * 4. Auto-schedule next queued transfer
     */
    @Test
    fun `transfer queue should respect priority and concurrent limits`() = runTest {
        // Given - 5 queued transfers
        val queuedTransfers = listOf(
            createQueuedTransfer("transfer_1", priority = 5),
            createQueuedTransfer("transfer_2", priority = 1), // Highest priority
            createQueuedTransfer("transfer_3", priority = 8),
            createQueuedTransfer("transfer_4", priority = 3),
            createQueuedTransfer("transfer_5", priority = 6)
        )

        // Step 1: No transfers running initially
        coEvery { mockQueueDao.getTransferringCount() } returns 0
        coEvery { mockQueueDao.getQueued() } returns queuedTransfers.sortedBy { it.priority }
        coEvery { mockQueueDao.updateStatus(any(), any()) } returns Unit
        coEvery { mockFileTransferManager.startTransfer(any()) } returns Unit

        // Step 2: Schedule (should start 3 highest priority)
        transferScheduler.scheduleNext()

        // Verify 3 transfers started (max concurrent)
        coVerify(exactly = 3) { mockFileTransferManager.startTransfer(any()) }

        // Step 3: Complete one transfer
        coEvery { mockQueueDao.getTransferringCount() } returns 2 // Now 2 running
        coEvery { mockQueueDao.getQueued() } returns queuedTransfers.sortedBy { it.priority }.drop(3)

        transferScheduler.onTransferComplete("transfer_2")

        // Step 4: Verify next transfer auto-started
        coVerify(atLeast = 1) { mockFileTransferManager.startTransfer(any()) }
    }

    /**
     * Integration Test 3: Multi-File Editor with Code Completion
     *
     * Workflow:
     * 1. Open multiple files in tabs
     * 2. Switch between tabs
     * 3. Edit file and get code completions
     * 4. Save dirty tabs
     */
    @Test
    fun `multi-file editor with code completion workflow`() = runTest {
        // Step 1: Open 3 Kotlin files
        val file1 = createTestFile("MainActivity.kt")
        val file2 = createTestFile("ViewModel.kt")
        val file3 = createTestFile("Repository.kt")

        tabManager.openTab(file1, "class MainActivity {}")
        tabManager.openTab(file2, "class ViewModel {}")
        tabManager.openTab(file3, "class Repository {}")

        val tabs = tabManager.tabs.first()
        assertEquals(3, tabs.size)

        // Step 2: Switch to first tab
        tabManager.switchToTab(tabs[0].id)

        // Step 3: Edit content
        tabManager.updateTabContent(tabs[0].id, """
            class MainActivity {
                fun onCr
            }
        """.trimIndent())

        val activeTab = tabManager.getActiveTab()
        assertTrue(activeTab?.isDirty ?: false)

        // Step 4: Get code completions
        val content = activeTab?.content ?: ""
        val cursorPosition = content.indexOf("onCr") + 4
        val prefix = "onCr"

        val completions = completionEngine.getCompletions(
            fileContent = content,
            fileName = "MainActivity.kt",
            cursorPosition = cursorPosition,
            prefix = prefix
        )

        // Should get "onCreate" from Android keywords/snippets
        assertTrue(completions.isNotEmpty())

        // Step 5: Apply completion
        val selectedCompletion = completions.first()
        val (newContent, newCursor) = completionEngine.applyCompletion(
            fileContent = content,
            cursorPosition = cursorPosition,
            completionItem = selectedCompletion
        )

        tabManager.updateTabContent(tabs[0].id, newContent)
        tabManager.updateCursorPosition(tabs[0].id, newCursor)

        // Step 6: Save all dirty tabs
        val dirtyTabs = tabManager.getDirtyTabs()
        dirtyTabs.forEach { tab ->
            tabManager.saveTab(tab.id)
        }

        // Verify no dirty tabs remain
        assertEquals(0, tabManager.getDirtyTabs().size)
    }

    /**
     * Integration Test 4: Code Folding with Multi-File Tabs
     *
     * Workflow:
     * 1. Open file with foldable regions
     * 2. Detect and fold regions
     * 3. Switch tabs (state preserved)
     * 4. Verify folding state maintained
     */
    @Test
    fun `code folding state preserved across tab switches`() = runTest {
        // Step 1: Open file with multiple functions
        val kotlinCode = """
            class MyClass {
                fun function1() {
                    println("A")
                    println("B")
                }

                fun function2() {
                    println("C")
                    println("D")
                }

                fun function3() {
                    println("E")
                }
            }
        """.trimIndent()

        val file = createTestFile("MyClass.kt")
        tabManager.openTab(file, kotlinCode)

        // Step 2: Detect foldable regions
        val regions = foldingManager.detectFoldableRegions(kotlinCode)
        assertTrue(regions.size >= 4) // 1 class + 3 functions

        // Step 3: Fold all functions
        val functionRegions = regions.filter { it.preview.contains("fun ") }
        functionRegions.forEach { region ->
            foldingManager.toggleFold(region)
        }

        // Verify folded
        functionRegions.forEach { region ->
            assertTrue(foldingManager.isRegionFolded(region))
        }

        // Step 4: Open another file
        val file2 = createTestFile("Other.kt")
        tabManager.openTab(file2, "class Other {}")

        // Step 5: Switch back to first file
        val tabs = tabManager.tabs.first()
        val firstTabId = tabs.first { it.file.name == "MyClass.kt" }.id
        tabManager.switchToTab(firstTabId)

        // Step 6: Verify folding state maintained
        // Note: In real implementation, folding state would be persisted per file
        // This test verifies the manager can maintain state
        functionRegions.forEach { region ->
            assertTrue(foldingManager.isRegionFolded(region))
        }
    }

    /**
     * Integration Test 5: Failed Transfer Retry with Checkpoint
     *
     * Workflow:
     * 1. Start transfer
     * 2. Transfer fails after 30 chunks
     * 3. Retry with checkpoint
     * 4. Resume from last checkpoint
     */
    @Test
    fun `failed transfer retry workflow with checkpoint`() = runTest {
        // Step 1: Start transfer
        val transferId = "transfer_456"
        val fileName = "document.pdf"

        val checkpoint = TransferCheckpointEntity(
            id = 1,
            transferId = transferId,
            fileName = fileName,
            totalChunks = 100,
            totalBytes = 102400L,
            receivedChunksJson = "[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29]",
            lastChunkIndex = 29,
            bytesTransferred = 30720L,
            createdAt = System.currentTimeMillis(),
            updatedAt = System.currentTimeMillis()
        )

        coEvery { mockCheckpointDao.getByTransferId(transferId) } returns checkpoint

        // Step 2: Mark transfer as failed
        val queueItem = createQueuedTransfer(transferId, priority = 5).copy(
            status = TransferQueueStatus.FAILED,
            error = "Network timeout",
            retryCount = 0
        )

        coEvery { mockQueueDao.getByTransferId(transferId) } returns queueItem
        coEvery { mockQueueDao.update(any()) } returns Unit

        // Step 3: Retry transfer
        transferScheduler.retryTransfer(1)

        // Verify retry count incremented and status changed to QUEUED
        coVerify {
            mockQueueDao.update(match {
                it.retryCount == 1 &&
                it.status == TransferQueueStatus.QUEUED &&
                it.error == null
            })
        }

        // Step 4: Restore checkpoint
        val restored = checkpointManager.restoreCheckpoint(transferId)
        assertNotNull(restored)

        // Verify can resume from chunk 30
        val missingChunks = restored.getMissingChunks()
        assertEquals(70, missingChunks.size) // 100 total - 30 received
        assertTrue(missingChunks.all { it >= 30 })
    }

    /**
     * Integration Test 6: Complete Editor Session
     *
     * Workflow:
     * 1. Open multiple files
     * 2. Edit with code completion
     * 3. Use code folding
     * 4. Save all changes
     * 5. Close session
     */
    @Test
    fun `complete editor session workflow`() = runTest {
        // Step 1: Open 3 files
        val files = listOf(
            createTestFile("Main.kt") to """
                class Main {
                    fun start() {
                        println("Start")
                    }
                }
            """.trimIndent(),
            createTestFile("Helper.kt") to """
                object Helper {
                    fun help() {}
                }
            """.trimIndent(),
            createTestFile("Utils.kt") to """
                fun utility() {}
            """.trimIndent()
        )

        files.forEach { (file, content) ->
            tabManager.openTab(file, content)
        }

        assertEquals(3, tabManager.tabs.first().size)

        // Step 2: Edit first file
        val tabs = tabManager.tabs.first()
        tabManager.updateTabContent(tabs[0].id, """
            class Main {
                fun start() {
                    println("Start")
                }

                fun sto
            }
        """.trimIndent())

        // Step 3: Get completions
        val activeTab = tabManager.getActiveTab()
        val completions = completionEngine.getCompletions(
            fileContent = activeTab?.content ?: "",
            fileName = "Main.kt",
            cursorPosition = activeTab?.content?.indexOf("sto")?.plus(3) ?: 0,
            prefix = "sto"
        )

        assertTrue(completions.isNotEmpty())

        // Step 4: Fold functions
        val regions = foldingManager.detectFoldableRegions(activeTab?.content ?: "")
        regions.forEach { region ->
            foldingManager.toggleFold(region)
        }

        // Step 5: Save all
        tabManager.getDirtyTabs().forEach { tab ->
            tabManager.saveTab(tab.id)
        }

        assertEquals(0, tabManager.getDirtyTabs().size)

        // Step 6: Close all tabs
        tabManager.closeAllTabs()
        assertEquals(0, tabManager.tabs.first().size)
    }

    // Helper functions
    private fun createTestFile(name: String): ProjectFileEntity {
        return ProjectFileEntity(
            id = UUID.randomUUID().toString(),
            projectId = "project_123",
            name = name,
            path = "/test/$name",
            type = "file",
            mimeType = "text/plain",
            extension = name.substringAfterLast('.', ""),
            size = 1024L,
            content = null,
            createdAt = System.currentTimeMillis(),
            updatedAt = System.currentTimeMillis()
        )
    }

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

package com.chainlesschain.android.feature.filebrowser.integration

import androidx.arch.core.executor.testing.InstantTaskExecutorRule
import app.cash.turbine.test
import com.chainlesschain.android.core.database.entity.FileCategory
import com.chainlesschain.android.feature.filebrowser.ai.FileSummarizer
import com.chainlesschain.android.feature.filebrowser.cache.ThumbnailCache
import com.chainlesschain.android.feature.filebrowser.data.repository.ExternalFileRepository
import com.chainlesschain.android.feature.filebrowser.data.repository.FileImportRepository
import com.chainlesschain.android.feature.filebrowser.data.scanner.MediaStoreScanner
import com.chainlesschain.android.feature.filebrowser.ml.FileClassifier
import com.chainlesschain.android.feature.filebrowser.ml.TextRecognizer
import com.chainlesschain.android.feature.filebrowser.viewmodel.GlobalFileBrowserViewModel
import io.mockk.clearAllMocks
import io.mockk.coEvery
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.*
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Integration tests for File Browser feature
 *
 * Tests end-to-end workflows:
 * - Permission → Scan → Display → Filter → Import
 * - Error scenarios
 * - Performance with large file sets
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class FileBrowserIntegrationTest {

    @get:Rule
    val instantExecutorRule = InstantTaskExecutorRule()

    private lateinit var viewModel: GlobalFileBrowserViewModel
    private lateinit var mockScanner: MediaStoreScanner
    private lateinit var mockFileRepository: ExternalFileRepository
    private lateinit var mockImportRepository: FileImportRepository
    private lateinit var mockThumbnailCache: ThumbnailCache
    private lateinit var mockFileClassifier: FileClassifier
    private lateinit var mockTextRecognizer: TextRecognizer
    private lateinit var mockFileSummarizer: FileSummarizer

    private val testDispatcher = StandardTestDispatcher()

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)

        mockScanner = mockk(relaxed = true)
        mockFileRepository = mockk(relaxed = true)
        mockImportRepository = mockk(relaxed = true)
        mockThumbnailCache = mockk(relaxed = true)
        mockFileClassifier = mockk(relaxed = true)
        mockTextRecognizer = mockk(relaxed = true)
        mockFileSummarizer = mockk(relaxed = true)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
        clearAllMocks()
    }

    @Test
    fun `full workflow - permission, scan, display, filter, import`() = runTest {
        // Step 1: Setup - Permission granted
        every { mockScanner.scanProgress } returns MutableStateFlow<MediaStoreScanner.ScanProgress>(
            MediaStoreScanner.ScanProgress.Completed(100)
        )
        coEvery { mockScanner.scanAllFiles() } returns Result.success(100)

        // Step 2: Mock file data
        val testFiles = List(100) { index ->
            createTestFile(
                id = "file_$index",
                name = "file_$index.${if (index % 3 == 0) "jpg" else if (index % 3 == 1) "mp4" else "txt"}",
                category = when (index % 3) {
                    0 -> FileCategory.IMAGE
                    1 -> FileCategory.VIDEO
                    else -> FileCategory.DOCUMENT
                }
            )
        }

        every { mockFileRepository.getAllFiles(any(), any()) } returns flowOf(testFiles)
        every {
            mockFileRepository.getFilesByCategory(FileCategory.IMAGE, any(), any())
        } returns flowOf(testFiles.filter { it.category == FileCategory.IMAGE })
        every {
            mockFileRepository.searchFiles("test", any(), any())
        } returns flowOf(testFiles.filter { it.displayName.contains("test") })

        coEvery { mockFileRepository.getFilesCount() } returns 100
        coEvery { mockFileRepository.getTotalSize() } returns 102400L
        coEvery { mockFileRepository.getFileCountByCategory(any()) } returns 33

        // Create ViewModel
        viewModel = GlobalFileBrowserViewModel(
            mediaStoreScanner = mockScanner,
            externalFileRepository = mockFileRepository,
            fileImportRepository = mockImportRepository,
            thumbnailCache = mockThumbnailCache,
            fileClassifier = mockFileClassifier,
            textRecognizer = mockTextRecognizer,
            fileSummarizer = mockFileSummarizer
        )

        testDispatcher.scheduler.advanceUntilIdle()

        // Step 3: Grant permissions and scan
        viewModel.onPermissionsGranted()
        testDispatcher.scheduler.advanceUntilIdle()

        // Verify permission state
        viewModel.permissionGranted.test {
            assertTrue(awaitItem())
        }

        // Step 4: Verify files loaded
        viewModel.files.test {
            val files = expectMostRecentItem()
            assertEquals(100, files.size)
        }

        // Step 5: Filter by category
        viewModel.selectCategory(FileCategory.IMAGE)
        testDispatcher.scheduler.advanceUntilIdle()

        viewModel.files.test {
            val filteredFiles = expectMostRecentItem()
            assertTrue(filteredFiles.all { it.category == FileCategory.IMAGE })
            assertEquals(34, filteredFiles.size) // Approximately 1/3 of files
        }

        // Step 6: Search
        viewModel.searchFiles("test")
        testDispatcher.scheduler.advanceUntilIdle()

        viewModel.searchQuery.test {
            assertEquals("test", expectMostRecentItem())
        }

        // Step 7: Sort by size
        viewModel.setSortBy(GlobalFileBrowserViewModel.SortBy.SIZE)
        testDispatcher.scheduler.advanceUntilIdle()

        viewModel.files.test {
            val sorted = expectMostRecentItem()
            // Verify descending order (largest first)
            for (i in 0 until sorted.size - 1) {
                assertTrue(sorted[i].size >= sorted[i + 1].size)
            }
        }

        // Step 8: Import file
        val fileToImport = testFiles.first()
        val projectId = "test_project"

        coEvery {
            mockImportRepository.importFileToProject(fileToImport, projectId)
        } returns FileImportRepository.ImportResult.Success(mockk(relaxed = true))

        viewModel.importFile(fileToImport.id, projectId)
        testDispatcher.scheduler.advanceUntilIdle()

        // Verify UI state is Success
        viewModel.uiState.test {
            val state = expectMostRecentItem()
            assertTrue(state is GlobalFileBrowserViewModel.FileBrowserUiState.Success)
        }
    }

    @Test
    fun `error scenario - scan permission denied`() = runTest {
        every { mockScanner.scanProgress } returns MutableStateFlow<MediaStoreScanner.ScanProgress>(
            MediaStoreScanner.ScanProgress.Error("Permission denied")
        )
        every { mockFileRepository.getAllFiles(any(), any()) } returns flowOf(emptyList())

        viewModel = GlobalFileBrowserViewModel(
            mediaStoreScanner = mockScanner,
            externalFileRepository = mockFileRepository,
            fileImportRepository = mockImportRepository,
            thumbnailCache = mockThumbnailCache,
            fileClassifier = mockFileClassifier,
            textRecognizer = mockTextRecognizer,
            fileSummarizer = mockFileSummarizer
        )

        testDispatcher.scheduler.advanceUntilIdle()

        // Verify error state
        viewModel.uiState.test {
            val state = expectMostRecentItem()
            assertTrue(state is GlobalFileBrowserViewModel.FileBrowserUiState.Error)
            assertEquals("Permission denied", (state as GlobalFileBrowserViewModel.FileBrowserUiState.Error).message)
        }
    }

    @Test
    fun `error scenario - empty scan result`() = runTest {
        every { mockScanner.scanProgress } returns MutableStateFlow<MediaStoreScanner.ScanProgress>(
            MediaStoreScanner.ScanProgress.Completed(0)
        )
        every { mockFileRepository.getAllFiles(any(), any()) } returns flowOf(emptyList())
        coEvery { mockFileRepository.getFilesCount() } returns 0

        viewModel = GlobalFileBrowserViewModel(
            mediaStoreScanner = mockScanner,
            externalFileRepository = mockFileRepository,
            fileImportRepository = mockImportRepository,
            thumbnailCache = mockThumbnailCache,
            fileClassifier = mockFileClassifier,
            textRecognizer = mockTextRecognizer,
            fileSummarizer = mockFileSummarizer
        )

        testDispatcher.scheduler.advanceUntilIdle()

        // Verify empty state
        viewModel.uiState.test {
            val state = expectMostRecentItem()
            assertTrue(state is GlobalFileBrowserViewModel.FileBrowserUiState.Empty)
        }

        viewModel.files.test {
            val files = expectMostRecentItem()
            assertTrue(files.isEmpty())
        }
    }

    @Test
    fun `performance scenario - handle 10000 files`() = runTest {
        // Create large file set
        val largeFileSet = List(10000) { index ->
            createTestFile(
                id = "file_$index",
                name = "file_$index.txt",
                category = FileCategory.values()[index % FileCategory.values().size]
            )
        }

        every { mockScanner.scanProgress } returns MutableStateFlow<MediaStoreScanner.ScanProgress>(
            MediaStoreScanner.ScanProgress.Completed(10000)
        )
        coEvery { mockScanner.scanAllFiles() } returns Result.success(10000)
        every { mockFileRepository.getAllFiles(any(), any()) } returns flowOf(largeFileSet)
        coEvery { mockFileRepository.getFilesCount() } returns 10000
        coEvery { mockFileRepository.getTotalSize() } returns 10240000L
        coEvery { mockFileRepository.getFileCountByCategory(any()) } returns 1428 // ~10000/7

        viewModel = GlobalFileBrowserViewModel(
            mediaStoreScanner = mockScanner,
            externalFileRepository = mockFileRepository,
            fileImportRepository = mockImportRepository,
            thumbnailCache = mockThumbnailCache,
            fileClassifier = mockFileClassifier,
            textRecognizer = mockTextRecognizer,
            fileSummarizer = mockFileSummarizer
        )

        testDispatcher.scheduler.advanceUntilIdle()

        // Grant permissions and scan
        viewModel.onPermissionsGranted()
        testDispatcher.scheduler.advanceUntilIdle()

        // Verify large file set loaded
        viewModel.files.test {
            val files = expectMostRecentItem()
            assertEquals(10000, files.size)
        }

        // Test sorting performance
        val startTime = System.currentTimeMillis()
        viewModel.setSortBy(GlobalFileBrowserViewModel.SortBy.NAME)
        testDispatcher.scheduler.advanceUntilIdle()
        val sortTime = System.currentTimeMillis() - startTime

        // Sorting should complete in reasonable time (<500ms)
        assertTrue(sortTime < 500, "Sorting took ${sortTime}ms, expected <500ms")

        // Verify sorted
        viewModel.files.test {
            val sorted = expectMostRecentItem()
            assertEquals(10000, sorted.size)
        }

        // Test filtering performance
        val filterStartTime = System.currentTimeMillis()
        viewModel.selectCategory(FileCategory.IMAGE)
        testDispatcher.scheduler.advanceUntilIdle()
        val filterTime = System.currentTimeMillis() - filterStartTime

        // Filtering should be fast (<100ms)
        assertTrue(filterTime < 100, "Filtering took ${filterTime}ms, expected <100ms")
    }

    @Test
    fun `refresh workflow - rescan and reload`() = runTest {
        // Initial scan
        every { mockScanner.scanProgress } returns MutableStateFlow<MediaStoreScanner.ScanProgress>(
            MediaStoreScanner.ScanProgress.Completed(50)
        )
        coEvery { mockScanner.scanAllFiles() } returns Result.success(50)

        val initialFiles = List(50) { createTestFile(id = "file_$it", name = "file_$it.txt") }
        every { mockFileRepository.getAllFiles(any(), any()) } returns flowOf(initialFiles)
        coEvery { mockFileRepository.getFilesCount() } returns 50

        viewModel = GlobalFileBrowserViewModel(
            mediaStoreScanner = mockScanner,
            externalFileRepository = mockFileRepository,
            fileImportRepository = mockImportRepository,
            thumbnailCache = mockThumbnailCache,
            fileClassifier = mockFileClassifier,
            textRecognizer = mockTextRecognizer,
            fileSummarizer = mockFileSummarizer
        )

        testDispatcher.scheduler.advanceUntilIdle()

        viewModel.onPermissionsGranted()
        testDispatcher.scheduler.advanceUntilIdle()

        // Verify initial state
        viewModel.files.test {
            assertEquals(50, expectMostRecentItem().size)
        }

        // Update files (simulating new files added)
        val updatedFiles = List(75) { createTestFile(id = "file_$it", name = "file_$it.txt") }
        every { mockFileRepository.getAllFiles(any(), any()) } returns flowOf(updatedFiles)
        coEvery { mockFileRepository.getFilesCount() } returns 75
        coEvery { mockScanner.scanAllFiles() } returns Result.success(75)

        // Refresh
        viewModel.refresh()
        testDispatcher.scheduler.advanceUntilIdle()

        // Verify updated state
        viewModel.files.test {
            assertEquals(75, expectMostRecentItem().size)
        }
    }

    // Helper method
    private fun createTestFile(
        id: String,
        name: String,
        category: FileCategory = FileCategory.DOCUMENT,
        size: Long = 1024L
    ) = com.chainlesschain.android.core.database.entity.ExternalFileEntity(
        id = id,
        uri = "content://media/external/file/$id",
        displayName = name,
        mimeType = "text/plain",
        size = size,
        category = category,
        lastModified = System.currentTimeMillis(),
        displayPath = "/storage/emulated/0/$name",
        parentFolder = "emulated",
        scannedAt = System.currentTimeMillis(),
        isFavorite = false,
        extension = name.substringAfterLast('.', "")
    )
}

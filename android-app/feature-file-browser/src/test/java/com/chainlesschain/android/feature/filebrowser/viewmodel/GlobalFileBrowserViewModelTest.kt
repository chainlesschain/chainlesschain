package com.chainlesschain.android.feature.filebrowser.viewmodel

import androidx.arch.core.executor.testing.InstantTaskExecutorRule
import app.cash.turbine.test
import com.chainlesschain.android.core.database.entity.ExternalFileEntity
import com.chainlesschain.android.core.database.entity.FileCategory
import com.chainlesschain.android.feature.filebrowser.ai.FileSummarizer
import com.chainlesschain.android.feature.filebrowser.cache.ThumbnailCache
import com.chainlesschain.android.feature.filebrowser.data.repository.ExternalFileRepository
import com.chainlesschain.android.feature.filebrowser.data.repository.FileImportRepository
import com.chainlesschain.android.feature.filebrowser.data.scanner.MediaStoreScanner
import com.chainlesschain.android.feature.filebrowser.ml.FileClassifier
import com.chainlesschain.android.feature.filebrowser.ml.TextRecognizer
import com.chainlesschain.android.feature.filebrowser.viewmodel.GlobalFileBrowserViewModel
import io.mockk.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.*
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Unit tests for GlobalFileBrowserViewModel
 *
 * Tests:
 * - Permission handling
 * - File scanning
 * - Search and filter
 * - Sorting
 * - Favorite toggle
 * - File import
 * - Statistics loading
 */
@OptIn(ExperimentalCoroutinesApi::class)
class GlobalFileBrowserViewModelTest {

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

        // Mock scanner progress flow (must be StateFlow)
        every { mockScanner.scanProgress } returns MutableStateFlow(MediaStoreScanner.ScanProgress.Idle)

        // Mock empty file list by default
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
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
        clearAllMocks()
    }

    @Test
    fun `initial state should have permission not granted`() = runTest {
        viewModel.permissionGranted.test {
            assertFalse(awaitItem())
        }
    }

    @Test
    fun `onPermissionsGranted should update permission state and start scan`() = runTest {
        coEvery { mockScanner.scanAllFiles() } returns Result.success(0)

        viewModel.onPermissionsGranted()
        testDispatcher.scheduler.advanceUntilIdle()

        viewModel.permissionGranted.test {
            assertTrue(awaitItem())
        }

        coVerify(exactly = 1) { mockScanner.scanAllFiles() }
    }

    @Test
    fun `startScan should trigger scanner and update UI state`() = runTest {
        coEvery { mockScanner.scanAllFiles() } returns Result.success(10)

        viewModel.startScan()
        testDispatcher.scheduler.advanceUntilIdle()

        coVerify(exactly = 1) { mockScanner.scanAllFiles() }
    }

    @Test
    fun `scan completion should load files and statistics`() = runTest {
        val testFiles = List(5) { createTestFile("file$it.txt") }

        every { mockScanner.scanProgress } returns MutableStateFlow<MediaStoreScanner.ScanProgress>(
            MediaStoreScanner.ScanProgress.Completed(5)
        )
        every { mockFileRepository.getAllFiles(any(), any()) } returns flowOf(testFiles)
        coEvery { mockFileRepository.getFilesCount() } returns 5
        coEvery { mockFileRepository.getTotalSize() } returns 5120L
        coEvery { mockFileRepository.getFileCountByCategory(any()) } returns 1

        // Create new ViewModel to trigger flow observation
        val vm = GlobalFileBrowserViewModel(
            mediaStoreScanner = mockScanner,
            externalFileRepository = mockFileRepository,
            fileImportRepository = mockImportRepository,
            thumbnailCache = mockThumbnailCache,
            fileClassifier = mockFileClassifier,
            textRecognizer = mockTextRecognizer,
            fileSummarizer = mockFileSummarizer
        )

        testDispatcher.scheduler.advanceUntilIdle()

        vm.files.test {
            val files = expectMostRecentItem()
            assertEquals(5, files.size)
        }

        vm.uiState.test {
            val state = expectMostRecentItem()
            assertTrue(state is GlobalFileBrowserViewModel.FileBrowserUiState.Success)
        }
    }

    @Test
    fun `searchFiles should update search query and reload files`() = runTest {
        val searchResults = listOf(createTestFile("test.txt"))

        every { mockFileRepository.searchFiles("test", any(), any()) } returns flowOf(searchResults)

        viewModel.searchFiles("test")
        testDispatcher.scheduler.advanceUntilIdle()

        viewModel.searchQuery.test {
            assertEquals("test", expectMostRecentItem())
        }

        verify { mockFileRepository.searchFiles("test", any(), any()) }
    }

    @Test
    fun `selectCategory should filter files by category`() = runTest {
        val imageFiles = listOf(createTestFile("image.jpg", FileCategory.IMAGE))

        every {
            mockFileRepository.getFilesByCategory(FileCategory.IMAGE, any(), any())
        } returns flowOf(imageFiles)

        viewModel.selectCategory(FileCategory.IMAGE)
        testDispatcher.scheduler.advanceUntilIdle()

        viewModel.selectedCategory.test {
            assertEquals(FileCategory.IMAGE, expectMostRecentItem())
        }

        verify { mockFileRepository.getFilesByCategory(FileCategory.IMAGE, any(), any()) }
    }

    @Test
    fun `setSortBy should update sort criteria and reload files`() = runTest {
        every { mockFileRepository.getAllFiles(any(), any()) } returns flowOf(emptyList())

        viewModel.setSortBy(GlobalFileBrowserViewModel.SortBy.SIZE)
        testDispatcher.scheduler.advanceUntilIdle()

        viewModel.sortBy.test {
            assertEquals(GlobalFileBrowserViewModel.SortBy.SIZE, expectMostRecentItem())
        }
    }

    @Test
    fun `toggleSortDirection should switch between ASC and DESC`() = runTest {
        // Initial direction is DESC
        viewModel.sortDirection.test {
            assertEquals(GlobalFileBrowserViewModel.SortDirection.DESC, awaitItem())
            cancelAndIgnoreRemainingEvents()
        }

        viewModel.toggleSortDirection()
        testDispatcher.scheduler.advanceUntilIdle()

        viewModel.sortDirection.test {
            assertEquals(GlobalFileBrowserViewModel.SortDirection.ASC, expectMostRecentItem())
        }

        viewModel.toggleSortDirection()
        testDispatcher.scheduler.advanceUntilIdle()

        viewModel.sortDirection.test {
            assertEquals(GlobalFileBrowserViewModel.SortDirection.DESC, expectMostRecentItem())
        }
    }

    @Test
    fun `sortFiles should sort by NAME correctly`() = runTest {
        val files = listOf(
            createTestFile("zebra.txt"),
            createTestFile("apple.txt"),
            createTestFile("banana.txt")
        )

        every { mockFileRepository.getAllFiles(any(), any()) } returns flowOf(files)

        viewModel.setSortBy(GlobalFileBrowserViewModel.SortBy.NAME)
        testDispatcher.scheduler.advanceUntilIdle()

        viewModel.files.test {
            val sorted = expectMostRecentItem()
            // DESC order (default)
            assertEquals("zebra.txt", sorted[0].displayName)
            assertEquals("banana.txt", sorted[1].displayName)
            assertEquals("apple.txt", sorted[2].displayName)
        }
    }

    @Test
    fun `sortFiles should sort by SIZE correctly`() = runTest {
        val files = listOf(
            createTestFile("small.txt", size = 100L),
            createTestFile("large.txt", size = 10000L),
            createTestFile("medium.txt", size = 1000L)
        )

        every { mockFileRepository.getAllFiles(any(), any()) } returns flowOf(files)

        viewModel.setSortBy(GlobalFileBrowserViewModel.SortBy.SIZE)
        testDispatcher.scheduler.advanceUntilIdle()

        viewModel.files.test {
            val sorted = expectMostRecentItem()
            // DESC order (largest first)
            assertEquals(10000L, sorted[0].size)
            assertEquals(1000L, sorted[1].size)
            assertEquals(100L, sorted[2].size)
        }
    }

    @Test
    fun `sortFiles should sort by DATE correctly`() = runTest {
        val now = System.currentTimeMillis()
        val files = listOf(
            createTestFile("old.txt", lastModified = now - 1000000),
            createTestFile("new.txt", lastModified = now),
            createTestFile("middle.txt", lastModified = now - 500000)
        )

        every { mockFileRepository.getAllFiles(any(), any()) } returns flowOf(files)

        viewModel.setSortBy(GlobalFileBrowserViewModel.SortBy.DATE)
        testDispatcher.scheduler.advanceUntilIdle()

        viewModel.files.test {
            val sorted = expectMostRecentItem()
            // DESC order (newest first)
            assertEquals("new.txt", sorted[0].displayName)
            assertEquals("middle.txt", sorted[1].displayName)
            assertEquals("old.txt", sorted[2].displayName)
        }
    }

    @Test
    fun `toggleFavorite should call repository`() = runTest {
        val fileId = UUID.randomUUID().toString()
        coEvery { mockFileRepository.toggleFavorite(fileId) } returns true

        viewModel.toggleFavorite(fileId)
        testDispatcher.scheduler.advanceUntilIdle()

        coVerify(exactly = 1) { mockFileRepository.toggleFavorite(fileId) }
    }

    @Test
    fun `importFile should call import repository`() = runTest {
        val fileId = UUID.randomUUID().toString()
        val projectId = UUID.randomUUID().toString()
        val testFile = createTestFile("test.txt")

        every { mockFileRepository.getAllFiles(any(), any()) } returns flowOf(listOf(testFile))
        coEvery {
            mockImportRepository.importFileToProject(any(), any())
        } returns FileImportRepository.ImportResult.Success(mockk(relaxed = true))

        // Load files first
        viewModel.refresh()
        testDispatcher.scheduler.advanceUntilIdle()

        viewModel.importFile(testFile.id, projectId)
        testDispatcher.scheduler.advanceUntilIdle()

        coVerify { mockImportRepository.importFileToProject(testFile, projectId) }
    }

    @Test
    fun `refresh should restart scan if permission granted`() = runTest {
        coEvery { mockScanner.scanAllFiles() } returns Result.success(0)

        viewModel.onPermissionsGranted()
        testDispatcher.scheduler.advanceUntilIdle()

        viewModel.refresh()
        testDispatcher.scheduler.advanceUntilIdle()

        coVerify(atLeast = 2) { mockScanner.scanAllFiles() }
    }

    @Test
    fun `clearFilters should reset search and category`() = runTest {
        // Set filters first
        viewModel.searchFiles("test")
        viewModel.selectCategory(FileCategory.IMAGE)
        testDispatcher.scheduler.advanceUntilIdle()

        // Clear filters
        viewModel.clearFilters()
        testDispatcher.scheduler.advanceUntilIdle()

        viewModel.searchQuery.test {
            assertEquals("", expectMostRecentItem())
        }

        viewModel.selectedCategory.test {
            assertEquals(null, expectMostRecentItem())
        }
    }

    @Test
    fun `empty file list should show empty state`() = runTest {
        every { mockScanner.scanProgress } returns MutableStateFlow<MediaStoreScanner.ScanProgress>(
            MediaStoreScanner.ScanProgress.Completed(0)
        )
        every { mockFileRepository.getAllFiles(any(), any()) } returns flowOf(emptyList())

        val vm = GlobalFileBrowserViewModel(
            mediaStoreScanner = mockScanner,
            externalFileRepository = mockFileRepository,
            fileImportRepository = mockImportRepository,
            thumbnailCache = mockThumbnailCache,
            fileClassifier = mockFileClassifier,
            textRecognizer = mockTextRecognizer,
            fileSummarizer = mockFileSummarizer
        )

        testDispatcher.scheduler.advanceUntilIdle()

        vm.uiState.test {
            val state = expectMostRecentItem()
            assertTrue(state is GlobalFileBrowserViewModel.FileBrowserUiState.Empty)
        }
    }

    @Test
    fun `scan error should show error state`() = runTest {
        every { mockScanner.scanProgress } returns MutableStateFlow<MediaStoreScanner.ScanProgress>(
            MediaStoreScanner.ScanProgress.Error("Permission denied")
        )

        val vm = GlobalFileBrowserViewModel(
            mediaStoreScanner = mockScanner,
            externalFileRepository = mockFileRepository,
            fileImportRepository = mockImportRepository,
            thumbnailCache = mockThumbnailCache,
            fileClassifier = mockFileClassifier,
            textRecognizer = mockTextRecognizer,
            fileSummarizer = mockFileSummarizer
        )

        testDispatcher.scheduler.advanceUntilIdle()

        vm.uiState.test {
            val state = expectMostRecentItem()
            assertTrue(state is GlobalFileBrowserViewModel.FileBrowserUiState.Error)
            assertEquals("Permission denied", (state as GlobalFileBrowserViewModel.FileBrowserUiState.Error).message)
        }
    }

    // Helper methods

    private fun createTestFile(
        name: String,
        category: FileCategory = FileCategory.DOCUMENT,
        size: Long = 1024L,
        lastModified: Long = System.currentTimeMillis()
    ): ExternalFileEntity {
        return ExternalFileEntity(
            id = UUID.randomUUID().toString(),
            uri = "content://media/external/file/${UUID.randomUUID()}",
            displayName = name,
            mimeType = "text/plain",
            size = size,
            category = category,
            lastModified = lastModified,
            displayPath = "/storage/emulated/0/$name",
            parentFolder = "emulated",
            scannedAt = System.currentTimeMillis(),
            isFavorite = false,
            extension = name.substringAfterLast('.', "")
        )
    }
}

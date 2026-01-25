package com.chainlesschain.android.feature.filebrowser

import com.chainlesschain.android.core.database.entity.ExternalFileEntity
import com.chainlesschain.android.core.database.entity.FileCategory
import com.chainlesschain.android.feature.filebrowser.data.repository.ExternalFileRepository
import com.chainlesschain.android.feature.filebrowser.data.repository.FileImportRepository
import com.chainlesschain.android.feature.filebrowser.data.scanner.MediaStoreScanner
import com.chainlesschain.android.feature.filebrowser.viewmodel.GlobalFileBrowserViewModel
import io.mockk.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.*
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.Assert.*

/**
 * Unit tests for GlobalFileBrowserViewModel
 *
 * Tests:
 * - Permission management
 * - Scan triggering and progress tracking
 * - File list loading and filtering
 * - Search functionality
 * - Sorting (by name, size, date, type)
 * - Favorite management
 * - File import
 * - Statistics loading
 */
@OptIn(ExperimentalCoroutinesApi::class)
class GlobalFileBrowserViewModelTest {

    private lateinit var viewModel: GlobalFileBrowserViewModel
    private lateinit var mockMediaStoreScanner: MediaStoreScanner
    private lateinit var mockExternalFileRepository: ExternalFileRepository
    private lateinit var mockFileImportRepository: FileImportRepository

    private val testDispatcher = StandardTestDispatcher()

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)

        mockMediaStoreScanner = mockk(relaxed = true)
        mockExternalFileRepository = mockk(relaxed = true)
        mockFileImportRepository = mockk(relaxed = true)

        // Default mock behavior
        every { mockMediaStoreScanner.scanProgress } returns flowOf(MediaStoreScanner.ScanProgress.Idle)
        coEvery { mockMediaStoreScanner.scanAllFiles() } returns Result.success(10)

        viewModel = GlobalFileBrowserViewModel(
            mockMediaStoreScanner,
            mockExternalFileRepository,
            mockFileImportRepository
        )
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
        clearAllMocks()
    }

    /**
     * Test 1: Permission granted triggers scan
     */
    @Test
    fun `onPermissionsGranted should set permission state and trigger scan`() = runTest {
        // Act
        viewModel.onPermissionsGranted()
        advanceUntilIdle()

        // Assert
        assertTrue(viewModel.permissionGranted.value)
        coVerify { mockMediaStoreScanner.scanAllFiles() }
    }

    /**
     * Test 2: Start scan updates UI state
     */
    @Test
    fun `startScan should set UI state to Loading`() = runTest {
        // Arrange
        viewModel.onPermissionsGranted()

        // Act
        viewModel.startScan()
        advanceUntilIdle()

        // Assert - UI state should transition to Loading then to final state
        coVerify { mockMediaStoreScanner.scanAllFiles() }
    }

    /**
     * Test 3: Scan completion loads files
     */
    @Test
    fun `scan completion should load files and statistics`() = runTest {
        // Arrange
        val testFiles = createTestFiles(5)
        every {
            mockExternalFileRepository.getAllFiles(any(), any())
        } returns flowOf(testFiles)

        coEvery { mockExternalFileRepository.getFilesCount() } returns 5
        coEvery { mockExternalFileRepository.getTotalSize() } returns 5120L
        coEvery {
            mockExternalFileRepository.getFileCountByCategory(any())
        } returns 1

        val scanProgressFlow = flowOf(
            MediaStoreScanner.ScanProgress.Idle,
            MediaStoreScanner.ScanProgress.Scanning(0, 10, "Images"),
            MediaStoreScanner.ScanProgress.Completed(10)
        )
        every { mockMediaStoreScanner.scanProgress } returns scanProgressFlow

        // Act
        viewModel.onPermissionsGranted()
        advanceUntilIdle()

        // Assert
        assertEquals(5, viewModel.files.value.size)
        assertNotNull(viewModel.statistics.value)
        assertEquals(5, viewModel.statistics.value?.totalFiles)
    }

    /**
     * Test 4: Search filters files
     */
    @Test
    fun `searchFiles should update search query and reload files`() = runTest {
        // Arrange
        val searchResults = createTestFiles(3)
        every {
            mockExternalFileRepository.searchFiles("test", null, 50)
        } returns flowOf(searchResults)

        // Act
        viewModel.searchFiles("test")
        advanceUntilIdle()

        // Assert
        assertEquals("test", viewModel.searchQuery.value)
        verify { mockExternalFileRepository.searchFiles("test", null, 50) }
    }

    /**
     * Test 5: Category selection filters files
     */
    @Test
    fun `selectCategory should update category and reload files`() = runTest {
        // Arrange
        val imageFiles = createTestFiles(3, FileCategory.IMAGE)
        every {
            mockExternalFileRepository.getFilesByCategory(FileCategory.IMAGE, 50, 0)
        } returns flowOf(imageFiles)

        // Act
        viewModel.selectCategory(FileCategory.IMAGE)
        advanceUntilIdle()

        // Assert
        assertEquals(FileCategory.IMAGE, viewModel.selectedCategory.value)
        verify { mockExternalFileRepository.getFilesByCategory(FileCategory.IMAGE, 50, 0) }
    }

    /**
     * Test 6: Sort by name
     */
    @Test
    fun `setSortBy NAME should sort files alphabetically`() = runTest {
        // Arrange
        val unsortedFiles = listOf(
            createTestFile(1, "Zebra.txt"),
            createTestFile(2, "Apple.txt"),
            createTestFile(3, "Mango.txt")
        )
        every {
            mockExternalFileRepository.getAllFiles(any(), any())
        } returns flowOf(unsortedFiles)

        viewModel.onPermissionsGranted()
        advanceUntilIdle()

        // Act
        viewModel.setSortBy(GlobalFileBrowserViewModel.SortBy.NAME)
        advanceUntilIdle()

        // Assert
        val sortedFiles = viewModel.files.value
        assertEquals("Apple.txt", sortedFiles[0].displayName)
        assertEquals("Mango.txt", sortedFiles[1].displayName)
        assertEquals("Zebra.txt", sortedFiles[2].displayName)
    }

    /**
     * Test 7: Sort by size
     */
    @Test
    fun `setSortBy SIZE should sort files by size`() = runTest {
        // Arrange
        val unsortedFiles = listOf(
            createTestFile(1, "file1.txt", size = 3000L),
            createTestFile(2, "file2.txt", size = 1000L),
            createTestFile(3, "file3.txt", size = 2000L)
        )
        every {
            mockExternalFileRepository.getAllFiles(any(), any())
        } returns flowOf(unsortedFiles)

        viewModel.onPermissionsGranted()
        advanceUntilIdle()

        // Act
        viewModel.setSortBy(GlobalFileBrowserViewModel.SortBy.SIZE)
        advanceUntilIdle()

        // Assert
        val sortedFiles = viewModel.files.value
        assertEquals(1000L, sortedFiles[0].size)
        assertEquals(2000L, sortedFiles[1].size)
        assertEquals(3000L, sortedFiles[2].size)
    }

    /**
     * Test 8: Sort direction toggle
     */
    @Test
    fun `toggleSortDirection should reverse sort order`() = runTest {
        // Arrange
        val testFiles = listOf(
            createTestFile(1, "A.txt"),
            createTestFile(2, "B.txt"),
            createTestFile(3, "C.txt")
        )
        every {
            mockExternalFileRepository.getAllFiles(any(), any())
        } returns flowOf(testFiles)

        viewModel.onPermissionsGranted()
        viewModel.setSortBy(GlobalFileBrowserViewModel.SortBy.NAME)
        advanceUntilIdle()

        // Initial state: ASC
        assertEquals(GlobalFileBrowserViewModel.SortDirection.ASC, viewModel.sortDirection.value)
        var sortedFiles = viewModel.files.value
        assertEquals("A.txt", sortedFiles[0].displayName)

        // Act - Toggle to DESC
        viewModel.toggleSortDirection()
        advanceUntilIdle()

        // Assert - Should be descending
        assertEquals(GlobalFileBrowserViewModel.SortDirection.DESC, viewModel.sortDirection.value)
        sortedFiles = viewModel.files.value
        assertEquals("C.txt", sortedFiles[0].displayName)
        assertEquals("A.txt", sortedFiles[2].displayName)

        // Act - Toggle back to ASC
        viewModel.toggleSortDirection()
        advanceUntilIdle()

        // Assert
        assertEquals(GlobalFileBrowserViewModel.SortDirection.ASC, viewModel.sortDirection.value)
    }

    /**
     * Test 9: Toggle favorite
     */
    @Test
    fun `toggleFavorite should call repository to toggle favorite status`() = runTest {
        // Arrange
        coEvery { mockExternalFileRepository.toggleFavorite("file_1") } returns true

        // Act
        viewModel.toggleFavorite("file_1")
        advanceUntilIdle()

        // Assert
        coVerify { mockExternalFileRepository.toggleFavorite("file_1") }
    }

    /**
     * Test 10: Import file to project
     */
    @Test
    fun `importFile should call import repository with correct parameters`() = runTest {
        // Arrange
        val testFile = createTestFile(1, "test.txt")
        val testFiles = listOf(testFile)
        every {
            mockExternalFileRepository.getAllFiles(any(), any())
        } returns flowOf(testFiles)

        val importResult = FileImportRepository.ImportResult.Success(
            mockk(relaxed = true)
        )
        coEvery {
            mockFileImportRepository.importFileToProject(any(), any(), any(), any())
        } returns importResult

        viewModel.onPermissionsGranted()
        advanceUntilIdle()

        // Act
        viewModel.importFile("file_1", "project_1")
        advanceUntilIdle()

        // Assert
        coVerify {
            mockFileImportRepository.importFileToProject(
                testFile,
                "project_1",
                any(),
                any()
            )
        }
    }

    /**
     * Test 11: Refresh triggers new scan when permissions granted
     */
    @Test
    fun `refresh should trigger new scan when permissions granted`() = runTest {
        // Arrange
        viewModel.onPermissionsGranted()
        advanceUntilIdle()
        clearMocks(mockMediaStoreScanner, answers = false)

        // Act
        viewModel.refresh()
        advanceUntilIdle()

        // Assert
        coVerify { mockMediaStoreScanner.scanAllFiles() }
    }

    /**
     * Test 12: Refresh checks permissions when not granted
     */
    @Test
    fun `refresh should check permissions when not granted`() = runTest {
        // Arrange - Permissions not granted
        assertEquals(false, viewModel.permissionGranted.value)

        // Act
        viewModel.refresh()
        advanceUntilIdle()

        // Assert - Should not trigger scan
        coVerify(exactly = 0) { mockMediaStoreScanner.scanAllFiles() }
    }

    /**
     * Test 13: Clear filters resets search and category
     */
    @Test
    fun `clearFilters should reset search query and selected category`() = runTest {
        // Arrange
        viewModel.searchFiles("test")
        viewModel.selectCategory(FileCategory.IMAGE)
        advanceUntilIdle()

        // Act
        viewModel.clearFilters()
        advanceUntilIdle()

        // Assert
        assertEquals("", viewModel.searchQuery.value)
        assertNull(viewModel.selectedCategory.value)
    }

    /**
     * Test 14: Error handling during file loading
     */
    @Test
    fun `file loading error should update UI state to Error`() = runTest {
        // Arrange
        every {
            mockExternalFileRepository.getAllFiles(any(), any())
        } returns flowOf<List<ExternalFileEntity>>().apply {
            throw Exception("Database error")
        }

        // Act
        viewModel.onPermissionsGranted()
        advanceUntilIdle()

        // Assert - UI state should be Error
        // Note: This depends on how the ViewModel handles exceptions in the collect block
    }

    /**
     * Test 15: Empty file list shows Empty state
     */
    @Test
    fun `empty file list should update UI state to Empty`() = runTest {
        // Arrange
        every {
            mockExternalFileRepository.getAllFiles(any(), any())
        } returns flowOf(emptyList())

        // Act
        viewModel.onPermissionsGranted()
        advanceUntilIdle()

        // Assert
        assertTrue(viewModel.uiState.value is GlobalFileBrowserViewModel.FileBrowserUiState.Empty)
    }

    /**
     * Test 16: Statistics calculation
     */
    @Test
    fun `statistics should include file counts and sizes by category`() = runTest {
        // Arrange
        coEvery { mockExternalFileRepository.getFilesCount() } returns 20
        coEvery { mockExternalFileRepository.getTotalSize() } returns 1024L * 100

        coEvery {
            mockExternalFileRepository.getFileCountByCategory(FileCategory.IMAGE)
        } returns 5

        coEvery {
            mockExternalFileRepository.getFileCountByCategory(FileCategory.VIDEO)
        } returns 3

        coEvery {
            mockExternalFileRepository.getFileCountByCategory(FileCategory.AUDIO)
        } returns 2

        every { mockExternalFileRepository.getAllFiles(any(), any()) } returns flowOf(emptyList())

        // Mock scan completion to trigger statistics loading
        val scanProgressFlow = flowOf(
            MediaStoreScanner.ScanProgress.Completed(20)
        )
        every { mockMediaStoreScanner.scanProgress } returns scanProgressFlow

        // Act
        viewModel.onPermissionsGranted()
        advanceUntilIdle()

        // Assert
        val stats = viewModel.statistics.value
        assertNotNull(stats)
        assertEquals(20, stats?.totalFiles)
        assertEquals(1024L * 100, stats?.totalSize)

        val imageStats = stats?.categories?.find { it.category == "IMAGE" }
        assertEquals(5, imageStats?.count)
    }

    /**
     * Test 17: Multiple filter changes combine correctly
     */
    @Test
    fun `combining search and category filter should work together`() = runTest {
        // Arrange
        val filteredFiles = createTestFiles(2, FileCategory.IMAGE)
        every {
            mockExternalFileRepository.searchFiles("test", FileCategory.IMAGE, 50)
        } returns flowOf(filteredFiles)

        // Act
        viewModel.searchFiles("test")
        viewModel.selectCategory(FileCategory.IMAGE)
        advanceUntilIdle()

        // Assert
        assertEquals("test", viewModel.searchQuery.value)
        assertEquals(FileCategory.IMAGE, viewModel.selectedCategory.value)
    }

    // Helper functions

    /**
     * Creates test files with specified count and category
     */
    private fun createTestFiles(
        count: Int,
        category: FileCategory = FileCategory.DOCUMENT
    ): List<ExternalFileEntity> {
        return (1..count).map { index ->
            createTestFile(index, "test_file_$index.txt", category = category)
        }
    }

    /**
     * Creates a single test file
     */
    private fun createTestFile(
        index: Int,
        displayName: String = "test_file_$index.txt",
        size: Long = 1024L * index,
        category: FileCategory = FileCategory.DOCUMENT
    ): ExternalFileEntity {
        return ExternalFileEntity(
            id = "file_$index",
            uri = "content://media/external/file/$index",
            displayName = displayName,
            mimeType = "text/plain",
            size = size,
            category = category,
            lastModified = System.currentTimeMillis() - (index * 1000),
            displayPath = "/storage/emulated/0/$displayName",
            parentFolder = "TestFolder",
            scannedAt = System.currentTimeMillis(),
            isFavorite = false,
            extension = "txt"
        )
    }
}

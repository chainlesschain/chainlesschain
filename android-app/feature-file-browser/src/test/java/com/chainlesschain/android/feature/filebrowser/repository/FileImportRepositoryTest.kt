package com.chainlesschain.android.feature.filebrowser.repository

import android.content.ContentResolver
import android.content.Context
import android.net.Uri
import com.chainlesschain.android.core.database.dao.ProjectDao
import com.chainlesschain.android.core.database.entity.ExternalFileEntity
import com.chainlesschain.android.core.database.entity.FileCategory
import com.chainlesschain.android.core.database.entity.ImportSource
import com.chainlesschain.android.core.database.entity.ImportType
import com.chainlesschain.android.core.database.entity.ProjectEntity
import com.chainlesschain.android.feature.filebrowser.data.repository.FileImportRepository
import io.mockk.*
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.Assert.*
import java.io.ByteArrayInputStream
import java.io.File

/**
 * Unit tests for FileImportRepository
 *
 * Tests:
 * - COPY mode import
 * - LINK mode import
 * - Smart storage strategy
 * - Project statistics update
 * - Error handling
 */
@OptIn(ExperimentalCoroutinesApi::class)
class FileImportRepositoryTest {

    private lateinit var repository: FileImportRepository
    private lateinit var mockContext: Context
    private lateinit var mockContentResolver: ContentResolver
    private lateinit var mockProjectDao: ProjectDao
    private lateinit var testFilesDir: File

    @Before
    fun setup() {
        mockContext = mockk(relaxed = true)
        mockContentResolver = mockk(relaxed = true)
        mockProjectDao = mockk(relaxed = true)

        // Setup test files directory
        testFilesDir = createTempDirectory("test_import").toFile()
        testFilesDir.deleteOnExit()

        every { mockContext.contentResolver } returns mockContentResolver
        every { mockContext.filesDir } returns testFilesDir

        repository = FileImportRepository(mockContext, mockProjectDao)
    }

    @After
    fun tearDown() {
        testFilesDir.deleteRecursively()
        clearAllMocks()
    }

    /**
     * Test 1: COPY mode - Small file stored in database
     */
    @Test
    fun `importFileToProject with COPY mode should store small files in database`() = runTest {
        // Arrange
        val smallFileContent = "Small test content" // < 100KB
        val testFile = createTestExternalFile(
            id = "file_1",
            size = smallFileContent.toByteArray().size.toLong()
        )

        mockFileContent(testFile.uri, smallFileContent)
        mockProjectEntity("project_1", fileCount = 0, totalSize = 0L)
        coEvery { mockProjectDao.insertFile(any()) } just Runs
        coEvery { mockProjectDao.updateProjectStats(any(), any(), any()) } just Runs

        // Act
        val result = repository.importFileToProject(
            externalFile = testFile,
            targetProjectId = "project_1",
            importType = ImportType.COPY
        )

        // Assert
        assertTrue(result is FileImportRepository.ImportResult.Success)
        val projectFile = (result as FileImportRepository.ImportResult.Success).projectFile

        // File should be stored in database (content is not null)
        assertNotNull(projectFile.content)
        assertEquals(smallFileContent, projectFile.content)

        // Hash should be calculated
        assertNotNull(projectFile.hash)
        assertTrue(projectFile.hash!!.isNotEmpty())

        // Verify project stats updated
        coVerify { mockProjectDao.updateProjectStats("project_1", 1, testFile.size) }
    }

    /**
     * Test 2: LINK mode - No file copy, only URI reference
     */
    @Test
    fun `importFileToProject with LINK mode should only store URI reference`() = runTest {
        // Arrange
        val testFile = createTestExternalFile(id = "file_3", size = 50 * 1024L)

        mockProjectEntity("project_1", fileCount = 0, totalSize = 0L)
        coEvery { mockProjectDao.insertFile(any()) } just Runs
        coEvery { mockProjectDao.updateProjectStats(any(), any(), any()) } just Runs

        // Act
        val result = repository.importFileToProject(
            externalFile = testFile,
            targetProjectId = "project_1",
            importType = ImportType.LINK
        )

        // Assert
        assertTrue(result is FileImportRepository.ImportResult.Success)
        val projectFile = (result as FileImportRepository.ImportResult.Success).projectFile

        // Path should be the external URI
        assertEquals(testFile.uri, projectFile.path)

        // Content should be null
        assertNull(projectFile.content)

        // Hash should be null (not calculated for LINK mode)
        assertNull(projectFile.hash)

        // Project total size should NOT increase (LINK mode doesn't count toward storage)
        coVerify { mockProjectDao.updateProjectStats("project_1", 1, 0L) }
    }

    /**
     * Test 3: Error handling - File read failure
     */
    @Test
    fun `importFileToProject should handle file read errors`() = runTest {
        // Arrange
        val testFile = createTestExternalFile(id = "file_7", size = 10 * 1024L)

        // Mock ContentResolver to throw exception
        every {
            mockContentResolver.openInputStream(any())
        } throws SecurityException("Permission denied")

        mockProjectEntity("project_1")

        // Act
        val result = repository.importFileToProject(
            externalFile = testFile,
            targetProjectId = "project_1",
            importType = ImportType.COPY
        )

        // Assert
        assertTrue(result is FileImportRepository.ImportResult.Failure)
        val error = (result as FileImportRepository.ImportResult.Failure).error
        assertTrue(error.message.contains("导入失败"))
    }

    // Helper functions

    /**
     * Creates a test ExternalFileEntity
     */
    private fun createTestExternalFile(
        id: String,
        displayName: String = "test_file_$id.txt",
        mimeType: String = "text/plain",
        size: Long = 1024L,
        category: FileCategory = FileCategory.DOCUMENT
    ): ExternalFileEntity {
        return ExternalFileEntity(
            id = id,
            uri = "content://media/external/file/$id",
            displayName = displayName,
            mimeType = mimeType,
            size = size,
            category = category,
            lastModified = System.currentTimeMillis(),
            displayPath = "/storage/emulated/0/$displayName",
            parentFolder = "TestFolder",
            scannedAt = System.currentTimeMillis(),
            isFavorite = false,
            extension = displayName.substringAfterLast('.', "")
        )
    }

    /**
     * Mocks file content for ContentResolver
     */
    private fun mockFileContent(uri: String, content: String) {
        val inputStream = ByteArrayInputStream(content.toByteArray())
        every {
            mockContentResolver.openInputStream(Uri.parse(uri))
        } returns inputStream
    }

    /**
     * Mocks a ProjectEntity
     */
    private fun mockProjectEntity(
        projectId: String,
        fileCount: Int = 0,
        totalSize: Long = 0L
    ) {
        val project = ProjectEntity(
            id = projectId,
            name = "Test Project",
            description = "Test Description",
            icon = null,
            color = "#FF0000",
            fileCount = fileCount,
            totalSize = totalSize,
            createdAt = System.currentTimeMillis(),
            updatedAt = System.currentTimeMillis(),
            lastAccessedAt = System.currentTimeMillis()
        )

        coEvery { mockProjectDao.getProjectById(projectId) } returns project
    }
}

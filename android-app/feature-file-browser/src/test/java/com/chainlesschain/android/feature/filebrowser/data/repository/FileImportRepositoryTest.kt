package com.chainlesschain.android.feature.filebrowser.data.repository

import android.content.ContentResolver
import android.content.Context
import android.net.Uri
import com.chainlesschain.android.core.database.dao.ProjectDao
import com.chainlesschain.android.core.database.entity.*
import io.mockk.*
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileOutputStream

/**
 * Unit tests for FileImportRepository
 *
 * Tests file import functionality including COPY and LINK modes,
 * small/large file handling, hash calculation, and error handling.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class FileImportRepositoryTest {

    private lateinit var context: Context
    private lateinit var contentResolver: ContentResolver
    private lateinit var projectDao: ProjectDao
    private lateinit var fileImportRepository: FileImportRepository
    private lateinit var filesDir: File

    @Before
    fun setup() {
        context = mockk(relaxed = true)
        contentResolver = mockk(relaxed = true)
        projectDao = mockk(relaxed = true)
        filesDir = mockk(relaxed = true)

        every { context.contentResolver } returns contentResolver
        every { context.filesDir } returns filesDir

        fileImportRepository = FileImportRepository(context, projectDao)
    }

    @After
    fun tearDown() {
        clearAllMocks()
    }

    @Test
    fun `importFileToProject with COPY mode should copy small file content to database`() = runTest {
        // Arrange
        val smallFileContent = "Small file content"
        val externalFile = createExternalFile(
            id = "external-1",
            size = 50 * 1024, // 50KB (< 100KB threshold)
            displayName = "small_file.txt"
        )

        val inputStream = ByteArrayInputStream(smallFileContent.toByteArray())
        every { contentResolver.openInputStream(Uri.parse(externalFile.uri)) } returns inputStream

        val project = createProject("project-1", fileCount = 5, totalSize = 10000L)
        coEvery { projectDao.getProjectById("project-1") } returns project
        coJustRun { projectDao.insertFile(any()) }
        coJustRun { projectDao.updateProjectStats(any(), any(), any()) }

        // Act
        val result = fileImportRepository.importFileToProject(
            externalFile = externalFile,
            targetProjectId = "project-1",
            importType = ImportType.COPY
        )

        // Assert
        assertTrue(result is FileImportRepository.ImportResult.Success)
        val projectFile = (result as FileImportRepository.ImportResult.Success).projectFile

        // Verify small file stored in database
        assertNotNull(projectFile.content)
        assertEquals(smallFileContent, projectFile.content)
        // path falls back to displayPath when filePath is null
        assertEquals("/storage/emulated/0/Documents/small_file.txt", projectFile.path)

        // Verify file entity
        assertEquals("project-1", projectFile.projectId)
        assertEquals("small_file.txt", projectFile.name)
        assertEquals("txt", projectFile.extension)

        // Verify hash calculated
        assertNotNull(projectFile.hash)
        assertTrue(projectFile.hash!!.isNotEmpty())

        // Verify DAO calls
        coVerify { projectDao.insertFile(any()) }
        coVerify { projectDao.updateProjectStats("project-1", 6, 10000L + externalFile.size) }
    }

    @Test
    fun `importFileToProject with COPY mode should write large file to filesystem`() = runTest {
        // Arrange
        val largeFileContent = "x".repeat(200 * 1024) // 200KB (> 100KB threshold)
        val externalFile = createExternalFile(
            id = "external-2",
            size = 200 * 1024L,
            displayName = "large_file.pdf"
        )

        // First call reads content (but size >= threshold, so goes to else branch)
        // Second call copies to filesystem
        val inputStream1 = ByteArrayInputStream(largeFileContent.toByteArray())
        val inputStream2 = ByteArrayInputStream(largeFileContent.toByteArray())
        every { contentResolver.openInputStream(Uri.parse(externalFile.uri)) } returns inputStream1 andThen inputStream2

        // Mock File constructor for filesystem operations
        val mockOutputStream = mockk<FileOutputStream>(relaxed = true)

        every { filesDir.absolutePath } returns "/data/app/files"
        mockkConstructor(File::class)
        every { anyConstructed<File>().mkdirs() } returns true
        every { anyConstructed<File>().absolutePath } returns "/data/app/files/projects/project-1/mock-file-id"
        every { anyConstructed<File>().outputStream() } returns mockOutputStream

        val project = createProject("project-1", fileCount = 0, totalSize = 0L)
        coEvery { projectDao.getProjectById("project-1") } returns project
        coJustRun { projectDao.insertFile(any()) }
        coJustRun { projectDao.updateProjectStats(any(), any(), any()) }

        // Act
        val result = fileImportRepository.importFileToProject(
            externalFile = externalFile,
            targetProjectId = "project-1",
            importType = ImportType.COPY
        )

        // Assert
        assertTrue(result is FileImportRepository.ImportResult.Success)
        val projectFile = (result as FileImportRepository.ImportResult.Success).projectFile

        // Verify large file written to filesystem
        assertNull(projectFile.content) // No database content

        // Verify DAO calls
        coVerify { projectDao.insertFile(any()) }
        coVerify { projectDao.updateProjectStats("project-1", 1, externalFile.size) }

        unmockkConstructor(File::class)
    }

    @Test
    fun `importFileToProject with LINK mode should store URI reference`() = runTest {
        // Arrange
        val externalFile = createExternalFile(
            id = "external-3",
            uri = "content://media/external/images/media/123",
            size = 500 * 1024L,
            displayName = "linked_photo.jpg"
        )

        val project = createProject("project-1", fileCount = 10, totalSize = 50000L)
        coEvery { projectDao.getProjectById("project-1") } returns project
        coJustRun { projectDao.insertFile(any()) }
        coJustRun { projectDao.updateProjectStats(any(), any(), any()) }

        // Act
        val result = fileImportRepository.importFileToProject(
            externalFile = externalFile,
            targetProjectId = "project-1",
            importType = ImportType.LINK
        )

        // Assert
        assertTrue(result is FileImportRepository.ImportResult.Success)
        val projectFile = (result as FileImportRepository.ImportResult.Success).projectFile

        // Verify URI stored as path
        assertEquals(externalFile.uri, projectFile.path)
        assertNull(projectFile.content) // No content stored
        assertNull(projectFile.hash) // No hash for LINK mode

        // Verify project stats updated (file count increases, but NOT total size)
        coVerify { projectDao.updateProjectStats("project-1", 11, 50000L) } // Size unchanged
    }

    @Test
    fun `importFileToProject should calculate SHA-256 hash correctly`() = runTest {
        // Arrange
        val content = "Test content for hash"
        val externalFile = createExternalFile(
            size = content.length.toLong(),
            displayName = "hash_test.txt"
        )

        val inputStream = ByteArrayInputStream(content.toByteArray())
        every { contentResolver.openInputStream(Uri.parse(externalFile.uri)) } returns inputStream

        val project = createProject("project-1")
        coEvery { projectDao.getProjectById("project-1") } returns project
        coJustRun { projectDao.insertFile(any()) }
        coJustRun { projectDao.updateProjectStats(any(), any(), any()) }

        // Act
        val result = fileImportRepository.importFileToProject(
            externalFile = externalFile,
            targetProjectId = "project-1",
            importType = ImportType.COPY
        )

        // Assert
        assertTrue(result is FileImportRepository.ImportResult.Success)
        val projectFile = (result as FileImportRepository.ImportResult.Success).projectFile

        assertNotNull(projectFile.hash)
        // Verify hash is 64 characters (SHA-256 hex)
        assertEquals(64, projectFile.hash!!.length)
        assertTrue(projectFile.hash!!.matches(Regex("[0-9a-f]{64}")))
    }

    @Test
    fun `importFileToProject should handle invalid URI gracefully`() = runTest {
        // Arrange
        val externalFile = createExternalFile(
            uri = "invalid://uri",
            displayName = "invalid.txt"
        )

        every { contentResolver.openInputStream(Uri.parse(externalFile.uri)) } throws IllegalArgumentException("Invalid URI")

        val project = createProject("project-1")
        coEvery { projectDao.getProjectById("project-1") } returns project

        // Act
        val result = fileImportRepository.importFileToProject(
            externalFile = externalFile,
            targetProjectId = "project-1",
            importType = ImportType.COPY
        )

        // Assert
        assertTrue(result is FileImportRepository.ImportResult.Failure)
        val error = (result as FileImportRepository.ImportResult.Failure).error

        assertTrue(error.message.contains("导入失败"))
        assertNotNull(error.cause)
    }

    @Test
    fun `importFileToProject should handle file not found error`() = runTest {
        // Arrange
        val externalFile = createExternalFile(displayName = "missing.txt")

        every { contentResolver.openInputStream(Uri.parse(externalFile.uri)) } returns null

        val project = createProject("project-1")
        coEvery { projectDao.getProjectById("project-1") } returns project
        coJustRun { projectDao.insertFile(any()) }
        coJustRun { projectDao.updateProjectStats(any(), any(), any()) }

        // Act
        val result = fileImportRepository.importFileToProject(
            externalFile = externalFile,
            targetProjectId = "project-1",
            importType = ImportType.COPY
        )

        // Assert - Should still succeed but with null content
        assertTrue(result is FileImportRepository.ImportResult.Success)
    }

    @Test
    fun `importFileToProject should update project statistics correctly`() = runTest {
        // Arrange
        val externalFile = createExternalFile(
            size = 15000L,
            displayName = "stats_test.txt"
        )

        val inputStream = ByteArrayInputStream("content".toByteArray())
        every { contentResolver.openInputStream(Uri.parse(externalFile.uri)) } returns inputStream

        val project = createProject("project-1", fileCount = 5, totalSize = 10000L)
        coEvery { projectDao.getProjectById("project-1") } returns project
        coJustRun { projectDao.insertFile(any()) }
        coJustRun { projectDao.updateProjectStats(any(), any(), any()) }

        // Act
        fileImportRepository.importFileToProject(
            externalFile = externalFile,
            targetProjectId = "project-1",
            importType = ImportType.COPY
        )

        // Assert
        coVerify {
            projectDao.updateProjectStats(
                "project-1",
                6, // fileCount + 1
                25000L // totalSize + externalFile.size
            )
        }
    }

    @Test
    fun `importFileToProject should handle missing project gracefully`() = runTest {
        // Arrange
        val externalFile = createExternalFile(displayName = "orphan.txt")

        val inputStream = ByteArrayInputStream("content".toByteArray())
        every { contentResolver.openInputStream(Uri.parse(externalFile.uri)) } returns inputStream

        coEvery { projectDao.getProjectById("missing-project") } returns null
        coJustRun { projectDao.insertFile(any()) }

        // Act
        val result = fileImportRepository.importFileToProject(
            externalFile = externalFile,
            targetProjectId = "missing-project",
            importType = ImportType.COPY
        )

        // Assert
        assertTrue(result is FileImportRepository.ImportResult.Success)

        // Stats update should not fail even if project is null
        coVerify(exactly = 0) { projectDao.updateProjectStats(any(), any(), any()) }
    }

    @Test
    fun `importFileToProject with different ImportSource should succeed`() = runTest {
        // Arrange
        val externalFile = createExternalFile(displayName = "ai_chat.txt")

        val inputStream = ByteArrayInputStream("AI content".toByteArray())
        every { contentResolver.openInputStream(Uri.parse(externalFile.uri)) } returns inputStream

        val project = createProject("project-1")
        coEvery { projectDao.getProjectById("project-1") } returns project
        coJustRun { projectDao.insertFile(any()) }
        coJustRun { projectDao.updateProjectStats(any(), any(), any()) }

        // Act
        val result = fileImportRepository.importFileToProject(
            externalFile = externalFile,
            targetProjectId = "project-1",
            importType = ImportType.LINK,
            importSource = ImportSource.AI_CHAT
        )

        // Assert
        assertTrue(result is FileImportRepository.ImportResult.Success)
        // Note: ImportSource would be used for FileImportHistoryEntity (not tested here)
    }

    // Helper functions

    private fun createExternalFile(
        id: String = "file-${System.currentTimeMillis()}",
        uri: String = "content://media/external/file/$id",
        displayName: String = "test_file.txt",
        mimeType: String = "text/plain",
        size: Long = 1024L,
        category: FileCategory = FileCategory.DOCUMENT
    ): ExternalFileEntity {
        return ExternalFileEntity(
            id = id,
            uri = uri,
            displayName = displayName,
            mimeType = mimeType,
            size = size,
            category = category,
            lastModified = System.currentTimeMillis(),
            displayPath = "/storage/emulated/0/Documents/$displayName",
            parentFolder = "Documents",
            scannedAt = System.currentTimeMillis(),
            isFavorite = false,
            extension = displayName.substringAfterLast('.', "")
        )
    }

    private fun createProject(
        id: String,
        fileCount: Int = 0,
        totalSize: Long = 0L
    ): ProjectEntity {
        return ProjectEntity(
            id = id,
            userId = "user-1",
            name = "Test Project",
            description = "Test Description",
            createdAt = System.currentTimeMillis(),
            updatedAt = System.currentTimeMillis(),
            fileCount = fileCount,
            totalSize = totalSize
        )
    }
}

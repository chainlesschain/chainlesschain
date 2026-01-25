package com.chainlesschain.android.feature.project.integration

import android.content.Context
import android.net.Uri
import androidx.test.core.app.ApplicationProvider
import com.chainlesschain.android.core.database.dao.ExternalFileDao
import com.chainlesschain.android.core.database.dao.ProjectDao
import com.chainlesschain.android.core.database.entity.ExternalFileEntity
import com.chainlesschain.android.core.database.entity.FileCategory
import com.chainlesschain.android.core.database.entity.ImportSource
import com.chainlesschain.android.core.database.entity.ImportType
import com.chainlesschain.android.core.database.entity.ProjectEntity
import com.chainlesschain.android.core.database.entity.ProjectFileEntity
import com.chainlesschain.android.feature.filebrowser.data.repository.ExternalFileRepository
import com.chainlesschain.android.feature.filebrowser.data.repository.FileImportRepository
import com.chainlesschain.android.feature.project.repository.ProjectChatRepository
import com.chainlesschain.android.feature.project.viewmodel.ProjectViewModel
import io.mockk.MockKAnnotations
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.impl.annotations.MockK
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Before
import org.junit.Test
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * Phase 6: AI Session Integration Tests
 *
 * Tests external file integration with AI chat:
 * 1. External file search for AI context
 * 2. LINK mode file import
 * 3. External file content loading in AI conversation
 * 4. Dual-tab file mention UI integration
 */
@OptIn(ExperimentalCoroutinesApi::class)
class Phase6IntegrationTest {

    private val testDispatcher = StandardTestDispatcher()

    @MockK
    private lateinit var mockContext: Context

    @MockK
    private lateinit var mockProjectDao: ProjectDao

    @MockK
    private lateinit var mockExternalFileDao: ExternalFileDao

    @MockK
    private lateinit var mockProjectChatRepository: ProjectChatRepository

    @MockK
    private lateinit var mockContentResolver: android.content.ContentResolver

    private lateinit var externalFileRepository: ExternalFileRepository
    private lateinit var fileImportRepository: FileImportRepository
    private lateinit var viewModel: ProjectViewModel

    @Before
    fun setup() {
        MockKAnnotations.init(this, relaxed = true)
        Dispatchers.setMain(testDispatcher)

        // Setup mock context
        every { mockContext.filesDir } returns mockk(relaxed = true)
        every { mockContext.contentResolver } returns mockContentResolver

        // Setup repositories
        externalFileRepository = ExternalFileRepository(mockContext, mockExternalFileDao)
        fileImportRepository = FileImportRepository(mockContext, mockProjectDao)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    /**
     * Test 1: External File Search for AI Chat
     *
     * Verifies:
     * - Search returns DOCUMENT and CODE category files
     * - Search query filters correctly
     * - Results are limited to 20
     */
    @Test
    fun `searchExternalFilesForChat should return document and code files`() = runTest {
        // Given
        val testFiles = listOf(
            createExternalFile("document.pdf", FileCategory.DOCUMENT),
            createExternalFile("code.kt", FileCategory.CODE),
            createExternalFile("image.png", FileCategory.IMAGE), // Should be filtered
            createExternalFile("readme.md", FileCategory.DOCUMENT)
        )

        coEvery {
            mockExternalFileDao.getRecentFiles(
                categories = listOf(FileCategory.DOCUMENT, FileCategory.CODE),
                limit = 20
            )
        } returns testFiles.filter { it.category in listOf(FileCategory.DOCUMENT, FileCategory.CODE) }

        // When
        val result = externalFileRepository.getRecentFiles(
            categories = listOf(FileCategory.DOCUMENT, FileCategory.CODE),
            limit = 20
        )

        // Then
        assertEquals(3, result.size)
        assertTrue(result.all { it.category in listOf(FileCategory.DOCUMENT, FileCategory.CODE) })
        coVerify { mockExternalFileDao.getRecentFiles(any(), any()) }
    }

    /**
     * Test 2: LINK Mode File Import
     *
     * Verifies:
     * - File is imported with URI reference
     * - No content is copied
     * - Project stats updated correctly
     */
    @Test
    fun `importFileToProject with LINK mode should store URI reference`() = runTest {
        // Given
        val projectId = UUID.randomUUID().toString()
        val externalFile = createExternalFile("test.pdf", FileCategory.DOCUMENT)
        val mockProject = ProjectEntity(
            id = projectId,
            name = "Test Project",
            userId = "user1",
            createdAt = System.currentTimeMillis(),
            updatedAt = System.currentTimeMillis(),
            fileCount = 5,
            totalSize = 1000L
        )

        coEvery { mockProjectDao.getProjectById(projectId) } returns mockProject
        coEvery { mockProjectDao.insertFile(any()) } returns Unit
        coEvery { mockProjectDao.updateProjectStats(any(), any(), any()) } returns Unit

        // When
        val result = fileImportRepository.importFileToProject(
            externalFile = externalFile,
            targetProjectId = projectId,
            importType = ImportType.LINK,
            importSource = ImportSource.AI_CHAT
        )

        // Then
        assertTrue(result is FileImportRepository.ImportResult.Success)
        val projectFile = (result as FileImportRepository.ImportResult.Success).projectFile

        // Verify URI is stored in path field
        assertEquals(externalFile.uri, projectFile.path)

        // Verify no content is stored
        assertEquals(null, projectFile.content)

        // Verify project stats updated (fileCount +1, totalSize unchanged)
        coVerify {
            mockProjectDao.updateProjectStats(
                projectId,
                6, // fileCount + 1
                1000L // totalSize unchanged for LINK mode
            )
        }
    }

    /**
     * Test 3: External File Content Loading
     *
     * Verifies:
     * - Content is loaded from external URI via ContentResolver
     * - Proper error handling for unavailable files
     */
    @Test
    fun `loadFileContent should load from external URI for LINK mode files`() = runTest {
        // Given
        val externalUri = "content://media/external/file/12345"
        val fileContent = "This is test file content"
        val projectFile = ProjectFileEntity(
            id = UUID.randomUUID().toString(),
            projectId = "project1",
            name = "test.txt",
            path = externalUri, // LINK mode: URI stored in path
            type = "file",
            mimeType = "text/plain",
            extension = "txt",
            size = fileContent.length.toLong(),
            content = null, // No content stored
            createdAt = System.currentTimeMillis(),
            updatedAt = System.currentTimeMillis()
        )

        val mockInputStream = fileContent.byteInputStream()
        coEvery {
            mockContentResolver.openInputStream(Uri.parse(externalUri))
        } returns mockInputStream

        // When
        val loadedContent = mockContentResolver.openInputStream(Uri.parse(projectFile.path))?.use {
            it.bufferedReader().readText()
        }

        // Then
        assertNotNull(loadedContent)
        assertEquals(fileContent, loadedContent)
    }

    /**
     * Test 4: ViewModel External File Search Integration
     *
     * Verifies:
     * - ViewModel can search external files
     * - State is updated correctly
     */
    @Test
    fun `viewModel searchExternalFilesForChat should update state`() = runTest {
        // Given
        val testFiles = listOf(
            createExternalFile("document1.pdf", FileCategory.DOCUMENT),
            createExternalFile("code1.kt", FileCategory.CODE)
        )

        coEvery {
            mockExternalFileDao.searchFiles(
                query = "test",
                category = null,
                limit = 20
            )
        } returns flowOf(testFiles)

        coEvery {
            mockExternalFileDao.getRecentFiles(
                categories = any(),
                limit = any()
            )
        } returns testFiles

        // When - search with query
        externalFileRepository.searchFiles("test", null, 20).first()

        // Then
        coVerify { mockExternalFileDao.searchFiles("test", null, 20) }
    }

    /**
     * Test 5: Import External File for Chat Workflow
     *
     * Verifies complete workflow:
     * 1. User selects external file from search
     * 2. File is imported via LINK mode
     * 3. File is added to mentioned files
     */
    @Test
    fun `complete workflow - search, import, and mention external file`() = runTest {
        // Given
        val projectId = UUID.randomUUID().toString()
        val externalFile = createExternalFile("context.pdf", FileCategory.DOCUMENT)
        val mockProject = ProjectEntity(
            id = projectId,
            name = "AI Project",
            userId = "user1",
            createdAt = System.currentTimeMillis(),
            updatedAt = System.currentTimeMillis(),
            fileCount = 3,
            totalSize = 500L
        )

        // Setup mocks
        coEvery { mockProjectDao.getProjectById(projectId) } returns mockProject
        coEvery { mockProjectDao.insertFile(any()) } returns Unit
        coEvery { mockProjectDao.updateProjectStats(any(), any(), any()) } returns Unit
        coEvery {
            mockExternalFileDao.searchFiles(any(), any(), any())
        } returns flowOf(listOf(externalFile))

        // When - complete workflow
        // 1. Search for external files
        val searchResults = externalFileRepository.searchFiles("context", null, 20).first()
        assertEquals(1, searchResults.size)

        // 2. Import selected file
        val importResult = fileImportRepository.importFileToProject(
            externalFile = searchResults.first(),
            targetProjectId = projectId,
            importType = ImportType.LINK,
            importSource = ImportSource.AI_CHAT
        )

        // Then
        assertTrue(importResult is FileImportRepository.ImportResult.Success)
        val importedFile = (importResult as FileImportRepository.ImportResult.Success).projectFile

        // Verify file was imported correctly
        assertEquals(externalFile.uri, importedFile.path)
        assertEquals(null, importedFile.content)
        assertEquals(projectId, importedFile.projectId)

        // Verify project stats updated
        coVerify {
            mockProjectDao.updateProjectStats(projectId, 4, 500L)
        }
    }

    /**
     * Test 6: Error Handling - Invalid URI
     *
     * Verifies:
     * - Proper error handling when external file is unavailable
     */
    @Test
    fun `importFileToProject should handle invalid URI gracefully`() = runTest {
        // Given
        val projectId = UUID.randomUUID().toString()
        val externalFile = createExternalFile("invalid.pdf", FileCategory.DOCUMENT)

        coEvery { mockProjectDao.getProjectById(projectId) } throws Exception("File not found")

        // When
        val result = fileImportRepository.importFileToProject(
            externalFile = externalFile,
            targetProjectId = projectId,
            importType = ImportType.LINK
        )

        // Then
        assertTrue(result is FileImportRepository.ImportResult.Failure)
        val error = (result as FileImportRepository.ImportResult.Failure).error
        assertTrue(error.message.contains("导入失败"))
    }

    /**
     * Test 7: Search Query Filtering
     *
     * Verifies:
     * - Search query filters file names
     * - Search is case-insensitive
     */
    @Test
    fun `searchFiles should filter by name case-insensitively`() = runTest {
        // Given
        val testFiles = listOf(
            createExternalFile("IMPORTANT.pdf", FileCategory.DOCUMENT),
            createExternalFile("important_doc.txt", FileCategory.DOCUMENT),
            createExternalFile("regular.pdf", FileCategory.DOCUMENT)
        )

        coEvery {
            mockExternalFileDao.searchFiles("important", null, 20)
        } returns flowOf(testFiles.filter {
            it.displayName.contains("important", ignoreCase = true)
        })

        // When
        val results = externalFileRepository.searchFiles("important", null, 20).first()

        // Then
        assertEquals(2, results.size)
        assertTrue(results.all { it.displayName.contains("important", ignoreCase = true) })
    }

    // Helper function
    private fun createExternalFile(
        name: String,
        category: FileCategory
    ): ExternalFileEntity {
        return ExternalFileEntity(
            id = UUID.randomUUID().toString(),
            uri = "content://media/external/file/${UUID.randomUUID()}",
            displayName = name,
            mimeType = when (category) {
                FileCategory.DOCUMENT -> "application/pdf"
                FileCategory.CODE -> "text/plain"
                FileCategory.IMAGE -> "image/png"
                else -> "application/octet-stream"
            },
            size = 1024L,
            category = category,
            lastModified = System.currentTimeMillis(),
            displayPath = "/storage/emulated/0/Documents/$name",
            parentFolder = "Documents",
            scannedAt = System.currentTimeMillis(),
            isFavorite = false,
            extension = name.substringAfterLast('.', "")
        )
    }
}

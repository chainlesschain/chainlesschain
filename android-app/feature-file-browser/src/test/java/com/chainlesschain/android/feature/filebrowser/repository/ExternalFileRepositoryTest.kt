package com.chainlesschain.android.feature.filebrowser.repository

import app.cash.turbine.test
import com.chainlesschain.android.core.database.dao.ExternalFileDao
import com.chainlesschain.android.core.database.entity.ExternalFileEntity
import com.chainlesschain.android.core.database.entity.FileCategory
import com.chainlesschain.android.feature.filebrowser.data.repository.ExternalFileRepository
import io.mockk.*
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * Unit tests for ExternalFileRepository
 *
 * Tests:
 * - File search
 * - Category filtering
 * - Recent files retrieval
 * - Favorite toggle
 * - Statistics calculation
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class ExternalFileRepositoryTest {

    private lateinit var repository: ExternalFileRepository
    private lateinit var mockDao: ExternalFileDao

    @Before
    fun setup() {
        mockDao = mockk(relaxed = true)
        repository = ExternalFileRepository(mockDao)
    }

    @After
    fun tearDown() {
        clearAllMocks()
    }

    @Test
    fun `searchFiles should return files from dao`() = runTest {
        val testFiles = listOf(
            createTestFile("test1.txt"),
            createTestFile("test2.txt")
        )

        every { mockDao.searchFiles("test", 50) } returns flowOf(testFiles)

        repository.searchFiles("test").test {
            val files = awaitItem()
            assertEquals(2, files.size)
            assertEquals("test1.txt", files[0].displayName)
            assertEquals("test2.txt", files[1].displayName)
            awaitComplete()
        }

        verify(exactly = 1) { mockDao.searchFiles("test", 50) }
    }

    @Test
    fun `searchFiles with category should filter by category`() = runTest {
        val testFiles = listOf(createTestFile("image.jpg", FileCategory.IMAGE))

        every {
            mockDao.searchFilesByCategory(FileCategory.IMAGE, "image", 50)
        } returns flowOf(testFiles)

        repository.searchFiles("image", FileCategory.IMAGE).test {
            val files = awaitItem()
            assertEquals(1, files.size)
            assertEquals(FileCategory.IMAGE, files[0].category)
            awaitComplete()
        }

        verify(exactly = 1) { mockDao.searchFilesByCategory(FileCategory.IMAGE, "image", 50) }
    }

    @Test
    fun `getRecentFiles should return files from last 30 days`() = runTest {
        val now = System.currentTimeMillis()
        val twentyDaysAgo = now - (20 * 24 * 60 * 60 * 1000L)

        val testFiles = listOf(
            createTestFile("recent1.txt", lastModified = twentyDaysAgo),
            createTestFile("recent2.txt", lastModified = now)
        )

        every {
            mockDao.getRecentFilesByCategory(
                category = FileCategory.DOCUMENT,
                fromTimestamp = any(),
                limit = any()
            )
        } returns flowOf(testFiles)

        val result = repository.getRecentFiles(
            categories = listOf(FileCategory.DOCUMENT),
            limit = 20
        )

        assertEquals(2, result.size)
        // Should be sorted by lastModified descending
        assertTrue(result[0].lastModified >= result[1].lastModified)
    }

    @Test
    fun `getById should return file if exists`() = runTest {
        val testFile = createTestFile("test.txt")

        coEvery { mockDao.getById(testFile.id) } returns testFile

        val result = repository.getById(testFile.id)

        assertNotNull(result)
        assertEquals(testFile.id, result.id)
        assertEquals("test.txt", result.displayName)

        coVerify(exactly = 1) { mockDao.getById(testFile.id) }
    }

    @Test
    fun `getById should return null if not exists`() = runTest {
        coEvery { mockDao.getById(any()) } returns null

        val result = repository.getById("nonexistent")

        assertEquals(null, result)
    }

    @Test
    fun `getFilesByCategory should return filtered files`() = runTest {
        val testFiles = listOf(
            createTestFile("image1.jpg", FileCategory.IMAGE),
            createTestFile("image2.png", FileCategory.IMAGE)
        )

        every {
            mockDao.getFilesByCategory(FileCategory.IMAGE, 50, 0)
        } returns flowOf(testFiles)

        repository.getFilesByCategory(FileCategory.IMAGE).test {
            val files = awaitItem()
            assertEquals(2, files.size)
            assertTrue(files.all { it.category == FileCategory.IMAGE })
            awaitComplete()
        }
    }

    @Test
    fun `getAllFiles should return all files with pagination`() = runTest {
        val testFiles = List(10) { createTestFile("file$it.txt") }

        every { mockDao.getAllFiles(50, 0) } returns flowOf(testFiles)

        repository.getAllFiles().test {
            val files = awaitItem()
            assertEquals(10, files.size)
            awaitComplete()
        }

        verify(exactly = 1) { mockDao.getAllFiles(50, 0) }
    }

    @Test
    fun `getFavoriteFiles should return only favorited files`() = runTest {
        val testFiles = listOf(
            createTestFile("fav1.txt", isFavorite = true),
            createTestFile("fav2.txt", isFavorite = true)
        )

        every { mockDao.getFavoriteFiles() } returns flowOf(testFiles)

        repository.getFavoriteFiles().test {
            val files = awaitItem()
            assertEquals(2, files.size)
            assertTrue(files.all { it.isFavorite })
            awaitComplete()
        }
    }

    @Test
    fun `toggleFavorite should toggle favorite status`() = runTest {
        val testFile = createTestFile("test.txt", isFavorite = false)

        coEvery { mockDao.getById(testFile.id) } returns testFile
        coEvery { mockDao.updateFavorite(testFile.id, true) } just runs

        val result = repository.toggleFavorite(testFile.id)

        assertTrue(result) // Should return new status (true)
        coVerify(exactly = 1) { mockDao.updateFavorite(testFile.id, true) }
    }

    @Test
    fun `toggleFavorite should return false if file not found`() = runTest {
        coEvery { mockDao.getById(any()) } returns null

        val result = repository.toggleFavorite("nonexistent")

        assertFalse(result)
        coVerify(exactly = 0) { mockDao.updateFavorite(any(), any()) }
    }

    @Test
    fun `getFilesCount should return total file count`() = runTest {
        coEvery { mockDao.getFileCount() } returns 150

        val result = repository.getFilesCount()

        assertEquals(150, result)
        coVerify(exactly = 1) { mockDao.getFileCount() }
    }

    @Test
    fun `getTotalSize should return sum of all file sizes`() = runTest {
        coEvery { mockDao.getTotalSize() } returns 1024L * 1024 * 50 // 50MB

        val result = repository.getTotalSize()

        assertEquals(1024L * 1024 * 50, result)
        coVerify(exactly = 1) { mockDao.getTotalSize() }
    }

    @Test
    fun `getTotalSize should return 0 if null`() = runTest {
        coEvery { mockDao.getTotalSize() } returns null

        val result = repository.getTotalSize()

        assertEquals(0L, result)
    }

    @Test
    fun `getFileCountByCategory should return count for specific category`() = runTest {
        coEvery { mockDao.getFileCountByCategory(FileCategory.IMAGE) } returns 25

        val result = repository.getFileCountByCategory(FileCategory.IMAGE)

        assertEquals(25, result)
        coVerify(exactly = 1) { mockDao.getFileCountByCategory(FileCategory.IMAGE) }
    }

    @Test
    fun `deleteAll should clear all files`() = runTest {
        coEvery { mockDao.deleteAll() } just runs

        repository.deleteAll()

        coVerify(exactly = 1) { mockDao.deleteAll() }
    }

    @Test
    fun `searchFiles with custom limit should respect limit parameter`() = runTest {
        val testFiles = List(100) { createTestFile("file$it.txt") }

        every { mockDao.searchFiles("file", 100) } returns flowOf(testFiles)

        repository.searchFiles("file", limit = 100).test {
            val files = awaitItem()
            assertEquals(100, files.size)
            awaitComplete()
        }

        verify(exactly = 1) { mockDao.searchFiles("file", 100) }
    }

    @Test
    fun `getFilesByCategory with pagination should support offset`() = runTest {
        val testFiles = List(50) { createTestFile("file$it.txt") }

        every {
            mockDao.getFilesByCategory(FileCategory.DOCUMENT, 50, 100)
        } returns flowOf(testFiles)

        repository.getFilesByCategory(
            category = FileCategory.DOCUMENT,
            limit = 50,
            offset = 100
        ).test {
            val files = awaitItem()
            assertEquals(50, files.size)
            awaitComplete()
        }

        verify(exactly = 1) { mockDao.getFilesByCategory(FileCategory.DOCUMENT, 50, 100) }
    }

    // Helper methods

    private fun createTestFile(
        name: String,
        category: FileCategory = FileCategory.DOCUMENT,
        size: Long = 1024L,
        lastModified: Long = System.currentTimeMillis(),
        isFavorite: Boolean = false
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
            isFavorite = isFavorite,
            extension = name.substringAfterLast('.', "")
        )
    }
}

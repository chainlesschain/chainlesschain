package com.chainlesschain.android.core.database.dao

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.chainlesschain.android.core.database.ChainlessChainDatabase
import com.chainlesschain.android.core.database.entity.ExternalFileEntity
import com.chainlesschain.android.core.database.entity.FileCategory
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
 * ExternalFileDao单元测试
 *
 * 使用Robolectric和Room内存数据库进行真实数据库操作测试
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28]) // Android 9.0
class ExternalFileDaoTest {

    private lateinit var database: ChainlessChainDatabase
    private lateinit var externalFileDao: ExternalFileDao

    @Before
    fun setup() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        database = Room.inMemoryDatabaseBuilder(
            context,
            ChainlessChainDatabase::class.java
        )
            .allowMainThreadQueries() // For testing only
            .build()

        externalFileDao = database.externalFileDao()
    }

    @After
    fun tearDown() {
        database.close()
    }

    // ===== 基础 CRUD 测试 =====

    @Test
    fun `insert single file and retrieve by id`() = runTest {
        // Arrange
        val file = createTestFile(
            id = "file-1",
            displayName = "test_document.pdf",
            category = FileCategory.DOCUMENT
        )

        // Act
        val insertId = externalFileDao.insert(file)
        val retrieved = externalFileDao.getById("file-1")

        // Assert
        assertTrue(insertId > 0)
        assertNotNull(retrieved)
        assertEquals("file-1", retrieved.id)
        assertEquals("test_document.pdf", retrieved.displayName)
        assertEquals(FileCategory.DOCUMENT, retrieved.category)
    }

    @Test
    fun `insertAll should batch insert 500 files`() = runTest {
        // Arrange
        val files = (1..500).map { index ->
            createTestFile(
                id = "file-$index",
                displayName = "document_$index.pdf",
                category = FileCategory.DOCUMENT,
                size = 1024L * index
            )
        }

        // Act
        val insertIds = externalFileDao.insertAll(files)
        val count = externalFileDao.getFileCount()

        // Assert
        assertEquals(500, insertIds.size)
        assertEquals(500, count)
    }

    @Test
    fun `insert with REPLACE strategy should update existing file`() = runTest {
        // Arrange
        val originalFile = createTestFile(id = "file-1", displayName = "original.txt")
        val updatedFile = originalFile.copy(displayName = "updated.txt")

        // Act
        externalFileDao.insert(originalFile)
        externalFileDao.insert(updatedFile) // Should replace
        val retrieved = externalFileDao.getById("file-1")

        // Assert
        assertNotNull(retrieved)
        assertEquals("updated.txt", retrieved.displayName)
    }

    @Test
    fun `update should modify existing file`() = runTest {
        // Arrange
        val file = createTestFile(id = "file-1", displayName = "original.txt")
        externalFileDao.insert(file)

        // Act
        val updated = file.copy(displayName = "modified.txt", isFavorite = true)
        externalFileDao.update(updated)
        val retrieved = externalFileDao.getById("file-1")

        // Assert
        assertNotNull(retrieved)
        assertEquals("modified.txt", retrieved.displayName)
        assertTrue(retrieved.isFavorite)
    }

    @Test
    fun `delete should remove file`() = runTest {
        // Arrange
        val file = createTestFile(id = "file-1")
        externalFileDao.insert(file)

        // Act
        externalFileDao.delete(file)
        val retrieved = externalFileDao.getById("file-1")

        // Assert
        assertNull(retrieved)
    }

    @Test
    fun `deleteById should remove file by id`() = runTest {
        // Arrange
        val file = createTestFile(id = "file-1")
        externalFileDao.insert(file)

        // Act
        externalFileDao.deleteById("file-1")
        val retrieved = externalFileDao.getById("file-1")

        // Assert
        assertNull(retrieved)
    }

    @Test
    fun `deleteAll should remove all files`() = runTest {
        // Arrange
        val files = (1..10).map { createTestFile(id = "file-$it") }
        externalFileDao.insertAll(files)

        // Act
        externalFileDao.deleteAll()
        val count = externalFileDao.getFileCount()

        // Assert
        assertEquals(0, count)
    }

    @Test
    fun `getByUri should retrieve file by uri`() = runTest {
        // Arrange
        val file = createTestFile(
            id = "file-1",
            uri = "content://media/external/images/media/123"
        )
        externalFileDao.insert(file)

        // Act
        val retrieved = externalFileDao.getByUri("content://media/external/images/media/123")

        // Assert
        assertNotNull(retrieved)
        assertEquals("file-1", retrieved.id)
    }

    // ===== 分类查询测试 =====

    @Test
    fun `getFilesByCategory should filter by category`() = runTest {
        // Arrange
        externalFileDao.insertAll(listOf(
            createTestFile(id = "doc-1", category = FileCategory.DOCUMENT),
            createTestFile(id = "doc-2", category = FileCategory.DOCUMENT),
            createTestFile(id = "img-1", category = FileCategory.IMAGE),
            createTestFile(id = "vid-1", category = FileCategory.VIDEO)
        ))

        // Act
        val documents = externalFileDao.getFilesByCategory(FileCategory.DOCUMENT, limit = 50, offset = 0).first()
        val images = externalFileDao.getFilesByCategory(FileCategory.IMAGE, limit = 50, offset = 0).first()

        // Assert
        assertEquals(2, documents.size)
        assertEquals(1, images.size)
        assertTrue(documents.all { it.category == FileCategory.DOCUMENT })
    }

    @Test
    fun `getAllFiles should return all files ordered by lastModified DESC`() = runTest {
        // Arrange
        val now = System.currentTimeMillis()
        externalFileDao.insertAll(listOf(
            createTestFile(id = "file-1", lastModified = now - 3000),
            createTestFile(id = "file-2", lastModified = now - 1000),
            createTestFile(id = "file-3", lastModified = now - 2000)
        ))

        // Act
        val files = externalFileDao.getAllFiles(limit = 50, offset = 0).first()

        // Assert
        assertEquals(3, files.size)
        assertEquals("file-2", files[0].id) // Most recent
        assertEquals("file-3", files[1].id)
        assertEquals("file-1", files[2].id) // Oldest
    }

    @Test
    fun `getFavoriteFiles should return only favorite files`() = runTest {
        // Arrange
        externalFileDao.insertAll(listOf(
            createTestFile(id = "file-1", isFavorite = true),
            createTestFile(id = "file-2", isFavorite = false),
            createTestFile(id = "file-3", isFavorite = true)
        ))

        // Act
        val favorites = externalFileDao.getFavoriteFiles().first()

        // Assert
        assertEquals(2, favorites.size)
        assertTrue(favorites.all { it.isFavorite })
    }

    // ===== 搜索测试 =====

    @Test
    fun `searchFiles should perform fuzzy search on displayName`() = runTest {
        // Arrange
        externalFileDao.insertAll(listOf(
            createTestFile(id = "file-1", displayName = "project_proposal.pdf"),
            createTestFile(id = "file-2", displayName = "meeting_notes.txt"),
            createTestFile(id = "file-3", displayName = "project_budget.xlsx")
        ))

        // Act
        val results = externalFileDao.searchFiles("project", limit = 50).first()

        // Assert
        assertEquals(2, results.size)
        assertTrue(results.any { it.id == "file-1" })
        assertTrue(results.any { it.id == "file-3" })
    }

    @Test
    fun `searchFiles should search in displayPath`() = runTest {
        // Arrange
        externalFileDao.insertAll(listOf(
            createTestFile(id = "file-1", displayPath = "/storage/emulated/0/Documents/work.pdf", parentFolder = "Documents"),
            createTestFile(id = "file-2", displayPath = "/storage/emulated/0/Pictures/photo.jpg", parentFolder = "Pictures"),
            createTestFile(id = "file-3", displayPath = "/storage/emulated/0/Documents/report.pdf", parentFolder = "Documents")
        ))

        // Act
        val results = externalFileDao.searchFiles("Documents", limit = 50).first()

        // Assert
        assertEquals(2, results.size)
        assertTrue(results.all { it.displayPath?.contains("Documents") == true })
    }

    @Test
    fun `searchFilesByCategory should filter by category and search`() = runTest {
        // Arrange
        externalFileDao.insertAll(listOf(
            createTestFile(id = "doc-1", displayName = "project.pdf", category = FileCategory.DOCUMENT),
            createTestFile(id = "img-1", displayName = "project_logo.png", category = FileCategory.IMAGE),
            createTestFile(id = "doc-2", displayName = "budget.xlsx", category = FileCategory.DOCUMENT)
        ))

        // Act
        val results = externalFileDao.searchFilesByCategory(
            category = FileCategory.DOCUMENT,
            query = "project",
            limit = 50
        ).first()

        // Assert
        assertEquals(1, results.size)
        assertEquals("doc-1", results[0].id)
        assertEquals(FileCategory.DOCUMENT, results[0].category)
    }

    @Test
    fun `searchFilesByCategories should search across multiple categories`() = runTest {
        // Arrange
        externalFileDao.insertAll(listOf(
            createTestFile(id = "doc-1", displayName = "report.pdf", category = FileCategory.DOCUMENT),
            createTestFile(id = "img-1", displayName = "report_chart.png", category = FileCategory.IMAGE),
            createTestFile(id = "vid-1", displayName = "presentation.mp4", category = FileCategory.VIDEO)
        ))

        // Act
        val results = externalFileDao.searchFilesByCategories(
            categories = listOf(FileCategory.DOCUMENT, FileCategory.IMAGE),
            query = "report",
            limit = 50
        ).first()

        // Assert
        assertEquals(2, results.size)
        assertTrue(results.any { it.id == "doc-1" })
        assertTrue(results.any { it.id == "img-1" })
    }

    // ===== 统计查询测试 =====

    @Test
    fun `getFileCount should return total file count`() = runTest {
        // Arrange
        val files = (1..15).map { createTestFile(id = "file-$it") }
        externalFileDao.insertAll(files)

        // Act
        val count = externalFileDao.getFileCount()

        // Assert
        assertEquals(15, count)
    }

    @Test
    fun `getFileCountByCategory should count files in category`() = runTest {
        // Arrange
        externalFileDao.insertAll(listOf(
            createTestFile(id = "doc-1", category = FileCategory.DOCUMENT),
            createTestFile(id = "doc-2", category = FileCategory.DOCUMENT),
            createTestFile(id = "img-1", category = FileCategory.IMAGE),
            createTestFile(id = "doc-3", category = FileCategory.DOCUMENT)
        ))

        // Act
        val docCount = externalFileDao.getFileCountByCategory(FileCategory.DOCUMENT)
        val imgCount = externalFileDao.getFileCountByCategory(FileCategory.IMAGE)

        // Assert
        assertEquals(3, docCount)
        assertEquals(1, imgCount)
    }

    @Test
    fun `getTotalSize should sum all file sizes`() = runTest {
        // Arrange
        externalFileDao.insertAll(listOf(
            createTestFile(id = "file-1", size = 1024L),
            createTestFile(id = "file-2", size = 2048L),
            createTestFile(id = "file-3", size = 4096L)
        ))

        // Act
        val totalSize = externalFileDao.getTotalSize()

        // Assert
        assertEquals(7168L, totalSize) // 1024 + 2048 + 4096
    }

    @Test
    fun `getTotalSize should return null when no files`() = runTest {
        // Act
        val totalSize = externalFileDao.getTotalSize()

        // Assert
        assertNull(totalSize)
    }

    @Test
    fun `getTotalSizeByCategory should sum sizes in category`() = runTest {
        // Arrange
        externalFileDao.insertAll(listOf(
            createTestFile(id = "doc-1", category = FileCategory.DOCUMENT, size = 1024L),
            createTestFile(id = "doc-2", category = FileCategory.DOCUMENT, size = 2048L),
            createTestFile(id = "img-1", category = FileCategory.IMAGE, size = 4096L)
        ))

        // Act
        val docSize = externalFileDao.getTotalSizeByCategory(FileCategory.DOCUMENT)
        val imgSize = externalFileDao.getTotalSizeByCategory(FileCategory.IMAGE)

        // Assert
        assertEquals(3072L, docSize) // 1024 + 2048
        assertEquals(4096L, imgSize)
    }

    @Test
    fun `getCountByCategory should group count by category`() = runTest {
        // Arrange
        externalFileDao.insertAll(listOf(
            createTestFile(id = "doc-1", category = FileCategory.DOCUMENT),
            createTestFile(id = "doc-2", category = FileCategory.DOCUMENT),
            createTestFile(id = "img-1", category = FileCategory.IMAGE),
            createTestFile(id = "vid-1", category = FileCategory.VIDEO),
            createTestFile(id = "vid-2", category = FileCategory.VIDEO),
            createTestFile(id = "vid-3", category = FileCategory.VIDEO)
        ))

        // Act
        val categoryCounts = externalFileDao.getCountByCategory()

        // Assert
        assertEquals(3, categoryCounts.size)
        val docCount = categoryCounts.find { it.category == FileCategory.DOCUMENT }
        val imgCount = categoryCounts.find { it.category == FileCategory.IMAGE }
        val vidCount = categoryCounts.find { it.category == FileCategory.VIDEO }

        assertEquals(2, docCount?.count)
        assertEquals(1, imgCount?.count)
        assertEquals(3, vidCount?.count)
    }

    @Test
    fun `getLastScanTimestamp should return most recent scan time`() = runTest {
        // Arrange
        val now = System.currentTimeMillis()
        externalFileDao.insertAll(listOf(
            createTestFile(id = "file-1", scannedAt = now - 3000),
            createTestFile(id = "file-2", scannedAt = now - 1000), // Most recent
            createTestFile(id = "file-3", scannedAt = now - 2000)
        ))

        // Act
        val lastScan = externalFileDao.getLastScanTimestamp()

        // Assert
        assertNotNull(lastScan)
        assertEquals(now - 1000, lastScan)
    }

    @Test
    fun `getNewFilesCount should count files scanned after timestamp`() = runTest {
        // Arrange
        val now = System.currentTimeMillis()
        val threshold = now - 5000
        externalFileDao.insertAll(listOf(
            createTestFile(id = "file-1", scannedAt = now - 6000), // Before threshold
            createTestFile(id = "file-2", scannedAt = now - 3000), // After threshold
            createTestFile(id = "file-3", scannedAt = now - 1000)  // After threshold
        ))

        // Act
        val newFilesCount = externalFileDao.getNewFilesCount(threshold)

        // Assert
        assertEquals(2, newFilesCount)
    }

    // ===== 收藏操作测试 =====

    @Test
    fun `updateFavorite should toggle favorite status`() = runTest {
        // Arrange
        val file = createTestFile(id = "file-1", isFavorite = false)
        externalFileDao.insert(file)

        // Act - Set to favorite
        externalFileDao.updateFavorite("file-1", true)
        val favorited = externalFileDao.getById("file-1")

        // Assert
        assertNotNull(favorited)
        assertTrue(favorited.isFavorite)

        // Act - Unset favorite
        externalFileDao.updateFavorite("file-1", false)
        val unfavorited = externalFileDao.getById("file-1")

        // Assert
        assertNotNull(unfavorited)
        assertTrue(!unfavorited.isFavorite)
    }

    // ===== 批量操作测试 =====

    @Test
    fun `deleteStaleFiles should remove files scanned before timestamp`() = runTest {
        // Arrange
        val now = System.currentTimeMillis()
        val threshold = now - 86400000L // 24 hours ago
        externalFileDao.insertAll(listOf(
            createTestFile(id = "old-1", scannedAt = now - 90000000L), // Stale
            createTestFile(id = "old-2", scannedAt = now - 87000000L), // Stale
            createTestFile(id = "new-1", scannedAt = now - 3600000L)   // Fresh
        ))

        // Act
        val deletedCount = externalFileDao.deleteStaleFiles(threshold)
        val remainingCount = externalFileDao.getFileCount()

        // Assert
        assertEquals(2, deletedCount)
        assertEquals(1, remainingCount)
    }

    @Test
    fun `updateScannedTime should update scan timestamp for specified uris`() = runTest {
        // Arrange
        val files = listOf(
            createTestFile(id = "file-1", uri = "content://uri-1", scannedAt = 1000L),
            createTestFile(id = "file-2", uri = "content://uri-2", scannedAt = 1000L),
            createTestFile(id = "file-3", uri = "content://uri-3", scannedAt = 1000L)
        )
        externalFileDao.insertAll(files)
        val newTimestamp = System.currentTimeMillis()

        // Act
        externalFileDao.updateScannedTime(listOf("content://uri-1", "content://uri-2"), newTimestamp)

        val file1 = externalFileDao.getByUri("content://uri-1")
        val file2 = externalFileDao.getByUri("content://uri-2")
        val file3 = externalFileDao.getByUri("content://uri-3")

        // Assert
        assertNotNull(file1)
        assertNotNull(file2)
        assertNotNull(file3)
        assertEquals(newTimestamp, file1.scannedAt)
        assertEquals(newTimestamp, file2.scannedAt)
        assertEquals(1000L, file3.scannedAt) // Unchanged
    }

    // ===== 排序和过滤测试 =====

    @Test
    fun `getFilesByCategorySortedByName should sort alphabetically`() = runTest {
        // Arrange
        externalFileDao.insertAll(listOf(
            createTestFile(id = "file-1", displayName = "zebra.txt", category = FileCategory.DOCUMENT),
            createTestFile(id = "file-2", displayName = "apple.txt", category = FileCategory.DOCUMENT),
            createTestFile(id = "file-3", displayName = "banana.txt", category = FileCategory.DOCUMENT)
        ))

        // Act
        val files = externalFileDao.getFilesByCategorySortedByName(FileCategory.DOCUMENT, limit = 50, offset = 0).first()

        // Assert
        assertEquals(3, files.size)
        assertEquals("apple.txt", files[0].displayName)
        assertEquals("banana.txt", files[1].displayName)
        assertEquals("zebra.txt", files[2].displayName)
    }

    @Test
    fun `getFilesByCategorySortedBySize should sort by size DESC`() = runTest {
        // Arrange
        externalFileDao.insertAll(listOf(
            createTestFile(id = "file-1", size = 1024L, category = FileCategory.DOCUMENT),
            createTestFile(id = "file-2", size = 4096L, category = FileCategory.DOCUMENT),
            createTestFile(id = "file-3", size = 2048L, category = FileCategory.DOCUMENT)
        ))

        // Act
        val files = externalFileDao.getFilesByCategorySortedBySize(FileCategory.DOCUMENT, limit = 50, offset = 0).first()

        // Assert
        assertEquals(3, files.size)
        assertEquals(4096L, files[0].size) // Largest first
        assertEquals(2048L, files[1].size)
        assertEquals(1024L, files[2].size)
    }

    @Test
    fun `getRecentFiles should filter by timestamp`() = runTest {
        // Arrange
        val now = System.currentTimeMillis()
        val oneDayAgo = now - 86400000L
        externalFileDao.insertAll(listOf(
            createTestFile(id = "old-1", lastModified = now - 172800000L), // 2 days ago
            createTestFile(id = "recent-1", lastModified = now - 3600000L), // 1 hour ago
            createTestFile(id = "recent-2", lastModified = now - 7200000L)  // 2 hours ago
        ))

        // Act
        val recentFiles = externalFileDao.getRecentFiles(oneDayAgo, limit = 50).first()

        // Assert
        assertEquals(2, recentFiles.size)
        assertTrue(recentFiles.all { it.lastModified >= oneDayAgo })
    }

    @Test
    fun `getFilesBySizeRange should filter by min and max size`() = runTest {
        // Arrange
        externalFileDao.insertAll(listOf(
            createTestFile(id = "file-1", size = 500L),   // Too small
            createTestFile(id = "file-2", size = 1024L),  // In range
            createTestFile(id = "file-3", size = 2048L),  // In range
            createTestFile(id = "file-4", size = 5000L)   // Too large
        ))

        // Act
        val files = externalFileDao.getFilesBySizeRange(minSize = 1000L, maxSize = 3000L, limit = 50).first()

        // Assert
        assertEquals(2, files.size)
        assertTrue(files.all { it.size in 1000L..3000L })
    }

    // ===== MIME类型查询测试 =====

    @Test
    fun `getFilesByMimeType should filter by mime type`() = runTest {
        // Arrange
        externalFileDao.insertAll(listOf(
            createTestFile(id = "file-1", mimeType = "application/pdf"),
            createTestFile(id = "file-2", mimeType = "image/jpeg"),
            createTestFile(id = "file-3", mimeType = "application/pdf")
        ))

        // Act
        val pdfFiles = externalFileDao.getFilesByMimeType("application/pdf", limit = 50).first()

        // Assert
        assertEquals(2, pdfFiles.size)
        assertTrue(pdfFiles.all { it.mimeType == "application/pdf" })
    }

    @Test
    fun `getMimeTypesByCategory should return distinct mime types`() = runTest {
        // Arrange
        externalFileDao.insertAll(listOf(
            createTestFile(id = "doc-1", category = FileCategory.DOCUMENT, mimeType = "application/pdf"),
            createTestFile(id = "doc-2", category = FileCategory.DOCUMENT, mimeType = "application/pdf"),
            createTestFile(id = "doc-3", category = FileCategory.DOCUMENT, mimeType = "application/msword"),
            createTestFile(id = "img-1", category = FileCategory.IMAGE, mimeType = "image/jpeg")
        ))

        // Act
        val documentMimeTypes = externalFileDao.getMimeTypesByCategory(FileCategory.DOCUMENT)

        // Assert
        assertEquals(2, documentMimeTypes.size)
        assertTrue(documentMimeTypes.contains("application/pdf"))
        assertTrue(documentMimeTypes.contains("application/msword"))
    }

    // ===== 路径相关查询测试 =====

    @Test
    fun `getFilesByFolder should filter by parent folder`() = runTest {
        // Arrange
        externalFileDao.insertAll(listOf(
            createTestFile(id = "file-1", parentFolder = "Documents"),
            createTestFile(id = "file-2", parentFolder = "Pictures"),
            createTestFile(id = "file-3", parentFolder = "Documents")
        ))

        // Act
        val documentsFiles = externalFileDao.getFilesByFolder("Documents").first()

        // Assert
        assertEquals(2, documentsFiles.size)
        assertTrue(documentsFiles.all { it.parentFolder == "Documents" })
    }

    @Test
    fun `getAllFolders should return distinct folder names`() = runTest {
        // Arrange
        externalFileDao.insertAll(listOf(
            createTestFile(id = "file-1", parentFolder = "Documents"),
            createTestFile(id = "file-2", parentFolder = "Pictures"),
            createTestFile(id = "file-3", parentFolder = "Documents"),
            createTestFile(id = "file-4", parentFolder = "Music"),
            createTestFile(id = "file-5", parentFolder = null) // No folder
        ))

        // Act
        val folders = externalFileDao.getAllFolders()

        // Assert
        assertEquals(3, folders.size)
        assertTrue(folders.contains("Documents"))
        assertTrue(folders.contains("Pictures"))
        assertTrue(folders.contains("Music"))
    }

    // ===== Helper Functions =====

    private fun createTestFile(
        id: String = "file-${System.currentTimeMillis()}",
        uri: String = "content://media/external/file/$id",
        displayName: String = "test_file.txt",
        mimeType: String = "text/plain",
        size: Long = 1024L,
        category: FileCategory = FileCategory.DOCUMENT,
        lastModified: Long = System.currentTimeMillis(),
        displayPath: String? = "/storage/emulated/0/Documents/$displayName",
        parentFolder: String? = "Documents",
        scannedAt: Long = System.currentTimeMillis(),
        isFavorite: Boolean = false,
        extension: String = displayName.substringAfterLast('.', "")
    ): ExternalFileEntity {
        return ExternalFileEntity(
            id = id,
            uri = uri,
            displayName = displayName,
            mimeType = mimeType,
            size = size,
            category = category,
            lastModified = lastModified,
            displayPath = displayPath,
            parentFolder = parentFolder,
            scannedAt = scannedAt,
            isFavorite = isFavorite,
            extension = extension
        )
    }
}

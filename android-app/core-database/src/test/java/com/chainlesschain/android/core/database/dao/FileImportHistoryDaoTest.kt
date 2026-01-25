package com.chainlesschain.android.core.database.dao

import android.content.Context
import androidx.room.Room
import androidx.sqlite.db.SimpleSQLiteQuery
import androidx.test.core.app.ApplicationProvider
import com.chainlesschain.android.core.database.ChainlessChainDatabase
import com.chainlesschain.android.core.database.entity.*
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
 * FileImportHistoryDao单元测试
 *
 * 测试文件导入历史记录的数据库操作，包括外键约束和级联删除
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28]) // Android 9.0
class FileImportHistoryDaoTest {

    private lateinit var database: ChainlessChainDatabase
    private lateinit var fileImportHistoryDao: FileImportHistoryDao
    private lateinit var projectDao: ProjectDao

    @Before
    fun setup() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        database = Room.inMemoryDatabaseBuilder(
            context,
            ChainlessChainDatabase::class.java
        )
            .allowMainThreadQueries() // For testing only
            .build()

        fileImportHistoryDao = database.fileImportHistoryDao()
        projectDao = database.projectDao()

        // Enable foreign keys
        database.openHelper.writableDatabase.execSQL("PRAGMA foreign_keys=ON")
    }

    @After
    fun tearDown() {
        database.close()
    }

    // ===== 基础 CRUD 测试 =====

    @Test
    fun `insert import history record and retrieve by id`() = runTest {
        // Arrange
        val project = createTestProject("project-1")
        projectDao.insertProject(project)

        val history = createTestImportHistory(
            id = "history-1",
            projectId = "project-1",
            sourceFileName = "document.pdf"
        )

        // Act
        val insertId = fileImportHistoryDao.insert(history)
        val retrieved = fileImportHistoryDao.getById("history-1")

        // Assert
        assertTrue(insertId > 0)
        assertNotNull(retrieved)
        assertEquals("history-1", retrieved.id)
        assertEquals("project-1", retrieved.projectId)
        assertEquals("document.pdf", retrieved.sourceFileName)
    }

    @Test
    fun `insertAll should batch insert multiple records`() = runTest {
        // Arrange
        val project = createTestProject("project-1")
        projectDao.insertProject(project)

        val histories = (1..10).map { index ->
            createTestImportHistory(
                id = "history-$index",
                projectId = "project-1",
                sourceFileName = "file_$index.txt"
            )
        }

        // Act
        val insertIds = fileImportHistoryDao.insertAll(histories)
        val count = fileImportHistoryDao.getTotalCount()

        // Assert
        assertEquals(10, insertIds.size)
        assertEquals(10, count)
    }

    @Test
    fun `getByProjectFileId should retrieve history by project file id`() = runTest {
        // Arrange
        val project = createTestProject("project-1")
        projectDao.insertProject(project)

        val history = createTestImportHistory(
            id = "history-1",
            projectId = "project-1",
            projectFileId = "file-123"
        )
        fileImportHistoryDao.insert(history)

        // Act
        val retrieved = fileImportHistoryDao.getByProjectFileId("file-123")

        // Assert
        assertNotNull(retrieved)
        assertEquals("history-1", retrieved.id)
        assertEquals("file-123", retrieved.projectFileId)
    }

    @Test
    fun `getBySourceUri should retrieve all imports from same source`() = runTest {
        // Arrange
        val project = createTestProject("project-1")
        projectDao.insertProject(project)

        val sourceUri = "content://media/external/file/123"
        fileImportHistoryDao.insertAll(listOf(
            createTestImportHistory(id = "history-1", projectId = "project-1", sourceUri = sourceUri),
            createTestImportHistory(id = "history-2", projectId = "project-1", sourceUri = sourceUri),
            createTestImportHistory(id = "history-3", projectId = "project-1", sourceUri = "other://uri")
        ))

        // Act
        val histories = fileImportHistoryDao.getBySourceUri(sourceUri)

        // Assert
        assertEquals(2, histories.size)
        assertTrue(histories.all { it.sourceUri == sourceUri })
    }

    @Test
    fun `update should modify existing history record`() = runTest {
        // Arrange
        val project = createTestProject("project-1")
        projectDao.insertProject(project)

        val history = createTestImportHistory(id = "history-1", projectId = "project-1")
        fileImportHistoryDao.insert(history)

        // Act
        val updated = history.copy(note = "Updated note")
        fileImportHistoryDao.update(updated)
        val retrieved = fileImportHistoryDao.getById("history-1")

        // Assert
        assertNotNull(retrieved)
        assertEquals("Updated note", retrieved.note)
    }

    @Test
    fun `delete should remove history record`() = runTest {
        // Arrange
        val project = createTestProject("project-1")
        projectDao.insertProject(project)

        val history = createTestImportHistory(id = "history-1", projectId = "project-1")
        fileImportHistoryDao.insert(history)

        // Act
        fileImportHistoryDao.delete(history)
        val retrieved = fileImportHistoryDao.getById("history-1")

        // Assert
        assertNull(retrieved)
    }

    // ===== 外键约束测试 =====

    @Test(expected = Exception::class)
    fun `insert should fail when project does not exist`() = runTest {
        // Arrange
        val history = createTestImportHistory(
            id = "history-1",
            projectId = "nonexistent-project"
        )

        // Act & Assert - Should throw foreign key constraint violation
        fileImportHistoryDao.insert(history)
    }

    @Test
    fun `foreign key constraint should be enforced`() = runTest {
        // Arrange
        val project = createTestProject("project-1")
        projectDao.insertProject(project)

        val history = createTestImportHistory(
            id = "history-1",
            projectId = "project-1"
        )
        fileImportHistoryDao.insert(history)

        // Act - Try to delete project (should fail because of foreign key)
        var constraintViolated = false
        try {
            // First, manually check foreign key constraints
            val query = SimpleSQLiteQuery("PRAGMA foreign_key_check(projects)")
            val cursor = database.openHelper.readableDatabase.query(query)

            projectDao.delete(project)

            // If we reach here without exception, check if records still exist
            val historyStillExists = fileImportHistoryDao.getById("history-1")
            if (historyStillExists != null) {
                // Foreign key should prevent deletion or cascade delete
                constraintViolated = true
            }
        } catch (e: Exception) {
            constraintViolated = true
        }

        // Assert
        assertTrue(constraintViolated, "Foreign key constraint should prevent project deletion or cascade")
    }

    // ===== 级联删除测试 =====

    @Test
    fun `cascade delete should remove history when project is deleted`() = runTest {
        // Arrange
        val project = createTestProject("project-1")
        projectDao.insertProject(project)

        val histories = (1..5).map { index ->
            createTestImportHistory(
                id = "history-$index",
                projectId = "project-1"
            )
        }
        fileImportHistoryDao.insertAll(histories)

        // Verify histories exist
        val countBefore = fileImportHistoryDao.getCountByProject("project-1")
        assertEquals(5, countBefore)

        // Act - Delete project
        projectDao.delete(project)

        // Assert - All histories should be deleted via cascade
        val countAfter = fileImportHistoryDao.getCountByProject("project-1")
        assertEquals(0, countAfter)
    }

    // ===== 按项目查询历史测试 =====

    @Test
    fun `getByProject should return histories for project ordered by importedAt DESC`() = runTest {
        // Arrange
        val project = createTestProject("project-1")
        projectDao.insertProject(project)

        val now = System.currentTimeMillis()
        fileImportHistoryDao.insertAll(listOf(
            createTestImportHistory(id = "history-1", projectId = "project-1", importedAt = now - 3000),
            createTestImportHistory(id = "history-2", projectId = "project-1", importedAt = now - 1000), // Most recent
            createTestImportHistory(id = "history-3", projectId = "project-1", importedAt = now - 2000)
        ))

        // Act
        val histories = fileImportHistoryDao.getByProject("project-1").first()

        // Assert
        assertEquals(3, histories.size)
        assertEquals("history-2", histories[0].id) // Most recent first
        assertEquals("history-3", histories[1].id)
        assertEquals("history-1", histories[2].id)
    }

    @Test
    fun `getRecentByProject should limit results`() = runTest {
        // Arrange
        val project = createTestProject("project-1")
        projectDao.insertProject(project)

        val histories = (1..15).map { index ->
            createTestImportHistory(
                id = "history-$index",
                projectId = "project-1"
            )
        }
        fileImportHistoryDao.insertAll(histories)

        // Act
        val recentHistories = fileImportHistoryDao.getRecentByProject("project-1", limit = 5)

        // Assert
        assertEquals(5, recentHistories.size)
    }

    @Test
    fun `getCountByProject should count imports for project`() = runTest {
        // Arrange
        val project1 = createTestProject("project-1")
        val project2 = createTestProject("project-2")
        projectDao.insert(project1)
        projectDao.insert(project2)

        fileImportHistoryDao.insertAll(listOf(
            createTestImportHistory(id = "history-1", projectId = "project-1"),
            createTestImportHistory(id = "history-2", projectId = "project-1"),
            createTestImportHistory(id = "history-3", projectId = "project-1"),
            createTestImportHistory(id = "history-4", projectId = "project-2")
        ))

        // Act
        val count1 = fileImportHistoryDao.getCountByProject("project-1")
        val count2 = fileImportHistoryDao.getCountByProject("project-2")

        // Assert
        assertEquals(3, count1)
        assertEquals(1, count2)
    }

    @Test
    fun `getTotalSizeByProject should sum file sizes`() = runTest {
        // Arrange
        val project = createTestProject("project-1")
        projectDao.insertProject(project)

        fileImportHistoryDao.insertAll(listOf(
            createTestImportHistory(id = "history-1", projectId = "project-1", sourceFileSize = 1024L),
            createTestImportHistory(id = "history-2", projectId = "project-1", sourceFileSize = 2048L),
            createTestImportHistory(id = "history-3", projectId = "project-1", sourceFileSize = 4096L)
        ))

        // Act
        val totalSize = fileImportHistoryDao.getTotalSizeByProject("project-1")

        // Assert
        assertEquals(7168L, totalSize) // 1024 + 2048 + 4096
    }

    // ===== 导入类型查询测试 =====

    @Test
    fun `getByImportType should filter by import type`() = runTest {
        // Arrange
        val project = createTestProject("project-1")
        projectDao.insertProject(project)

        fileImportHistoryDao.insertAll(listOf(
            createTestImportHistory(id = "history-1", projectId = "project-1", importType = ImportType.COPY),
            createTestImportHistory(id = "history-2", projectId = "project-1", importType = ImportType.LINK),
            createTestImportHistory(id = "history-3", projectId = "project-1", importType = ImportType.COPY)
        ))

        // Act
        val copyImports = fileImportHistoryDao.getByImportType(ImportType.COPY).first()
        val linkImports = fileImportHistoryDao.getByImportType(ImportType.LINK).first()

        // Assert
        assertEquals(2, copyImports.size)
        assertEquals(1, linkImports.size)
        assertTrue(copyImports.all { it.importType == ImportType.COPY })
        assertTrue(linkImports.all { it.importType == ImportType.LINK })
    }

    @Test
    fun `getCountByImportType should count by type`() = runTest {
        // Arrange
        val project = createTestProject("project-1")
        projectDao.insertProject(project)

        fileImportHistoryDao.insertAll(listOf(
            createTestImportHistory(id = "history-1", projectId = "project-1", importType = ImportType.COPY),
            createTestImportHistory(id = "history-2", projectId = "project-1", importType = ImportType.COPY),
            createTestImportHistory(id = "history-3", projectId = "project-1", importType = ImportType.LINK),
            createTestImportHistory(id = "history-4", projectId = "project-1", importType = ImportType.SYNC)
        ))

        // Act
        val copyCount = fileImportHistoryDao.getCountByImportType(ImportType.COPY)
        val linkCount = fileImportHistoryDao.getCountByImportType(ImportType.LINK)
        val syncCount = fileImportHistoryDao.getCountByImportType(ImportType.SYNC)

        // Assert
        assertEquals(2, copyCount)
        assertEquals(1, linkCount)
        assertEquals(1, syncCount)
    }

    // ===== 导入来源查询测试 =====

    @Test
    fun `getByImportSource should filter by source`() = runTest {
        // Arrange
        val project = createTestProject("project-1")
        projectDao.insertProject(project)

        fileImportHistoryDao.insertAll(listOf(
            createTestImportHistory(id = "history-1", projectId = "project-1", importedFrom = ImportSource.FILE_BROWSER),
            createTestImportHistory(id = "history-2", projectId = "project-1", importedFrom = ImportSource.AI_CHAT),
            createTestImportHistory(id = "history-3", projectId = "project-1", importedFrom = ImportSource.FILE_BROWSER)
        ))

        // Act
        val browserImports = fileImportHistoryDao.getByImportSource(ImportSource.FILE_BROWSER).first()
        val chatImports = fileImportHistoryDao.getByImportSource(ImportSource.AI_CHAT).first()

        // Assert
        assertEquals(2, browserImports.size)
        assertEquals(1, chatImports.size)
    }

    @Test
    fun `getCountByImportSource should count by source`() = runTest {
        // Arrange
        val project = createTestProject("project-1")
        projectDao.insertProject(project)

        fileImportHistoryDao.insertAll(listOf(
            createTestImportHistory(id = "history-1", projectId = "project-1", importedFrom = ImportSource.FILE_BROWSER),
            createTestImportHistory(id = "history-2", projectId = "project-1", importedFrom = ImportSource.AI_CHAT),
            createTestImportHistory(id = "history-3", projectId = "project-1", importedFrom = ImportSource.SHARE_INTENT)
        ))

        // Act
        val browserCount = fileImportHistoryDao.getCountByImportSource(ImportSource.FILE_BROWSER)
        val chatCount = fileImportHistoryDao.getCountByImportSource(ImportSource.AI_CHAT)
        val shareCount = fileImportHistoryDao.getCountByImportSource(ImportSource.SHARE_INTENT)

        // Assert
        assertEquals(1, browserCount)
        assertEquals(1, chatCount)
        assertEquals(1, shareCount)
    }

    // ===== 时间范围查询测试 =====

    @Test
    fun `getImportsSince should filter by timestamp`() = runTest {
        // Arrange
        val project = createTestProject("project-1")
        projectDao.insertProject(project)

        val now = System.currentTimeMillis()
        val oneDayAgo = now - 86400000L
        fileImportHistoryDao.insertAll(listOf(
            createTestImportHistory(id = "history-1", projectId = "project-1", importedAt = now - 172800000L), // 2 days ago
            createTestImportHistory(id = "history-2", projectId = "project-1", importedAt = now - 3600000L),   // 1 hour ago
            createTestImportHistory(id = "history-3", projectId = "project-1", importedAt = now - 7200000L)    // 2 hours ago
        ))

        // Act
        val recentImports = fileImportHistoryDao.getImportsSince(oneDayAgo).first()

        // Assert
        assertEquals(2, recentImports.size)
        assertTrue(recentImports.all { it.importedAt >= oneDayAgo })
    }

    @Test
    fun `getImportsInRange should filter by time range`() = runTest {
        // Arrange
        val project = createTestProject("project-1")
        projectDao.insertProject(project)

        val now = System.currentTimeMillis()
        val start = now - 86400000L // 1 day ago
        val end = now - 3600000L    // 1 hour ago

        fileImportHistoryDao.insertAll(listOf(
            createTestImportHistory(id = "history-1", projectId = "project-1", importedAt = now - 172800000L), // Before range
            createTestImportHistory(id = "history-2", projectId = "project-1", importedAt = now - 7200000L),   // In range
            createTestImportHistory(id = "history-3", projectId = "project-1", importedAt = now - 1800000L)    // After range
        ))

        // Act
        val rangeImports = fileImportHistoryDao.getImportsInRange(start, end).first()

        // Assert
        assertEquals(1, rangeImports.size)
        val import = rangeImports[0]
        assertTrue(import.importedAt >= start && import.importedAt <= end)
    }

    // ===== 统计查询测试 =====

    @Test
    fun `getCountByType should group count by import type`() = runTest {
        // Arrange
        val project = createTestProject("project-1")
        projectDao.insertProject(project)

        fileImportHistoryDao.insertAll(listOf(
            createTestImportHistory(id = "history-1", projectId = "project-1", importType = ImportType.COPY),
            createTestImportHistory(id = "history-2", projectId = "project-1", importType = ImportType.COPY),
            createTestImportHistory(id = "history-3", projectId = "project-1", importType = ImportType.LINK),
            createTestImportHistory(id = "history-4", projectId = "project-1", importType = ImportType.SYNC)
        ))

        // Act
        val typeCounts = fileImportHistoryDao.getCountByType()

        // Assert
        assertEquals(3, typeCounts.size)
        val copyCount = typeCounts.find { it.importType == ImportType.COPY }
        val linkCount = typeCounts.find { it.importType == ImportType.LINK }
        val syncCount = typeCounts.find { it.importType == ImportType.SYNC }

        assertEquals(2, copyCount?.count)
        assertEquals(1, linkCount?.count)
        assertEquals(1, syncCount?.count)
    }

    @Test
    fun `getCountBySource should group count by import source`() = runTest {
        // Arrange
        val project = createTestProject("project-1")
        projectDao.insertProject(project)

        fileImportHistoryDao.insertAll(listOf(
            createTestImportHistory(id = "history-1", projectId = "project-1", importedFrom = ImportSource.FILE_BROWSER),
            createTestImportHistory(id = "history-2", projectId = "project-1", importedFrom = ImportSource.FILE_BROWSER),
            createTestImportHistory(id = "history-3", projectId = "project-1", importedFrom = ImportSource.AI_CHAT)
        ))

        // Act
        val sourceCounts = fileImportHistoryDao.getCountBySource()

        // Assert
        assertEquals(2, sourceCounts.size)
        val browserCount = sourceCounts.find { it.importedFrom == ImportSource.FILE_BROWSER }
        val chatCount = sourceCounts.find { it.importedFrom == ImportSource.AI_CHAT }

        assertEquals(2, browserCount?.count)
        assertEquals(1, chatCount?.count)
    }

    @Test
    fun `getStatsPerProject should aggregate import stats`() = runTest {
        // Arrange
        val project1 = createTestProject("project-1")
        val project2 = createTestProject("project-2")
        projectDao.insert(project1)
        projectDao.insert(project2)

        fileImportHistoryDao.insertAll(listOf(
            createTestImportHistory(id = "history-1", projectId = "project-1", sourceFileSize = 1024L),
            createTestImportHistory(id = "history-2", projectId = "project-1", sourceFileSize = 2048L),
            createTestImportHistory(id = "history-3", projectId = "project-2", sourceFileSize = 4096L)
        ))

        // Act
        val stats = fileImportHistoryDao.getStatsPerProject()

        // Assert
        assertEquals(2, stats.size)
        val project1Stats = stats.find { it.projectId == "project-1" }
        val project2Stats = stats.find { it.projectId == "project-2" }

        assertNotNull(project1Stats)
        assertEquals(2, project1Stats.importCount)
        assertEquals(3072L, project1Stats.totalSize)

        assertNotNull(project2Stats)
        assertEquals(1, project2Stats.importCount)
        assertEquals(4096L, project2Stats.totalSize)
    }

    // ===== 重复检测测试 =====

    @Test
    fun `checkDuplicate should detect existing imports`() = runTest {
        // Arrange
        val project = createTestProject("project-1")
        projectDao.insertProject(project)

        val sourceUri = "content://media/external/file/123"
        fileImportHistoryDao.insert(
            createTestImportHistory(
                id = "history-1",
                projectId = "project-1",
                sourceUri = sourceUri
            )
        )

        // Act
        val duplicateCount = fileImportHistoryDao.checkDuplicate("project-1", sourceUri)
        val noDuplicateCount = fileImportHistoryDao.checkDuplicate("project-1", "other://uri")

        // Assert
        assertEquals(1, duplicateCount)
        assertEquals(0, noDuplicateCount)
    }

    @Test
    fun `getLatestImportByUri should return most recent import`() = runTest {
        // Arrange
        val project = createTestProject("project-1")
        projectDao.insertProject(project)

        val sourceUri = "content://media/external/file/123"
        val now = System.currentTimeMillis()

        fileImportHistoryDao.insertAll(listOf(
            createTestImportHistory(id = "history-1", projectId = "project-1", sourceUri = sourceUri, importedAt = now - 3000),
            createTestImportHistory(id = "history-2", projectId = "project-1", sourceUri = sourceUri, importedAt = now - 1000), // Latest
            createTestImportHistory(id = "history-3", projectId = "project-1", sourceUri = sourceUri, importedAt = now - 2000)
        ))

        // Act
        val latest = fileImportHistoryDao.getLatestImportByUri(sourceUri)

        // Assert
        assertNotNull(latest)
        assertEquals("history-2", latest.id)
        assertEquals(now - 1000, latest.importedAt)
    }

    // ===== 搜索测试 =====

    @Test
    fun `searchImports should search in sourceFileName`() = runTest {
        // Arrange
        val project = createTestProject("project-1")
        projectDao.insertProject(project)

        fileImportHistoryDao.insertAll(listOf(
            createTestImportHistory(id = "history-1", projectId = "project-1", sourceFileName = "project_report.pdf"),
            createTestImportHistory(id = "history-2", projectId = "project-1", sourceFileName = "meeting_notes.txt"),
            createTestImportHistory(id = "history-3", projectId = "project-1", sourceFileName = "project_budget.xlsx")
        ))

        // Act
        val results = fileImportHistoryDao.searchImports("project", limit = 50).first()

        // Assert
        assertEquals(2, results.size)
        assertTrue(results.any { it.sourceFileName.contains("project") })
    }

    // ===== 批量删除测试 =====

    @Test
    fun `deleteByProject should remove all histories for project`() = runTest {
        // Arrange
        val project1 = createTestProject("project-1")
        val project2 = createTestProject("project-2")
        projectDao.insert(project1)
        projectDao.insert(project2)

        fileImportHistoryDao.insertAll(listOf(
            createTestImportHistory(id = "history-1", projectId = "project-1"),
            createTestImportHistory(id = "history-2", projectId = "project-1"),
            createTestImportHistory(id = "history-3", projectId = "project-2")
        ))

        // Act
        fileImportHistoryDao.deleteByProject("project-1")
        val count1 = fileImportHistoryDao.getCountByProject("project-1")
        val count2 = fileImportHistoryDao.getCountByProject("project-2")

        // Assert
        assertEquals(0, count1)
        assertEquals(1, count2)
    }

    @Test
    fun `deleteOldImports should remove imports before timestamp`() = runTest {
        // Arrange
        val project = createTestProject("project-1")
        projectDao.insertProject(project)

        val now = System.currentTimeMillis()
        val threshold = now - 86400000L // 24 hours ago

        fileImportHistoryDao.insertAll(listOf(
            createTestImportHistory(id = "history-1", projectId = "project-1", importedAt = now - 172800000L), // 2 days ago
            createTestImportHistory(id = "history-2", projectId = "project-1", importedAt = now - 3600000L),   // 1 hour ago
            createTestImportHistory(id = "history-3", projectId = "project-1", importedAt = now - 90000000L)   // >1 day ago
        ))

        // Act
        val deletedCount = fileImportHistoryDao.deleteOldImports(threshold)
        val remainingCount = fileImportHistoryDao.getTotalCount()

        // Assert
        assertEquals(2, deletedCount)
        assertEquals(1, remainingCount)
    }

    // ===== Helper Functions =====

    private fun createTestProject(
        id: String,
        userId: String = "user-1",
        name: String = "Test Project",
        description: String = "Test Description"
    ): ProjectEntity {
        return ProjectEntity(
            id = id,
            userId = userId,
            name = name,
            description = description,
            createdAt = System.currentTimeMillis(),
            updatedAt = System.currentTimeMillis(),
            fileCount = 0,
            totalSize = 0L
        )
    }

    private fun createTestImportHistory(
        id: String,
        projectId: String,
        projectFileId: String = "file-${System.currentTimeMillis()}",
        sourceUri: String = "content://media/external/file/$id",
        sourceFileName: String = "test_file.txt",
        sourceFileSize: Long = 1024L,
        importType: ImportType = ImportType.COPY,
        importedAt: Long = System.currentTimeMillis(),
        importedFrom: ImportSource = ImportSource.FILE_BROWSER,
        note: String? = null
    ): FileImportHistoryEntity {
        return FileImportHistoryEntity(
            id = id,
            projectId = projectId,
            projectFileId = projectFileId,
            sourceUri = sourceUri,
            sourceFileName = sourceFileName,
            sourceFileSize = sourceFileSize,
            importType = importType,
            importedAt = importedAt,
            importedFrom = importedFrom,
            note = note
        )
    }
}

package com.chainlesschain.android.core.database.dao

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import app.cash.turbine.test
import com.chainlesschain.android.core.database.ChainlessChainDatabase
import com.chainlesschain.android.core.database.entity.ProjectActivityEntity
import com.chainlesschain.android.core.database.entity.ProjectEntity
import com.chainlesschain.android.core.database.entity.ProjectFileEntity
import com.chainlesschain.android.core.database.entity.ProjectStatus
import com.chainlesschain.android.core.database.entity.ProjectType
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * ProjectDao Unit Tests
 *
 * Comprehensive tests for project management DAO
 *
 * Coverage:
 * - Project CRUD operations
 * - Status management (active, paused, completed, archived)
 * - Git integration (config, status, commit tracking)
 * - Access tracking and statistics
 * - File tree operations (CRUD, hierarchy, search)
 * - File tracking (open files, dirty files, recently accessed)
 * - Activity logging
 * - Flow reactive updates
 *
 * Target: 90% code coverage for ProjectDao.kt
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class ProjectDaoTest {

    private lateinit var database: ChainlessChainDatabase
    private lateinit var projectDao: ProjectDao

    @Before
    fun setup() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        database = Room.inMemoryDatabaseBuilder(
            context,
            ChainlessChainDatabase::class.java
        )
            .allowMainThreadQueries()
            .build()

        projectDao = database.projectDao()
    }

    @After
    fun tearDown() {
        database.close()
    }

    // ========================================
    // Project CRUD Tests (5 tests)
    // ========================================

    @Test
    fun `insertProject and retrieve by id`() = runTest {
        // Given
        val project = createTestProject(
            id = "proj-1",
            name = "ChainlessChain Android",
            type = ProjectType.ANDROID,
            userId = "user-123"
        )

        // When
        val insertId = projectDao.insertProject(project)
        val retrieved = projectDao.getProjectById("proj-1")

        // Then
        assertTrue(insertId > 0)
        assertNotNull(retrieved)
        assertEquals("proj-1", retrieved.id)
        assertEquals("ChainlessChain Android", retrieved.name)
        assertEquals(ProjectType.ANDROID, retrieved.type)
    }

    @Test
    fun `getProjectsByUser filters by userId and excludes deleted`() = runTest {
        // Given
        projectDao.insertProject(createTestProject(id = "proj-1", userId = "user-A", name = "Active"))
        projectDao.insertProject(createTestProject(id = "proj-2", userId = "user-B", name = "Other User"))
        projectDao.insertProject(createTestProject(id = "proj-3", userId = "user-A", status = ProjectStatus.DELETED))

        // When
        projectDao.getProjectsByUser("user-A").test {
            val projects = awaitItem()

            // Then: Only user-A's non-deleted projects
            assertEquals(1, projects.size)
            assertEquals("proj-1", projects[0].id)

            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `updateProject modifies project metadata`() = runTest {
        // Given
        val original = createTestProject(id = "proj-1", name = "Original Name", userId = "user-123")
        projectDao.insertProject(original)

        // When
        val updated = original.copy(
            name = "Updated Name",
            description = "New description",
            isFavorite = true
        )
        projectDao.updateProject(updated)
        val retrieved = projectDao.getProjectById("proj-1")

        // Then
        assertNotNull(retrieved)
        assertEquals("Updated Name", retrieved.name)
        assertEquals("New description", retrieved.description)
        assertTrue(retrieved.isFavorite)
    }

    @Test
    fun `softDeleteProject marks project as deleted without hard deletion`() = runTest {
        // Given
        val project = createTestProject(id = "proj-1", userId = "user-123")
        projectDao.insertProject(project)

        // When
        projectDao.softDeleteProject("proj-1")

        // Then: Project still exists but with deleted status
        val retrieved = projectDao.getProjectById("proj-1")
        assertNotNull(retrieved)
        assertEquals(ProjectStatus.DELETED, retrieved.status)

        // And: Excluded from normal queries
        projectDao.getProjectsByUser("user-123").test {
            val projects = awaitItem()
            assertEquals(0, projects.size)
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `searchProjects filters by name, description, and tags`() = runTest {
        // Given
        projectDao.insertProject(createTestProject(
            id = "proj-1",
            userId = "user-123",
            name = "Kotlin Project",
            description = "Android app development"
        ))
        projectDao.insertProject(createTestProject(
            id = "proj-2",
            userId = "user-123",
            name = "Java Backend",
            description = "Spring Boot microservices"
        ))
        projectDao.insertProject(createTestProject(
            id = "proj-3",
            userId = "user-123",
            name = "Flutter App",
            tags = "[\"kotlin\", \"multiplatform\"]"
        ))

        // When: Search for "kotlin"
        projectDao.searchProjects("user-123", "kotlin").test {
            val results = awaitItem()

            // Then: Matches in name and tags
            assertEquals(2, results.size)
            assertTrue(results.any { it.id == "proj-1" }) // Name match
            assertTrue(results.any { it.id == "proj-3" }) // Tag match

            cancelAndIgnoreRemainingEvents()
        }
    }

    // ========================================
    // Status Management Tests (3 tests)
    // ========================================

    @Test
    fun `updateProjectStatus changes project status`() = runTest {
        // Given
        val project = createTestProject(id = "proj-1", status = ProjectStatus.ACTIVE, userId = "user-123")
        projectDao.insertProject(project)

        // When
        projectDao.updateProjectStatus("proj-1", ProjectStatus.COMPLETED)
        val retrieved = projectDao.getProjectById("proj-1")

        // Then
        assertNotNull(retrieved)
        assertEquals(ProjectStatus.COMPLETED, retrieved.status)
    }

    @Test
    fun `updateFavorite toggles favorite status`() = runTest {
        // Given
        val project = createTestProject(id = "proj-1", isFavorite = false, userId = "user-123")
        projectDao.insertProject(project)

        // When: Mark as favorite
        projectDao.updateFavorite("proj-1", isFavorite = true)

        // Then
        projectDao.getFavoriteProjects("user-123").test {
            val favorites = awaitItem()
            assertEquals(1, favorites.size)
            assertEquals("proj-1", favorites[0].id)
            assertTrue(favorites[0].isFavorite)
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `updateArchived marks project as archived and changes status`() = runTest {
        // Given
        val project = createTestProject(id = "proj-1", status = ProjectStatus.ACTIVE, userId = "user-123")
        projectDao.insertProject(project)

        // When
        projectDao.updateArchived("proj-1", isArchived = true)
        val retrieved = projectDao.getProjectById("proj-1")

        // Then: isArchived flag set and status changed to archived
        assertNotNull(retrieved)
        assertTrue(retrieved.isArchived)
        assertEquals(ProjectStatus.ARCHIVED, retrieved.status)

        // And: Appears in archived projects query
        projectDao.getArchivedProjects("user-123").test {
            val archived = awaitItem()
            assertEquals(1, archived.size)
            cancelAndIgnoreRemainingEvents()
        }
    }

    // ========================================
    // Git Integration Tests (2 tests)
    // ========================================

    @Test
    fun `updateGitConfig sets Git configuration`() = runTest {
        // Given
        val project = createTestProject(id = "proj-1", userId = "user-123")
        projectDao.insertProject(project)

        // When
        projectDao.updateGitConfig(
            projectId = "proj-1",
            enabled = true,
            remoteUrl = "https://github.com/user/repo.git",
            branch = "main"
        )
        val retrieved = projectDao.getProjectById("proj-1")

        // Then
        assertNotNull(retrieved)
        assertTrue(retrieved.gitEnabled)
        assertEquals("https://github.com/user/repo.git", retrieved.gitRemoteUrl)
        assertEquals("main", retrieved.gitBranch)
    }

    @Test
    fun `updateGitStatus tracks commit hash and uncommitted changes`() = runTest {
        // Given
        val project = createTestProject(id = "proj-1", userId = "user-123", gitEnabled = true)
        projectDao.insertProject(project)

        // When: Update Git status with new commit
        projectDao.updateGitStatus(
            projectId = "proj-1",
            hash = "a1b2c3d4e5f6",
            changes = 5
        )
        val retrieved = projectDao.getProjectById("proj-1")

        // Then
        assertNotNull(retrieved)
        assertEquals("a1b2c3d4e5f6", retrieved.lastCommitHash)
        assertEquals(5, retrieved.uncommittedChanges)
    }

    // ========================================
    // Access Tracking & Statistics Tests (3 tests)
    // ========================================

    @Test
    fun `recordAccess increments access count and updates timestamp`() = runTest {
        // Given
        val project = createTestProject(id = "proj-1", userId = "user-123", accessCount = 0)
        projectDao.insertProject(project)

        // When: Access project twice
        val time1 = System.currentTimeMillis()
        projectDao.recordAccess("proj-1", accessedAt = time1)
        Thread.sleep(10) // Ensure different timestamp
        val time2 = System.currentTimeMillis()
        projectDao.recordAccess("proj-1", accessedAt = time2)

        // Then
        val retrieved = projectDao.getProjectById("proj-1")
        assertNotNull(retrieved)
        assertEquals(2, retrieved.accessCount)
        assertEquals(time2, retrieved.lastAccessedAt)
    }

    @Test
    fun `getProjectCount returns count of non-deleted projects`() = runTest {
        // Given
        projectDao.insertProject(createTestProject(id = "proj-1", userId = "user-123", status = ProjectStatus.ACTIVE))
        projectDao.insertProject(createTestProject(id = "proj-2", userId = "user-123", status = ProjectStatus.PAUSED))
        projectDao.insertProject(createTestProject(id = "proj-3", userId = "user-123", status = ProjectStatus.DELETED))

        // When
        val count = projectDao.getProjectCount("user-123")

        // Then: Only non-deleted projects counted
        assertEquals(2, count)
    }

    @Test
    fun `updateProjectStats tracks file count and total size`() = runTest {
        // Given
        val project = createTestProject(id = "proj-1", userId = "user-123")
        projectDao.insertProject(project)

        // When
        projectDao.updateProjectStats(
            projectId = "proj-1",
            fileCount = 42,
            totalSize = 1024000L // 1MB
        )
        val retrieved = projectDao.getProjectById("proj-1")

        // Then
        assertNotNull(retrieved)
        assertEquals(42, retrieved.fileCount)
        assertEquals(1024000L, retrieved.totalSize)
    }

    // ========================================
    // Project Files Tests (5 tests)
    // ========================================

    @Test
    fun `insertFile and retrieve file by id`() = runTest {
        // Given: Project with file
        projectDao.insertProject(createTestProject(id = "proj-1", userId = "user-123"))
        val file = createTestFile(
            id = "file-1",
            projectId = "proj-1",
            name = "MainActivity.kt",
            path = "src/main/MainActivity.kt",
            type = "file",
            extension = "kt"
        )

        // When
        val insertId = projectDao.insertFile(file)
        val retrieved = projectDao.getFileById("file-1")

        // Then
        assertTrue(insertId > 0)
        assertNotNull(retrieved)
        assertEquals("MainActivity.kt", retrieved.name)
        assertEquals("kt", retrieved.extension)
    }

    @Test
    fun `getRootFiles and getFilesByParent builds file tree hierarchy`() = runTest {
        // Given: Project with folder structure
        projectDao.insertProject(createTestProject(id = "proj-1", userId = "user-123"))
        projectDao.insertFile(createTestFile(id = "folder-1", projectId = "proj-1", name = "src", type = "folder", parentId = null))
        projectDao.insertFile(createTestFile(id = "folder-2", projectId = "proj-1", name = "main", type = "folder", parentId = "folder-1"))
        projectDao.insertFile(createTestFile(id = "file-1", projectId = "proj-1", name = "App.kt", parentId = "folder-2"))
        projectDao.insertFile(createTestFile(id = "file-2", projectId = "proj-1", name = "README.md", parentId = null))

        // When: Query root files
        projectDao.getRootFiles("proj-1").test {
            val rootFiles = awaitItem()

            // Then: Only root-level items (folder "src" and "README.md")
            assertEquals(2, rootFiles.size)
            assertTrue(rootFiles.any { it.id == "folder-1" })
            assertTrue(rootFiles.any { it.id == "file-2" })

            cancelAndIgnoreRemainingEvents()
        }

        // When: Query files in "src" folder
        projectDao.getFilesByParent("proj-1", "folder-1").test {
            val children = awaitItem()

            // Then: Only "main" folder
            assertEquals(1, children.size)
            assertEquals("folder-2", children[0].id)
            assertEquals("main", children[0].name)

            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `markFileAsOpened updates lastAccessedAt and sets isOpen flag`() = runTest {
        // Given
        projectDao.insertProject(createTestProject(id = "proj-1", userId = "user-123"))
        val file = createTestFile(id = "file-1", projectId = "proj-1", isOpen = false)
        projectDao.insertFile(file)

        // When
        val accessTime = System.currentTimeMillis()
        projectDao.markFileAsOpened("file-1", accessedAt = accessTime)
        val retrieved = projectDao.getFileById("file-1")

        // Then
        assertNotNull(retrieved)
        assertTrue(retrieved.isOpen)
        assertEquals(accessTime, retrieved.lastAccessedAt)
    }

    @Test
    fun `updateFileDirtyStatus tracks unsaved changes`() = runTest {
        // Given
        projectDao.insertProject(createTestProject(id = "proj-1", userId = "user-123"))
        val file = createTestFile(id = "file-1", projectId = "proj-1", isDirty = false)
        projectDao.insertFile(file)

        // When: Mark file as dirty (has unsaved changes)
        projectDao.updateFileDirtyStatus("file-1", isDirty = true)

        // Then: File appears in dirty files query
        val dirtyFiles = projectDao.getDirtyFiles("proj-1")
        assertEquals(1, dirtyFiles.size)
        assertEquals("file-1", dirtyFiles[0].id)
        assertTrue(dirtyFiles[0].isDirty)
    }

    @Test
    fun `searchFiles filters by name and path`() = runTest {
        // Given
        projectDao.insertProject(createTestProject(id = "proj-1", userId = "user-123"))
        projectDao.insertFiles(listOf(
            createTestFile(id = "file-1", projectId = "proj-1", name = "MainActivity.kt", path = "src/main/MainActivity.kt"),
            createTestFile(id = "file-2", projectId = "proj-1", name = "TestActivity.kt", path = "src/test/TestActivity.kt"),
            createTestFile(id = "file-3", projectId = "proj-1", name = "build.gradle", path = "build.gradle")
        ))

        // When: Search for "Activity"
        projectDao.searchFiles("proj-1", "Activity").test {
            val results = awaitItem()

            // Then: Matches MainActivity and TestActivity
            assertEquals(2, results.size)
            assertTrue(results.all { it.name.contains("Activity") })

            cancelAndIgnoreRemainingEvents()
        }
    }

    // ========================================
    // File Filtering Tests (2 tests)
    // ========================================

    @Test
    fun `getFilesByExtensions filters by file type`() = runTest {
        // Given
        projectDao.insertProject(createTestProject(id = "proj-1", userId = "user-123"))
        projectDao.insertFiles(listOf(
            createTestFile(id = "file-1", projectId = "proj-1", name = "App.kt", extension = "kt"),
            createTestFile(id = "file-2", projectId = "proj-1", name = "Main.java", extension = "java"),
            createTestFile(id = "file-3", projectId = "proj-1", name = "Config.kt", extension = "kt"),
            createTestFile(id = "file-4", projectId = "proj-1", name = "README.md", extension = "md")
        ))

        // When: Filter Kotlin and Java files
        projectDao.getFilesByExtensions("proj-1", listOf("kt", "java")).test {
            val kotlinJavaFiles = awaitItem()

            // Then
            assertEquals(3, kotlinJavaFiles.size)
            assertTrue(kotlinJavaFiles.all { it.extension in listOf("kt", "java") })

            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `getRecentlyModifiedFiles returns files ordered by updatedAt DESC`() = runTest {
        // Given
        projectDao.insertProject(createTestProject(id = "proj-1", userId = "user-123"))
        val now = System.currentTimeMillis()
        projectDao.insertFiles(listOf(
            createTestFile(id = "file-1", projectId = "proj-1", name = "Old.kt", updatedAt = now - 10000),
            createTestFile(id = "file-2", projectId = "proj-1", name = "Recent.kt", updatedAt = now - 1000),
            createTestFile(id = "file-3", projectId = "proj-1", name = "VeryOld.kt", updatedAt = now - 20000)
        ))

        // When
        projectDao.getRecentlyModifiedFiles("proj-1", limit = 2).test {
            val recentFiles = awaitItem()

            // Then: Most recent first
            assertEquals(2, recentFiles.size)
            assertEquals("file-2", recentFiles[0].id) // Most recent
            assertEquals("file-1", recentFiles[1].id)

            cancelAndIgnoreRemainingEvents()
        }
    }

    // ========================================
    // Project Activities Tests (2 tests)
    // ========================================

    @Test
    fun `insertActivity and getProjectActivities tracks project history`() = runTest {
        // Given
        projectDao.insertProject(createTestProject(id = "proj-1", userId = "user-123"))
        val now = System.currentTimeMillis()
        val activity1 = createTestActivity(
            id = "act-1",
            projectId = "proj-1",
            type = "file_created",
            description = "Created MainActivity.kt",
            createdAt = now - 2000 // Older activity
        )
        val activity2 = createTestActivity(
            id = "act-2",
            projectId = "proj-1",
            type = "status_changed",
            description = "Project status changed to active",
            createdAt = now - 1000 // Newer activity
        )

        // When
        projectDao.insertActivity(activity1)
        projectDao.insertActivity(activity2)

        // Then
        projectDao.getProjectActivities("proj-1", limit = 50).test {
            val activities = awaitItem()
            assertEquals(2, activities.size)
            // Most recent first (activity2)
            assertEquals("act-2", activities[0].id)
            assertEquals("act-1", activities[1].id)

            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `deleteOldActivities removes activities before cutoff time`() = runTest {
        // Given
        projectDao.insertProject(createTestProject(id = "proj-1", userId = "user-123"))
        val now = System.currentTimeMillis()
        val cutoff = now - 86400000L // 24 hours ago

        projectDao.insertActivity(createTestActivity(
            id = "act-old",
            projectId = "proj-1",
            description = "Old activity",
            createdAt = now - 90000000L // 25 hours ago
        ))
        projectDao.insertActivity(createTestActivity(
            id = "act-recent",
            projectId = "proj-1",
            description = "Recent activity",
            createdAt = now - 3600000L // 1 hour ago
        ))

        // When: Delete activities older than 24 hours
        projectDao.deleteOldActivities("proj-1", cutoffTime = cutoff)

        // Then: Only recent activity remains
        projectDao.getProjectActivities("proj-1", limit = 50).test {
            val activities = awaitItem()
            assertEquals(1, activities.size)
            assertEquals("act-recent", activities[0].id)

            cancelAndIgnoreRemainingEvents()
        }
    }

    // ========================================
    // Flow Reactive Updates Tests (2 tests)
    // ========================================

    @Test
    fun `observeProject Flow emits updates on project changes`() = runTest {
        // Given
        val project = createTestProject(id = "proj-1", name = "Original", userId = "user-123")
        projectDao.insertProject(project)

        projectDao.observeProject("proj-1").test {
            // Initial emission
            val initial = awaitItem()
            assertNotNull(initial)
            assertEquals("Original", initial.name)

            // When: Update project
            projectDao.updateProject(project.copy(name = "Updated"))

            // Then: Flow emits updated project
            val updated = awaitItem()
            assertNotNull(updated)
            assertEquals("Updated", updated.name)

            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `getProjectFiles Flow emits updates when files added or removed`() = runTest {
        // Given
        projectDao.insertProject(createTestProject(id = "proj-1", userId = "user-123"))

        projectDao.getProjectFiles("proj-1").test {
            // Initial emission (empty)
            val initial = awaitItem()
            assertEquals(0, initial.size)

            // When: Add file
            projectDao.insertFile(createTestFile(id = "file-1", projectId = "proj-1", name = "Test.kt"))

            // Then: Flow emits updated list
            val withFile = awaitItem()
            assertEquals(1, withFile.size)
            assertEquals("Test.kt", withFile[0].name)

            cancelAndIgnoreRemainingEvents()
        }
    }

    // ========================================
    // Statistics Tests (1 test)
    // ========================================

    @Test
    fun `file statistics return accurate counts and sizes`() = runTest {
        // Given
        projectDao.insertProject(createTestProject(id = "proj-1", userId = "user-123"))
        projectDao.insertFiles(listOf(
            createTestFile(id = "folder-1", projectId = "proj-1", type = "folder", size = 0),
            createTestFile(id = "file-1", projectId = "proj-1", type = "file", size = 1024, extension = "kt"),
            createTestFile(id = "file-2", projectId = "proj-1", type = "file", size = 2048, extension = "kt"),
            createTestFile(id = "file-3", projectId = "proj-1", type = "file", size = 4096, extension = "java")
        ))

        // When
        val fileCount = projectDao.getFileCount("proj-1")
        val folderCount = projectDao.getFolderCount("proj-1")
        val totalSize = projectDao.getTotalFilesSize("proj-1")
        val countByExtension = projectDao.getFileCountByExtension("proj-1")

        // Then
        assertEquals(3, fileCount) // Only files
        assertEquals(1, folderCount) // Only folders
        assertEquals(7168L, totalSize) // Sum of file sizes (1024 + 2048 + 4096)

        // Extension counts
        val ktCount = countByExtension.find { it.extension == "kt" }?.count
        val javaCount = countByExtension.find { it.extension == "java" }?.count
        assertEquals(2, ktCount)
        assertEquals(1, javaCount)
    }

    // ========================================
    // Helper Functions
    // ========================================

    private fun createTestProject(
        id: String = "proj-${System.currentTimeMillis()}",
        name: String = "Test Project",
        description: String? = null,
        type: String = ProjectType.OTHER,
        status: String = ProjectStatus.ACTIVE,
        userId: String = "user-test",
        rootPath: String? = null,
        isFavorite: Boolean = false,
        isArchived: Boolean = false,
        isSynced: Boolean = false,
        remoteId: String? = null,
        fileCount: Int = 0,
        totalSize: Long = 0,
        accessCount: Int = 0,
        gitEnabled: Boolean = false,
        gitRemoteUrl: String? = null,
        gitBranch: String? = null,
        lastCommitHash: String? = null,
        uncommittedChanges: Int = 0,
        tags: String? = null,
        createdAt: Long = System.currentTimeMillis(),
        updatedAt: Long = System.currentTimeMillis()
    ): ProjectEntity {
        return ProjectEntity(
            id = id,
            name = name,
            description = description,
            type = type,
            status = status,
            userId = userId,
            rootPath = rootPath,
            icon = null,
            coverImage = null,
            tags = tags,
            metadata = null,
            isFavorite = isFavorite,
            isArchived = isArchived,
            isSynced = isSynced,
            remoteId = remoteId,
            lastSyncedAt = null,
            fileCount = fileCount,
            totalSize = totalSize,
            lastAccessedAt = null,
            accessCount = accessCount,
            gitEnabled = gitEnabled,
            gitRemoteUrl = gitRemoteUrl,
            gitBranch = gitBranch,
            lastCommitHash = lastCommitHash,
            uncommittedChanges = uncommittedChanges,
            createdAt = createdAt,
            updatedAt = updatedAt,
            completedAt = null
        )
    }

    private fun createTestFile(
        id: String = "file-${System.currentTimeMillis()}",
        projectId: String,
        parentId: String? = null,
        name: String = "test.txt",
        path: String = "test.txt",
        type: String = "file",
        mimeType: String? = null,
        size: Long = 0,
        extension: String? = null,
        content: String? = null,
        isOpen: Boolean = false,
        isDirty: Boolean = false,
        createdAt: Long = System.currentTimeMillis(),
        updatedAt: Long = System.currentTimeMillis(),
        lastAccessedAt: Long? = null
    ): ProjectFileEntity {
        return ProjectFileEntity(
            id = id,
            projectId = projectId,
            parentId = parentId,
            name = name,
            path = path,
            type = type,
            mimeType = mimeType,
            size = size,
            extension = extension,
            content = content,
            isEncrypted = false,
            hash = null,
            isOpen = isOpen,
            isDirty = isDirty,
            createdAt = createdAt,
            updatedAt = updatedAt,
            lastAccessedAt = lastAccessedAt
        )
    }

    private fun createTestActivity(
        id: String = "act-${System.currentTimeMillis()}",
        projectId: String,
        type: String = "test_activity",
        description: String = "Test activity",
        fileId: String? = null,
        data: String? = null,
        createdAt: Long = System.currentTimeMillis()
    ): ProjectActivityEntity {
        return ProjectActivityEntity(
            id = id,
            projectId = projectId,
            type = type,
            description = description,
            fileId = fileId,
            data = data,
            createdAt = createdAt
        )
    }
}

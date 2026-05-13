package com.chainlesschain.android.feature.project.sync

import com.chainlesschain.android.core.database.dao.ProjectDao
import com.chainlesschain.android.core.database.entity.ProjectEntity
import com.chainlesschain.android.core.database.entity.ProjectStatus
import com.chainlesschain.android.core.database.entity.ProjectType
import com.chainlesschain.android.core.p2p.sync.PullCursor
import com.chainlesschain.android.core.p2p.sync.ResourceType
import com.chainlesschain.android.core.p2p.sync.SyncOperation
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class ProjectSyncWalkerTest {

    private lateinit var projectDao: ProjectDao
    private lateinit var walker: ProjectSyncWalker
    private val json = Json { ignoreUnknownKeys = true }

    @Before
    fun setUp() {
        projectDao = mockk(relaxed = true)
        walker = ProjectSyncWalker(projectDao)
    }

    private fun project(
        id: String,
        userId: String = "u-1",
        name: String = "name-$id",
        status: String = ProjectStatus.ACTIVE,
        type: String = ProjectType.DOCUMENT,
        createdAt: Long = 100L,
        updatedAt: Long = 100L,
    ): ProjectEntity = ProjectEntity(
        id = id,
        userId = userId,
        name = name,
        type = type,
        status = status,
        createdAt = createdAt,
        updatedAt = updatedAt,
    )

    @Test
    fun `enumerate returns empty when no matching projects`() = runTest {
        coEvery { projectDao.getProjectsSinceCursor(any(), any(), any()) } returns emptyList()
        val items = walker.enumerate(PullCursor(0L, null), null, 50)
        assertTrue(items.isEmpty())
    }

    @Test
    fun `enumerate skips when resourceTypes filter excludes PROJECT`() = runTest {
        val items = walker.enumerate(
            PullCursor(0L, null),
            listOf(ResourceType.MESSAGE, ResourceType.FRIEND),
            50,
        )
        assertTrue(items.isEmpty())
        // DAO not even queried — short-circuit
        coVerify(exactly = 0) { projectDao.getProjectsSinceCursor(any(), any(), any()) }
    }

    @Test
    fun `enumerate runs when PROJECT in resourceTypes`() = runTest {
        coEvery { projectDao.getProjectsSinceCursor(any(), any(), any()) } returns listOf(
            project("p1"),
        )
        val items = walker.enumerate(
            PullCursor(0L, null),
            listOf(ResourceType.PROJECT, ResourceType.MESSAGE),
            50,
        )
        assertEquals(1, items.size)
    }

    @Test
    fun `enumerate runs when resourceTypes is null (all types)`() = runTest {
        coEvery { projectDao.getProjectsSinceCursor(any(), any(), any()) } returns listOf(
            project("p1"),
        )
        val items = walker.enumerate(PullCursor(0L, null), null, 50)
        assertEquals(1, items.size)
    }

    @Test
    fun `enumerate maps deleted status to DELETE operation`() = runTest {
        coEvery { projectDao.getProjectsSinceCursor(any(), any(), any()) } returns listOf(
            project("p1", status = ProjectStatus.DELETED, createdAt = 100L, updatedAt = 200L),
        )
        val items = walker.enumerate(PullCursor(0L, null), null, 50)
        assertEquals(SyncOperation.DELETE, items[0].operation)
    }

    @Test
    fun `enumerate maps updated_at greater than created_at to UPDATE`() = runTest {
        coEvery { projectDao.getProjectsSinceCursor(any(), any(), any()) } returns listOf(
            project("p1", createdAt = 100L, updatedAt = 200L),
        )
        val items = walker.enumerate(PullCursor(0L, null), null, 50)
        assertEquals(SyncOperation.UPDATE, items[0].operation)
    }

    @Test
    fun `enumerate maps created_at equals updated_at to CREATE`() = runTest {
        coEvery { projectDao.getProjectsSinceCursor(any(), any(), any()) } returns listOf(
            project("p1", createdAt = 100L, updatedAt = 100L),
        )
        val items = walker.enumerate(PullCursor(0L, null), null, 50)
        assertEquals(SyncOperation.CREATE, items[0].operation)
    }

    @Test
    fun `enumerate produces snake_case JSON aligned with desktop walker`() = runTest {
        coEvery { projectDao.getProjectsSinceCursor(any(), any(), any()) } returns listOf(
            project(
                id = "p1",
                userId = "u-1",
                name = "Test",
                type = ProjectType.DOCUMENT,
                status = ProjectStatus.ACTIVE,
                createdAt = 100L,
                updatedAt = 150L,
            ),
        )
        val items = walker.enumerate(PullCursor(0L, null), null, 50)
        val obj: JsonObject = json.parseToJsonElement(items[0].data).jsonObject
        assertEquals("p1", obj["id"]?.jsonPrimitive?.content)
        assertEquals("u-1", obj["user_id"]?.jsonPrimitive?.content)
        assertEquals("Test", obj["name"]?.jsonPrimitive?.content)
        assertEquals(ProjectType.DOCUMENT, obj["project_type"]?.jsonPrimitive?.content)
        assertEquals(ProjectStatus.ACTIVE, obj["status"]?.jsonPrimitive?.content)
        assertEquals(100L, obj["created_at"]?.jsonPrimitive?.longOrNull)
        assertEquals(150L, obj["updated_at"]?.jsonPrimitive?.longOrNull)
        // null/empty fields must NOT appear in JSON
        assertNull(obj["description"])
        assertNull(obj["root_path"])
    }

    @Test
    fun `enumerate forwards cursor params verbatim to DAO`() = runTest {
        coEvery { projectDao.getProjectsSinceCursor(any(), any(), any()) } returns emptyList()
        walker.enumerate(PullCursor(ts = 500L, id = "p42"), null, 25)
        coVerify { projectDao.getProjectsSinceCursor(500L, "p42", 25) }
    }

    @Test
    fun `enumerate substitutes empty string when cursor id is null`() = runTest {
        coEvery { projectDao.getProjectsSinceCursor(any(), any(), any()) } returns emptyList()
        walker.enumerate(PullCursor(ts = 0L, id = null), null, 50)
        coVerify { projectDao.getProjectsSinceCursor(0L, "", 50) }
    }

    @Test
    fun `enumerate clamps limit into 1-500 range`() = runTest {
        coEvery { projectDao.getProjectsSinceCursor(any(), any(), any()) } returns emptyList()
        walker.enumerate(PullCursor(0L, null), null, 9999)
        coVerify { projectDao.getProjectsSinceCursor(any(), any(), 500) }

        walker.enumerate(PullCursor(0L, null), null, 0)
        coVerify { projectDao.getProjectsSinceCursor(any(), any(), 1) }
    }

    @Test
    fun `enumerate returns empty on DAO exception (defensive fallback)`() = runTest {
        coEvery {
            projectDao.getProjectsSinceCursor(any(), any(), any())
        } throws RuntimeException("simulated DAO failure")
        val items = walker.enumerate(PullCursor(0L, null), null, 50)
        assertTrue(items.isEmpty())
    }
}

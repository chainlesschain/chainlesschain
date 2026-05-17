package com.chainlesschain.android.feature.project.sync

import com.chainlesschain.android.core.database.dao.ProjectDao
import com.chainlesschain.android.core.database.entity.ProjectEntity
import com.chainlesschain.android.core.database.entity.ProjectStatus
import com.chainlesschain.android.core.database.entity.ProjectType
import com.chainlesschain.android.feature.project.data.sync.ProjectSyncApplierImpl
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import io.mockk.slot
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * ProjectSyncApplierImpl 单测 — Android 项目管理 → 远程终端入口 Sub-phase 2。
 *
 * 详见 docs/design/Android_Project_Remote_Terminal_Entry.md §6.2。
 */
class ProjectSyncApplierImplTest {

    private lateinit var projectDao: ProjectDao
    private lateinit var applier: ProjectSyncApplierImpl
    private val json = Json { ignoreUnknownKeys = true }

    @Before
    fun setUp() {
        projectDao = mockk(relaxed = true)
        applier = ProjectSyncApplierImpl(projectDao)
    }

    private fun jsonPayload(
        id: String,
        name: String = "test",
        sourcePeerId: String? = null,
        pcRootPath: String? = null,
        rootPath: String? = null,
        status: String = "active",
    ): String {
        val parts = mutableListOf(
            "\"id\":\"$id\"",
            "\"name\":\"$name\"",
            "\"project_type\":\"document\"",
            "\"status\":\"$status\"",
            "\"user_id\":\"u-1\"",
            "\"created_at\":1000",
            "\"updated_at\":2000",
        )
        sourcePeerId?.let { parts.add("\"source_peer_id\":\"$it\"") }
        pcRootPath?.let { parts.add("\"pc_root_path\":\"$it\"") }
        rootPath?.let { parts.add("\"root_path\":\"$it\"") }
        return "{${parts.joinToString(",")}}"
    }

    // ===== source_peer_id + pc_root_path 解析 =====

    @Test
    fun `saveFromSync writes sourcePeerId and pcRootPath when present`() = runTest {
        coEvery { projectDao.getProjectById("p-1") } returns null
        val entitySlot = slot<ProjectEntity>()
        coEvery { projectDao.insertProject(capture(entitySlot)) } returns 1L

        applier.saveFromSync(
            "p-1",
            jsonPayload("p-1", sourcePeerId = "PC-DEVICE-123", pcRootPath = "/home/x/proj"),
        )

        assertEquals("PC-DEVICE-123", entitySlot.captured.sourcePeerId)
        assertEquals("/home/x/proj", entitySlot.captured.pcRootPath)
    }

    @Test
    fun `saveFromSync leaves new fields null for LOCAL-style payload`() = runTest {
        coEvery { projectDao.getProjectById("p-2") } returns null
        val entitySlot = slot<ProjectEntity>()
        coEvery { projectDao.insertProject(capture(entitySlot)) } returns 1L

        applier.saveFromSync("p-2", jsonPayload("p-2"))

        assertNull(entitySlot.captured.sourcePeerId)
        assertNull(entitySlot.captured.pcRootPath)
    }

    @Test
    fun `updateFromSync without new fields preserves existing sourcePeerId and pcRootPath`() = runTest {
        // 桌面端不发新字段时，本地 FROM_PC 项目的 sourcePeerId/pcRootPath 不应被清空
        val existing = ProjectEntity(
            id = "p-3",
            name = "old",
            userId = "u-1",
            sourcePeerId = "PC-OLD",
            pcRootPath = "/old/path",
        )
        coEvery { projectDao.getProjectById("p-3") } returns existing
        val entitySlot = slot<ProjectEntity>()
        coEvery { projectDao.insertProject(capture(entitySlot)) } returns 1L

        applier.updateFromSync("p-3", jsonPayload("p-3", name = "updated"))

        assertEquals("PC-OLD", entitySlot.captured.sourcePeerId)
        assertEquals("/old/path", entitySlot.captured.pcRootPath)
        assertEquals("updated", entitySlot.captured.name)
    }

    @Test
    fun `pcRootPath does NOT fallback to root_path field (Android keeps SAF URI vs PC path distinct)`() = runTest {
        // Android 端 rootPath 是 SAF URI；pcRootPath 是 PC 路径。两者语义不同，不能互相兜底。
        coEvery { projectDao.getProjectById("p-4") } returns null
        val entitySlot = slot<ProjectEntity>()
        coEvery { projectDao.insertProject(capture(entitySlot)) } returns 1L

        applier.saveFromSync(
            "p-4",
            jsonPayload("p-4", rootPath = "/some/pc/path"),
        )

        // rootPath 字段写入 entity.rootPath，但 entity.pcRootPath 应保持 null（没显式 pc_root_path）
        assertEquals("/some/pc/path", entitySlot.captured.rootPath)
        assertNull(entitySlot.captured.pcRootPath)
    }

    // ===== DELETED orphan 处理 =====

    @Test
    fun `deleteFromSync soft-deletes when LOCAL project (no sourcePeerId)`() = runTest {
        val local = ProjectEntity(
            id = "p-5",
            name = "local",
            userId = "u-1",
            sourcePeerId = null,
            pcRootPath = null,
        )
        coEvery { projectDao.getProjectById("p-5") } returns local

        applier.deleteFromSync("p-5")

        coVerify(exactly = 1) { projectDao.softDeleteProject("p-5") }
        coVerify(exactly = 0) { projectDao.insertProject(any()) }
    }

    @Test
    fun `deleteFromSync orphan-tags FROM_PC project instead of soft-deleting`() = runTest {
        val fromPc = ProjectEntity(
            id = "p-6",
            name = "from-pc",
            userId = "u-1",
            sourcePeerId = "PC-DEVICE-XYZ",
            pcRootPath = "/home/x/proj",
            metadata = null,
        )
        coEvery { projectDao.getProjectById("p-6") } returns fromPc
        val entitySlot = slot<ProjectEntity>()
        coEvery { projectDao.insertProject(capture(entitySlot)) } returns 1L

        applier.deleteFromSync("p-6")

        coVerify(exactly = 0) { projectDao.softDeleteProject("p-6") }
        coVerify(exactly = 1) { projectDao.insertProject(any()) }

        // metadata 应含 orphan=true
        val md = entitySlot.captured.metadata
        assertNotNull(md)
        val parsed = json.parseToJsonElement(md!!).jsonObject
        assertEquals(true, parsed["orphan"]?.jsonPrimitive?.boolean)
        assertNotNull(parsed["orphanedAt"])

        // pcRootPath / sourcePeerId 保留作 audit
        assertEquals("PC-DEVICE-XYZ", entitySlot.captured.sourcePeerId)
        assertEquals("/home/x/proj", entitySlot.captured.pcRootPath)
    }

    @Test
    fun `mergeOrphanIntoMetadata preserves existing metadata keys`() {
        val existing = """{"customKey":"customValue","priority":5}"""
        val merged = applier.mergeOrphanIntoMetadata(existing)
        val parsed = json.parseToJsonElement(merged).jsonObject
        assertEquals("customValue", parsed["customKey"]?.jsonPrimitive?.content)
        assertEquals("5", parsed["priority"]?.jsonPrimitive?.content)
        assertEquals(true, parsed["orphan"]?.jsonPrimitive?.boolean)
    }

    @Test
    fun `mergeOrphanIntoMetadata handles null existing metadata`() {
        val merged = applier.mergeOrphanIntoMetadata(null)
        val parsed = json.parseToJsonElement(merged).jsonObject
        assertEquals(true, parsed["orphan"]?.jsonPrimitive?.boolean)
        assertNotNull(parsed["orphanedAt"])
    }

    @Test
    fun `mergeOrphanIntoMetadata handles bad JSON gracefully`() {
        val merged = applier.mergeOrphanIntoMetadata("not-json{}}")
        val parsed = json.parseToJsonElement(merged).jsonObject
        // 不应抛异常，且新生成的 JSON 含 orphan
        assertEquals(true, parsed["orphan"]?.jsonPrimitive?.boolean)
    }
}

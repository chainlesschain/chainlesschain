package com.chainlesschain.android.feature.knowledge

import com.chainlesschain.android.core.database.dao.KnowledgeItemDao
import com.chainlesschain.android.core.database.entity.KnowledgeItemEntity
import com.chainlesschain.android.feature.knowledge.data.sync.KnowledgeSyncApplierImpl
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import io.mockk.slot
import kotlinx.coroutines.test.runTest
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * KnowledgeSyncApplierImpl 单元测试 — v1.1 W1 (2026-05-12)。
 *
 * 验证字段级 merge 保留本地独有列 + type normalize + soft delete 行为。
 */
class KnowledgeSyncApplierImplTest {

    private val dao = mockk<KnowledgeItemDao>(relaxed = true)
    private lateinit var applier: KnowledgeSyncApplierImpl

    private fun makeEntity(
        id: String = "k1",
        title: String = "Local",
        content: String = "local content",
        type: String = "note",
        folderId: String? = "folder-a",
        tags: String? = """["star"]""",
        isFavorite: Boolean = true,
        isPinned: Boolean = true,
        isDeleted: Boolean = false,
        createdAt: Long = 100,
        updatedAt: Long = 200,
        deviceId: String = "android-local",
        syncStatus: String = "pending",
    ) = KnowledgeItemEntity(
        id = id,
        title = title,
        content = content,
        type = type,
        folderId = folderId,
        tags = tags,
        isFavorite = isFavorite,
        isPinned = isPinned,
        isDeleted = isDeleted,
        createdAt = createdAt,
        updatedAt = updatedAt,
        deviceId = deviceId,
        syncStatus = syncStatus,
    )

    @Before
    fun setup() {
        applier = KnowledgeSyncApplierImpl(dao)
    }

    // ============================================================
    // saveFromSync
    // ============================================================
    @Test
    fun `saveFromSync inserts new entity when local doesn't exist`() = runTest {
        coEvery { dao.getItemByIdSync("k-new") } returns null
        val captured = slot<KnowledgeItemEntity>()
        coEvery { dao.insert(capture(captured)) } returns 1L

        applier.saveFromSync(
            "k-new",
            """{"id":"k-new","title":"Desktop Title","type":"note","content":"hello","createdAt":100,"updatedAt":200,"deviceId":"desktop-1"}""",
        )

        coVerify(exactly = 1) { dao.insert(any()) }
        val entity = captured.captured
        assertEquals("k-new", entity.id)
        assertEquals("Desktop Title", entity.title)
        assertEquals("note", entity.type)
        assertEquals("hello", entity.content)
        assertEquals(100L, entity.createdAt)
        assertEquals(200L, entity.updatedAt)
        assertEquals("desktop-1", entity.deviceId)
        assertEquals("synced", entity.syncStatus)
        // 本地独有字段走默认值
        assertEquals(null, entity.folderId)
        assertEquals(null, entity.tags)
        assertFalse(entity.isFavorite)
        assertFalse(entity.isPinned)
        assertFalse(entity.isDeleted)
    }

    @Test
    fun `saveFromSync swallows bad JSON without throwing`() = runTest {
        coEvery { dao.getItemByIdSync(any()) } returns null

        applier.saveFromSync("k-bad", "{not valid json")

        coVerify(exactly = 0) { dao.insert(any()) }
    }

    // ============================================================
    // updateFromSync — 字段级 merge
    // ============================================================
    @Test
    fun `updateFromSync preserves local-only fields (folderId, tags, isFavorite, isPinned)`() = runTest {
        coEvery { dao.getItemByIdSync("k1") } returns makeEntity()
        val captured = slot<KnowledgeItemEntity>()
        coEvery { dao.insert(capture(captured)) } returns 1L

        applier.updateFromSync(
            "k1",
            """{"id":"k1","title":"Updated","type":"note","content":"new body","createdAt":100,"updatedAt":500,"deviceId":"desktop-1"}""",
        )

        val entity = captured.captured
        // 对端字段覆写
        assertEquals("Updated", entity.title)
        assertEquals("new body", entity.content)
        assertEquals(500L, entity.updatedAt)
        // 本地独有字段保留
        assertEquals("folder-a", entity.folderId)
        assertEquals("""["star"]""", entity.tags)
        assertTrue(entity.isFavorite)
        assertTrue(entity.isPinned)
        // syncStatus 永远写 synced
        assertEquals("synced", entity.syncStatus)
    }

    @Test
    fun `updateFromSync falls back to existing values when JSON missing fields`() = runTest {
        val existing = makeEntity(title = "OLD", content = "OLD CONTENT")
        coEvery { dao.getItemByIdSync("k1") } returns existing
        val captured = slot<KnowledgeItemEntity>()
        coEvery { dao.insert(capture(captured)) } returns 1L

        // JSON 只有 id 和 updatedAt
        applier.updateFromSync("k1", """{"id":"k1","updatedAt":999}""")

        val entity = captured.captured
        assertEquals("OLD", entity.title)
        assertEquals("OLD CONTENT", entity.content)
        assertEquals(999L, entity.updatedAt)
    }

    // ============================================================
    // type normalize
    // ============================================================
    @Test
    fun `type normalize accepts all 4 KnowledgeType values`() = runTest {
        coEvery { dao.getItemByIdSync(any()) } returns null
        val captured = mutableListOf<KnowledgeItemEntity>()
        coEvery { dao.insert(capture(captured)) } returns 1L

        listOf("note", "document", "conversation", "web_clip").forEachIndexed { i, t ->
            applier.saveFromSync(
                "k-$i",
                """{"id":"k-$i","title":"t","type":"$t","content":"","deviceId":"d","createdAt":1,"updatedAt":1}""",
            )
        }

        assertEquals(listOf("note", "document", "conversation", "web_clip"), captured.map { it.type })
    }

    @Test
    fun `type normalize falls back to note for unknown values`() = runTest {
        coEvery { dao.getItemByIdSync("k-bad-type") } returns null
        val captured = slot<KnowledgeItemEntity>()
        coEvery { dao.insert(capture(captured)) } returns 1L

        applier.saveFromSync(
            "k-bad-type",
            """{"id":"k-bad-type","title":"t","type":"GARBAGE","content":"","deviceId":"d","createdAt":1,"updatedAt":1}""",
        )

        assertEquals("note", captured.captured.type)
    }

    @Test
    fun `type normalize is case-insensitive`() = runTest {
        coEvery { dao.getItemByIdSync("k-upper") } returns null
        val captured = slot<KnowledgeItemEntity>()
        coEvery { dao.insert(capture(captured)) } returns 1L

        applier.saveFromSync(
            "k-upper",
            """{"id":"k-upper","title":"t","type":"NOTE","content":"","deviceId":"d","createdAt":1,"updatedAt":1}""",
        )

        assertEquals("note", captured.captured.type)
    }

    // ============================================================
    // deleteFromSync — soft delete
    // ============================================================
    @Test
    fun `deleteFromSync calls softDelete not hardDelete`() = runTest {
        applier.deleteFromSync("k-del")

        coVerify(exactly = 1) { dao.softDelete("k-del", any()) }
        coVerify(exactly = 0) { dao.hardDelete(any()) }
    }

    @Test
    fun `deleteFromSync swallows dao error without throwing`() = runTest {
        coEvery { dao.softDelete(any(), any()) } throws RuntimeException("db locked")

        applier.deleteFromSync("k-err") // 不应抛
    }

    // ============================================================
    // deviceId 兜底
    // ============================================================
    @Test
    fun `saveFromSync falls back to empty deviceId when JSON omits it`() = runTest {
        coEvery { dao.getItemByIdSync("k-no-dev") } returns null
        val captured = slot<KnowledgeItemEntity>()
        coEvery { dao.insert(capture(captured)) } returns 1L

        applier.saveFromSync(
            "k-no-dev",
            """{"id":"k-no-dev","title":"t","type":"note","content":"","createdAt":1,"updatedAt":1}""",
        )

        assertEquals("", captured.captured.deviceId)
    }
}

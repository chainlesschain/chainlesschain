package com.chainlesschain.android.feature.knowledge

import androidx.paging.PagingSource
import com.chainlesschain.android.core.database.dao.KnowledgeItemDao
import com.chainlesschain.android.core.database.entity.KnowledgeItemEntity
import com.chainlesschain.android.feature.knowledge.data.repository.KnowledgeRepository
import com.chainlesschain.android.feature.knowledge.domain.model.KnowledgeType
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import io.mockk.slot
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * KnowledgeRepository单元测试
 */
class KnowledgeRepositoryTest {

    private lateinit var repository: KnowledgeRepository
    private val dao = mockk<KnowledgeItemDao>(relaxed = true)

    private val testEntity = KnowledgeItemEntity(
        id = "test-id",
        title = "测试标题",
        content = "测试内容",
        type = "note",
        deviceId = "test-device",
        createdAt = System.currentTimeMillis(),
        updatedAt = System.currentTimeMillis()
    )

    @Before
    fun setup() {
        repository = KnowledgeRepository(dao)
    }

    @Test
    fun `createItem should insert entity to dao`() = runTest {
        // Given
        val title = "新笔记"
        val content = "内容"
        val deviceId = "device-123"
        coEvery { dao.insert(any()) } returns 1L

        // When
        val result = repository.createItem(
            title = title,
            content = content,
            type = KnowledgeType.NOTE,
            deviceId = deviceId
        )

        // Then
        assertTrue(result.isSuccess)
        val item = result.getOrNull()
        assertNotNull(item)
        assertEquals(title, item.title)
        assertEquals(content, item.content)
        assertEquals(KnowledgeType.NOTE, item.type)
        coVerify { dao.insert(any()) }
    }

    @Test
    fun `updateItem should update entity in dao`() = runTest {
        // Given
        val id = "test-id"
        val title = "更新标题"
        val content = "更新内容"
        coEvery { dao.getItemById(id) } returns flowOf(testEntity)
        coEvery { dao.update(any()) } returns Unit

        // When
        val result = repository.updateItem(id, title, content)

        // Then
        assertTrue(result.isSuccess)
        coVerify { dao.update(any()) }
    }

    @Test
    fun `deleteItem should call softDelete`() = runTest {
        // Given
        val id = "test-id"
        coEvery { dao.softDelete(id, any()) } returns Unit

        // When
        val result = repository.deleteItem(id)

        // Then
        assertTrue(result.isSuccess)
        coVerify { dao.softDelete(id, any()) }
    }

    @Test
    fun `toggleFavorite should update favorite status`() = runTest {
        // Given
        val id = "test-id"
        val entity = testEntity.copy(isFavorite = false)
        val slot = slot<KnowledgeItemEntity>()
        coEvery { dao.getItemByIdSync(id) } returns entity
        coEvery { dao.update(any()) } returns Unit

        // When
        val result = repository.toggleFavorite(id)

        // Then
        assertTrue(result.isSuccess)
        coVerify { dao.update(capture(slot)) }
        assertTrue(slot.captured.isFavorite)
    }

    @Test
    fun `togglePinned should update pinned status`() = runTest {
        // Given
        val id = "test-id"
        val entity = testEntity.copy(isPinned = false)
        val slot = slot<KnowledgeItemEntity>()
        coEvery { dao.getItemByIdSync(id) } returns entity
        coEvery { dao.update(any()) } returns Unit

        // When
        val result = repository.togglePinned(id)

        // Then
        assertTrue(result.isSuccess)
        coVerify { dao.update(capture(slot)) }
        assertTrue(slot.captured.isPinned)
    }

    @Test
    fun `getItemById should return flow of domain model`() = runTest {
        // Given
        coEvery { dao.getItemById("test-id") } returns flowOf(testEntity)

        // When
        repository.getItemById("test-id").collect { item ->
            // Then
            assertNotNull(item)
            assertEquals("test-id", item.id)
            assertEquals("测试标题", item.title)
        }
    }
}

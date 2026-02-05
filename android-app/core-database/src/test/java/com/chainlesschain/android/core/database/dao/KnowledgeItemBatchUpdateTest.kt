package com.chainlesschain.android.core.database.dao

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.chainlesschain.android.core.database.ChainlessChainDatabase
import com.chainlesschain.android.core.database.entity.KnowledgeItemEntity
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
 * 知识库批量更新测试
 *
 * 验证多条记录可以正确更新，解决"仅第一条记录能更新"的问题
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class KnowledgeItemBatchUpdateTest {

    private lateinit var database: ChainlessChainDatabase
    private lateinit var knowledgeItemDao: KnowledgeItemDao

    @Before
    fun setup() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        database = Room.inMemoryDatabaseBuilder(
            context,
            ChainlessChainDatabase::class.java
        )
            .allowMainThreadQueries()
            .build()

        knowledgeItemDao = database.knowledgeItemDao()
    }

    @After
    fun tearDown() {
        database.close()
    }

    /**
     * 创建测试条目
     */
    private fun createTestItem(
        id: String,
        title: String = "Test Item",
        content: String = "Test content",
        type: String = "note"
    ): KnowledgeItemEntity {
        return KnowledgeItemEntity(
            id = id,
            title = title,
            content = content,
            type = type,
            folderId = null,
            createdAt = System.currentTimeMillis(),
            updatedAt = System.currentTimeMillis(),
            syncStatus = "synced",
            deviceId = "test-device",
            isDeleted = false,
            tags = null,
            isFavorite = false,
            isPinned = false
        )
    }

    @Test
    fun `单条记录更新成功`() = runTest {
        // Given - 插入一条记录
        val original = createTestItem(id = "item-1", title = "Original")
        knowledgeItemDao.insert(original)

        // When - 更新标题
        val updated = original.copy(title = "Updated")
        knowledgeItemDao.update(updated)

        // Then - 验证更新成功
        val result = knowledgeItemDao.getItemByIdSync("item-1")
        assertNotNull(result, "更新后记录应存在")
        assertEquals("Updated", result.title, "标题应已更新")
    }

    @Test
    fun `多条记录逐个更新成功`() = runTest {
        // Given - 插入3条记录
        val items = listOf(
            createTestItem(id = "item-1", title = "Item 1"),
            createTestItem(id = "item-2", title = "Item 2"),
            createTestItem(id = "item-3", title = "Item 3")
        )
        knowledgeItemDao.insertAll(items)

        // When - 逐个更新标题
        knowledgeItemDao.update(items[0].copy(title = "Updated 1"))
        knowledgeItemDao.update(items[1].copy(title = "Updated 2"))
        knowledgeItemDao.update(items[2].copy(title = "Updated 3"))

        // Then - 验证所有记录都已更新
        val result1 = knowledgeItemDao.getItemByIdSync("item-1")
        val result2 = knowledgeItemDao.getItemByIdSync("item-2")
        val result3 = knowledgeItemDao.getItemByIdSync("item-3")

        assertNotNull(result1)
        assertNotNull(result2)
        assertNotNull(result3)

        assertEquals("Updated 1", result1.title, "第1条记录应已更新")
        assertEquals("Updated 2", result2.title, "第2条记录应已更新")
        assertEquals("Updated 3", result3.title, "第3条记录应已更新")
    }

    @Test
    fun `批量更新多条记录成功`() = runTest {
        // Given - 插入5条记录
        val items = (1..5).map { index ->
            createTestItem(
                id = "item-$index",
                title = "Original $index",
                content = "Original content $index"
            )
        }
        knowledgeItemDao.insertAll(items)

        // When - 批量更新
        val updatedItems = items.mapIndexed { index, item ->
            item.copy(
                title = "Batch Updated ${index + 1}",
                content = "New content ${index + 1}",
                isFavorite = true
            )
        }
        val updateCount = knowledgeItemDao.updateAll(updatedItems)

        // Then - 验证所有记录都已更新
        assertEquals(5, updateCount, "应更新5条记录")

        val results = knowledgeItemDao.getItemsList(limit = 10, offset = 0)
        assertEquals(5, results.size, "应返回5条记录")

        results.forEachIndexed { index, result ->
            assertTrue(result.title.startsWith("Batch Updated"), "第${index + 1}条记录标题应已更新")
            assertTrue(result.content.startsWith("New content"), "第${index + 1}条记录内容应已更新")
            assertTrue(result.isFavorite, "第${index + 1}条记录应已收藏")
        }
    }

    @Test
    fun `更新不存在的记录不会抛出异常`() = runTest {
        // Given - 创建一个不存在于数据库的条目
        val nonExistent = createTestItem(id = "nonexistent", title = "Ghost")

        // When - 尝试更新
        // Room 的 @Update 对于不存在的记录会静默失败，不抛异常
        try {
            knowledgeItemDao.update(nonExistent)
            // 验证没有抛出异常
            assertTrue(true, "更新不存在的记录不应抛出异常")
        } catch (e: Exception) {
            throw AssertionError("不应抛出异常: ${e.message}")
        }

        // Then - 验证记录仍不存在
        val result = knowledgeItemDao.getItemByIdSync("nonexistent")
        assertEquals(null, result, "不存在的记录不应被创建")
    }

    @Test
    fun `更新后updatedAt时间戳应改变`() = runTest {
        // Given
        val originalTime = System.currentTimeMillis()
        val original = createTestItem(
            id = "item-1",
            title = "Original"
        ).copy(updatedAt = originalTime)
        knowledgeItemDao.insert(original)

        // Wait to ensure time difference
        Thread.sleep(10)

        // When
        val newTime = System.currentTimeMillis()
        val updated = original.copy(
            title = "Updated",
            updatedAt = newTime
        )
        knowledgeItemDao.update(updated)

        // Then
        val result = knowledgeItemDao.getItemByIdSync("item-1")
        assertNotNull(result)
        assertTrue(
            result.updatedAt > originalTime,
            "更新后的时间戳应大于原始时间戳 (original: $originalTime, updated: ${result.updatedAt})"
        )
    }

    @Test
    fun `更新不会影响其他字段`() = runTest {
        // Given
        val original = createTestItem(
            id = "item-1",
            title = "Original",
            content = "Original content"
        ).copy(
            isFavorite = true,
            isPinned = true,
            syncStatus = "synced"
        )
        knowledgeItemDao.insert(original)

        // When - 只更新标题
        val updated = original.copy(title = "Updated Title Only")
        knowledgeItemDao.update(updated)

        // Then - 验证其他字段未改变
        val result = knowledgeItemDao.getItemByIdSync("item-1")
        assertNotNull(result)
        assertEquals("Updated Title Only", result.title, "标题应已更新")
        assertEquals("Original content", result.content, "内容应保持不变")
        assertEquals(true, result.isFavorite, "收藏状态应保持不变")
        assertEquals(true, result.isPinned, "置顶状态应保持不变")
        assertEquals("synced", result.syncStatus, "同步状态应保持不变")
    }

    @Test
    fun `大批量更新100条记录`() = runTest {
        // Given - 插入100条记录
        val items = (1..100).map { index ->
            createTestItem(
                id = "item-$index",
                title = "Item $index"
            )
        }
        knowledgeItemDao.insertAll(items)

        // When - 批量更新所有记录
        val updatedItems = items.map { item ->
            item.copy(
                title = "Bulk Updated ${item.id}",
                isFavorite = true
            )
        }
        val updateCount = knowledgeItemDao.updateAll(updatedItems)

        // Then
        assertEquals(100, updateCount, "应更新100条记录")

        // 抽样检查前10条和后10条
        val first10 = knowledgeItemDao.getItemsList(limit = 10, offset = 0)
        val last10 = knowledgeItemDao.getItemsList(limit = 10, offset = 90)

        first10.forEach { item ->
            assertTrue(item.title.startsWith("Bulk Updated"), "前10条记录应已更新")
            assertTrue(item.isFavorite, "前10条记录应已收藏")
        }

        last10.forEach { item ->
            assertTrue(item.title.startsWith("Bulk Updated"), "后10条记录应已更新")
            assertTrue(item.isFavorite, "后10条记录应已收藏")
        }
    }
}

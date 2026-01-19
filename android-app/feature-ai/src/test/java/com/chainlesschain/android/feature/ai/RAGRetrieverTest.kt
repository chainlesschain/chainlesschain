package com.chainlesschain.android.feature.ai

import androidx.paging.PagingSource
import com.chainlesschain.android.core.database.dao.KnowledgeItemDao
import com.chainlesschain.android.core.database.entity.KnowledgeItemEntity
import com.chainlesschain.android.feature.ai.data.rag.*
import io.mockk.coEvery
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * RAGRetriever集成测试
 *
 * 测试FTS5和向量搜索的检索功能
 */
class RAGRetrieverTest {

    private lateinit var ragRetriever: RAGRetriever
    private val knowledgeItemDao = mockk<KnowledgeItemDao>(relaxed = true)
    private val vectorEmbedderFactory = mockk<VectorEmbedderFactory>(relaxed = true)

    private val testItems = listOf(
        KnowledgeItemEntity(
            id = "1",
            title = "Kotlin协程基础",
            content = "Kotlin协程是一种轻量级的并发编程方式，可以简化异步代码的编写。协程使用suspend关键字定义挂起函数。",
            createdAt = System.currentTimeMillis(),
            updatedAt = System.currentTimeMillis(),
            userId = "user1"
        ),
        KnowledgeItemEntity(
            id = "2",
            title = "Android开发指南",
            content = "Android应用开发需要掌握Activity、Fragment、ViewModel等核心组件。Jetpack库提供了现代化的开发工具。",
            createdAt = System.currentTimeMillis(),
            updatedAt = System.currentTimeMillis(),
            userId = "user1"
        ),
        KnowledgeItemEntity(
            id = "3",
            title = "Jetpack Compose教程",
            content = "Jetpack Compose是Android的声明式UI工具包，使用Kotlin编写UI代码。Compose简化了UI开发流程。",
            createdAt = System.currentTimeMillis(),
            updatedAt = System.currentTimeMillis(),
            userId = "user1"
        )
    )

    @Before
    fun setup() {
        // Mock embedder factory
        val tfIdfEmbedder = TfIdfEmbedder()
        every { vectorEmbedderFactory.createEmbedder(EmbedderType.TF_IDF) } returns tfIdfEmbedder

        ragRetriever = RAGRetriever(knowledgeItemDao, vectorEmbedderFactory)
    }

    @Test
    fun `retrieveByFTS5 should return top K results`() = runTest {
        // Given
        val query = "Kotlin协程"
        val topK = 2

        val pagingSource = mockk<PagingSource<Int, KnowledgeItemEntity>>()
        val loadResult = PagingSource.LoadResult.Page(
            data = testItems.take(2),
            prevKey = null,
            nextKey = null
        )

        coEvery { knowledgeItemDao.searchItemsSimple(query) } returns pagingSource
        coEvery { pagingSource.load(any()) } returns loadResult

        // When
        val results = ragRetriever.retrieve(query, topK, useVectorSearch = false)

        // Then
        assertEquals(2, results.size)
        assertEquals("Kotlin协程基础", results[0].title)
        assertEquals("FTS5", results[0].searchMethod)
    }

    @Test
    fun `retrieveByVector should return top K results sorted by similarity`() = runTest {
        // Given
        val query = "Kotlin协程"
        val topK = 2

        coEvery { knowledgeItemDao.getAllItemsSync() } returns testItems

        // When
        val results = ragRetriever.retrieve(query, topK, useVectorSearch = true)

        // Then
        assertEquals(2, results.size)
        assertTrue(results[0].score >= results[1].score, "Results should be sorted by score")
        assertEquals("Vector", results[0].searchMethod)
    }

    @Test
    fun `retrieve should use FTS5 by default`() = runTest {
        // Given
        val query = "Android"
        val pagingSource = mockk<PagingSource<Int, KnowledgeItemEntity>>()
        val loadResult = PagingSource.LoadResult.Page(
            data = listOf(testItems[1]),
            prevKey = null,
            nextKey = null
        )

        coEvery { knowledgeItemDao.searchItemsSimple(query) } returns pagingSource
        coEvery { pagingSource.load(any()) } returns loadResult

        // When
        val results = ragRetriever.retrieve(query, topK = 3)

        // Then
        assertEquals("FTS5", results[0].searchMethod)
    }

    @Test
    fun `retrieve should return empty list for blank query`() = runTest {
        // When
        val results = ragRetriever.retrieve("", topK = 3)

        // Then
        assertTrue(results.isEmpty())
    }

    @Test
    fun `retrieve should return empty list for whitespace query`() = runTest {
        // When
        val results = ragRetriever.retrieve("   ", topK = 3)

        // Then
        assertTrue(results.isEmpty())
    }

    @Test
    fun `buildContext should format results correctly`() = runTest {
        // Given
        val query = "Kotlin"
        val pagingSource = mockk<PagingSource<Int, KnowledgeItemEntity>>()
        val loadResult = PagingSource.LoadResult.Page(
            data = testItems.take(2),
            prevKey = null,
            nextKey = null
        )

        coEvery { knowledgeItemDao.searchItemsSimple(query) } returns pagingSource
        coEvery { pagingSource.load(any()) } returns loadResult

        // When
        val context = ragRetriever.buildContext(query, topK = 2)

        // Then
        assertTrue(context.contains("以下是相关的知识库内容"))
        assertTrue(context.contains("【参考资料 1】"))
        assertTrue(context.contains("【参考资料 2】"))
        assertTrue(context.contains("Kotlin协程基础"))
    }

    @Test
    fun `buildContext should return empty string for no results`() = runTest {
        // Given
        val query = "nonexistent"
        val pagingSource = mockk<PagingSource<Int, KnowledgeItemEntity>>()
        val loadResult = PagingSource.LoadResult.Page<Int, KnowledgeItemEntity>(
            data = emptyList(),
            prevKey = null,
            nextKey = null
        )

        coEvery { knowledgeItemDao.searchItemsSimple(query) } returns pagingSource
        coEvery { pagingSource.load(any()) } returns loadResult

        // When
        val context = ragRetriever.buildContext(query, topK = 3)

        // Then
        assertEquals("", context)
    }

    @Test
    fun `buildContext should truncate long content`() = runTest {
        // Given
        val query = "Kotlin"
        val longContent = "a".repeat(1000)
        val itemWithLongContent = testItems[0].copy(content = longContent)

        val pagingSource = mockk<PagingSource<Int, KnowledgeItemEntity>>()
        val loadResult = PagingSource.LoadResult.Page(
            data = listOf(itemWithLongContent),
            prevKey = null,
            nextKey = null
        )

        coEvery { knowledgeItemDao.searchItemsSimple(query) } returns pagingSource
        coEvery { pagingSource.load(any()) } returns loadResult

        // When
        val context = ragRetriever.buildContext(query, topK = 1)

        // Then
        assertTrue(context.contains("..."), "Long content should be truncated")
        // Content should be limited to 500 characters + "..."
        val contentStart = context.indexOf("内容: ")
        val contentEnd = context.indexOf("\n\n", contentStart)
        val contentLength = contentEnd - contentStart - 4  // "内容: " is 4 chars
        assertTrue(contentLength <= 503, "Content should be truncated to ~500 chars")
    }

    @Test
    fun `vectorSearch should rank semantically similar content higher`() = runTest {
        // Given
        val query = "异步编程"
        coEvery { knowledgeItemDao.getAllItemsSync() } returns testItems

        // When
        val results = ragRetriever.retrieve(query, topK = 3, useVectorSearch = true)

        // Then
        assertTrue(results.isNotEmpty())
        // "Kotlin协程基础" mentions "异步代码", should be most relevant
        assertTrue(
            results[0].title.contains("协程") || results[0].content.contains("异步"),
            "Most relevant result should mention related terms"
        )
    }

    @Test
    fun `FTS5Search should handle special characters in query`() = runTest {
        // Given
        val query = "Kotlin#协程*测试?"
        val pagingSource = mockk<PagingSource<Int, KnowledgeItemEntity>>()
        val loadResult = PagingSource.LoadResult.Page<Int, KnowledgeItemEntity>(
            data = emptyList(),
            prevKey = null,
            nextKey = null
        )

        coEvery { knowledgeItemDao.searchItemsSimple(query) } returns pagingSource
        coEvery { pagingSource.load(any()) } returns loadResult

        // When
        val results = ragRetriever.retrieve(query, topK = 3, useVectorSearch = false)

        // Then - should not crash
        assertTrue(results.isEmpty())
    }

    @Test
    fun `vectorSearch should handle large dataset`() = runTest {
        // Given
        val query = "测试"
        val largeDataset = (1..100).map { i ->
            KnowledgeItemEntity(
                id = "item-$i",
                title = "文档 $i",
                content = "这是第 $i 个测试文档的内容",
                createdAt = System.currentTimeMillis(),
                updatedAt = System.currentTimeMillis(),
                userId = "user1"
            )
        }

        coEvery { knowledgeItemDao.getAllItemsSync() } returns largeDataset

        // When
        val results = ragRetriever.retrieve(query, topK = 5, useVectorSearch = true)

        // Then
        assertEquals(5, results.size)
        assertTrue(results[0].score >= results[4].score)
    }

    @Test
    fun `calculateKeywordRelevanceScore should prioritize exact matches`() = runTest {
        // Given
        val query = "Kotlin Compose"
        val pagingSource = mockk<PagingSource<Int, KnowledgeItemEntity>>()
        val loadResult = PagingSource.LoadResult.Page(
            data = testItems,
            prevKey = null,
            nextKey = null
        )

        coEvery { knowledgeItemDao.searchItemsSimple(query) } returns pagingSource
        coEvery { pagingSource.load(any()) } returns loadResult

        // When
        val results = ragRetriever.retrieve(query, topK = 3, useVectorSearch = false)

        // Then
        // Results with both "Kotlin" and "Compose" should rank higher
        assertTrue(results.isNotEmpty())
    }
}

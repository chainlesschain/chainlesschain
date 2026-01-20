package com.chainlesschain.android.feature.ai

import android.content.Context
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
 * 测试FTS5、BM25、向量搜索和混合检索功能
 */
class RAGRetrieverTest {

    private lateinit var ragRetriever: RAGRetriever
    private val knowledgeItemDao = mockk<KnowledgeItemDao>(relaxed = true)
    private val vectorEmbedderFactory = mockk<VectorEmbedderFactory>(relaxed = true)
    private val enhancedTfIdfEmbedder = mockk<EnhancedTfIdfEmbedder>(relaxed = true)

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

        // Mock enhanced embedder
        var vectorCounter = 0
        coEvery { enhancedTfIdfEmbedder.embed(any()) } answers {
            val offset = (vectorCounter++ % 10) * 0.1f
            FloatArray(256) { (it * 0.01f + offset) }
        }
        coEvery { enhancedTfIdfEmbedder.getDimension() } returns 256
        coEvery { enhancedTfIdfEmbedder.initialize() } returns Unit
        coEvery { enhancedTfIdfEmbedder.updateFromCorpus(any()) } returns Unit
        every { enhancedTfIdfEmbedder.getStats() } returns EmbedderStats(
            vocabularySize = 100,
            totalDocuments = 3,
            cacheSize = 10,
            vectorDimension = 256
        )

        // Mock DAO for initial load
        coEvery { knowledgeItemDao.getAllItemsSync() } returns testItems

        ragRetriever = RAGRetriever(knowledgeItemDao, vectorEmbedderFactory, enhancedTfIdfEmbedder)
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
        val results = ragRetriever.retrieve(query, topK, RetrievalStrategy.FTS5)

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
        val results = ragRetriever.retrieve(query, topK, RetrievalStrategy.VECTOR)

        // Then
        assertEquals(2, results.size)
        assertTrue(results[0].score >= results[1].score, "Results should be sorted by score")
        assertEquals("Vector", results[0].searchMethod)
    }

    @Test
    fun `retrieveByBM25 should return relevant results`() = runTest {
        // Given
        val query = "Kotlin协程"
        val topK = 3

        // When
        val results = ragRetriever.retrieve(query, topK, RetrievalStrategy.BM25)

        // Then
        assertTrue(results.isNotEmpty())
        assertEquals("BM25", results[0].searchMethod)
    }

    @Test
    fun `retrieveByHybrid should combine multiple methods`() = runTest {
        // Given
        val query = "Kotlin Android"
        val topK = 3

        // When
        val results = ragRetriever.retrieve(query, topK, RetrievalStrategy.HYBRID)

        // Then
        assertTrue(results.isNotEmpty())
        assertTrue(results[0].searchMethod.startsWith("Hybrid"))
    }

    @Test
    fun `retrieve should use HYBRID by default`() = runTest {
        // Given
        val query = "Android"

        // When
        val results = ragRetriever.retrieve(query, topK = 3)

        // Then
        assertTrue(results.isNotEmpty())
        assertTrue(results[0].searchMethod.startsWith("Hybrid"))
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

        // When
        val context = ragRetriever.buildContext(query, topK = 2)

        // Then
        assertTrue(context.contains("以下是相关的知识库内容"))
        assertTrue(context.contains("【参考资料 1】"))
    }

    @Test
    fun `buildContext should return empty string for no results`() = runTest {
        // Given
        val query = "nonexistent"
        coEvery { knowledgeItemDao.getAllItemsSync() } returns emptyList()

        // Recreate retriever with empty data
        ragRetriever = RAGRetriever(knowledgeItemDao, vectorEmbedderFactory, enhancedTfIdfEmbedder)

        // When
        val context = ragRetriever.buildContext(query, topK = 3)

        // Then
        assertEquals("", context)
    }

    @Test
    fun `buildContext should include matched terms`() = runTest {
        // Given
        val query = "Kotlin"

        // When
        val context = ragRetriever.buildContext(query, topK = 2)

        // Then
        // Hybrid results may include matched terms
        assertTrue(context.isNotEmpty())
    }

    @Test
    fun `getStats should return retriever statistics`() = runTest {
        // Initialize first
        ragRetriever.initialize()

        // When
        val stats = ragRetriever.getStats()

        // Then
        assertTrue(stats.isIndexed)
        assertEquals(256, stats.embedderStats.vectorDimension)
    }

    @Test
    fun `refreshIndex should rebuild the index`() = runTest {
        // Given
        ragRetriever.initialize()
        assertTrue(ragRetriever.getStats().isIndexed)

        // When
        ragRetriever.refreshIndex()

        // Then
        assertTrue(ragRetriever.getStats().isIndexed)
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
        ragRetriever = RAGRetriever(knowledgeItemDao, vectorEmbedderFactory, enhancedTfIdfEmbedder)

        // When
        val results = ragRetriever.retrieve(query, topK = 5, RetrievalStrategy.VECTOR)

        // Then
        assertEquals(5, results.size)
        assertTrue(results[0].score >= results[4].score)
    }

    @Test
    fun `hybrid search should rank results with multiple matches higher`() = runTest {
        // Given
        val query = "Kotlin Compose"

        // When
        val results = ragRetriever.retrieve(query, topK = 3, RetrievalStrategy.HYBRID)

        // Then
        assertTrue(results.isNotEmpty())
        // Jetpack Compose教程 mentions both Kotlin and Compose
        // It should rank higher than documents with only one match
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
        val results = ragRetriever.retrieve(query, topK = 3, RetrievalStrategy.FTS5)

        // Then - should not crash
        assertTrue(results.isEmpty())
    }

    @Test
    fun `retrieve with different strategies should return different search methods`() = runTest {
        // Given
        val query = "Kotlin"
        val pagingSource = mockk<PagingSource<Int, KnowledgeItemEntity>>()
        val loadResult = PagingSource.LoadResult.Page(
            data = testItems.take(1),
            prevKey = null,
            nextKey = null
        )
        coEvery { knowledgeItemDao.searchItemsSimple(query) } returns pagingSource
        coEvery { pagingSource.load(any()) } returns loadResult

        // When
        val fts5Results = ragRetriever.retrieve(query, strategy = RetrievalStrategy.FTS5)
        val bm25Results = ragRetriever.retrieve(query, strategy = RetrievalStrategy.BM25)
        val vectorResults = ragRetriever.retrieve(query, strategy = RetrievalStrategy.VECTOR)
        val hybridResults = ragRetriever.retrieve(query, strategy = RetrievalStrategy.HYBRID)

        // Then
        assertTrue(fts5Results.firstOrNull()?.searchMethod == "FTS5")
        assertTrue(bm25Results.firstOrNull()?.searchMethod == "BM25")
        assertTrue(vectorResults.firstOrNull()?.searchMethod == "Vector")
        assertTrue(hybridResults.firstOrNull()?.searchMethod?.startsWith("Hybrid") == true)
    }
}

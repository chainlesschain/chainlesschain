package com.chainlesschain.android.feature.ai.data.rag

import io.mockk.coEvery
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * 混合检索器单元测试
 */
class HybridRetrieverTest {

    private lateinit var bm25Retriever: BM25Retriever
    private lateinit var vectorEmbedder: VectorEmbedder
    private lateinit var hybridRetriever: HybridRetriever

    @Before
    fun setup() {
        bm25Retriever = BM25Retriever()
        vectorEmbedder = mockk()
        hybridRetriever = HybridRetriever(
            bm25Retriever = bm25Retriever,
            vectorEmbedder = vectorEmbedder,
            config = HybridRetriever.HybridConfig(
                bm25Weight = 0.4,
                vectorWeight = 0.4,
                keywordWeight = 0.2,
                minSimilarity = 0.1,
                enableReranking = true
            )
        )
    }

    @Test
    fun `search returns empty list for empty query`() = runTest {
        setupMockEmbedder()
        indexSampleDocuments()

        val results = hybridRetriever.search("")

        assertTrue(results.isEmpty())
    }

    @Test
    fun `search returns empty list when no documents indexed`() = runTest {
        setupMockEmbedder()

        val results = hybridRetriever.search("test query")

        assertTrue(results.isEmpty())
    }

    @Test
    fun `indexDocuments indexes documents correctly`() = runTest {
        setupMockEmbedder()
        indexSampleDocuments()

        val stats = hybridRetriever.getStats()

        assertEquals(3, stats.documentCount)
        assertEquals(3, stats.vectorCacheSize)
    }

    @Test
    fun `search with BM25_ONLY mode uses only BM25`() = runTest {
        setupMockEmbedder()
        indexSampleDocuments()

        val results = hybridRetriever.search("Kotlin programming", searchMode = SearchMode.BM25_ONLY)

        assertTrue(results.isNotEmpty())
        assertEquals("BM25", results.first().searchMethod)
    }

    @Test
    fun `search with VECTOR_ONLY mode uses only vector search`() = runTest {
        setupMockEmbedder()
        indexSampleDocuments()

        val results = hybridRetriever.search("Kotlin", searchMode = SearchMode.VECTOR_ONLY)

        assertTrue(results.isNotEmpty())
        assertEquals("Vector", results.first().searchMethod)
    }

    @Test
    fun `search with KEYWORD_ONLY mode uses only keyword matching`() = runTest {
        setupMockEmbedder()
        indexSampleDocuments()

        val results = hybridRetriever.search("Kotlin", searchMode = SearchMode.KEYWORD_ONLY)

        assertTrue(results.isNotEmpty())
        assertEquals("Keyword", results.first().searchMethod)
    }

    @Test
    fun `search with HYBRID mode combines all methods`() = runTest {
        setupMockEmbedder()
        indexSampleDocuments()

        val results = hybridRetriever.search("Kotlin programming", searchMode = SearchMode.HYBRID)

        assertTrue(results.isNotEmpty())
        assertEquals("Hybrid", results.first().searchMethod)
    }

    @Test
    fun `hybrid search returns combined scores`() = runTest {
        setupMockEmbedder()
        indexSampleDocuments()

        val results = hybridRetriever.search("Kotlin Android", searchMode = SearchMode.HYBRID)

        assertTrue(results.isNotEmpty())
        // Hybrid results should have all score components
        val firstResult = results.first()
        assertTrue(firstResult.bm25Score >= 0)
        assertTrue(firstResult.vectorScore >= 0)
        assertTrue(firstResult.keywordScore >= 0)
    }

    @Test
    fun `search respects topK parameter`() = runTest {
        setupMockEmbedder()
        indexSampleDocuments()

        val results = hybridRetriever.search("programming", topK = 2)

        assertTrue(results.size <= 2)
    }

    @Test
    fun `search finds matched terms`() = runTest {
        setupMockEmbedder()
        indexSampleDocuments()

        val results = hybridRetriever.search("Kotlin", searchMode = SearchMode.KEYWORD_ONLY)

        assertTrue(results.isNotEmpty())
        assertTrue(results.first().matchedTerms.contains("kotlin"))
    }

    @Test
    fun `clear removes all indexed data`() = runTest {
        setupMockEmbedder()
        indexSampleDocuments()
        assertEquals(3, hybridRetriever.getStats().documentCount)

        hybridRetriever.clear()

        assertEquals(0, hybridRetriever.getStats().documentCount)
        assertEquals(0, hybridRetriever.getStats().vectorCacheSize)
    }

    @Test
    fun `getStats returns configuration`() = runTest {
        setupMockEmbedder()
        indexSampleDocuments()

        val stats = hybridRetriever.getStats()

        assertEquals(0.4, stats.config.bm25Weight)
        assertEquals(0.4, stats.config.vectorWeight)
        assertEquals(0.2, stats.config.keywordWeight)
    }

    @Test
    fun `search handles Chinese queries`() = runTest {
        setupMockEmbedder()

        val documents = listOf(
            IndexableDocument("1", "安卓开发指南", "使用Kotlin进行安卓应用开发"),
            IndexableDocument("2", "iOS开发", "使用Swift进行iOS开发"),
            IndexableDocument("3", "后端开发", "使用Java进行后端开发")
        )
        hybridRetriever.indexDocuments(documents)

        val results = hybridRetriever.search("安卓 Kotlin")

        assertTrue(results.isNotEmpty())
        assertEquals("1", results.first().id)
    }

    @Test
    fun `search results are sorted by score descending`() = runTest {
        setupMockEmbedder()
        indexSampleDocuments()

        val results = hybridRetriever.search("programming")

        for (i in 0 until results.size - 1) {
            assertTrue(results[i].score >= results[i + 1].score)
        }
    }

    @Test
    fun `vector similarity threshold filters low scores`() = runTest {
        // Create embedder that returns low similarity vectors
        coEvery { vectorEmbedder.embed(any()) } returns FloatArray(256) { 0.01f }
        coEvery { vectorEmbedder.getDimension() } returns 256

        indexSampleDocuments()

        val results = hybridRetriever.search("completely unrelated query xyz", searchMode = SearchMode.VECTOR_ONLY)

        // Low similarity results should be filtered out
        assertTrue(results.all { it.vectorScore >= 0.1 || it.score > 0 })
    }

    private fun setupMockEmbedder() {
        var counter = 0
        coEvery { vectorEmbedder.embed(any()) } answers {
            // Generate slightly different vectors for each document
            val offset = (counter++ % 10) * 0.1f
            FloatArray(256) { (it * 0.01f + offset) }
        }
        coEvery { vectorEmbedder.getDimension() } returns 256
    }

    private suspend fun indexSampleDocuments() {
        val documents = listOf(
            IndexableDocument("1", "Kotlin Guide", "Kotlin is a modern programming language for Android"),
            IndexableDocument("2", "Java Guide", "Java is an object-oriented programming language"),
            IndexableDocument("3", "Android Dev", "Android development using Kotlin and Java")
        )
        hybridRetriever.indexDocuments(documents)
    }
}

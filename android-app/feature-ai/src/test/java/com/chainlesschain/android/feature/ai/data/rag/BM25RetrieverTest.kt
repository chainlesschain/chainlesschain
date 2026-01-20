package com.chainlesschain.android.feature.ai.data.rag

import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * BM25检索器单元测试
 */
class BM25RetrieverTest {

    private lateinit var retriever: BM25Retriever

    @Before
    fun setup() {
        retriever = BM25Retriever(k1 = 1.5, b = 0.75)
    }

    @Test
    fun `search returns empty list when no documents indexed`() {
        val results = retriever.search("test query")
        assertTrue(results.isEmpty())
    }

    @Test
    fun `search returns empty list for empty query`() {
        indexSampleDocuments()
        val results = retriever.search("")
        assertTrue(results.isEmpty())
    }

    @Test
    fun `indexDocuments indexes documents correctly`() {
        indexSampleDocuments()

        val stats = retriever.getStats()
        assertEquals(3, stats.documentCount)
        assertTrue(stats.vocabularySize > 0)
    }

    @Test
    fun `search finds relevant English documents`() {
        val documents = listOf(
            IndexableDocument("1", "Kotlin Guide", "Kotlin is a modern programming language"),
            IndexableDocument("2", "Java Guide", "Java is an object-oriented programming language"),
            IndexableDocument("3", "Python Guide", "Python is a scripting language")
        )
        retriever.indexDocuments(documents)

        val results = retriever.search("Kotlin programming")

        assertTrue(results.isNotEmpty())
        assertEquals("1", results.first().id)
    }

    @Test
    fun `search finds relevant Chinese documents`() {
        val documents = listOf(
            IndexableDocument("1", "安卓开发", "安卓应用程序开发指南，使用Kotlin语言"),
            IndexableDocument("2", "iOS开发", "iOS应用开发使用Swift语言"),
            IndexableDocument("3", "后端开发", "后端服务使用Java或Python")
        )
        retriever.indexDocuments(documents)

        val results = retriever.search("安卓开发")

        assertTrue(results.isNotEmpty())
        assertEquals("1", results.first().id)
    }

    @Test
    fun `search returns matched terms`() {
        indexSampleDocuments()

        val results = retriever.search("programming language")

        assertTrue(results.isNotEmpty())
        assertTrue(results.first().matchedTerms.isNotEmpty())
    }

    @Test
    fun `search respects topK parameter`() {
        indexSampleDocuments()

        val results = retriever.search("programming", topK = 2)

        assertTrue(results.size <= 2)
    }

    @Test
    fun `search scores higher for more relevant documents`() {
        val documents = listOf(
            IndexableDocument("1", "Kotlin Kotlin", "Kotlin Kotlin Kotlin programming"),
            IndexableDocument("2", "Mixed", "Java and Kotlin programming"),
            IndexableDocument("3", "Java", "Java programming language")
        )
        retriever.indexDocuments(documents)

        val results = retriever.search("Kotlin")

        assertTrue(results.size >= 2)
        // First result should have higher score due to more Kotlin mentions
        assertTrue(results[0].score >= results[1].score)
    }

    @Test
    fun `getStats returns correct statistics`() {
        indexSampleDocuments()

        val stats = retriever.getStats()

        assertEquals(3, stats.documentCount)
        assertTrue(stats.avgDocumentLength > 0)
        assertTrue(stats.vocabularySize > 0)
        assertEquals(1.5, stats.k1)
        assertEquals(0.75, stats.b)
    }

    @Test
    fun `search handles mixed Chinese and English content`() {
        val documents = listOf(
            IndexableDocument("1", "混合文档", "This is a 混合 document with both Chinese 和 English"),
            IndexableDocument("2", "English Only", "This is pure English content"),
            IndexableDocument("3", "纯中文", "这是纯中文内容")
        )
        retriever.indexDocuments(documents)

        val results = retriever.search("混合 English")

        assertTrue(results.isNotEmpty())
        assertEquals("1", results.first().id)
    }

    @Test
    fun `indexDocuments clears previous index`() {
        indexSampleDocuments()
        assertEquals(3, retriever.getStats().documentCount)

        val newDocuments = listOf(
            IndexableDocument("a", "New Doc", "New content")
        )
        retriever.indexDocuments(newDocuments)

        assertEquals(1, retriever.getStats().documentCount)
    }

    private fun indexSampleDocuments() {
        val documents = listOf(
            IndexableDocument("1", "Kotlin Guide", "Kotlin is a modern programming language for Android"),
            IndexableDocument("2", "Java Guide", "Java is an object-oriented programming language"),
            IndexableDocument("3", "Android Dev", "Android development using Kotlin and Java")
        )
        retriever.indexDocuments(documents)
    }
}

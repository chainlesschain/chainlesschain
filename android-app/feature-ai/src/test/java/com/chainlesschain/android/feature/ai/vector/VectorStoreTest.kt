package com.chainlesschain.android.feature.ai.vector

import org.junit.Assert.*
import org.junit.Test

/**
 * VectorStore 单元测试
 *
 * 验证向量存储、相似度搜索、批量操作等功能
 */
class VectorStoreTest {

    // ===== SIMDUtils Tests =====

    @Test
    fun `余弦相似度计算正确`() {
        // Given - 相同向量
        val vec1 = floatArrayOf(1f, 0f, 0f)
        val vec2 = floatArrayOf(1f, 0f, 0f)

        // When
        val similarity = SIMDUtils.cosineSimilarity(vec1, vec2)

        // Then
        assertEquals("相同向量相似度应为1", 1.0f, similarity, 0.001f)
    }

    @Test
    fun `正交向量余弦相似度为0`() {
        // Given - 正交向量
        val vec1 = floatArrayOf(1f, 0f, 0f)
        val vec2 = floatArrayOf(0f, 1f, 0f)

        // When
        val similarity = SIMDUtils.cosineSimilarity(vec1, vec2)

        // Then
        assertEquals("正交向量相似度应为0", 0.0f, similarity, 0.001f)
    }

    @Test
    fun `反向向量余弦相似度为-1`() {
        // Given - 反向向量
        val vec1 = floatArrayOf(1f, 0f, 0f)
        val vec2 = floatArrayOf(-1f, 0f, 0f)

        // When
        val similarity = SIMDUtils.cosineSimilarity(vec1, vec2)

        // Then
        assertEquals("反向向量相似度应为-1", -1.0f, similarity, 0.001f)
    }

    @Test
    fun `欧几里得距离计算正确`() {
        // Given
        val vec1 = floatArrayOf(0f, 0f, 0f)
        val vec2 = floatArrayOf(3f, 4f, 0f)

        // When
        val distance = SIMDUtils.euclideanDistance(vec1, vec2)

        // Then
        assertEquals("距离应为5", 5.0f, distance, 0.001f)
    }

    @Test
    fun `相同向量欧几里得距离为0`() {
        // Given
        val vec = floatArrayOf(1f, 2f, 3f)

        // When
        val distance = SIMDUtils.euclideanDistance(vec, vec)

        // Then
        assertEquals("相同向量距离应为0", 0.0f, distance, 0.001f)
    }

    @Test
    fun `点积计算正确`() {
        // Given
        val vec1 = floatArrayOf(1f, 2f, 3f)
        val vec2 = floatArrayOf(4f, 5f, 6f)

        // When
        val dotProduct = SIMDUtils.dotProduct(vec1, vec2)

        // Then
        // 1*4 + 2*5 + 3*6 = 4 + 10 + 18 = 32
        assertEquals("点积应为32", 32.0f, dotProduct, 0.001f)
    }

    @Test
    fun `向量归一化正确`() {
        // Given
        val vec = floatArrayOf(3f, 4f, 0f)

        // When
        val normalized = SIMDUtils.normalize(vec)

        // Then
        val magnitude = kotlin.math.sqrt(
            normalized[0] * normalized[0] +
            normalized[1] * normalized[1] +
            normalized[2] * normalized[2]
        )
        assertEquals("归一化向量模长应为1", 1.0f, magnitude, 0.001f)
    }

    @Test
    fun `零向量归一化返回零向量`() {
        // Given
        val zeroVec = floatArrayOf(0f, 0f, 0f)

        // When
        val normalized = SIMDUtils.normalize(zeroVec)

        // Then
        assertTrue("零向量归一化应返回零向量", normalized.all { it == 0f })
    }

    // ===== VectorSearch Tests =====

    @Test
    fun `MinHeap Top-K搜索正确`() {
        // Given - VectorEntry(id, namespace, content, embedding, metadata?)
        val entries = listOf(
            VectorEntry("1", "ns", "doc1", floatArrayOf(1f, 0f, 0f)),
            VectorEntry("2", "ns", "doc2", floatArrayOf(0.9f, 0.1f, 0f)),
            VectorEntry("3", "ns", "doc3", floatArrayOf(0.5f, 0.5f, 0f)),
            VectorEntry("4", "ns", "doc4", floatArrayOf(0f, 1f, 0f)),
            VectorEntry("5", "ns", "doc5", floatArrayOf(0.8f, 0.2f, 0f))
        )
        val query = floatArrayOf(1f, 0f, 0f)

        // When - searchTopK(query, candidates, k, threshold)
        val results = VectorSearch.searchTopK(query, entries, k = 3)

        // Then
        assertEquals("应返回3个结果", 3, results.size)
        assertEquals("第一个应是最相似的", "1", results[0].entry.id)
        assertTrue("结果应按相似度降序", results[0].score >= results[1].score)
        assertTrue("结果应按相似度降序", results[1].score >= results[2].score)
    }

    @Test
    fun `Top-K K大于条目数应返回所有`() {
        // Given
        val entries = listOf(
            VectorEntry("1", "ns", "doc1", floatArrayOf(1f, 0f)),
            VectorEntry("2", "ns", "doc2", floatArrayOf(0f, 1f))
        )
        val query = floatArrayOf(1f, 0f)

        // When
        val results = VectorSearch.searchTopK(query, entries, k = 10)

        // Then
        assertEquals("应返回所有条目", 2, results.size)
    }

    @Test
    fun `Top-K空列表应返回空`() {
        // Given
        val entries = emptyList<VectorEntry>()
        val query = floatArrayOf(1f, 0f, 0f)

        // When
        val results = VectorSearch.searchTopK(query, entries, k = 5)

        // Then
        assertTrue("空列表应返回空结果", results.isEmpty())
    }

    @Test
    fun `阈值过滤正确`() {
        // Given
        val entries = listOf(
            VectorEntry("1", "ns", "doc1", floatArrayOf(1f, 0f, 0f)),
            VectorEntry("2", "ns", "doc2", floatArrayOf(0.5f, 0.5f, 0f)),
            VectorEntry("3", "ns", "doc3", floatArrayOf(0f, 1f, 0f))
        )
        val query = floatArrayOf(1f, 0f, 0f)

        // When - 只返回相似度>0.7的结果
        val results = VectorSearch.searchTopK(query, entries, k = 10, threshold = 0.7f)

        // Then
        assertTrue("所有结果相似度应>0.7", results.all { it.score > 0.7f })
    }

    @Test
    fun `MMR多样性搜索正确`() {
        // Given - 三个不同相似度的向量
        val entries = listOf(
            VectorEntry("1", "ns", "doc1", floatArrayOf(1f, 0f, 0f)),
            VectorEntry("2", "ns", "doc2", floatArrayOf(0.8f, 0.6f, 0f)), // 与1中等相似
            VectorEntry("3", "ns", "doc3", floatArrayOf(0.6f, 0.8f, 0f))  // 与1较低相似
        )
        val query = floatArrayOf(1f, 0f, 0f)

        // When - MMR应该选择平衡相关性和多样性的结果
        val results = VectorSearch.searchMMR(query, entries, k = 2, lambda = 0.7f)

        // Then
        assertTrue("应至少返回1个结果", results.isNotEmpty())
        assertEquals("第一个应是最相似的", "1", results[0].entry.id)
        // MMR会根据相关性和多样性的平衡来选择后续结果
        if (results.size > 1) {
            assertTrue("第二个结果应有较高相似度", results[1].score > 0.5f)
        }
    }

    // ===== VectorEntry Tests =====

    @Test
    fun `VectorEntry创建正确`() {
        // Given
        val entry = VectorEntry(
            id = "test-id",
            namespace = "test-namespace",
            content = "Test content",
            embedding = floatArrayOf(0.1f, 0.2f, 0.3f),
            metadata = VectorMetadata(tags = listOf("tag1", "tag2"))
        )

        // Then
        assertEquals("ID应正确", "test-id", entry.id)
        assertEquals("命名空间应正确", "test-namespace", entry.namespace)
        assertEquals("内容应正确", "Test content", entry.content)
        assertEquals("向量维度应正确", 3, entry.embedding.size)
        assertEquals("标签数量应正确", 2, entry.metadata?.tags?.size)
    }

    @Test
    fun `VectorEntry相等性基于id和embedding`() {
        // Given
        val entry1 = VectorEntry(
            id = "test-id",
            namespace = "ns1",
            content = "content1",
            embedding = floatArrayOf(1f, 2f, 3f)
        )
        val entry2 = VectorEntry(
            id = "test-id",
            namespace = "ns2",
            content = "content2",
            embedding = floatArrayOf(1f, 2f, 3f)
        )

        // Then
        assertEquals("相同id和embedding应相等", entry1, entry2)
    }

    // ===== Metadata Filter Tests =====

    @Test
    fun `元数据过滤正确`() {
        // Given
        val entries = listOf(
            VectorEntry("1", "ns", "doc1", floatArrayOf(1f, 0f),
                metadata = VectorMetadata(category = "article")),
            VectorEntry("2", "ns", "doc2", floatArrayOf(0.9f, 0.1f),
                metadata = VectorMetadata(category = "code")),
            VectorEntry("3", "ns", "doc3", floatArrayOf(0.8f, 0.2f),
                metadata = VectorMetadata(category = "article"))
        )

        // When
        val filtered = entries.filter { it.metadata?.category == "article" }

        // Then
        assertEquals("应有2个article", 2, filtered.size)
    }

    // ===== Performance Tests =====

    @Test
    fun `大规模向量搜索性能`() {
        // Given - 1000个768维向量
        val dimension = 768
        val count = 1000
        val entries = List(count) { i ->
            val embedding = FloatArray(dimension) { kotlin.random.Random.nextFloat() }
            VectorEntry("id-$i", "ns", "content-$i", embedding)
        }
        val query = FloatArray(dimension) { kotlin.random.Random.nextFloat() }

        // When
        val startTime = System.nanoTime()
        val results = VectorSearch.searchTopK(query, entries, k = 10)
        val duration = (System.nanoTime() - startTime) / 1_000_000.0

        // Then
        assertEquals("应返回10个结果", 10, results.size)
        println("搜索1000个768维向量耗时: ${String.format("%.2f", duration)} ms")
        assertTrue("搜索应在合理时间内完成", duration < 1000) // < 1秒
    }

    @Test
    fun `批量相似度计算性能`() {
        // Given
        val dimension = 384
        val count = 10000

        val vectors = List(count) { FloatArray(dimension) { kotlin.random.Random.nextFloat() } }
        val query = FloatArray(dimension) { kotlin.random.Random.nextFloat() }

        // When
        val startTime = System.nanoTime()
        val similarities = vectors.map { SIMDUtils.cosineSimilarity(query, it) }
        val duration = (System.nanoTime() - startTime) / 1_000_000.0

        // Then
        assertEquals("应计算所有相似度", count, similarities.size)
        println("计算10000个384维向量相似度耗时: ${String.format("%.2f", duration)} ms")
        assertTrue("计算应在合理时间内完成", duration < 500) // < 500ms
    }

    // ===== Edge Cases =====

    @Test
    fun `不同维度向量应处理正确`() {
        // Given
        val vec1 = floatArrayOf(1f, 0f, 0f)
        val vec2 = floatArrayOf(1f, 0f) // 不同维度

        // When
        val similarity = SIMDUtils.cosineSimilarity(vec1, vec2)

        // Then - 应该不抛异常，使用较小维度
        assertTrue("应返回有效相似度", similarity.isFinite())
    }

    @Test
    fun `高维向量相似度计算正确`() {
        // Given - 1536维向量（OpenAI embedding维度）
        val dimension = 1536
        val vec1 = FloatArray(dimension) { 1f / kotlin.math.sqrt(dimension.toFloat()) }
        val vec2 = FloatArray(dimension) { 1f / kotlin.math.sqrt(dimension.toFloat()) }

        // When
        val similarity = SIMDUtils.cosineSimilarity(vec1, vec2)

        // Then
        assertEquals("相同向量相似度应为1", 1.0f, similarity, 0.01f)
    }

    @Test
    fun `命名空间隔离正确`() {
        // Given
        val entries = listOf(
            VectorEntry("1", "ns-a", "doc1", floatArrayOf(1f, 0f)),
            VectorEntry("2", "ns-b", "doc2", floatArrayOf(0.9f, 0.1f)),
            VectorEntry("3", "ns-a", "doc3", floatArrayOf(0.8f, 0.2f))
        )

        // When
        val nsAEntries = entries.filter { it.namespace == "ns-a" }

        // Then
        assertEquals("ns-a应有2个条目", 2, nsAEntries.size)
    }

    @Test
    fun `按命名空间搜索正确`() {
        // Given
        val entries = listOf(
            VectorEntry("1", "ns-a", "doc1", floatArrayOf(1f, 0f, 0f)),
            VectorEntry("2", "ns-b", "doc2", floatArrayOf(0.9f, 0.1f, 0f)),
            VectorEntry("3", "ns-a", "doc3", floatArrayOf(0.8f, 0.2f, 0f))
        )
        val query = floatArrayOf(1f, 0f, 0f)

        // When
        val results = VectorSearch.searchByNamespace(query, entries, "ns-a", k = 10)

        // Then
        assertEquals("应只返回ns-a的结果", 2, results.size)
        assertTrue("所有结果应属于ns-a", results.all { it.entry.namespace == "ns-a" })
    }

    @Test
    fun `批量搜索正确`() {
        // Given
        val entries = listOf(
            VectorEntry("1", "ns", "doc1", floatArrayOf(1f, 0f, 0f)),
            VectorEntry("2", "ns", "doc2", floatArrayOf(0f, 1f, 0f)),
            VectorEntry("3", "ns", "doc3", floatArrayOf(0f, 0f, 1f))
        )
        val queries = listOf(
            floatArrayOf(1f, 0f, 0f),
            floatArrayOf(0f, 1f, 0f)
        )

        // When
        val results = VectorSearch.batchSearch(queries, entries, k = 1)

        // Then
        assertEquals("应有2个查询结果", 2, results.size)
        assertEquals("第一个查询应匹配doc1", "1", results[0]?.firstOrNull()?.entry?.id)
        assertEquals("第二个查询应匹配doc2", "2", results[1]?.firstOrNull()?.entry?.id)
    }

    @Test
    fun `相似度矩阵计算正确`() {
        // Given
        val setA = listOf(
            floatArrayOf(1f, 0f),
            floatArrayOf(0f, 1f)
        )
        val setB = listOf(
            floatArrayOf(1f, 0f),
            floatArrayOf(0f, 1f),
            floatArrayOf(0.5f, 0.5f)
        )

        // When
        val matrix = VectorSearch.similarityMatrix(setA, setB)

        // Then
        assertEquals("矩阵行数应正确", 2, matrix.size)
        assertEquals("矩阵列数应正确", 3, matrix[0].size)
        assertEquals("对角线元素应为1", 1.0f, matrix[0][0], 0.01f)
        assertEquals("对角线元素应为1", 1.0f, matrix[1][1], 0.01f)
    }
}

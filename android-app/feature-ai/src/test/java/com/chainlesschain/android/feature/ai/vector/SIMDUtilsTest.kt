package com.chainlesschain.android.feature.ai.vector

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * [SIMDUtils] 补测：VectorStoreTest 已覆盖 cosine/euclidean/dot/normalize 基本用例，这里补
 * ① cosineSimilarity 的循环展开余数路径（长度非 4 倍数，易在 4-元素展开+尾部处理出错）；
 * ② 完全未覆盖的 l2Norm / add / scale / mean 及其维度守卫。RAG 向量相似度算错会污染检索召回。
 */
class SIMDUtilsTest {

    private val eps = 1e-5f

    @Test
    fun `cosineSimilarity is correct across loop-unroll boundary lengths`() {
        // 长度 1..7 覆盖「无展开(<4)」「恰一组(4)」「一组+余数(5,6,7)」
        for (n in 1..7) {
            val v = FloatArray(n) { (it + 1).toFloat() }
            assertEquals("identical len=$n", 1f, SIMDUtils.cosineSimilarity(v, v), eps)
        }
        // 正交（长度 5，跨展开边界）→ 0
        val a = floatArrayOf(1f, 0f, 0f, 0f, 0f)
        val b = floatArrayOf(0f, 1f, 0f, 0f, 0f)
        assertEquals(0f, SIMDUtils.cosineSimilarity(a, b), eps)
    }

    @Test
    fun `cosineSimilarity guards mismatched and empty vectors`() {
        assertEquals(0f, SIMDUtils.cosineSimilarity(floatArrayOf(1f, 2f), floatArrayOf(1f)), 0f)
        assertEquals(0f, SIMDUtils.cosineSimilarity(floatArrayOf(), floatArrayOf()), 0f)
    }

    @Test
    fun `l2Norm computes magnitude and is zero for empty`() {
        assertEquals(5f, SIMDUtils.l2Norm(floatArrayOf(3f, 4f)), eps)
        assertEquals(0f, SIMDUtils.l2Norm(floatArrayOf()), 0f)
    }

    @Test
    fun `add is element-wise and requires equal dimension`() {
        assertArrayEquals(floatArrayOf(4f, 6f), SIMDUtils.add(floatArrayOf(1f, 2f), floatArrayOf(3f, 4f)), eps)
        try {
            SIMDUtils.add(floatArrayOf(1f, 2f), floatArrayOf(1f))
            org.junit.Assert.fail("add should require equal dimension")
        } catch (e: IllegalArgumentException) { /* expected */ }
    }

    @Test
    fun `scale multiplies each element by scalar`() {
        assertArrayEquals(floatArrayOf(2f, 4f, 6f), SIMDUtils.scale(floatArrayOf(1f, 2f, 3f), 2f), eps)
        assertArrayEquals(floatArrayOf(0f, 0f), SIMDUtils.scale(floatArrayOf(5f, 9f), 0f), eps)
    }

    @Test
    fun `mean averages vectors, empty list yields empty, dimension mismatch throws`() {
        assertArrayEquals(
            floatArrayOf(3f, 6f),
            SIMDUtils.mean(listOf(floatArrayOf(2f, 4f), floatArrayOf(4f, 8f))),
            eps,
        )
        assertEquals(0, SIMDUtils.mean(emptyList()).size)
        try {
            SIMDUtils.mean(listOf(floatArrayOf(1f, 2f), floatArrayOf(1f)))
            org.junit.Assert.fail("mean should require equal dimension")
        } catch (e: IllegalArgumentException) { /* expected */ }
    }
}

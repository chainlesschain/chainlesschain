package com.chainlesschain.android.feature.ai.data.rag

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * VectorMath工具类单元测试
 */
class VectorMathTest {

    @Test
    fun `cosineSimilarity returns 1 for identical vectors`() {
        val vec = floatArrayOf(1f, 2f, 3f, 4f)
        val similarity = VectorMath.cosineSimilarity(vec, vec)
        assertTrue(similarity > 0.99, "Identical vectors should have similarity close to 1")
    }

    @Test
    fun `cosineSimilarity returns 0 for orthogonal vectors`() {
        val vec1 = floatArrayOf(1f, 0f, 0f)
        val vec2 = floatArrayOf(0f, 1f, 0f)
        val similarity = VectorMath.cosineSimilarity(vec1, vec2)
        assertTrue(similarity < 0.01, "Orthogonal vectors should have similarity close to 0")
    }

    @Test
    fun `cosineSimilarity returns -1 for opposite vectors`() {
        val vec1 = floatArrayOf(1f, 2f, 3f)
        val vec2 = floatArrayOf(-1f, -2f, -3f)
        val similarity = VectorMath.cosineSimilarity(vec1, vec2)
        assertTrue(similarity < -0.99, "Opposite vectors should have similarity close to -1")
    }

    @Test
    fun `euclideanDistance returns 0 for identical vectors`() {
        val vec = floatArrayOf(1f, 2f, 3f, 4f)
        val distance = VectorMath.euclideanDistance(vec, vec)
        assertEquals(0.0, distance, 0.001)
    }

    @Test
    fun `euclideanDistance calculates correctly`() {
        val vec1 = floatArrayOf(0f, 0f, 0f)
        val vec2 = floatArrayOf(3f, 4f, 0f)
        val distance = VectorMath.euclideanDistance(vec1, vec2)
        assertEquals(5.0, distance, 0.001)
    }

    @Test
    fun `normalize returns unit vector`() {
        val vec = floatArrayOf(3f, 4f)
        val normalized = VectorMath.normalize(vec)

        // Check magnitude is 1
        val magnitude = kotlin.math.sqrt(normalized.sumOf { (it * it).toDouble() })
        assertEquals(1.0, magnitude, 0.001)
    }

    @Test
    fun `normalize preserves direction`() {
        val vec = floatArrayOf(3f, 4f)
        val normalized = VectorMath.normalize(vec)

        // Check direction is preserved (ratio of components is the same)
        assertEquals(vec[0] / vec[1], normalized[0] / normalized[1], 0.001f)
    }

    @Test
    fun `normalize handles zero vector`() {
        val vec = floatArrayOf(0f, 0f, 0f)
        val normalized = VectorMath.normalize(vec)

        // Should return the same zero vector without error
        assertTrue(normalized.all { it == 0f })
    }

    @Test
    fun `cosineSimilarity handles vectors of different magnitudes`() {
        val vec1 = floatArrayOf(1f, 0f, 0f)
        val vec2 = floatArrayOf(100f, 0f, 0f)
        val similarity = VectorMath.cosineSimilarity(vec1, vec2)
        assertTrue(similarity > 0.99, "Parallel vectors should have similarity close to 1")
    }

    @Test(expected = IllegalArgumentException::class)
    fun `cosineSimilarity throws for mismatched dimensions`() {
        val vec1 = floatArrayOf(1f, 2f, 3f)
        val vec2 = floatArrayOf(1f, 2f)
        VectorMath.cosineSimilarity(vec1, vec2)
    }

    @Test(expected = IllegalArgumentException::class)
    fun `euclideanDistance throws for mismatched dimensions`() {
        val vec1 = floatArrayOf(1f, 2f, 3f)
        val vec2 = floatArrayOf(1f, 2f)
        VectorMath.euclideanDistance(vec1, vec2)
    }
}

/**
 * TfIdfEmbedder单元测试
 */
class TfIdfEmbedderTest {

    private val embedder = TfIdfEmbedder()

    @Test
    fun `getDimension returns correct value`() {
        assertEquals(128, embedder.getDimension())
    }

    @Test
    fun `embed returns normalized vector`() = kotlinx.coroutines.test.runTest {
        val text = "Hello world"
        val vector = embedder.embed(text)

        // Check vector dimension
        assertEquals(128, vector.size)

        // Check normalization (magnitude should be close to 1 or 0)
        val magnitude = kotlin.math.sqrt(vector.sumOf { (it * it).toDouble() })
        assertTrue(magnitude <= 1.01, "Vector should be normalized")
    }

    @Test
    fun `embed returns same dimension for different text lengths`() = kotlinx.coroutines.test.runTest {
        val shortText = "Hi"
        val longText = "This is a much longer text with many more words to process"

        val shortVector = embedder.embed(shortText)
        val longVector = embedder.embed(longText)

        assertEquals(shortVector.size, longVector.size)
    }

    @Test
    fun `similar texts produce similar vectors`() = kotlinx.coroutines.test.runTest {
        val text1 = "Kotlin programming language"
        val text2 = "Kotlin programming tutorial"
        val text3 = "Python scripting basics"

        val vec1 = embedder.embed(text1)
        val vec2 = embedder.embed(text2)
        val vec3 = embedder.embed(text3)

        val sim12 = VectorMath.cosineSimilarity(vec1, vec2)
        val sim13 = VectorMath.cosineSimilarity(vec1, vec3)

        // Similar texts should have higher similarity
        assertTrue(sim12 > sim13, "Similar texts should have higher similarity")
    }

    @Test
    fun `updateDocumentFrequency updates statistics`() = kotlinx.coroutines.test.runTest {
        val documents = listOf(
            "Kotlin is great",
            "Java is also good",
            "Python is popular"
        )

        embedder.updateDocumentFrequency(documents)

        // After update, vectors should be influenced by document frequency
        val vec = embedder.embed("Kotlin programming")
        assertTrue(vec.any { it != 0f }, "Vector should have non-zero values")
    }

    @Test
    fun `embed handles Chinese text`() = kotlinx.coroutines.test.runTest {
        val chineseText = "这是一段中文文本"
        val vector = embedder.embed(chineseText)

        assertEquals(128, vector.size)
    }

    @Test
    fun `embed handles mixed Chinese and English`() = kotlinx.coroutines.test.runTest {
        val mixedText = "Hello 你好 World 世界"
        val vector = embedder.embed(mixedText)

        assertEquals(128, vector.size)
        assertTrue(vector.any { it != 0f }, "Mixed text should produce non-zero vector")
    }

    @Test
    fun `embed handles empty text`() = kotlinx.coroutines.test.runTest {
        val emptyText = ""
        val vector = embedder.embed(emptyText)

        assertEquals(128, vector.size)
    }

    @Test
    fun `embed handles special characters`() = kotlinx.coroutines.test.runTest {
        val specialText = "Hello! @#\$%^&*() World?"
        val vector = embedder.embed(specialText)

        assertEquals(128, vector.size)
    }
}

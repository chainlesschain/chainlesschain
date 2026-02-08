package com.chainlesschain.android.feature.ai

import com.chainlesschain.android.feature.ai.data.rag.OnnxModelManager
import com.chainlesschain.android.feature.ai.data.rag.TfIdfEmbedder
import com.chainlesschain.android.feature.ai.data.rag.VectorMath
import com.chainlesschain.android.feature.ai.data.rag.SentenceTransformerEmbedder
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * 向量嵌入器单元测试
 */
class VectorEmbedderTest {

    private lateinit var tfIdfEmbedder: TfIdfEmbedder

    @Before
    fun setup() {
        tfIdfEmbedder = TfIdfEmbedder()
    }

    @Test
    fun `TfIdfEmbedder should return vector of correct dimension`() = runTest {
        // Given
        val text = "这是一个测试文本"

        // When
        val vector = tfIdfEmbedder.embed(text)

        // Then
        assertEquals(128, vector.size)
        assertEquals(128, tfIdfEmbedder.getDimension())
    }

    @Test
    fun `TfIdfEmbedder should return normalized vectors`() = runTest {
        // Given
        val text = "测试文本"

        // When
        val vector = tfIdfEmbedder.embed(text)

        // Then - calculate magnitude
        var magnitude = 0.0
        for (value in vector) {
            magnitude += value * value
        }
        magnitude = kotlin.math.sqrt(magnitude)

        // Should be approximately 1.0 (normalized)
        assertTrue(magnitude > 0.99 && magnitude < 1.01, "Magnitude should be ~1.0, got $magnitude")
    }

    @Test
    fun `TfIdfEmbedder should produce similar vectors for similar text`() = runTest {
        // Given - use texts with overlapping words for tokenizer to find similarity
        val text1 = "kotlin coroutine programming async"
        val text2 = "kotlin coroutine development async"

        // When
        val vector1 = tfIdfEmbedder.embed(text1)
        val vector2 = tfIdfEmbedder.embed(text2)

        // Then - texts share 3/4 words, should have high similarity
        val similarity = VectorMath.cosineSimilarity(vector1, vector2)
        assertTrue(similarity > 0.5, "Similar texts should have high similarity: $similarity")
    }

    @Test
    fun `TfIdfEmbedder should produce different vectors for different text`() = runTest {
        // Given
        val text1 = "Kotlin协程编程"
        val text2 = "JavaScript前端开发"

        // When
        val vector1 = tfIdfEmbedder.embed(text1)
        val vector2 = tfIdfEmbedder.embed(text2)

        // Then
        val similarity = VectorMath.cosineSimilarity(vector1, vector2)
        assertTrue(similarity < 0.8, "Different texts should have lower similarity: $similarity")
    }

    @Test
    fun `TfIdfEmbedder should handle empty text`() = runTest {
        // Given
        val text = ""

        // When
        val vector = tfIdfEmbedder.embed(text)

        // Then
        assertEquals(128, vector.size)
        // All values should be 0
        assertTrue(vector.all { it == 0f })
    }

    @Test
    fun `TfIdfEmbedder should handle very long text`() = runTest {
        // Given
        val text = "测试 ".repeat(1000)

        // When
        val vector = tfIdfEmbedder.embed(text)

        // Then
        assertEquals(128, vector.size)
    }

    @Test
    fun `updateDocumentFrequency should improve embeddings`() = runTest {
        // Given
        val documents = listOf(
            "Kotlin协程是一种轻量级的并发编程方式",
            "Kotlin协程可以简化异步代码",
            "协程在Android开发中非常有用"
        )

        // When - train on documents
        tfIdfEmbedder.updateDocumentFrequency(documents)

        // Then - embeddings should be more meaningful
        val vector = tfIdfEmbedder.embed("Kotlin协程")
        assertEquals(128, vector.size)
        assertTrue(vector.any { it != 0f }, "Trained embeddings should have non-zero values")
    }

    @Test
    fun `SentenceTransformerEmbedder should return vector of correct dimension`() = runTest {
        // Given - model not available, will use fallback
        val modelManager = mockk<OnnxModelManager>()
        every { modelManager.isModelAvailable() } returns false
        val embedder = SentenceTransformerEmbedder(modelManager)
        val text = "测试文本"

        // When
        val vector = embedder.embed(text)

        // Then
        assertEquals(384, vector.size)
        assertEquals(384, embedder.getDimension())
    }

    @Test
    fun `SentenceTransformerEmbedder should return normalized vectors`() = runTest {
        // Given - model not available, will use fallback
        val modelManager = mockk<OnnxModelManager>()
        every { modelManager.isModelAvailable() } returns false
        val embedder = SentenceTransformerEmbedder(modelManager)
        val text = "测试文本"

        // When
        val vector = embedder.embed(text)

        // Then
        var magnitude = 0.0
        for (value in vector) {
            magnitude += value * value
        }
        magnitude = kotlin.math.sqrt(magnitude)

        assertTrue(magnitude > 0.99 && magnitude < 1.01, "Magnitude should be ~1.0")
    }

    @Test
    fun `SentenceTransformerEmbedder fallback should be deterministic`() = runTest {
        // Given - model not available, uses hash-based fallback
        val modelManager = mockk<OnnxModelManager>()
        every { modelManager.isModelAvailable() } returns false
        val embedder = SentenceTransformerEmbedder(modelManager)
        val text = "deterministic test"

        // When
        val vector1 = embedder.embed(text)
        val vector2 = embedder.embed(text)

        // Then - same input should produce same output
        assertTrue(vector1.contentEquals(vector2), "Fallback should be deterministic")
    }
}

/**
 * VectorMath工具类测试
 */
class VectorMathTest {

    @Test
    fun `cosineSimilarity should return 1 for identical vectors`() {
        // Given
        val vec1 = floatArrayOf(1f, 2f, 3f)
        val vec2 = floatArrayOf(1f, 2f, 3f)

        // When
        val similarity = VectorMath.cosineSimilarity(vec1, vec2)

        // Then
        assertEquals(1.0, similarity, 0.001)
    }

    @Test
    fun `cosineSimilarity should return 0 for orthogonal vectors`() {
        // Given
        val vec1 = floatArrayOf(1f, 0f, 0f)
        val vec2 = floatArrayOf(0f, 1f, 0f)

        // When
        val similarity = VectorMath.cosineSimilarity(vec1, vec2)

        // Then
        assertEquals(0.0, similarity, 0.001)
    }

    @Test
    fun `cosineSimilarity should return -1 for opposite vectors`() {
        // Given
        val vec1 = floatArrayOf(1f, 0f, 0f)
        val vec2 = floatArrayOf(-1f, 0f, 0f)

        // When
        val similarity = VectorMath.cosineSimilarity(vec1, vec2)

        // Then
        assertEquals(-1.0, similarity, 0.001)
    }

    @Test
    fun `cosineSimilarity should handle zero vectors`() {
        // Given
        val vec1 = floatArrayOf(0f, 0f, 0f)
        val vec2 = floatArrayOf(1f, 2f, 3f)

        // When
        val similarity = VectorMath.cosineSimilarity(vec1, vec2)

        // Then
        assertEquals(0.0, similarity, 0.001)
    }

    @Test
    fun `euclideanDistance should return 0 for identical vectors`() {
        // Given
        val vec1 = floatArrayOf(1f, 2f, 3f)
        val vec2 = floatArrayOf(1f, 2f, 3f)

        // When
        val distance = VectorMath.euclideanDistance(vec1, vec2)

        // Then
        assertEquals(0.0, distance, 0.001)
    }

    @Test
    fun `euclideanDistance should calculate correct distance`() {
        // Given
        val vec1 = floatArrayOf(0f, 0f, 0f)
        val vec2 = floatArrayOf(3f, 4f, 0f)

        // When
        val distance = VectorMath.euclideanDistance(vec1, vec2)

        // Then
        // Should be 5.0 (3-4-5 triangle)
        assertEquals(5.0, distance, 0.001)
    }

    @Test
    fun `normalize should create unit vector`() {
        // Given
        val vector = floatArrayOf(3f, 4f, 0f)

        // When
        val normalized = VectorMath.normalize(vector)

        // Then
        var magnitude = 0.0
        for (value in normalized) {
            magnitude += value * value
        }
        magnitude = kotlin.math.sqrt(magnitude)

        assertEquals(1.0, magnitude, 0.001)
        assertEquals(0.6f, normalized[0], 0.001f)  // 3/5
        assertEquals(0.8f, normalized[1], 0.001f)  // 4/5
    }

    @Test
    fun `normalize should handle zero vector`() {
        // Given
        val vector = floatArrayOf(0f, 0f, 0f)

        // When
        val normalized = VectorMath.normalize(vector)

        // Then
        assertTrue(normalized.all { it == 0f })
    }

    @Test(expected = IllegalArgumentException::class)
    fun `cosineSimilarity should throw for mismatched dimensions`() {
        // Given
        val vec1 = floatArrayOf(1f, 2f)
        val vec2 = floatArrayOf(1f, 2f, 3f)

        // When
        VectorMath.cosineSimilarity(vec1, vec2)

        // Then - should throw IllegalArgumentException
    }

    @Test(expected = IllegalArgumentException::class)
    fun `euclideanDistance should throw for mismatched dimensions`() {
        // Given
        val vec1 = floatArrayOf(1f, 2f)
        val vec2 = floatArrayOf(1f, 2f, 3f)

        // When
        VectorMath.euclideanDistance(vec1, vec2)

        // Then - should throw IllegalArgumentException
    }
}

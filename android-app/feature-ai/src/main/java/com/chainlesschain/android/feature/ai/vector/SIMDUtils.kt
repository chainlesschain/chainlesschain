package com.chainlesschain.android.feature.ai.vector

import kotlin.math.sqrt

/**
 * SIMD Utils
 *
 * Utility functions for vector similarity calculations.
 * While Android doesn't have direct SIMD access like iOS simd library,
 * these implementations are optimized for performance.
 *
 * Future optimization: Consider using Android NDK with NEON intrinsics
 * for actual SIMD acceleration on ARM processors.
 */
object SIMDUtils {

    /**
     * Calculate cosine similarity between two vectors
     *
     * @param a First vector
     * @param b Second vector
     * @return Cosine similarity in range [-1, 1], or 0 if vectors are invalid
     */
    fun cosineSimilarity(a: FloatArray, b: FloatArray): Float {
        if (a.size != b.size || a.isEmpty()) return 0f

        var dotProduct = 0f
        var normA = 0f
        var normB = 0f

        // Manual loop unrolling for better performance
        val len = a.size
        var i = 0

        // Process 4 elements at a time
        while (i + 3 < len) {
            dotProduct += a[i] * b[i] + a[i + 1] * b[i + 1] + a[i + 2] * b[i + 2] + a[i + 3] * b[i + 3]
            normA += a[i] * a[i] + a[i + 1] * a[i + 1] + a[i + 2] * a[i + 2] + a[i + 3] * a[i + 3]
            normB += b[i] * b[i] + b[i + 1] * b[i + 1] + b[i + 2] * b[i + 2] + b[i + 3] * b[i + 3]
            i += 4
        }

        // Handle remaining elements
        while (i < len) {
            dotProduct += a[i] * b[i]
            normA += a[i] * a[i]
            normB += b[i] * b[i]
            i++
        }

        val denominator = sqrt(normA) * sqrt(normB)
        return if (denominator > 0f) dotProduct / denominator else 0f
    }

    /**
     * Calculate Euclidean distance between two vectors
     *
     * @param a First vector
     * @param b Second vector
     * @return Euclidean distance, or Float.MAX_VALUE if vectors are invalid
     */
    fun euclideanDistance(a: FloatArray, b: FloatArray): Float {
        if (a.size != b.size || a.isEmpty()) return Float.MAX_VALUE

        var sum = 0f
        for (i in a.indices) {
            val diff = a[i] - b[i]
            sum += diff * diff
        }
        return sqrt(sum)
    }

    /**
     * Calculate dot product of two vectors
     *
     * @param a First vector
     * @param b Second vector
     * @return Dot product, or 0 if vectors are invalid
     */
    fun dotProduct(a: FloatArray, b: FloatArray): Float {
        if (a.size != b.size || a.isEmpty()) return 0f

        var result = 0f
        for (i in a.indices) {
            result += a[i] * b[i]
        }
        return result
    }

    /**
     * Normalize a vector to unit length
     *
     * @param vector Input vector
     * @return Normalized vector (unit vector)
     */
    fun normalize(vector: FloatArray): FloatArray {
        if (vector.isEmpty()) return floatArrayOf()

        var norm = 0f
        for (v in vector) {
            norm += v * v
        }
        norm = sqrt(norm)

        if (norm == 0f) return vector.copyOf()

        return FloatArray(vector.size) { vector[it] / norm }
    }

    /**
     * Calculate L2 norm (magnitude) of a vector
     *
     * @param vector Input vector
     * @return L2 norm (Euclidean length)
     */
    fun l2Norm(vector: FloatArray): Float {
        if (vector.isEmpty()) return 0f

        var sum = 0f
        for (v in vector) {
            sum += v * v
        }
        return sqrt(sum)
    }

    /**
     * Add two vectors element-wise
     *
     * @param a First vector
     * @param b Second vector
     * @return Sum vector
     */
    fun add(a: FloatArray, b: FloatArray): FloatArray {
        require(a.size == b.size) { "Vectors must have same dimension" }
        return FloatArray(a.size) { a[it] + b[it] }
    }

    /**
     * Multiply vector by scalar
     *
     * @param vector Input vector
     * @param scalar Scalar multiplier
     * @return Scaled vector
     */
    fun scale(vector: FloatArray, scalar: Float): FloatArray {
        return FloatArray(vector.size) { vector[it] * scalar }
    }

    /**
     * Calculate mean of a list of vectors
     *
     * @param vectors List of vectors
     * @return Mean vector
     */
    fun mean(vectors: List<FloatArray>): FloatArray {
        if (vectors.isEmpty()) return floatArrayOf()

        val dim = vectors[0].size
        val result = FloatArray(dim)

        for (vector in vectors) {
            require(vector.size == dim) { "All vectors must have same dimension" }
            for (i in vector.indices) {
                result[i] += vector[i]
            }
        }

        val count = vectors.size.toFloat()
        for (i in result.indices) {
            result[i] /= count
        }

        return result
    }
}

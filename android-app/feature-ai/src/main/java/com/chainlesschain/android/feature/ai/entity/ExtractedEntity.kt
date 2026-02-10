package com.chainlesschain.android.feature.ai.entity

import java.util.UUID

/**
 * Extracted Entity
 *
 * Represents a single entity extracted from text.
 */
data class ExtractedEntity(
    /**
     * Unique identifier for this entity
     */
    val id: String = UUID.randomUUID().toString(),

    /**
     * The entity text as it appears in the source
     */
    val text: String,

    /**
     * Normalized/canonical form of the entity
     */
    val normalizedText: String = text.trim().lowercase(),

    /**
     * Type of the entity
     */
    val type: EntityType,

    /**
     * Confidence score (0.0 to 1.0)
     */
    val confidence: Float = 1.0f,

    /**
     * Start position in source text
     */
    val startOffset: Int = -1,

    /**
     * End position in source text
     */
    val endOffset: Int = -1,

    /**
     * Source text snippet for context
     */
    val context: String? = null,

    /**
     * Additional metadata
     */
    val metadata: Map<String, String> = emptyMap()
) {
    /**
     * Check if this entity has valid position information
     */
    val hasPosition: Boolean
        get() = startOffset >= 0 && endOffset > startOffset

    /**
     * Get the length of the entity text
     */
    val length: Int
        get() = text.length

    /**
     * Check if this entity overlaps with another entity's position
     */
    fun overlaps(other: ExtractedEntity): Boolean {
        if (!hasPosition || !other.hasPosition) return false
        return startOffset < other.endOffset && endOffset > other.startOffset
    }

    /**
     * Calculate similarity with another entity
     */
    fun similarityTo(other: ExtractedEntity): Float {
        if (type != other.type) return 0f
        return jaccardSimilarity(normalizedText, other.normalizedText)
    }

    private fun jaccardSimilarity(a: String, b: String): Float {
        val setA = a.toSet()
        val setB = b.toSet()
        val intersection = setA.intersect(setB).size
        val union = setA.union(setB).size
        return if (union > 0) intersection.toFloat() / union else 0f
    }
}

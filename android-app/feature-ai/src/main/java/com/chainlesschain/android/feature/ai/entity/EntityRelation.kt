package com.chainlesschain.android.feature.ai.entity

import java.util.UUID

/**
 * Entity Relation
 *
 * Represents a relationship between two entities.
 */
data class EntityRelation(
    /**
     * Unique identifier for this relation
     */
    val id: String = UUID.randomUUID().toString(),

    /**
     * Source entity ID
     */
    val sourceEntityId: String,

    /**
     * Target entity ID
     */
    val targetEntityId: String,

    /**
     * Type of relationship
     */
    val relationType: RelationType,

    /**
     * Confidence score (0.0 to 1.0)
     */
    val confidence: Float = 1.0f,

    /**
     * Evidence text supporting this relation
     */
    val evidence: String? = null,

    /**
     * Additional metadata
     */
    val metadata: Map<String, String> = emptyMap()
) {
    /**
     * Check if this is a self-referential relation
     */
    val isSelfReference: Boolean
        get() = sourceEntityId == targetEntityId

    /**
     * Get the reverse relation (for non-directional relations)
     */
    fun reverse(): EntityRelation {
        return copy(
            id = UUID.randomUUID().toString(),
            sourceEntityId = targetEntityId,
            targetEntityId = sourceEntityId
        )
    }

    /**
     * Check if this relation involves a specific entity
     */
    fun involves(entityId: String): Boolean {
        return sourceEntityId == entityId || targetEntityId == entityId
    }
}

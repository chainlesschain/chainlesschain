package com.chainlesschain.android.feature.ai.vector

import com.chainlesschain.android.core.database.entity.VectorEmbeddingEntity
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * Vector Entry
 *
 * Represents a vector embedding entry with its content and metadata.
 * Used as the domain model for vector operations.
 */
data class VectorEntry(
    /**
     * Unique identifier
     */
    val id: String,

    /**
     * Namespace for organization
     */
    val namespace: String,

    /**
     * Original text content
     */
    val content: String,

    /**
     * Embedding vector
     */
    val embedding: FloatArray,

    /**
     * Optional metadata
     */
    val metadata: VectorMetadata? = null,

    /**
     * Source identifier
     */
    val sourceId: String? = null,

    /**
     * Source type
     */
    val sourceType: String? = null,

    /**
     * Creation timestamp
     */
    val createdAt: Long = System.currentTimeMillis()
) {
    /**
     * Convert to database entity
     */
    fun toEntity(contentHash: String): VectorEmbeddingEntity {
        return VectorEmbeddingEntity(
            id = id,
            namespace = namespace,
            content = content,
            contentHash = contentHash,
            embeddingJson = embedding.toJsonString(),
            dimension = embedding.size,
            metadataJson = metadata?.let { Json.encodeToString(VectorMetadata.serializer(), it) },
            sourceId = sourceId,
            sourceType = sourceType,
            createdAt = createdAt,
            updatedAt = System.currentTimeMillis()
        )
    }

    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (javaClass != other?.javaClass) return false

        other as VectorEntry

        if (id != other.id) return false
        if (!embedding.contentEquals(other.embedding)) return false

        return true
    }

    override fun hashCode(): Int {
        var result = id.hashCode()
        result = 31 * result + embedding.contentHashCode()
        return result
    }

    companion object {
        private val json = Json { ignoreUnknownKeys = true }

        /**
         * Create from database entity
         */
        fun fromEntity(entity: VectorEmbeddingEntity): VectorEntry {
            return VectorEntry(
                id = entity.id,
                namespace = entity.namespace,
                content = entity.content,
                embedding = entity.embeddingJson.parseEmbedding(),
                metadata = entity.metadataJson?.let {
                    try {
                        json.decodeFromString(VectorMetadata.serializer(), it)
                    } catch (e: Exception) {
                        null
                    }
                },
                sourceId = entity.sourceId,
                sourceType = entity.sourceType,
                createdAt = entity.createdAt
            )
        }
    }
}

/**
 * Vector metadata for storing additional information
 */
@Serializable
data class VectorMetadata(
    /**
     * Tags associated with this vector
     */
    val tags: List<String>? = null,

    /**
     * Category classification
     */
    val category: String? = null,

    /**
     * Language of the content
     */
    val language: String? = null,

    /**
     * Title or summary
     */
    val title: String? = null,

    /**
     * Additional custom properties
     */
    val properties: Map<String, String>? = null
)

/**
 * Search result with similarity score
 */
data class VectorSearchResult(
    /**
     * The matching vector entry
     */
    val entry: VectorEntry,

    /**
     * Cosine similarity score (0.0 to 1.0)
     */
    val score: Float
)

// Extension functions for embedding serialization
private fun FloatArray.toJsonString(): String {
    return joinToString(prefix = "[", postfix = "]", separator = ",") {
        it.toString()
    }
}

private fun String.parseEmbedding(): FloatArray {
    return try {
        val cleanedString = trim().removePrefix("[").removeSuffix("]")
        if (cleanedString.isBlank()) {
            floatArrayOf()
        } else {
            cleanedString.split(",").map { it.trim().toFloat() }.toFloatArray()
        }
    } catch (e: Exception) {
        floatArrayOf()
    }
}

package com.chainlesschain.android.core.database.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import java.util.UUID

/**
 * Vector Embedding Entity
 *
 * Stores vector embeddings for semantic search functionality.
 * Each entry contains an embedding vector, source content hash,
 * and optional metadata for filtering.
 */
@Entity(
    tableName = "vector_embeddings",
    indices = [
        Index(value = ["namespace"]),
        Index(value = ["contentHash"], unique = true),
        Index(value = ["createdAt"]),
        Index(value = ["namespace", "createdAt"])
    ]
)
data class VectorEmbeddingEntity(
    @PrimaryKey
    val id: String = UUID.randomUUID().toString(),

    /**
     * Namespace for organizing embeddings (e.g., "knowledge", "conversation", "file")
     */
    val namespace: String,

    /**
     * The original text content that was embedded
     */
    val content: String,

    /**
     * SHA-256 hash of the content for deduplication
     */
    val contentHash: String,

    /**
     * Serialized embedding vector as JSON array string
     * Format: "[0.1, 0.2, 0.3, ...]"
     */
    val embeddingJson: String,

    /**
     * Embedding dimension (e.g., 384, 768, 1536)
     */
    val dimension: Int,

    /**
     * Optional metadata as JSON object string
     * Can contain source file, tags, categories, etc.
     */
    val metadataJson: String? = null,

    /**
     * Source identifier (e.g., file path, URL, conversation ID)
     */
    val sourceId: String? = null,

    /**
     * Source type (e.g., "file", "url", "conversation", "note")
     */
    val sourceType: String? = null,

    /**
     * Creation timestamp
     */
    val createdAt: Long = System.currentTimeMillis(),

    /**
     * Last updated timestamp
     */
    val updatedAt: Long = System.currentTimeMillis()
)

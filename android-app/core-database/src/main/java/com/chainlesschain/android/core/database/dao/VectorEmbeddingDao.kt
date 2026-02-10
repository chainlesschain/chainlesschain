package com.chainlesschain.android.core.database.dao

import androidx.room.*
import com.chainlesschain.android.core.database.entity.VectorEmbeddingEntity
import kotlinx.coroutines.flow.Flow

/**
 * Data Access Object for Vector Embeddings
 *
 * Provides CRUD operations and queries for vector embedding storage.
 */
@Dao
interface VectorEmbeddingDao {

    // ===== Insert Operations =====

    /**
     * Insert a single embedding
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(embedding: VectorEmbeddingEntity): Long

    /**
     * Insert multiple embeddings
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(embeddings: List<VectorEmbeddingEntity>)

    // ===== Query Operations =====

    /**
     * Get embedding by ID
     */
    @Query("SELECT * FROM vector_embeddings WHERE id = :id")
    suspend fun getById(id: String): VectorEmbeddingEntity?

    /**
     * Get embedding by content hash (for deduplication)
     */
    @Query("SELECT * FROM vector_embeddings WHERE contentHash = :hash")
    suspend fun getByContentHash(hash: String): VectorEmbeddingEntity?

    /**
     * Get all embeddings in a namespace
     */
    @Query("SELECT * FROM vector_embeddings WHERE namespace = :namespace ORDER BY createdAt DESC")
    fun getByNamespace(namespace: String): Flow<List<VectorEmbeddingEntity>>

    /**
     * Get all embeddings in a namespace (sync)
     */
    @Query("SELECT * FROM vector_embeddings WHERE namespace = :namespace ORDER BY createdAt DESC")
    suspend fun getByNamespaceSync(namespace: String): List<VectorEmbeddingEntity>

    /**
     * Get embeddings by source ID
     */
    @Query("SELECT * FROM vector_embeddings WHERE sourceId = :sourceId ORDER BY createdAt DESC")
    suspend fun getBySourceId(sourceId: String): List<VectorEmbeddingEntity>

    /**
     * Get embeddings by source type
     */
    @Query("SELECT * FROM vector_embeddings WHERE sourceType = :sourceType ORDER BY createdAt DESC")
    suspend fun getBySourceType(sourceType: String): List<VectorEmbeddingEntity>

    /**
     * Get all embeddings (for bulk operations like search)
     */
    @Query("SELECT * FROM vector_embeddings ORDER BY createdAt DESC")
    suspend fun getAll(): List<VectorEmbeddingEntity>

    /**
     * Get embedding count by namespace
     */
    @Query("SELECT COUNT(*) FROM vector_embeddings WHERE namespace = :namespace")
    suspend fun countByNamespace(namespace: String): Int

    /**
     * Get total embedding count
     */
    @Query("SELECT COUNT(*) FROM vector_embeddings")
    suspend fun count(): Int

    // ===== Update Operations =====

    /**
     * Update an embedding
     */
    @Update
    suspend fun update(embedding: VectorEmbeddingEntity)

    /**
     * Update embedding metadata
     */
    @Query("UPDATE vector_embeddings SET metadataJson = :metadataJson, updatedAt = :updatedAt WHERE id = :id")
    suspend fun updateMetadata(id: String, metadataJson: String?, updatedAt: Long = System.currentTimeMillis())

    // ===== Delete Operations =====

    /**
     * Delete embedding by ID
     */
    @Query("DELETE FROM vector_embeddings WHERE id = :id")
    suspend fun deleteById(id: String)

    /**
     * Delete all embeddings in a namespace
     */
    @Query("DELETE FROM vector_embeddings WHERE namespace = :namespace")
    suspend fun deleteByNamespace(namespace: String)

    /**
     * Delete embeddings by source ID
     */
    @Query("DELETE FROM vector_embeddings WHERE sourceId = :sourceId")
    suspend fun deleteBySourceId(sourceId: String)

    /**
     * Delete embeddings older than timestamp
     */
    @Query("DELETE FROM vector_embeddings WHERE createdAt < :timestamp")
    suspend fun deleteOlderThan(timestamp: Long)

    /**
     * Delete all embeddings
     */
    @Query("DELETE FROM vector_embeddings")
    suspend fun deleteAll()

    // ===== Existence Checks =====

    /**
     * Check if content hash exists
     */
    @Query("SELECT EXISTS(SELECT 1 FROM vector_embeddings WHERE contentHash = :hash)")
    suspend fun existsByContentHash(hash: String): Boolean

    /**
     * Check if embedding exists by ID
     */
    @Query("SELECT EXISTS(SELECT 1 FROM vector_embeddings WHERE id = :id)")
    suspend fun existsById(id: String): Boolean
}

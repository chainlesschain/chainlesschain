package com.chainlesschain.android.feature.ai.vector

import com.chainlesschain.android.core.database.dao.VectorEmbeddingDao
import com.chainlesschain.android.core.database.entity.VectorEmbeddingEntity
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.withContext
import java.security.MessageDigest
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Vector Store Repository
 *
 * Repository layer for vector embedding operations.
 * Provides data access abstraction over Room database.
 */
@Singleton
class VectorStoreRepository @Inject constructor(
    private val vectorEmbeddingDao: VectorEmbeddingDao
) {

    // ===== Insert Operations =====

    /**
     * Insert a vector entry
     *
     * @param entry Vector entry to insert
     * @return True if insert was successful
     */
    suspend fun insert(entry: VectorEntry): Boolean = withContext(Dispatchers.IO) {
        try {
            val contentHash = computeHash(entry.content)

            // Check for duplicate
            if (vectorEmbeddingDao.existsByContentHash(contentHash)) {
                return@withContext false
            }

            val entity = entry.toEntity(contentHash)
            vectorEmbeddingDao.insert(entity)
            true
        } catch (e: Exception) {
            false
        }
    }

    /**
     * Insert or update a vector entry
     *
     * @param entry Vector entry to upsert
     */
    suspend fun upsert(entry: VectorEntry) = withContext(Dispatchers.IO) {
        val contentHash = computeHash(entry.content)
        val entity = entry.toEntity(contentHash)
        vectorEmbeddingDao.insert(entity)
    }

    /**
     * Batch insert vector entries
     *
     * @param entries List of vector entries
     * @return Number of successfully inserted entries
     */
    suspend fun insertBatch(entries: List<VectorEntry>): Int = withContext(Dispatchers.IO) {
        var count = 0
        val entitiesToInsert = mutableListOf<VectorEmbeddingEntity>()

        for (entry in entries) {
            val contentHash = computeHash(entry.content)
            if (!vectorEmbeddingDao.existsByContentHash(contentHash)) {
                entitiesToInsert.add(entry.toEntity(contentHash))
                count++
            }
        }

        if (entitiesToInsert.isNotEmpty()) {
            vectorEmbeddingDao.insertAll(entitiesToInsert)
        }

        count
    }

    // ===== Query Operations =====

    /**
     * Get entry by ID
     */
    suspend fun getById(id: String): VectorEntry? = withContext(Dispatchers.IO) {
        vectorEmbeddingDao.getById(id)?.let { VectorEntry.fromEntity(it) }
    }

    /**
     * Get entry by content hash
     */
    suspend fun getByContent(content: String): VectorEntry? = withContext(Dispatchers.IO) {
        val hash = computeHash(content)
        vectorEmbeddingDao.getByContentHash(hash)?.let { VectorEntry.fromEntity(it) }
    }

    /**
     * Get all entries in a namespace (Flow)
     */
    fun getByNamespace(namespace: String): Flow<List<VectorEntry>> {
        return vectorEmbeddingDao.getByNamespace(namespace).map { entities ->
            entities.map { VectorEntry.fromEntity(it) }
        }
    }

    /**
     * Get all entries in a namespace (suspend)
     */
    suspend fun getByNamespaceSync(namespace: String): List<VectorEntry> = withContext(Dispatchers.IO) {
        vectorEmbeddingDao.getByNamespaceSync(namespace).map { VectorEntry.fromEntity(it) }
    }

    /**
     * Get entries by source ID
     */
    suspend fun getBySourceId(sourceId: String): List<VectorEntry> = withContext(Dispatchers.IO) {
        vectorEmbeddingDao.getBySourceId(sourceId).map { VectorEntry.fromEntity(it) }
    }

    /**
     * Get entries by source type
     */
    suspend fun getBySourceType(sourceType: String): List<VectorEntry> = withContext(Dispatchers.IO) {
        vectorEmbeddingDao.getBySourceType(sourceType).map { VectorEntry.fromEntity(it) }
    }

    /**
     * Get all entries
     */
    suspend fun getAll(): List<VectorEntry> = withContext(Dispatchers.IO) {
        vectorEmbeddingDao.getAll().map { VectorEntry.fromEntity(it) }
    }

    /**
     * Get count by namespace
     */
    suspend fun countByNamespace(namespace: String): Int = withContext(Dispatchers.IO) {
        vectorEmbeddingDao.countByNamespace(namespace)
    }

    /**
     * Get total count
     */
    suspend fun count(): Int = withContext(Dispatchers.IO) {
        vectorEmbeddingDao.count()
    }

    // ===== Update Operations =====

    /**
     * Update entry metadata
     */
    suspend fun updateMetadata(id: String, metadata: VectorMetadata) = withContext(Dispatchers.IO) {
        val metadataJson = kotlinx.serialization.json.Json.encodeToString(
            VectorMetadata.serializer(),
            metadata
        )
        vectorEmbeddingDao.updateMetadata(id, metadataJson)
    }

    // ===== Delete Operations =====

    /**
     * Delete entry by ID
     */
    suspend fun deleteById(id: String) = withContext(Dispatchers.IO) {
        vectorEmbeddingDao.deleteById(id)
    }

    /**
     * Delete entries by namespace
     */
    suspend fun deleteByNamespace(namespace: String) = withContext(Dispatchers.IO) {
        vectorEmbeddingDao.deleteByNamespace(namespace)
    }

    /**
     * Delete entries by source ID
     */
    suspend fun deleteBySourceId(sourceId: String) = withContext(Dispatchers.IO) {
        vectorEmbeddingDao.deleteBySourceId(sourceId)
    }

    /**
     * Delete entries older than timestamp
     */
    suspend fun deleteOlderThan(timestamp: Long) = withContext(Dispatchers.IO) {
        vectorEmbeddingDao.deleteOlderThan(timestamp)
    }

    /**
     * Delete all entries
     */
    suspend fun deleteAll() = withContext(Dispatchers.IO) {
        vectorEmbeddingDao.deleteAll()
    }

    // ===== Existence Checks =====

    /**
     * Check if content already exists
     */
    suspend fun existsByContent(content: String): Boolean = withContext(Dispatchers.IO) {
        val hash = computeHash(content)
        vectorEmbeddingDao.existsByContentHash(hash)
    }

    /**
     * Check if ID exists
     */
    suspend fun existsById(id: String): Boolean = withContext(Dispatchers.IO) {
        vectorEmbeddingDao.existsById(id)
    }

    // ===== Utility Functions =====

    /**
     * Compute SHA-256 hash of content
     */
    private fun computeHash(content: String): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val hashBytes = digest.digest(content.toByteArray(Charsets.UTF_8))
        return hashBytes.joinToString("") { "%02x".format(it) }
    }
}

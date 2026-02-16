package com.chainlesschain.android.feature.ai.vector

import timber.log.Timber
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Vector Store
 *
 * Local vector database for semantic search functionality.
 * Provides high-level API for storing, searching, and managing
 * vector embeddings with support for namespaces, metadata filtering,
 * and efficient Top-K retrieval.
 *
 * Features:
 * - Room persistence for embeddings
 * - MinHeap-based efficient Top-K search
 * - Namespace organization
 * - Metadata filtering
 * - Batch operations
 * - MMR (Maximal Marginal Relevance) for diverse results
 *
 * Aligns with iOS implementation patterns.
 */
@Singleton
class VectorStore @Inject constructor(
    private val repository: VectorStoreRepository
) {

    companion object {
        const val DEFAULT_NAMESPACE = "default"
        const val DEFAULT_TOP_K = 10
        const val DEFAULT_THRESHOLD = 0.5f
    }

    // In-memory cache for frequently accessed vectors
    private val cache = mutableMapOf<String, List<VectorEntry>>()
    private val cacheMutex = Mutex()

    // Store statistics
    private val _stats = MutableStateFlow(VectorStoreStats())
    val stats: StateFlow<VectorStoreStats> = _stats.asStateFlow()

    // ===== Add Operations =====

    /**
     * Add a text with its embedding to the store
     *
     * @param content Text content
     * @param embedding Vector embedding
     * @param namespace Namespace for organization
     * @param metadata Optional metadata
     * @param sourceId Optional source identifier
     * @param sourceType Optional source type
     * @return ID of the created entry, or null if duplicate
     */
    suspend fun add(
        content: String,
        embedding: FloatArray,
        namespace: String = DEFAULT_NAMESPACE,
        metadata: VectorMetadata? = null,
        sourceId: String? = null,
        sourceType: String? = null
    ): String? = withContext(Dispatchers.IO) {
        val id = UUID.randomUUID().toString()
        val entry = VectorEntry(
            id = id,
            namespace = namespace,
            content = content,
            embedding = embedding,
            metadata = metadata,
            sourceId = sourceId,
            sourceType = sourceType
        )

        val success = repository.insert(entry)
        if (success) {
            invalidateCache(namespace)
            updateStats()
            Timber.d("Added vector entry: $id to namespace: $namespace")
            id
        } else {
            Timber.d("Duplicate content, skipped: ${content.take(50)}...")
            null
        }
    }

    /**
     * Add or update an entry
     */
    suspend fun upsert(
        content: String,
        embedding: FloatArray,
        namespace: String = DEFAULT_NAMESPACE,
        metadata: VectorMetadata? = null,
        sourceId: String? = null,
        sourceType: String? = null
    ): String = withContext(Dispatchers.IO) {
        val id = UUID.randomUUID().toString()
        val entry = VectorEntry(
            id = id,
            namespace = namespace,
            content = content,
            embedding = embedding,
            metadata = metadata,
            sourceId = sourceId,
            sourceType = sourceType
        )

        repository.upsert(entry)
        invalidateCache(namespace)
        updateStats()
        id
    }

    /**
     * Batch add entries
     *
     * @param entries List of (content, embedding) pairs with optional metadata
     * @param namespace Namespace for all entries
     * @return Number of successfully added entries
     */
    suspend fun addBatch(
        entries: List<AddBatchEntry>,
        namespace: String = DEFAULT_NAMESPACE
    ): Int = withContext(Dispatchers.IO) {
        val vectorEntries = entries.map { entry ->
            VectorEntry(
                id = UUID.randomUUID().toString(),
                namespace = namespace,
                content = entry.content,
                embedding = entry.embedding,
                metadata = entry.metadata,
                sourceId = entry.sourceId,
                sourceType = entry.sourceType
            )
        }

        val count = repository.insertBatch(vectorEntries)
        if (count > 0) {
            invalidateCache(namespace)
            updateStats()
            Timber.d("Batch added $count entries to namespace: $namespace")
        }
        count
    }

    // ===== Search Operations =====

    /**
     * Search for similar vectors
     *
     * @param queryEmbedding Query vector
     * @param namespace Namespace to search in (null for all)
     * @param topK Number of results
     * @param threshold Minimum similarity threshold
     * @return List of search results
     */
    suspend fun search(
        queryEmbedding: FloatArray,
        namespace: String? = null,
        topK: Int = DEFAULT_TOP_K,
        threshold: Float = DEFAULT_THRESHOLD
    ): List<VectorSearchResult> = withContext(Dispatchers.IO) {
        val candidates = if (namespace != null) {
            getCached(namespace)
        } else {
            repository.getAll()
        }

        VectorSearch.searchByNamespace(queryEmbedding, candidates, namespace, topK, threshold)
    }

    /**
     * Search with metadata filter
     *
     * @param queryEmbedding Query vector
     * @param filter Metadata filter predicate
     * @param namespace Optional namespace filter
     * @param topK Number of results
     * @param threshold Minimum similarity threshold
     * @return Filtered search results
     */
    suspend fun searchWithFilter(
        queryEmbedding: FloatArray,
        filter: (VectorMetadata?) -> Boolean,
        namespace: String? = null,
        topK: Int = DEFAULT_TOP_K,
        threshold: Float = DEFAULT_THRESHOLD
    ): List<VectorSearchResult> = withContext(Dispatchers.IO) {
        val candidates = if (namespace != null) {
            getCached(namespace)
        } else {
            repository.getAll()
        }

        VectorSearch.searchWithFilter(queryEmbedding, candidates, filter, topK, threshold)
    }

    /**
     * Search with tag filter
     */
    suspend fun searchByTag(
        queryEmbedding: FloatArray,
        tag: String,
        namespace: String? = null,
        topK: Int = DEFAULT_TOP_K,
        threshold: Float = DEFAULT_THRESHOLD
    ): List<VectorSearchResult> {
        return searchWithFilter(
            queryEmbedding = queryEmbedding,
            filter = { metadata -> metadata?.tags?.contains(tag) == true },
            namespace = namespace,
            topK = topK,
            threshold = threshold
        )
    }

    /**
     * Search with category filter
     */
    suspend fun searchByCategory(
        queryEmbedding: FloatArray,
        category: String,
        namespace: String? = null,
        topK: Int = DEFAULT_TOP_K,
        threshold: Float = DEFAULT_THRESHOLD
    ): List<VectorSearchResult> {
        return searchWithFilter(
            queryEmbedding = queryEmbedding,
            filter = { metadata -> metadata?.category == category },
            namespace = namespace,
            topK = topK,
            threshold = threshold
        )
    }

    /**
     * Search with diversity (MMR)
     *
     * @param queryEmbedding Query vector
     * @param namespace Optional namespace filter
     * @param topK Number of results
     * @param lambda Diversity trade-off (1.0 = pure relevance, 0.0 = pure diversity)
     * @param threshold Minimum similarity threshold
     * @return Diversified search results
     */
    suspend fun searchDiverse(
        queryEmbedding: FloatArray,
        namespace: String? = null,
        topK: Int = DEFAULT_TOP_K,
        lambda: Float = 0.7f,
        threshold: Float = DEFAULT_THRESHOLD
    ): List<VectorSearchResult> = withContext(Dispatchers.IO) {
        val candidates = if (namespace != null) {
            getCached(namespace)
        } else {
            repository.getAll()
        }

        VectorSearch.searchMMR(queryEmbedding, candidates, topK, lambda, threshold)
    }

    // ===== Get Operations =====

    /**
     * Get entry by ID
     */
    suspend fun getById(id: String): VectorEntry? {
        return repository.getById(id)
    }

    /**
     * Get entries by namespace (Flow)
     */
    fun getByNamespace(namespace: String): Flow<List<VectorEntry>> {
        return repository.getByNamespace(namespace)
    }

    /**
     * Get entries by source ID
     */
    suspend fun getBySourceId(sourceId: String): List<VectorEntry> {
        return repository.getBySourceId(sourceId)
    }

    /**
     * Get count by namespace
     */
    suspend fun countByNamespace(namespace: String): Int {
        return repository.countByNamespace(namespace)
    }

    /**
     * Get total count
     */
    suspend fun count(): Int {
        return repository.count()
    }

    // ===== Update Operations =====

    /**
     * Update entry metadata
     */
    suspend fun updateMetadata(id: String, metadata: VectorMetadata) {
        repository.updateMetadata(id, metadata)
        // Invalidate all caches since we don't know which namespace
        invalidateAllCaches()
    }

    // ===== Delete Operations =====

    /**
     * Delete entry by ID
     */
    suspend fun deleteById(id: String) {
        repository.deleteById(id)
        invalidateAllCaches()
        updateStats()
    }

    /**
     * Delete entries by namespace
     */
    suspend fun deleteByNamespace(namespace: String) {
        repository.deleteByNamespace(namespace)
        invalidateCache(namespace)
        updateStats()
        Timber.d("Deleted all entries in namespace: $namespace")
    }

    /**
     * Delete entries by source ID
     */
    suspend fun deleteBySourceId(sourceId: String) {
        repository.deleteBySourceId(sourceId)
        invalidateAllCaches()
        updateStats()
    }

    /**
     * Delete entries older than timestamp
     */
    suspend fun deleteOlderThan(timestamp: Long) {
        repository.deleteOlderThan(timestamp)
        invalidateAllCaches()
        updateStats()
    }

    /**
     * Clear all entries
     */
    suspend fun clear() {
        repository.deleteAll()
        invalidateAllCaches()
        updateStats()
        Timber.d("Cleared all entries")
    }

    // ===== Utility Operations =====

    /**
     * Check if content exists
     */
    suspend fun exists(content: String): Boolean {
        return repository.existsByContent(content)
    }

    /**
     * Get list of namespaces
     */
    suspend fun getNamespaces(): List<String> = withContext(Dispatchers.IO) {
        repository.getAll()
            .map { it.namespace }
            .distinct()
            .sorted()
    }

    // ===== Private Helpers =====

    private suspend fun getCached(namespace: String): List<VectorEntry> {
        return cacheMutex.withLock {
            cache.getOrPut(namespace) {
                repository.getByNamespaceSync(namespace)
            }
        }
    }

    private suspend fun invalidateCache(namespace: String) {
        cacheMutex.withLock {
            cache.remove(namespace)
        }
    }

    private suspend fun invalidateAllCaches() {
        cacheMutex.withLock {
            cache.clear()
        }
    }

    private suspend fun updateStats() {
        val totalCount = repository.count()
        val namespaces = getNamespaces()
        _stats.value = VectorStoreStats(
            totalEntries = totalCount,
            namespaceCount = namespaces.size,
            namespaces = namespaces
        )
    }
}

/**
 * Vector store statistics
 */
data class VectorStoreStats(
    val totalEntries: Int = 0,
    val namespaceCount: Int = 0,
    val namespaces: List<String> = emptyList()
)

/**
 * Batch add entry
 */
data class AddBatchEntry(
    val content: String,
    val embedding: FloatArray,
    val metadata: VectorMetadata? = null,
    val sourceId: String? = null,
    val sourceType: String? = null
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (javaClass != other?.javaClass) return false

        other as AddBatchEntry
        return content == other.content && embedding.contentEquals(other.embedding)
    }

    override fun hashCode(): Int {
        var result = content.hashCode()
        result = 31 * result + embedding.contentHashCode()
        return result
    }
}

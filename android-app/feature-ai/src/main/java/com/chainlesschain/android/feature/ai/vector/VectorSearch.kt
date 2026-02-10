package com.chainlesschain.android.feature.ai.vector

import java.util.PriorityQueue

/**
 * Vector Search
 *
 * Implements efficient Top-K similarity search using MinHeap.
 * Provides both exact search and approximate nearest neighbor search.
 */
object VectorSearch {

    /**
     * Search for top-K most similar vectors using MinHeap
     *
     * @param query Query embedding vector
     * @param candidates List of candidate entries to search
     * @param k Number of top results to return
     * @param threshold Minimum similarity threshold (0.0 to 1.0)
     * @return List of search results sorted by similarity (highest first)
     */
    fun searchTopK(
        query: FloatArray,
        candidates: List<VectorEntry>,
        k: Int,
        threshold: Float = 0f
    ): List<VectorSearchResult> {
        if (candidates.isEmpty() || k <= 0) return emptyList()

        // MinHeap to maintain top-K elements (lowest score at top)
        val minHeap = PriorityQueue<VectorSearchResult>(k) { a, b ->
            a.score.compareTo(b.score)
        }

        for (candidate in candidates) {
            val score = SIMDUtils.cosineSimilarity(query, candidate.embedding)

            if (score < threshold) continue

            if (minHeap.size < k) {
                minHeap.offer(VectorSearchResult(candidate, score))
            } else if (score > minHeap.peek().score) {
                minHeap.poll()
                minHeap.offer(VectorSearchResult(candidate, score))
            }
        }

        // Convert heap to sorted list (highest score first)
        return minHeap.toList().sortedByDescending { it.score }
    }

    /**
     * Search with namespace filtering
     *
     * @param query Query embedding vector
     * @param candidates List of candidate entries
     * @param namespace Namespace to filter by (null for all)
     * @param k Number of top results
     * @param threshold Minimum similarity threshold
     * @return Filtered search results
     */
    fun searchByNamespace(
        query: FloatArray,
        candidates: List<VectorEntry>,
        namespace: String?,
        k: Int,
        threshold: Float = 0f
    ): List<VectorSearchResult> {
        val filtered = if (namespace != null) {
            candidates.filter { it.namespace == namespace }
        } else {
            candidates
        }
        return searchTopK(query, filtered, k, threshold)
    }

    /**
     * Search with metadata filtering
     *
     * @param query Query embedding vector
     * @param candidates List of candidate entries
     * @param filter Metadata filter predicate
     * @param k Number of top results
     * @param threshold Minimum similarity threshold
     * @return Filtered search results
     */
    fun searchWithFilter(
        query: FloatArray,
        candidates: List<VectorEntry>,
        filter: (VectorMetadata?) -> Boolean,
        k: Int,
        threshold: Float = 0f
    ): List<VectorSearchResult> {
        val filtered = candidates.filter { filter(it.metadata) }
        return searchTopK(query, filtered, k, threshold)
    }

    /**
     * Batch search for multiple queries
     *
     * @param queries List of query vectors
     * @param candidates List of candidate entries
     * @param k Number of top results per query
     * @param threshold Minimum similarity threshold
     * @return Map of query index to search results
     */
    fun batchSearch(
        queries: List<FloatArray>,
        candidates: List<VectorEntry>,
        k: Int,
        threshold: Float = 0f
    ): Map<Int, List<VectorSearchResult>> {
        return queries.mapIndexed { index, query ->
            index to searchTopK(query, candidates, k, threshold)
        }.toMap()
    }

    /**
     * Diversified search using Maximal Marginal Relevance (MMR)
     *
     * Balances relevance with diversity to avoid redundant results.
     *
     * @param query Query embedding vector
     * @param candidates List of candidate entries
     * @param k Number of results
     * @param lambda Trade-off between relevance and diversity (0.0 to 1.0)
     *              1.0 = pure relevance, 0.0 = pure diversity
     * @param threshold Minimum similarity threshold
     * @return Diversified search results
     */
    fun searchMMR(
        query: FloatArray,
        candidates: List<VectorEntry>,
        k: Int,
        lambda: Float = 0.7f,
        threshold: Float = 0f
    ): List<VectorSearchResult> {
        if (candidates.isEmpty() || k <= 0) return emptyList()

        // Calculate initial similarities
        val similarities = candidates.map { candidate ->
            candidate to SIMDUtils.cosineSimilarity(query, candidate.embedding)
        }.filter { it.second >= threshold }

        if (similarities.isEmpty()) return emptyList()

        val selected = mutableListOf<VectorSearchResult>()
        val remaining = similarities.toMutableList()

        // Select first item (most relevant)
        val first = remaining.maxByOrNull { it.second }!!
        selected.add(VectorSearchResult(first.first, first.second))
        remaining.remove(first)

        // Iteratively select remaining items
        while (selected.size < k && remaining.isNotEmpty()) {
            var bestScore = Float.MIN_VALUE
            var bestCandidate: Pair<VectorEntry, Float>? = null

            for ((candidate, relevance) in remaining) {
                // Calculate max similarity to already selected items
                val maxSimilarityToSelected = selected.maxOfOrNull { selected ->
                    SIMDUtils.cosineSimilarity(candidate.embedding, selected.entry.embedding)
                } ?: 0f

                // MMR score: lambda * relevance - (1 - lambda) * max_similarity_to_selected
                val mmrScore = lambda * relevance - (1 - lambda) * maxSimilarityToSelected

                if (mmrScore > bestScore) {
                    bestScore = mmrScore
                    bestCandidate = candidate to relevance
                }
            }

            if (bestCandidate != null) {
                selected.add(VectorSearchResult(bestCandidate.first, bestCandidate.second))
                remaining.remove(bestCandidate)
            } else {
                break
            }
        }

        return selected
    }

    /**
     * Calculate similarity matrix between two sets of vectors
     *
     * @param setA First set of vectors
     * @param setB Second set of vectors
     * @return 2D array of similarities (setA.size x setB.size)
     */
    fun similarityMatrix(
        setA: List<FloatArray>,
        setB: List<FloatArray>
    ): Array<FloatArray> {
        return Array(setA.size) { i ->
            FloatArray(setB.size) { j ->
                SIMDUtils.cosineSimilarity(setA[i], setB[j])
            }
        }
    }
}

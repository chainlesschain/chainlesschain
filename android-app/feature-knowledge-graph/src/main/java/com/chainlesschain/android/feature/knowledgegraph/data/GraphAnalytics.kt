package com.chainlesschain.android.feature.knowledgegraph.data

import com.chainlesschain.android.feature.knowledgegraph.domain.model.*
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.math.pow

/**
 * Graph analytics algorithms
 * Implements centrality measures, community detection, and path finding
 */
@Singleton
class GraphAnalytics @Inject constructor() {

    /**
     * Calculate degree centrality for all nodes
     */
    fun calculateDegreeCentrality(graph: GraphData): Map<String, Double> {
        val degrees = mutableMapOf<String, Int>()

        graph.nodes.forEach { node ->
            degrees[node.id] = 0
        }

        graph.edges.forEach { edge ->
            degrees[edge.source] = (degrees[edge.source] ?: 0) + 1
            if (!edge.directed) {
                degrees[edge.target] = (degrees[edge.target] ?: 0) + 1
            } else {
                degrees[edge.target] = (degrees[edge.target] ?: 0) + 1
            }
        }

        val maxDegree = degrees.values.maxOrNull()?.toDouble() ?: 1.0

        return degrees.mapValues { (_, degree) ->
            if (maxDegree > 0) degree / maxDegree else 0.0
        }
    }

    /**
     * Calculate closeness centrality using BFS
     */
    fun calculateClosenessCentrality(graph: GraphData): Map<String, Double> {
        val result = mutableMapOf<String, Double>()
        val adjacencyList = buildAdjacencyList(graph)

        graph.nodes.forEach { node ->
            val distances = bfsDistances(node.id, adjacencyList)
            val totalDistance = distances.values.sum()

            result[node.id] = if (totalDistance > 0) {
                (distances.size - 1).toDouble() / totalDistance
            } else {
                0.0
            }
        }

        // Normalize
        val maxValue = result.values.maxOrNull() ?: 1.0
        return result.mapValues { (_, v) -> if (maxValue > 0) v / maxValue else 0.0 }
    }

    /**
     * Calculate betweenness centrality
     */
    fun calculateBetweennessCentrality(graph: GraphData): Map<String, Double> {
        val betweenness = mutableMapOf<String, Double>()
        graph.nodes.forEach { betweenness[it.id] = 0.0 }

        val adjacencyList = buildAdjacencyList(graph)

        // For each pair of nodes, find shortest paths and count
        graph.nodes.forEach { source ->
            graph.nodes.forEach { target ->
                if (source.id != target.id) {
                    val paths = findAllShortestPaths(source.id, target.id, adjacencyList)
                    if (paths.isNotEmpty()) {
                        val pathCount = paths.size.toDouble()
                        paths.forEach { path ->
                            // Count intermediate nodes
                            path.drop(1).dropLast(1).forEach { nodeId ->
                                betweenness[nodeId] = (betweenness[nodeId] ?: 0.0) + (1.0 / pathCount)
                            }
                        }
                    }
                }
            }
        }

        // Normalize
        val maxValue = betweenness.values.maxOrNull() ?: 1.0
        return betweenness.mapValues { (_, v) -> if (maxValue > 0) v / maxValue else 0.0 }
    }

    /**
     * Calculate PageRank
     */
    fun calculatePageRank(
        graph: GraphData,
        damping: Double = 0.85,
        iterations: Int = 100,
        tolerance: Double = 1e-6
    ): Map<String, Double> {
        val n = graph.nodes.size
        if (n == 0) return emptyMap()

        val adjacencyList = buildOutgoingAdjacencyList(graph)
        var pageRank = graph.nodes.associate { it.id to 1.0 / n }.toMutableMap()

        repeat(iterations) {
            val newPageRank = mutableMapOf<String, Double>()
            var diff = 0.0

            graph.nodes.forEach { node ->
                var sum = 0.0

                // Find nodes that link to this node
                graph.edges.filter { it.target == node.id }.forEach { edge ->
                    val outDegree = adjacencyList[edge.source]?.size ?: 1
                    sum += (pageRank[edge.source] ?: 0.0) / outDegree
                }

                val newValue = (1 - damping) / n + damping * sum
                newPageRank[node.id] = newValue
                diff += kotlin.math.abs(newValue - (pageRank[node.id] ?: 0.0))
            }

            pageRank = newPageRank

            if (diff < tolerance) {
                return@repeat
            }
        }

        return pageRank
    }

    /**
     * Detect communities using label propagation
     */
    fun detectCommunities(graph: GraphData): List<Community> {
        if (graph.nodes.isEmpty()) return emptyList()

        // Initialize each node with its own label
        val labels = graph.nodes.associate { it.id to it.id }.toMutableMap()
        val adjacencyList = buildAdjacencyList(graph)

        var changed = true
        var iterations = 0
        val maxIterations = 100

        while (changed && iterations < maxIterations) {
            changed = false
            iterations++

            graph.nodes.shuffled().forEach { node ->
                val neighborLabels = adjacencyList[node.id]?.mapNotNull { labels[it] } ?: emptyList()

                if (neighborLabels.isNotEmpty()) {
                    // Find most common label among neighbors
                    val mostCommonLabel = neighborLabels
                        .groupingBy { it }
                        .eachCount()
                        .maxByOrNull { it.value }?.key

                    if (mostCommonLabel != null && mostCommonLabel != labels[node.id]) {
                        labels[node.id] = mostCommonLabel
                        changed = true
                    }
                }
            }
        }

        // Group nodes by label
        val communities = labels.entries
            .groupBy { it.value }
            .map { (label, entries) ->
                Community(
                    id = label,
                    nodeIds = entries.map { it.key },
                    label = "Community ${label.take(8)}"
                )
            }

        return communities
    }

    /**
     * Find shortest path between two nodes using BFS
     */
    fun findShortestPath(
        graph: GraphData,
        fromId: String,
        toId: String
    ): List<GraphNode>? {
        if (fromId == toId) {
            return listOfNotNull(graph.getNode(fromId))
        }

        val adjacencyList = buildAdjacencyList(graph)
        val visited = mutableSetOf<String>()
        val queue = mutableListOf(listOf(fromId))

        while (queue.isNotEmpty()) {
            val path = queue.removeAt(0)
            val current = path.last()

            if (current == toId) {
                return path.mapNotNull { graph.getNode(it) }
            }

            if (current !in visited) {
                visited.add(current)
                adjacencyList[current]?.forEach { neighbor ->
                    if (neighbor !in visited) {
                        queue.add(path + neighbor)
                    }
                }
            }
        }

        return null
    }

    /**
     * Calculate all centrality metrics
     */
    fun calculateAllCentralities(graph: GraphData): List<CentralityResult> {
        val degree = calculateDegreeCentrality(graph)
        val closeness = calculateClosenessCentrality(graph)
        val betweenness = calculateBetweennessCentrality(graph)
        val pageRank = calculatePageRank(graph)

        return graph.nodes.map { node ->
            CentralityResult(
                nodeId = node.id,
                degreeCentrality = degree[node.id] ?: 0.0,
                closenessCentrality = closeness[node.id] ?: 0.0,
                betweennessCentrality = betweenness[node.id] ?: 0.0,
                pageRank = pageRank[node.id] ?: 0.0
            )
        }
    }

    // ==================== Helper Functions ====================

    private fun buildAdjacencyList(graph: GraphData): Map<String, List<String>> {
        val adjacency = mutableMapOf<String, MutableList<String>>()

        graph.nodes.forEach { node ->
            adjacency[node.id] = mutableListOf()
        }

        graph.edges.forEach { edge ->
            adjacency[edge.source]?.add(edge.target)
            if (!edge.directed) {
                adjacency[edge.target]?.add(edge.source)
            }
        }

        return adjacency
    }

    private fun buildOutgoingAdjacencyList(graph: GraphData): Map<String, List<String>> {
        val adjacency = mutableMapOf<String, MutableList<String>>()

        graph.nodes.forEach { node ->
            adjacency[node.id] = mutableListOf()
        }

        graph.edges.forEach { edge ->
            adjacency[edge.source]?.add(edge.target)
        }

        return adjacency
    }

    private fun bfsDistances(startId: String, adjacencyList: Map<String, List<String>>): Map<String, Int> {
        val distances = mutableMapOf<String, Int>()
        val visited = mutableSetOf<String>()
        val queue = mutableListOf(startId to 0)

        while (queue.isNotEmpty()) {
            val (nodeId, distance) = queue.removeAt(0)

            if (nodeId in visited) continue
            visited.add(nodeId)
            distances[nodeId] = distance

            adjacencyList[nodeId]?.forEach { neighbor ->
                if (neighbor !in visited) {
                    queue.add(neighbor to distance + 1)
                }
            }
        }

        return distances
    }

    private fun findAllShortestPaths(
        fromId: String,
        toId: String,
        adjacencyList: Map<String, List<String>>
    ): List<List<String>> {
        if (fromId == toId) return listOf(listOf(fromId))

        val paths = mutableListOf<List<String>>()
        var shortestLength = Int.MAX_VALUE
        val queue = mutableListOf(listOf(fromId))

        while (queue.isNotEmpty()) {
            val path = queue.removeAt(0)

            if (path.size > shortestLength) break

            val current = path.last()

            if (current == toId) {
                shortestLength = path.size
                paths.add(path)
                continue
            }

            adjacencyList[current]?.forEach { neighbor ->
                if (neighbor !in path) {
                    queue.add(path + neighbor)
                }
            }
        }

        return paths
    }
}

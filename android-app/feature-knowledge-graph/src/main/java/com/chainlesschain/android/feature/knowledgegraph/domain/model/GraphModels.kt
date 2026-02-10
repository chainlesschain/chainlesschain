package com.chainlesschain.android.feature.knowledgegraph.domain.model

import kotlinx.serialization.Serializable

/**
 * Graph node representing an entity in the knowledge graph
 */
@Serializable
data class GraphNode(
    val id: String,
    val label: String,
    val type: NodeType,
    val properties: Map<String, String> = emptyMap(),
    val x: Float = 0f,
    val y: Float = 0f,
    val size: Float = 1f,
    val color: String? = null,
    val metadata: NodeMetadata? = null
)

/**
 * Node types in the knowledge graph
 */
@Serializable
enum class NodeType {
    NOTE,
    DOCUMENT,
    TAG,
    ENTITY,
    PERSON,
    ORGANIZATION,
    LOCATION,
    DATE,
    CONCEPT,
    PROJECT,
    TASK
}

/**
 * Node metadata
 */
@Serializable
data class NodeMetadata(
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis(),
    val sourceId: String? = null,
    val sourceType: String? = null,
    val importance: Float = 0.5f
)

/**
 * Graph edge representing a relationship
 */
@Serializable
data class GraphEdge(
    val id: String,
    val source: String, // Source node ID
    val target: String, // Target node ID
    val type: RelationType,
    val label: String? = null,
    val weight: Float = 1f,
    val properties: Map<String, String> = emptyMap(),
    val directed: Boolean = true
)

/**
 * Relation types between nodes
 */
@Serializable
enum class RelationType {
    LINK,       // Explicit link in content
    TAG,        // Tagged with
    SEMANTIC,   // Semantically related
    TEMPORAL,   // Time-based relation
    MENTIONS,   // Entity mention
    PART_OF,    // Part-whole relation
    RELATED_TO, // General relation
    DEPENDS_ON, // Dependency
    CREATED_BY, // Authorship
    LOCATED_IN  // Location
}

/**
 * Complete graph data
 */
@Serializable
data class GraphData(
    val nodes: List<GraphNode>,
    val edges: List<GraphEdge>,
    val metadata: GraphMetadata? = null
) {
    /**
     * Get node by ID
     */
    fun getNode(id: String): GraphNode? = nodes.find { it.id == id }

    /**
     * Get edges for a node
     */
    fun getEdgesForNode(nodeId: String): List<GraphEdge> {
        return edges.filter { it.source == nodeId || it.target == nodeId }
    }

    /**
     * Get neighbors of a node
     */
    fun getNeighbors(nodeId: String): List<GraphNode> {
        val neighborIds = getEdgesForNode(nodeId).flatMap {
            listOf(it.source, it.target)
        }.filter { it != nodeId }.toSet()
        return nodes.filter { it.id in neighborIds }
    }

    /**
     * Get subgraph centered on a node
     */
    fun getSubgraph(centerId: String, depth: Int = 1): GraphData {
        val visitedNodes = mutableSetOf<String>()
        val queue = mutableListOf(centerId to 0)

        while (queue.isNotEmpty()) {
            val (nodeId, currentDepth) = queue.removeAt(0)
            if (nodeId in visitedNodes || currentDepth > depth) continue
            visitedNodes.add(nodeId)

            if (currentDepth < depth) {
                getNeighbors(nodeId).forEach { neighbor ->
                    if (neighbor.id !in visitedNodes) {
                        queue.add(neighbor.id to currentDepth + 1)
                    }
                }
            }
        }

        val subNodes = nodes.filter { it.id in visitedNodes }
        val subEdges = edges.filter { it.source in visitedNodes && it.target in visitedNodes }

        return GraphData(subNodes, subEdges)
    }
}

/**
 * Graph metadata
 */
@Serializable
data class GraphMetadata(
    val nodeCount: Int,
    val edgeCount: Int,
    val createdAt: Long = System.currentTimeMillis(),
    val lastUpdated: Long = System.currentTimeMillis()
)

/**
 * Centrality calculation result
 */
@Serializable
data class CentralityResult(
    val nodeId: String,
    val degreeCentrality: Double = 0.0,
    val closenessCentrality: Double = 0.0,
    val betweennessCentrality: Double = 0.0,
    val pageRank: Double = 0.0
)

/**
 * Community detection result
 */
@Serializable
data class Community(
    val id: String,
    val nodeIds: List<String>,
    val label: String? = null,
    val modularity: Double = 0.0
)

/**
 * Graph layout types
 */
@Serializable
enum class LayoutType {
    FORCE_DIRECTED,
    CIRCULAR,
    HIERARCHICAL,
    RADIAL,
    GRID
}

package com.chainlesschain.android.feature.knowledgegraph.data.manager

import com.chainlesschain.android.feature.knowledgegraph.data.GraphAnalytics
import com.chainlesschain.android.feature.knowledgegraph.data.repository.GraphRepository
import com.chainlesschain.android.feature.knowledgegraph.domain.model.*
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.math.cos
import kotlin.math.sin
import kotlin.random.Random

/**
 * Manager for knowledge graph operations
 */
@Singleton
class GraphManager @Inject constructor(
    private val graphRepository: GraphRepository,
    private val graphAnalytics: GraphAnalytics
) {
    // ==================== Node Operations ====================

    fun getAllNodes(): Flow<List<GraphNode>> = graphRepository.getAllNodes()

    fun getNodesByType(type: NodeType): Flow<List<GraphNode>> = graphRepository.getNodesByType(type)

    fun searchNodes(query: String): Flow<List<GraphNode>> = graphRepository.searchNodes(query)

    suspend fun createNode(
        label: String,
        type: NodeType,
        properties: Map<String, String> = emptyMap(),
        sourceId: String? = null,
        sourceType: String? = null
    ): GraphNode {
        val node = GraphNode(
            id = "",
            label = label,
            type = type,
            properties = properties,
            metadata = NodeMetadata(
                sourceId = sourceId,
                sourceType = sourceType
            )
        )
        return graphRepository.createNode(node)
    }

    suspend fun updateNode(node: GraphNode): Boolean = graphRepository.updateNode(node)

    suspend fun deleteNode(nodeId: String): Boolean = graphRepository.deleteNode(nodeId)

    // ==================== Edge Operations ====================

    fun getEdgesForNode(nodeId: String): Flow<List<GraphEdge>> = graphRepository.getEdgesForNode(nodeId)

    suspend fun createEdge(
        sourceId: String,
        targetId: String,
        type: RelationType,
        label: String? = null,
        weight: Float = 1f,
        directed: Boolean = true
    ): GraphEdge {
        val edge = GraphEdge(
            id = "",
            source = sourceId,
            target = targetId,
            type = type,
            label = label,
            weight = weight,
            directed = directed
        )
        return graphRepository.createEdge(edge)
    }

    suspend fun deleteEdge(edgeId: String): Boolean = graphRepository.deleteEdge(edgeId)

    // ==================== Graph Data ====================

    fun getGraphData(): Flow<GraphData> = graphRepository.getGraphData()

    suspend fun getGraphDataNow(): GraphData = graphRepository.getGraphData().first()

    fun getSubgraph(nodeIds: Set<String>): Flow<GraphData> = graphRepository.getSubgraph(nodeIds)

    // ==================== Analytics ====================

    suspend fun calculateCentralities(): List<CentralityResult> {
        val graph = getGraphDataNow()
        return graphAnalytics.calculateAllCentralities(graph)
    }

    suspend fun detectCommunities(): List<Community> {
        val graph = getGraphDataNow()
        return graphAnalytics.detectCommunities(graph)
    }

    suspend fun findShortestPath(fromId: String, toId: String): List<GraphNode>? {
        val graph = getGraphDataNow()
        return graphAnalytics.findShortestPath(graph, fromId, toId)
    }

    suspend fun getTopNodesByCentrality(metric: CentralityMetric, limit: Int = 10): List<Pair<GraphNode, Double>> {
        val graph = getGraphDataNow()
        val centralities = when (metric) {
            CentralityMetric.DEGREE -> graphAnalytics.calculateDegreeCentrality(graph)
            CentralityMetric.CLOSENESS -> graphAnalytics.calculateClosenessCentrality(graph)
            CentralityMetric.BETWEENNESS -> graphAnalytics.calculateBetweennessCentrality(graph)
            CentralityMetric.PAGERANK -> graphAnalytics.calculatePageRank(graph)
        }

        return centralities.entries
            .sortedByDescending { it.value }
            .take(limit)
            .mapNotNull { (nodeId, value) ->
                graph.getNode(nodeId)?.let { it to value }
            }
    }

    // ==================== Layout ====================

    suspend fun applyLayout(layoutType: LayoutType): GraphData {
        val graph = getGraphDataNow()
        val positionedNodes = when (layoutType) {
            LayoutType.FORCE_DIRECTED -> applyForceDirectedLayout(graph)
            LayoutType.CIRCULAR -> applyCircularLayout(graph)
            LayoutType.HIERARCHICAL -> applyHierarchicalLayout(graph)
            LayoutType.RADIAL -> applyRadialLayout(graph)
            LayoutType.GRID -> applyGridLayout(graph)
        }

        // Update nodes with new positions
        positionedNodes.forEach { node ->
            graphRepository.updateNode(node)
        }

        return graph.copy(nodes = positionedNodes)
    }

    private fun applyCircularLayout(graph: GraphData): List<GraphNode> {
        val n = graph.nodes.size
        if (n == 0) return emptyList()

        val radius = 200f
        val angleStep = 2 * Math.PI / n

        return graph.nodes.mapIndexed { index, node ->
            val angle = index * angleStep
            node.copy(
                x = (radius * cos(angle)).toFloat(),
                y = (radius * sin(angle)).toFloat()
            )
        }
    }

    private fun applyForceDirectedLayout(graph: GraphData): List<GraphNode> {
        // Simple force-directed layout
        val positions = graph.nodes.associate {
            it.id to Pair(Random.nextFloat() * 400 - 200, Random.nextFloat() * 400 - 200)
        }.toMutableMap()

        val iterations = 50
        val k = 50f // optimal distance
        val temperature = 100f

        repeat(iterations) { iter ->
            val cooling = temperature * (1 - iter.toFloat() / iterations)

            // Calculate repulsive forces
            val forces = graph.nodes.associate { it.id to Pair(0f, 0f) }.toMutableMap()

            for (i in graph.nodes.indices) {
                for (j in i + 1 until graph.nodes.size) {
                    val v = graph.nodes[i]
                    val u = graph.nodes[j]
                    val (vx, vy) = positions[v.id]!!
                    val (ux, uy) = positions[u.id]!!

                    val dx = vx - ux
                    val dy = vy - uy
                    val dist = kotlin.math.sqrt(dx * dx + dy * dy).coerceAtLeast(0.01f)
                    val force = k * k / dist

                    val fx = dx / dist * force
                    val fy = dy / dist * force

                    forces[v.id] = Pair(forces[v.id]!!.first + fx, forces[v.id]!!.second + fy)
                    forces[u.id] = Pair(forces[u.id]!!.first - fx, forces[u.id]!!.second - fy)
                }
            }

            // Calculate attractive forces
            for (edge in graph.edges) {
                val (sx, sy) = positions[edge.source] ?: continue
                val (tx, ty) = positions[edge.target] ?: continue

                val dx = tx - sx
                val dy = ty - sy
                val dist = kotlin.math.sqrt(dx * dx + dy * dy).coerceAtLeast(0.01f)
                val force = dist * dist / k

                val fx = dx / dist * force
                val fy = dy / dist * force

                forces[edge.source] = Pair(forces[edge.source]!!.first + fx, forces[edge.source]!!.second + fy)
                forces[edge.target] = Pair(forces[edge.target]!!.first - fx, forces[edge.target]!!.second - fy)
            }

            // Apply forces
            for (node in graph.nodes) {
                val (fx, fy) = forces[node.id]!!
                val (x, y) = positions[node.id]!!
                val forceMag = kotlin.math.sqrt(fx * fx + fy * fy).coerceAtLeast(0.01f)
                val scale = minOf(forceMag, cooling) / forceMag

                positions[node.id] = Pair(x + fx * scale, y + fy * scale)
            }
        }

        return graph.nodes.map { node ->
            val (x, y) = positions[node.id]!!
            node.copy(x = x, y = y)
        }
    }

    private fun applyHierarchicalLayout(graph: GraphData): List<GraphNode> {
        // Find root nodes (no incoming edges)
        val incomingEdges = graph.edges.groupBy { it.target }
        val roots = graph.nodes.filter { node ->
            incomingEdges[node.id]?.isEmpty() ?: true
        }

        val levels = mutableMapOf<String, Int>()
        val queue = roots.map { it.id to 0 }.toMutableList()

        while (queue.isNotEmpty()) {
            val (nodeId, level) = queue.removeAt(0)
            if (levels.containsKey(nodeId)) continue
            levels[nodeId] = level

            graph.edges.filter { it.source == nodeId }.forEach { edge ->
                if (!levels.containsKey(edge.target)) {
                    queue.add(edge.target to level + 1)
                }
            }
        }

        // Position nodes by level
        val nodesByLevel = levels.entries.groupBy({ it.value }, { it.key })
        val ySpacing = 100f

        return graph.nodes.map { node ->
            val level = levels[node.id] ?: 0
            val nodesInLevel = nodesByLevel[level] ?: listOf(node.id)
            val indexInLevel = nodesInLevel.indexOf(node.id)
            val xSpacing = 100f
            val xOffset = -(nodesInLevel.size - 1) * xSpacing / 2

            node.copy(
                x = xOffset + indexInLevel * xSpacing,
                y = level * ySpacing
            )
        }
    }

    private fun applyRadialLayout(graph: GraphData): List<GraphNode> {
        if (graph.nodes.isEmpty()) return emptyList()

        // Use first node or most connected as center
        val center = graph.nodes.maxByOrNull { node ->
            graph.edges.count { it.source == node.id || it.target == node.id }
        } ?: graph.nodes.first()

        val visited = mutableSetOf(center.id)
        val levels = mutableMapOf(center.id to 0)
        val queue = mutableListOf(center.id)

        while (queue.isNotEmpty()) {
            val nodeId = queue.removeAt(0)
            val neighbors = graph.getNeighbors(nodeId)

            neighbors.forEach { neighbor ->
                if (neighbor.id !in visited) {
                    visited.add(neighbor.id)
                    levels[neighbor.id] = (levels[nodeId] ?: 0) + 1
                    queue.add(neighbor.id)
                }
            }
        }

        // Position by level in rings
        val nodesByLevel = levels.entries.groupBy({ it.value }, { it.key })
        val radiusStep = 100f

        return graph.nodes.map { node ->
            val level = levels[node.id] ?: 0
            if (level == 0) {
                node.copy(x = 0f, y = 0f)
            } else {
                val nodesInLevel = nodesByLevel[level] ?: emptyList()
                val indexInLevel = nodesInLevel.indexOf(node.id)
                val angle = 2 * Math.PI * indexInLevel / nodesInLevel.size
                val radius = level * radiusStep

                node.copy(
                    x = (radius * cos(angle)).toFloat(),
                    y = (radius * sin(angle)).toFloat()
                )
            }
        }
    }

    private fun applyGridLayout(graph: GraphData): List<GraphNode> {
        val n = graph.nodes.size
        if (n == 0) return emptyList()

        val cols = kotlin.math.ceil(kotlin.math.sqrt(n.toDouble())).toInt()
        val spacing = 100f

        return graph.nodes.mapIndexed { index, node ->
            val row = index / cols
            val col = index % cols
            node.copy(
                x = col * spacing - (cols - 1) * spacing / 2,
                y = row * spacing - ((n - 1) / cols) * spacing / 2
            )
        }
    }

    // ==================== Import/Export ====================

    suspend fun importGraph(graphData: GraphData) = graphRepository.importGraph(graphData)

    suspend fun clearGraph() = graphRepository.clearGraph()
}

/**
 * Centrality metric types
 */
enum class CentralityMetric {
    DEGREE,
    CLOSENESS,
    BETWEENNESS,
    PAGERANK
}

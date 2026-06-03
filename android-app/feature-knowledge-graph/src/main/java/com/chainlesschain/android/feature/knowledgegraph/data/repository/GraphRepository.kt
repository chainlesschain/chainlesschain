package com.chainlesschain.android.feature.knowledgegraph.data.repository

import com.chainlesschain.android.feature.knowledgegraph.domain.model.*
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.map
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Repository for knowledge graph data
 */
@Singleton
class GraphRepository @Inject constructor() {

    private val _nodes = MutableStateFlow<Map<String, GraphNode>>(emptyMap())
    private val _edges = MutableStateFlow<Map<String, GraphEdge>>(emptyMap())

    // ==================== Nodes ====================

    fun getAllNodes(): Flow<List<GraphNode>> = _nodes.map { it.values.toList() }

    fun getNodeById(nodeId: String): GraphNode? = _nodes.value[nodeId]

    fun getNodesByType(type: NodeType): Flow<List<GraphNode>> = _nodes.map { nodes ->
        nodes.values.filter { it.type == type }
    }

    fun searchNodes(query: String): Flow<List<GraphNode>> = _nodes.map { nodes ->
        if (query.isBlank()) {
            nodes.values.toList()
        } else {
            nodes.values.filter { node ->
                node.label.contains(query, ignoreCase = true) ||
                node.properties.values.any { it.contains(query, ignoreCase = true) }
            }
        }
    }

    suspend fun createNode(node: GraphNode): GraphNode {
        val newNode = node.copy(
            id = if (node.id.isBlank()) UUID.randomUUID().toString() else node.id,
            metadata = node.metadata?.copy(
                createdAt = System.currentTimeMillis(),
                updatedAt = System.currentTimeMillis()
            ) ?: NodeMetadata()
        )
        _nodes.value = _nodes.value + (newNode.id to newNode)
        return newNode
    }

    suspend fun updateNode(node: GraphNode): Boolean {
        if (!_nodes.value.containsKey(node.id)) return false
        val updated = node.copy(
            metadata = node.metadata?.copy(updatedAt = System.currentTimeMillis())
        )
        _nodes.value = _nodes.value + (node.id to updated)
        return true
    }

    suspend fun deleteNode(nodeId: String): Boolean {
        if (!_nodes.value.containsKey(nodeId)) return false
        _nodes.value = _nodes.value - nodeId
        // Also delete connected edges
        _edges.value = _edges.value.filterValues { it.source != nodeId && it.target != nodeId }
        return true
    }

    // ==================== Edges ====================

    fun getAllEdges(): Flow<List<GraphEdge>> = _edges.map { it.values.toList() }

    fun getEdgeById(edgeId: String): GraphEdge? = _edges.value[edgeId]

    fun getEdgesForNode(nodeId: String): Flow<List<GraphEdge>> = _edges.map { edges ->
        edges.values.filter { it.source == nodeId || it.target == nodeId }
    }

    fun getOutgoingEdges(nodeId: String): Flow<List<GraphEdge>> = _edges.map { edges ->
        edges.values.filter { it.source == nodeId }
    }

    fun getIncomingEdges(nodeId: String): Flow<List<GraphEdge>> = _edges.map { edges ->
        edges.values.filter { it.target == nodeId }
    }

    suspend fun createEdge(edge: GraphEdge): GraphEdge {
        val newEdge = edge.copy(
            id = if (edge.id.isBlank()) UUID.randomUUID().toString() else edge.id
        )
        _edges.value = _edges.value + (newEdge.id to newEdge)
        return newEdge
    }

    suspend fun updateEdge(edge: GraphEdge): Boolean {
        if (!_edges.value.containsKey(edge.id)) return false
        _edges.value = _edges.value + (edge.id to edge)
        return true
    }

    suspend fun deleteEdge(edgeId: String): Boolean {
        if (!_edges.value.containsKey(edgeId)) return false
        _edges.value = _edges.value - edgeId
        return true
    }

    // ==================== Graph Operations ====================

    fun getGraphData(): Flow<GraphData> = _nodes.map { nodes ->
        GraphData(
            nodes = nodes.values.toList(),
            edges = _edges.value.values.toList(),
            metadata = GraphMetadata(
                nodeCount = nodes.size,
                edgeCount = _edges.value.size,
                lastUpdated = System.currentTimeMillis()
            )
        )
    }

    fun getSubgraph(nodeIds: Set<String>): Flow<GraphData> = _nodes.map { allNodes ->
        val nodes = allNodes.values.filter { it.id in nodeIds }
        val edges = _edges.value.values.filter {
            it.source in nodeIds && it.target in nodeIds
        }
        GraphData(nodes, edges)
    }

    suspend fun importGraph(graphData: GraphData) {
        graphData.nodes.forEach { node ->
            _nodes.value = _nodes.value + (node.id to node)
        }
        graphData.edges.forEach { edge ->
            _edges.value = _edges.value + (edge.id to edge)
        }
    }

    suspend fun clearGraph() {
        _nodes.value = emptyMap()
        _edges.value = emptyMap()
    }
}

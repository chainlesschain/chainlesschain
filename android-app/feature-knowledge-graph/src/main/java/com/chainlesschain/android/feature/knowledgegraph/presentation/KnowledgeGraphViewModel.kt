package com.chainlesschain.android.feature.knowledgegraph.presentation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.feature.knowledgegraph.data.manager.CentralityMetric
import com.chainlesschain.android.feature.knowledgegraph.data.manager.GraphManager
import com.chainlesschain.android.feature.knowledgegraph.domain.model.*
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class KnowledgeGraphViewModel @Inject constructor(
    private val graphManager: GraphManager
) : ViewModel() {

    private val _uiState = MutableStateFlow(GraphUiState())
    val uiState: StateFlow<GraphUiState> = _uiState.asStateFlow()

    private val _selectedNode = MutableStateFlow<GraphNode?>(null)
    val selectedNode: StateFlow<GraphNode?> = _selectedNode.asStateFlow()

    init {
        loadGraph()
    }

    private fun loadGraph() {
        viewModelScope.launch {
            graphManager.getGraphData().collect { graphData ->
                _uiState.update {
                    it.copy(
                        graphData = graphData,
                        isLoading = false
                    )
                }
            }
        }
    }

    // ==================== Node Operations ====================

    fun selectNode(node: GraphNode?) {
        _selectedNode.value = node
        node?.let { loadNodeDetails(it.id) }
    }

    private fun loadNodeDetails(nodeId: String) {
        viewModelScope.launch {
            graphManager.getEdgesForNode(nodeId).collect { edges ->
                _uiState.update { it.copy(selectedNodeEdges = edges) }
            }
        }
    }

    fun createNode(label: String, type: NodeType, properties: Map<String, String> = emptyMap()) {
        viewModelScope.launch {
            try {
                graphManager.createNode(label, type, properties)
                _uiState.update { it.copy(message = "Node created") }
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message) }
            }
        }
    }

    fun updateNode(node: GraphNode) {
        viewModelScope.launch {
            try {
                graphManager.updateNode(node)
                _uiState.update { it.copy(message = "Node updated") }
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message) }
            }
        }
    }

    fun deleteNode(nodeId: String) {
        viewModelScope.launch {
            try {
                graphManager.deleteNode(nodeId)
                if (_selectedNode.value?.id == nodeId) {
                    _selectedNode.value = null
                }
                _uiState.update { it.copy(message = "Node deleted") }
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message) }
            }
        }
    }

    // ==================== Edge Operations ====================

    fun createEdge(sourceId: String, targetId: String, type: RelationType, label: String? = null) {
        viewModelScope.launch {
            try {
                graphManager.createEdge(sourceId, targetId, type, label)
                _uiState.update { it.copy(message = "Edge created") }
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message) }
            }
        }
    }

    fun deleteEdge(edgeId: String) {
        viewModelScope.launch {
            try {
                graphManager.deleteEdge(edgeId)
                _uiState.update { it.copy(message = "Edge deleted") }
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message) }
            }
        }
    }

    // ==================== Layout ====================

    fun applyLayout(layoutType: LayoutType) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            try {
                val newGraph = graphManager.applyLayout(layoutType)
                _uiState.update {
                    it.copy(
                        graphData = newGraph,
                        currentLayout = layoutType,
                        isLoading = false,
                        message = "Layout applied"
                    )
                }
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message, isLoading = false) }
            }
        }
    }

    // ==================== Analytics ====================

    fun calculateCentralities() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            try {
                val centralities = graphManager.calculateCentralities()
                _uiState.update {
                    it.copy(
                        centralities = centralities,
                        isLoading = false
                    )
                }
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message, isLoading = false) }
            }
        }
    }

    fun detectCommunities() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            try {
                val communities = graphManager.detectCommunities()
                _uiState.update {
                    it.copy(
                        communities = communities,
                        isLoading = false
                    )
                }
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message, isLoading = false) }
            }
        }
    }

    fun findPath(fromId: String, toId: String) {
        viewModelScope.launch {
            try {
                val path = graphManager.findShortestPath(fromId, toId)
                _uiState.update {
                    it.copy(
                        highlightedPath = path?.map { node -> node.id } ?: emptyList(),
                        message = if (path != null) "Path found (${path.size} nodes)" else "No path found"
                    )
                }
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message) }
            }
        }
    }

    fun getTopNodes(metric: CentralityMetric, limit: Int = 10) {
        viewModelScope.launch {
            try {
                val topNodes = graphManager.getTopNodesByCentrality(metric, limit)
                _uiState.update {
                    it.copy(
                        topNodes = topNodes,
                        currentMetric = metric
                    )
                }
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message) }
            }
        }
    }

    // ==================== Search ====================

    fun searchNodes(query: String) {
        viewModelScope.launch {
            graphManager.searchNodes(query).collect { results ->
                _uiState.update { it.copy(searchResults = results) }
            }
        }
    }

    fun clearSearch() {
        _uiState.update { it.copy(searchResults = emptyList()) }
    }

    // ==================== Messages ====================

    fun clearMessage() {
        _uiState.update { it.copy(message = null) }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }

    fun clearHighlightedPath() {
        _uiState.update { it.copy(highlightedPath = emptyList()) }
    }
}

data class GraphUiState(
    val isLoading: Boolean = true,
    val graphData: GraphData? = null,
    val selectedNodeEdges: List<GraphEdge> = emptyList(),
    val currentLayout: LayoutType = LayoutType.FORCE_DIRECTED,
    val centralities: List<CentralityResult> = emptyList(),
    val communities: List<Community> = emptyList(),
    val topNodes: List<Pair<GraphNode, Double>> = emptyList(),
    val currentMetric: CentralityMetric = CentralityMetric.PAGERANK,
    val highlightedPath: List<String> = emptyList(),
    val searchResults: List<GraphNode> = emptyList(),
    val message: String? = null,
    val error: String? = null
)

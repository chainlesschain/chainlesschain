package com.chainlesschain.android.feature.knowledgegraph.presentation

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.feature.knowledgegraph.domain.model.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun KnowledgeGraphScreen(
    viewModel: KnowledgeGraphViewModel = hiltViewModel(),
    onNavigateBack: () -> Unit = {}
) {
    val uiState by viewModel.uiState.collectAsState()
    val selectedNode by viewModel.selectedNode.collectAsState()

    var showLayoutMenu by remember { mutableStateOf(false) }
    var showAnalyticsMenu by remember { mutableStateOf(false) }
    var showCreateNodeDialog by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Knowledge Graph") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    IconButton(onClick = { showCreateNodeDialog = true }) {
                        Icon(Icons.Default.Add, contentDescription = "Add Node")
                    }
                    Box {
                        IconButton(onClick = { showLayoutMenu = true }) {
                            Icon(Icons.Default.GridView, contentDescription = "Layout")
                        }
                        DropdownMenu(
                            expanded = showLayoutMenu,
                            onDismissRequest = { showLayoutMenu = false }
                        ) {
                            LayoutType.entries.forEach { layout ->
                                DropdownMenuItem(
                                    text = { Text(layout.name.replace("_", " ")) },
                                    onClick = {
                                        viewModel.applyLayout(layout)
                                        showLayoutMenu = false
                                    },
                                    leadingIcon = {
                                        if (layout == uiState.currentLayout) {
                                            Icon(Icons.Default.Check, contentDescription = null)
                                        }
                                    }
                                )
                            }
                        }
                    }
                    Box {
                        IconButton(onClick = { showAnalyticsMenu = true }) {
                            Icon(Icons.Default.Analytics, contentDescription = "Analytics")
                        }
                        DropdownMenu(
                            expanded = showAnalyticsMenu,
                            onDismissRequest = { showAnalyticsMenu = false }
                        ) {
                            DropdownMenuItem(
                                text = { Text("Calculate Centralities") },
                                onClick = {
                                    viewModel.calculateCentralities()
                                    showAnalyticsMenu = false
                                }
                            )
                            DropdownMenuItem(
                                text = { Text("Detect Communities") },
                                onClick = {
                                    viewModel.detectCommunities()
                                    showAnalyticsMenu = false
                                }
                            )
                        }
                    }
                }
            )
        }
    ) { padding ->
        Row(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            // Graph Canvas
            Box(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxHeight()
            ) {
                when {
                    uiState.isLoading -> {
                        CircularProgressIndicator(
                            modifier = Modifier.align(Alignment.Center)
                        )
                    }
                    uiState.graphData != null -> {
                        GraphCanvas(
                            graphData = uiState.graphData!!,
                            selectedNodeId = selectedNode?.id,
                            highlightedPath = uiState.highlightedPath,
                            onNodeClick = { nodeId ->
                                val node = uiState.graphData!!.getNode(nodeId)
                                viewModel.selectNode(node)
                            }
                        )

                        // Stats overlay
                        GraphStatsOverlay(
                            nodeCount = uiState.graphData!!.nodes.size,
                            edgeCount = uiState.graphData!!.edges.size,
                            modifier = Modifier.align(Alignment.TopStart)
                        )
                    }
                    else -> {
                        Text(
                            "No graph data",
                            modifier = Modifier.align(Alignment.Center)
                        )
                    }
                }
            }

            // Detail Panel
            if (selectedNode != null) {
                VerticalDivider()
                NodeDetailPanel(
                    node = selectedNode!!,
                    edges = uiState.selectedNodeEdges,
                    onClose = { viewModel.selectNode(null) },
                    onDelete = { viewModel.deleteNode(selectedNode!!.id) },
                    modifier = Modifier.width(300.dp)
                )
            }

            // Analytics Panel
            if (uiState.communities.isNotEmpty() || uiState.centralities.isNotEmpty()) {
                VerticalDivider()
                AnalyticsPanel(
                    communities = uiState.communities,
                    centralities = uiState.centralities,
                    modifier = Modifier.width(250.dp)
                )
            }
        }
    }

    if (showCreateNodeDialog) {
        CreateNodeDialog(
            onDismiss = { showCreateNodeDialog = false },
            onCreate = { label, type ->
                viewModel.createNode(label, type)
                showCreateNodeDialog = false
            }
        )
    }

    uiState.message?.let {
        LaunchedEffect(it) { viewModel.clearMessage() }
    }
    uiState.error?.let {
        LaunchedEffect(it) { viewModel.clearError() }
    }
}

@Composable
private fun GraphCanvas(
    graphData: GraphData,
    selectedNodeId: String?,
    highlightedPath: List<String>,
    onNodeClick: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    var scale by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }

    Canvas(
        modifier = modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.surface)
            .pointerInput(Unit) {
                detectTransformGestures { _, pan, zoom, _ ->
                    scale = (scale * zoom).coerceIn(0.1f, 5f)
                    offset += pan
                }
            }
            .pointerInput(graphData) {
                detectTapGestures { tapOffset ->
                    val centerX = size.width / 2f
                    val centerY = size.height / 2f

                    graphData.nodes.forEach { node ->
                        val nodeX = centerX + (node.x * scale) + offset.x
                        val nodeY = centerY + (node.y * scale) + offset.y
                        val radius = 20f * scale

                        val dx = tapOffset.x - nodeX
                        val dy = tapOffset.y - nodeY
                        if (dx * dx + dy * dy <= radius * radius) {
                            onNodeClick(node.id)
                            return@detectTapGestures
                        }
                    }
                }
            }
    ) {
        val centerX = size.width / 2f
        val centerY = size.height / 2f

        // Draw edges
        graphData.edges.forEach { edge ->
            val sourceNode = graphData.getNode(edge.source)
            val targetNode = graphData.getNode(edge.target)

            if (sourceNode != null && targetNode != null) {
                val isHighlighted = edge.source in highlightedPath && edge.target in highlightedPath
                drawEdge(
                    sourceNode, targetNode, edge,
                    centerX, centerY, scale, offset,
                    isHighlighted
                )
            }
        }

        // Draw nodes
        graphData.nodes.forEach { node ->
            val isSelected = node.id == selectedNodeId
            val isInPath = node.id in highlightedPath
            drawNode(node, centerX, centerY, scale, offset, isSelected, isInPath)
        }
    }
}

private fun DrawScope.drawNode(
    node: GraphNode,
    centerX: Float,
    centerY: Float,
    scale: Float,
    offset: Offset,
    isSelected: Boolean,
    isInPath: Boolean
) {
    val x = centerX + (node.x * scale) + offset.x
    val y = centerY + (node.y * scale) + offset.y
    val radius = 20f * scale * node.size

    val color = when {
        isSelected -> Color(0xFF4CAF50)
        isInPath -> Color(0xFFFF9800)
        else -> getNodeColor(node.type)
    }

    drawCircle(
        color = color,
        radius = radius,
        center = Offset(x, y)
    )

    if (isSelected) {
        drawCircle(
            color = Color.White,
            radius = radius + 4f,
            center = Offset(x, y),
            style = androidx.compose.ui.graphics.drawscope.Stroke(width = 2f)
        )
    }
}

private fun DrawScope.drawEdge(
    source: GraphNode,
    target: GraphNode,
    edge: GraphEdge,
    centerX: Float,
    centerY: Float,
    scale: Float,
    offset: Offset,
    isHighlighted: Boolean
) {
    val x1 = centerX + (source.x * scale) + offset.x
    val y1 = centerY + (source.y * scale) + offset.y
    val x2 = centerX + (target.x * scale) + offset.x
    val y2 = centerY + (target.y * scale) + offset.y

    val color = if (isHighlighted) Color(0xFFFF9800) else Color.Gray.copy(alpha = 0.5f)
    val strokeWidth = if (isHighlighted) 3f else 1f

    drawLine(
        color = color,
        start = Offset(x1, y1),
        end = Offset(x2, y2),
        strokeWidth = strokeWidth * edge.weight
    )
}

private fun getNodeColor(type: NodeType): Color {
    return when (type) {
        NodeType.NOTE -> Color(0xFF2196F3)
        NodeType.DOCUMENT -> Color(0xFF4CAF50)
        NodeType.TAG -> Color(0xFFFF9800)
        NodeType.ENTITY -> Color(0xFF9C27B0)
        NodeType.PERSON -> Color(0xFFE91E63)
        NodeType.ORGANIZATION -> Color(0xFF00BCD4)
        NodeType.LOCATION -> Color(0xFF795548)
        NodeType.DATE -> Color(0xFF607D8B)
        NodeType.CONCEPT -> Color(0xFF673AB7)
        NodeType.PROJECT -> Color(0xFF3F51B5)
        NodeType.TASK -> Color(0xFFCDDC39)
    }
}

@Composable
private fun GraphStatsOverlay(
    nodeCount: Int,
    edgeCount: Int,
    modifier: Modifier = Modifier
) {
    Surface(
        modifier = modifier.padding(8.dp),
        shape = MaterialTheme.shapes.small,
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.9f)
    ) {
        Row(
            modifier = Modifier.padding(8.dp),
            horizontalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Text("Nodes: $nodeCount", style = MaterialTheme.typography.bodySmall)
            Text("Edges: $edgeCount", style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun NodeDetailPanel(
    node: GraphNode,
    edges: List<GraphEdge>,
    onClose: () -> Unit,
    onDelete: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier
            .fillMaxHeight()
            .padding(16.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(node.label, style = MaterialTheme.typography.titleMedium)
            Row {
                IconButton(onClick = onDelete) {
                    Icon(Icons.Default.Delete, contentDescription = "Delete")
                }
                IconButton(onClick = onClose) {
                    Icon(Icons.Default.Close, contentDescription = "Close")
                }
            }
        }

        AssistChip(
            onClick = {},
            label = { Text(node.type.name) }
        )

        Spacer(modifier = Modifier.height(16.dp))

        Text("Properties", style = MaterialTheme.typography.titleSmall)
        node.properties.forEach { (key, value) ->
            Text("$key: $value", style = MaterialTheme.typography.bodySmall)
        }

        Spacer(modifier = Modifier.height(16.dp))

        Text("Connections (${edges.size})", style = MaterialTheme.typography.titleSmall)
        LazyColumn {
            items(edges) { edge ->
                ListItem(
                    headlineContent = {
                        Text(if (edge.source == node.id) edge.target else edge.source)
                    },
                    supportingContent = {
                        Text(edge.type.name)
                    }
                )
            }
        }
    }
}

@Composable
private fun AnalyticsPanel(
    communities: List<Community>,
    centralities: List<CentralityResult>,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier
            .fillMaxHeight()
            .padding(16.dp)
    ) {
        if (communities.isNotEmpty()) {
            Text("Communities (${communities.size})", style = MaterialTheme.typography.titleMedium)
            Spacer(modifier = Modifier.height(8.dp))
            communities.take(5).forEach { community ->
                Text(
                    "${community.label}: ${community.nodeIds.size} nodes",
                    style = MaterialTheme.typography.bodySmall
                )
            }
            Spacer(modifier = Modifier.height(16.dp))
        }

        if (centralities.isNotEmpty()) {
            Text("Top by PageRank", style = MaterialTheme.typography.titleMedium)
            Spacer(modifier = Modifier.height(8.dp))
            centralities
                .sortedByDescending { it.pageRank }
                .take(5)
                .forEach { result ->
                    Text(
                        "${result.nodeId.take(8)}: ${String.format("%.3f", result.pageRank)}",
                        style = MaterialTheme.typography.bodySmall
                    )
                }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CreateNodeDialog(
    onDismiss: () -> Unit,
    onCreate: (String, NodeType) -> Unit
) {
    var label by remember { mutableStateOf("") }
    var selectedType by remember { mutableStateOf(NodeType.NOTE) }
    var expanded by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Create Node") },
        text = {
            Column {
                OutlinedTextField(
                    value = label,
                    onValueChange = { label = it },
                    label = { Text("Label") },
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(modifier = Modifier.height(8.dp))
                ExposedDropdownMenuBox(
                    expanded = expanded,
                    onExpandedChange = { expanded = it }
                ) {
                    OutlinedTextField(
                        value = selectedType.name,
                        onValueChange = {},
                        readOnly = true,
                        label = { Text("Type") },
                        trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded) },
                        modifier = Modifier
                            .fillMaxWidth()
                            .menuAnchor()
                    )
                    ExposedDropdownMenu(
                        expanded = expanded,
                        onDismissRequest = { expanded = false }
                    ) {
                        NodeType.entries.forEach { type ->
                            DropdownMenuItem(
                                text = { Text(type.name) },
                                onClick = {
                                    selectedType = type
                                    expanded = false
                                }
                            )
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onCreate(label, selectedType) },
                enabled = label.isNotBlank()
            ) {
                Text("Create")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel")
            }
        }
    )
}

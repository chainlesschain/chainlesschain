package com.chainlesschain.android.remote.ui.ai

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.remote.commands.SearchResult
import com.chainlesschain.android.remote.p2p.ConnectionState

/**
 * 远程 RAG 搜索界面
 *
 * 功能：
 * - 搜索 PC 端知识库
 * - 显示搜索结果（相似度排序）
 * - 查看结果详情
 * - 搜索历史
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RemoteRAGSearchScreen(
    viewModel: RemoteRAGSearchViewModel = hiltViewModel(),
    onNavigateBack: () -> Unit
) {
    val uiState by viewModel.uiState.collectAsState()
    val searchResults by viewModel.searchResults.collectAsState()
    val searchHistory by viewModel.searchHistory.collectAsState()
    val connectionState by viewModel.connectionState.collectAsState()

    var searchQuery by remember { mutableStateOf("") }
    var showSettings by remember { mutableStateOf(false) }
    var selectedResult by remember { mutableStateOf<SearchResult?>(null) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("RAG 知识库搜索") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "返回")
                    }
                },
                actions = {
                    // 设置按钮
                    IconButton(onClick = { showSettings = true }) {
                        Icon(Icons.Default.Settings, contentDescription = "设置")
                    }

                    // 清除结果
                    if (searchResults.isNotEmpty()) {
                        IconButton(onClick = { viewModel.clearResults() }) {
                            Icon(Icons.Default.DeleteSweep, contentDescription = "清除结果")
                        }
                    }
                }
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            // 搜索栏
            SearchBar(
                query = searchQuery,
                onQueryChange = { searchQuery = it },
                onSearch = {
                    viewModel.search(searchQuery, uiState.topK)
                },
                enabled = connectionState == ConnectionState.CONNECTED && !uiState.isSearching,
                modifier = Modifier.padding(16.dp)
            )

            // 主内容区
            Box(modifier = Modifier.weight(1f)) {
                when {
                    connectionState != ConnectionState.CONNECTED -> {
                        // 未连接提示
                        EmptyState(
                            icon = Icons.Default.CloudOff,
                            title = "未连接到 PC",
                            subtitle = "请先在主界面连接到 PC 设备"
                        )
                    }
                    uiState.isSearching -> {
                        // 搜索中
                        LoadingState()
                    }
                    searchResults.isEmpty() && uiState.currentQuery == null -> {
                        // 初始状态 - 显示搜索历史
                        if (searchHistory.isEmpty()) {
                            EmptyState(
                                icon = Icons.Default.Search,
                                title = "搜索知识库",
                                subtitle = "在 PC 端的知识库中搜索相关内容"
                            )
                        } else {
                            SearchHistorySection(
                                history = searchHistory,
                                onHistoryClick = { query ->
                                    searchQuery = query
                                    viewModel.search(query, uiState.topK)
                                }
                            )
                        }
                    }
                    searchResults.isEmpty() && uiState.currentQuery != null -> {
                        // 无搜索结果
                        EmptyState(
                            icon = Icons.Default.SearchOff,
                            title = "未找到相关内容",
                            subtitle = "尝试使用不同的关键词搜索"
                        )
                    }
                    else -> {
                        // 显示搜索结果
                        SearchResultsList(
                            results = searchResults,
                            totalResults = uiState.totalResults,
                            query = uiState.currentQuery ?: "",
                            onResultClick = { result ->
                                selectedResult = result
                            }
                        )
                    }
                }

                // 错误提示
                uiState.error?.let { error ->
                    Snackbar(
                        modifier = Modifier
                            .align(Alignment.BottomCenter)
                            .padding(16.dp),
                        action = {
                            TextButton(onClick = { viewModel.clearError() }) {
                                Text("关闭")
                            }
                        }
                    ) {
                        Text(error)
                    }
                }
            }
        }
    }

    // 结果详情对话框
    selectedResult?.let { result ->
        ResultDetailDialog(
            result = result,
            onDismiss = { selectedResult = null }
        )
    }

    // 设置对话框
    if (showSettings) {
        SearchSettingsDialog(
            topK = uiState.topK,
            onTopKChange = { viewModel.setTopK(it) },
            onDismiss = { showSettings = false }
        )
    }
}

/**
 * 搜索栏
 */
@Composable
fun SearchBar(
    query: String,
    onQueryChange: (String) -> Unit,
    onSearch: () -> Unit,
    enabled: Boolean,
    modifier: Modifier = Modifier
) {
    OutlinedTextField(
        value = query,
        onValueChange = onQueryChange,
        modifier = modifier.fillMaxWidth(),
        placeholder = { Text("搜索知识库...") },
        leadingIcon = {
            Icon(Icons.Default.Search, contentDescription = null)
        },
        trailingIcon = {
            if (query.isNotEmpty()) {
                IconButton(onClick = { onQueryChange("") }) {
                    Icon(Icons.Default.Clear, contentDescription = "清除")
                }
            }
        },
        singleLine = true,
        enabled = enabled,
        shape = RoundedCornerShape(28.dp),
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = MaterialTheme.colorScheme.primary,
            unfocusedBorderColor = MaterialTheme.colorScheme.outlineVariant
        ),
        keyboardActions = androidx.compose.foundation.text.KeyboardActions(
            onSearch = { onSearch() }
        )
    )
}

/**
 * 搜索结果列表
 */
@Composable
fun SearchResultsList(
    results: List<SearchResult>,
    totalResults: Int,
    query: String,
    onResultClick: (SearchResult) -> Unit
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        // 结果统计
        item {
            Text(
                text = "找到 $totalResults 条结果（关键词：\"$query\"）",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }

        // 搜索结果
        items(results, key = { it.noteId }) { result ->
            SearchResultCard(
                result = result,
                onClick = { onResultClick(result) }
            )
        }
    }
}

/**
 * 搜索结果卡片
 */
@Composable
fun SearchResultCard(
    result: SearchResult,
    onClick: () -> Unit
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant
        )
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            // 标题和相似度分数
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = result.title,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.weight(1f),
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )

                Spacer(modifier = Modifier.width(8.dp))

                // 相似度分数指示器
                SimilarityScoreChip(score = result.score)
            }

            // 内容预览
            Text(
                text = result.content,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis
            )

            // 元数据
            result.metadata?.let { metadata ->
                if (metadata.isNotEmpty()) {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        metadata.entries.take(3).forEach { (key, value) ->
                            AssistChip(
                                onClick = { },
                                label = {
                                    Text(
                                        text = "$key: $value",
                                        style = MaterialTheme.typography.bodySmall
                                    )
                                }
                            )
                        }
                    }
                }
            }
        }
    }
}

/**
 * 相似度分数芯片
 */
@Composable
fun SimilarityScoreChip(score: Float) {
    val percentage = (score * 100).toInt()
    val color = when {
        score >= 0.8f -> MaterialTheme.colorScheme.tertiary
        score >= 0.6f -> MaterialTheme.colorScheme.secondary
        else -> MaterialTheme.colorScheme.outline
    }

    Surface(
        shape = RoundedCornerShape(12.dp),
        color = color.copy(alpha = 0.15f)
    ) {
        Text(
            text = "$percentage%",
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
            style = MaterialTheme.typography.labelMedium,
            color = color,
            fontWeight = FontWeight.Bold
        )
    }
}

/**
 * 搜索历史区域
 */
@Composable
fun SearchHistorySection(
    history: List<String>,
    onHistoryClick: (String) -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Text(
            text = "最近搜索",
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold
        )

        history.forEach { query ->
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { onHistoryClick(query) },
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.surfaceVariant
                )
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Icon(
                        Icons.Default.History,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Text(
                        text = query,
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.weight(1f)
                    )
                    Icon(
                        Icons.Default.ArrowForward,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        }
    }
}

/**
 * 加载状态
 */
@Composable
fun LoadingState() {
    Box(
        modifier = Modifier.fillMaxSize(),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            CircularProgressIndicator()
            Text(
                text = "正在搜索...",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

/**
 * 空状态
 */
@Composable
fun EmptyState(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    subtitle: String
) {
    Box(
        modifier = Modifier.fillMaxSize(),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Icon(
                icon,
                contentDescription = null,
                modifier = Modifier.size(64.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
            )
            Text(
                text = title,
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurface
            )
            Text(
                text = subtitle,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f)
            )
        }
    }
}

/**
 * 结果详情对话框
 */
@Composable
fun ResultDetailDialog(
    result: SearchResult,
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(result.title) },
        text = {
            LazyColumn(
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                // 相似度分数
                item {
                    Row(
                        horizontalArrangement = Arrangement.SpaceBetween,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text(
                            text = "相似度",
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.Bold
                        )
                        SimilarityScoreChip(score = result.score)
                    }
                }

                // 内容
                item {
                    Column {
                        Text(
                            text = "内容",
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.Bold
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = result.content,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }

                // 元数据
                result.metadata?.let { metadata ->
                    if (metadata.isNotEmpty()) {
                        item {
                            Column {
                                Text(
                                    text = "元数据",
                                    style = MaterialTheme.typography.bodyMedium,
                                    fontWeight = FontWeight.Bold
                                )
                                Spacer(modifier = Modifier.height(4.dp))
                                metadata.forEach { (key, value) ->
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.SpaceBetween
                                    ) {
                                        Text(
                                            text = "$key:",
                                            style = MaterialTheme.typography.bodySmall
                                        )
                                        Text(
                                            text = value,
                                            style = MaterialTheme.typography.bodySmall,
                                            fontWeight = FontWeight.Medium
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text("关闭")
            }
        }
    )
}

/**
 * 搜索设置对话框
 */
@Composable
fun SearchSettingsDialog(
    topK: Int,
    onTopKChange: (Int) -> Unit,
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("搜索设置") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                // Top K 设置
                Column {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text(
                            text = "返回结果数量",
                            style = MaterialTheme.typography.bodyMedium
                        )
                        Text(
                            text = "$topK",
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.Bold
                        )
                    }

                    Slider(
                        value = topK.toFloat(),
                        onValueChange = { onTopKChange(it.toInt()) },
                        valueRange = 1f..20f,
                        steps = 18
                    )

                    Text(
                        text = "控制搜索返回的结果数量（1-20）",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text("确定")
            }
        }
    )
}

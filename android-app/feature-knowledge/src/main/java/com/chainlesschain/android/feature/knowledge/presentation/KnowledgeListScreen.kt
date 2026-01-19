package com.chainlesschain.android.feature.knowledge.presentation

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.paging.LoadState
import androidx.paging.compose.LazyPagingItems
import androidx.paging.compose.collectAsLazyPagingItems
import com.chainlesschain.android.feature.knowledge.domain.model.KnowledgeItem
import java.text.SimpleDateFormat
import java.util.*

/**
 * 知识库列表界面
 *
 * 显示知识库条目列表，支持搜索、筛选、分页加载
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun KnowledgeListScreen(
    onItemClick: (String) -> Unit,
    onAddClick: () -> Unit,
    viewModel: KnowledgeViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val knowledgeItems = viewModel.knowledgeItems.collectAsLazyPagingItems()

    Scaffold(
        topBar = {
            KnowledgeTopBar(
                searchQuery = uiState.searchQuery,
                onSearchQueryChange = { viewModel.searchKnowledge(it) },
                onClearSearch = { viewModel.clearSearch() }
            )
        },
        floatingActionButton = {
            FloatingActionButton(onClick = onAddClick) {
                Icon(
                    imageVector = Icons.Default.Add,
                    contentDescription = "添加知识库"
                )
            }
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            // 筛选器
            FilterChips(
                filterMode = uiState.filterMode,
                onFilterChange = { viewModel.setFilterMode(it) }
            )

            // 列表
            KnowledgeList(
                items = knowledgeItems,
                onItemClick = onItemClick,
                onFavoriteClick = { viewModel.toggleFavorite(it) },
                onDeleteClick = { viewModel.deleteItem(it) }
            )
        }

        // 错误提示
        uiState.error?.let { error ->
            Snackbar(
                modifier = Modifier.padding(16.dp),
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

/**
 * 顶部搜索栏
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun KnowledgeTopBar(
    searchQuery: String,
    onSearchQueryChange: (String) -> Unit,
    onClearSearch: () -> Unit
) {
    TopAppBar(
        title = {
            if (searchQuery.isEmpty()) {
                Text("知识库")
            } else {
                SearchField(
                    query = searchQuery,
                    onQueryChange = onSearchQueryChange,
                    onClearClick = onClearSearch
                )
            }
        },
        actions = {
            if (searchQuery.isEmpty()) {
                IconButton(onClick = { onSearchQueryChange("") }) {
                    Icon(
                        imageVector = Icons.Default.Search,
                        contentDescription = "搜索"
                    )
                }
            }
        }
    )
}

/**
 * 搜索输入框
 */
@Composable
fun SearchField(
    query: String,
    onQueryChange: (String) -> Unit,
    onClearClick: () -> Unit
) {
    OutlinedTextField(
        value = query,
        onValueChange = onQueryChange,
        modifier = Modifier.fillMaxWidth(),
        placeholder = { Text("搜索知识库...") },
        trailingIcon = {
            IconButton(onClick = onClearClick) {
                Icon(
                    imageVector = Icons.Default.Clear,
                    contentDescription = "清除搜索"
                )
            }
        },
        singleLine = true,
        colors = OutlinedTextFieldDefaults.colors(
            unfocusedContainerColor = MaterialTheme.colorScheme.surface,
            focusedContainerColor = MaterialTheme.colorScheme.surface
        )
    )
}

/**
 * 筛选器芯片
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FilterChips(
    filterMode: FilterMode,
    onFilterChange: (FilterMode) -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        FilterChip(
            selected = filterMode == FilterMode.ALL,
            onClick = { onFilterChange(FilterMode.ALL) },
            label = { Text("全部") },
            leadingIcon = if (filterMode == FilterMode.ALL) {
                { Icon(Icons.Default.Check, contentDescription = null, modifier = Modifier.size(16.dp)) }
            } else null
        )

        FilterChip(
            selected = filterMode == FilterMode.FAVORITE,
            onClick = { onFilterChange(FilterMode.FAVORITE) },
            label = { Text("收藏") },
            leadingIcon = if (filterMode == FilterMode.FAVORITE) {
                { Icon(Icons.Default.Check, contentDescription = null, modifier = Modifier.size(16.dp)) }
            } else null
        )

        // TODO: 添加文件夹筛选
    }
}

/**
 * 知识库列表
 */
@Composable
fun KnowledgeList(
    items: LazyPagingItems<KnowledgeItem>,
    onItemClick: (String) -> Unit,
    onFavoriteClick: (String) -> Unit,
    onDeleteClick: (String) -> Unit
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        items(items.itemCount) { index ->
            items[index]?.let { item ->
                KnowledgeItemCard(
                    item = item,
                    onClick = { onItemClick(item.id) },
                    onFavoriteClick = { onFavoriteClick(item.id) },
                    onDeleteClick = { onDeleteClick(item.id) }
                )
            }
        }

        // 加载状态
        when (items.loadState.append) {
            is LoadState.Loading -> {
                item {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(16.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        CircularProgressIndicator()
                    }
                }
            }
            is LoadState.Error -> {
                item {
                    Text(
                        text = "加载失败",
                        modifier = Modifier.padding(16.dp),
                        color = MaterialTheme.colorScheme.error
                    )
                }
            }
            else -> {}
        }

        // 刷新状态
        when (items.loadState.refresh) {
            is LoadState.Loading -> {
                item {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(200.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        CircularProgressIndicator()
                    }
                }
            }
            is LoadState.Error -> {
                item {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(16.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = "加载失败，请重试",
                            color = MaterialTheme.colorScheme.error
                        )
                    }
                }
            }
            else -> {}
        }
    }
}

/**
 * 知识库条目卡片
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun KnowledgeItemCard(
    item: KnowledgeItem,
    onClick: () -> Unit,
    onFavoriteClick: () -> Unit,
    onDeleteClick: () -> Unit
) {
    var showDeleteDialog by remember { mutableStateOf(false) }

    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
        ) {
            // 标题行
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(
                    modifier = Modifier.weight(1f),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    // 置顶图标
                    if (item.isPinned) {
                        Icon(
                            imageVector = Icons.Default.PushPin,
                            contentDescription = "置顶",
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.size(16.dp)
                        )
                    }

                    // 标题
                    Text(
                        text = item.title,
                        style = MaterialTheme.typography.titleMedium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }

                // 收藏按钮
                IconButton(onClick = onFavoriteClick) {
                    Icon(
                        imageVector = if (item.isFavorite) Icons.Default.Favorite else Icons.Default.FavoriteBorder,
                        contentDescription = if (item.isFavorite) "取消收藏" else "收藏",
                        tint = if (item.isFavorite) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            Spacer(modifier = Modifier.height(8.dp))

            // 内容预览
            Text(
                text = item.content,
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            Spacer(modifier = Modifier.height(8.dp))

            // 标签
            if (item.tags.isNotEmpty()) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                    modifier = Modifier.padding(vertical = 4.dp)
                ) {
                    item.tags.take(3).forEach { tag ->
                        SuggestionChip(
                            onClick = {},
                            label = { Text(tag, style = MaterialTheme.typography.labelSmall) }
                        )
                    }
                    if (item.tags.size > 3) {
                        Text(
                            text = "+${item.tags.size - 3}",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }

            // 底部信息
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = formatTimestamp(item.updatedAt),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )

                IconButton(onClick = { showDeleteDialog = true }) {
                    Icon(
                        imageVector = Icons.Default.Delete,
                        contentDescription = "删除",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        }
    }

    // 删除确认对话框
    if (showDeleteDialog) {
        AlertDialog(
            onDismissRequest = { showDeleteDialog = false },
            title = { Text("确认删除") },
            text = { Text("确定要删除「${item.title}」吗？") },
            confirmButton = {
                TextButton(
                    onClick = {
                        onDeleteClick()
                        showDeleteDialog = false
                    }
                ) {
                    Text("删除")
                }
            },
            dismissButton = {
                TextButton(onClick = { showDeleteDialog = false }) {
                    Text("取消")
                }
            }
        )
    }
}

/**
 * 格式化时间戳
 */
private fun formatTimestamp(timestamp: Long): String {
    val now = System.currentTimeMillis()
    val diff = now - timestamp

    return when {
        diff < 60_000 -> "刚刚"
        diff < 3600_000 -> "${diff / 60_000}分钟前"
        diff < 86400_000 -> "${diff / 3600_000}小时前"
        diff < 604800_000 -> "${diff / 86400_000}天前"
        else -> {
            val sdf = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())
            sdf.format(Date(timestamp))
        }
    }
}

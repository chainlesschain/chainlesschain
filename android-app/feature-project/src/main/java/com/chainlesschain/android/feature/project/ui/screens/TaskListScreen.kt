package com.chainlesschain.android.feature.project.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Sort
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.FilterList
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.feature.project.model.Task
import com.chainlesschain.android.feature.project.model.TaskListState
import com.chainlesschain.android.feature.project.model.TaskPriority
import com.chainlesschain.android.feature.project.model.TaskSortBy
import com.chainlesschain.android.feature.project.model.TaskStats
import com.chainlesschain.android.feature.project.model.TaskStatus
import com.chainlesschain.android.feature.project.model.TaskUiEvent
import com.chainlesschain.android.feature.project.ui.components.TaskCard
import com.chainlesschain.android.feature.project.viewmodel.TaskViewModel
import kotlinx.coroutines.flow.collectLatest

/**
 * 任务列表页面
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun TaskListScreen(
    viewModel: TaskViewModel = hiltViewModel(),
    userId: String,
    onNavigateBack: () -> Unit,
    onNavigateToTask: (String) -> Unit,
    onNavigateToCreateTask: () -> Unit
) {
    val taskListState by viewModel.taskListState.collectAsState()
    val taskStats by viewModel.taskStats.collectAsState()
    val filter by viewModel.filter.collectAsState()
    val sortBy by viewModel.sortBy.collectAsState()
    val isLoading by viewModel.isLoading.collectAsState()

    var searchQuery by remember { mutableStateOf("") }
    var showSearch by remember { mutableStateOf(false) }
    var showSortMenu by remember { mutableStateOf(false) }
    var showFilterSheet by remember { mutableStateOf(false) }

    val snackbarHostState = remember { SnackbarHostState() }

    // 设置用户 ID
    LaunchedEffect(userId) {
        viewModel.setCurrentUser(userId)
    }

    // 处理 UI 事件
    LaunchedEffect(Unit) {
        viewModel.uiEvents.collectLatest { event ->
            when (event) {
                is TaskUiEvent.ShowMessage -> {
                    snackbarHostState.showSnackbar(event.message)
                }
                is TaskUiEvent.ShowError -> {
                    snackbarHostState.showSnackbar(event.error)
                }
                is TaskUiEvent.NavigateToTask -> {
                    onNavigateToTask(event.taskId)
                }
                is TaskUiEvent.TaskCreated -> {
                    onNavigateToTask(event.task.id)
                }
                else -> {}
            }
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    if (showSearch) {
                        OutlinedTextField(
                            value = searchQuery,
                            onValueChange = {
                                searchQuery = it
                                viewModel.search(it)
                            },
                            placeholder = { Text("搜索任务...") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                            keyboardActions = KeyboardActions(
                                onSearch = { viewModel.search(searchQuery) }
                            ),
                            trailingIcon = {
                                if (searchQuery.isNotEmpty()) {
                                    IconButton(onClick = {
                                        searchQuery = ""
                                        viewModel.search("")
                                    }) {
                                        Icon(Icons.Default.Clear, contentDescription = "清除")
                                    }
                                }
                            }
                        )
                    } else {
                        Text("任务")
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                    }
                },
                actions = {
                    IconButton(onClick = {
                        showSearch = !showSearch
                        if (!showSearch) {
                            searchQuery = ""
                            viewModel.search("")
                        }
                    }) {
                        Icon(
                            imageVector = if (showSearch) Icons.Default.Clear else Icons.Default.Search,
                            contentDescription = "搜索"
                        )
                    }

                    Box {
                        IconButton(onClick = { showSortMenu = true }) {
                            Icon(Icons.AutoMirrored.Filled.Sort, contentDescription = "排序")
                        }
                        SortDropdownMenu(
                            expanded = showSortMenu,
                            onDismiss = { showSortMenu = false },
                            currentSortBy = sortBy,
                            onSortSelected = { sort ->
                                viewModel.setSorting(sort)
                                showSortMenu = false
                            }
                        )
                    }

                    IconButton(onClick = { showFilterSheet = true }) {
                        Icon(Icons.Default.FilterList, contentDescription = "筛选")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface
                )
            )
        },
        floatingActionButton = {
            FloatingActionButton(
                onClick = onNavigateToCreateTask,
                containerColor = MaterialTheme.colorScheme.primary
            ) {
                Icon(Icons.Default.Add, contentDescription = "创建任务")
            }
        },
        snackbarHost = { SnackbarHost(snackbarHostState) }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            // 统计卡片
            TaskStatsCard(
                stats = taskStats,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
            )

            // 筛选芯片
            AnimatedVisibility(
                visible = filter.status != null || filter.priority != null || filter.showOverdueOnly || filter.showTodayOnly,
                enter = fadeIn() + expandVertically(),
                exit = fadeOut() + shrinkVertically()
            ) {
                FlowRow(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    filter.status?.let { status ->
                        FilterChip(
                            selected = true,
                            onClick = { viewModel.filterByStatus(null) },
                            label = { Text(status.displayName) },
                            trailingIcon = {
                                Icon(
                                    Icons.Default.Clear,
                                    contentDescription = "清除",
                                    modifier = Modifier.size(16.dp)
                                )
                            }
                        )
                    }

                    filter.priority?.let { priority ->
                        FilterChip(
                            selected = true,
                            onClick = { viewModel.filterByPriority(null) },
                            label = { Text(priority.displayName) },
                            trailingIcon = {
                                Icon(
                                    Icons.Default.Clear,
                                    contentDescription = "清除",
                                    modifier = Modifier.size(16.dp)
                                )
                            }
                        )
                    }

                    if (filter.showOverdueOnly) {
                        FilterChip(
                            selected = true,
                            onClick = { viewModel.showOverdueOnly(false) },
                            label = { Text("逾期") },
                            trailingIcon = {
                                Icon(
                                    Icons.Default.Clear,
                                    contentDescription = "清除",
                                    modifier = Modifier.size(16.dp)
                                )
                            }
                        )
                    }

                    if (filter.showTodayOnly) {
                        FilterChip(
                            selected = true,
                            onClick = { viewModel.showTodayOnly(false) },
                            label = { Text("今日") },
                            trailingIcon = {
                                Icon(
                                    Icons.Default.Clear,
                                    contentDescription = "清除",
                                    modifier = Modifier.size(16.dp)
                                )
                            }
                        )
                    }
                }
            }

            // 快捷筛选按钮
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                FilterChip(
                    selected = filter.status == null && !filter.showOverdueOnly && !filter.showTodayOnly,
                    onClick = { viewModel.clearFilter() },
                    label = { Text("全部") }
                )
                FilterChip(
                    selected = filter.showTodayOnly,
                    onClick = { viewModel.showTodayOnly(!filter.showTodayOnly) },
                    label = { Text("今日") }
                )
                FilterChip(
                    selected = filter.showOverdueOnly,
                    onClick = { viewModel.showOverdueOnly(!filter.showOverdueOnly) },
                    label = { Text("逾期") }
                )
                FilterChip(
                    selected = filter.status == TaskStatus.COMPLETED,
                    onClick = {
                        viewModel.filterByStatus(
                            if (filter.status == TaskStatus.COMPLETED) null else TaskStatus.COMPLETED
                        )
                    },
                    label = { Text("已完成") }
                )
            }

            // 任务列表
            when (val state = taskListState) {
                is TaskListState.Loading -> {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        CircularProgressIndicator()
                    }
                }

                is TaskListState.Empty -> {
                    EmptyTasksPlaceholder(
                        onCreateTask = onNavigateToCreateTask,
                        modifier = Modifier.fillMaxSize()
                    )
                }

                is TaskListState.Success -> {
                    LazyColumn(
                        contentPadding = PaddingValues(
                            start = 16.dp,
                            end = 16.dp,
                            top = 8.dp,
                            bottom = 88.dp
                        ),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        items(
                            items = state.tasks,
                            key = { it.id }
                        ) { task ->
                            TaskCard(
                                task = task,
                                onClick = { onNavigateToTask(task.id) },
                                onCheckboxClick = { checked ->
                                    if (checked) {
                                        viewModel.completeTask(task.id)
                                    } else {
                                        viewModel.updateTaskStatus(task.id, TaskStatus.PENDING)
                                    }
                                }
                            )
                        }
                    }
                }

                is TaskListState.Error -> {
                    ErrorPlaceholder(
                        message = state.message,
                        onRetry = { viewModel.loadTasks() },
                        modifier = Modifier.fillMaxSize()
                    )
                }
            }
        }
    }

    // 筛选 Bottom Sheet（简化版）
    if (showFilterSheet) {
        TaskFilterSheet(
            currentFilter = filter,
            onFilterChange = { newFilter ->
                viewModel.setFilter(newFilter)
            },
            onDismiss = { showFilterSheet = false }
        )
    }
}

/**
 * 任务统计卡片
 */
@Composable
fun TaskStatsCard(
    stats: TaskStats,
    modifier: Modifier = Modifier
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.3f)
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalArrangement = Arrangement.SpaceEvenly
        ) {
            StatItem(
                value = stats.active.toString(),
                label = "进行中",
                color = MaterialTheme.colorScheme.primary
            )
            StatItem(
                value = stats.completed.toString(),
                label = "已完成",
                color = Color(0xFF4CAF50)
            )
            StatItem(
                value = stats.overdue.toString(),
                label = "逾期",
                color = MaterialTheme.colorScheme.error
            )
            StatItem(
                value = "${(stats.completionRate * 100).toInt()}%",
                label = "完成率",
                color = MaterialTheme.colorScheme.tertiary
            )
        }
    }
}

@Composable
private fun StatItem(
    value: String,
    label: String,
    color: Color
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(
            text = value,
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
            color = color
        )
        Text(
            text = label,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

/**
 * 排序下拉菜单
 */
@Composable
fun SortDropdownMenu(
    expanded: Boolean,
    onDismiss: () -> Unit,
    currentSortBy: TaskSortBy,
    onSortSelected: (TaskSortBy) -> Unit
) {
    DropdownMenu(
        expanded = expanded,
        onDismissRequest = onDismiss
    ) {
        TaskSortBy.entries.forEach { sortBy ->
            DropdownMenuItem(
                text = {
                    Row(
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(sortBy.displayName)
                        if (sortBy == currentSortBy) {
                            Spacer(modifier = Modifier.width(8.dp))
                            Icon(
                                Icons.Default.CheckCircle,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.size(16.dp)
                            )
                        }
                    }
                },
                onClick = { onSortSelected(sortBy) }
            )
        }
    }
}

/**
 * 空任务占位符
 */
@Composable
fun EmptyTasksPlaceholder(
    onCreateTask: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier.padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Icon(
            imageVector = Icons.Default.CheckCircle,
            contentDescription = null,
            modifier = Modifier.size(64.dp),
            tint = MaterialTheme.colorScheme.outline
        )
        Spacer(modifier = Modifier.height(16.dp))
        Text(
            text = "暂无任务",
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = "点击右下角按钮创建第一个任务",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.outline,
            textAlign = TextAlign.Center
        )
    }
}

/**
 * 错误占位符
 */
@Composable
fun ErrorPlaceholder(
    message: String,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier.padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Icon(
            imageVector = Icons.Default.Warning,
            contentDescription = null,
            modifier = Modifier.size(64.dp),
            tint = MaterialTheme.colorScheme.error
        )
        Spacer(modifier = Modifier.height(16.dp))
        Text(
            text = "加载失败",
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.error
        )
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = message,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center
        )
        Spacer(modifier = Modifier.height(16.dp))
        Surface(
            onClick = onRetry,
            color = MaterialTheme.colorScheme.primary,
            shape = RoundedCornerShape(8.dp)
        ) {
            Text(
                text = "重试",
                modifier = Modifier.padding(horizontal = 24.dp, vertical = 12.dp),
                color = MaterialTheme.colorScheme.onPrimary
            )
        }
    }
}

/**
 * 任务筛选 Sheet
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun TaskFilterSheet(
    currentFilter: com.chainlesschain.android.feature.project.model.TaskFilter,
    onFilterChange: (com.chainlesschain.android.feature.project.model.TaskFilter) -> Unit,
    onDismiss: () -> Unit
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp),
        shadowElevation = 8.dp
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
        ) {
            // 标题
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "筛选",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold
                )
                IconButton(onClick = onDismiss) {
                    Icon(Icons.Default.Clear, contentDescription = "关闭")
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            // 状态筛选
            Text(
                text = "状态",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Spacer(modifier = Modifier.height(8.dp))
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                TaskStatus.entries.forEach { status ->
                    FilterChip(
                        selected = currentFilter.status == status,
                        onClick = {
                            onFilterChange(currentFilter.copy(
                                status = if (currentFilter.status == status) null else status
                            ))
                        },
                        label = { Text(status.displayName) }
                    )
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            // 优先级筛选
            Text(
                text = "优先级",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Spacer(modifier = Modifier.height(8.dp))
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                TaskPriority.entries.forEach { priority ->
                    FilterChip(
                        selected = currentFilter.priority == priority,
                        onClick = {
                            onFilterChange(currentFilter.copy(
                                priority = if (currentFilter.priority == priority) null else priority
                            ))
                        },
                        label = { Text(priority.displayName) }
                    )
                }
            }

            Spacer(modifier = Modifier.height(24.dp))

            // 清除筛选按钮
            Surface(
                onClick = {
                    onFilterChange(com.chainlesschain.android.feature.project.model.TaskFilter())
                    onDismiss()
                },
                modifier = Modifier.fillMaxWidth(),
                color = MaterialTheme.colorScheme.surfaceVariant,
                shape = RoundedCornerShape(8.dp)
            ) {
                Text(
                    text = "清除筛选",
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    textAlign = TextAlign.Center,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

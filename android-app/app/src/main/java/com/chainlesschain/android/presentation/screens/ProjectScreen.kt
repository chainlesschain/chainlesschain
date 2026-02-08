package com.chainlesschain.android.presentation.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Sort
import androidx.compose.material.icons.automirrored.outlined.InsertDriveFile
import androidx.compose.material.icons.automirrored.outlined.TrendingUp
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.feature.auth.presentation.AuthViewModel
import com.chainlesschain.android.core.database.entity.ProjectEntity
import com.chainlesschain.android.core.database.entity.ProjectStatus
import com.chainlesschain.android.core.database.entity.ProjectType
import com.chainlesschain.android.feature.project.viewmodel.ProjectViewModel
import com.chainlesschain.android.feature.project.viewmodel.ProjectUiEvent
import com.chainlesschain.android.feature.project.model.ProjectListState
import com.chainlesschain.android.feature.project.model.ProjectSortBy
import com.chainlesschain.android.feature.project.model.ProjectWithStats
import com.chainlesschain.android.feature.project.ui.components.TemplateSelectionDialog
import kotlinx.coroutines.flow.collectLatest

/**
 * 项目页面（整合任务功能）
 * 参考设计稿的"我的任务"样式，将任务概念合并到项目中
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProjectScreen(
    onProjectClick: (String) -> Unit = {},
    onNavigateToFileBrowser: () -> Unit = {},
    projectViewModel: ProjectViewModel = hiltViewModel(),
    authViewModel: AuthViewModel = hiltViewModel()
) {
    var showAddDialog by remember { mutableStateOf(false) }
    var selectedFilter by remember { mutableStateOf("全部") }
    var showSearchBar by remember { mutableStateOf(false) }
    var searchQuery by remember { mutableStateOf("") }
    var showSortMenu by remember { mutableStateOf(false) }
    val snackbarHostState = remember { SnackbarHostState() }

    // 获取认证状态
    val authState by authViewModel.uiState.collectAsState()

    // 初始化用户上下文
    LaunchedEffect(authState.currentUser) {
        authState.currentUser?.let { user ->
            projectViewModel.setCurrentUser(user.id)
        }
    }

    // 监听UI事件
    LaunchedEffect(Unit) {
        projectViewModel.uiEvents.collectLatest { event ->
            when (event) {
                is ProjectUiEvent.ShowMessage -> {
                    snackbarHostState.showSnackbar(event.message)
                }
                is ProjectUiEvent.ShowError -> {
                    snackbarHostState.showSnackbar("错误: ${event.error}")
                }
                is ProjectUiEvent.NavigateToProject -> {
                    onProjectClick(event.projectId)
                }
                else -> {}
            }
        }
    }

    // 获取项目列表状态
    val projectListState by projectViewModel.projectListState.collectAsState()

    // 从ViewModel状态获取真实数据
    val projects = when (val state = projectListState) {
        is ProjectListState.Success -> state.projects
        else -> emptyList()
    }
    val isLoading = projectListState is ProjectListState.Loading

    // 筛选项目
    val filteredProjects = remember(selectedFilter, projects, searchQuery) {
        val filtered = when (selectedFilter) {
            "进行中" -> projects.filter { it.project.status == ProjectStatus.ACTIVE }
            "已完成" -> projects.filter { it.project.status == ProjectStatus.COMPLETED }
            "已暂停" -> projects.filter { it.project.status == ProjectStatus.PAUSED }
            else -> projects
        }
        if (searchQuery.isBlank()) filtered
        else filtered.filter {
            it.project.name.contains(searchQuery, ignoreCase = true) ||
                (it.project.description?.contains(searchQuery, ignoreCase = true) == true)
        }
    }

    Scaffold(
        modifier = Modifier.fillMaxSize(),
        topBar = {
            if (showSearchBar) {
                SearchBar(
                    query = searchQuery,
                    onQueryChange = { searchQuery = it },
                    onSearch = { showSearchBar = false },
                    active = false,
                    onActiveChange = {},
                    leadingIcon = {
                        IconButton(onClick = {
                            showSearchBar = false
                            searchQuery = ""
                        }) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                        }
                    },
                    trailingIcon = {
                        if (searchQuery.isNotEmpty()) {
                            IconButton(onClick = { searchQuery = "" }) {
                                Icon(Icons.Default.Clear, contentDescription = "清除")
                            }
                        }
                    },
                    placeholder = { Text("搜索项目...") },
                    modifier = Modifier.fillMaxWidth()
                ) {}
            } else {
                TopAppBar(
                    title = { Text("我的项目", fontWeight = FontWeight.Bold) },
                    actions = {
                        IconButton(onClick = onNavigateToFileBrowser) {
                            Icon(Icons.Default.FolderOpen, contentDescription = "文件浏览器")
                        }
                        IconButton(onClick = { showSearchBar = true }) {
                            Icon(Icons.Default.Search, contentDescription = "搜索")
                        }
                        IconButton(onClick = { showAddDialog = true }) {
                            Icon(Icons.Default.Add, contentDescription = "新建项目")
                        }
                    }
                )
            }
        },
        snackbarHost = {
            SnackbarHost(hostState = snackbarHostState)
        }
    ) { paddingValues ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues),
            contentPadding = PaddingValues(vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            // 项目统计卡片
            item {
                ProjectStatsCard(
                    totalProjects = projects.size,
                    activeProjects = projects.count { it.project.status == ProjectStatus.ACTIVE },
                    totalFiles = projects.sumOf { it.project.fileCount },
                    completedProjects = projects.count { it.project.status == ProjectStatus.COMPLETED }
                )
            }

            // 筛选器
            item {
                ProjectFilterChips(
                    selectedFilter = selectedFilter,
                    onFilterSelected = { selectedFilter = it }
                )
            }

            // 项目列表标题
            item {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "全部项目 (${filteredProjects.size})",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold
                    )
                    Box {
                        TextButton(onClick = { showSortMenu = true }) {
                            Icon(
                                Icons.AutoMirrored.Filled.Sort,
                                contentDescription = null,
                                modifier = Modifier.size(18.dp)
                            )
                            Spacer(modifier = Modifier.width(4.dp))
                            Text("排序")
                        }
                        DropdownMenu(
                            expanded = showSortMenu,
                            onDismissRequest = { showSortMenu = false }
                        ) {
                            DropdownMenuItem(
                                text = { Text("更新时间") },
                                onClick = {
                                    showSortMenu = false
                                    projectViewModel.setSorting(ProjectSortBy.UPDATED_AT)
                                },
                                leadingIcon = { Icon(Icons.Default.Update, null) }
                            )
                            DropdownMenuItem(
                                text = { Text("名称") },
                                onClick = {
                                    showSortMenu = false
                                    projectViewModel.setSorting(ProjectSortBy.NAME)
                                },
                                leadingIcon = { Icon(Icons.Default.SortByAlpha, null) }
                            )
                            DropdownMenuItem(
                                text = { Text("创建时间") },
                                onClick = {
                                    showSortMenu = false
                                    projectViewModel.setSorting(ProjectSortBy.CREATED_AT)
                                },
                                leadingIcon = { Icon(Icons.Default.DateRange, null) }
                            )
                        }
                    }
                }
            }

            // 加载指示器
            if (isLoading) {
                item {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(32.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        CircularProgressIndicator()
                    }
                }
            }

            // 错误状态
            if (projectListState is ProjectListState.Error) {
                item {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(32.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Text(
                            text = "加载项目失败",
                            style = MaterialTheme.typography.bodyLarge,
                            color = MaterialTheme.colorScheme.error
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        TextButton(onClick = { projectViewModel.loadProjects() }) {
                            Text("重试")
                        }
                    }
                }
            }

            // 空状态
            if (!isLoading && projectListState !is ProjectListState.Error && filteredProjects.isEmpty()) {
                item {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(32.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = "暂无项目",
                            style = MaterialTheme.typography.bodyLarge,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }

            // 项目列表
            items(filteredProjects, key = { it.project.id }) { projectWithStats ->
                EnhancedProjectCard(
                    projectWithStats = projectWithStats,
                    onClick = { onProjectClick(projectWithStats.project.id) }
                )
            }
        }
    }

    // 创建项目对话框
    if (showAddDialog) {
        TemplateSelectionDialog(
            onTemplateSelected = { template ->
                // 使用模板创建项目
                projectViewModel.createProjectFromTemplate(
                    template = template,
                    name = template.name
                )
                showAddDialog = false
            },
            onDismiss = { showAddDialog = false }
        )
    }
}

/**
 * 项目筛选芯片
 */
@Composable
fun ProjectFilterChips(
    selectedFilter: String,
    onFilterSelected: (String) -> Unit
) {
    val filters = listOf("全部", "进行中", "已完成", "已暂停")

    LazyRow(
        modifier = Modifier.fillMaxWidth(),
        contentPadding = PaddingValues(horizontal = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        items(filters) { filter ->
            FilterChip(
                selected = selectedFilter == filter,
                onClick = { onFilterSelected(filter) },
                label = { Text(filter) },
                leadingIcon = if (selectedFilter == filter) {
                    { Icon(Icons.Default.Check, null, modifier = Modifier.size(18.dp)) }
                } else null
            )
        }
    }
}

/**
 * 项目统计卡片
 */
@Composable
fun ProjectStatsCard(
    totalProjects: Int,
    activeProjects: Int,
    totalFiles: Int,
    completedProjects: Int
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.primaryContainer
        ),
        shape = RoundedCornerShape(16.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(20.dp),
            horizontalArrangement = Arrangement.SpaceAround
        ) {
            ProjectStatItem(
                icon = Icons.Outlined.Folder,
                value = totalProjects.toString(),
                label = "总项目"
            )
            ProjectStatItem(
                icon = Icons.AutoMirrored.Outlined.TrendingUp,
                value = activeProjects.toString(),
                label = "进行中"
            )
            ProjectStatItem(
                icon = Icons.AutoMirrored.Outlined.InsertDriveFile,
                value = totalFiles.toString(),
                label = "总文件"
            )
            ProjectStatItem(
                icon = Icons.Outlined.CheckCircle,
                value = completedProjects.toString(),
                label = "已完成"
            )
        }
    }
}

/**
 * 项目统计项
 */
@Composable
fun ProjectStatItem(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    value: String,
    label: String
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onPrimaryContainer,
            modifier = Modifier.size(24.dp)
        )
        Spacer(modifier = Modifier.height(4.dp))
        Text(
            text = value,
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onPrimaryContainer
        )
        Text(
            text = label,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.8f)
        )
    }
}

/**
 * 增强的项目卡片（使用真实数据）
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EnhancedProjectCard(
    projectWithStats: ProjectWithStats,
    onClick: () -> Unit
) {
    val project = projectWithStats.project
    val statusColor = when (project.status) {
        ProjectStatus.ACTIVE -> MaterialTheme.colorScheme.primary
        ProjectStatus.COMPLETED -> MaterialTheme.colorScheme.tertiary
        ProjectStatus.PAUSED -> MaterialTheme.colorScheme.secondary
        ProjectStatus.ARCHIVED -> MaterialTheme.colorScheme.onSurfaceVariant
        else -> MaterialTheme.colorScheme.outline
    }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp),
        onClick = onClick,
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant
        ),
        shape = RoundedCornerShape(16.dp)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
        ) {
            // 顶部行：项目信息 + 状态
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.Top
            ) {
                Row(
                    modifier = Modifier.weight(1f),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    // 项目类型图标
                    Box(
                        modifier = Modifier
                            .size(44.dp)
                            .clip(RoundedCornerShape(12.dp))
                            .background(MaterialTheme.colorScheme.primaryContainer),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            imageVector = getProjectTypeIcon(project.type),
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.onPrimaryContainer,
                            modifier = Modifier.size(24.dp)
                        )
                    }

                    Spacer(modifier = Modifier.width(12.dp))

                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = project.name,
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.SemiBold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                        Spacer(modifier = Modifier.height(2.dp))
                        Text(
                            text = project.description ?: "",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                }

                // 状态标签
                Surface(
                    color = statusColor.copy(alpha = 0.15f),
                    shape = RoundedCornerShape(6.dp)
                ) {
                    Text(
                        text = project.getStatusDisplayName(),
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                        style = MaterialTheme.typography.labelSmall,
                        color = statusColor,
                        fontWeight = FontWeight.Medium
                    )
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            // 文件信息和更新时间
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                // 文件统计
                Row(
                    horizontalArrangement = Arrangement.spacedBy(16.dp)
                ) {
                    FileStatBadge(
                        icon = Icons.AutoMirrored.Outlined.InsertDriveFile,
                        count = project.fileCount,
                        label = "文件"
                    )
                    if (projectWithStats.fileCountByExtension.isNotEmpty()) {
                        Text(
                            text = projectWithStats.getFileTypeDistribution(),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f, fill = false)
                        )
                    }
                }

                // 更新时间
                Text(
                    text = formatTimestamp(project.updatedAt),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            // 项目大小
            if (project.totalSize > 0) {
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = "大小: ${project.getReadableSize()}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

/**
 * 文件统计徽章
 */
@Composable
fun FileStatBadge(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    count: Int,
    label: String,
    color: androidx.compose.ui.graphics.Color = MaterialTheme.colorScheme.onSurfaceVariant
) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            modifier = Modifier.size(16.dp),
            tint = color
        )
        Text(
            text = "$count $label",
            style = MaterialTheme.typography.bodySmall,
            fontWeight = FontWeight.Medium,
            color = color
        )
    }
}

/**
 * 获取项目类型图标
 */
fun getProjectTypeIcon(type: String): androidx.compose.ui.graphics.vector.ImageVector {
    return when (type) {
        ProjectType.DOCUMENT -> Icons.Outlined.Description
        ProjectType.WEB -> Icons.Outlined.Language
        ProjectType.APP -> Icons.Outlined.PhoneAndroid
        ProjectType.DATA -> Icons.Outlined.Analytics
        ProjectType.DESIGN -> Icons.Outlined.Palette
        ProjectType.RESEARCH -> Icons.Outlined.Science
        ProjectType.ANDROID -> Icons.Outlined.PhoneAndroid
        ProjectType.BACKEND -> Icons.Outlined.Storage
        ProjectType.DATA_SCIENCE -> Icons.Outlined.Analytics
        ProjectType.MULTIPLATFORM -> Icons.Outlined.Devices
        ProjectType.FLUTTER -> Icons.Outlined.Folder
        else -> Icons.Outlined.Folder
    }
}

/**
 * 格式化时间戳（Long毫秒 -> 友好显示）
 */
fun formatTimestamp(timestamp: Long): String {
    val now = System.currentTimeMillis()
    val diffMs = now - timestamp
    val minutes = diffMs / 60_000

    return when {
        minutes < 1 -> "刚刚更新"
        minutes < 60 -> "${minutes}分钟前"
        minutes < 1440 -> "${minutes / 60}小时前"
        minutes < 10080 -> "${minutes / 1440}天前"
        else -> {
            val sdf = java.text.SimpleDateFormat("MM-dd", java.util.Locale.getDefault())
            sdf.format(java.util.Date(timestamp))
        }
    }
}

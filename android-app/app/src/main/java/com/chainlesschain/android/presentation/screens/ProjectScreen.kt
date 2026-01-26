package com.chainlesschain.android.presentation.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
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
import com.chainlesschain.android.feature.project.domain.*
import com.chainlesschain.android.feature.project.viewmodel.ProjectViewModel
import com.chainlesschain.android.feature.project.viewmodel.ProjectUiEvent
import com.chainlesschain.android.feature.project.model.ProjectListState
import com.chainlesschain.android.feature.project.ui.components.TemplateSelectionDialog
import kotlinx.coroutines.flow.collectLatest
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter

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
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()

    // 获取认证状态
    val authState by authViewModel.uiState.collectAsState()

    // 初始化用户上下文
    LaunchedEffect(authState.currentUser) {
        android.util.Log.d("ProjectScreen", "LaunchedEffect triggered: authState.currentUser=${authState.currentUser?.id}")
        authState.currentUser?.let { user ->
            android.util.Log.d("ProjectScreen", "Calling setCurrentUser with userId=${user.id}")
            projectViewModel.setCurrentUser(user.id)
        } ?: run {
            android.util.Log.w("ProjectScreen", "authState.currentUser is NULL")
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

    // TODO: 集成真实数据（待实现数据转换）
    // 暂时使用模拟数据避免类型不匹配
    val projects = remember {
        listOf(
            ProjectWithTasks(
                project = ProjectEntity(
                    id = "1",
                    name = "AI助手开发",
                    description = "开发一个智能AI助手应用",
                    type = ProjectType.DEVELOPMENT,
                    status = ProjectStatus.ACTIVE,
                    progress = 0.65f
                ),
                totalTasks = 12,
                completedTasks = 8,
                pendingTasks = 4,
                lastUpdated = LocalDateTime.now().minusHours(2)
            ),
            ProjectWithTasks(
                project = ProjectEntity(
                    id = "2",
                    name = "产品设计文档",
                    description = "整理产品设计相关文档和资料",
                    type = ProjectType.WRITING,
                    status = ProjectStatus.ACTIVE,
                    progress = 0.40f
                ),
                totalTasks = 8,
                completedTasks = 3,
                pendingTasks = 5,
                lastUpdated = LocalDateTime.now().minusDays(1)
            )
        )
    }

    // 显示加载指示器
    val isLoading = false

    // 筛选项目
    val filteredProjects = remember(selectedFilter, projects) {
        when (selectedFilter) {
            "进行中" -> projects.filter { it.project.status == ProjectStatus.ACTIVE }
            "已完成" -> projects.filter { it.project.status == ProjectStatus.COMPLETED }
            "草稿" -> projects.filter { it.project.status == ProjectStatus.DRAFT }
            else -> projects
        }
    }

    Scaffold(
        modifier = Modifier.fillMaxSize(),
        topBar = {
            TopAppBar(
                title = { Text("我的项目", fontWeight = FontWeight.Bold) },
                actions = {
                    IconButton(onClick = onNavigateToFileBrowser) {
                        Icon(Icons.Default.FolderOpen, contentDescription = "文件浏览器")
                    }
                    IconButton(onClick = { /* TODO: 搜索 */ }) {
                        Icon(Icons.Default.Search, contentDescription = "搜索")
                    }
                    IconButton(onClick = { showAddDialog = true }) {
                        Icon(Icons.Default.Add, contentDescription = "新建项目")
                    }
                }
            )
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
                    totalTasks = projects.sumOf { it.totalTasks },
                    completedTasks = projects.sumOf { it.completedTasks },
                    activeProjects = projects.count { it.project.status == ProjectStatus.ACTIVE }
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
                    TextButton(onClick = { /* TODO: 排序 */ }) {
                        Icon(
                            Icons.Default.Sort,
                            contentDescription = null,
                            modifier = Modifier.size(18.dp)
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("排序")
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
            items(filteredProjects, key = { it.project.id }) { projectWithTasks ->
                EnhancedProjectCard(
                    projectWithTasks = projectWithTasks,
                    onClick = { onProjectClick(projectWithTasks.project.id) }
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
    val filters = listOf("全部", "进行中", "已完成", "草稿")

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
 * 项目统计卡片（增强版）
 */
@Composable
fun ProjectStatsCard(
    totalProjects: Int,
    totalTasks: Int,
    completedTasks: Int,
    activeProjects: Int
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
                icon = Icons.Outlined.Assignment,
                value = totalTasks.toString(),
                label = "总任务"
            )
            ProjectStatItem(
                icon = Icons.Outlined.CheckCircle,
                value = completedTasks.toString(),
                label = "已完成"
            )
            ProjectStatItem(
                icon = Icons.Outlined.TrendingUp,
                value = activeProjects.toString(),
                label = "进行中"
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
 * 增强的项目卡片（包含任务信息）
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EnhancedProjectCard(
    projectWithTasks: ProjectWithTasks,
    onClick: () -> Unit
) {
    val project = projectWithTasks.project
    val statusColor = when (project.status) {
        ProjectStatus.ACTIVE -> MaterialTheme.colorScheme.primary
        ProjectStatus.COMPLETED -> MaterialTheme.colorScheme.tertiary
        ProjectStatus.PAUSED -> MaterialTheme.colorScheme.secondary
        ProjectStatus.DRAFT -> MaterialTheme.colorScheme.outline
        ProjectStatus.ARCHIVED -> MaterialTheme.colorScheme.onSurfaceVariant
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
            // 顶部行：项目信息 + 状态 + 操作
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
                        text = project.status.displayName,
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                        style = MaterialTheme.typography.labelSmall,
                        color = statusColor,
                        fontWeight = FontWeight.Medium
                    )
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            // 任务进度信息
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                // 任务统计
                Row(
                    horizontalArrangement = Arrangement.spacedBy(16.dp)
                ) {
                    TaskStatBadge(
                        icon = Icons.Outlined.Assignment,
                        count = projectWithTasks.totalTasks,
                        label = "任务"
                    )
                    TaskStatBadge(
                        icon = Icons.Outlined.CheckCircle,
                        count = projectWithTasks.completedTasks,
                        label = "完成",
                        color = MaterialTheme.colorScheme.tertiary
                    )
                    TaskStatBadge(
                        icon = Icons.Outlined.Schedule,
                        count = projectWithTasks.pendingTasks,
                        label = "待办",
                        color = MaterialTheme.colorScheme.primary
                    )
                }

                // 更新时间
                Text(
                    text = formatLastUpdated(projectWithTasks.lastUpdated),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            Spacer(modifier = Modifier.height(12.dp))

            // 进度条
            Column {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text(
                        text = "项目进度",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Text(
                        text = "${(project.progress * 100).toInt()}%",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.primary,
                        fontWeight = FontWeight.SemiBold
                    )
                }
                Spacer(modifier = Modifier.height(6.dp))
                LinearProgressIndicator(
                    progress = { project.progress },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(8.dp)
                        .clip(RoundedCornerShape(4.dp)),
                    trackColor = MaterialTheme.colorScheme.surfaceVariant,
                )
            }
        }
    }
}

/**
 * 任务统计徽章
 */
@Composable
fun TaskStatBadge(
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
            text = "$count",
            style = MaterialTheme.typography.bodySmall,
            fontWeight = FontWeight.Medium,
            color = color
        )
    }
}

/**
 * 获取项目类型图标
 */
fun getProjectTypeIcon(type: ProjectType): androidx.compose.ui.graphics.vector.ImageVector {
    return when (type) {
        ProjectType.GENERAL -> Icons.Outlined.Folder
        ProjectType.RESEARCH -> Icons.Outlined.Science
        ProjectType.DEVELOPMENT -> Icons.Outlined.Code
        ProjectType.WRITING -> Icons.Outlined.Edit
        ProjectType.DESIGN -> Icons.Outlined.Palette
        ProjectType.ANDROID -> Icons.Outlined.PhoneAndroid
        ProjectType.BACKEND -> Icons.Outlined.Storage
        ProjectType.DATA_SCIENCE -> Icons.Outlined.Analytics
        ProjectType.MULTIPLATFORM -> Icons.Outlined.Devices
        ProjectType.FLUTTER -> Icons.Outlined.Folder
    }
}

/**
 * 格式化最后更新时间
 */
fun formatLastUpdated(dateTime: LocalDateTime): String {
    val now = LocalDateTime.now()
    val minutes = java.time.Duration.between(dateTime, now).toMinutes()

    return when {
        minutes < 1 -> "刚刚更新"
        minutes < 60 -> "${minutes}分钟前"
        minutes < 1440 -> "${minutes / 60}小时前"
        minutes < 10080 -> "${minutes / 1440}天前"
        else -> dateTime.format(DateTimeFormatter.ofPattern("MM-dd"))
    }
}

/**
 * 项目与任务数据类
 */
data class ProjectWithTasks(
    val project: ProjectEntity,
    val totalTasks: Int,
    val completedTasks: Int,
    val pendingTasks: Int,
    val lastUpdated: LocalDateTime
)

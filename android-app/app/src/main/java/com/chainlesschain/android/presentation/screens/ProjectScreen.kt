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

    // 获取认证状态和项目列表状态
    val authState by authViewModel.uiState.collectAsState()
    val projectListState by projectViewModel.projectListState.collectAsState()

    // 加载用户项目
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

    // 从真实数据或使用模拟数据
    val projects = when (val state = projectListState) {
        is ProjectListState.Success -> state.projects.map { projectWithStats ->
            // 转换为ProjectWithTasks格式
            ProjectWithTasks(
                project = projectWithStats.project,
                totalTasks = projectWithStats.statistics.totalFiles,
                completedTasks = (projectWithStats.statistics.totalFiles * projectWithStats.project.progress).toInt(),
                pendingTasks = projectWithStats.statistics.totalFiles - (projectWithStats.statistics.totalFiles * projectWithStats.project.progress).toInt(),
                lastUpdated = projectWithStats.project.updatedAt
            )
        }
        is ProjectListState.Loading -> emptyList()
        is ProjectListState.Error -> {
            // 如果加载失败，使用模拟数据作为后备
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
            ),
            ProjectWithTasks(
                project = ProjectEntity(
                    id = "3",
                    name = "市场调研分析",
                    description = "进行竞品分析和市场调研",
                    type = ProjectType.RESEARCH,
                    status = ProjectStatus.DRAFT,
                    progress = 0.15f
                ),
                totalTasks = 6,
                completedTasks = 1,
                pendingTasks = 5,
                lastUpdated = LocalDateTime.now().minusDays(3)
            ),
            ProjectWithTasks(
                project = ProjectEntity(
                    id = "4",
                    name = "UI界面设计",
                    description = "设计应用的用户界面",
                    type = ProjectType.DESIGN,
                    status = ProjectStatus.COMPLETED,
                    progress = 1.0f
                ),
                totalTasks = 10,
                completedTasks = 10,
                pendingTasks = 0,
                lastUpdated = LocalDateTime.now().minusWeeks(1)
            )
        )
    }

    // 筛选项目
    val filteredProjects = remember(selectedFilter, projects) {
        when (selectedFilter) {
            "进行中" -> projects.filter { it.project.status == ProjectStatus.ACTIVE }
            "已完成" -> projects.filter { it.project.status == ProjectStatus.COMPLETED }
            "草稿" -> projects.filter { it.project.status == ProjectStatus.DRAFT }
            else -> projects
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.surface)
    ) {
        // 顶部栏
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

        LazyColumn(
            modifier = Modifier.fillMaxSize(),
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

            // 项目列表
            items(filteredProjects, key = { it.project.id }) { projectWithTasks ->
                EnhancedProjectCard(
                    projectWithTasks = projectWithTasks,
                    onClick = { onProjectClick(projectWithTasks.project.id) }
                )
            }
        }

        // Snackbar提示
        SnackbarHost(
            hostState = snackbarHostState,
            modifier = Modifier
                .fillMaxWidth()
                .align(Alignment.BottomCenter)
                .padding(16.dp)
        )
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

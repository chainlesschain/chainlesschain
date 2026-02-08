package com.chainlesschain.android.presentation.screens

import androidx.compose.animation.*
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.filled.InsertDriveFile
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.chainlesschain.android.feature.project.domain.*
import com.chainlesschain.android.presentation.components.*
import java.time.format.DateTimeFormatter

/**
 * 项目详情页面 (V1 - 已废弃)
 *
 * 此页面已被 ProjectDetailScreenV2 替代，不在 NavGraph 中使用。
 * 保留仅供参考。使用 ProjectDetailScreenV2 代替。
 */
@Deprecated("Use ProjectDetailScreenV2 instead. This screen is not in the NavGraph.")
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProjectDetailScreen(
    project: ProjectEntity,
    onNavigateBack: () -> Unit = {}
) {
    var selectedTab by remember { mutableStateOf(ProjectTab.FILES) }
    var showMenu by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(project.name) },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                    }
                },
                actions = {
                    IconButton(onClick = { showMenu = true }) {
                        Icon(Icons.Default.MoreVert, contentDescription = "更多")
                    }
                    DropdownMenu(
                        expanded = showMenu,
                        onDismissRequest = { showMenu = false }
                    ) {
                        DropdownMenuItem(
                            text = { Text("编辑项目") },
                            onClick = { /* TODO */ },
                            leadingIcon = { Icon(Icons.Default.Edit, null) }
                        )
                        DropdownMenuItem(
                            text = { Text("分享项目") },
                            onClick = { /* TODO */ },
                            leadingIcon = { Icon(Icons.Default.Share, null) }
                        )
                        DropdownMenuItem(
                            text = { Text("导出") },
                            onClick = { /* TODO */ },
                            leadingIcon = { Icon(Icons.Default.Download, null) }
                        )
                        HorizontalDivider()
                        DropdownMenuItem(
                            text = { Text("删除项目", color = MaterialTheme.colorScheme.error) },
                            onClick = { /* TODO */ },
                            leadingIcon = { Icon(Icons.Default.Delete, null, tint = MaterialTheme.colorScheme.error) }
                        )
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
            // 项目头部信息
            ProjectHeader(project)

            HorizontalDivider()

            // Tab 栏
            ProjectTabBar(
                selectedTab = selectedTab,
                onTabSelected = { selectedTab = it }
            )

            HorizontalDivider()

            // Tab 内容
            when (selectedTab) {
                ProjectTab.FILES -> ProjectFilesTab(project)
                ProjectTab.CHAT -> ProjectChatTab(project)
                ProjectTab.EDITOR -> ProjectEditorTab(project)
                ProjectTab.GIT -> ProjectGitTab(project)
                ProjectTab.INFO -> ProjectInfoTab(project)
            }
        }
    }
}

/**
 * 项目Tab枚举
 */
enum class ProjectTab(val displayName: String, val icon: androidx.compose.ui.graphics.vector.ImageVector) {
    FILES("文件", Icons.Default.Folder),
    CHAT("对话", Icons.AutoMirrored.Filled.Chat),
    EDITOR("编辑", Icons.Default.Edit),
    GIT("Git", Icons.Default.Code),
    INFO("信息", Icons.Default.Info)
}

/**
 * 项目头部
 */
@Composable
fun ProjectHeader(project: ProjectEntity) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(16.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant
        )
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                // 项目图标
                Box(
                    modifier = Modifier
                        .size(48.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(getStatusColor(project.status).copy(alpha = 0.1f)),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = getTypeIcon(project.type),
                        contentDescription = null,
                        tint = getStatusColor(project.status),
                        modifier = Modifier.size(28.dp)
                    )
                }

                Column(modifier = Modifier.weight(1f)) {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Tag(
                            text = project.status.displayName,
                            color = getStatusColor(project.status).copy(alpha = 0.1f),
                            contentColor = getStatusColor(project.status)
                        )

                        if (project.isShared) {
                            Icon(
                                imageVector = Icons.Default.Link,
                                contentDescription = "已分享",
                                tint = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.size(16.dp)
                            )
                        }
                    }

                    Spacer(modifier = Modifier.height(4.dp))

                    Row(
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(4.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(
                                imageVector = Icons.Default.Description,
                                contentDescription = null,
                                modifier = Modifier.size(14.dp),
                                tint = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                            Text(
                                text = "${project.fileCount}",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }

                        Row(
                            horizontalArrangement = Arrangement.spacedBy(4.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(
                                imageVector = Icons.Default.Storage,
                                contentDescription = null,
                                modifier = Modifier.size(14.dp),
                                tint = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                            Text(
                                text = project.formattedSize,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
            }

            // 描述
            if (!project.description.isNullOrBlank()) {
                Text(
                    text = project.description,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            // 进度条
            if (project.progress > 0) {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text(
                            text = "进度",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Text(
                            text = "${(project.progress * 100).toInt()}%",
                            style = MaterialTheme.typography.labelSmall,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.primary
                        )
                    }
                    LinearProgressIndicator(
                        progress = project.progress,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(8.dp)
                            .clip(RoundedCornerShape(4.dp))
                    )
                }
            }

            // 标签
            if (project.tags.isNotEmpty()) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    project.tags.take(3).forEach { tag ->
                        Tag(text = tag)
                    }
                    if (project.tags.size > 3) {
                        Tag(text = "+${project.tags.size - 3}")
                    }
                }
            }
        }
    }
}

/**
 * Tab 栏
 */
@Composable
fun ProjectTabBar(
    selectedTab: ProjectTab,
    onTabSelected: (ProjectTab) -> Unit
) {
    ScrollableTabRow(
        selectedTabIndex = ProjectTab.values().indexOf(selectedTab),
        edgePadding = 0.dp
    ) {
        ProjectTab.values().forEach { tab ->
            Tab(
                selected = selectedTab == tab,
                onClick = { onTabSelected(tab) },
                text = {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            imageVector = tab.icon,
                            contentDescription = null,
                            modifier = Modifier.size(18.dp)
                        )
                        Text(tab.displayName)
                    }
                }
            )
        }
    }
}

/**
 * 文件Tab
 */
@Composable
fun ProjectFilesTab(project: ProjectEntity) {
    // 模拟文件列表
    val sampleFiles = remember {
        listOf(
            ProjectFileEntity(
                id = "1",
                projectId = project.id,
                name = "README.md",
                path = "/README.md",
                type = FileType.DOCUMENT,
                size = 1024
            ),
            ProjectFileEntity(
                id = "2",
                projectId = project.id,
                name = "main.kt",
                path = "/src/main.kt",
                type = FileType.CODE,
                size = 2048
            )
        )
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        item {
            Button(
                onClick = { /* TODO: 添加文件 */ },
                modifier = Modifier.fillMaxWidth()
            ) {
                Icon(Icons.Default.Add, contentDescription = null)
                Spacer(modifier = Modifier.width(8.dp))
                Text("添加文件")
            }
        }

        items(sampleFiles) { file ->
            FileCard(file)
        }
    }
}

@Composable
fun FileCard(file: ProjectFileEntity) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        onClick = { /* TODO: 打开文件 */ }
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = getFileIcon(file.type),
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(32.dp)
            )

            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = file.name,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.Medium
                )
                Text(
                    text = "${file.formattedSize} · ${file.updatedAt.format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm"))}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            IconButton(onClick = { /* TODO: 文件操作 */ }) {
                Icon(Icons.Default.MoreVert, contentDescription = "更多")
            }
        }
    }
}

/**
 * 对话Tab
 */
@Composable
fun ProjectChatTab(project: ProjectEntity) {
    Box(
        modifier = Modifier.fillMaxSize(),
        contentAlignment = Alignment.Center
    ) {
        EmptyState(
            icon = Icons.AutoMirrored.Filled.Chat,
            title = "项目AI对话",
            description = "与AI讨论项目内容，获取智能建议",
            actionText = "开始对话",
            onAction = { /* TODO */ }
        )
    }
}

/**
 * 编辑器Tab
 */
@Composable
fun ProjectEditorTab(project: ProjectEntity) {
    Box(
        modifier = Modifier.fillMaxSize(),
        contentAlignment = Alignment.Center
    ) {
        EmptyState(
            icon = Icons.Default.Edit,
            title = "代码编辑器",
            description = "在这里编辑项目文件",
            actionText = "打开编辑器",
            onAction = { /* TODO */ }
        )
    }
}

/**
 * Git Tab
 */
@Composable
fun ProjectGitTab(project: ProjectEntity) {
    Box(
        modifier = Modifier.fillMaxSize(),
        contentAlignment = Alignment.Center
    ) {
        EmptyState(
            icon = Icons.Default.Code,
            title = "Git 版本控制",
            description = "管理项目的Git仓库",
            actionText = "初始化Git",
            onAction = { /* TODO */ }
        )
    }
}

/**
 * 项目信息Tab
 */
@Composable
fun ProjectInfoTab(project: ProjectEntity) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        item {
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Text(
                        text = "基本信息",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold
                    )

                    InfoRow("类型", project.type.displayName)
                    InfoRow("状态", project.status.displayName)
                    InfoRow("创建时间", project.createdAt.format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm")))
                    InfoRow("更新时间", project.updatedAt.format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm")))

                    project.dueDate?.let {
                        InfoRow("截止日期", it.format(DateTimeFormatter.ofPattern("yyyy-MM-dd")))
                    }
                }
            }
        }

        item {
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Text(
                        text = "统计信息",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold
                    )

                    InfoRow("文件数量", "${project.fileCount} 个")
                    InfoRow("总大小", project.formattedSize)
                    InfoRow("完成进度", "${(project.progress * 100).toInt()}%")
                }
            }
        }
    }
}

@Composable
fun InfoRow(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Text(
            text = value,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.Medium
        )
    }
}

// 辅助函数
fun getStatusColor(status: ProjectStatus): Color {
    return when (status) {
        ProjectStatus.DRAFT -> Color.Gray
        ProjectStatus.ACTIVE -> Color(0xFF4CAF50)
        ProjectStatus.PAUSED -> Color(0xFFFFA726)
        ProjectStatus.COMPLETED -> Color(0xFF2196F3)
        ProjectStatus.ARCHIVED -> Color(0xFF9E9E9E)
    }
}

fun getTypeIcon(type: ProjectType): androidx.compose.ui.graphics.vector.ImageVector {
    return when (type) {
        ProjectType.GENERAL -> Icons.Default.Folder
        ProjectType.RESEARCH -> Icons.Default.Science
        ProjectType.DEVELOPMENT -> Icons.Default.Code
        ProjectType.WRITING -> Icons.Default.Edit
        ProjectType.DESIGN -> Icons.Default.Palette
        ProjectType.ANDROID -> Icons.Default.PhoneAndroid
        ProjectType.BACKEND -> Icons.Default.Storage
        ProjectType.DATA_SCIENCE -> Icons.Default.Analytics
        ProjectType.MULTIPLATFORM -> Icons.Default.Devices
        ProjectType.FLUTTER -> Icons.Default.FlutterDash
    }
}

fun getFileIcon(type: FileType): androidx.compose.ui.graphics.vector.ImageVector {
    return when (type) {
        FileType.DOCUMENT -> Icons.Default.Description
        FileType.CODE -> Icons.Default.Code
        FileType.IMAGE -> Icons.Default.Image
        FileType.VIDEO -> Icons.Default.VideoLibrary
        FileType.AUDIO -> Icons.Default.AudioFile
        FileType.OTHER -> Icons.Default.InsertDriveFile
    }
}

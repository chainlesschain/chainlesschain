package com.chainlesschain.android.presentation.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Code
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Preview
import androidx.compose.material.icons.filled.Save
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.core.database.entity.ProjectFileEntity
import com.chainlesschain.android.core.ui.components.MarkdownText
import com.chainlesschain.android.feature.project.viewmodel.ProjectViewModel

/**
 * 项目文件列表 (#21 P3 + user feedback "在项目管理要可以查看本项目文件")。
 *
 * 接 [ProjectViewModel.projectFiles] (List<ProjectFileEntity>)。点文件 → bottom
 * sheet 显示文件内容；`.md` / `.markdown` 走 MarkdownText 渲染 + 双 tab (预览/源码)。
 *
 * 入口：ProjectDetailScreenV2 顶部 folder icon (改 wire 到此屏 而不是全局
 * FileBrowser)。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProjectFilesScreen(
    projectId: String,
    onNavigateBack: () -> Unit,
    viewModel: ProjectViewModel = hiltViewModel(),
) {
    // 加载项目文件列表
    LaunchedEffect(projectId) {
        viewModel.loadProjectFiles(projectId)
    }
    val projectFiles by viewModel.projectFiles.collectAsState()

    var selectedFile by remember { mutableStateOf<ProjectFileEntity?>(null) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("项目文件", style = MaterialTheme.typography.titleMedium)
                        Text(
                            text = "共 ${projectFiles.size} 项",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                    }
                },
            )
        },
    ) { paddingValues ->
        if (projectFiles.isEmpty()) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(paddingValues),
                contentAlignment = Alignment.Center,
            ) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Icon(
                        imageVector = Icons.Default.Folder,
                        contentDescription = null,
                        modifier = Modifier.size(56.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f),
                    )
                    Text(
                        text = "暂无文件",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        } else {
            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(paddingValues),
                contentPadding = PaddingValues(12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(projectFiles, key = { it.id }) { file ->
                    FileRow(file = file, onClick = { selectedFile = file })
                }
            }
        }
    }

    // File content viewer bottom sheet
    selectedFile?.let { file ->
        ModalBottomSheet(
            onDismissRequest = { selectedFile = null },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        ) {
            FileContentView(
                file = file,
                onSave = { newContent ->
                    viewModel.updateFileContent(file.id, newContent)
                    // 重新载入列表 (content 改了, last-modified 也变, list 自动 emit)
                },
                onDelete = {
                    viewModel.deleteFile(file.id)
                    selectedFile = null
                },
            )
        }
    }
}

@Composable
private fun FileRow(file: ProjectFileEntity, onClick: () -> Unit) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant,
        ),
        shape = RoundedCornerShape(10.dp),
    ) {
        Row(
            modifier = Modifier.padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            val isMd = file.extension?.lowercase() in setOf("md", "markdown")
            Icon(
                imageVector = if (file.type == "folder") Icons.Default.Folder
                    else if (isMd) Icons.Default.Description
                    else Icons.Default.Code,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(28.dp),
            )
            Spacer(modifier = Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = file.name,
                    style = MaterialTheme.typography.bodyMedium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = "${file.path} · ${formatSize(file.size)}",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@Composable
private fun FileContentView(
    file: ProjectFileEntity,
    onSave: (String) -> Unit,
    onDelete: () -> Unit,
) {
    val isMd = file.extension?.lowercase() in setOf("md", "markdown")
    // tab: 0 = 预览 (only for md), 1 = 编辑
    var selectedTab by remember { mutableIntStateOf(if (isMd) 0 else 1) }
    var editingContent by remember(file.id) { mutableStateOf(file.content ?: "") }
    var showDeleteConfirm by remember { mutableStateOf(false) }
    val isDirty = editingContent != (file.content ?: "")

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp),
    ) {
        // 头部：标题 + 操作按钮
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = file.name,
                    style = MaterialTheme.typography.titleMedium,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = file.path,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            // 保存（编辑改动后亮起）
            IconButton(
                onClick = { onSave(editingContent) },
                enabled = isDirty,
            ) {
                Icon(
                    Icons.Default.Save,
                    contentDescription = "保存",
                    tint = if (isDirty) MaterialTheme.colorScheme.primary
                        else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f),
                )
            }
            // 删除
            IconButton(onClick = { showDeleteConfirm = true }) {
                Icon(
                    Icons.Default.Delete,
                    contentDescription = "删除",
                    tint = MaterialTheme.colorScheme.error,
                )
            }
        }
        Spacer(modifier = Modifier.height(8.dp))

        if (isMd) {
            TabRow(selectedTabIndex = selectedTab) {
                Tab(
                    selected = selectedTab == 0,
                    onClick = { selectedTab = 0 },
                    text = { Text("预览") },
                    icon = { Icon(Icons.Default.Preview, null) },
                )
                Tab(
                    selected = selectedTab == 1,
                    onClick = { selectedTab = 1 },
                    text = { Text("编辑") },
                    icon = { Icon(Icons.Default.Edit, null) },
                )
            }
        }

        val scrollState = rememberScrollState()
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 200.dp, max = 500.dp)
                .verticalScroll(scrollState)
                .padding(12.dp)
                .clip(RoundedCornerShape(8.dp)),
        ) {
            if (isMd && selectedTab == 0) {
                // 预览：渲染 editing content (实时反映编辑)
                MarkdownText(
                    markdown = editingContent.ifBlank { "（文件内容为空）" },
                    textColor = MaterialTheme.colorScheme.onSurface,
                    linkColor = MaterialTheme.colorScheme.primary,
                    style = MaterialTheme.typography.bodyMedium,
                )
            } else {
                // 编辑：TextField
                OutlinedTextField(
                    value = editingContent,
                    onValueChange = { editingContent = it },
                    modifier = Modifier.fillMaxWidth(),
                    textStyle = MaterialTheme.typography.bodyMedium,
                    placeholder = { Text("（输入文件内容）") },
                )
            }
        }
        Spacer(modifier = Modifier.height(8.dp))
    }

    // 删除确认
    if (showDeleteConfirm) {
        AlertDialog(
            onDismissRequest = { showDeleteConfirm = false },
            icon = {
                Icon(
                    Icons.Default.Delete,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.error,
                )
            },
            title = { Text("删除文件") },
            text = { Text("确定要删除 \"${file.name}\" 吗？此操作不可撤销。") },
            confirmButton = {
                TextButton(
                    onClick = {
                        showDeleteConfirm = false
                        onDelete()
                    },
                    colors = ButtonDefaults.textButtonColors(
                        contentColor = MaterialTheme.colorScheme.error,
                    ),
                ) {
                    Text("删除")
                }
            },
            dismissButton = {
                TextButton(onClick = { showDeleteConfirm = false }) {
                    Text("取消")
                }
            },
        )
    }
}

private fun formatSize(bytes: Long): String {
    if (bytes <= 0) return "0 B"
    val units = arrayOf("B", "KB", "MB", "GB")
    var size = bytes.toDouble()
    var unitIdx = 0
    while (size >= 1024 && unitIdx < units.size - 1) {
        size /= 1024
        unitIdx++
    }
    return "${"%.1f".format(size)} ${units[unitIdx]}"
}

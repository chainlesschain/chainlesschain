package com.chainlesschain.android.feature.project.ui

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.core.database.entity.ExternalFileEntity
import com.chainlesschain.android.core.database.entity.FileCategory
import com.chainlesschain.android.feature.filebrowser.data.scanner.MediaStoreScanner
import com.chainlesschain.android.feature.filebrowser.viewmodel.GlobalFileBrowserViewModel

/**
 * 文件选择对话框 - 用于AI聊天添加附件
 *
 * 功能：
 * - 多选文件
 * - 分类筛选
 * - 搜索功能
 * - 返回选中的文件列表
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FilePickerDialog(
    onDismiss: () -> Unit,
    onFilesSelected: (List<AttachedFileData>) -> Unit,
    viewModel: GlobalFileBrowserViewModel = hiltViewModel()
) {
    // State
    val permissionGranted by viewModel.permissionGranted.collectAsState()
    val files by viewModel.files.collectAsState()
    val selectedCategory by viewModel.selectedCategory.collectAsState()
    val searchQuery by viewModel.searchQuery.collectAsState()

    var selectedFileIds by remember { mutableStateOf(setOf<String>()) }
    var showSearchBar by remember { mutableStateOf(false) }

    // Permission launcher
    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        if (permissions.values.all { it }) {
            viewModel.onPermissionsGranted()
        }
    }

    // Request permissions on first launch
    LaunchedEffect(Unit) {
        if (!permissionGranted) {
            val permissions = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                arrayOf(
                    Manifest.permission.READ_MEDIA_IMAGES,
                    Manifest.permission.READ_MEDIA_VIDEO,
                    Manifest.permission.READ_MEDIA_AUDIO
                )
            } else {
                arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE)
            }
            permissionLauncher.launch(permissions)
        }
    }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Surface(
            modifier = Modifier
                .fillMaxWidth(0.95f)
                .fillMaxHeight(0.85f),
            shape = RoundedCornerShape(16.dp),
            color = MaterialTheme.colorScheme.surface
        ) {
            Column(modifier = Modifier.fillMaxSize()) {
                // 顶部栏
                TopAppBar(
                    title = {
                        if (showSearchBar) {
                            OutlinedTextField(
                                value = searchQuery,
                                onValueChange = { viewModel.searchFiles(it) },
                                placeholder = { Text("搜索文件...") },
                                modifier = Modifier.fillMaxWidth(),
                                singleLine = true
                            )
                        } else {
                            Column {
                                Text("选择附件")
                                if (selectedFileIds.isNotEmpty()) {
                                    Text(
                                        text = "已选 ${selectedFileIds.size} 个文件",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.primary
                                    )
                                }
                            }
                        }
                    },
                    navigationIcon = {
                        IconButton(onClick = onDismiss) {
                            Icon(Icons.Default.Close, contentDescription = "关闭")
                        }
                    },
                    actions = {
                        IconButton(onClick = { showSearchBar = !showSearchBar }) {
                            Icon(Icons.Default.Search, contentDescription = "搜索")
                        }
                        if (selectedFileIds.isNotEmpty()) {
                            IconButton(
                                onClick = {
                                    selectedFileIds = emptySet()
                                }
                            ) {
                                Icon(Icons.Default.Clear, contentDescription = "清除选择")
                            }
                        }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(
                        containerColor = MaterialTheme.colorScheme.primaryContainer,
                        titleContentColor = MaterialTheme.colorScheme.onPrimaryContainer
                    )
                )

                // Permission request UI
                if (!permissionGranted) {
                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            .weight(1f),
                        contentAlignment = Alignment.Center
                    ) {
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            modifier = Modifier.padding(24.dp)
                        ) {
                            Text(
                                text = "需要存储权限",
                                style = MaterialTheme.typography.headlineSmall,
                                color = MaterialTheme.colorScheme.onSurface
                            )

                            Text(
                                text = "文件选择需要访问您的设备存储。",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                textAlign = TextAlign.Center,
                                modifier = Modifier.padding(top = 16.dp)
                            )

                            Button(
                                onClick = {
                                    val permissions = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                                        arrayOf(
                                            Manifest.permission.READ_MEDIA_IMAGES,
                                            Manifest.permission.READ_MEDIA_VIDEO,
                                            Manifest.permission.READ_MEDIA_AUDIO
                                        )
                                    } else {
                                        arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE)
                                    }
                                    permissionLauncher.launch(permissions)
                                },
                                modifier = Modifier.padding(top = 24.dp)
                            ) {
                                Text("授予权限")
                            }
                        }
                    }
                } else {
                    // Category tabs
                    LazyRow(
                        modifier = Modifier.fillMaxWidth(),
                        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        item {
                            FilterChip(
                                selected = selectedCategory == null,
                                onClick = { viewModel.selectCategory(null) },
                                label = { Text("全部") }
                            )
                        }

                        items(FileCategory.values()) { category ->
                            FilterChip(
                                selected = selectedCategory == category,
                                onClick = { viewModel.selectCategory(category) },
                                label = {
                                    Text(
                                        when (category) {
                                            FileCategory.DOCUMENT -> "文档"
                                            FileCategory.IMAGE -> "图片"
                                            FileCategory.VIDEO -> "视频"
                                            FileCategory.AUDIO -> "音频"
                                            FileCategory.ARCHIVE -> "压缩包"
                                            FileCategory.CODE -> "代码"
                                            FileCategory.OTHER -> "其他"
                                        }
                                    )
                                }
                            )
                        }
                    }

                    // File list
                    LazyColumn(
                        modifier = Modifier
                            .fillMaxWidth()
                            .weight(1f),
                        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        if (files.isEmpty()) {
                            item {
                                Box(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(vertical = 32.dp),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Text(
                                        text = "未找到文件\n请在文件浏览器中扫描文件",
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        textAlign = TextAlign.Center
                                    )
                                }
                            }
                        } else {
                            items(files, key = { it.id }) { file ->
                                FilePickerItem(
                                    file = file,
                                    isSelected = selectedFileIds.contains(file.id),
                                    onSelectionChange = { isSelected ->
                                        selectedFileIds = if (isSelected) {
                                            selectedFileIds + file.id
                                        } else {
                                            selectedFileIds - file.id
                                        }
                                    }
                                )
                            }
                        }
                    }

                    // Bottom action bar
                    Surface(
                        modifier = Modifier.fillMaxWidth(),
                        tonalElevation = 3.dp
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(16.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            TextButton(onClick = onDismiss) {
                                Text("取消")
                            }

                            Button(
                                onClick = {
                                    val selectedFiles = files.filter { selectedFileIds.contains(it.id) }
                                    val attachedFiles = selectedFiles.map { it.toAttachedFileData() }
                                    onFilesSelected(attachedFiles)
                                    onDismiss()
                                },
                                enabled = selectedFileIds.isNotEmpty()
                            ) {
                                Text("添加 (${selectedFileIds.size})")
                            }
                        }
                    }
                }
            }
        }
    }
}

/**
 * 文件选择项
 */
@Composable
private fun FilePickerItem(
    file: ExternalFileEntity,
    isSelected: Boolean,
    onSelectionChange: (Boolean) -> Unit
) {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onSelectionChange(!isSelected) },
        shape = RoundedCornerShape(8.dp),
        color = if (isSelected) {
            MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.3f)
        } else {
            MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
        },
        tonalElevation = if (isSelected) 2.dp else 0.dp
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Checkbox
            Checkbox(
                checked = isSelected,
                onCheckedChange = onSelectionChange
            )

            // File icon
            Surface(
                modifier = Modifier.size(48.dp),
                shape = RoundedCornerShape(8.dp),
                color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.3f)
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        imageVector = when (file.category) {
                            FileCategory.IMAGE -> Icons.Default.Image
                            FileCategory.VIDEO -> Icons.Default.VideoLibrary
                            FileCategory.AUDIO -> Icons.Default.AudioFile
                            FileCategory.DOCUMENT -> Icons.Default.Description
                            FileCategory.CODE -> Icons.Default.Code
                            FileCategory.ARCHIVE -> Icons.Default.FolderZip
                            FileCategory.OTHER -> Icons.Default.InsertDriveFile
                        },
                        contentDescription = file.category.name,
                        modifier = Modifier.size(28.dp),
                        tint = MaterialTheme.colorScheme.primary
                    )
                }
            }

            // File info
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                Text(
                    text = file.displayName,
                    style = MaterialTheme.typography.bodyMedium.copy(
                        fontWeight = FontWeight.Medium
                    ),
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )

                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = file.getReadableSize(),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )

                    Text(
                        text = "•",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
                    )

                    Text(
                        text = file.getCategoryDisplayName(),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        }
    }
}

/**
 * 附件数据类 - 传递给AI聊天
 */
data class AttachedFileData(
    val id: String,
    val name: String,
    val size: Long,
    val mimeType: String,
    val category: String,
    val path: String? = null
)

/**
 * 转换扩展函数
 */
private fun ExternalFileEntity.toAttachedFileData(): AttachedFileData {
    return AttachedFileData(
        id = id,
        name = displayName,
        size = size,
        mimeType = mimeType,
        category = category.name,
        path = uri
    )
}

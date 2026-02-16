package com.chainlesschain.android.feature.project.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AudioFile
import androidx.compose.material.icons.filled.Code
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.FolderZip
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.InsertDriveFile
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.TextSnippet
import androidx.compose.material.icons.filled.VideoFile
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.chainlesschain.android.feature.project.R
import com.chainlesschain.android.core.database.entity.ExternalFileEntity
import com.chainlesschain.android.core.database.entity.FileCategory
import com.chainlesschain.android.core.database.entity.ProjectFileEntity

/**
 * 增强版文件引用弹出菜单
 *
 * 双Tab模式：
 * - Tab 1: 项目文件 - 显示当前项目内的文件
 * - Tab 2: 手机文件 - 显示手机上的外部文件
 *
 * 当用户在聊天输入中输入@时弹出，允许选择文件加入上下文
 */
@Composable
fun EnhancedFileMentionPopup(
    isVisible: Boolean,
    // Tab 1: 项目文件
    projectFiles: List<ProjectFileEntity>,
    projectSearchQuery: String,
    onProjectSearchQueryChange: (String) -> Unit,
    onProjectFileSelected: (ProjectFileEntity) -> Unit,
    // Tab 2: 外部文件
    externalFiles: List<ExternalFileEntity>,
    externalSearchQuery: String,
    onExternalSearchQueryChange: (String) -> Unit,
    onExternalFileSelected: (ExternalFileEntity) -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier
) {
    var selectedTab by remember { mutableStateOf(0) }
    val focusRequester = remember { FocusRequester() }

    // 过滤项目文件
    val filteredProjectFiles = remember(projectFiles, projectSearchQuery) {
        if (projectSearchQuery.isBlank()) {
            projectFiles.filter { it.type == "file" }
        } else {
            projectFiles.filter {
                it.type == "file" &&
                        (it.name.contains(projectSearchQuery, ignoreCase = true) ||
                                it.path.contains(projectSearchQuery, ignoreCase = true))
            }
        }
    }

    // 过滤外部文件
    val filteredExternalFiles = remember(externalFiles, externalSearchQuery) {
        if (externalSearchQuery.isBlank()) {
            externalFiles
        } else {
            externalFiles.filter {
                it.displayName.contains(externalSearchQuery, ignoreCase = true) ||
                        (it.displayPath?.contains(externalSearchQuery, ignoreCase = true) == true)
            }
        }
    }

    AnimatedVisibility(
        visible = isVisible,
        enter = slideInVertically(initialOffsetY = { it / 2 }) + fadeIn(),
        exit = slideOutVertically(targetOffsetY = { it / 2 }) + fadeOut()
    ) {
        Card(
            modifier = modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
            elevation = CardDefaults.cardElevation(defaultElevation = 8.dp),
            colors = CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.surface
            )
        ) {
            Column {
                // Tab Row
                TabRow(
                    selectedTabIndex = selectedTab,
                    containerColor = MaterialTheme.colorScheme.surface,
                    contentColor = MaterialTheme.colorScheme.primary
                ) {
                    Tab(
                        selected = selectedTab == 0,
                        onClick = { selectedTab = 0 },
                        text = {
                            Row(
                                horizontalArrangement = Arrangement.spacedBy(4.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Folder,
                                    contentDescription = null,
                                    modifier = Modifier.size(16.dp)
                                )
                                Text(stringResource(R.string.project_files))
                            }
                        }
                    )
                    Tab(
                        selected = selectedTab == 1,
                        onClick = { selectedTab = 1 },
                        text = {
                            Row(
                                horizontalArrangement = Arrangement.spacedBy(4.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Phone,
                                    contentDescription = null,
                                    modifier = Modifier.size(16.dp)
                                )
                                Text(stringResource(R.string.phone_files))
                            }
                        }
                    )
                }

                // 搜索框
                OutlinedTextField(
                    value = if (selectedTab == 0) projectSearchQuery else externalSearchQuery,
                    onValueChange = {
                        if (selectedTab == 0) {
                            onProjectSearchQueryChange(it)
                        } else {
                            onExternalSearchQueryChange(it)
                        }
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(12.dp)
                        .focusRequester(focusRequester),
                    placeholder = {
                        Text(stringResource(if (selectedTab == 0) R.string.search_project_files else R.string.search_phone_files))
                    },
                    leadingIcon = {
                        Icon(
                            imageVector = Icons.Default.Search,
                            contentDescription = null,
                            modifier = Modifier.size(20.dp)
                        )
                    },
                    singleLine = true,
                    shape = RoundedCornerShape(8.dp),
                    colors = OutlinedTextFieldDefaults.colors(
                        unfocusedBorderColor = MaterialTheme.colorScheme.outline.copy(alpha = 0.3f)
                    )
                )

                HorizontalDivider()

                // 文件列表
                when (selectedTab) {
                    0 -> ProjectFileList(
                        files = filteredProjectFiles,
                        searchQuery = projectSearchQuery,
                        onFileSelected = {
                            onProjectFileSelected(it)
                            onDismiss()
                        }
                    )
                    1 -> ExternalFileList(
                        files = filteredExternalFiles,
                        searchQuery = externalSearchQuery,
                        onFileSelected = {
                            onExternalFileSelected(it)
                            onDismiss()
                        }
                    )
                }

                // 提示
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
                ) {
                    Text(
                        text = when (selectedTab) {
                            0 -> stringResource(R.string.project_file_context_hint)
                            1 -> stringResource(R.string.phone_file_context_hint)
                            else -> ""
                        },
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp)
                    )
                }
            }
        }

        LaunchedEffect(isVisible) {
            if (isVisible) {
                try {
                    focusRequester.requestFocus()
                } catch (_: Exception) {
                    // Ignore focus request failures
                }
            }
        }
    }
}

/**
 * 项目文件列表
 */
@Composable
private fun ProjectFileList(
    files: List<ProjectFileEntity>,
    searchQuery: String,
    onFileSelected: (ProjectFileEntity) -> Unit
) {
    LazyColumn(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(max = 300.dp)
    ) {
        if (files.isEmpty()) {
            item {
                EmptyState(
                    message = if (searchQuery.isBlank()) stringResource(R.string.no_files) else stringResource(R.string.no_matching_files)
                )
            }
        } else {
            items(
                items = files,
                key = { it.id }
            ) { file ->
                ProjectFileMentionItem(
                    file = file,
                    searchQuery = searchQuery,
                    onClick = { onFileSelected(file) }
                )
            }
        }
    }
}

/**
 * 外部文件列表
 */
@Composable
private fun ExternalFileList(
    files: List<ExternalFileEntity>,
    searchQuery: String,
    onFileSelected: (ExternalFileEntity) -> Unit
) {
    LazyColumn(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(max = 300.dp)
    ) {
        if (files.isEmpty()) {
            item {
                EmptyState(
                    message = if (searchQuery.isBlank()) {
                        stringResource(R.string.no_phone_files)
                    } else {
                        stringResource(R.string.no_matching_files)
                    }
                )
            }
        } else {
            items(
                items = files,
                key = { it.id }
            ) { file ->
                ExternalFileMentionItem(
                    file = file,
                    searchQuery = searchQuery,
                    onClick = { onFileSelected(file) }
                )
            }
        }
    }
}

/**
 * 空状态视图
 */
@Composable
private fun EmptyState(message: String) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .padding(24.dp),
        contentAlignment = Alignment.Center
    ) {
        Text(
            text = message,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
        )
    }
}

/**
 * 项目文件条目
 */
@Composable
private fun ProjectFileMentionItem(
    file: ProjectFileEntity,
    searchQuery: String,
    onClick: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        // 文件图标
        Icon(
            imageVector = getProjectFileIcon(file.extension),
            contentDescription = null,
            tint = getProjectFileIconColor(file.extension),
            modifier = Modifier.size(24.dp)
        )

        // 文件信息
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(2.dp)
        ) {
            // 文件名（高亮搜索词）
            HighlightedText(
                text = file.name,
                highlight = searchQuery,
                style = MaterialTheme.typography.bodyMedium,
                highlightColor = MaterialTheme.colorScheme.primary
            )

            // 文件路径
            Text(
                text = file.path,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }

        // 文件大小
        file.size.takeIf { it > 0 }?.let { size ->
            Text(
                text = formatFileSize(size),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f)
            )
        }
    }
}

/**
 * 外部文件条目
 */
@Composable
private fun ExternalFileMentionItem(
    file: ExternalFileEntity,
    searchQuery: String,
    onClick: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        // 文件图标
        Icon(
            imageVector = getExternalFileIcon(file.category),
            contentDescription = null,
            tint = getExternalFileIconColor(file.category),
            modifier = Modifier.size(24.dp)
        )

        // 文件信息
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(2.dp)
        ) {
            // 文件名（高亮搜索词）
            HighlightedText(
                text = file.displayName,
                highlight = searchQuery,
                style = MaterialTheme.typography.bodyMedium,
                highlightColor = MaterialTheme.colorScheme.primary
            )

            // 文件路径
            file.displayPath?.let { path ->
                Text(
                    text = path,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }

        // 文件大小
        Text(
            text = formatFileSize(file.size),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f)
        )
    }
}

/**
 * 高亮显示搜索词的文本
 */
@Composable
private fun HighlightedText(
    text: String,
    highlight: String,
    style: androidx.compose.ui.text.TextStyle,
    highlightColor: Color
) {
    if (highlight.isBlank()) {
        Text(
            text = text,
            style = style,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
    } else {
        val startIndex = text.indexOf(highlight, ignoreCase = true)
        if (startIndex < 0) {
            Text(
                text = text,
                style = style,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        } else {
            val annotatedString = androidx.compose.ui.text.buildAnnotatedString {
                append(text.substring(0, startIndex))
                pushStyle(
                    androidx.compose.ui.text.SpanStyle(
                        color = highlightColor,
                        fontWeight = FontWeight.Bold
                    )
                )
                append(text.substring(startIndex, startIndex + highlight.length))
                pop()
                append(text.substring(startIndex + highlight.length))
            }
            Text(
                text = annotatedString,
                style = style,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}

/**
 * 获取项目文件图标
 */
private fun getProjectFileIcon(extension: String?): ImageVector {
    return when (extension?.lowercase()) {
        "kt", "java", "py", "js", "ts", "tsx", "jsx", "c", "cpp", "h", "swift", "go", "rs" -> Icons.Default.Code
        "md", "txt", "json", "xml", "yaml", "yml", "toml" -> Icons.Default.TextSnippet
        "png", "jpg", "jpeg", "gif", "webp", "svg", "ico" -> Icons.Default.Image
        "pdf", "doc", "docx" -> Icons.Default.Description
        else -> Icons.Default.InsertDriveFile
    }
}

/**
 * 获取项目文件图标颜色
 */
@Composable
private fun getProjectFileIconColor(extension: String?): Color {
    return when (extension?.lowercase()) {
        "kt" -> Color(0xFFA97BFF) // Kotlin purple
        "java" -> Color(0xFFE76F00) // Java orange
        "py" -> Color(0xFF3776AB) // Python blue
        "js", "ts", "tsx", "jsx" -> Color(0xFFF7DF1E) // JavaScript yellow
        "swift" -> Color(0xFFFA7343) // Swift orange
        "go" -> Color(0xFF00ADD8) // Go cyan
        "rs" -> Color(0xFFDEA584) // Rust
        "md" -> Color(0xFF519ABA) // Markdown blue
        "json" -> Color(0xFFC0C0C0) // JSON gray
        "xml" -> Color(0xFFE44D26) // XML orange
        "png", "jpg", "jpeg", "gif" -> Color(0xFF4CAF50) // Image green
        else -> MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f)
    }
}

/**
 * 获取外部文件图标（根据分类）
 */
private fun getExternalFileIcon(category: FileCategory): ImageVector {
    return when (category) {
        FileCategory.DOCUMENT -> Icons.Default.Description
        FileCategory.IMAGE -> Icons.Default.Image
        FileCategory.VIDEO -> Icons.Default.VideoFile
        FileCategory.AUDIO -> Icons.Default.AudioFile
        FileCategory.ARCHIVE -> Icons.Default.FolderZip
        FileCategory.CODE -> Icons.Default.Code
        FileCategory.OTHER -> Icons.Default.InsertDriveFile
    }
}

/**
 * 获取外部文件图标颜色
 */
@Composable
private fun getExternalFileIconColor(category: FileCategory): Color {
    return when (category) {
        FileCategory.DOCUMENT -> Color(0xFF1976D2) // Blue
        FileCategory.IMAGE -> Color(0xFF00897B) // Cyan
        FileCategory.VIDEO -> Color(0xFFE53935) // Red
        FileCategory.AUDIO -> Color(0xFF8E24AA) // Purple
        FileCategory.ARCHIVE -> Color(0xFF757575) // Gray
        FileCategory.CODE -> Color(0xFF1976D2) // Blue
        FileCategory.OTHER -> MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f)
    }
}

/**
 * 格式化文件大小
 */
private fun formatFileSize(bytes: Long): String {
    return when {
        bytes < 1024 -> "${bytes}B"
        bytes < 1024 * 1024 -> "${bytes / 1024}KB"
        bytes < 1024 * 1024 * 1024 -> String.format("%.1fMB", bytes / (1024.0 * 1024))
        else -> String.format("%.1fGB", bytes / (1024.0 * 1024 * 1024))
    }
}

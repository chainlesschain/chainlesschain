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
import androidx.compose.material.icons.filled.Code
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.InsertDriveFile
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.TextSnippet
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
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
import com.chainlesschain.android.core.database.entity.ProjectFileEntity

/**
 * 文件引用弹出菜单
 * 当用户在聊天输入中输入@时弹出，允许选择文件加入上下文
 */
@Composable
fun FileMentionPopup(
    isVisible: Boolean,
    files: List<ProjectFileEntity>,
    searchQuery: String,
    onSearchQueryChange: (String) -> Unit,
    onFileSelected: (ProjectFileEntity) -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier
) {
    val focusRequester = remember { FocusRequester() }

    // 过滤文件列表
    val filteredFiles = remember(files, searchQuery) {
        if (searchQuery.isBlank()) {
            files.filter { it.type == "file" }
        } else {
            files.filter {
                it.type == "file" &&
                        (it.name.contains(searchQuery, ignoreCase = true) ||
                                it.path.contains(searchQuery, ignoreCase = true))
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
                // 搜索框
                OutlinedTextField(
                    value = searchQuery,
                    onValueChange = onSearchQueryChange,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(12.dp)
                        .focusRequester(focusRequester),
                    placeholder = { Text(stringResource(R.string.search_files)) },
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
                LazyColumn(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(max = 300.dp)
                ) {
                    if (filteredFiles.isEmpty()) {
                        item {
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(24.dp),
                                contentAlignment = Alignment.Center
                            ) {
                                Text(
                                    text = stringResource(if (searchQuery.isBlank()) R.string.no_files else R.string.no_matching_files),
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
                                )
                            }
                        }
                    } else {
                        items(
                            items = filteredFiles,
                            key = { it.id }
                        ) { file ->
                            FileMentionItem(
                                file = file,
                                searchQuery = searchQuery,
                                onClick = {
                                    onFileSelected(file)
                                    onDismiss()
                                }
                            )
                        }
                    }
                }

                // 提示
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
                ) {
                    Text(
                        text = stringResource(R.string.file_context_hint),
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

@Composable
private fun FileMentionItem(
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
            imageVector = getFileIcon(file.extension),
            contentDescription = null,
            tint = getFileIconColor(file.extension),
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
 * 获取文件图标
 */
private fun getFileIcon(extension: String?): ImageVector {
    return when (extension?.lowercase()) {
        "kt", "java", "py", "js", "ts", "tsx", "jsx", "c", "cpp", "h", "swift", "go", "rs" -> Icons.Default.Code
        "md", "txt", "json", "xml", "yaml", "yml", "toml" -> Icons.Default.TextSnippet
        "png", "jpg", "jpeg", "gif", "webp", "svg", "ico" -> Icons.Default.Image
        "pdf", "doc", "docx" -> Icons.Default.Description
        else -> Icons.Default.InsertDriveFile
    }
}

/**
 * 获取文件图标颜色
 */
@Composable
private fun getFileIconColor(extension: String?): Color {
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

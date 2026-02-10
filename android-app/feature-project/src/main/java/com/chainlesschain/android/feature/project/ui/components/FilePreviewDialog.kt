package com.chainlesschain.android.feature.project.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.BrokenImage
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Code
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.ZoomIn
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import coil.compose.AsyncImagePainter
import coil.request.ImageRequest
import com.chainlesschain.android.core.database.entity.ProjectFileEntity
import com.chainlesschain.android.core.ui.components.MarkdownText
import com.chainlesschain.android.core.ui.image.ImagePreviewDialog
import java.io.File

/**
 * 文件预览对话框
 *
 * 支持多种文件类型的预览：
 * - Markdown: 渲染预览
 * - 代码文件: 语法高亮
 * - 文本文件: 纯文本显示
 * - 图片: 图片显示（支持 jpg, jpeg, png, gif, webp, bmp, svg）
 * - 其他: 显示文件信息
 *
 * @param file 文件实体
 * @param projectId 项目ID（用于构建图片完整路径）
 * @param projectRootPath 项目根目录路径（可选，用于图片预览）
 * @param onDismiss 关闭回调
 * @param onEdit 编辑回调
 */
@Composable
fun FilePreviewDialog(
    file: ProjectFileEntity,
    projectId: String? = null,
    projectRootPath: String? = null,
    onDismiss: () -> Unit,
    onEdit: (() -> Unit)? = null,
    modifier: Modifier = Modifier
) {
    // 全屏图片预览状态
    var showFullscreenImage by remember { mutableStateOf(false) }
    val imagePath = remember(file, projectRootPath) {
        if (projectRootPath != null && isImageFile(file.extension)) {
            File(projectRootPath, file.path).absolutePath
        } else {
            null
        }
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        modifier = modifier,
        title = {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.weight(1f)
                ) {
                    FileTypeIcon(file = file)
                    Column {
                        Text(
                            text = file.name,
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            text = file.path,
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
                IconButton(onClick = onDismiss) {
                    Icon(
                        imageVector = Icons.Default.Close,
                        contentDescription = "关闭",
                        modifier = Modifier.size(20.dp)
                    )
                }
            }
        },
        text = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
            ) {
                // File metadata
                FileMetadataCard(file = file)

                Spacer(modifier = Modifier.height(16.dp))

                // Content preview
                when {
                    isImageFile(file.extension) && imagePath != null -> ImagePreview(
                        imagePath = imagePath,
                        fileName = file.name,
                        onFullscreen = { showFullscreenImage = true }
                    )
                    file.extension == "md" -> MarkdownPreview(content = file.content ?: "")
                    isCodeFile(file.extension) -> CodePreview(
                        content = file.content ?: "",
                        extension = file.extension ?: "txt"
                    )
                    file.extension in listOf("txt", "json", "xml", "yaml", "yml") -> TextPreview(
                        content = file.content ?: ""
                    )
                    isImageFile(file.extension) && imagePath == null -> ImagePathMissingMessage()
                    file.content.isNullOrEmpty() -> EmptyContentMessage()
                    else -> UnsupportedPreviewMessage(extension = file.extension ?: "unknown")
                }
            }
        },
        confirmButton = {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TextButton(onClick = onDismiss) {
                    Text("关闭")
                }
                if (onEdit != null) {
                    TextButton(onClick = {
                        onEdit()
                        onDismiss()
                    }) {
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(4.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(
                                imageVector = Icons.Default.Edit,
                                contentDescription = null,
                                modifier = Modifier.size(16.dp)
                            )
                            Text("编辑")
                        }
                    }
                }
            }
        }
    )

    // 全屏图片预览
    if (showFullscreenImage && imagePath != null) {
        ImagePreviewDialog(
            images = listOf(imagePath),
            initialIndex = 0,
            onDismiss = { showFullscreenImage = false }
        )
    }
}

/**
 * 文件元数据卡片
 */
@Composable
private fun FileMetadataCard(file: ProjectFileEntity) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f)
        )
    ) {
        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            MetadataRow(label = "大小", value = file.getReadableSize())
            MetadataRow(label = "类型", value = file.extension?.uppercase() ?: "UNKNOWN")
            MetadataRow(label = "修改时间", value = formatTimestamp(file.updatedAt))
            file.lastAccessedAt?.let { lastAccessed ->
                MetadataRow(label = "访问时间", value = formatTimestamp(lastAccessed))
            }
        }
    }
}

/**
 * 元数据行
 */
@Composable
private fun MetadataRow(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Text(
            text = value,
            style = MaterialTheme.typography.bodySmall,
            fontWeight = FontWeight.Medium
        )
    }
}

/**
 * Markdown 预览
 */
@Composable
private fun MarkdownPreview(content: String) {
    Column {
        Text(
            text = "Markdown 预览",
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.primary
        )
        Spacer(modifier = Modifier.height(8.dp))
        Surface(
            modifier = Modifier.fillMaxWidth(),
            color = MaterialTheme.colorScheme.surface,
            shape = RoundedCornerShape(8.dp)
        ) {
            MarkdownText(
                markdown = content,
                textColor = MaterialTheme.colorScheme.onSurface,
                linkColor = MaterialTheme.colorScheme.primary,
                modifier = Modifier.padding(16.dp)
            )
        }
    }
}

/**
 * 代码预览
 */
@Composable
private fun CodePreview(content: String, extension: String) {
    Column {
        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = Icons.Default.Code,
                contentDescription = null,
                modifier = Modifier.size(16.dp),
                tint = MaterialTheme.colorScheme.primary
            )
            Text(
                text = "${extension.uppercase()} 代码",
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.primary
            )
        }
        Spacer(modifier = Modifier.height(8.dp))
        Surface(
            modifier = Modifier.fillMaxWidth(),
            color = Color(0xFF1E1E1E),  // VS Code dark theme
            shape = RoundedCornerShape(8.dp)
        ) {
            Box(
                modifier = Modifier
                    .horizontalScroll(rememberScrollState())
                    .padding(16.dp)
            ) {
                Text(
                    text = content,
                    fontFamily = FontFamily.Monospace,
                    style = MaterialTheme.typography.bodySmall,
                    color = Color(0xFFD4D4D4)
                )
            }
        }
    }
}

/**
 * 文本预览
 */
@Composable
private fun TextPreview(content: String) {
    Column {
        Text(
            text = "文本内容",
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.primary
        )
        Spacer(modifier = Modifier.height(8.dp))
        Surface(
            modifier = Modifier.fillMaxWidth(),
            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
            shape = RoundedCornerShape(8.dp)
        ) {
            Text(
                text = content,
                fontFamily = FontFamily.Monospace,
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(16.dp)
            )
        }
    }
}

/**
 * 空内容消息
 */
@Composable
private fun EmptyContentMessage() {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .padding(32.dp),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Icon(
                imageVector = Icons.Default.Description,
                contentDescription = null,
                modifier = Modifier.size(48.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
            )
            Text(
                text = "文件内容为空",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

/**
 * 不支持预览消息
 */
@Composable
private fun UnsupportedPreviewMessage(extension: String) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .padding(32.dp),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Icon(
                imageVector = Icons.Default.Description,
                contentDescription = null,
                modifier = Modifier.size(48.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
            )
            Text(
                text = "不支持 .$extension 文件预览",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Text(
                text = "点击\"编辑\"按钮在编辑器中打开",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f)
            )
        }
    }
}

/**
 * 文件类型图标
 */
@Composable
private fun FileTypeIcon(file: ProjectFileEntity) {
    val (icon, color) = when {
        file.extension == "md" -> Icons.Default.Description to Color(0xFF2196F3)
        isCodeFile(file.extension) -> Icons.Default.Code to Color(0xFF4CAF50)
        isImageFile(file.extension) -> Icons.Default.Image to Color(0xFFF44336)
        else -> Icons.Default.Description to MaterialTheme.colorScheme.onSurfaceVariant
    }

    Icon(
        imageVector = icon,
        contentDescription = null,
        modifier = Modifier.size(24.dp),
        tint = color
    )
}

/**
 * 判断是否为代码文件
 */
private fun isCodeFile(extension: String?): Boolean {
    return extension in listOf(
        "kt", "java", "js", "ts", "tsx", "jsx",
        "py", "swift", "c", "cpp", "h", "hpp",
        "go", "rs", "rb", "php", "html", "css",
        "scss", "sass", "less", "vue", "dart"
    )
}

/**
 * 判断是否为图片文件
 */
private fun isImageFile(extension: String?): Boolean {
    return extension?.lowercase() in listOf(
        "jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"
    )
}

/**
 * 图片预览
 */
@Composable
private fun ImagePreview(
    imagePath: String,
    fileName: String,
    onFullscreen: () -> Unit
) {
    val context = LocalContext.current
    var loadState by remember { mutableStateOf<AsyncImagePainter.State?>(null) }

    Column {
        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = Icons.Default.Image,
                contentDescription = null,
                modifier = Modifier.size(16.dp),
                tint = MaterialTheme.colorScheme.primary
            )
            Text(
                text = "图片预览",
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.primary
            )
        }

        Spacer(modifier = Modifier.height(8.dp))

        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f)
            )
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(8.dp),
                contentAlignment = Alignment.Center
            ) {
                AsyncImage(
                    model = ImageRequest.Builder(context)
                        .data(File(imagePath))
                        .crossfade(true)
                        .build(),
                    contentDescription = fileName,
                    modifier = Modifier
                        .fillMaxWidth()
                        .aspectRatio(16f / 9f)
                        .clip(RoundedCornerShape(8.dp)),
                    contentScale = ContentScale.Fit,
                    onState = { state -> loadState = state }
                )

                // 加载状态
                when (loadState) {
                    is AsyncImagePainter.State.Loading -> {
                        CircularProgressIndicator(
                            modifier = Modifier.size(32.dp),
                            strokeWidth = 2.dp
                        )
                    }
                    is AsyncImagePainter.State.Error -> {
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(4.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.BrokenImage,
                                contentDescription = null,
                                modifier = Modifier.size(48.dp),
                                tint = MaterialTheme.colorScheme.error
                            )
                            Text(
                                text = "图片加载失败",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.error
                            )
                        }
                    }
                    else -> {}
                }
            }

            // 全屏按钮
            if (loadState is AsyncImagePainter.State.Success) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 8.dp, vertical = 4.dp),
                    horizontalArrangement = Arrangement.End
                ) {
                    TextButton(onClick = onFullscreen) {
                        Icon(
                            imageVector = Icons.Default.ZoomIn,
                            contentDescription = null,
                            modifier = Modifier.size(16.dp)
                        )
                        Spacer(modifier = Modifier.size(4.dp))
                        Text("全屏查看")
                    }
                }
            }
        }
    }
}

/**
 * 图片路径缺失消息
 */
@Composable
private fun ImagePathMissingMessage() {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .padding(32.dp),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Icon(
                imageVector = Icons.Default.Image,
                contentDescription = null,
                modifier = Modifier.size(48.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
            )
            Text(
                text = "无法预览图片",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Text(
                text = "需要项目路径信息才能加载图片",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f)
            )
        }
    }
}

/**
 * 格式化时间戳
 */
private fun formatTimestamp(timestamp: Long): String {
    val now = System.currentTimeMillis()
    val diff = now - timestamp

    return when {
        diff < 60 * 1000 -> "刚刚"
        diff < 60 * 60 * 1000 -> "${diff / (60 * 1000)} 分钟前"
        diff < 24 * 60 * 60 * 1000 -> "${diff / (60 * 60 * 1000)} 小时前"
        diff < 7 * 24 * 60 * 60 * 1000 -> "${diff / (24 * 60 * 60 * 1000)} 天前"
        else -> {
            val date = java.util.Date(timestamp)
            val format = java.text.SimpleDateFormat("yyyy-MM-dd HH:mm", java.util.Locale.getDefault())
            format.format(date)
        }
    }
}

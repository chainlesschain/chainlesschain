package com.chainlesschain.android.feature.p2p.ui.components

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector

/**
 * 根据MIME类型获取对应的图标
 */
@Composable
fun FileTypeIcon(
    mimeType: String,
    modifier: Modifier = Modifier,
    tint: Color = MaterialTheme.colorScheme.onSurfaceVariant
) {
    val icon = getIconForMimeType(mimeType)
    Icon(
        imageVector = icon,
        contentDescription = "File type",
        modifier = modifier,
        tint = tint
    )
}

/**
 * 根据MIME类型返回对应的图标
 */
fun getIconForMimeType(mimeType: String): ImageVector {
    return when {
        mimeType.startsWith("image/") -> Icons.Default.Image
        mimeType.startsWith("video/") -> Icons.Default.VideoFile
        mimeType.startsWith("audio/") -> Icons.Default.AudioFile
        mimeType.startsWith("text/") -> Icons.Default.Description
        mimeType.contains("pdf") -> Icons.Default.PictureAsPdf
        mimeType.contains("zip") || mimeType.contains("archive") || mimeType.contains("compressed") -> Icons.Default.FolderZip
        mimeType.contains("word") || mimeType.contains("document") -> Icons.Default.Article
        mimeType.contains("excel") || mimeType.contains("spreadsheet") -> Icons.Default.TableChart
        mimeType.contains("powerpoint") || mimeType.contains("presentation") -> Icons.Default.Slideshow
        else -> Icons.Default.InsertDriveFile
    }
}

/**
 * 获取文件类型的颜色
 */
@Composable
fun getColorForMimeType(mimeType: String): Color {
    return when {
        mimeType.startsWith("image/") -> Color(0xFF4CAF50) // Green
        mimeType.startsWith("video/") -> Color(0xFFE91E63) // Pink
        mimeType.startsWith("audio/") -> Color(0xFF9C27B0) // Purple
        mimeType.contains("pdf") -> Color(0xFFF44336) // Red
        mimeType.contains("word") || mimeType.contains("document") -> Color(0xFF2196F3) // Blue
        mimeType.contains("excel") || mimeType.contains("spreadsheet") -> Color(0xFF4CAF50) // Green
        mimeType.contains("powerpoint") || mimeType.contains("presentation") -> Color(0xFFFF9800) // Orange
        mimeType.contains("zip") || mimeType.contains("archive") -> Color(0xFF795548) // Brown
        else -> MaterialTheme.colorScheme.primary
    }
}

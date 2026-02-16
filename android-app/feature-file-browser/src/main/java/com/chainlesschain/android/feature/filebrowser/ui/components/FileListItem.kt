package com.chainlesschain.android.feature.filebrowser.ui.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.chainlesschain.android.feature.filebrowser.R
import com.chainlesschain.android.core.database.entity.ExternalFileEntity
import com.chainlesschain.android.core.database.entity.FileCategory
import java.text.SimpleDateFormat
import java.util.*

/**
 * File List Item Component
 *
 * Displays a single file in the file browser list with:
 * - Category-based icon with color (or thumbnail for images)
 * - File name, size, and last modified date
 * - Import and favorite buttons
 *
 * @param file The file entity to display
 * @param onFileClick Callback when file is clicked (for preview)
 * @param onImportClick Callback when import button is clicked
 * @param onFavoriteClick Callback when favorite button is clicked
 * @param showImportButton Whether to show the import button
 * @param thumbnailCache Optional thumbnail cache for image thumbnails
 */
@Composable
fun FileListItem(
    file: ExternalFileEntity,
    onFileClick: () -> Unit,
    onImportClick: () -> Unit,
    onFavoriteClick: () -> Unit,
    showImportButton: Boolean = true,
    thumbnailCache: com.chainlesschain.android.feature.filebrowser.cache.ThumbnailCache? = null
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onFileClick)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        // File icon with category color (or thumbnail for images)
        FileTypeIcon(
            file = file,
            thumbnailCache = thumbnailCache,
            modifier = Modifier.size(48.dp)
        )

        // File info
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            // File name
            Text(
                text = file.displayName,
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )

            // File size and date
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = file.getReadableSize(),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )

                Text(
                    text = "•",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )

                Text(
                    text = formatDate(file.lastModified),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            // File path
            file.displayPath?.let { path ->
                Text(
                    text = path,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.outline,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }

        // Action buttons
        Row(
            horizontalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            // Favorite button
            IconButton(
                onClick = onFavoriteClick,
                modifier = Modifier.size(36.dp)
            ) {
                Icon(
                    imageVector = if (file.isFavorite) Icons.Default.Star else Icons.Default.StarBorder,
                    contentDescription = if (file.isFavorite) stringResource(R.string.file_unfavorite) else stringResource(R.string.file_favorite),
                    tint = if (file.isFavorite) {
                        MaterialTheme.colorScheme.primary
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    },
                    modifier = Modifier.size(20.dp)
                )
            }

            // Import button (conditional)
            if (showImportButton) {
                FilledTonalIconButton(
                    onClick = onImportClick,
                    modifier = Modifier.size(36.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.Add,
                        contentDescription = stringResource(R.string.file_import_to_project),
                        modifier = Modifier.size(20.dp)
                    )
                }
            }
        }
    }
}

/**
 * File Type Icon
 *
 * Displays a category-appropriate icon with color coding, or thumbnail for images
 */
@Composable
private fun FileTypeIcon(
    file: ExternalFileEntity,
    thumbnailCache: com.chainlesschain.android.feature.filebrowser.cache.ThumbnailCache?,
    modifier: Modifier = Modifier
) {
    // Show thumbnail for images if cache is available
    if (file.category == FileCategory.IMAGE && thumbnailCache != null) {
        ThumbnailImage(
            uri = file.uri,
            thumbnailCache = thumbnailCache,
            modifier = modifier,
            size = 48.dp,
            contentDescription = file.displayName
        )
    } else {
        // Show category icon for other files
        val (icon, color) = when (file.category) {
            FileCategory.DOCUMENT -> Icons.Default.Description to Color(0xFF1976D2) // Blue
            FileCategory.IMAGE -> Icons.Default.Image to Color(0xFF388E3C) // Green
            FileCategory.VIDEO -> Icons.Default.VideoLibrary to Color(0xFFD32F2F) // Red
            FileCategory.AUDIO -> Icons.Default.AudioFile to Color(0xFFF57C00) // Orange
            FileCategory.ARCHIVE -> Icons.Default.FolderZip to Color(0xFF7B1FA2) // Purple
            FileCategory.CODE -> Icons.Default.Code to Color(0xFF0288D1) // Cyan
            FileCategory.OTHER -> Icons.Default.InsertDriveFile to Color(0xFF616161) // Gray
        }

        Surface(
            modifier = modifier,
            shape = MaterialTheme.shapes.small,
            color = color.copy(alpha = 0.1f)
        ) {
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier.fillMaxSize()
            ) {
                Icon(
                    imageVector = icon,
                    contentDescription = file.category.name,
                    tint = color,
                    modifier = Modifier.size(24.dp)
                )
            }
        }
    }
}

/**
 * Format timestamp to readable date string
 */
@Composable
private fun formatDate(timestamp: Long): String {
    val now = System.currentTimeMillis()
    val diff = now - timestamp

    return when {
        diff < 60_000 -> stringResource(R.string.time_just_now) // Less than 1 minute
        diff < 3600_000 -> stringResource(R.string.time_minutes_ago, (diff / 60_000).toInt()) // Less than 1 hour
        diff < 86400_000 -> stringResource(R.string.time_hours_ago, (diff / 3600_000).toInt()) // Less than 1 day
        diff < 604800_000 -> stringResource(R.string.time_days_ago, (diff / 86400_000).toInt()) // Less than 1 week
        else -> {
            // Format as date
            val sdf = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())
            sdf.format(Date(timestamp))
        }
    }
}

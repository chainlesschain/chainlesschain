package com.chainlesschain.android.feature.filebrowser.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.chainlesschain.android.core.database.entity.FileCategory
import com.chainlesschain.android.feature.filebrowser.viewmodel.GlobalFileBrowserViewModel.CategoryStats
import com.chainlesschain.android.feature.filebrowser.viewmodel.GlobalFileBrowserViewModel.FileBrowserStatistics

/**
 * File Statistics Card
 *
 * Collapsible card showing file browser statistics:
 * - Total files count and total size
 * - Storage distribution bar by category
 * - Per-category breakdown rows
 * - Favorite and imported counts
 */
@Composable
fun FileStatisticsCard(
    statistics: FileBrowserStatistics,
    isExpanded: Boolean,
    onToggleExpanded: () -> Unit,
    modifier: Modifier = Modifier
) {
    Card(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant
        ),
        onClick = onToggleExpanded
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            // Header row
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        imageVector = Icons.Default.Analytics,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(20.dp)
                    )
                    Text(
                        text = "\u6587\u4EF6\u7EDF\u8BA1",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.SemiBold
                    )
                }

                Row(
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "${statistics.totalFiles} \u4E2A\u6587\u4EF6\uFF0C${formatSize(statistics.totalSize)}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Icon(
                        imageVector = if (isExpanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
                        contentDescription = if (isExpanded) "\u6536\u8D77" else "\u5C55\u5F00",
                        modifier = Modifier.size(20.dp)
                    )
                }
            }

            // Expandable section
            AnimatedVisibility(
                visible = isExpanded,
                enter = expandVertically(),
                exit = shrinkVertically()
            ) {
                Column(
                    modifier = Modifier.padding(top = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    // Storage distribution bar
                    StorageDistributionBar(
                        categories = statistics.categories,
                        totalSize = statistics.totalSize
                    )

                    // Category breakdown rows
                    statistics.categories
                        .filter { it.count > 0 }
                        .forEach { catStats ->
                            CategoryStatRow(categoryStats = catStats)
                        }

                    // Divider
                    HorizontalDivider(
                        color = MaterialTheme.colorScheme.outlineVariant,
                        modifier = Modifier.padding(vertical = 4.dp)
                    )

                    // Favorites and imports row
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceEvenly
                    ) {
                        StatChip(
                            icon = Icons.Default.Star,
                            label = "${statistics.favoriteCount} \u4E2A\u6536\u85CF",
                            color = Color(0xFFFFA000)
                        )
                        StatChip(
                            icon = Icons.Default.CloudDownload,
                            label = "${statistics.importedCount} \u4E2A\u5DF2\u5BFC\u5165",
                            color = MaterialTheme.colorScheme.primary
                        )
                    }
                }
            }
        }
    }
}

/**
 * Horizontal bar showing proportional storage usage by category
 */
@Composable
private fun StorageDistributionBar(
    categories: List<CategoryStats>,
    totalSize: Long,
    modifier: Modifier = Modifier
) {
    if (totalSize <= 0) return

    val nonEmpty = categories.filter { it.totalSize > 0 }
    if (nonEmpty.isEmpty()) return

    Row(
        modifier = modifier
            .fillMaxWidth()
            .height(12.dp)
            .clip(RoundedCornerShape(6.dp))
    ) {
        nonEmpty.forEach { catStats ->
            val fraction = (catStats.totalSize.toFloat() / totalSize).coerceIn(0.02f, 1f)
            Box(
                modifier = Modifier
                    .weight(fraction)
                    .fillMaxHeight()
                    .background(getCategoryColor(catStats.category))
            )
        }
    }
}

/**
 * Single category stat row
 */
@Composable
private fun CategoryStatRow(
    categoryStats: CategoryStats,
    modifier: Modifier = Modifier
) {
    val (icon, color) = getCategoryIconAndColor(categoryStats.category)
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Surface(
                modifier = Modifier.size(28.dp),
                shape = RoundedCornerShape(6.dp),
                color = color.copy(alpha = 0.1f)
            ) {
                Box(contentAlignment = Alignment.Center, modifier = Modifier.fillMaxSize()) {
                    Icon(
                        imageVector = icon,
                        contentDescription = null,
                        tint = color,
                        modifier = Modifier.size(16.dp)
                    )
                }
            }
            Text(
                text = getCategoryDisplayName(categoryStats.category),
                style = MaterialTheme.typography.bodyMedium
            )
        }

        Row(
            horizontalArrangement = Arrangement.spacedBy(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = "${categoryStats.count} \u4E2A",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Text(
                text = formatSize(categoryStats.totalSize),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontWeight = FontWeight.Medium
            )
        }
    }
}

/**
 * Small stat chip for favorites/imports
 */
@Composable
private fun StatChip(
    icon: ImageVector,
    label: String,
    color: Color,
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = color,
            modifier = Modifier.size(16.dp)
        )
        Text(
            text = label,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

/**
 * Format byte size to human-readable string
 */
internal fun formatSize(bytes: Long): String {
    val units = arrayOf("B", "KB", "MB", "GB", "TB")
    var size = bytes.toDouble()
    var unitIndex = 0

    while (size >= 1024 && unitIndex < units.size - 1) {
        size /= 1024
        unitIndex++
    }

    return String.format("%.1f %s", size, units[unitIndex])
}

/**
 * Get color for a category name
 */
private fun getCategoryColor(categoryName: String): Color {
    return when (categoryName) {
        FileCategory.DOCUMENT.name -> Color(0xFF1976D2)
        FileCategory.IMAGE.name -> Color(0xFF388E3C)
        FileCategory.VIDEO.name -> Color(0xFFD32F2F)
        FileCategory.AUDIO.name -> Color(0xFFF57C00)
        FileCategory.ARCHIVE.name -> Color(0xFF7B1FA2)
        FileCategory.CODE.name -> Color(0xFF0288D1)
        FileCategory.OTHER.name -> Color(0xFF616161)
        else -> Color(0xFF616161)
    }
}

/**
 * Get icon and color pair for a category name
 */
private fun getCategoryIconAndColor(categoryName: String): Pair<ImageVector, Color> {
    return when (categoryName) {
        FileCategory.DOCUMENT.name -> Icons.Default.Description to Color(0xFF1976D2)
        FileCategory.IMAGE.name -> Icons.Default.Image to Color(0xFF388E3C)
        FileCategory.VIDEO.name -> Icons.Default.VideoLibrary to Color(0xFFD32F2F)
        FileCategory.AUDIO.name -> Icons.Default.AudioFile to Color(0xFFF57C00)
        FileCategory.ARCHIVE.name -> Icons.Default.FolderZip to Color(0xFF7B1FA2)
        FileCategory.CODE.name -> Icons.Default.Code to Color(0xFF0288D1)
        FileCategory.OTHER.name -> Icons.Default.InsertDriveFile to Color(0xFF616161)
        else -> Icons.Default.InsertDriveFile to Color(0xFF616161)
    }
}

/**
 * Get display name for a category
 */
private fun getCategoryDisplayName(categoryName: String): String {
    return when (categoryName) {
        FileCategory.DOCUMENT.name -> "\u6587\u6863"
        FileCategory.IMAGE.name -> "\u56FE\u7247"
        FileCategory.VIDEO.name -> "\u89C6\u9891"
        FileCategory.AUDIO.name -> "\u97F3\u9891"
        FileCategory.ARCHIVE.name -> "\u538B\u7F29\u5305"
        FileCategory.CODE.name -> "\u4EE3\u7801"
        FileCategory.OTHER.name -> "\u5176\u4ED6"
        else -> categoryName
    }
}

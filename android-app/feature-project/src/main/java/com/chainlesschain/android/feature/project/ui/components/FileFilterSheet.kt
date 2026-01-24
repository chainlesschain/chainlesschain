package com.chainlesschain.android.feature.project.ui.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.FilterList
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/**
 * 文件过滤器底部表单
 *
 * 提供文件过滤和排序选项
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FileFilterSheet(
    currentSortBy: FileSortBy,
    currentSortDirection: SortDirection,
    selectedExtensions: Set<String>,
    onSortChange: (FileSortBy, SortDirection) -> Unit,
    onExtensionFilterChange: (Set<String>) -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier
) {
    val sheetState = rememberModalBottomSheetState()
    var tempSortBy by remember { mutableStateOf(currentSortBy) }
    var tempSortDirection by remember { mutableStateOf(currentSortDirection) }
    var tempExtensions by remember { mutableStateOf(selectedExtensions) }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        modifier = modifier
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            // Title
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
                        imageVector = Icons.Default.FilterList,
                        contentDescription = null,
                        modifier = Modifier.size(24.dp),
                        tint = MaterialTheme.colorScheme.primary
                    )
                    Text(
                        text = "文件过滤和排序",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold
                    )
                }
            }

            Spacer(modifier = Modifier.height(24.dp))

            // Sort by
            Text(
                text = "排序方式",
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.Medium
            )
            Spacer(modifier = Modifier.height(12.dp))
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(FileSortBy.values()) { sortBy ->
                    FilterChip(
                        selected = tempSortBy == sortBy,
                        onClick = { tempSortBy = sortBy },
                        label = { Text(sortBy.displayName) },
                        leadingIcon = if (tempSortBy == sortBy) {
                            {
                                Icon(
                                    imageVector = Icons.Default.Check,
                                    contentDescription = null,
                                    modifier = Modifier.size(18.dp)
                                )
                            }
                        } else null
                    )
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            // Sort direction
            Text(
                text = "排序方向",
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.Medium
            )
            Spacer(modifier = Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SortDirection.values().forEach { direction ->
                    FilterChip(
                        selected = tempSortDirection == direction,
                        onClick = { tempSortDirection = direction },
                        label = { Text(direction.displayName) },
                        leadingIcon = {
                            Icon(
                                imageVector = when (direction) {
                                    SortDirection.ASC -> Icons.Default.ArrowUpward
                                    SortDirection.DESC -> Icons.Default.ArrowDownward
                                },
                                contentDescription = null,
                                modifier = Modifier.size(18.dp)
                            )
                        }
                    )
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            // Extension filter
            Text(
                text = "文件类型过滤",
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.Medium
            )
            Spacer(modifier = Modifier.height(12.dp))
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(commonExtensions) { ext ->
                    FilterChip(
                        selected = ext in tempExtensions,
                        onClick = {
                            tempExtensions = if (ext in tempExtensions) {
                                tempExtensions - ext
                            } else {
                                tempExtensions + ext
                            }
                        },
                        label = { Text(ext.uppercase()) }
                    )
                }
            }

            Spacer(modifier = Modifier.height(24.dp))

            // Action buttons
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)
            ) {
                TextButton(onClick = {
                    tempSortBy = FileSortBy.NAME
                    tempSortDirection = SortDirection.ASC
                    tempExtensions = emptySet()
                }) {
                    Text("重置")
                }
                TextButton(onClick = {
                    onSortChange(tempSortBy, tempSortDirection)
                    onExtensionFilterChange(tempExtensions)
                    onDismiss()
                }) {
                    Text("应用", fontWeight = FontWeight.Bold)
                }
            }

            Spacer(modifier = Modifier.height(16.dp))
        }
    }
}

/**
 * 文件排序方式
 */
enum class FileSortBy(val displayName: String) {
    NAME("名称"),
    SIZE("大小"),
    MODIFIED("修改时间"),
    TYPE("类型"),
    PATH("路径")
}

/**
 * 排序方向
 */
enum class SortDirection(val displayName: String) {
    ASC("升序"),
    DESC("降序")
}

/**
 * 常见文件扩展名
 */
private val commonExtensions = listOf(
    "kt", "java", "js", "ts", "tsx",
    "py", "md", "txt", "json", "xml",
    "html", "css", "svg", "png", "jpg"
)

/**
 * 简化版过滤栏
 */
@Composable
fun FiltersBar(
    currentSortBy: FileSortBy,
    selectedExtensionsCount: Int,
    onShowFilters: () -> Unit,
    modifier: Modifier = Modifier
) {
    Surface(
        modifier = modifier
            .fillMaxWidth()
            .clickable(onClick = onShowFilters),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f),
        shape = RoundedCornerShape(8.dp)
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    imageVector = Icons.Default.FilterList,
                    contentDescription = null,
                    modifier = Modifier.size(18.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Text(
                    text = "排序: ${currentSortBy.displayName}",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                if (selectedExtensionsCount > 0) {
                    Surface(
                        color = MaterialTheme.colorScheme.primaryContainer,
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Text(
                            text = "$selectedExtensionsCount 个类型",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onPrimaryContainer,
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                        )
                    }
                }
            }
            Text(
                text = "调整",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.primary,
                fontWeight = FontWeight.Medium
            )
        }
    }
}

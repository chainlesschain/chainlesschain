package com.chainlesschain.android.feature.project.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.FolderOpen
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowRight
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.chainlesschain.android.core.database.entity.ProjectFileEntity
import kotlinx.coroutines.flow.distinctUntilChanged

/**
 * Virtual File Tree
 *
 * Optimized file tree component for large projects:
 * - LazyColumn with stable keys for efficient recomposition
 * - Preloading strategy for smooth scrolling
 * - Flattened tree structure for virtualization
 * - Expanded/collapsed state management
 * - File type icons and Git status indicators
 */
@Composable
fun VirtualFileTree(
    files: List<ProjectFileEntity>,
    selectedFileId: String?,
    onFileClick: (ProjectFileEntity) -> Unit,
    onFolderToggle: (ProjectFileEntity) -> Unit,
    modifier: Modifier = Modifier,
    listState: LazyListState = rememberLazyListState(),
    showGitStatus: Boolean = false,
    gitModifiedFiles: Set<String> = emptySet()
) {
    // Build flattened tree for virtualization
    val expandedFolders = remember { mutableStateListOf<String>() }

    val flattenedTree by remember(files, expandedFolders.toList()) {
        derivedStateOf {
            flattenFileTree(files, expandedFolders.toSet())
        }
    }

    // Preloading - track visible range
    var visibleRange by remember { mutableStateOf(0..10) }

    LaunchedEffect(listState) {
        snapshotFlow {
            val first = listState.firstVisibleItemIndex
            val last = first + listState.layoutInfo.visibleItemsInfo.size
            first..last
        }
            .distinctUntilChanged()
            .collect { range ->
                visibleRange = range
            }
    }

    if (flattenedTree.isEmpty()) {
        Box(
            modifier = modifier.fillMaxSize(),
            contentAlignment = Alignment.Center
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(
                    Icons.Default.Folder,
                    contentDescription = null,
                    modifier = Modifier.size(48.dp),
                    tint = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.3f)
                )
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = "空项目",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f)
                )
            }
        }
    } else {
        LazyColumn(
            modifier = modifier.fillMaxSize(),
            state = listState,
            contentPadding = PaddingValues(vertical = 4.dp)
        ) {
            items(
                items = flattenedTree,
                key = { it.file.id }  // Stable key for efficient recomposition
            ) { node ->
                FileTreeItem(
                    node = node,
                    isSelected = node.file.id == selectedFileId,
                    isExpanded = node.file.id in expandedFolders,
                    isGitModified = node.file.path in gitModifiedFiles,
                    showGitStatus = showGitStatus,
                    onClick = {
                        if (node.file.type == "folder") {
                            if (node.file.id in expandedFolders) {
                                expandedFolders.remove(node.file.id)
                            } else {
                                expandedFolders.add(node.file.id)
                            }
                            onFolderToggle(node.file)
                        } else {
                            onFileClick(node.file)
                        }
                    }
                )
            }
        }
    }
}

@Composable
private fun FileTreeItem(
    node: FlattenedNode,
    isSelected: Boolean,
    isExpanded: Boolean,
    isGitModified: Boolean,
    showGitStatus: Boolean,
    onClick: () -> Unit
) {
    val isFolder = node.file.type == "folder"

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(
                if (isSelected) MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.3f)
                else Color.Transparent
            )
            .clickable(onClick = onClick)
            .padding(
                start = (8 + node.depth * 16).dp,
                top = 6.dp,
                bottom = 6.dp,
                end = 8.dp
            ),
        verticalAlignment = Alignment.CenterVertically
    ) {
        // Expand/collapse indicator for folders
        if (isFolder) {
            Icon(
                imageVector = if (isExpanded) Icons.Default.KeyboardArrowDown
                else Icons.Default.KeyboardArrowRight,
                contentDescription = if (isExpanded) "Collapse" else "Expand",
                modifier = Modifier.size(18.dp),
                tint = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f)
            )
        } else {
            Spacer(modifier = Modifier.width(18.dp))
        }

        Spacer(modifier = Modifier.width(4.dp))

        // File/folder icon
        Icon(
            imageVector = getFileIcon(node.file, isExpanded),
            contentDescription = null,
            modifier = Modifier.size(18.dp),
            tint = getFileIconColor(node.file, isGitModified)
        )

        Spacer(modifier = Modifier.width(8.dp))

        // File name
        Text(
            text = node.file.name,
            style = MaterialTheme.typography.bodyMedium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            fontWeight = if (isSelected) FontWeight.Medium else FontWeight.Normal,
            color = if (isGitModified && showGitStatus)
                Color(0xFFFF9800)
            else
                MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.weight(1f)
        )

        // Git status indicator
        if (showGitStatus && isGitModified) {
            Box(
                modifier = Modifier
                    .size(6.dp)
                    .background(Color(0xFFFF9800), RoundedCornerShape(3.dp))
            )
        }

        // File size for files
        if (!isFolder && node.file.size > 0) {
            Text(
                text = formatFileSize(node.file.size),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.4f)
            )
        }
    }
}

private fun getFileIcon(file: ProjectFileEntity, isExpanded: Boolean): ImageVector {
    return if (file.type == "folder") {
        if (isExpanded) Icons.Default.FolderOpen else Icons.Default.Folder
    } else {
        Icons.Default.Description
    }
}

private fun getFileIconColor(file: ProjectFileEntity, isGitModified: Boolean): Color {
    if (isGitModified) return Color(0xFFFF9800)

    return when (file.extension?.lowercase()) {
        "kt", "kts" -> Color(0xFF7F52FF)     // Kotlin purple
        "java" -> Color(0xFFE76F00)          // Java orange
        "js", "jsx" -> Color(0xFFF7DF1E)     // JavaScript yellow
        "ts", "tsx" -> Color(0xFF3178C6)     // TypeScript blue
        "py" -> Color(0xFF3776AB)            // Python blue
        "json" -> Color(0xFF4CAF50)          // JSON green
        "xml" -> Color(0xFFFF5722)           // XML orange
        "md" -> Color(0xFF42A5F5)            // Markdown blue
        "yaml", "yml" -> Color(0xFFCC1018)   // YAML red
        "html" -> Color(0xFFE44D26)          // HTML orange
        "css", "scss" -> Color(0xFF264DE4)   // CSS blue
        "gradle" -> Color(0xFF02303A)        // Gradle dark
        else -> Color(0xFF9E9E9E)            // Default gray
    }
}

private fun formatFileSize(bytes: Long): String {
    return when {
        bytes < 1024 -> "$bytes B"
        bytes < 1024 * 1024 -> "${bytes / 1024} KB"
        bytes < 1024 * 1024 * 1024 -> "${bytes / (1024 * 1024)} MB"
        else -> "${bytes / (1024 * 1024 * 1024)} GB"
    }
}

/**
 * Flatten file tree for virtualization
 * Converts hierarchical structure to flat list with depth info
 */
private fun flattenFileTree(
    files: List<ProjectFileEntity>,
    expandedFolders: Set<String>
): List<FlattenedNode> {
    val result = mutableListOf<FlattenedNode>()

    // Build parent-child map
    val childrenMap = files.groupBy { it.parentId }

    // Recursive function to flatten
    fun flatten(parentId: String?, depth: Int) {
        val children = childrenMap[parentId] ?: return

        // Sort: folders first, then files, alphabetically
        val sorted = children.sortedWith(
            compareBy<ProjectFileEntity> { it.type != "folder" }
                .thenBy { it.name.lowercase() }
        )

        for (file in sorted) {
            result.add(FlattenedNode(file, depth))

            // Recursively add children if folder is expanded
            if (file.type == "folder" && file.id in expandedFolders) {
                flatten(file.id, depth + 1)
            }
        }
    }

    // Start from root (parentId = null)
    flatten(null, 0)

    return result
}

/**
 * Flattened node with depth information
 */
data class FlattenedNode(
    val file: ProjectFileEntity,
    val depth: Int
)

/**
 * File tree statistics
 */
@Composable
fun FileTreeStats(
    files: List<ProjectFileEntity>,
    modifier: Modifier = Modifier
) {
    val stats by remember(files) {
        derivedStateOf {
            val fileCount = files.count { it.type == "file" }
            val folderCount = files.count { it.type == "folder" }
            val totalSize = files.filter { it.type == "file" }.sumOf { it.size }
            Triple(fileCount, folderCount, totalSize)
        }
    }

    val (fileCount, folderCount, totalSize) = stats

    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 8.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(
            text = "$fileCount 个文件, $folderCount 个文件夹",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f)
        )
        Text(
            text = formatFileSize(totalSize),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f)
        )
    }
}

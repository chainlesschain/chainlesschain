package com.chainlesschain.android.feature.filebrowser.ui.components

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.chainlesschain.android.core.database.entity.ExternalFileEntity
import ProjectEntity

/**
 * File Import Dialog Component
 *
 * Provides a dialog for importing files to projects with:
 * - File information display
 * - Project selection via dropdown
 * - Import confirmation
 *
 * @param file The file to import
 * @param projectId Target project ID (if pre-selected)
 * @param availableProjects List of projects to choose from
 * @param onDismiss Callback when dialog is dismissed
 * @param onImport Callback when import is confirmed with selected project ID
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FileImportDialog(
    file: ExternalFileEntity,
    projectId: String?,
    availableProjects: List<ProjectEntity>,
    onDismiss: () -> Unit,
    onImport: (String) -> Unit // projectId
) {
    var selectedProjectId by remember { mutableStateOf(projectId ?: "") }
    var selectedProjectName by remember {
        mutableStateOf(
            availableProjects.find { it.id == projectId }?.name ?: ""
        )
    }
    var expanded by remember { mutableStateOf(false) }
    var searchQuery by remember { mutableStateOf("") }
    var showProjectSelector by remember { mutableStateOf(projectId == null) }

    // Filter projects based on search query
    val filteredProjects = remember(searchQuery, availableProjects) {
        if (searchQuery.isBlank()) {
            availableProjects
        } else {
            availableProjects.filter { project ->
                project.name.contains(searchQuery, ignoreCase = true) ||
                project.description?.contains(searchQuery, ignoreCase = true) == true ||
                project.getTypeDisplayName().contains(searchQuery, ignoreCase = true)
            }
        }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Text(
                text = "导入文件到项目",
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold
            )
        },
        text = {
            Column(
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                // File info card
                FileInfoCard(file = file)

                // Import mode info
                Surface(
                    color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.3f),
                    shape = MaterialTheme.shapes.small
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(12.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            imageVector = Icons.Default.Info,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.size(20.dp)
                        )
                        Text(
                            text = "文件将被复制到项目中，保持独立性",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurface
                        )
                    }
                }

                // Project selector (if needed)
                if (showProjectSelector) {
                    Text(
                        text = "选择目标项目",
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.Medium
                    )

                    // Project dropdown selector
                    ExposedDropdownMenuBox(
                        expanded = expanded,
                        onExpandedChange = { expanded = it }
                    ) {
                        OutlinedTextField(
                            value = selectedProjectName,
                            onValueChange = { query ->
                                searchQuery = query
                                selectedProjectName = query
                                expanded = true
                            },
                            modifier = Modifier
                                .fillMaxWidth()
                                .menuAnchor(),
                            label = { Text("项目") },
                            placeholder = { Text("搜索或选择项目...") },
                            trailingIcon = {
                                ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded)
                            },
                            colors = ExposedDropdownMenuDefaults.outlinedTextFieldColors(),
                            singleLine = true
                        )

                        ExposedDropdownMenu(
                            expanded = expanded && filteredProjects.isNotEmpty(),
                            onDismissRequest = { expanded = false }
                        ) {
                            if (filteredProjects.isEmpty()) {
                                DropdownMenuItem(
                                    text = {
                                        Text(
                                            text = "未找到项目",
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant
                                        )
                                    },
                                    onClick = { },
                                    enabled = false
                                )
                            } else {
                                filteredProjects.forEach { project ->
                                    DropdownMenuItem(
                                        text = {
                                            Column {
                                                Text(
                                                    text = project.name,
                                                    style = MaterialTheme.typography.bodyMedium,
                                                    fontWeight = FontWeight.Medium
                                                )
                                                Row(
                                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                                    verticalAlignment = Alignment.CenterVertically
                                                ) {
                                                    Text(
                                                        text = project.getTypeDisplayName(),
                                                        style = MaterialTheme.typography.bodySmall,
                                                        color = MaterialTheme.colorScheme.primary
                                                    )
                                                    project.description?.let { desc ->
                                                        Text(
                                                            text = "•",
                                                            style = MaterialTheme.typography.bodySmall,
                                                            color = MaterialTheme.colorScheme.onSurfaceVariant
                                                        )
                                                        Text(
                                                            text = desc.take(30) + if (desc.length > 30) "..." else "",
                                                            style = MaterialTheme.typography.bodySmall,
                                                            color = MaterialTheme.colorScheme.onSurfaceVariant
                                                        )
                                                    }
                                                }
                                            }
                                        },
                                        onClick = {
                                            selectedProjectId = project.id
                                            selectedProjectName = project.name
                                            searchQuery = ""
                                            expanded = false
                                        },
                                        leadingIcon = {
                                            Icon(
                                                imageVector = when (project.type) {
                                                    "document" -> Icons.Default.Description
                                                    "web" -> Icons.Default.Language
                                                    "app", "android" -> Icons.Default.Apps
                                                    "data", "data_science" -> Icons.Default.DataUsage
                                                    "design" -> Icons.Default.Palette
                                                    "research" -> Icons.Default.Science
                                                    else -> Icons.Default.Folder
                                                },
                                                contentDescription = project.getTypeDisplayName(),
                                                tint = MaterialTheme.colorScheme.primary
                                            )
                                        }
                                    )
                                }
                            }
                        }
                    }

                    // Show selected project info if available
                    if (selectedProjectId.isNotBlank()) {
                        val selectedProject = availableProjects.find { it.id == selectedProjectId }
                        selectedProject?.let { project ->
                            Surface(
                                modifier = Modifier.fillMaxWidth(),
                                color = MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.3f),
                                shape = MaterialTheme.shapes.small
                            ) {
                                Row(
                                    modifier = Modifier.padding(12.dp),
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Icon(
                                        imageVector = Icons.Default.CheckCircle,
                                        contentDescription = null,
                                        tint = MaterialTheme.colorScheme.primary,
                                        modifier = Modifier.size(20.dp)
                                    )
                                    Column {
                                        Text(
                                            text = "已选择: ${project.name}",
                                            style = MaterialTheme.typography.bodySmall,
                                            fontWeight = FontWeight.Medium
                                        )
                                        Text(
                                            text = "${project.fileCount} 个文件 • ${project.getReadableSize()}",
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    val targetProjectId = if (projectId != null) projectId else selectedProjectId
                    if (targetProjectId.isNotBlank()) {
                        onImport(targetProjectId)
                        onDismiss()
                    }
                },
                enabled = selectedProjectId.isNotBlank() || projectId != null
            ) {
                Text("导入")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("取消")
            }
        }
    )
}

/**
 * File Info Card
 *
 * Displays file metadata in a card format
 */
@Composable
private fun FileInfoCard(file: ExternalFileEntity) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
        shape = MaterialTheme.shapes.medium
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            // File name with icon
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    imageVector = when (file.category) {
                        com.chainlesschain.android.core.database.entity.FileCategory.DOCUMENT -> Icons.Default.Description
                        com.chainlesschain.android.core.database.entity.FileCategory.IMAGE -> Icons.Default.Image
                        com.chainlesschain.android.core.database.entity.FileCategory.VIDEO -> Icons.Default.VideoLibrary
                        com.chainlesschain.android.core.database.entity.FileCategory.AUDIO -> Icons.Default.AudioFile
                        com.chainlesschain.android.core.database.entity.FileCategory.ARCHIVE -> Icons.Default.FolderZip
                        com.chainlesschain.android.core.database.entity.FileCategory.CODE -> Icons.Default.Code
                        com.chainlesschain.android.core.database.entity.FileCategory.OTHER -> Icons.Default.InsertDriveFile
                    },
                    contentDescription = file.category.name,
                    tint = MaterialTheme.colorScheme.primary
                )

                Text(
                    text = file.displayName,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.Medium
                )
            }

            // File metadata
            InfoRow(label = "类型", value = file.getCategoryDisplayName())
            InfoRow(label = "大小", value = file.getReadableSize())
            file.displayPath?.let {
                InfoRow(label = "路径", value = it)
            }
        }
    }
}

/**
 * Info Row
 *
 * Displays a label-value pair
 */
@Composable
private fun InfoRow(label: String, value: String) {
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
            fontWeight = FontWeight.Medium,
            color = MaterialTheme.colorScheme.onSurface
        )
    }
}

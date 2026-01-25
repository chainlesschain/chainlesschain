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

/**
 * File Import Dialog Component
 *
 * Provides a dialog for importing files to projects with:
 * - File information display
 * - Project selection
 * - Import confirmation
 *
 * @param file The file to import
 * @param projectId Target project ID (if pre-selected)
 * @param onDismiss Callback when dialog is dismissed
 * @param onImport Callback when import is confirmed
 */
@Composable
fun FileImportDialog(
    file: ExternalFileEntity,
    projectId: String?,
    onDismiss: () -> Unit,
    onImport: (String) -> Unit // projectId
) {
    var selectedProjectId by remember { mutableStateOf(projectId ?: "") }
    var showProjectSelector by remember { mutableStateOf(projectId == null) }

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

                    // TODO: Implement project selector dropdown
                    // For now, show a text field for project ID input
                    OutlinedTextField(
                        value = selectedProjectId,
                        onValueChange = { selectedProjectId = it },
                        label = { Text("项目 ID") },
                        placeholder = { Text("输入项目 ID") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true
                    )
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

package com.chainlesschain.android.feature.p2p.ui.components

import android.graphics.BitmapFactory
import android.util.Base64
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.chainlesschain.android.core.database.entity.FileTransferEntity
import com.chainlesschain.android.core.database.entity.FileTransferStatusEnum
import com.chainlesschain.android.core.p2p.filetransfer.model.TransferProgress
import java.text.SimpleDateFormat
import java.util.*

/**
 * 文件传输卡片
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FileTransferCard(
    transfer: FileTransferEntity,
    progress: TransferProgress?,
    onAccept: () -> Unit,
    onReject: () -> Unit,
    onPause: () -> Unit,
    onResume: () -> Unit,
    onCancel: () -> Unit,
    onRetry: () -> Unit,
    onDelete: () -> Unit,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    var showMenu by remember { mutableStateOf(false) }
    val dateFormat = remember { SimpleDateFormat("MM/dd HH:mm", Locale.getDefault()) }

    Card(
        onClick = onClick,
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.Top
            ) {
                // File info section
                Row(
                    modifier = Modifier.weight(1f),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    // Thumbnail or icon
                    Box(
                        modifier = Modifier
                            .size(48.dp)
                            .clip(RoundedCornerShape(8.dp))
                            .background(MaterialTheme.colorScheme.surfaceVariant),
                        contentAlignment = Alignment.Center
                    ) {
                        if (!transfer.thumbnailBase64.isNullOrEmpty()) {
                            // Show thumbnail
                            val bitmap = remember(transfer.thumbnailBase64) {
                                try {
                                    val bytes = Base64.decode(transfer.thumbnailBase64, Base64.DEFAULT)
                                    BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                                } catch (e: Exception) {
                                    null
                                }
                            }
                            if (bitmap != null) {
                                Image(
                                    bitmap = bitmap.asImageBitmap(),
                                    contentDescription = "Thumbnail",
                                    modifier = Modifier.fillMaxSize(),
                                    contentScale = ContentScale.Crop
                                )
                            } else {
                                FileTypeIcon(
                                    mimeType = transfer.mimeType,
                                    modifier = Modifier.size(24.dp),
                                    tint = getColorForMimeType(transfer.mimeType)
                                )
                            }
                        } else {
                            FileTypeIcon(
                                mimeType = transfer.mimeType,
                                modifier = Modifier.size(24.dp),
                                tint = getColorForMimeType(transfer.mimeType)
                            )
                        }
                    }

                    Column(modifier = Modifier.weight(1f)) {
                        // File name
                        Text(
                            text = transfer.fileName,
                            style = MaterialTheme.typography.bodyMedium,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )

                        // Size and direction
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(4.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(
                                imageVector = if (transfer.isOutgoing) Icons.Default.Upload else Icons.Default.Download,
                                contentDescription = if (transfer.isOutgoing) "Sending" else "Receiving",
                                modifier = Modifier.size(12.dp),
                                tint = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                            Text(
                                text = formatFileSize(transfer.fileSize),
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                            Text(
                                text = "•",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                            Text(
                                text = dateFormat.format(Date(transfer.createdAt)),
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }

                // Status chip and menu
                Row(
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    TransferStatusChip(status = transfer.status)

                    Box {
                        IconButton(
                            onClick = { showMenu = true },
                            modifier = Modifier.size(32.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.MoreVert,
                                contentDescription = "More options",
                                modifier = Modifier.size(18.dp)
                            )
                        }

                        DropdownMenu(
                            expanded = showMenu,
                            onDismissRequest = { showMenu = false }
                        ) {
                            when (transfer.status) {
                                FileTransferStatusEnum.REQUESTING -> {
                                    if (!transfer.isOutgoing) {
                                        DropdownMenuItem(
                                            text = { Text("Accept") },
                                            onClick = { showMenu = false; onAccept() },
                                            leadingIcon = {
                                                Icon(Icons.Default.Check, contentDescription = null)
                                            }
                                        )
                                        DropdownMenuItem(
                                            text = { Text("Reject") },
                                            onClick = { showMenu = false; onReject() },
                                            leadingIcon = {
                                                Icon(Icons.Default.Close, contentDescription = null)
                                            }
                                        )
                                    }
                                }
                                FileTransferStatusEnum.TRANSFERRING -> {
                                    DropdownMenuItem(
                                        text = { Text("Pause") },
                                        onClick = { showMenu = false; onPause() },
                                        leadingIcon = {
                                            Icon(Icons.Default.Pause, contentDescription = null)
                                        }
                                    )
                                    DropdownMenuItem(
                                        text = { Text("Cancel") },
                                        onClick = { showMenu = false; onCancel() },
                                        leadingIcon = {
                                            Icon(Icons.Default.Cancel, contentDescription = null)
                                        }
                                    )
                                }
                                FileTransferStatusEnum.PAUSED -> {
                                    DropdownMenuItem(
                                        text = { Text("Resume") },
                                        onClick = { showMenu = false; onResume() },
                                        leadingIcon = {
                                            Icon(Icons.Default.PlayArrow, contentDescription = null)
                                        }
                                    )
                                    DropdownMenuItem(
                                        text = { Text("Cancel") },
                                        onClick = { showMenu = false; onCancel() },
                                        leadingIcon = {
                                            Icon(Icons.Default.Cancel, contentDescription = null)
                                        }
                                    )
                                }
                                FileTransferStatusEnum.FAILED,
                                FileTransferStatusEnum.CANCELLED -> {
                                    if (transfer.isOutgoing) {
                                        DropdownMenuItem(
                                            text = { Text("Retry") },
                                            onClick = { showMenu = false; onRetry() },
                                            leadingIcon = {
                                                Icon(Icons.Default.Refresh, contentDescription = null)
                                            }
                                        )
                                    }
                                }
                            }

                            if (FileTransferStatusEnum.isTerminal(transfer.status)) {
                                DropdownMenuItem(
                                    text = { Text("Delete") },
                                    onClick = { showMenu = false; onDelete() },
                                    leadingIcon = {
                                        Icon(Icons.Default.Delete, contentDescription = null)
                                    }
                                )
                            }
                        }
                    }
                }
            }

            // Progress bar for active transfers
            if (transfer.status == FileTransferStatusEnum.TRANSFERRING ||
                transfer.status == FileTransferStatusEnum.PAUSED) {
                Spacer(modifier = Modifier.height(8.dp))
                TransferProgressIndicator(
                    progress = progress,
                    showDetails = true
                )
            }

            // Quick actions for pending requests
            if (transfer.status == FileTransferStatusEnum.REQUESTING && !transfer.isOutgoing) {
                Spacer(modifier = Modifier.height(8.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    OutlinedButton(
                        onClick = onReject,
                        modifier = Modifier.padding(end = 8.dp)
                    ) {
                        Text("Reject")
                    }
                    Button(onClick = onAccept) {
                        Text("Accept")
                    }
                }
            }

            // Error message
            val errorMsg = transfer.errorMessage
            if (transfer.status == FileTransferStatusEnum.FAILED && !errorMsg.isNullOrEmpty()) {
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = errorMsg,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.error
                )
            }
        }
    }
}

/**
 * 传输状态标签
 */
@Composable
fun TransferStatusChip(
    status: String,
    modifier: Modifier = Modifier
) {
    val (containerColor, labelColor, label) = when (status) {
        FileTransferStatusEnum.PENDING -> Triple(
            MaterialTheme.colorScheme.surfaceVariant,
            MaterialTheme.colorScheme.onSurfaceVariant,
            "Pending"
        )
        FileTransferStatusEnum.REQUESTING -> Triple(
            MaterialTheme.colorScheme.primaryContainer,
            MaterialTheme.colorScheme.onPrimaryContainer,
            "Requesting"
        )
        FileTransferStatusEnum.TRANSFERRING -> Triple(
            MaterialTheme.colorScheme.primaryContainer,
            MaterialTheme.colorScheme.onPrimaryContainer,
            "Transferring"
        )
        FileTransferStatusEnum.PAUSED -> Triple(
            MaterialTheme.colorScheme.tertiaryContainer,
            MaterialTheme.colorScheme.onTertiaryContainer,
            "Paused"
        )
        FileTransferStatusEnum.COMPLETED -> Triple(
            MaterialTheme.colorScheme.primaryContainer,
            MaterialTheme.colorScheme.primary,
            "Completed"
        )
        FileTransferStatusEnum.FAILED -> Triple(
            MaterialTheme.colorScheme.errorContainer,
            MaterialTheme.colorScheme.onErrorContainer,
            "Failed"
        )
        FileTransferStatusEnum.CANCELLED -> Triple(
            MaterialTheme.colorScheme.surfaceVariant,
            MaterialTheme.colorScheme.onSurfaceVariant,
            "Cancelled"
        )
        FileTransferStatusEnum.REJECTED -> Triple(
            MaterialTheme.colorScheme.errorContainer,
            MaterialTheme.colorScheme.onErrorContainer,
            "Rejected"
        )
        else -> Triple(
            MaterialTheme.colorScheme.surfaceVariant,
            MaterialTheme.colorScheme.onSurfaceVariant,
            status
        )
    }

    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(4.dp),
        color = containerColor
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = labelColor,
            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
        )
    }
}

/**
 * 格式化文件大小
 */
fun formatFileSize(bytes: Long): String {
    val units = arrayOf("B", "KB", "MB", "GB", "TB")
    var size = bytes.toDouble()
    var unitIndex = 0

    while (size >= 1024 && unitIndex < units.size - 1) {
        size /= 1024
        unitIndex++
    }

    return String.format("%.2f %s", size, units[unitIndex])
}

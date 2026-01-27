package com.chainlesschain.android.remote.ui.file

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.remote.data.FileTransferEntity
import com.chainlesschain.android.remote.data.TransferDirection
import com.chainlesschain.android.remote.data.TransferStatus
import java.text.SimpleDateFormat
import java.util.*

/**
 * 文件传输屏幕
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FileTransferScreen(
    deviceDid: String,
    onNavigateBack: () -> Unit,
    viewModel: FileTransferViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val recentTransfers by viewModel.recentTransfers.collectAsState()
    val activeTransfers by viewModel.activeTransfers.collectAsState()
    val statistics by viewModel.statistics.collectAsState()

    var showFilePicker by remember { mutableStateOf(false) }
    var selectedUri by remember { mutableStateOf<Uri?>(null) }

    // 文件选择器
    val filePickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.GetContent()
    ) { uri: Uri? ->
        uri?.let {
            selectedUri = it
            // 从 URI 获取文件名
            val fileName = it.lastPathSegment ?: "unknown_file"
            viewModel.uploadFile(it, fileName, deviceDid)
        }
    }

    // 显示错误或成功消息
    LaunchedEffect(uiState) {
        if (uiState is FileTransferUiState.Error || uiState is FileTransferUiState.Success) {
            // 在 Snackbar 中显示消息后重置状态
            kotlinx.coroutines.delay(3000)
            viewModel.resetUiState()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("文件传输") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, "返回")
                    }
                },
                actions = {
                    // 上传按钮
                    IconButton(onClick = { filePickerLauncher.launch("*/*") }) {
                        Icon(Icons.Default.CloudUpload, "上传文件")
                    }
                }
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            // 统计卡片
            statistics?.let { stats ->
                StatisticsCard(
                    statistics = stats,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp)
                )
            }

            // 活动传输（进行中）
            if (activeTransfers.isNotEmpty()) {
                Text(
                    text = "正在传输 (${activeTransfers.size})",
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
                )

                activeTransfers.forEach { transfer ->
                    TransferItem(
                        transfer = transfer,
                        onCancel = { viewModel.cancelTransfer(transfer.id) },
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp, vertical = 4.dp)
                    )
                }

                Divider(modifier = Modifier.padding(vertical = 8.dp))
            }

            // 传输历史
            Text(
                text = "传输历史",
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
            )

            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                items(
                    items = recentTransfers,
                    key = { it.id }
                ) { transfer ->
                    TransferItem(
                        transfer = transfer,
                        onCancel = if (transfer.status == TransferStatus.IN_PROGRESS) {
                            { viewModel.cancelTransfer(transfer.id) }
                        } else null,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            }
        }

        // 显示上传/下载进度
        when (val state = uiState) {
            is FileTransferUiState.Uploading -> {
                ProgressDialog(
                    title = "上传中",
                    fileName = state.fileName,
                    progress = state.progress
                )
            }
            is FileTransferUiState.Downloading -> {
                ProgressDialog(
                    title = "下载中",
                    fileName = state.fileName,
                    progress = state.progress
                )
            }
            else -> {}
        }
    }
}

/**
 * 统计卡片
 */
@Composable
fun StatisticsCard(
    statistics: com.chainlesschain.android.remote.data.FileTransferStatistics,
    modifier: Modifier = Modifier
) {
    Card(
        modifier = modifier,
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(
            modifier = Modifier.padding(16.dp)
        ) {
            Text(
                text = "传输统计",
                style = MaterialTheme.typography.titleMedium
            )

            Spacer(modifier = Modifier.height(12.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceEvenly
            ) {
                StatItem("总数", statistics.total.toString())
                StatItem("完成", statistics.completed.toString(), MaterialTheme.colorScheme.primary)
                StatItem("失败", statistics.failed.toString(), MaterialTheme.colorScheme.error)
                StatItem("进行中", statistics.inProgress.toString(), MaterialTheme.colorScheme.tertiary)
            }

            Spacer(modifier = Modifier.height(8.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceEvenly
            ) {
                StatItem("上传", statistics.uploads.toString())
                StatItem("下载", statistics.downloads.toString())
                StatItem(
                    "总大小",
                    formatFileSize(statistics.totalBytes)
                )
            }
        }
    }
}

/**
 * 统计项
 */
@Composable
fun StatItem(
    label: String,
    value: String,
    color: androidx.compose.ui.graphics.Color = MaterialTheme.colorScheme.onSurface
) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            text = value,
            style = MaterialTheme.typography.titleLarge,
            color = color
        )
        Text(
            text = label,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

/**
 * 传输项
 */
@Composable
fun TransferItem(
    transfer: FileTransferEntity,
    onCancel: (() -> Unit)?,
    modifier: Modifier = Modifier
) {
    Card(
        modifier = modifier,
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
    ) {
        Column(
            modifier = Modifier.padding(16.dp)
        ) {
            // 文件名和状态
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.weight(1f)
                ) {
                    // 方向图标
                    Icon(
                        imageVector = if (transfer.direction == TransferDirection.UPLOAD) {
                            Icons.Default.CloudUpload
                        } else {
                            Icons.Default.CloudDownload
                        },
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(24.dp)
                    )

                    Spacer(modifier = Modifier.width(8.dp))

                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = transfer.fileName,
                            style = MaterialTheme.typography.bodyLarge,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )

                        Text(
                            text = formatFileSize(transfer.fileSize),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }

                // 状态标签
                StatusChip(status = transfer.status)
            }

            // 进度条（仅进行中时显示）
            if (transfer.status == TransferStatus.IN_PROGRESS) {
                Spacer(modifier = Modifier.height(8.dp))

                LinearProgressIndicator(
                    progress = (transfer.progress / 100).toFloat(),
                    modifier = Modifier.fillMaxWidth()
                )

                Spacer(modifier = Modifier.height(4.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text(
                        text = "${String.format("%.1f", transfer.progress)}%",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )

                    if (transfer.speed > 0) {
                        Text(
                            text = formatSpeed(transfer.speed),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }

            // 时间和操作
            Spacer(modifier = Modifier.height(8.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = formatTimestamp(transfer.createdAt),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )

                // 取消按钮（仅进行中时显示）
                onCancel?.let {
                    TextButton(onClick = it) {
                        Icon(
                            imageVector = Icons.Default.Cancel,
                            contentDescription = "取消",
                            modifier = Modifier.size(16.dp)
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("取消")
                    }
                }
            }

            // 错误信息
            transfer.error?.let { error ->
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = "错误: $error",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error
                )
            }
        }
    }
}

/**
 * 状态标签
 */
@Composable
fun StatusChip(status: TransferStatus) {
    val (text, color) = when (status) {
        TransferStatus.PENDING -> "等待中" to MaterialTheme.colorScheme.secondary
        TransferStatus.IN_PROGRESS -> "传输中" to MaterialTheme.colorScheme.primary
        TransferStatus.PAUSED -> "已暂停" to MaterialTheme.colorScheme.tertiary
        TransferStatus.COMPLETED -> "已完成" to MaterialTheme.colorScheme.primary
        TransferStatus.FAILED -> "失败" to MaterialTheme.colorScheme.error
        TransferStatus.CANCELLED -> "已取消" to MaterialTheme.colorScheme.outline
    }

    Surface(
        color = color.copy(alpha = 0.1f),
        shape = MaterialTheme.shapes.small
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.labelSmall,
            color = color,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
        )
    }
}

/**
 * 进度对话框
 */
@Composable
fun ProgressDialog(
    title: String,
    fileName: String,
    progress: Double
) {
    AlertDialog(
        onDismissRequest = {},
        title = { Text(title) },
        text = {
            Column {
                Text(
                    text = fileName,
                    style = MaterialTheme.typography.bodyMedium
                )

                Spacer(modifier = Modifier.height(16.dp))

                LinearProgressIndicator(
                    progress = (progress / 100).toFloat(),
                    modifier = Modifier.fillMaxWidth()
                )

                Spacer(modifier = Modifier.height(8.dp))

                Text(
                    text = "${String.format("%.1f", progress)}%",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        },
        confirmButton = {}
    )
}

// ========== 工具函数 ==========

/**
 * 格式化文件大小
 */
fun formatFileSize(bytes: Long): String {
    if (bytes < 1024) return "$bytes B"
    val kb = bytes / 1024.0
    if (kb < 1024) return String.format("%.2f KB", kb)
    val mb = kb / 1024.0
    if (mb < 1024) return String.format("%.2f MB", mb)
    val gb = mb / 1024.0
    return String.format("%.2f GB", gb)
}

/**
 * 格式化速度
 */
fun formatSpeed(bytesPerSecond: Double): String {
    return "${formatFileSize(bytesPerSecond.toLong())}/s"
}

/**
 * 格式化时间戳
 */
fun formatTimestamp(timestamp: Long): String {
    val formatter = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault())
    return formatter.format(Date(timestamp))
}

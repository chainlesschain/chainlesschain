package com.chainlesschain.android.remote.ui.file

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Cancel
import androidx.compose.material.icons.filled.CleaningServices
import androidx.compose.material.icons.filled.CloudDownload
import androidx.compose.material.icons.filled.CloudUpload
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Divider
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.remote.data.FileTransferEntity
import com.chainlesschain.android.remote.data.FileTransferStatistics
import com.chainlesschain.android.remote.data.TransferDirection
import com.chainlesschain.android.remote.data.TransferStatus
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

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
    val snackbarHostState = remember { SnackbarHostState() }

    var downloadRemotePath by remember { mutableStateOf("") }
    var downloadFileName by remember { mutableStateOf("") }
    var showDownloadPanel by remember { mutableStateOf(false) }

    val filePickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.GetContent()
    ) { uri: Uri? ->
        uri?.let {
            val fileName = it.lastPathSegment ?: "unknown_file"
            viewModel.uploadFile(it, fileName, deviceDid)
        }
    }

    LaunchedEffect(uiState) {
        when (val state = uiState) {
            is FileTransferUiState.Error -> {
                snackbarHostState.showSnackbar(state.message)
                viewModel.resetUiState()
            }
            is FileTransferUiState.Success -> {
                snackbarHostState.showSnackbar(state.message)
                viewModel.resetUiState()
            }
            else -> Unit
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = { Text("File Transfer") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, "Back")
                    }
                },
                actions = {
                    IconButton(onClick = { filePickerLauncher.launch("*/*") }) {
                        Icon(Icons.Default.CloudUpload, "Upload")
                    }
                    IconButton(onClick = { showDownloadPanel = !showDownloadPanel }) {
                        Icon(Icons.Default.CloudDownload, "Download")
                    }
                    IconButton(onClick = { viewModel.cleanupOldTransfers(30) }) {
                        Icon(Icons.Default.CleaningServices, "Cleanup")
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
            if (showDownloadPanel) {
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 8.dp),
                    elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(12.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Text("Remote Download", style = MaterialTheme.typography.titleSmall)
                        OutlinedTextField(
                            value = downloadRemotePath,
                            onValueChange = { downloadRemotePath = it },
                            modifier = Modifier.fillMaxWidth(),
                            label = { Text("Remote Path") },
                            singleLine = true
                        )
                        OutlinedTextField(
                            value = downloadFileName,
                            onValueChange = { downloadFileName = it },
                            modifier = Modifier.fillMaxWidth(),
                            label = { Text("Local File Name (Optional)") },
                            singleLine = true
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(
                                onClick = {
                                    val remotePath = downloadRemotePath.trim()
                                    if (remotePath.isNotEmpty()) {
                                        val finalName = downloadFileName.trim().ifEmpty {
                                            remotePath.substringAfterLast('/').ifEmpty { "download.bin" }
                                        }
                                        viewModel.downloadFile(
                                            remotePath = remotePath,
                                            fileName = finalName,
                                            deviceDid = deviceDid
                                        )
                                    }
                                },
                                enabled = downloadRemotePath.isNotBlank()
                            ) {
                                Text("Start Download")
                            }
                            OutlinedButton(onClick = { showDownloadPanel = false }) {
                                Text("Close")
                            }
                        }
                    }
                }
            }

            statistics?.let { stats ->
                StatisticsCard(
                    statistics = stats,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp)
                )
            }

            if (activeTransfers.isNotEmpty()) {
                Text(
                    text = "Active Transfers (${activeTransfers.size})",
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

            Text(
                text = "Transfer History",
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
            )

            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                items(items = recentTransfers, key = { it.id }) { transfer ->
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

        when (val state = uiState) {
            is FileTransferUiState.Uploading -> {
                ProgressDialog(
                    title = "Uploading",
                    fileName = state.fileName,
                    progress = state.progress
                )
            }
            is FileTransferUiState.Downloading -> {
                ProgressDialog(
                    title = "Downloading",
                    fileName = state.fileName,
                    progress = state.progress
                )
            }
            else -> Unit
        }
    }
}

@Composable
fun StatisticsCard(
    statistics: FileTransferStatistics,
    modifier: Modifier = Modifier
) {
    Card(
        modifier = modifier,
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(text = "Transfer Statistics", style = MaterialTheme.typography.titleMedium)

            Spacer(modifier = Modifier.height(12.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceEvenly
            ) {
                StatItem("Total", statistics.total.toString())
                StatItem("Done", statistics.completed.toString(), MaterialTheme.colorScheme.primary)
                StatItem("Failed", statistics.failed.toString(), MaterialTheme.colorScheme.error)
                StatItem("Active", statistics.inProgress.toString(), MaterialTheme.colorScheme.tertiary)
            }

            Spacer(modifier = Modifier.height(8.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceEvenly
            ) {
                StatItem("Upload", statistics.uploads.toString())
                StatItem("Download", statistics.downloads.toString())
                StatItem("Bytes", formatFileSize(statistics.totalBytes))
            }
        }
    }
}

@Composable
fun StatItem(
    label: String,
    value: String,
    color: Color = MaterialTheme.colorScheme.onSurface
) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(text = value, style = MaterialTheme.typography.titleLarge, color = color)
        Text(
            text = label,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

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
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.weight(1f)
                ) {
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

                StatusChip(status = transfer.status)
            }

            if (transfer.status == TransferStatus.IN_PROGRESS) {
                Spacer(modifier = Modifier.height(8.dp))
                LinearProgressIndicator(
                    progress = { (transfer.progress / 100).toFloat() },
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

                onCancel?.let {
                    TextButton(onClick = it) {
                        Icon(
                            imageVector = Icons.Default.Cancel,
                            contentDescription = "Cancel",
                            modifier = Modifier.size(16.dp)
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("Cancel")
                    }
                }
            }

            transfer.error?.let { error ->
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = "Error: $error",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error
                )
            }
        }
    }
}

@Composable
fun StatusChip(status: TransferStatus) {
    val (text, color) = when (status) {
        TransferStatus.PENDING -> "Pending" to MaterialTheme.colorScheme.secondary
        TransferStatus.IN_PROGRESS -> "In Progress" to MaterialTheme.colorScheme.primary
        TransferStatus.PAUSED -> "Paused" to MaterialTheme.colorScheme.tertiary
        TransferStatus.COMPLETED -> "Completed" to MaterialTheme.colorScheme.primary
        TransferStatus.FAILED -> "Failed" to MaterialTheme.colorScheme.error
        TransferStatus.CANCELLED -> "Cancelled" to MaterialTheme.colorScheme.outline
    }

    Surface(color = color.copy(alpha = 0.1f), shape = MaterialTheme.shapes.small) {
        Text(
            text = text,
            style = MaterialTheme.typography.labelSmall,
            color = color,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
        )
    }
}

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
                Text(text = fileName, style = MaterialTheme.typography.bodyMedium)
                Spacer(modifier = Modifier.height(16.dp))
                LinearProgressIndicator(
                    progress = { (progress / 100).toFloat() },
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

fun formatFileSize(bytes: Long): String {
    if (bytes < 1024) return "$bytes B"
    val kb = bytes / 1024.0
    if (kb < 1024) return String.format("%.2f KB", kb)
    val mb = kb / 1024.0
    if (mb < 1024) return String.format("%.2f MB", mb)
    val gb = mb / 1024.0
    return String.format("%.2f GB", gb)
}

fun formatSpeed(bytesPerSecond: Double): String {
    return "${formatFileSize(bytesPerSecond.toLong())}/s"
}

fun formatTimestamp(timestamp: Long): String {
    val formatter = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault())
    return formatter.format(Date(timestamp))
}

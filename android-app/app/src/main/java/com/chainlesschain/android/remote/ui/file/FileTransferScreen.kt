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
import androidx.compose.material3.HorizontalDivider
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.R
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
                title = { Text(stringResource(R.string.rs_file_title)) },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, stringResource(R.string.common_back))
                    }
                },
                actions = {
                    IconButton(onClick = { filePickerLauncher.launch("*/*") }) {
                        Icon(Icons.Default.CloudUpload, stringResource(R.string.rs_file_upload))
                    }
                    IconButton(onClick = { showDownloadPanel = !showDownloadPanel }) {
                        Icon(Icons.Default.CloudDownload, stringResource(R.string.rs_file_download))
                    }
                    IconButton(onClick = { viewModel.cleanupOldTransfers(30) }) {
                        Icon(Icons.Default.CleaningServices, stringResource(R.string.rs_file_cleanup))
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
                        Text(stringResource(R.string.rs_file_remote_download), style = MaterialTheme.typography.titleSmall)
                        OutlinedTextField(
                            value = downloadRemotePath,
                            onValueChange = { downloadRemotePath = it },
                            modifier = Modifier.fillMaxWidth(),
                            label = { Text(stringResource(R.string.rs_file_remote_path)) },
                            singleLine = true
                        )
                        OutlinedTextField(
                            value = downloadFileName,
                            onValueChange = { downloadFileName = it },
                            modifier = Modifier.fillMaxWidth(),
                            label = { Text(stringResource(R.string.rs_file_local_name_optional)) },
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
                                Text(stringResource(R.string.rs_file_start_download))
                            }
                            OutlinedButton(onClick = { showDownloadPanel = false }) {
                                Text(stringResource(R.string.common_close))
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
                    text = stringResource(R.string.rs_file_active_transfers_fmt, activeTransfers.size),
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

                HorizontalDivider(modifier = Modifier.padding(vertical = 8.dp))
            }

            Text(
                text = stringResource(R.string.rs_file_transfer_history),
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
                    title = stringResource(R.string.rs_file_uploading),
                    fileName = state.fileName,
                    progress = state.progress
                )
            }
            is FileTransferUiState.Downloading -> {
                ProgressDialog(
                    title = stringResource(R.string.rs_file_downloading),
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
            Text(text = stringResource(R.string.rs_file_stats_title), style = MaterialTheme.typography.titleMedium)

            Spacer(modifier = Modifier.height(12.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceEvenly
            ) {
                StatItem(stringResource(R.string.rs_file_stat_total), statistics.total.toString())
                StatItem(stringResource(R.string.rs_file_stat_done), statistics.completed.toString(), MaterialTheme.colorScheme.primary)
                StatItem(stringResource(R.string.rs_file_stat_failed), statistics.failed.toString(), MaterialTheme.colorScheme.error)
                StatItem(stringResource(R.string.rs_file_stat_active), statistics.inProgress.toString(), MaterialTheme.colorScheme.tertiary)
            }

            Spacer(modifier = Modifier.height(8.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceEvenly
            ) {
                StatItem(stringResource(R.string.rs_file_stat_upload), statistics.uploads.toString())
                StatItem(stringResource(R.string.rs_file_stat_download), statistics.downloads.toString())
                StatItem(stringResource(R.string.rs_file_stat_bytes), formatFileSize(statistics.totalBytes))
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
                            contentDescription = stringResource(R.string.common_cancel),
                            modifier = Modifier.size(16.dp)
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text(stringResource(R.string.common_cancel))
                    }
                }
            }

            transfer.error?.let { error ->
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = stringResource(R.string.error_prefix, error),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error
                )
            }
        }
    }
}

@Composable
fun StatusChip(status: TransferStatus) {
    val (textRes, color) = when (status) {
        TransferStatus.PENDING -> R.string.rs_file_status_pending to MaterialTheme.colorScheme.secondary
        TransferStatus.IN_PROGRESS -> R.string.rs_file_status_in_progress to MaterialTheme.colorScheme.primary
        TransferStatus.PAUSED -> R.string.rs_file_status_paused to MaterialTheme.colorScheme.tertiary
        TransferStatus.COMPLETED -> R.string.rs_file_status_completed to MaterialTheme.colorScheme.primary
        TransferStatus.FAILED -> R.string.rs_file_status_failed to MaterialTheme.colorScheme.error
        TransferStatus.CANCELLED -> R.string.rs_file_status_cancelled to MaterialTheme.colorScheme.outline
    }

    Surface(color = color.copy(alpha = 0.1f), shape = MaterialTheme.shapes.small) {
        Text(
            text = stringResource(textRes),
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

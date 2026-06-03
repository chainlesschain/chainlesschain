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
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.Cancel
import androidx.compose.material.icons.filled.CleaningServices
import androidx.compose.material.icons.filled.CloudDownload
import androidx.compose.material.icons.filled.CloudUpload
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.FolderOpen
import androidx.compose.material.icons.filled.InsertDriveFile
import androidx.compose.material.icons.filled.PhoneAndroid
import androidx.compose.material.icons.filled.Refresh
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
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
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
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import android.content.ContentUris
import android.content.Intent
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.widget.Toast
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
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
    val remoteFiles by viewModel.remoteFiles.collectAsState()
    val currentRemotePath by viewModel.currentPath.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }

    var downloadRemotePath by remember { mutableStateOf("") }
    var downloadFileName by remember { mutableStateOf("") }
    var showDownloadPanel by remember { mutableStateOf(false) }
    var showBrowsePanel by remember { mutableStateOf(false) }
    // 默认浏览起点：用户家目录 占位符 "~"；PC 端 file-handler 应识别并解析为当前系统的 home。
    var pathInput by remember { mutableStateOf("~") }

    var showLocalPanel by remember { mutableStateOf(false) }
    var localDownloads by remember { mutableStateOf<List<LocalDownloadItem>>(emptyList()) }
    var isLocalLoading by remember { mutableStateOf(false) }
    var localRefreshTick by remember { mutableStateOf(0) }

    val filePickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.GetContent()
    ) { uri: Uri? ->
        uri?.let {
            val fileName = it.lastPathSegment ?: "unknown_file"
            viewModel.uploadFile(it, fileName, deviceDid)
        }
    }

    val clipboardManager = LocalClipboardManager.current
    val ctx = LocalContext.current

    LaunchedEffect(uiState) {
        when (val state = uiState) {
            is FileTransferUiState.Error -> {
                snackbarHostState.showSnackbar(state.message)
                viewModel.resetUiState()
            }
            is FileTransferUiState.Success -> {
                val pathHint = state.pathHint
                val openUri = state.openUri
                val displayMsg = if (pathHint != null) "${state.message}\n$pathHint" else state.message
                // 优先「打开」按钮（下载场景，有 content:// uri），其次「复制路径」
                // （上传场景，PC 路径无法在 Android 端打开）。两种场景不会冲突。
                val actionLabel = when {
                    openUri != null -> "打开"
                    pathHint != null -> "复制路径"
                    else -> null
                }
                val res = snackbarHostState.showSnackbar(
                    message = displayMsg,
                    actionLabel = actionLabel,
                    duration = if (actionLabel != null) SnackbarDuration.Long else SnackbarDuration.Short,
                )
                if (res == SnackbarResult.ActionPerformed) {
                    if (openUri != null) {
                        openDownloadedFile(ctx, openUri)
                    } else if (pathHint != null) {
                        val raw = pathHint.removePrefix("PC: ").trim()
                        clipboardManager.setText(AnnotatedString(raw))
                        Toast.makeText(ctx, "路径已复制", Toast.LENGTH_SHORT).show()
                    }
                }
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
                    IconButton(onClick = {
                        showBrowsePanel = !showBrowsePanel
                        if (showBrowsePanel && remoteFiles.isEmpty()) {
                            // 首次打开默认浏览家目录；用户可改 pathInput 后再"进入"。
                            viewModel.browseRemoteFiles(pathInput)
                        }
                    }) {
                        Icon(
                            if (showBrowsePanel) Icons.Default.FolderOpen else Icons.Default.Folder,
                            contentDescription = "浏览远程目录",
                        )
                    }
                    IconButton(onClick = { filePickerLauncher.launch("*/*") }) {
                        Icon(Icons.Default.CloudUpload, stringResource(R.string.rs_file_upload))
                    }
                    IconButton(onClick = { showDownloadPanel = !showDownloadPanel }) {
                        Icon(Icons.Default.CloudDownload, stringResource(R.string.rs_file_download))
                    }
                    IconButton(onClick = { showLocalPanel = !showLocalPanel }) {
                        Icon(Icons.Default.PhoneAndroid, contentDescription = "本机下载文件夹")
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
            // 顶部引导卡（始终显示）：让用户一眼看到右上角 4 个图标对应什么操作。
            HelpBanner(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp),
            )

            if (showLocalPanel) {
                LaunchedEffect(showLocalPanel, localRefreshTick) {
                    isLocalLoading = true
                    localDownloads = queryLocalDownloads(ctx)
                    isLocalLoading = false
                }
                LocalDownloadsPanel(
                    items = localDownloads,
                    isLoading = isLocalLoading,
                    onItemClick = { item ->
                        openDownloadedFile(ctx, item.uri.toString())
                    },
                    onRefresh = { localRefreshTick++ },
                    onClose = { showLocalPanel = false },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 8.dp),
                )
            }

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

            if (showBrowsePanel) {
                RemoteBrowsePanel(
                    currentPath = currentRemotePath,
                    pathInput = pathInput,
                    onPathInputChange = { pathInput = it },
                    files = remoteFiles,
                    isLoading = uiState is FileTransferUiState.Loading,
                    onEnter = {
                        val target = pathInput.trim().ifEmpty { "~" }
                        viewModel.browseRemoteFiles(target)
                    },
                    onRefresh = {
                        viewModel.browseRemoteFiles(currentRemotePath.ifEmpty { pathInput })
                    },
                    onParent = {
                        val parent = parentPath(currentRemotePath)
                        pathInput = parent
                        viewModel.browseRemoteFiles(parent)
                    },
                    onDirClick = { dir ->
                        pathInput = dir.path
                        viewModel.browseRemoteFiles(dir.path)
                    },
                    onFileDownload = { file ->
                        viewModel.downloadFile(
                            remotePath = file.path,
                            fileName = file.name,
                            deviceDid = deviceDid,
                        )
                    },
                    onClose = { showBrowsePanel = false },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 8.dp),
                )
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

/**
 * 本机 Downloads 目录下的一条文件，用于 LocalDownloadsPanel 列表。
 */
internal data class LocalDownloadItem(
    val displayName: String,
    val size: Long,
    val mimeType: String,
    val dateAdded: Long,   // 毫秒
    val uri: android.net.Uri,
)

/**
 * 查询本机公共 Downloads 目录的所有文件 (按 dateAdded DESC)。
 * API 29+ 通过 MediaStore.Downloads；老版本暂返回空（fallback app-private 路径
 * 用户不需要在 app 内浏览，他们也访问不到）。
 */
internal suspend fun queryLocalDownloads(
    context: android.content.Context,
): List<LocalDownloadItem> = withContext(Dispatchers.IO) {
    val items = mutableListOf<LocalDownloadItem>()
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return@withContext items
    val collection = MediaStore.Downloads.EXTERNAL_CONTENT_URI
    val projection = arrayOf(
        MediaStore.MediaColumns._ID,
        MediaStore.MediaColumns.DISPLAY_NAME,
        MediaStore.MediaColumns.SIZE,
        MediaStore.MediaColumns.MIME_TYPE,
        MediaStore.MediaColumns.DATE_ADDED,
    )
    runCatching {
        context.contentResolver.query(
            collection,
            projection,
            null,
            null,
            "${MediaStore.MediaColumns.DATE_ADDED} DESC",
        )?.use { cursor ->
            val idIdx = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns._ID)
            val nameIdx = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DISPLAY_NAME)
            val sizeIdx = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.SIZE)
            val mimeIdx = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.MIME_TYPE)
            val dateIdx = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DATE_ADDED)
            while (cursor.moveToNext()) {
                val id = cursor.getLong(idIdx)
                items.add(
                    LocalDownloadItem(
                        displayName = cursor.getString(nameIdx) ?: "(未命名)",
                        size = cursor.getLong(sizeIdx),
                        mimeType = cursor.getString(mimeIdx) ?: "*/*",
                        dateAdded = cursor.getLong(dateIdx) * 1000L,
                        uri = ContentUris.withAppendedId(collection, id),
                    ),
                )
            }
        }
    }
    items
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun LocalDownloadsPanel(
    items: List<LocalDownloadItem>,
    isLoading: Boolean,
    onItemClick: (LocalDownloadItem) -> Unit,
    onRefresh: () -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Card(
        modifier = modifier,
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column {
                    Text(
                        text = "本机下载文件夹",
                        style = MaterialTheme.typography.titleSmall,
                    )
                    Text(
                        text = "内部存储 / Download (${items.size} 个)",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Row {
                    IconButton(onClick = onRefresh, enabled = !isLoading) {
                        Icon(Icons.Default.Refresh, contentDescription = "刷新")
                    }
                    TextButton(onClick = onClose) {
                        Text(stringResource(R.string.common_close))
                    }
                }
            }

            if (isLoading) {
                LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            }
            HorizontalDivider()

            if (items.isEmpty() && !isLoading) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(80.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = "暂无下载文件",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            } else {
                LazyColumn(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(360.dp),
                    verticalArrangement = Arrangement.spacedBy(2.dp),
                ) {
                    items(items = items, key = { it.uri.toString() }) { item ->
                        LocalDownloadRow(item = item, onClick = { onItemClick(item) })
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun LocalDownloadRow(
    item: LocalDownloadItem,
    onClick: () -> Unit,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        onClick = onClick,
        color = MaterialTheme.colorScheme.surface,
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                imageVector = Icons.Default.InsertDriveFile,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(20.dp),
            )
            Spacer(modifier = Modifier.width(10.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = item.displayName,
                    style = MaterialTheme.typography.bodyMedium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = "${formatFileSize(item.size)} · ${formatTimestamp(item.dateAdded)}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Text(
                text = "打开",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.primary,
            )
        }
    }
}

/**
 * 触发系统 viewer 打开下载到 Downloads 文件夹的文件。
 *
 * 主路径：Intent.ACTION_VIEW + content:// uri + FLAG_GRANT_READ_URI_PERMISSION。
 * 系统会根据 MIME 拉起对应应用（图片→相册、PDF→阅读器、视频→播放器、其它→文件管理器）。
 *
 * Fallback：如果文件类型没有 viewer（应用未安装等），尝试打开 Downloads 文件夹本身
 * 让用户手动找。再失败 toast 提示。
 */
private fun openDownloadedFile(context: android.content.Context, uriString: String) {
    val uri = Uri.parse(uriString)
    try {
        // 用 ContentResolver 探 MIME，没拿到就让系统 sniff
        val mime = try {
            context.contentResolver.getType(uri)
        } catch (_: Exception) {
            null
        }
        val viewIntent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, mime ?: "*/*")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        // 用 chooser 避免某些 ROM 直接 silent fail
        val chooser = Intent.createChooser(viewIntent, "打开文件").apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(chooser)
    } catch (e: Exception) {
        // 文件类型无 viewer 或 uri 失效 → fallback 打开 Downloads 文件夹
        try {
            val downloadsIntent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(
                    Uri.parse(
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                            // 标准 DocumentsUI 打开 Downloads 树
                            "content://com.android.externalstorage.documents/document/primary:Download"
                        } else {
                            Environment.getExternalStoragePublicDirectory(
                                Environment.DIRECTORY_DOWNLOADS,
                            ).absolutePath
                        },
                    ),
                    "resource/folder",
                )
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(downloadsIntent)
        } catch (e2: Exception) {
            Toast.makeText(
                context,
                "无法打开文件，请到「文件管理 → 内部存储 → Download」查看",
                Toast.LENGTH_LONG,
            ).show()
        }
    }
}

@Composable
private fun HelpBanner(modifier: Modifier = Modifier) {
    Card(
        modifier = modifier,
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.secondaryContainer,
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Text(
                text = "操作指引（右上角图标）",
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.onSecondaryContainer,
            )
            Spacer(modifier = Modifier.height(6.dp))
            Text(
                text = "📁 浏览远程目录（输入 ~ 看 PC 家目录；C:/ 看 Windows 盘根；/ 看 macOS/Linux 根）",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSecondaryContainer,
            )
            Text(
                text = "☁️↑ 上传本机文件到 PC（默认落 PC 用户 Downloads 目录）",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSecondaryContainer,
            )
            Text(
                text = "☁️↓ 输入远程路径直接下载（或在浏览面板里点文件）",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSecondaryContainer,
            )
            Text(
                text = "📱 本机下载文件夹 — 列出 Download 目录已下载文件，点击直接打开（不跳出 app）",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSecondaryContainer,
            )
            Text(
                text = "🧹 清理 30 天前的传输历史",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSecondaryContainer,
            )
        }
    }
}

/**
 * 返回 path 的父目录（兼容 Windows `\` 与 POSIX `/`）。
 * 顶层（"/" / "C:\" / "~"）返回自身。
 */
internal fun parentPath(path: String): String {
    if (path.isBlank() || path == "/" || path == "~") return path
    // Windows 盘根 "C:\" / "C:/"
    if (path.length == 3 && path[1] == ':' && (path[2] == '\\' || path[2] == '/')) return path
    val sep = if (path.contains('\\')) '\\' else '/'
    val trimmed = path.trimEnd(sep)
    val idx = trimmed.lastIndexOf(sep)
    if (idx <= 0) {
        // "C:\foo" → "C:\" ; "/foo" → "/"
        if (trimmed.length >= 2 && trimmed[1] == ':') return trimmed.substring(0, 2) + sep
        return sep.toString()
    }
    return trimmed.substring(0, idx)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun RemoteBrowsePanel(
    currentPath: String,
    pathInput: String,
    onPathInputChange: (String) -> Unit,
    files: List<RemoteFileInfo>,
    isLoading: Boolean,
    onEnter: () -> Unit,
    onRefresh: () -> Unit,
    onParent: () -> Unit,
    onDirClick: (RemoteFileInfo) -> Unit,
    onFileDownload: (RemoteFileInfo) -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Card(
        modifier = modifier,
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            // 标题行
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "远程目录浏览",
                    style = MaterialTheme.typography.titleSmall,
                )
                TextButton(onClick = onClose) {
                    Text(stringResource(R.string.common_close))
                }
            }

            // 路径输入 + 进入按钮
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                OutlinedTextField(
                    value = pathInput,
                    onValueChange = onPathInputChange,
                    modifier = Modifier.weight(1f),
                    label = { Text("远程路径") },
                    placeholder = { Text("~ 或 C:\\Users\\... 或 /home/...") },
                    singleLine = true,
                )
                Button(onClick = onEnter, enabled = !isLoading) {
                    Text("进入")
                }
            }

            // 操作行：当前位置 + 上级 + 刷新
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "当前: ${currentPath.ifEmpty { "(未浏览)" }}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                IconButton(
                    onClick = onParent,
                    enabled = !isLoading && currentPath.isNotEmpty(),
                ) {
                    Icon(Icons.Default.ArrowUpward, contentDescription = "上级目录")
                }
                IconButton(onClick = onRefresh, enabled = !isLoading) {
                    Icon(Icons.Default.Refresh, contentDescription = "刷新")
                }
            }

            if (isLoading) {
                LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            }

            HorizontalDivider()

            // 文件列表（最高 320dp，避免吞掉整个屏幕；超过滚动）
            if (files.isEmpty() && !isLoading) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(80.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = if (currentPath.isEmpty()) "点击「进入」浏览远程目录" else "目录为空",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            } else {
                LazyColumn(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(320.dp),
                    verticalArrangement = Arrangement.spacedBy(2.dp),
                ) {
                    items(items = files, key = { it.path }) { entry ->
                        RemoteFileRow(
                            entry = entry,
                            onClick = {
                                if (entry.isDirectory) onDirClick(entry) else onFileDownload(entry)
                            },
                        )
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun RemoteFileRow(
    entry: RemoteFileInfo,
    onClick: () -> Unit,
) {
    Surface(
        modifier = Modifier
            .fillMaxWidth(),
        onClick = onClick,
        color = MaterialTheme.colorScheme.surface,
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                imageVector = if (entry.isDirectory) Icons.Default.Folder else Icons.Default.InsertDriveFile,
                contentDescription = null,
                tint = if (entry.isDirectory) {
                    MaterialTheme.colorScheme.primary
                } else {
                    MaterialTheme.colorScheme.onSurfaceVariant
                },
                modifier = Modifier.size(20.dp),
            )
            Spacer(modifier = Modifier.width(10.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = entry.name,
                    style = MaterialTheme.typography.bodyMedium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = if (entry.isDirectory) "目录" else formatFileSize(entry.size),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (!entry.isDirectory) {
                Icon(
                    Icons.Default.CloudDownload,
                    contentDescription = "下载",
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(18.dp),
                )
            }
        }
    }
}

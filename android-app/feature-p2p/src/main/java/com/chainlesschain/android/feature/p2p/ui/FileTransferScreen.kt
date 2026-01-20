package com.chainlesschain.android.feature.p2p.ui

import android.widget.Toast
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.core.database.entity.FileTransferEntity
import com.chainlesschain.android.core.database.entity.FileTransferStatusEnum
import com.chainlesschain.android.feature.p2p.ui.components.FileTransferCard
import com.chainlesschain.android.feature.p2p.viewmodel.FileTransferUiEvent
import com.chainlesschain.android.feature.p2p.viewmodel.FileTransferViewModel
import kotlinx.coroutines.launch

/**
 * 文件传输列表界面
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FileTransferScreen(
    peerId: String?,
    peerName: String?,
    onNavigateBack: () -> Unit,
    viewModel: FileTransferViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val allProgress by viewModel.allTransfersProgress.collectAsState()

    val context = LocalContext.current
    val snackbarHostState = remember { SnackbarHostState() }
    val coroutineScope = rememberCoroutineScope()

    // File picker launcher
    val filePickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenDocument()
    ) { uri ->
        uri?.let { viewModel.sendFile(it, peerId) }
    }

    // Load transfers
    LaunchedEffect(peerId) {
        if (peerId != null) {
            viewModel.loadTransfers(peerId)
        } else {
            viewModel.loadAllTransfers()
        }
    }

    // Handle events
    LaunchedEffect(Unit) {
        viewModel.events.collect { event ->
            when (event) {
                is FileTransferUiEvent.RequestFilePicker -> {
                    filePickerLauncher.launch(arrayOf("*/*"))
                }
                is FileTransferUiEvent.TransferStarted -> {
                    coroutineScope.launch {
                        snackbarHostState.showSnackbar("Sending ${event.fileName}...")
                    }
                }
                is FileTransferUiEvent.TransferCompleted -> {
                    coroutineScope.launch {
                        snackbarHostState.showSnackbar(
                            message = "${event.fileName} completed",
                            actionLabel = "Open"
                        ).let { result ->
                            if (result == SnackbarResult.ActionPerformed && event.localPath != null) {
                                // TODO: Open file
                            }
                        }
                    }
                }
                is FileTransferUiEvent.TransferFailed -> {
                    coroutineScope.launch {
                        snackbarHostState.showSnackbar(
                            message = "Transfer failed: ${event.error ?: "Unknown error"}",
                            duration = SnackbarDuration.Long
                        )
                    }
                }
                is FileTransferUiEvent.ShowError -> {
                    Toast.makeText(context, event.message, Toast.LENGTH_SHORT).show()
                }
                is FileTransferUiEvent.ShowMessage -> {
                    Toast.makeText(context, event.message, Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(if (peerName != null) "Files with $peerName" else "All Transfers")
                        if (uiState.activeTransfers.isNotEmpty()) {
                            Text(
                                text = "${uiState.activeTransfers.size} active",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    // Clear menu
                    var showMenu by remember { mutableStateOf(false) }
                    IconButton(onClick = { showMenu = true }) {
                        Icon(Icons.Default.MoreVert, contentDescription = "More options")
                    }
                    DropdownMenu(
                        expanded = showMenu,
                        onDismissRequest = { showMenu = false }
                    ) {
                        DropdownMenuItem(
                            text = { Text("Clear completed") },
                            onClick = {
                                showMenu = false
                                viewModel.clearCompletedTransfers()
                            },
                            leadingIcon = {
                                Icon(Icons.Default.ClearAll, contentDescription = null)
                            }
                        )
                        DropdownMenuItem(
                            text = { Text("Clear failed") },
                            onClick = {
                                showMenu = false
                                viewModel.clearFailedTransfers()
                            },
                            leadingIcon = {
                                Icon(Icons.Default.DeleteSweep, contentDescription = null)
                            }
                        )
                    }
                }
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
        floatingActionButton = {
            if (peerId != null) {
                FloatingActionButton(
                    onClick = { viewModel.requestFilePicker() }
                ) {
                    Icon(Icons.Default.Add, contentDescription = "Send file")
                }
            }
        }
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            when {
                uiState.isLoading -> {
                    CircularProgressIndicator(
                        modifier = Modifier.align(Alignment.Center)
                    )
                }

                uiState.transfers.isEmpty() -> {
                    EmptyTransfersState(
                        hasPeer = peerId != null,
                        onSendFile = { viewModel.requestFilePicker() }
                    )
                }

                else -> {
                    FileTransferList(
                        transfers = uiState.transfers,
                        pendingRequests = uiState.pendingRequests,
                        progressMap = allProgress,
                        onAccept = viewModel::acceptTransfer,
                        onReject = viewModel::rejectTransfer,
                        onPause = viewModel::pauseTransfer,
                        onResume = viewModel::resumeTransfer,
                        onCancel = viewModel::cancelTransfer,
                        onRetry = viewModel::retryTransfer,
                        onDelete = viewModel::deleteTransfer,
                        onSelect = viewModel::selectTransfer
                    )
                }
            }

            // Error message
            if (uiState.error != null) {
                Snackbar(
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(16.dp),
                    action = {
                        TextButton(onClick = { viewModel.clearError() }) {
                            Text("Dismiss")
                        }
                    }
                ) {
                    Text(uiState.error ?: "Unknown error")
                }
            }
        }
    }
}

/**
 * 文件传输列表
 */
@Composable
private fun FileTransferList(
    transfers: List<FileTransferEntity>,
    pendingRequests: List<FileTransferEntity>,
    progressMap: Map<String, com.chainlesschain.android.core.p2p.filetransfer.model.TransferProgress>,
    onAccept: (String) -> Unit,
    onReject: (String) -> Unit,
    onPause: (String) -> Unit,
    onResume: (String) -> Unit,
    onCancel: (String) -> Unit,
    onRetry: (String) -> Unit,
    onDelete: (String) -> Unit,
    onSelect: (String) -> Unit
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        // Pending requests banner
        if (pendingRequests.isNotEmpty()) {
            item {
                PendingRequestsBanner(
                    count = pendingRequests.size,
                    modifier = Modifier.fillMaxWidth()
                )
            }
        }

        // Active transfers section
        val activeTransfers = transfers.filter { !FileTransferStatusEnum.isTerminal(it.status) }
        if (activeTransfers.isNotEmpty()) {
            item {
                SectionHeader(title = "Active Transfers")
            }
            items(activeTransfers, key = { it.id }) { transfer ->
                FileTransferCard(
                    transfer = transfer,
                    progress = progressMap[transfer.id],
                    onAccept = { onAccept(transfer.id) },
                    onReject = { onReject(transfer.id) },
                    onPause = { onPause(transfer.id) },
                    onResume = { onResume(transfer.id) },
                    onCancel = { onCancel(transfer.id) },
                    onRetry = { onRetry(transfer.id) },
                    onDelete = { onDelete(transfer.id) },
                    onClick = { onSelect(transfer.id) }
                )
            }
        }

        // Completed transfers section
        val completedTransfers = transfers.filter { FileTransferStatusEnum.isTerminal(it.status) }
        if (completedTransfers.isNotEmpty()) {
            item {
                SectionHeader(title = "History")
            }
            items(completedTransfers, key = { it.id }) { transfer ->
                FileTransferCard(
                    transfer = transfer,
                    progress = progressMap[transfer.id],
                    onAccept = { onAccept(transfer.id) },
                    onReject = { onReject(transfer.id) },
                    onPause = { onPause(transfer.id) },
                    onResume = { onResume(transfer.id) },
                    onCancel = { onCancel(transfer.id) },
                    onRetry = { onRetry(transfer.id) },
                    onDelete = { onDelete(transfer.id) },
                    onClick = { onSelect(transfer.id) }
                )
            }
        }
    }
}

/**
 * 分区标题
 */
@Composable
private fun SectionHeader(
    title: String,
    modifier: Modifier = Modifier
) {
    Text(
        text = title,
        style = MaterialTheme.typography.titleSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = modifier.padding(vertical = 8.dp)
    )
}

/**
 * 待处理请求横幅
 */
@Composable
private fun PendingRequestsBanner(
    count: Int,
    modifier: Modifier = Modifier
) {
    Surface(
        modifier = modifier,
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.primaryContainer
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = Icons.Default.Inbox,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onPrimaryContainer
            )
            Text(
                text = "$count pending request${if (count > 1) "s" else ""}",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onPrimaryContainer
            )
        }
    }
}

/**
 * 空状态
 */
@Composable
private fun EmptyTransfersState(
    hasPeer: Boolean,
    onSendFile: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Icon(
            imageVector = Icons.Default.SwapHoriz,
            contentDescription = null,
            modifier = Modifier.size(64.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
        )
        Spacer(modifier = Modifier.height(16.dp))
        Text(
            text = "No file transfers",
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = if (hasPeer) {
                "Tap the + button to send a file"
            } else {
                "File transfers will appear here"
            },
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
            textAlign = TextAlign.Center
        )
        if (hasPeer) {
            Spacer(modifier = Modifier.height(24.dp))
            FilledTonalButton(onClick = onSendFile) {
                Icon(Icons.Default.Add, contentDescription = null)
                Spacer(modifier = Modifier.width(8.dp))
                Text("Send a file")
            }
        }
    }
}

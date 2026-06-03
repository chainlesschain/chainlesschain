package com.chainlesschain.android.presentation.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Error
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.R

/**
 * 安卓本机 LLM 模型管理屏。
 *
 * 入口：[com.chainlesschain.android.feature.ai.presentation.settings.LLMSettingsScreen]
 * 顶栏 PhoneAndroid 图标 → NavGraph 路由 [com.chainlesschain.android.navigation.Screen.AndroidLocalModel]。
 *
 * 职责（薄屏）：
 *  1. 显示 ModelManager.state 的 5 态
 *  2. 提供 下载 / 删除 / 刷新 三个 action
 *  3. Ready 时点 "测试对话" 跳 [LLMTestChatScreen] (useLocalEngine=true)
 *
 * 不在此屏跑推理本身 —— 测试走专门的对话页面，复用既有 LLMTestChatScreen UI。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AndroidLocalModelScreen(
    onNavigateBack: () -> Unit,
    onNavigateToTestChat: () -> Unit,
    viewModel: AndroidLocalModelViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(uiState.message) {
        uiState.message?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.clearMessage()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.local_model_title)) },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = stringResource(R.string.common_back),
                        )
                    }
                },
                actions = {
                    IconButton(onClick = { viewModel.refreshModel() }) {
                        Icon(
                            Icons.Default.Refresh,
                            contentDescription = stringResource(R.string.local_model_refresh),
                        )
                    }
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            item { ModelSpecCard(uiState) }
            item { ModelStatusCard(uiState) }
            if (!uiState.nativeReady) {
                item { NativeNotReadyCard() }
            }
            item {
                ModelActionsRow(
                    uiState = uiState,
                    onDownload = { viewModel.downloadModel() },
                    onDelete = { viewModel.deleteModel() },
                    onTest = onNavigateToTestChat,
                )
            }
            item { UsageTipsCard() }
        }
    }
}

@Composable
private fun ModelSpecCard(uiState: AndroidLocalModelUiState) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.primaryContainer,
        ),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(
                text = uiState.spec.displayName,
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onPrimaryContainer,
            )
            Text(
                text = uiState.spec.filename,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.85f),
                fontFamily = FontFamily.Monospace,
            )
            Text(
                text = stringResource(
                    R.string.local_model_size_label,
                    uiState.spec.sizeBytesApprox / 1_000_000L,
                ),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onPrimaryContainer,
            )
            Text(
                text = stringResource(R.string.local_model_url_label, uiState.spec.primaryUrl),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onPrimaryContainer,
                fontFamily = FontFamily.Monospace,
            )
        }
    }
}

@Composable
private fun ModelStatusCard(uiState: AndroidLocalModelUiState) {
    val status = uiState.modelState
    val containerColor = when (status) {
        is LocalModelStatus.Ready -> MaterialTheme.colorScheme.primaryContainer
        is LocalModelStatus.Failed -> MaterialTheme.colorScheme.errorContainer
        is LocalModelStatus.Downloading, LocalModelStatus.Verifying -> MaterialTheme.colorScheme.tertiaryContainer
        LocalModelStatus.NotDownloaded -> MaterialTheme.colorScheme.surfaceVariant
    }
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = containerColor),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                when (status) {
                    is LocalModelStatus.Ready -> Icon(
                        Icons.Default.CheckCircle, null,
                        tint = MaterialTheme.colorScheme.primary,
                    )
                    is LocalModelStatus.Failed -> Icon(
                        Icons.Default.Error, null,
                        tint = MaterialTheme.colorScheme.error,
                    )
                    is LocalModelStatus.Downloading, LocalModelStatus.Verifying ->
                        CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                    LocalModelStatus.NotDownloaded -> Icon(Icons.Default.Download, null)
                }
                Text(
                    text = stringResource(statusLabelRes(status)),
                    style = MaterialTheme.typography.titleMedium,
                )
            }

            when (status) {
                is LocalModelStatus.Downloading -> {
                    val pct = (status.fraction * 100).toInt().coerceIn(0, 100)
                    LinearProgressIndicator(
                        progress = { status.fraction.coerceIn(0f, 1f) },
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Text(
                        text = stringResource(
                            R.string.local_model_download_progress,
                            pct,
                            status.received / 1_000_000L,
                            status.total / 1_000_000L,
                        ),
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
                is LocalModelStatus.Ready -> {
                    Text(
                        text = stringResource(R.string.local_model_ready_file, status.filename),
                        style = MaterialTheme.typography.bodySmall,
                    )
                    Text(
                        text = "sha256: ${status.sha256Short}…",
                        style = MaterialTheme.typography.labelSmall,
                        fontFamily = FontFamily.Monospace,
                    )
                }
                is LocalModelStatus.Failed -> Text(
                    text = status.reason,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onErrorContainer,
                )
                else -> { /* no extra detail */ }
            }
        }
    }
}

@Composable
private fun NativeNotReadyCard() {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.errorContainer,
        ),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Icon(Icons.Default.Error, null, tint = MaterialTheme.colorScheme.error)
            Text(
                text = stringResource(R.string.local_model_native_not_ready),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onErrorContainer,
            )
        }
    }
}

@Composable
private fun ModelActionsRow(
    uiState: AndroidLocalModelUiState,
    onDownload: () -> Unit,
    onDelete: () -> Unit,
    onTest: () -> Unit,
) {
    val status = uiState.modelState
    val isDownloading = status is LocalModelStatus.Downloading || status is LocalModelStatus.Verifying

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Button(
                onClick = onDownload,
                enabled = !isDownloading && !uiState.isReady,
                modifier = Modifier.weight(1f),
            ) {
                Icon(Icons.Default.Download, null, Modifier.size(18.dp))
                Spacer(Modifier.size(4.dp))
                Text(
                    stringResource(
                        if (status is LocalModelStatus.Failed) R.string.local_model_retry
                        else R.string.local_model_download,
                    ),
                )
            }
            OutlinedButton(
                onClick = onDelete,
                enabled = uiState.isReady || status is LocalModelStatus.Failed ||
                    status is LocalModelStatus.Downloading,
                modifier = Modifier.weight(1f),
            ) {
                Icon(Icons.Default.Delete, null, Modifier.size(18.dp))
                Spacer(Modifier.size(4.dp))
                Text(stringResource(R.string.local_model_delete))
            }
        }
        Button(
            onClick = onTest,
            enabled = uiState.isReady && uiState.nativeReady,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Icon(Icons.Default.PlayArrow, null, Modifier.size(18.dp))
            Spacer(Modifier.size(4.dp))
            Text(stringResource(R.string.local_model_test_chat))
        }
    }
}

@Composable
private fun UsageTipsCard() {
    Card(
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant,
        ),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = stringResource(R.string.local_model_tips_title),
                style = MaterialTheme.typography.titleSmall,
            )
            HorizontalDivider()
            Text(
                text = stringResource(R.string.local_model_tips_body),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

private fun statusLabelRes(status: LocalModelStatus): Int = when (status) {
    LocalModelStatus.NotDownloaded -> R.string.local_model_status_not_downloaded
    is LocalModelStatus.Downloading -> R.string.local_model_status_downloading
    LocalModelStatus.Verifying -> R.string.local_model_status_verifying
    is LocalModelStatus.Ready -> R.string.local_model_status_ready
    is LocalModelStatus.Failed -> R.string.local_model_status_failed
}

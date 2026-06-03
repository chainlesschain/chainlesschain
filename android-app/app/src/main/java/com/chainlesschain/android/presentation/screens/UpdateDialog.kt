package com.chainlesschain.android.presentation.screens

import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.SystemUpdate
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.chainlesschain.android.update.UpdateInstaller
import com.chainlesschain.android.update.UpdateViewModel

/**
 * 更新对话框 —— 调用方放在 Composable 树里，绑定 [UpdateViewModel]
 * 状态变化驱动显示。silent 检查无更新时不弹窗。
 */
@Composable
fun UpdateDialog(viewModel: UpdateViewModel) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val download by viewModel.installerProgress.collectAsStateWithLifecycle()
    val context = LocalContext.current

    when (val s = state) {
        is UpdateViewModel.UpdateState.Checking -> {
            AlertDialog(
                onDismissRequest = { viewModel.dismiss() },
                icon = { CircularProgressIndicator(modifier = Modifier.padding(8.dp)) },
                title = { Text("正在检查更新") },
                text = { Text("查询 GitHub Releases，请稍候...") },
                confirmButton = { /* none */ },
                dismissButton = {
                    TextButton(onClick = { viewModel.dismiss() }) { Text("取消") }
                }
            )
        }
        is UpdateViewModel.UpdateState.Available -> {
            val u = s.update
            val isDownloading = download is UpdateInstaller.DownloadProgress.Downloading
            AlertDialog(
                onDismissRequest = { if (!isDownloading) viewModel.dismiss() },
                icon = {
                    Icon(
                        Icons.Default.SystemUpdate,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary
                    )
                },
                title = { Text("发现新版本 v${u.versionName}") },
                text = {
                    Column(modifier = Modifier.fillMaxWidth()) {
                        Text(
                            text = "${u.apkName} (${humanSize(u.sizeBytes)})",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Spacer(Modifier.height(12.dp))
                        if (u.changelog.isNotBlank()) {
                            Text(
                                text = "更新内容",
                                style = MaterialTheme.typography.titleSmall,
                                fontWeight = FontWeight.SemiBold
                            )
                            Spacer(Modifier.height(4.dp))
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .heightIn(max = 240.dp)
                                    .verticalScroll(rememberScrollState())
                            ) {
                                Text(
                                    text = u.changelog.trim(),
                                    style = MaterialTheme.typography.bodyMedium
                                )
                            }
                        }
                        if (download is UpdateInstaller.DownloadProgress.Downloading) {
                            Spacer(Modifier.height(12.dp))
                            LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                            Text(
                                text = "下载已开始，进度可在系统通知栏查看",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        if (download is UpdateInstaller.DownloadProgress.Error) {
                            Spacer(Modifier.height(8.dp))
                            Text(
                                text = (download as UpdateInstaller.DownloadProgress.Error).message,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.error
                            )
                        }
                    }
                },
                confirmButton = {
                    if (!isDownloading) {
                        Button(onClick = {
                            if (!viewModel.installerCanInstall()) {
                                // 跳系统设置开"安装未知来源 app"
                                val pkg = context.packageName
                                val intent = Intent(
                                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                    Uri.parse("package:$pkg")
                                ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                                runCatching { context.startActivity(intent) }
                            } else {
                                viewModel.confirmDownload()
                            }
                        }) {
                            Text(if (viewModel.installerCanInstall()) "下载安装" else "授权安装权限")
                        }
                    }
                },
                dismissButton = {
                    TextButton(onClick = { viewModel.dismiss() }) {
                        Text(if (isDownloading) "关闭" else "稍后")
                    }
                }
            )
        }
        is UpdateViewModel.UpdateState.UpToDate -> {
            if (!s.silent) {
                AlertDialog(
                    onDismissRequest = { viewModel.dismiss() },
                    title = { Text("已是最新版本") },
                    text = { Text("当前版本已经是最新发布版。") },
                    confirmButton = {
                        TextButton(onClick = { viewModel.dismiss() }) { Text("确定") }
                    }
                )
            } else {
                viewModel.dismiss()
            }
        }
        is UpdateViewModel.UpdateState.Error -> {
            AlertDialog(
                onDismissRequest = { viewModel.dismiss() },
                title = { Text("检查更新失败") },
                text = { Text(s.message) },
                confirmButton = {
                    TextButton(onClick = { viewModel.dismiss() }) { Text("确定") }
                }
            )
        }
        UpdateViewModel.UpdateState.Idle -> Unit
    }
}

private fun humanSize(bytes: Long): String {
    if (bytes <= 0) return "未知大小"
    val mb = bytes / 1024.0 / 1024.0
    return "%.1f MB".format(mb)
}

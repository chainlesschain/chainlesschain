package com.chainlesschain.android.remote.ui.personalDataHub

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * 三道锁卡片 — 镜像推文 §"三道锁，缺一不可"。
 *
 *  - 第一把：加密金库（永远 on，无 toggle，仅状态显示）
 *  - 第二把：默认拒云开关（Switch，默认 OFF）
 *  - 第三把：一键销毁（Button + 二次确认 AlertDialog）
 *
 * Export ("一键带走") 已接通加密 vault 导出；按钮会写入应用导出目录，
 * 桌面端可通过 `cc hub import-vault` 恢复。
 */
@Composable
fun ThreeLocksCard(
    state: HubLocalViewModel.ThreeLocksState,
    globalBusy: Boolean,
    onAllowCloudChanged: (Boolean) -> Unit,
    onDestroyConfirmed: () -> Unit,
    onClearDestroyError: () -> Unit,
    onExportRequested: () -> Unit,
    onClearExportError: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var showDestroyDialog by remember { mutableStateOf(false) }

    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant,
        ),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(
                "三道锁",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                "推文承诺：加密、拒云、可销毁，缺一不可。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            // 第一把：加密金库
            Spacer(Modifier.height(16.dp))
            LockRow(
                emoji = "🔐",
                title = "金库本身加密",
                detail = "SQLCipher AES-256-GCM — 手机丢了也打不开里面是什么",
                trailing = {
                    Text(
                        "已开",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.primary,
                        fontWeight = FontWeight.SemiBold,
                    )
                },
            )

            // 第二把：拒云开关
            Spacer(Modifier.height(12.dp))
            LockRow(
                emoji = "🛡️",
                title = "默认不许问云端",
                detail = if (state.allowCloudFallback)
                    "允许在本地数据不足时使用云端 AI 兜底（每次会再次确认）"
                else
                    "推理完全在本机，云端 AI 看不到你的数据（默认）",
                trailing = {
                    Switch(
                        checked = state.allowCloudFallback,
                        onCheckedChange = onAllowCloudChanged,
                    )
                },
            )

            // 第三把：一键销毁
            Spacer(Modifier.height(12.dp))
            LockRow(
                emoji = "💣",
                title = "随时能销毁",
                detail = if (state.lastDestroyedAt != null)
                    "上次销毁：${formatDestroyTime(state.lastDestroyedAt)}"
                else
                    "一键清空金库 + 销毁密钥 — 不留痕迹，不假删",
                trailing = {
                    OutlinedButton(
                        onClick = { showDestroyDialog = true },
                        enabled = !state.destroying && !globalBusy,
                    ) {
                        if (state.destroying) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(14.dp),
                                strokeWidth = 2.dp,
                            )
                            Spacer(Modifier.size(6.dp))
                            Text("销毁中…")
                        } else {
                            Text("销毁")
                        }
                    }
                },
            )

            // 一键带走 (推文 §一键带走) — D11 v0.1: 导到 app external-files-dir，
            // 用户用 File Manager 拿走。SAF picker 留 v0.2 polish。
            Spacer(Modifier.height(12.dp))
            LockRow(
                emoji = "📤",
                title = "一键带走",
                detail = state.lastExportPath?.let { p ->
                    "上次导出：${p.substringAfterLast('/')} (${(state.lastExportBytes / 1024)} KB) — 用 File Manager 拿走"
                } ?: "导出加密金库到 /Android/data/<pkg>/files/exports/，桌面端可 reimport",
                trailing = {
                    OutlinedButton(
                        onClick = onExportRequested,
                        enabled = !state.exporting && !globalBusy,
                    ) {
                        if (state.exporting) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(14.dp),
                                strokeWidth = 2.dp,
                            )
                            Spacer(Modifier.size(6.dp))
                            Text("导出中…")
                        } else {
                            Text("导出")
                        }
                    }
                },
            )

            // 销毁报错
            state.destroyError?.let { err ->
                Spacer(Modifier.height(12.dp))
                Surface(
                    color = MaterialTheme.colorScheme.errorContainer,
                    shape = RoundedCornerShape(8.dp),
                ) {
                    Row(modifier = Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            err,
                            modifier = Modifier.fillMaxWidth(0.85f),
                            color = MaterialTheme.colorScheme.onErrorContainer,
                            style = MaterialTheme.typography.bodySmall,
                        )
                        TextButton(onClick = onClearDestroyError) { Text("知道了") }
                    }
                }
            }

            // 导出报错
            state.exportError?.let { err ->
                Spacer(Modifier.height(12.dp))
                Surface(
                    color = MaterialTheme.colorScheme.errorContainer,
                    shape = RoundedCornerShape(8.dp),
                ) {
                    Row(modifier = Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            err,
                            modifier = Modifier.fillMaxWidth(0.85f),
                            color = MaterialTheme.colorScheme.onErrorContainer,
                            style = MaterialTheme.typography.bodySmall,
                        )
                        TextButton(onClick = onClearExportError) { Text("知道了") }
                    }
                }
            }
        }
    }

    if (showDestroyDialog) {
        AlertDialog(
            onDismissRequest = { showDestroyDialog = false },
            title = { Text("销毁本机金库？") },
            text = {
                Text(
                    "这将彻底清空本机数据库 (vault.db + WAL) 与密钥文件。" +
                        "不可恢复，下次启动需要重新采集所有 adapter。" +
                        "继续？"
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        showDestroyDialog = false
                        onDestroyConfirmed()
                    },
                ) {
                    Text("确认销毁", color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(onClick = { showDestroyDialog = false }) { Text("取消") }
            },
        )
    }
}

@Composable
private fun LockRow(
    emoji: String,
    title: String,
    detail: String,
    trailing: @Composable () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.fillMaxWidth(0.66f)) {
            Text(
                "$emoji  $title",
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
            )
            Spacer(Modifier.height(2.dp))
            Text(
                detail,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        trailing()
    }
}

private val destroyFormatter = SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.getDefault())
private fun formatDestroyTime(epochMs: Long): String = destroyFormatter.format(Date(epochMs))

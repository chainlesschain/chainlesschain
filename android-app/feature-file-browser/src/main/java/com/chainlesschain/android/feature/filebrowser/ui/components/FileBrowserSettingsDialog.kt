package com.chainlesschain.android.feature.filebrowser.ui.components

import android.content.Context
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.chainlesschain.android.feature.filebrowser.R
import androidx.compose.ui.window.Dialog
import com.chainlesschain.android.feature.filebrowser.worker.FileScanWorkManager

/**
 * 文件浏览器设置对话框
 *
 * 功能:
 * - 自动扫描开关
 * - 扫描频率设置
 * - 缓存管理
 * - 统计信息显示
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FileBrowserSettingsDialog(
    onDismiss: () -> Unit,
    onClearCache: () -> Unit
) {
    val context = LocalContext.current
    val preferences = remember {
        context.getSharedPreferences("file_browser_settings", Context.MODE_PRIVATE)
    }

    var autoScanEnabled by remember {
        mutableStateOf(preferences.getBoolean("auto_scan_enabled", false))
    }

    var scanOnWifiOnly by remember {
        mutableStateOf(preferences.getBoolean("scan_wifi_only", true))
    }

    var scanOnChargingOnly by remember {
        mutableStateOf(preferences.getBoolean("scan_charging_only", true))
    }

    Dialog(onDismissRequest = onDismiss) {
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .wrapContentHeight(),
            shape = MaterialTheme.shapes.large,
            color = MaterialTheme.colorScheme.surface
        ) {
            Column(
                modifier = Modifier.padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                // 标题
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = stringResource(R.string.settings_dialog_title),
                        style = MaterialTheme.typography.headlineSmall,
                        color = MaterialTheme.colorScheme.onSurface
                    )

                    IconButton(onClick = onDismiss) {
                        Icon(Icons.Default.Close, contentDescription = stringResource(R.string.settings_close))
                    }
                }

                Divider()

                // 自动扫描设置
                Text(
                    text = stringResource(R.string.settings_auto_scan_section),
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.primary
                )

                SettingSwitchItem(
                    icon = Icons.Default.Autorenew,
                    title = stringResource(R.string.settings_auto_scan_enable),
                    description = stringResource(R.string.settings_auto_scan_desc),
                    checked = autoScanEnabled,
                    onCheckedChange = { enabled ->
                        autoScanEnabled = enabled
                        preferences.edit().putBoolean("auto_scan_enabled", enabled).apply()

                        if (enabled) {
                            FileScanWorkManager.enableAutoScan(context)
                        } else {
                            FileScanWorkManager.disableAutoScan(context)
                        }
                    }
                )

                if (autoScanEnabled) {
                    SettingSwitchItem(
                        icon = Icons.Default.Wifi,
                        title = stringResource(R.string.settings_wifi_only),
                        description = stringResource(R.string.settings_wifi_only_desc),
                        checked = scanOnWifiOnly,
                        onCheckedChange = { enabled ->
                            scanOnWifiOnly = enabled
                            preferences.edit().putBoolean("scan_wifi_only", enabled).apply()
                            // 重新调度Worker以更新约束条件
                            if (autoScanEnabled) {
                                FileScanWorkManager.disableAutoScan(context)
                                FileScanWorkManager.enableAutoScan(context)
                            }
                        }
                    )

                    SettingSwitchItem(
                        icon = Icons.Default.BatteryChargingFull,
                        title = stringResource(R.string.settings_charging_only),
                        description = stringResource(R.string.settings_charging_only_desc),
                        checked = scanOnChargingOnly,
                        onCheckedChange = { enabled ->
                            scanOnChargingOnly = enabled
                            preferences.edit().putBoolean("scan_charging_only", enabled).apply()
                            // 重新调度Worker以更新约束条件
                            if (autoScanEnabled) {
                                FileScanWorkManager.disableAutoScan(context)
                                FileScanWorkManager.enableAutoScan(context)
                            }
                        }
                    )
                }

                Divider()

                // 缓存管理
                Text(
                    text = stringResource(R.string.settings_cache_section),
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.primary
                )

                OutlinedButton(
                    onClick = {
                        onClearCache()
                        onDismiss()
                    },
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Icon(
                        imageVector = Icons.Default.Delete,
                        contentDescription = null,
                        modifier = Modifier.size(20.dp)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(stringResource(R.string.settings_clear_file_cache))
                }

                Text(
                    text = stringResource(R.string.settings_clear_cache_note),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )

                Divider()

                // 说明信息
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.3f),
                    shape = MaterialTheme.shapes.medium
                ) {
                    Row(
                        modifier = Modifier.padding(12.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Info,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.size(20.dp)
                        )
                        Text(
                            text = stringResource(R.string.settings_auto_scan_note),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurface
                        )
                    }
                }

                // 关闭按钮
                Button(
                    onClick = onDismiss,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(stringResource(R.string.settings_done))
                }
            }
        }
    }
}

/**
 * 设置开关项
 */
@Composable
private fun SettingSwitchItem(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    description: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f),
        shape = MaterialTheme.shapes.medium
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(
                modifier = Modifier.weight(1f),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    imageVector = icon,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(24.dp)
                )

                Column(
                    verticalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Text(
                        text = title,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                    Text(
                        text = description,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            Switch(
                checked = checked,
                onCheckedChange = onCheckedChange
            )
        }
    }
}

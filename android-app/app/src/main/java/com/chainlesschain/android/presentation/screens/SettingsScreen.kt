package com.chainlesschain.android.presentation.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Help
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.chainlesschain.android.R
import com.chainlesschain.android.config.ThemeMode
import kotlinx.coroutines.launch

/**
 * 设置页面
 * 应用通用设置、安全设置、存储管理等
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    onNavigateBack: () -> Unit,
    onNavigateToAbout: () -> Unit = {},
    onNavigateToHelpFeedback: () -> Unit = {},
    currentThemeMode: ThemeMode = ThemeMode.SYSTEM,
    onThemeModeChanged: (ThemeMode) -> Unit = {}
) {
    val darkModeEnabled = currentThemeMode == ThemeMode.DARK
    var notificationsEnabled by remember { mutableStateOf(true) }
    var biometricEnabled by remember { mutableStateOf(false) }
    var autoSaveEnabled by remember { mutableStateOf(true) }
    var showClearCacheDialog by remember { mutableStateOf(false) }
    var showLanguageDialog by remember { mutableStateOf(false) }
    var showPinDialog by remember { mutableStateOf(false) }
    var showDataManagementSheet by remember { mutableStateOf(false) }
    var showSignalingDialog by remember { mutableStateOf(false) }

    // 信令服务器配置 (与 SignalingConfig 使用相同的 SharedPreferences)
    val context = LocalContext.current
    var selectedLanguage by remember { mutableStateOf(context.getString(R.string.settings_language_zh_cn)) }
    val scope = rememberCoroutineScope()
    val snackbarHostState = remember { SnackbarHostState() }
    val prefs = context.getSharedPreferences("signaling_prefs", android.content.Context.MODE_PRIVATE)
    var signalingServerUrl by remember {
        mutableStateOf(prefs.getString("custom_signaling_url", "ws://192.168.1.1:9001") ?: "ws://192.168.1.1:9001")
    }
    var signalingTestStatus by remember { mutableStateOf("") }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.settings_title), fontWeight = FontWeight.Bold) },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.common_back))
                    }
                }
            )
        },
        snackbarHost = { SnackbarHost(hostState = snackbarHostState) }
    ) { paddingValues ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // 通用设置
            item {
                Text(
                    text = stringResource(R.string.settings_section_general),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.primary
                )
            }

            item {
                SettingsToggleItem(
                    icon = Icons.Default.DarkMode,
                    title = stringResource(R.string.settings_dark_mode),
                    subtitle = if (darkModeEnabled) stringResource(R.string.settings_dark_mode_enabled) else stringResource(R.string.settings_dark_mode_follow_system),
                    checked = darkModeEnabled,
                    onCheckedChange = { enabled ->
                        onThemeModeChanged(if (enabled) ThemeMode.DARK else ThemeMode.SYSTEM)
                    }
                )
            }

            item {
                SettingsToggleItem(
                    icon = Icons.Default.Notifications,
                    title = stringResource(R.string.settings_notifications),
                    subtitle = stringResource(R.string.settings_notifications_desc),
                    checked = notificationsEnabled,
                    onCheckedChange = { notificationsEnabled = it }
                )
            }

            item {
                SettingsToggleItem(
                    icon = Icons.Default.Save,
                    title = stringResource(R.string.settings_auto_save),
                    subtitle = stringResource(R.string.settings_auto_save_desc),
                    checked = autoSaveEnabled,
                    onCheckedChange = { autoSaveEnabled = it }
                )
            }

            item {
                SettingsNavigationItem(
                    icon = Icons.Default.Language,
                    title = stringResource(R.string.settings_language),
                    subtitle = stringResource(R.string.settings_language_zh_cn),
                    onClick = { showLanguageDialog = true }
                )
            }

            // 网络设置
            item {
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = stringResource(R.string.settings_section_network),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.primary
                )
            }

            item {
                SettingsNavigationItem(
                    icon = Icons.Default.Wifi,
                    title = stringResource(R.string.settings_signaling_server),
                    subtitle = signalingServerUrl,
                    onClick = { showSignalingDialog = true }
                )
            }

            // 安全设置
            item {
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = stringResource(R.string.settings_section_security),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.primary
                )
            }

            item {
                SettingsToggleItem(
                    icon = Icons.Default.Fingerprint,
                    title = stringResource(R.string.settings_biometric),
                    subtitle = stringResource(R.string.settings_biometric_desc),
                    checked = biometricEnabled,
                    onCheckedChange = { biometricEnabled = it }
                )
            }

            item {
                SettingsNavigationItem(
                    icon = Icons.Default.Lock,
                    title = stringResource(R.string.settings_change_pin),
                    subtitle = stringResource(R.string.settings_change_pin_desc),
                    onClick = { showPinDialog = true }
                )
            }

            item {
                SettingsNavigationItem(
                    icon = Icons.Default.Key,
                    title = stringResource(R.string.settings_key_management),
                    subtitle = stringResource(R.string.settings_key_management_desc),
                    onClick = {
                        scope.launch { snackbarHostState.showSnackbar(context.getString(R.string.common_feature_in_development)) }
                    }
                )
            }

            // 存储设置
            item {
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = stringResource(R.string.settings_section_storage),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.primary
                )
            }

            item {
                SettingsNavigationItem(
                    icon = Icons.Default.CleaningServices,
                    title = stringResource(R.string.settings_clear_cache),
                    subtitle = stringResource(R.string.settings_clear_cache_desc),
                    onClick = { showClearCacheDialog = true }
                )
            }

            item {
                SettingsNavigationItem(
                    icon = Icons.Default.Storage,
                    title = stringResource(R.string.settings_data_management),
                    subtitle = stringResource(R.string.settings_data_management_desc),
                    onClick = { showDataManagementSheet = true }
                )
            }

            // 其他
            item {
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = stringResource(R.string.settings_section_other),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.primary
                )
            }

            item {
                SettingsNavigationItem(
                    icon = Icons.Default.Info,
                    title = stringResource(R.string.settings_about),
                    subtitle = stringResource(R.string.settings_about_desc),
                    onClick = onNavigateToAbout
                )
            }

            item {
                SettingsNavigationItem(
                    icon = Icons.AutoMirrored.Filled.Help,
                    title = stringResource(R.string.settings_help_feedback),
                    subtitle = stringResource(R.string.settings_help_feedback_desc),
                    onClick = onNavigateToHelpFeedback
                )
            }
        }
    }

    // 清除缓存确认对话框
    if (showClearCacheDialog) {
        AlertDialog(
            onDismissRequest = { showClearCacheDialog = false },
            title = { Text(stringResource(R.string.settings_clear_cache_dialog_title)) },
            text = { Text(stringResource(R.string.settings_clear_cache_dialog_msg)) },
            confirmButton = {
                TextButton(
                    onClick = {
                        context.cacheDir.deleteRecursively()
                        showClearCacheDialog = false
                        scope.launch { snackbarHostState.showSnackbar(context.getString(R.string.settings_cache_cleared)) }
                    }
                ) {
                    Text(stringResource(R.string.common_confirm))
                }
            },
            dismissButton = {
                TextButton(onClick = { showClearCacheDialog = false }) {
                    Text(stringResource(R.string.common_cancel))
                }
            }
        )
    }

    // 语言选择对话框
    if (showLanguageDialog) {
        AlertDialog(
            onDismissRequest = { showLanguageDialog = false },
            title = { Text(stringResource(R.string.settings_select_language)) },
            text = {
                Column {
                    listOf(stringResource(R.string.settings_language_zh_cn), "English").forEach { lang ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            RadioButton(
                                selected = selectedLanguage == lang,
                                onClick = { selectedLanguage = lang }
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(lang)
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    showLanguageDialog = false
                    scope.launch { snackbarHostState.showSnackbar(context.getString(R.string.settings_language_set_to, selectedLanguage)) }
                }) { Text(stringResource(R.string.common_confirm)) }
            },
            dismissButton = {
                TextButton(onClick = { showLanguageDialog = false }) { Text(stringResource(R.string.common_cancel)) }
            }
        )
    }

    // 修改PIN码对话框
    if (showPinDialog) {
        var oldPin by remember { mutableStateOf("") }
        var newPin by remember { mutableStateOf("") }
        var confirmPin by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { showPinDialog = false },
            title = { Text(stringResource(R.string.settings_change_pin_dialog_title)) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    OutlinedTextField(
                        value = oldPin,
                        onValueChange = { oldPin = it },
                        label = { Text(stringResource(R.string.settings_current_pin)) },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedTextField(
                        value = newPin,
                        onValueChange = { newPin = it },
                        label = { Text(stringResource(R.string.settings_new_pin)) },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedTextField(
                        value = confirmPin,
                        onValueChange = { confirmPin = it },
                        label = { Text(stringResource(R.string.settings_confirm_new_pin)) },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    showPinDialog = false
                    scope.launch {
                        if (newPin == confirmPin && newPin.isNotBlank()) {
                            snackbarHostState.showSnackbar(context.getString(R.string.settings_pin_changed))
                        } else {
                            snackbarHostState.showSnackbar(context.getString(R.string.settings_pin_mismatch))
                        }
                    }
                }) { Text(stringResource(R.string.common_confirm)) }
            },
            dismissButton = {
                TextButton(onClick = { showPinDialog = false }) { Text(stringResource(R.string.common_cancel)) }
            }
        )
    }

    // 数据管理底部弹窗
    if (showDataManagementSheet) {
        AlertDialog(
            onDismissRequest = { showDataManagementSheet = false },
            title = { Text(stringResource(R.string.settings_data_management_dialog_title)) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    TextButton(
                        onClick = {
                            showDataManagementSheet = false
                            scope.launch { snackbarHostState.showSnackbar(context.getString(R.string.settings_export_in_development)) }
                        },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Icon(Icons.Default.Upload, null)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(stringResource(R.string.settings_export_data))
                    }
                    TextButton(
                        onClick = {
                            showDataManagementSheet = false
                            scope.launch { snackbarHostState.showSnackbar(context.getString(R.string.settings_backup_in_development)) }
                        },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Icon(Icons.Default.Backup, null)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(stringResource(R.string.settings_backup_data))
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { showDataManagementSheet = false }) { Text(stringResource(R.string.common_close)) }
            }
        )
    }

    // 信令服务器配置对话框
    if (showSignalingDialog) {
        var tempUrl by remember { mutableStateOf(signalingServerUrl) }
        var isTesting by remember { mutableStateOf(false) }

        AlertDialog(
            onDismissRequest = { showSignalingDialog = false },
            title = { Text(stringResource(R.string.settings_signaling_dialog_title)) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(
                        text = stringResource(R.string.settings_signaling_format_hint),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    OutlinedTextField(
                        value = tempUrl,
                        onValueChange = { tempUrl = it },
                        label = { Text(stringResource(R.string.settings_server_address)) },
                        placeholder = { Text("ws://192.168.x.x:9001") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )

                    // 测试连接按钮
                    OutlinedButton(
                        onClick = {
                            isTesting = true
                            signalingTestStatus = context.getString(R.string.settings_testing_connection)
                            scope.launch {
                                try {
                                    // 简单的 WebSocket 连接测试
                                    val uri = java.net.URI(tempUrl)
                                    val host = uri.host
                                    val port = if (uri.port > 0) uri.port else 9001
                                    java.net.Socket().use { socket ->
                                        socket.connect(java.net.InetSocketAddress(host, port), 5000)
                                    }
                                    signalingTestStatus = context.getString(R.string.settings_connection_ok)
                                } catch (e: Exception) {
                                    signalingTestStatus = context.getString(R.string.settings_connection_fail, e.message ?: "")
                                } finally {
                                    isTesting = false
                                }
                            }
                        },
                        enabled = !isTesting && tempUrl.isNotBlank(),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        if (isTesting) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(16.dp),
                                strokeWidth = 2.dp
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                        }
                        Text(if (isTesting) stringResource(R.string.common_testing) else stringResource(R.string.settings_test_connection))
                    }

                    // 测试状态
                    if (signalingTestStatus.isNotBlank()) {
                        Text(
                            text = signalingTestStatus,
                            style = MaterialTheme.typography.bodySmall,
                            color = if (signalingTestStatus.startsWith("✓"))
                                MaterialTheme.colorScheme.primary
                            else if (signalingTestStatus.startsWith("✗"))
                                MaterialTheme.colorScheme.error
                            else
                                MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        // 保存到 SharedPreferences
                        prefs.edit().putString("custom_signaling_url", tempUrl).apply()
                        signalingServerUrl = tempUrl
                        showSignalingDialog = false
                        scope.launch { snackbarHostState.showSnackbar(context.getString(R.string.settings_signaling_saved)) }
                    }
                ) { Text(stringResource(R.string.common_save)) }
            },
            dismissButton = {
                TextButton(onClick = { showSignalingDialog = false }) { Text(stringResource(R.string.common_cancel)) }
            }
        )
    }
}

/**
 * 带开关的设置项
 */
@Composable
fun SettingsToggleItem(
    icon: ImageVector,
    title: String,
    subtitle: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant
        ),
        shape = RoundedCornerShape(12.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier.weight(1f)
            ) {
                Box(
                    modifier = Modifier
                        .size(40.dp)
                        .clip(CircleShape)
                        .background(MaterialTheme.colorScheme.primaryContainer),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = icon,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onPrimaryContainer,
                        modifier = Modifier.size(20.dp)
                    )
                }

                Column {
                    Text(
                        text = title,
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Medium
                    )
                    Text(
                        text = subtitle,
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

/**
 * 可点击导航的设置项
 */
@Composable
fun SettingsNavigationItem(
    icon: ImageVector,
    title: String,
    subtitle: String,
    onClick: () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        onClick = onClick,
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant
        ),
        shape = RoundedCornerShape(12.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier.weight(1f)
            ) {
                Box(
                    modifier = Modifier
                        .size(40.dp)
                        .clip(CircleShape)
                        .background(MaterialTheme.colorScheme.primaryContainer),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = icon,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onPrimaryContainer,
                        modifier = Modifier.size(20.dp)
                    )
                }

                Column {
                    Text(
                        text = title,
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Medium
                    )
                    Text(
                        text = subtitle,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            Icon(
                imageVector = Icons.Default.ChevronRight,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

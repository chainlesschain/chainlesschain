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
import androidx.compose.ui.unit.dp
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
    onNavigateToHelpFeedback: () -> Unit = {}
) {
    var darkModeEnabled by remember { mutableStateOf(false) }
    var notificationsEnabled by remember { mutableStateOf(true) }
    var biometricEnabled by remember { mutableStateOf(false) }
    var autoSaveEnabled by remember { mutableStateOf(true) }
    var showClearCacheDialog by remember { mutableStateOf(false) }
    var showLanguageDialog by remember { mutableStateOf(false) }
    var showPinDialog by remember { mutableStateOf(false) }
    var showDataManagementSheet by remember { mutableStateOf(false) }
    var selectedLanguage by remember { mutableStateOf("简体中文") }
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val context = androidx.compose.ui.platform.LocalContext.current

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("设置", fontWeight = FontWeight.Bold) },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
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
                    text = "通用",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.primary
                )
            }

            item {
                SettingsToggleItem(
                    icon = Icons.Default.DarkMode,
                    title = "深色模式",
                    subtitle = "使用深色主题界面",
                    checked = darkModeEnabled,
                    onCheckedChange = { darkModeEnabled = it }
                )
            }

            item {
                SettingsToggleItem(
                    icon = Icons.Default.Notifications,
                    title = "消息通知",
                    subtitle = "接收消息和系统通知",
                    checked = notificationsEnabled,
                    onCheckedChange = { notificationsEnabled = it }
                )
            }

            item {
                SettingsToggleItem(
                    icon = Icons.Default.Save,
                    title = "自动保存",
                    subtitle = "自动保存编辑内容",
                    checked = autoSaveEnabled,
                    onCheckedChange = { autoSaveEnabled = it }
                )
            }

            item {
                SettingsNavigationItem(
                    icon = Icons.Default.Language,
                    title = "语言",
                    subtitle = "简体中文",
                    onClick = { showLanguageDialog = true }
                )
            }

            // 安全设置
            item {
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = "安全",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.primary
                )
            }

            item {
                SettingsToggleItem(
                    icon = Icons.Default.Fingerprint,
                    title = "生物识别",
                    subtitle = "使用指纹或面部识别解锁",
                    checked = biometricEnabled,
                    onCheckedChange = { biometricEnabled = it }
                )
            }

            item {
                SettingsNavigationItem(
                    icon = Icons.Default.Lock,
                    title = "修改PIN码",
                    subtitle = "更改应用解锁密码",
                    onClick = { showPinDialog = true }
                )
            }

            item {
                SettingsNavigationItem(
                    icon = Icons.Default.Key,
                    title = "密钥管理",
                    subtitle = "管理加密密钥和DID身份",
                    onClick = {
                        scope.launch { snackbarHostState.showSnackbar("功能开发中") }
                    }
                )
            }

            // 存储设置
            item {
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = "存储",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.primary
                )
            }

            item {
                SettingsNavigationItem(
                    icon = Icons.Default.CleaningServices,
                    title = "清除缓存",
                    subtitle = "释放临时文件占用的空间",
                    onClick = { showClearCacheDialog = true }
                )
            }

            item {
                SettingsNavigationItem(
                    icon = Icons.Default.Storage,
                    title = "数据管理",
                    subtitle = "导出或备份个人数据",
                    onClick = { showDataManagementSheet = true }
                )
            }

            // 其他
            item {
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = "其他",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.primary
                )
            }

            item {
                SettingsNavigationItem(
                    icon = Icons.Default.Info,
                    title = "关于",
                    subtitle = "应用版本和信息",
                    onClick = onNavigateToAbout
                )
            }

            item {
                SettingsNavigationItem(
                    icon = Icons.AutoMirrored.Filled.Help,
                    title = "帮助与反馈",
                    subtitle = "获取帮助或提交反馈",
                    onClick = onNavigateToHelpFeedback
                )
            }
        }
    }

    // 清除缓存确认对话框
    if (showClearCacheDialog) {
        AlertDialog(
            onDismissRequest = { showClearCacheDialog = false },
            title = { Text("清除缓存") },
            text = { Text("确定要清除所有缓存数据吗？此操作不会影响您的个人数据。") },
            confirmButton = {
                TextButton(
                    onClick = {
                        context.cacheDir.deleteRecursively()
                        showClearCacheDialog = false
                        scope.launch { snackbarHostState.showSnackbar("缓存已清除") }
                    }
                ) {
                    Text("确定")
                }
            },
            dismissButton = {
                TextButton(onClick = { showClearCacheDialog = false }) {
                    Text("取消")
                }
            }
        )
    }

    // 语言选择对话框
    if (showLanguageDialog) {
        AlertDialog(
            onDismissRequest = { showLanguageDialog = false },
            title = { Text("选择语言") },
            text = {
                Column {
                    listOf("简体中文", "English").forEach { lang ->
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
                    scope.launch { snackbarHostState.showSnackbar("语言已设置为 $selectedLanguage") }
                }) { Text("确定") }
            },
            dismissButton = {
                TextButton(onClick = { showLanguageDialog = false }) { Text("取消") }
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
            title = { Text("修改PIN码") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    OutlinedTextField(
                        value = oldPin,
                        onValueChange = { oldPin = it },
                        label = { Text("当前PIN码") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedTextField(
                        value = newPin,
                        onValueChange = { newPin = it },
                        label = { Text("新PIN码") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedTextField(
                        value = confirmPin,
                        onValueChange = { confirmPin = it },
                        label = { Text("确认新PIN码") },
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
                            snackbarHostState.showSnackbar("PIN码修改成功")
                        } else {
                            snackbarHostState.showSnackbar("两次输入的PIN码不一致")
                        }
                    }
                }) { Text("确定") }
            },
            dismissButton = {
                TextButton(onClick = { showPinDialog = false }) { Text("取消") }
            }
        )
    }

    // 数据管理底部弹窗
    if (showDataManagementSheet) {
        AlertDialog(
            onDismissRequest = { showDataManagementSheet = false },
            title = { Text("数据管理") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    TextButton(
                        onClick = {
                            showDataManagementSheet = false
                            scope.launch { snackbarHostState.showSnackbar("数据导出功能开发中") }
                        },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Icon(Icons.Default.Upload, null)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("导出数据")
                    }
                    TextButton(
                        onClick = {
                            showDataManagementSheet = false
                            scope.launch { snackbarHostState.showSnackbar("数据备份功能开发中") }
                        },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Icon(Icons.Default.Backup, null)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("备份数据")
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { showDataManagementSheet = false }) { Text("关闭") }
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

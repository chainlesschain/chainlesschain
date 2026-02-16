package com.chainlesschain.android.presentation.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.res.stringResource
import com.chainlesschain.android.R
import com.chainlesschain.android.feature.auth.presentation.AuthViewModel

/**
 * 我的页面
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProfileScreen(
    onLogout: () -> Unit,
    onNavigateToLLMSettings: () -> Unit = {},
    onNavigateToUsageStatistics: () -> Unit = {},
    onNavigateToKnowledgeList: () -> Unit = {},
    onNavigateToAIChat: () -> Unit = {},
    onNavigateToP2P: () -> Unit = {},
    onNavigateToSettings: () -> Unit = {},
    onNavigateToAbout: () -> Unit = {},
    onNavigateToHelpFeedback: () -> Unit = {},
    onNavigateToBookmark: () -> Unit = {},
    viewModel: AuthViewModel
) {
    val uiState by viewModel.uiState.collectAsState()
    var showLogoutDialog by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.surface)
    ) {
        // 顶部栏
        TopAppBar(
            title = { Text(stringResource(R.string.profile_tab), fontWeight = FontWeight.Bold) }
        )

        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // 用户信息卡片
            item {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.primaryContainer
                    )
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(20.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        // 头像
                        Box(
                            modifier = Modifier
                                .size(80.dp)
                                .clip(CircleShape)
                                .background(MaterialTheme.colorScheme.primary),
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(
                                imageVector = Icons.Default.Person,
                                contentDescription = null,
                                modifier = Modifier.size(48.dp),
                                tint = MaterialTheme.colorScheme.onPrimary
                            )
                        }

                        Spacer(modifier = Modifier.height(16.dp))

                        uiState.currentUser?.let { user ->
                            Text(
                                text = stringResource(R.string.profile_user_label, user.id.take(8)),
                                style = MaterialTheme.typography.titleLarge,
                                fontWeight = FontWeight.Bold,
                                color = MaterialTheme.colorScheme.onPrimaryContainer
                            )

                            Spacer(modifier = Modifier.height(4.dp))

                            Text(
                                text = stringResource(R.string.profile_device_id_label, user.deviceId.take(12)),
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.7f)
                            )

                            Spacer(modifier = Modifier.height(16.dp))

                            // 生物识别状态
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                Icon(
                                    imageVector = if (user.biometricEnabled) Icons.Default.CheckCircle else Icons.Default.Cancel,
                                    contentDescription = null,
                                    tint = if (user.biometricEnabled)
                                        MaterialTheme.colorScheme.tertiary
                                    else
                                        MaterialTheme.colorScheme.error,
                                    modifier = Modifier.size(20.dp)
                                )
                                Text(
                                    text = if (user.biometricEnabled) stringResource(R.string.profile_biometric_enabled) else stringResource(R.string.profile_biometric_disabled),
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onPrimaryContainer
                                )
                            }
                        }
                    }
                }
            }

            // 功能菜单
            item {
                Text(
                    text = stringResource(R.string.profile_section_features),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold
                )
            }

            item {
                ProfileMenuItem(
                    icon = Icons.Default.Book,
                    title = stringResource(R.string.profile_knowledge_base),
                    subtitle = stringResource(R.string.profile_knowledge_base_desc),
                    onClick = onNavigateToKnowledgeList
                )
            }

            item {
                ProfileMenuItem(
                    icon = Icons.Default.Chat,
                    title = stringResource(R.string.profile_ai_chat),
                    subtitle = stringResource(R.string.profile_ai_chat_desc),
                    onClick = onNavigateToAIChat
                )
            }

            item {
                ProfileMenuItem(
                    icon = Icons.Default.SmartToy,
                    title = stringResource(R.string.profile_ai_config),
                    subtitle = stringResource(R.string.profile_ai_config_desc),
                    onClick = onNavigateToLLMSettings
                )
            }

            item {
                ProfileMenuItem(
                    icon = Icons.Default.Analytics,
                    title = stringResource(R.string.profile_usage_stats),
                    subtitle = stringResource(R.string.profile_usage_stats_desc),
                    onClick = onNavigateToUsageStatistics
                )
            }

            item {
                ProfileMenuItem(
                    icon = Icons.Default.Devices,
                    title = stringResource(R.string.profile_p2p_devices),
                    subtitle = stringResource(R.string.profile_p2p_devices_desc),
                    onClick = onNavigateToP2P
                )
            }

            item {
                ProfileMenuItem(
                    icon = Icons.Default.Bookmark,
                    title = stringResource(R.string.profile_bookmarks),
                    subtitle = stringResource(R.string.profile_bookmarks_desc),
                    onClick = onNavigateToBookmark
                )
            }

            // 系统设置
            item {
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = stringResource(R.string.profile_section_system),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold
                )
            }

            item {
                ProfileMenuItem(
                    icon = Icons.Default.Settings,
                    title = stringResource(R.string.profile_settings),
                    subtitle = stringResource(R.string.profile_settings_desc),
                    onClick = onNavigateToSettings
                )
            }

            item {
                ProfileMenuItem(
                    icon = Icons.Default.Info,
                    title = stringResource(R.string.profile_about),
                    subtitle = stringResource(R.string.profile_about_desc),
                    onClick = onNavigateToAbout
                )
            }

            item {
                ProfileMenuItem(
                    icon = Icons.Default.Help,
                    title = stringResource(R.string.profile_help),
                    subtitle = stringResource(R.string.profile_help_desc),
                    onClick = onNavigateToHelpFeedback
                )
            }

            // 退出登录
            item {
                Spacer(modifier = Modifier.height(16.dp))
                OutlinedButton(
                    onClick = { showLogoutDialog = true },
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.outlinedButtonColors(
                        contentColor = MaterialTheme.colorScheme.error
                    )
                ) {
                    Icon(
                        imageVector = Icons.Default.ExitToApp,
                        contentDescription = null,
                        modifier = Modifier.size(20.dp)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(stringResource(R.string.home_logout))
                }
            }
        }
    }

    // 退出登录确认对话框
    if (showLogoutDialog) {
        AlertDialog(
            onDismissRequest = { showLogoutDialog = false },
            title = { Text(stringResource(R.string.home_logout)) },
            text = { Text(stringResource(R.string.home_logout_confirm)) },
            confirmButton = {
                TextButton(
                    onClick = {
                        viewModel.logout()
                        showLogoutDialog = false
                        onLogout()
                    }
                ) {
                    Text(stringResource(R.string.common_confirm), color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(onClick = { showLogoutDialog = false }) {
                    Text(stringResource(R.string.common_cancel))
                }
            }
        )
    }
}

/**
 * 个人资料菜单项
 */
@Composable
fun ProfileMenuItem(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    subtitle: String,
    onClick: () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        onClick = onClick,
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant
        )
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
                horizontalArrangement = Arrangement.spacedBy(16.dp),
                modifier = Modifier.weight(1f)
            ) {
                Box(
                    modifier = Modifier
                        .size(48.dp)
                        .clip(CircleShape)
                        .background(MaterialTheme.colorScheme.primaryContainer),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = icon,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onPrimaryContainer,
                        modifier = Modifier.size(24.dp)
                    )
                }

                Column {
                    Text(
                        text = title,
                        style = MaterialTheme.typography.titleMedium,
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

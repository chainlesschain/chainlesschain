package com.chainlesschain.android.feature.p2p.ui.social

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.clickable
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.clickable
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.clickable
import androidx.compose.material.icons.Icons
import androidx.compose.foundation.clickable
import androidx.compose.material.icons.filled.*
import androidx.compose.foundation.clickable
import androidx.compose.material3.*
import androidx.compose.foundation.clickable
import androidx.compose.runtime.*
import androidx.compose.foundation.clickable
import androidx.compose.ui.Alignment
import androidx.compose.foundation.clickable
import androidx.compose.ui.Modifier
import androidx.compose.foundation.clickable
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.clickable
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.core.database.entity.social.NotificationType
import com.chainlesschain.android.core.ui.components.EmptyState
import com.chainlesschain.android.core.ui.components.LoadingState
import com.chainlesschain.android.feature.p2p.ui.social.components.CompactNotificationCard
import com.chainlesschain.android.feature.p2p.ui.social.components.NotificationCard
import com.chainlesschain.android.feature.p2p.ui.social.components.NotificationTypeBadge
import com.chainlesschain.android.feature.p2p.viewmodel.social.NotificationEvent
import com.chainlesschain.android.feature.p2p.viewmodel.social.NotificationViewModel
import kotlinx.coroutines.flow.collectLatest

/**
 * 通知中心页面
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NotificationCenterScreen(
    onNavigateBack: () -> Unit,
    onNavigateToFriendRequest: (String) -> Unit,
    onNavigateToFriendProfile: (String) -> Unit,
    onNavigateToPost: (String) -> Unit,
    onNavigateToComment: (String) -> Unit,
    viewModel: NotificationViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }

    // 收集事件
    LaunchedEffect(Unit) {
        viewModel.eventFlow.collectLatest { event ->
            when (event) {
                is NotificationEvent.ShowToast -> {
                    snackbarHostState.showSnackbar(event.message)
                }
                is NotificationEvent.NavigateToFriendRequest -> {
                    onNavigateToFriendRequest(event.did)
                }
                is NotificationEvent.NavigateToFriendProfile -> {
                    onNavigateToFriendProfile(event.did)
                }
                is NotificationEvent.NavigateToPost -> {
                    onNavigateToPost(event.postId)
                }
                is NotificationEvent.NavigateToComment -> {
                    onNavigateToComment(event.commentId)
                }
            }
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { },
                actions = {
                    // 筛选菜单
                    IconButton(onClick = { viewModel.toggleFilterMenu() }) {
                        BadgedBox(
                            badge = {
                                if (uiState.selectedType != null) {
                                    Badge()
                                }
                            }
                        ) {
                            Icon(Icons.Default.FilterList, contentDescription = "筛选")
                        }
                    }

                    // 更多菜单
                    var showMenu by remember { mutableStateOf(false) }
                    Box {
                        IconButton(onClick = { showMenu = true }) {
                            Icon(Icons.Default.MoreVert, contentDescription = "更多")
                        }
                        DropdownMenu(
                            expanded = showMenu,
                            onDismissRequest = { showMenu = false }
                        ) {
                            DropdownMenuItem(
                                text = { Text("全部标记为已读") },
                                onClick = {
                                    showMenu = false
                                    viewModel.markAllAsRead()
                                },
                                leadingIcon = {
                                    Icon(Icons.Default.DoneAll, contentDescription = null)
                                }
                            )
                            DropdownMenuItem(
                                text = { Text("删除所有已读") },
                                onClick = {
                                    showMenu = false
                                    viewModel.deleteAllRead()
                                },
                                leadingIcon = {
                                    Icon(Icons.Default.DeleteSweep, contentDescription = null)
                                }
                            )
                            DropdownMenuItem(
                                text = { Text("清理旧通知") },
                                onClick = {
                                    showMenu = false
                                    viewModel.cleanupOldNotifications()
                                },
                                leadingIcon = {
                                    Icon(Icons.Default.CleaningServices, contentDescription = null)
                                }
                            )
                            Divider()
                            DropdownMenuItem(
                                text = { Text(if (uiState.showOnlyUnread) "显示全部" else "仅显示未读") },
                                onClick = {
                                    showMenu = false
                                    viewModel.toggleShowOnlyUnread()
                                },
                                leadingIcon = {
                                    Icon(
                                        if (uiState.showOnlyUnread) Icons.Default.Visibility else Icons.Default.VisibilityOff,
                                        contentDescription = null
                                    )
                                }
                            )
                        }
                    }
                }
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            // 类型筛选栏
            if (uiState.showFilterMenu) {
                Surface(
                    tonalElevation = 1.dp
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Text(
                            text = "按类型筛选",
                            style = MaterialTheme.typography.labelLarge
                        )

                        Row(
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            NotificationType.values().forEach { type ->
                                val count = uiState.unreadCountsByType[type] ?: 0
                                NotificationTypeBadge(
                                    type = type,
                                    count = count,
                                    onClick = {
                                        if (uiState.selectedType == type) {
                                            viewModel.clearTypeFilter()
                                        } else {
                                            viewModel.filterByType(type)
                                        }
                                    }
                                )
                            }
                        }

                        if (uiState.selectedType != null) {
                            TextButton(
                                onClick = { viewModel.clearTypeFilter() }
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Clear,
                                    contentDescription = null,
                                    modifier = Modifier.size(18.dp)
                                )
                                Spacer(modifier = Modifier.width(4.dp))
                                Text("清除筛选")
                            }
                        }
                    }
                }
                Divider()
            }

            // 通知列表
            when {
                uiState.isLoading -> {
                    LoadingState()
                }
                uiState.allNotifications.isEmpty() && uiState.filteredNotifications.isEmpty() -> {
                    EmptyState(
                        title = if (uiState.selectedType != null) "没有此类通知" else "暂无通知",
                        icon = Icons.Default.Notifications
                    )
                }
                else -> {
                    val notifications = if (uiState.selectedType != null) {
                        uiState.filteredNotifications
                    } else if (uiState.showOnlyUnread) {
                        uiState.unreadNotifications
                    } else {
                        uiState.allNotifications
                    }

                    LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(vertical = 8.dp)
                    ) {
                        items(
                            items = notifications,
                            key = { it.id }
                        ) { notification ->
                            NotificationCard(
                                notification = notification,
                                onClick = { viewModel.onNotificationClick(notification) },
                                onLongClick = { viewModel.onNotificationLongClick(notification) },
                                modifier = Modifier.padding(
                                    horizontal = 16.dp,
                                    vertical = 4.dp
                                )
                            )
                        }
                    }
                }
            }

            // 刷新指示器
            if (uiState.isRefreshing) {
                LinearProgressIndicator(
                    modifier = Modifier.fillMaxWidth()
                )
            }
        }
    }

    // 通知操作菜单
    if (uiState.showNotificationMenu && uiState.selectedNotification != null) {
        val notification = uiState.selectedNotification!!

        ModalBottomSheet(
            onDismissRequest = { viewModel.hideNotificationMenu() }
        ) {
            Column(
                modifier = Modifier.padding(bottom = 16.dp)
            ) {
                ListItem(
                    headlineContent = { Text(if (notification.isRead) "标记为未读" else "标记为已读") },
                    leadingContent = {
                        Icon(
                            if (notification.isRead) Icons.Default.MarkEmailUnread else Icons.Default.MarkEmailRead,
                            contentDescription = null
                        )
                    },
                    modifier = Modifier.clickable {
                        viewModel.hideNotificationMenu()
                        if (notification.isRead) {
                            viewModel.markAsUnread(notification.id)
                        } else {
                            viewModel.markAsRead(notification.id)
                        }
                    }
                )

                Divider()

                ListItem(
                    headlineContent = { Text("删除") },
                    leadingContent = { Icon(Icons.Default.Delete, contentDescription = null) },
                    modifier = Modifier.clickable {
                        viewModel.hideNotificationMenu()
                        viewModel.deleteNotification(notification.id)
                    }
                )
            }
        }
    }
}

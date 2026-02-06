package com.chainlesschain.android.feature.p2p.ui.social

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.core.ui.components.EmptyState
import com.chainlesschain.android.core.ui.components.LoadingState
import com.chainlesschain.android.feature.p2p.viewmodel.social.AddFriendEvent
import com.chainlesschain.android.feature.p2p.viewmodel.social.AddFriendViewModel
import com.chainlesschain.android.feature.p2p.viewmodel.social.UserSearchResult
import kotlinx.coroutines.flow.collectLatest

/**
 * 添加好友页面
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AddFriendScreen(
    onNavigateBack: () -> Unit,
    onNavigateToQRScanner: () -> Unit = {},
    viewModel: AddFriendViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }

    // 收集事件
    LaunchedEffect(Unit) {
        viewModel.eventFlow.collectLatest { event ->
            when (event) {
                is AddFriendEvent.ShowToast -> {
                    snackbarHostState.showSnackbar(event.message)
                }
                is AddFriendEvent.FriendRequestSent -> {
                    // 好友请求发送成功，可以选择返回或显示提示
                }
                is AddFriendEvent.NavigateToQRScanner -> {
                    // 导航到二维码扫描页面
                    onNavigateToQRScanner()
                }
            }
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("添加好友") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "返回")
                    }
                },
                actions = {
                    IconButton(onClick = { viewModel.scanQRCode() }) {
                        Icon(Icons.Default.QrCodeScanner, contentDescription = "扫描二维码")
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
            // 搜索栏
            SearchBar(
                query = uiState.searchQuery,
                onQueryChange = { viewModel.updateSearchQuery(it) },
                isSearching = uiState.isSearching,
                modifier = Modifier.fillMaxWidth()
            )

            // 内容区域
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                // 搜索结果
                if (uiState.searchQuery.isNotBlank()) {
                    if (uiState.isSearching) {
                        item {
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(vertical = 32.dp),
                                contentAlignment = Alignment.Center
                            ) {
                                CircularProgressIndicator()
                            }
                        }
                    } else if (uiState.searchResults.isEmpty()) {
                        item {
                            EmptyState(
                                title = "未找到相关用户",
                                icon = Icons.Default.PersonSearch
                            )
                        }
                    } else {
                        item {
                            Text(
                                text = "搜索结果",
                                style = MaterialTheme.typography.titleSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        items(
                            items = uiState.searchResults,
                            key = { it.did }
                        ) { user ->
                            UserSearchResultCard(
                                user = user,
                                onAddClick = { viewModel.showFriendRequestDialog(user) }
                            )
                        }
                    }
                } else {
                    // 附近的人
                    if (uiState.nearbyUsers.isNotEmpty()) {
                        item {
                            Text(
                                text = "附近的人",
                                style = MaterialTheme.typography.titleSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        items(
                            items = uiState.nearbyUsers.take(5), // 最多显示5个
                            key = { it.did }
                        ) { user ->
                            UserSearchResultCard(
                                user = user,
                                onAddClick = { viewModel.showFriendRequestDialog(user) }
                            )
                        }
                        item { Divider(modifier = Modifier.padding(vertical = 8.dp)) }
                    }

                    // 好友推荐
                    if (uiState.recommendations.isNotEmpty()) {
                        item {
                            Text(
                                text = "推荐好友",
                                style = MaterialTheme.typography.titleSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        items(
                            items = uiState.recommendations,
                            key = { it.did }
                        ) { user ->
                            UserSearchResultCard(
                                user = user,
                                onAddClick = { viewModel.showFriendRequestDialog(user) }
                            )
                        }
                    }

                    // 如果两者都为空
                    if (uiState.nearbyUsers.isEmpty() && uiState.recommendations.isEmpty()) {
                        item {
                            EmptyState(
                                title = "暂无推荐好友",
                                icon = Icons.Default.People,
                                actionText = "刷新",
                                onAction = {
                                    viewModel.loadNearbyUsers()
                                    viewModel.loadRecommendations()
                                }
                            )
                        }
                    }
                }
            }
        }
    }

    // 好友请求对话框
    val selectedUser = uiState.selectedUser
    if (uiState.showRequestDialog && selectedUser != null) {
        FriendRequestDialog(
            user = selectedUser,
            onDismiss = { viewModel.hideRequestDialog() },
            onConfirm = { message ->
                viewModel.sendFriendRequest(selectedUser.did, message)
                viewModel.hideRequestDialog()
            }
        )
    }
}

/**
 * 搜索栏组件
 */
@Composable
private fun SearchBar(
    query: String,
    onQueryChange: (String) -> Unit,
    isSearching: Boolean,
    modifier: Modifier = Modifier
) {
    OutlinedTextField(
        value = query,
        onValueChange = onQueryChange,
        modifier = modifier.padding(16.dp),
        placeholder = { Text("搜索 DID 或昵称") },
        leadingIcon = {
            Icon(Icons.Default.Search, contentDescription = null)
        },
        trailingIcon = {
            if (isSearching) {
                CircularProgressIndicator(
                    modifier = Modifier.size(24.dp),
                    strokeWidth = 2.dp
                )
            } else if (query.isNotEmpty()) {
                IconButton(onClick = { onQueryChange("") }) {
                    Icon(Icons.Default.Clear, contentDescription = "清除")
                }
            }
        },
        singleLine = true
    )
}

/**
 * 用户搜索结果卡片
 */
@Composable
private fun UserSearchResultCard(
    user: UserSearchResult,
    onAddClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    ElevatedCard(
        modifier = modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.weight(1f)
            ) {
                // 头像
                Surface(
                    modifier = Modifier.size(48.dp),
                    shape = MaterialTheme.shapes.medium,
                    color = MaterialTheme.colorScheme.primaryContainer
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(
                            imageVector = Icons.Default.Person,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.onPrimaryContainer
                        )
                    }
                }

                Column(
                    verticalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Text(
                        text = user.nickname,
                        style = MaterialTheme.typography.titleMedium
                    )
                    Text(
                        text = "DID: ${user.did.take(12)}...",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    if (user.mutualFriendCount > 0) {
                        Text(
                            text = "${user.mutualFriendCount} 位共同好友",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.primary
                        )
                    }
                    user.distance?.let { distance ->
                        Text(
                            text = "${String.format("%.1f", distance / 1000)} km",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }

            // 添加按钮
            if (user.isFriend) {
                AssistChip(
                    onClick = { },
                    label = { Text("已添加") },
                    leadingIcon = {
                        Icon(
                            Icons.Default.Check,
                            contentDescription = null,
                            modifier = Modifier.size(18.dp)
                        )
                    }
                )
            } else {
                Button(onClick = onAddClick) {
                    Icon(
                        Icons.Default.PersonAdd,
                        contentDescription = null,
                        modifier = Modifier.size(18.dp)
                    )
                    Spacer(Modifier.width(4.dp))
                    Text("添加")
                }
            }
        }
    }
}

/**
 * 好友请求对话框
 */
@Composable
private fun FriendRequestDialog(
    user: UserSearchResult,
    onDismiss: () -> Unit,
    onConfirm: (String?) -> Unit
) {
    var message by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismiss,
        icon = {
            Icon(Icons.Default.PersonAdd, contentDescription = null)
        },
        title = {
            Text("添加好友")
        },
        text = {
            Column(
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Text("向 ${user.nickname} 发送好友请求")
                OutlinedTextField(
                    value = message,
                    onValueChange = { message = it },
                    label = { Text("验证消息（可选）") },
                    placeholder = { Text("我是...") },
                    modifier = Modifier.fillMaxWidth(),
                    maxLines = 3
                )
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    onConfirm(message.ifBlank { null })
                }
            ) {
                Text("发送")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("取消")
            }
        }
    )
}

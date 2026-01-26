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
import com.chainlesschain.android.core.ui.components.EmptyState
import com.chainlesschain.android.core.ui.components.LoadingState
import com.chainlesschain.android.core.ui.components.RemarkNameDialog
import com.chainlesschain.android.feature.p2p.ui.social.components.FriendCard
import com.chainlesschain.android.feature.p2p.ui.social.components.FriendRequestCard
import com.chainlesschain.android.feature.p2p.viewmodel.social.FriendEvent
import com.chainlesschain.android.feature.p2p.viewmodel.social.FriendViewModel
import kotlinx.coroutines.flow.collectLatest

/**
 * 好友列表页面
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FriendListScreen(
    onNavigateBack: () -> Unit,
    onNavigateToFriendDetail: (String) -> Unit,
    onNavigateToAddFriend: () -> Unit,
    viewModel: FriendViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }

    var showGroupDialog by remember { mutableStateOf(false) }
    var showSearchBar by remember { mutableStateOf(false) }
    var searchQuery by remember { mutableStateOf("") }
    var showRemarkDialog by remember { mutableStateOf(false) }
    var remarkFriend by remember { mutableStateOf<com.chainlesschain.android.core.database.entity.social.FriendEntity?>(null) }

    // 收集事件
    LaunchedEffect(Unit) {
        viewModel.eventFlow.collectLatest { event ->
            when (event) {
                is FriendEvent.ShowToast -> {
                    snackbarHostState.showSnackbar(event.message)
                }
                is FriendEvent.NavigateToFriendDetail -> {
                    onNavigateToFriendDetail(event.did)
                }
                else -> {}
            }
        }
    }

    Scaffold(
        topBar = {
            if (showSearchBar) {
                SearchBar(
                    query = searchQuery,
                    onQueryChange = {
                        searchQuery = it
                        viewModel.searchFriends(it)
                    },
                    onSearch = { viewModel.searchFriends(it) },
                    active = true,
                    onActiveChange = { if (!it) showSearchBar = false },
                    onDismiss = { showSearchBar = false }
                )
            } else {
                TopAppBar(
                    title = { },
                    actions = {
                        // 搜索
                        IconButton(onClick = { showSearchBar = true }) {
                            Icon(Icons.Default.Search, contentDescription = "搜索")
                        }

                        // 添加好友
                        IconButton(onClick = onNavigateToAddFriend) {
                            Icon(Icons.Default.PersonAdd, contentDescription = "添加好友")
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
                                    text = { Text("新建分组") },
                                    onClick = {
                                        showMenu = false
                                        showGroupDialog = true
                                    },
                                    leadingIcon = {
                                        Icon(Icons.Default.CreateNewFolder, contentDescription = null)
                                    }
                                )
                                DropdownMenuItem(
                                    text = { Text(if (uiState.isGridView) "列表视图" else "网格视图") },
                                    onClick = {
                                        showMenu = false
                                        viewModel.toggleViewMode()
                                    },
                                    leadingIcon = {
                                        Icon(
                                            if (uiState.isGridView) Icons.Default.ViewList else Icons.Default.GridView,
                                            contentDescription = null
                                        )
                                    }
                                )
                            }
                        }
                    }
                )
            }
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
        floatingActionButton = {
            // 好友请求徽章
            if (uiState.pendingRequestCount > 0) {
                ExtendedFloatingActionButton(
                    onClick = { /* TODO: 导航到好友请求页面 */ },
                    icon = {
                        BadgedBox(
                            badge = {
                                Badge { Text(uiState.pendingRequestCount.toString()) }
                            }
                        ) {
                            Icon(Icons.Default.PersonAdd, contentDescription = null)
                        }
                    },
                    text = { Text("好友请求") }
                )
            }
        }
    ) { paddingValues ->
        when {
            uiState.isLoadingFriends -> {
                LoadingState(modifier = Modifier.padding(paddingValues))
            }
            uiState.friends.isEmpty() -> {
                EmptyState(
                    title = if (uiState.searchQuery.isNotEmpty()) "没有找到相关好友" else "还没有好友",
                    icon = Icons.Default.People,
                    actionText = if (uiState.searchQuery.isEmpty()) "添加好友" else null,
                    onAction = if (uiState.searchQuery.isEmpty()) onNavigateToAddFriend else null,
                    modifier = Modifier.padding(paddingValues)
                )
            }
            else -> {
                LazyColumn(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(paddingValues),
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    // 好友分组
                    if (uiState.groups.isNotEmpty()) {
                        item {
                            Text(
                                text = "分组",
                                style = MaterialTheme.typography.titleSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }

                        items(uiState.groups) { group ->
                            Card(
                                onClick = { viewModel.loadFriendsByGroup(group.id) }
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
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        Icon(
                                            imageVector = Icons.Default.Folder,
                                            contentDescription = null,
                                            tint = MaterialTheme.colorScheme.primary
                                        )
                                        Text(
                                            text = group.name,
                                            style = MaterialTheme.typography.titleMedium
                                        )
                                    }
                                    Icon(
                                        imageVector = Icons.Default.ChevronRight,
                                        contentDescription = null
                                    )
                                }
                            }
                        }

                        item {
                            Divider(modifier = Modifier.padding(vertical = 8.dp))
                        }
                    }

                    // 好友列表
                    item {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = "所有好友",
                                style = MaterialTheme.typography.titleSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                            Text(
                                text = "${uiState.friends.size} 位",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }

                    items(
                        items = uiState.friends,
                        key = { it.did }
                    ) { friend ->
                        FriendCard(
                            friend = friend,
                            onClick = { viewModel.selectFriend(friend) },
                            onLongClick = { viewModel.showFriendMenu(friend) }
                        )
                    }
                }
            }
        }
    }

    // 新建分组对话框
    if (showGroupDialog) {
        var groupName by remember { mutableStateOf("") }

        AlertDialog(
            onDismissRequest = { showGroupDialog = false },
            title = { Text("新建分组") },
            text = {
                OutlinedTextField(
                    value = groupName,
                    onValueChange = { groupName = it },
                    label = { Text("分组名称") },
                    singleLine = true
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        if (groupName.isNotBlank()) {
                            viewModel.createGroup(groupName)
                            showGroupDialog = false
                            groupName = ""
                        }
                    }
                ) {
                    Text("创建")
                }
            },
            dismissButton = {
                TextButton(onClick = { showGroupDialog = false }) {
                    Text("取消")
                }
            }
        )
    }

    // 好友操作菜单
    if (uiState.showFriendMenu && uiState.selectedFriend != null) {
        val friend = uiState.selectedFriend!!

        ModalBottomSheet(
            onDismissRequest = { viewModel.hideFriendMenu() }
        ) {
            Column(
                modifier = Modifier.padding(bottom = 16.dp)
            ) {
                ListItem(
                    headlineContent = { Text("设置备注") },
                    leadingContent = { Icon(Icons.Default.Edit, contentDescription = null) },
                    modifier = Modifier.clickable {
                        viewModel.hideFriendMenu()
                        remarkFriend = friend
                        showRemarkDialog = true
                    }
                )
                ListItem(
                    headlineContent = { Text("移动到分组") },
                    leadingContent = { Icon(Icons.Default.DriveFileMove, contentDescription = null) },
                    modifier = Modifier.clickable {
                        viewModel.hideFriendMenu()
                        viewModel.showGroupSelector(friend)
                    }
                )
                Divider()
                ListItem(
                    headlineContent = { Text("删除好友") },
                    leadingContent = { Icon(Icons.Default.Delete, contentDescription = null) },
                    modifier = Modifier.clickable {
                        viewModel.hideFriendMenu()
                        viewModel.deleteFriend(friend.did)
                    }
                )
                if (!friend.isBlocked) {
                    ListItem(
                        headlineContent = { Text("屏蔽好友") },
                        leadingContent = { Icon(Icons.Default.Block, contentDescription = null) },
                        modifier = Modifier.clickable {
                            viewModel.hideFriendMenu()
                            viewModel.blockFriend(friend.did)
                        }
                    )
                } else {
                    ListItem(
                        headlineContent = { Text("取消屏蔽") },
                        leadingContent = { Icon(Icons.Default.CheckCircle, contentDescription = null) },
                        modifier = Modifier.clickable {
                            viewModel.hideFriendMenu()
                            viewModel.unblockFriend(friend.did)
                        }
                    )
                }
            }
        }
    }

    // 备注名对话框
    if (showRemarkDialog && remarkFriend != null) {
        RemarkNameDialog(
            currentRemarkName = remarkFriend!!.remarkName,
            originalNickname = remarkFriend!!.nickname,
            onDismiss = {
                showRemarkDialog = false
                remarkFriend = null
            },
            onConfirm = { newRemarkName ->
                viewModel.updateRemarkName(remarkFriend!!.did, newRemarkName)
                showRemarkDialog = false
                remarkFriend = null
            }
        )
    }
}

/**
 * 搜索栏组件（简化版）
 */
@Composable
private fun SearchBar(
    query: String,
    onQueryChange: (String) -> Unit,
    onSearch: (String) -> Unit,
    active: Boolean,
    onActiveChange: (Boolean) -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier
) {
    OutlinedTextField(
        value = query,
        onValueChange = onQueryChange,
        modifier = modifier.fillMaxWidth().padding(16.dp),
        placeholder = { Text("搜索好友") },
        leadingIcon = {
            Icon(Icons.Default.Search, contentDescription = null)
        },
        trailingIcon = {
            if (query.isNotEmpty()) {
                IconButton(onClick = { onQueryChange("") }) {
                    Icon(Icons.Default.Clear, contentDescription = "清除")
                }
            }
        },
        singleLine = true
    )
}

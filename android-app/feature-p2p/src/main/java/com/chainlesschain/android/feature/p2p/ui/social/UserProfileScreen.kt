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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.core.ui.components.EmptyState
import com.chainlesschain.android.core.ui.components.LoadingState
import com.chainlesschain.android.core.ui.image.Avatar
import com.chainlesschain.android.core.ui.image.AvatarSize
import com.chainlesschain.android.feature.p2p.ui.social.components.PostCard
import com.chainlesschain.android.feature.p2p.viewmodel.social.FriendshipStatus
import com.chainlesschain.android.feature.p2p.viewmodel.social.UserProfileEvent
import com.chainlesschain.android.feature.p2p.viewmodel.social.UserProfileViewModel
import kotlinx.coroutines.flow.collectLatest

/**
 * 用户资料页面
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun UserProfileScreen(
    onNavigateBack: () -> Unit,
    onNavigateToPost: (String) -> Unit = {},
    onNavigateToChat: (String) -> Unit = {},
    viewModel: UserProfileViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }

    // 收集事件
    LaunchedEffect(Unit) {
        viewModel.eventFlow.collectLatest { event ->
            when (event) {
                is UserProfileEvent.ShowToast -> {
                    snackbarHostState.showSnackbar(event.message)
                }
                is UserProfileEvent.NavigateToChat -> {
                    onNavigateToChat(event.did)
                }
            }
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(uiState.userInfo?.nickname ?: "用户资料") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "返回")
                    }
                },
                actions = {
                    IconButton(onClick = { viewModel.showMenu() }) {
                        Icon(Icons.Default.MoreVert, contentDescription = "更多")
                    }
                }
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) }
    ) { paddingValues ->
        when {
            uiState.isLoadingUser -> {
                LoadingState(modifier = Modifier.padding(paddingValues))
            }
            uiState.userInfo == null -> {
                EmptyState(
                    title = "用户信息加载失败",
                    icon = Icons.Default.Error,
                    modifier = Modifier.padding(paddingValues)
                )
            }
            else -> {
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(paddingValues)
                ) {
                    // 个人信息区
                    UserInfoSection(
                        userInfo = uiState.userInfo!!,
                        relationship = uiState.relationship,
                        onAddFriend = { viewModel.sendFriendRequest() },
                        onSendMessage = { viewModel.sendMessage() },
                        onUnblock = { viewModel.unblockUser() }
                    )

                    Divider()

                    // Tab切换
                    TabRow(selectedTabIndex = uiState.selectedTab) {
                        Tab(
                            selected = uiState.selectedTab == 0,
                            onClick = { viewModel.selectTab(0) },
                            text = { Text("动态") }
                        )
                        Tab(
                            selected = uiState.selectedTab == 1,
                            onClick = { viewModel.selectTab(1) },
                            text = { Text("点赞") }
                        )
                    }

                    // 动态列表
                    LazyColumn(
                        modifier = Modifier.fillMaxSize()
                    ) {
                        when (uiState.selectedTab) {
                            0 -> {
                                // 动态Tab
                                if (uiState.isLoadingPosts) {
                                    item {
                                        Box(
                                            modifier = Modifier
                                                .fillMaxWidth()
                                                .padding(32.dp),
                                            contentAlignment = Alignment.Center
                                        ) {
                                            CircularProgressIndicator()
                                        }
                                    }
                                } else if (uiState.posts.isEmpty()) {
                                    item {
                                        EmptyState(
                                            title = "还没有发布动态",
                                            icon = Icons.Default.PostAdd,
                                            modifier = Modifier.padding(32.dp)
                                        )
                                    }
                                } else {
                                    items(
                                        items = uiState.posts,
                                        key = { it.id }
                                    ) { post ->
                                        PostCard(
                                            post = post,
                                            authorNickname = uiState.userInfo!!.nickname,
                                            authorAvatar = uiState.userInfo!!.avatar,
                                            onPostClick = { onNavigateToPost(post.id) },
                                            onAuthorClick = { /* Already on user profile */ },
                                            onLikeClick = { /* TODO: Like post */ },
                                            onCommentClick = { onNavigateToPost(post.id) },
                                            onShareClick = { /* TODO: Share post */ },
                                            onMoreClick = { /* TODO: Show post menu */ },
                                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
                                        )
                                    }
                                }
                            }
                            1 -> {
                                // 点赞Tab
                                item {
                                    EmptyState(
                                        title = "点赞列表功能开发中",
                                        icon = Icons.Default.ThumbUp,
                                        modifier = Modifier.padding(32.dp)
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // 更多菜单
    if (uiState.showMenu) {
        ModalBottomSheet(
            onDismissRequest = { viewModel.hideMenu() }
        ) {
            Column(
                modifier = Modifier.padding(bottom = 16.dp)
            ) {
                ListItem(
                    headlineContent = { Text("举报") },
                    leadingContent = { Icon(Icons.Default.Report, contentDescription = null) },
                    modifier = Modifier.clickable {
                        // TODO: Show report dialog
                        viewModel.reportUser("其他")
                    }
                )
                if (uiState.relationship != FriendshipStatus.BLOCKED) {
                    ListItem(
                        headlineContent = { Text("屏蔽") },
                        leadingContent = { Icon(Icons.Default.Block, contentDescription = null) },
                        modifier = Modifier.clickable {
                            viewModel.blockUser()
                        }
                    )
                }
            }
        }
    }
}

/**
 * 用户信息区域
 */
@Composable
private fun UserInfoSection(
    userInfo: com.chainlesschain.android.feature.p2p.viewmodel.social.UserInfo,
    relationship: FriendshipStatus,
    onAddFriend: () -> Unit,
    onSendMessage: () -> Unit,
    onUnblock: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        // 头像
        Avatar(
            avatarUrl = userInfo.avatar,
            name = userInfo.nickname,
            size = AvatarSize.XLARGE
        )

        // 昵称
        Text(
            text = userInfo.nickname,
            style = MaterialTheme.typography.headlineSmall
        )

        // DID
        Text(
            text = "DID: ${userInfo.did.take(16)}...",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )

        // 个人简介
        userInfo.bio?.let { bio ->
            Text(
                text = bio,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis
            )
        }

        // 关系状态区域
        when (relationship) {
            FriendshipStatus.STRANGER -> {
                // 陌生人：显示添加好友按钮
                Button(
                    onClick = onAddFriend,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Icon(Icons.Default.PersonAdd, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text("添加好友")
                }
            }
            FriendshipStatus.FRIEND -> {
                // 已是好友：显示发消息按钮
                Button(
                    onClick = onSendMessage,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Icon(Icons.Default.Message, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text("发消息")
                }
            }
            FriendshipStatus.PENDING_SENT -> {
                // 等待对方接受
                OutlinedButton(
                    onClick = { },
                    enabled = false,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Icon(Icons.Default.HourglassEmpty, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text("等待接受")
                }
            }
            FriendshipStatus.PENDING_RECEIVED -> {
                // 待自己接受
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Button(
                        onClick = { /* TODO: Accept friend request */ },
                        modifier = Modifier.weight(1f)
                    ) {
                        Text("接受")
                    }
                    OutlinedButton(
                        onClick = { /* TODO: Reject friend request */ },
                        modifier = Modifier.weight(1f)
                    ) {
                        Text("拒绝")
                    }
                }
            }
            FriendshipStatus.BLOCKED -> {
                // 已屏蔽
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(
                        text = "已屏蔽该用户",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.error
                    )
                    TextButton(onClick = onUnblock) {
                        Text("取消屏蔽")
                    }
                }
            }
        }
    }
}

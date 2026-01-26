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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.foundation.clickable
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.clickable
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.core.p2p.realtime.UserPresenceStatus
import com.chainlesschain.android.core.ui.components.EmptyState
import com.chainlesschain.android.core.ui.components.LoadingState
import com.chainlesschain.android.core.ui.image.Avatar
import com.chainlesschain.android.core.ui.image.AvatarSize
import com.chainlesschain.android.feature.p2p.ui.social.components.PostCard
import com.chainlesschain.android.feature.p2p.viewmodel.social.FriendDetailEvent
import com.chainlesschain.android.feature.p2p.viewmodel.social.FriendDetailViewModel
import kotlinx.coroutines.flow.collectLatest
import java.text.SimpleDateFormat
import java.util.*

/**
 * 好友详情页面
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FriendDetailScreen(
    onNavigateBack: () -> Unit,
    onNavigateToPost: (String) -> Unit = {},
    onNavigateToChat: (String) -> Unit = {},
    viewModel: FriendDetailViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }

    // 收集事件
    LaunchedEffect(Unit) {
        viewModel.eventFlow.collectLatest { event ->
            when (event) {
                is FriendDetailEvent.ShowToast -> {
                    snackbarHostState.showSnackbar(event.message)
                }
                is FriendDetailEvent.NavigateToChat -> {
                    onNavigateToChat(event.did)
                }
                is FriendDetailEvent.StartVoiceCall -> {
                    // TODO: 启动语音通话
                    snackbarHostState.showSnackbar("语音通话功能开发中...")
                }
                is FriendDetailEvent.StartVideoCall -> {
                    // TODO: 启动视频通话
                    snackbarHostState.showSnackbar("视频通话功能开发中...")
                }
                is FriendDetailEvent.NavigateBack -> {
                    onNavigateBack()
                }
            }
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(uiState.friend?.remarkName ?: uiState.friend?.nickname ?: "好友详情") },
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
            uiState.isLoadingFriend -> {
                LoadingState(modifier = Modifier.padding(paddingValues))
            }
            uiState.friend == null -> {
                EmptyState(
                    title = "好友信息加载失败",
                    icon = Icons.Default.Error,
                    actionText = "重试",
                    onAction = { viewModel.refresh() },
                    modifier = Modifier.padding(paddingValues)
                )
            }
            else -> {
                val friend = uiState.friend!!
                LazyColumn(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(paddingValues)
                ) {
                    // 个人信息区
                    item {
                        FriendInfoSection(
                            friend = friend,
                            presenceInfo = uiState.presenceInfo,
                            onSendMessage = { viewModel.sendMessage() },
                            onVoiceCall = { viewModel.startVoiceCall() },
                            onVideoCall = { viewModel.startVideoCall() }
                        )
                        Divider(modifier = Modifier.padding(vertical = 12.dp))
                    }

                    // 动态列表标题
                    item {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 16.dp, vertical = 8.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = "动态",
                                style = MaterialTheme.typography.titleMedium
                            )
                            Text(
                                text = "${uiState.posts.size} 条",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }

                    // 动态列表
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
                                authorNickname = friend.remarkName ?: friend.nickname,
                                authorAvatar = friend.avatar,
                                onPostClick = { onNavigateToPost(post.id) },
                                onAuthorClick = { /* Already on friend detail */ },
                                onLikeClick = { /* TODO: Like post */ },
                                onCommentClick = { onNavigateToPost(post.id) },
                                onShareClick = { /* TODO: Share post */ },
                                onMoreClick = { /* TODO: Show post menu */ },
                                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
                            )
                        }
                    }
                }
            }
        }
    }

    // 更多菜单
    if (uiState.showMenu && uiState.friend != null) {
        ModalBottomSheet(
            onDismissRequest = { viewModel.hideMenu() }
        ) {
            Column(
                modifier = Modifier.padding(bottom = 16.dp)
            ) {
                ListItem(
                    headlineContent = { Text("设置备注") },
                    leadingContent = { Icon(Icons.Default.Edit, contentDescription = null) },
                    modifier = Modifier.clickable {
                        viewModel.showRemarkDialog()
                    }
                )
                Divider()
                ListItem(
                    headlineContent = { Text("删除好友") },
                    leadingContent = { Icon(Icons.Default.PersonRemove, contentDescription = null) },
                    modifier = Modifier.clickable {
                        viewModel.deleteFriend()
                    }
                )
                ListItem(
                    headlineContent = { Text("屏蔽好友") },
                    leadingContent = { Icon(Icons.Default.Block, contentDescription = null) },
                    modifier = Modifier.clickable {
                        viewModel.blockFriend()
                    }
                )
            }
        }
    }

    // 备注名对话框
    if (uiState.showRemarkDialog && uiState.friend != null) {
        var remarkName by remember { mutableStateOf(uiState.friend!!.remarkName ?: "") }

        AlertDialog(
            onDismissRequest = { viewModel.hideRemarkDialog() },
            title = { Text("设置备注名") },
            text = {
                Column(
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Text(
                        text = "昵称: ${uiState.friend!!.nickname}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    OutlinedTextField(
                        value = remarkName,
                        onValueChange = { remarkName = it },
                        label = { Text("备注名") },
                        placeholder = { Text("给好友起个备注名") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        viewModel.updateRemarkName(remarkName.ifBlank { null })
                    }
                ) {
                    Text("保存")
                }
            },
            dismissButton = {
                TextButton(onClick = { viewModel.hideRemarkDialog() }) {
                    Text("取消")
                }
            }
        )
    }
}

/**
 * 好友信息区域
 */
@Composable
private fun FriendInfoSection(
    friend: com.chainlesschain.android.core.database.entity.social.FriendEntity,
    presenceInfo: com.chainlesschain.android.core.p2p.realtime.PresenceInfo?,
    onSendMessage: () -> Unit,
    onVoiceCall: () -> Unit,
    onVideoCall: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        // 头像 + 在线状态
        Box {
            Avatar(
                avatarUrl = friend.avatar,
                name = friend.nickname,
                size = AvatarSize.XLARGE
            )
            // 在线状态指示器
            if (presenceInfo?.status == UserPresenceStatus.ONLINE) {
                Surface(
                    modifier = Modifier
                        .size(16.dp)
                        .align(Alignment.BottomEnd),
                    shape = MaterialTheme.shapes.small,
                    color = MaterialTheme.colorScheme.primary,
                    border = androidx.compose.foundation.BorderStroke(
                        2.dp,
                        MaterialTheme.colorScheme.surface
                    )
                ) {}
            }
        }

        // 昵称/备注名
        Text(
            text = friend.remarkName ?: friend.nickname,
            style = MaterialTheme.typography.headlineSmall
        )

        // DID
        Text(
            text = "DID: ${friend.did.take(16)}...",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )

        // 个人简介
        friend.bio?.let { bio ->
            Text(
                text = bio,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis
            )
        }

        // 添加时间和最后在线
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceEvenly
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    text = "添加时间",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Text(
                    text = formatDate(friend.addedAt),
                    style = MaterialTheme.typography.bodySmall
                )
            }
            presenceInfo?.lastActiveAt?.let { lastActiveAt ->
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        text = "最后在线",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Text(
                        text = formatRelativeTime(lastActiveAt),
                        style = MaterialTheme.typography.bodySmall
                    )
                }
            }
        }

        // 操作按钮
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Button(
                onClick = onSendMessage,
                modifier = Modifier.weight(1f)
            ) {
                Icon(Icons.Default.Message, contentDescription = null)
                Spacer(Modifier.width(4.dp))
                Text("发消息")
            }
            OutlinedButton(onClick = onVoiceCall) {
                Icon(Icons.Default.Phone, contentDescription = "语音通话")
            }
            OutlinedButton(onClick = onVideoCall) {
                Icon(Icons.Default.Videocam, contentDescription = "视频通话")
            }
        }
    }
}

/**
 * 格式化日期
 */
private fun formatDate(timestamp: Long): String {
    val sdf = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())
    return sdf.format(Date(timestamp))
}

/**
 * 格式化相对时间
 */
private fun formatRelativeTime(timestamp: Long): String {
    val now = System.currentTimeMillis()
    val diff = now - timestamp

    return when {
        diff < 60_000 -> "刚刚"
        diff < 3600_000 -> "${diff / 60_000} 分钟前"
        diff < 86400_000 -> "${diff / 3600_000} 小时前"
        diff < 2592000_000 -> "${diff / 86400_000} 天前"
        else -> formatDate(timestamp)
    }
}

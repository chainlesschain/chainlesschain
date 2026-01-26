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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.core.ui.components.EmptyState
import com.chainlesschain.android.core.ui.components.LoadingState
import com.chainlesschain.android.core.ui.image.Avatar
import com.chainlesschain.android.core.ui.image.AvatarSize
import com.chainlesschain.android.feature.p2p.viewmodel.social.CommentDetailEvent
import com.chainlesschain.android.feature.p2p.viewmodel.social.CommentDetailViewModel
import kotlinx.coroutines.flow.collectLatest
import java.text.SimpleDateFormat
import java.util.*

/**
 * 评论详情页面
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CommentDetailScreen(
    onNavigateBack: () -> Unit,
    onNavigateToUserProfile: (String) -> Unit = {},
    viewModel: CommentDetailViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }
    var replyText by remember { mutableStateOf("") }

    // 收集事件
    LaunchedEffect(Unit) {
        viewModel.eventFlow.collectLatest { event ->
            when (event) {
                is CommentDetailEvent.ShowToast -> {
                    snackbarHostState.showSnackbar(event.message)
                }
                is CommentDetailEvent.ReplyAdded -> {
                    replyText = ""
                }
            }
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("评论详情") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "返回")
                    }
                }
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
        bottomBar = {
            // 回复输入框
            Surface(
                tonalElevation = 3.dp
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    OutlinedTextField(
                        value = replyText,
                        onValueChange = { replyText = it },
                        modifier = Modifier.weight(1f),
                        placeholder = { Text("写回复...") },
                        maxLines = 3
                    )
                    IconButton(
                        onClick = {
                            viewModel.addReply(replyText)
                        },
                        enabled = replyText.isNotBlank()
                    ) {
                        Icon(Icons.Default.Send, contentDescription = "发送")
                    }
                }
            }
        }
    ) { paddingValues ->
        when {
            uiState.isLoadingComment -> {
                LoadingState(modifier = Modifier.padding(paddingValues))
            }
            uiState.comment == null -> {
                EmptyState(
                    message = "评论不存在或已被删除",
                    icon = Icons.Default.Error,
                    modifier = Modifier.padding(paddingValues)
                )
            }
            else -> {
                val comment = uiState.comment!!
                val authorInfo = uiState.authorInfo[comment.authorDid]

                LazyColumn(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(paddingValues),
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    // 主评论
                    item {
                        CommentCard(
                            comment = comment,
                            authorNickname = authorInfo?.nickname ?: "用户",
                            authorAvatar = authorInfo?.avatar,
                            isMainComment = true,
                            onAuthorClick = { onNavigateToUserProfile(comment.authorDid) },
                            onLikeClick = { viewModel.likeComment() }
                        )
                    }

                    // 回复标题
                    if (uiState.replies.isNotEmpty()) {
                        item {
                            Text(
                                text = "回复 (${uiState.replies.size})",
                                style = MaterialTheme.typography.titleMedium,
                                modifier = Modifier.padding(top = 8.dp)
                            )
                        }
                    }

                    // 回复列表
                    items(
                        items = uiState.replies,
                        key = { it.id }
                    ) { reply ->
                        val replyAuthorInfo = uiState.authorInfo[reply.authorDid]
                        CommentCard(
                            comment = reply,
                            authorNickname = replyAuthorInfo?.nickname ?: "用户",
                            authorAvatar = replyAuthorInfo?.avatar,
                            isMainComment = false,
                            onAuthorClick = { onNavigateToUserProfile(reply.authorDid) },
                            onLikeClick = { viewModel.likeReply(reply.id) }
                        )
                    }

                    // 空状态提示
                    if (uiState.replies.isEmpty()) {
                        item {
                            EmptyState(
                                message = "还没有回复",
                                icon = Icons.Default.Comment,
                                modifier = Modifier.padding(32.dp)
                            )
                        }
                    }
                }
            }
        }
    }
}

/**
 * 评论卡片
 */
@Composable
private fun CommentCard(
    comment: com.chainlesschain.android.core.database.entity.social.PostCommentEntity,
    authorNickname: String,
    authorAvatar: String?,
    isMainComment: Boolean,
    onAuthorClick: () -> Unit,
    onLikeClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    ElevatedCard(
        modifier = modifier.fillMaxWidth(),
        colors = if (isMainComment) {
            CardDefaults.elevatedCardColors(
                containerColor = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.3f)
            )
        } else {
            CardDefaults.elevatedCardColors()
        }
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            // 作者信息
            Row(
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Avatar(
                    avatarUrl = authorAvatar,
                    name = authorNickname,
                    size = if (isMainComment) AvatarSize.MEDIUM else AvatarSize.SMALL,
                    modifier = Modifier.clickable(onClick = onAuthorClick)
                )

                Column(
                    verticalArrangement = Arrangement.spacedBy(2.dp),
                    modifier = Modifier.weight(1f)
                ) {
                    Text(
                        text = authorNickname,
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = if (isMainComment) FontWeight.Bold else FontWeight.Normal
                    )
                    Text(
                        text = formatRelativeTime(comment.createdAt),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            // 评论内容
            Text(
                text = comment.content,
                style = if (isMainComment) {
                    MaterialTheme.typography.bodyLarge
                } else {
                    MaterialTheme.typography.bodyMedium
                }
            )

            // 点赞按钮
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                IconButton(onClick = onLikeClick) {
                    Icon(
                        imageVector = if (comment.isLiked) {
                            Icons.Default.Favorite
                        } else {
                            Icons.Default.FavoriteBorder
                        },
                        contentDescription = "点赞",
                        tint = if (comment.isLiked) {
                            MaterialTheme.colorScheme.error
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        }
                    )
                }
                if (comment.likeCount > 0) {
                    Text(
                        text = comment.likeCount.toString(),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        }
    }
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
        else -> {
            val sdf = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())
            sdf.format(Date(timestamp))
        }
    }
}

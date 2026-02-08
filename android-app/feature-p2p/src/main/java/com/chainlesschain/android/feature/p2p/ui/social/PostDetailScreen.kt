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
import com.chainlesschain.android.feature.p2p.ui.social.components.PostCard
import com.chainlesschain.android.feature.p2p.viewmodel.social.PostEvent
import com.chainlesschain.android.feature.p2p.viewmodel.social.PostViewModel
import kotlinx.coroutines.flow.collectLatest
import java.text.SimpleDateFormat
import java.util.*

/**
 * 动态详情页面（包含评论列表）
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PostDetailScreen(
    postId: String,
    myDid: String,
    onNavigateBack: () -> Unit,
    onNavigateToUserProfile: (String) -> Unit,
    viewModel: PostViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }
    var commentText by remember { mutableStateOf("") }

    // 加载动态详情和评论
    LaunchedEffect(postId) {
        viewModel.loadPostDetail(postId)
        viewModel.loadComments(postId)
    }

    // 收集事件
    LaunchedEffect(Unit) {
        viewModel.eventFlow.collectLatest { event ->
            when (event) {
                is PostEvent.ShowToast -> {
                    snackbarHostState.showSnackbar(event.message)
                }
                is PostEvent.CommentAdded -> {
                    commentText = ""
                }
                is PostEvent.NavigateToUserProfile -> {
                    onNavigateToUserProfile(event.did)
                }
                else -> {}
            }
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("动态详情") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "返回")
                    }
                },
                actions = {
                    if (uiState.currentPost != null) {
                        IconButton(onClick = {
                            viewModel.showPostMenu(uiState.currentPost!!)
                        }) {
                            Icon(Icons.Default.MoreVert, contentDescription = "更多")
                        }
                    }
                }
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
        bottomBar = {
            // 评论输入框
            if (uiState.currentPost != null) {
                CommentInputBar(
                    value = commentText,
                    onValueChange = { commentText = it },
                    onSend = {
                        if (commentText.isNotBlank()) {
                            viewModel.addComment(
                                postId = postId,
                                content = commentText.trim(),
                                authorDid = uiState.currentPost?.authorDid ?: ""
                            )
                        }
                    },
                    enabled = commentText.isNotBlank()
                )
            }
        }
    ) { paddingValues ->
        when {
            uiState.currentPost == null -> {
                LoadingState(modifier = Modifier.padding(paddingValues))
            }
            else -> {
                val post = uiState.currentPost!!

                LazyColumn(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(paddingValues),
                    contentPadding = PaddingValues(bottom = 16.dp)
                ) {
                    // 动态内容
                    item {
                        PostCard(
                            post = post,
                            authorNickname = "用户${post.authorDid.take(8)}", // Nickname lookup requires friend info cache
                            onPostClick = { },
                            onAuthorClick = { onNavigateToUserProfile(post.authorDid) },
                            onLikeClick = { viewModel.toggleLike(post.id, post.isLiked, post.authorDid) },
                            onCommentClick = { },
                            onShareClick = { viewModel.sharePost(post.id, post.authorDid) },
                            onMoreClick = { viewModel.showPostMenu(post) },
                            modifier = Modifier.padding(16.dp)
                        )
                    }

                    item {
                        Divider()
                    }

                    // 评论标题
                    item {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(16.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = "评论",
                                style = MaterialTheme.typography.titleMedium
                            )
                            Text(
                                text = "${uiState.comments.size} 条",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }

                    // 评论列表
                    if (uiState.isLoadingComments) {
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
                    } else if (uiState.comments.isEmpty()) {
                        item {
                            EmptyState(
                                title = "还没有评论",
                                icon = Icons.Default.Comment
                            )
                        }
                    } else {
                        items(
                            items = uiState.comments,
                            key = { it.id }
                        ) { comment ->
                            CommentItem(
                                comment = comment,
                                myDid = myDid,
                                onAuthorClick = { onNavigateToUserProfile(comment.authorDid) },
                                onLikeClick = {
                                    viewModel.toggleCommentLike(comment.id, comment.isLiked)
                                },
                                onReplyClick = {
                                    viewModel.showCommentInput(postId, comment.id)
                                },
                                onDeleteClick = {
                                    viewModel.deleteComment(comment)
                                },
                                onLoadReplies = {
                                    viewModel.loadCommentReplies(comment.id)
                                }
                            )
                        }
                    }
                }
            }
        }
    }
}

/**
 * 评论项组件
 */
@Composable
private fun CommentItem(
    comment: com.chainlesschain.android.core.database.entity.social.PostCommentEntity,
    myDid: String,
    onAuthorClick: () -> Unit,
    onLikeClick: () -> Unit,
    onReplyClick: () -> Unit,
    onDeleteClick: () -> Unit,
    onLoadReplies: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp)
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            // 头像占位
            Surface(
                modifier = Modifier.size(40.dp),
                shape = MaterialTheme.shapes.small,
                color = MaterialTheme.colorScheme.primaryContainer
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Text(
                        text = comment.authorDid.take(1).uppercase(),
                        style = MaterialTheme.typography.titleSmall
                    )
                }
            }

            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                // 作者和时间
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "用户${comment.authorDid.take(8)}",
                        style = MaterialTheme.typography.titleSmall,
                        modifier = Modifier.weight(1f)
                    )

                    Text(
                        text = formatCommentTime(comment.createdAt),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }

                // 评论内容
                Text(
                    text = comment.content,
                    style = MaterialTheme.typography.bodyMedium
                )

                // 操作按钮
                Row(
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    // 点赞
                    TextButton(
                        onClick = onLikeClick,
                        contentPadding = PaddingValues(horizontal = 8.dp)
                    ) {
                        Icon(
                            imageVector = if (comment.isLiked) {
                                Icons.Filled.Favorite
                            } else {
                                Icons.Filled.FavoriteBorder
                            },
                            contentDescription = null,
                            modifier = Modifier.size(16.dp),
                            tint = if (comment.isLiked) {
                                MaterialTheme.colorScheme.error
                            } else {
                                MaterialTheme.colorScheme.onSurfaceVariant
                            }
                        )
                        if (comment.likeCount > 0) {
                            Spacer(modifier = Modifier.width(4.dp))
                            Text(
                                text = comment.likeCount.toString(),
                                style = MaterialTheme.typography.labelSmall
                            )
                        }
                    }

                    // 回复
                    TextButton(
                        onClick = onReplyClick,
                        contentPadding = PaddingValues(horizontal = 8.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Reply,
                            contentDescription = null,
                            modifier = Modifier.size(16.dp)
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("回复")
                    }

                    // 删除（仅自己的评论）
                    if (comment.authorDid == myDid) {
                        TextButton(
                            onClick = onDeleteClick,
                            contentPadding = PaddingValues(horizontal = 8.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.Delete,
                                contentDescription = null,
                                modifier = Modifier.size(16.dp)
                            )
                            Spacer(modifier = Modifier.width(4.dp))
                            Text("删除")
                        }
                    }
                }
            }
        }
    }

    Divider(modifier = Modifier.padding(start = 68.dp))
}

/**
 * 评论输入栏组件
 */
@Composable
private fun CommentInputBar(
    value: String,
    onValueChange: (String) -> Unit,
    onSend: () -> Unit,
    enabled: Boolean,
    modifier: Modifier = Modifier
) {
    Surface(
        modifier = modifier,
        tonalElevation = 3.dp
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            OutlinedTextField(
                value = value,
                onValueChange = onValueChange,
                modifier = Modifier.weight(1f),
                placeholder = { Text("写评论...") },
                maxLines = 4,
                shape = MaterialTheme.shapes.medium
            )

            IconButton(
                onClick = onSend,
                enabled = enabled
            ) {
                Icon(
                    imageVector = Icons.Default.Send,
                    contentDescription = "发送",
                    tint = if (enabled) {
                        MaterialTheme.colorScheme.primary
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    }
                )
            }
        }
    }
}

/**
 * 格式化评论时间
 */
private fun formatCommentTime(timestamp: Long): String {
    val diff = System.currentTimeMillis() - timestamp
    return when {
        diff < 60 * 1000 -> "刚刚"
        diff < 60 * 60 * 1000 -> "${diff / (60 * 1000)}分钟前"
        diff < 24 * 60 * 60 * 1000 -> "${diff / (60 * 60 * 1000)}小时前"
        diff < 7 * 24 * 60 * 60 * 1000 -> "${diff / (24 * 60 * 60 * 1000)}天前"
        else -> SimpleDateFormat("MM-dd HH:mm", Locale.getDefault()).format(Date(timestamp))
    }
}

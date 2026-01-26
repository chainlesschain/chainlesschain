package com.chainlesschain.android.feature.p2p.ui.social

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.clickable
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.clickable
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.clickable
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.clickable
import androidx.compose.material.icons.Icons
import androidx.compose.foundation.clickable
import androidx.compose.material.icons.filled.*
import androidx.compose.foundation.clickable
import androidx.compose.material3.*
import androidx.compose.foundation.clickable
import androidx.compose.runtime.*
import androidx.compose.foundation.clickable
import androidx.compose.ui.Modifier
import androidx.compose.foundation.clickable
import androidx.compose.ui.platform.LocalContext
import androidx.compose.foundation.clickable
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.clickable
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.core.ui.util.ShareManager
import com.chainlesschain.android.core.ui.components.EmptyState
import com.chainlesschain.android.core.ui.components.LoadingState
import com.chainlesschain.android.feature.p2p.ui.social.components.PostCard
import com.chainlesschain.android.feature.p2p.ui.social.components.ReportDialog
import com.chainlesschain.android.feature.p2p.ui.social.components.EditHistoryDialog
import com.chainlesschain.android.feature.p2p.ui.social.components.HistoryVersionDialog
import com.chainlesschain.android.core.common.Result
import com.chainlesschain.android.core.database.entity.social.PostEditHistoryEntity
import com.chainlesschain.android.core.database.entity.social.PostEntity
import com.chainlesschain.android.feature.p2p.util.EditPermission
import com.chainlesschain.android.feature.p2p.util.PostEditPolicy
import com.chainlesschain.android.feature.p2p.viewmodel.social.PostEvent
import com.chainlesschain.android.feature.p2p.viewmodel.social.PostViewModel
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

/**
 * 时间流页面（动态列表）
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TimelineScreen(
    myDid: String,
    friendDids: List<String>,
    onNavigateToPublishPost: () -> Unit,
    onNavigateToPostDetail: (String) -> Unit,
    onNavigateToUserProfile: (String) -> Unit,
    onNavigateToEditPost: (String) -> Unit,
    viewModel: PostViewModel = hiltViewModel()
) {
    val context = LocalContext.current
    val uiState by viewModel.uiState.collectAsState()
    val listState = rememberLazyListState()
    val snackbarHostState = remember { SnackbarHostState() }
    val coroutineScope = rememberCoroutineScope()

    // 举报对话框状态
    var showReportDialog by remember { mutableStateOf(false) }
    var reportTargetPost by remember { mutableStateOf<com.chainlesschain.android.core.database.entity.social.PostEntity?>(null) }

    // 编辑历史对话框状态
    var showEditHistoryDialog by remember { mutableStateOf(false) }
    var editHistoryPost by remember { mutableStateOf<PostEntity?>(null) }
    var editHistories by remember { mutableStateOf<List<PostEditHistoryEntity>>(emptyList()) }
    var showVersionDialog by remember { mutableStateOf(false) }
    var selectedVersion by remember { mutableStateOf<PostEditHistoryEntity?>(null) }

    // 初始化
    LaunchedEffect(Unit) {
        viewModel.initialize(myDid, friendDids)
    }

    // 收集事件
    LaunchedEffect(Unit) {
        viewModel.eventFlow.collectLatest { event ->
            when (event) {
                is PostEvent.ShowToast -> {
                    snackbarHostState.showSnackbar(event.message)
                }
                is PostEvent.NavigateToPostDetail -> {
                    onNavigateToPostDetail(event.postId)
                }
                is PostEvent.NavigateToUserProfile -> {
                    onNavigateToUserProfile(event.did)
                }
                is PostEvent.PostPublished -> {
                    // 滚动到顶部
                    coroutineScope.launch {
                        listState.animateScrollToItem(0)
                    }
                }
                else -> {}
            }
        }
    }

    // 检测滚动到底部，加载更多
    LaunchedEffect(listState) {
        snapshotFlow { listState.layoutInfo }
            .collect { layoutInfo ->
                val lastVisibleItem = layoutInfo.visibleItemsInfo.lastOrNull()
                if (lastVisibleItem != null &&
                    lastVisibleItem.index >= layoutInfo.totalItemsCount - 3 &&
                    !uiState.isLoadingTimeline) {
                    viewModel.loadMoreTimeline()
                }
            }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { },
                actions = {
                    // 标签筛选
                    if (uiState.selectedTag != null) {
                        FilterChip(
                            selected = true,
                            onClick = { viewModel.clearTagFilter() },
                            label = { Text("#${uiState.selectedTag}") },
                            trailingIcon = {
                                Icon(
                                    imageVector = Icons.Default.Close,
                                    contentDescription = "清除筛选",
                                    modifier = Modifier.size(18.dp)
                                )
                            }
                        )
                    }

                    // 刷新
                    IconButton(
                        onClick = { viewModel.refreshTimeline() },
                        enabled = !uiState.isRefreshing
                    ) {
                        Icon(Icons.Default.Refresh, contentDescription = "刷新")
                    }

                    // 搜索
                    IconButton(onClick = { /* TODO: 显示搜索 */ }) {
                        Icon(Icons.Default.Search, contentDescription = "搜索")
                    }
                }
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
        floatingActionButton = {
            FloatingActionButton(
                onClick = onNavigateToPublishPost
            ) {
                Icon(Icons.Default.Add, contentDescription = "发布动态")
            }
        }
    ) { paddingValues ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            when {
                uiState.isLoadingTimeline && uiState.timelinePosts.isEmpty() -> {
                    LoadingState()
                }
                uiState.timelinePosts.isEmpty() -> {
                    EmptyState(
                        title = "还没有动态",
                        icon = Icons.Default.Article,
                        actionText = "发布第一条动态",
                        onAction = onNavigateToPublishPost
                    )
                }
                else -> {
                    LazyColumn(
                        state = listState,
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(vertical = 8.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        items(
                            items = uiState.timelinePosts,
                            key = { it.id }
                        ) { post ->
                            PostCard(
                                post = post,
                                authorNickname = "用户${post.authorDid.take(8)}", // TODO: 从好友信息获取昵称
                                onPostClick = { onNavigateToPostDetail(post.id) },
                                onAuthorClick = { onNavigateToUserProfile(post.authorDid) },
                                onLikeClick = { viewModel.toggleLike(post.id, post.isLiked, post.authorDid) },
                                onCommentClick = {
                                    onNavigateToPostDetail(post.id)
                                },
                                onShareClick = {
                                    // 分享动态
                                    ShareManager.sharePost(
                                        context = context,
                                        authorName = "用户${post.authorDid.take(8)}", // TODO: 从好友信息获取昵称
                                        content = post.content
                                    )
                                    // 记录分享
                                    viewModel.sharePost(post.id, post.authorDid)
                                },
                                onMoreClick = {
                                    viewModel.showPostMenu(post)
                                },
                                modifier = Modifier.padding(horizontal = 16.dp)
                            )
                        }

                        // 加载更多指示器
                        if (uiState.isLoadingTimeline && uiState.timelinePosts.isNotEmpty()) {
                            item {
                                Box(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(16.dp)
                                ) {
                                    CircularProgressIndicator(
                                        modifier = Modifier.size(24.dp)
                                    )
                                }
                            }
                        }

                        // 没有更多提示
                        if (!uiState.hasMoreTimeline && uiState.timelinePosts.isNotEmpty()) {
                            item {
                                Text(
                                    text = "没有更多了",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(16.dp)
                                )
                            }
                        }
                    }
                }
            }

            // 下拉刷新指示器
            if (uiState.isRefreshing) {
                LinearProgressIndicator(
                    modifier = Modifier.fillMaxWidth()
                )
            }
        }
    }

    // 动态操作菜单
    if (uiState.showPostMenu && uiState.currentPost != null) {
        val post = uiState.currentPost!!
        val isMyPost = post.authorDid == myDid

        ModalBottomSheet(
            onDismissRequest = { viewModel.hidePostMenu() }
        ) {
            Column(
                modifier = Modifier.padding(bottom = 16.dp)
            ) {
                if (isMyPost) {
                    // 我的动态操作
                    ListItem(
                        headlineContent = { Text(if (post.isPinned) "取消置顶" else "置顶") },
                        leadingContent = {
                            Icon(
                                if (post.isPinned) Icons.Default.PushPin else Icons.Default.PushPin,
                                contentDescription = null
                            )
                        },
                        modifier = Modifier.clickable {
                            viewModel.hidePostMenu()
                            if (post.isPinned) {
                                viewModel.unpinPost(post.id)
                            } else {
                                viewModel.pinPost(post.id)
                            }
                        }
                    )

                    // 编辑动态（仅在24小时内可用）
                    val editPermission = PostEditPolicy.canEdit(post, myDid)
                    if (editPermission is EditPermission.Allowed) {
                        ListItem(
                            headlineContent = { Text("编辑") },
                            supportingContent = {
                                Text(
                                    "剩余: ${PostEditPolicy.formatRemainingTime(editPermission.remainingTime)}",
                                    style = MaterialTheme.typography.labelSmall
                                )
                            },
                            leadingContent = { Icon(Icons.Default.Edit, contentDescription = null) },
                            modifier = Modifier.clickable {
                                viewModel.hidePostMenu()
                                onNavigateToEditPost(post.id)
                            }
                        )
                    }

                    // 查看编辑历史（仅当动态已编辑时显示）
                    if (PostEditPolicy.isEdited(post)) {
                        ListItem(
                            headlineContent = { Text("查看编辑历史") },
                            leadingContent = { Icon(Icons.Default.History, contentDescription = null) },
                            modifier = Modifier.clickable {
                                viewModel.hidePostMenu()
                                editHistoryPost = post
                                // 加载编辑历史
                                coroutineScope.launch {
                                    viewModel.getPostEditHistory(post.id)
                                        .collect { result ->
                                            when (result) {
                                                is Result.Success -> {
                                                    editHistories = result.data
                                                    showEditHistoryDialog = true
                                                }
                                                is Result.Error -> {
                                                    snackbarHostState.showSnackbar("加载编辑历史失败")
                                                }
                                                is Result.Loading -> {}
                                            }
                                        }
                                }
                            }
                        )
                    }

                    Divider()

                    ListItem(
                        headlineContent = { Text("删除") },
                        leadingContent = { Icon(Icons.Default.Delete, contentDescription = null) },
                        modifier = Modifier.clickable {
                            viewModel.hidePostMenu()
                            viewModel.deletePost(post.id)
                        }
                    )
                } else {
                    // 其他人的动态操作
                    ListItem(
                        headlineContent = { Text("举报") },
                        leadingContent = { Icon(Icons.Default.Report, contentDescription = null) },
                        modifier = Modifier.clickable {
                            viewModel.hidePostMenu()
                            reportTargetPost = post
                            showReportDialog = true
                        }
                    )

                    ListItem(
                        headlineContent = { Text("屏蔽该用户") },
                        leadingContent = { Icon(Icons.Default.Block, contentDescription = null) },
                        modifier = Modifier.clickable {
                            viewModel.hidePostMenu()
                            viewModel.blockUserFromPost(post.authorDid)
                        }
                    )
                }
            }
        }
    }

    // 举报对话框
    if (showReportDialog && reportTargetPost != null) {
        ReportDialog(
            onDismiss = {
                showReportDialog = false
                reportTargetPost = null
            },
            onConfirm = { reason, description ->
                viewModel.reportPost(reportTargetPost!!.id, myDid, reason, description)
                showReportDialog = false
                reportTargetPost = null
            }
        )
    }

    // 编辑历史对话框
    if (showEditHistoryDialog) {
        EditHistoryDialog(
            editHistories = editHistories,
            onDismiss = {
                showEditHistoryDialog = false
                editHistoryPost = null
                editHistories = emptyList()
            },
            onViewVersion = { history ->
                selectedVersion = history
                showVersionDialog = true
            }
        )
    }

    // 历史版本详情对话框
    if (showVersionDialog && selectedVersion != null) {
        HistoryVersionDialog(
            history = selectedVersion!!,
            onDismiss = {
                showVersionDialog = false
                selectedVersion = null
            }
        )
    }
}

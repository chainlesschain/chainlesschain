package com.chainlesschain.android.feature.p2p.ui.social

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.core.ui.components.EmptyState
import com.chainlesschain.android.core.ui.components.LoadingState
import com.chainlesschain.android.feature.p2p.ui.social.components.PostCard
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
    viewModel: PostViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val listState = rememberLazyListState()
    val snackbarHostState = remember { SnackbarHostState() }
    val coroutineScope = rememberCoroutineScope()

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
                        message = "还没有动态",
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
                                onLikeClick = { viewModel.toggleLike(post.id, post.isLiked) },
                                onCommentClick = {
                                    onNavigateToPostDetail(post.id)
                                },
                                onShareClick = {
                                    // TODO: 分享功能
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

                    ListItem(
                        headlineContent = { Text("编辑") },
                        leadingContent = { Icon(Icons.Default.Edit, contentDescription = null) },
                        modifier = Modifier.clickable {
                            viewModel.hidePostMenu()
                            // TODO: 导航到编辑页面
                        }
                    )

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
                            // TODO: 举报功能
                        }
                    )

                    ListItem(
                        headlineContent = { Text("屏蔽该用户") },
                        leadingContent = { Icon(Icons.Default.Block, contentDescription = null) },
                        modifier = Modifier.clickable {
                            viewModel.hidePostMenu()
                            // TODO: 屏蔽用户
                        }
                    )
                }
            }
        }
    }
}

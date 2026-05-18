package com.chainlesschain.android.presentation.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.R
import com.chainlesschain.android.feature.p2p.ui.social.FriendListScreen
import com.chainlesschain.android.feature.p2p.ui.social.NotificationCenterScreen
import com.chainlesschain.android.feature.p2p.ui.social.TimelineScreen
import com.chainlesschain.android.feature.p2p.viewmodel.DIDViewModel
import com.chainlesschain.android.feature.p2p.viewmodel.social.FriendViewModel

@Composable
fun SocialScreen(
    onNavigateToFriendDetail: (String) -> Unit = {},
    onNavigateToAddFriend: () -> Unit = {},
    onNavigateToPublishPost: () -> Unit = {},
    onNavigateToPostDetail: (String) -> Unit = {},
    onNavigateToUserProfile: (String) -> Unit = {},
    onNavigateToEditPost: (String) -> Unit = {},
    onNavigateToComment: (String) -> Unit = {},
    onNavigateToBlockedUsers: () -> Unit = {},
    onNavigateToP2PChat: () -> Unit = {}
) {
    val context = LocalContext.current
    var selectedTab by rememberSaveable { mutableStateOf(0) }
    val tabs = listOf(
        context.getString(R.string.social_tab_friends),
        context.getString(R.string.social_tab_timeline),
        context.getString(R.string.social_tab_notifications)
    )

    // 共享 ViewModel：Friends tab 列表数据 + Timeline tab 计算 friendDids 都用这一份。
    val friendViewModel: FriendViewModel = hiltViewModel()
    val didViewModel: DIDViewModel = hiltViewModel()
    val friendUiState by friendViewModel.uiState.collectAsState()
    val didDocument by didViewModel.didDocument.collectAsState()
    val myDid = didDocument?.id

    Scaffold { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            TabRow(selectedTabIndex = selectedTab) {
                tabs.forEachIndexed { index, label ->
                    Tab(
                        selected = selectedTab == index,
                        onClick = { selectedTab = index },
                        text = { Text(label) }
                    )
                }
            }

            Box(modifier = Modifier.fillMaxSize()) {
                when (selectedTab) {
                    0 -> {
                        Column(modifier = Modifier.fillMaxSize()) {
                            // P2P 聊天入口（顶部 CTA，保留旧 demo 入口避免功能回退）
                            Card(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(horizontal = 16.dp, vertical = 8.dp)
                                    .clickable(onClick = onNavigateToP2PChat),
                                colors = CardDefaults.cardColors(
                                    containerColor = MaterialTheme.colorScheme.surfaceVariant
                                )
                            ) {
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(16.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                                ) {
                                    Icon(
                                        imageVector = Icons.AutoMirrored.Filled.Chat,
                                        contentDescription = null,
                                        tint = MaterialTheme.colorScheme.primary,
                                        modifier = Modifier.size(24.dp)
                                    )
                                    Text(
                                        text = context.getString(R.string.p2p_chat_title),
                                        style = MaterialTheme.typography.bodyLarge,
                                        modifier = Modifier.weight(1f)
                                    )
                                    Icon(
                                        imageVector = Icons.Default.ChevronRight,
                                        contentDescription = null,
                                        tint = MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                }
                            }
                            // 嵌入到 tab：好友列表只暴露子集，onNavigateBack 是 no-op（不可见的返回箭头本来就没出现在 FriendListScreen TopAppBar 里）。
                            FriendListScreen(
                                onNavigateBack = {},
                                onNavigateToFriendDetail = onNavigateToFriendDetail,
                                onNavigateToAddFriend = onNavigateToAddFriend,
                                onNavigateToBlockedUsers = onNavigateToBlockedUsers,
                                viewModel = friendViewModel
                            )
                        }
                    }
                    1 -> {
                        val resolvedMyDid = myDid
                        if (resolvedMyDid.isNullOrBlank()) {
                            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                                CircularProgressIndicator()
                            }
                        } else {
                            TimelineScreen(
                                myDid = resolvedMyDid,
                                friendDids = friendUiState.friends.map { it.did },
                                onNavigateToPublishPost = onNavigateToPublishPost,
                                onNavigateToPostDetail = onNavigateToPostDetail,
                                onNavigateToUserProfile = onNavigateToUserProfile,
                                onNavigateToEditPost = onNavigateToEditPost
                            )
                        }
                    }
                    2 -> NotificationCenterScreen(
                        onNavigateBack = {},
                        onNavigateToFriendRequest = onNavigateToFriendDetail,
                        onNavigateToFriendProfile = onNavigateToUserProfile,
                        onNavigateToPost = onNavigateToPostDetail,
                        onNavigateToComment = onNavigateToComment
                    )
                }
            }
        }
    }
}


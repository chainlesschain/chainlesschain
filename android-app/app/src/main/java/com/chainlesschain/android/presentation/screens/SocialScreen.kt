package com.chainlesschain.android.presentation.screens

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.feature.p2p.ui.social.FriendListScreen
import com.chainlesschain.android.feature.p2p.ui.social.TimelineScreen
import com.chainlesschain.android.feature.p2p.ui.social.NotificationCenterScreen
import com.chainlesschain.android.feature.p2p.viewmodel.social.NotificationViewModel

/**
 * 社交页面容器
 *
 * 包含三个子 tab：好友、动态、通知
 */
@Composable
fun SocialScreen(
    onNavigateToFriendDetail: (String) -> Unit = {},
    onNavigateToAddFriend: () -> Unit = {},
    onNavigateToPublishPost: () -> Unit = {},
    onNavigateToPostDetail: (String) -> Unit = {},
    onNavigateToUserProfile: (String) -> Unit = {},
    onNavigateToComment: (String) -> Unit = {},
    myDid: String = "did:example:123456", // TODO: 从实际的 DID 服务获取
    friendDids: List<String> = emptyList(), // TODO: 从好友列表获取
    notificationViewModel: NotificationViewModel = hiltViewModel()
) {
    var selectedTab by rememberSaveable { mutableStateOf(1) } // 默认显示动态
    val unreadCount by notificationViewModel.uiState.collectAsState()

    Scaffold(
        topBar = {
            SocialTopBar(
                selectedTab = selectedTab,
                onTabSelected = { selectedTab = it },
                unreadCount = unreadCount.unreadCount
            )
        }
    ) { paddingValues ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            when (selectedTab) {
                0 -> key("friends") {
                    FriendListScreen(
                        onNavigateBack = { /* 在主容器中不需要返回 */ },
                        onNavigateToFriendDetail = onNavigateToFriendDetail,
                        onNavigateToAddFriend = onNavigateToAddFriend
                    )
                }
                1 -> key("timeline") {
                    TimelineScreen(
                        myDid = myDid,
                        friendDids = friendDids,
                        onNavigateToPublishPost = onNavigateToPublishPost,
                        onNavigateToPostDetail = onNavigateToPostDetail,
                        onNavigateToUserProfile = onNavigateToUserProfile
                    )
                }
                2 -> key("notifications") {
                    NotificationCenterScreen(
                        onNavigateBack = { /* 在主容器中不需要返回 */ },
                        onNavigateToFriendRequest = onNavigateToUserProfile,
                        onNavigateToFriendProfile = onNavigateToUserProfile,
                        onNavigateToPost = onNavigateToPostDetail,
                        onNavigateToComment = onNavigateToComment
                    )
                }
            }
        }
    }
}

/**
 * 社交页面顶部栏（带 Tab）
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SocialTopBar(
    selectedTab: Int,
    onTabSelected: (Int) -> Unit,
    unreadCount: Int
) {
    val tabs = listOf(
        SocialTab("好友", Icons.Filled.People, Icons.Outlined.People),
        SocialTab("动态", Icons.Filled.Article, Icons.Outlined.Article),
        SocialTab("通知", Icons.Filled.Notifications, Icons.Outlined.Notifications)
    )

    Column {
        TopAppBar(
            title = { Text("社交") }
        )

        TabRow(
            selectedTabIndex = selectedTab
        ) {
            tabs.forEachIndexed { index, tab ->
                Tab(
                    selected = selectedTab == index,
                    onClick = { onTabSelected(index) },
                    text = { Text(tab.label) },
                    icon = {
                        if (index == 2 && unreadCount > 0) {
                            // 通知 tab 显示未读徽章
                            BadgedBox(
                                badge = {
                                    Badge {
                                        Text(if (unreadCount > 99) "99+" else unreadCount.toString())
                                    }
                                }
                            ) {
                                Icon(
                                    imageVector = if (selectedTab == index) {
                                        tab.selectedIcon
                                    } else {
                                        tab.unselectedIcon
                                    },
                                    contentDescription = tab.label
                                )
                            }
                        } else {
                            Icon(
                                imageVector = if (selectedTab == index) {
                                    tab.selectedIcon
                                } else {
                                    tab.unselectedIcon
                                },
                                contentDescription = tab.label
                            )
                        }
                    }
                )
            }
        }
    }
}

/**
 * 社交 Tab 数据类
 */
private data class SocialTab(
    val label: String,
    val selectedIcon: ImageVector,
    val unselectedIcon: ImageVector
)

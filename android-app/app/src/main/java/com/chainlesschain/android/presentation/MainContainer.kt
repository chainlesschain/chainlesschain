package com.chainlesschain.android.presentation

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.layout.imePadding
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarHost
import com.chainlesschain.android.feature.auth.presentation.AuthViewModel
import com.chainlesschain.android.feature.familyguard.domain.model.selectedRole
import com.chainlesschain.android.feature.familyguard.presentation.role.RoleSelectorViewModel
import com.chainlesschain.android.feature.familyguard.presentation.shell.FamilyGuardTab
import com.chainlesschain.android.feature.p2p.viewmodel.social.NotificationViewModel
import com.chainlesschain.android.presentation.components.BottomNavigationBar
import com.chainlesschain.android.presentation.components.BottomTab
import com.chainlesschain.android.presentation.components.allBottomNavItems
import com.chainlesschain.android.presentation.screens.*
import kotlinx.coroutines.launch
import com.chainlesschain.android.update.UpdateViewModel

/**
 * 主容器，包含底部导航栏和各个页面
 * 4个tab: 首页、项目、社交、个人中心
 *
 * 性能优化：
 * 1. 使用 rememberSaveable 保存 Tab 状态（进程终止后恢复）
 * 2. 使用 key 参数优化 when 分支重组
 * 3. 提取回调函数避免重复创建 lambda
 */
@Composable
fun MainContainer(
    onLogout: () -> Unit,
    onNavigateToKnowledgeList: () -> Unit = {},
    onNavigateToAIChat: () -> Unit = {},
    onNavigateToAiStudy: () -> Unit = {},
    onNavigateToTasks: () -> Unit = {},
    onNavigateToRewards: () -> Unit = {},
    onNavigateToGentleness: () -> Unit = {},
    onNavigateToPairing: () -> Unit = {},
    onNavigateToMistakeBook: () -> Unit = {},
    onNavigateToChildActivity: () -> Unit = {},
    onNavigateToChildSelection: () -> Unit = {},
    onNavigateToAIChatWithMessage: (String) -> Unit = {},
    onNavigateToConversation: (String) -> Unit = {},
    onNavigateToProjectDetail: (String) -> Unit = {},
    onNavigateToFriendDetail: (String) -> Unit = {},
    onNavigateToAddFriend: () -> Unit = {},
    onNavigateToPublishPost: () -> Unit = {},
    onNavigateToPostDetail: (String) -> Unit = {},
    onNavigateToUserProfile: (String) -> Unit = {},
    onNavigateToEditPost: (String) -> Unit = {},
    onNavigateToComment: (String) -> Unit = {},
    onNavigateToBlockedUsers: () -> Unit = {},
    onNavigateToMyQRCode: () -> Unit = {},
    onNavigateToQRScanner: () -> Unit = {},
    onNavigateToLLMSettings: () -> Unit = {},
    onNavigateToUsageStatistics: () -> Unit = {},
    onNavigateToLLMTest: () -> Unit = {},
    onNavigateToCcChat: () -> Unit = {},
    onNavigateToPdhChat: () -> Unit = {},
    onNavigateToFileBrowser: () -> Unit = {},
    onNavigateToRemoteProjectBrowser: () -> Unit = {},
    onNavigateToRemoteControl: () -> Unit = {},
    onNavigateToLocalTerminal: () -> Unit = {},
    onNavigateToP2P: () -> Unit = {},
    onNavigateToLocalDataHub: () -> Unit = {},
    // 2026-05-24 — PDH 第 6 tab "数据浏览" (vault browser) 快捷入口
    onNavigateToPdhBrowser: () -> Unit = {},
    // 2026-05-24 — 首页 RAG inline sheet「查看详情」→ PDH tab 4 + 自动 submit
    onNavigateToPdhAsk: (question: String) -> Unit = {},
    // 2026-05-24 — 首页 row2 cell 1 替代社交广场的本机模型入口
    onNavigateToLocalModel: () -> Unit = {},
    onNavigateToScanDesktopPairing: () -> Unit = {},
    onNavigateToRemoteOperate: (String) -> Unit = {},
    onNavigateToSettings: () -> Unit = {},
    onNavigateToAbout: () -> Unit = {},
    onNavigateToHelpFeedback: () -> Unit = {},
    onNavigateToP2PChatSessionList: () -> Unit = {},
    viewModel: AuthViewModel = hiltViewModel(),
    notificationViewModel: NotificationViewModel = hiltViewModel(),
    // 2026-05-24 — 首页 更多 sheet "版本更新" 直接 trigger checkForUpdates；
    // 把 VM + 对话框 host 在 MainContainer 顶层，任何子 tab 都能弹同一份 UpdateDialog。
    updateViewModel: UpdateViewModel = hiltViewModel(),
    // B 方案 — 家庭 / AI 陪学 tab 按本机角色动态显隐。复用 RoleSelectorViewModel
    // 暴露的 lockState (它已 @HiltViewModel + observeLockState)，此处仅读不写。
    roleViewModel: RoleSelectorViewModel = hiltViewModel(),
) {
    // 使用 rememberSaveable 保存状态（进程重建后恢复）。以 BottomTab key 记忆,
    // 不用裸 Int —— 家庭 tab 动态显隐会改变列表长度, 裸索引会错位。
    var selectedTab by rememberSaveable { mutableStateOf(BottomTab.HOME) }
    var showProfileDialog by rememberSaveable { mutableStateOf(false) }
    val notificationState by notificationViewModel.uiState.collectAsState()

    // B 方案: 角色已选 (PARENT/CHILD) 才在底部栏显家庭 tab; 未选角色时隐藏。
    // forceShowFamily: 用户从首页「更多功能 → AI 陪学」进入时一次性放行 (本会话),
    // 让未选角色的用户也能进入 shell 完成角色设置 —— 设好角色后即转为 role 驱动常显。
    val roleLockState by roleViewModel.lockState.collectAsState()
    var forceShowFamily by rememberSaveable { mutableStateOf(false) }
    val showFamilyTab = roleLockState.selectedRole() != null || forceShowFamily
    val bottomNavItems = remember(showFamilyTab) {
        if (showFamilyTab) allBottomNavItems
        else allBottomNavItems.filter { it.tab != BottomTab.FAMILY }
    }

    // 家庭 tab 在停留时被隐藏 (例如清除数据后角色回到 Unselected) → 回落首页, 避免
    // selectedTab 卡在一个导航栏里已不存在的 tab。
    LaunchedEffect(showFamilyTab) {
        if (!showFamilyTab && selectedTab == BottomTab.FAMILY) {
            selectedTab = BottomTab.HOME
        }
    }

    // 首页「更多功能 → AI 陪学」入口: 放行并切到家庭 / AI 陪学 shell。
    val onOpenAiStudyHub = remember {
        {
            forceShowFamily = true
            selectedTab = BottomTab.FAMILY
        }
    }

    // 提取回调函数，避免重复创建 lambda（减少重组）
    val onProfileClick = remember {
        { showProfileDialog = true }
    }

    val onDismissDialog = remember {
        { showProfileDialog = false }
    }

    val onLogoutClick = remember(onLogout) {
        {
            showProfileDialog = false
            onLogout()
        }
    }

    // FAMILY-06: SOS placeholder snackbar; FAMILY-40 接通真触发流程后改回调。
    val snackbarHostState = remember { SnackbarHostState() }
    val coroutineScope = rememberCoroutineScope()

    Scaffold(
        bottomBar = {
            BottomNavigationBar(
                items = bottomNavItems,
                selectedTab = selectedTab,
                onTabSelected = { selectedTab = it },
                socialUnreadCount = notificationState.unreadCount
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) }
    ) { paddingValues ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .imePadding()
        ) {
            // 使用 key 优化重组，确保正确的 Composable 对应正确的 Tab
            when (selectedTab) {
                BottomTab.HOME -> key("home") {
                    NewHomeScreen(
                        viewModel = viewModel,
                        onProfileClick = onProfileClick,
                        onNavigateToUsageStatistics = onNavigateToUsageStatistics,
                        onNavigateToKnowledgeList = onNavigateToKnowledgeList,
                        onNavigateToAIChat = onNavigateToAIChat,
                        onNavigateToAIChatWithMessage = onNavigateToAIChatWithMessage,
                        onNavigateToConversation = onNavigateToConversation,
                        onNavigateToLLMSettings = onNavigateToLLMSettings,
                        onNavigateToSocialFeed = { selectedTab = BottomTab.SOCIAL },  // 切换到社交tab
                        onNavigateToMyQRCode = onNavigateToMyQRCode,
                        onNavigateToQRScanner = onNavigateToQRScanner,
                        onNavigateToProjectTab = { selectedTab = BottomTab.PROJECT },  // 切换到项目tab
                        // 「更多功能 → AI 陪学」入口: 进家庭 / AI 陪学 shell (B 方案下 tab 隐藏时的常驻入口)
                        onNavigateToAiStudyHub = onOpenAiStudyHub,
                        onNavigateToFileBrowser = onNavigateToFileBrowser,
                        onNavigateToRemoteControl = onNavigateToRemoteControl,
                        onNavigateToLocalTerminal = onNavigateToLocalTerminal,
                        onNavigateToP2P = onNavigateToP2P,  // P2P设备管理
                        onNavigateToLocalDataHub = onNavigateToLocalDataHub,
                        onNavigateToPdhBrowser = onNavigateToPdhBrowser,
                        onNavigateToLocalModel = onNavigateToLocalModel,
                        onCheckForUpdates = { updateViewModel.checkForUpdates(silent = false) },
                        onNavigateToScanDesktopPairing = onNavigateToScanDesktopPairing,
                        onNavigateToRemoteOperate = onNavigateToRemoteOperate,
                        onNavigateToPdhAsk = onNavigateToPdhAsk,
                        socialUnreadCount = notificationState.unreadCount
                    )
                }
                BottomTab.PROJECT -> key("project") {
                    ProjectScreen(
                        onProjectClick = onNavigateToProjectDetail,
                        onNavigateToFileBrowser = onNavigateToFileBrowser,
                        onNavigateToRemoteProjectBrowser = onNavigateToRemoteProjectBrowser,
                        authViewModel = viewModel  // 传递共享的AuthViewModel实例
                    )
                }
                BottomTab.SOCIAL -> key("social") {
                    SocialScreen(
                        onNavigateToFriendDetail = onNavigateToFriendDetail,
                        onNavigateToAddFriend = onNavigateToAddFriend,
                        onNavigateToPublishPost = onNavigateToPublishPost,
                        onNavigateToPostDetail = onNavigateToPostDetail,
                        onNavigateToUserProfile = onNavigateToUserProfile,
                        onNavigateToEditPost = onNavigateToEditPost,
                        onNavigateToComment = onNavigateToComment,
                        onNavigateToBlockedUsers = onNavigateToBlockedUsers,
                        onNavigateToP2PChat = onNavigateToP2PChatSessionList
                    )
                }
                // FAMILY-06: 家庭 tab. B 方案下按本机角色动态显隐 (见 showFamilyTab)。
                // FamilyShellScreen 自 :feature-family-guard. v0.1: SOS click →
                // snackbar 占位; FAMILY-40 接通真触发流程 (sos_event upsert + 录音 + broadcast call)。
                BottomTab.FAMILY -> key("family_guard") {
                    FamilyGuardTab(
                        onNavigateToPairing = onNavigateToPairing,
                        onNavigateToAiStudy = onNavigateToAiStudy,
                        onNavigateToTasks = onNavigateToTasks,
                        onNavigateToRewards = onNavigateToRewards,
                        onNavigateToGentleness = onNavigateToGentleness,
                        onNavigateToMistakeBook = onNavigateToMistakeBook,
                        onNavigateToChildActivity = onNavigateToChildActivity,
                        onNavigateToChildSelection = onNavigateToChildSelection,
                        onSosTriggered = {
                            coroutineScope.launch {
                                snackbarHostState.showSnackbar(
                                    message = "SOS 触发流程将在 FAMILY-40 接通; v0.1 仅为占位",
                                )
                            }
                        },
                    )
                }
                BottomTab.PROFILE -> key("profile") {
                    ProfileScreen(
                        onLogout = onLogout,
                        onNavigateToLLMSettings = onNavigateToLLMSettings,
                        onNavigateToUsageStatistics = onNavigateToUsageStatistics,
                        onNavigateToKnowledgeList = onNavigateToKnowledgeList,
                        onNavigateToAIChat = onNavigateToAIChat,
                        onNavigateToP2P = onNavigateToP2P,
                        onNavigateToSettings = onNavigateToSettings,
                        onNavigateToAbout = onNavigateToAbout,
                        onNavigateToHelpFeedback = onNavigateToHelpFeedback,
                        viewModel = viewModel
                    )
                }
            }
        }
    }

    // 顶层 UpdateDialog —— state-driven，触发后任何 tab 都能弹出。
    // 由 FunctionEntryGrid 更多 sheet 的 "版本更新" / SettingsScreen 的 "检查更新" 共同驱动。
    UpdateDialog(viewModel = updateViewModel)

    // 个人资料弹窗（从首页头像点击打开）
    if (showProfileDialog) {
        ProfileDialog(
            onDismiss = onDismissDialog,
            onLogout = onLogoutClick,
            onNavigateToLLMSettings = {
                showProfileDialog = false
                onNavigateToLLMSettings()
            },
            onNavigateToLLMTest = {
                showProfileDialog = false
                onNavigateToLLMTest()
            },
            onNavigateToCcChat = {
                showProfileDialog = false
                onNavigateToCcChat()
            },
            onNavigateToPdhChat = {
                showProfileDialog = false
                onNavigateToPdhChat()
            },
            onNavigateToKnowledgeList = {
                showProfileDialog = false
                onNavigateToKnowledgeList()
            },
            onNavigateToAIChat = {
                showProfileDialog = false
                onNavigateToAIChat()
            },
            onNavigateToP2P = {
                showProfileDialog = false
                onNavigateToP2P()
            },
            onNavigateToSettings = {
                showProfileDialog = false
                onNavigateToSettings()
            },
            onNavigateToAbout = {
                showProfileDialog = false
                onNavigateToAbout()
            },
            onNavigateToHelpFeedback = {
                showProfileDialog = false
                onNavigateToHelpFeedback()
            },
            viewModel = viewModel
        )
    }
}

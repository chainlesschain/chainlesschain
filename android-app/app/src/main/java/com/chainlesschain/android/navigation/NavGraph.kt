package com.chainlesschain.android.navigation

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.NavType
import androidx.navigation.navArgument
import com.chainlesschain.android.feature.auth.presentation.AuthViewModel
import com.chainlesschain.android.feature.auth.presentation.LoginScreen
import com.chainlesschain.android.feature.auth.presentation.SetupPinScreen
import com.chainlesschain.android.feature.knowledge.presentation.KnowledgeEditorScreen
import com.chainlesschain.android.feature.knowledge.presentation.KnowledgeListScreen
import com.chainlesschain.android.feature.ai.presentation.ConversationListScreen
import com.chainlesschain.android.feature.ai.presentation.ChatScreen
import com.chainlesschain.android.feature.ai.presentation.NewConversationScreen
import com.chainlesschain.android.presentation.HomeScreen
import com.chainlesschain.android.presentation.MainContainer
import com.chainlesschain.android.presentation.screens.ProjectDetailScreenV2
import com.chainlesschain.android.presentation.screens.StepDetailScreen
import com.chainlesschain.android.presentation.screens.LLMTestChatScreen
import com.chainlesschain.android.feature.ai.presentation.settings.LLMSettingsScreen
import com.chainlesschain.android.feature.ai.presentation.usage.UsageStatisticsScreen
import com.chainlesschain.android.feature.ai.domain.model.LLMProvider
import com.chainlesschain.android.feature.p2p.navigation.p2pGraph
import com.chainlesschain.android.feature.p2p.navigation.P2P_ROUTE
import com.chainlesschain.android.feature.p2p.ui.social.PostDetailScreen
import com.chainlesschain.android.feature.p2p.ui.social.PublishPostScreen
import com.chainlesschain.android.feature.p2p.ui.social.MyQRCodeScreen
import com.chainlesschain.android.feature.p2p.ui.social.QRCodeScannerScreen
import com.chainlesschain.android.feature.p2p.ui.social.EditPostScreen
import com.chainlesschain.android.feature.filebrowser.ui.SafeFileBrowserScreen

/**
 * 应用导航图
 */
@Composable
fun NavGraph(
    navController: NavHostController,
    startDestination: String,
    authViewModel: AuthViewModel
) {
    NavHost(
        navController = navController,
        startDestination = startDestination
    ) {
        // 设置PIN码界面
        composable(route = Screen.SetupPin.route) {
            SetupPinScreen(
                viewModel = authViewModel,  // 传递共享的AuthViewModel
                onSetupComplete = {
                    navController.navigate(Screen.Home.route) {
                        popUpTo(Screen.SetupPin.route) { inclusive = true }
                    }
                }
            )
        }

        // 登录界面
        composable(route = Screen.Login.route) {
            LoginScreen(
                viewModel = authViewModel,  // 传递共享的AuthViewModel
                onLoginSuccess = {
                    navController.navigate(Screen.Home.route) {
                        popUpTo(Screen.Login.route) { inclusive = true }
                    }
                }
            )
        }

        // 主界面（使用新的MainContainer）
        composable(route = Screen.Home.route) {
            MainContainer(
                viewModel = authViewModel,  // 传递共享的AuthViewModel
                onLogout = {
                    navController.navigate(Screen.Login.route) {
                        popUpTo(Screen.Home.route) { inclusive = true }
                    }
                },
                // 知识库管理功能
                onNavigateToKnowledgeList = {
                    navController.navigate(Screen.KnowledgeList.route)
                },
                onNavigateToAIChat = {
                    navController.navigate(Screen.ConversationList.route)
                },
                // 项目管理功能
                onNavigateToProjectDetail = { projectId ->
                    navController.navigate(Screen.ProjectDetail.createRoute(projectId))
                },
                // 社交功能
                onNavigateToFriendDetail = { did ->
                    navController.navigate(Screen.FriendDetail.createRoute(did))
                },
                onNavigateToAddFriend = {
                    navController.navigate(Screen.AddFriend.route)
                },
                onNavigateToPublishPost = {
                    navController.navigate(Screen.PublishPost.route)
                },
                onNavigateToPostDetail = { postId ->
                    navController.navigate(Screen.PostDetail.createRoute(postId))
                },
                onNavigateToUserProfile = { did ->
                    navController.navigate(Screen.UserProfile.createRoute(did))
                },
                onNavigateToEditPost = { postId ->
                    navController.navigate(Screen.EditPost.createRoute(postId))
                },
                onNavigateToComment = { commentId ->
                    navController.navigate(Screen.CommentDetail.createRoute(commentId))
                },
                onNavigateToMyQRCode = {
                    navController.navigate(Screen.MyQRCode.route)
                },
                onNavigateToQRScanner = {
                    navController.navigate(Screen.QRCodeScanner.route)
                },
                // LLM 和系统功能
                onNavigateToLLMSettings = {
                    navController.navigate(Screen.LLMSettings.route)
                },
                onNavigateToLLMTest = {
                    navController.navigate(Screen.LLMTest.route)
                },
                onNavigateToFileBrowser = {
                    navController.navigate(Screen.FileBrowser.route)
                },
                onNavigateToRemoteControl = {
                    navController.navigate(Screen.RemoteControl.route)
                }
            )
        }

        // 知识库列表
        composable(route = Screen.KnowledgeList.route) {
            KnowledgeListScreen(
                onItemClick = { itemId ->
                    navController.navigate(Screen.KnowledgeEditor.createRoute(itemId))
                },
                onAddClick = {
                    navController.navigate(Screen.KnowledgeEditor.route)
                }
            )
        }

        // 知识库编辑器（新建）
        composable(route = Screen.KnowledgeEditor.route) {
            KnowledgeEditorScreen(
                onNavigateBack = {
                    navController.popBackStack()
                }
            )
        }

        // 知识库编辑器（编辑）
        composable(
            route = "${Screen.KnowledgeEditor.route}/{itemId}",
            arguments = listOf(
                navArgument("itemId") { type = NavType.StringType }
            )
        ) { backStackEntry ->
            val itemId = backStackEntry.arguments?.getString("itemId")
            KnowledgeEditorScreen(
                itemId = itemId,
                onNavigateBack = {
                    navController.popBackStack()
                }
            )
        }

        // AI对话列表
        composable(route = Screen.ConversationList.route) {
            ConversationListScreen(
                onConversationClick = { conversationId ->
                    navController.navigate(Screen.Chat.createRoute(conversationId))
                },
                onNewConversation = {
                    navController.navigate(Screen.NewConversation.route)
                },
                onSettings = {
                    navController.navigate(Screen.AISettings.route)
                }
            )
        }

        // 新建对话
        composable(route = Screen.NewConversation.route) {
            NewConversationScreen(
                onNavigateBack = {
                    navController.popBackStack()
                },
                onConversationCreated = { conversationId ->
                    navController.navigate(Screen.Chat.createRoute(conversationId)) {
                        popUpTo(Screen.ConversationList.route)
                    }
                }
            )
        }

        // 聊天界面
        composable(
            route = "${Screen.Chat.route}/{conversationId}",
            arguments = listOf(
                navArgument("conversationId") { type = NavType.StringType }
            )
        ) { backStackEntry ->
            val conversationId = backStackEntry.arguments?.getString("conversationId") ?: return@composable
            ChatScreen(
                conversationId = conversationId,
                onNavigateBack = {
                    navController.popBackStack()
                },
                onSettings = {
                    // TODO: Navigate to conversation settings
                }
            )
        }

        // AI设置界面（占位）
        composable(route = Screen.AISettings.route) {
            AISettingsPlaceholder(
                onNavigateBack = {
                    navController.popBackStack()
                }
            )
        }

        // P2P 功能导航图
        p2pGraph(
            navController = navController,
            onNavigateToChat = { deviceId ->
                // TODO: Navigate to P2P chat screen when implemented
                // For now, just navigate to AI chat as placeholder
                navController.navigate(Screen.ConversationList.route)
            }
        )

        // 项目详情页 V2
        composable(
            route = "${Screen.ProjectDetail.route}/{projectId}",
            arguments = listOf(
                navArgument("projectId") { type = NavType.StringType }
            )
        ) { backStackEntry ->
            val projectId = backStackEntry.arguments?.getString("projectId") ?: return@composable
            ProjectDetailScreenV2(
                projectId = projectId,
                onNavigateBack = {
                    navController.popBackStack()
                },
                onNavigateToSteps = { id ->
                    navController.navigate(Screen.StepDetail.createRoute(id))
                },
                onNavigateToFileBrowser = { id ->
                    navController.navigate(Screen.FileBrowser.createRoute(id))
                }
            )
        }

        // 步骤详情页
        composable(
            route = "${Screen.StepDetail.route}/{projectId}",
            arguments = listOf(
                navArgument("projectId") { type = NavType.StringType }
            )
        ) { backStackEntry ->
            val projectId = backStackEntry.arguments?.getString("projectId") ?: return@composable
            StepDetailScreen(
                projectId = projectId,
                onNavigateBack = {
                    navController.popBackStack()
                }
            )
        }

        // ===== LLM功能路由 =====

        // LLM设置界面
        composable(route = Screen.LLMSettings.route) {
            LLMSettingsScreen(
                onNavigateBack = {
                    navController.popBackStack()
                },
                onNavigateToUsageStatistics = {
                    navController.navigate(Screen.UsageStatistics.route)
                }
            )
        }

        // Token使用统计界面
        composable(route = Screen.UsageStatistics.route) {
            UsageStatisticsScreen(
                onNavigateBack = {
                    navController.popBackStack()
                }
            )
        }

        // LLM测试对话界面
        composable(route = Screen.LLMTest.route) {
            LLMTestChatScreen(
                onNavigateBack = {
                    navController.popBackStack()
                },
                provider = LLMProvider.DOUBAO  // 默认使用火山引擎
            )
        }

        // LLM测试对话界面（带提供商参数）
        composable(
            route = "${Screen.LLMTest.route}/{provider}",
            arguments = listOf(
                navArgument("provider") { type = NavType.StringType }
            )
        ) { backStackEntry ->
            val providerName = backStackEntry.arguments?.getString("provider") ?: "DOUBAO"
            val provider = try {
                LLMProvider.valueOf(providerName)
            } catch (e: Exception) {
                LLMProvider.DOUBAO
            }

            LLMTestChatScreen(
                onNavigateBack = {
                    navController.popBackStack()
                },
                provider = provider
            )
        }

        // 文件浏览器界面
        composable(
            route = Screen.FileBrowser.route,
            arguments = listOf(
                navArgument("projectId") {
                    type = NavType.StringType
                    nullable = true
                    defaultValue = null
                }
            )
        ) { backStackEntry ->
            val projectId = backStackEntry.arguments?.getString("projectId")

            // Get ProjectViewModel to fetch available projects
            val projectViewModel: com.chainlesschain.android.feature.project.viewmodel.ProjectViewModel = hiltViewModel()
            val authViewModel: AuthViewModel = hiltViewModel()
            val authState by authViewModel.uiState.collectAsState()
            val projectListState by projectViewModel.projectListState.collectAsState()

            // Load projects when screen launches
            LaunchedEffect(authState.currentUser) {
                authState.currentUser?.let { user ->
                    projectViewModel.setCurrentUser(user.id)
                }
            }

            // Extract projects from state
            val availableProjects = when (val state = projectListState) {
                is com.chainlesschain.android.feature.project.model.ProjectListState.Success -> state.projects.map { it.project }
                else -> emptyList()
            }

            SafeFileBrowserScreen(
                projectId = projectId,
                availableProjects = availableProjects,
                onNavigateBack = {
                    navController.popBackStack()
                },
                onFileImported = { fileId ->
                    // File imported successfully, could navigate back or show confirmation
                    // For now, just stay on the screen
                }
            )
        }

        // ===== 社交功能路由 =====

        // 发布动态页面
        composable(route = Screen.PublishPost.route) {
            PublishPostScreen(
                myDid = "did:example:123456", // TODO: 从实际的 DID 服务获取
                onNavigateBack = {
                    navController.popBackStack()
                }
            )
        }

        // 动态详情页面
        composable(
            route = "${Screen.PostDetail.route}/{postId}",
            arguments = listOf(
                navArgument("postId") { type = NavType.StringType }
            )
        ) { backStackEntry ->
            val postId = backStackEntry.arguments?.getString("postId") ?: return@composable
            PostDetailScreen(
                postId = postId,
                myDid = "did:example:123456", // TODO: 从实际的 DID 服务获取
                onNavigateBack = {
                    navController.popBackStack()
                },
                onNavigateToUserProfile = { did ->
                    navController.navigate(Screen.UserProfile.createRoute(did))
                }
            )
        }

        // 好友详情页面
        composable(
            route = "${Screen.FriendDetail.route}/{did}",
            arguments = listOf(
                navArgument("did") { type = NavType.StringType }
            )
        ) { backStackEntry ->
            val did = backStackEntry.arguments?.getString("did") ?: return@composable
            com.chainlesschain.android.feature.p2p.ui.social.FriendDetailScreen(
                onNavigateBack = {
                    navController.popBackStack()
                },
                onNavigateToPost = { postId ->
                    navController.navigate(Screen.PostDetail.createRoute(postId))
                },
                onNavigateToChat = { did ->
                    // TODO: Navigate to P2P chat when implemented
                    navController.navigate(Screen.ConversationList.route)
                }
            )
        }

        // 用户资料页面
        composable(
            route = "${Screen.UserProfile.route}/{did}",
            arguments = listOf(
                navArgument("did") { type = NavType.StringType }
            )
        ) { backStackEntry ->
            val did = backStackEntry.arguments?.getString("did") ?: return@composable
            com.chainlesschain.android.feature.p2p.ui.social.UserProfileScreen(
                onNavigateBack = {
                    navController.popBackStack()
                },
                onNavigateToPost = { postId ->
                    navController.navigate(Screen.PostDetail.createRoute(postId))
                },
                onNavigateToChat = { did ->
                    // TODO: Navigate to P2P chat when implemented
                    navController.navigate(Screen.ConversationList.route)
                }
            )
        }

        // 添加好友页面
        composable(route = Screen.AddFriend.route) {
            com.chainlesschain.android.feature.p2p.ui.social.AddFriendScreen(
                onNavigateBack = {
                    navController.popBackStack()
                },
                onNavigateToQRScanner = {
                    navController.navigate(Screen.QRCodeScanner.route)
                }
            )
        }

        // 评论详情页面
        composable(
            route = "${Screen.CommentDetail.route}/{commentId}",
            arguments = listOf(
                navArgument("commentId") { type = NavType.StringType }
            )
        ) { backStackEntry ->
            val commentId = backStackEntry.arguments?.getString("commentId") ?: return@composable
            com.chainlesschain.android.feature.p2p.ui.social.CommentDetailScreen(
                onNavigateBack = {
                    navController.popBackStack()
                },
                onNavigateToUserProfile = { did ->
                    navController.navigate(Screen.UserProfile.createRoute(did))
                }
            )
        }

        // ===== v0.31.0 新增功能 =====

        // 我的二维码页面
        composable(route = Screen.MyQRCode.route) {
            MyQRCodeScreen(
                onNavigateBack = {
                    navController.popBackStack()
                },
                onShowToast = { message ->
                    // TODO: 实现Toast显示（可以通过SnackbarHost或MainActivity处理）
                }
            )
        }

        // 二维码扫描页面
        composable(route = Screen.QRCodeScanner.route) {
            QRCodeScannerScreen(
                onNavigateBack = {
                    navController.popBackStack()
                },
                onQRCodeScanned = { qrCode ->
                    // 扫描成功，解析二维码内容并导航到对应页面
                    navController.popBackStack()

                    // 解析二维码URL
                    val uri = android.net.Uri.parse(qrCode)
                    when (uri.host) {
                        "add-friend" -> {
                            // 获取DID并导航到用户资料页面
                            val did = uri.getQueryParameter("did")
                            if (did != null) {
                                navController.navigate(Screen.UserProfile.createRoute(did))
                            }
                        }
                        "post" -> {
                            // 导航到动态详情页面
                            val postId = uri.getQueryParameter("id")
                            if (postId != null) {
                                navController.navigate(Screen.PostDetail.createRoute(postId))
                            }
                        }
                        "group" -> {
                            // TODO: 导航到群组页面（待实现）
                        }
                    }
                }
            )
        }

        // 编辑动态页面
        composable(
            route = "${Screen.EditPost.route}/{postId}",
            arguments = listOf(
                navArgument("postId") { type = NavType.StringType }
            )
        ) { backStackEntry ->
            val postId = backStackEntry.arguments?.getString("postId") ?: return@composable
            EditPostScreen(
                postId = postId,
                onNavigateBack = {
                    navController.popBackStack()
                },
                onPostUpdated = {
                    // 更新成功，可以刷新动态列表
                }
            )
        }

        // ===== 远程控制功能路由（Phase 2）=====
        // 注意：由于 WebRTC 依赖问题，远程控制功能暂时禁用
        // 待添加 WebRTC 依赖后恢复这些路由
        // 详见：android-app/QUICK_FIX_REMOTE_CONTROL.md

        /*
        // 远程控制主界面
        composable(route = Screen.RemoteControl.route) {
            com.chainlesschain.android.remote.ui.RemoteControlScreen(
                onNavigateToAIChat = {
                    navController.navigate(Screen.RemoteAIChat.route)
                },
                onNavigateToRAGSearch = {
                    navController.navigate(Screen.RemoteRAGSearch.route)
                },
                onNavigateToAgentControl = {
                    navController.navigate(Screen.RemoteAgentControl.route)
                },
                onNavigateToScreenshot = {
                    navController.navigate(Screen.RemoteScreenshot.route)
                },
                onNavigateToSystemMonitor = {
                    navController.navigate(Screen.RemoteSystemMonitor.route)
                },
                onNavigateToCommandHistory = {
                    navController.navigate(Screen.RemoteCommandHistory.route)
                }
            )
        }

        // 远程 AI 对话界面
        composable(route = Screen.RemoteAIChat.route) {
            com.chainlesschain.android.remote.ui.ai.RemoteAIChatScreen(
                onNavigateBack = {
                    navController.popBackStack()
                }
            )
        }

        // 远程 RAG 搜索界面
        composable(route = Screen.RemoteRAGSearch.route) {
            com.chainlesschain.android.remote.ui.ai.RemoteRAGSearchScreen(
                onNavigateBack = {
                    navController.popBackStack()
                }
            )
        }

        // 远程 Agent 控制界面
        composable(route = Screen.RemoteAgentControl.route) {
            com.chainlesschain.android.remote.ui.ai.RemoteAgentControlScreen(
                onNavigateBack = {
                    navController.popBackStack()
                }
            )
        }

        // 远程截图界面
        composable(route = Screen.RemoteScreenshot.route) {
            com.chainlesschain.android.remote.ui.system.RemoteScreenshotScreen(
                onNavigateBack = {
                    navController.popBackStack()
                }
            )
        }

        // 系统监控界面
        composable(route = Screen.RemoteSystemMonitor.route) {
            com.chainlesschain.android.remote.ui.system.SystemMonitorScreen(
                onNavigateBack = {
                    navController.popBackStack()
                }
            )
        }

        // 命令历史界面
        composable(route = Screen.RemoteCommandHistory.route) {
            com.chainlesschain.android.remote.ui.history.CommandHistoryScreen(
                onNavigateBack = {
                    navController.popBackStack()
                }
            )
        }
        */
    }
}

/**
 * 导航路由定义
 */
sealed class Screen(val route: String) {
    data object SetupPin : Screen("setup_pin")
    data object Login : Screen("login")
    data object Home : Screen("home")
    data object KnowledgeList : Screen("knowledge_list")
    data object KnowledgeEditor : Screen("knowledge_editor") {
        fun createRoute(itemId: String) = "knowledge_editor/$itemId"
    }
    data object ConversationList : Screen("conversation_list")
    data object NewConversation : Screen("new_conversation")
    data object Chat : Screen("chat") {
        fun createRoute(conversationId: String) = "chat/$conversationId"
    }
    data object AISettings : Screen("ai_settings")
    data object ProjectDetail : Screen("project_detail") {
        fun createRoute(projectId: String) = "project_detail/$projectId"
    }
    data object StepDetail : Screen("step_detail") {
        fun createRoute(projectId: String) = "step_detail/$projectId"
    }

    // LLM功能路由
    data object LLMSettings : Screen("llm_settings")
    data object UsageStatistics : Screen("usage_statistics")
    data object LLMTest : Screen("llm_test") {
        fun createRoute(provider: String) = "llm_test/$provider"
    }
    data object FileBrowser : Screen("file_browser") {
        fun createRoute(projectId: String? = null) = if (projectId != null) {
            "file_browser?projectId=$projectId"
        } else {
            "file_browser"
        }
    }

    // 社交功能路由
    data object PublishPost : Screen("publish_post")
    data object PostDetail : Screen("post_detail") {
        fun createRoute(postId: String) = "post_detail/$postId"
    }
    data object FriendDetail : Screen("friend_detail") {
        fun createRoute(did: String) = "friend_detail/$did"
    }
    data object UserProfile : Screen("user_profile") {
        fun createRoute(did: String) = "user_profile/$did"
    }
    data object AddFriend : Screen("add_friend")
    data object CommentDetail : Screen("comment_detail") {
        fun createRoute(commentId: String) = "comment_detail/$commentId"
    }

    // v0.31.0 新增
    data object MyQRCode : Screen("my_qrcode")
    data object QRCodeScanner : Screen("qrcode_scanner")
    data object EditPost : Screen("edit_post") {
        fun createRoute(postId: String) = "edit_post/$postId"
    }

    // 远程控制功能路由（Phase 2）
    data object RemoteControl : Screen("remote_control")
    data object RemoteAIChat : Screen("remote_ai_chat")
    data object RemoteRAGSearch : Screen("remote_rag_search")
    data object RemoteAgentControl : Screen("remote_agent_control")
    data object RemoteScreenshot : Screen("remote_screenshot")
    data object RemoteSystemMonitor : Screen("remote_system_monitor")
    data object RemoteCommandHistory : Screen("remote_command_history")
}

/**
 * 确定启动路由
 */
@Composable
fun getStartDestination(viewModel: AuthViewModel = hiltViewModel()): String {
    val uiState by viewModel.uiState.collectAsState()

    return when {
        !uiState.isSetupComplete -> Screen.SetupPin.route
        !uiState.isAuthenticated -> Screen.Login.route
        else -> Screen.Home.route
    }
}

/**
 * AI设置占位界面
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AISettingsPlaceholder(
    onNavigateBack: () -> Unit
) {
    PlaceholderScreen(
        title = "AI 设置",
        message = "AI 设置功能开发中...",
        icon = Icons.Default.Settings,
        onNavigateBack = onNavigateBack
    )
}

/**
 * 通用占位界面
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PlaceholderScreen(
    title: String,
    message: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector = Icons.Default.Settings,
    onNavigateBack: () -> Unit
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(title) },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "返回")
                    }
                }
            )
        }
    ) { paddingValues ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues),
            contentAlignment = Alignment.Center
        ) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                Icon(
                    imageVector = icon,
                    contentDescription = null,
                    modifier = Modifier.size(64.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
                )
                Text(
                    text = message,
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

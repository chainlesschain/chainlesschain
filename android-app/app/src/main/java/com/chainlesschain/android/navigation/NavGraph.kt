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
import com.chainlesschain.android.feature.filebrowser.ui.GlobalFileBrowserScreen

/**
 * 应用导航图
 */
@Composable
fun NavGraph(
    navController: NavHostController,
    startDestination: String
) {
    NavHost(
        navController = navController,
        startDestination = startDestination
    ) {
        // 设置PIN码界面
        composable(route = Screen.SetupPin.route) {
            SetupPinScreen(
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
                onLogout = {
                    navController.navigate(Screen.Login.route) {
                        popUpTo(Screen.Home.route) { inclusive = true }
                    }
                },
                onNavigateToProjectDetail = { projectId ->
                    navController.navigate(Screen.ProjectDetail.createRoute(projectId))
                },
                onNavigateToLLMSettings = {
                    navController.navigate(Screen.LLMSettings.route)
                },
                onNavigateToLLMTest = {
                    navController.navigate(Screen.LLMTest.route)
                },
                onNavigateToFileBrowser = {
                    navController.navigate(Screen.FileBrowser.route)
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

            GlobalFileBrowserScreen(
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
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("AI 设置") },
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
                    imageVector = Icons.Default.Settings,
                    contentDescription = null,
                    modifier = Modifier.size(64.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
                )
                Text(
                    text = "AI 设置功能开发中...",
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

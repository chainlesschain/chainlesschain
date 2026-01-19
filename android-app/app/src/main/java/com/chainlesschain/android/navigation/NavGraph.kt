package com.chainlesschain.android.navigation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
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

        // 主界面
        composable(route = Screen.Home.route) {
            HomeScreen(
                onLogout = {
                    navController.navigate(Screen.Login.route) {
                        popUpTo(Screen.Home.route) { inclusive = true }
                    }
                },
                onNavigateToKnowledge = {
                    navController.navigate(Screen.KnowledgeList.route)
                },
                onNavigateToAI = {
                    navController.navigate(Screen.ConversationList.route)
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
                onNavigateBack = {
                    navController.popBackStack()
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

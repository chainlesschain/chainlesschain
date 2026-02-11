package com.chainlesschain.android.navigation

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import com.chainlesschain.android.feature.ai.domain.model.LLMProvider
import com.chainlesschain.android.feature.ai.presentation.ChatScreen
import com.chainlesschain.android.feature.ai.presentation.ConversationListScreen
import com.chainlesschain.android.feature.ai.presentation.NewConversationScreen
import com.chainlesschain.android.feature.ai.presentation.settings.LLMSettingsScreen
import com.chainlesschain.android.feature.ai.presentation.usage.UsageStatisticsScreen
import com.chainlesschain.android.feature.auth.presentation.AuthViewModel
import com.chainlesschain.android.feature.auth.presentation.LoginScreen
import com.chainlesschain.android.feature.auth.presentation.SetupPinScreen
import com.chainlesschain.android.feature.knowledge.presentation.KnowledgeEditorScreen
import com.chainlesschain.android.feature.knowledge.presentation.KnowledgeListScreen
import com.chainlesschain.android.presentation.MainContainer
import com.chainlesschain.android.presentation.screens.AboutScreen
import com.chainlesschain.android.presentation.screens.BookmarkScreen
import com.chainlesschain.android.presentation.screens.HelpFeedbackScreen
import com.chainlesschain.android.presentation.screens.LLMTestChatScreen
import com.chainlesschain.android.presentation.screens.ProjectDetailScreenV2
import com.chainlesschain.android.presentation.screens.SettingsScreen
import com.chainlesschain.android.presentation.screens.StepDetailScreen
import com.chainlesschain.android.remote.ui.DeviceListScreen
import com.chainlesschain.android.remote.ui.DeviceScanScreen
import com.chainlesschain.android.remote.ui.RemoteControlScreen
import com.chainlesschain.android.remote.ui.ai.RemoteAgentControlScreen
import com.chainlesschain.android.remote.ui.ai.RemoteAIChatScreen
import com.chainlesschain.android.remote.ui.ai.RemoteRAGSearchScreen
import com.chainlesschain.android.remote.ui.desktop.RemoteDesktopScreen
import com.chainlesschain.android.remote.ui.file.FileTransferScreen
import com.chainlesschain.android.remote.ui.history.CommandHistoryScreen
import com.chainlesschain.android.remote.ui.system.RemoteScreenshotScreen
import com.chainlesschain.android.remote.ui.system.SystemMonitorScreen
import com.chainlesschain.android.remote.ui.clipboard.ClipboardSyncScreen
import com.chainlesschain.android.remote.ui.notification.RemoteNotificationScreen
import com.chainlesschain.android.remote.ui.workflow.WorkflowScreen
import com.chainlesschain.android.remote.ui.connection.ConnectionStatusScreen
import com.chainlesschain.android.remote.ui.power.PowerControlScreen
import com.chainlesschain.android.remote.ui.process.ProcessManagerScreen
import com.chainlesschain.android.remote.ui.media.MediaControlScreen
import com.chainlesschain.android.remote.ui.input.InputControlScreen
import com.chainlesschain.android.remote.ui.storage.StorageInfoScreen
import com.chainlesschain.android.remote.ui.network.NetworkInfoScreen
import com.chainlesschain.android.remote.ui.application.ApplicationManagerScreen
import com.chainlesschain.android.remote.ui.security.SecurityInfoScreen
import com.chainlesschain.android.feature.filebrowser.ui.SafeFileBrowserScreen
import com.chainlesschain.android.feature.project.viewmodel.ProjectViewModel
import com.chainlesschain.android.feature.project.model.ProjectListState
import com.chainlesschain.android.feature.p2p.ui.ChatSessionListScreen
import com.chainlesschain.android.feature.p2p.ui.P2PChatScreen
import com.chainlesschain.android.feature.p2p.ui.social.MyQRCodeScreen
import com.chainlesschain.android.feature.p2p.ui.social.QRCodeScannerScreen

@Composable
fun NavGraph(
    navController: NavHostController,
    startDestination: String,
    authViewModel: AuthViewModel
) {
    NavHost(navController = navController, startDestination = startDestination) {
        composable(Screen.SetupPin.route) {
            SetupPinScreen(
                viewModel = authViewModel,
                onSetupComplete = {
                    navController.navigate(Screen.Home.route) {
                        popUpTo(Screen.SetupPin.route) { inclusive = true }
                    }
                }
            )
        }

        composable(Screen.Login.route) {
            LoginScreen(
                viewModel = authViewModel,
                onLoginSuccess = {
                    navController.navigate(Screen.Home.route) {
                        popUpTo(Screen.Login.route) { inclusive = true }
                    }
                }
            )
        }

        composable(Screen.Home.route) {
            MainContainer(
                viewModel = authViewModel,
                onLogout = {
                    navController.navigate(Screen.Login.route) {
                        popUpTo(Screen.Home.route) { inclusive = true }
                    }
                },
                onNavigateToKnowledgeList = { navController.navigate(Screen.KnowledgeList.route) },
                onNavigateToAIChat = { navController.navigate(Screen.ConversationList.route) },
                onNavigateToProjectDetail = { navController.navigate(Screen.ProjectDetail.createRoute(it)) },
                onNavigateToFriendDetail = { navController.navigate(Screen.FriendDetail.createRoute(it)) },
                onNavigateToAddFriend = { navController.navigate(Screen.AddFriend.route) },
                onNavigateToPublishPost = { navController.navigate(Screen.PublishPost.route) },
                onNavigateToPostDetail = { navController.navigate(Screen.PostDetail.createRoute(it)) },
                onNavigateToUserProfile = { navController.navigate(Screen.UserProfile.createRoute(it)) },
                onNavigateToEditPost = { navController.navigate(Screen.EditPost.createRoute(it)) },
                onNavigateToComment = { navController.navigate(Screen.CommentDetail.createRoute(it)) },
                onNavigateToMyQRCode = { navController.navigate(Screen.MyQRCode.route) },
                onNavigateToQRScanner = { navController.navigate(Screen.QRCodeScanner.route) },
                onNavigateToLLMSettings = { navController.navigate(Screen.LLMSettings.route) },
                onNavigateToUsageStatistics = { navController.navigate(Screen.UsageStatistics.route) },
                onNavigateToLLMTest = { navController.navigate(Screen.LLMTest.route) },
                onNavigateToFileBrowser = { navController.navigate(Screen.FileBrowser.route) },
                onNavigateToRemoteControl = { navController.navigate(Screen.RemoteControl.route) },
                onNavigateToP2P = { navController.navigate(Screen.DeviceManagement.route) },
                onNavigateToSettings = { navController.navigate(Screen.Settings.route) },
                onNavigateToAbout = { navController.navigate(Screen.About.route) },
                onNavigateToHelpFeedback = { navController.navigate(Screen.HelpFeedback.route) },
                onNavigateToBookmark = { navController.navigate(Screen.Bookmark.route) },
                onNavigateToP2PChatSessionList = { navController.navigate(Screen.P2PChatSessionList.route) }
            )
        }

        composable(Screen.KnowledgeList.route) {
            KnowledgeListScreen(
                onItemClick = { navController.navigate(Screen.KnowledgeEditor.createRoute(it)) },
                onAddClick = { navController.navigate(Screen.KnowledgeEditor.route) }
            )
        }

        composable(Screen.KnowledgeEditor.route) {
            KnowledgeEditorScreen(onNavigateBack = { navController.popBackStack() })
        }

        composable(
            route = "${Screen.KnowledgeEditor.route}/{itemId}",
            arguments = listOf(navArgument("itemId") { type = NavType.StringType })
        ) { backStackEntry ->
            KnowledgeEditorScreen(
                itemId = backStackEntry.arguments?.getString("itemId"),
                onNavigateBack = { navController.popBackStack() }
            )
        }

        composable(Screen.ConversationList.route) {
            ConversationListScreen(
                onConversationClick = { navController.navigate(Screen.Chat.createRoute(it)) },
                onNewConversation = { navController.navigate(Screen.NewConversation.route) },
                onSettings = { navController.navigate(Screen.AISettings.route) }
            )
        }

        composable(Screen.NewConversation.route) {
            NewConversationScreen(
                onNavigateBack = { navController.popBackStack() },
                onConversationCreated = { conversationId ->
                    navController.navigate(Screen.Chat.createRoute(conversationId)) {
                        popUpTo(Screen.ConversationList.route)
                    }
                }
            )
        }

        composable(
            route = "${Screen.Chat.route}/{conversationId}",
            arguments = listOf(navArgument("conversationId") { type = NavType.StringType })
        ) { backStackEntry ->
            val conversationId = backStackEntry.arguments?.getString("conversationId") ?: return@composable
            ChatScreen(
                conversationId = conversationId,
                onNavigateBack = { navController.popBackStack() },
                onSettings = { }
            )
        }

        composable(Screen.AISettings.route) {
            AISettingsPlaceholder(onNavigateBack = { navController.popBackStack() })
        }

        composable(
            route = "${Screen.ProjectDetail.route}/{projectId}",
            arguments = listOf(navArgument("projectId") { type = NavType.StringType })
        ) { backStackEntry ->
            val projectId = backStackEntry.arguments?.getString("projectId") ?: return@composable
            ProjectDetailScreenV2(
                projectId = projectId,
                onNavigateBack = { navController.popBackStack() },
                onNavigateToSteps = { navController.navigate(Screen.StepDetail.createRoute(it)) },
                onNavigateToFileBrowser = { navController.navigate(Screen.FileBrowser.route) }
            )
        }

        composable(
            route = "${Screen.StepDetail.route}/{projectId}",
            arguments = listOf(navArgument("projectId") { type = NavType.StringType })
        ) { backStackEntry ->
            val projectId = backStackEntry.arguments?.getString("projectId") ?: return@composable
            StepDetailScreen(projectId = projectId, onNavigateBack = { navController.popBackStack() })
        }

        composable(Screen.LLMSettings.route) {
            LLMSettingsScreen(
                onNavigateBack = { navController.popBackStack() },
                onNavigateToUsageStatistics = { navController.navigate(Screen.UsageStatistics.route) }
            )
        }

        composable(Screen.UsageStatistics.route) {
            UsageStatisticsScreen(onNavigateBack = { navController.popBackStack() })
        }

        composable(Screen.LLMTest.route) {
            LLMTestChatScreen(onNavigateBack = { navController.popBackStack() }, provider = LLMProvider.DOUBAO)
        }

        composable(
            route = "${Screen.LLMTest.route}/{provider}",
            arguments = listOf(navArgument("provider") { type = NavType.StringType })
        ) { backStackEntry ->
            val providerName = backStackEntry.arguments?.getString("provider") ?: "DOUBAO"
            val provider = runCatching { LLMProvider.valueOf(providerName) }.getOrElse { LLMProvider.DOUBAO }
            LLMTestChatScreen(onNavigateBack = { navController.popBackStack() }, provider = provider)
        }

        composable(Screen.Settings.route) {
            SettingsScreen(
                onNavigateBack = { navController.popBackStack() },
                onNavigateToAbout = { navController.navigate(Screen.About.route) },
                onNavigateToHelpFeedback = { navController.navigate(Screen.HelpFeedback.route) }
            )
        }

        composable(Screen.About.route) {
            AboutScreen(onNavigateBack = { navController.popBackStack() })
        }

        composable(Screen.HelpFeedback.route) {
            HelpFeedbackScreen(onNavigateBack = { navController.popBackStack() })
        }

        composable(Screen.Bookmark.route) {
            BookmarkScreen(onNavigateBack = { navController.popBackStack() })
        }

        composable(Screen.FileBrowser.route) {
            // Get projects from ProjectViewModel to avoid circular dependency
            val projectViewModel: ProjectViewModel = hiltViewModel()
            val projectListState by projectViewModel.projectListState.collectAsState()

            // Extract project entities from the state
            val availableProjects = when (val state = projectListState) {
                is ProjectListState.Success -> state.projects.map { it.project }
                else -> emptyList()
            }

            SafeFileBrowserScreen(
                projectId = null,
                availableProjects = availableProjects,
                onNavigateBack = { navController.popBackStack() },
                onFileImported = { fileId ->
                    android.widget.Toast.makeText(
                        navController.context,
                        "文件已导入",
                        android.widget.Toast.LENGTH_SHORT
                    ).show()
                }
            )
        }

        registerPlaceholder(navController, Screen.PublishPost.route, "Publish Post")
        registerPlaceholder(navController, "${Screen.PostDetail.route}/{postId}", "Post Detail", "postId")
        registerPlaceholder(navController, "${Screen.FriendDetail.route}/{did}", "Friend Detail", "did")
        registerPlaceholder(navController, "${Screen.UserProfile.route}/{did}", "User Profile", "did")
        registerPlaceholder(navController, Screen.AddFriend.route, "Add Friend")
        registerPlaceholder(navController, "${Screen.CommentDetail.route}/{commentId}", "Comment Detail", "commentId")
        // 我的二维码页面
        composable(Screen.MyQRCode.route) {
            MyQRCodeScreen(
                onNavigateBack = { navController.popBackStack() },
                onShowToast = { message ->
                    android.widget.Toast.makeText(navController.context, message, android.widget.Toast.LENGTH_SHORT).show()
                }
            )
        }

        // 扫描二维码页面
        composable(Screen.QRCodeScanner.route) {
            QRCodeScannerScreen(
                onNavigateBack = { navController.popBackStack() },
                onQRCodeScanned = { qrContent ->
                    // 处理扫描结果：如果是好友添加链接，导航到添加好友页面
                    android.widget.Toast.makeText(navController.context, "扫描成功: $qrContent", android.widget.Toast.LENGTH_LONG).show()
                    navController.popBackStack()
                }
            )
        }
        registerPlaceholder(navController, "${Screen.EditPost.route}/{postId}", "Edit Post", "postId")
        composable(Screen.DeviceManagement.route) {
            DeviceListScreen(
                onNavigateToDeviceDetail = { peerId, did ->
                    val resolvedDid = did.ifBlank { "did:key:$peerId" }
                    navController.navigate(Screen.RemoteControl.createRoute(peerId, resolvedDid))
                },
                onNavigateToDeviceScan = { navController.navigate(Screen.DeviceScan.route) },
                onNavigateBack = { navController.popBackStack() }
            )
        }
        composable(Screen.DeviceScan.route) {
            DeviceScanScreen(
                onNavigateBack = { navController.popBackStack() },
                onDeviceSelected = { peerId, did ->
                    val resolvedDid = did.ifBlank { "did:key:$peerId" }
                    navController.navigate(Screen.RemoteControl.createRoute(peerId, resolvedDid))
                }
            )
        }
        composable(Screen.RemoteControl.route) {
            RemoteControlScreen(
                onNavigateToAIChat = { navController.navigate(Screen.RemoteAIChat.route) },
                onNavigateToRAGSearch = { navController.navigate(Screen.RemoteRAGSearch.route) },
                onNavigateToAgentControl = { navController.navigate(Screen.RemoteAgentControl.route) },
                onNavigateToScreenshot = { navController.navigate(Screen.RemoteScreenshot.route) },
                onNavigateToSystemMonitor = { navController.navigate(Screen.RemoteSystemMonitor.route) },
                onNavigateToCommandHistory = { navController.navigate(Screen.RemoteCommandHistory.route) },
                onNavigateToRemoteDesktop = { navController.navigate(Screen.RemoteDesktop.route) },
                onNavigateToFileTransfer = { did ->
                    navController.navigate(Screen.RemoteFileTransfer.createRoute(did))
                },
                onNavigateToClipboardSync = { navController.navigate(Screen.RemoteClipboard.route) },
                onNavigateToNotificationCenter = { navController.navigate(Screen.RemoteNotificationCenter.route) },
                onNavigateToWorkflow = { navController.navigate(Screen.RemoteWorkflow.route) },
                onNavigateToConnectionStatus = { navController.navigate(Screen.ConnectionStatus.route) },
                // Phase 17A: New navigation callbacks
                onNavigateToPowerControl = { navController.navigate(Screen.RemotePowerControl.route) },
                onNavigateToProcessManager = { navController.navigate(Screen.RemoteProcessManager.route) },
                onNavigateToMediaControl = { navController.navigate(Screen.RemoteMediaControl.route) },
                onNavigateToInputControl = { navController.navigate(Screen.RemoteInputControl.route) },
                onNavigateToStorageInfo = { navController.navigate(Screen.RemoteStorageInfo.route) },
                onNavigateToNetworkInfo = { navController.navigate(Screen.RemoteNetworkInfo.route) },
                onNavigateToApplicationManager = { navController.navigate(Screen.RemoteApplicationManager.route) },
                onNavigateToSecurityInfo = { navController.navigate(Screen.RemoteSecurityInfo.route) }
            )
        }
        composable(
            route = "${Screen.RemoteControl.route}/{peerId}/{did}",
            arguments = listOf(
                navArgument("peerId") { type = NavType.StringType },
                navArgument("did") { type = NavType.StringType }
            )
        ) { backStackEntry ->
            val peerId = backStackEntry.arguments?.getString("peerId")
            val did = backStackEntry.arguments?.getString("did")
            RemoteControlScreen(
                defaultPeerId = peerId,
                defaultDid = did,
                onNavigateToAIChat = { navController.navigate(Screen.RemoteAIChat.route) },
                onNavigateToRAGSearch = { navController.navigate(Screen.RemoteRAGSearch.route) },
                onNavigateToAgentControl = { navController.navigate(Screen.RemoteAgentControl.route) },
                onNavigateToScreenshot = { navController.navigate(Screen.RemoteScreenshot.route) },
                onNavigateToSystemMonitor = { navController.navigate(Screen.RemoteSystemMonitor.route) },
                onNavigateToCommandHistory = { navController.navigate(Screen.RemoteCommandHistory.route) },
                onNavigateToRemoteDesktop = { navController.navigate(Screen.RemoteDesktop.route) },
                onNavigateToFileTransfer = { targetDid ->
                    navController.navigate(Screen.RemoteFileTransfer.createRoute(targetDid))
                },
                onNavigateToClipboardSync = { navController.navigate(Screen.RemoteClipboard.route) },
                onNavigateToNotificationCenter = { navController.navigate(Screen.RemoteNotificationCenter.route) },
                onNavigateToWorkflow = { navController.navigate(Screen.RemoteWorkflow.route) },
                onNavigateToConnectionStatus = { navController.navigate(Screen.ConnectionStatus.route) },
                // Phase 17A: New navigation callbacks
                onNavigateToPowerControl = { navController.navigate(Screen.RemotePowerControl.route) },
                onNavigateToProcessManager = { navController.navigate(Screen.RemoteProcessManager.route) },
                onNavigateToMediaControl = { navController.navigate(Screen.RemoteMediaControl.route) },
                onNavigateToInputControl = { navController.navigate(Screen.RemoteInputControl.route) },
                onNavigateToStorageInfo = { navController.navigate(Screen.RemoteStorageInfo.route) },
                onNavigateToNetworkInfo = { navController.navigate(Screen.RemoteNetworkInfo.route) },
                onNavigateToApplicationManager = { navController.navigate(Screen.RemoteApplicationManager.route) },
                onNavigateToSecurityInfo = { navController.navigate(Screen.RemoteSecurityInfo.route) }
            )
        }
        composable(Screen.RemoteAIChat.route) {
            RemoteAIChatScreen(onNavigateBack = { navController.popBackStack() })
        }
        composable(Screen.RemoteRAGSearch.route) {
            RemoteRAGSearchScreen(onNavigateBack = { navController.popBackStack() })
        }
        composable(Screen.RemoteAgentControl.route) {
            RemoteAgentControlScreen(onNavigateBack = { navController.popBackStack() })
        }
        composable(Screen.RemoteScreenshot.route) {
            RemoteScreenshotScreen(onNavigateBack = { navController.popBackStack() })
        }
        composable(Screen.RemoteSystemMonitor.route) {
            SystemMonitorScreen(onNavigateBack = { navController.popBackStack() })
        }
        composable(Screen.RemoteCommandHistory.route) {
            CommandHistoryScreen(onNavigateBack = { navController.popBackStack() })
        }
        composable(Screen.RemoteDesktop.route) {
            RemoteDesktopScreen(onNavigateBack = { navController.popBackStack() })
        }
        composable(
            route = "${Screen.RemoteFileTransfer.route}/{did}",
            arguments = listOf(navArgument("did") { type = NavType.StringType })
        ) { backStackEntry ->
            val did = backStackEntry.arguments?.getString("did").orEmpty()
            FileTransferScreen(
                deviceDid = did,
                onNavigateBack = { navController.popBackStack() }
            )
        }

        // Clipboard Sync Screen
        composable(Screen.RemoteClipboard.route) {
            ClipboardSyncScreen(onNavigateBack = { navController.popBackStack() })
        }

        // Remote Notification Center Screen
        composable(Screen.RemoteNotificationCenter.route) {
            RemoteNotificationScreen(onNavigateBack = { navController.popBackStack() })
        }

        // Remote Workflow Screen
        composable(Screen.RemoteWorkflow.route) {
            WorkflowScreen(onNavigateBack = { navController.popBackStack() })
        }

        // Connection Status Screen
        composable(Screen.ConnectionStatus.route) {
            ConnectionStatusScreen(onNavigateBack = { navController.popBackStack() })
        }

        // Phase 17A: New Remote Control Screens
        composable(Screen.RemotePowerControl.route) {
            PowerControlScreen(onNavigateBack = { navController.popBackStack() })
        }
        composable(Screen.RemoteProcessManager.route) {
            ProcessManagerScreen(onNavigateBack = { navController.popBackStack() })
        }
        composable(Screen.RemoteMediaControl.route) {
            MediaControlScreen(onNavigateBack = { navController.popBackStack() })
        }
        composable(Screen.RemoteInputControl.route) {
            InputControlScreen(onNavigateBack = { navController.popBackStack() })
        }
        composable(Screen.RemoteStorageInfo.route) {
            StorageInfoScreen(onNavigateBack = { navController.popBackStack() })
        }
        composable(Screen.RemoteNetworkInfo.route) {
            NetworkInfoScreen(onNavigateBack = { navController.popBackStack() })
        }
        composable(Screen.RemoteApplicationManager.route) {
            ApplicationManagerScreen(onNavigateBack = { navController.popBackStack() })
        }
        composable(Screen.RemoteSecurityInfo.route) {
            SecurityInfoScreen(onNavigateBack = { navController.popBackStack() })
        }

        // P2P Chat Session List
        composable(Screen.P2PChatSessionList.route) {
            ChatSessionListScreen(
                onNavigateToChat = { peerId, peerName ->
                    navController.navigate(Screen.P2PChat.createRoute(peerId, peerName))
                },
                onNavigateBack = { navController.popBackStack() }
            )
        }

        // P2P Chat
        composable(
            route = "${Screen.P2PChat.route}/{peerId}/{peerName}",
            arguments = listOf(
                navArgument("peerId") { type = NavType.StringType },
                navArgument("peerName") { type = NavType.StringType }
            )
        ) { backStackEntry ->
            val peerId = android.net.Uri.decode(backStackEntry.arguments?.getString("peerId") ?: return@composable)
            val peerName = android.net.Uri.decode(backStackEntry.arguments?.getString("peerName") ?: "")
            P2PChatScreen(
                deviceId = peerId,
                deviceName = peerName,
                onNavigateBack = { navController.popBackStack() },
                onVerifyDevice = { navController.navigate("safety_numbers/$peerId") }
            )
        }
    }
}

private fun androidx.navigation.NavGraphBuilder.registerPlaceholder(
    navController: NavHostController,
    route: String,
    title: String,
    argName: String? = null
) {
    val args = if (argName == null) emptyList() else listOf(navArgument(argName) { type = NavType.StringType })
    composable(route = route, arguments = args) {
        PlaceholderScreen(title = title, message = "$title is temporarily simplified for build stability.", onNavigateBack = {
            navController.popBackStack()
        })
    }
}

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
    data object FileBrowser : Screen("file_browser")
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
    data object MyQRCode : Screen("my_qrcode")
    data object QRCodeScanner : Screen("qrcode_scanner")
    data object EditPost : Screen("edit_post") {
        fun createRoute(postId: String) = "edit_post/$postId"
    }
    data object Settings : Screen("settings")
    data object About : Screen("about")
    data object HelpFeedback : Screen("help_feedback")
    data object Bookmark : Screen("bookmark")
    data object DeviceManagement : Screen("device_management")
    data object DeviceScan : Screen("device_scan")
    data object RemoteControl : Screen("remote_control") {
        fun createRoute(peerId: String, did: String) = "remote_control/$peerId/$did"
    }
    data object RemoteAIChat : Screen("remote_ai_chat")
    data object RemoteRAGSearch : Screen("remote_rag_search")
    data object RemoteAgentControl : Screen("remote_agent_control")
    data object RemoteScreenshot : Screen("remote_screenshot")
    data object RemoteSystemMonitor : Screen("remote_system_monitor")
    data object RemoteCommandHistory : Screen("remote_command_history")
    data object RemoteDesktop : Screen("remote_desktop")
    data object RemoteFileTransfer : Screen("remote_file_transfer") {
        fun createRoute(did: String) = "remote_file_transfer/$did"
    }
    data object RemoteClipboard : Screen("remote_clipboard")
    data object RemoteNotificationCenter : Screen("remote_notification_center")
    data object RemoteWorkflow : Screen("remote_workflow")
    data object ConnectionStatus : Screen("connection_status")
    data object P2PChatSessionList : Screen("p2p_chat_session_list")
    data object P2PChat : Screen("p2p_chat") {
        fun createRoute(peerId: String, peerName: String) =
            "p2p_chat/${android.net.Uri.encode(peerId)}/${android.net.Uri.encode(peerName)}"
    }
    // Phase 17A: New remote control screens
    data object RemotePowerControl : Screen("remote_power_control")
    data object RemoteProcessManager : Screen("remote_process_manager")
    data object RemoteMediaControl : Screen("remote_media_control")
    data object RemoteInputControl : Screen("remote_input_control")
    data object RemoteStorageInfo : Screen("remote_storage_info")
    data object RemoteNetworkInfo : Screen("remote_network_info")
    data object RemoteApplicationManager : Screen("remote_application_manager")
    data object RemoteSecurityInfo : Screen("remote_security_info")
}

@Composable
fun getStartDestination(viewModel: AuthViewModel = hiltViewModel()): String {
    val uiState by viewModel.uiState.collectAsState()
    return when {
        !uiState.isSetupComplete -> Screen.SetupPin.route
        !uiState.isAuthenticated -> Screen.Login.route
        else -> Screen.Home.route
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AISettingsPlaceholder(onNavigateBack: () -> Unit) {
    PlaceholderScreen(
        title = "AI Settings",
        message = "AI settings are under construction.",
        onNavigateBack = onNavigateBack
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PlaceholderScreen(
    title: String,
    message: String,
    icon: ImageVector = Icons.Default.Settings,
    onNavigateBack: () -> Unit
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(title) },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
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
                    modifier = Modifier.padding(4.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant
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

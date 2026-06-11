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
import com.chainlesschain.android.R
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import com.chainlesschain.android.config.ThemeMode
import com.chainlesschain.android.feature.ai.domain.model.LLMProvider
import com.chainlesschain.android.feature.ai.presentation.ChatScreen
import com.chainlesschain.android.presentation.aistudy.AiStudyScreen
import com.chainlesschain.android.presentation.familytask.FamilyTaskScreen
import com.chainlesschain.android.presentation.familyrewards.FamilyRewardsScreen
import com.chainlesschain.android.presentation.mistakebook.MistakeBookScreen
import com.chainlesschain.android.presentation.parentedu.GentlenessReportScreen
import com.chainlesschain.android.feature.ai.presentation.ConversationListScreen
import com.chainlesschain.android.feature.ai.presentation.NewConversationScreen
import com.chainlesschain.android.feature.ai.presentation.settings.LLMSettingsScreen
import com.chainlesschain.android.feature.ai.presentation.usage.UsageStatisticsScreen
import com.chainlesschain.android.feature.auth.presentation.AuthViewModel
import com.chainlesschain.android.feature.auth.presentation.LoginScreen
import com.chainlesschain.android.feature.auth.presentation.SetupPinScreen
import com.chainlesschain.android.feature.knowledge.presentation.KnowledgeEditorScreen
import com.chainlesschain.android.feature.knowledge.presentation.KnowledgeListScreen
import com.chainlesschain.android.feature.p2p.ui.DesktopPairingScreen
import com.chainlesschain.android.feature.p2p.ui.ScanDesktopPairingScreen
import com.chainlesschain.android.feature.project.ui.screens.TaskCreateScreen
import com.chainlesschain.android.feature.project.ui.screens.TaskListScreen
import com.chainlesschain.android.presentation.MainContainer
import com.chainlesschain.android.presentation.screens.AboutScreen
import com.chainlesschain.android.presentation.screens.AsrSettingsScreen
import com.chainlesschain.android.presentation.screens.CodeViewerScreen
import com.chainlesschain.android.presentation.screens.HelpFeedbackScreen
import com.chainlesschain.android.presentation.screens.KeyManagementScreen
import com.chainlesschain.android.presentation.screens.LLMTestChatScreen
import com.chainlesschain.android.presentation.screens.ProjectDetailScreenV2
import com.chainlesschain.android.presentation.screens.ProjectFilesScreen
import com.chainlesschain.android.presentation.screens.SettingsScreen
import com.chainlesschain.android.presentation.screens.SplashScreen
import com.chainlesschain.android.presentation.screens.StepDetailScreen
import com.chainlesschain.android.presentation.screens.voice.VoiceModeScreen as PhoneVoiceModeScreen
import com.chainlesschain.android.remote.ui.DeviceListScreen
import com.chainlesschain.android.remote.ui.DeviceScanScreen
import com.chainlesschain.android.remote.ui.RemoteControlScreen
import com.chainlesschain.android.remote.ui.RemoteOperateScreen
import com.chainlesschain.android.remote.terminal.ui.TerminalListScreen
import com.chainlesschain.android.remote.terminal.ui.TerminalSessionScreen
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
import com.chainlesschain.android.remote.ui.personalDataHub.PersonalDataHubScreen
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
import com.chainlesschain.android.feature.p2p.ui.social.AddFriendScreen
import com.chainlesschain.android.feature.p2p.ui.social.BlockedUsersScreen
import com.chainlesschain.android.feature.p2p.ui.social.CommentDetailScreen
import com.chainlesschain.android.feature.p2p.ui.social.EditPostScreen
import com.chainlesschain.android.feature.p2p.ui.social.FriendDetailScreen
import com.chainlesschain.android.feature.p2p.ui.social.MyQRCodeScreen
import com.chainlesschain.android.feature.p2p.ui.social.NotificationCenterScreen
import com.chainlesschain.android.feature.p2p.ui.social.PostDetailScreen
import com.chainlesschain.android.feature.p2p.ui.social.PublishPostScreen
import com.chainlesschain.android.feature.p2p.ui.social.QRCodeScannerScreen
import com.chainlesschain.android.feature.p2p.ui.social.UserProfileScreen
import com.chainlesschain.android.feature.p2p.viewmodel.DIDViewModel

@Composable
fun NavGraph(
    navController: NavHostController,
    startDestination: String,
    authViewModel: AuthViewModel,
    nextAfterSplash: String = Screen.Login.route,
    currentThemeMode: ThemeMode = ThemeMode.SYSTEM,
    onThemeModeChanged: (ThemeMode) -> Unit = {}
) {
    NavHost(navController = navController, startDestination = startDestination) {
        composable(Screen.Splash.route) {
            SplashScreen(onComplete = {
                navController.navigate(nextAfterSplash) {
                    popUpTo(Screen.Splash.route) { inclusive = true }
                }
            })
        }

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
                onNavigateToAiStudy = { navController.navigate(Screen.AiStudy.route) },
                onNavigateToTasks = { navController.navigate(Screen.FamilyTask.route) },
                onNavigateToRewards = { navController.navigate(Screen.FamilyRewards.route) },
                onNavigateToGentleness = { navController.navigate(Screen.GentlenessReport.route) },
                onNavigateToMistakeBook = { navController.navigate(Screen.MistakeBook.route) },
                onNavigateToAIChatWithMessage = { msg ->
                    // 跳过 ConversationList → 直接进 NewConversation；带 prefill 的
                    // 情况下 NewConversationScreen 自动选默认模型 + 自动创建 → Chat
                    // 全程用户只需 1 步发送。
                    navController.navigate(Screen.NewConversation.createRoute(msg))
                },
                // 最近会话 chip 点击 → 直接打开对应 Chat 路由
                onNavigateToConversation = { conversationId ->
                    navController.navigate(Screen.Chat.createRoute(conversationId))
                },
                onNavigateToProjectDetail = { navController.navigate(Screen.ProjectDetail.createRoute(it)) },
                onNavigateToFriendDetail = { navController.navigate(Screen.FriendDetail.createRoute(it)) },
                onNavigateToAddFriend = { navController.navigate(Screen.AddFriend.route) },
                onNavigateToPublishPost = { navController.navigate(Screen.PublishPost.route) },
                onNavigateToPostDetail = { navController.navigate(Screen.PostDetail.createRoute(it)) },
                onNavigateToUserProfile = { navController.navigate(Screen.UserProfile.createRoute(it)) },
                onNavigateToEditPost = { navController.navigate(Screen.EditPost.createRoute(it)) },
                onNavigateToComment = { navController.navigate(Screen.CommentDetail.createRoute(it)) },
                onNavigateToBlockedUsers = { navController.navigate(Screen.BlockedUsers.route) },
                onNavigateToMyQRCode = { navController.navigate(Screen.MyQRCode.route) },
                onNavigateToQRScanner = { navController.navigate(Screen.QRCodeScanner.route) },
                onNavigateToLLMSettings = { navController.navigate(Screen.LLMSettings.route) },
                onNavigateToUsageStatistics = { navController.navigate(Screen.UsageStatistics.route) },
                onNavigateToLLMTest = { navController.navigate(Screen.LLMTest.route) },
                onNavigateToCcChat = { navController.navigate(Screen.CcChat.route) },
                onNavigateToFileBrowser = { navController.navigate(Screen.FileBrowser.route) },
                onNavigateToRemoteProjectBrowser = { navController.navigate(Screen.RemoteProjectBrowser.route) },
                onNavigateToRemoteControl = { navController.navigate(Screen.RemoteControl.route) },
                onNavigateToLocalTerminal = { navController.navigate(Screen.LocalTerminal.route) },
                onNavigateToP2P = { navController.navigate(Screen.DeviceManagement.route) },
                // Plan A v0.1 — 首页 "本机数据" 直跳 PersonalDataHub 容器屏 +
                // initialTab=3 (本机数据 tab 默认聚焦)；不依赖配对桌面。
                onNavigateToLocalDataHub = { navController.navigate(Screen.PersonalDataHub.createRoute(initialTab = 3)) },
                // 2026-05-24 — PDH 第 6 tab "数据浏览" (b4fa54b6d) 快捷入口
                onNavigateToPdhBrowser = { navController.navigate(Screen.PersonalDataHub.createRoute(initialTab = 5)) },
                // 2026-05-24 — 首页 ChatInputBar 选本机 RAG 路由 → inline sheet「查看详情」
                // 跳 PDH tab 4 (本机提问) 并把同一问题作为 askPrefill 自动重 submit。
                onNavigateToPdhAsk = { question ->
                    navController.navigate(Screen.PersonalDataHub.createRoute(initialTab = 4, askPrefill = question))
                },
                // 2026-05-24 — 首页快捷入口跳 AndroidLocalModel（Gemma/Qwen .task 下载 + 测试）
                onNavigateToLocalModel = { navController.navigate(Screen.AndroidLocalModel.route) },
                // 用户反馈：首页要可直接扫描桌面 QR (不要隐藏在设置里)
                onNavigateToScanDesktopPairing = { navController.navigate(Screen.ScanDesktopPairing.route) },
                // v1.3+ issue #21 plan C — 首页已连接桌面卡点击 → 走 signaling forward
                // 路径的 RemoteOperate 简单页（不依赖 WebRTC P2P，跨 NAT 也能用）。
                onNavigateToRemoteOperate = { pcPeerId ->
                    navController.navigate(Screen.RemoteOperate.createRoute(pcPeerId))
                },
                onNavigateToSettings = { navController.navigate(Screen.Settings.route) },
                onNavigateToAbout = { navController.navigate(Screen.About.route) },
                onNavigateToHelpFeedback = { navController.navigate(Screen.HelpFeedback.route) },
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

        composable(
            route = Screen.ConversationList.routePattern,
            arguments = listOf(
                navArgument("prefill") {
                    type = NavType.StringType
                    nullable = true
                    defaultValue = null
                }
            )
        ) { backStackEntry ->
            val prefill = backStackEntry.arguments?.getString("prefill")
            ConversationListScreen(
                onConversationClick = { id ->
                    // ConversationList 现在也走 routePattern；老的 popUpTo 用 route 不匹配
                    // 用户在列表点对话直接打开（带 prefill 注入到 Chat 输入框）
                    navController.navigate(Screen.Chat.createRoute(id, prefill))
                },
                onNewConversation = {
                    navController.navigate(Screen.NewConversation.createRoute(prefill))
                },
                onSettings = { navController.navigate(Screen.AISettings.route) }
            )
        }

        composable(
            route = Screen.NewConversation.routePattern,
            arguments = listOf(
                navArgument("prefill") {
                    type = NavType.StringType
                    nullable = true
                    defaultValue = null
                }
            )
        ) { backStackEntry ->
            val prefill = backStackEntry.arguments?.getString("prefill")
            NewConversationScreen(
                onNavigateBack = { navController.popBackStack() },
                onConversationCreated = { conversationId ->
                    navController.navigate(Screen.Chat.createRoute(conversationId, prefill)) {
                        // popUpTo 必须匹配 composable 注册时用的 routePattern
                        // —— 用户回退不会回到自动跳过的中间页
                        popUpTo(Screen.NewConversation.routePattern) { inclusive = true }
                    }
                },
                prefilledMessage = prefill
            )
        }

        composable(
            route = Screen.Chat.routePattern,
            arguments = listOf(
                navArgument("conversationId") { type = NavType.StringType },
                navArgument("prefill") {
                    type = NavType.StringType
                    nullable = true
                    defaultValue = null
                }
            )
        ) { backStackEntry ->
            val conversationId = backStackEntry.arguments?.getString("conversationId") ?: return@composable
            val prefilledMessage = backStackEntry.arguments?.getString("prefill")
            ChatScreen(
                conversationId = conversationId,
                onNavigateBack = { navController.popBackStack() },
                onSettings = { },
                prefilledMessage = prefilledMessage
            )
        }

        composable(Screen.AISettings.route) {
            AISettingsPlaceholder(onNavigateBack = { navController.popBackStack() })
        }

        // AI 陪学 (M6 MVP) — 家庭 tab "AI陪学" 卡导航至此 (双轨 学习/陪伴 chat)。
        composable(Screen.AiStudy.route) {
            AiStudyScreen(onBack = { navController.popBackStack() })
        }

        // M5 任务/作业 — 家庭 tab "任务" 卡导航至此。开始学习 → 进 AI 陪学引导模式。
        composable(Screen.FamilyTask.route) {
            FamilyTaskScreen(
                onBack = { navController.popBackStack() },
                onOpenAiStudy = { navController.navigate(Screen.AiStudy.route) },
            )
        }

        // M9 奖励/积分 — 家庭 tab "积分" 卡导航至此。
        composable(Screen.FamilyRewards.route) {
            FamilyRewardsScreen(onBack = { navController.popBackStack() })
        }

        // M10 监管温和度月报 — 家庭 tab "家长成长" 卡导航至此。
        composable(Screen.GentlenessReport.route) {
            GentlenessReportScreen(onBack = { navController.popBackStack() })
        }

        // M6 错题本 — 家庭 tab "错题本" 卡导航至此 (间隔复习 + 满 5 题赚积分)。
        composable(Screen.MistakeBook.route) {
            MistakeBookScreen(onBack = { navController.popBackStack() })
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
                // #21: folder icon now opens this project's files, not the global file browser
                onNavigateToFileBrowser = { navController.navigate(Screen.ProjectFiles.createRoute(projectId)) },
                onNavigateToTaskList = { navController.navigate(Screen.TaskList.route) },
                // Sub-phase 7.5: 远程文件 CRUD
                onNavigateToRemoteFiles = { pid, name ->
                    navController.navigate(Screen.RemoteProjectFiles.createRoute(pid, name))
                },
                // Sub-phase 5-6: 远程终端入口 — Terminal icon → TerminalList(peerId, cwd=pcRootPath)
                onNavigateToRemoteTerminal = { peerId, cwd ->
                    navController.navigate(Screen.TerminalList.createRoute(peerId, cwd))
                },
            )
        }

        composable(Screen.TaskList.route) {
            val taskAuthViewModel: AuthViewModel = hiltViewModel()
            val taskAuthState by taskAuthViewModel.uiState.collectAsState()
            TaskListScreen(
                userId = taskAuthState.currentUser?.id ?: "",
                onNavigateBack = { navController.popBackStack() },
                onNavigateToTask = { /* Task detail wire-up pending */ },
                onNavigateToCreateTask = { navController.navigate(Screen.TaskCreate.route) }
            )
        }

        // Sub-phase 10 (2026-05-17): RemoteProjectBrowser — PC→Android 选择性拉项目
        // 详见 docs/design/Android_Project_Remote_Terminal_Entry.md §6.10
        composable(Screen.RemoteProjectBrowser.route) {
            // 用 NavGraph 传入的 shared authViewModel（含已登录 user state），
            // 不要 hiltViewModel() 拿新 instance — 后者 currentUser 为 null，
            // userId 空触发桌面端 PERMISSION_DENIED。
            val browserAuthState by authViewModel.uiState.collectAsState()
            com.chainlesschain.android.remote.ui.project.RemoteProjectBrowserScreen(
                userId = browserAuthState.currentUser?.id ?: "",
                onNavigateBack = { navController.popBackStack() },
                onProjectPulled = { projectId ->
                    navController.navigate(Screen.ProjectDetail.createRoute(projectId)) {
                        popUpTo(Screen.RemoteProjectBrowser.route) { inclusive = true }
                    }
                },
            )
        }

        // Sub-phase 7.5 (2026-05-17): 远程项目文件 CRUD
        composable(
            route = Screen.RemoteProjectFiles.routePattern,
            arguments = listOf(
                navArgument("projectId") { type = NavType.StringType },
                navArgument("projectName") { type = NavType.StringType },
            ),
        ) { entry ->
            val pid = entry.arguments?.getString("projectId") ?: return@composable
            val name = entry.arguments?.getString("projectName")?.let { android.net.Uri.decode(it) } ?: ""
            com.chainlesschain.android.remote.ui.project.RemoteProjectFilesScreen(
                projectId = pid,
                projectName = name,
                onNavigateBack = { navController.popBackStack() },
            )
        }

        composable(Screen.TaskCreate.route) {
            val taskAuthViewModel: AuthViewModel = hiltViewModel()
            val taskAuthState by taskAuthViewModel.uiState.collectAsState()
            TaskCreateScreen(
                userId = taskAuthState.currentUser?.id ?: "",
                onNavigateBack = { navController.popBackStack() },
                onTaskCreated = { navController.popBackStack() }
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
                onNavigateToUsageStatistics = { navController.navigate(Screen.UsageStatistics.route) },
                onNavigateToLocalModel = { navController.navigate(Screen.AndroidLocalModel.route) }
            )
        }

        composable(Screen.AndroidLocalModel.route) {
            com.chainlesschain.android.presentation.screens.AndroidLocalModelScreen(
                onNavigateBack = { navController.popBackStack() },
                onNavigateToTestChat = { navController.navigate(Screen.LLMTestLocal.route) }
            )
        }

        composable(Screen.LLMTestLocal.route) {
            LLMTestChatScreen(
                onNavigateBack = { navController.popBackStack() },
                useLocalEngine = true
            )
        }

        composable(Screen.UsageStatistics.route) {
            UsageStatisticsScreen(onNavigateBack = { navController.popBackStack() })
        }

        composable(Screen.LLMTest.route) {
            LLMTestChatScreen(onNavigateBack = { navController.popBackStack() }, provider = LLMProvider.DOUBAO)
        }

        composable(Screen.CcChat.route) {
            com.chainlesschain.android.presentation.screens.cc.CcChatScreen(
                initialProvider = LLMProvider.DOUBAO,
            )
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
                onNavigateToHelpFeedback = { navController.navigate(Screen.HelpFeedback.route) },
                onNavigateToKeyManagement = { navController.navigate(Screen.KeyManagement.route) },
                onNavigateToAsrSettings = { navController.navigate(Screen.AsrSettings.route) },
                onNavigateToDesktopPairing = { navController.navigate(Screen.DesktopPairing.route) },
                onNavigateToScanDesktopPairing = { navController.navigate(Screen.ScanDesktopPairing.route) },
                currentThemeMode = currentThemeMode,
                onThemeModeChanged = onThemeModeChanged
            )
        }

        composable(Screen.DesktopPairing.route) {
            DesktopPairingScreen(onClose = { navController.popBackStack() })
        }

        composable(Screen.ScanDesktopPairing.route) {
            ScanDesktopPairingScreen(onClose = { navController.popBackStack() })
        }

        // #21 C.1 PR1 — phone VoiceMode entry. PhoneVoiceModeScreen lives
        // in presentation/screens/voice and was previously orphan (no
        // NavGraph entry). Reachable now via ACTION_START_VOICE_MODE
        // intent (see voice/VoiceLaunchActions.kt + MainActivity routing)
        // and future wear-forward (PR2) / phone shortcut (PR4).
        composable(Screen.VoiceMode.route) {
            PhoneVoiceModeScreen(onBack = { navController.popBackStack() })
        }

        composable(Screen.KeyManagement.route) {
            KeyManagementScreen(onNavigateBack = { navController.popBackStack() })
        }

        composable(Screen.AsrSettings.route) {
            AsrSettingsScreen(onNavigateBack = { navController.popBackStack() })
        }

        // Phase 4 — local terminal (feature-local-terminal module).
        // Self-contained: bootstrap + mksh + xterm.js on device, no pairing
        // dependency. ViewModel pulled via Hilt's @HiltViewModel.
        composable(Screen.LocalTerminal.route) {
            val vm: com.chainlesschain.android.feature.localterminal.ui.LocalSessionViewModel =
                hiltViewModel()
            com.chainlesschain.android.feature.localterminal.ui.LocalTerminalScreen(
                viewModel = vm,
            )
        }

        composable(Screen.About.route) {
            AboutScreen(onNavigateBack = { navController.popBackStack() })
        }

        composable(Screen.HelpFeedback.route) {
            HelpFeedbackScreen(onNavigateBack = { navController.popBackStack() })
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
                        navController.context.getString(R.string.nav_file_imported),
                        android.widget.Toast.LENGTH_SHORT
                    ).show()
                },
                onOpenInEditor = { file ->
                    navController.navigate(Screen.CodeViewer.createRoute(file.id))
                }
            )
        }

        composable(
            route = Screen.ProjectFiles.routePattern,
            arguments = listOf(navArgument("projectId") { type = NavType.StringType }),
        ) { backStackEntry ->
            val projectId = backStackEntry.arguments?.getString("projectId") ?: return@composable
            ProjectFilesScreen(
                projectId = projectId,
                onNavigateBack = { navController.popBackStack() },
            )
        }

        composable(
            route = Screen.CodeViewer.routePattern,
            arguments = listOf(navArgument("fileId") { type = NavType.StringType })
        ) {
            CodeViewerScreen(onNavigateBack = { navController.popBackStack() })
        }

        composable(Screen.PublishPost.route) {
            val didViewModel: DIDViewModel = hiltViewModel()
            val didDocument by didViewModel.didDocument.collectAsState()
            val myDid = didDocument?.id
            if (myDid.isNullOrBlank()) {
                // DID 还没加载完——给 hilt 一帧时间，渲染 spinner 占位
                androidx.compose.foundation.layout.Box(
                    modifier = androidx.compose.ui.Modifier.fillMaxSize(),
                    contentAlignment = androidx.compose.ui.Alignment.Center
                ) {
                    androidx.compose.material3.CircularProgressIndicator()
                }
            } else {
                PublishPostScreen(
                    myDid = myDid,
                    onNavigateBack = { navController.popBackStack() }
                )
            }
        }

        composable(
            route = "${Screen.PostDetail.route}/{postId}",
            arguments = listOf(navArgument("postId") { type = NavType.StringType })
        ) { backStackEntry ->
            val postId = backStackEntry.arguments?.getString("postId") ?: return@composable
            val didViewModel: DIDViewModel = hiltViewModel()
            val didDocument by didViewModel.didDocument.collectAsState()
            val myDid = didDocument?.id
            if (myDid.isNullOrBlank()) {
                androidx.compose.foundation.layout.Box(
                    modifier = androidx.compose.ui.Modifier.fillMaxSize(),
                    contentAlignment = androidx.compose.ui.Alignment.Center
                ) {
                    androidx.compose.material3.CircularProgressIndicator()
                }
            } else {
                PostDetailScreen(
                    postId = postId,
                    myDid = myDid,
                    onNavigateBack = { navController.popBackStack() },
                    onNavigateToUserProfile = { did ->
                        navController.navigate(Screen.UserProfile.createRoute(did))
                    }
                )
            }
        }

        composable(
            route = "${Screen.FriendDetail.route}/{did}",
            arguments = listOf(navArgument("did") { type = NavType.StringType })
        ) { backStackEntry ->
            val friendDid = backStackEntry.arguments?.getString("did") ?: return@composable
            FriendDetailScreen(
                onNavigateBack = { navController.popBackStack() },
                onNavigateToPost = { postId ->
                    navController.navigate(Screen.PostDetail.createRoute(postId))
                },
                onNavigateToChat = { peerId ->
                    // 已存在的 P2P chat 路由用 peerId+peerName 两段；用 friendDid 当 peer 显示名兜底
                    navController.navigate(Screen.P2PChat.createRoute(peerId, friendDid))
                },
                onNavigateToCallHistory = { /* 通话功能已移除 */ }
            )
        }

        composable(
            route = "${Screen.UserProfile.route}/{did}",
            arguments = listOf(navArgument("did") { type = NavType.StringType })
        ) { backStackEntry ->
            val did = backStackEntry.arguments?.getString("did") ?: return@composable
            UserProfileScreen(
                onNavigateBack = { navController.popBackStack() },
                onNavigateToPost = { postId ->
                    navController.navigate(Screen.PostDetail.createRoute(postId))
                },
                onNavigateToChat = { peerId ->
                    navController.navigate(Screen.P2PChat.createRoute(peerId, did))
                }
            )
        }

        composable(Screen.AddFriend.route) {
            AddFriendScreen(
                onNavigateBack = { navController.popBackStack() },
                onNavigateToQRScanner = { navController.navigate(Screen.QRCodeScanner.route) }
            )
        }

        composable(
            route = "${Screen.CommentDetail.route}/{commentId}",
            arguments = listOf(navArgument("commentId") { type = NavType.StringType })
        ) { _ ->
            CommentDetailScreen(
                onNavigateBack = { navController.popBackStack() },
                onNavigateToUserProfile = { did ->
                    navController.navigate(Screen.UserProfile.createRoute(did))
                }
            )
        }
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
                    // 扫描成功后解析出对方 DID, 跳到其资料页 (含「添加好友」按钮)。
                    // 之前这里只弹 Toast 不跳转 → 扫码后看似无反应, 无法加好友 (真机反馈)。
                    // QRCodeScannerViewModel 已校验过格式/签名/有效期, 这里只取 did 跳转。
                    val parsed = runCatching { android.net.Uri.parse(qrContent) }.getOrNull()
                    val scannedDid = parsed?.getQueryParameter("did")
                    navController.popBackStack()
                    if (parsed?.host == "add-friend" && !scannedDid.isNullOrBlank()) {
                        navController.navigate(Screen.UserProfile.createRoute(scannedDid))
                    } else {
                        android.widget.Toast.makeText(
                            navController.context,
                            navController.context.getString(R.string.nav_qr_scan_success, qrContent),
                            android.widget.Toast.LENGTH_LONG,
                        ).show()
                    }
                }
            )
        }
        composable(
            route = "${Screen.EditPost.route}/{postId}",
            arguments = listOf(navArgument("postId") { type = NavType.StringType })
        ) { backStackEntry ->
            val postId = backStackEntry.arguments?.getString("postId") ?: return@composable
            EditPostScreen(
                postId = postId,
                onNavigateBack = { navController.popBackStack() },
                onPostUpdated = { navController.popBackStack() }
            )
        }

        composable(Screen.NotificationCenter.route) {
            NotificationCenterScreen(
                onNavigateBack = { navController.popBackStack() },
                onNavigateToFriendRequest = { did ->
                    navController.navigate(Screen.FriendDetail.createRoute(did))
                },
                onNavigateToFriendProfile = { did ->
                    navController.navigate(Screen.UserProfile.createRoute(did))
                },
                onNavigateToPost = { postId ->
                    navController.navigate(Screen.PostDetail.createRoute(postId))
                },
                onNavigateToComment = { commentId ->
                    navController.navigate(Screen.CommentDetail.createRoute(commentId))
                }
            )
        }

        composable(Screen.BlockedUsers.route) {
            BlockedUsersScreen(
                onNavigateBack = { navController.popBackStack() }
            )
        }
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
        composable(
            route = Screen.RemoteOperate.routePattern,
            arguments = listOf(
                navArgument("peerId") { type = NavType.StringType },
            ),
        ) {
            RemoteOperateScreen(
                onBack = { navController.popBackStack() },
                onOpenTerminal = { peerId ->
                    navController.navigate(Screen.TerminalList.createRoute(peerId))
                },
                onOpenFileTransfer = { peerId ->
                    // Plan C 入口下用户没有真 DID，沿用 RemoteControl 的兜替规则。
                    navController.navigate(Screen.RemoteFileTransfer.createRoute("did:key:$peerId"))
                },
                // Phase 14.1 step 4 — 个人数据中台入口；走 typed PersonalDataHubCommands
                // (DC RPC) 调对端桌面 hub.*。屏内三 tab：提问 / Adapter / 审计。
                onOpenPersonalDataHub = {
                    // RemoteOperate 入口默认进 tab 0 (提问) — 远控场景延续原行为。
                    navController.navigate(Screen.PersonalDataHub.createRoute(initialTab = 0))
                },
            )
        }

        // Phase 14.1 step 4 — 个人数据中台容器屏。Tab 切提问/Adapter/审计/本机数据；
        // 前三 tab 通过 PersonalDataHubCommands typed wrapper 经 P2P DC RPC 走桌面 hub；
        // 本机数据 tab 走 in-APK cc + ContentResolver/PackageManager (Plan A v0.1)。
        composable(
            route = Screen.PersonalDataHub.routePattern,
            arguments = listOf(
                navArgument("tab") {
                    type = NavType.IntType
                    defaultValue = 0
                },
                navArgument("ask") {
                    type = NavType.StringType
                    nullable = true
                    defaultValue = null
                },
            ),
        ) { backStackEntry ->
            val initialTab = backStackEntry.arguments?.getInt("tab") ?: 0
            val askPrefill = backStackEntry.arguments?.getString("ask")
                ?.let { java.net.URLDecoder.decode(it, "UTF-8") }
            PersonalDataHubScreen(initialTab = initialTab, askPrefill = askPrefill)
        }
        composable(
            route = Screen.TerminalList.routePattern,
            arguments = listOf(
                navArgument("peerId") { type = NavType.StringType },
                navArgument("cwd") {
                    type = NavType.StringType
                    nullable = true
                    defaultValue = null
                },
            ),
        ) { backStack ->
            val peerId = backStack.arguments?.getString("peerId").orEmpty()
            val cwd = backStack.arguments?.getString("cwd")?.let { android.net.Uri.decode(it) }
            TerminalListScreen(
                pcPeerId = peerId,
                onBack = { navController.popBackStack() },
                onOpenSession = { sessionId ->
                    navController.navigate(Screen.TerminalSession.createRoute(peerId, sessionId))
                },
                initialCwd = cwd,
            )
        }
        composable(
            route = Screen.TerminalSession.routePattern,
            arguments = listOf(
                navArgument("peerId") { type = NavType.StringType },
                navArgument("sessionId") { type = NavType.StringType },
            ),
        ) {
            TerminalSessionScreen(onBack = { navController.popBackStack() })
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
    data object Splash : Screen("splash")
    data object SetupPin : Screen("setup_pin")
    data object Login : Screen("login")
    data object Home : Screen("home")
    data object KeyManagement : Screen("key_management")
    data object AsrSettings : Screen("asr_settings")
    /** Phase 4 — local terminal (mksh in $PREFIX, no pairing required). */
    data object LocalTerminal : Screen("local_terminal")
    data object CcChat : Screen("cc_chat")
    data object KnowledgeList : Screen("knowledge_list")
    data object KnowledgeEditor : Screen("knowledge_editor") {
        fun createRoute(itemId: String) = "knowledge_editor/$itemId"
    }
    data object ConversationList : Screen("conversation_list") {
        const val routePattern = "conversation_list?prefill={prefill}"
        fun createRoute(prefill: String? = null): String =
            if (prefill.isNullOrEmpty()) "conversation_list"
            else "conversation_list?prefill=${java.net.URLEncoder.encode(prefill, "UTF-8")}"
    }
    data object NewConversation : Screen("new_conversation") {
        const val routePattern = "new_conversation?prefill={prefill}"
        fun createRoute(prefill: String? = null): String =
            if (prefill.isNullOrEmpty()) "new_conversation"
            else "new_conversation?prefill=${java.net.URLEncoder.encode(prefill, "UTF-8")}"
    }
    data object Chat : Screen("chat") {
        const val routePattern = "chat/{conversationId}?prefill={prefill}"
        fun createRoute(conversationId: String, prefill: String? = null): String {
            val base = "chat/$conversationId"
            return if (prefill.isNullOrEmpty()) base
            else "$base?prefill=${java.net.URLEncoder.encode(prefill, "UTF-8")}"
        }
    }
    data object AISettings : Screen("ai_settings")

    /** AI 陪学 (M6 MVP) — 家庭 tab 的「AI陪学」入口。 */
    data object AiStudy : Screen("ai_study")
    data object FamilyTask : Screen("family_task")

    /** M9 奖励/积分 — 家庭 tab「积分」入口。 */
    data object FamilyRewards : Screen("family_rewards")
    data object MistakeBook : Screen("mistake_book")

    /** M10 监管温和度月报 — 家庭 tab「家长成长」入口。 */
    data object GentlenessReport : Screen("gentleness_report")
    data object ProjectDetail : Screen("project_detail") {
        fun createRoute(projectId: String) = "project_detail/$projectId"
    }
    data object StepDetail : Screen("step_detail") {
        fun createRoute(projectId: String) = "step_detail/$projectId"
    }
    data object TaskList : Screen("task_list")
    data object TaskCreate : Screen("task_create")
    // Sub-phase 10 (2026-05-17): Android 项目管理 → 远程终端入口 — PC→Android 选择性拉
    // 详见 docs/design/Android_Project_Remote_Terminal_Entry.md §6.10
    data object RemoteProjectBrowser : Screen("remote_project_browser")

    // Sub-phase 7.5 (2026-05-17): 远程项目文件 CRUD 屏
    data object RemoteProjectFiles : Screen("remote_project_files/{projectId}/{projectName}") {
        const val routePattern = "remote_project_files/{projectId}/{projectName}"
        fun createRoute(projectId: String, projectName: String) =
            "remote_project_files/$projectId/${android.net.Uri.encode(projectName)}"
    }
    data object LLMSettings : Screen("llm_settings")
    data object UsageStatistics : Screen("usage_statistics")
    data object LLMTest : Screen("llm_test") {
        fun createRoute(provider: String) = "llm_test/$provider"
    }
    /** 安卓本机 Gemma-3 1B 模型管理屏（下载/删除/测试入口）。 */
    data object AndroidLocalModel : Screen("android_local_model")
    /** LLMTestChatScreen 的本机引擎模式路由 —— useLocalEngine=true 自动注入。 */
    data object LLMTestLocal : Screen("llm_test_local")
    data object FileBrowser : Screen("file_browser")
    // #21 user feedback "在项目管理要可以查看本项目文件" — project-scoped file list
    data object ProjectFiles : Screen("project_files") {
        const val routePattern = "project_files/{projectId}"
        fun createRoute(projectId: String) = "project_files/$projectId"
    }
    data object CodeViewer : Screen("code_viewer") {
        const val routePattern = "code_viewer/{fileId}"
        fun createRoute(fileId: String) = "code_viewer/${android.net.Uri.encode(fileId)}"
    }
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
    data object NotificationCenter : Screen("notification_center")
    data object BlockedUsers : Screen("blocked_users")
    data object Settings : Screen("settings")
    // #21 C.1 PR1 — phone-side VoiceMode entry. Reachable via
    // ACTION_START_VOICE_MODE intent (manifest filter on MainActivity) +
    // future wear-forward (PR2) + phone shortcut (PR4 follow-up).
    data object VoiceMode : Screen("voice_mode")
    data object DesktopPairing : Screen("desktop_pairing") // v1.1 W3.2 mobile↔desktop QR pairing
    data object ScanDesktopPairing : Screen("scan_desktop_pairing") // v1.1 W3.7 Flow B
    data object About : Screen("about")
    data object HelpFeedback : Screen("help_feedback")
    data object DeviceManagement : Screen("device_management")
    data object DeviceScan : Screen("device_scan")
    data object RemoteControl : Screen("remote_control") {
        fun createRoute(peerId: String, did: String) = "remote_control/$peerId/$did"
    }
    // v1.3+ issue #21 plan C — signaling forward 简单远程操控页
    data object RemoteOperate : Screen("remote_operate") {
        const val routePattern = "remote_operate/{peerId}"
        fun createRoute(peerId: String) = "remote_operate/$peerId"
    }
    // Phase 14.1 step 4 — 个人数据中台主屏（提问 / Adapter / 审计 / 本机数据 4 tab）
    // Plan A v0.1 — initialTab path arg lets the home shortcut "本机数据" land
    // straight on the local-data tab without scrolling through remote ones.
    data object PersonalDataHub : Screen("personal_data_hub") {
        // 2026-05-24 — 加 ask query param：首页 ChatInputBar 选「本机 RAG」路由发问
        // 后点 inline sheet 的「查看详情」→ 跳 PDH tab 4 并自动 submit 同一问题。
        // ask 用 URLEncoder.encode 防中文 / 空格 / & 破坏 route。
        const val routePattern = "personal_data_hub?tab={tab}&ask={ask}"
        fun createRoute(initialTab: Int = 0, askPrefill: String? = null): String {
            val base = "personal_data_hub?tab=$initialTab"
            return if (askPrefill.isNullOrBlank()) base
            else "$base&ask=${java.net.URLEncoder.encode(askPrefill, "UTF-8")}"
        }
    }
    // Plan A 远程终端 — list + single session
    // Sub-phase 5-6 (2026-05-17): 加 cwd 可选 query 让项目详情页 Terminal icon
    // 入口能预填 PC 端项目根目录。
    data object TerminalList : Screen("terminal_list") {
        const val routePattern = "terminal_list/{peerId}?cwd={cwd}"
        fun createRoute(peerId: String, cwd: String? = null): String {
            val base = "terminal_list/$peerId"
            return if (cwd.isNullOrEmpty()) base
            else "$base?cwd=${java.net.URLEncoder.encode(cwd, "UTF-8")}"
        }
    }
    data object TerminalSession : Screen("terminal_session") {
        const val routePattern = "terminal_session/{peerId}/{sessionId}"
        fun createRoute(peerId: String, sessionId: String) =
            "terminal_session/$peerId/$sessionId"
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

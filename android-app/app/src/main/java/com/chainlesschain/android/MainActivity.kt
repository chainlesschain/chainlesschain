package com.chainlesschain.android

import android.animation.ObjectAnimator
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.view.animation.AnticipateInterpolator
import androidx.activity.compose.setContent
import androidx.appcompat.app.AppCompatActivity
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.core.animation.doOnEnd
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.compose.rememberNavController
import com.chainlesschain.android.config.AppConfigManager
import com.chainlesschain.android.config.ThemeMode
import com.chainlesschain.android.core.security.strongbox.StrongBoxKeyManager
import com.chainlesschain.android.core.ui.theme.ChainlessChainTheme
import com.chainlesschain.android.feature.auth.data.biometric.BiometricAuthenticator
import com.chainlesschain.android.feature.auth.presentation.AuthViewModel
import com.chainlesschain.android.navigation.NavGraph
import com.chainlesschain.android.navigation.Screen
import com.chainlesschain.android.sign.AndroidApprovalGate
import com.chainlesschain.android.sign.ApprovalDialogHost
import com.chainlesschain.android.voice.VoiceLaunchActions
import com.chainlesschain.android.voice.VoiceTriggerSource
import androidx.lifecycle.lifecycleScope
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

/**
 * 主Activity
 *
 * 性能优化策略：
 * 1. 使用 SplashScreen API（Android 12+）优化启动体验
 * 2. 延迟 ViewModel 初始化直到真正需要
 * 3. 使用边到边显示提升现代化体验
 *
 * @AndroidEntryPoint 注解使Activity能够接收Hilt依赖注入
 */
@AndroidEntryPoint
class MainActivity : AppCompatActivity() {

    @Inject
    lateinit var appConfigManager: AppConfigManager

    @Inject
    lateinit var approvalGate: AndroidApprovalGate

    @Inject
    lateinit var biometricAuthenticator: BiometricAuthenticator

    @Inject
    lateinit var strongBoxKeyManager: StrongBoxKeyManager

    // FAMILY-67: 真实启动入口（AppInitializer 当前未被任何地方调用＝死代码，其内的
    // SyncCoordinator/FamilyGuardSyncConnector 启动也从未触发）。在这里启动同步推送 loop
    // + 家庭 P2P 自动接通；两者皆幂等、自闸（无 peer/无 DID/无 relationship 即空转）。
    @Inject
    lateinit var syncCoordinator: dagger.Lazy<com.chainlesschain.android.sync.SyncCoordinator>

    @Inject
    lateinit var familyGuardSyncConnector: dagger.Lazy<com.chainlesschain.android.sync.FamilyGuardSyncConnector>

    // FAMILY-67 对称件: 已加好友在启动时自动接通好友 P2P，让社交/好友数据跨设备推送
    @Inject
    lateinit var friendSyncConnector: dagger.Lazy<com.chainlesschain.android.sync.FriendSyncConnector>

    // FAMILY-67: 好友 P2P 音视频通话 —— 启动接通话状态机（监听来电信令），媒体/前台服务 seam 互挂。
    @Inject
    lateinit var callManager: dagger.Lazy<com.chainlesschain.android.call.CallManager>

    @Inject
    lateinit var callMediaController: dagger.Lazy<com.chainlesschain.android.call.WebRtcCallMediaController>

    @Inject
    lateinit var callServiceLauncher: dagger.Lazy<com.chainlesschain.android.call.AndroidCallServiceLauncher>

    @Inject
    lateinit var callHistoryRecorder: dagger.Lazy<com.chainlesschain.android.call.RoomCallHistoryRecorder>

    private var isReady = false

    /**
     * #21 C.1 PR1 — class-level state so onNewIntent (activity already
     * running) can also trigger VoiceMode navigation. NavGraph LaunchedEffect
     * reads this + navigates + resets to null. Cold-start populates this in
     * onCreate before setContent.
     */
    private val pendingVoiceTrigger = mutableStateOf<VoiceTriggerSource?>(null)

    /** FAMILY-67: 点好友消息通知 → 携带 open_chat_peer 进来，鉴权后深链到对应好友聊天。 */
    private val pendingChatPeer = mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        // 安装 SplashScreen（必须在 super.onCreate 之前）
        val splashScreen = installSplashScreen()

        super.onCreate(savedInstanceState)

        Timber.d("MainActivity onCreate - start")
        val startTime = System.currentTimeMillis()

        // FAMILY-67: 启动同步推送 loop + 家庭 P2P 自动接通（幂等；早于 PIN 也安全，各自自闸）。
        lifecycleScope.launch {
            runCatching { syncCoordinator.get().start() }
                .onFailure { Timber.w(it, "SyncCoordinator start failed (non-fatal)") }
            runCatching { familyGuardSyncConnector.get().ensureConnected() }
                .onFailure { Timber.w(it, "FamilyGuardSyncConnector start failed (non-fatal)") }
            runCatching { friendSyncConnector.get().ensureConnected() }
                .onFailure { Timber.w(it, "FriendSyncConnector start failed (non-fatal)") }
            // FAMILY-67: 接通话状态机 + 媒体/前台服务互挂 —— start() 订阅 call:* 来电信令，
            // 否则被叫端收不到来电（startCall 直接 send 不需要 start，但 onSignal 订阅必须 start）。
            runCatching {
                val mgr = callManager.get()
                mgr.media = callMediaController.get()
                callMediaController.get().listener = mgr
                mgr.serviceLauncher = callServiceLauncher.get()
                mgr.historyRecorder = callHistoryRecorder.get()
                mgr.start()
                Timber.d("CallManager started")
            }.onFailure { Timber.w(it, "CallManager start failed (non-fatal)") }
            // FAMILY-67:「保持在线接听」前台服务 —— 保活进程 + 周期重连信令，后台/熄屏也能收来电
            // （用户可在通知「停止」opt-out；幂等，重复启动安全）。
            runCatching { com.chainlesschain.android.call.CallPresenceService.startIfEnabled(this@MainActivity) }
                .onFailure { Timber.w(it, "CallPresenceService start failed (non-fatal)") }
        }

        // #21 C.1 PR1 — pick up ACTION_START_VOICE_MODE on cold start.
        pendingVoiceTrigger.value = VoiceLaunchActions.extractTriggerSource(intent)
        if (pendingVoiceTrigger.value != null) {
            Timber.i(
                "MainActivity onCreate: VoiceMode launch intent received, source=${pendingVoiceTrigger.value}",
            )
        }
        // FAMILY-67: 冷启动时若由好友消息通知拉起，携带 open_chat_peer
        intent.getStringExtra("open_chat_peer")?.let { pendingChatPeer.value = it }

        // 配置 SplashScreen
        setupSplashScreen(splashScreen)

        // 启用边到边显示（适配Android 15+）
        enableEdgeToEdge()

        setContent {
            val appConfig by appConfigManager.config.collectAsState()
            val darkTheme = when (appConfig.themeMode) {
                ThemeMode.LIGHT -> false
                ThemeMode.DARK -> true
                ThemeMode.SYSTEM -> androidx.compose.foundation.isSystemInDarkTheme()
            }

            ChainlessChainTheme(darkTheme = darkTheme) {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    val navController = rememberNavController()
                    val authViewModel: AuthViewModel = hiltViewModel()

                    // FAMILY-67: Android 13+ 必须运行时申请通知权限，否则来电/好友消息/未接来电
                    // 通知全部不显示（用户得打开 app 才看得到）。首启请求一次。
                    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
                        val notifLauncher = androidx.activity.compose.rememberLauncherForActivityResult(
                            androidx.activity.result.contract.ActivityResultContracts.RequestPermission(),
                        ) { /* 拒绝则通知不显示；用户可在系统设置开启 */ }
                        androidx.compose.runtime.LaunchedEffect(Unit) {
                            val granted = androidx.core.content.ContextCompat.checkSelfPermission(
                                this@MainActivity, android.Manifest.permission.POST_NOTIFICATIONS,
                            ) == android.content.pm.PackageManager.PERMISSION_GRANTED
                            if (!granted) notifLauncher.launch(android.Manifest.permission.POST_NOTIFICATIONS)
                        }
                    }

                    // 启动总是从 Splash 进入；splash 结束后跳到下面计算的实际目的地。
                    val uiState = authViewModel.uiState.collectAsState().value
                    val nextAfterSplash = remember(uiState.isSetupComplete, uiState.isAuthenticated) {
                        when {
                            !uiState.isSetupComplete -> Screen.SetupPin.route
                            !uiState.isAuthenticated -> Screen.Login.route
                            else -> Screen.Home.route
                        }
                    }

                    Timber.d("MainActivity: nextAfterSplash=$nextAfterSplash, isAuthenticated=${uiState.isAuthenticated}, currentUser=${uiState.currentUser?.id}")

                    NavGraph(
                        navController = navController,
                        startDestination = Screen.Splash.route,
                        authViewModel = authViewModel,
                        nextAfterSplash = nextAfterSplash,
                        currentThemeMode = appConfig.themeMode,
                        onThemeModeChanged = { newMode ->
                            appConfigManager.saveConfig(appConfig.copy(themeMode = newMode))
                        }
                    )

                    // FAMILY-67: 全局通话浮层 —— 任意页面之上接来电/显示通话中。
                    com.chainlesschain.android.call.ui.CallHost()

                    // #21 C.1 PR1 — wire ACTION_START_VOICE_MODE into NavGraph.
                    // We wait until auth is done (otherwise SetupPin / Login
                    // get jumped over) — voice intent on unauthenticated boot
                    // is silently dropped per spike doc §3.3.
                    val pendingTrigger = pendingVoiceTrigger.value
                    LaunchedEffect(pendingTrigger, uiState.isAuthenticated) {
                        if (pendingTrigger != null && uiState.isAuthenticated) {
                            Timber.i("MainActivity: navigating to VoiceMode (source=$pendingTrigger)")
                            navController.navigate(Screen.VoiceMode.route)
                            pendingVoiceTrigger.value = null
                        } else if (pendingTrigger != null && !uiState.isAuthenticated) {
                            Timber.w(
                                "MainActivity: voice intent received but auth not done — dropping (source=$pendingTrigger)",
                            )
                            pendingVoiceTrigger.value = null
                        }
                    }

                    // FAMILY-67: 好友消息通知深链 —— 鉴权后导航到对应好友聊天页（peerName 用 DID 兜底）。
                    val pendingChat = pendingChatPeer.value
                    LaunchedEffect(pendingChat, uiState.isAuthenticated) {
                        if (pendingChat != null && uiState.isAuthenticated) {
                            runCatching {
                                navController.navigate(Screen.P2PChat.createRoute(pendingChat, pendingChat))
                            }.onFailure { Timber.w(it, "deep-link to chat failed") }
                            pendingChatPeer.value = null
                        }
                    }

                    // 全局 ApprovalDialog 宿主：监听 backend (SignAsService / 未来 M4 D2
                    // 桌面 approval channel) 通过 AndroidApprovalGate 发起的确认请求，
                    // 弹 BiometricPrompt + 同意/拒绝对话框。
                    ApprovalDialogHost(
                        approvalGate = approvalGate,
                        biometricAuthenticator = biometricAuthenticator,
                        strongBoxKeyManager = strongBoxKeyManager,
                    )

                    // 标记准备完成
                    LaunchedEffect(Unit) {
                        isReady = true
                        val duration = System.currentTimeMillis() - startTime
                        Timber.d("MainActivity onCreate - completed in ${duration}ms")
                    }
                }
            }
        }
    }

    /**
     * #21 C.1 PR1 — handle ACTION_START_VOICE_MODE when activity is already
     * running. The LaunchedEffect in setContent observes pendingVoiceTrigger
     * and navigates as soon as the value flips non-null.
     */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val src = VoiceLaunchActions.extractTriggerSource(intent)
        if (src != null) {
            Timber.i("MainActivity onNewIntent: VoiceMode launch, source=$src")
            pendingVoiceTrigger.value = src
        }
        // FAMILY-67: app 已在运行时点好友消息通知 → 深链到对应聊天
        intent.getStringExtra("open_chat_peer")?.let { pendingChatPeer.value = it }
    }

    /**
     * 配置 SplashScreen
     * - 保持显示直到内容准备好
     * - 添加退出动画
     */
    private fun setupSplashScreen(splashScreen: androidx.core.splashscreen.SplashScreen) {
        // 保持 SplashScreen 显示直到准备好
        splashScreen.setKeepOnScreenCondition { !isReady }

        // 配置退出动画（Android 12+）
        splashScreen.setOnExitAnimationListener { splashScreenView ->
            val splashView = splashScreenView.view

            // 创建向上滑动并淡出的动画
            val slideUp = ObjectAnimator.ofFloat(
                splashView,
                View.TRANSLATION_Y,
                0f,
                -splashView.height.toFloat()
            )
            slideUp.interpolator = AnticipateInterpolator()
            slideUp.duration = 300L

            // 动画结束后移除 SplashScreen
            slideUp.doOnEnd {
                splashScreenView.remove()
                Timber.d("SplashScreen exit animation completed")
            }

            slideUp.start()
        }
    }
}

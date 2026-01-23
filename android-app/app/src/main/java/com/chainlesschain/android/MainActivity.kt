package com.chainlesschain.android

import android.animation.ObjectAnimator
import android.os.Bundle
import android.view.View
import android.view.animation.AnticipateInterpolator
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
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
import com.chainlesschain.android.core.ui.theme.ChainlessChainTheme
import com.chainlesschain.android.feature.auth.presentation.AuthViewModel
import com.chainlesschain.android.navigation.NavGraph
import com.chainlesschain.android.navigation.Screen
import dagger.hilt.android.AndroidEntryPoint
import timber.log.Timber

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
class MainActivity : ComponentActivity() {

    private var isReady = false

    override fun onCreate(savedInstanceState: Bundle?) {
        // 安装 SplashScreen（必须在 super.onCreate 之前）
        val splashScreen = installSplashScreen()

        super.onCreate(savedInstanceState)

        Timber.d("MainActivity onCreate - start")
        val startTime = System.currentTimeMillis()

        // 配置 SplashScreen
        setupSplashScreen(splashScreen)

        // 启用边到边显示（适配Android 15+）
        enableEdgeToEdge()

        setContent {
            var isInitialized by remember { mutableStateOf(false) }
            val navController = rememberNavController()

            ChainlessChainTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    // 延迟初始化 ViewModel 直到 Compose 准备好
                    if (isInitialized) {
                        val authViewModel: AuthViewModel = hiltViewModel()

                        // 根据认证状态确定启动路由
                        val uiState = authViewModel.uiState.collectAsState().value
                        val startDestination = when {
                            !uiState.isSetupComplete -> Screen.SetupPin.route
                            !uiState.isAuthenticated -> Screen.Login.route
                            else -> Screen.Home.route
                        }

                        NavGraph(
                            navController = navController,
                            startDestination = startDestination
                        )
                    }

                    // 初始化完成
                    LaunchedEffect(Unit) {
                        isInitialized = true
                        isReady = true

                        val duration = System.currentTimeMillis() - startTime
                        Timber.d("MainActivity onCreate - completed in ${duration}ms")
                    }
                }
            }
        }
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

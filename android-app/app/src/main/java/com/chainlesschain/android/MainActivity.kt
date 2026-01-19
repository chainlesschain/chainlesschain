package com.chainlesschain.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.Modifier
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
 * @AndroidEntryPoint 注解使Activity能够接收Hilt依赖注入
 */
@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        Timber.d("MainActivity onCreate")

        // 启用边到边显示（适配Android 15+）
        enableEdgeToEdge()

        setContent {
            ChainlessChainTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    val navController = rememberNavController()
                    val authViewModel: AuthViewModel = hiltViewModel()

                    // 根据认证状态确定启动路由
                    val uiState = authViewModel.uiState.collectAsState().value
                    val startDestination = when {
                        !uiState.isSetupComplete -> Screen.SetupPin.route
                        !uiState.isAuthenticated -> Screen.Login.route
                        else -> Screen.Home.route
                    }

                    // 等待状态初始化完成后再显示导航
                    LaunchedEffect(Unit) {
                        Timber.d("Start destination: $startDestination")
                    }

                    NavGraph(
                        navController = navController,
                        startDestination = startDestination
                    )
                }
            }
        }
    }
}

package com.chainlesschain.android.feature.auth.presentation

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.fragment.app.FragmentActivity
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.feature.auth.presentation.components.NumberKeypad
import com.chainlesschain.android.feature.auth.presentation.components.PinIndicator

/**
 * 登录界面（已设置PIN码后的解锁界面）
 */
@Composable
fun LoginScreen(
    onLoginSuccess: () -> Unit,
    viewModel: AuthViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val context = LocalContext.current

    var pin by remember { mutableStateOf("") }
    var shake by remember { mutableStateOf(false) }

    // 监听认证成功
    LaunchedEffect(uiState.isAuthenticated) {
        if (uiState.isAuthenticated) {
            onLoginSuccess()
        }
    }

    // 监听PIN输入错误
    LaunchedEffect(uiState.error) {
        if (uiState.error != null && pin.length == 6) {
            shake = true
            pin = ""
            kotlinx.coroutines.delay(300)
            shake = false
        }
    }

    // 自动触发生物识别（如果已启用）
    LaunchedEffect(Unit) {
        if (uiState.biometricEnabled && uiState.biometricAvailable) {
            viewModel.authenticateWithBiometric(context as FragmentActivity)
        }
    }

    Scaffold { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.SpaceBetween
        ) {
            // 顶部标题区域
            Column(
                modifier = Modifier.fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Spacer(modifier = Modifier.height(60.dp))

                Text(
                    text = "ChainlessChain",
                    style = MaterialTheme.typography.headlineLarge,
                    color = MaterialTheme.colorScheme.primary
                )

                Spacer(modifier = Modifier.height(8.dp))

                Text(
                    text = "输入PIN码解锁",
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )

                // 显示尝试次数（超过3次后）
                if (uiState.pinAttempts >= 3) {
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "已尝试 ${uiState.pinAttempts} 次",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.error
                    )
                }
            }

            // 中间PIN指示器
            Column(
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                PinIndicator(
                    pinLength = pin.length,
                    shake = shake
                )

                Spacer(modifier = Modifier.height(16.dp))

                // 错误提示
                uiState.error?.let { error ->
                    Text(
                        text = error,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.error,
                        textAlign = TextAlign.Center
                    )
                }
            }

            // 底部数字键盘
            Column {
                NumberKeypad(
                    onNumberClick = { number ->
                        if (pin.length < 6) {
                            pin += number.toString()

                            // 自动验证
                            if (pin.length == 6) {
                                viewModel.verifyPIN(pin)
                            }
                        }
                    },
                    onDeleteClick = {
                        if (pin.isNotEmpty()) {
                            pin = pin.dropLast(1)
                            viewModel.clearError()
                        }
                    },
                    onBiometricClick = if (uiState.biometricEnabled && uiState.biometricAvailable) {
                        {
                            viewModel.authenticateWithBiometric(context as FragmentActivity)
                        }
                    } else null
                )

                if (uiState.isLoading) {
                    Spacer(modifier = Modifier.height(16.dp))
                    LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                }
            }
        }
    }
}

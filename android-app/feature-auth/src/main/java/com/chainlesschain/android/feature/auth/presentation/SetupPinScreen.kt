package com.chainlesschain.android.feature.auth.presentation

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import kotlinx.coroutines.launch
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.feature.auth.presentation.components.NumberKeypad
import com.chainlesschain.android.feature.auth.presentation.components.PinIndicator

/**
 * 设置PIN码界面（首次使用）
 */
@Composable
fun SetupPinScreen(
    onSetupComplete: () -> Unit,
    viewModel: AuthViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()

    var pin by remember { mutableStateOf("") }
    var confirmPin by remember { mutableStateOf("") }
    var step by remember { mutableStateOf(SetupStep.EnterPin) }
    var shake by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    // 监听认证成功
    LaunchedEffect(uiState.isAuthenticated) {
        if (uiState.isAuthenticated) {
            onSetupComplete()
        }
    }

    // 重置shake动画
    LaunchedEffect(shake) {
        if (shake) {
            kotlinx.coroutines.delay(300)
            shake = false
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
                    text = when (step) {
                        SetupStep.EnterPin -> "设置您的6位PIN码"
                        SetupStep.ConfirmPin -> "确认PIN码"
                    },
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )

                if (step == SetupStep.ConfirmPin) {
                    Text(
                        text = "请再次输入PIN码",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            // 中间PIN指示器
            Column(
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                val currentPin = if (step == SetupStep.EnterPin) pin else confirmPin

                PinIndicator(
                    pinLength = currentPin.length,
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
            NumberKeypad(
                onNumberClick = { number ->
                    val currentPin = if (step == SetupStep.EnterPin) pin else confirmPin

                    if (currentPin.length < 6) {
                        val newPin = currentPin + number.toString()

                        if (step == SetupStep.EnterPin) {
                            pin = newPin
                            if (newPin.length == 6) {
                                // 第一次输入完成，进入确认阶段
                                step = SetupStep.ConfirmPin
                                viewModel.clearError()
                            }
                        } else {
                            confirmPin = newPin
                            if (newPin.length == 6) {
                                // 两次输入完成，验证是否一致
                                if (pin == confirmPin) {
                                    viewModel.setupPIN(pin)
                                } else {
                                    // PIN码不一致，重新输入
                                    shake = true
                                    confirmPin = ""
                                    viewModel.clearError()
                                    // 显示错误提示
                                    scope.launch {
                                        viewModel.clearError()
                                        kotlinx.coroutines.delay(100)
                                        // 这里可以通过UiState显示错误
                                    }
                                }
                            }
                        }
                    }
                },
                onDeleteClick = {
                    if (step == SetupStep.EnterPin) {
                        if (pin.isNotEmpty()) {
                            pin = pin.dropLast(1)
                        }
                    } else {
                        if (confirmPin.isNotEmpty()) {
                            confirmPin = confirmPin.dropLast(1)
                        } else {
                            // 如果确认PIN为空，返回第一步
                            step = SetupStep.EnterPin
                            viewModel.clearError()
                        }
                    }
                },
                onBiometricClick = null // 首次设置不支持生物识别
            )

            if (uiState.isLoading) {
                LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            }
        }
    }
}

private enum class SetupStep {
    EnterPin,
    ConfirmPin
}

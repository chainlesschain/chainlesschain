package com.chainlesschain.android.feature.p2p.navigation

import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavType
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import androidx.navigation.navigation
import com.chainlesschain.android.feature.p2p.ui.*
import androidx.hilt.navigation.compose.hiltViewModel

/**
 * P2P 功能导航图
 */
const val P2P_ROUTE = "p2p"
const val DEVICE_LIST_ROUTE = "device_list"
const val P2P_CHAT_ROUTE = "p2p_chat/{deviceId}/{deviceName}"
const val DEVICE_PAIRING_ROUTE = "device_pairing/{deviceId}/{deviceName}"
const val SAFETY_NUMBERS_ROUTE = "safety_numbers/{peerId}"
const val SESSION_FINGERPRINT_ROUTE = "session_fingerprint/{peerId}"
const val SESSION_FINGERPRINT_COMPARISON_ROUTE = "session_fingerprint_comparison/{peerId}"
const val DID_MANAGEMENT_ROUTE = "did_management"
const val MESSAGE_QUEUE_ROUTE = "message_queue"
const val DEVICE_MANAGEMENT_ROUTE = "device_management"

/**
 * 添加 P2P 导航图到主导航
 */
fun NavGraphBuilder.p2pGraph(
    navController: NavController,
    onNavigateToChat: (String) -> Unit
) {
    navigation(
        route = P2P_ROUTE,
        startDestination = DEVICE_LIST_ROUTE
    ) {
        // 设备列表
        composable(route = DEVICE_LIST_ROUTE) {
            DeviceListScreen(
                onDeviceClick = { device ->
                    navController.navigate("p2p_chat/${device.deviceId}/${device.deviceName}")
                },
                onVerifyClick = { peerId ->
                    navController.navigate("safety_numbers/$peerId")
                }
            )
        }

        // P2P聊天
        composable(
            route = P2P_CHAT_ROUTE,
            arguments = listOf(
                navArgument("deviceId") { type = NavType.StringType },
                navArgument("deviceName") { type = NavType.StringType }
            )
        ) { backStackEntry ->
            val deviceId = backStackEntry.arguments?.getString("deviceId") ?: ""
            val deviceName = backStackEntry.arguments?.getString("deviceName") ?: ""

            P2PChatScreen(
                deviceId = deviceId,
                deviceName = deviceName,
                onNavigateBack = {
                    navController.popBackStack()
                },
                onVerifyDevice = {
                    navController.navigate("safety_numbers/$deviceId")
                }
            )
        }

        // 设备配对
        composable(
            route = DEVICE_PAIRING_ROUTE,
            arguments = listOf(
                navArgument("deviceId") { type = NavType.StringType },
                navArgument("deviceName") { type = NavType.StringType }
            )
        ) { backStackEntry ->
            val deviceId = backStackEntry.arguments?.getString("deviceId") ?: ""
            val deviceName = backStackEntry.arguments?.getString("deviceName") ?: ""

            val viewModel = hiltViewModel<com.chainlesschain.android.feature.p2p.viewmodel.PairingViewModel>()

            DevicePairingScreen(
                deviceId = deviceId,
                deviceName = deviceName,
                pairingState = viewModel.pairingState.value,
                onCancel = {
                    viewModel.cancelPairing()
                    navController.popBackStack()
                },
                onRetry = {
                    viewModel.retryPairing()
                }
            )
        }

        // Safety Numbers 验证
        composable(
            route = SAFETY_NUMBERS_ROUTE,
            arguments = listOf(
                navArgument("peerId") { type = NavType.StringType }
            )
        ) { backStackEntry ->
            val peerId = backStackEntry.arguments?.getString("peerId") ?: ""
            val viewModel = hiltViewModel<com.chainlesschain.android.feature.p2p.viewmodel.P2PDeviceViewModel>()

            // 获取验证信息
            var verificationInfo by remember { mutableStateOf<com.chainlesschain.android.core.e2ee.verification.CompleteVerificationInfo?>(null) }

            LaunchedEffect(peerId) {
                verificationInfo = viewModel.getVerificationInfo(peerId)
            }

            SafetyNumbersScreen(
                peerId = peerId,
                verificationInfo = verificationInfo,
                onVerify = {
                    // Mark as verified
                    navController.popBackStack()
                },
                onScanQRCode = {
                    navController.navigate("qr_scanner/$peerId")
                },
                onBack = {
                    navController.popBackStack()
                }
            )
        }

        // 会话指纹显示
        composable(
            route = SESSION_FINGERPRINT_ROUTE,
            arguments = listOf(
                navArgument("peerId") { type = NavType.StringType }
            )
        ) { backStackEntry ->
            val peerId = backStackEntry.arguments?.getString("peerId") ?: ""
            val viewModel = hiltViewModel<com.chainlesschain.android.feature.p2p.viewmodel.P2PDeviceViewModel>()

            // 获取验证信息
            var verificationInfo by remember { mutableStateOf<com.chainlesschain.android.core.e2ee.verification.CompleteVerificationInfo?>(null) }

            LaunchedEffect(peerId) {
                verificationInfo = viewModel.getVerificationInfo(peerId)
            }

            // 从验证信息中提取会话指纹
            val fingerprint = verificationInfo?.sessionFingerprint ?: ""
            val isVerified = verificationInfo?.isVerified ?: false

            SessionFingerprintDisplay(
                fingerprint = fingerprint,
                peerId = peerId,
                isVerified = isVerified,
                onVerify = {
                    navController.navigate("session_fingerprint_comparison/$peerId")
                }
            )
        }

        // 会话指纹对比
        composable(
            route = SESSION_FINGERPRINT_COMPARISON_ROUTE,
            arguments = listOf(
                navArgument("peerId") { type = NavType.StringType }
            )
        ) { backStackEntry ->
            val peerId = backStackEntry.arguments?.getString("peerId") ?: ""
            val viewModel = hiltViewModel<com.chainlesschain.android.feature.p2p.viewmodel.P2PDeviceViewModel>()

            // 获取验证信息
            var verificationInfo by remember { mutableStateOf<com.chainlesschain.android.core.e2ee.verification.CompleteVerificationInfo?>(null) }

            LaunchedEffect(peerId) {
                verificationInfo = viewModel.getVerificationInfo(peerId)
            }

            // 从验证信息中提取指纹（本地和远程应该相同）
            val fingerprint = verificationInfo?.sessionFingerprint ?: ""

            SessionFingerprintComparisonScreen(
                localFingerprint = fingerprint,
                remoteFingerprint = fingerprint, // 应该从远程对等方获取
                peerId = peerId,
                onBack = {
                    navController.popBackStack()
                },
                onConfirmMatch = {
                    // Mark as verified
                    navController.popBackStack(DEVICE_LIST_ROUTE, inclusive = false)
                },
                onReportMismatch = {
                    // Disconnect and go back
                    navController.popBackStack(DEVICE_LIST_ROUTE, inclusive = false)
                }
            )
        }

        // DID 管理
        composable(route = DID_MANAGEMENT_ROUTE) {
            val viewModel = hiltViewModel<com.chainlesschain.android.feature.p2p.viewmodel.DIDViewModel>()

            DIDManagementScreen(
                didDocument = viewModel.didDocument.value,
                identityKeyFingerprint = viewModel.identityKeyFingerprint.value,
                deviceCount = viewModel.deviceCount.value,
                onBack = {
                    navController.popBackStack()
                },
                onExportDID = {
                    viewModel.exportDID()
                },
                onShareDID = {
                    viewModel.shareDID()
                },
                onManageDevices = {
                    navController.navigate(DEVICE_MANAGEMENT_ROUTE)
                },
                onBackupKeys = {
                    viewModel.backupKeys()
                }
            )
        }

        // 消息队列
        composable(route = MESSAGE_QUEUE_ROUTE) {
            val viewModel = hiltViewModel<com.chainlesschain.android.feature.p2p.viewmodel.MessageQueueViewModel>()

            MessageQueueScreen(
                outgoingMessages = viewModel.outgoingMessages.value,
                incomingMessages = viewModel.incomingMessages.value,
                onBack = {
                    navController.popBackStack()
                },
                onRetryMessage = { messageId ->
                    viewModel.retryMessage(messageId)
                },
                onCancelMessage = { messageId ->
                    viewModel.cancelMessage(messageId)
                },
                onClearCompleted = {
                    viewModel.clearCompleted()
                }
            )
        }

        // 设备管理
        composable(route = DEVICE_MANAGEMENT_ROUTE) {
            DeviceManagementScreen(
                onBack = {
                    navController.popBackStack()
                },
                onDeviceClick = { deviceId ->
                    // Navigate to device details or chat
                    navController.navigate("p2p_chat/$deviceId/Device")
                }
            )
        }
    }
}

/**
 * P2P 导航扩展函数
 */
fun NavController.navigateToDeviceList() {
    navigate(DEVICE_LIST_ROUTE) {
        popUpTo(P2P_ROUTE) { inclusive = false }
    }
}

fun NavController.navigateToDevicePairing(deviceId: String, deviceName: String) {
    navigate("device_pairing/$deviceId/$deviceName")
}

fun NavController.navigateToSafetyNumbers(peerId: String) {
    navigate("safety_numbers/$peerId")
}

fun NavController.navigateToSessionFingerprint(peerId: String) {
    navigate("session_fingerprint/$peerId")
}

fun NavController.navigateToDIDManagement() {
    navigate(DID_MANAGEMENT_ROUTE)
}

fun NavController.navigateToMessageQueue() {
    navigate(MESSAGE_QUEUE_ROUTE)
}

fun NavController.navigateToDeviceManagement() {
    navigate(DEVICE_MANAGEMENT_ROUTE)
}

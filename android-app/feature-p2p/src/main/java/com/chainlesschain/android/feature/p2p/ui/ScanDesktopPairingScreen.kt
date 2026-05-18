package com.chainlesschain.android.feature.p2p.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.feature.p2p.viewmodel.ScanDesktopPairingState
import com.chainlesschain.android.feature.p2p.viewmodel.ScanDesktopPairingViewModel

/**
 * 扫描桌面 QR 配对屏 — Android v1.1 W3.7 Flow B (issue #19)。
 *
 * 用户从 Settings → "扫描桌面 QR" 进入。Scanning 阶段直接复用 social 的
 * `QRCodeScannerScreen`（ML Kit 摄像头扫码 + 权限请求 + 手电筒）。Sending /
 * Success / Failed 状态切换为状态屏 — 用户看到结果后可返回 Settings。
 */
@Composable
fun ScanDesktopPairingScreen(
    onClose: () -> Unit,
    viewModel: ScanDesktopPairingViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsState()

    when (val s = state) {
        ScanDesktopPairingState.Scanning -> {
            // 用非-social `QRCodeScannerScreen` (ZXing) 因为 social variant 的
            // ViewModel 内置 QRCodeGenerator.isValidChainlessChainQRCode 校验 reject 我们的
            // desktop-pairing JSON。这个 ZXing-based 不做格式校验，把任意 string 透传。
            QRCodeScannerScreen(
                peerId = "", // 此屏不用，仅为 API 兼容
                onQRCodeScanned = { rawJson -> viewModel.onQrScanned(rawJson) },
                onBack = onClose,
            )
        }
        is ScanDesktopPairingState.Sending -> StatusContent(
            title = "正在通知桌面 ${s.desktopName}…",
            showSpinner = true,
            onAction = null,
            actionLabel = null,
        )
        is ScanDesktopPairingState.Success -> StatusContent(
            title = "配对成功",
            detail = "已与 ${s.desktopName} 建立配对",
            onAction = onClose,
            actionLabel = "完成",
        )
        is ScanDesktopPairingState.Failed -> StatusContent(
            title = "配对失败",
            detail = s.error,
            onAction = { viewModel.retry() },
            actionLabel = "重试",
            secondaryAction = onClose,
            secondaryLabel = "返回",
        )
    }
}

@Composable
private fun StatusContent(
    title: String,
    detail: String? = null,
    showSpinner: Boolean = false,
    onAction: (() -> Unit)? = null,
    actionLabel: String? = null,
    secondaryAction: (() -> Unit)? = null,
    secondaryLabel: String? = null,
) {
    // 用 Surface 而非 Scaffold —— 用户反馈 Success state 白屏，定位是 Scaffold
    // 默认 containerColor 在某些 SDK 下与 ScanningCameraPreview 残留 surface
    // 互相覆盖；Surface 显式 fillMaxSize + colorScheme.background 兜底不透明。
    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background,
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(24.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            if (showSpinner) {
                CircularProgressIndicator()
                Spacer(modifier = Modifier.height(24.dp))
            }
            Text(
                title,
                style = MaterialTheme.typography.headlineSmall,
                textAlign = TextAlign.Center,
            )
            if (detail != null) {
                Spacer(modifier = Modifier.height(12.dp))
                Text(
                    detail,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                )
            }
            if (onAction != null && actionLabel != null) {
                Spacer(modifier = Modifier.height(24.dp))
                Button(onClick = onAction) { Text(actionLabel) }
            }
            if (secondaryAction != null && secondaryLabel != null) {
                Spacer(modifier = Modifier.height(8.dp))
                androidx.compose.material3.TextButton(onClick = secondaryAction) {
                    Text(secondaryLabel)
                }
            }
        }
    }
}

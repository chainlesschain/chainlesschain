package com.chainlesschain.android.feature.p2p.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.feature.p2p.viewmodel.DesktopPairingState
import com.chainlesschain.android.feature.p2p.viewmodel.DesktopPairingViewModel

/**
 * 桌面配对屏 — Android v1.1 W3.2 (issue #19)。
 *
 * Flow A：mobile 显示 QR + 6 位 code，desktop 用摄像头扫。
 *
 * **本 commit (W3.2) 不渲染 QR bitmap**——仅文本展示 6 位 code + payload JSON
 * 占位文本。QR bitmap 渲染由 W3.3 commit 引入 zxing-android-embedded（或 qrcode-kotlin）
 * 后替换 [QrPlaceholder]。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DesktopPairingScreen(
    onClose: () -> Unit,
    viewModel: DesktopPairingViewModel = hiltViewModel(),
) {
    val state by viewModel.pairingState.collectAsState()

    androidx.compose.runtime.LaunchedEffect(Unit) {
        if (state is DesktopPairingState.Idle) {
            viewModel.startPairing()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("配对桌面") },
                navigationIcon = {
                    IconButton(onClick = {
                        viewModel.cancelPairing()
                        onClose()
                    }) {
                        Icon(Icons.Default.Close, contentDescription = "关闭")
                    }
                },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            when (val s = state) {
                is DesktopPairingState.Idle -> CircularProgressIndicator()

                is DesktopPairingState.Displaying -> {
                    Text(
                        "在桌面端打开 设置 → 移动桥 → 扫描或手动输入",
                        style = MaterialTheme.typography.bodyLarge,
                        textAlign = TextAlign.Center,
                    )
                    Spacer(modifier = Modifier.height(24.dp))
                    QrPlaceholder(s.payloadJson)
                    Spacer(modifier = Modifier.height(16.dp))
                    Text(
                        "或在桌面手动输入：",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = s.payload.code,
                        fontSize = 36.sp,
                        fontWeight = FontWeight.Bold,
                        fontFamily = FontFamily.Monospace,
                        letterSpacing = 8.sp,
                    )
                    Spacer(modifier = Modifier.height(16.dp))
                    // v1.1 W3.6 manual-entry support: 显示 DID + deviceId 让用户在桌面
                    // 手动输入表单里读取（摄像头扫码无法用时的 fallback 路径）
                    PairingMetaRow(label = "DID", value = s.payload.did)
                    Spacer(modifier = Modifier.height(4.dp))
                    PairingMetaRow(label = "Device ID", value = s.payload.deviceInfo.deviceId)
                    Spacer(modifier = Modifier.height(4.dp))
                    PairingMetaRow(label = "设备名", value = s.payload.deviceInfo.name)
                    Spacer(modifier = Modifier.height(16.dp))
                    Text(
                        "5 分钟内有效",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }

                is DesktopPairingState.Completed -> StatusBlock(
                    title = "配对成功",
                    onAction = onClose,
                    actionLabel = "完成",
                )

                is DesktopPairingState.Expired -> StatusBlock(
                    title = "配对码已过期",
                    detail = "请重新生成",
                    onAction = { viewModel.startPairing() },
                    actionLabel = "重新生成",
                )

                is DesktopPairingState.Failed -> StatusBlock(
                    title = "配对失败",
                    detail = s.error,
                    onAction = { viewModel.startPairing() },
                    actionLabel = "重试",
                )
            }
        }
    }
}

/**
 * v1.1 W3.6 manual-entry：在 QR 下方展示 DID / Device ID / 设备名让用户在桌面
 * 手动输入表单里照填。Label 灰色短标 + Value monospace 长串可全选复制（Compose
 * SelectionContainer 自动支持）。
 */
@Composable
private fun PairingMetaRow(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.Center,
    ) {
        Text(
            text = "$label：",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            text = value,
            style = MaterialTheme.typography.labelSmall,
            fontFamily = FontFamily.Monospace,
            color = MaterialTheme.colorScheme.onSurface,
        )
    }
}

@Composable
private fun QrPlaceholder(payloadJson: String) {
    // W3.3a: 真 zxing QR bitmap。BG 白色 card 包一层保证暗色主题下扫描对比度足够。
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(8.dp)
            .border(
                width = 2.dp,
                color = MaterialTheme.colorScheme.outline,
                shape = RoundedCornerShape(12.dp),
            )
            .clip(RoundedCornerShape(12.dp))
            .background(Color.White),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            QrCodeImage(
                text = payloadJson,
                size = 240.dp,
            )
        }
    }
}

@Composable
private fun StatusBlock(
    title: String,
    detail: String? = null,
    onAction: () -> Unit,
    actionLabel: String,
) {
    Text(title, style = MaterialTheme.typography.headlineSmall)
    if (detail != null) {
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            detail,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
    }
    Spacer(modifier = Modifier.height(24.dp))
    Button(onClick = onAction) { Text(actionLabel) }
}

package com.chainlesschain.android.feature.p2p.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

/**
 * 会话指纹显示组件
 *
 * 将 SHA-256 指纹转换为可视化的颜色块网格
 */
@Composable
fun SessionFingerprintDisplay(
    fingerprint: String,
    peerId: String,
    isVerified: Boolean,
    onVerify: (() -> Unit)? = null,
    modifier: Modifier = Modifier
) {
    Card(
        modifier = modifier.fillMaxWidth()
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
        ) {
            // 标题
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "会话指纹",
                    style = MaterialTheme.typography.titleMedium
                )

                if (isVerified) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            imageVector = Icons.Default.Verified,
                            contentDescription = "已验证",
                            modifier = Modifier.size(16.dp),
                            tint = MaterialTheme.colorScheme.tertiary
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text(
                            text = "已验证",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.tertiary
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            // 颜色网格可视化
            FingerprintGrid(
                fingerprint = fingerprint
            )

            Spacer(modifier = Modifier.height(16.dp))

            // 十六进制指纹
            FingerprintHexDisplay(
                fingerprint = fingerprint
            )

            Spacer(modifier = Modifier.height(16.dp))

            // 说明文本
            Text(
                text = "此指纹由会话密钥生成，用于验证端到端加密的安全性",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth()
            )

            // 验证按钮（如果未验证）
            if (!isVerified && onVerify != null) {
                Spacer(modifier = Modifier.height(16.dp))

                Button(
                    onClick = onVerify,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Icon(
                        imageVector = Icons.Default.VerifiedUser,
                        contentDescription = null
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("验证此会话")
                }
            }
        }
    }
}

/**
 * 指纹颜色网格
 *
 * 将指纹的前 64 个十六进制字符转换为 8x8 的颜色网格
 */
@Composable
fun FingerprintGrid(
    fingerprint: String,
    modifier: Modifier = Modifier
) {
    val colors = remember(fingerprint) {
        fingerprintToColors(fingerprint)
    }

    Box(
        modifier = modifier
            .fillMaxWidth()
            .aspectRatio(1f)
            .background(
                color = MaterialTheme.colorScheme.surfaceVariant,
                shape = RoundedCornerShape(8.dp)
            )
            .padding(8.dp)
    ) {
        Canvas(
            modifier = Modifier.fillMaxSize()
        ) {
            val cellSize = size.width / 8f
            val spacing = 2.dp.toPx()

            colors.forEachIndexed { index, color ->
                val row = index / 8
                val col = index % 8

                val x = col * cellSize + spacing / 2
                val y = row * cellSize + spacing / 2
                val width = cellSize - spacing
                val height = cellSize - spacing

                drawRect(
                    color = color,
                    topLeft = Offset(x, y),
                    size = androidx.compose.ui.geometry.Size(width, height)
                )
            }
        }
    }
}

/**
 * 十六进制指纹显示
 */
@Composable
fun FingerprintHexDisplay(
    fingerprint: String,
    modifier: Modifier = Modifier
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant
        )
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp)
        ) {
            Text(
                text = "SHA-256 指纹",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            Spacer(modifier = Modifier.height(8.dp))

            // 分组显示指纹（每行 16 个字符）
            val lines = fingerprint.chunked(16)
            Column(
                verticalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                lines.forEach { line ->
                    Text(
                        text = line.chunked(4).joinToString(" "),
                        style = MaterialTheme.typography.bodySmall,
                        fontFamily = FontFamily.Monospace,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        }
    }
}

/**
 * 将指纹转换为颜色列表
 *
 * 将十六进制指纹的前 64 个字符转换为 64 个颜色
 * 每个十六进制字符映射到一个颜色值
 */
private fun fingerprintToColors(fingerprint: String): List<Color> {
    val hexChars = fingerprint.take(64).lowercase()

    return hexChars.map { char ->
        when (char) {
            '0' -> Color(0xFF1976D2) // 蓝色
            '1' -> Color(0xFF388E3C) // 绿色
            '2' -> Color(0xFFD32F2F) // 红色
            '3' -> Color(0xFFF57C00) // 橙色
            '4' -> Color(0xFF7B1FA2) // 紫色
            '5' -> Color(0xFF0097A7) // 青色
            '6' -> Color(0xFFC2185B) // 粉色
            '7' -> Color(0xFF5D4037) // 棕色
            '8' -> Color(0xFF303F9F) // 靛蓝
            '9' -> Color(0xFF689F38) // 浅绿
            'a' -> Color(0xFFE64A19) // 深橙
            'b' -> Color(0xFF00796B) // 蓝绿
            'c' -> Color(0xFF512DA8) // 深紫
            'd' -> Color(0xFFFBC02D) // 黄色
            'e' -> Color(0xFF455A64) // 蓝灰
            'f' -> Color(0xFF616161) // 灰色
            else -> Color(0xFF9E9E9E) // 默认灰色
        }
    }
}

/**
 * 会话指纹对比界面
 *
 * 并排显示本地和远程指纹，用于验证
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SessionFingerprintComparisonScreen(
    localFingerprint: String,
    remoteFingerprint: String,
    peerId: String,
    onBack: () -> Unit,
    onConfirmMatch: () -> Unit,
    onReportMismatch: () -> Unit
) {
    var showWarning by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("指纹对比") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                    }
                }
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .padding(16.dp)
        ) {
            // 说明文本
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.secondaryContainer
                )
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        imageVector = Icons.Default.Info,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSecondaryContainer
                    )

                    Spacer(modifier = Modifier.width(12.dp))

                    Text(
                        text = "请与对方比对以下指纹是否完全一致",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSecondaryContainer
                    )
                }
            }

            Spacer(modifier = Modifier.height(24.dp))

            // 本地指纹
            Text(
                text = "您的指纹",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.primary
            )

            Spacer(modifier = Modifier.height(8.dp))

            FingerprintGrid(
                fingerprint = localFingerprint,
                modifier = Modifier.fillMaxWidth()
            )

            Spacer(modifier = Modifier.height(24.dp))

            // 远程指纹
            Text(
                text = "$peerId 的指纹",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.primary
            )

            Spacer(modifier = Modifier.height(8.dp))

            FingerprintGrid(
                fingerprint = remoteFingerprint,
                modifier = Modifier.fillMaxWidth()
            )

            Spacer(modifier = Modifier.height(32.dp))

            // 操作按钮
            Button(
                onClick = onConfirmMatch,
                modifier = Modifier.fillMaxWidth()
            ) {
                Icon(
                    imageVector = Icons.Default.Check,
                    contentDescription = null
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text("指纹一致，确认验证")
            }

            Spacer(modifier = Modifier.height(8.dp))

            OutlinedButton(
                onClick = { showWarning = true },
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.outlinedButtonColors(
                    contentColor = MaterialTheme.colorScheme.error
                )
            ) {
                Icon(
                    imageVector = Icons.Default.Warning,
                    contentDescription = null
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text("指纹不一致")
            }
        }

        // 警告对话框
        if (showWarning) {
            AlertDialog(
                onDismissRequest = { showWarning = false },
                icon = {
                    Icon(
                        imageVector = Icons.Default.Warning,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.error
                    )
                },
                title = {
                    Text("安全警告")
                },
                text = {
                    Text(
                        "指纹不一致可能意味着通信被中间人攻击！\n\n" +
                                "建议立即断开连接并通过其他可信渠道联系对方。"
                    )
                },
                confirmButton = {
                    TextButton(
                        onClick = {
                            showWarning = false
                            onReportMismatch()
                        }
                    ) {
                        Text("断开连接")
                    }
                },
                dismissButton = {
                    TextButton(onClick = { showWarning = false }) {
                        Text("取消")
                    }
                }
            )
        }
    }
}

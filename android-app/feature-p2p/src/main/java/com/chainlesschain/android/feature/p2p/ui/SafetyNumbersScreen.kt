package com.chainlesschain.android.feature.p2p.ui

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.chainlesschain.android.core.e2ee.verification.CompleteVerificationInfo

/**
 * Safety Numbers 验证界面
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SafetyNumbersScreen(
    peerId: String,
    verificationInfo: CompleteVerificationInfo?,
    onVerify: () -> Unit,
    onScanQRCode: () -> Unit,
    onBack: () -> Unit
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("安全码验证") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                    }
                }
            )
        }
    ) { paddingValues ->
        if (verificationInfo == null) {
            // 加载状态
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(paddingValues),
                contentAlignment = Alignment.Center
            ) {
                CircularProgressIndicator()
            }
        } else {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(paddingValues)
                    .verticalScroll(rememberScrollState())
                    .padding(16.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                // 状态卡片
                VerificationStatusCard(
                    isVerified = verificationInfo.isVerified,
                    remoteIdentifier = verificationInfo.remoteIdentifier
                )

                Spacer(modifier = Modifier.height(24.dp))

                // 说明文本
                Text(
                    text = "与对方比对以下安全码，确保通信安全",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center
                )

                Spacer(modifier = Modifier.height(24.dp))

                // Safety Number 显示
                SafetyNumberDisplay(
                    safetyNumber = verificationInfo.safetyNumber
                )

                Spacer(modifier = Modifier.height(24.dp))

                // 二维码
                QRCodeDisplay(
                    qrCodeData = verificationInfo.qrCodeData
                )

                Spacer(modifier = Modifier.height(24.dp))

                // 操作按钮
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    OutlinedButton(
                        onClick = onScanQRCode,
                        modifier = Modifier.weight(1f)
                    ) {
                        Icon(
                            imageVector = Icons.Default.QrCodeScanner,
                            contentDescription = null
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("扫描对方")
                    }

                    Button(
                        onClick = onVerify,
                        modifier = Modifier.weight(1f),
                        enabled = !verificationInfo.isVerified
                    ) {
                        Icon(
                            imageVector = Icons.Default.Check,
                            contentDescription = null
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(if (verificationInfo.isVerified) "已验证" else "确认验证")
                    }
                }

                Spacer(modifier = Modifier.height(16.dp))

                // 帮助文本
                HelpCard()
            }
        }
    }
}

/**
 * 验证状态卡片
 */
@Composable
fun VerificationStatusCard(
    isVerified: Boolean,
    remoteIdentifier: String
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = if (isVerified)
                MaterialTheme.colorScheme.tertiaryContainer
            else
                MaterialTheme.colorScheme.surfaceVariant
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = if (isVerified) Icons.Default.Verified else Icons.Default.Shield,
                contentDescription = null,
                modifier = Modifier.size(40.dp),
                tint = if (isVerified)
                    MaterialTheme.colorScheme.tertiary
                else
                    MaterialTheme.colorScheme.onSurfaceVariant
            )

            Spacer(modifier = Modifier.width(16.dp))

            Column {
                Text(
                    text = if (isVerified) "已验证" else "未验证",
                    style = MaterialTheme.typography.titleMedium,
                    color = if (isVerified)
                        MaterialTheme.colorScheme.onTertiaryContainer
                    else
                        MaterialTheme.colorScheme.onSurfaceVariant
                )

                Text(
                    text = remoteIdentifier,
                    style = MaterialTheme.typography.bodySmall,
                    color = if (isVerified)
                        MaterialTheme.colorScheme.onTertiaryContainer
                    else
                        MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

/**
 * Safety Number 显示
 */
@Composable
fun SafetyNumberDisplay(
    safetyNumber: String
) {
    Card(
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(
                text = "安全码",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.primary
            )

            Spacer(modifier = Modifier.height(16.dp))

            // 分组显示安全码（每组 12 位）
            val groups = safetyNumber.split(" ")
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                groups.forEach { group ->
                    Text(
                        text = group,
                        style = MaterialTheme.typography.headlineSmall,
                        fontFamily = FontFamily.Monospace,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                }
            }
        }
    }
}

/**
 * 二维码显示
 */
@Composable
fun QRCodeDisplay(
    qrCodeData: String
) {
    var qrCodeBitmap by remember { mutableStateOf<Bitmap?>(null) }

    // 生成二维码
    LaunchedEffect(qrCodeData) {
        qrCodeBitmap = generateQRCode(qrCodeData, 512)
    }

    Card(
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(
                text = "二维码",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.primary
            )

            Spacer(modifier = Modifier.height(16.dp))

            if (qrCodeBitmap != null) {
                Image(
                    bitmap = qrCodeBitmap!!.asImageBitmap(),
                    contentDescription = "验证二维码",
                    modifier = Modifier.size(200.dp)
                )
            } else {
                CircularProgressIndicator()
            }

            Spacer(modifier = Modifier.height(8.dp))

            Text(
                text = "让对方扫描此二维码",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

/**
 * 帮助卡片
 */
@Composable
fun HelpCard() {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant
        )
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    imageVector = Icons.Default.Info,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = "如何验证？",
                    style = MaterialTheme.typography.titleSmall,
                    color = MaterialTheme.colorScheme.primary
                )
            }

            Spacer(modifier = Modifier.height(8.dp))

            Text(
                text = "1. 与对方面对面，或通过可信渠道（如电话）\n" +
                        "2. 比对双方显示的安全码是否一致\n" +
                        "3. 或扫描对方的二维码进行快速验证\n" +
                        "4. 确认一致后点击「确认验证」按钮",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

/**
 * 生成二维码
 */
private fun generateQRCode(content: String, size: Int): Bitmap {
    // 使用 ZXing 生成二维码
    val writer = com.google.zxing.qrcode.QRCodeWriter()
    val bitMatrix = writer.encode(
        content,
        com.google.zxing.BarcodeFormat.QR_CODE,
        size,
        size
    )

    val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.RGB_565)
    for (x in 0 until size) {
        for (y in 0 until size) {
            bitmap.setPixel(
                x,
                y,
                if (bitMatrix[x, y]) android.graphics.Color.BLACK else android.graphics.Color.WHITE
            )
        }
    }

    return bitmap
}

package com.chainlesschain.android.feature.p2p.ui.social

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import coil.compose.AsyncImage
import com.chainlesschain.android.feature.p2p.viewmodel.social.MyQRCodeViewModel
import com.chainlesschain.android.feature.p2p.viewmodel.social.MyQRCodeEvent

/**
 * 我的二维码页面
 *
 * 功能：
 * - 显示个人信息（头像、昵称、DID）
 * - 显示个人二维码（含签名验证）
 * - 保存二维码到相册
 * - 分享二维码
 *
 * @param onNavigateBack 返回上一页
 * @param onShowToast 显示Toast消息
 * @param viewModel ViewModel
 *
 * @since v0.31.0
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MyQRCodeScreen(
    onNavigateBack: () -> Unit,
    onShowToast: (String) -> Unit = {},
    viewModel: MyQRCodeViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()

    // 初始化时生成二维码
    LaunchedEffect(Unit) {
        viewModel.generateQRCode()
    }

    // 监听事件
    LaunchedEffect(Unit) {
        viewModel.events.collect { event ->
            when (event) {
                is MyQRCodeEvent.GenerateError -> {
                    onShowToast("生成二维码失败：${event.message}")
                }
                is MyQRCodeEvent.SaveSuccess -> {
                    onShowToast("二维码已保存到相册")
                }
                is MyQRCodeEvent.SaveError -> {
                    onShowToast("保存失败：${event.message}")
                }
                is MyQRCodeEvent.ShareTriggered -> {
                    onShowToast("分享功能即将推出")
                }
            }
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("我的二维码") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(
                            Icons.Default.ArrowBack,
                            contentDescription = "返回"
                        )
                    }
                },
                actions = {
                    // 保存到相册按钮
                    IconButton(
                        onClick = { viewModel.saveToGallery() },
                        enabled = uiState.qrCodeBitmap != null && !uiState.isLoading
                    ) {
                        Icon(
                            Icons.Default.Download,
                            contentDescription = "保存到相册"
                        )
                    }

                    // 分享按钮
                    IconButton(
                        onClick = { viewModel.shareQRCode() },
                        enabled = uiState.qrCodeBitmap != null && !uiState.isLoading
                    ) {
                        Icon(
                            Icons.Default.Share,
                            contentDescription = "分享"
                        )
                    }
                }
            )
        }
    ) { paddingValues ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues),
            contentAlignment = Alignment.Center
        ) {
            if (uiState.isLoading) {
                // 加载状态
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center
                ) {
                    CircularProgressIndicator()
                    Spacer(modifier = Modifier.height(16.dp))
                    Text(
                        text = "正在生成二维码...",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            } else {
                // 二维码显示
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                    modifier = Modifier.padding(24.dp)
                ) {
                    // 个人头像
                    AsyncImage(
                        model = uiState.avatarUrl,
                        contentDescription = "头像",
                        modifier = Modifier
                            .size(80.dp)
                            .clip(CircleShape),
                        contentScale = ContentScale.Crop,
                        error = null, // Default avatar placeholder requires drawable resource
                        placeholder = null
                    )

                    Spacer(modifier = Modifier.height(16.dp))

                    // 昵称
                    Text(
                        text = uiState.nickname,
                        style = MaterialTheme.typography.titleLarge,
                        color = MaterialTheme.colorScheme.onSurface
                    )

                    Spacer(modifier = Modifier.height(4.dp))

                    // DID（简化显示）
                    Text(
                        text = uiState.did.take(20) + "..." + uiState.did.takeLast(8),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )

                    Spacer(modifier = Modifier.height(32.dp))

                    // 二维码卡片
                    uiState.qrCodeBitmap?.let { bitmap ->
                        Card(
                            modifier = Modifier.size(280.dp),
                            elevation = CardDefaults.cardElevation(defaultElevation = 4.dp),
                            colors = CardDefaults.cardColors(
                                containerColor = MaterialTheme.colorScheme.surface
                            )
                        ) {
                            Box(
                                modifier = Modifier.fillMaxSize(),
                                contentAlignment = Alignment.Center
                            ) {
                                Image(
                                    bitmap = bitmap.asImageBitmap(),
                                    contentDescription = "二维码",
                                    modifier = Modifier
                                        .fillMaxSize()
                                        .padding(16.dp)
                                )
                            }
                        }
                    }

                    Spacer(modifier = Modifier.height(24.dp))

                    // 提示文字
                    Text(
                        text = "扫一扫上面的二维码，添加我为好友",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )

                    Spacer(modifier = Modifier.height(8.dp))

                    // 安全提示
                    Surface(
                        color = MaterialTheme.colorScheme.secondaryContainer,
                        shape = MaterialTheme.shapes.small,
                        modifier = Modifier.padding(horizontal = 32.dp)
                    ) {
                        Text(
                            text = "二维码包含数字签名，24小时内有效",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSecondaryContainer,
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp)
                        )
                    }
                }
            }

            // 错误状态
            if (uiState.errorMessage != null) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center
                ) {
                    Text(
                        text = "⚠️",
                        style = MaterialTheme.typography.displayMedium
                    )
                    Spacer(modifier = Modifier.height(16.dp))
                    Text(
                        text = uiState.errorMessage!!,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.error
                    )
                    Spacer(modifier = Modifier.height(16.dp))
                    Button(onClick = { viewModel.generateQRCode() }) {
                        Text("重试")
                    }
                }
            }
        }
    }
}

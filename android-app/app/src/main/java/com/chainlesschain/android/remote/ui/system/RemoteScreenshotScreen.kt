package com.chainlesschain.android.remote.ui.system

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.remote.p2p.ConnectionState
import java.text.SimpleDateFormat
import java.util.*

/**
 * 远程截图界面
 *
 * 功能：
 * - 截取 PC 端屏幕
 * - 显示和缩放截图
 * - 保存截图到本地相册
 * - 截图历史记录
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RemoteScreenshotScreen(
    viewModel: RemoteScreenshotViewModel = hiltViewModel(),
    onNavigateBack: () -> Unit
) {
    val uiState by viewModel.uiState.collectAsState()
    val screenshots by viewModel.screenshots.collectAsState()
    val connectionState by viewModel.connectionState.collectAsState()

    var showSettings by remember { mutableStateOf(false) }
    var showFullScreen by remember { mutableStateOf(false) }

    // 保存成功提示
    LaunchedEffect(uiState.saveSuccess) {
        if (uiState.saveSuccess) {
            kotlinx.coroutines.delay(2000)
            viewModel.clearSaveSuccess()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("远程截图") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "返回")
                    }
                },
                actions = {
                    // 设置按钮
                    IconButton(onClick = { showSettings = true }) {
                        Icon(Icons.Default.Settings, contentDescription = "设置")
                    }

                    // 全屏查看
                    if (uiState.currentScreenshot != null) {
                        IconButton(onClick = { showFullScreen = true }) {
                            Icon(Icons.Default.Fullscreen, contentDescription = "全屏")
                        }
                    }
                }
            )
        },
        floatingActionButton = {
            // 截图按钮
            if (connectionState == ConnectionState.CONNECTED) {
                ExtendedFloatingActionButton(
                    onClick = {
                        viewModel.takeScreenshot(
                            display = uiState.selectedDisplay,
                            quality = uiState.quality
                        )
                    },
                    icon = {
                        Icon(Icons.Default.Screenshot, contentDescription = null)
                    },
                    text = { Text("截图") },
                    containerColor = MaterialTheme.colorScheme.primaryContainer
                )
            }
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            when {
                connectionState != ConnectionState.CONNECTED -> {
                    // 未连接提示
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(16.dp)
                        ) {
                            Icon(
                                Icons.Default.CloudOff,
                                contentDescription = null,
                                modifier = Modifier.size(64.dp),
                                tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
                            )
                            Text(
                                text = "未连接到 PC",
                                style = MaterialTheme.typography.titleMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
                uiState.isTakingScreenshot -> {
                    // 截图中
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(16.dp)
                        ) {
                            CircularProgressIndicator()
                            Text(
                                text = "正在截图...",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
                uiState.currentScreenshot != null -> {
                    // 显示截图
                    Column(
                        modifier = Modifier.fillMaxSize(),
                        verticalArrangement = Arrangement.spacedBy(16.dp)
                    ) {
                        // 截图信息
                        ScreenshotInfoCard(screenshot = uiState.currentScreenshot!!)

                        // 截图预览
                        Box(
                            modifier = Modifier
                                .weight(1f)
                                .fillMaxWidth()
                        ) {
                            ZoomableImage(
                                screenshot = uiState.currentScreenshot!!,
                                modifier = Modifier.fillMaxSize()
                            )

                            // 保存按钮
                            FloatingActionButton(
                                onClick = {
                                    viewModel.saveScreenshot(uiState.currentScreenshot!!)
                                },
                                modifier = Modifier
                                    .align(Alignment.BottomEnd)
                                    .padding(16.dp),
                                containerColor = MaterialTheme.colorScheme.secondaryContainer
                            ) {
                                if (uiState.isSaving) {
                                    CircularProgressIndicator(
                                        modifier = Modifier.size(24.dp),
                                        strokeWidth = 2.dp
                                    )
                                } else {
                                    Icon(Icons.Default.Save, contentDescription = "保存")
                                }
                            }
                        }

                        // 截图历史
                        if (screenshots.size > 1) {
                            ScreenshotHistorySection(
                                screenshots = screenshots,
                                currentScreenshot = uiState.currentScreenshot,
                                onScreenshotClick = { viewModel.selectScreenshot(it) }
                            )
                        }
                    }
                }
                screenshots.isEmpty() -> {
                    // 空状态
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(16.dp)
                        ) {
                            Icon(
                                Icons.Default.Screenshot,
                                contentDescription = null,
                                modifier = Modifier.size(64.dp),
                                tint = MaterialTheme.colorScheme.primary.copy(alpha = 0.5f)
                            )
                            Text(
                                text = "尚未截图",
                                style = MaterialTheme.typography.titleMedium,
                                color = MaterialTheme.colorScheme.onSurface
                            )
                            Text(
                                text = "点击右下角按钮开始截图",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
                else -> {
                    // 显示最近的截图
                    viewModel.selectScreenshot(screenshots.first())
                }
            }

            // 错误提示
            uiState.error?.let { error ->
                Snackbar(
                    modifier = Modifier.padding(16.dp),
                    action = {
                        TextButton(onClick = { viewModel.clearError() }) {
                            Text("关闭")
                        }
                    }
                ) {
                    Text(error)
                }
            }

            // 保存成功提示
            if (uiState.saveSuccess) {
                Snackbar(
                    modifier = Modifier.padding(16.dp),
                    containerColor = MaterialTheme.colorScheme.tertiaryContainer
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Icon(
                            Icons.Default.CheckCircle,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.tertiary
                        )
                        Text("截图已保存到相册")
                    }
                }
            }
        }
    }

    // 设置对话框
    if (showSettings) {
        ScreenshotSettingsDialog(
            selectedDisplay = uiState.selectedDisplay,
            quality = uiState.quality,
            onDisplayChange = { viewModel.setDisplay(it) },
            onQualityChange = { viewModel.setQuality(it) },
            onDismiss = { showSettings = false }
        )
    }

    // 全屏查看
    if (showFullScreen && uiState.currentScreenshot != null) {
        FullScreenImageDialog(
            screenshot = uiState.currentScreenshot!!,
            onDismiss = { showFullScreen = false }
        )
    }
}

/**
 * 截图信息卡片
 */
@Composable
fun ScreenshotInfoCard(screenshot: ScreenshotItem) {
    val dateFormat = remember { SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault()) }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.primaryContainer
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalArrangement = Arrangement.SpaceEvenly
        ) {
            InfoItem(
                label = "分辨率",
                value = "${screenshot.width}x${screenshot.height}"
            )
            InfoItem(
                label = "显示器",
                value = "#${screenshot.display}"
            )
            InfoItem(
                label = "格式",
                value = screenshot.format.uppercase()
            )
            InfoItem(
                label = "时间",
                value = dateFormat.format(Date(screenshot.timestamp)).substring(11)
            )
        }
    }
}

/**
 * 信息项
 */
@Composable
fun InfoItem(label: String, value: String) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        Text(
            text = value,
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onPrimaryContainer
        )
        Text(
            text = label,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.7f)
        )
    }
}

/**
 * 可缩放图片
 */
@Composable
fun ZoomableImage(
    screenshot: ScreenshotItem,
    modifier: Modifier = Modifier
) {
    var scale by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }

    Box(
        modifier = modifier
            .background(Color.Black)
            .pointerInput(Unit) {
                detectTransformGestures { _, pan, zoom, _ ->
                    scale = (scale * zoom).coerceIn(1f, 5f)

                    if (scale > 1f) {
                        offset += pan
                    } else {
                        offset = Offset.Zero
                    }
                }
            },
        contentAlignment = Alignment.Center
    ) {
        Image(
            bitmap = screenshot.bitmap.asImageBitmap(),
            contentDescription = "截图",
            modifier = Modifier
                .fillMaxSize()
                .graphicsLayer(
                    scaleX = scale,
                    scaleY = scale,
                    translationX = offset.x,
                    translationY = offset.y
                ),
            contentScale = ContentScale.Fit
        )

        // 缩放提示
        if (scale > 1f) {
            Surface(
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(16.dp),
                shape = RoundedCornerShape(8.dp),
                color = Color.Black.copy(alpha = 0.6f)
            ) {
                Text(
                    text = "${(scale * 100).toInt()}%",
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                    color = Color.White,
                    style = MaterialTheme.typography.labelMedium
                )
            }
        }
    }
}

/**
 * 截图历史区域
 */
@Composable
fun ScreenshotHistorySection(
    screenshots: List<ScreenshotItem>,
    currentScreenshot: ScreenshotItem?,
    onScreenshotClick: (ScreenshotItem) -> Unit
) {
    Column(
        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Text(
            text = "历史截图 (${screenshots.size})",
            style = MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.Bold
        )

        LazyRow(
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            items(screenshots, key = { it.id }) { screenshot ->
                ScreenshotThumbnail(
                    screenshot = screenshot,
                    isSelected = screenshot.id == currentScreenshot?.id,
                    onClick = { onScreenshotClick(screenshot) }
                )
            }
        }
    }
}

/**
 * 截图缩略图
 */
@Composable
fun ScreenshotThumbnail(
    screenshot: ScreenshotItem,
    isSelected: Boolean,
    onClick: () -> Unit
) {
    Card(
        modifier = Modifier
            .size(80.dp)
            .clickable(onClick = onClick),
        shape = RoundedCornerShape(8.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (isSelected) {
                MaterialTheme.colorScheme.primaryContainer
            } else {
                MaterialTheme.colorScheme.surfaceVariant
            }
        ),
        border = if (isSelected) {
            androidx.compose.foundation.BorderStroke(
                2.dp,
                MaterialTheme.colorScheme.primary
            )
        } else null
    ) {
        Image(
            bitmap = screenshot.bitmap.asImageBitmap(),
            contentDescription = "截图缩略图",
            modifier = Modifier.fillMaxSize(),
            contentScale = ContentScale.Crop
        )
    }
}

/**
 * 截图设置对话框
 */
@Composable
fun ScreenshotSettingsDialog(
    selectedDisplay: Int,
    quality: Int,
    onDisplayChange: (Int) -> Unit,
    onQualityChange: (Int) -> Unit,
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("截图设置") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                // 显示器选择
                Column {
                    Text(
                        text = "显示器",
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.Bold
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        (0..2).forEach { display ->
                            FilterChip(
                                selected = selectedDisplay == display,
                                onClick = { onDisplayChange(display) },
                                label = { Text("#$display") }
                            )
                        }
                    }
                }

                // 质量设置
                Column {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text(
                            text = "图片质量",
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            text = "$quality%",
                            style = MaterialTheme.typography.bodyMedium
                        )
                    }

                    Slider(
                        value = quality.toFloat(),
                        onValueChange = { onQualityChange(it.toInt()) },
                        valueRange = 50f..100f,
                        steps = 4
                    )

                    Text(
                        text = "较高的质量会增加传输时间",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text("确定")
            }
        }
    )
}

/**
 * 全屏图片对话框
 */
@Composable
fun FullScreenImageDialog(
    screenshot: ScreenshotItem,
    onDismiss: () -> Unit
) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black)
            .clickable(onClick = onDismiss)
    ) {
        ZoomableImage(
            screenshot = screenshot,
            modifier = Modifier.fillMaxSize()
        )

        // 关闭按钮
        IconButton(
            onClick = onDismiss,
            modifier = Modifier
                .align(Alignment.TopEnd)
                .padding(16.dp)
        ) {
            Icon(
                Icons.Default.Close,
                contentDescription = "关闭",
                tint = Color.White
            )
        }
    }
}

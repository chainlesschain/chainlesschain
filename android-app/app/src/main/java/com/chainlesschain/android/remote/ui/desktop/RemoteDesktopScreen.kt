package com.chainlesschain.android.remote.ui.desktop

import android.graphics.Bitmap
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.remote.commands.DisplayInfo
import kotlinx.coroutines.delay
import kotlin.math.roundToInt

/**
 * 远程桌面屏幕
 *
 * 提供远程桌面连接、控制和显示功能
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RemoteDesktopScreen(
    deviceDid: String,
    onNavigateBack: () -> Unit,
    viewModel: RemoteDesktopViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val currentFrame by viewModel.currentFrame.collectAsState()
    val displays by viewModel.displays.collectAsState()
    val statistics by viewModel.statistics.collectAsState()

    var showSettings by remember { mutableStateOf(false) }
    var showStats by remember { mutableStateOf(false) }
    var showDisplaySelector by remember { mutableStateOf(false) }

    // 会话参数
    var quality by remember { mutableStateOf(80) }
    var maxFps by remember { mutableStateOf(30) }
    var selectedDisplayId by remember { mutableStateOf<Int?>(null) }

    // 启动会话
    LaunchedEffect(deviceDid) {
        if (!uiState.isConnected) {
            viewModel.startSession(
                did = deviceDid,
                displayId = selectedDisplayId,
                quality = quality,
                maxFps = maxFps
            )
        }
    }

    // 定期加载统计
    LaunchedEffect(uiState.isConnected) {
        while (uiState.isConnected) {
            viewModel.loadStatistics()
            delay(2000)
        }
    }

    // 停止会话
    DisposableEffect(Unit) {
        onDispose {
            if (uiState.isConnected) {
                viewModel.stopSession()
            }
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("远程桌面") },
                navigationIcon = {
                    IconButton(onClick = {
                        viewModel.stopSession()
                        onNavigateBack()
                    }) {
                        Icon(Icons.Default.ArrowBack, "返回")
                    }
                },
                actions = {
                    // 显示器选择
                    if (displays.isNotEmpty()) {
                        IconButton(onClick = { showDisplaySelector = true }) {
                            Icon(Icons.Default.Monitor, "选择显示器")
                        }
                    }

                    // 统计信息
                    IconButton(onClick = { showStats = !showStats }) {
                        Icon(Icons.Default.Analytics, "统计信息")
                    }

                    // 设置
                    IconButton(onClick = { showSettings = true }) {
                        Icon(Icons.Default.Settings, "设置")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = if (uiState.isConnected) {
                        MaterialTheme.colorScheme.primaryContainer
                    } else {
                        MaterialTheme.colorScheme.surface
                    }
                )
            )
        }
    ) { paddingValues ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            when {
                uiState.isLoading -> {
                    LoadingView()
                }

                uiState.error != null -> {
                    ErrorView(
                        error = uiState.error!!,
                        onRetry = {
                            viewModel.clearError()
                            viewModel.startSession(
                                did = deviceDid,
                                displayId = selectedDisplayId,
                                quality = quality,
                                maxFps = maxFps
                            )
                        }
                    )
                }

                uiState.isConnected -> {
                    // 远程桌面画布
                    RemoteDesktopCanvas(
                        frame = currentFrame,
                        inputControlEnabled = uiState.inputControlEnabled,
                        onMouseMove = { x, y -> viewModel.sendMouseMove(x, y) },
                        onMouseClick = { button, double -> viewModel.sendMouseClick(button, double) },
                        onMouseScroll = { dx, dy -> viewModel.sendMouseScroll(dx, dy) }
                    )

                    // 统计信息覆盖层
                    if (showStats) {
                        StatsOverlay(
                            uiState = uiState,
                            statistics = statistics,
                            onDismiss = { showStats = false }
                        )
                    }
                }
            }
        }
    }

    // 设置对话框
    if (showSettings) {
        SettingsDialog(
            quality = quality,
            maxFps = maxFps,
            onQualityChange = { quality = it },
            onMaxFpsChange = { maxFps = it },
            onConfirm = {
                showSettings = false
                if (uiState.isConnected) {
                    viewModel.stopSession()
                    viewModel.startSession(
                        did = deviceDid,
                        displayId = selectedDisplayId,
                        quality = quality,
                        maxFps = maxFps
                    )
                }
            },
            onDismiss = { showSettings = false }
        )
    }

    // 显示器选择对话框
    if (showDisplaySelector) {
        DisplaySelectorDialog(
            displays = displays,
            currentDisplayId = uiState.currentDisplay,
            onSelect = { displayId ->
                viewModel.switchDisplay(displayId)
                showDisplaySelector = false
            },
            onDismiss = { showDisplaySelector = false }
        )
    }
}

/**
 * 远程桌面画布
 */
@Composable
fun RemoteDesktopCanvas(
    frame: Bitmap?,
    inputControlEnabled: Boolean,
    onMouseMove: (Int, Int) -> Unit,
    onMouseClick: (String, Boolean) -> Unit,
    onMouseScroll: (Int, Int) -> Unit
) {
    var canvasSize by remember { mutableStateOf(IntSize.Zero) }
    var lastTapTime by remember { mutableStateOf(0L) }
    val doubleTapThreshold = 300L

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black)
            .onSizeChanged { canvasSize = it }
            .then(
                if (inputControlEnabled) {
                    Modifier
                        .pointerInput(Unit) {
                            detectTapGestures(
                                onTap = { offset ->
                                    // 计算远程坐标
                                    val (remoteX, remoteY) = calculateRemoteCoordinates(
                                        offset,
                                        canvasSize,
                                        frame
                                    )

                                    // 检测双击
                                    val currentTime = System.currentTimeMillis()
                                    val isDoubleTap = (currentTime - lastTapTime) < doubleTapThreshold
                                    lastTapTime = currentTime

                                    // 发送点击
                                    onMouseMove(remoteX, remoteY)
                                    onMouseClick("left", isDoubleTap)
                                },
                                onLongPress = { offset ->
                                    // 长按 = 右键
                                    val (remoteX, remoteY) = calculateRemoteCoordinates(
                                        offset,
                                        canvasSize,
                                        frame
                                    )
                                    onMouseMove(remoteX, remoteY)
                                    onMouseClick("right", false)
                                }
                            )
                        }
                        .pointerInput(Unit) {
                            detectDragGestures { change, dragAmount ->
                                // 拖拽 = 鼠标移动
                                val (remoteX, remoteY) = calculateRemoteCoordinates(
                                    change.position,
                                    canvasSize,
                                    frame
                                )
                                onMouseMove(remoteX, remoteY)

                                // 滚轮模拟（垂直拖拽）
                                if (kotlin.math.abs(dragAmount.y) > 10f) {
                                    val scrollAmount = (dragAmount.y / 10).roundToInt()
                                    onMouseScroll(0, -scrollAmount)
                                }
                            }
                        }
                } else {
                    Modifier
                }
            )
    ) {
        // 绘制帧
        if (frame != null) {
            Canvas(
                modifier = Modifier.fillMaxSize()
            ) {
                val imageBitmap = frame.asImageBitmap()

                // 计算缩放以适应屏幕
                val scale = minOf(
                    size.width / imageBitmap.width,
                    size.height / imageBitmap.height
                )

                // Draw image centered (simplified - no scaling for now)
                val offsetX = (size.width - imageBitmap.width) / 2
                val offsetY = (size.height - imageBitmap.height) / 2

                drawImage(
                    image = imageBitmap,
                    topLeft = Offset(offsetX, offsetY)
                )
            }
        } else {
            // 无帧时显示占位
            Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = "等待屏幕帧...",
                    color = Color.White,
                    style = MaterialTheme.typography.bodyLarge
                )
            }
        }

        // 输入禁用提示
        if (!inputControlEnabled) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp)
                    .align(Alignment.BottomCenter)
            ) {
                Card(
                    colors = CardDefaults.cardColors(
                        containerColor = Color.Black.copy(alpha = 0.7f)
                    )
                ) {
                    Row(
                        modifier = Modifier.padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            Icons.Default.Info,
                            contentDescription = null,
                            tint = Color.White
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = "输入控制已禁用（仅查看模式）",
                            color = Color.White,
                            style = MaterialTheme.typography.bodySmall
                        )
                    }
                }
            }
        }
    }
}

/**
 * 计算远程坐标
 */
private fun calculateRemoteCoordinates(
    touchOffset: Offset,
    canvasSize: IntSize,
    frame: Bitmap?
): Pair<Int, Int> {
    if (frame == null) return Pair(0, 0)

    val scale = minOf(
        canvasSize.width.toFloat() / frame.width,
        canvasSize.height.toFloat() / frame.height
    )

    val scaledWidth = frame.width * scale
    val scaledHeight = frame.height * scale

    val offsetX = (canvasSize.width - scaledWidth) / 2
    val offsetY = (canvasSize.height - scaledHeight) / 2

    val relativeX = (touchOffset.x - offsetX) / scale
    val relativeY = (touchOffset.y - offsetY) / scale

    val remoteX = relativeX.coerceIn(0f, frame.width.toFloat()).roundToInt()
    val remoteY = relativeY.coerceIn(0f, frame.height.toFloat()).roundToInt()

    return Pair(remoteX, remoteY)
}

/**
 * 加载视图
 */
@Composable
fun LoadingView() {
    Box(
        modifier = Modifier.fillMaxSize(),
        contentAlignment = Alignment.Center
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            CircularProgressIndicator()
            Spacer(modifier = Modifier.height(16.dp))
            Text("正在连接...")
        }
    }
}

/**
 * 错误视图
 */
@Composable
fun ErrorView(
    error: String,
    onRetry: () -> Unit
) {
    Box(
        modifier = Modifier.fillMaxSize(),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.padding(32.dp)
        ) {
            Icon(
                Icons.Default.Error,
                contentDescription = null,
                modifier = Modifier.size(64.dp),
                tint = MaterialTheme.colorScheme.error
            )
            Spacer(modifier = Modifier.height(16.dp))
            Text(
                text = error,
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.error
            )
            Spacer(modifier = Modifier.height(16.dp))
            Button(onClick = onRetry) {
                Text("重试")
            }
        }
    }
}

/**
 * 统计信息覆盖层
 */
@Composable
fun StatsOverlay(
    uiState: RemoteDesktopUiState,
    statistics: com.chainlesschain.android.remote.commands.StatsResponse?,
    onDismiss: () -> Unit
) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = 0.5f))
            .pointerInput(Unit) {
                detectTapGestures { onDismiss() }
            }
    ) {
        Card(
            modifier = Modifier
                .align(Alignment.TopEnd)
                .padding(16.dp)
                .width(280.dp)
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text(
                    text = "性能统计",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold
                )

                Spacer(modifier = Modifier.height(12.dp))

                StatItem("会话 ID", uiState.sessionId ?: "无")
                StatItem("帧数", "${uiState.totalFrames}")
                StatItem("总字节", formatBytes(uiState.totalBytes))
                StatItem("平均帧大小", formatBytes(uiState.avgFrameSize.toLong()))
                StatItem("捕获时间", "${uiState.avgCaptureTime} ms")
                StatItem("编码时间", "${uiState.avgEncodeTime} ms")
                StatItem("质量", "${uiState.quality}")
                StatItem("帧率", "${uiState.maxFps} FPS")

                statistics?.let {
                    Divider(modifier = Modifier.padding(vertical = 8.dp))
                    Text(
                        text = "全局统计",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Bold
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    StatItem("总帧数", "${it.totalFrames}")
                    StatItem("总字节", formatBytes(it.totalBytes))
                    StatItem("活动会话", "${it.activeSessions}")
                }
            }
        }
    }
}

@Composable
fun StatItem(label: String, value: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Text(
            text = value,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.Medium
        )
    }
}

/**
 * 设置对话框
 */
@Composable
fun SettingsDialog(
    quality: Int,
    maxFps: Int,
    onQualityChange: (Int) -> Unit,
    onMaxFpsChange: (Int) -> Unit,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("远程桌面设置") },
        text = {
            Column {
                Text(
                    text = "图像质量: $quality",
                    style = MaterialTheme.typography.bodyMedium
                )
                Slider(
                    value = quality.toFloat(),
                    onValueChange = { onQualityChange(it.roundToInt()) },
                    valueRange = 50f..100f,
                    steps = 9
                )

                Spacer(modifier = Modifier.height(16.dp))

                Text(
                    text = "最大帧率: $maxFps FPS",
                    style = MaterialTheme.typography.bodyMedium
                )
                Slider(
                    value = maxFps.toFloat(),
                    onValueChange = { onMaxFpsChange(it.roundToInt()) },
                    valueRange = 10f..60f,
                    steps = 9
                )

                Spacer(modifier = Modifier.height(8.dp))

                Text(
                    text = "注意：更改设置需要重新连接",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        },
        confirmButton = {
            Button(onClick = onConfirm) {
                Text("应用")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("取消")
            }
        }
    )
}

/**
 * 显示器选择对话框
 */
@Composable
fun DisplaySelectorDialog(
    displays: List<DisplayInfo>,
    currentDisplayId: Int?,
    onSelect: (Int) -> Unit,
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("选择显示器") },
        text = {
            LazyColumn {
                items(displays) { display ->
                    val isSelected = display.id == currentDisplayId

                    Card(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 4.dp),
                        colors = CardDefaults.cardColors(
                            containerColor = if (isSelected) {
                                MaterialTheme.colorScheme.primaryContainer
                            } else {
                                MaterialTheme.colorScheme.surface
                            }
                        ),
                        onClick = { onSelect(display.id) }
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(16.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(
                                Icons.Default.Monitor,
                                contentDescription = null
                            )
                            Spacer(modifier = Modifier.width(12.dp))
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = display.name,
                                    style = MaterialTheme.typography.bodyLarge,
                                    fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal
                                )
                                if (display.width != null && display.height != null) {
                                    Text(
                                        text = "${display.width} × ${display.height}",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                }
                            }
                            if (display.primary == true) {
                                Chip(
                                    label = { Text("主显示器") }
                                )
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text("关闭")
            }
        }
    )
}

@Composable
fun Chip(label: @Composable () -> Unit) {
    Surface(
        shape = MaterialTheme.shapes.small,
        color = MaterialTheme.colorScheme.secondaryContainer
    ) {
        Box(modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)) {
            ProvideTextStyle(MaterialTheme.typography.labelSmall) {
                label()
            }
        }
    }
}

/**
 * 格式化字节数
 */
fun formatBytes(bytes: Long): String {
    return when {
        bytes < 1024 -> "$bytes B"
        bytes < 1024 * 1024 -> "%.2f KB".format(bytes / 1024.0)
        bytes < 1024 * 1024 * 1024 -> "%.2f MB".format(bytes / (1024.0 * 1024.0))
        else -> "%.2f GB".format(bytes / (1024.0 * 1024.0 * 1024.0))
    }
}

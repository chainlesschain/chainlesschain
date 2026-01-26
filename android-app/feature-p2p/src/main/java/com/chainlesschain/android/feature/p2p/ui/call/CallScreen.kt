package com.chainlesschain.android.feature.p2p.ui.call

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.feature.p2p.call.CallState
import com.chainlesschain.android.feature.p2p.ui.call.components.CallControlButtons
import com.chainlesschain.android.feature.p2p.viewmodel.call.CallEvent
import com.chainlesschain.android.feature.p2p.viewmodel.call.CallViewModel
import kotlinx.coroutines.flow.collectLatest
import org.webrtc.SurfaceViewRenderer
import timber.log.Timber
import kotlin.time.Duration.Companion.seconds

/**
 * 通话界面
 *
 * 显示音频/视频通话界面，包括：
 * - 本地视频预览（如果是视频通话）
 * - 远程视频画面
 * - 通话控制按钮
 * - 通话状态和时长
 *
 * @param peerDid 对方DID
 * @param peerName 对方名称
 * @param isVideoCall 是否视频通话
 * @param onCallEnded 通话结束回调
 * @param viewModel 通话ViewModel
 *
 * @since v0.32.0
 */
@Composable
fun CallScreen(
    peerDid: String,
    peerName: String,
    isVideoCall: Boolean,
    onCallEnded: () -> Unit,
    viewModel: CallViewModel = hiltViewModel()
) {
    val context = LocalContext.current
    val uiState by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }

    // 通话时长计时器
    var callDuration by remember { mutableStateOf(0L) }
    LaunchedEffect(uiState.callState) {
        if (uiState.callState is CallState.Connected) {
            while (true) {
                kotlinx.coroutines.delay(1.seconds)
                callDuration++
            }
        }
    }

    // 收集事件
    LaunchedEffect(Unit) {
        viewModel.eventFlow.collectLatest { event ->
            when (event) {
                is CallEvent.ShowError -> {
                    snackbarHostState.showSnackbar(event.message)
                }
                is CallEvent.CallEnded -> {
                    onCallEnded()
                }
                else -> {}
            }
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
    ) {
        // 视频画面区域
        if (isVideoCall) {
            VideoCallContent(
                peerName = peerName,
                callState = uiState.callState,
                callDuration = callDuration,
                modifier = Modifier.fillMaxSize()
            )
        } else {
            AudioCallContent(
                peerName = peerName,
                callState = uiState.callState,
                callDuration = callDuration,
                modifier = Modifier.fillMaxSize()
            )
        }

        // 顶部信息栏
        CallInfoBar(
            peerName = peerName,
            callState = uiState.callState,
            callDuration = callDuration,
            modifier = Modifier
                .align(Alignment.TopCenter)
                .fillMaxWidth()
                .padding(16.dp)
        )

        // 底部控制按钮
        CallControlButtons(
            isVideoCall = isVideoCall,
            isMicrophoneMuted = uiState.isMicrophoneMuted,
            isSpeakerOn = uiState.isSpeakerOn,
            isFrontCamera = uiState.isFrontCamera,
            onMicrophoneToggle = { viewModel.toggleMicrophone() },
            onSpeakerToggle = { viewModel.toggleSpeaker() },
            onCameraSwitch = { viewModel.switchCamera() },
            onEndCall = { viewModel.endCall() },
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .padding(24.dp)
        )

        // Snackbar
        SnackbarHost(
            hostState = snackbarHostState,
            modifier = Modifier.align(Alignment.BottomCenter)
        )
    }
}

/**
 * 视频通话内容
 */
@Composable
private fun VideoCallContent(
    peerName: String,
    callState: CallState,
    callDuration: Long,
    modifier: Modifier = Modifier
) {
    Box(modifier = modifier) {
        // 远程视频画面（全屏）
        AndroidView(
            factory = { context ->
                SurfaceViewRenderer(context).apply {
                    setScalingType(org.webrtc.RendererCommon.ScalingType.SCALE_ASPECT_FILL)
                    setEnableHardwareScaler(true)
                }
            },
            modifier = Modifier.fillMaxSize()
        )

        // 本地视频预览（小窗）
        Box(
            modifier = Modifier
                .align(Alignment.TopEnd)
                .padding(16.dp)
                .size(120.dp, 160.dp)
                .clip(MaterialTheme.shapes.medium)
                .background(MaterialTheme.colorScheme.surfaceVariant)
        ) {
            AndroidView(
                factory = { context ->
                    SurfaceViewRenderer(context).apply {
                        setScalingType(org.webrtc.RendererCommon.ScalingType.SCALE_ASPECT_FILL)
                        setEnableHardwareScaler(true)
                        setMirror(true) // 前置摄像头镜像
                    }
                },
                modifier = Modifier.fillMaxSize()
            )
        }

        // 连接状态提示
        if (callState !is CallState.Connected) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color.Black.copy(alpha = 0.6f)),
                contentAlignment = Alignment.Center
            ) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(16.dp)
                ) {
                    CircularProgressIndicator(color = Color.White)
                    Text(
                        text = when (callState) {
                            is CallState.Initiating -> "正在发起通话..."
                            is CallState.Ringing -> "等待对方接听..."
                            is CallState.Receiving -> "正在接听..."
                            else -> ""
                        },
                        style = MaterialTheme.typography.bodyLarge,
                        color = Color.White
                    )
                }
            }
        }
    }
}

/**
 * 音频通话内容
 */
@Composable
private fun AudioCallContent(
    peerName: String,
    callState: CallState,
    callDuration: Long,
    modifier: Modifier = Modifier
) {
    Box(
        modifier = modifier
            .fillMaxSize()
            .background(
                androidx.compose.ui.graphics.Brush.verticalGradient(
                    colors = listOf(
                        MaterialTheme.colorScheme.primary,
                        MaterialTheme.colorScheme.primaryContainer
                    )
                )
            ),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(24.dp)
        ) {
            // 头像
            Box(
                modifier = Modifier
                    .size(120.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.surface),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = Icons.Default.Person,
                    contentDescription = null,
                    modifier = Modifier.size(64.dp),
                    tint = MaterialTheme.colorScheme.onSurface
                )
            }

            // 对方名称
            Text(
                text = peerName,
                style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.Bold,
                color = Color.White
            )

            // 通话状态
            Text(
                text = when (callState) {
                    is CallState.Initiating -> "正在发起通话..."
                    is CallState.Ringing -> "等待对方接听..."
                    is CallState.Receiving -> "正在接听..."
                    is CallState.Connected -> formatDuration(callDuration)
                    else -> ""
                },
                style = MaterialTheme.typography.bodyLarge,
                color = Color.White.copy(alpha = 0.8f)
            )

            // 连接中动画
            if (callState !is CallState.Connected) {
                CircularProgressIndicator(
                    color = Color.White,
                    modifier = Modifier.size(40.dp)
                )
            }
        }
    }
}

/**
 * 通话信息栏
 */
@Composable
private fun CallInfoBar(
    peerName: String,
    callState: CallState,
    callDuration: Long,
    modifier: Modifier = Modifier
) {
    Surface(
        modifier = modifier,
        color = Color.Black.copy(alpha = 0.3f),
        shape = MaterialTheme.shapes.medium
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically
        ) {
            // 通话状态图标
            if (callState is CallState.Connected) {
                Icon(
                    imageVector = Icons.Default.CheckCircle,
                    contentDescription = null,
                    tint = Color.Green,
                    modifier = Modifier.size(20.dp)
                )
                Spacer(modifier = Modifier.width(8.dp))
            }

            // 通话时长/状态
            Text(
                text = if (callState is CallState.Connected) {
                    formatDuration(callDuration)
                } else {
                    when (callState) {
                        is CallState.Initiating -> "正在发起..."
                        is CallState.Ringing -> "呼叫中..."
                        is CallState.Receiving -> "接听中..."
                        else -> ""
                    }
                },
                style = MaterialTheme.typography.bodyMedium,
                color = Color.White,
                fontWeight = FontWeight.Medium
            )
        }
    }
}

/**
 * 格式化通话时长
 */
private fun formatDuration(seconds: Long): String {
    val hours = seconds / 3600
    val minutes = (seconds % 3600) / 60
    val secs = seconds % 60

    return if (hours > 0) {
        String.format("%02d:%02d:%02d", hours, minutes, secs)
    } else {
        String.format("%02d:%02d", minutes, secs)
    }
}

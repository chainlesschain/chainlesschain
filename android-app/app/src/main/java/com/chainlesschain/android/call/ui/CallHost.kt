package com.chainlesschain.android.call.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.CallEnd
import androidx.compose.material.icons.filled.Cameraswitch
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material.icons.filled.VideocamOff
import androidx.compose.material.icons.filled.VolumeUp
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.call.CallDirection
import com.chainlesschain.android.call.CallMediaType
import com.chainlesschain.android.call.CallSession
import com.chainlesschain.android.call.CallState
import kotlinx.coroutines.delay
import org.webrtc.EglBase
import org.webrtc.RendererCommon
import org.webrtc.SurfaceViewRenderer
import org.webrtc.VideoTrack

/**
 * FAMILY-67 全局通话浮层宿主。挂在 [com.chainlesschain.android.MainActivity] 顶层，
 * 监听 [CallViewModel.callState]：非空即弹全屏 [Dialog] 覆盖任意页面（来电响铃、去电拨号、
 * 通话中），故任意界面都能接到来电。视频通话（P2）额外渲染远端全屏 + 本地 PiP。
 */
@Composable
fun CallHost(viewModel: CallViewModel = hiltViewModel()) {
    val session by viewModel.callState.collectAsState()
    val s = session ?: return
    val isVideo = s.media == CallMediaType.VIDEO

    // 通话需录音权限（视频还需摄像头）：来电/去电出现时确保已授权。
    val context = androidx.compose.ui.platform.LocalContext.current
    val permLauncher = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.RequestMultiplePermissions(),
    ) { /* 拒绝则相应媒体捕获静音/黑屏；用户可在系统设置授予后重拨 */ }
    LaunchedEffect(s.callId, isVideo) {
        val needed = buildList {
            add(android.Manifest.permission.RECORD_AUDIO)
            if (isVideo) add(android.Manifest.permission.CAMERA)
        }.filter {
            androidx.core.content.ContextCompat.checkSelfPermission(context, it) !=
                android.content.pm.PackageManager.PERMISSION_GRANTED
        }
        if (needed.isNotEmpty()) permLauncher.launch(needed.toTypedArray())
    }

    Dialog(
        onDismissRequest = { /* 通话浮层不允许点外部关闭，须显式挂断 */ },
        properties = DialogProperties(
            usePlatformDefaultWidth = false,
            dismissOnBackPress = false,
            dismissOnClickOutside = false,
        ),
    ) {
        Surface(
            modifier = Modifier.fillMaxSize(),
            color = if (isVideo) Color.Black else MaterialTheme.colorScheme.surface,
        ) {
            Box(Modifier.fillMaxSize()) {
                // 视频层（仅视频通话，连接中/通话中）
                if (isVideo && (s.state == CallState.ACTIVE || s.state == CallState.CONNECTING)) {
                    VideoLayer(viewModel)
                }
                CallContent(
                    session = s,
                    isVideo = isVideo,
                    onAccept = viewModel::accept,
                    onReject = viewModel::reject,
                    onHangup = viewModel::hangup,
                    onToggleMute = { viewModel.setMuted(!s.muted) },
                    onToggleSpeaker = { viewModel.setSpeaker(!s.speakerOn) },
                    onSwitchCamera = viewModel::switchCamera,
                )
            }
        }
    }
}

@Composable
private fun VideoLayer(viewModel: CallViewModel) {
    val remote by viewModel.remoteVideoTrack.collectAsState()
    val local by viewModel.localVideoTrack.collectAsState()
    val egl = remember { viewModel.eglContext() }

    // 远端全屏
    remote?.let { track ->
        VideoSink(track, egl, mirror = false, modifier = Modifier.fillMaxSize())
    }
    // 本地小窗 PiP（右上角）
    Box(Modifier.fillMaxSize().padding(16.dp)) {
        local?.let { track ->
            Box(
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(top = 48.dp)
                    .size(width = 108.dp, height = 160.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(Color.DarkGray),
            ) {
                VideoSink(track, egl, mirror = true, modifier = Modifier.fillMaxSize())
            }
        }
    }
}

/** 一个 [SurfaceViewRenderer]，按 track 生命周期 init/addSink/removeSink/release。 */
@Composable
private fun VideoSink(
    track: VideoTrack,
    egl: EglBase.Context,
    mirror: Boolean,
    modifier: Modifier = Modifier,
) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val renderer = remember {
        SurfaceViewRenderer(context).apply {
            init(egl, null)
            setScalingType(RendererCommon.ScalingType.SCALE_ASPECT_FILL)
            setEnableHardwareScaler(true)
            setMirror(mirror)
        }
    }
    androidx.compose.runtime.DisposableEffect(track) {
        runCatching { track.addSink(renderer) }
        onDispose {
            runCatching { track.removeSink(renderer) }
            runCatching { renderer.release() }
        }
    }
    AndroidView(factory = { renderer }, modifier = modifier)
}

@Composable
private fun CallContent(
    session: CallSession,
    isVideo: Boolean,
    onAccept: () -> Unit,
    onReject: () -> Unit,
    onHangup: () -> Unit,
    onToggleMute: () -> Unit,
    onToggleSpeaker: () -> Unit,
    onSwitchCamera: () -> Unit,
) {
    // 视频通话激活时文字用浅色（黑底视频上方）
    val onBg = if (isVideo && session.state == CallState.ACTIVE) Color.White
    else MaterialTheme.colorScheme.onSurface
    val subColor = if (isVideo && session.state == CallState.ACTIVE) Color(0xFFDDDDDD)
    else MaterialTheme.colorScheme.onSurfaceVariant

    Column(
        modifier = Modifier.fillMaxSize().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(72.dp))

        // 头像占位（视频激活时隐藏，避免遮挡画面）
        if (!(isVideo && session.state == CallState.ACTIVE)) {
            Box(
                modifier = Modifier.size(96.dp).clip(CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = if (isVideo) Icons.Filled.Videocam else Icons.Filled.Call,
                    contentDescription = null,
                    modifier = Modifier.size(96.dp),
                    tint = MaterialTheme.colorScheme.primary,
                )
            }
            Spacer(Modifier.height(20.dp))
        }
        Text(
            text = shortDid(session.peerDid),
            style = MaterialTheme.typography.headlineSmall,
            color = onBg,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(8.dp))
        Text(text = statusLine(session), style = MaterialTheme.typography.bodyLarge, color = subColor)

        Spacer(Modifier.weight(1f))

        when {
            // 来电：接听 / 拒接
            session.state == CallState.INCOMING -> {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                    CircleButton(Icons.Filled.CallEnd, Color(0xFFD32F2F), "拒接", onReject)
                    CircleButton(
                        if (isVideo) Icons.Filled.Videocam else Icons.Filled.Call,
                        Color(0xFF388E3C), "接听", onAccept,
                    )
                }
            }
            // 通话中：静音 / (摄像头切换) / 扬声器 / 挂断
            session.state == CallState.ACTIVE -> {
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceEvenly,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    CircleButton(
                        if (session.muted) Icons.Filled.MicOff else Icons.Filled.Mic,
                        if (session.muted) Color(0xFF757575) else MaterialTheme.colorScheme.primary,
                        if (session.muted) "已静音" else "静音", onToggleMute,
                    )
                    if (isVideo) {
                        CircleButton(Icons.Filled.Cameraswitch, Color(0xFF607D8B), "翻转", onSwitchCamera)
                    }
                    CircleButton(Icons.Filled.CallEnd, Color(0xFFD32F2F), "挂断", onHangup)
                    CircleButton(
                        Icons.Filled.VolumeUp,
                        if (session.speakerOn) MaterialTheme.colorScheme.primary else Color(0xFF757575),
                        if (session.speakerOn) "扬声器开" else "扬声器", onToggleSpeaker,
                    )
                }
            }
            // 去电 / 连接中 / 结束：仅挂断
            else -> {
                CircleButton(Icons.Filled.CallEnd, Color(0xFFD32F2F), "挂断", onHangup)
            }
        }

        Spacer(Modifier.height(48.dp))
    }
}

@Composable
private fun CircleButton(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    bg: Color,
    label: String,
    onClick: () -> Unit,
) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Surface(
            shape = CircleShape,
            color = bg,
            modifier = Modifier.size(64.dp).clip(CircleShape).clickable(onClick = onClick),
        ) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Icon(icon, contentDescription = label, tint = Color.White, modifier = Modifier.size(28.dp))
            }
        }
        Spacer(Modifier.height(6.dp))
        Text(label, style = MaterialTheme.typography.labelMedium)
    }
}

@Composable
private fun statusLine(session: CallSession): String {
    val mediaLabel = if (session.media == CallMediaType.VIDEO) "视频通话" else "语音通话"
    return when (session.state) {
        CallState.OUTGOING -> "正在呼叫…"
        CallState.OUTGOING_RINGING -> "等待对方接听…"
        CallState.INCOMING -> "$mediaLabel 来电…"
        CallState.CONNECTING -> "连接中…"
        CallState.ACTIVE -> activeTimer(session)
        CallState.ENDED -> "通话结束"
        CallState.IDLE -> mediaLabel
    }
}

@Composable
private fun activeTimer(session: CallSession): String {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(session.callId) {
        while (true) {
            now = System.currentTimeMillis()
            delay(500)
        }
    }
    val base = session.connectedAtMs ?: now
    val secs = ((now - base).coerceAtLeast(0)) / 1000
    return "%02d:%02d".format(secs / 60, secs % 60)
}

private fun shortDid(did: String): String =
    if (did.length <= 22) did else did.take(14) + "…" + did.takeLast(6)

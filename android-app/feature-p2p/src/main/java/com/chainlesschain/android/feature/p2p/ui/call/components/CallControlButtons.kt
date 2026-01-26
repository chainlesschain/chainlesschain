package com.chainlesschain.android.feature.p2p.ui.call.components

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp

/**
 * 通话控制按钮组
 *
 * 显示通话过程中的控制按钮：
 * - 麦克风静音/取消静音
 * - 扬声器开/关
 * - 切换摄像头（视频通话）
 * - 挂断
 *
 * @param isVideoCall 是否视频通话
 * @param isMicrophoneMuted 麦克风是否静音
 * @param isSpeakerOn 扬声器是否开启
 * @param isFrontCamera 是否前置摄像头
 * @param onMicrophoneToggle 麦克风切换回调
 * @param onSpeakerToggle 扬声器切换回调
 * @param onCameraSwitch 摄像头切换回调
 * @param onEndCall 挂断回调
 *
 * @since v0.32.0
 */
@Composable
fun CallControlButtons(
    isVideoCall: Boolean,
    isMicrophoneMuted: Boolean,
    isSpeakerOn: Boolean,
    isFrontCamera: Boolean,
    onMicrophoneToggle: () -> Unit,
    onSpeakerToggle: () -> Unit,
    onCameraSwitch: () -> Unit,
    onEndCall: () -> Unit,
    modifier: Modifier = Modifier
) {
    Surface(
        modifier = modifier,
        color = Color.Black.copy(alpha = 0.5f),
        shape = MaterialTheme.shapes.large
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalArrangement = Arrangement.SpaceEvenly,
            verticalAlignment = Alignment.CenterVertically
        ) {
            // 麦克风
            CallControlButton(
                icon = if (isMicrophoneMuted) Icons.Default.MicOff else Icons.Default.Mic,
                label = if (isMicrophoneMuted) "取消静音" else "静音",
                isActive = !isMicrophoneMuted,
                onClick = onMicrophoneToggle
            )

            // 扬声器
            CallControlButton(
                icon = if (isSpeakerOn) Icons.Default.VolumeUp else Icons.Default.VolumeDown,
                label = if (isSpeakerOn) "扬声器" else "听筒",
                isActive = isSpeakerOn,
                onClick = onSpeakerToggle
            )

            // 切换摄像头（仅视频通话）
            if (isVideoCall) {
                CallControlButton(
                    icon = Icons.Default.Cameraswitch,
                    label = "切换",
                    isActive = true,
                    onClick = onCameraSwitch
                )
            }

            // 挂断（红色按钮）
            CallControlButton(
                icon = Icons.Default.CallEnd,
                label = "挂断",
                isActive = true,
                backgroundColor = Color.Red,
                onClick = onEndCall
            )
        }
    }
}

/**
 * 单个通话控制按钮
 */
@Composable
private fun CallControlButton(
    icon: ImageVector,
    label: String,
    isActive: Boolean,
    backgroundColor: Color = MaterialTheme.colorScheme.surface,
    onClick: () -> Unit
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        // 圆形按钮
        FloatingActionButton(
            onClick = onClick,
            containerColor = if (isActive) backgroundColor else MaterialTheme.colorScheme.surfaceVariant,
            contentColor = if (isActive) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
            shape = CircleShape,
            modifier = Modifier.size(56.dp)
        ) {
            Icon(
                imageVector = icon,
                contentDescription = label,
                modifier = Modifier.size(24.dp)
            )
        }

        // 按钮标签
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = Color.White
        )
    }
}

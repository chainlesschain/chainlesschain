package com.chainlesschain.android.presentation.screens

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.delay

/**
 * 录音中对话框 —— 居中珊瑚橙圆形 mic 图标 + 呼吸光环 + 计时 + Stop 圆按钮 + Cancel
 */
@Composable
fun VoiceRecordingDialog(
    onStop: () -> Unit,
    onCancel: () -> Unit
) {
    Dialog(
        onDismissRequest = onCancel,
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Surface(
            modifier = Modifier
                .padding(horizontal = 32.dp)
                .fillMaxWidth(),
            shape = RoundedCornerShape(24.dp),
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 4.dp
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                // 顶部右上角 Close
                Box(modifier = Modifier.fillMaxWidth()) {
                    IconButton(
                        onClick = onCancel,
                        modifier = Modifier.align(Alignment.TopEnd).size(28.dp)
                    ) {
                        Icon(
                            Icons.Default.Close,
                            contentDescription = "取消",
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.size(18.dp)
                        )
                    }
                }

                // 呼吸 mic 圆
                PulsingMic()

                Spacer(modifier = Modifier.height(20.dp))

                Text(
                    text = "正在聆听",
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurface
                )

                Spacer(modifier = Modifier.height(6.dp))

                // 计时
                RecordingTimer()

                Spacer(modifier = Modifier.height(8.dp))

                Text(
                    text = "说完后轻点下方按钮识别",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )

                Spacer(modifier = Modifier.height(24.dp))

                // Stop 圆形大按钮
                Surface(
                    modifier = Modifier.size(72.dp).clip(CircleShape),
                    shape = CircleShape,
                    color = MaterialTheme.colorScheme.primary,
                    onClick = onStop
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(
                            Icons.Default.Stop,
                            contentDescription = "完成识别",
                            tint = MaterialTheme.colorScheme.onPrimary,
                            modifier = Modifier.size(32.dp)
                        )
                    }
                }
            }
        }
    }
}

/**
 * 识别中对话框 —— 3 dot 错峰呼吸（与 splash 一致风格）
 */
@Composable
fun VoiceTranscribingDialog() {
    Dialog(
        onDismissRequest = { /* 不可取消 */ },
        properties = DialogProperties(
            usePlatformDefaultWidth = false,
            dismissOnBackPress = false,
            dismissOnClickOutside = false
        )
    ) {
        Surface(
            modifier = Modifier.padding(horizontal = 64.dp),
            shape = RoundedCornerShape(20.dp),
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 4.dp
        ) {
            Column(
                modifier = Modifier.padding(28.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                ThreeDotIndicatorPrimary()
                Spacer(modifier = Modifier.height(16.dp))
                Text(
                    text = "正在识别...",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold
                )
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = "豆包 SeedASR 大模型",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

@Composable
private fun PulsingMic() {
    val transition = rememberInfiniteTransition(label = "mic")
    val scale by transition.animateFloat(
        initialValue = 1.0f,
        targetValue = 1.18f,
        animationSpec = infiniteRepeatable(
            animation = tween(900, easing = LinearEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "micScale"
    )
    val alpha by transition.animateFloat(
        initialValue = 0.3f,
        targetValue = 0.0f,
        animationSpec = infiniteRepeatable(
            animation = tween(1400, easing = LinearEasing),
            repeatMode = RepeatMode.Restart
        ),
        label = "micRing"
    )
    Box(modifier = Modifier.size(120.dp), contentAlignment = Alignment.Center) {
        // 外圈光环
        Box(
            modifier = Modifier
                .size(120.dp)
                .scale(1.0f + (1.0f - alpha) * 0.4f)
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.primary.copy(alpha = alpha * 0.6f))
        )
        // 内圈 mic 容器
        Box(
            modifier = Modifier
                .size(80.dp)
                .scale(scale)
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.primary),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                Icons.Default.Mic,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onPrimary,
                modifier = Modifier.size(36.dp)
            )
        }
    }
}

@Composable
private fun RecordingTimer() {
    val startMs = remember { System.currentTimeMillis() }
    var elapsedSec by remember { mutableLongStateOf(0L) }
    LaunchedEffect(Unit) {
        while (true) {
            elapsedSec = (System.currentTimeMillis() - startMs) / 1000L
            delay(1000)
        }
    }
    val mm = elapsedSec / 60
    val ss = elapsedSec % 60
    Text(
        text = "%02d:%02d".format(mm, ss),
        style = MaterialTheme.typography.titleMedium,
        color = MaterialTheme.colorScheme.primary,
        fontWeight = FontWeight.Medium
    )
}

@Composable
private fun ThreeDotIndicatorPrimary() {
    val transition = rememberInfiniteTransition(label = "dots-asr")
    val cycleMs = 1100
    val dotAnims = (0..2).map { idx ->
        transition.animateFloat(
            initialValue = 0.3f,
            targetValue = 1f,
            animationSpec = infiniteRepeatable(
                animation = tween(cycleMs, delayMillis = idx * (cycleMs / 4), easing = LinearEasing),
                repeatMode = RepeatMode.Reverse
            ),
            label = "dot$idx"
        )
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        dotAnims.forEach { a ->
            Box(
                modifier = Modifier
                    .size(10.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.primary.copy(alpha = a.value))
            )
        }
    }
}

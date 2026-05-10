package com.chainlesschain.android.presentation.screens

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.chainlesschain.android.R
import kotlinx.coroutines.delay

/**
 * 启动 Splash —— 视觉对齐桌面端 ThinkingProcess loading 画面：
 * 紫色渐变背景 + 旋转光环 + TT logo + 3 dot + 进度条 + 阶段文本。
 *
 * 显示约 2.5s 后调 [onComplete]，由调用方决定跳到 Login / Home / SetupPin。
 */
@Composable
fun SplashScreen(onComplete: () -> Unit) {
    val totalDurationMs = 2500
    val stages = listOf(
        "正在初始化运行时",
        "加载身份与密钥",
        "准备 AI 引擎",
        "即将就绪"
    )

    var progress by remember { mutableFloatStateOf(0f) }
    var stageIndex by remember { mutableStateOf(0) }

    // 用 rememberUpdatedState 锁住最新的 onComplete —— 否则 LaunchedEffect(Unit)
    // 在第一次合成时捕获的 lambda 会 close over MainActivity 还没读完 DataStore
    // 时算出的 stale `nextAfterSplash`（初始 isSetupComplete=false → SetupPin），
    // 导致已注册用户被错误送回设置 PIN 页。
    val currentOnComplete by rememberUpdatedState(onComplete)

    LaunchedEffect(Unit) {
        val tickMs = 50L
        val steps = totalDurationMs / tickMs.toInt()
        for (i in 1..steps) {
            delay(tickMs)
            val frac = i.toFloat() / steps
            progress = frac
            stageIndex = (frac * stages.size).toInt().coerceIn(0, stages.size - 1)
        }
        currentOnComplete()
    }

    val bg = Brush.verticalGradient(
        colors = listOf(
            Color(0xFFB57BD8),
            Color(0xFF7E40A8),
            Color(0xFF4A1B7A)
        )
    )

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(bg),
        contentAlignment = Alignment.Center
    ) {
        // 右上角 radial bloom（参考图右上的高光气泡）
        Canvas(modifier = Modifier.fillMaxSize()) {
            drawCircle(
                brush = Brush.radialGradient(
                    colors = listOf(
                        Color.White.copy(alpha = 0.18f),
                        Color.Transparent
                    ),
                    center = Offset(size.width * 0.85f, size.height * 0.18f),
                    radius = size.width * 0.45f
                ),
                center = Offset(size.width * 0.85f, size.height * 0.18f),
                radius = size.width * 0.45f
            )
        }

        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 32.dp)
        ) {
            LogoWithRotatingRing(diameter = 140)

            Spacer(modifier = Modifier.height(28.dp))

            Text(
                text = "CHAINLESSCHAIN",
                color = Color.White,
                fontSize = 18.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 4.sp
            )

            Spacer(modifier = Modifier.height(20.dp))

            ThreeDotIndicator()

            Spacer(modifier = Modifier.height(20.dp))

            LinearProgressIndicator(
                progress = { progress },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(4.dp)
                    .clip(RoundedCornerShape(2.dp)),
                color = Color.White,
                trackColor = Color.White.copy(alpha = 0.25f)
            )

            Spacer(modifier = Modifier.height(12.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(
                    text = "阶段 ${stageIndex + 1}: ${stages[stageIndex]}",
                    color = Color.White.copy(alpha = 0.85f),
                    fontSize = 12.sp
                )
                Text(
                    text = "${(progress * 100).toInt()}%",
                    color = Color.White.copy(alpha = 0.85f),
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Medium
                )
            }
        }
    }
}

@Composable
private fun LogoWithRotatingRing(diameter: Int) {
    val transition = rememberInfiniteTransition(label = "ring")
    val angle by transition.animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 2400, easing = LinearEasing),
            repeatMode = RepeatMode.Restart
        ),
        label = "ringAngle"
    )

    Box(
        modifier = Modifier.size(diameter.dp),
        contentAlignment = Alignment.Center
    ) {
        // 旋转光环：sweep gradient arc
        Canvas(
            modifier = Modifier
                .fillMaxSize()
                .rotate(angle)
        ) {
            val stroke = 4.dp.toPx()
            val sweepBrush = Brush.sweepGradient(
                colors = listOf(
                    Color.White.copy(alpha = 0.0f),
                    Color.White.copy(alpha = 0.2f),
                    Color.White.copy(alpha = 0.7f),
                    Color.White.copy(alpha = 0.95f),
                    Color.White.copy(alpha = 0.7f),
                    Color.White.copy(alpha = 0.2f),
                    Color.White.copy(alpha = 0.0f)
                )
            )
            drawCircle(
                brush = sweepBrush,
                radius = (this.size.minDimension - stroke) / 2,
                style = Stroke(width = stroke, cap = StrokeCap.Round)
            )
        }

        // 内圈半透明描边（给 logo 一个柔和的"框"）
        Box(
            modifier = Modifier
                .size((diameter - 28).dp)
                .clip(CircleShape)
                .background(Color.White.copy(alpha = 0.08f))
        )

        // 中心 logo
        Image(
            painter = painterResource(id = R.mipmap.ic_launcher),
            contentDescription = null,
            modifier = Modifier
                .size((diameter - 56).dp)
                .clip(CircleShape)
        )
    }
}

@Composable
private fun ThreeDotIndicator() {
    val transition = rememberInfiniteTransition(label = "dots")
    val cycleMs = 1200
    val dotAnims = (0..2).map { idx ->
        transition.animateFloat(
            initialValue = 0.3f,
            targetValue = 1f,
            animationSpec = infiniteRepeatable(
                animation = tween(
                    durationMillis = cycleMs,
                    delayMillis = idx * (cycleMs / 4),
                    easing = LinearEasing
                ),
                repeatMode = RepeatMode.Reverse
            ),
            label = "dot$idx"
        )
    }

    Row(
        horizontalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        dotAnims.forEach { alphaAnim ->
            Box(
                modifier = Modifier
                    .size(8.dp)
                    .clip(CircleShape)
                    .background(Color.White.copy(alpha = alphaAnim.value))
            )
        }
    }
}

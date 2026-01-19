package com.chainlesschain.android.feature.p2p.ui

import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.dp

/**
 * P2P UI 动画效果
 *
 * 提供统一的动画效果和过渡
 */

/**
 * 淡入淡出动画
 */
@Composable
fun FadeInOut(
    visible: Boolean,
    content: @Composable () -> Unit
) {
    AnimatedVisibility(
        visible = visible,
        enter = fadeIn(
            animationSpec = tween(durationMillis = 300)
        ),
        exit = fadeOut(
            animationSpec = tween(durationMillis = 300)
        )
    ) {
        content()
    }
}

/**
 * 滑入滑出动画
 */
@Composable
fun SlideInOut(
    visible: Boolean,
    content: @Composable () -> Unit
) {
    AnimatedVisibility(
        visible = visible,
        enter = slideInVertically(
            initialOffsetY = { it },
            animationSpec = spring(
                dampingRatio = Spring.DampingRatioMediumBouncy,
                stiffness = Spring.StiffnessLow
            )
        ) + fadeIn(),
        exit = slideOutVertically(
            targetOffsetY = { it },
            animationSpec = tween(durationMillis = 300)
        ) + fadeOut()
    ) {
        content()
    }
}

/**
 * 展开收起动画
 */
@Composable
fun ExpandCollapse(
    visible: Boolean,
    content: @Composable () -> Unit
) {
    AnimatedVisibility(
        visible = visible,
        enter = expandVertically(
            animationSpec = spring(
                dampingRatio = Spring.DampingRatioMediumBouncy
            )
        ) + fadeIn(),
        exit = shrinkVertically(
            animationSpec = tween(durationMillis = 300)
        ) + fadeOut()
    ) {
        content()
    }
}

/**
 * 缩放动画
 */
@Composable
fun ScaleInOut(
    visible: Boolean,
    content: @Composable () -> Unit
) {
    AnimatedVisibility(
        visible = visible,
        enter = scaleIn(
            initialScale = 0.8f,
            animationSpec = spring(
                dampingRatio = Spring.DampingRatioMediumBouncy
            )
        ) + fadeIn(),
        exit = scaleOut(
            targetScale = 0.8f,
            animationSpec = tween(durationMillis = 200)
        ) + fadeOut()
    ) {
        content()
    }
}

/**
 * 脉冲动画（用于强调）
 */
@Composable
fun Pulsing(
    enabled: Boolean = true,
    content: @Composable () -> Unit
) {
    val infiniteTransition = rememberInfiniteTransition(label = "pulse")
    val scale by infiniteTransition.animateFloat(
        initialValue = 1f,
        targetValue = if (enabled) 1.1f else 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 1000, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "pulse_scale"
    )

    Box(
        modifier = Modifier.scale(scale)
    ) {
        content()
    }
}

/**
 * 旋转动画（用于加载指示器）
 */
@Composable
fun Rotating(
    enabled: Boolean = true,
    content: @Composable () -> Unit
) {
    val infiniteTransition = rememberInfiniteTransition(label = "rotate")
    val rotation by infiniteTransition.animateFloat(
        initialValue = 0f,
        targetValue = if (enabled) 360f else 0f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 2000, easing = LinearEasing),
            repeatMode = RepeatMode.Restart
        ),
        label = "rotation"
    )

    Box(
        modifier = Modifier.graphicsLayer {
            rotationZ = rotation
        }
    ) {
        content()
    }
}

/**
 * 抖动动画（用于错误提示）
 */
@Composable
fun Shaking(
    enabled: Boolean = false,
    content: @Composable () -> Unit
) {
    var shakeOffset by remember { mutableStateOf(0f) }

    LaunchedEffect(enabled) {
        if (enabled) {
            val shakeValues = listOf(0f, -10f, 10f, -10f, 10f, -5f, 5f, 0f)
            shakeValues.forEach { offset ->
                shakeOffset = offset
                kotlinx.coroutines.delay(50)
            }
        }
    }

    Box(
        modifier = Modifier.graphicsLayer {
            translationX = shakeOffset
        }
    ) {
        content()
    }
}

/**
 * 闪烁动画（用于新消息通知）
 */
@Composable
fun Blinking(
    enabled: Boolean = true,
    content: @Composable () -> Unit
) {
    val infiniteTransition = rememberInfiniteTransition(label = "blink")
    val alpha by infiniteTransition.animateFloat(
        initialValue = 1f,
        targetValue = if (enabled) 0.3f else 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 500),
            repeatMode = RepeatMode.Reverse
        ),
        label = "blink_alpha"
    )

    Box(
        modifier = Modifier.graphicsLayer {
            this.alpha = alpha
        }
    ) {
        content()
    }
}

/**
 * 扫描线动画（用于 QR 扫描）
 */
@Composable
fun ScanningLine(
    enabled: Boolean = true
) {
    val infiniteTransition = rememberInfiniteTransition(label = "scan")
    val offsetY by infiniteTransition.animateFloat(
        initialValue = 0f,
        targetValue = if (enabled) 250f else 0f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 2000, easing = LinearEasing),
            repeatMode = RepeatMode.Restart
        ),
        label = "scan_offset"
    )

    if (enabled) {
        Spacer(
            modifier = Modifier
                .fillMaxWidth()
                .height(2.dp)
                .graphicsLayer {
                    translationY = offsetY
                }
        )
    }
}

/**
 * 连接动画（用于配对过程）
 */
@Composable
fun ConnectingAnimation(
    visible: Boolean
) {
    AnimatedVisibility(
        visible = visible,
        enter = fadeIn() + expandVertically(),
        exit = fadeOut() + shrinkVertically()
    ) {
        val infiniteTransition = rememberInfiniteTransition(label = "connecting")
        val progress by infiniteTransition.animateFloat(
            initialValue = 0f,
            targetValue = 1f,
            animationSpec = infiniteRepeatable(
                animation = tween(durationMillis = 1500),
                repeatMode = RepeatMode.Restart
            ),
            label = "progress"
        )

        // Custom connecting animation content
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(4.dp)
                .graphicsLayer {
                    scaleX = progress
                }
        )
    }
}

/**
 * 数字滚动动画
 */
@Composable
fun AnimatedCounter(
    count: Int,
    modifier: Modifier = Modifier
) {
    val animatedCount by animateIntAsState(
        targetValue = count,
        animationSpec = tween(
            durationMillis = 500,
            easing = FastOutSlowInEasing
        ),
        label = "counter"
    )

    androidx.compose.material3.Text(
        text = animatedCount.toString(),
        modifier = modifier
    )
}

/**
 * 进度动画
 */
@Composable
fun AnimatedProgress(
    progress: Float,
    modifier: Modifier = Modifier
) {
    val animatedProgress by animateFloatAsState(
        targetValue = progress,
        animationSpec = spring(
            dampingRatio = Spring.DampingRatioMediumBouncy,
            stiffness = Spring.StiffnessLow
        ),
        label = "progress"
    )

    androidx.compose.material3.LinearProgressIndicator(
        progress = animatedProgress,
        modifier = modifier
    )
}

/**
 * 列表项动画（用于设备列表）
 */
fun listItemEnterAnimation(index: Int): EnterTransition {
    return slideInVertically(
        initialOffsetY = { 50 },
        animationSpec = tween(
            durationMillis = 300,
            delayMillis = index * 50,
            easing = FastOutSlowInEasing
        )
    ) + fadeIn(
        animationSpec = tween(
            durationMillis = 300,
            delayMillis = index * 50
        )
    )
}

/**
 * 列表项退出动画
 */
fun listItemExitAnimation(): ExitTransition {
    return slideOutHorizontally(
        targetOffsetX = { -it },
        animationSpec = tween(
            durationMillis = 300,
            easing = FastOutSlowInEasing
        )
    ) + fadeOut(
        animationSpec = tween(durationMillis = 300)
    )
}

/**
 * 状态切换动画
 */
@Composable
fun <T> AnimatedContent(
    targetState: T,
    content: @Composable (T) -> Unit
) {
    androidx.compose.animation.AnimatedContent(
        targetState = targetState,
        transitionSpec = {
            fadeIn(
                animationSpec = tween(300)
            ) with fadeOut(
                animationSpec = tween(300)
            )
        },
        label = "content_animation"
    ) { state ->
        content(state)
    }
}

package com.chainlesschain.android.core.ui.animation

import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.animation.ExperimentalAnimationApi
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.debugInspectorInfo

/**
 * Compose 动画工具类
 *
 * 提供统一的动画效果和交互反馈
 */
object AnimationUtils {

    /**
     * 标准动画时长
     */
    object Duration {
        const val FAST = 150        // 快速动画（微交互）
        const val NORMAL = 300      // 标准动画（默认）
        const val SLOW = 500        // 慢速动画（强调）
        const val VERY_SLOW = 800   // 非常慢（页面过渡）
    }

    /**
     * 标准缓动曲线
     */
    object AnimationEasing {
        val STANDARD: androidx.compose.animation.core.Easing = FastOutSlowInEasing
        val EMPHASIZED: androidx.compose.animation.core.Easing = CubicBezierEasing(0.4f, 0f, 0.2f, 1f)
        val DECELERATE: androidx.compose.animation.core.Easing = LinearOutSlowInEasing
        val ACCELERATE: androidx.compose.animation.core.Easing = FastOutLinearInEasing
        val BOUNCE: androidx.compose.animation.core.Easing = CubicBezierEasing(0.68f, -0.55f, 0.27f, 1.55f)
    }

    /**
     * 淡入淡出动画规格
     */
    @OptIn(ExperimentalAnimationApi::class)
    fun fadeInOut(
        duration: Int = Duration.NORMAL,
        easing: androidx.compose.animation.core.Easing = AnimationEasing.STANDARD
    ): ContentTransform {
        return fadeIn(
            animationSpec = tween(duration, easing = easing)
        ) with fadeOut(
            animationSpec = tween(duration, easing = easing)
        )
    }

    /**
     * 滑动进入/退出动画
     */
    @OptIn(ExperimentalAnimationApi::class)
    fun slideInOut(
        duration: Int = Duration.NORMAL,
        easing: androidx.compose.animation.core.Easing = AnimationEasing.EMPHASIZED
    ): ContentTransform {
        return slideInHorizontally(
            animationSpec = tween(duration, easing = easing),
            initialOffsetX = { it }
        ) with slideOutHorizontally(
            animationSpec = tween(duration, easing = easing),
            targetOffsetX = { -it }
        )
    }

    /**
     * 缩放+淡入/淡出动画
     */
    @OptIn(ExperimentalAnimationApi::class)
    fun scaleInOut(
        duration: Int = Duration.NORMAL,
        easing: androidx.compose.animation.core.Easing = AnimationEasing.EMPHASIZED
    ): ContentTransform {
        return (fadeIn(
            animationSpec = tween(duration, easing = easing)
        ) + scaleIn(
            animationSpec = tween(duration, easing = easing),
            initialScale = 0.8f
        )) with (fadeOut(
            animationSpec = tween(duration, easing = easing)
        ) + scaleOut(
            animationSpec = tween(duration, easing = easing),
            targetScale = 0.8f
        ))
    }
}

/**
 * 按压动画修饰符
 *
 * 按下时缩小，松开时恢复
 *
 * 用法：
 * ```kotlin
 * Box(modifier = Modifier.pressAnimation())
 * ```
 */
fun Modifier.pressAnimation(
    pressedScale: Float = 0.95f,
    duration: Int = AnimationUtils.Duration.FAST
): Modifier = composed(
    inspectorInfo = debugInspectorInfo {
        name = "pressAnimation"
        properties["pressedScale"] = pressedScale
        properties["duration"] = duration
    }
) {
    var isPressed by remember { mutableStateOf(false) }

    val scale by animateFloatAsState(
        targetValue = if (isPressed) pressedScale else 1f,
        animationSpec = tween(
            durationMillis = duration,
            easing = AnimationUtils.AnimationEasing.STANDARD
        ),
        label = "pressScale"
    )

    this
        .scale(scale)
        .pointerInput(Unit) {
            detectTapGestures(
                onPress = {
                    isPressed = true
                    tryAwaitRelease()
                    isPressed = false
                }
            )
        }
}

/**
 * 点击波纹动画
 *
 * 点击时产生波纹效果
 *
 * 用法：
 * ```kotlin
 * Box(modifier = Modifier.rippleClickable { /* 点击事件 */ })
 * ```
 */
fun Modifier.rippleClickable(
    enabled: Boolean = true,
    onClick: () -> Unit
): Modifier = composed(
    inspectorInfo = debugInspectorInfo {
        name = "rippleClickable"
        properties["enabled"] = enabled
    }
) {
    this
        .pressAnimation()
        .pointerInput(enabled) {
            if (enabled) {
                detectTapGestures { onClick() }
            }
        }
}

/**
 * 悬停动画修饰符
 *
 * 鼠标悬停时放大（适用于平板/Chromebook）
 *
 * 用法：
 * ```kotlin
 * Box(modifier = Modifier.hoverAnimation())
 * ```
 */
fun Modifier.hoverAnimation(
    hoverScale: Float = 1.05f,
    duration: Int = AnimationUtils.Duration.FAST
): Modifier = composed(
    inspectorInfo = debugInspectorInfo {
        name = "hoverAnimation"
        properties["hoverScale"] = hoverScale
        properties["duration"] = duration
    }
) {
    var isHovered by remember { mutableStateOf(false) }

    val scale by animateFloatAsState(
        targetValue = if (isHovered) hoverScale else 1f,
        animationSpec = tween(
            durationMillis = duration,
            easing = AnimationUtils.AnimationEasing.STANDARD
        ),
        label = "hoverScale"
    )

    this.scale(scale)
    // 注意：需要鼠标输入支持，这里仅提供基础实现
}

/**
 * 震动动画修饰符
 *
 * 触发震动效果（用于错误提示等）
 *
 * 用法：
 * ```kotlin
 * var shake by remember { mutableStateOf(false) }
 * Box(modifier = Modifier.shakeAnimation(shake) { shake = false })
 * ```
 */
fun Modifier.shakeAnimation(
    trigger: Boolean,
    onAnimationEnd: () -> Unit = {}
): Modifier = composed(
    inspectorInfo = debugInspectorInfo {
        name = "shakeAnimation"
        properties["trigger"] = trigger
    }
) {
    val offsetX by animateFloatAsState(
        targetValue = if (trigger) 0f else 0f,
        animationSpec = keyframes {
            durationMillis = 400
            0f at 0
            -10f at 50
            10f at 100
            -10f at 150
            10f at 200
            -5f at 250
            5f at 300
            0f at 400
        },
        finishedListener = { onAnimationEnd() },
        label = "shakeOffset"
    )

    this.graphicsLayer {
        translationX = if (trigger) offsetX else 0f
    }
}

/**
 * 弹跳动画修饰符
 *
 * 触发弹跳效果（用于成功反馈等）
 *
 * 用法：
 * ```kotlin
 * var bounce by remember { mutableStateOf(false) }
 * Box(modifier = Modifier.bounceAnimation(bounce) { bounce = false })
 * ```
 */
fun Modifier.bounceAnimation(
    trigger: Boolean,
    onAnimationEnd: () -> Unit = {}
): Modifier = composed(
    inspectorInfo = debugInspectorInfo {
        name = "bounceAnimation"
        properties["trigger"] = trigger
    }
) {
    val scale by animateFloatAsState(
        targetValue = if (trigger) 1f else 1f,
        animationSpec = keyframes {
            durationMillis = 600
            1f at 0
            1.2f at 150
            0.9f at 300
            1.05f at 450
            1f at 600
        },
        finishedListener = { onAnimationEnd() },
        label = "bounceScale"
    )

    this.scale(if (trigger) scale else 1f)
}

/**
 * 脉冲动画修饰符
 *
 * 持续脉冲效果（用于引导注意力）
 *
 * 用法：
 * ```kotlin
 * Box(modifier = Modifier.pulseAnimation(enabled = true))
 * ```
 */
fun Modifier.pulseAnimation(
    enabled: Boolean = true,
    minScale: Float = 0.95f,
    maxScale: Float = 1.05f,
    duration: Int = 1000
): Modifier = composed(
    inspectorInfo = debugInspectorInfo {
        name = "pulseAnimation"
        properties["enabled"] = enabled
        properties["minScale"] = minScale
        properties["maxScale"] = maxScale
    }
) {
    val infiniteTransition = rememberInfiniteTransition(label = "pulse")

    val scale by infiniteTransition.animateFloat(
        initialValue = minScale,
        targetValue = maxScale,
        animationSpec = infiniteRepeatable(
            animation = tween(duration, easing = AnimationUtils.AnimationEasing.STANDARD),
            repeatMode = RepeatMode.Reverse
        ),
        label = "pulseScale"
    )

    this.scale(if (enabled) scale else 1f)
}

/**
 * 旋转动画修饰符
 *
 * 持续旋转（用于加载指示器等）
 *
 * 用法：
 * ```kotlin
 * Icon(
 *     imageVector = Icons.Default.Refresh,
 *     modifier = Modifier.rotateAnimation(isLoading)
 * )
 * ```
 */
fun Modifier.rotateAnimation(
    enabled: Boolean = true,
    duration: Int = 1000
): Modifier = composed(
    inspectorInfo = debugInspectorInfo {
        name = "rotateAnimation"
        properties["enabled"] = enabled
        properties["duration"] = duration
    }
) {
    val infiniteTransition = rememberInfiniteTransition(label = "rotate")

    val rotation by infiniteTransition.animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(
            animation = tween(duration, easing = LinearEasing),
            repeatMode = RepeatMode.Restart
        ),
        label = "rotation"
    )

    this.graphicsLayer {
        rotationZ = if (enabled) rotation else 0f
    }
}

/**
 * 列表项进入动画
 *
 * 列表项从右侧滑入
 *
 * 用法：
 * ```kotlin
 * LazyColumn {
 *     itemsIndexed(items) { index, item ->
 *         Box(modifier = Modifier.animateItemPlacement())
 *     }
 * }
 * ```
 */
fun EnterTransition.slideInFromRight(
    duration: Int = AnimationUtils.Duration.NORMAL
): EnterTransition {
    return slideInHorizontally(
        animationSpec = tween(duration, easing = AnimationUtils.AnimationEasing.EMPHASIZED),
        initialOffsetX = { it }
    ) + fadeIn(
        animationSpec = tween(duration)
    )
}

/**
 * 列表项退出动画
 *
 * 列表项向左滑出
 */
fun ExitTransition.slideOutToLeft(
    duration: Int = AnimationUtils.Duration.NORMAL
): ExitTransition {
    return slideOutHorizontally(
        animationSpec = tween(duration, easing = AnimationUtils.AnimationEasing.EMPHASIZED),
        targetOffsetX = { -it }
    ) + fadeOut(
        animationSpec = tween(duration)
    )
}

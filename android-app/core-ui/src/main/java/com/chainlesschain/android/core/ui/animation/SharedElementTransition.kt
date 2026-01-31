package com.chainlesschain.android.core.ui.animation

import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

/**
 * 共享元素过渡动画
 *
 * 用于实现页面间的共享元素动画效果
 * 例如：列表项图片 → 详情页大图
 *
 * 注意：Compose 的 Shared Element Transition 目前还在实验阶段
 * 这里提供基础实现和最佳实践
 */
object SharedElementTransition {

    /**
     * 共享元素动画规格
     */
    val defaultAnimationSpec: FiniteAnimationSpec<Float> = spring(
        dampingRatio = Spring.DampingRatioMediumBouncy,
        stiffness = Spring.StiffnessMedium
    )

    /**
     * 创建共享元素过渡动画
     *
     * @param isVisible 是否可见
     * @param enter 进入动画
     * @param exit 退出动画
     * @param content 内容
     */
    @Composable
    fun SharedElement(
        key: Any,
        isVisible: Boolean,
        modifier: Modifier = Modifier,
        enter: EnterTransition = fadeIn() + scaleIn(initialScale = 0.8f),
        exit: ExitTransition = fadeOut() + scaleOut(targetScale = 0.8f),
        content: @Composable () -> Unit
    ) {
        AnimatedVisibility(
            visible = isVisible,
            enter = enter,
            exit = exit,
            modifier = modifier
        ) {
            content()
        }
    }

    /**
     * 页面过渡动画配置
     */
    object PageTransition {

        /**
         * 标准页面进入动画（从右侧滑入）
         */
        val enterFromRight: EnterTransition = slideInHorizontally(
            animationSpec = tween(
                durationMillis = 400,
                easing = CubicBezierEasing(0.4f, 0f, 0.2f, 1f)
            ),
            initialOffsetX = { it }
        ) + fadeIn(
            animationSpec = tween(400)
        )

        /**
         * 标准页面退出动画（向左滑出）
         */
        val exitToLeft: ExitTransition = slideOutHorizontally(
            animationSpec = tween(
                durationMillis = 400,
                easing = CubicBezierEasing(0.4f, 0f, 0.2f, 1f)
            ),
            targetOffsetX = { -it / 3 }  // 轻微滑出（类似 iOS）
        ) + fadeOut(
            animationSpec = tween(400)
        )

        /**
         * 返回动画 - 页面进入（从左侧滑入）
         */
        val enterFromLeft: EnterTransition = slideInHorizontally(
            animationSpec = tween(
                durationMillis = 400,
                easing = CubicBezierEasing(0.4f, 0f, 0.2f, 1f)
            ),
            initialOffsetX = { -it / 3 }
        ) + fadeIn(
            animationSpec = tween(400)
        )

        /**
         * 返回动画 - 页面退出（向右滑出）
         */
        val exitToRight: ExitTransition = slideOutHorizontally(
            animationSpec = tween(
                durationMillis = 400,
                easing = CubicBezierEasing(0.4f, 0f, 0.2f, 1f)
            ),
            targetOffsetX = { it }
        ) + fadeOut(
            animationSpec = tween(400)
        )

        /**
         * 模态弹窗进入动画（从底部滑入）
         */
        val enterFromBottom: EnterTransition = slideInVertically(
            animationSpec = tween(
                durationMillis = 400,
                easing = CubicBezierEasing(0.4f, 0f, 0.2f, 1f)
            ),
            initialOffsetY = { it }
        ) + fadeIn(
            animationSpec = tween(200)
        )

        /**
         * 模态弹窗退出动画（向底部滑出）
         */
        val exitToBottom: ExitTransition = slideOutVertically(
            animationSpec = tween(
                durationMillis = 400,
                easing = CubicBezierEasing(0.4f, 0f, 0.6f, 1f)
            ),
            targetOffsetY = { it }
        ) + fadeOut(
            animationSpec = tween(200)
        )

        /**
         * 淡入淡出动画（用于 Tab 切换等）
         */
        val fadeInOut: Pair<EnterTransition, ExitTransition> = Pair(
            fadeIn(
                animationSpec = tween(
                    durationMillis = 300,
                    easing = LinearOutSlowInEasing
                )
            ),
            fadeOut(
                animationSpec = tween(
                    durationMillis = 300,
                    easing = FastOutLinearInEasing
                )
            )
        )

        /**
         * 缩放+淡入淡出（用于对话框等）
         */
        val scaleInOut: Pair<EnterTransition, ExitTransition> = Pair(
            scaleIn(
                animationSpec = tween(
                    durationMillis = 300,
                    easing = CubicBezierEasing(0.4f, 0f, 0.2f, 1f)
                ),
                initialScale = 0.8f
            ) + fadeIn(
                animationSpec = tween(300)
            ),
            scaleOut(
                animationSpec = tween(
                    durationMillis = 200,
                    easing = CubicBezierEasing(0.4f, 0f, 0.6f, 1f)
                ),
                targetScale = 0.8f
            ) + fadeOut(
                animationSpec = tween(200)
            )
        )
    }
}

/**
 * 导航过渡动画扩展
 *
 * 用法示例：
 * ```kotlin
 * NavHost(
 *     navController = navController,
 *     startDestination = "home"
 * ) {
 *     composable(
 *         route = "home",
 *         enterTransition = { PageTransition.enterFromRight },
 *         exitTransition = { PageTransition.exitToLeft },
 *         popEnterTransition = { PageTransition.enterFromLeft },
 *         popExitTransition = { PageTransition.exitToRight }
 *     ) {
 *         HomeScreen()
 *     }
 * }
 * ```
 */

/**
 * 标准页面过渡动画（前进）
 */
fun standardForwardTransition(): Pair<EnterTransition, ExitTransition> {
    return Pair(
        SharedElementTransition.PageTransition.enterFromRight,
        SharedElementTransition.PageTransition.exitToLeft
    )
}

/**
 * 标准页面过渡动画（返回）
 */
fun standardBackwardTransition(): Pair<EnterTransition, ExitTransition> {
    return Pair(
        SharedElementTransition.PageTransition.enterFromLeft,
        SharedElementTransition.PageTransition.exitToRight
    )
}

/**
 * 模态弹窗过渡动画
 */
fun modalTransition(): Pair<EnterTransition, ExitTransition> {
    return Pair(
        SharedElementTransition.PageTransition.enterFromBottom,
        SharedElementTransition.PageTransition.exitToBottom
    )
}

/**
 * 使用示例：
 *
 * 1. 列表 → 详情的共享元素动画
 * ```kotlin
 * // 列表页
 * LazyColumn {
 *     items(items) { item ->
 *         AsyncImage(
 *             model = item.imageUrl,
 *             modifier = Modifier.sharedElement(
 *                 key = "image_${item.id}",
 *                 navController = navController
 *             )
 *         )
 *     }
 * }
 *
 * // 详情页
 * AsyncImage(
 *     model = imageUrl,
 *     modifier = Modifier.sharedElement(
 *         key = "image_$itemId",
 *         navController = navController
 *     )
 * )
 * ```
 *
 * 2. 页面过渡动画
 * ```kotlin
 * NavHost(
 *     navController = navController,
 *     startDestination = "list"
 * ) {
 *     composable(
 *         route = "list",
 *         enterTransition = { standardForwardTransition().first },
 *         exitTransition = { standardForwardTransition().second }
 *     ) {
 *         ListScreen()
 *     }
 *
 *     composable(
 *         route = "detail/{id}",
 *         enterTransition = { standardForwardTransition().first },
 *         exitTransition = { standardForwardTransition().second },
 *         popEnterTransition = { standardBackwardTransition().first },
 *         popExitTransition = { standardBackwardTransition().second }
 *     ) {
 *         DetailScreen()
 *     }
 * }
 * ```
 *
 * 3. 模态弹窗动画
 * ```kotlin
 * AnimatedVisibility(
 *     visible = showDialog,
 *     enter = modalTransition().first,
 *     exit = modalTransition().second
 * ) {
 *     Dialog(onDismissRequest = { showDialog = false }) {
 *         // 对话框内容
 *     }
 * }
 * ```
 */

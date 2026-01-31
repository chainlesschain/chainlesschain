package com.chainlesschain.android.core.ui.components

import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * 骨架屏加载效果
 *
 * 提供类似 Facebook/Twitter 的骨架屏加载动画
 */

/**
 * 闪光动画渐变色
 */
@Composable
private fun shimmerBrush(): Brush {
    val shimmerColors = listOf(
        MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.8f),
        MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f),
        MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.8f)
    )

    val transition = rememberInfiniteTransition(label = "shimmer")
    val translateAnim by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1000f,
        animationSpec = infiniteRepeatable(
            animation = tween(
                durationMillis = 1200,
                easing = FastOutSlowInEasing
            ),
            repeatMode = RepeatMode.Restart
        ),
        label = "shimmer"
    )

    return Brush.linearGradient(
        colors = shimmerColors,
        start = Offset(translateAnim, translateAnim),
        end = Offset(translateAnim + 200f, translateAnim + 200f)
    )
}

/**
 * 骨架屏基础组件
 *
 * @param modifier 修饰符
 * @param shape 形状
 */
@Composable
fun SkeletonBox(
    modifier: Modifier = Modifier,
    shape: Shape = RoundedCornerShape(4.dp)
) {
    Box(
        modifier = modifier
            .clip(shape)
            .background(shimmerBrush())
    )
}

/**
 * 骨架屏文本行
 *
 * @param modifier 修饰符
 * @param width 宽度（可选，默认填充父容器）
 * @param height 高度
 */
@Composable
fun SkeletonText(
    modifier: Modifier = Modifier,
    width: Dp? = null,
    height: Dp = 16.dp
) {
    SkeletonBox(
        modifier = modifier
            .height(height)
            .then(if (width != null) Modifier.width(width) else Modifier.fillMaxWidth()),
        shape = RoundedCornerShape(4.dp)
    )
}

/**
 * 骨架屏圆形（用于头像等）
 *
 * @param size 尺寸
 * @param modifier 修饰符
 */
@Composable
fun SkeletonCircle(
    size: Dp,
    modifier: Modifier = Modifier
) {
    SkeletonBox(
        modifier = modifier.size(size),
        shape = CircleShape
    )
}

/**
 * 骨架屏矩形（用于图片等）
 *
 * @param width 宽度
 * @param height 高度
 * @param modifier 修饰符
 * @param cornerRadius 圆角半径
 */
@Composable
fun SkeletonRect(
    width: Dp,
    height: Dp,
    modifier: Modifier = Modifier,
    cornerRadius: Dp = 8.dp
) {
    SkeletonBox(
        modifier = modifier.size(width, height),
        shape = RoundedCornerShape(cornerRadius)
    )
}

/**
 * 骨架屏列表项 - 标准样式
 *
 * 适用于知识库列表、对话列表等
 */
@Composable
fun SkeletonListItem(
    modifier: Modifier = Modifier,
    showAvatar: Boolean = true,
    showSubtitle: Boolean = true
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(16.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        // 头像（如果需要）
        if (showAvatar) {
            SkeletonCircle(size = 48.dp)
        }

        // 文本内容
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            // 标题
            SkeletonText(
                width = 180.dp,
                height = 18.dp
            )

            // 副标题（如果需要）
            if (showSubtitle) {
                SkeletonText(
                    width = 120.dp,
                    height = 14.dp
                )
            }
        }

        // 右侧图标区域
        SkeletonBox(
            modifier = Modifier.size(24.dp)
        )
    }
}

/**
 * 骨架屏卡片 - 标准样式
 *
 * 适用于项目卡片、知识卡片等
 */
@Composable
fun SkeletonCard(
    modifier: Modifier = Modifier,
    showImage: Boolean = true
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        // 图片（如果需要）
        if (showImage) {
            SkeletonRect(
                width = 320.dp,
                height = 180.dp,
                modifier = Modifier.fillMaxWidth()
            )
        }

        // 标题
        SkeletonText(
            width = 200.dp,
            height = 20.dp
        )

        // 内容行1
        SkeletonText(height = 14.dp)

        // 内容行2
        SkeletonText(
            width = 280.dp,
            height = 14.dp
        )

        // 底部操作区
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            SkeletonBox(
                modifier = Modifier
                    .width(80.dp)
                    .height(36.dp),
                shape = RoundedCornerShape(18.dp)
            )
            SkeletonBox(
                modifier = Modifier
                    .width(80.dp)
                    .height(36.dp),
                shape = RoundedCornerShape(18.dp)
            )
        }
    }
}

/**
 * 骨架屏网格项 - 标准样式
 *
 * 适用于照片网格、文件网格等
 */
@Composable
fun SkeletonGridItem(
    modifier: Modifier = Modifier,
    aspectRatio: Float = 1f
) {
    Column(
        modifier = modifier.padding(8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        // 主图
        SkeletonBox(
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(aspectRatio),
            shape = RoundedCornerShape(8.dp)
        )

        // 标题
        SkeletonText(
            height = 14.dp
        )

        // 副标题
        SkeletonText(
            width = 80.dp,
            height = 12.dp
        )
    }
}

/**
 * 骨架屏聊天消息
 *
 * 适用于聊天界面
 *
 * @param isOwnMessage 是否是自己发送的消息
 */
@Composable
fun SkeletonChatMessage(
    isOwnMessage: Boolean = false,
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = if (isOwnMessage) {
            Arrangement.End
        } else {
            Arrangement.Start
        }
    ) {
        if (!isOwnMessage) {
            SkeletonCircle(size = 36.dp)
            Spacer(modifier = Modifier.width(8.dp))
        }

        Column(
            modifier = Modifier.widthIn(max = 280.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            SkeletonText(
                width = 200.dp,
                height = 16.dp
            )
            SkeletonText(
                width = 160.dp,
                height = 16.dp
            )
        }

        if (isOwnMessage) {
            Spacer(modifier = Modifier.width(8.dp))
            SkeletonCircle(size = 36.dp)
        }
    }
}

/**
 * 骨架屏加载列表
 *
 * 显示多个骨架屏列表项
 *
 * @param count 数量
 * @param showAvatar 是否显示头像
 * @param showSubtitle 是否显示副标题
 */
@Composable
fun SkeletonList(
    count: Int = 5,
    showAvatar: Boolean = true,
    showSubtitle: Boolean = true,
    modifier: Modifier = Modifier
) {
    Column(modifier = modifier) {
        repeat(count) {
            SkeletonListItem(
                showAvatar = showAvatar,
                showSubtitle = showSubtitle
            )
        }
    }
}

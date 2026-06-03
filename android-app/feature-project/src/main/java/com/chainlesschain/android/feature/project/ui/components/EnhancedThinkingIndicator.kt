package com.chainlesschain.android.feature.project.ui.components

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.LightbulbCircle
import androidx.compose.material.icons.filled.Psychology
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.chainlesschain.android.feature.project.model.ThinkingStage
import kotlinx.coroutines.delay

/**
 * 增强版思考指示器
 * 显示AI思考的各个阶段，包括理解问题、分析上下文、规划回答、生成内容
 */
@Composable
fun EnhancedThinkingIndicator(
    currentStage: ThinkingStage,
    isVisible: Boolean,
    modifier: Modifier = Modifier,
    showProgress: Boolean = true
) {
    AnimatedVisibility(
        visible = isVisible,
        enter = fadeIn() + slideInVertically(initialOffsetY = { it / 2 }),
        exit = fadeOut() + slideOutVertically(targetOffsetY = { it / 2 })
    ) {
        Card(
            modifier = modifier.fillMaxWidth(),
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.5f)
            ),
            elevation = CardDefaults.cardElevation(defaultElevation = 0.dp)
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                // AI头像和标题
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    // 动画AI图标
                    AnimatedAIIcon()

                    Column {
                        Text(
                            text = "AI 正在思考...",
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.onSecondaryContainer
                        )
                        Text(
                            text = currentStage.getShortDescription(),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSecondaryContainer.copy(alpha = 0.8f)
                        )
                    }
                }

                // 进度指示器
                if (showProgress) {
                    val infiniteTransition = rememberInfiniteTransition(label = "progress")
                    val progressAnimation by infiniteTransition.animateFloat(
                        initialValue = 0f,
                        targetValue = 1f,
                        animationSpec = infiniteRepeatable(
                            animation = tween(2000, easing = LinearEasing),
                            repeatMode = RepeatMode.Restart
                        ),
                        label = "progressAnimation"
                    )

                    LinearProgressIndicator(
                        progress = { progressAnimation },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(4.dp)
                            .clip(RoundedCornerShape(2.dp)),
                        color = MaterialTheme.colorScheme.primary,
                        trackColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.2f),
                        strokeCap = StrokeCap.Round
                    )
                }

                // 阶段步骤
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceEvenly
                ) {
                    ThinkingStage.getAllStages().forEach { stage ->
                        ThinkingStageItem(
                            stage = stage,
                            isActive = stage == currentStage,
                            isCompleted = stage.ordinal < currentStage.ordinal
                        )
                    }
                }
            }
        }
    }
}

/**
 * 简洁版思考指示器（用于消息列表中）
 */
@Composable
fun SimpleThinkingIndicator(
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier
            .clip(RoundedCornerShape(16.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f))
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        AnimatedAIIcon(size = 20)

        AnimatedThinkingText()
    }
}

/**
 * 动画AI图标
 */
@Composable
private fun AnimatedAIIcon(size: Int = 32) {
    val infiniteTransition = rememberInfiniteTransition(label = "aiIcon")

    val scale by infiniteTransition.animateFloat(
        initialValue = 0.9f,
        targetValue = 1.1f,
        animationSpec = infiniteRepeatable(
            animation = tween(1000),
            repeatMode = RepeatMode.Reverse
        ),
        label = "scale"
    )

    val alpha by infiniteTransition.animateFloat(
        initialValue = 0.6f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(1000),
            repeatMode = RepeatMode.Reverse
        ),
        label = "alpha"
    )

    Box(
        modifier = Modifier
            .size(size.dp)
            .scale(scale)
            .alpha(alpha)
            .clip(CircleShape)
            .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.2f)),
        contentAlignment = Alignment.Center
    ) {
        Icon(
            imageVector = Icons.Default.AutoAwesome,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.primary,
            modifier = Modifier.size((size * 0.6).dp)
        )
    }
}

/**
 * 动画思考文字
 */
@Composable
private fun AnimatedThinkingText() {
    var dotCount by remember { mutableIntStateOf(0) }

    LaunchedEffect(Unit) {
        while (true) {
            delay(500)
            dotCount = (dotCount + 1) % 4
        }
    }

    val text = "AI 正在思考" + ".".repeat(dotCount)

    Text(
        text = text,
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f)
    )
}

@Composable
private fun ThinkingStageItem(
    stage: ThinkingStage,
    isActive: Boolean,
    isCompleted: Boolean
) {
    val iconColor by animateColorAsState(
        targetValue = when {
            isCompleted -> MaterialTheme.colorScheme.primary
            isActive -> MaterialTheme.colorScheme.primary
            else -> MaterialTheme.colorScheme.onSurface.copy(alpha = 0.3f)
        },
        label = "iconColor"
    )

    val textColor by animateColorAsState(
        targetValue = when {
            isCompleted -> MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f)
            isActive -> MaterialTheme.colorScheme.onSurface
            else -> MaterialTheme.colorScheme.onSurface.copy(alpha = 0.3f)
        },
        label = "textColor"
    )

    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        AnimatedContent(
            targetState = isCompleted to isActive,
            transitionSpec = {
                fadeIn() togetherWith fadeOut()
            },
            label = "stageIcon"
        ) { (completed, active) ->
            val icon = when {
                completed -> Icons.Default.CheckCircle
                else -> stage.getIcon()
            }

            val modifier = if (active) {
                val infiniteTransition = rememberInfiniteTransition(label = "active")
                val scale by infiniteTransition.animateFloat(
                    initialValue = 1f,
                    targetValue = 1.2f,
                    animationSpec = infiniteRepeatable(
                        animation = tween(500),
                        repeatMode = RepeatMode.Reverse
                    ),
                    label = "activeScale"
                )
                Modifier.scale(scale)
            } else {
                Modifier
            }

            Icon(
                imageVector = icon,
                contentDescription = stage.getDisplayName(),
                tint = iconColor,
                modifier = modifier.size(20.dp)
            )
        }

        Text(
            text = stage.getDisplayName().take(4),
            style = MaterialTheme.typography.labelSmall,
            color = textColor,
            fontWeight = if (isActive) FontWeight.Bold else FontWeight.Normal
        )
    }
}

/**
 * 获取阶段对应的图标
 */
private fun ThinkingStage.getIcon(): ImageVector = when (this) {
    ThinkingStage.UNDERSTANDING -> Icons.Default.Psychology
    ThinkingStage.ANALYZING -> Icons.Default.Search
    ThinkingStage.PLANNING -> Icons.Default.LightbulbCircle
    ThinkingStage.GENERATING -> Icons.Default.AutoAwesome
}

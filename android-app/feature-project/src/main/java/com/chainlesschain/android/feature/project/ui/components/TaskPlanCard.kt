package com.chainlesschain.android.feature.project.ui.components

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Cancel
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Error
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.RadioButtonUnchecked
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.chainlesschain.android.feature.project.model.StepStatus
import com.chainlesschain.android.feature.project.model.TaskPlan
import com.chainlesschain.android.feature.project.model.TaskPlanStatus
import com.chainlesschain.android.feature.project.model.TaskStep

/**
 * 任务计划卡片组件
 * 显示AI生成的任务计划，支持确认、修改、执行操作
 */
@Composable
fun TaskPlanCard(
    taskPlan: TaskPlan,
    onConfirm: () -> Unit,
    onCancel: () -> Unit,
    onModify: () -> Unit,
    onRetry: (TaskStep) -> Unit,
    modifier: Modifier = Modifier
) {
    val progress by animateFloatAsState(
        targetValue = taskPlan.getProgress(),
        label = "progress"
    )

    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.7f)
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            // 标题栏
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.PlayArrow,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(20.dp)
                    )
                    Text(
                        text = "任务计划",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.primary
                    )
                }

                // 状态标签
                TaskPlanStatusChip(status = taskPlan.status)
            }

            // 任务标题
            Text(
                text = taskPlan.title,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold
            )

            // 任务描述（如果有）
            if (taskPlan.description.isNotBlank()) {
                Text(
                    text = taskPlan.description,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f)
                )
            }

            // 进度条（执行中时显示）
            AnimatedVisibility(
                visible = taskPlan.status == TaskPlanStatus.EXECUTING
            ) {
                Column(
                    verticalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    LinearProgressIndicator(
                        progress = { progress },
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(4.dp)),
                        strokeCap = StrokeCap.Round
                    )
                    Text(
                        text = "${(progress * 100).toInt()}% 完成",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
                    )
                }
            }

            // 步骤列表
            Column(
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                taskPlan.steps.forEach { step ->
                    TaskStepItem(
                        step = step,
                        onRetry = { onRetry(step) }
                    )
                }
            }

            // 操作按钮
            when (taskPlan.status) {
                TaskPlanStatus.PENDING -> {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        OutlinedButton(
                            onClick = onCancel,
                            modifier = Modifier.weight(1f)
                        ) {
                            Icon(
                                imageVector = Icons.Default.Cancel,
                                contentDescription = null,
                                modifier = Modifier.size(18.dp)
                            )
                            Text(
                                text = "取消",
                                modifier = Modifier.padding(start = 4.dp)
                            )
                        }

                        TextButton(
                            onClick = onModify
                        ) {
                            Icon(
                                imageVector = Icons.Default.Edit,
                                contentDescription = null,
                                modifier = Modifier.size(18.dp)
                            )
                            Text(
                                text = "修改",
                                modifier = Modifier.padding(start = 4.dp)
                            )
                        }

                        Button(
                            onClick = onConfirm,
                            modifier = Modifier.weight(1f)
                        ) {
                            Icon(
                                imageVector = Icons.Default.CheckCircle,
                                contentDescription = null,
                                modifier = Modifier.size(18.dp)
                            )
                            Text(
                                text = "确认执行",
                                modifier = Modifier.padding(start = 4.dp)
                            )
                        }
                    }
                }

                TaskPlanStatus.EXECUTING -> {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.Center
                    ) {
                        OutlinedButton(
                            onClick = onCancel,
                            colors = ButtonDefaults.outlinedButtonColors(
                                contentColor = MaterialTheme.colorScheme.error
                            )
                        ) {
                            Icon(
                                imageVector = Icons.Default.Cancel,
                                contentDescription = null,
                                modifier = Modifier.size(18.dp)
                            )
                            Text(
                                text = "取消执行",
                                modifier = Modifier.padding(start = 4.dp)
                            )
                        }
                    }
                }

                TaskPlanStatus.FAILED -> {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.Center
                    ) {
                        Button(
                            onClick = onConfirm
                        ) {
                            Icon(
                                imageVector = Icons.Default.Refresh,
                                contentDescription = null,
                                modifier = Modifier.size(18.dp)
                            )
                            Text(
                                text = "重试",
                                modifier = Modifier.padding(start = 4.dp)
                            )
                        }
                    }
                }

                else -> {
                    // COMPLETED, CONFIRMED, CANCELLED - 不显示按钮
                }
            }
        }
    }
}

@Composable
private fun TaskStepItem(
    step: TaskStep,
    onRetry: () -> Unit
) {
    val backgroundColor by animateColorAsState(
        targetValue = when (step.status) {
            StepStatus.COMPLETED -> MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.3f)
            StepStatus.IN_PROGRESS -> MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.3f)
            StepStatus.FAILED -> MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.3f)
            else -> Color.Transparent
        },
        label = "backgroundColor"
    )

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(backgroundColor)
            .padding(8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        // 状态图标
        StepStatusIcon(status = step.status)

        // 步骤内容
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(2.dp)
        ) {
            Text(
                text = step.description,
                style = MaterialTheme.typography.bodyMedium,
                textDecoration = if (step.status == StepStatus.COMPLETED) {
                    TextDecoration.LineThrough
                } else null,
                color = if (step.status == StepStatus.COMPLETED) {
                    MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f)
                } else {
                    MaterialTheme.colorScheme.onSurface
                },
                maxLines = 2,
                overflow = TextOverflow.Ellipsis
            )

            // 显示错误信息
            step.error?.let { error ->
                Text(
                    text = error,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.error
                )
            }

            // 显示结果
            step.result?.let { result ->
                Text(
                    text = result,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }

        // 重试按钮（失败时显示）
        if (step.status == StepStatus.FAILED) {
            IconButton(
                onClick = onRetry,
                modifier = Modifier.size(32.dp)
            ) {
                Icon(
                    imageVector = Icons.Default.Refresh,
                    contentDescription = "重试",
                    tint = MaterialTheme.colorScheme.error,
                    modifier = Modifier.size(18.dp)
                )
            }
        }
    }
}

@Composable
private fun StepStatusIcon(status: StepStatus) {
    AnimatedContent(
        targetState = status,
        label = "statusIcon"
    ) { currentStatus ->
        when (currentStatus) {
            StepStatus.PENDING -> {
                Icon(
                    imageVector = Icons.Default.RadioButtonUnchecked,
                    contentDescription = "待执行",
                    tint = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.4f),
                    modifier = Modifier.size(20.dp)
                )
            }

            StepStatus.IN_PROGRESS -> {
                CircularProgressIndicator(
                    modifier = Modifier.size(20.dp),
                    strokeWidth = 2.dp
                )
            }

            StepStatus.COMPLETED -> {
                Icon(
                    imageVector = Icons.Default.CheckCircle,
                    contentDescription = "已完成",
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(20.dp)
                )
            }

            StepStatus.FAILED -> {
                Icon(
                    imageVector = Icons.Default.Error,
                    contentDescription = "失败",
                    tint = MaterialTheme.colorScheme.error,
                    modifier = Modifier.size(20.dp)
                )
            }

            StepStatus.SKIPPED -> {
                Icon(
                    imageVector = Icons.Default.RadioButtonUnchecked,
                    contentDescription = "已跳过",
                    tint = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.3f),
                    modifier = Modifier.size(20.dp)
                )
            }
        }
    }
}

@Composable
private fun TaskPlanStatusChip(status: TaskPlanStatus) {
    val (text, backgroundColor, textColor) = when (status) {
        TaskPlanStatus.PENDING -> Triple(
            "待确认",
            MaterialTheme.colorScheme.secondaryContainer,
            MaterialTheme.colorScheme.onSecondaryContainer
        )

        TaskPlanStatus.CONFIRMED -> Triple(
            "已确认",
            MaterialTheme.colorScheme.primaryContainer,
            MaterialTheme.colorScheme.onPrimaryContainer
        )

        TaskPlanStatus.EXECUTING -> Triple(
            "执行中",
            MaterialTheme.colorScheme.tertiaryContainer,
            MaterialTheme.colorScheme.onTertiaryContainer
        )

        TaskPlanStatus.COMPLETED -> Triple(
            "已完成",
            Color(0xFF4CAF50).copy(alpha = 0.2f),
            Color(0xFF2E7D32)
        )

        TaskPlanStatus.FAILED -> Triple(
            "执行失败",
            MaterialTheme.colorScheme.errorContainer,
            MaterialTheme.colorScheme.onErrorContainer
        )

        TaskPlanStatus.CANCELLED -> Triple(
            "已取消",
            MaterialTheme.colorScheme.surfaceVariant,
            MaterialTheme.colorScheme.onSurfaceVariant
        )
    }

    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(12.dp))
            .background(backgroundColor)
            .padding(horizontal = 8.dp, vertical = 4.dp)
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.labelSmall,
            color = textColor,
            fontWeight = FontWeight.Medium
        )
    }
}

package com.chainlesschain.android.feature.project.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccessTime
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.DragHandle
import androidx.compose.material.icons.filled.PriorityHigh
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
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
import androidx.compose.ui.res.stringResource
import com.chainlesschain.android.feature.project.model.Task
import com.chainlesschain.android.feature.project.model.TaskPriority
import com.chainlesschain.android.feature.project.model.TaskStatus
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * 任务卡片组件
 *
 * 用于在任务列表中显示单个任务的摘要信息
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun TaskCard(
    task: Task,
    onClick: () -> Unit,
    onCheckboxClick: (Boolean) -> Unit,
    modifier: Modifier = Modifier
) {
    val isCompleted = task.status == TaskStatus.COMPLETED
    val priorityColor = Color(task.priority.color)

    Card(
        modifier = modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (isCompleted) {
                MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
            } else {
                MaterialTheme.colorScheme.surface
            }
        ),
        elevation = CardDefaults.cardElevation(
            defaultElevation = if (isCompleted) 0.dp else 2.dp
        )
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.Top
        ) {
            // 优先级颜色条
            Box(
                modifier = Modifier
                    .width(4.dp)
                    .height(80.dp)
                    .background(
                        color = if (isCompleted) {
                            priorityColor.copy(alpha = 0.3f)
                        } else {
                            priorityColor
                        }
                    )
            )

            // 复选框
            Checkbox(
                checked = isCompleted,
                onCheckedChange = onCheckboxClick,
                modifier = Modifier.padding(start = 8.dp, top = 8.dp),
                colors = CheckboxDefaults.colors(
                    checkedColor = MaterialTheme.colorScheme.primary,
                    uncheckedColor = MaterialTheme.colorScheme.outline
                )
            )

            // 内容区域
            Column(
                modifier = Modifier
                    .weight(1f)
                    .padding(vertical = 12.dp, horizontal = 8.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                // 标题行
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = task.title,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Medium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        textDecoration = if (isCompleted) TextDecoration.LineThrough else null,
                        color = if (isCompleted) {
                            MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f)
                        } else {
                            MaterialTheme.colorScheme.onSurface
                        },
                        modifier = Modifier.weight(1f)
                    )

                    // 状态和优先级芯片
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        TaskStatusChip(status = task.status)
                        TaskPriorityIcon(priority = task.priority)
                    }
                }

                // 描述（如果有）
                task.description?.let { desc ->
                    if (desc.isNotBlank()) {
                        Text(
                            text = desc,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                }

                // 底部信息行
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    // 截止日期
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        if (task.dueDate != null) {
                            DueDateChip(
                                dueDate = task.dueDate,
                                isOverdue = task.isOverdue,
                                isDueSoon = task.isDueSoon
                            )
                        }

                        // 进度指示器（如果有子步骤）
                        if (task.hasSteps) {
                            TaskProgressChip(
                                completed = task.completedStepsCount,
                                total = task.totalStepsCount
                            )
                        }
                    }

                    // 标签
                    if (task.labels.isNotEmpty()) {
                        FlowRow(
                            horizontalArrangement = Arrangement.spacedBy(4.dp),
                            maxItemsInEachRow = 3
                        ) {
                            task.labels.take(2).forEach { label ->
                                TaskLabelChip(label = label)
                            }
                            if (task.labels.size > 2) {
                                Text(
                                    text = "+${task.labels.size - 2}",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        }
                    }
                }

                // 子步骤进度条
                if (task.hasSteps && !isCompleted) {
                    val progress by animateFloatAsState(
                        targetValue = task.completionRate,
                        label = "progress"
                    )
                    LinearProgressIndicator(
                        progress = { progress },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(4.dp)
                            .clip(RoundedCornerShape(2.dp)),
                        strokeCap = StrokeCap.Round
                    )
                }
            }
        }
    }
}

/**
 * 任务状态芯片
 */
@Composable
fun TaskStatusChip(status: TaskStatus) {
    val backgroundColor by animateColorAsState(
        targetValue = Color(status.color).copy(alpha = 0.15f),
        label = "bgColor"
    )
    val textColor by animateColorAsState(
        targetValue = Color(status.color),
        label = "textColor"
    )

    Surface(
        color = backgroundColor,
        shape = RoundedCornerShape(4.dp)
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                modifier = Modifier
                    .size(6.dp)
                    .clip(CircleShape)
                    .background(textColor)
            )
            Text(
                text = stringResource(status.displayNameResId),
                style = MaterialTheme.typography.labelSmall,
                color = textColor,
                fontWeight = FontWeight.Medium
            )
        }
    }
}

/**
 * 任务优先级图标
 */
@Composable
fun TaskPriorityIcon(priority: TaskPriority) {
    val color = Color(priority.color)
    val icon = when (priority) {
        TaskPriority.LOW -> Icons.Default.ArrowDownward
        TaskPriority.MEDIUM -> Icons.Default.DragHandle
        TaskPriority.HIGH -> Icons.Default.ArrowUpward
        TaskPriority.URGENT -> Icons.Default.PriorityHigh
    }

    Icon(
        imageVector = icon,
        contentDescription = stringResource(priority.displayNameResId),
        tint = color,
        modifier = Modifier.size(16.dp)
    )
}

/**
 * 截止日期芯片
 */
@Composable
fun DueDateChip(
    dueDate: Long,
    isOverdue: Boolean,
    isDueSoon: Boolean
) {
    val dateFormat = SimpleDateFormat("MM/dd", Locale.getDefault())
    val dateStr = dateFormat.format(Date(dueDate))

    val backgroundColor = when {
        isOverdue -> MaterialTheme.colorScheme.errorContainer
        isDueSoon -> MaterialTheme.colorScheme.tertiaryContainer
        else -> MaterialTheme.colorScheme.surfaceVariant
    }

    val textColor = when {
        isOverdue -> MaterialTheme.colorScheme.error
        isDueSoon -> MaterialTheme.colorScheme.tertiary
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }

    Surface(
        color = backgroundColor,
        shape = RoundedCornerShape(4.dp)
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = if (isOverdue) Icons.Default.Warning else Icons.Default.AccessTime,
                contentDescription = null,
                tint = textColor,
                modifier = Modifier.size(12.dp)
            )
            Text(
                text = dateStr,
                style = MaterialTheme.typography.labelSmall,
                color = textColor,
                fontWeight = if (isOverdue) FontWeight.Bold else FontWeight.Normal
            )
        }
    }
}

/**
 * 任务进度芯片
 */
@Composable
fun TaskProgressChip(
    completed: Int,
    total: Int
) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceVariant,
        shape = RoundedCornerShape(4.dp)
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = Icons.Default.CheckCircle,
                contentDescription = null,
                tint = if (completed == total) {
                    MaterialTheme.colorScheme.primary
                } else {
                    MaterialTheme.colorScheme.onSurfaceVariant
                },
                modifier = Modifier.size(12.dp)
            )
            Text(
                text = "$completed/$total",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

/**
 * 任务标签芯片
 */
@Composable
fun TaskLabelChip(label: String) {
    Surface(
        color = MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.5f),
        shape = RoundedCornerShape(4.dp)
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSecondaryContainer,
            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
    }
}

/**
 * 简化版任务卡片（用于紧凑列表）
 */
@Composable
fun TaskCardCompact(
    task: Task,
    onClick: () -> Unit,
    onCheckboxClick: (Boolean) -> Unit,
    modifier: Modifier = Modifier
) {
    val isCompleted = task.status == TaskStatus.COMPLETED
    val priorityColor = Color(task.priority.color)

    Row(
        modifier = modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(vertical = 8.dp, horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        // 优先级颜色条
        Box(
            modifier = Modifier
                .width(3.dp)
                .height(40.dp)
                .clip(RoundedCornerShape(2.dp))
                .background(priorityColor)
        )

        // 复选框
        Checkbox(
            checked = isCompleted,
            onCheckedChange = onCheckboxClick,
            colors = CheckboxDefaults.colors(
                checkedColor = MaterialTheme.colorScheme.primary,
                uncheckedColor = MaterialTheme.colorScheme.outline
            )
        )

        // 标题
        Text(
            text = task.title,
            style = MaterialTheme.typography.bodyMedium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            textDecoration = if (isCompleted) TextDecoration.LineThrough else null,
            color = if (isCompleted) {
                MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f)
            } else {
                MaterialTheme.colorScheme.onSurface
            },
            modifier = Modifier.weight(1f)
        )

        // 截止日期
        if (task.dueDate != null && !isCompleted) {
            DueDateChip(
                dueDate = task.dueDate,
                isOverdue = task.isOverdue,
                isDueSoon = task.isDueSoon
            )
        }
    }
}

package com.chainlesschain.android.presentation.screens

import androidx.compose.animation.*
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.res.stringResource
import com.chainlesschain.android.R
import com.chainlesschain.android.feature.project.domain.*
import com.chainlesschain.android.presentation.components.*
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter

/**
 * 任务详情页面
 * 参考: iOS和PC端的任务管理页面
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TaskDetailScreen(
    task: TaskEntity,
    onNavigateBack: () -> Unit = {},
    onTaskUpdate: (TaskEntity) -> Unit = {}
) {
    var editedTask by remember { mutableStateOf(task) }
    var showMenu by remember { mutableStateOf(false) }
    var showEditDialog by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.task_detail_title)) },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.common_back))
                    }
                },
                actions = {
                    IconButton(onClick = { showMenu = true }) {
                        Icon(Icons.Default.MoreVert, contentDescription = stringResource(R.string.common_more))
                    }
                    DropdownMenu(
                        expanded = showMenu,
                        onDismissRequest = { showMenu = false }
                    ) {
                        DropdownMenuItem(
                            text = { Text(stringResource(R.string.common_edit)) },
                            onClick = {
                                showMenu = false
                                showEditDialog = true
                            },
                            leadingIcon = { Icon(Icons.Default.Edit, null) }
                        )
                        DropdownMenuItem(
                            text = { Text(stringResource(R.string.common_copy)) },
                            onClick = {
                                showMenu = false
                                onTaskUpdate(editedTask.copy(id = "copy_${System.currentTimeMillis()}"))
                            },
                            leadingIcon = { Icon(Icons.Default.ContentCopy, null) }
                        )
                        HorizontalDivider()
                        DropdownMenuItem(
                            text = { Text(stringResource(R.string.common_delete), color = MaterialTheme.colorScheme.error) },
                            onClick = {
                                showMenu = false
                                onNavigateBack()
                            },
                            leadingIcon = { Icon(Icons.Default.Delete, null, tint = MaterialTheme.colorScheme.error) }
                        )
                    }
                }
            )
        },
        floatingActionButton = {
            if (editedTask.status != TaskStatus.COMPLETED) {
                FloatingActionButton(
                    onClick = {
                        val completed = editedTask.copy(
                            status = TaskStatus.COMPLETED,
                            completedAt = LocalDateTime.now()
                        )
                        editedTask = completed
                        onTaskUpdate(completed)
                    }
                ) {
                    Icon(Icons.Default.Check, contentDescription = stringResource(R.string.task_complete))
                }
            }
        }
    ) { paddingValues ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // 任务标题和状态
            item {
                TaskHeaderCard(editedTask)
            }

            // 任务描述
            val description = editedTask.description
            if (!description.isNullOrBlank()) {
                item {
                    TaskDescriptionCard(description)
                }
            }

            // 任务详细信息
            item {
                TaskInfoCard(editedTask)
            }

            // 任务步骤
            if (editedTask.steps.isNotEmpty()) {
                item {
                    Text(
                        text = "任务步骤",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold
                    )
                }

                items(editedTask.steps.sortedBy { it.order }) { step ->
                    TaskStepItem(
                        step = step,
                        onToggle = { updatedStep ->
                            val updatedSteps = editedTask.steps.map {
                                if (it.id == updatedStep.id) updatedStep else it
                            }
                            val updated = editedTask.copy(steps = updatedSteps)
                            editedTask = updated
                            onTaskUpdate(updated)
                        }
                    )
                }

                item {
                    OutlinedButton(
                        onClick = { /* Step creation requires TaskStep data model */ },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Icon(Icons.Default.Add, contentDescription = null)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(stringResource(R.string.task_add_step))
                    }
                }
            }

            // 标签
            if (editedTask.tags.isNotEmpty()) {
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(
                            text = "标签",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold
                        )
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            editedTask.tags.forEach { tag ->
                                Tag(text = tag)
                            }
                        }
                    }
                }
            }

            // 进度统计
            if (editedTask.steps.isNotEmpty()) {
                item {
                    TaskProgressCard(editedTask)
                }
            }
        }
    }
}

/**
 * 任务头部卡片
 */
@Composable
fun TaskHeaderCard(task: TaskEntity) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant
        )
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            // 标题
            Text(
                text = task.title,
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold,
                textDecoration = if (task.status == TaskStatus.COMPLETED) TextDecoration.LineThrough else null
            )

            // 状态和优先级
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                StatusChip(status = task.status)
                PriorityChip(priority = task.priority)

                if (task.isOverdue) {
                    Surface(
                        color = MaterialTheme.colorScheme.errorContainer,
                        shape = RoundedCornerShape(6.dp)
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                            horizontalArrangement = Arrangement.spacedBy(4.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(
                                imageVector = Icons.Default.Warning,
                                contentDescription = null,
                                modifier = Modifier.size(14.dp),
                                tint = MaterialTheme.colorScheme.error
                            )
                            Text(
                                text = "已逾期",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.error,
                                fontWeight = FontWeight.Medium
                            )
                        }
                    }
                }
            }
        }
    }
}

/**
 * 任务描述卡片
 */
@Composable
fun TaskDescriptionCard(description: String) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Text(
                text = "描述",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold
            )
            Text(
                text = description,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

/**
 * 任务信息卡片
 */
@Composable
fun TaskInfoCard(task: TaskEntity) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Text(
                text = "任务信息",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold
            )

            // 创建时间
            TaskInfoRow(
                icon = Icons.Default.CalendarToday,
                label = stringResource(R.string.task_created_at),
                value = task.createdAt.format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm"))
            )

            // 截止时间
            task.dueDate?.let { dueDate ->
                TaskInfoRow(
                    icon = Icons.Default.Event,
                    label = stringResource(R.string.task_due_date),
                    value = dueDate.format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm")),
                    valueColor = if (task.isOverdue) MaterialTheme.colorScheme.error else null
                )
            }

            // 完成时间
            task.completedAt?.let { completedAt ->
                TaskInfoRow(
                    icon = Icons.Default.CheckCircle,
                    label = stringResource(R.string.task_completed_at),
                    value = completedAt.format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm")),
                    valueColor = MaterialTheme.colorScheme.tertiary
                )
            }

            // 更新时间
            TaskInfoRow(
                icon = Icons.Default.Update,
                label = stringResource(R.string.task_updated_at),
                value = task.updatedAt.format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm"))
            )
        }
    }
}

@Composable
fun TaskInfoRow(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    value: String,
    valueColor: Color? = null
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            modifier = Modifier.size(20.dp),
            tint = MaterialTheme.colorScheme.primary
        )

        Text(
            text = label,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.weight(1f)
        )

        Text(
            text = value,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.Medium,
            color = valueColor ?: MaterialTheme.colorScheme.onSurface
        )
    }
}

/**
 * 任务步骤项
 */
@Composable
fun TaskStepItem(
    step: TaskStep,
    onToggle: (TaskStep) -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        onClick = { onToggle(step.copy(completed = !step.completed)) }
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // 复选框
            Checkbox(
                checked = step.completed,
                onCheckedChange = { onToggle(step.copy(completed = it)) }
            )

            // 步骤标题
            Text(
                text = step.title,
                style = MaterialTheme.typography.bodyLarge,
                textDecoration = if (step.completed) TextDecoration.LineThrough else null,
                color = if (step.completed) {
                    MaterialTheme.colorScheme.onSurfaceVariant
                } else {
                    MaterialTheme.colorScheme.onSurface
                },
                modifier = Modifier.weight(1f)
            )

            // 完成图标
            if (step.completed) {
                Icon(
                    imageVector = Icons.Default.CheckCircle,
                    contentDescription = stringResource(R.string.task_completed_cd),
                    tint = MaterialTheme.colorScheme.tertiary,
                    modifier = Modifier.size(20.dp)
                )
            }
        }
    }
}

/**
 * 任务进度卡片
 */
@Composable
fun TaskProgressCard(task: TaskEntity) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.primaryContainer
        )
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            horizontalArrangement = Arrangement.spacedBy(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // 进度环
            CircularProgress(
                progress = task.completionRate,
                size = 80.dp,
                strokeWidth = 8.dp
            )

            // 进度信息
            Column(
                verticalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                Text(
                    text = "任务进度",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold
                )

                val completedSteps = task.steps.count { it.completed }
                val totalSteps = task.steps.size

                Text(
                    text = "已完成 $completedSteps / $totalSteps 个步骤",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )

                if (task.status == TaskStatus.COMPLETED) {
                    Text(
                        text = "✓ 任务已完成",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.tertiary,
                        fontWeight = FontWeight.Medium
                    )
                }
            }
        }
    }
}

/**
 * 状态芯片
 */
@Composable
fun StatusChip(status: TaskStatus) {
    val (color, backgroundColor) = when (status) {
        TaskStatus.TODO -> MaterialTheme.colorScheme.secondary to MaterialTheme.colorScheme.secondaryContainer
        TaskStatus.IN_PROGRESS -> MaterialTheme.colorScheme.primary to MaterialTheme.colorScheme.primaryContainer
        TaskStatus.COMPLETED -> MaterialTheme.colorScheme.tertiary to MaterialTheme.colorScheme.tertiaryContainer
        TaskStatus.CANCELLED -> MaterialTheme.colorScheme.error to MaterialTheme.colorScheme.errorContainer
    }

    Surface(
        color = backgroundColor,
        shape = RoundedCornerShape(6.dp)
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                modifier = Modifier
                    .size(8.dp)
                    .clip(CircleShape)
                    .background(color)
            )
            Text(
                text = stringResource(status.displayNameResId),
                style = MaterialTheme.typography.labelSmall,
                color = color,
                fontWeight = FontWeight.Medium
            )
        }
    }
}

/**
 * 优先级芯片
 */
@Composable
fun PriorityChip(priority: TaskPriority) {
    val (color, icon) = when (priority) {
        TaskPriority.LOW -> MaterialTheme.colorScheme.secondary to Icons.Default.ArrowDownward
        TaskPriority.MEDIUM -> MaterialTheme.colorScheme.primary to Icons.Default.DragHandle
        TaskPriority.HIGH -> MaterialTheme.colorScheme.tertiary to Icons.Default.ArrowUpward
        TaskPriority.URGENT -> MaterialTheme.colorScheme.error to Icons.Default.PriorityHigh
    }

    Surface(
        color = color.copy(alpha = 0.1f),
        shape = RoundedCornerShape(6.dp)
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                modifier = Modifier.size(14.dp),
                tint = color
            )
            Text(
                text = stringResource(priority.displayNameResId),
                style = MaterialTheme.typography.labelSmall,
                color = color,
                fontWeight = FontWeight.Medium
            )
        }
    }
}

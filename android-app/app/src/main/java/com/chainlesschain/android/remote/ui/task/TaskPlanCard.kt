package com.chainlesschain.android.remote.ui.task

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.chainlesschain.android.remote.model.PlanningState
import com.chainlesschain.android.remote.model.TaskItem
import com.chainlesschain.android.remote.model.TaskPlan
import com.chainlesschain.android.remote.model.TaskStatus

/**
 * Full-featured Task Plan Card component
 *
 * Displays a task plan with:
 * - Title and summary
 * - Expandable task list
 * - Execution progress
 * - Action buttons based on state
 */
@Composable
fun TaskPlanCardFull(
    plan: TaskPlan,
    state: PlanningState,
    onConfirm: () -> Unit,
    onReject: () -> Unit,
    onPause: () -> Unit = {},
    onResume: () -> Unit = {},
    onCancel: () -> Unit = {},
    modifier: Modifier = Modifier
) {
    var isExpanded by remember { mutableStateOf(true) }

    Card(
        modifier = modifier
            .fillMaxWidth()
            .animateContentSize(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceContainerHigh
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 4.dp)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            // Header
            TaskPlanHeader(
                title = plan.title,
                state = state,
                isExpanded = isExpanded,
                onToggleExpand = { isExpanded = !isExpanded }
            )

            Spacer(modifier = Modifier.height(12.dp))

            // Summary
            Text(
                text = plan.summary,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            // Progress bar for executing state
            if (state == PlanningState.EXECUTING) {
                Spacer(modifier = Modifier.height(12.dp))
                TaskExecutionProgress(plan = plan)
            }

            // Expandable task list
            AnimatedVisibility(
                visible = isExpanded,
                enter = expandVertically(),
                exit = shrinkVertically()
            ) {
                Column {
                    Spacer(modifier = Modifier.height(16.dp))
                    HorizontalDivider()
                    Spacer(modifier = Modifier.height(12.dp))

                    Text(
                        text = "Tasks (${plan.tasks.size})",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Bold
                    )

                    Spacer(modifier = Modifier.height(8.dp))

                    plan.tasks.forEach { task ->
                        TaskItemCard(
                            task = task,
                            isExecuting = state == PlanningState.EXECUTING
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                    }
                }
            }

            // Outputs
            if (plan.outputs.isNotEmpty() && isExpanded) {
                Spacer(modifier = Modifier.height(12.dp))
                TaskOutputsSection(outputs = plan.outputs)
            }

            // Estimated duration
            plan.estimatedDuration?.let { duration ->
                Spacer(modifier = Modifier.height(12.dp))
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Icon(
                        Icons.Default.Schedule,
                        contentDescription = null,
                        modifier = Modifier.size(16.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Text(
                        text = "Estimated: $duration",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            // Action buttons
            Spacer(modifier = Modifier.height(16.dp))
            TaskPlanActions(
                state = state,
                onConfirm = onConfirm,
                onReject = onReject,
                onPause = onPause,
                onResume = onResume,
                onCancel = onCancel
            )
        }
    }
}

@Composable
private fun TaskPlanHeader(
    title: String,
    state: PlanningState,
    isExpanded: Boolean,
    onToggleExpand: () -> Unit
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.weight(1f)
        ) {
            // State indicator
            PlanStateIndicator(state = state)

            Text(
                text = title,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis
            )
        }

        IconButton(onClick = onToggleExpand) {
            val rotation by animateFloatAsState(
                targetValue = if (isExpanded) 0f else 180f,
                label = "expand rotation"
            )
            Icon(
                Icons.Default.ExpandLess,
                contentDescription = if (isExpanded) "Collapse" else "Expand",
                modifier = Modifier.rotate(rotation)
            )
        }
    }
}

@Composable
private fun PlanStateIndicator(state: PlanningState) {
    val (color, icon) = when (state) {
        PlanningState.IDLE -> MaterialTheme.colorScheme.surfaceVariant to null
        PlanningState.ANALYZING -> MaterialTheme.colorScheme.tertiary to null
        PlanningState.INTERVIEWING -> MaterialTheme.colorScheme.secondary to null
        PlanningState.PLANNING -> MaterialTheme.colorScheme.secondary to null
        PlanningState.CONFIRMING -> MaterialTheme.colorScheme.primary to null
        PlanningState.EXECUTING -> MaterialTheme.colorScheme.primary to Icons.Default.PlayArrow
        PlanningState.COMPLETED -> MaterialTheme.colorScheme.primary to Icons.Default.Check
        PlanningState.CANCELLED -> MaterialTheme.colorScheme.error to Icons.Default.Close
    }

    Box(
        modifier = Modifier
            .size(32.dp)
            .clip(CircleShape)
            .background(color),
        contentAlignment = Alignment.Center
    ) {
        if (state == PlanningState.EXECUTING || state == PlanningState.ANALYZING ||
            state == PlanningState.PLANNING) {
            CircularProgressIndicator(
                modifier = Modifier.size(20.dp),
                strokeWidth = 2.dp,
                color = MaterialTheme.colorScheme.onPrimary
            )
        } else if (icon != null) {
            Icon(
                icon,
                contentDescription = null,
                modifier = Modifier.size(18.dp),
                tint = MaterialTheme.colorScheme.onPrimary
            )
        }
    }
}

@Composable
private fun TaskExecutionProgress(plan: TaskPlan) {
    val completedCount = plan.tasks.count {
        it.status == TaskStatus.COMPLETED || it.status == TaskStatus.FAILED
    }
    val progress = if (plan.tasks.isNotEmpty()) {
        completedCount.toFloat() / plan.tasks.size
    } else 0f

    Column {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text(
                text = "Progress",
                style = MaterialTheme.typography.labelMedium
            )
            Text(
                text = "$completedCount / ${plan.tasks.size}",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.primary
            )
        }

        Spacer(modifier = Modifier.height(8.dp))

        LinearProgressIndicator(
            progress = { progress },
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun TaskItemCard(
    task: TaskItem,
    isExecuting: Boolean
) {
    var showDetails by remember { mutableStateOf(false) }

    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { showDetails = !showDetails },
        shape = RoundedCornerShape(8.dp),
        color = when (task.status) {
            TaskStatus.COMPLETED -> MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.3f)
            TaskStatus.IN_PROGRESS -> MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.5f)
            TaskStatus.FAILED -> MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.3f)
            TaskStatus.SKIPPED -> MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
            TaskStatus.PENDING -> MaterialTheme.colorScheme.surface
        }
    ) {
        Column(
            modifier = Modifier
                .padding(12.dp)
                .animateContentSize()
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                // Status indicator
                TaskStatusIndicator(
                    status = task.status,
                    taskId = task.id,
                    progress = task.progress
                )

                // Task info
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = task.name,
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.Medium
                    )

                    if (!showDetails) {
                        Text(
                            text = task.description,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                }

                // Expand indicator
                Icon(
                    if (showDetails) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
                    contentDescription = null,
                    modifier = Modifier.size(20.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            // Expanded details
            AnimatedVisibility(visible = showDetails) {
                Column(modifier = Modifier.padding(top = 8.dp)) {
                    Text(
                        text = task.description,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )

                    Spacer(modifier = Modifier.height(8.dp))

                    Row(
                        horizontalArrangement = Arrangement.spacedBy(16.dp)
                    ) {
                        Column {
                            Text(
                                text = "Action",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                            Text(
                                text = task.action,
                                style = MaterialTheme.typography.bodySmall
                            )
                        }

                        Column {
                            Text(
                                text = "Output",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                            Text(
                                text = task.output,
                                style = MaterialTheme.typography.bodySmall
                            )
                        }
                    }

                    // Error message if failed
                    task.error?.let { error ->
                        Spacer(modifier = Modifier.height(8.dp))
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(4.dp)
                        ) {
                            Icon(
                                Icons.Default.Warning,
                                contentDescription = null,
                                modifier = Modifier.size(14.dp),
                                tint = MaterialTheme.colorScheme.error
                            )
                            Text(
                                text = error,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.error
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun TaskStatusIndicator(
    status: TaskStatus,
    taskId: Int,
    progress: Int
) {
    Box(
        modifier = Modifier
            .size(28.dp)
            .clip(CircleShape)
            .background(
                when (status) {
                    TaskStatus.COMPLETED -> MaterialTheme.colorScheme.primary
                    TaskStatus.IN_PROGRESS -> MaterialTheme.colorScheme.secondary
                    TaskStatus.FAILED -> MaterialTheme.colorScheme.error
                    TaskStatus.SKIPPED -> MaterialTheme.colorScheme.outline
                    TaskStatus.PENDING -> MaterialTheme.colorScheme.surfaceVariant
                }
            ),
        contentAlignment = Alignment.Center
    ) {
        when (status) {
            TaskStatus.COMPLETED -> Icon(
                Icons.Default.Check,
                null,
                modifier = Modifier.size(16.dp),
                tint = MaterialTheme.colorScheme.onPrimary
            )
            TaskStatus.IN_PROGRESS -> {
                if (progress > 0) {
                    CircularProgressIndicator(
                        progress = { progress / 100f },
                        modifier = Modifier.size(20.dp),
                        strokeWidth = 2.dp,
                        color = MaterialTheme.colorScheme.onSecondary,
                        trackColor = MaterialTheme.colorScheme.secondary.copy(alpha = 0.3f)
                    )
                } else {
                    CircularProgressIndicator(
                        modifier = Modifier.size(16.dp),
                        strokeWidth = 2.dp,
                        color = MaterialTheme.colorScheme.onSecondary
                    )
                }
            }
            TaskStatus.FAILED -> Icon(
                Icons.Default.Close,
                null,
                modifier = Modifier.size(16.dp),
                tint = MaterialTheme.colorScheme.onError
            )
            else -> Text(
                text = "$taskId",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

@Composable
private fun TaskOutputsSection(outputs: List<String>) {
    Column {
        Text(
            text = "Expected Outputs",
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )

        Spacer(modifier = Modifier.height(4.dp))

        outputs.forEach { output ->
            Row(
                modifier = Modifier.padding(vertical = 2.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(
                    modifier = Modifier
                        .size(6.dp)
                        .clip(CircleShape)
                        .background(MaterialTheme.colorScheme.primary)
                )
                Text(
                    text = output,
                    style = MaterialTheme.typography.bodySmall
                )
            }
        }
    }
}

@Composable
private fun TaskPlanActions(
    state: PlanningState,
    onConfirm: () -> Unit,
    onReject: () -> Unit,
    onPause: () -> Unit,
    onResume: () -> Unit,
    onCancel: () -> Unit
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.End,
        verticalAlignment = Alignment.CenterVertically
    ) {
        when (state) {
            PlanningState.CONFIRMING -> {
                OutlinedButton(onClick = onReject) {
                    Icon(Icons.Default.Close, null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("Reject")
                }
                Spacer(Modifier.width(12.dp))
                Button(onClick = onConfirm) {
                    Icon(Icons.Default.PlayArrow, null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("Execute")
                }
            }
            PlanningState.EXECUTING -> {
                OutlinedButton(
                    onClick = onCancel,
                    colors = ButtonDefaults.outlinedButtonColors(
                        contentColor = MaterialTheme.colorScheme.error
                    )
                ) {
                    Icon(Icons.Default.Close, null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("Cancel")
                }
            }
            PlanningState.COMPLETED -> {
                Text(
                    text = "Completed",
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.primary
                )
            }
            PlanningState.CANCELLED -> {
                Text(
                    text = "Cancelled",
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.error
                )
            }
            else -> {}
        }
    }
}

/**
 * Compact version of task plan card for message display
 */
@Composable
fun TaskPlanCardCompact(
    plan: TaskPlan,
    state: PlanningState,
    onViewDetails: () -> Unit,
    modifier: Modifier = Modifier
) {
    Card(
        modifier = modifier
            .fillMaxWidth()
            .clickable(onClick = onViewDetails),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceContainerHigh
        )
    ) {
        Row(
            modifier = Modifier
                .padding(12.dp)
                .fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            PlanStateIndicator(state = state)

            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = plan.title,
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    text = "${plan.tasks.size} tasks",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            Icon(
                Icons.Default.ExpandMore,
                contentDescription = "View details",
                tint = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

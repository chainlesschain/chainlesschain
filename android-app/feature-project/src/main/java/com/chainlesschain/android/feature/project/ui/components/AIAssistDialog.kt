package com.chainlesschain.android.feature.project.ui.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.BugReport
import androidx.compose.material.icons.filled.Code
import androidx.compose.material.icons.filled.Comment
import androidx.compose.material.icons.filled.CompareArrows
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.LightbulbCircle
import androidx.compose.material.icons.filled.Science
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.chainlesschain.android.feature.project.R

/**
 * AI助手操作类型
 */
enum class AIAssistAction(
    val titleResId: Int,
    val descriptionResId: Int,
    val icon: ImageVector,
    val color: Color
) {
    EXPLAIN(
        R.string.ai_action_explain,
        R.string.ai_action_explain_desc,
        Icons.Default.LightbulbCircle,
        Color(0xFF4CAF50)
    ),
    OPTIMIZE(
        R.string.ai_action_optimize,
        R.string.ai_action_optimize_desc,
        Icons.Default.AutoAwesome,
        Color(0xFF2196F3)
    ),
    FIX_BUGS(
        R.string.ai_action_fix_bugs,
        R.string.ai_action_fix_bugs_desc,
        Icons.Default.BugReport,
        Color(0xFFF44336)
    ),
    ADD_COMMENTS(
        R.string.ai_action_add_comments,
        R.string.ai_action_add_comments_desc,
        Icons.Default.Comment,
        Color(0xFF9C27B0)
    ),
    REFACTOR(
        R.string.ai_action_refactor,
        R.string.ai_action_refactor_desc,
        Icons.Default.CompareArrows,
        Color(0xFFFF9800)
    ),
    GENERATE_TESTS(
        R.string.ai_action_generate_tests,
        R.string.ai_action_generate_tests_desc,
        Icons.Default.Science,
        Color(0xFF00BCD4)
    ),
    IMPROVE_NAMING(
        R.string.ai_action_improve_naming,
        R.string.ai_action_improve_naming_desc,
        Icons.Default.Edit,
        Color(0xFFE91E63)
    ),
    COMPLETE_CODE(
        R.string.ai_action_complete_code,
        R.string.ai_action_complete_code_desc,
        Icons.Default.Code,
        Color(0xFF673AB7)
    )
}

/**
 * AI助手对话框
 * 提供常用的代码AI操作选项
 */
@Composable
fun AIAssistDialog(
    fileName: String?,
    fileExtension: String?,
    onActionSelected: (AIAssistAction) -> Unit,
    onDismiss: () -> Unit,
    isProcessing: Boolean = false
) {
    var selectedAction by remember { mutableStateOf<AIAssistAction?>(null) }

    AlertDialog(
        onDismissRequest = { if (!isProcessing) onDismiss() },
        title = {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Icon(
                    imageVector = Icons.Default.AutoAwesome,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(24.dp)
                )
                Column {
                    Text(
                        text = stringResource(R.string.ai_code_assistant),
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold
                    )
                    fileName?.let { name ->
                        Text(
                            text = name,
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }
        },
        text = {
            if (isProcessing) {
                // Processing state
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 32.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(16.dp)
                ) {
                    CircularProgressIndicator()
                    Text(
                        text = stringResource(R.string.ai_processing),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    selectedAction?.let { action ->
                        Text(
                            text = stringResource(action.titleResId),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.primary
                        )
                    }
                }
            } else {
                // Action list
                LazyColumn(
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    items(AIAssistAction.entries) { action ->
                        AIAssistActionCard(
                            action = action,
                            onClick = {
                                selectedAction = action
                                onActionSelected(action)
                            }
                        )
                    }
                }
            }
        },
        confirmButton = {
            if (!isProcessing) {
                TextButton(onClick = onDismiss) {
                    Text(stringResource(R.string.cancel))
                }
            }
        }
    )
}

/**
 * AI助手操作卡片
 */
@Composable
private fun AIAssistActionCard(
    action: AIAssistAction,
    onClick: () -> Unit
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            // Action icon
            Icon(
                imageVector = action.icon,
                contentDescription = null,
                tint = action.color,
                modifier = Modifier.size(28.dp)
            )

            // Action info
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = stringResource(action.titleResId),
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Medium,
                    color = MaterialTheme.colorScheme.onSurface
                )
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = stringResource(action.descriptionResId),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

/**
 * 简洁版AI助手快捷按钮
 */
@Composable
fun AIAssistQuickActions(
    onActionSelected: (AIAssistAction) -> Unit,
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        // 最常用的3个操作
        listOf(
            AIAssistAction.EXPLAIN,
            AIAssistAction.OPTIMIZE,
            AIAssistAction.FIX_BUGS
        ).forEach { action ->
            Card(
                modifier = Modifier
                    .weight(1f)
                    .clickable { onActionSelected(action) },
                shape = RoundedCornerShape(8.dp),
                colors = CardDefaults.cardColors(
                    containerColor = action.color.copy(alpha = 0.1f)
                )
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(12.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Icon(
                        imageVector = action.icon,
                        contentDescription = null,
                        tint = action.color,
                        modifier = Modifier.size(20.dp)
                    )
                    Text(
                        text = stringResource(action.titleResId),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                }
            }
        }
    }
}

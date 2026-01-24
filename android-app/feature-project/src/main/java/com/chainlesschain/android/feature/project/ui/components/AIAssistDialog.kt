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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/**
 * AI助手操作类型
 */
enum class AIAssistAction(
    val title: String,
    val description: String,
    val icon: ImageVector,
    val color: Color
) {
    EXPLAIN(
        "解释代码",
        "让AI解释当前代码的功能和工作原理",
        Icons.Default.LightbulbCircle,
        Color(0xFF4CAF50)
    ),
    OPTIMIZE(
        "优化代码",
        "获取代码优化建议和性能改进方案",
        Icons.Default.AutoAwesome,
        Color(0xFF2196F3)
    ),
    FIX_BUGS(
        "检测Bug",
        "分析代码中可能存在的问题和潜在bug",
        Icons.Default.BugReport,
        Color(0xFFF44336)
    ),
    ADD_COMMENTS(
        "添加注释",
        "为代码生成详细的注释和文档",
        Icons.Default.Comment,
        Color(0xFF9C27B0)
    ),
    REFACTOR(
        "重构建议",
        "获取代码重构和架构改进建议",
        Icons.Default.CompareArrows,
        Color(0xFFFF9800)
    ),
    GENERATE_TESTS(
        "生成测试",
        "为当前代码生成单元测试",
        Icons.Default.Science,
        Color(0xFF00BCD4)
    ),
    IMPROVE_NAMING(
        "改进命名",
        "优化变量、函数和类的命名",
        Icons.Default.Edit,
        Color(0xFFE91E63)
    ),
    COMPLETE_CODE(
        "智能补全",
        "根据上下文智能补全代码",
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
                        text = "AI 代码助手",
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
                        text = "AI 正在处理...",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    selectedAction?.let { action ->
                        Text(
                            text = action.title,
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
                    Text("取消")
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
                    text = action.title,
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Medium,
                    color = MaterialTheme.colorScheme.onSurface
                )
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = action.description,
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
                        text = action.title,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                }
            }
        }
    }
}

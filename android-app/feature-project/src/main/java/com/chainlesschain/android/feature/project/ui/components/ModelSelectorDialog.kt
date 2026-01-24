package com.chainlesschain.android.feature.project.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.Computer
import androidx.compose.material.icons.filled.Speed
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.Token
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.chainlesschain.android.feature.ai.domain.model.LLMModel
import com.chainlesschain.android.feature.ai.domain.model.LLMProvider

/**
 * 模型选择器对话框
 * 展示所有可用的LLM模型，按提供商分组
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ModelSelectorDialog(
    currentModel: String,
    currentProvider: LLMProvider,
    onModelSelected: (String, LLMProvider) -> Unit,
    onDismiss: () -> Unit
) {
    var selectedProvider by remember { mutableStateOf(currentProvider) }
    val allModels = LLMProvider.DEFAULT_MODELS

    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Text(
                text = "选择AI模型",
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold
            )
        },
        text = {
            Column {
                // Provider tabs
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    LLMProvider.entries.forEach { provider ->
                        ProviderChip(
                            provider = provider,
                            isSelected = selectedProvider == provider,
                            onClick = { selectedProvider = provider },
                            modifier = Modifier.weight(1f)
                        )
                    }
                }

                Spacer(modifier = Modifier.height(16.dp))

                // Models list for selected provider
                val models = allModels[selectedProvider] ?: emptyList()

                if (models.isEmpty()) {
                    EmptyModelsMessage(selectedProvider)
                } else {
                    LazyColumn(
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        items(models) { model ->
                            ModelCard(
                                model = model,
                                isSelected = model.id == currentModel && model.provider == currentProvider,
                                onClick = {
                                    onModelSelected(model.id, model.provider)
                                    onDismiss()
                                }
                            )
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text("关闭")
            }
        }
    )
}

/**
 * Provider选择芯片
 */
@Composable
private fun ProviderChip(
    provider: LLMProvider,
    isSelected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    Surface(
        modifier = modifier
            .clip(RoundedCornerShape(20.dp))
            .clickable(onClick = onClick),
        color = if (isSelected) {
            MaterialTheme.colorScheme.primaryContainer
        } else {
            MaterialTheme.colorScheme.surfaceVariant
        },
        shape = RoundedCornerShape(20.dp)
    ) {
        Column(
            modifier = Modifier.padding(vertical = 12.dp, horizontal = 8.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            Icon(
                imageVector = getProviderIcon(provider),
                contentDescription = null,
                modifier = Modifier.size(24.dp),
                tint = if (isSelected) {
                    MaterialTheme.colorScheme.primary
                } else {
                    MaterialTheme.colorScheme.onSurfaceVariant
                }
            )
            Text(
                text = provider.displayName,
                style = MaterialTheme.typography.labelSmall,
                color = if (isSelected) {
                    MaterialTheme.colorScheme.onPrimaryContainer
                } else {
                    MaterialTheme.colorScheme.onSurfaceVariant
                },
                fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal
            )
        }
    }
}

/**
 * 模型卡片
 */
@Composable
private fun ModelCard(
    model: LLMModel,
    isSelected: Boolean,
    onClick: () -> Unit
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (isSelected) {
                MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.5f)
            } else {
                MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f)
            }
        ),
        elevation = CardDefaults.cardElevation(
            defaultElevation = if (isSelected) 2.dp else 0.dp
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                // Model name with recommended badge
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Text(
                        text = model.name,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium,
                        color = if (isSelected) {
                            MaterialTheme.colorScheme.onPrimaryContainer
                        } else {
                            MaterialTheme.colorScheme.onSurface
                        }
                    )

                    if (isRecommended(model)) {
                        RecommendedBadge()
                    }
                }

                Spacer(modifier = Modifier.height(8.dp))

                // Model capabilities
                Row(
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    ModelCapability(
                        icon = Icons.Default.Token,
                        label = "${model.maxTokens / 1024}K",
                        tooltip = "最大上下文"
                    )
                    ModelCapability(
                        icon = Icons.Default.Speed,
                        label = getSpeedRating(model),
                        tooltip = "响应速度"
                    )
                    if (model.provider != LLMProvider.OLLAMA) {
                        ModelCapability(
                            icon = Icons.Default.Cloud,
                            label = getCostRating(model),
                            tooltip = "成本"
                        )
                    }
                }
            }

            if (isSelected) {
                Icon(
                    imageVector = Icons.Default.CheckCircle,
                    contentDescription = "已选择",
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(28.dp)
                )
            }
        }
    }
}

/**
 * 推荐徽章
 */
@Composable
private fun RecommendedBadge() {
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.tertiaryContainer
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            Icon(
                imageVector = Icons.Default.Star,
                contentDescription = null,
                modifier = Modifier.size(12.dp),
                tint = MaterialTheme.colorScheme.tertiary
            )
            Text(
                text = "推荐",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onTertiaryContainer,
                fontWeight = FontWeight.Bold
            )
        }
    }
}

/**
 * 模型能力指标
 */
@Composable
private fun ModelCapability(
    icon: ImageVector,
    label: String,
    tooltip: String
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        Icon(
            imageVector = icon,
            contentDescription = tooltip,
            modifier = Modifier.size(14.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f)
        )
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

/**
 * 空模型列表提示
 */
@Composable
private fun EmptyModelsMessage(provider: LLMProvider) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Icon(
            imageVector = getProviderIcon(provider),
            contentDescription = null,
            modifier = Modifier.size(48.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
        )
        Text(
            text = "暂无${provider.displayName}模型",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

/**
 * 获取提供商图标
 */
private fun getProviderIcon(provider: LLMProvider): ImageVector = when (provider) {
    LLMProvider.OPENAI -> Icons.Default.Cloud
    LLMProvider.DEEPSEEK -> Icons.Default.Cloud
    LLMProvider.OLLAMA -> Icons.Default.Computer
    LLMProvider.CUSTOM -> Icons.Default.Cloud
}

/**
 * 判断是否推荐模型
 */
private fun isRecommended(model: LLMModel): Boolean = when {
    model.id == "deepseek-chat" -> true
    model.id == "gpt-4" -> true
    model.id == "qwen2:7b" -> true
    else -> false
}

/**
 * 获取速度评级
 */
private fun getSpeedRating(model: LLMModel): String = when (model.provider) {
    LLMProvider.OPENAI -> when (model.id) {
        "gpt-4" -> "中"
        "gpt-3.5-turbo" -> "快"
        else -> "中"
    }
    LLMProvider.DEEPSEEK -> "快"
    LLMProvider.OLLAMA -> "快"
    LLMProvider.CUSTOM -> "中"
}

/**
 * 获取成本评级
 */
private fun getCostRating(model: LLMModel): String = when (model.provider) {
    LLMProvider.OPENAI -> when (model.id) {
        "gpt-4" -> "$$"
        "gpt-3.5-turbo" -> "$"
        else -> "$$"
    }
    LLMProvider.DEEPSEEK -> "$"
    else -> "$"
}

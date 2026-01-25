package com.chainlesschain.android.feature.filebrowser.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.chainlesschain.android.core.database.entity.FileCategory
import com.chainlesschain.android.feature.filebrowser.ml.FileClassifier

/**
 * AI Classification Badge Component
 *
 * Displays AI-suggested file category with:
 * - Confidence score indicator
 * - Top labels from ML Kit
 * - Accept/Reject actions
 * - Animated appearance
 *
 * @param classification AI classification result
 * @param currentCategory Current file category
 * @param onAccept Callback when user accepts AI suggestion
 * @param onReject Callback when user rejects AI suggestion
 * @param modifier Modifier for customization
 */
@Composable
fun AIClassificationBadge(
    classification: FileClassifier.ClassificationResult,
    currentCategory: FileCategory,
    onAccept: () -> Unit,
    onReject: () -> Unit,
    modifier: Modifier = Modifier
) {
    // Don't show if fallback or same category
    val shouldShow = !classification.fallback &&
            classification.suggestedCategory != currentCategory &&
            classification.confidence > 0.5f

    AnimatedVisibility(
        visible = shouldShow,
        enter = fadeIn(),
        exit = fadeOut(),
        modifier = modifier
    ) {
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.primaryContainer
            )
        ) {
            Column(
                modifier = Modifier.padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                // Header with AI icon
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        imageVector = Icons.Default.AutoAwesome,
                        contentDescription = "AI建议",
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(20.dp)
                    )

                    Text(
                        text = "AI 建议分类",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Medium,
                        color = MaterialTheme.colorScheme.onPrimaryContainer
                    )

                    Spacer(modifier = Modifier.weight(1f))

                    // Confidence score
                    ConfidenceBadge(confidence = classification.confidence)
                }

                // Suggested category
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "建议分类为:",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.8f)
                    )

                    AssistChip(
                        onClick = { },
                        label = {
                            Text(
                                text = getCategoryDisplayName(classification.suggestedCategory),
                                fontWeight = FontWeight.Medium
                            )
                        },
                        colors = AssistChipDefaults.assistChipColors(
                            containerColor = MaterialTheme.colorScheme.primary,
                            labelColor = MaterialTheme.colorScheme.onPrimary
                        )
                    )
                }

                // Top labels from ML Kit
                if (classification.labels.isNotEmpty()) {
                    Text(
                        text = "检测到: ${classification.labels.take(3).joinToString(", ")}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.6f)
                    )
                }

                // Action buttons
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    TextButton(
                        onClick = onReject,
                        colors = ButtonDefaults.textButtonColors(
                            contentColor = MaterialTheme.colorScheme.onPrimaryContainer
                        )
                    ) {
                        Icon(
                            imageVector = Icons.Default.Close,
                            contentDescription = "拒绝",
                            modifier = Modifier.size(16.dp)
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("忽略")
                    }

                    Spacer(modifier = Modifier.width(8.dp))

                    FilledTonalButton(
                        onClick = onAccept,
                        colors = ButtonDefaults.filledTonalButtonColors(
                            containerColor = MaterialTheme.colorScheme.primary,
                            contentColor = MaterialTheme.colorScheme.onPrimary
                        )
                    ) {
                        Icon(
                            imageVector = Icons.Default.Check,
                            contentDescription = "接受",
                            modifier = Modifier.size(16.dp)
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("应用")
                    }
                }
            }
        }
    }
}

/**
 * Confidence Score Badge
 *
 * Displays confidence as percentage with color coding
 */
@Composable
private fun ConfidenceBadge(confidence: Float) {
    val percentage = (confidence * 100).toInt()

    val (backgroundColor, textColor) = when {
        confidence >= 0.9f -> MaterialTheme.colorScheme.primary to MaterialTheme.colorScheme.onPrimary
        confidence >= 0.7f -> MaterialTheme.colorScheme.tertiary to MaterialTheme.colorScheme.onTertiary
        else -> MaterialTheme.colorScheme.surfaceVariant to MaterialTheme.colorScheme.onSurfaceVariant
    }

    Surface(
        shape = MaterialTheme.shapes.small,
        color = backgroundColor
    ) {
        Text(
            text = "${percentage}%",
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Bold,
            color = textColor,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
        )
    }
}

/**
 * Get display name for file category
 */
private fun getCategoryDisplayName(category: FileCategory): String {
    return when (category) {
        FileCategory.DOCUMENT -> "文档"
        FileCategory.IMAGE -> "图片"
        FileCategory.VIDEO -> "视频"
        FileCategory.AUDIO -> "音频"
        FileCategory.ARCHIVE -> "压缩包"
        FileCategory.CODE -> "代码"
        FileCategory.OTHER -> "其他"
    }
}

/**
 * AI Classification Chip (Compact Version)
 *
 * Smaller badge for use in file list items
 *
 * @param classification AI classification result
 * @param onClick Callback when chip is clicked
 */
@Composable
fun AIClassificationChip(
    classification: FileClassifier.ClassificationResult,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    if (classification.fallback || classification.confidence < 0.7f) {
        return
    }

    AssistChip(
        onClick = onClick,
        label = {
            Row(
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    imageVector = Icons.Default.AutoAwesome,
                    contentDescription = null,
                    modifier = Modifier.size(14.dp)
                )
                Text(
                    text = "AI: ${getCategoryDisplayName(classification.suggestedCategory)}",
                    style = MaterialTheme.typography.labelSmall
                )
            }
        },
        colors = AssistChipDefaults.assistChipColors(
            containerColor = MaterialTheme.colorScheme.primaryContainer,
            labelColor = MaterialTheme.colorScheme.onPrimaryContainer
        ),
        modifier = modifier
    )
}

package com.chainlesschain.android.feature.filebrowser.ui.components

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.chainlesschain.android.feature.filebrowser.R
import com.chainlesschain.android.feature.filebrowser.ai.FileSummarizer

/**
 * File Summary Card
 *
 * Displays AI-generated file summary with:
 * - Summary text
 * - Key points
 * - Statistics (word count, language)
 * - Expand/collapse
 * - Copy to clipboard
 * - Loading state
 *
 * @param summary Summary result (null = not generated yet)
 * @param isLoading Whether summary is being generated
 * @param onGenerate Callback to generate summary
 * @param onCopy Callback when summary is copied
 * @param modifier Modifier for customization
 */
@Composable
fun FileSummaryCard(
    summary: FileSummarizer.SummaryResult?,
    isLoading: Boolean,
    onGenerate: () -> Unit,
    onCopy: (() -> Unit)? = null,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    var expanded by remember { mutableStateOf(true) }

    Card(
        modifier = modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.secondaryContainer
        )
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            // Header
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        imageVector = Icons.Default.Summarize,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(24.dp)
                    )
                    Text(
                        text = stringResource(R.string.summary_title),
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onSecondaryContainer
                    )

                    // Method badge
                    summary?.let { result ->
                        SummaryMethodBadge(method = result.method)
                    }
                }

                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    // Copy button
                    if (summary != null && !isLoading) {
                        IconButton(
                            onClick = {
                                copyToClipboard(context, summary.summary)
                                onCopy?.invoke()
                            },
                            modifier = Modifier.size(32.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.ContentCopy,
                                contentDescription = stringResource(R.string.summary_copy),
                                modifier = Modifier.size(18.dp)
                            )
                        }
                    }

                    // Expand/Collapse button
                    if (summary != null && !isLoading) {
                        IconButton(
                            onClick = { expanded = !expanded },
                            modifier = Modifier.size(32.dp)
                        ) {
                            Icon(
                                imageVector = if (expanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
                                contentDescription = if (expanded) stringResource(R.string.summary_collapse) else stringResource(R.string.summary_expand),
                                modifier = Modifier.size(18.dp)
                            )
                        }
                    }
                }
            }

            // Content
            when {
                isLoading -> {
                    // Loading state
                    LoadingSummary()
                }

                summary == null -> {
                    // No summary generated
                    EmptySummary(onGenerate = onGenerate)
                }

                else -> {
                    // Summary content
                    AnimatedVisibility(
                        visible = expanded,
                        enter = fadeIn() + expandVertically(),
                        exit = fadeOut() + shrinkVertically()
                    ) {
                        SummaryContent(summary = summary)
                    }
                }
            }
        }
    }
}

/**
 * Summary Method Badge
 */
@Composable
private fun SummaryMethodBadge(method: FileSummarizer.SummarizationMethod) {
    val (icon, label, color) = when (method) {
        FileSummarizer.SummarizationMethod.LLM -> Triple(
            Icons.Default.Psychology,
            "AI",
            MaterialTheme.colorScheme.primary
        )
        FileSummarizer.SummarizationMethod.RULE_BASED -> Triple(
            Icons.Default.Rule,
            stringResource(R.string.summary_method_rule),
            MaterialTheme.colorScheme.tertiary
        )
        FileSummarizer.SummarizationMethod.STATISTICAL -> Triple(
            Icons.Default.Analytics,
            stringResource(R.string.summary_method_statistical),
            MaterialTheme.colorScheme.secondary
        )
        FileSummarizer.SummarizationMethod.HYBRID -> Triple(
            Icons.Default.AutoAwesome,
            stringResource(R.string.summary_method_hybrid),
            MaterialTheme.colorScheme.primary
        )
    }

    AssistChip(
        onClick = { },
        label = {
            Row(
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    imageVector = icon,
                    contentDescription = null,
                    modifier = Modifier.size(14.dp)
                )
                Text(
                    text = label,
                    style = MaterialTheme.typography.labelSmall
                )
            }
        },
        colors = AssistChipDefaults.assistChipColors(
            containerColor = color.copy(alpha = 0.2f),
            labelColor = color
        ),
        modifier = Modifier.height(24.dp)
    )
}

/**
 * Loading Summary State
 */
@Composable
private fun LoadingSummary() {
    Row(
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        CircularProgressIndicator(
            modifier = Modifier.size(24.dp),
            strokeWidth = 2.dp
        )
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                text = stringResource(R.string.summary_generating),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSecondaryContainer
            )
            Text(
                text = stringResource(R.string.summary_analyzing),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSecondaryContainer.copy(alpha = 0.7f)
            )
        }
    }
}

/**
 * Empty Summary State
 */
@Composable
private fun EmptySummary(onGenerate: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Icon(
            imageVector = Icons.Default.Description,
            contentDescription = null,
            modifier = Modifier.size(48.dp),
            tint = MaterialTheme.colorScheme.onSecondaryContainer.copy(alpha = 0.4f)
        )
        Text(
            text = stringResource(R.string.summary_empty),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSecondaryContainer.copy(alpha = 0.7f)
        )
        FilledTonalButton(
            onClick = onGenerate,
            colors = ButtonDefaults.filledTonalButtonColors(
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary
            )
        ) {
            Icon(
                imageVector = Icons.Default.AutoAwesome,
                contentDescription = null,
                modifier = Modifier.size(18.dp)
            )
            Spacer(modifier = Modifier.width(8.dp))
            Text(stringResource(R.string.summary_generate))
        }
    }
}

/**
 * Summary Content
 */
@Composable
private fun SummaryContent(summary: FileSummarizer.SummaryResult) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        // Summary text
        Surface(
            modifier = Modifier.fillMaxWidth(),
            shape = MaterialTheme.shapes.medium,
            color = MaterialTheme.colorScheme.surface.copy(alpha = 0.5f)
        ) {
            Text(
                text = summary.summary,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.padding(12.dp)
            )
        }

        // Key points
        if (summary.keyPoints.isNotEmpty()) {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    text = stringResource(R.string.summary_key_points),
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSecondaryContainer
                )

                summary.keyPoints.forEach { point ->
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.Top
                    ) {
                        Icon(
                            imageVector = Icons.Default.ChevronRight,
                            contentDescription = null,
                            modifier = Modifier.size(16.dp),
                            tint = MaterialTheme.colorScheme.primary
                        )
                        Text(
                            text = point,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSecondaryContainer
                        )
                    }
                }
            }
        }

        // Statistics
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            if (summary.wordCount > 0) {
                StatChip(
                    icon = Icons.Default.TextFields,
                    label = stringResource(R.string.summary_word_count, summary.wordCount)
                )
            }

            summary.language?.let { lang ->
                StatChip(
                    icon = Icons.Default.Language,
                    label = lang
                )
            }
        }
    }
}

/**
 * Stat Chip
 */
@Composable
private fun StatChip(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String
) {
    Surface(
        shape = MaterialTheme.shapes.small,
        color = MaterialTheme.colorScheme.surface.copy(alpha = 0.3f)
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
                tint = MaterialTheme.colorScheme.onSecondaryContainer.copy(alpha = 0.7f)
            )
            Text(
                text = label,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSecondaryContainer.copy(alpha = 0.7f)
            )
        }
    }
}

/**
 * Compact File Summary Badge
 *
 * Small badge for use in file list items
 */
@Composable
fun FileSummaryBadge(
    summary: FileSummarizer.SummaryResult?,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    if (summary == null) return

    AssistChip(
        onClick = onClick,
        label = {
            Row(
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    imageVector = Icons.Default.Summarize,
                    contentDescription = null,
                    modifier = Modifier.size(14.dp)
                )
                Text(
                    text = summary.summary.take(30) + if (summary.summary.length > 30) "..." else "",
                    style = MaterialTheme.typography.labelSmall
                )
            }
        },
        colors = AssistChipDefaults.assistChipColors(
            containerColor = MaterialTheme.colorScheme.secondaryContainer,
            labelColor = MaterialTheme.colorScheme.onSecondaryContainer
        ),
        modifier = modifier
    )
}

/**
 * Copy text to clipboard
 */
private fun copyToClipboard(context: Context, text: String) {
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return
    val clip = ClipData.newPlainText("File Summary", text)
    clipboard.setPrimaryClip(clip)
}

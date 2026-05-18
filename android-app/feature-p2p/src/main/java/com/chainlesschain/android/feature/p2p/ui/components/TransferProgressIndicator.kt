package com.chainlesschain.android.feature.p2p.ui.components

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.chainlesschain.android.core.p2p.filetransfer.model.TransferProgress

/**
 * 传输进度指示器
 */
@Composable
fun TransferProgressIndicator(
    progress: TransferProgress?,
    modifier: Modifier = Modifier,
    showDetails: Boolean = true
) {
    val progressPercent = progress?.getProgressPercent() ?: 0f
    val animatedProgress by animateFloatAsState(
        targetValue = progressPercent / 100f,
        animationSpec = tween(durationMillis = 300),
        label = "progress"
    )

    Column(modifier = modifier) {
        // Progress bar
        LinearProgressIndicator(
            progress = { animatedProgress },
            modifier = Modifier
                .fillMaxWidth()
                .height(8.dp),
            strokeCap = StrokeCap.Round,
            trackColor = MaterialTheme.colorScheme.surfaceVariant,
            color = MaterialTheme.colorScheme.primary
        )

        if (showDetails && progress != null) {
            Spacer(modifier = Modifier.height(4.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                // Progress percentage and size
                Text(
                    text = "${String.format("%.1f", progressPercent)}% • ${progress.getReadableBytesTransferred()} / ${progress.getReadableTotalBytes()}",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )

                // Speed and ETA
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    if (progress.speedBytesPerSecond > 0) {
                        Text(
                            text = progress.getReadableSpeed(),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.primary
                        )
                    }

                    val eta = progress.getReadableEta()
                    if (eta != "--") {
                        Text(
                            text = eta,
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }
        }
    }
}

/**
 * 圆形进度指示器
 */
@Composable
fun CircularTransferProgress(
    progress: TransferProgress?,
    modifier: Modifier = Modifier,
    size: Int = 48
) {
    val progressPercent = progress?.getProgressPercent() ?: 0f
    val animatedProgress by animateFloatAsState(
        targetValue = progressPercent / 100f,
        animationSpec = tween(durationMillis = 300),
        label = "circular_progress"
    )

    Box(
        modifier = modifier.size(size.dp),
        contentAlignment = Alignment.Center
    ) {
        CircularProgressIndicator(
            progress = { animatedProgress },
            modifier = Modifier.fillMaxSize(),
            strokeCap = StrokeCap.Round,
            trackColor = MaterialTheme.colorScheme.surfaceVariant,
            color = MaterialTheme.colorScheme.primary
        )

        Text(
            text = "${progressPercent.toInt()}%",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurface
        )
    }
}

/**
 * 紧凑的进度文本
 */
@Composable
fun CompactProgressText(
    progress: TransferProgress?,
    modifier: Modifier = Modifier
) {
    if (progress == null) return

    Text(
        text = "${String.format("%.0f", progress.getProgressPercent())}% • ${progress.getReadableSpeed()}",
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = modifier,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis
    )
}

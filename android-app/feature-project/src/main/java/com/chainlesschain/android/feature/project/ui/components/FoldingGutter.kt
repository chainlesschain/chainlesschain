package com.chainlesschain.android.feature.project.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowRight
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

/**
 * 代码折叠侧边栏
 *
 * 显示可折叠区域的展开/折叠图标
 */
@Composable
fun FoldingGutter(
    foldableRegions: List<FoldableRegion>,
    foldedRegions: Set<IntRange>,
    lineHeight: Float,
    scrollY: Float,
    onToggleFold: (FoldableRegion) -> Unit,
    modifier: Modifier = Modifier
) {
    val density = LocalDensity.current.density
    val iconColor = MaterialTheme.colorScheme.onSurfaceVariant
    val lineColor = MaterialTheme.colorScheme.outline.copy(alpha = 0.3f)

    Box(
        modifier = modifier
            .width(24.dp)
            .fillMaxHeight()
    ) {
        // Draw folding lines
        Canvas(modifier = Modifier.fillMaxSize()) {
            foldableRegions.forEach { region ->
                val isFolded = (region.startLine..region.endLine) in foldedRegions
                drawFoldingLine(
                    region = region,
                    isFolded = isFolded,
                    lineHeight = lineHeight,
                    scrollY = scrollY,
                    lineColor = lineColor
                )
            }
        }

        // Draw folding icons
        foldableRegions.forEach { region ->
            val isFolded = (region.startLine..region.endLine) in foldedRegions
            val y = region.startLine * lineHeight - scrollY

            Box(
                modifier = Modifier
                    .offset(x = 0.dp, y = (y / density).dp)
                    .size(24.dp)
                    .clickable { onToggleFold(region) },
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = if (isFolded) {
                        Icons.Default.KeyboardArrowRight
                    } else {
                        Icons.Default.KeyboardArrowDown
                    },
                    contentDescription = if (isFolded) "Expand" else "Collapse",
                    tint = iconColor,
                    modifier = Modifier.size(16.dp)
                )
            }
        }
    }
}

/**
 * 绘制折叠区域的垂直连接线
 */
private fun DrawScope.drawFoldingLine(
    region: FoldableRegion,
    isFolded: Boolean,
    lineHeight: Float,
    scrollY: Float,
    lineColor: Color
) {
    val startY = region.startLine * lineHeight - scrollY + lineHeight / 2
    val endY = if (isFolded) {
        // Folded: short line to the icon
        startY + lineHeight / 4
    } else {
        // Unfolded: line to end of region
        region.endLine * lineHeight - scrollY + lineHeight / 2
    }

    // Vertical line
    drawLine(
        color = lineColor,
        start = Offset(size.width / 2, startY),
        end = Offset(size.width / 2, endY),
        strokeWidth = 1.dp.toPx()
    )

    // Horizontal line to content
    if (!isFolded) {
        drawLine(
            color = lineColor,
            start = Offset(size.width / 2, endY),
            end = Offset(size.width, endY),
            strokeWidth = 1.dp.toPx()
        )
    }
}

/**
 * 折叠指示器（显示在折叠行）
 *
 * 用于在编辑器中显示"..."表示折叠内容
 */
@Composable
fun FoldedRegionIndicator(
    region: FoldableRegion,
    lineHeight: Float,
    scrollY: Float,
    modifier: Modifier = Modifier
) {
    val density = LocalDensity.current.density
    val y = region.startLine * lineHeight - scrollY
    val textColor = MaterialTheme.colorScheme.onSurfaceVariant
    val backgroundColor = MaterialTheme.colorScheme.surfaceVariant

    Box(
        modifier = modifier
            .offset(x = 0.dp, y = (y / density).dp)
            .height((lineHeight / density).dp)
            .padding(start = 48.dp) // After line numbers
    ) {
        Canvas(modifier = Modifier.fillMaxSize()) {
            // Draw background
            drawRect(
                color = backgroundColor,
                topLeft = Offset(0f, 0f),
                size = androidx.compose.ui.geometry.Size(size.width, lineHeight)
            )

            // Draw "..." text
            // Note: In actual implementation, you'd use TextMeasurer here
            // For now, this is a placeholder showing the concept
        }
    }
}

/**
 * 折叠区域预览
 *
 * 显示折叠区域的摘要信息（如函数签名、类名等）
 */
@Composable
fun FoldedRegionPreview(
    region: FoldableRegion,
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier
            .padding(start = 8.dp, end = 8.dp)
            .height(24.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        // Type indicator
        val typeColor = when (region.type) {
            FoldableRegionType.FUNCTION -> MaterialTheme.colorScheme.primary
            FoldableRegionType.CLASS -> MaterialTheme.colorScheme.secondary
            FoldableRegionType.COMMENT -> MaterialTheme.colorScheme.tertiary
            FoldableRegionType.IMPORT -> MaterialTheme.colorScheme.primaryContainer
            FoldableRegionType.CONTROL_FLOW -> MaterialTheme.colorScheme.secondaryContainer
        }

        Box(
            modifier = Modifier
                .size(6.dp)
                .background(typeColor, shape = CircleShape)
        )

        // Preview text (truncated)
        Text(
            text = region.preview.take(50),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )

        Text(
            text = "...",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f)
        )

        // Line count badge
        Text(
            text = "${region.endLine - region.startLine + 1} lines",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
            modifier = Modifier
                .background(
                    MaterialTheme.colorScheme.surfaceVariant,
                    shape = RoundedCornerShape(4.dp)
                )
                .padding(horizontal = 4.dp, vertical = 2.dp)
        )
    }
}
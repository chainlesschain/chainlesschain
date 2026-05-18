package com.chainlesschain.android.feature.project.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp

/**
 * 行号侧边栏组件
 *
 * 显示代码行号，高亮当前行
 */
@Composable
fun LineNumberGutter(
    lineCount: Int,
    currentLine: Int,
    lineHeight: Float,
    scrollY: Float,
    modifier: Modifier = Modifier
) {
    val textMeasurer = rememberTextMeasurer()
    val textStyle = MaterialTheme.typography.bodySmall.copy(
        color = MaterialTheme.colorScheme.onSurfaceVariant
    )
    val currentLineColor = MaterialTheme.colorScheme.primary
    val backgroundColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f)

    Box(
        modifier = modifier
            .width(48.dp)
            .fillMaxHeight()
            .background(backgroundColor)
    ) {
        Canvas(modifier = Modifier.fillMaxSize()) {
            val visibleStartLine = (scrollY / lineHeight).toInt().coerceAtLeast(0)
            val visibleEndLine = ((scrollY + size.height) / lineHeight).toInt()
                .coerceAtMost(lineCount - 1)

            for (line in visibleStartLine..visibleEndLine) {
                val lineNumber = (line + 1).toString()
                val y = line * lineHeight - scrollY + lineHeight * 0.7f

                // 测量文本
                val textLayoutResult = textMeasurer.measure(
                    text = lineNumber,
                    style = if (line + 1 == currentLine) {
                        textStyle.copy(color = currentLineColor)
                    } else {
                        textStyle
                    }
                )

                // 右对齐行号
                val x = size.width - textLayoutResult.size.width - 8.dp.toPx()

                // 绘制行号
                drawText(
                    textLayoutResult = textLayoutResult,
                    topLeft = Offset(x, y)
                )
            }
        }
    }
}

/**
 * 缩进参考线组件
 *
 * 显示垂直缩进线辅助代码对齐
 */
@Composable
fun IndentGuide(
    content: String,
    lineHeight: Float,
    charWidth: Float,
    scrollY: Float,
    tabSize: Int = 4,
    modifier: Modifier = Modifier
) {
    val guideColor = MaterialTheme.colorScheme.outline.copy(alpha = 0.2f)

    Canvas(modifier = modifier.fillMaxSize()) {
        val lines = content.lines()
        val visibleStartLine = (scrollY / lineHeight).toInt().coerceAtLeast(0)
        val visibleEndLine = ((scrollY + size.height) / lineHeight).toInt()
            .coerceAtMost(lines.size - 1)

        for (line in visibleStartLine..visibleEndLine) {
            if (line >= lines.size) break

            val lineText = lines[line]
            val indentLevel = calculateIndentLevel(lineText, tabSize)

            val y = line * lineHeight - scrollY

            // 绘制每个缩进级别的垂直线
            for (level in 1..indentLevel) {
                val x = level * tabSize * charWidth

                drawLine(
                    color = guideColor,
                    start = Offset(x, y),
                    end = Offset(x, y + lineHeight),
                    strokeWidth = 1.dp.toPx()
                )
            }
        }
    }
}

/**
 * 计算缩进级别
 */
private fun calculateIndentLevel(line: String, tabSize: Int): Int {
    var spaces = 0
    for (char in line) {
        when (char) {
            ' ' -> spaces++
            '\t' -> spaces += tabSize
            else -> break
        }
    }
    return spaces / tabSize
}

/**
 * 当前行高亮背景
 */
@Composable
fun CurrentLineHighlight(
    currentLine: Int,
    lineHeight: Float,
    scrollY: Float,
    modifier: Modifier = Modifier
) {
    val highlightColor = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.1f)

    Canvas(modifier = modifier.fillMaxSize()) {
        val y = (currentLine - 1) * lineHeight - scrollY

        drawRect(
            color = highlightColor,
            topLeft = Offset(0f, y),
            size = androidx.compose.ui.geometry.Size(size.width, lineHeight)
        )
    }
}

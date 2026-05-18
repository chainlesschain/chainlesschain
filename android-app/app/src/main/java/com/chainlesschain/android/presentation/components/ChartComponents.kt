package com.chainlesschain.android.presentation.components

import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlin.math.cos
import kotlin.math.sin

/**
 * 圆形进度条（增强版）
 */
@Composable
fun CircularProgress(
    progress: Float,
    modifier: Modifier = Modifier,
    size: Dp = 120.dp,
    strokeWidth: Dp = 12.dp,
    animationDuration: Int = 1000,
    showPercentage: Boolean = true
) {
    var animatedProgress by remember { mutableStateOf(0f) }

    LaunchedEffect(progress) {
        animate(
            initialValue = animatedProgress,
            targetValue = progress,
            animationSpec = tween(
                durationMillis = animationDuration,
                easing = FastOutSlowInEasing
            )
        ) { value, _ ->
            animatedProgress = value
        }
    }

    Box(
        modifier = modifier.size(size),
        contentAlignment = Alignment.Center
    ) {
        Canvas(modifier = Modifier.fillMaxSize()) {
            val canvasSize = this.size.minDimension
            val radius = canvasSize / 2 - strokeWidth.toPx() / 2

            // 背景圆
            drawCircle(
                color = Color.LightGray.copy(alpha = 0.2f),
                radius = radius,
                style = Stroke(width = strokeWidth.toPx())
            )

            // 进度圆弧
            drawArc(
                brush = Brush.sweepGradient(
                    colors = listOf(
                        Color(0xFF4CAF50),
                        Color(0xFF2196F3),
                        Color(0xFF9C27B0)
                    )
                ),
                startAngle = -90f,
                sweepAngle = 360f * animatedProgress,
                useCenter = false,
                style = Stroke(
                    width = strokeWidth.toPx(),
                    cap = StrokeCap.Round
                )
            )
        }

        // 显示百分比
        if (showPercentage) {
            Text(
                text = "${(animatedProgress * 100).toInt()}%",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.primary
            )
        }
    }
}

/**
 * 知识库统计图表
 */
@Composable
fun KnowledgeStatsChart(
    totalItems: Int,
    categories: List<Pair<String, Int>>,
    modifier: Modifier = Modifier
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant
        )
    ) {
        Column(
            modifier = Modifier.padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // 标题
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "知识库统计",
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold
                )

                Surface(
                    shape = CircleShape,
                    color = MaterialTheme.colorScheme.primaryContainer
                ) {
                    Box(
                        modifier = Modifier.padding(8.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = "$totalItems",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.onPrimaryContainer
                        )
                    }
                }
            }

            // 饼图
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(24.dp)
            ) {
                // 饼图
                PieChart(
                    data = categories,
                    modifier = Modifier.size(140.dp)
                )

                // 图例
                Column(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    categories.forEachIndexed { index, (category, count) ->
                        ChartLegendItem(
                            color = getPieChartColor(index),
                            label = category,
                            value = count,
                            percentage = if (totalItems > 0) count.toFloat() / totalItems else 0f
                        )
                    }
                }
            }
        }
    }
}

/**
 * 饼图组件
 */
@Composable
fun PieChart(
    data: List<Pair<String, Int>>,
    modifier: Modifier = Modifier
) {
    val total = data.sumOf { it.second }
    var startAngle = 0f

    Canvas(modifier = modifier) {
        val canvasSize = size.minDimension
        val radius = canvasSize / 2

        data.forEachIndexed { index, (_, value) ->
            val sweepAngle = if (total > 0) 360f * value / total else 0f

            drawArc(
                color = getPieChartColor(index),
                startAngle = startAngle,
                sweepAngle = sweepAngle,
                useCenter = true,
                topLeft = Offset.Zero,
                size = Size(canvasSize, canvasSize)
            )

            startAngle += sweepAngle
        }

        // 中心白色圆
        drawCircle(
            color = Color.White,
            radius = radius * 0.5f
        )
    }
}

/**
 * 图例项
 */
@Composable
fun ChartLegendItem(
    color: Color,
    label: String,
    value: Int,
    percentage: Float
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier
                .size(12.dp)
                .clip(CircleShape)
                .background(color)
        )

        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = label,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium
            )
            Text(
                text = "$value 项 (${(percentage * 100).toInt()}%)",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

/**
 * 柱状图组件
 */
@Composable
fun BarChart(
    data: List<Pair<String, Int>>,
    modifier: Modifier = Modifier,
    maxValue: Int = data.maxOfOrNull { it.second } ?: 1
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp)
    ) {
        Column(
            modifier = Modifier.padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Text(
                text = "活动统计",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold
            )

            Column(
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                data.forEach { (label, value) ->
                    BarChartItem(
                        label = label,
                        value = value,
                        maxValue = maxValue
                    )
                }
            }
        }
    }
}

/**
 * 柱状图项
 */
@Composable
fun BarChartItem(
    label: String,
    value: Int,
    maxValue: Int
) {
    val progress = if (maxValue > 0) value.toFloat() / maxValue else 0f

    var animatedProgress by remember { mutableStateOf(0f) }

    LaunchedEffect(progress) {
        animate(
            initialValue = 0f,
            targetValue = progress,
            animationSpec = tween(
                durationMillis = 800,
                easing = FastOutSlowInEasing
            )
        ) { value, _ ->
            animatedProgress = value
        }
    }

    Column(
        verticalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text(
                text = label,
                style = MaterialTheme.typography.bodyMedium
            )
            Text(
                text = value.toString(),
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.primary
            )
        }

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(8.dp)
                .clip(RoundedCornerShape(4.dp))
                .background(MaterialTheme.colorScheme.surfaceVariant)
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth(animatedProgress)
                    .fillMaxHeight()
                    .clip(RoundedCornerShape(4.dp))
                    .background(
                        brush = Brush.horizontalGradient(
                            colors = listOf(
                                MaterialTheme.colorScheme.primary,
                                MaterialTheme.colorScheme.tertiary
                            )
                        )
                    )
            )
        }
    }
}

/**
 * 折线图组件
 */
@Composable
fun LineChart(
    data: List<Float>,
    labels: List<String>,
    modifier: Modifier = Modifier
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp)
    ) {
        Column(
            modifier = Modifier.padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Text(
                text = "趋势分析",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold
            )

            val maxValue = data.maxOrNull() ?: 1f

            Canvas(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(180.dp)
            ) {
                val width = size.width
                val height = size.height
                val spacing = width / (data.size - 1)

                // 绘制网格线
                for (i in 0..4) {
                    val y = height * i / 4
                    drawLine(
                        color = Color.LightGray.copy(alpha = 0.3f),
                        start = Offset(0f, y),
                        end = Offset(width, y),
                        strokeWidth = 1.dp.toPx()
                    )
                }

                // 绘制折线
                val path = Path()
                data.forEachIndexed { index, value ->
                    val x = index * spacing
                    val y = height - (value / maxValue * height)

                    if (index == 0) {
                        path.moveTo(x, y)
                    } else {
                        path.lineTo(x, y)
                    }

                    // 绘制数据点
                    drawCircle(
                        color = Color(0xFF2196F3),
                        radius = 6.dp.toPx(),
                        center = Offset(x, y)
                    )
                }

                drawPath(
                    path = path,
                    color = Color(0xFF2196F3),
                    style = Stroke(
                        width = 3.dp.toPx(),
                        cap = StrokeCap.Round,
                        join = StrokeJoin.Round
                    )
                )
            }

            // 标签
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                labels.forEach { label ->
                    Text(
                        text = label,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        }
    }
}

/**
 * 雷达图组件
 */
@Composable
fun RadarChart(
    data: List<Pair<String, Float>>,
    modifier: Modifier = Modifier
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp)
    ) {
        Column(
            modifier = Modifier.padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Text(
                text = "能力分析",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold
            )

            Canvas(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(240.dp)
            ) {
                val centerX = size.width / 2
                val centerY = size.height / 2
                val radius = size.minDimension / 2 * 0.8f
                val angleStep = 360f / data.size

                // 绘制背景多边形
                for (level in 1..5) {
                    val levelRadius = radius * level / 5
                    val path = Path()

                    data.forEachIndexed { index, _ ->
                        val angle = Math.toRadians((angleStep * index - 90).toDouble())
                        val x = centerX + levelRadius * cos(angle).toFloat()
                        val y = centerY + levelRadius * sin(angle).toFloat()

                        if (index == 0) {
                            path.moveTo(x, y)
                        } else {
                            path.lineTo(x, y)
                        }
                    }
                    path.close()

                    drawPath(
                        path = path,
                        color = Color.LightGray.copy(alpha = 0.2f),
                        style = Stroke(width = 1.dp.toPx())
                    )
                }

                // 绘制数据区域
                val dataPath = Path()
                data.forEachIndexed { index, (_, value) ->
                    val angle = Math.toRadians((angleStep * index - 90).toDouble())
                    val distance = radius * value
                    val x = centerX + distance * cos(angle).toFloat()
                    val y = centerY + distance * sin(angle).toFloat()

                    if (index == 0) {
                        dataPath.moveTo(x, y)
                    } else {
                        dataPath.lineTo(x, y)
                    }
                }
                dataPath.close()

                // 填充数据区域
                drawPath(
                    path = dataPath,
                    color = Color(0xFF2196F3).copy(alpha = 0.3f)
                )

                // 绘制数据轮廓
                drawPath(
                    path = dataPath,
                    color = Color(0xFF2196F3),
                    style = Stroke(width = 2.dp.toPx())
                )

                // 绘制数据点
                data.forEachIndexed { index, (_, value) ->
                    val angle = Math.toRadians((angleStep * index - 90).toDouble())
                    val distance = radius * value
                    val x = centerX + distance * cos(angle).toFloat()
                    val y = centerY + distance * sin(angle).toFloat()

                    drawCircle(
                        color = Color(0xFF2196F3),
                        radius = 6.dp.toPx(),
                        center = Offset(x, y)
                    )
                }
            }

            // 图例
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceEvenly
            ) {
                data.forEach { (label, value) ->
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Text(
                            text = label,
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Text(
                            text = "${(value * 100).toInt()}%",
                            style = MaterialTheme.typography.labelMedium,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.primary
                        )
                    }
                }
            }
        }
    }
}

// 辅助函数：获取饼图颜色
fun getPieChartColor(index: Int): Color {
    val colors = listOf(
        Color(0xFF2196F3), // Blue
        Color(0xFF4CAF50), // Green
        Color(0xFFFFC107), // Amber
        Color(0xFFE91E63), // Pink
        Color(0xFF9C27B0), // Purple
        Color(0xFFFF5722), // Deep Orange
        Color(0xFF00BCD4), // Cyan
        Color(0xFF8BC34A)  // Light Green
    )
    return colors[index % colors.size]
}

package com.chainlesschain.android.presentation.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.chainlesschain.android.R
import com.chainlesschain.android.feature.project.domain.*

/**
 * 时间线颜色配置
 */
object TimelineColors {
    val Primary = Color(0xFF2196F3)
    val PrimaryLight = Color(0xFFBBDEFB)
    val DotActive = Color(0xFF2196F3)
    val DotInactive = Color(0xFFBDBDBD)
    val LineColor = Color(0xFF2196F3)
    val TerminalBg = Color(0xFF1E1E1E)
    val TerminalText = Color(0xFF4EC9B0)
    val CodeKeyword = Color(0xFF569CD6)
    val CodeString = Color(0xFFCE9178)
    val CodeComment = Color(0xFF6A9955)
}

/**
 * 竖直时间线容器
 * 用于包裹多个步骤项，绘制左侧的竖直虚线
 */
@Composable
fun VerticalTimeline(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit
) {
    Row(modifier = modifier.fillMaxWidth()) {
        // 左侧时间线区域
        Box(
            modifier = Modifier
                .width(40.dp)
                .fillMaxHeight()
        )

        // 内容区域
        Column(
            modifier = Modifier
                .weight(1f)
                .padding(end = 16.dp),
            verticalArrangement = Arrangement.spacedBy(0.dp),
            content = content
        )
    }
}

/**
 * 时间线步骤项
 * 包含左侧的圆点和虚线，以及右侧的内容卡片
 */
@Composable
fun TimelineStepItem(
    step: ExecutionStep,
    isFirst: Boolean = false,
    isLast: Boolean = false,
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.Start
    ) {
        // 左侧时间线指示器
        TimelineIndicator(
            isFirst = isFirst,
            isLast = isLast,
            modifier = Modifier.padding(end = 12.dp)
        )

        // 右侧内容
        Column(
            modifier = Modifier
                .weight(1f)
                .padding(bottom = 24.dp)
        ) {
            // 步骤标题行
            StepTitleRow(step = step)

            Spacer(modifier = Modifier.height(8.dp))

            // 步骤内容
            StepContentCard(step = step)
        }
    }
}

/**
 * 时间线指示器 - 圆点和虚线
 */
@Composable
fun TimelineIndicator(
    isFirst: Boolean = false,
    isLast: Boolean = false,
    dotSize: Dp = 12.dp,
    modifier: Modifier = Modifier
) {
    Box(
        modifier = modifier
            .width(40.dp)
            .fillMaxHeight(),
        contentAlignment = Alignment.TopCenter
    ) {
        // 绘制虚线
        Canvas(
            modifier = Modifier
                .width(2.dp)
                .fillMaxHeight()
        ) {
            val pathEffect = PathEffect.dashPathEffect(floatArrayOf(8f, 8f), 0f)

            // 上半部分虚线（如果不是第一个）
            if (!isFirst) {
                drawLine(
                    color = TimelineColors.LineColor,
                    start = Offset(size.width / 2, 0f),
                    end = Offset(size.width / 2, 6.dp.toPx()),
                    strokeWidth = 2.dp.toPx(),
                    pathEffect = pathEffect
                )
            }

            // 下半部分虚线（如果不是最后一个）
            if (!isLast) {
                drawLine(
                    color = TimelineColors.LineColor,
                    start = Offset(size.width / 2, (6.dp + dotSize).toPx()),
                    end = Offset(size.width / 2, size.height),
                    strokeWidth = 2.dp.toPx(),
                    pathEffect = pathEffect
                )
            }
        }

        // 圆点
        Box(
            modifier = Modifier
                .padding(top = 6.dp)
                .size(dotSize)
                .clip(CircleShape)
                .background(TimelineColors.DotActive)
        )
    }
}

/**
 * 步骤标题行
 */
@Composable
fun StepTitleRow(step: ExecutionStep) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        // 步骤图标
        Icon(
            imageVector = getStepIcon(step.type),
            contentDescription = null,
            modifier = Modifier.size(20.dp),
            tint = MaterialTheme.colorScheme.primary
        )

        // 步骤标题
        Text(
            text = step.title,
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onSurface
        )
    }
}

/**
 * 步骤内容卡片 - 根据步骤类型渲染不同内容
 */
@Composable
fun StepContentCard(step: ExecutionStep) {
    when (step.type) {
        StepType.USER_MESSAGE -> UserMessageContent(step)
        StepType.FILE_READ -> FileReadContent(step)
        StepType.AI_MESSAGE -> AIMessageContent(step)
        StepType.TERMINAL -> TerminalContent(step)
        StepType.WEB_BROWSE -> WebBrowseContent(step)
        StepType.CODE_EXECUTE -> CodeExecuteContent(step)
    }
}

/**
 * 用户消息内容
 */
@Composable
fun UserMessageContent(step: ExecutionStep) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        // 如果有图片
        step.imageUrl?.let { imageUrl ->
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(120.dp),
                shape = RoundedCornerShape(12.dp),
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.surfaceVariant
                )
            ) {
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    // 占位图标（实际应用中使用 AsyncImage 加载图片）
                    Icon(
                        imageVector = Icons.Default.Image,
                        contentDescription = null,
                        modifier = Modifier.size(48.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
                    )
                }
            }
        }

        // 文本内容
        step.content?.let { content ->
            Text(
                text = content,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

/**
 * 文件读取内容
 */
@Composable
fun FileReadContent(step: ExecutionStep) {
    step.fileData?.let { fileData ->
        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
            colors = CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.surfaceVariant
            )
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(12.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                // 文件图标
                Box(
                    modifier = Modifier
                        .size(40.dp)
                        .clip(RoundedCornerShape(8.dp))
                        .background(MaterialTheme.colorScheme.primaryContainer),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = getFileTypeIcon(fileData.fileType),
                        contentDescription = null,
                        modifier = Modifier.size(24.dp),
                        tint = MaterialTheme.colorScheme.primary
                    )
                }

                // 文件名
                Text(
                    text = fileData.fileName,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Medium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }
    }
}

/**
 * AI消息内容
 */
@Composable
fun AIMessageContent(step: ExecutionStep) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        step.content?.let { content ->
            Text(
                text = content,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurface,
                lineHeight = MaterialTheme.typography.bodyMedium.lineHeight * 1.5f
            )
        }

        // 如果有代码块
        step.codeBlock?.let { codeBlock ->
            CodeBlockCard(codeBlock = codeBlock)
        }
    }
}

/**
 * 终端内容
 */
@Composable
fun TerminalContent(step: ExecutionStep) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        step.content?.let { content ->
            Text(
                text = content,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }

        step.terminalOutput?.let { terminal ->
            TerminalCard(terminal = terminal)
        }
    }
}

/**
 * 网页浏览内容
 */
@Composable
fun WebBrowseContent(step: ExecutionStep) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = Icons.Default.Language,
                contentDescription = null,
                modifier = Modifier.size(24.dp),
                tint = MaterialTheme.colorScheme.primary
            )

            Column {
                Text(
                    text = step.title,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Medium
                )
                step.content?.let {
                    Text(
                        text = it,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
            }
        }
    }
}

/**
 * 代码执行内容
 */
@Composable
fun CodeExecuteContent(step: ExecutionStep) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        step.codeBlock?.let { codeBlock ->
            CodeBlockCard(codeBlock = codeBlock)
        }

        step.terminalOutput?.let { terminal ->
            TerminalCard(terminal = terminal)
        }
    }
}

/**
 * 代码块卡片
 */
@Composable
fun CodeBlockCard(codeBlock: CodeBlockData) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = TimelineColors.TerminalBg
        )
    ) {
        Column {
            // 头部 - 语言和复制按钮
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color(0xFF2D2D2D))
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = codeBlock.language,
                    style = MaterialTheme.typography.labelSmall,
                    color = Color.White.copy(alpha = 0.7f)
                )

                Icon(
                    imageVector = Icons.Default.ContentCopy,
                    contentDescription = stringResource(R.string.common_copy_code),
                    modifier = Modifier.size(16.dp),
                    tint = Color.White.copy(alpha = 0.7f)
                )
            }

            // 代码内容
            Text(
                text = codeBlock.code,
                style = MaterialTheme.typography.bodySmall.copy(
                    fontFamily = FontFamily.Monospace
                ),
                color = TimelineColors.TerminalText,
                modifier = Modifier.padding(12.dp)
            )
        }
    }
}

/**
 * 终端卡片
 */
@Composable
fun TerminalCard(terminal: TerminalOutputData) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = TimelineColors.TerminalBg
        )
    ) {
        Column {
            // 头部 - 显示命令提示符
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color(0xFF2D2D2D))
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "$",
                        style = MaterialTheme.typography.labelMedium,
                        color = TimelineColors.CodeKeyword,
                        fontFamily = FontFamily.Monospace
                    )
                    Text(
                        text = terminal.language,
                        style = MaterialTheme.typography.labelSmall,
                        color = Color.White.copy(alpha = 0.7f)
                    )
                }

                Icon(
                    imageVector = Icons.Default.OpenInNew,
                    contentDescription = stringResource(R.string.common_expand),
                    modifier = Modifier.size(16.dp),
                    tint = Color.White.copy(alpha = 0.7f)
                )
            }

            // 命令和输出
            Column(modifier = Modifier.padding(12.dp)) {
                // 命令
                Row {
                    Text(
                        text = "$ ",
                        style = MaterialTheme.typography.bodySmall.copy(
                            fontFamily = FontFamily.Monospace
                        ),
                        color = TimelineColors.CodeKeyword
                    )
                    Text(
                        text = terminal.command,
                        style = MaterialTheme.typography.bodySmall.copy(
                            fontFamily = FontFamily.Monospace
                        ),
                        color = Color.White
                    )
                }

                Spacer(modifier = Modifier.height(8.dp))

                // 输出
                Text(
                    text = terminal.output,
                    style = MaterialTheme.typography.bodySmall.copy(
                        fontFamily = FontFamily.Monospace
                    ),
                    color = if (terminal.isError) Color(0xFFFF6B6B) else TimelineColors.TerminalText
                )
            }
        }
    }
}

/**
 * 获取步骤类型对应的图标
 */
fun getStepIcon(type: StepType): ImageVector {
    return when (type) {
        StepType.USER_MESSAGE -> Icons.Default.Person
        StepType.FILE_READ -> Icons.Default.Folder
        StepType.AI_MESSAGE -> Icons.Default.SmartToy
        StepType.TERMINAL -> Icons.Default.Terminal
        StepType.WEB_BROWSE -> Icons.Default.Language
        StepType.CODE_EXECUTE -> Icons.Default.Code
    }
}

/**
 * 获取文件类型对应的图标
 */
fun getFileTypeIcon(type: FileType): ImageVector {
    return when (type) {
        FileType.DOCUMENT -> Icons.Default.Description
        FileType.CODE -> Icons.Default.Code
        FileType.IMAGE -> Icons.Default.Image
        FileType.VIDEO -> Icons.Default.VideoLibrary
        FileType.AUDIO -> Icons.Default.AudioFile
        FileType.OTHER -> Icons.Default.InsertDriveFile
    }
}

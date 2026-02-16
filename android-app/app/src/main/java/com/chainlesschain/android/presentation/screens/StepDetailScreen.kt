package com.chainlesschain.android.presentation.screens

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.res.stringResource
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.R
import com.chainlesschain.android.core.database.entity.ProjectChatMessageEntity
import com.chainlesschain.android.core.database.entity.ProjectChatRole
import com.chainlesschain.android.feature.project.model.ProjectDetailState
import com.chainlesschain.android.feature.project.viewmodel.ProjectViewModel
import com.chainlesschain.android.presentation.components.TimelineColors
import java.text.SimpleDateFormat
import java.util.*

/**
 * 步骤详情页 - 时间线布局
 * 参考: 扣子空间移动端"查看所有步骤详情页"设计
 * 对接实际数据接口
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StepDetailScreen(
    projectId: String,
    onNavigateBack: () -> Unit = {},
    viewModel: ProjectViewModel = hiltViewModel()
) {
    // 加载项目详情（如果还没有加载）
    LaunchedEffect(projectId) {
        viewModel.loadProjectDetail(projectId)
    }

    // 收集状态
    val projectDetailState by viewModel.projectDetailState.collectAsState()
    val chatMessages by viewModel.chatMessages.collectAsState()

    // 获取项目标题
    val projectTitle = when (val state = projectDetailState) {
        is ProjectDetailState.Success -> state.project.name
        else -> "步骤"
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = "步骤",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Medium
                    )
                },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = stringResource(R.string.common_back))
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface
                )
            )
        }
    ) { paddingValues ->
        when (projectDetailState) {
            is ProjectDetailState.Loading -> {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(paddingValues),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator()
                }
            }

            is ProjectDetailState.Error -> {
                val state = projectDetailState as ProjectDetailState.Error
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(paddingValues),
                    contentAlignment = Alignment.Center
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(
                            Icons.Default.Error,
                            contentDescription = null,
                            modifier = Modifier.size(48.dp),
                            tint = MaterialTheme.colorScheme.error
                        )
                        Spacer(modifier = Modifier.height(16.dp))
                        Text(
                            text = state.message,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.error
                        )
                    }
                }
            }

            is ProjectDetailState.Success -> {
                if (chatMessages.isEmpty()) {
                    // 空状态
                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(paddingValues),
                        contentAlignment = Alignment.Center
                    ) {
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(16.dp)
                        ) {
                            Icon(
                                Icons.Default.Timeline,
                                contentDescription = null,
                                modifier = Modifier.size(64.dp),
                                tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.3f)
                            )
                            Text(
                                text = "暂无执行步骤",
                                style = MaterialTheme.typography.titleMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                            Text(
                                text = "与 AI 对话后会在这里显示执行步骤",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f)
                            )
                        }
                    }
                } else {
                    LazyColumn(
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(paddingValues),
                        contentPadding = PaddingValues(start = 0.dp, end = 16.dp, top = 16.dp, bottom = 32.dp)
                    ) {
                        itemsIndexed(chatMessages) { index, message ->
                            MessageTimelineItem(
                                message = message,
                                isFirst = index == 0,
                                isLast = index == chatMessages.size - 1
                            )
                        }
                    }
                }
            }
        }
    }
}

/**
 * 消息时间线项
 */
@Composable
fun MessageTimelineItem(
    message: ProjectChatMessageEntity,
    isFirst: Boolean,
    isLast: Boolean
) {
    Row(
        modifier = Modifier.fillMaxWidth()
    ) {
        // 左侧时间线
        MessageTimelineIndicator(
            isFirst = isFirst,
            isLast = isLast,
            role = message.role
        )

        // 右侧内容
        Column(
            modifier = Modifier
                .weight(1f)
                .padding(start = 12.dp, bottom = if (isLast) 0.dp else 24.dp)
        ) {
            // 步骤标题
            MessageStepHeader(message = message)

            Spacer(modifier = Modifier.height(12.dp))

            // 步骤内容
            MessageStepContent(message = message)
        }
    }
}

/**
 * 时间线指示器
 */
@Composable
fun MessageTimelineIndicator(
    isFirst: Boolean,
    isLast: Boolean,
    role: String
) {
    val dotColor = when (role) {
        ProjectChatRole.USER -> MaterialTheme.colorScheme.primary
        ProjectChatRole.ASSISTANT -> MaterialTheme.colorScheme.tertiary
        else -> MaterialTheme.colorScheme.outline
    }

    Box(
        modifier = Modifier
            .width(48.dp)
            .height(IntrinsicSize.Max),
        contentAlignment = Alignment.TopCenter
    ) {
        // 绘制虚线
        Canvas(
            modifier = Modifier
                .width(2.dp)
                .fillMaxHeight()
                .padding(start = 23.dp)
        ) {
            val dashPathEffect = PathEffect.dashPathEffect(floatArrayOf(6f, 6f), 0f)

            // 上半部分
            if (!isFirst) {
                drawLine(
                    color = TimelineColors.LineColor,
                    start = Offset(0f, 0f),
                    end = Offset(0f, 8.dp.toPx()),
                    strokeWidth = 2.dp.toPx(),
                    pathEffect = dashPathEffect
                )
            }

            // 下半部分
            if (!isLast) {
                drawLine(
                    color = TimelineColors.LineColor,
                    start = Offset(0f, 20.dp.toPx()),
                    end = Offset(0f, size.height),
                    strokeWidth = 2.dp.toPx(),
                    pathEffect = dashPathEffect
                )
            }
        }

        // 圆点
        Box(
            modifier = Modifier
                .padding(start = 16.dp, top = 4.dp)
                .size(16.dp)
                .clip(CircleShape)
                .background(dotColor)
        )
    }
}

/**
 * 步骤头部 - 图标和标题
 */
@Composable
fun MessageStepHeader(message: ProjectChatMessageEntity) {
    val (icon, title) = when (message.role) {
        ProjectChatRole.USER -> Icons.Default.Person to "用户发送消息"
        ProjectChatRole.ASSISTANT -> Icons.Default.SmartToy to "AI发送消息"
        else -> Icons.Default.Info to "系统消息"
    }

    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        // 步骤类型图标
        Icon(
            imageVector = icon,
            contentDescription = null,
            modifier = Modifier.size(20.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant
        )

        // 步骤标题
        Text(
            text = title,
            style = MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onSurface
        )

        // 时间
        Text(
            text = formatStepTimestamp(message.createdAt),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f)
        )
    }
}

/**
 * 步骤内容
 */
@Composable
fun MessageStepContent(message: ProjectChatMessageEntity) {
    when (message.role) {
        ProjectChatRole.USER -> UserStepContent(message)
        ProjectChatRole.ASSISTANT -> AiStepContent(message)
        else -> SystemStepContent(message)
    }
}

/**
 * 用户消息步骤内容
 */
@Composable
fun UserStepContent(message: ProjectChatMessageEntity) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        // 文本内容
        if (message.content.isNotBlank()) {
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.5f)
                )
            ) {
                Text(
                    text = message.content,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onPrimaryContainer,
                    modifier = Modifier.padding(12.dp),
                    lineHeight = MaterialTheme.typography.bodyMedium.lineHeight * 1.4f
                )
            }
        }

        // 引用的文件
        message.referencedFilePaths?.let { paths ->
            if (paths.isNotBlank() && paths != "null") {
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
                            imageVector = Icons.Default.AttachFile,
                            contentDescription = null,
                            modifier = Modifier.size(20.dp),
                            tint = MaterialTheme.colorScheme.primary
                        )
                        Text(
                            text = "引用了文件",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }
        }
    }
}

/**
 * AI消息步骤内容
 */
@Composable
fun AiStepContent(message: ProjectChatMessageEntity) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        // AI 模型信息
        message.model?.let { model ->
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    imageVector = Icons.Default.Memory,
                    contentDescription = null,
                    modifier = Modifier.size(14.dp),
                    tint = MaterialTheme.colorScheme.tertiary
                )
                Text(
                    text = model,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.tertiary
                )
            }
        }

        // AI回复文本
        if (message.content.isNotBlank()) {
            Text(
                text = message.content,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurface,
                lineHeight = MaterialTheme.typography.bodyMedium.lineHeight * 1.5f
            )
        }

        // 如果正在流式传输
        if (message.isStreaming && message.content.isBlank()) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                CircularProgressIndicator(
                    modifier = Modifier.size(16.dp),
                    strokeWidth = 2.dp
                )
                Text(
                    text = "正在生成回复...",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }

        // 错误信息
        message.error?.let { error ->
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(8.dp),
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.errorContainer
                )
            ) {
                Row(
                    modifier = Modifier.padding(12.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        imageVector = Icons.Default.Error,
                        contentDescription = null,
                        modifier = Modifier.size(16.dp),
                        tint = MaterialTheme.colorScheme.error
                    )
                    Text(
                        text = error,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error
                    )
                }
            }
        }

        // 任务计划数据（如果有）
        message.taskPlanData?.let { planData ->
            if (planData.isNotBlank() && planData != "null") {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.tertiaryContainer.copy(alpha = 0.5f)
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
                            imageVector = Icons.Default.Assignment,
                            contentDescription = null,
                            modifier = Modifier.size(20.dp),
                            tint = MaterialTheme.colorScheme.tertiary
                        )
                        Text(
                            text = "生成了任务计划",
                            style = MaterialTheme.typography.bodySmall,
                            fontWeight = FontWeight.Medium,
                            color = MaterialTheme.colorScheme.onTertiaryContainer
                        )
                    }
                }
            }
        }

        // 快速操作类型（如果有）
        if (message.isQuickAction && message.quickActionType != null) {
            val actionName = when (message.quickActionType) {
                "generate_readme" -> "生成 README"
                "explain_project" -> "解释项目"
                "suggest_improvements" -> "建议改进"
                "review_code" -> "代码审查"
                else -> message.quickActionType
            }

            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(8.dp),
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.5f)
                )
            ) {
                Row(
                    modifier = Modifier.padding(8.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        imageVector = Icons.Default.Bolt,
                        contentDescription = null,
                        modifier = Modifier.size(14.dp),
                        tint = MaterialTheme.colorScheme.secondary
                    )
                    Text(
                        text = "快速操作: $actionName",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSecondaryContainer
                    )
                }
            }
        }
    }
}

/**
 * 系统消息步骤内容
 */
@Composable
fun SystemStepContent(message: ProjectChatMessageEntity) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(8.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
        )
    ) {
        Text(
            text = message.content,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(12.dp)
        )
    }
}

/**
 * 格式化步骤时间戳
 */
private fun formatStepTimestamp(timestamp: Long): String {
    return SimpleDateFormat("HH:mm:ss", Locale.getDefault()).format(Date(timestamp))
}

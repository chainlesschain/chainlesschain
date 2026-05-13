package com.chainlesschain.android.presentation.screens

import androidx.compose.animation.*
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.R
import com.chainlesschain.android.core.database.entity.ProjectChatMessageEntity
import com.chainlesschain.android.core.database.entity.ProjectChatRole
import com.chainlesschain.android.feature.project.model.ProjectDetailState
import com.chainlesschain.android.feature.project.ui.components.FileMentionPopup
import com.chainlesschain.android.feature.project.viewmodel.ProjectViewModel
import java.text.SimpleDateFormat
import java.util.*

/**
 * 项目详情页 V2 - 对话式布局
 * 参考: 扣子空间移动端设计
 * 对接实际数据接口
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProjectDetailScreenV2(
    projectId: String,
    onNavigateBack: () -> Unit = {},
    onNavigateToSteps: (String) -> Unit = {},
    onNavigateToFileBrowser: (String) -> Unit = {},
    onNavigateToTaskList: () -> Unit = {},
    viewModel: ProjectViewModel = hiltViewModel(),
    authViewModel: com.chainlesschain.android.feature.auth.presentation.AuthViewModel = hiltViewModel()
) {
    // 获取认证状态并初始化用户上下文
    val authState by authViewModel.uiState.collectAsState()

    LaunchedEffect(authState.currentUser) {
        authState.currentUser?.let { user ->
            viewModel.setCurrentUser(user.id)
        }
    }

    // 加载项目详情
    LaunchedEffect(projectId) {
        viewModel.loadProjectDetail(projectId)
    }

    // 收集状态
    val projectDetailState by viewModel.projectDetailState.collectAsState()
    val chatMessages by viewModel.chatMessages.collectAsState()
    val chatInputText by viewModel.chatInputText.collectAsState()
    val isAiResponding by viewModel.isAiResponding.collectAsState()
    val isFileMentionVisible by viewModel.isFileMentionVisible.collectAsState()
    val fileMentionSearchQuery by viewModel.fileMentionSearchQuery.collectAsState()
    val projectFiles by viewModel.projectFiles.collectAsState()
    val listState = rememberLazyListState()

    // 自动滚动到底部当有新消息时
    LaunchedEffect(chatMessages.size) {
        if (chatMessages.isNotEmpty()) {
            listState.animateScrollToItem(chatMessages.size - 1)
        }
    }

    // 获取项目标题
    val projectTitle = when (val state = projectDetailState) {
        is ProjectDetailState.Success -> state.project.name
        else -> stringResource(R.string.project_detail_default_title)
    }

    Scaffold(
        topBar = {
            ProjectDetailTopBar(
                title = projectTitle,
                onNavigateBack = onNavigateBack,
                onNavigateToFileBrowser = { onNavigateToFileBrowser(projectId) },
                onNavigateToTaskList = onNavigateToTaskList,
                isLoading = projectDetailState is ProjectDetailState.Loading
            )
        },
        bottomBar = {
            // #21 P3 fix: 输入框被系统导航栏遮挡 → 加 navigationBarsPadding + imePadding,
            // 让输入栏自动上移避开系统底部导航条 + 软键盘
            Column(
                modifier = Modifier
                    .navigationBarsPadding()
                    .imePadding()
            ) {
                FileMentionPopup(
                    isVisible = isFileMentionVisible,
                    files = projectFiles,
                    searchQuery = fileMentionSearchQuery,
                    onSearchQueryChange = { viewModel.updateFileMentionSearchQuery(it) },
                    onFileSelected = { viewModel.addFileMention(it) },
                    onDismiss = { viewModel.hideFileMentionPopup() }
                )
                ProjectInputBar(
                    value = chatInputText,
                    onValueChange = { newText ->
                        viewModel.updateChatInput(newText)
                        viewModel.checkForFileMentionTrigger(newText)
                        if (isFileMentionVisible) {
                            viewModel.updateFileMentionSearchQuery(newText.substringAfterLast("@", ""))
                        }
                    },
                    onSend = { viewModel.sendChatMessage() },
                    isLoading = isAiResponding
                )
            }
        }
    ) { paddingValues ->
        when (val state = projectDetailState) {
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
                        Spacer(modifier = Modifier.height(16.dp))
                        Button(onClick = { viewModel.loadProjectDetail(projectId) }) {
                            Text(stringResource(R.string.common_retry))
                        }
                    }
                }
            }

            is ProjectDetailState.Success -> {
                LazyColumn(
                    state = listState,
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(paddingValues),
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    // 查看所有步骤入口
                    item {
                        ViewAllStepsButton(
                            stepsCount = chatMessages.size,
                            onClick = { onNavigateToSteps(projectId) }
                        )
                    }

                    // 消息列表
                    items(chatMessages, key = { it.id }) { message ->
                        ChatMessageItem(
                            message = message,
                            onViewSteps = { onNavigateToSteps(projectId) }
                        )
                    }

                    // AI 正在响应的指示器
                    if (isAiResponding) {
                        item {
                            AiTypingIndicator()
                        }
                    }

                    // 空状态
                    if (chatMessages.isEmpty() && !isAiResponding) {
                        item {
                            EmptyConversationHint(
                                projectName = state.project.name,
                                projectType = state.project.type,
                                onQuickAction = { actionType ->
                                    viewModel.executeQuickAction(actionType)
                                }
                            )
                        }
                    }
                }
            }
        }
    }
}

/**
 * 项目详情顶部栏
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProjectDetailTopBar(
    title: String,
    onNavigateBack: () -> Unit,
    onNavigateToFileBrowser: () -> Unit = {},
    onNavigateToTaskList: () -> Unit = {},
    isLoading: Boolean = false
) {
    val context = LocalContext.current
    TopAppBar(
        title = {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Medium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                if (isLoading) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(16.dp),
                        strokeWidth = 2.dp
                    )
                }
            }
        },
        navigationIcon = {
            IconButton(onClick = onNavigateBack) {
                Icon(Icons.Default.ArrowBack, contentDescription = stringResource(R.string.common_back))
            }
        },
        actions = {
            IconButton(onClick = { /* Add functionality planned for future release */ }) {
                Icon(Icons.Default.Add, contentDescription = stringResource(R.string.project_detail_add))
            }
            IconButton(onClick = onNavigateToFileBrowser) {
                Icon(Icons.Outlined.Folder, contentDescription = stringResource(R.string.project_detail_import_file))
            }
            IconButton(onClick = onNavigateToTaskList) {
                Icon(Icons.Default.Assignment, contentDescription = stringResource(R.string.project_detail_task_list))
            }
            IconButton(onClick = {
                val intent = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
                    type = "text/plain"
                    putExtra(android.content.Intent.EXTRA_TEXT, context.getString(R.string.project_detail_share_text, title))
                }
                // Share intent will be started by the caller
            }) {
                Icon(Icons.Default.Share, contentDescription = stringResource(R.string.common_share))
            }
        },
        colors = TopAppBarDefaults.topAppBarColors(
            containerColor = MaterialTheme.colorScheme.surface
        )
    )
}

/**
 * 查看所有步骤按钮
 */
@Composable
fun ViewAllStepsButton(
    stepsCount: Int,
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
                .padding(horizontal = 16.dp, vertical = 14.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    imageVector = Icons.Default.AccountTree,
                    contentDescription = null,
                    modifier = Modifier.size(20.dp),
                    tint = MaterialTheme.colorScheme.primary
                )
                Text(
                    text = stringResource(R.string.project_detail_view_all_steps),
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Medium
                )
                if (stepsCount > 0) {
                    Surface(
                        shape = RoundedCornerShape(10.dp),
                        color = MaterialTheme.colorScheme.primaryContainer
                    ) {
                        Text(
                            text = "$stepsCount",
                            style = MaterialTheme.typography.labelSmall,
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
                            color = MaterialTheme.colorScheme.primary
                        )
                    }
                }
            }

            Icon(
                imageVector = Icons.Default.ChevronRight,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

/**
 * 聊天消息项 - 根据数据库实体渲染
 */
@Composable
fun ChatMessageItem(
    message: ProjectChatMessageEntity,
    onViewSteps: () -> Unit
) {
    when (message.role) {
        ProjectChatRole.USER -> UserMessageBubble(message)
        ProjectChatRole.ASSISTANT -> AiMessageBubble(message, onViewSteps)
        ProjectChatRole.SYSTEM -> SystemMessageItem(message)
    }
}

/**
 * 用户消息气泡
 */
@Composable
fun UserMessageBubble(message: ProjectChatMessageEntity) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.End
    ) {
        Card(
            shape = RoundedCornerShape(16.dp, 16.dp, 4.dp, 16.dp),
            colors = CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.primaryContainer
            ),
            modifier = Modifier.widthIn(max = 280.dp)
        ) {
            Column(
                modifier = Modifier.padding(12.dp)
            ) {
                Text(
                    text = message.content,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onPrimaryContainer
                )
            }
        }

        // 时间戳
        Text(
            text = formatDetailTimestamp(message.createdAt, LocalContext.current),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
            modifier = Modifier.padding(top = 4.dp, end = 4.dp)
        )
    }
}

/**
 * AI消息气泡
 */
@Composable
fun AiMessageBubble(
    message: ProjectChatMessageEntity,
    onViewSteps: () -> Unit
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.Start,
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        // AI 头像和名称
        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                modifier = Modifier
                    .size(24.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.primaryContainer),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = Icons.Default.SmartToy,
                    contentDescription = null,
                    modifier = Modifier.size(16.dp),
                    tint = MaterialTheme.colorScheme.primary
                )
            }
            Text(
                text = stringResource(R.string.project_detail_ai_assistant),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            message.model?.let { model ->
                Text(
                    text = "· $model",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f)
                )
            }
        }

        // 消息内容
        if (message.content.isNotBlank()) {
            Card(
                shape = RoundedCornerShape(4.dp, 16.dp, 16.dp, 16.dp),
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.surfaceVariant
                ),
                modifier = Modifier.widthIn(max = 300.dp)
            ) {
                Column(modifier = Modifier.padding(12.dp)) {
                    // #21 P3 fix: AI 消息用 MarkdownText 渲染 (用户反馈 AI 回复
                    // 里 # ## * 等符号裸显)。streaming 中持续追加 + 渲染 cursor;
                    // 完成后用纯渲染版本。
                    if (message.isStreaming) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            com.chainlesschain.android.core.ui.components.MarkdownText(
                                markdown = message.content,
                                textColor = MaterialTheme.colorScheme.onSurfaceVariant,
                                linkColor = MaterialTheme.colorScheme.primary,
                                // #21 P3 fix: 字号与用户气泡 bodyMedium 一致 (用户反馈 AI 输出比输入偏大)
                                style = MaterialTheme.typography.bodyMedium,
                                modifier = Modifier.weight(1f, fill = false),
                            )
                            Text(
                                text = "▋",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.primary
                            )
                        }
                    } else {
                        com.chainlesschain.android.core.ui.components.MarkdownText(
                            markdown = message.content,
                            textColor = MaterialTheme.colorScheme.onSurfaceVariant,
                            linkColor = MaterialTheme.colorScheme.primary,
                            // #21 P3 fix: 字号与用户气泡 bodyMedium 一致
                            style = MaterialTheme.typography.bodyMedium,
                        )
                    }

                    // 错误信息
                    message.error?.let { error ->
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(
                            text = stringResource(R.string.error_prefix, error),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.error
                        )
                    }
                }
            }
        } else if (message.isStreaming) {
            // 正在加载中的占位符
            Card(
                shape = RoundedCornerShape(4.dp, 16.dp, 16.dp, 16.dp),
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.surfaceVariant
                )
            ) {
                Row(
                    modifier = Modifier.padding(12.dp),
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    repeat(3) {
                        Box(
                            modifier = Modifier
                                .size(8.dp)
                                .clip(CircleShape)
                                .background(MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.3f))
                        )
                    }
                }
            }
        }

        // 时间戳
        Text(
            text = formatDetailTimestamp(message.createdAt, LocalContext.current),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
            modifier = Modifier.padding(start = 32.dp, top = 4.dp)
        )
    }
}

/**
 * 系统消息项
 */
@Composable
fun SystemMessageItem(message: ProjectChatMessageEntity) {
    Box(
        modifier = Modifier.fillMaxWidth(),
        contentAlignment = Alignment.Center
    ) {
        Text(
            text = message.content,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f)
        )
    }
}

/**
 * AI 正在输入指示器
 */
@Composable
fun AiTypingIndicator() {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.Start,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier
                .size(24.dp)
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.primaryContainer),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                imageVector = Icons.Default.SmartToy,
                contentDescription = null,
                modifier = Modifier.size(16.dp),
                tint = MaterialTheme.colorScheme.primary
            )
        }

        Spacer(modifier = Modifier.width(8.dp))

        Card(
            shape = RoundedCornerShape(4.dp, 16.dp, 16.dp, 16.dp),
            colors = CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.surfaceVariant
            )
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                Text(
                    text = stringResource(R.string.project_detail_thinking),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                CircularProgressIndicator(
                    modifier = Modifier.size(12.dp),
                    strokeWidth = 1.5.dp
                )
            }
        }
    }
}

/**
 * 空对话提示
 *
 * #21 P3 fix: 按 projectType 分两组快捷操作。code 类型 (code/android/web/app/
 * backend/data_science/multiplatform/flutter) 保留原 3 个程序员场景操作
 * (生成 README / 解释项目代码 / 建议改进)；其它（日常项目: document/data/
 * design/research/other 等）换 3 个非程序员快捷操作 (整理要点 / 列出待办 /
 * 给点建议)。
 *
 * 用户反馈："做个旅行计划怎么还有代码解释 明显不对"。
 */
@Composable
fun EmptyConversationHint(
    projectName: String,
    projectType: String = "",
    onQuickAction: (String) -> Unit
) {
    val isCodeProject = projectType in setOf(
        "code", "android", "web", "app", "backend",
        "data_science", "multiplatform", "flutter",
    )
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Icon(
            imageVector = Icons.Outlined.Chat,
            contentDescription = null,
            modifier = Modifier.size(64.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.3f)
        )

        Text(
            text = stringResource(R.string.project_detail_start_discuss, projectName),
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )

        Text(
            text = stringResource(R.string.project_detail_try_quick_actions),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f)
        )

        // 快捷操作按钮 — 按 projectType 分组渲染 (#21 P3 fix)
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            if (isCodeProject) {
                // 程序员场景：保持原 3 个快捷操作
                QuickActionButton(
                    icon = Icons.Default.Description,
                    text = stringResource(R.string.project_detail_generate_readme),
                    onClick = { onQuickAction("generate_readme") }
                )
                QuickActionButton(
                    icon = Icons.Default.Code,
                    text = stringResource(R.string.project_detail_explain_code),
                    onClick = { onQuickAction("explain_project") }
                )
                QuickActionButton(
                    icon = Icons.Default.Lightbulb,
                    text = stringResource(R.string.project_detail_suggest_improvements),
                    onClick = { onQuickAction("suggest_improvements") }
                )
            } else {
                // 日常项目场景：旅行计划/购物清单/读书笔记等
                QuickActionButton(
                    icon = Icons.Default.FormatListBulleted,
                    text = stringResource(R.string.project_detail_summarize_points),
                    onClick = { onQuickAction("summarize_points") }
                )
                QuickActionButton(
                    icon = Icons.Default.CheckBox,
                    text = stringResource(R.string.project_detail_list_todos),
                    onClick = { onQuickAction("list_todos") }
                )
                QuickActionButton(
                    icon = Icons.Default.Lightbulb,
                    text = stringResource(R.string.project_detail_advise),
                    onClick = { onQuickAction("advise") }
                )
            }
        }
    }
}

/**
 * 快捷操作按钮
 */
@Composable
private fun QuickActionButton(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    text: String,
    onClick: () -> Unit
) {
    OutlinedCard(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        shape = RoundedCornerShape(12.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                modifier = Modifier.size(20.dp),
                tint = MaterialTheme.colorScheme.primary
            )
            Text(
                text = text,
                style = MaterialTheme.typography.bodyMedium
            )
        }
    }
}

/**
 * 底部输入栏
 */
@Composable
fun ProjectInputBar(
    value: String,
    onValueChange: (String) -> Unit,
    onSend: () -> Unit,
    isLoading: Boolean = false
) {
    Surface(
        shadowElevation = 8.dp,
        color = MaterialTheme.colorScheme.surface
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // 附件按钮
            IconButton(
                onClick = { /* Attachment picker planned for future release */ },
                modifier = Modifier.size(40.dp),
                enabled = !isLoading
            ) {
                Icon(
                    imageVector = Icons.Default.AttachFile,
                    contentDescription = stringResource(R.string.project_detail_attachment),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            // 输入框
            OutlinedTextField(
                value = value,
                onValueChange = onValueChange,
                modifier = Modifier.weight(1f),
                placeholder = {
                    Text(
                        stringResource(R.string.project_detail_input_hint),
                        style = MaterialTheme.typography.bodyMedium
                    )
                },
                shape = RoundedCornerShape(24.dp),
                colors = OutlinedTextFieldDefaults.colors(
                    unfocusedBorderColor = MaterialTheme.colorScheme.outline.copy(alpha = 0.3f),
                    focusedBorderColor = MaterialTheme.colorScheme.primary
                ),
                singleLine = true,
                enabled = !isLoading
            )

            // 发送/语音按钮
            if (value.isNotBlank()) {
                IconButton(
                    onClick = onSend,
                    modifier = Modifier
                        .size(40.dp)
                        .clip(CircleShape)
                        .background(MaterialTheme.colorScheme.primary),
                    enabled = !isLoading
                ) {
                    if (isLoading) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(20.dp),
                            strokeWidth = 2.dp,
                            color = MaterialTheme.colorScheme.onPrimary
                        )
                    } else {
                        Icon(
                            imageVector = Icons.Default.Send,
                            contentDescription = stringResource(R.string.common_send),
                            tint = MaterialTheme.colorScheme.onPrimary
                        )
                    }
                }
            } else {
                IconButton(
                    onClick = { /* Voice input planned for future release */ },
                    modifier = Modifier
                        .size(40.dp)
                        .clip(CircleShape)
                        .background(MaterialTheme.colorScheme.primaryContainer),
                    enabled = !isLoading
                ) {
                    Icon(
                        imageVector = Icons.Default.Mic,
                        contentDescription = stringResource(R.string.project_detail_voice),
                        tint = MaterialTheme.colorScheme.primary
                    )
                }
            }
        }
    }
}

/**
 * 格式化时间戳
 */
private fun formatDetailTimestamp(timestamp: Long, context: android.content.Context): String {
    val now = System.currentTimeMillis()
    val diff = now - timestamp

    return when {
        diff < 60_000 -> context.getString(R.string.common_just_now)
        diff < 3600_000 -> context.getString(R.string.common_minutes_ago, (diff / 60_000).toInt())
        diff < 86400_000 -> SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(timestamp))
        else -> SimpleDateFormat("MM-dd HH:mm", Locale.getDefault()).format(Date(timestamp))
    }
}

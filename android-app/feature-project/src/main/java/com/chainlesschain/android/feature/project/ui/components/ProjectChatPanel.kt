package com.chainlesschain.android.feature.project.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.AlternateEmail
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Error
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.SmartToy
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.chainlesschain.android.core.database.entity.ProjectChatMessageEntity
import com.chainlesschain.android.core.database.entity.ProjectChatRole
import com.chainlesschain.android.core.database.entity.ProjectFileEntity
import com.chainlesschain.android.core.database.entity.ProjectMessageType
import com.chainlesschain.android.core.ui.components.MarkdownText
import com.chainlesschain.android.feature.project.model.ChatContextMode
import com.chainlesschain.android.feature.project.model.TaskPlan
import com.chainlesschain.android.feature.project.model.ThinkingStage
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Main chat panel for project AI conversations
 */
@Composable
fun ProjectChatPanel(
    messages: List<ProjectChatMessageEntity>,
    isAiResponding: Boolean,
    inputText: String,
    onInputChange: (String) -> Unit,
    onSendMessage: () -> Unit,
    onQuickAction: (String) -> Unit,
    onClearChat: () -> Unit,
    onRetry: () -> Unit,
    // Context mode props
    contextMode: ChatContextMode = ChatContextMode.PROJECT,
    onContextModeChange: (ChatContextMode) -> Unit = {},
    selectedFileName: String? = null,
    // File mention props
    projectFiles: List<ProjectFileEntity> = emptyList(),
    isFileMentionVisible: Boolean = false,
    fileMentionSearchQuery: String = "",
    onFileMentionSearchChange: (String) -> Unit = {},
    onFileSelected: (ProjectFileEntity) -> Unit = {},
    onShowFileMention: () -> Unit = {},
    onHideFileMention: () -> Unit = {},
    // Thinking stage props
    currentThinkingStage: ThinkingStage = ThinkingStage.UNDERSTANDING,
    // Task plan props
    currentTaskPlan: TaskPlan? = null,
    onConfirmTaskPlan: () -> Unit = {},
    onCancelTaskPlan: () -> Unit = {},
    onModifyTaskPlan: () -> Unit = {},
    onRetryTaskStep: (com.chainlesschain.android.feature.project.model.TaskStep) -> Unit = {},
    modifier: Modifier = Modifier
) {
    val listState = rememberLazyListState()

    // Auto-scroll to bottom when new messages arrive
    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) {
            listState.animateScrollToItem(messages.size - 1)
        }
    }

    Column(modifier = modifier.fillMaxSize()) {
        // Context Mode Switcher
        CompactContextModeSwitcher(
            currentMode = contextMode,
            onModeChange = onContextModeChange,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp)
        )

        // Quick Actions Bar
        QuickActionsBar(
            onQuickAction = onQuickAction,
            isLoading = isAiResponding,
            modifier = Modifier.fillMaxWidth()
        )

        // Messages List
        Box(modifier = Modifier.weight(1f)) {
            if (messages.isEmpty()) {
                EmptyChatState(
                    onQuickAction = onQuickAction,
                    modifier = Modifier.fillMaxSize()
                )
            } else {
                LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    items(messages, key = { it.id }) { message ->
                        ChatMessageBubble(
                            message = message,
                            onRetry = onRetry
                        )
                    }

                    // Show task plan card if available
                    currentTaskPlan?.let { plan ->
                        item {
                            TaskPlanCard(
                                taskPlan = plan,
                                onConfirm = onConfirmTaskPlan,
                                onCancel = onCancelTaskPlan,
                                onModify = onModifyTaskPlan,
                                onRetry = onRetryTaskStep
                            )
                        }
                    }
                }
            }

            // Enhanced thinking indicator
            AnimatedVisibility(
                visible = isAiResponding,
                enter = fadeIn() + slideInVertically(initialOffsetY = { it / 2 }),
                exit = fadeOut() + slideOutVertically(targetOffsetY = { it / 2 }),
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(bottom = 8.dp)
            ) {
                EnhancedThinkingIndicator(
                    currentStage = currentThinkingStage,
                    isVisible = true,
                    showProgress = true
                )
            }

            // File mention popup
            AnimatedVisibility(
                visible = isFileMentionVisible,
                enter = fadeIn() + slideInVertically(initialOffsetY = { it }),
                exit = fadeOut() + slideOutVertically(targetOffsetY = { it }),
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(horizontal = 16.dp, vertical = 8.dp)
            ) {
                FileMentionPopup(
                    isVisible = isFileMentionVisible,
                    files = projectFiles,
                    searchQuery = fileMentionSearchQuery,
                    onSearchQueryChange = onFileMentionSearchChange,
                    onFileSelected = onFileSelected,
                    onDismiss = onHideFileMention
                )
            }
        }

        // Input Bar with file mention support
        EnhancedChatInputBar(
            text = inputText,
            onTextChange = { newText ->
                onInputChange(newText)
                // Check for @ trigger
                if (newText.endsWith("@")) {
                    onShowFileMention()
                }
            },
            onSend = onSendMessage,
            isLoading = isAiResponding,
            onClearChat = onClearChat,
            onFileMentionClick = onShowFileMention,
            modifier = Modifier.fillMaxWidth()
        )
    }
}

/**
 * Quick actions bar with AI shortcuts
 */
@Composable
private fun QuickActionsBar(
    onQuickAction: (String) -> Unit,
    isLoading: Boolean,
    modifier: Modifier = Modifier
) {
    Surface(
        modifier = modifier,
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            QuickActionChip(
                text = "README",
                icon = Icons.Default.Description,
                onClick = { onQuickAction("generate_readme") },
                enabled = !isLoading
            )
            QuickActionChip(
                text = "Explain",
                icon = Icons.Default.AutoAwesome,
                onClick = { onQuickAction("explain_code") },
                enabled = !isLoading
            )
            QuickActionChip(
                text = "Review",
                icon = Icons.Default.SmartToy,
                onClick = { onQuickAction("review_code") },
                enabled = !isLoading
            )
        }
    }
}

/**
 * Quick action chip button
 */
@Composable
private fun QuickActionChip(
    text: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    onClick: () -> Unit,
    enabled: Boolean,
    modifier: Modifier = Modifier
) {
    Surface(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier,
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = if (enabled) 1f else 0.5f)
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                modifier = Modifier.size(16.dp),
                tint = MaterialTheme.colorScheme.onPrimaryContainer
            )
            Spacer(modifier = Modifier.width(4.dp))
            Text(
                text = text,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onPrimaryContainer
            )
        }
    }
}

/**
 * Empty chat state with suggestions
 */
@Composable
private fun EmptyChatState(
    onQuickAction: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier.padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Icon(
            imageVector = Icons.Default.SmartToy,
            contentDescription = null,
            modifier = Modifier.size(64.dp),
            tint = MaterialTheme.colorScheme.primary.copy(alpha = 0.5f)
        )
        Spacer(modifier = Modifier.height(16.dp))
        Text(
            text = "Project AI Assistant",
            style = MaterialTheme.typography.titleLarge,
            color = MaterialTheme.colorScheme.onSurface
        )
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = "Ask questions about your project, generate documentation, or get code suggestions.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center
        )
        Spacer(modifier = Modifier.height(24.dp))
        Text(
            text = "Try asking:",
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Spacer(modifier = Modifier.height(8.dp))
        SuggestionChip(
            text = "Generate a README for this project",
            onClick = { onQuickAction("generate_readme") }
        )
        SuggestionChip(
            text = "What does this project do?",
            onClick = { onQuickAction("explain_project") }
        )
        SuggestionChip(
            text = "Suggest improvements for code quality",
            onClick = { onQuickAction("suggest_improvements") }
        )
    }
}

/**
 * Suggestion chip for empty state
 */
@Composable
private fun SuggestionChip(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    Surface(
        onClick = onClick,
        modifier = modifier.padding(vertical = 4.dp),
        shape = RoundedCornerShape(20.dp),
        color = MaterialTheme.colorScheme.surfaceVariant
    ) {
        Text(
            text = text,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.primary
        )
    }
}

/**
 * Chat message bubble
 */
@Composable
private fun ChatMessageBubble(
    message: ProjectChatMessageEntity,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier
) {
    val isUser = message.role == ProjectChatRole.USER
    val clipboardManager = LocalClipboardManager.current
    var showMenu by remember { mutableStateOf(false) }

    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start
    ) {
        if (!isUser) {
            // AI Avatar
            Box(
                modifier = Modifier
                    .size(32.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.primaryContainer),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = Icons.Default.SmartToy,
                    contentDescription = null,
                    modifier = Modifier.size(20.dp),
                    tint = MaterialTheme.colorScheme.onPrimaryContainer
                )
            }
            Spacer(modifier = Modifier.width(8.dp))
        }

        Column(
            modifier = Modifier.widthIn(max = 300.dp),
            horizontalAlignment = if (isUser) Alignment.End else Alignment.Start
        ) {
            Card(
                colors = CardDefaults.cardColors(
                    containerColor = if (isUser)
                        MaterialTheme.colorScheme.primary
                    else
                        MaterialTheme.colorScheme.surfaceVariant
                ),
                shape = RoundedCornerShape(
                    topStart = 16.dp,
                    topEnd = 16.dp,
                    bottomStart = if (isUser) 16.dp else 4.dp,
                    bottomEnd = if (isUser) 4.dp else 16.dp
                )
            ) {
                Column(modifier = Modifier.padding(12.dp)) {
                    // Message type badge
                    val typeBadge = when {
                        message.isQuickAction && message.quickActionType != null ->
                            message.quickActionType.replace("_", " ").uppercase()
                        message.messageType == ProjectMessageType.TASK_PLAN -> "TASK PLAN"
                        message.messageType == ProjectMessageType.TASK_ANALYSIS -> "ANALYSIS"
                        message.messageType == ProjectMessageType.INTENT_CONFIRM -> "CONFIRM"
                        message.messageType == ProjectMessageType.CREATION -> "CREATING"
                        else -> null
                    }

                    typeBadge?.let { badge ->
                        Text(
                            text = badge,
                            style = MaterialTheme.typography.labelSmall,
                            color = if (isUser)
                                MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.7f)
                            else
                                MaterialTheme.colorScheme.primary
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                    }

                    // Message content - use Markdown rendering for assistant messages
                    if (isUser || message.content.isEmpty()) {
                        Text(
                            text = message.content.ifEmpty {
                                if (message.isStreaming) "..." else ""
                            },
                            style = MaterialTheme.typography.bodyMedium,
                            color = if (isUser)
                                MaterialTheme.colorScheme.onPrimary
                            else
                                MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    } else {
                        // Render Markdown for assistant messages
                        MarkdownText(
                            markdown = message.content,
                            textColor = MaterialTheme.colorScheme.onSurfaceVariant,
                            linkColor = MaterialTheme.colorScheme.primary
                        )
                    }

                    // Error state
                    if (message.error != null) {
                        Spacer(modifier = Modifier.height(8.dp))
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(
                                imageVector = Icons.Default.Error,
                                contentDescription = null,
                                modifier = Modifier.size(16.dp),
                                tint = MaterialTheme.colorScheme.error
                            )
                            Spacer(modifier = Modifier.width(4.dp))
                            Text(
                                text = message.error,
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.error
                            )
                        }
                        TextButton(onClick = onRetry) {
                            Icon(
                                imageVector = Icons.Default.Refresh,
                                contentDescription = null,
                                modifier = Modifier.size(16.dp)
                            )
                            Spacer(modifier = Modifier.width(4.dp))
                            Text("Retry")
                        }
                    }
                }
            }

            // Timestamp and actions row
            Row(
                modifier = Modifier.padding(horizontal = 4.dp, vertical = 2.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = formatMessageTime(message.createdAt),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f)
                )

                if (!isUser && message.content.isNotEmpty() && !message.isStreaming) {
                    Spacer(modifier = Modifier.width(8.dp))
                    Box {
                        IconButton(
                            onClick = { showMenu = true },
                            modifier = Modifier.size(24.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.MoreVert,
                                contentDescription = "More options",
                                modifier = Modifier.size(16.dp),
                                tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f)
                            )
                        }
                        DropdownMenu(
                            expanded = showMenu,
                            onDismissRequest = { showMenu = false }
                        ) {
                            DropdownMenuItem(
                                text = { Text("Copy") },
                                leadingIcon = { Icon(Icons.Default.ContentCopy, null) },
                                onClick = {
                                    clipboardManager.setText(AnnotatedString(message.content))
                                    showMenu = false
                                }
                            )
                        }
                    }
                }
            }
        }

        if (isUser) {
            Spacer(modifier = Modifier.width(8.dp))
            // User Avatar
            Box(
                modifier = Modifier
                    .size(32.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.secondaryContainer),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = Icons.Default.Person,
                    contentDescription = null,
                    modifier = Modifier.size(20.dp),
                    tint = MaterialTheme.colorScheme.onSecondaryContainer
                )
            }
        }
    }
}

/**
 * Thinking/loading indicator
 */
@Composable
private fun ThinkingIndicator(modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surfaceVariant
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            CircularProgressIndicator(
                modifier = Modifier.size(16.dp),
                strokeWidth = 2.dp
            )
            Spacer(modifier = Modifier.width(8.dp))
            Text(
                text = "AI is thinking...",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

/**
 * Chat input bar
 */
@Composable
private fun ChatInputBar(
    text: String,
    onTextChange: (String) -> Unit,
    onSend: () -> Unit,
    isLoading: Boolean,
    onClearChat: () -> Unit,
    modifier: Modifier = Modifier
) {
    var showMenu by remember { mutableStateOf(false) }

    Surface(
        modifier = modifier,
        color = MaterialTheme.colorScheme.surface,
        tonalElevation = 2.dp
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(8.dp),
            verticalAlignment = Alignment.Bottom
        ) {
            Box {
                IconButton(onClick = { showMenu = true }) {
                    Icon(
                        imageVector = Icons.Default.MoreVert,
                        contentDescription = "More options"
                    )
                }
                DropdownMenu(
                    expanded = showMenu,
                    onDismissRequest = { showMenu = false }
                ) {
                    DropdownMenuItem(
                        text = { Text("Clear chat") },
                        leadingIcon = { Icon(Icons.Default.Clear, null) },
                        onClick = {
                            onClearChat()
                            showMenu = false
                        }
                    )
                }
            }

            OutlinedTextField(
                value = text,
                onValueChange = onTextChange,
                modifier = Modifier.weight(1f),
                placeholder = { Text("Ask about your project...") },
                maxLines = 4,
                shape = RoundedCornerShape(24.dp),
                enabled = !isLoading
            )

            Spacer(modifier = Modifier.width(8.dp))

            IconButton(
                onClick = onSend,
                enabled = text.isNotBlank() && !isLoading,
                modifier = Modifier
                    .clip(CircleShape)
                    .background(
                        if (text.isNotBlank() && !isLoading)
                            MaterialTheme.colorScheme.primary
                        else
                            MaterialTheme.colorScheme.surfaceVariant
                    )
            ) {
                if (isLoading) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(24.dp),
                        strokeWidth = 2.dp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                } else {
                    Icon(
                        imageVector = Icons.AutoMirrored.Filled.Send,
                        contentDescription = "Send",
                        tint = if (text.isNotBlank())
                            MaterialTheme.colorScheme.onPrimary
                        else
                            MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        }
    }
}

/**
 * Enhanced chat input bar with file mention support
 */
@Composable
private fun EnhancedChatInputBar(
    text: String,
    onTextChange: (String) -> Unit,
    onSend: () -> Unit,
    isLoading: Boolean,
    onClearChat: () -> Unit,
    onFileMentionClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    var showMenu by remember { mutableStateOf(false) }

    Surface(
        modifier = modifier,
        color = MaterialTheme.colorScheme.surface,
        tonalElevation = 2.dp
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(8.dp),
            verticalAlignment = Alignment.Bottom
        ) {
            // Menu button
            Box {
                IconButton(onClick = { showMenu = true }) {
                    Icon(
                        imageVector = Icons.Default.MoreVert,
                        contentDescription = "More options"
                    )
                }
                DropdownMenu(
                    expanded = showMenu,
                    onDismissRequest = { showMenu = false }
                ) {
                    DropdownMenuItem(
                        text = { Text("Clear chat") },
                        leadingIcon = { Icon(Icons.Default.Clear, null) },
                        onClick = {
                            onClearChat()
                            showMenu = false
                        }
                    )
                }
            }

            // File mention button
            IconButton(
                onClick = onFileMentionClick,
                enabled = !isLoading
            ) {
                Icon(
                    imageVector = Icons.Default.AlternateEmail,
                    contentDescription = "Mention file",
                    tint = MaterialTheme.colorScheme.primary.copy(
                        alpha = if (isLoading) 0.5f else 1f
                    )
                )
            }

            // Input field
            OutlinedTextField(
                value = text,
                onValueChange = onTextChange,
                modifier = Modifier.weight(1f),
                placeholder = { Text("Ask about your project... Use @ to mention files") },
                maxLines = 4,
                shape = RoundedCornerShape(24.dp),
                enabled = !isLoading
            )

            Spacer(modifier = Modifier.width(8.dp))

            // Send button
            IconButton(
                onClick = onSend,
                enabled = text.isNotBlank() && !isLoading,
                modifier = Modifier
                    .clip(CircleShape)
                    .background(
                        if (text.isNotBlank() && !isLoading)
                            MaterialTheme.colorScheme.primary
                        else
                            MaterialTheme.colorScheme.surfaceVariant
                    )
            ) {
                if (isLoading) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(24.dp),
                        strokeWidth = 2.dp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                } else {
                    Icon(
                        imageVector = Icons.AutoMirrored.Filled.Send,
                        contentDescription = "Send",
                        tint = if (text.isNotBlank())
                            MaterialTheme.colorScheme.onPrimary
                        else
                            MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        }
    }
}

private fun formatMessageTime(timestamp: Long): String {
    val now = System.currentTimeMillis()
    val diff = now - timestamp

    return when {
        diff < 60 * 1000 -> "Just now"
        diff < 60 * 60 * 1000 -> "${diff / (60 * 1000)}m ago"
        diff < 24 * 60 * 60 * 1000 -> {
            SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(timestamp))
        }
        else -> {
            SimpleDateFormat("MM/dd HH:mm", Locale.getDefault()).format(Date(timestamp))
        }
    }
}

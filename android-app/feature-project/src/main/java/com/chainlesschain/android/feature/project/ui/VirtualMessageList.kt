package com.chainlesschain.android.feature.project.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
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
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.SmartToy
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.chainlesschain.android.core.database.entity.ProjectChatMessageEntity
import com.chainlesschain.android.core.database.entity.ProjectChatRole
import com.chainlesschain.android.core.database.entity.ProjectMessageType
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Virtual Message List
 *
 * Optimized message list component for long conversations:
 * - LazyColumn with stable keys
 * - Automatic scroll to bottom on new messages
 * - Scroll-to-bottom FAB for long lists
 * - Message grouping by date
 * - Efficient recomposition with derived states
 * - Pagination support for very long histories
 */
@Composable
fun VirtualMessageList(
    messages: List<ProjectChatMessageEntity>,
    modifier: Modifier = Modifier,
    listState: LazyListState = rememberLazyListState(),
    isStreaming: Boolean = false,
    onLoadMore: (() -> Unit)? = null,
    showTimestamps: Boolean = true,
    contentPadding: PaddingValues = PaddingValues(16.dp)
) {
    val scope = rememberCoroutineScope()
    val configuration = LocalConfiguration.current
    val maxBubbleWidth = (configuration.screenWidthDp * 0.85f).dp

    // Group messages by date
    val groupedMessages by remember(messages) {
        derivedStateOf {
            groupMessagesByDate(messages)
        }
    }

    // Track if we should show scroll-to-bottom button
    val showScrollButton by remember {
        derivedStateOf {
            val lastVisibleIndex = listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0
            val totalItems = listState.layoutInfo.totalItemsCount
            totalItems > 10 && lastVisibleIndex < totalItems - 3
        }
    }

    // Auto-scroll to bottom on new messages
    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty() && !showScrollButton) {
            listState.animateScrollToItem(messages.lastIndex)
        }
    }

    // Detect when scrolled to top for load more
    LaunchedEffect(listState) {
        snapshotFlow { listState.firstVisibleItemIndex }
            .distinctUntilChanged()
            .collect { index ->
                if (index == 0 && onLoadMore != null) {
                    onLoadMore()
                }
            }
    }

    Box(modifier = modifier.fillMaxSize()) {
        if (messages.isEmpty()) {
            EmptyMessageState()
        } else {
            LazyColumn(
                state = listState,
                contentPadding = contentPadding,
                verticalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.fillMaxSize()
            ) {
                groupedMessages.forEach { (date, dateMessages) ->
                    // Date header
                    item(key = "date-$date") {
                        DateHeader(date = date)
                    }

                    // Messages for this date
                    items(
                        items = dateMessages,
                        key = { it.id }
                    ) { message ->
                        MessageBubble(
                            message = message,
                            maxWidth = maxBubbleWidth,
                            showTimestamp = showTimestamps,
                            isStreaming = isStreaming && message == messages.lastOrNull()
                        )
                    }
                }
            }
        }

        // Scroll to bottom FAB
        AnimatedVisibility(
            visible = showScrollButton,
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(bottom = 16.dp),
            enter = fadeIn(),
            exit = fadeOut()
        ) {
            FloatingActionButton(
                onClick = {
                    scope.launch {
                        listState.animateScrollToItem(messages.lastIndex)
                    }
                },
                modifier = Modifier.size(40.dp),
                containerColor = MaterialTheme.colorScheme.secondaryContainer,
                contentColor = MaterialTheme.colorScheme.onSecondaryContainer
            ) {
                Icon(
                    Icons.Default.KeyboardArrowDown,
                    contentDescription = "滚动到底部",
                    modifier = Modifier.size(24.dp)
                )
            }
        }
    }
}

@Composable
private fun EmptyMessageState() {
    Box(
        modifier = Modifier.fillMaxSize(),
        contentAlignment = Alignment.Center
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(
                Icons.Default.SmartToy,
                contentDescription = null,
                modifier = Modifier.size(64.dp),
                tint = MaterialTheme.colorScheme.primary.copy(alpha = 0.3f)
            )
            Spacer(modifier = Modifier.height(16.dp))
            Text(
                text = "开始对话",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f)
            )
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = "输入消息与 AI 助手交流",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.4f)
            )
        }
    }
}

@Composable
private fun DateHeader(date: String) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 8.dp),
        contentAlignment = Alignment.Center
    ) {
        Surface(
            shape = RoundedCornerShape(12.dp),
            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
        ) {
            Text(
                text = date,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp)
            )
        }
    }
}

@Composable
private fun MessageBubble(
    message: ProjectChatMessageEntity,
    maxWidth: androidx.compose.ui.unit.Dp,
    showTimestamp: Boolean,
    isStreaming: Boolean
) {
    val isUser = message.role == ProjectChatRole.USER
    val isSystem = message.role == ProjectChatRole.SYSTEM

    val alignment = when {
        isSystem -> Alignment.Center
        isUser -> Alignment.End
        else -> Alignment.Start
    }

    val backgroundColor = when {
        isSystem -> MaterialTheme.colorScheme.tertiaryContainer.copy(alpha = 0.5f)
        isUser -> MaterialTheme.colorScheme.primaryContainer
        else -> MaterialTheme.colorScheme.surfaceVariant
    }

    val contentColor = when {
        isSystem -> MaterialTheme.colorScheme.onTertiaryContainer
        isUser -> MaterialTheme.colorScheme.onPrimaryContainer
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }

    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = if (isUser) Alignment.End else Alignment.Start
    ) {
        Row(
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start,
            modifier = Modifier.fillMaxWidth()
        ) {
            // Avatar for AI messages
            if (!isUser && !isSystem) {
                Box(
                    modifier = Modifier
                        .size(32.dp)
                        .background(
                            MaterialTheme.colorScheme.primary.copy(alpha = 0.1f),
                            CircleShape
                        ),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        Icons.Default.SmartToy,
                        contentDescription = null,
                        modifier = Modifier.size(18.dp),
                        tint = MaterialTheme.colorScheme.primary
                    )
                }
                Spacer(modifier = Modifier.width(8.dp))
            }

            // Message bubble
            Card(
                shape = RoundedCornerShape(
                    topStart = 16.dp,
                    topEnd = 16.dp,
                    bottomStart = if (isUser) 16.dp else 4.dp,
                    bottomEnd = if (isUser) 4.dp else 16.dp
                ),
                colors = CardDefaults.cardColors(containerColor = backgroundColor),
                modifier = Modifier.widthIn(max = maxWidth)
            ) {
                Column(modifier = Modifier.padding(12.dp)) {
                    // Message type badge for special messages
                    if (message.messageType != ProjectMessageType.NORMAL) {
                        MessageTypeBadge(message.messageType)
                        Spacer(modifier = Modifier.height(4.dp))
                    }

                    // Content
                    Text(
                        text = message.content,
                        style = MaterialTheme.typography.bodyMedium,
                        color = contentColor
                    )

                    // Streaming indicator
                    if (isStreaming) {
                        Spacer(modifier = Modifier.height(4.dp))
                        StreamingIndicator()
                    }
                }
            }

            // Avatar for user messages
            if (isUser) {
                Spacer(modifier = Modifier.width(8.dp))
                Box(
                    modifier = Modifier
                        .size(32.dp)
                        .background(
                            MaterialTheme.colorScheme.secondary.copy(alpha = 0.1f),
                            CircleShape
                        ),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        Icons.Default.Person,
                        contentDescription = null,
                        modifier = Modifier.size(18.dp),
                        tint = MaterialTheme.colorScheme.secondary
                    )
                }
            }
        }

        // Timestamp
        if (showTimestamp) {
            Text(
                text = formatTimestamp(message.createdAt),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.4f),
                modifier = Modifier.padding(
                    top = 2.dp,
                    start = if (isUser) 0.dp else 40.dp,
                    end = if (isUser) 40.dp else 0.dp
                )
            )
        }
    }
}

@Composable
private fun MessageTypeBadge(type: String) {
    val (label, color) = when (type) {
        ProjectMessageType.TASK_PLAN -> "任务计划" to Color(0xFF4CAF50)
        ProjectMessageType.TASK_ANALYSIS -> "任务分析" to Color(0xFF2196F3)
        ProjectMessageType.CODE_BLOCK -> "代码" to Color(0xFF9C27B0)
        ProjectMessageType.FILE_REFERENCE -> "文件引用" to Color(0xFFFF9800)
        ProjectMessageType.EXECUTION_RESULT -> "执行结果" to Color(0xFF00BCD4)
        ProjectMessageType.SYSTEM -> "系统" to Color(0xFF607D8B)
        else -> null to null
    }

    if (label != null && color != null) {
        Surface(
            shape = RoundedCornerShape(4.dp),
            color = color.copy(alpha = 0.2f)
        ) {
            Text(
                text = label,
                style = MaterialTheme.typography.labelSmall,
                color = color,
                fontWeight = FontWeight.Medium,
                modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
            )
        }
    }
}

@Composable
private fun StreamingIndicator() {
    Row(verticalAlignment = Alignment.CenterVertically) {
        repeat(3) { index ->
            Box(
                modifier = Modifier
                    .size(4.dp)
                    .background(
                        MaterialTheme.colorScheme.primary.copy(alpha = 0.6f),
                        CircleShape
                    )
            )
            if (index < 2) {
                Spacer(modifier = Modifier.width(4.dp))
            }
        }
    }
}

private fun groupMessagesByDate(
    messages: List<ProjectChatMessageEntity>
): List<Pair<String, List<ProjectChatMessageEntity>>> {
    val dateFormat = SimpleDateFormat("yyyy年MM月dd日", Locale.getDefault())
    val today = dateFormat.format(Date())
    val yesterday = dateFormat.format(Date(System.currentTimeMillis() - 24 * 60 * 60 * 1000))

    return messages
        .groupBy { msg ->
            val date = dateFormat.format(Date(msg.createdAt))
            when (date) {
                today -> "今天"
                yesterday -> "昨天"
                else -> date
            }
        }
        .toList()
        .sortedBy { (_, msgs) -> msgs.firstOrNull()?.createdAt ?: 0 }
}

private fun formatTimestamp(timestamp: Long): String {
    val format = SimpleDateFormat("HH:mm", Locale.getDefault())
    return format.format(Date(timestamp))
}

/**
 * Message list with pagination
 */
@Composable
fun PaginatedMessageList(
    messages: List<ProjectChatMessageEntity>,
    hasMore: Boolean,
    isLoadingMore: Boolean,
    onLoadMore: () -> Unit,
    modifier: Modifier = Modifier
) {
    val listState = rememberLazyListState()

    VirtualMessageList(
        messages = messages,
        modifier = modifier,
        listState = listState,
        onLoadMore = if (hasMore && !isLoadingMore) onLoadMore else null
    )
}

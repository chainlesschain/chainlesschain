package com.chainlesschain.android.feature.p2p.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import java.text.SimpleDateFormat
import java.util.*

/**
 * 消息队列状态界面
 *
 * 显示待发送和待接收的消息队列
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MessageQueueScreen(
    outgoingMessages: List<QueuedMessage>,
    incomingMessages: List<QueuedMessage>,
    onBack: () -> Unit,
    onRetryMessage: (String) -> Unit,
    onCancelMessage: (String) -> Unit,
    onClearCompleted: () -> Unit
) {
    var selectedTab by remember { mutableStateOf(0) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("消息队列") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                    }
                },
                actions = {
                    IconButton(onClick = onClearCompleted) {
                        Icon(Icons.Default.CleaningServices, contentDescription = "清理已完成")
                    }
                }
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            // 标签栏
            TabRow(selectedTabIndex = selectedTab) {
                Tab(
                    selected = selectedTab == 0,
                    onClick = { selectedTab = 0 },
                    text = {
                        Row(
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text("发送队列")
                            if (outgoingMessages.isNotEmpty()) {
                                Spacer(modifier = Modifier.width(8.dp))
                                Badge {
                                    Text("${outgoingMessages.size}")
                                }
                            }
                        }
                    }
                )

                Tab(
                    selected = selectedTab == 1,
                    onClick = { selectedTab = 1 },
                    text = {
                        Row(
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text("接收队列")
                            if (incomingMessages.isNotEmpty()) {
                                Spacer(modifier = Modifier.width(8.dp))
                                Badge {
                                    Text("${incomingMessages.size}")
                                }
                            }
                        }
                    }
                )
            }

            // 队列列表
            when (selectedTab) {
                0 -> MessageQueueList(
                    messages = outgoingMessages,
                    isOutgoing = true,
                    onRetry = onRetryMessage,
                    onCancel = onCancelMessage
                )
                1 -> MessageQueueList(
                    messages = incomingMessages,
                    isOutgoing = false,
                    onRetry = onRetryMessage,
                    onCancel = onCancelMessage
                )
            }
        }
    }
}

/**
 * 消息队列列表
 */
@Composable
fun MessageQueueList(
    messages: List<QueuedMessage>,
    isOutgoing: Boolean,
    onRetry: (String) -> Unit,
    onCancel: (String) -> Unit
) {
    if (messages.isEmpty()) {
        // 空状态
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(32.dp),
            contentAlignment = Alignment.Center
        ) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Icon(
                    imageVector = if (isOutgoing) Icons.Default.SendToMobile else Icons.Default.Inbox,
                    contentDescription = null,
                    modifier = Modifier.size(64.dp),
                    tint = MaterialTheme.colorScheme.outline
                )

                Spacer(modifier = Modifier.height(16.dp))

                Text(
                    text = if (isOutgoing) "发送队列为空" else "接收队列为空",
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    } else {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            items(messages, key = { it.id }) { message ->
                QueuedMessageItem(
                    message = message,
                    isOutgoing = isOutgoing,
                    onRetry = { onRetry(message.id) },
                    onCancel = { onCancel(message.id) }
                )
            }
        }
    }
}

/**
 * 队列中的消息项
 */
@Composable
fun QueuedMessageItem(
    message: QueuedMessage,
    isOutgoing: Boolean,
    onRetry: () -> Unit,
    onCancel: () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
        ) {
            // 消息头部
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    // 状态图标
                    MessageStatusIcon(status = message.status)

                    Spacer(modifier = Modifier.width(12.dp))

                    Column {
                        Text(
                            text = if (isOutgoing) "发送至 ${message.peerId}" else "来自 ${message.peerId}",
                            style = MaterialTheme.typography.titleSmall,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )

                        Spacer(modifier = Modifier.height(4.dp))

                        Text(
                            text = formatTimestamp(message.timestamp),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }

                // 优先级徽章
                if (message.priority == MessagePriority.HIGH) {
                    Badge(
                        containerColor = MaterialTheme.colorScheme.error
                    ) {
                        Text("高优先级")
                    }
                }
            }

            Spacer(modifier = Modifier.height(12.dp))

            // 消息内容预览
            Text(
                text = message.preview,
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            // 进度和操作按钮
            when (message.status) {
                MessageStatus.PENDING -> {
                    Spacer(modifier = Modifier.height(12.dp))

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.End
                    ) {
                        TextButton(onClick = onCancel) {
                            Text("取消")
                        }
                    }
                }

                MessageStatus.SENDING, MessageStatus.RECEIVING -> {
                    Spacer(modifier = Modifier.height(12.dp))

                    LinearProgressIndicator(
                        modifier = Modifier.fillMaxWidth()
                    )
                }

                MessageStatus.FAILED -> {
                    Spacer(modifier = Modifier.height(12.dp))

                    // 错误信息
                    message.error?.let { error ->
                        Text(
                            text = "错误: $error",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.error
                        )

                        Spacer(modifier = Modifier.height(8.dp))
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.End
                    ) {
                        TextButton(onClick = onCancel) {
                            Text("删除")
                        }

                        Spacer(modifier = Modifier.width(8.dp))

                        Button(onClick = onRetry) {
                            Icon(
                                imageVector = Icons.Default.Refresh,
                                contentDescription = null,
                                modifier = Modifier.size(18.dp)
                            )
                            Spacer(modifier = Modifier.width(4.dp))
                            Text("重试")
                        }
                    }
                }

                MessageStatus.COMPLETED -> {
                    Spacer(modifier = Modifier.height(8.dp))

                    Row(
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            imageVector = Icons.Default.CheckCircle,
                            contentDescription = null,
                            modifier = Modifier.size(16.dp),
                            tint = MaterialTheme.colorScheme.tertiary
                        )

                        Spacer(modifier = Modifier.width(8.dp))

                        Text(
                            text = if (isOutgoing) "已发送" else "已接收",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.tertiary
                        )
                    }
                }
            }
        }
    }
}

/**
 * 消息状态图标
 */
@Composable
fun MessageStatusIcon(status: MessageStatus) {
    val (icon, tint) = when (status) {
        MessageStatus.PENDING -> Icons.Default.Schedule to MaterialTheme.colorScheme.onSurfaceVariant
        MessageStatus.SENDING, MessageStatus.RECEIVING -> Icons.Default.Sync to MaterialTheme.colorScheme.primary
        MessageStatus.COMPLETED -> Icons.Default.CheckCircle to MaterialTheme.colorScheme.tertiary
        MessageStatus.FAILED -> Icons.Default.Error to MaterialTheme.colorScheme.error
    }

    Icon(
        imageVector = icon,
        contentDescription = status.name,
        modifier = Modifier.size(24.dp),
        tint = tint
    )
}

/**
 * 格式化时间戳
 */
private fun formatTimestamp(timestamp: Long): String {
    val now = System.currentTimeMillis()
    val diff = now - timestamp

    return when {
        diff < 60_000 -> "刚刚"
        diff < 3600_000 -> "${diff / 60_000} 分钟前"
        diff < 86400_000 -> "${diff / 3600_000} 小时前"
        else -> {
            val sdf = SimpleDateFormat("MM-dd HH:mm", Locale.getDefault())
            sdf.format(Date(timestamp))
        }
    }
}

/**
 * 队列消息数据模型
 */
data class QueuedMessage(
    val id: String,
    val peerId: String,
    val preview: String,
    val timestamp: Long,
    val status: MessageStatus,
    val priority: MessagePriority,
    val error: String? = null
)

/**
 * 消息状态
 */
enum class MessageStatus {
    PENDING,    // 等待中
    SENDING,    // 发送中
    RECEIVING,  // 接收中
    COMPLETED,  // 已完成
    FAILED      // 失败
}

/**
 * 消息优先级
 */
enum class MessagePriority {
    LOW,
    NORMAL,
    HIGH
}

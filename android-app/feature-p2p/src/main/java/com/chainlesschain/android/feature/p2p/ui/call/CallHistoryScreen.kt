package com.chainlesschain.android.feature.p2p.ui.call

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import java.text.SimpleDateFormat
import java.util.*

/**
 * 通话历史界面
 *
 * 显示通话历史记录列表
 *
 * 功能：
 * - 显示通话记录
 * - 按时间分组
 * - 通话类型图标（语音/视频）
 * - 通话状态（已接听/未接听/已拨打）
 * - 通话时长
 * - 点击重新拨打
 *
 * @param onNavigateToCall 跳转到通话界面回调
 * @param onNavigateBack 返回回调
 *
 * @since v0.32.0
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CallHistoryScreen(
    onNavigateToCall: (String, Boolean) -> Unit,
    onNavigateBack: () -> Unit
) {
    // TODO: 从ViewModel获取通话历史
    val callHistory = remember { getSampleCallHistory() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("通话历史") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "返回")
                    }
                },
                actions = {
                    IconButton(onClick = { /* TODO: 清空历史 */ }) {
                        Icon(Icons.Default.Delete, contentDescription = "清空历史")
                    }
                }
            )
        }
    ) { paddingValues ->
        if (callHistory.isEmpty()) {
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
                        imageVector = Icons.Default.CallEnd,
                        contentDescription = null,
                        modifier = Modifier.size(64.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Text(
                        text = "暂无通话记录",
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        } else {
            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(paddingValues),
                contentPadding = PaddingValues(vertical = 8.dp)
            ) {
                items(callHistory) { record ->
                    CallHistoryItem(
                        record = record,
                        onClick = {
                            onNavigateToCall(record.peerDid, record.isVideoCall)
                        }
                    )
                    Divider()
                }
            }
        }
    }
}

/**
 * 通话历史项
 */
@Composable
private fun CallHistoryItem(
    record: CallHistoryRecord,
    onClick: () -> Unit
) {
    ListItem(
        headlineContent = {
            Text(
                text = record.peerName,
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.Medium
            )
        },
        supportingContent = {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                // 通话类型图标
                Icon(
                    imageVector = when (record.callType) {
                        CallType.OUTGOING -> Icons.Default.CallMade
                        CallType.INCOMING -> Icons.Default.CallReceived
                        CallType.MISSED -> Icons.Default.CallMissed
                    },
                    contentDescription = null,
                    modifier = Modifier.size(16.dp),
                    tint = when (record.callType) {
                        CallType.MISSED -> Color.Red
                        else -> MaterialTheme.colorScheme.onSurfaceVariant
                    }
                )

                // 时间
                Text(
                    text = formatCallTime(record.timestamp),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )

                // 通话时长
                if (record.duration > 0) {
                    Text(
                        text = " • ${formatDuration(record.duration)}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        },
        leadingContent = {
            Icon(
                imageVector = if (record.isVideoCall) Icons.Default.Videocam else Icons.Default.Call,
                contentDescription = null,
                modifier = Modifier.size(40.dp),
                tint = MaterialTheme.colorScheme.primary
            )
        },
        trailingContent = {
            IconButton(onClick = onClick) {
                Icon(
                    imageVector = if (record.isVideoCall) Icons.Default.Videocam else Icons.Default.Call,
                    contentDescription = "重新拨打",
                    tint = MaterialTheme.colorScheme.primary
                )
            }
        },
        modifier = Modifier
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 8.dp)
    )
}

/**
 * 通话历史记录数据类
 */
data class CallHistoryRecord(
    val id: String,
    val peerDid: String,
    val peerName: String,
    val isVideoCall: Boolean,
    val callType: CallType,
    val timestamp: Long,
    val duration: Long // 秒
)

/**
 * 通话类型
 */
enum class CallType {
    OUTGOING,  // 呼出
    INCOMING,  // 接听
    MISSED     // 未接
}

/**
 * 格式化通话时间
 */
private fun formatCallTime(timestamp: Long): String {
    val now = System.currentTimeMillis()
    val diff = now - timestamp

    return when {
        diff < 60_000 -> "刚刚"
        diff < 3600_000 -> "${diff / 60_000}分钟前"
        diff < 86400_000 -> SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(timestamp))
        diff < 604800_000 -> SimpleDateFormat("E HH:mm", Locale.getDefault()).format(Date(timestamp))
        else -> SimpleDateFormat("MM-dd HH:mm", Locale.getDefault()).format(Date(timestamp))
    }
}

/**
 * 格式化通话时长
 */
private fun formatDuration(seconds: Long): String {
    val hours = seconds / 3600
    val minutes = (seconds % 3600) / 60
    val secs = seconds % 60

    return if (hours > 0) {
        String.format("%d:%02d:%02d", hours, minutes, secs)
    } else {
        String.format("%02d:%02d", minutes, secs)
    }
}

/**
 * 示例数据（用于测试）
 */
private fun getSampleCallHistory(): List<CallHistoryRecord> {
    val now = System.currentTimeMillis()
    return listOf(
        CallHistoryRecord(
            id = "1",
            peerDid = "did:example:alice",
            peerName = "Alice",
            isVideoCall = true,
            callType = CallType.OUTGOING,
            timestamp = now - 3600_000,
            duration = 320
        ),
        CallHistoryRecord(
            id = "2",
            peerDid = "did:example:bob",
            peerName = "Bob",
            isVideoCall = false,
            callType = CallType.INCOMING,
            timestamp = now - 7200_000,
            duration = 180
        ),
        CallHistoryRecord(
            id = "3",
            peerDid = "did:example:charlie",
            peerName = "Charlie",
            isVideoCall = false,
            callType = CallType.MISSED,
            timestamp = now - 86400_000,
            duration = 0
        )
    )
}

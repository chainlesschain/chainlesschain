package com.chainlesschain.android.feature.p2p.ui.social.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.chainlesschain.android.core.database.entity.social.NotificationEntity
import com.chainlesschain.android.core.database.entity.social.NotificationType
import java.text.SimpleDateFormat
import java.util.*

/**
 * 通知卡片组件
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NotificationCard(
    notification: NotificationEntity,
    onClick: () -> Unit,
    onLongClick: () -> Unit = {},
    modifier: Modifier = Modifier
) {
    val (icon, iconColor) = getNotificationIcon(notification.type)

    Card(
        modifier = modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        colors = CardDefaults.cardColors(
            containerColor = if (notification.isRead) {
                MaterialTheme.colorScheme.surface
            } else {
                MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.3f)
            }
        )
    ) {
        Row(
            modifier = Modifier
                .padding(16.dp)
                .fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // 通知图标
            Box(
                modifier = Modifier
                    .size(48.dp)
                    .background(
                        color = iconColor.copy(alpha = 0.2f),
                        shape = MaterialTheme.shapes.medium
                    ),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = icon,
                    contentDescription = null,
                    tint = iconColor,
                    modifier = Modifier.size(24.dp)
                )
            }

            // 通知内容
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = notification.title,
                        style = MaterialTheme.typography.titleSmall,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f)
                    )

                    // 未读标识
                    if (!notification.isRead) {
                        Box(
                            modifier = Modifier
                                .size(8.dp)
                                .background(
                                    color = MaterialTheme.colorScheme.primary,
                                    shape = MaterialTheme.shapes.small
                                )
                        )
                    }
                }

                Text(
                    text = notification.content,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )

                Text(
                    text = formatNotificationTime(notification.createdAt),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

/**
 * 紧凑型通知卡片（用于列表）
 */
@Composable
fun CompactNotificationCard(
    notification: NotificationEntity,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    val (icon, iconColor) = getNotificationIcon(notification.type)

    Surface(
        modifier = modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        color = if (notification.isRead) {
            MaterialTheme.colorScheme.surface
        } else {
            MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.2f)
        }
    ) {
        Row(
            modifier = Modifier
                .padding(12.dp)
                .fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // 图标
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = iconColor,
                modifier = Modifier.size(20.dp)
            )

            // 内容
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(2.dp)
            ) {
                Text(
                    text = notification.title,
                    style = MaterialTheme.typography.bodyMedium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )

                Text(
                    text = notification.content,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }

            // 时间和未读标识
            Column(
                horizontalAlignment = Alignment.End,
                verticalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                Text(
                    text = formatCompactTime(notification.createdAt),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )

                if (!notification.isRead) {
                    Box(
                        modifier = Modifier
                            .size(8.dp)
                            .background(
                                color = MaterialTheme.colorScheme.primary,
                                shape = MaterialTheme.shapes.small
                            )
                    )
                }
            }
        }
    }
}

/**
 * 通知类型徽章
 */
@Composable
fun NotificationTypeBadge(
    type: NotificationType,
    count: Int,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    val (icon, iconColor) = getNotificationIcon(type)
    val label = getNotificationTypeLabel(type)

    FilterChip(
        selected = false,
        onClick = onClick,
        label = {
            Row(
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(label)
                if (count > 0) {
                    Badge {
                        Text(if (count > 99) "99+" else count.toString())
                    }
                }
            }
        },
        leadingIcon = {
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = iconColor,
                modifier = Modifier.size(18.dp)
            )
        },
        modifier = modifier
    )
}

/**
 * 获取通知图标和颜色
 */
private fun getNotificationIcon(type: NotificationType): Pair<ImageVector, androidx.compose.ui.graphics.Color> {
    return when (type) {
        NotificationType.FRIEND_REQUEST -> Icons.Default.PersonAdd to androidx.compose.ui.graphics.Color(0xFF2196F3)
        NotificationType.FRIEND_ACCEPTED -> Icons.Default.Check to androidx.compose.ui.graphics.Color(0xFF4CAF50)
        NotificationType.POST_LIKED -> Icons.Default.Favorite to androidx.compose.ui.graphics.Color(0xFFE91E63)
        NotificationType.POST_COMMENTED -> Icons.Default.Comment to androidx.compose.ui.graphics.Color(0xFF9C27B0)
        NotificationType.COMMENT_REPLIED -> Icons.Default.Reply to androidx.compose.ui.graphics.Color(0xFF673AB7)
        NotificationType.POST_MENTIONED -> Icons.Default.AlternateEmail to androidx.compose.ui.graphics.Color(0xFF00BCD4)
        NotificationType.POST_SHARED -> Icons.Default.Share to androidx.compose.ui.graphics.Color(0xFFFF9800)
        NotificationType.SYSTEM -> Icons.Default.Info to androidx.compose.ui.graphics.Color(0xFF607D8B)
    }
}

/**
 * 获取通知类型标签
 */
private fun getNotificationTypeLabel(type: NotificationType): String {
    return when (type) {
        NotificationType.FRIEND_REQUEST -> "好友请求"
        NotificationType.FRIEND_ACCEPTED -> "好友已接受"
        NotificationType.POST_LIKED -> "点赞"
        NotificationType.POST_COMMENTED -> "评论"
        NotificationType.COMMENT_REPLIED -> "回复"
        NotificationType.POST_MENTIONED -> "提及"
        NotificationType.POST_SHARED -> "分享"
        NotificationType.SYSTEM -> "系统"
    }
}

/**
 * 格式化通知时间
 */
private fun formatNotificationTime(timestamp: Long): String {
    val diff = System.currentTimeMillis() - timestamp
    return when {
        diff < 60 * 1000 -> "刚刚"
        diff < 60 * 60 * 1000 -> "${diff / (60 * 1000)}分钟前"
        diff < 24 * 60 * 60 * 1000 -> "${diff / (60 * 60 * 1000)}小时前"
        diff < 7 * 24 * 60 * 60 * 1000 -> "${diff / (24 * 60 * 60 * 1000)}天前"
        else -> SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.getDefault()).format(Date(timestamp))
    }
}

/**
 * 格式化紧凑型时间
 */
private fun formatCompactTime(timestamp: Long): String {
    val diff = System.currentTimeMillis() - timestamp
    return when {
        diff < 60 * 1000 -> "刚刚"
        diff < 60 * 60 * 1000 -> "${diff / (60 * 1000)}分"
        diff < 24 * 60 * 60 * 1000 -> "${diff / (60 * 60 * 1000)}时"
        diff < 7 * 24 * 60 * 60 * 1000 -> "${diff / (24 * 60 * 60 * 1000)}天"
        else -> SimpleDateFormat("MM-dd", Locale.getDefault()).format(Date(timestamp))
    }
}

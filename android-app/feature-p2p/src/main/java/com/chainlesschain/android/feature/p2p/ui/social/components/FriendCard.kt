package com.chainlesschain.android.feature.p2p.ui.social.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.chainlesschain.android.core.database.entity.social.FriendEntity
import com.chainlesschain.android.core.database.entity.social.FriendStatus
import com.chainlesschain.android.core.ui.image.Avatar
import com.chainlesschain.android.core.ui.image.AvatarSize
import java.text.SimpleDateFormat
import java.util.*

/**
 * 好友卡片组件
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FriendCard(
    friend: FriendEntity,
    onClick: () -> Unit,
    onLongClick: () -> Unit = {},
    modifier: Modifier = Modifier,
    showStatus: Boolean = true
) {
    Card(
        modifier = modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant
        )
    ) {
        Row(
            modifier = Modifier
                .padding(16.dp)
                .fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // 头像
            AvatarImage(
                avatar = friend.avatar,
                nickname = friend.nickname,
                size = 48.dp,
                showOnlineStatus = showStatus,
                isOnline = friend.lastActiveAt != null &&
                        System.currentTimeMillis() - friend.lastActiveAt < 5 * 60 * 1000
            )

            // 好友信息
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                // 显示名称（备注名或昵称）
                Text(
                    text = friend.remarkName ?: friend.nickname,
                    style = MaterialTheme.typography.titleMedium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )

                // 原昵称（如果有备注名）
                if (friend.remarkName != null) {
                    Text(
                        text = friend.nickname,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }

                // 个人简介
                friend.bio?.let { bio ->
                    Text(
                        text = bio,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }

                // 最后活跃时间
                if (showStatus && friend.lastActiveAt != null) {
                    Text(
                        text = formatLastActiveTime(friend.lastActiveAt),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            // 状态图标
            if (friend.status == FriendStatus.PENDING) {
                Icon(
                    imageVector = Icons.Default.HourglassEmpty,
                    contentDescription = "待处理",
                    tint = MaterialTheme.colorScheme.tertiary
                )
            } else if (friend.isBlocked) {
                Icon(
                    imageVector = Icons.Default.Block,
                    contentDescription = "已屏蔽",
                    tint = MaterialTheme.colorScheme.error
                )
            }
        }
    }
}

/**
 * 头像图片组件（带在线状态）
 */
@Composable
fun AvatarImage(
    avatar: String?,
    nickname: String,
    size: androidx.compose.ui.unit.Dp,
    modifier: Modifier = Modifier,
    showOnlineStatus: Boolean = false,
    isOnline: Boolean = false
) {
    Box(modifier = modifier) {
        // 头像
        val avatarSize = when {
            size <= 32.dp -> AvatarSize.SMALL
            size <= 48.dp -> AvatarSize.MEDIUM
            size <= 64.dp -> AvatarSize.LARGE
            else -> AvatarSize.EXTRA_LARGE
        }

        Avatar(
            avatarUrl = avatar,
            name = nickname,
            size = avatarSize
        )

        // 在线状态指示器
        if (showOnlineStatus && isOnline) {
            Box(
                modifier = Modifier
                    .size(12.dp)
                    .align(Alignment.BottomEnd)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.primary)
                    .padding(2.dp)
            )
        }
    }
}

/**
 * 好友请求卡片
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FriendRequestCard(
    friend: FriendEntity,
    onAccept: () -> Unit,
    onReject: () -> Unit,
    modifier: Modifier = Modifier
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant
        )
    ) {
        Row(
            modifier = Modifier
                .padding(16.dp)
                .fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // 头像
            AvatarImage(
                avatar = friend.avatar,
                nickname = friend.nickname,
                size = 48.dp
            )

            // 好友信息
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                Text(
                    text = friend.nickname,
                    style = MaterialTheme.typography.titleMedium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )

                friend.bio?.let { bio ->
                    Text(
                        text = bio,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis
                    )
                }

                Text(
                    text = formatAddedTime(friend.addedAt),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }

        // 操作按钮
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            OutlinedButton(
                onClick = onReject,
                modifier = Modifier.weight(1f)
            ) {
                Text("拒绝")
            }

            Button(
                onClick = onAccept,
                modifier = Modifier.weight(1f)
            ) {
                Text("接受")
            }
        }
    }
}

/**
 * 格式化最后活跃时间
 */
private fun formatLastActiveTime(timestamp: Long): String {
    val diff = System.currentTimeMillis() - timestamp
    return when {
        diff < 60 * 1000 -> "刚刚在线"
        diff < 5 * 60 * 1000 -> "在线"
        diff < 60 * 60 * 1000 -> "${diff / (60 * 1000)}分钟前在线"
        diff < 24 * 60 * 60 * 1000 -> "${diff / (60 * 60 * 1000)}小时前在线"
        diff < 7 * 24 * 60 * 60 * 1000 -> "${diff / (24 * 60 * 60 * 1000)}天前在线"
        else -> SimpleDateFormat("MM-dd", Locale.getDefault()).format(Date(timestamp))
    }
}

/**
 * 格式化添加时间
 */
private fun formatAddedTime(timestamp: Long): String {
    val diff = System.currentTimeMillis() - timestamp
    return when {
        diff < 60 * 1000 -> "刚刚"
        diff < 60 * 60 * 1000 -> "${diff / (60 * 1000)}分钟前"
        diff < 24 * 60 * 60 * 1000 -> "${diff / (60 * 60 * 1000)}小时前"
        diff < 7 * 24 * 60 * 60 * 1000 -> "${diff / (24 * 60 * 60 * 1000)}天前"
        else -> SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(Date(timestamp))
    }
}

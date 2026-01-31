package com.chainlesschain.android.feature.p2p.ui.social.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.chainlesschain.android.core.database.entity.social.PostEntity
import com.chainlesschain.android.core.database.entity.social.PostVisibility
import com.chainlesschain.android.core.ui.image.Avatar
import com.chainlesschain.android.core.ui.image.AvatarSize
import com.chainlesschain.android.core.ui.image.ImageGrid
import com.chainlesschain.android.core.ui.image.ImagePreviewDialog
import com.chainlesschain.android.feature.p2p.util.PostEditPolicy
import java.text.SimpleDateFormat
import java.util.*

/**
 * 优化后的动态卡片组件 - Phase 7.3
 *
 * 性能优化要点：
 * 1. 使用remember缓存计算结果，避免不必要的重新计算
 * 2. 拆分为更小的Composable，减少重组范围
 * 3. 使用derivedStateOf处理派生状态
 * 4. 避免在Composable中直接调用耗时函数
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PostCardOptimized(
    post: PostEntity,
    authorNickname: String,
    authorAvatar: String? = null,
    onPostClick: () -> Unit,
    onAuthorClick: () -> Unit,
    onLikeClick: () -> Unit,
    onCommentClick: () -> Unit,
    onShareClick: () -> Unit,
    onMoreClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    var showImagePreview by remember { mutableStateOf(false) }
    var selectedImageIndex by remember { mutableStateOf(0) }

    Card(
        modifier = modifier
            .fillMaxWidth()
            .clickable(onClick = onPostClick),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface
        )
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            // 作者信息栏 - 独立组件，仅在相关数据变化时重组
            PostAuthorHeader(
                post = post,
                authorNickname = authorNickname,
                authorAvatar = authorAvatar,
                onAuthorClick = onAuthorClick,
                onMoreClick = onMoreClick
            )

            // 动态内容 - 独立组件
            PostContent(
                content = post.content,
                images = post.images,
                tags = post.tags,
                onImageClick = { index ->
                    selectedImageIndex = index
                    showImagePreview = true
                }
            )

            Divider()

            // 互动按钮栏 - 独立组件，仅在互动数据变化时重组
            PostActionBar(
                post = post,
                onLikeClick = onLikeClick,
                onCommentClick = onCommentClick,
                onShareClick = onShareClick
            )
        }
    }

    // 图片预览对话框
    if (showImagePreview) {
        ImagePreviewDialog(
            images = post.images,
            initialIndex = selectedImageIndex,
            onDismiss = { showImagePreview = false }
        )
    }
}

/**
 * 作者信息头部 - 独立组件
 * 仅在author、nickname、post.isPinned、post.visibility、post.createdAt、post.lastEditedAt变化时重组
 */
@Composable
private fun PostAuthorHeader(
    post: PostEntity,
    authorNickname: String,
    authorAvatar: String?,
    onAuthorClick: () -> Unit,
    onMoreClick: () -> Unit
) {
    // 使用remember缓存时间格式化结果，仅在createdAt变化时重新计算
    val formattedTime = remember(post.createdAt) {
        formatPostTime(post.createdAt)
    }

    // 使用remember缓存编辑状态，仅在updatedAt变化时重新计算
    val isEdited = remember(post.updatedAt) {
        PostEditPolicy.isEdited(post)
    }

    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        // 作者头像
        Avatar(
            avatarUrl = authorAvatar,
            name = authorNickname,
            size = AvatarSize.MEDIUM,
            modifier = Modifier.clickable(onClick = onAuthorClick)
        )

        // 作者信息
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(2.dp)
        ) {
            // 作者名和状态标识
            AuthorNameRow(
                authorNickname = authorNickname,
                isPinned = post.isPinned,
                visibility = post.visibility
            )

            // 时间和编辑标签
            PostTimeRow(
                formattedTime = formattedTime,
                isEdited = isEdited
            )
        }

        // 更多菜单
        IconButton(onClick = onMoreClick) {
            Icon(
                imageVector = Icons.Default.MoreVert,
                contentDescription = "更多"
            )
        }
    }
}

/**
 * 作者名和状态标识行 - 进一步拆分，减少重组范围
 */
@Composable
private fun AuthorNameRow(
    authorNickname: String,
    isPinned: Boolean,
    visibility: PostVisibility
) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = authorNickname,
            style = MaterialTheme.typography.titleSmall,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )

        // 置顶标识
        if (isPinned) {
            Icon(
                imageVector = Icons.Default.PushPin,
                contentDescription = "置顶",
                modifier = Modifier.size(14.dp),
                tint = MaterialTheme.colorScheme.primary
            )
        }

        // 可见性图标
        when (visibility) {
            PostVisibility.PRIVATE -> {
                Icon(
                    imageVector = Icons.Default.Lock,
                    contentDescription = "私密",
                    modifier = Modifier.size(14.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            PostVisibility.FRIENDS_ONLY -> {
                Icon(
                    imageVector = Icons.Default.Group,
                    contentDescription = "仅好友",
                    modifier = Modifier.size(14.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            PostVisibility.PUBLIC -> { /* 公开不显示图标 */ }
        }
    }
}

/**
 * 时间和编辑标签行 - 独立组件
 */
@Composable
private fun PostTimeRow(
    formattedTime: String,
    isEdited: Boolean
) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = formattedTime,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )

        // 已编辑标签
        if (isEdited) {
            Text(
                text = "·",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Text(
                text = "已编辑",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.primary
            )
        }
    }
}

/**
 * 动态内容 - 独立组件
 * 仅在content、images、tags变化时重组
 */
@Composable
private fun PostContent(
    content: String,
    images: List<String>,
    tags: List<String>,
    onImageClick: (Int) -> Unit
) {
    Column(
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        // 文本内容
        Text(
            text = content,
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.fillMaxWidth()
        )

        // 图片网格（如果有）
        if (images.isNotEmpty()) {
            ImageGrid(
                images = images,
                modifier = Modifier.fillMaxWidth(),
                onImageClick = { index, _ ->
                    onImageClick(index)
                }
            )
        }

        // 标签
        if (tags.isNotEmpty()) {
            PostTagsRow(tags = tags)
        }
    }
}

/**
 * 标签行 - 独立组件
 */
@Composable
private fun PostTagsRow(tags: List<String>) {
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier.fillMaxWidth()
    ) {
        tags.forEach { tag ->
            AssistChip(
                onClick = { /* TODO: 点击标签筛选 */ },
                label = { Text("#$tag") },
                leadingIcon = {
                    Icon(
                        imageVector = Icons.Default.Tag,
                        contentDescription = null,
                        modifier = Modifier.size(16.dp)
                    )
                }
            )
        }
    }
}

/**
 * 互动按钮栏 - 独立组件
 * 仅在isLiked、likeCount、commentCount、shareCount变化时重组
 */
@Composable
private fun PostActionBar(
    post: PostEntity,
    onLikeClick: () -> Unit,
    onCommentClick: () -> Unit,
    onShareClick: () -> Unit
) {
    // 使用remember缓存格式化结果，仅在对应count变化时重新计算
    val formattedLikeCount = remember(post.likeCount) {
        formatCount(post.likeCount)
    }
    val formattedCommentCount = remember(post.commentCount) {
        formatCount(post.commentCount)
    }
    val formattedShareCount = remember(post.shareCount) {
        formatCount(post.shareCount)
    }

    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceEvenly
    ) {
        // 点赞
        InteractionButton(
            icon = if (post.isLiked) Icons.Filled.Favorite else Icons.Outlined.FavoriteBorder,
            text = formattedLikeCount,
            onClick = onLikeClick,
            tint = if (post.isLiked)
                MaterialTheme.colorScheme.error
            else
                MaterialTheme.colorScheme.onSurfaceVariant
        )

        // 评论
        InteractionButton(
            icon = Icons.Outlined.ChatBubbleOutline,
            text = formattedCommentCount,
            onClick = onCommentClick
        )

        // 转发
        InteractionButton(
            icon = Icons.Outlined.Share,
            text = formattedShareCount,
            onClick = onShareClick
        )
    }
}

/**
 * 互动按钮组件
 */
@Composable
private fun InteractionButton(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    text: String,
    onClick: () -> Unit,
    tint: androidx.compose.ui.graphics.Color = MaterialTheme.colorScheme.onSurfaceVariant
) {
    TextButton(
        onClick = onClick,
        colors = ButtonDefaults.textButtonColors(
            contentColor = tint
        )
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            modifier = Modifier.size(20.dp)
        )
        Spacer(modifier = Modifier.width(4.dp))
        Text(
            text = text,
            style = MaterialTheme.typography.labelMedium
        )
    }
}

/**
 * FlowRow 实现
 */
@Composable
private fun FlowRow(
    modifier: Modifier = Modifier,
    horizontalArrangement: Arrangement.Horizontal = Arrangement.Start,
    content: @Composable () -> Unit
) {
    // 简化实现，实际应该使用 FlowLayout
    Row(
        modifier = modifier,
        horizontalArrangement = horizontalArrangement
    ) {
        content()
    }
}

/**
 * 格式化动态时间
 *
 * 性能优化：使用智能时间格式化，减少精确度计算
 */
private fun formatPostTime(timestamp: Long): String {
    val diff = System.currentTimeMillis() - timestamp
    return when {
        diff < 60 * 1000 -> "刚刚"
        diff < 60 * 60 * 1000 -> "${diff / (60 * 1000)}分钟前"
        diff < 24 * 60 * 60 * 1000 -> "${diff / (60 * 60 * 1000)}小时前"
        diff < 7 * 24 * 60 * 60 * 1000 -> "${diff / (24 * 60 * 60 * 1000)}天前"
        else -> SimpleDateFormat("MM-dd HH:mm", Locale.getDefault()).format(Date(timestamp))
    }
}

/**
 * 格式化数量显示
 */
private fun formatCount(count: Int): String {
    return when {
        count == 0 -> ""
        count < 1000 -> count.toString()
        count < 10000 -> String.format("%.1fk", count / 1000.0)
        else -> String.format("%.1fw", count / 10000.0)
    }
}

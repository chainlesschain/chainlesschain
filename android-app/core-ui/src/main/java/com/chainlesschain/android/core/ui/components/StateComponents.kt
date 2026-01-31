package com.chainlesschain.android.core.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

/**
 * 空状态组件
 *
 * 用于显示列表为空、搜索无结果等场景
 *
 * @param icon 图标
 * @param title 标题
 * @param description 描述
 * @param actionText 操作按钮文字（可选）
 * @param onAction 操作按钮点击事件（可选）
 */
@Composable
fun EmptyState(
    icon: ImageVector = Icons.Default.SearchOff,
    title: String,
    description: String? = null,
    actionText: String? = null,
    onAction: (() -> Unit)? = null,
    modifier: Modifier = Modifier
) {
    Box(
        modifier = modifier.fillMaxSize(),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp),
            modifier = Modifier
                .padding(horizontal = 32.dp)
                .widthIn(max = 400.dp)
        ) {
            // 图标
            Icon(
                imageVector = icon,
                contentDescription = null,
                modifier = Modifier.size(80.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f)
            )

            // 标题
            Text(
                text = title,
                style = MaterialTheme.typography.titleLarge,
                color = MaterialTheme.colorScheme.onSurface,
                textAlign = TextAlign.Center
            )

            // 描述
            description?.let {
                Text(
                    text = it,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center
                )
            }

            // 操作按钮
            if (actionText != null && onAction != null) {
                Spacer(modifier = Modifier.height(8.dp))
                Button(onClick = onAction) {
                    Text(actionText)
                }
            }
        }
    }
}

/**
 * 错误状态组件
 *
 * 用于显示网络错误、加载失败等场景
 *
 * @param title 标题
 * @param description 错误描述
 * @param onRetry 重试按钮点击事件（可选）
 */
@Composable
fun ErrorState(
    title: String = "出错了",
    description: String = "加载失败，请稍后重试",
    onRetry: (() -> Unit)? = null,
    modifier: Modifier = Modifier
) {
    Box(
        modifier = modifier.fillMaxSize(),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp),
            modifier = Modifier
                .padding(horizontal = 32.dp)
                .widthIn(max = 400.dp)
        ) {
            // 错误图标
            Icon(
                imageVector = Icons.Default.ErrorOutline,
                contentDescription = null,
                modifier = Modifier.size(80.dp),
                tint = MaterialTheme.colorScheme.error
            )

            // 标题
            Text(
                text = title,
                style = MaterialTheme.typography.titleLarge,
                color = MaterialTheme.colorScheme.onSurface,
                textAlign = TextAlign.Center
            )

            // 描述
            Text(
                text = description,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center
            )

            // 重试按钮
            onRetry?.let {
                Spacer(modifier = Modifier.height(8.dp))
                Button(onClick = it) {
                    Icon(
                        imageVector = Icons.Default.Refresh,
                        contentDescription = null,
                        modifier = Modifier.size(18.dp)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("重试")
                }
            }
        }
    }
}

/**
 * 加载状态组件
 *
 * 用于显示数据加载中的状态
 *
 * @param message 加载提示文字（可选）
 */
@Composable
fun LoadingState(
    message: String? = "加载中...",
    modifier: Modifier = Modifier
) {
    Box(
        modifier = modifier.fillMaxSize(),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            CircularProgressIndicator()

            message?.let {
                Text(
                    text = it,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

/**
 * 全屏状态容器
 *
 * 根据 UIState 自动显示加载、错误或内容
 *
 * @param isLoading 是否加载中
 * @param isError 是否错误
 * @param errorMessage 错误信息
 * @param isEmpty 内容是否为空
 * @param emptyMessage 空状态提示
 * @param onRetry 重试回调
 * @param content 内容 Composable
 */
@Composable
fun StateContainer(
    isLoading: Boolean,
    isError: Boolean = false,
    errorMessage: String? = null,
    isEmpty: Boolean = false,
    emptyMessage: String? = null,
    emptyIcon: ImageVector = Icons.Default.Inbox,
    onRetry: (() -> Unit)? = null,
    onEmptyAction: (() -> Unit)? = null,
    emptyActionText: String? = null,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit
) {
    Box(modifier = modifier.fillMaxSize()) {
        // 加载状态
        AnimatedVisibility(
            visible = isLoading,
            enter = fadeIn(),
            exit = fadeOut()
        ) {
            LoadingState()
        }

        // 错误状态
        AnimatedVisibility(
            visible = !isLoading && isError,
            enter = fadeIn(),
            exit = fadeOut()
        ) {
            ErrorState(
                description = errorMessage ?: "加载失败，请稍后重试",
                onRetry = onRetry
            )
        }

        // 空状态
        AnimatedVisibility(
            visible = !isLoading && !isError && isEmpty,
            enter = fadeIn(),
            exit = fadeOut()
        ) {
            EmptyState(
                icon = emptyIcon,
                title = emptyMessage ?: "暂无数据",
                description = "这里空空如也",
                actionText = emptyActionText,
                onAction = onEmptyAction
            )
        }

        // 内容
        AnimatedVisibility(
            visible = !isLoading && !isError && !isEmpty,
            enter = fadeIn(),
            exit = fadeOut()
        ) {
            content()
        }
    }
}

/**
 * 常用的空状态图标
 */
object EmptyStateIcons {
    val NoData = Icons.Default.Inbox
    val NoSearch = Icons.Default.SearchOff
    val NoNotification = Icons.Default.NotificationsNone
    val NoMessage = Icons.Default.MailOutline
    val NoBookmark = Icons.Default.BookmarkBorder
    val NoFavorite = Icons.Default.FavoriteBorder
    val NoFile = Icons.Default.InsertDriveFile
    val NoPhoto = Icons.Default.PhotoLibrary
}

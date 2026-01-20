package com.chainlesschain.android.feature.project.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Language
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.chainlesschain.android.feature.project.model.ChatContextMode

/**
 * 上下文模式切换器组件
 * 允许用户在项目/文件/全局三种模式间切换
 */
@Composable
fun ContextModeSwitcher(
    currentMode: ChatContextMode,
    onModeChange: (ChatContextMode) -> Unit,
    currentFileName: String? = null,
    modifier: Modifier = Modifier
) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
        shape = RoundedCornerShape(12.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(4.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            ChatContextMode.entries.forEach { mode ->
                ContextModeItem(
                    mode = mode,
                    isSelected = currentMode == mode,
                    onClick = { onModeChange(mode) },
                    currentFileName = if (mode == ChatContextMode.FILE) currentFileName else null,
                    modifier = Modifier.weight(1f)
                )
            }
        }
    }
}

@Composable
private fun ContextModeItem(
    mode: ChatContextMode,
    isSelected: Boolean,
    onClick: () -> Unit,
    currentFileName: String?,
    modifier: Modifier = Modifier
) {
    val backgroundColor by animateColorAsState(
        targetValue = if (isSelected) {
            MaterialTheme.colorScheme.primary
        } else {
            MaterialTheme.colorScheme.surface
        },
        label = "backgroundColor"
    )

    val contentColor by animateColorAsState(
        targetValue = if (isSelected) {
            MaterialTheme.colorScheme.onPrimary
        } else {
            MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f)
        },
        label = "contentColor"
    )

    Box(
        modifier = modifier
            .clip(RoundedCornerShape(8.dp))
            .background(backgroundColor)
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 8.dp),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(2.dp)
        ) {
            Icon(
                imageVector = mode.getIcon(),
                contentDescription = mode.getDisplayName(),
                tint = contentColor,
                modifier = Modifier.size(18.dp)
            )
            Text(
                text = if (mode == ChatContextMode.FILE && currentFileName != null) {
                    currentFileName
                } else {
                    mode.getDisplayName()
                },
                style = MaterialTheme.typography.labelSmall,
                fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
                color = contentColor,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}

/**
 * 紧凑版上下文模式切换器（用于聊天顶部）
 */
@Composable
fun CompactContextModeSwitcher(
    currentMode: ChatContextMode,
    onModeChange: (ChatContextMode) -> Unit,
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier
            .clip(RoundedCornerShape(16.dp))
            .border(
                width = 1.dp,
                color = MaterialTheme.colorScheme.outline.copy(alpha = 0.3f),
                shape = RoundedCornerShape(16.dp)
            )
            .padding(2.dp),
        horizontalArrangement = Arrangement.spacedBy(2.dp)
    ) {
        ChatContextMode.entries.forEach { mode ->
            CompactModeChip(
                mode = mode,
                isSelected = currentMode == mode,
                onClick = { onModeChange(mode) }
            )
        }
    }
}

@Composable
private fun CompactModeChip(
    mode: ChatContextMode,
    isSelected: Boolean,
    onClick: () -> Unit
) {
    val backgroundColor by animateColorAsState(
        targetValue = if (isSelected) {
            MaterialTheme.colorScheme.primaryContainer
        } else {
            MaterialTheme.colorScheme.surface
        },
        label = "backgroundColor"
    )

    val contentColor by animateColorAsState(
        targetValue = if (isSelected) {
            MaterialTheme.colorScheme.onPrimaryContainer
        } else {
            MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
        },
        label = "contentColor"
    )

    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(14.dp))
            .background(backgroundColor)
            .clickable(onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 4.dp),
        contentAlignment = Alignment.Center
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            Icon(
                imageVector = mode.getIcon(),
                contentDescription = null,
                tint = contentColor,
                modifier = Modifier.size(14.dp)
            )
            Text(
                text = mode.getDisplayName(),
                style = MaterialTheme.typography.labelSmall,
                color = contentColor,
                fontWeight = if (isSelected) FontWeight.Medium else FontWeight.Normal
            )
        }
    }
}

/**
 * 获取模式对应的图标
 */
private fun ChatContextMode.getIcon(): ImageVector = when (this) {
    ChatContextMode.PROJECT -> Icons.Default.Folder
    ChatContextMode.FILE -> Icons.Default.Description
    ChatContextMode.GLOBAL -> Icons.Default.Language
}

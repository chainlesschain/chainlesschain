package com.chainlesschain.android.core.ui.image

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage

/**
 * 头像尺寸枚举
 */
enum class AvatarSize(val size: Dp, val textSize: TextUnit) {
    SMALL(32.dp, 14.sp),
    MEDIUM(48.dp, 18.sp),
    LARGE(64.dp, 24.sp),
    EXTRA_LARGE(96.dp, 32.sp)
}

/**
 * 用户头像组件
 *
 * 如果有头像 URL 则显示图片，否则显示用户名首字母
 *
 * @param avatarUrl 头像 URL（可为空）
 * @param name 用户名（用于生成首字母）
 * @param size 头像尺寸
 * @param modifier Modifier
 * @param backgroundColor 背景色（当无头像时）
 */
@Composable
fun Avatar(
    avatarUrl: String?,
    name: String,
    size: AvatarSize = AvatarSize.MEDIUM,
    modifier: Modifier = Modifier,
    backgroundColor: Color = MaterialTheme.colorScheme.primaryContainer
) {
    Box(
        modifier = modifier
            .size(size.size)
            .clip(CircleShape)
            .background(backgroundColor),
        contentAlignment = Alignment.Center
    ) {
        if (!avatarUrl.isNullOrBlank()) {
            // 显示头像图片
            AsyncImage(
                model = avatarUrl,
                contentDescription = "$name 的头像",
                modifier = Modifier
                    .size(size.size)
                    .clip(CircleShape),
                contentScale = ContentScale.Crop
            )
        } else {
            // 显示首字母
            Text(
                text = getInitials(name),
                color = MaterialTheme.colorScheme.onPrimaryContainer,
                fontSize = size.textSize,
                fontWeight = FontWeight.Medium
            )
        }
    }
}

/**
 * 获取用户名的首字母
 *
 * 规则：
 * - 中文：取第一个字符
 * - 英文：取前两个单词的首字母（大写）
 * - 其他：取第一个字符
 *
 * @param name 用户名
 * @return 首字母（1-2 个字符）
 */
private fun getInitials(name: String): String {
    if (name.isBlank()) return "?"

    val trimmed = name.trim()

    // 中文字符
    if (trimmed[0].code in 0x4E00..0x9FFF) {
        return trimmed.take(1)
    }

    // 英文或其他
    val words = trimmed.split(Regex("\\s+"))
    return if (words.size >= 2) {
        // 两个单词取首字母
        words.take(2).mapNotNull { it.firstOrNull()?.uppercase() }.joinToString("")
    } else {
        // 单个单词取前两个字符
        trimmed.take(2).uppercase()
    }
}

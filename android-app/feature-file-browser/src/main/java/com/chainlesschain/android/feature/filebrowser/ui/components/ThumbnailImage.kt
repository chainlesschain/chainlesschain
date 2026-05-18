package com.chainlesschain.android.feature.filebrowser.ui.components

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.BrokenImage
import androidx.compose.material.icons.filled.Image
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.chainlesschain.android.feature.filebrowser.cache.ThumbnailCache
import kotlinx.coroutines.launch

/**
 * 缩略图组件
 *
 * 功能:
 * - 异步加载缩略图
 * - 使用LRU缓存
 * - 显示加载状态
 * - 错误处理
 */
@Composable
fun ThumbnailImage(
    uri: String,
    thumbnailCache: ThumbnailCache,
    modifier: Modifier = Modifier,
    size: Dp = 48.dp,
    contentDescription: String? = null
) {
    val context = LocalContext.current
    val contentResolver = context.contentResolver

    var thumbnailState by remember(uri) {
        mutableStateOf<ThumbnailState>(ThumbnailState.Loading)
    }

    val coroutineScope = rememberCoroutineScope()

    // Load thumbnail
    LaunchedEffect(uri) {
        coroutineScope.launch {
            thumbnailState = ThumbnailState.Loading

            val bitmap = thumbnailCache.loadThumbnail(contentResolver, uri)

            thumbnailState = if (bitmap != null) {
                ThumbnailState.Success(bitmap)
            } else {
                ThumbnailState.Error
            }
        }
    }

    Box(
        modifier = modifier
            .size(size)
            .background(
                MaterialTheme.colorScheme.surfaceVariant,
                MaterialTheme.shapes.small
            ),
        contentAlignment = Alignment.Center
    ) {
        when (val state = thumbnailState) {
            is ThumbnailState.Loading -> {
                CircularProgressIndicator(
                    modifier = Modifier.size(size / 2),
                    strokeWidth = 2.dp
                )
            }

            is ThumbnailState.Success -> {
                Image(
                    bitmap = state.bitmap.asImageBitmap(),
                    contentDescription = contentDescription,
                    modifier = Modifier.fillMaxSize(),
                    contentScale = ContentScale.Crop
                )
            }

            is ThumbnailState.Error -> {
                Icon(
                    imageVector = Icons.Default.BrokenImage,
                    contentDescription = "加载失败",
                    modifier = Modifier.size(size / 2),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
                )
            }
        }
    }
}

/**
 * 缩略图占位符组件
 *
 * 用于非图片文件，显示默认图标
 */
@Composable
fun ThumbnailPlaceholder(
    modifier: Modifier = Modifier,
    size: Dp = 48.dp,
    icon: androidx.compose.ui.graphics.vector.ImageVector = Icons.Default.Image,
    contentDescription: String? = null
) {
    Box(
        modifier = modifier
            .size(size)
            .background(
                MaterialTheme.colorScheme.surfaceVariant,
                MaterialTheme.shapes.small
            ),
        contentAlignment = Alignment.Center
    ) {
        Icon(
            imageVector = icon,
            contentDescription = contentDescription,
            modifier = Modifier.size(size / 2),
            tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
        )
    }
}

/**
 * 缩略图状态
 */
private sealed class ThumbnailState {
    object Loading : ThumbnailState()
    data class Success(val bitmap: Bitmap) : ThumbnailState()
    object Error : ThumbnailState()
}

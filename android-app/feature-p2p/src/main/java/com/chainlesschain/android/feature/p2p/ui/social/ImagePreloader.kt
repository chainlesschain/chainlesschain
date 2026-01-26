package com.chainlesschain.android.feature.p2p.ui.social

import android.content.Context
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.platform.LocalContext
import coil.ImageLoader
import coil.request.ImageRequest
import com.chainlesschain.android.core.database.entity.social.PostEntity
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter

/**
 * 图片预加载器 - Phase 7.3
 *
 * 在用户滚动时预加载即将可见的图片，提升滚动流畅度
 *
 * 使用方法：
 * ```kotlin
 * val listState = rememberLazyListState()
 * val imageLoader = LocalImageLoader.current
 *
 * ImagePreloader(
 *     listState = listState,
 *     posts = uiState.posts,
 *     imageLoader = imageLoader,
 *     preloadDistance = 5  // 预加载距离可见区域5个item
 * )
 * ```
 */
@Composable
fun ImagePreloader(
    listState: LazyListState,
    posts: List<PostEntity>,
    imageLoader: ImageLoader,
    preloadDistance: Int = 5,
    enabled: Boolean = true
) {
    val context = LocalContext.current

    LaunchedEffect(listState, posts, enabled) {
        if (!enabled) return@LaunchedEffect

        snapshotFlow { listState.firstVisibleItemIndex }
            .distinctUntilChanged()
            .filter { posts.isNotEmpty() }
            .collect { firstVisibleIndex ->
                // 计算预加载范围
                val startIndex = (firstVisibleIndex + preloadDistance).coerceAtMost(posts.size - 1)
                val endIndex = (startIndex + preloadDistance).coerceAtMost(posts.size - 1)

                // 预加载范围内的所有图片
                for (index in startIndex..endIndex) {
                    val post = posts.getOrNull(index) ?: continue
                    post.images.forEach { imageUrl ->
                        preloadImage(context, imageLoader, imageUrl)
                    }
                }
            }
    }
}

/**
 * 预加载单个图片
 */
private fun preloadImage(
    context: Context,
    imageLoader: ImageLoader,
    url: String
) {
    val request = ImageRequest.Builder(context)
        .data(url)
        .build()

    imageLoader.enqueue(request)
}

/**
 * 批量预加载图片
 */
fun preloadImages(
    context: Context,
    imageLoader: ImageLoader,
    urls: List<String>
) {
    urls.forEach { url ->
        preloadImage(context, imageLoader, url)
    }
}

/**
 * 根据设备性能自适应预加载距离
 */
object AdaptivePreloadPolicy {
    /**
     * 根据可用内存计算预加载距离
     *
     * @param availableMemoryMB 可用内存（MB）
     * @return 预加载距离（item数量）
     */
    fun calculatePreloadDistance(availableMemoryMB: Long): Int {
        return when {
            availableMemoryMB >= 2048 -> 10  // 高端设备：预加载10个item
            availableMemoryMB >= 1024 -> 5   // 中端设备：预加载5个item
            else -> 2                         // 低端设备：预加载2个item
        }
    }

    /**
     * 判断是否启用预加载
     *
     * @param availableMemoryMB 可用内存（MB）
     * @param isLowPowerMode 是否省电模式
     * @return 是否启用预加载
     */
    fun shouldEnablePreload(
        availableMemoryMB: Long,
        isLowPowerMode: Boolean
    ): Boolean {
        // 省电模式下禁用预加载
        if (isLowPowerMode) return false

        // 内存不足512MB禁用预加载
        if (availableMemoryMB < 512) return false

        return true
    }
}

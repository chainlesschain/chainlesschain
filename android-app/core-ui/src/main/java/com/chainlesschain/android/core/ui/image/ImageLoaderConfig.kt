package com.chainlesschain.android.core.ui.image

import android.content.Context
import android.os.Build
import coil.ImageLoader
import coil.decode.GifDecoder
import coil.decode.ImageDecoderDecoder
import coil.decode.SvgDecoder
import coil.disk.DiskCache
import coil.memory.MemoryCache
import coil.request.CachePolicy
import coil.util.DebugLogger
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

/**
 * Coil 图片加载器配置
 *
 * 优化策略：
 * 1. 合理的内存缓存大小（可用内存的 20%）
 * 2. 磁盘缓存限制（100MB）
 * 3. 网络超时配置
 * 4. 支持多种图片格式（SVG、GIF 等）
 * 5. Debug 环境启用日志
 */
object ImageLoaderConfig {

    /**
     * 创建优化的 ImageLoader
     *
     * @param context Android 上下文
     * @param isDebug 是否为 Debug 环境
     * @return 配置好的 ImageLoader
     */
    fun createImageLoader(
        context: Context,
        isDebug: Boolean = false
    ): ImageLoader {
        return ImageLoader.Builder(context)
            .memoryCache {
                MemoryCache.Builder(context)
                    // 内存缓存大小：可用内存的 20%
                    .maxSizePercent(0.20)
                    // 弱引用阈值：可用内存的 10%
                    .weakReferencesEnabled(true)
                    .build()
            }
            .diskCache {
                DiskCache.Builder()
                    .directory(context.cacheDir.resolve("image_cache"))
                    // 磁盘缓存大小：100MB
                    .maxSizeBytes(100 * 1024 * 1024)
                    .build()
            }
            .okHttpClient {
                OkHttpClient.Builder()
                    // 网络超时配置
                    .connectTimeout(15, TimeUnit.SECONDS)
                    .readTimeout(20, TimeUnit.SECONDS)
                    .writeTimeout(20, TimeUnit.SECONDS)
                    .build()
            }
            .components {
                // SVG 支持
                add(SvgDecoder.Factory())

                // GIF 支持（根据 Android 版本选择解码器）
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    add(ImageDecoderDecoder.Factory())
                } else {
                    add(GifDecoder.Factory())
                }
            }
            // 默认缓存策略
            .diskCachePolicy(CachePolicy.ENABLED)
            .memoryCachePolicy(CachePolicy.ENABLED)
            .networkCachePolicy(CachePolicy.ENABLED)
            // 启用硬件加速位图
            .allowHardware(true)
            // RGB_565 色彩空间（节省内存，适用于不需要透明通道的图片）
            .allowRgb565(true)
            // Debug 环境启用日志
            .apply {
                if (isDebug) {
                    logger(DebugLogger())
                }
            }
            .build()
    }

    /**
     * 清理图片缓存
     *
     * @param imageLoader ImageLoader 实例
     */
    suspend fun clearCache(imageLoader: ImageLoader) {
        // 清理内存缓存
        imageLoader.memoryCache?.clear()
        // 清理磁盘缓存
        imageLoader.diskCache?.clear()
    }

    /**
     * 获取缓存大小（字节）
     *
     * @param imageLoader ImageLoader 实例
     * @return 缓存大小（内存缓存 + 磁盘缓存）
     */
    fun getCacheSize(imageLoader: ImageLoader): Long {
        val memorySize = imageLoader.memoryCache?.size?.toLong() ?: 0L
        val diskSize = imageLoader.diskCache?.size ?: 0L
        return memorySize + diskSize
    }
}

/**
 * Coil 图片加载最佳实践
 *
 * 1. 指定图片尺寸（避免加载原图）
 * ```kotlin
 * AsyncImage(
 *     model = ImageRequest.Builder(LocalContext.current)
 *         .data(url)
 *         .size(300, 200)  // ✅ 指定尺寸
 *         .build(),
 *     contentDescription = null
 * )
 * ```
 *
 * 2. 使用合适的缩放模式
 * ```kotlin
 * AsyncImage(
 *     model = url,
 *     contentScale = ContentScale.Crop,  // ✅ 裁剪填充
 *     contentDescription = null
 * )
 * ```
 *
 * 3. 添加占位图和错误图
 * ```kotlin
 * AsyncImage(
 *     model = ImageRequest.Builder(LocalContext.current)
 *         .data(url)
 *         .placeholder(R.drawable.placeholder)  // ✅ 占位图
 *         .error(R.drawable.error)  // ✅ 错误图
 *         .crossfade(true)  // ✅ 淡入动画
 *         .build(),
 *     contentDescription = null
 * )
 * ```
 *
 * 4. 列表中的图片优化
 * ```kotlin
 * LazyColumn {
 *     items(items, key = { it.id }) { item ->
 *         AsyncImage(
 *             model = ImageRequest.Builder(LocalContext.current)
 *                 .data(item.imageUrl)
 *                 .size(300, 200)
 *                 .memoryCacheKey(item.id)  // ✅ 缓存 key
 *                 .diskCacheKey(item.id)
 *                 .build(),
 *             contentDescription = null
 *         )
 *     }
 * }
 * ```
 *
 * 5. 预加载图片
 * ```kotlin
 * val imageLoader = LocalContext.current.imageLoader
 * LaunchedEffect(urls) {
 *     urls.forEach { url ->
 *         imageLoader.enqueue(
 *             ImageRequest.Builder(context)
 *                 .data(url)
 *                 .build()
 *         )
 *     }
 * }
 * ```
 */

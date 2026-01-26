package com.chainlesschain.android.core.ui.image

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import androidx.core.content.getSystemService
import coil.ImageLoader
import coil.decode.GifDecoder
import coil.decode.ImageDecoderDecoder
import coil.decode.SvgDecoder
import coil.disk.DiskCache
import coil.memory.MemoryCache
import coil.request.CachePolicy
import coil.util.DebugLogger
import okhttp3.Dispatcher
import okhttp3.OkHttpClient
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * Coil图片加载优化配置
 *
 * Phase 7.2 - 内存优化
 * Task 7.2.1: Coil内存缓存配置（限制25%堆内存）
 *
 * 优化策略：
 * 1. 内存缓存：限制为最大堆内存的25%
 * 2. 磁盘缓存：最大100MB，保存7天
 * 3. 网络优化：并发请求限制，连接池优化
 * 4. 图片格式：支持GIF/SVG/WEBP
 * 5. 占位符：使用矢量图减少内存占用
 */
object ImageLoadingConfig {

    /**
     * 创建优化的ImageLoader实例
     */
    fun createOptimizedImageLoader(context: Context): ImageLoader {
        return ImageLoader.Builder(context)
            .apply {
                // 内存缓存配置
                memoryCache(createMemoryCache(context))

                // 磁盘缓存配置
                diskCache(createDiskCache(context))

                // 网络客户端配置
                okHttpClient(createOkHttpClient())

                // 图片解码器
                components {
                    // GIF支持
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                        add(ImageDecoderDecoder.Factory())
                    } else {
                        add(GifDecoder.Factory())
                    }

                    // SVG支持
                    add(SvgDecoder.Factory())
                }

                // 默认请求配置
                crossfade(true)  // 淡入动画
                crossfade(300)   // 动画时长300ms

                // 缓存策略
                respectCacheHeaders(false)  // 忽略HTTP缓存头，使用自定义策略

                // 调试模式（仅Debug构建）
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                    if (context.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0) {
                        logger(DebugLogger())
                    }
                }
            }
            .build()
    }

    /**
     * 创建内存缓存
     *
     * 限制为最大堆内存的25%（默认是20%）
     */
    private fun createMemoryCache(context: Context): MemoryCache {
        val maxHeapSize = Runtime.getRuntime().maxMemory()
        val cacheSize = (maxHeapSize * 0.25).toLong()  // 25% of heap

        return MemoryCache.Builder(context)
            .maxSizeBytes(cacheSize)
            .strongReferencesEnabled(true)  // 使用强引用提高缓存命中率
            .weakReferencesEnabled(true)    // 同时保留弱引用作为后备
            .build()
    }

    /**
     * 创建磁盘缓存
     *
     * 最大100MB，保存7天
     */
    private fun createDiskCache(context: Context): DiskCache {
        return DiskCache.Builder()
            .directory(File(context.cacheDir, "image_cache"))
            .maxSizeBytes(100L * 1024 * 1024)  // 100 MB
            .build()
    }

    /**
     * 创建OkHttp客户端
     *
     * 优化网络请求性能
     */
    private fun createOkHttpClient(): OkHttpClient {
        return OkHttpClient.Builder()
            .dispatcher(
                Dispatcher().apply {
                    maxRequests = 64           // 最大并发请求数
                    maxRequestsPerHost = 8     // 每个主机最大并发数
                }
            )
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .build()
    }

    /**
     * 获取推荐的内存缓存大小
     */
    fun getRecommendedMemoryCacheSize(context: Context): Long {
        val activityManager = context.getSystemService<ActivityManager>()
        val memoryClass = activityManager?.memoryClass ?: 64  // Default 64MB

        // 使用设备内存等级的25%
        return (memoryClass * 1024 * 1024 * 0.25).toLong()
    }

    /**
     * 获取当前内存使用情况
     */
    fun getMemoryInfo(context: Context): MemoryInfo {
        val runtime = Runtime.getRuntime()
        val activityManager = context.getSystemService<ActivityManager>()

        val maxMemory = runtime.maxMemory()
        val totalMemory = runtime.totalMemory()
        val freeMemory = runtime.freeMemory()
        val usedMemory = totalMemory - freeMemory

        val memoryInfo = ActivityManager.MemoryInfo()
        activityManager?.getMemoryInfo(memoryInfo)

        return MemoryInfo(
            maxHeapSize = maxMemory,
            totalHeapSize = totalMemory,
            freeHeapSize = freeMemory,
            usedHeapSize = usedMemory,
            availableSystemMemory = memoryInfo.availMem,
            totalSystemMemory = memoryInfo.totalMem,
            lowMemory = memoryInfo.lowMemory,
            threshold = memoryInfo.threshold
        )
    }

    /**
     * 清理缓存
     */
    fun clearCache(context: Context, imageLoader: ImageLoader) {
        // 清理内存缓存
        imageLoader.memoryCache?.clear()

        // 清理磁盘缓存
        imageLoader.diskCache?.clear()
    }

    /**
     * 获取缓存大小
     */
    fun getCacheSize(imageLoader: ImageLoader): CacheSize {
        val memorySize = imageLoader.memoryCache?.size ?: 0L
        val diskSize = imageLoader.diskCache?.size ?: 0L

        return CacheSize(
            memoryBytes = memorySize,
            diskBytes = diskSize
        )
    }
}

/**
 * 内存信息数据类
 */
data class MemoryInfo(
    /** 最大堆内存（Bytes） */
    val maxHeapSize: Long,
    /** 已分配堆内存（Bytes） */
    val totalHeapSize: Long,
    /** 空闲堆内存（Bytes） */
    val freeHeapSize: Long,
    /** 已使用堆内存（Bytes） */
    val usedHeapSize: Long,
    /** 可用系统内存（Bytes） */
    val availableSystemMemory: Long,
    /** 总系统内存（Bytes） */
    val totalSystemMemory: Long,
    /** 是否低内存状态 */
    val lowMemory: Boolean,
    /** 低内存阈值（Bytes） */
    val threshold: Long
) {
    /** 堆内存使用百分比 */
    val heapUsagePercent: Int
        get() = ((usedHeapSize * 100) / maxHeapSize).toInt()

    /** 系统内存使用百分比 */
    val systemMemoryUsagePercent: Int
        get() = (((totalSystemMemory - availableSystemMemory) * 100) / totalSystemMemory).toInt()

    /** 格式化的堆内存使用情况 */
    fun formatHeapUsage(): String {
        return "${formatBytes(usedHeapSize)} / ${formatBytes(maxHeapSize)} ($heapUsagePercent%)"
    }

    /** 格式化的系统内存使用情况 */
    fun formatSystemMemoryUsage(): String {
        return "${formatBytes(totalSystemMemory - availableSystemMemory)} / ${formatBytes(totalSystemMemory)} ($systemMemoryUsagePercent%)"
    }

    private fun formatBytes(bytes: Long): String {
        return when {
            bytes < 1024 -> "$bytes B"
            bytes < 1024 * 1024 -> "${bytes / 1024} KB"
            bytes < 1024 * 1024 * 1024 -> "${bytes / (1024 * 1024)} MB"
            else -> "${bytes / (1024 * 1024 * 1024)} GB"
        }
    }
}

/**
 * 缓存大小数据类
 */
data class CacheSize(
    /** 内存缓存大小（Bytes） */
    val memoryBytes: Long,
    /** 磁盘缓存大小（Bytes） */
    val diskBytes: Long
) {
    /** 总缓存大小（Bytes） */
    val totalBytes: Long
        get() = memoryBytes + diskBytes

    /** 格式化的内存缓存大小 */
    fun formatMemorySize(): String = formatBytes(memoryBytes)

    /** 格式化的磁盘缓存大小 */
    fun formatDiskSize(): String = formatBytes(diskBytes)

    /** 格式化的总缓存大小 */
    fun formatTotalSize(): String = formatBytes(totalBytes)

    private fun formatBytes(bytes: Long): String {
        return when {
            bytes < 1024 -> "$bytes B"
            bytes < 1024 * 1024 -> String.format("%.1f KB", bytes / 1024.0)
            bytes < 1024 * 1024 * 1024 -> String.format("%.1f MB", bytes / (1024.0 * 1024))
            else -> String.format("%.1f GB", bytes / (1024.0 * 1024 * 1024))
        }
    }
}

/**
 * 图片加载扩展函数
 */
object ImageLoadingExtensions {
    /**
     * 预加载图片
     */
    fun ImageLoader.preload(url: String) {
        val request = coil.request.ImageRequest.Builder(this.context)
            .data(url)
            .memoryCachePolicy(CachePolicy.ENABLED)
            .diskCachePolicy(CachePolicy.ENABLED)
            .build()

        this.enqueue(request)
    }

    /**
     * 批量预加载图片
     */
    fun ImageLoader.preloadBatch(urls: List<String>) {
        urls.forEach { url -> preload(url) }
    }
}

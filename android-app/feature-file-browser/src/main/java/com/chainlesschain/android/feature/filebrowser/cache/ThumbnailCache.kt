package com.chainlesschain.android.feature.filebrowser.cache

import android.content.ContentResolver
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import timber.log.Timber
import android.util.LruCache
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 缩略图缓存管理器
 *
 * 功能:
 * - LRU缓存策略，自动清理最少使用的缩略图
 * - 异步加载缩略图
 * - 内存管理，避免OOM
 * - 自动缩放图片到合适尺寸
 */
@Singleton
class ThumbnailCache @Inject constructor() {

    companion object {
        private const val MAX_MEMORY_PERCENT = 0.125 // 使用12.5%的应用内存
        private const val THUMBNAIL_MAX_WIDTH = 200
        private const val THUMBNAIL_MAX_HEIGHT = 200
    }

    // LRU缓存
    private val cache: LruCache<String, Bitmap>

    init {
        // 计算缓存大小
        val maxMemory = (Runtime.getRuntime().maxMemory() / 1024).toInt()
        val cacheSize = (maxMemory * MAX_MEMORY_PERCENT).toInt()

        // 初始化LRU缓存
        cache = object : LruCache<String, Bitmap>(cacheSize) {
            override fun sizeOf(key: String, bitmap: Bitmap): Int {
                // 返回bitmap占用的内存大小（KB）
                return bitmap.byteCount / 1024
            }

            override fun entryRemoved(
                evicted: Boolean,
                key: String?,
                oldValue: Bitmap?,
                newValue: Bitmap?
            ) {
                if (evicted && oldValue != null && !oldValue.isRecycled) {
                    // 缓存被清理时，回收Bitmap
                    oldValue.recycle()
                }
            }
        }

        Timber.d("ThumbnailCache initialized with max size: ${cacheSize}KB")
    }

    /**
     * 获取缓存的缩略图
     *
     * @param uri 文件URI
     * @return 缓存的Bitmap，如果不存在返回null
     */
    fun get(uri: String): Bitmap? {
        return cache.get(uri)
    }

    /**
     * 添加缩略图到缓存
     *
     * @param uri 文件URI
     * @param bitmap 缩略图Bitmap
     */
    fun put(uri: String, bitmap: Bitmap) {
        cache.put(uri, bitmap)
    }

    /**
     * 从URI加载缩略图
     *
     * @param contentResolver ContentResolver实例
     * @param uri 文件URI
     * @return 缩略图Bitmap，如果加载失败返回null
     */
    suspend fun loadThumbnail(
        contentResolver: ContentResolver,
        uri: String
    ): Bitmap? = withContext(Dispatchers.IO) {
        try {
            // 检查缓存
            val cached = get(uri)
            if (cached != null) {
                Timber.d("Thumbnail cache hit: $uri")
                return@withContext cached
            }

            // 从URI加载图片
            val parsedUri = Uri.parse(uri)

            // 首先获取图片尺寸
            val options = BitmapFactory.Options().apply {
                inJustDecodeBounds = true
            }
            contentResolver.openInputStream(parsedUri)?.use { inputStream ->
                BitmapFactory.decodeStream(inputStream, null, options)
            } ?: return@withContext null

            // 计算缩放比例
            val scaleFactor = calculateScaleFactor(
                options.outWidth,
                options.outHeight,
                THUMBNAIL_MAX_WIDTH,
                THUMBNAIL_MAX_HEIGHT
            )

            // 加载缩略图
            val thumbnailOptions = BitmapFactory.Options().apply {
                inSampleSize = scaleFactor
                inPreferredConfig = Bitmap.Config.RGB_565 // 使用RGB_565减少内存占用
            }

            val bitmap = contentResolver.openInputStream(parsedUri)?.use { inputStream2 ->
                BitmapFactory.decodeStream(inputStream2, null, thumbnailOptions)
            }

            if (bitmap != null) {
                // 添加到缓存
                put(uri, bitmap)
                Timber.d("Thumbnail loaded and cached: $uri (${bitmap.width}x${bitmap.height})")
            }

            bitmap
        } catch (e: Exception) {
            Timber.e(e, "Error loading thumbnail: $uri")
            null
        }
    }

    /**
     * 计算图片缩放比例
     *
     * @param srcWidth 原始宽度
     * @param srcHeight 原始高度
     * @param maxWidth 目标最大宽度
     * @param maxHeight 目标最大高度
     * @return 缩放比例（必须是2的幂次方）
     */
    private fun calculateScaleFactor(
        srcWidth: Int,
        srcHeight: Int,
        maxWidth: Int,
        maxHeight: Int
    ): Int {
        var scaleFactor = 1

        if (srcHeight > maxHeight || srcWidth > maxWidth) {
            val heightRatio = srcHeight / maxHeight
            val widthRatio = srcWidth / maxWidth

            // 选择较大的比例，确保缩略图不会超过最大尺寸
            scaleFactor = if (heightRatio > widthRatio) heightRatio else widthRatio

            // inSampleSize应该是2的幂次方
            var powerOfTwo = 1
            while (powerOfTwo < scaleFactor) {
                powerOfTwo *= 2
            }
            scaleFactor = powerOfTwo
        }

        return scaleFactor
    }

    /**
     * 清除指定URI的缓存
     *
     * @param uri 文件URI
     */
    fun remove(uri: String) {
        val bitmap = cache.remove(uri)
        if (bitmap != null && !bitmap.isRecycled) {
            bitmap.recycle()
        }
    }

    /**
     * 清空所有缓存
     */
    fun clear() {
        // LruCache会自动调用entryRemoved回收Bitmap
        cache.evictAll()
        Timber.d("Thumbnail cache cleared")
    }

    /**
     * 获取缓存统计信息
     *
     * @return 缓存统计信息
     */
    fun getStats(): CacheStats {
        return CacheStats(
            size = cache.size(),
            maxSize = cache.maxSize(),
            hitCount = cache.hitCount(),
            missCount = cache.missCount(),
            evictionCount = cache.evictionCount()
        )
    }

    /**
     * 缓存统计信息
     */
    data class CacheStats(
        val size: Int,
        val maxSize: Int,
        val hitCount: Int,
        val missCount: Int,
        val evictionCount: Int
    ) {
        val hitRate: Float
            get() = if (hitCount + missCount > 0) {
                hitCount.toFloat() / (hitCount + missCount)
            } else {
                0f
            }

        fun getReadableSize(): String {
            return "${size}KB / ${maxSize}KB"
        }

        fun getHitRatePercent(): String {
            return String.format("%.1f%%", hitRate * 100)
        }
    }
}

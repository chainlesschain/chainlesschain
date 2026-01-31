package com.chainlesschain.android.feature.p2p.service

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 图片上传服务
 *
 * 负责图片压缩、调整尺寸和上传
 */
@Singleton
class ImageUploadService @Inject constructor(
    @ApplicationContext private val context: Context
) {

    companion object {
        /** 最大宽度 */
        private const val MAX_WIDTH = 1920

        /** 最大高度 */
        private const val MAX_HEIGHT = 1920

        /** 压缩质量 */
        private const val QUALITY = 85

        /** 最大文件大小（5MB） */
        private const val MAX_FILE_SIZE = 5 * 1024 * 1024
    }

    /**
     * 上传图片结果
     */
    sealed class UploadResult {
        data class Progress(val uri: Uri, val progress: Int) : UploadResult()
        data class Success(val uri: Uri, val url: String) : UploadResult()
        data class Error(val uri: Uri, val message: String) : UploadResult()
    }

    /**
     * 上传多张图片
     *
     * @param uris 图片 URI 列表
     * @return Flow 发送上传进度和结果
     */
    fun uploadImages(uris: List<Uri>): Flow<UploadResult> = flow {
        for (uri in uris) {
            try {
                // 压缩图片
                emit(UploadResult.Progress(uri, 30))
                val compressedFile = compressImage(uri)

                // 上传到服务器
                emit(UploadResult.Progress(uri, 60))
                val url = uploadToServer(compressedFile)

                // 删除临时文件
                compressedFile.delete()

                emit(UploadResult.Success(uri, url))
            } catch (e: Exception) {
                emit(UploadResult.Error(uri, e.message ?: "上传失败"))
            }
        }
    }

    /**
     * 压缩图片
     *
     * @param uri 原始图片 URI
     * @return 压缩后的文件
     */
    private suspend fun compressImage(uri: Uri): File = withContext(Dispatchers.IO) {
        val inputStream = context.contentResolver.openInputStream(uri)
            ?: throw IllegalArgumentException("无法打开图片")

        // 解码图片
        val options = BitmapFactory.Options().apply {
            inJustDecodeBounds = true
        }
        BitmapFactory.decodeStream(inputStream, null, options)
        inputStream.close()

        // 计算采样率
        val sampleSize = calculateInSampleSize(
            options.outWidth,
            options.outHeight,
            MAX_WIDTH,
            MAX_HEIGHT
        )

        // 重新解码图片
        val inputStream2 = context.contentResolver.openInputStream(uri)
            ?: throw IllegalArgumentException("无法打开图片")

        val bitmap = BitmapFactory.Options().run {
            inSampleSize = sampleSize
            inJustDecodeBounds = false
            BitmapFactory.decodeStream(inputStream2, null, this)
        }
        inputStream2.close()

        bitmap ?: throw IllegalArgumentException("无法解码图片")

        // 调整尺寸
        val scaledBitmap = scaleBitmap(bitmap, MAX_WIDTH, MAX_HEIGHT)

        // 压缩并保存
        val outputFile = File(context.cacheDir, "upload_${UUID.randomUUID()}.jpg")
        FileOutputStream(outputFile).use { fos ->
            scaledBitmap.compress(Bitmap.CompressFormat.JPEG, QUALITY, fos)
        }

        // 释放 Bitmap
        if (scaledBitmap != bitmap) {
            scaledBitmap.recycle()
        }
        bitmap.recycle()

        // 检查文件大小
        if (outputFile.length() > MAX_FILE_SIZE) {
            // 如果还是太大，降低质量
            val recompressedFile = recompressImage(outputFile, QUALITY - 15)
            outputFile.delete()
            recompressedFile
        } else {
            outputFile
        }
    }

    /**
     * 重新压缩图片以减小文件大小
     */
    private fun recompressImage(file: File, quality: Int): File {
        val bitmap = BitmapFactory.decodeFile(file.absolutePath)
        val outputFile = File(context.cacheDir, "recompressed_${UUID.randomUUID()}.jpg")
        FileOutputStream(outputFile).use { fos ->
            bitmap.compress(Bitmap.CompressFormat.JPEG, quality, fos)
        }
        bitmap.recycle()
        return outputFile
    }

    /**
     * 计算采样率
     */
    private fun calculateInSampleSize(
        width: Int,
        height: Int,
        reqWidth: Int,
        reqHeight: Int
    ): Int {
        var inSampleSize = 1

        if (height > reqHeight || width > reqWidth) {
            val halfHeight = height / 2
            val halfWidth = width / 2

            while ((halfHeight / inSampleSize) >= reqHeight &&
                (halfWidth / inSampleSize) >= reqWidth
            ) {
                inSampleSize *= 2
            }
        }

        return inSampleSize
    }

    /**
     * 缩放 Bitmap
     */
    private fun scaleBitmap(bitmap: Bitmap, maxWidth: Int, maxHeight: Int): Bitmap {
        val width = bitmap.width
        val height = bitmap.height

        if (width <= maxWidth && height <= maxHeight) {
            return bitmap
        }

        val ratio = minOf(
            maxWidth.toFloat() / width,
            maxHeight.toFloat() / height
        )

        val newWidth = (width * ratio).toInt()
        val newHeight = (height * ratio).toInt()

        return Bitmap.createScaledBitmap(bitmap, newWidth, newHeight, true)
    }

    /**
     * 上传文件到服务器
     *
     * @param file 要上传的文件
     * @return 图片 URL
     */
    private suspend fun uploadToServer(file: File): String = withContext(Dispatchers.IO) {
        // TODO: 实现实际的服务器上传逻辑
        // 这里暂时返回本地文件路径作为占位符
        // 实际应该使用 OkHttp 或 Retrofit 上传到后端服务器

        // 模拟上传延迟
        kotlinx.coroutines.delay(500)

        // 返回本地文件 URI（临时方案）
        "file://${file.absolutePath}"
    }

    /**
     * 取消上传
     *
     * TODO: 实现取消上传功能
     */
    fun cancelUpload() {
        // 实现取消逻辑
    }
}

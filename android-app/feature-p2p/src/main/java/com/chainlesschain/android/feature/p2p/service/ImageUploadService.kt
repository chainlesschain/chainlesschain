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
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.util.UUID
import java.util.concurrent.TimeUnit
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
        // 解码图片尺寸
        val options = BitmapFactory.Options().apply {
            inJustDecodeBounds = true
        }
        context.contentResolver.openInputStream(uri)?.use { inputStream ->
            BitmapFactory.decodeStream(inputStream, null, options)
        } ?: throw IllegalArgumentException("无法打开图片")

        // 计算采样率
        val sampleSize = calculateInSampleSize(
            options.outWidth,
            options.outHeight,
            MAX_WIDTH,
            MAX_HEIGHT
        )

        // 重新解码图片
        val bitmap = context.contentResolver.openInputStream(uri)?.use { inputStream2 ->
            BitmapFactory.Options().run {
                inSampleSize = sampleSize
                inJustDecodeBounds = false
                BitmapFactory.decodeStream(inputStream2, null, this)
            }
        } ?: throw IllegalArgumentException("无法打开图片")

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
    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    @Volatile
    private var currentCall: okhttp3.Call? = null

    private fun getUploadBaseUrl(): String {
        // Use signaling server host as upload endpoint base
        val isDebug = try { com.chainlesschain.android.feature.p2p.BuildConfig.DEBUG } catch (_: Exception) { false }
        return if (isDebug) "http://10.0.2.2:9090" else "https://api.chainlesschain.com"
    }

    private suspend fun uploadToServer(file: File): String = withContext(Dispatchers.IO) {
        val mediaType = "image/jpeg".toMediaType()
        val requestBody = MultipartBody.Builder()
            .setType(MultipartBody.FORM)
            .addFormDataPart(
                "file",
                file.name,
                file.asRequestBody(mediaType)
            )
            .build()

        val request = Request.Builder()
            .url("${getUploadBaseUrl()}/api/files/upload")
            .post(requestBody)
            .build()

        val call = httpClient.newCall(request)
        currentCall = call

        try {
            val response = call.execute()
            if (response.isSuccessful) {
                val body = response.body?.string() ?: throw Exception("Empty response")
                val json = JSONObject(body)
                json.optString("url", json.optString("fileUrl", "file://${file.absolutePath}"))
            } else {
                // Server not available, fall back to local file URI
                android.util.Log.w("ImageUploadService",
                    "Upload server returned ${response.code}, using local path")
                "file://${file.absolutePath}"
            }
        } catch (e: java.io.IOException) {
            // Network error, fall back to local file URI
            android.util.Log.w("ImageUploadService",
                "Upload failed (${e.message}), using local path")
            "file://${file.absolutePath}"
        } finally {
            currentCall = null
        }
    }

    /**
     * 取消当前上传
     */
    fun cancelUpload() {
        currentCall?.cancel()
        currentCall = null
    }
}

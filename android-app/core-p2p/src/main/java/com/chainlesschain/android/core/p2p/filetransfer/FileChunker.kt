package com.chainlesschain.android.core.p2p.filetransfer

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.util.Base64
import android.util.Log
import com.chainlesschain.android.core.p2p.filetransfer.model.FileChunk
import com.chainlesschain.android.core.p2p.filetransfer.model.FileTransferMetadata
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.InputStream
import java.io.RandomAccessFile
import java.security.MessageDigest
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 文件分块处理器
 *
 * Handles file chunking, checksum calculation, and thumbnail generation.
 * Uses stream-based I/O to avoid memory issues with large files.
 */
@Singleton
class FileChunker @Inject constructor(
    private val context: Context
) {
    companion object {
        private const val TAG = "FileChunker"

        /** Thumbnail max width/height */
        private const val THUMBNAIL_MAX_SIZE = 200

        /** Thumbnail quality (0-100) */
        private const val THUMBNAIL_QUALITY = 80

        /** Max thumbnail file size in bytes */
        private const val MAX_THUMBNAIL_BYTES = 50 * 1024 // 50KB
    }

    /**
     * Calculate SHA256 checksum for a file
     *
     * @param uri File URI to calculate checksum for
     * @return Hex-encoded SHA256 checksum
     */
    suspend fun calculateFileChecksum(uri: Uri): String = withContext(Dispatchers.IO) {
        val digest = MessageDigest.getInstance("SHA-256")
        val buffer = ByteArray(8192)

        context.contentResolver.openInputStream(uri)?.use { inputStream ->
            var bytesRead: Int
            while (inputStream.read(buffer).also { bytesRead = it } != -1) {
                digest.update(buffer, 0, bytesRead)
            }
        } ?: throw IllegalStateException("Cannot open input stream for URI: $uri")

        bytesToHex(digest.digest())
    }

    /**
     * Calculate SHA256 checksum for a file
     *
     * @param file File to calculate checksum for
     * @return Hex-encoded SHA256 checksum
     */
    suspend fun calculateFileChecksum(file: File): String = withContext(Dispatchers.IO) {
        val digest = MessageDigest.getInstance("SHA-256")
        val buffer = ByteArray(8192)

        FileInputStream(file).use { inputStream ->
            var bytesRead: Int
            while (inputStream.read(buffer).also { bytesRead = it } != -1) {
                digest.update(buffer, 0, bytesRead)
            }
        }

        bytesToHex(digest.digest())
    }

    /**
     * Calculate SHA256 checksum for a byte array (chunk)
     *
     * @param data Byte array to calculate checksum for
     * @return Hex-encoded SHA256 checksum
     */
    fun calculateChunkChecksum(data: ByteArray): String {
        val digest = MessageDigest.getInstance("SHA-256")
        digest.update(data)
        return bytesToHex(digest.digest())
    }

    /**
     * Read a specific chunk from a file
     *
     * @param uri File URI
     * @param chunkIndex Index of the chunk to read (0-based)
     * @param chunkSize Size of each chunk in bytes
     * @param totalChunks Total number of chunks
     * @param transferId Transfer ID for this file
     * @param mimeType MIME type of the file (for compression decision)
     * @param enableCompression Whether to enable compression for compressible types
     * @return FileChunk object containing the chunk data
     */
    suspend fun readChunk(
        uri: Uri,
        chunkIndex: Int,
        chunkSize: Int,
        totalChunks: Int,
        transferId: String,
        mimeType: String? = null,
        enableCompression: Boolean = true
    ): FileChunk = withContext(Dispatchers.IO) {
        val offset = chunkIndex.toLong() * chunkSize
        val buffer = ByteArray(chunkSize)

        context.contentResolver.openInputStream(uri)?.use { inputStream ->
            // Skip to the chunk offset
            var skipped = 0L
            while (skipped < offset) {
                val toSkip = minOf(offset - skipped, 8192L)
                val actuallySkipped = inputStream.skip(toSkip)
                if (actuallySkipped <= 0) break
                skipped += actuallySkipped
            }

            // Read the chunk
            var totalRead = 0
            while (totalRead < chunkSize) {
                val bytesRead = inputStream.read(buffer, totalRead, chunkSize - totalRead)
                if (bytesRead == -1) break
                totalRead += bytesRead
            }

            // Trim buffer if we read less than chunkSize (last chunk)
            val actualData = if (totalRead < chunkSize) {
                buffer.copyOf(totalRead)
            } else {
                buffer
            }

            val chunkChecksum = calculateChunkChecksum(actualData)

            FileChunk.create(
                transferId = transferId,
                chunkIndex = chunkIndex,
                totalChunks = totalChunks,
                data = actualData,
                chunkChecksum = chunkChecksum,
                mimeType = mimeType,
                enableCompression = enableCompression
            )
        } ?: throw IllegalStateException("Cannot open input stream for URI: $uri")
    }

    /**
     * Read a specific chunk from a file using RandomAccessFile (more efficient for random access)
     *
     * @param file File to read from
     * @param chunkIndex Index of the chunk to read (0-based)
     * @param chunkSize Size of each chunk in bytes
     * @param totalChunks Total number of chunks
     * @param transferId Transfer ID for this file
     * @param mimeType MIME type of the file (for compression decision)
     * @param enableCompression Whether to enable compression for compressible types
     * @return FileChunk object containing the chunk data
     */
    suspend fun readChunk(
        file: File,
        chunkIndex: Int,
        chunkSize: Int,
        totalChunks: Int,
        transferId: String,
        mimeType: String? = null,
        enableCompression: Boolean = true
    ): FileChunk = withContext(Dispatchers.IO) {
        val offset = chunkIndex.toLong() * chunkSize

        RandomAccessFile(file, "r").use { raf ->
            raf.seek(offset)

            // Calculate actual size to read (may be smaller for last chunk)
            val remaining = file.length() - offset
            val bytesToRead = minOf(chunkSize.toLong(), remaining).toInt()
            val buffer = ByteArray(bytesToRead)

            raf.readFully(buffer)

            val chunkChecksum = calculateChunkChecksum(buffer)

            FileChunk.create(
                transferId = transferId,
                chunkIndex = chunkIndex,
                totalChunks = totalChunks,
                data = buffer,
                chunkChecksum = chunkChecksum,
                mimeType = mimeType,
                enableCompression = enableCompression
            )
        }
    }

    /**
     * Write a chunk to a temp file
     *
     * @param chunk The chunk to write
     * @param tempFile The temp file to write to
     * @return true if successful, false otherwise
     */
    suspend fun writeChunk(
        chunk: FileChunk,
        tempFile: File
    ): Boolean = withContext(Dispatchers.IO) {
        try {
            val data = FileChunk.decodeData(chunk)

            // Verify chunk checksum
            val calculatedChecksum = calculateChunkChecksum(data)
            if (calculatedChecksum != chunk.chunkChecksum) {
                Log.e(TAG, "Chunk checksum mismatch for chunk ${chunk.chunkIndex}")
                return@withContext false
            }

            // Write chunk at correct offset
            val offset = chunk.offset

            // Create parent directories if needed
            tempFile.parentFile?.mkdirs()

            RandomAccessFile(tempFile, "rw").use { raf ->
                raf.seek(offset)
                raf.write(data)
            }

            true
        } catch (e: Exception) {
            Log.e(TAG, "Failed to write chunk ${chunk.chunkIndex}", e)
            false
        }
    }

    /**
     * Create a temporary file for receiving a transfer
     *
     * @param transferId Transfer ID
     * @param fileName Original file name
     * @return Temp file path
     */
    fun createTempFile(transferId: String, fileName: String): File {
        val transferDir = File(context.cacheDir, "file_transfers")
        transferDir.mkdirs()
        return File(transferDir, "${transferId}_${fileName}.tmp")
    }

    /**
     * Move temp file to final destination
     *
     * @param tempFile Temp file to move
     * @param destinationDir Destination directory
     * @param fileName Final file name
     * @return Final file path, or null if failed
     */
    suspend fun finalizeTempFile(
        tempFile: File,
        destinationDir: File,
        fileName: String
    ): File? = withContext(Dispatchers.IO) {
        try {
            destinationDir.mkdirs()

            // Handle duplicate file names
            var finalFile = File(destinationDir, fileName)
            var counter = 1
            val nameWithoutExt = fileName.substringBeforeLast('.')
            val extension = fileName.substringAfterLast('.', "")

            while (finalFile.exists()) {
                val newName = if (extension.isNotEmpty()) {
                    "${nameWithoutExt}_$counter.$extension"
                } else {
                    "${nameWithoutExt}_$counter"
                }
                finalFile = File(destinationDir, newName)
                counter++
            }

            // Copy temp file to destination
            tempFile.copyTo(finalFile, overwrite = false)
            tempFile.delete()

            Log.d(TAG, "File finalized: ${finalFile.absolutePath}")
            finalFile
        } catch (e: Exception) {
            Log.e(TAG, "Failed to finalize temp file", e)
            null
        }
    }

    /**
     * Verify final file checksum matches expected
     *
     * @param file File to verify
     * @param expectedChecksum Expected SHA256 checksum
     * @return true if checksum matches
     */
    suspend fun verifyFileChecksum(file: File, expectedChecksum: String): Boolean {
        val actualChecksum = calculateFileChecksum(file)
        return actualChecksum == expectedChecksum
    }

    /**
     * Generate thumbnail for image file (optimized single-pass)
     *
     * 优化版本：
     * 1. 使用 BufferedInputStream 支持 mark/reset，避免两次打开流
     * 2. 第一次读取只获取边界信息，然后 reset 回起点
     * 3. 第二次读取使用计算好的 sampleSize 解码
     *
     * @param uri Image file URI
     * @return Base64-encoded thumbnail, or null if generation fails
     */
    suspend fun generateImageThumbnail(uri: Uri): String? = withContext(Dispatchers.IO) {
        try {
            context.contentResolver.openInputStream(uri)?.use { rawInputStream ->
                // 使用 BufferedInputStream 支持 mark/reset
                val inputStream = java.io.BufferedInputStream(rawInputStream, 1024 * 1024) // 1MB buffer
                inputStream.mark(1024 * 1024) // 标记位置，允许重置

                // 第一次读取：只获取边界信息
                val boundsOptions = BitmapFactory.Options().apply {
                    inJustDecodeBounds = true
                }
                BitmapFactory.decodeStream(inputStream, null, boundsOptions)

                // 检查是否成功获取了图片尺寸
                if (boundsOptions.outWidth <= 0 || boundsOptions.outHeight <= 0) {
                    return@withContext null
                }

                // 计算采样率
                val sampleSize = calculateSampleSize(boundsOptions, THUMBNAIL_MAX_SIZE, THUMBNAIL_MAX_SIZE)

                // 重置流到起点
                inputStream.reset()

                // 第二次读取：使用 sampleSize 解码
                val decodeOptions = BitmapFactory.Options().apply {
                    inSampleSize = sampleSize
                    inPreferredConfig = Bitmap.Config.RGB_565 // 使用更小的内存格式
                }

                val bitmap = BitmapFactory.decodeStream(inputStream, null, decodeOptions)
                    ?: return@withContext null

                // 缩放到精确的缩略图大小
                val scaledBitmap = scaleBitmap(bitmap, THUMBNAIL_MAX_SIZE)

                // 压缩为 JPEG
                val outputStream = ByteArrayOutputStream()
                var quality = THUMBNAIL_QUALITY
                scaledBitmap.compress(Bitmap.CompressFormat.JPEG, quality, outputStream)

                // 如果缩略图太大，降低质量
                while (outputStream.size() > MAX_THUMBNAIL_BYTES && quality > 10) {
                    outputStream.reset()
                    quality -= 10
                    scaledBitmap.compress(Bitmap.CompressFormat.JPEG, quality, outputStream)
                }

                // 回收位图
                if (!scaledBitmap.isRecycled) scaledBitmap.recycle()
                if (!bitmap.isRecycled && bitmap != scaledBitmap) bitmap.recycle()

                Base64.encodeToString(outputStream.toByteArray(), Base64.NO_WRAP)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to generate image thumbnail", e)
            null
        }
    }

    /**
     * Generate thumbnail for video file (优化版)
     *
     * 优化点：
     * 1. 使用 use 模式确保 MediaMetadataRetriever 正确释放
     * 2. 尝试多个时间点获取帧，避免黑帧
     * 3. 使用 RGB_565 格式减少内存使用
     *
     * @param uri Video file URI
     * @return Base64-encoded thumbnail, or null if generation fails
     */
    suspend fun generateVideoThumbnail(uri: Uri): String? = withContext(Dispatchers.IO) {
        var retriever: MediaMetadataRetriever? = null
        try {
            retriever = MediaMetadataRetriever()
            retriever.setDataSource(context, uri)

            // 获取视频时长（微秒）
            val durationStr = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)
            val durationMs = durationStr?.toLongOrNull() ?: 0L
            val durationUs = durationMs * 1000

            // 尝试多个时间点获取帧（避免黑帧或加载画面）
            val timePoints = listOf(
                durationUs / 10,        // 10% 位置
                1_000_000L,             // 1秒
                durationUs / 2,         // 50% 位置
                0L                      // 第一帧
            ).filter { it <= durationUs }

            var bitmap: Bitmap? = null
            for (timeUs in timePoints) {
                bitmap = retriever.getFrameAtTime(timeUs, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
                if (bitmap != null && !isMostlyBlack(bitmap)) {
                    break
                }
                bitmap?.recycle()
                bitmap = null
            }

            if (bitmap == null) {
                return@withContext null
            }

            // 缩放到缩略图大小
            val scaledBitmap = scaleBitmap(bitmap, THUMBNAIL_MAX_SIZE)

            // 压缩为 JPEG
            val outputStream = ByteArrayOutputStream()
            var quality = THUMBNAIL_QUALITY
            scaledBitmap.compress(Bitmap.CompressFormat.JPEG, quality, outputStream)

            // 如果缩略图太大，降低质量
            while (outputStream.size() > MAX_THUMBNAIL_BYTES && quality > 10) {
                outputStream.reset()
                quality -= 10
                scaledBitmap.compress(Bitmap.CompressFormat.JPEG, quality, outputStream)
            }

            // 回收位图
            if (!scaledBitmap.isRecycled) scaledBitmap.recycle()
            if (!bitmap.isRecycled && bitmap != scaledBitmap) bitmap.recycle()

            Base64.encodeToString(outputStream.toByteArray(), Base64.NO_WRAP)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to generate video thumbnail", e)
            null
        } finally {
            try {
                retriever?.release()
            } catch (e: Exception) {
                Log.w(TAG, "Failed to release MediaMetadataRetriever", e)
            }
        }
    }

    /**
     * 检查位图是否大部分是黑色（用于跳过黑帧）
     */
    private fun isMostlyBlack(bitmap: Bitmap): Boolean {
        // 采样检查：取9个点的平均亮度
        val width = bitmap.width
        val height = bitmap.height
        var totalBrightness = 0

        val samplePoints = listOf(
            0 to 0, width / 2 to 0, width - 1 to 0,
            0 to height / 2, width / 2 to height / 2, width - 1 to height / 2,
            0 to height - 1, width / 2 to height - 1, width - 1 to height - 1
        )

        for ((x, y) in samplePoints) {
            val pixel = bitmap.getPixel(x.coerceIn(0, width - 1), y.coerceIn(0, height - 1))
            val r = (pixel shr 16) and 0xFF
            val g = (pixel shr 8) and 0xFF
            val b = pixel and 0xFF
            totalBrightness += (r + g + b) / 3
        }

        val averageBrightness = totalBrightness / samplePoints.size
        return averageBrightness < 20 // 如果平均亮度小于20，认为是黑帧
    }

    /**
     * Get file info from URI
     *
     * @param uri File URI
     * @return Triple of (fileName, fileSize, mimeType)
     */
    fun getFileInfo(uri: Uri): Triple<String, Long, String> {
        var fileName = "unknown"
        var fileSize = 0L
        var mimeType = "application/octet-stream"

        context.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) {
                val nameIndex = cursor.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
                val sizeIndex = cursor.getColumnIndex(android.provider.OpenableColumns.SIZE)

                if (nameIndex >= 0) {
                    fileName = cursor.getString(nameIndex) ?: "unknown"
                }
                if (sizeIndex >= 0) {
                    fileSize = cursor.getLong(sizeIndex)
                }
            }
        }

        mimeType = context.contentResolver.getType(uri) ?: mimeType

        return Triple(fileName, fileSize, mimeType)
    }

    /**
     * Create transfer metadata for a file
     *
     * @param uri File URI
     * @param senderDeviceId Sender's device ID
     * @param receiverDeviceId Receiver's device ID
     * @return FileTransferMetadata
     */
    suspend fun createTransferMetadata(
        uri: Uri,
        senderDeviceId: String,
        receiverDeviceId: String
    ): FileTransferMetadata = withContext(Dispatchers.IO) {
        val (fileName, fileSize, mimeType) = getFileInfo(uri)
        val checksum = calculateFileChecksum(uri)

        // Generate thumbnail for media files
        val thumbnail = when {
            mimeType.startsWith("image/") -> generateImageThumbnail(uri)
            mimeType.startsWith("video/") -> generateVideoThumbnail(uri)
            else -> null
        }

        FileTransferMetadata.create(
            transferId = UUID.randomUUID().toString(),
            fileName = fileName,
            fileSize = fileSize,
            mimeType = mimeType,
            checksum = checksum,
            senderDeviceId = senderDeviceId,
            receiverDeviceId = receiverDeviceId,
            thumbnail = thumbnail
        )
    }

    /**
     * Delete temp files for a transfer
     *
     * @param transferId Transfer ID
     */
    fun cleanupTempFiles(transferId: String) {
        val transferDir = File(context.cacheDir, "file_transfers")
        transferDir.listFiles()?.forEach { file ->
            if (file.name.startsWith(transferId)) {
                file.delete()
            }
        }
    }

    /**
     * Clean up all old temp files
     *
     * @param maxAgeMillis Max age of temp files to keep (default 24 hours)
     */
    fun cleanupOldTempFiles(maxAgeMillis: Long = 24 * 60 * 60 * 1000L) {
        val transferDir = File(context.cacheDir, "file_transfers")
        val cutoffTime = System.currentTimeMillis() - maxAgeMillis

        transferDir.listFiles()?.forEach { file ->
            if (file.lastModified() < cutoffTime) {
                file.delete()
            }
        }
    }

    // Helper functions

    private fun bytesToHex(bytes: ByteArray): String {
        return bytes.joinToString("") { "%02x".format(it) }
    }

    private fun calculateSampleSize(
        options: BitmapFactory.Options,
        reqWidth: Int,
        reqHeight: Int
    ): Int {
        val (height, width) = options.outHeight to options.outWidth
        var inSampleSize = 1

        if (height > reqHeight || width > reqWidth) {
            val halfHeight = height / 2
            val halfWidth = width / 2

            while (halfHeight / inSampleSize >= reqHeight && halfWidth / inSampleSize >= reqWidth) {
                inSampleSize *= 2
            }
        }

        return inSampleSize
    }

    private fun scaleBitmap(bitmap: Bitmap, maxSize: Int): Bitmap {
        val ratio = minOf(
            maxSize.toFloat() / bitmap.width,
            maxSize.toFloat() / bitmap.height
        )

        if (ratio >= 1f) return bitmap

        val newWidth = (bitmap.width * ratio).toInt()
        val newHeight = (bitmap.height * ratio).toInt()

        return Bitmap.createScaledBitmap(bitmap, newWidth, newHeight, true)
    }
}

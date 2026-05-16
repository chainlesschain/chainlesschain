package com.chainlesschain.android.remote.data

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.webkit.MimeTypeMap
import com.chainlesschain.android.remote.commands.FileCommands
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.security.MessageDigest
import javax.inject.Inject
import javax.inject.Singleton
import timber.log.Timber

/**
 * 文件传输 Repository
 *
 * 负责文件传输的业务逻辑
 */
@Singleton
class FileTransferRepository @Inject constructor(
    @ApplicationContext private val context: Context,
    private val fileCommands: FileCommands,
    private val database: CommandHistoryDatabase
) {
    private val dao = database.fileTransferDao()

    // 默认分块大小（256KB）
    private val DEFAULT_CHUNK_SIZE = 256 * 1024

    // transferId → 下载落点的 content:// uri (MediaStore.Downloads insert 返回值)。
    // 不持久化 — entity 不带 @Ignore 字段（Room 限制），且 process 重启后 uri
    // 通常仍有效但缺再次访问的稳定性保证。后续如需"打开历史下载"，应改 MediaStore
    // .Files 按 DISPLAY_NAME query 反向定位。
    private val downloadUris = java.util.concurrent.ConcurrentHashMap<String, String>()

    /**
     * 获取下载完成后的 content:// uri。VM 用它 Intent.ACTION_VIEW 拉起系统 viewer。
     * 未找到 → null（fallback 打开 Downloads 文件夹）。
     */
    fun getDownloadUri(transferId: String): String? = downloadUris[transferId]

    /**
     * 上传文件（Android → PC）
     */
    suspend fun uploadFile(
        uri: Uri,
        fileName: String,
        deviceDid: String,
        onProgress: ((Double) -> Unit)? = null
    ): Result<FileTransferEntity> = withContext(Dispatchers.IO) {
        try {
            // 1. 读取文件信息
            val inputStream = context.contentResolver.openInputStream(uri)
                ?: return@withContext Result.failure(Exception("Cannot open file"))

            val tempFile = File(context.cacheDir, "upload_temp_$fileName")
            inputStream.use { input ->
                tempFile.outputStream().use { output ->
                    input.copyTo(output)
                }
            }

            val fileSize = tempFile.length()

            // 2. 计算 MD5 校验和
            val checksum = calculateMD5(tempFile)

            // 3. 请求上传
            val requestResult = fileCommands.requestUpload(
                fileName = fileName,
                fileSize = fileSize,
                checksum = "md5:$checksum"
            )

            if (requestResult.isFailure) {
                tempFile.delete()
                return@withContext Result.failure(requestResult.exceptionOrNull() ?: Exception("Unknown error"))
            }

            val uploadRequest = requestResult.getOrThrow()

            // 4. 创建传输记录
            val transfer = FileTransferEntity(
                id = uploadRequest.transferId,
                deviceDid = deviceDid,
                direction = TransferDirection.UPLOAD,
                fileName = fileName,
                fileSize = fileSize,
                status = TransferStatus.IN_PROGRESS,
                chunkSize = uploadRequest.chunkSize,
                totalChunks = uploadRequest.totalChunks,
                localPath = tempFile.absolutePath,
                checksum = checksum
            )

            dao.insert(transfer)

            // 5. 上传分块
            val totalChunks = uploadRequest.totalChunks
            val chunkSize = uploadRequest.chunkSize

            for (chunkIndex in 0 until totalChunks) {
                // 读取分块数据
                val chunkData = readChunk(tempFile, chunkIndex, chunkSize)
                val base64Data = Base64.encodeToString(chunkData, Base64.NO_WRAP)

                // 上传分块
                val chunkResult = fileCommands.uploadChunk(
                    transferId = uploadRequest.transferId,
                    chunkIndex = chunkIndex,
                    chunkData = base64Data
                )

                if (chunkResult.isFailure) {
                    // 标记失败
                    dao.updateStatus(
                        id = uploadRequest.transferId,
                        status = TransferStatus.FAILED,
                        error = chunkResult.exceptionOrNull()?.message
                    )
                    tempFile.delete()
                    return@withContext Result.failure(chunkResult.exceptionOrNull() ?: Exception("Unknown error"))
                }

                val chunkResponse = chunkResult.getOrThrow()

                // 更新进度
                val progress = chunkResponse.progress
                val bytesTransferred = ((fileSize * progress) / 100).toLong()

                dao.updateProgress(
                    id = uploadRequest.transferId,
                    progress = progress,
                    bytesTransferred = bytesTransferred
                )

                onProgress?.invoke(progress)

                Timber.d("Uploaded chunk $chunkIndex/$totalChunks (${progress}%)")
            }

            // 6. 完成上传
            val completeResult = fileCommands.completeUpload(uploadRequest.transferId)

            if (completeResult.isFailure) {
                dao.updateStatus(
                    id = uploadRequest.transferId,
                    status = TransferStatus.FAILED,
                    error = completeResult.exceptionOrNull()?.message
                )
                tempFile.delete()
                return@withContext Result.failure(completeResult.exceptionOrNull() ?: Exception("Unknown error"))
            }

            val completeResponse = completeResult.getOrThrow()

            // 7. 标记完成
            val duration = completeResponse.duration
            val speed = if (duration > 0) (fileSize * 1000.0 / duration) else 0.0

            dao.markCompleted(
                id = uploadRequest.transferId,
                duration = duration,
                speed = speed
            )

            // 8. 清理临时文件
            tempFile.delete()

            // 9. 返回最终状态：把 completeResponse 返回的 PC 绝对路径写回 entity.remotePath
            //    供 UI 显示「上传到 C:\Users\...\Downloads\<name>」让用户知道落点。
            val finalTransfer = dao.getById(uploadRequest.transferId)
                ?: return@withContext Result.failure(Exception("Transfer not found"))
            val patched = finalTransfer.copy(remotePath = completeResponse.filePath)
            dao.update(patched)

            Result.success(patched)

        } catch (e: Exception) {
            Timber.e(e, "Upload failed")
            Result.failure(e)
        }
    }

    /**
     * 下载文件（PC → Android）
     */
    suspend fun downloadFile(
        remotePath: String,
        fileName: String,
        deviceDid: String,
        onProgress: ((Double) -> Unit)? = null
    ): Result<FileTransferEntity> = withContext(Dispatchers.IO) {
        try {
            // 1. 请求下载
            val requestResult = fileCommands.requestDownload(
                filePath = remotePath,
                fileName = fileName
            )

            if (requestResult.isFailure) {
                return@withContext Result.failure(requestResult.exceptionOrNull() ?: Exception("Unknown error"))
            }

            val downloadRequest = requestResult.getOrThrow()

            // 2. 决定写入位置：API 29+ 走 MediaStore.Downloads 写到手机公共下载目录
            //    （/storage/emulated/0/Download/<file>），用户用「文件」App、相册、
            //    Chrome 下载页都能直接打开；不需要 WRITE_EXTERNAL_STORAGE 权限。
            //    API <29 fallback 到 app-private external（老逻辑），避免引入运行
            //    时权限请求。displayPath 是给用户看的友好字符串。
            val (writeUri, fallbackFile, displayPath) = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val values = ContentValues().apply {
                    put(MediaStore.MediaColumns.DISPLAY_NAME, downloadRequest.fileName)
                    put(MediaStore.MediaColumns.MIME_TYPE, guessMimeType(downloadRequest.fileName))
                    put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                    put(MediaStore.MediaColumns.IS_PENDING, 1)
                }
                val uri = context.contentResolver.insert(
                    MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                    values,
                ) ?: return@withContext Result.failure(Exception("MediaStore insert 失败"))
                Triple(uri, null as File?, "手机 Download/${downloadRequest.fileName}")
            } else {
                val downloadDir = File(context.getExternalFilesDir(null), "downloads")
                downloadDir.mkdirs()
                val f = File(downloadDir, downloadRequest.fileName)
                Triple(null as Uri?, f, f.absolutePath)
            }

            // 3. 创建传输记录
            val transfer = FileTransferEntity(
                id = downloadRequest.transferId,
                deviceDid = deviceDid,
                direction = TransferDirection.DOWNLOAD,
                fileName = downloadRequest.fileName,
                fileSize = downloadRequest.fileSize,
                status = TransferStatus.IN_PROGRESS,
                chunkSize = downloadRequest.chunkSize,
                totalChunks = downloadRequest.totalChunks,
                localPath = displayPath,
                remotePath = remotePath,
                checksum = downloadRequest.checksum
            )

            dao.insert(transfer)

            // 4. 下载分块（写到 MediaStore uri 或 fallback File）
            val totalChunks = downloadRequest.totalChunks
            val outputStream = if (writeUri != null) {
                context.contentResolver.openOutputStream(writeUri, "w")
                    ?: return@withContext Result.failure(Exception("openOutputStream 失败"))
            } else {
                FileOutputStream(fallbackFile!!)
            }

            try {
                outputStream.use { os ->
                    for (chunkIndex in 0 until totalChunks) {
                        val chunkResult = fileCommands.downloadChunk(
                            transferId = downloadRequest.transferId,
                            chunkIndex = chunkIndex
                        )

                        if (chunkResult.isFailure) {
                            cleanupFailedDownload(writeUri, fallbackFile)
                            dao.updateStatus(
                                id = downloadRequest.transferId,
                                status = TransferStatus.FAILED,
                                error = chunkResult.exceptionOrNull()?.message
                            )
                            return@withContext Result.failure(chunkResult.exceptionOrNull() ?: Exception("Unknown error"))
                        }

                        val chunkResponse = chunkResult.getOrThrow()
                        val chunkData = Base64.decode(chunkResponse.chunkData, Base64.NO_WRAP)
                        os.write(chunkData)

                        val progress = chunkResponse.progress
                        val bytesTransferred = ((downloadRequest.fileSize * progress) / 100).toLong()

                        dao.updateProgress(
                            id = downloadRequest.transferId,
                            progress = progress,
                            bytesTransferred = bytesTransferred
                        )
                        onProgress?.invoke(progress)
                        Timber.d("Downloaded chunk $chunkIndex/$totalChunks (${progress}%)")
                    }
                }
            } catch (e: Exception) {
                cleanupFailedDownload(writeUri, fallbackFile)
                throw e
            }

            // 4.5 标 MediaStore 条目为非 pending（让 file picker / 文件管理器看到）
            //      + 把 uri 存进内存 map 供 VM 取出做 Intent.ACTION_VIEW。
            if (writeUri != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val finalize = ContentValues().apply {
                    put(MediaStore.MediaColumns.IS_PENDING, 0)
                }
                context.contentResolver.update(writeUri, finalize, null, null)
                downloadUris[downloadRequest.transferId] = writeUri.toString()
            } else if (fallbackFile != null) {
                // 老 Android (< API 29) fallback：app-private 路径，Intent.ACTION_VIEW
                // 需要 FileProvider；先 skip uri，让 VM fallback 打开 Downloads 文件夹
                // (其实是 app-private 看不见)。可后续补 FileProvider 适配。
            }

            // 5. 验证校验和（如果提供）— 期望 "md5:" 前缀的完整 MD5。
            //    PC 端目前 skip，所以这段几乎走不到；保留兼容旧 PC 端。
            if (downloadRequest.checksum != null && fallbackFile != null) {
                val actualChecksum = calculateMD5(fallbackFile)
                val expectedChecksum = downloadRequest.checksum.removePrefix("md5:")

                if (actualChecksum != expectedChecksum) {
                    cleanupFailedDownload(writeUri, fallbackFile)
                    dao.updateStatus(
                        id = downloadRequest.transferId,
                        status = TransferStatus.FAILED,
                        error = "Checksum mismatch"
                    )
                    return@withContext Result.failure(Exception("Checksum mismatch"))
                }
            }

            // 6. 标记完成
            val duration = System.currentTimeMillis() - transfer.createdAt
            val speed = if (duration > 0) (downloadRequest.fileSize * 1000.0 / duration) else 0.0

            dao.markCompleted(
                id = downloadRequest.transferId,
                duration = duration,
                speed = speed
            )

            // 7. 返回最终状态
            val finalTransfer = dao.getById(downloadRequest.transferId)
                ?: return@withContext Result.failure(Exception("Transfer not found"))

            Result.success(finalTransfer)

        } catch (e: Exception) {
            Timber.e(e, "Download failed")
            Result.failure(e)
        }
    }

    /**
     * 取消传输
     */
    suspend fun cancelTransfer(transferId: String): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            // 1. 调用 PC 端取消
            val cancelResult = fileCommands.cancelTransfer(transferId)

            if (cancelResult.isFailure) {
                return@withContext Result.failure(cancelResult.exceptionOrNull() ?: Exception("Unknown error"))
            }

            // 2. 更新本地状态
            dao.updateStatus(
                id = transferId,
                status = TransferStatus.CANCELLED
            )

            // 3. 清理临时文件
            val transfer = dao.getById(transferId)
            transfer?.localPath?.let { path ->
                val file = File(path)
                if (file.exists() && file.name.startsWith("upload_temp_")) {
                    file.delete()
                }
            }

            Result.success(Unit)

        } catch (e: Exception) {
            Timber.e(e, "Cancel failed")
            Result.failure(e)
        }
    }

    /**
     * 获取传输记录（Flow）
     */
    fun getTransferById(transferId: String): Flow<FileTransferEntity?> {
        return dao.getByIdFlow(transferId)
    }

    /**
     * 获取最近的传输记录
     */
    fun getRecentTransfers(limit: Int = 20): Flow<List<FileTransferEntity>> {
        return dao.getRecentFlow(limit)
    }

    /**
     * 获取活动的传输
     */
    fun getActiveTransfers(): Flow<List<FileTransferEntity>> {
        return dao.getActiveTransfersFlow()
    }

    /**
     * 获取传输统计
     */
    fun getStatistics(): Flow<FileTransferStatistics> {
        return dao.getStatisticsFlow()
    }

    /**
     * 清理完成的传输（超过 N 天）
     */
    suspend fun cleanupOldTransfers(days: Int = 30) {
        val timestamp = System.currentTimeMillis() - (days * 24 * 60 * 60 * 1000L)
        dao.deleteCompletedBefore(timestamp)
    }

    // ========== 工具方法 ==========

    /**
     * 读取文件分块
     */
    private fun readChunk(file: File, chunkIndex: Int, chunkSize: Int): ByteArray {
        val offset = chunkIndex.toLong() * chunkSize

        return FileInputStream(file).use { inputStream ->
            inputStream.skip(offset)

            val isLastChunk = (offset + chunkSize) >= file.length()
            val actualChunkSize = if (isLastChunk) {
                (file.length() - offset).toInt()
            } else {
                chunkSize
            }

            val buffer = ByteArray(actualChunkSize)
            inputStream.read(buffer)
            buffer
        }
    }

    /**
     * 计算 MD5 校验和
     */
    private fun calculateMD5(file: File): String {
        val md = MessageDigest.getInstance("MD5")

        FileInputStream(file).use { inputStream ->
            val buffer = ByteArray(8192)
            var bytesRead: Int

            while (inputStream.read(buffer).also { bytesRead = it } != -1) {
                md.update(buffer, 0, bytesRead)
            }
        }

        val digest = md.digest()
        return digest.joinToString("") { "%02x".format(it) }
    }

    /**
     * 根据文件扩展名猜 MIME。MediaStore.MediaColumns.MIME_TYPE 需要这个值否则
     * 部分文管把文件当 application/octet-stream 显示不出预览。
     */
    private fun guessMimeType(fileName: String): String {
        val ext = fileName.substringAfterLast('.', "").lowercase()
        return MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext)
            ?: "application/octet-stream"
    }

    /**
     * 下载失败时清理残留：MediaStore Uri 删条目；fallback File 删文件。
     */
    private fun cleanupFailedDownload(uri: Uri?, file: File?) {
        try {
            if (uri != null) {
                context.contentResolver.delete(uri, null, null)
            } else {
                file?.delete()
            }
        } catch (e: Exception) {
            Timber.w(e, "cleanupFailedDownload 失败")
        }
    }
}

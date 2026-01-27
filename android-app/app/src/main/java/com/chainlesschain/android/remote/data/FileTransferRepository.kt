package com.chainlesschain.android.remote.data

import android.content.Context
import android.net.Uri
import android.util.Base64
import android.util.Log
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
    private val TAG = "FileTransferRepository"

    // 默认分块大小（256KB）
    private val DEFAULT_CHUNK_SIZE = 256 * 1024

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
            tempFile.outputStream().use { output ->
                inputStream.copyTo(output)
            }
            inputStream.close()

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
                return@withContext Result.failure(requestResult.exceptionOrNull()!!)
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
                    return@withContext Result.failure(chunkResult.exceptionOrNull()!!)
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

                Log.d(TAG, "Uploaded chunk $chunkIndex/$totalChunks (${progress}%)")
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
                return@withContext Result.failure(completeResult.exceptionOrNull()!!)
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

            // 9. 返回最终状态
            val finalTransfer = dao.getById(uploadRequest.transferId)
                ?: return@withContext Result.failure(Exception("Transfer not found"))

            Result.success(finalTransfer)

        } catch (e: Exception) {
            Log.e(TAG, "Upload failed", e)
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
                return@withContext Result.failure(requestResult.exceptionOrNull()!!)
            }

            val downloadRequest = requestResult.getOrThrow()

            // 2. 创建本地文件
            val downloadDir = File(context.getExternalFilesDir(null), "downloads")
            downloadDir.mkdirs()

            val localFile = File(downloadDir, downloadRequest.fileName)

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
                localPath = localFile.absolutePath,
                remotePath = remotePath,
                checksum = downloadRequest.checksum
            )

            dao.insert(transfer)

            // 4. 下载分块
            val totalChunks = downloadRequest.totalChunks
            val outputStream = FileOutputStream(localFile)

            for (chunkIndex in 0 until totalChunks) {
                // 下载分块
                val chunkResult = fileCommands.downloadChunk(
                    transferId = downloadRequest.transferId,
                    chunkIndex = chunkIndex
                )

                if (chunkResult.isFailure) {
                    outputStream.close()
                    localFile.delete()
                    dao.updateStatus(
                        id = downloadRequest.transferId,
                        status = TransferStatus.FAILED,
                        error = chunkResult.exceptionOrNull()?.message
                    )
                    return@withContext Result.failure(chunkResult.exceptionOrNull()!!)
                }

                val chunkResponse = chunkResult.getOrThrow()

                // 解码并写入数据
                val chunkData = Base64.decode(chunkResponse.chunkData, Base64.NO_WRAP)
                outputStream.write(chunkData)

                // 更新进度
                val progress = chunkResponse.progress
                val bytesTransferred = ((downloadRequest.fileSize * progress) / 100).toLong()

                dao.updateProgress(
                    id = downloadRequest.transferId,
                    progress = progress,
                    bytesTransferred = bytesTransferred
                )

                onProgress?.invoke(progress)

                Log.d(TAG, "Downloaded chunk $chunkIndex/$totalChunks (${progress}%)")
            }

            outputStream.close()

            // 5. 验证校验和（如果提供）
            if (downloadRequest.checksum != null) {
                val actualChecksum = calculateMD5(localFile)
                val expectedChecksum = downloadRequest.checksum.removePrefix("md5:")

                if (actualChecksum != expectedChecksum) {
                    localFile.delete()
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
            Log.e(TAG, "Download failed", e)
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
                return@withContext Result.failure(cancelResult.exceptionOrNull()!!)
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
            Log.e(TAG, "Cancel failed", e)
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
        val inputStream = FileInputStream(file)
        inputStream.skip(offset)

        val isLastChunk = (offset + chunkSize) >= file.length()
        val actualChunkSize = if (isLastChunk) {
            (file.length() - offset).toInt()
        } else {
            chunkSize
        }

        val buffer = ByteArray(actualChunkSize)
        inputStream.read(buffer)
        inputStream.close()

        return buffer
    }

    /**
     * 计算 MD5 校验和
     */
    private fun calculateMD5(file: File): String {
        val md = MessageDigest.getInstance("MD5")
        val inputStream = FileInputStream(file)
        val buffer = ByteArray(8192)
        var bytesRead: Int

        while (inputStream.read(buffer).also { bytesRead = it } != -1) {
            md.update(buffer, 0, bytesRead)
        }

        inputStream.close()

        val digest = md.digest()
        return digest.joinToString("") { "%02x".format(it) }
    }
}

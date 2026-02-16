package com.chainlesschain.android.feature.filebrowser.data.repository

import android.content.Context
import android.net.Uri
import timber.log.Timber
import com.chainlesschain.android.core.database.dao.ProjectDao
import com.chainlesschain.android.core.database.entity.ExternalFileEntity
import com.chainlesschain.android.core.database.entity.ImportSource
import com.chainlesschain.android.core.database.entity.ImportType
import com.chainlesschain.android.core.database.entity.ProjectFileEntity
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.security.MessageDigest
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 文件导入仓库
 *
 * 负责将外部文件导入到项目中
 */
@Singleton
class FileImportRepository @Inject constructor(
    @ApplicationContext private val context: Context,
    private val projectDao: ProjectDao
) {

    companion object {
        private const val SMALL_FILE_THRESHOLD = 100 * 1024 // 100KB
    }

    /**
     * 导入结果
     */
    sealed class ImportResult {
        data class Success(val projectFile: ProjectFileEntity) : ImportResult()
        data class Failure(val error: ImportError) : ImportResult()
    }

    /**
     * 导入错误
     */
    data class ImportError(val message: String, val cause: Throwable? = null)

    /**
     * 导入文件到项目
     *
     * @param externalFile 外部文件实体
     * @param targetProjectId 目标项目ID
     * @param importType 导入类型（COPY/LINK/SYNC）
     * @param importSource 导入来源
     * @return 导入结果
     */
    suspend fun importFileToProject(
        externalFile: ExternalFileEntity,
        targetProjectId: String,
        importType: ImportType = ImportType.COPY,
        importSource: ImportSource = ImportSource.FILE_BROWSER
    ): ImportResult = withContext(Dispatchers.IO) {
        try {
            when (importType) {
                ImportType.COPY -> importByCopy(externalFile, targetProjectId, importSource)
                ImportType.LINK -> importByLink(externalFile, targetProjectId, importSource)
                ImportType.SYNC -> importByLink(externalFile, targetProjectId, importSource) // SYNC暂时等同于LINK
            }
        } catch (e: Exception) {
            Timber.e(e, "Import failed")
            ImportResult.Failure(ImportError("导入失败: ${e.message}", e))
        }
    }

    /**
     * 复制模式导入
     *
     * 完整复制文件到项目目录
     */
    private suspend fun importByCopy(
        externalFile: ExternalFileEntity,
        targetProjectId: String,
        importSource: ImportSource
    ): ImportResult {
        val uri = Uri.parse(externalFile.uri)
        val fileId = UUID.randomUUID().toString()

        // Read file content
        val content = try {
            context.contentResolver.openInputStream(uri)?.use { inputStream ->
                inputStream.bufferedReader().readText()
            }
        } catch (e: Exception) {
            Timber.e(e, "Failed to read file content")
            null
        }

        // Determine storage strategy
        val (storedContent, filePath) = if (externalFile.size < SMALL_FILE_THRESHOLD && content != null) {
            // Small file: store in database
            Pair(content, null)
        } else {
            // Large file: write to filesystem
            val projectDir = File(context.filesDir, "projects/$targetProjectId")
            projectDir.mkdirs()
            val targetFile = File(projectDir, fileId)

            context.contentResolver.openInputStream(uri)?.use { inputStream ->
                targetFile.outputStream().use { outputStream ->
                    inputStream.copyTo(outputStream)
                }
            }

            Pair(null, targetFile.absolutePath)
        }

        // Calculate hash
        val hash = content?.let { calculateHash(it) } ?: ""

        // Create ProjectFileEntity
        val projectFile = ProjectFileEntity(
            id = fileId,
            projectId = targetProjectId,
            name = externalFile.displayName,
            path = filePath ?: (externalFile.displayPath ?: externalFile.displayName),
            type = "file",
            mimeType = externalFile.mimeType,
            extension = externalFile.displayName.substringAfterLast('.', ""),
            size = externalFile.size,
            content = storedContent,
            hash = hash,
            createdAt = System.currentTimeMillis(),
            updatedAt = System.currentTimeMillis()
        )

        // Insert to database
        projectDao.insertFile(projectFile)

        // Update project stats
        val project = projectDao.getProjectById(targetProjectId)
        if (project != null) {
            projectDao.updateProjectStats(
                targetProjectId,
                project.fileCount + 1,
                project.totalSize + externalFile.size
            )
        }

        return ImportResult.Success(projectFile)
    }

    /**
     * 链接模式导入
     *
     * 仅保存URI引用，不复制文件内容
     */
    private suspend fun importByLink(
        externalFile: ExternalFileEntity,
        targetProjectId: String,
        importSource: ImportSource
    ): ImportResult {
        val fileId = UUID.randomUUID().toString()

        // Create ProjectFileEntity with URI reference
        // Note: External URI is stored in the path field for LINK mode
        val projectFile = ProjectFileEntity(
            id = fileId,
            projectId = targetProjectId,
            name = externalFile.displayName,
            path = externalFile.uri, // Store external URI as path for LINK mode
            type = "file",
            mimeType = externalFile.mimeType,
            extension = externalFile.displayName.substringAfterLast('.', ""),
            size = externalFile.size,
            content = null, // No content stored
            hash = null,
            createdAt = System.currentTimeMillis(),
            updatedAt = System.currentTimeMillis()
        )

        // Insert to database
        projectDao.insertFile(projectFile)

        // Update project stats (LINK mode doesn't count toward storage)
        val project = projectDao.getProjectById(targetProjectId)
        if (project != null) {
            projectDao.updateProjectStats(
                targetProjectId,
                project.fileCount + 1,
                project.totalSize // No size increase for LINK mode
            )
        }

        return ImportResult.Success(projectFile)
    }

    /**
     * 计算文件内容的SHA-256哈希
     */
    private fun calculateHash(content: String): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val hashBytes = digest.digest(content.toByteArray())
        return hashBytes.joinToString("") { "%02x".format(it) }
    }
}

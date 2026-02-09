package com.chainlesschain.android.feature.project.util

import android.content.Context
import android.util.Log
import com.chainlesschain.android.core.database.entity.ProjectFileEntity
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 项目文件存储管理器
 *
 * 负责将项目文件写入设备存储（与PC端对齐）
 *
 * PC端：使用 fs.writeFile 将文件写入 projects/{projectId}/ 目录
 * Android端：使用此类将文件写入 files/projects/{projectId}/ 目录
 */
@Singleton
class ProjectFileStorage @Inject constructor(
    private val context: Context
) {
    companion object {
        private const val TAG = "ProjectFileStorage"
        private const val PROJECTS_DIR = "projects"
    }

    /**
     * 获取项目根目录
     */
    fun getProjectsRootDir(): File {
        return File(context.filesDir, PROJECTS_DIR).also {
            if (!it.exists()) {
                it.mkdirs()
            }
        }
    }

    /**
     * 获取项目目录
     */
    fun getProjectDir(projectId: String): File {
        return File(getProjectsRootDir(), projectId)
    }

    /**
     * 创建项目目录结构
     * @param projectId 项目ID
     * @param directories 需要创建的子目录列表
     * @return 项目根目录路径
     */
    suspend fun createProjectDirectories(
        projectId: String,
        directories: List<String>
    ): String = withContext(Dispatchers.IO) {
        val projectDir = getProjectDir(projectId)

        // 创建项目根目录
        if (!projectDir.exists()) {
            projectDir.mkdirs()
            Log.d(TAG, "Created project directory: ${projectDir.absolutePath}")
        }

        // 创建子目录
        directories.forEach { dir ->
            val subDir = File(projectDir, dir)
            if (!subDir.exists()) {
                subDir.mkdirs()
                Log.d(TAG, "Created subdirectory: $dir")
            }
        }

        projectDir.absolutePath
    }

    /**
     * 写入项目文件
     * @param projectId 项目ID
     * @param files 文件列表
     * @return 成功写入的文件数量
     */
    suspend fun writeProjectFiles(
        projectId: String,
        files: List<ProjectFileEntity>
    ): Int = withContext(Dispatchers.IO) {
        val projectDir = getProjectDir(projectId)
        var successCount = 0

        // 确保项目目录存在
        if (!projectDir.exists()) {
            projectDir.mkdirs()
        }

        files.forEach { fileEntity ->
            try {
                if (fileEntity.type == "folder") {
                    // 创建文件夹
                    val folderPath = File(projectDir, fileEntity.path)
                    if (!folderPath.exists()) {
                        folderPath.mkdirs()
                        Log.d(TAG, "Created folder: ${fileEntity.path}")
                    }
                    successCount++
                } else {
                    // 写入文件内容
                    val filePath = File(projectDir, fileEntity.path)

                    // 确保父目录存在
                    filePath.parentFile?.let { parent ->
                        if (!parent.exists()) {
                            parent.mkdirs()
                        }
                    }

                    // 写入内容
                    val content = fileEntity.content ?: ""
                    filePath.writeText(content, Charsets.UTF_8)

                    Log.d(TAG, "Wrote file: ${fileEntity.path} (${content.length} chars)")
                    successCount++
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to write file: ${fileEntity.path}", e)
            }
        }

        Log.i(TAG, "Wrote $successCount/${files.size} files to project $projectId")
        successCount
    }

    /**
     * 写入单个文件
     */
    suspend fun writeFile(
        projectId: String,
        relativePath: String,
        content: String
    ): Boolean = withContext(Dispatchers.IO) {
        try {
            val projectDir = getProjectDir(projectId)
            val filePath = File(projectDir, relativePath)

            // 确保父目录存在
            filePath.parentFile?.let { parent ->
                if (!parent.exists()) {
                    parent.mkdirs()
                }
            }

            filePath.writeText(content, Charsets.UTF_8)
            Log.d(TAG, "Wrote file: $relativePath")
            true
        } catch (e: Exception) {
            Log.e(TAG, "Failed to write file: $relativePath", e)
            false
        }
    }

    /**
     * 读取文件内容
     */
    suspend fun readFile(
        projectId: String,
        relativePath: String
    ): String? = withContext(Dispatchers.IO) {
        try {
            val filePath = File(getProjectDir(projectId), relativePath)
            if (filePath.exists()) {
                filePath.readText(Charsets.UTF_8)
            } else {
                null
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to read file: $relativePath", e)
            null
        }
    }

    /**
     * 删除项目目录及所有文件
     */
    suspend fun deleteProjectFiles(projectId: String): Boolean = withContext(Dispatchers.IO) {
        try {
            val projectDir = getProjectDir(projectId)
            if (projectDir.exists()) {
                projectDir.deleteRecursively()
                Log.d(TAG, "Deleted project directory: $projectId")
            }
            true
        } catch (e: Exception) {
            Log.e(TAG, "Failed to delete project directory: $projectId", e)
            false
        }
    }

    /**
     * 检查项目目录是否存在
     */
    fun projectExists(projectId: String): Boolean {
        return getProjectDir(projectId).exists()
    }

    /**
     * 获取项目目录大小（字节）
     */
    suspend fun getProjectSize(projectId: String): Long = withContext(Dispatchers.IO) {
        val projectDir = getProjectDir(projectId)
        if (projectDir.exists()) {
            calculateDirSize(projectDir)
        } else {
            0L
        }
    }

    private fun calculateDirSize(dir: File): Long {
        var size = 0L
        dir.listFiles()?.forEach { file ->
            size += if (file.isDirectory) {
                calculateDirSize(file)
            } else {
                file.length()
            }
        }
        return size
    }

    /**
     * 列出项目中的所有文件
     */
    suspend fun listProjectFiles(projectId: String): List<String> = withContext(Dispatchers.IO) {
        val projectDir = getProjectDir(projectId)
        if (projectDir.exists()) {
            projectDir.walkTopDown()
                .filter { it.isFile }
                .map { it.relativeTo(projectDir).path }
                .toList()
        } else {
            emptyList()
        }
    }
}

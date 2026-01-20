package com.chainlesschain.android.feature.project.repository

import com.chainlesschain.android.core.common.Result
import com.chainlesschain.android.core.database.dao.ProjectChatMessageDao
import com.chainlesschain.android.core.database.dao.ProjectDao
import com.chainlesschain.android.core.database.entity.ProjectChatMessageEntity
import com.chainlesschain.android.core.database.entity.ProjectChatRole
import com.chainlesschain.android.core.database.entity.ProjectFileEntity
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Repository for project-specific AI chat functionality
 */
@Singleton
class ProjectChatRepository @Inject constructor(
    private val projectChatMessageDao: ProjectChatMessageDao,
    private val projectDao: ProjectDao
) {

    private val json = Json { ignoreUnknownKeys = true }

    /**
     * Get all chat messages for a project
     */
    fun getMessages(projectId: String): Flow<List<ProjectChatMessageEntity>> {
        return projectChatMessageDao.getMessagesByProject(projectId)
    }

    /**
     * Get recent messages for context building
     */
    suspend fun getRecentMessages(projectId: String, count: Int = 20): List<ProjectChatMessageEntity> {
        return projectChatMessageDao.getRecentMessages(projectId, count).reversed()
    }

    /**
     * Get message count for a project
     */
    suspend fun getMessageCount(projectId: String): Int {
        return projectChatMessageDao.getMessageCount(projectId)
    }

    /**
     * Get total token usage for a project
     */
    suspend fun getTotalTokenCount(projectId: String): Int {
        return projectChatMessageDao.getTotalTokenCount(projectId)
    }

    /**
     * Add a user message
     */
    suspend fun addUserMessage(
        projectId: String,
        content: String,
        referencedFileIds: List<String>? = null
    ): Result<ProjectChatMessageEntity> {
        return try {
            val message = ProjectChatMessageEntity(
                id = UUID.randomUUID().toString(),
                projectId = projectId,
                role = ProjectChatRole.USER,
                content = content,
                referencedFileIds = referencedFileIds?.let { json.encodeToString(it) },
                createdAt = System.currentTimeMillis()
            )
            projectChatMessageDao.insertMessage(message)
            Result.success(message)
        } catch (e: Exception) {
            Result.error(e, "Failed to add user message")
        }
    }

    /**
     * Create a placeholder for streaming assistant response
     */
    suspend fun createAssistantMessagePlaceholder(
        projectId: String,
        model: String,
        isQuickAction: Boolean = false,
        quickActionType: String? = null
    ): Result<ProjectChatMessageEntity> {
        return try {
            val message = ProjectChatMessageEntity(
                id = UUID.randomUUID().toString(),
                projectId = projectId,
                role = ProjectChatRole.ASSISTANT,
                content = "",
                model = model,
                isQuickAction = isQuickAction,
                quickActionType = quickActionType,
                isStreaming = true,
                createdAt = System.currentTimeMillis()
            )
            projectChatMessageDao.insertMessage(message)
            Result.success(message)
        } catch (e: Exception) {
            Result.error(e, "Failed to create assistant message placeholder")
        }
    }

    /**
     * Update streaming message content
     */
    suspend fun updateStreamingContent(messageId: String, content: String) {
        projectChatMessageDao.updateMessageContent(messageId, content, isStreaming = true)
    }

    /**
     * Complete a streaming message
     */
    suspend fun completeMessage(messageId: String, tokenCount: Int? = null) {
        projectChatMessageDao.completeMessage(messageId, tokenCount)
    }

    /**
     * Set message error
     */
    suspend fun setMessageError(messageId: String, error: String) {
        projectChatMessageDao.setMessageError(messageId, error)
    }

    /**
     * Delete a message
     */
    suspend fun deleteMessage(messageId: String): Result<Unit> {
        return try {
            projectChatMessageDao.deleteMessage(messageId)
            Result.success(Unit)
        } catch (e: Exception) {
            Result.error(e, "Failed to delete message")
        }
    }

    /**
     * Clear all chat history for a project
     */
    suspend fun clearChatHistory(projectId: String): Result<Unit> {
        return try {
            projectChatMessageDao.deleteAllMessages(projectId)
            Result.success(Unit)
        } catch (e: Exception) {
            Result.error(e, "Failed to clear chat history")
        }
    }

    /**
     * Search messages
     */
    suspend fun searchMessages(projectId: String, query: String): List<ProjectChatMessageEntity> {
        return projectChatMessageDao.searchMessages(projectId, query)
    }

    /**
     * Build system prompt with project context
     */
    suspend fun buildProjectContext(projectId: String): String {
        val project = projectDao.getProjectById(projectId) ?: return ""
        val files = projectDao.getProjectFilesSync(projectId)

        val fileTree = buildFileTreeString(files)

        return """
You are an AI assistant helping with the project "${project.name}".

Project Information:
- Name: ${project.name}
- Type: ${project.type}
- Description: ${project.description ?: "No description"}
- Status: ${project.status}
- File Count: ${project.fileCount}
- Total Size: ${formatFileSize(project.totalSize)}

Project File Structure:
$fileTree

When the user mentions @filename, they are referring to a specific file in the project.
You can help with:
- Explaining code and project structure
- Generating documentation (README, comments)
- Suggesting improvements and refactoring
- Answering questions about the project
- Creating new files with appropriate content

Be concise and helpful. Reference specific files when relevant.
        """.trimIndent()
    }

    /**
     * Get file content by path (for @mentions)
     */
    suspend fun getFileContent(projectId: String, filePath: String): String? {
        val files = projectDao.getProjectFilesSync(projectId)
        return files.find { it.path == filePath || it.name == filePath }?.content
    }

    /**
     * Get file content by ID
     */
    suspend fun getFileContentById(fileId: String): String? {
        return projectDao.getFileById(fileId)?.content
    }

    private fun buildFileTreeString(files: List<ProjectFileEntity>, indent: String = ""): String {
        val rootFiles = files.filter { it.parentId == null }
        return buildFileTreeRecursive(rootFiles, files, "")
    }

    private fun buildFileTreeRecursive(
        currentLevel: List<ProjectFileEntity>,
        allFiles: List<ProjectFileEntity>,
        indent: String
    ): String {
        val result = StringBuilder()
        val sorted = currentLevel.sortedWith(compareBy({ it.type != "folder" }, { it.name }))

        sorted.forEach { file ->
            val prefix = if (file.type == "folder") "[D]" else "[F]"
            result.appendLine("$indent$prefix ${file.name}")

            if (file.type == "folder") {
                val children = allFiles.filter { it.parentId == file.id }
                if (children.isNotEmpty()) {
                    result.append(buildFileTreeRecursive(children, allFiles, "$indent  "))
                }
            }
        }
        return result.toString()
    }

    private fun formatFileSize(bytes: Long): String {
        return when {
            bytes < 1024 -> "$bytes B"
            bytes < 1024 * 1024 -> "${bytes / 1024} KB"
            bytes < 1024 * 1024 * 1024 -> "${bytes / (1024 * 1024)} MB"
            else -> "${bytes / (1024 * 1024 * 1024)} GB"
        }
    }
}

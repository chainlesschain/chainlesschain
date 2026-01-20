package com.chainlesschain.android.core.database.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import com.chainlesschain.android.core.database.entity.ProjectChatMessageEntity
import kotlinx.coroutines.flow.Flow

/**
 * DAO for project-specific AI chat messages
 */
@Dao
interface ProjectChatMessageDao {

    /**
     * Get all messages for a project, ordered by creation time
     */
    @Query("SELECT * FROM project_chat_messages WHERE projectId = :projectId ORDER BY createdAt ASC")
    fun getMessagesByProject(projectId: String): Flow<List<ProjectChatMessageEntity>>

    /**
     * Get messages with pagination
     */
    @Query("""
        SELECT * FROM project_chat_messages
        WHERE projectId = :projectId
        ORDER BY createdAt DESC
        LIMIT :limit OFFSET :offset
    """)
    suspend fun getMessagesPaged(projectId: String, limit: Int, offset: Int): List<ProjectChatMessageEntity>

    /**
     * Get a single message by ID
     */
    @Query("SELECT * FROM project_chat_messages WHERE id = :messageId")
    suspend fun getMessageById(messageId: String): ProjectChatMessageEntity?

    /**
     * Get the last N messages for a project (for context building)
     */
    @Query("""
        SELECT * FROM project_chat_messages
        WHERE projectId = :projectId
        ORDER BY createdAt DESC
        LIMIT :count
    """)
    suspend fun getRecentMessages(projectId: String, count: Int): List<ProjectChatMessageEntity>

    /**
     * Get total message count for a project
     */
    @Query("SELECT COUNT(*) FROM project_chat_messages WHERE projectId = :projectId")
    suspend fun getMessageCount(projectId: String): Int

    /**
     * Get total token count for a project
     */
    @Query("SELECT COALESCE(SUM(tokenCount), 0) FROM project_chat_messages WHERE projectId = :projectId")
    suspend fun getTotalTokenCount(projectId: String): Int

    /**
     * Insert a new message
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertMessage(message: ProjectChatMessageEntity)

    /**
     * Insert multiple messages
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertMessages(messages: List<ProjectChatMessageEntity>)

    /**
     * Update an existing message (e.g., when streaming completes)
     */
    @Update
    suspend fun updateMessage(message: ProjectChatMessageEntity)

    /**
     * Update message content (for streaming updates)
     */
    @Query("UPDATE project_chat_messages SET content = :content, isStreaming = :isStreaming WHERE id = :messageId")
    suspend fun updateMessageContent(messageId: String, content: String, isStreaming: Boolean)

    /**
     * Mark message as completed (streaming done)
     */
    @Query("UPDATE project_chat_messages SET isStreaming = 0, tokenCount = :tokenCount WHERE id = :messageId")
    suspend fun completeMessage(messageId: String, tokenCount: Int?)

    /**
     * Mark message as error
     */
    @Query("UPDATE project_chat_messages SET isStreaming = 0, error = :error WHERE id = :messageId")
    suspend fun setMessageError(messageId: String, error: String)

    /**
     * Delete a single message
     */
    @Query("DELETE FROM project_chat_messages WHERE id = :messageId")
    suspend fun deleteMessage(messageId: String)

    /**
     * Delete all messages for a project
     */
    @Query("DELETE FROM project_chat_messages WHERE projectId = :projectId")
    suspend fun deleteAllMessages(projectId: String)

    /**
     * Get messages referencing a specific file
     */
    @Query("""
        SELECT * FROM project_chat_messages
        WHERE projectId = :projectId
        AND referencedFileIds LIKE '%' || :fileId || '%'
        ORDER BY createdAt ASC
    """)
    fun getMessagesReferencingFile(projectId: String, fileId: String): Flow<List<ProjectChatMessageEntity>>

    /**
     * Get quick action messages for a project
     */
    @Query("""
        SELECT * FROM project_chat_messages
        WHERE projectId = :projectId
        AND isQuickAction = 1
        ORDER BY createdAt DESC
    """)
    fun getQuickActionMessages(projectId: String): Flow<List<ProjectChatMessageEntity>>

    /**
     * Search messages by content
     */
    @Query("""
        SELECT * FROM project_chat_messages
        WHERE projectId = :projectId
        AND content LIKE '%' || :query || '%'
        ORDER BY createdAt DESC
    """)
    suspend fun searchMessages(projectId: String, query: String): List<ProjectChatMessageEntity>
}

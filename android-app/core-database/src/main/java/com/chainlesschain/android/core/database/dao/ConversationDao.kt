package com.chainlesschain.android.core.database.dao

import androidx.room.*
import com.chainlesschain.android.core.database.entity.ConversationEntity
import com.chainlesschain.android.core.database.entity.MessageEntity
import kotlinx.coroutines.flow.Flow

/**
 * 对话数据访问对象
 */
@Dao
interface ConversationDao {

    // ===== 会话相关 =====

    /**
     * 获取所有会话
     */
    @Query("""
        SELECT * FROM conversations
        ORDER BY isPinned DESC, updatedAt DESC
    """)
    fun getAllConversations(): Flow<List<ConversationEntity>>

    /**
     * 根据ID获取会话
     */
    @Query("SELECT * FROM conversations WHERE id = :id")
    fun getConversationById(id: String): Flow<ConversationEntity?>

    /**
     * 根据ID获取会话（同步版本）
     */
    @Query("SELECT * FROM conversations WHERE id = :id")
    suspend fun getConversationByIdSync(id: String): ConversationEntity?

    /**
     * 插入会话
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertConversation(conversation: ConversationEntity): Long

    /**
     * 更新会话
     */
    @Update
    suspend fun updateConversation(conversation: ConversationEntity)

    /**
     * 删除会话
     */
    @Delete
    suspend fun deleteConversation(conversation: ConversationEntity)

    /**
     * 更新会话最后活动时间
     */
    @Query("""
        UPDATE conversations
        SET updatedAt = :timestamp, messageCount = messageCount + 1
        WHERE id = :conversationId
    """)
    suspend fun updateConversationTimestamp(
        conversationId: String,
        timestamp: Long = System.currentTimeMillis()
    )

    // ===== 消息相关 =====

    /**
     * 获取会话的所有消息
     */
    @Query("""
        SELECT * FROM messages
        WHERE conversationId = :conversationId
        ORDER BY createdAt ASC
    """)
    fun getMessagesByConversation(conversationId: String): Flow<List<MessageEntity>>

    /**
     * 插入消息
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertMessage(message: MessageEntity): Long

    /**
     * 批量插入消息
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertMessages(messages: List<MessageEntity>)

    /**
     * 删除会话的所有消息
     */
    @Query("DELETE FROM messages WHERE conversationId = :conversationId")
    suspend fun deleteMessagesByConversation(conversationId: String)

    /**
     * 获取会话的消息数量
     */
    @Query("SELECT COUNT(*) FROM messages WHERE conversationId = :conversationId")
    suspend fun getMessageCount(conversationId: String): Int

    /**
     * 删除会话（通过ID）
     */
    @Query("DELETE FROM conversations WHERE id = :conversationId")
    suspend fun deleteConversationById(conversationId: String)

    /**
     * 删除会话及其所有消息（事务）
     */
    @Transaction
    suspend fun deleteConversationWithMessages(conversationId: String) {
        deleteMessagesByConversation(conversationId)
        deleteConversationById(conversationId)
    }
}

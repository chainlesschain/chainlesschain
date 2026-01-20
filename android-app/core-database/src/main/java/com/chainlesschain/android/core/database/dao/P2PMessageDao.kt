package com.chainlesschain.android.core.database.dao

import androidx.paging.PagingSource
import androidx.room.*
import com.chainlesschain.android.core.database.entity.P2PMessageEntity
import kotlinx.coroutines.flow.Flow

/**
 * P2P消息数据访问对象
 */
@Dao
interface P2PMessageDao {

    // ===== 查询方法 =====

    /**
     * 获取与指定设备的所有消息（按时间排序）
     */
    @Query("""
        SELECT * FROM p2p_messages
        WHERE peerId = :peerId
        ORDER BY timestamp ASC
    """)
    fun getMessagesByPeer(peerId: String): Flow<List<P2PMessageEntity>>

    /**
     * 获取与指定设备的消息（分页）
     */
    @Query("""
        SELECT * FROM p2p_messages
        WHERE peerId = :peerId
        ORDER BY timestamp DESC
    """)
    fun getMessagesByPeerPaged(peerId: String): PagingSource<Int, P2PMessageEntity>

    /**
     * 获取最近的消息
     */
    @Query("""
        SELECT * FROM p2p_messages
        WHERE peerId = :peerId
        ORDER BY timestamp DESC
        LIMIT :limit
    """)
    suspend fun getRecentMessages(peerId: String, limit: Int = 50): List<P2PMessageEntity>

    /**
     * 根据ID获取消息
     */
    @Query("SELECT * FROM p2p_messages WHERE id = :messageId")
    suspend fun getMessageById(messageId: String): P2PMessageEntity?

    /**
     * 获取未确认的消息（用于重传）
     */
    @Query("""
        SELECT * FROM p2p_messages
        WHERE peerId = :peerId
          AND isOutgoing = 1
          AND sendStatus != 'DELIVERED'
        ORDER BY timestamp ASC
    """)
    suspend fun getPendingMessages(peerId: String): List<P2PMessageEntity>

    /**
     * 获取所有对话的最后一条消息（用于聊天列表）
     */
    @Query("""
        SELECT * FROM p2p_messages m1
        WHERE timestamp = (
            SELECT MAX(timestamp)
            FROM p2p_messages m2
            WHERE m1.peerId = m2.peerId
        )
        ORDER BY timestamp DESC
    """)
    fun getLastMessagePerPeer(): Flow<List<P2PMessageEntity>>

    /**
     * 获取未读消息数量
     */
    @Query("""
        SELECT COUNT(*) FROM p2p_messages
        WHERE peerId = :peerId
          AND isOutgoing = 0
          AND isAcknowledged = 0
    """)
    fun getUnreadCount(peerId: String): Flow<Int>

    /**
     * 搜索消息内容
     */
    @Query("""
        SELECT * FROM p2p_messages
        WHERE peerId = :peerId
          AND content LIKE '%' || :query || '%'
        ORDER BY timestamp DESC
    """)
    suspend fun searchMessages(peerId: String, query: String): List<P2PMessageEntity>

    // ===== 插入方法 =====

    /**
     * 插入消息
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertMessage(message: P2PMessageEntity): Long

    /**
     * 批量插入消息
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertMessages(messages: List<P2PMessageEntity>)

    // ===== 更新方法 =====

    /**
     * 更新消息
     */
    @Update
    suspend fun updateMessage(message: P2PMessageEntity)

    /**
     * 更新消息发送状态
     */
    @Query("""
        UPDATE p2p_messages
        SET sendStatus = :status
        WHERE id = :messageId
    """)
    suspend fun updateSendStatus(messageId: String, status: String)

    /**
     * 标记消息为已确认
     */
    @Query("""
        UPDATE p2p_messages
        SET isAcknowledged = 1, sendStatus = 'DELIVERED'
        WHERE id = :messageId
    """)
    suspend fun markAsAcknowledged(messageId: String)

    /**
     * 标记所有来自某设备的消息为已读
     */
    @Query("""
        UPDATE p2p_messages
        SET isAcknowledged = 1
        WHERE peerId = :peerId
          AND isOutgoing = 0
          AND isAcknowledged = 0
    """)
    suspend fun markAllAsRead(peerId: String)

    // ===== 删除方法 =====

    /**
     * 删除消息
     */
    @Delete
    suspend fun deleteMessage(message: P2PMessageEntity)

    /**
     * 删除指定ID的消息
     */
    @Query("DELETE FROM p2p_messages WHERE id = :messageId")
    suspend fun deleteMessageById(messageId: String)

    /**
     * 删除与指定设备的所有消息
     */
    @Query("DELETE FROM p2p_messages WHERE peerId = :peerId")
    suspend fun deleteMessagesByPeer(peerId: String)

    /**
     * 删除旧消息（保留最近N条）
     */
    @Query("""
        DELETE FROM p2p_messages
        WHERE peerId = :peerId
          AND id NOT IN (
            SELECT id FROM p2p_messages
            WHERE peerId = :peerId
            ORDER BY timestamp DESC
            LIMIT :keepCount
          )
    """)
    suspend fun deleteOldMessages(peerId: String, keepCount: Int = 1000)

    // ===== 统计方法 =====

    /**
     * 获取与指定设备的消息数量
     */
    @Query("SELECT COUNT(*) FROM p2p_messages WHERE peerId = :peerId")
    suspend fun getMessageCount(peerId: String): Int

    /**
     * 获取所有聊天的设备ID列表
     */
    @Query("SELECT DISTINCT peerId FROM p2p_messages ORDER BY timestamp DESC")
    fun getAllPeerIds(): Flow<List<String>>
}

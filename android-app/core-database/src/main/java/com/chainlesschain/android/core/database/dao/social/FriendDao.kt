package com.chainlesschain.android.core.database.dao.social

import androidx.room.*
import com.chainlesschain.android.core.database.entity.social.FriendEntity
import com.chainlesschain.android.core.database.entity.social.FriendGroupEntity
import com.chainlesschain.android.core.database.entity.social.FriendStatus
import kotlinx.coroutines.flow.Flow

/**
 * 好友数据访问对象
 */
@Dao
interface FriendDao {

    // ===== 查询方法 =====

    /**
     * 获取所有好友（已接受状态）
     */
    @Query("SELECT * FROM friends WHERE status = 'ACCEPTED' AND isBlocked = 0 ORDER BY addedAt DESC")
    fun getAllFriends(): Flow<List<FriendEntity>>

    /**
     * 根据 DID 获取好友
     */
    @Query("SELECT * FROM friends WHERE did = :did")
    suspend fun getFriendByDid(did: String): FriendEntity?

    /**
     * 根据 DID 获取好友（Flow）
     */
    @Query("SELECT * FROM friends WHERE did = :did")
    fun observeFriendByDid(did: String): Flow<FriendEntity?>

    /**
     * 获取待处理的好友请求
     */
    @Query("SELECT * FROM friends WHERE status = 'PENDING' ORDER BY addedAt ASC")
    fun getPendingRequests(): Flow<List<FriendEntity>>

    /**
     * 获取指定分组的好友
     */
    @Query("SELECT * FROM friends WHERE groupId = :groupId AND status = 'ACCEPTED' AND isBlocked = 0 ORDER BY addedAt DESC")
    fun getFriendsByGroup(groupId: String): Flow<List<FriendEntity>>

    /**
     * 搜索好友
     */
    @Query("""
        SELECT * FROM friends
        WHERE status = 'ACCEPTED'
          AND isBlocked = 0
          AND (nickname LIKE '%' || :query || '%' OR remarkName LIKE '%' || :query || '%')
        ORDER BY
          CASE
            WHEN nickname LIKE :query || '%' OR remarkName LIKE :query || '%' THEN 0
            ELSE 1
          END,
          addedAt DESC
    """)
    fun searchFriends(query: String): Flow<List<FriendEntity>>

    /**
     * 获取被屏蔽的好友
     */
    @Query("SELECT * FROM friends WHERE isBlocked = 1 ORDER BY addedAt DESC")
    fun getBlockedFriends(): Flow<List<FriendEntity>>

    /**
     * 获取好友总数
     */
    @Query("SELECT COUNT(*) FROM friends WHERE status = 'ACCEPTED' AND isBlocked = 0")
    suspend fun getFriendCount(): Int

    /**
     * 获取待处理请求数
     */
    @Query("SELECT COUNT(*) FROM friends WHERE status = 'PENDING'")
    fun getPendingRequestCount(): Flow<Int>

    /**
     * 检查是否为好友
     */
    @Query("SELECT COUNT(*) > 0 FROM friends WHERE did = :did AND status = 'ACCEPTED' AND isBlocked = 0")
    suspend fun isFriend(did: String): Boolean

    // ===== 插入方法 =====

    /**
     * 插入好友
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(friend: FriendEntity)

    /**
     * 批量插入好友
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(friends: List<FriendEntity>)

    // ===== 更新方法 =====

    /**
     * 更新好友
     */
    @Update
    suspend fun update(friend: FriendEntity)

    /**
     * 更新好友状态
     */
    @Query("UPDATE friends SET status = :status WHERE did = :did")
    suspend fun updateStatus(did: String, status: FriendStatus)

    /**
     * 更新备注名
     */
    @Query("UPDATE friends SET remarkName = :remarkName WHERE did = :did")
    suspend fun updateRemarkName(did: String, remarkName: String?)

    /**
     * 更新分组
     */
    @Query("UPDATE friends SET groupId = :groupId WHERE did = :did")
    suspend fun updateGroup(did: String, groupId: String?)

    /**
     * 更新屏蔽状态
     */
    @Query("UPDATE friends SET isBlocked = :isBlocked WHERE did = :did")
    suspend fun updateBlockStatus(did: String, isBlocked: Boolean)

    /**
     * 更新最后活跃时间
     */
    @Query("UPDATE friends SET lastActiveAt = :time WHERE did = :did")
    suspend fun updateLastActiveAt(did: String, time: Long)

    // ===== 删除方法 =====

    /**
     * 删除好友
     */
    @Delete
    suspend fun delete(friend: FriendEntity)

    /**
     * 根据 DID 删除好友
     */
    @Query("DELETE FROM friends WHERE did = :did")
    suspend fun deleteByDid(did: String)

    /**
     * 清理已拒绝和已删除的记录
     */
    @Query("DELETE FROM friends WHERE status IN ('REJECTED', 'DELETED') AND addedAt < :cutoffTime")
    suspend fun cleanupOldRecords(cutoffTime: Long)

    // ===== 分组相关方法 =====

    /**
     * 获取所有分组
     */
    @Query("SELECT * FROM friend_groups ORDER BY sortOrder ASC, name ASC")
    fun getAllGroups(): Flow<List<FriendGroupEntity>>

    /**
     * 根据 ID 获取分组
     */
    @Query("SELECT * FROM friend_groups WHERE id = :id")
    suspend fun getGroupById(id: String): FriendGroupEntity?

    /**
     * 插入分组
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertGroup(group: FriendGroupEntity)

    /**
     * 更新分组
     */
    @Update
    suspend fun updateGroup(group: FriendGroupEntity)

    /**
     * 删除分组
     */
    @Delete
    suspend fun deleteGroup(group: FriendGroupEntity)

    /**
     * 根据 ID 删除分组
     */
    @Query("DELETE FROM friend_groups WHERE id = :id")
    suspend fun deleteGroupById(id: String)

    /**
     * 获取分组中的好友数量
     */
    @Query("SELECT COUNT(*) FROM friends WHERE groupId = :groupId AND status = 'ACCEPTED' AND isBlocked = 0")
    suspend fun getFriendCountInGroup(groupId: String): Int
}

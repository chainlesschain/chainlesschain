package com.chainlesschain.android.core.database.dao.social

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.chainlesschain.android.core.database.entity.social.BlockedUserEntity
import kotlinx.coroutines.flow.Flow

/**
 * 屏蔽用户数据访问对象
 */
@Dao
interface BlockedUserDao {

    /**
     * 获取某用户屏蔽的所有用户
     */
    @Query("SELECT * FROM blocked_users WHERE blockerDid = :blockerDid ORDER BY createdAt DESC")
    fun getBlockedUsers(blockerDid: String): Flow<List<BlockedUserEntity>>

    /**
     * 插入屏蔽记录
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertBlockedUser(entity: BlockedUserEntity)

    /**
     * 移除屏蔽记录
     */
    @Query("DELETE FROM blocked_users WHERE blockerDid = :blockerDid AND blockedDid = :blockedDid")
    suspend fun removeBlockedUser(blockerDid: String, blockedDid: String)

    /**
     * 检查是否已屏蔽
     */
    @Query("SELECT EXISTS(SELECT 1 FROM blocked_users WHERE blockerDid = :blockerDid AND blockedDid = :blockedDid)")
    suspend fun isBlocked(blockerDid: String, blockedDid: String): Boolean

    /**
     * 获取屏蔽用户数量
     */
    @Query("SELECT COUNT(*) FROM blocked_users WHERE blockerDid = :blockerDid")
    suspend fun getBlockedCount(blockerDid: String): Int
}

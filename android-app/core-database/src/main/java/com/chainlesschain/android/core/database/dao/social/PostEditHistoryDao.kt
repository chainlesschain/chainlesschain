package com.chainlesschain.android.core.database.dao.social

import androidx.room.*
import com.chainlesschain.android.core.database.entity.social.PostEditHistoryEntity
import kotlinx.coroutines.flow.Flow

/**
 * 动态编辑历史DAO
 *
 * 提供动态编辑历史的增删查功能
 *
 * @since v0.31.0
 */
@Dao
interface PostEditHistoryDao {

    /**
     * 插入编辑历史记录
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(history: PostEditHistoryEntity)

    /**
     * 插入多条编辑历史记录
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(histories: List<PostEditHistoryEntity>)

    /**
     * 删除编辑历史记录
     */
    @Delete
    suspend fun delete(history: PostEditHistoryEntity)

    /**
     * 根据动态ID获取所有编辑历史（按时间倒序）
     *
     * @param postId 动态ID
     * @return 编辑历史列表（最新的在前）
     */
    @Query("SELECT * FROM post_edit_history WHERE postId = :postId ORDER BY editedAt DESC")
    fun getHistoriesByPostId(postId: String): Flow<List<PostEditHistoryEntity>>

    /**
     * 根据动态ID获取所有编辑历史（一次性查询，用于Repository）
     *
     * @param postId 动态ID
     * @return 编辑历史列表（最新的在前）
     */
    @Query("SELECT * FROM post_edit_history WHERE postId = :postId ORDER BY editedAt DESC")
    suspend fun getHistoriesByPostIdOnce(postId: String): List<PostEditHistoryEntity>

    /**
     * 根据ID获取单条编辑历史
     *
     * @param historyId 编辑历史ID
     * @return 编辑历史记录，不存在则返回null
     */
    @Query("SELECT * FROM post_edit_history WHERE id = :historyId LIMIT 1")
    suspend fun getHistoryById(historyId: String): PostEditHistoryEntity?

    /**
     * 获取动态的最新编辑历史
     *
     * @param postId 动态ID
     * @return 最新的编辑历史记录，不存在则返回null
     */
    @Query("SELECT * FROM post_edit_history WHERE postId = :postId ORDER BY editedAt DESC LIMIT 1")
    suspend fun getLatestHistoryByPostId(postId: String): PostEditHistoryEntity?

    /**
     * 获取动态的编辑次数
     *
     * @param postId 动态ID
     * @return 编辑次数
     */
    @Query("SELECT COUNT(*) FROM post_edit_history WHERE postId = :postId")
    suspend fun getEditCountByPostId(postId: String): Int

    /**
     * 删除指定动态的所有编辑历史
     *
     * @param postId 动态ID
     */
    @Query("DELETE FROM post_edit_history WHERE postId = :postId")
    suspend fun deleteHistoriesByPostId(postId: String)

    /**
     * 清空所有编辑历史
     */
    @Query("DELETE FROM post_edit_history")
    suspend fun deleteAll()
}

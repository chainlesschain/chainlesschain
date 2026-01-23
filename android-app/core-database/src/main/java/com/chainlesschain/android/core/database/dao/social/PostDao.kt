package com.chainlesschain.android.core.database.dao.social

import androidx.room.*
import com.chainlesschain.android.core.database.entity.social.PostEntity
import com.chainlesschain.android.core.database.entity.social.PostVisibility
import kotlinx.coroutines.flow.Flow

/**
 * 动态数据访问对象
 */
@Dao
interface PostDao {

    // ===== 查询方法 =====

    /**
     * 获取时间流（好友 + 自己的动态）
     */
    @Query("""
        SELECT * FROM posts
        WHERE (authorDid IN (:friendDids) OR authorDid = :myDid)
          AND (visibility = 'PUBLIC' OR (visibility = 'FRIENDS_ONLY' AND authorDid IN (:friendDids)) OR authorDid = :myDid)
        ORDER BY isPinned DESC, createdAt DESC
        LIMIT :limit OFFSET :offset
    """)
    fun getTimeline(
        friendDids: List<String>,
        myDid: String,
        limit: Int,
        offset: Int
    ): Flow<List<PostEntity>>

    /**
     * 获取用户动态
     */
    @Query("""
        SELECT * FROM posts
        WHERE authorDid = :did
        ORDER BY isPinned DESC, createdAt DESC
    """)
    fun getUserPosts(did: String): Flow<List<PostEntity>>

    /**
     * 根据 ID 获取动态
     */
    @Query("SELECT * FROM posts WHERE id = :id")
    suspend fun getPostById(id: String): PostEntity?

    /**
     * 根据 ID 获取动态（Flow）
     */
    @Query("SELECT * FROM posts WHERE id = :id")
    fun observePostById(id: String): Flow<PostEntity?>

    /**
     * 搜索动态
     */
    @Query("""
        SELECT * FROM posts
        WHERE (content LIKE '%' || :query || '%' OR :tag IN (tags))
          AND (visibility = 'PUBLIC' OR authorDid = :myDid OR (visibility = 'FRIENDS_ONLY' AND authorDid IN (:friendDids)))
        ORDER BY createdAt DESC
        LIMIT :limit
    """)
    fun searchPosts(
        query: String,
        tag: String?,
        myDid: String,
        friendDids: List<String>,
        limit: Int = 50
    ): Flow<List<PostEntity>>

    /**
     * 获取包含特定标签的动态
     */
    @Query("""
        SELECT * FROM posts
        WHERE :tag IN (tags)
          AND (visibility = 'PUBLIC' OR authorDid = :myDid OR (visibility = 'FRIENDS_ONLY' AND authorDid IN (:friendDids)))
        ORDER BY createdAt DESC
        LIMIT :limit
    """)
    fun getPostsByTag(
        tag: String,
        myDid: String,
        friendDids: List<String>,
        limit: Int = 50
    ): Flow<List<PostEntity>>

    /**
     * 获取提及自己的动态
     */
    @Query("""
        SELECT * FROM posts
        WHERE :myDid IN (mentions)
        ORDER BY createdAt DESC
    """)
    fun getMentionedPosts(myDid: String): Flow<List<PostEntity>>

    /**
     * 获取用户的置顶动态
     */
    @Query("SELECT * FROM posts WHERE authorDid = :did AND isPinned = 1")
    fun getPinnedPosts(did: String): Flow<List<PostEntity>>

    /**
     * 获取用户的动态数量
     */
    @Query("SELECT COUNT(*) FROM posts WHERE authorDid = :did")
    suspend fun getPostCount(did: String): Int

    // ===== 插入方法 =====

    /**
     * 插入动态
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(post: PostEntity): Long

    /**
     * 批量插入动态
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(posts: List<PostEntity>)

    // ===== 更新方法 =====

    /**
     * 更新动态
     */
    @Update
    suspend fun update(post: PostEntity)

    /**
     * 更新动态内容
     */
    @Query("UPDATE posts SET content = :content, updatedAt = :updatedAt WHERE id = :postId")
    suspend fun updateContent(postId: String, content: String, updatedAt: Long)

    /**
     * 更新点赞状态
     */
    @Query("UPDATE posts SET likeCount = :count, isLiked = :isLiked WHERE id = :postId")
    suspend fun updateLikeStatus(postId: String, count: Int, isLiked: Boolean)

    /**
     * 更新评论数
     */
    @Query("UPDATE posts SET commentCount = :count WHERE id = :postId")
    suspend fun updateCommentCount(postId: String, count: Int)

    /**
     * 更新转发数
     */
    @Query("UPDATE posts SET shareCount = :count WHERE id = :postId")
    suspend fun updateShareCount(postId: String, count: Int)

    /**
     * 增加点赞数
     */
    @Query("UPDATE posts SET likeCount = likeCount + 1, isLiked = 1 WHERE id = :postId")
    suspend fun incrementLikeCount(postId: String)

    /**
     * 减少点赞数
     */
    @Query("UPDATE posts SET likeCount = likeCount - 1, isLiked = 0 WHERE id = :postId AND likeCount > 0")
    suspend fun decrementLikeCount(postId: String)

    /**
     * 增加评论数
     */
    @Query("UPDATE posts SET commentCount = commentCount + 1 WHERE id = :postId")
    suspend fun incrementCommentCount(postId: String)

    /**
     * 减少评论数
     */
    @Query("UPDATE posts SET commentCount = commentCount - 1 WHERE id = :postId AND commentCount > 0")
    suspend fun decrementCommentCount(postId: String)

    /**
     * 增加转发数
     */
    @Query("UPDATE posts SET shareCount = shareCount + 1 WHERE id = :postId")
    suspend fun incrementShareCount(postId: String)

    /**
     * 更新置顶状态
     */
    @Query("UPDATE posts SET isPinned = :isPinned WHERE id = :postId")
    suspend fun updatePinnedStatus(postId: String, isPinned: Boolean)

    /**
     * 取消用户的所有置顶动态
     */
    @Query("UPDATE posts SET isPinned = 0 WHERE authorDid = :did AND isPinned = 1")
    suspend fun unpinAllPosts(did: String)

    // ===== 删除方法 =====

    /**
     * 删除动态
     */
    @Delete
    suspend fun delete(post: PostEntity)

    /**
     * 根据 ID 删除动态
     */
    @Query("DELETE FROM posts WHERE id = :id")
    suspend fun deleteById(id: String)

    /**
     * 删除用户的所有动态
     */
    @Query("DELETE FROM posts WHERE authorDid = :did")
    suspend fun deleteByAuthor(did: String)

    /**
     * 清理旧动态
     */
    @Query("DELETE FROM posts WHERE createdAt < :cutoffTime AND isPinned = 0")
    suspend fun cleanupOldPosts(cutoffTime: Long)

    /**
     * 清理私密动态（超过指定时间）
     */
    @Query("DELETE FROM posts WHERE visibility = 'PRIVATE' AND createdAt < :cutoffTime")
    suspend fun cleanupOldPrivatePosts(cutoffTime: Long)
}

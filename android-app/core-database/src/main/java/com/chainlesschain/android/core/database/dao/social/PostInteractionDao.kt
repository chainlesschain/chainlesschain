package com.chainlesschain.android.core.database.dao.social

import androidx.room.*
import com.chainlesschain.android.core.database.entity.social.PostCommentEntity
import com.chainlesschain.android.core.database.entity.social.PostLikeEntity
import com.chainlesschain.android.core.database.entity.social.PostShareEntity
import kotlinx.coroutines.flow.Flow

/**
 * 动态互动数据访问对象
 *
 * 管理点赞、评论、转发等互动操作
 */
@Dao
interface PostInteractionDao {

    // ===== 点赞相关 =====

    /**
     * 获取动态的所有点赞
     */
    @Query("SELECT * FROM post_likes WHERE postId = :postId ORDER BY createdAt DESC")
    fun getPostLikes(postId: String): Flow<List<PostLikeEntity>>

    /**
     * 获取动态的点赞数
     */
    @Query("SELECT COUNT(*) FROM post_likes WHERE postId = :postId")
    suspend fun getPostLikeCount(postId: String): Int

    /**
     * 检查用户是否点赞了动态
     */
    @Query("SELECT COUNT(*) > 0 FROM post_likes WHERE postId = :postId AND userDid = :userDid")
    suspend fun hasUserLikedPost(postId: String, userDid: String): Boolean

    /**
     * 根据 ID 获取点赞记录
     */
    @Query("SELECT * FROM post_likes WHERE postId = :postId AND userDid = :userDid")
    suspend fun getPostLike(postId: String, userDid: String): PostLikeEntity?

    /**
     * 插入点赞
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertLike(like: PostLikeEntity)

    /**
     * 删除点赞
     */
    @Delete
    suspend fun deleteLike(like: PostLikeEntity)

    /**
     * 根据动态 ID 和用户 DID 删除点赞
     */
    @Query("DELETE FROM post_likes WHERE postId = :postId AND userDid = :userDid")
    suspend fun deleteLike(postId: String, userDid: String)

    /**
     * 删除动态的所有点赞
     */
    @Query("DELETE FROM post_likes WHERE postId = :postId")
    suspend fun deletePostLikes(postId: String)

    /**
     * 获取用户点赞的所有动态
     */
    @Query("SELECT * FROM post_likes WHERE userDid = :userDid ORDER BY createdAt DESC")
    fun getUserLikes(userDid: String): Flow<List<PostLikeEntity>>

    // ===== 评论相关 =====

    /**
     * 获取动态的所有评论（不含回复）
     */
    @Query("""
        SELECT * FROM post_comments
        WHERE postId = :postId AND parentCommentId IS NULL
        ORDER BY createdAt DESC
    """)
    fun getPostComments(postId: String): Flow<List<PostCommentEntity>>

    /**
     * 获取评论的所有回复
     */
    @Query("""
        SELECT * FROM post_comments
        WHERE parentCommentId = :commentId
        ORDER BY createdAt ASC
    """)
    fun getCommentReplies(commentId: String): Flow<List<PostCommentEntity>>

    /**
     * 根据 ID 获取评论
     */
    @Query("SELECT * FROM post_comments WHERE id = :id")
    suspend fun getCommentById(id: String): PostCommentEntity?

    /**
     * 根据 ID 获取评论（Flow）
     */
    @Query("SELECT * FROM post_comments WHERE id = :id")
    fun observeCommentById(id: String): Flow<PostCommentEntity?>

    /**
     * 获取动态的评论数（不含回复）
     */
    @Query("SELECT COUNT(*) FROM post_comments WHERE postId = :postId AND parentCommentId IS NULL")
    suspend fun getPostCommentCount(postId: String): Int

    /**
     * 获取评论的回复数
     */
    @Query("SELECT COUNT(*) FROM post_comments WHERE parentCommentId = :commentId")
    suspend fun getCommentReplyCount(commentId: String): Int

    /**
     * 获取用户的所有评论
     */
    @Query("SELECT * FROM post_comments WHERE authorDid = :did ORDER BY createdAt DESC")
    fun getUserComments(did: String): Flow<List<PostCommentEntity>>

    /**
     * 插入评论
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertComment(comment: PostCommentEntity)

    /**
     * 更新评论
     */
    @Update
    suspend fun updateComment(comment: PostCommentEntity)

    /**
     * 更新评论点赞状态
     */
    @Query("UPDATE post_comments SET likeCount = :count, isLiked = :isLiked WHERE id = :commentId")
    suspend fun updateCommentLikeStatus(commentId: String, count: Int, isLiked: Boolean)

    /**
     * 增加评论点赞数
     */
    @Query("UPDATE post_comments SET likeCount = likeCount + 1, isLiked = 1 WHERE id = :commentId")
    suspend fun incrementCommentLikeCount(commentId: String)

    /**
     * 减少评论点赞数
     */
    @Query("UPDATE post_comments SET likeCount = likeCount - 1, isLiked = 0 WHERE id = :commentId AND likeCount > 0")
    suspend fun decrementCommentLikeCount(commentId: String)

    /**
     * 删除评论
     */
    @Delete
    suspend fun deleteComment(comment: PostCommentEntity)

    /**
     * 根据 ID 删除评论
     */
    @Query("DELETE FROM post_comments WHERE id = :id")
    suspend fun deleteCommentById(id: String)

    /**
     * 删除评论的所有回复
     */
    @Query("DELETE FROM post_comments WHERE parentCommentId = :commentId")
    suspend fun deleteCommentReplies(commentId: String)

    /**
     * 删除动态的所有评论
     */
    @Query("DELETE FROM post_comments WHERE postId = :postId")
    suspend fun deletePostComments(postId: String)

    // ===== 转发相关 =====

    /**
     * 获取动态的所有转发
     */
    @Query("SELECT * FROM post_shares WHERE postId = :postId ORDER BY createdAt DESC")
    fun getPostShares(postId: String): Flow<List<PostShareEntity>>

    /**
     * 获取动态的转发数
     */
    @Query("SELECT COUNT(*) FROM post_shares WHERE postId = :postId")
    suspend fun getPostShareCount(postId: String): Int

    /**
     * 检查用户是否转发了动态
     */
    @Query("SELECT COUNT(*) > 0 FROM post_shares WHERE postId = :postId AND userDid = :userDid")
    suspend fun hasUserSharedPost(postId: String, userDid: String): Boolean

    /**
     * 获取用户的转发记录
     */
    @Query("SELECT * FROM post_shares WHERE postId = :postId AND userDid = :userDid")
    suspend fun getUserShare(postId: String, userDid: String): PostShareEntity?

    /**
     * 获取用户的所有转发
     */
    @Query("SELECT * FROM post_shares WHERE userDid = :userDid ORDER BY createdAt DESC")
    fun getUserShares(userDid: String): Flow<List<PostShareEntity>>

    /**
     * 插入转发
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertShare(share: PostShareEntity)

    /**
     * 删除转发
     */
    @Delete
    suspend fun deleteShare(share: PostShareEntity)

    /**
     * 根据动态 ID 和用户 DID 删除转发
     */
    @Query("DELETE FROM post_shares WHERE postId = :postId AND userDid = :userDid")
    suspend fun deleteShare(postId: String, userDid: String)

    /**
     * 删除动态的所有转发
     */
    @Query("DELETE FROM post_shares WHERE postId = :postId")
    suspend fun deletePostShares(postId: String)

    // ===== 批量操作 =====

    /**
     * 批量插入点赞
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertLikes(likes: List<PostLikeEntity>)

    /**
     * 批量插入评论
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertComments(comments: List<PostCommentEntity>)

    /**
     * 批量插入转发
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertShares(shares: List<PostShareEntity>)

    // ===== 清理操作 =====

    /**
     * 清理旧的点赞记录
     */
    @Query("DELETE FROM post_likes WHERE createdAt < :cutoffTime")
    suspend fun cleanupOldLikes(cutoffTime: Long)

    /**
     * 清理旧的评论
     */
    @Query("DELETE FROM post_comments WHERE createdAt < :cutoffTime")
    suspend fun cleanupOldComments(cutoffTime: Long)

    /**
     * 清理旧的转发记录
     */
    @Query("DELETE FROM post_shares WHERE createdAt < :cutoffTime")
    suspend fun cleanupOldShares(cutoffTime: Long)
}

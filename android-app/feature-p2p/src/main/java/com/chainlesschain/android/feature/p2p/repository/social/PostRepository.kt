package com.chainlesschain.android.feature.p2p.repository.social

import com.chainlesschain.android.core.common.Result
import com.chainlesschain.android.core.common.asResult
import com.chainlesschain.android.core.database.dao.social.PostDao
import com.chainlesschain.android.core.database.dao.social.PostInteractionDao
import com.chainlesschain.android.core.database.dao.social.PostEditHistoryDao
import com.chainlesschain.android.core.database.entity.social.PostEntity
import com.chainlesschain.android.core.database.entity.social.PostCommentEntity
import com.chainlesschain.android.core.database.entity.social.PostLikeEntity
import com.chainlesschain.android.core.database.entity.social.PostShareEntity
import com.chainlesschain.android.core.database.entity.social.PostReportEntity
import com.chainlesschain.android.core.database.entity.social.PostEditHistoryEntity
import com.chainlesschain.android.core.database.entity.social.ReportReason
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 动态数据仓库
 *
 * 管理用户动态、时间流、点赞、评论和转发
 */
@Singleton
class PostRepository @Inject constructor(
    private val postDao: PostDao,
    private val interactionDao: PostInteractionDao,
    private val postEditHistoryDao: PostEditHistoryDao,
    private val syncAdapter: Lazy<SocialSyncAdapter> // 使用 Lazy 避免循环依赖
) {

    // ===== 动态查询 =====

    /**
     * 获取时间流
     */
    fun getTimeline(
        friendDids: List<String>,
        myDid: String,
        limit: Int = 20,
        offset: Int = 0
    ): Flow<Result<List<PostEntity>>> {
        return postDao.getTimeline(friendDids, myDid, limit, offset)
            .asResult()
    }

    /**
     * 获取用户动态
     */
    fun getUserPosts(did: String): Flow<Result<List<PostEntity>>> {
        return postDao.getUserPosts(did)
            .asResult()
    }

    /**
     * 根据 ID 获取动态
     */
    suspend fun getPostById(id: String): Result<PostEntity?> {
        return try {
            Result.Success(postDao.getPostById(id))
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    /**
     * 观察动态
     */
    fun observePostById(id: String): Flow<Result<PostEntity?>> {
        return postDao.observePostById(id)
            .asResult()
    }

    /**
     * 搜索动态
     */
    fun searchPosts(
        query: String,
        tag: String? = null,
        myDid: String,
        friendDids: List<String>,
        limit: Int = 50
    ): Flow<Result<List<PostEntity>>> {
        return postDao.searchPosts(query, tag, myDid, friendDids, limit)
            .asResult()
    }

    /**
     * 获取包含特定标签的动态
     */
    fun getPostsByTag(
        tag: String,
        myDid: String,
        friendDids: List<String>,
        limit: Int = 50
    ): Flow<Result<List<PostEntity>>> {
        return postDao.getPostsByTag(tag, myDid, friendDids, limit)
            .asResult()
    }

    /**
     * 获取提及自己的动态
     */
    fun getMentionedPosts(myDid: String): Flow<Result<List<PostEntity>>> {
        return postDao.getMentionedPosts(myDid)
            .asResult()
    }

    /**
     * 获取置顶动态
     */
    fun getPinnedPosts(did: String): Flow<Result<List<PostEntity>>> {
        return postDao.getPinnedPosts(did)
            .asResult()
    }

    /**
     * 获取动态数量
     */
    suspend fun getPostCount(did: String): Result<Int> {
        return try {
            Result.Success(postDao.getPostCount(did))
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    // ===== 动态管理 =====

    /**
     * 发布动态
     */
    suspend fun createPost(post: PostEntity): Result<Unit> {
        return try {
            postDao.insert(post)
            syncAdapter.value.syncPostCreated(post)
            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    /**
     * 更新动态
     */
    suspend fun updatePost(post: PostEntity): Result<Unit> {
        return try {
            postDao.update(post)
            syncAdapter.value.syncPostUpdated(post)
            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    /**
     * 更新动态内容
     */
    suspend fun updatePostContent(postId: String, content: String, updatedAt: Long): Result<Unit> {
        return try {
            postDao.updateContent(postId, content, updatedAt)
            // 获取更新后的动态并同步
            postDao.getPostById(postId)?.let { post ->
                syncAdapter.value.syncPostUpdated(post)
            }
            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    /**
     * 更新动态并保存编辑历史
     *
     * @param updatedPost 更新后的动态
     * @param editHistory 编辑历史记录
     * @since v0.31.0
     */
    suspend fun updatePostWithHistory(
        updatedPost: PostEntity,
        editHistory: PostEditHistoryEntity
    ): Result<Unit> {
        return try {
            // 先保存编辑历史
            postEditHistoryDao.insert(editHistory)

            // 再更新动态
            postDao.update(updatedPost)

            // 同步到P2P网络
            syncAdapter.value.syncPostUpdated(updatedPost)

            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    /**
     * 获取动态的编辑历史
     *
     * @param postId 动态ID
     * @return 编辑历史列表（按时间倒序）
     * @since v0.31.0
     */
    fun getPostEditHistory(postId: String): Flow<Result<List<PostEditHistoryEntity>>> {
        return postEditHistoryDao.getHistoriesByPostId(postId)
            .asResult()
    }

    /**
     * 获取动态的编辑次数
     *
     * @param postId 动态ID
     * @return 编辑次数
     * @since v0.31.0
     */
    suspend fun getPostEditCount(postId: String): Result<Int> {
        return try {
            Result.Success(postEditHistoryDao.getEditCountByPostId(postId))
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    /**
     * 删除动态
     */
    suspend fun deletePost(id: String): Result<Unit> {
        return try {
            postDao.deleteById(id)
            syncAdapter.value.syncPostDeleted(id)
            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    /**
     * 置顶动态
     */
    suspend fun pinPost(postId: String, did: String): Result<Unit> {
        return try {
            // 先取消该用户的所有置顶
            postDao.unpinAllPosts(did)
            // 再置顶当前动态
            postDao.updatePinnedStatus(postId, true)
            // 获取更新后的动态并同步
            postDao.getPostById(postId)?.let { post ->
                syncAdapter.value.syncPostUpdated(post)
            }
            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    /**
     * 取消置顶
     */
    suspend fun unpinPost(postId: String): Result<Unit> {
        return try {
            postDao.updatePinnedStatus(postId, false)
            // 获取更新后的动态并同步
            postDao.getPostById(postId)?.let { post ->
                syncAdapter.value.syncPostUpdated(post)
            }
            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    // ===== 点赞管理 =====

    /**
     * 获取动态的点赞列表
     */
    fun getPostLikes(postId: String): Flow<Result<List<PostLikeEntity>>> {
        return interactionDao.getPostLikes(postId)
            .asResult()
    }

    /**
     * 点赞动态
     */
    suspend fun likePost(postId: String, userDid: String): Result<Unit> {
        return try {
            val like = PostLikeEntity(
                id = "${postId}_${userDid}",
                postId = postId,
                userDid = userDid,
                createdAt = System.currentTimeMillis()
            )
            interactionDao.insertLike(like)
            postDao.incrementLikeCount(postId)
            syncAdapter.value.syncLikeAdded(like)
            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    /**
     * 取消点赞
     */
    suspend fun unlikePost(postId: String, userDid: String): Result<Unit> {
        return try {
            val likeId = "${postId}_${userDid}"
            interactionDao.deleteLike(postId, userDid)
            postDao.decrementLikeCount(postId)
            syncAdapter.value.syncLikeRemoved(likeId)
            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    /**
     * 检查是否已点赞
     */
    suspend fun hasUserLikedPost(postId: String, userDid: String): Result<Boolean> {
        return try {
            Result.Success(interactionDao.hasUserLikedPost(postId, userDid))
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    // ===== 评论管理 =====

    /**
     * 获取动态的评论
     */
    fun getPostComments(postId: String): Flow<Result<List<PostCommentEntity>>> {
        return interactionDao.getPostComments(postId)
            .asResult()
    }

    /**
     * 获取评论的回复
     */
    fun getCommentReplies(commentId: String): Flow<Result<List<PostCommentEntity>>> {
        return interactionDao.getCommentReplies(commentId)
            .asResult()
    }

    /**
     * 根据 ID 观察评论
     */
    fun observeCommentById(commentId: String): Flow<Result<PostCommentEntity?>> {
        return interactionDao.observeCommentById(commentId)
            .asResult()
    }

    /**
     * 发表评论
     */
    suspend fun addComment(comment: PostCommentEntity): Result<Unit> {
        return try {
            interactionDao.insertComment(comment)
            postDao.incrementCommentCount(comment.postId)
            syncAdapter.value.syncCommentAdded(comment)
            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    /**
     * 删除评论
     */
    suspend fun deleteComment(comment: PostCommentEntity): Result<Unit> {
        return try {
            // 删除所有回复
            interactionDao.deleteCommentReplies(comment.id)
            // 删除评论
            interactionDao.deleteComment(comment)
            // 更新评论数
            postDao.decrementCommentCount(comment.postId)
            syncAdapter.value.syncCommentDeleted(comment.id)
            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    /**
     * 点赞评论
     */
    suspend fun likeComment(commentId: String): Result<Unit> {
        return try {
            interactionDao.incrementCommentLikeCount(commentId)
            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    /**
     * 取消点赞评论
     */
    suspend fun unlikeComment(commentId: String): Result<Unit> {
        return try {
            interactionDao.decrementCommentLikeCount(commentId)
            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    // ===== 转发管理 =====

    /**
     * 获取动态的转发列表
     */
    fun getPostShares(postId: String): Flow<Result<List<PostShareEntity>>> {
        return interactionDao.getPostShares(postId)
            .asResult()
    }

    /**
     * 转发动态
     */
    suspend fun sharePost(share: PostShareEntity): Result<Unit> {
        return try {
            interactionDao.insertShare(share)
            postDao.incrementShareCount(share.postId)
            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    /**
     * 取消转发
     */
    suspend fun unsharePost(postId: String, userDid: String): Result<Unit> {
        return try {
            interactionDao.deleteShare(postId, userDid)
            // Note: 不减少转发数，因为转发记录已经产生
            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    /**
     * 检查是否已转发
     */
    suspend fun hasUserSharedPost(postId: String, userDid: String): Result<Boolean> {
        return try {
            Result.Success(interactionDao.hasUserSharedPost(postId, userDid))
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    // ===== 举报管理 =====

    /**
     * 举报动态
     *
     * @param postId 动态ID
     * @param reporterDid 举报人DID
     * @param reason 举报原因
     * @param description 详细描述
     */
    suspend fun reportPost(
        postId: String,
        reporterDid: String,
        reason: ReportReason,
        description: String? = null
    ): Result<Unit> {
        return try {
            val report = PostReportEntity(
                id = "report_${System.currentTimeMillis()}",
                postId = postId,
                reporterDid = reporterDid,
                reason = reason,
                description = description,
                createdAt = System.currentTimeMillis()
            )

            // TODO: 添加到数据库
            // interactionDao.insertReport(report)

            // 发送到后端审核（如果有）
            syncAdapter.value.syncReportSubmitted(report)

            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    /**
     * 获取用户的举报记录
     *
     * @param reporterDid 举报人DID
     */
    fun getUserReports(reporterDid: String): Flow<Result<List<PostReportEntity>>> {
        // TODO: 实现从DAO获取
        return kotlinx.coroutines.flow.flow {
            emit(Result.Success(emptyList()))
        }
    }

    // ===== 清理操作 =====

    /**
     * 清理旧动态
     */
    suspend fun cleanupOldPosts(cutoffTime: Long): Result<Unit> {
        return try {
            postDao.cleanupOldPosts(cutoffTime)
            Result.Success(Unit)
        } catch (e: Exception) {
            Result.Error(e)
        }
    }
}

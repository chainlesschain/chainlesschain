package com.chainlesschain.android.core.database.dao

import androidx.room.*
import com.chainlesschain.android.core.database.entity.*
import kotlinx.coroutines.flow.Flow

/**
 * 审核队列DAO
 *
 * 提供审核队列的数据库操作
 */
@Dao
interface ModerationQueueDao {

    // ==================== 插入操作 ====================

    /**
     * 插入单个审核项
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(item: ModerationQueueEntity): Long

    /**
     * 批量插入审核项
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(items: List<ModerationQueueEntity>): List<Long>

    // ==================== 更新操作 ====================

    /**
     * 更新审核项
     */
    @Update
    suspend fun update(item: ModerationQueueEntity): Int

    /**
     * 更新审核状态
     */
    @Query("""
        UPDATE moderation_queue
        SET status = :status,
            human_decision = :decision,
            human_note = :note,
            reviewer_did = :reviewerDid,
            reviewed_at = :reviewedAt
        WHERE id = :id
    """)
    suspend fun updateStatus(
        id: Long,
        status: ModerationStatus,
        decision: HumanDecision?,
        note: String?,
        reviewerDid: String?,
        reviewedAt: Long
    ): Int

    /**
     * 更新申诉信息
     */
    @Query("""
        UPDATE moderation_queue
        SET appeal_status = :appealStatus,
            appeal_text = :appealText,
            appeal_at = :appealAt,
            status = :moderationStatus
        WHERE id = :id
    """)
    suspend fun updateAppeal(
        id: Long,
        appealStatus: AppealStatus,
        appealText: String,
        appealAt: Long,
        moderationStatus: ModerationStatus
    ): Int

    /**
     * 处理申诉
     */
    @Query("""
        UPDATE moderation_queue
        SET appeal_status = :appealStatus,
            appeal_result = :appealResult,
            status = :moderationStatus,
            reviewed_at = :reviewedAt
        WHERE id = :id
    """)
    suspend fun processAppeal(
        id: Long,
        appealStatus: AppealStatus,
        appealResult: String,
        moderationStatus: ModerationStatus,
        reviewedAt: Long
    ): Int

    // ==================== 删除操作 ====================

    /**
     * 删除单个审核项
     */
    @Delete
    suspend fun delete(item: ModerationQueueEntity): Int

    /**
     * 按ID删除
     */
    @Query("DELETE FROM moderation_queue WHERE id = :id")
    suspend fun deleteById(id: Long): Int

    /**
     * 删除已处理的审核项（超过指定天数）
     */
    @Query("""
        DELETE FROM moderation_queue
        WHERE status IN ('APPROVED', 'REJECTED', 'DELETED')
        AND reviewed_at < :beforeTimestamp
    """)
    suspend fun deleteProcessedBefore(beforeTimestamp: Long): Int

    /**
     * 清空所有已处理的审核项
     */
    @Query("""
        DELETE FROM moderation_queue
        WHERE status IN ('APPROVED', 'REJECTED', 'DELETED')
    """)
    suspend fun deleteAllProcessed(): Int

    // ==================== 查询操作 ====================

    /**
     * 按ID查询
     */
    @Query("SELECT * FROM moderation_queue WHERE id = :id")
    suspend fun getById(id: Long): ModerationQueueEntity?

    /**
     * 按ID查询（Flow）
     */
    @Query("SELECT * FROM moderation_queue WHERE id = :id")
    fun getByIdFlow(id: Long): Flow<ModerationQueueEntity?>

    /**
     * 按内容ID查询
     */
    @Query("SELECT * FROM moderation_queue WHERE content_id = :contentId")
    suspend fun getByContentId(contentId: String): ModerationQueueEntity?

    /**
     * 查询所有审核项（按创建时间降序）
     */
    @Query("SELECT * FROM moderation_queue ORDER BY created_at DESC")
    fun getAllFlow(): Flow<List<ModerationQueueEntity>>

    /**
     * 按状态查询
     */
    @Query("SELECT * FROM moderation_queue WHERE status = :status ORDER BY created_at ASC")
    fun getByStatusFlow(status: ModerationStatus): Flow<List<ModerationQueueEntity>>

    /**
     * 查询待审核项目
     */
    @Query("SELECT * FROM moderation_queue WHERE status = 'PENDING' ORDER BY created_at ASC")
    fun getPendingFlow(): Flow<List<ModerationQueueEntity>>

    /**
     * 查询申诉中的项目
     */
    @Query("SELECT * FROM moderation_queue WHERE status = 'APPEALING' ORDER BY appeal_at ASC")
    fun getAppealingFlow(): Flow<List<ModerationQueueEntity>>

    /**
     * 按内容类型查询
     */
    @Query("SELECT * FROM moderation_queue WHERE content_type = :contentType ORDER BY created_at DESC")
    fun getByContentTypeFlow(contentType: ContentType): Flow<List<ModerationQueueEntity>>

    /**
     * 按作者DID查询
     */
    @Query("SELECT * FROM moderation_queue WHERE author_did = :authorDid ORDER BY created_at DESC")
    fun getByAuthorFlow(authorDid: String): Flow<List<ModerationQueueEntity>>

    /**
     * 按审核员DID查询
     */
    @Query("SELECT * FROM moderation_queue WHERE reviewer_did = :reviewerDid ORDER BY reviewed_at DESC")
    fun getByReviewerFlow(reviewerDid: String): Flow<List<ModerationQueueEntity>>

    /**
     * 查询超时未处理的项目（超过指定小时数）
     */
    @Query("""
        SELECT * FROM moderation_queue
        WHERE status = 'PENDING'
        AND created_at < :beforeTimestamp
        ORDER BY created_at ASC
    """)
    fun getOverdueFlow(beforeTimestamp: Long): Flow<List<ModerationQueueEntity>>

    // ==================== 统计查询 ====================

    /**
     * 统计总数
     */
    @Query("SELECT COUNT(*) FROM moderation_queue")
    fun getCountFlow(): Flow<Int>

    /**
     * 按状态统计
     */
    @Query("SELECT COUNT(*) FROM moderation_queue WHERE status = :status")
    fun getCountByStatusFlow(status: ModerationStatus): Flow<Int>

    /**
     * 统计待审核数量
     */
    @Query("SELECT COUNT(*) FROM moderation_queue WHERE status = 'PENDING'")
    fun getPendingCountFlow(): Flow<Int>

    /**
     * 统计申诉数量
     */
    @Query("SELECT COUNT(*) FROM moderation_queue WHERE status = 'APPEALING'")
    fun getAppealingCountFlow(): Flow<Int>

    /**
     * 按内容类型统计
     */
    @Query("SELECT COUNT(*) FROM moderation_queue WHERE content_type = :contentType")
    fun getCountByContentTypeFlow(contentType: ContentType): Flow<Int>

    /**
     * 统计作者的违规次数
     */
    @Query("""
        SELECT COUNT(*) FROM moderation_queue
        WHERE author_did = :authorDid
        AND status IN ('REJECTED', 'DELETED')
    """)
    fun getViolationCountByAuthorFlow(authorDid: String): Flow<Int>

    /**
     * 统计审核员的处理数量
     */
    @Query("""
        SELECT COUNT(*) FROM moderation_queue
        WHERE reviewer_did = :reviewerDid
        AND status IN ('APPROVED', 'REJECTED', 'DELETED')
    """)
    fun getReviewCountByReviewerFlow(reviewerDid: String): Flow<Int>

    /**
     * 统计平均等待时长（小时）
     */
    @Query("""
        SELECT AVG(reviewed_at - created_at) / 3600000.0 FROM moderation_queue
        WHERE reviewed_at IS NOT NULL
    """)
    fun getAverageWaitingHoursFlow(): Flow<Double?>

    // ==================== 复杂查询 ====================

    /**
     * 搜索审核项（内容文本或作者名称）
     */
    @Query("""
        SELECT * FROM moderation_queue
        WHERE content_text LIKE '%' || :query || '%'
           OR author_name LIKE '%' || :query || '%'
        ORDER BY created_at DESC
    """)
    fun searchFlow(query: String): Flow<List<ModerationQueueEntity>>

    /**
     * 查询高优先级项目（待审核且等待超过24小时）
     */
    @Query("""
        SELECT * FROM moderation_queue
        WHERE status = 'PENDING'
        AND created_at < :oneDayAgo
        ORDER BY created_at ASC
    """)
    fun getHighPriorityFlow(oneDayAgo: Long): Flow<List<ModerationQueueEntity>>

    /**
     * 获取审核统计（按日期分组）
     */
    @Query("""
        SELECT
            DATE(created_at / 1000, 'unixepoch') as date,
            COUNT(*) as total,
            SUM(CASE WHEN status = 'APPROVED' THEN 1 ELSE 0 END) as approved,
            SUM(CASE WHEN status = 'REJECTED' THEN 1 ELSE 0 END) as rejected,
            SUM(CASE WHEN status = 'DELETED' THEN 1 ELSE 0 END) as deleted
        FROM moderation_queue
        WHERE created_at >= :startTimestamp
        GROUP BY date
        ORDER BY date DESC
    """)
    fun getStatsByDateFlow(startTimestamp: Long): Flow<List<ModerationStatsByDate>>

    /**
     * 获取作者违规统计
     */
    @Query("""
        SELECT
            author_did,
            author_name,
            COUNT(*) as total,
            SUM(CASE WHEN status = 'REJECTED' THEN 1 ELSE 0 END) as rejected,
            SUM(CASE WHEN status = 'DELETED' THEN 1 ELSE 0 END) as deleted
        FROM moderation_queue
        WHERE status IN ('REJECTED', 'DELETED')
        GROUP BY author_did
        ORDER BY total DESC
        LIMIT :limit
    """)
    fun getTopViolatorsFlow(limit: Int = 10): Flow<List<AuthorViolationStats>>
}

/**
 * 按日期统计数据类
 */
data class ModerationStatsByDate(
    val date: String,
    val total: Int,
    val approved: Int,
    val rejected: Int,
    val deleted: Int
)

/**
 * 作者违规统计数据类
 */
data class AuthorViolationStats(
    @ColumnInfo(name = "author_did") val authorDid: String,
    @ColumnInfo(name = "author_name") val authorName: String?,
    val total: Int,
    val rejected: Int,
    val deleted: Int
)

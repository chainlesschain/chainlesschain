package com.chainlesschain.android.core.database.dao.social

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import com.chainlesschain.android.core.database.entity.social.PostReportEntity
import com.chainlesschain.android.core.database.entity.social.ReportStatus
import kotlinx.coroutines.flow.Flow

/**
 * 动态举报数据访问对象
 *
 * Entity 已注册到 schema (ChainlessChainDatabase v? row PostReportEntity::class)；
 * 之前 PostRepository.reportPost 构造 entity 但**没写库**——v0.31.x demo 残余，
 * 本 DAO 一起补齐 insert + 查询 + 状态更新。
 */
@Dao
interface PostReportDao {

    /**
     * 插入举报记录
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertReport(report: PostReportEntity)

    /**
     * 获取举报人的全部举报记录（倒序）
     */
    @Query("SELECT * FROM post_reports WHERE reporterDid = :reporterDid ORDER BY createdAt DESC")
    fun getReportsByReporter(reporterDid: String): Flow<List<PostReportEntity>>

    /**
     * 获取某条动态收到的全部举报
     */
    @Query("SELECT * FROM post_reports WHERE postId = :postId ORDER BY createdAt DESC")
    fun getReportsByPost(postId: String): Flow<List<PostReportEntity>>

    /**
     * 获取某条动态收到的举报总数（用于 moderation 排序）
     */
    @Query("SELECT COUNT(*) FROM post_reports WHERE postId = :postId AND status = :status")
    suspend fun getReportCountByPost(postId: String, status: ReportStatus = ReportStatus.PENDING): Int

    /**
     * 检查举报人是否已对某条动态举报过（去重）
     */
    @Query("SELECT EXISTS(SELECT 1 FROM post_reports WHERE postId = :postId AND reporterDid = :reporterDid)")
    suspend fun hasReporterReportedPost(postId: String, reporterDid: String): Boolean

    /**
     * 更新举报处理状态（管理员/审核后）
     */
    @Query("UPDATE post_reports SET status = :status WHERE id = :reportId")
    suspend fun updateStatus(reportId: String, status: ReportStatus)

    /**
     * 删除举报记录
     */
    @Query("DELETE FROM post_reports WHERE id = :reportId")
    suspend fun deleteReport(reportId: String)
}

package com.chainlesschain.android.feature.familyguard.data.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import com.chainlesschain.android.feature.familyguard.data.entity.FamilyTaskEntity
import kotlinx.coroutines.flow.Flow

/**
 * M5 family_task DAO (主文档 §3.5)。
 *
 * 单行字段更新 (status / submission / ai_grade / parent_review / ai_call_log) 走显式
 * @Query, 避免整行 @Update 覆盖并发改动 (家长改评语 + 孩子改 status 可能并发)。
 */
@Dao
interface FamilyTaskDao {

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: FamilyTaskEntity)

    @Update
    suspend fun update(entity: FamilyTaskEntity)

    @Query("SELECT * FROM family_task WHERE id = :id")
    suspend fun getById(id: String): FamilyTaskEntity?

    @Query("SELECT * FROM family_task WHERE child_did = :childDid ORDER BY created_at DESC")
    fun observeForChild(childDid: String): Flow<List<FamilyTaskEntity>>

    @Query(
        """
        SELECT * FROM family_task
         WHERE child_did = :childDid AND status = :status
         ORDER BY created_at DESC
        """,
    )
    fun observeForChildByStatus(childDid: String, status: String): Flow<List<FamilyTaskEntity>>

    @Query("SELECT * FROM family_task WHERE child_did = :childDid AND status = :status")
    suspend fun listForChildByStatus(childDid: String, status: String): List<FamilyTaskEntity>

    @Query(
        "UPDATE family_task SET status = :status, updated_at = :updatedAt WHERE id = :id",
    )
    suspend fun updateStatus(id: String, status: String, updatedAt: Long): Int

    @Query(
        """
        UPDATE family_task
           SET submission = :submission, submitted_at = :submittedAt,
               status = :status, updated_at = :updatedAt
         WHERE id = :id
        """,
    )
    suspend fun recordSubmission(
        id: String,
        submission: String,
        submittedAt: Long,
        status: String,
        updatedAt: Long,
    ): Int

    @Query("UPDATE family_task SET ai_grade = :aiGrade, updated_at = :updatedAt WHERE id = :id")
    suspend fun updateAiGrade(id: String, aiGrade: String, updatedAt: Long): Int

    @Query(
        "UPDATE family_task SET parent_review = :review, updated_at = :updatedAt WHERE id = :id",
    )
    suspend fun updateParentReview(id: String, review: String, updatedAt: Long): Int

    @Query("SELECT ai_call_log FROM family_task WHERE id = :id")
    suspend fun getAiCallLog(id: String): String?

    @Query("UPDATE family_task SET ai_call_log = :log, updated_at = :updatedAt WHERE id = :id")
    suspend fun updateAiCallLog(id: String, log: String, updatedAt: Long): Int

    @Query("DELETE FROM family_task WHERE id = :id")
    suspend fun delete(id: String): Int

    /** 数据生命周期清理: 删已完成/取消且早于 cutoff 的任务 (主文档 §4.6)。 */
    @Query(
        """
        DELETE FROM family_task
         WHERE updated_at < :cutoffMs AND status IN ('done', 'cancelled')
        """,
    )
    suspend fun deleteTerminalOlderThan(cutoffMs: Long): Int

    @Query("SELECT COUNT(*) FROM family_task WHERE child_did = :childDid")
    suspend fun countForChild(childDid: String): Int
}

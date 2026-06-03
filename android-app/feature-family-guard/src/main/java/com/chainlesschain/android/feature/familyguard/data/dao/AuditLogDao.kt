package com.chainlesschain.android.feature.familyguard.data.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.chainlesschain.android.feature.familyguard.data.entity.AuditLogEntity
import kotlinx.coroutines.flow.Flow

/**
 * 审计日志 DAO (FAMILY-63). **append-only**: 只 insert + query, 故意**不提供 update/delete**
 * —— audit_log 主文档 §4.6 "不可删", API 层面即杜绝改/删 (Room 不会生成对应方法)。
 * insert 用 ABORT (而非 IGNORE): 审计写入失败应显式抛, 不静默吞。
 */
@Dao
interface AuditLogDao {

    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insert(entity: AuditLogEntity): Long

    @Query(
        """
        SELECT * FROM audit_log
         ORDER BY timestamp DESC
         LIMIT :limit
        """,
    )
    fun observeRecent(limit: Int): Flow<List<AuditLogEntity>>

    @Query(
        """
        SELECT * FROM audit_log
         WHERE timestamp >= :sinceMs AND timestamp < :untilMs
         ORDER BY timestamp DESC
        """,
    )
    suspend fun queryRange(sinceMs: Long, untilMs: Long): List<AuditLogEntity>

    @Query(
        """
        SELECT * FROM audit_log
         WHERE family_group_id = :familyGroupId
           AND timestamp >= :sinceMs AND timestamp < :untilMs
         ORDER BY timestamp DESC
        """,
    )
    suspend fun queryByGroup(
        familyGroupId: String,
        sinceMs: Long,
        untilMs: Long,
    ): List<AuditLogEntity>

    @Query("SELECT COUNT(*) FROM audit_log")
    suspend fun count(): Int
}

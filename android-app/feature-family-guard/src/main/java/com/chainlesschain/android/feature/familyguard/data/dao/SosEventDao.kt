package com.chainlesschain.android.feature.familyguard.data.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.chainlesschain.android.feature.familyguard.data.entity.SosEventEntity
import kotlinx.coroutines.flow.Flow

/**
 * SOS 事件 DAO (FAMILY-40). 状态转换走原子 SQL UPDATE + WHERE status 守卫, 让并发 race
 * 自然 last-write-wins, 不会乱跳状态 (同 FamilyRelationshipDao unbind 转换模式)。
 */
@Dao
interface SosEventDao {

    @Query("SELECT * FROM sos_event WHERE status = 'pending' ORDER BY triggered_at DESC")
    fun observePending(): Flow<List<SosEventEntity>>

    @Query(
        """
        SELECT * FROM sos_event
         WHERE child_did = :childDid
         ORDER BY triggered_at DESC
         LIMIT :limit
        """,
    )
    fun observeRecentForChild(childDid: String, limit: Int): Flow<List<SosEventEntity>>

    @Query("SELECT * FROM sos_event WHERE id = :id LIMIT 1")
    suspend fun findById(id: String): SosEventEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: SosEventEntity)

    // ─── FAMILY-40 状态机转换 (WHERE status 守卫) ───

    /** PENDING → ACKNOWLEDGED. */
    @Query(
        """
        UPDATE sos_event
           SET status = 'acknowledged', acknowledged_by = :guardianDid, acknowledged_at = :at
         WHERE id = :id AND status = 'pending'
        """,
    )
    suspend fun markAcknowledged(id: String, guardianDid: String, at: Long): Int

    /** PENDING / ACKNOWLEDGED → RESOLVED. */
    @Query(
        """
        UPDATE sos_event
           SET status = 'resolved', resolved_at = :at, resolution_note = :note
         WHERE id = :id AND status IN ('pending', 'acknowledged')
        """,
    )
    suspend fun markResolved(id: String, at: Long, note: String?): Int

    /** PENDING → FALSE_ALARM (误触撤销). */
    @Query(
        """
        UPDATE sos_event
           SET status = 'false_alarm', cancelled_at = :at, cancel_reason = :reason
         WHERE id = :id AND status = 'pending'
        """,
    )
    suspend fun markFalseAlarm(id: String, at: Long, reason: String): Int
}

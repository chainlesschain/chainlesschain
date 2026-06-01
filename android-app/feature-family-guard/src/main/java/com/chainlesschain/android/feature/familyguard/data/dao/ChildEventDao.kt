package com.chainlesschain.android.feature.familyguard.data.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.chainlesschain.android.feature.familyguard.data.entity.ChildEventEntity
import kotlinx.coroutines.flow.Flow

/**
 * Child telemetry events DAO (FAMILY-20). 共享给 PDH collector / ForegroundAppTimer /
 * AccessibilityService 等所有上行子系统; 走 SQL 路径过滤 (level / source / 时间窗)。
 */
@Dao
interface ChildEventDao {

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insert(entity: ChildEventEntity): Long

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertAll(entities: List<ChildEventEntity>): List<Long>

    @Query(
        """
        SELECT * FROM child_event
         WHERE child_did = :childDid AND timestamp >= :sinceMs
         ORDER BY timestamp DESC
        """,
    )
    suspend fun querySince(childDid: String, sinceMs: Long): List<ChildEventEntity>

    @Query(
        """
        SELECT * FROM child_event
         WHERE child_did = :childDid AND source = :source
           AND timestamp >= :sinceMs AND timestamp < :untilMs
         ORDER BY timestamp DESC
        """,
    )
    suspend fun querySourceRange(
        childDid: String,
        source: String,
        sinceMs: Long,
        untilMs: Long,
    ): List<ChildEventEntity>

    /** UI Flow: 观察某 child 最近 N 条事件. */
    @Query(
        """
        SELECT * FROM child_event
         WHERE child_did = :childDid
         ORDER BY timestamp DESC
         LIMIT :limit
        """,
    )
    fun observeRecent(childDid: String, limit: Int): Flow<List<ChildEventEntity>>

    @Query("DELETE FROM child_event WHERE timestamp < :cutoffMs")
    suspend fun deleteOlderThan(cutoffMs: Long): Int

    /**
     * 按分级硬删过期事件 (FAMILY-28 数据生命周期; 主文档 §4.6 L0 1y / L1 90d /
     * L2 30d / L3 7d 各自保留期不同, 故按 level 分别 cutoff)。
     */
    @Query("DELETE FROM child_event WHERE level = :level AND timestamp < :cutoffMs")
    suspend fun deleteOlderThanByLevel(level: String, cutoffMs: Long): Int

    @Query("SELECT COUNT(*) FROM child_event WHERE child_did = :childDid")
    suspend fun countForChild(childDid: String): Int
}

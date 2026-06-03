package com.chainlesschain.android.feature.familyguard.data.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.chainlesschain.android.feature.familyguard.data.entity.AnomalyEntity
import kotlinx.coroutines.flow.Flow

/**
 * 异常事件 DAO (FAMILY-27). insert 走 IGNORE — dedup_key UNIQUE 冲突时静默跳过
 * (返 -1), 让 [com.chainlesschain.android.feature.familyguard.data.anomaly.AnomalyScanTimer]
 * 据 rowId 区分"新检出" vs "复扫去重"。
 */
@Dao
interface AnomalyDao {

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insert(entity: AnomalyEntity): Long

    @Query(
        """
        SELECT * FROM anomaly
         WHERE child_did = :childDid
         ORDER BY detected_at DESC
         LIMIT :limit
        """,
    )
    fun observeRecent(childDid: String, limit: Int): Flow<List<AnomalyEntity>>

    @Query("UPDATE anomaly SET acknowledged = 1 WHERE id = :id")
    suspend fun acknowledge(id: Long): Int

    @Query("DELETE FROM anomaly WHERE detected_at < :cutoffMs")
    suspend fun deleteOlderThan(cutoffMs: Long): Int

    @Query("SELECT COUNT(*) FROM anomaly WHERE child_did = :childDid")
    suspend fun countForChild(childDid: String): Int
}

package com.chainlesschain.android.feature.familyguard.data.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.chainlesschain.android.feature.familyguard.data.entity.LocationPointEntity

/**
 * Placeholder DAO (FAMILY-02). Body methods land in FAMILY-50/51.
 */
@Dao
interface LocationPointDao {

    @Query("""
        SELECT * FROM location_point
        WHERE child_did = :childDid AND timestamp >= :sinceMs
        ORDER BY timestamp DESC
    """)
    suspend fun querySince(childDid: String, sinceMs: Long): List<LocationPointEntity>

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertAll(points: List<LocationPointEntity>): List<Long>

    @Query("DELETE FROM location_point WHERE timestamp < :cutoffMs")
    suspend fun deleteOlderThan(cutoffMs: Long): Int
}

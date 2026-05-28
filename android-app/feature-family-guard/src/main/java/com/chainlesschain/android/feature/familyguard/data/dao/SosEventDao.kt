package com.chainlesschain.android.feature.familyguard.data.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.chainlesschain.android.feature.familyguard.data.entity.SosEventEntity
import kotlinx.coroutines.flow.Flow

/**
 * Placeholder DAO (FAMILY-02). Body methods land in FAMILY-40.
 */
@Dao
interface SosEventDao {

    @Query("SELECT * FROM sos_event WHERE status = 'pending' ORDER BY triggered_at DESC")
    fun observePending(): Flow<List<SosEventEntity>>

    @Query("SELECT * FROM sos_event WHERE id = :id LIMIT 1")
    suspend fun findById(id: String): SosEventEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: SosEventEntity)
}

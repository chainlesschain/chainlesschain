package com.chainlesschain.android.feature.familyguard.data.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.chainlesschain.android.feature.familyguard.data.entity.GeofenceEntity
import kotlinx.coroutines.flow.Flow

/**
 * Placeholder DAO (FAMILY-02). Body methods land in FAMILY-52.
 */
@Dao
interface GeofenceDao {

    @Query("SELECT * FROM geofence WHERE family_group_id = :groupId AND active = 1")
    fun observeActive(groupId: String): Flow<List<GeofenceEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: GeofenceEntity)

    @Query("DELETE FROM geofence WHERE id = :id")
    suspend fun deleteById(id: String): Int
}

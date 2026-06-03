package com.chainlesschain.android.feature.familyguard.data.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.chainlesschain.android.feature.familyguard.data.entity.GeofenceEntity
import kotlinx.coroutines.flow.Flow

/**
 * Geofence DAO. observe/upsert/delete from FAMILY-02; getById added FAMILY-50
 * (Repository 读改路径). 围栏边界注册 / 触发在 FAMILY-52。
 */
@Dao
interface GeofenceDao {

    @Query("SELECT * FROM geofence WHERE family_group_id = :groupId AND active = 1")
    fun observeActive(groupId: String): Flow<List<GeofenceEntity>>

    @Query("SELECT * FROM geofence WHERE id = :id")
    suspend fun getById(id: String): GeofenceEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: GeofenceEntity)

    @Query("DELETE FROM geofence WHERE id = :id")
    suspend fun deleteById(id: String): Int
}

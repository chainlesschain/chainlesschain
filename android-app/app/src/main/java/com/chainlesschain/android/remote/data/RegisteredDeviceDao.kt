package com.chainlesschain.android.remote.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface RegisteredDeviceDao {

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(device: RegisteredDeviceEntity)

    @Query("SELECT * FROM registered_devices ORDER BY lastSeenAt DESC")
    fun getAllFlow(): Flow<List<RegisteredDeviceEntity>>

    @Query("SELECT * FROM registered_devices WHERE peerId = :peerId LIMIT 1")
    suspend fun getByPeerId(peerId: String): RegisteredDeviceEntity?

    @Query("DELETE FROM registered_devices WHERE peerId = :peerId")
    suspend fun deleteByPeerId(peerId: String)
}

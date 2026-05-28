package com.chainlesschain.android.feature.familyguard.data.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.chainlesschain.android.feature.familyguard.data.entity.FamilyGroupEntity
import kotlinx.coroutines.flow.Flow

/**
 * Placeholder DAO (FAMILY-02). Body methods land in FAMILY-10.
 */
@Dao
interface FamilyGroupDao {

    @Query("SELECT * FROM family_group ORDER BY created_at DESC")
    fun observeAll(): Flow<List<FamilyGroupEntity>>

    @Query("SELECT * FROM family_group WHERE id = :id LIMIT 1")
    suspend fun findById(id: String): FamilyGroupEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: FamilyGroupEntity)

    @Query("DELETE FROM family_group WHERE id = :id")
    suspend fun deleteById(id: String): Int
}

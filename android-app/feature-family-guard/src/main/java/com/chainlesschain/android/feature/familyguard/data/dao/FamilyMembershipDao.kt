package com.chainlesschain.android.feature.familyguard.data.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.chainlesschain.android.feature.familyguard.data.entity.FamilyMembershipEntity
import kotlinx.coroutines.flow.Flow

/**
 * Placeholder DAO (FAMILY-02). Body methods land in FAMILY-11.
 */
@Dao
interface FamilyMembershipDao {

    @Query("SELECT * FROM family_membership WHERE family_group_id = :groupId ORDER BY joined_at")
    fun observeByGroup(groupId: String): Flow<List<FamilyMembershipEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: FamilyMembershipEntity): Long

    @Query("DELETE FROM family_membership WHERE id = :id")
    suspend fun deleteById(id: Long): Int
}

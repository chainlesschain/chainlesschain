package com.chainlesschain.android.feature.familyguard.data.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.chainlesschain.android.feature.familyguard.data.entity.FamilyRelationshipEntity
import kotlinx.coroutines.flow.Flow

/**
 * Placeholder DAO (FAMILY-02). Body methods land in FAMILY-12 (permissions
 * engine) + FAMILY-15 (unbind state machine) + FAMILY-16 (emergency unbind).
 */
@Dao
interface FamilyRelationshipDao {

    @Query("SELECT * FROM family_relationship WHERE family_group_id = :groupId AND status = 'active'")
    fun observeActive(groupId: String): Flow<List<FamilyRelationshipEntity>>

    @Query("SELECT * FROM family_relationship WHERE friend_did = :friendDid LIMIT 1")
    suspend fun findByFriendDid(friendDid: String): FamilyRelationshipEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: FamilyRelationshipEntity): Long

    @Query("UPDATE family_relationship SET status = :newStatus, updated_at = :updatedAt WHERE id = :id")
    suspend fun updateStatus(id: Long, newStatus: String, updatedAt: Long): Int
}

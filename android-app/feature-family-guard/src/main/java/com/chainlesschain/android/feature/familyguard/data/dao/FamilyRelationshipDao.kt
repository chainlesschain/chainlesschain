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

    /**
     * FAMILY-03: observe all active family relationships across all family_groups.
     * 用于 FamilyFriendRepository 拼接 FriendEntity, 不需特定 group 上下文。
     */
    @Query("SELECT * FROM family_relationship WHERE status = 'active'")
    fun observeAllActive(): Flow<List<FamilyRelationshipEntity>>

    @Query("SELECT * FROM family_relationship WHERE friend_did = :friendDid LIMIT 1")
    suspend fun findByFriendDid(friendDid: String): FamilyRelationshipEntity?

    /**
     * FAMILY-03: 查 friend_did 是否当前已 active marked-family。
     * 返回是否存在 ANY active row (不返实体, 节省查询)。
     */
    @Query("SELECT COUNT(*) > 0 FROM family_relationship WHERE friend_did = :friendDid AND status = 'active'")
    suspend fun isActiveFamily(friendDid: String): Boolean

    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insert(entity: FamilyRelationshipEntity): Long

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: FamilyRelationshipEntity): Long

    @Query("UPDATE family_relationship SET status = :newStatus, updated_at = :updatedAt WHERE id = :id")
    suspend fun updateStatus(id: Long, newStatus: String, updatedAt: Long): Int

    /** FAMILY-12: 改 permissions JSON 但不动 status / cooldown 等其他字段。 */
    @Query(
        "UPDATE family_relationship " +
            "SET permissions = :permissionsJson, updated_at = :updatedAt " +
            "WHERE id = :id",
    )
    suspend fun updatePermissions(id: Long, permissionsJson: String, updatedAt: Long): Int

    @Query(
        "UPDATE family_relationship " +
            "SET emergency_contacts = :emergencyContactsJson, updated_at = :updatedAt " +
            "WHERE id = :id",
    )
    suspend fun updateEmergencyContacts(
        id: Long,
        emergencyContactsJson: String?,
        updatedAt: Long,
    ): Int

    @Query("SELECT * FROM family_relationship WHERE id = :id LIMIT 1")
    suspend fun findById(id: Long): FamilyRelationshipEntity?
}

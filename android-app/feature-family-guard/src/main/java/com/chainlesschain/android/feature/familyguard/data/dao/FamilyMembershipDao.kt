package com.chainlesschain.android.feature.familyguard.data.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.chainlesschain.android.feature.familyguard.data.entity.FamilyMembershipEntity
import kotlinx.coroutines.flow.Flow

/**
 * Family membership DAO. Originally FAMILY-02 placeholder; FAMILY-11 加角色 /
 * tier 过滤查询路径, 让 Repository 不需在内存里手工 filter (RUNTIME 性能上, SQL
 * 过滤比 Kotlin List.filter 快, 且更易加索引)。
 *
 * 注意 SQL 中 role 列是 TEXT (entity 字段是 String), 直接比较 'parent' / 'child'
 * / 'guardian' 字面值; Repository 层 enum → String 由 [com.chainlesschain.android.
 * feature.familyguard.domain.model.MemberRole.storageValue] 提供。
 */
@Dao
interface FamilyMembershipDao {

    @Query("SELECT * FROM family_membership WHERE family_group_id = :groupId ORDER BY joined_at")
    fun observeByGroup(groupId: String): Flow<List<FamilyMembershipEntity>>

    @Query("SELECT * FROM family_membership WHERE family_group_id = :groupId ORDER BY joined_at")
    suspend fun listByGroup(groupId: String): List<FamilyMembershipEntity>

    @Query(
        "SELECT * FROM family_membership " +
            "WHERE family_group_id = :groupId AND role = :role AND status = 'active' " +
            "ORDER BY joined_at",
    )
    suspend fun listByGroupAndRole(groupId: String, role: String): List<FamilyMembershipEntity>

    @Query(
        "SELECT * FROM family_membership " +
            "WHERE family_group_id = :groupId AND role IN ('parent', 'guardian') AND status = 'active' " +
            "ORDER BY (CASE guardian_tier WHEN 'primary' THEN 0 WHEN 'secondary' THEN 1 ELSE 2 END), joined_at",
    )
    suspend fun listGuardiansByGroup(groupId: String): List<FamilyMembershipEntity>

    @Query(
        "SELECT * FROM family_membership " +
            "WHERE family_group_id = :groupId AND role IN ('parent', 'guardian') " +
            "AND guardian_tier = :tier AND status = 'active' " +
            "ORDER BY joined_at",
    )
    suspend fun listGuardiansByGroupAndTier(
        groupId: String,
        tier: String,
    ): List<FamilyMembershipEntity>

    @Query(
        "SELECT * FROM family_membership " +
            "WHERE family_group_id = :groupId AND member_did = :memberDid AND device_id = :deviceId " +
            "LIMIT 1",
    )
    suspend fun findInGroup(
        groupId: String,
        memberDid: String,
        deviceId: String,
    ): FamilyMembershipEntity?

    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insert(entity: FamilyMembershipEntity): Long

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: FamilyMembershipEntity): Long

    @Query("UPDATE family_membership SET status = :status WHERE id = :id")
    suspend fun updateStatus(id: Long, status: String): Int

    @Query("DELETE FROM family_membership WHERE id = :id")
    suspend fun deleteById(id: Long): Int
}

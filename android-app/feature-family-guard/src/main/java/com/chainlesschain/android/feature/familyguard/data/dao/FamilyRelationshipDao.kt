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

    /**
     * FAMILY-28 数据生命周期: 硬删指定状态且 updated_at 早于 cutoff 的关系。
     * 主文档 §4.6 "解绑后历史 90d 后硬删除" → 传 status='unbound'。
     * updated_at 在状态转 unbound 时被置, 故为"解绑以来"的合理近似。
     */
    @Query("DELETE FROM family_relationship WHERE status = :status AND updated_at < :cutoffMs")
    suspend fun deleteByStatusOlderThan(status: String, cutoffMs: Long): Int

    // ─── FAMILY-15 unbind state machine (atomic SQL state transitions) ───

    /**
     * active → unbind_pending; WHERE status='active' 让重复 request 自动 no-op
     * (返 0 行影响), 避免 race condition 改坏数据。
     */
    @Query(
        """
        UPDATE family_relationship
           SET status = 'unbind_pending',
               unbind_request_at = :requestAt,
               unbind_cooldown_until = :cooldownUntil,
               unbind_requester = :requesterDid,
               updated_at = :updatedAt
         WHERE id = :id AND status = 'active'
        """,
    )
    suspend fun markUnbindPending(
        id: Long,
        requestAt: Long,
        cooldownUntil: Long,
        requesterDid: String,
        updatedAt: Long,
    ): Int

    /**
     * unbind_pending → active (撤销解绑); 清三个 unbind 列。WHERE status 守卫
     * 防对 active / unbound 误调。
     */
    @Query(
        """
        UPDATE family_relationship
           SET status = 'active',
               unbind_request_at = NULL,
               unbind_cooldown_until = NULL,
               unbind_requester = NULL,
               updated_at = :updatedAt
         WHERE id = :id AND status = 'unbind_pending'
        """,
    )
    suspend fun cancelUnbindPending(id: Long, updatedAt: Long): Int

    /**
     * unbind_pending → unbound; 只有冷却到期 (now ≥ cooldown_until) 才生效。
     * 由后台 Worker 周期调用; 或 forceFinalize 路径。
     */
    @Query(
        """
        UPDATE family_relationship
           SET status = 'unbound',
               updated_at = :updatedAt
         WHERE id = :id
           AND status = 'unbind_pending'
           AND unbind_cooldown_until <= :now
        """,
    )
    suspend fun finalizeUnbindIfExpired(id: Long, now: Long, updatedAt: Long): Int

    /** 查所有冷却到期但仍 unbind_pending 的 id; Worker 用. */
    @Query(
        """
        SELECT id FROM family_relationship
         WHERE status = 'unbind_pending'
           AND unbind_cooldown_until <= :now
        """,
    )
    suspend fun listExpiredPendingIds(now: Long): List<Long>

    // ─── FAMILY-16 emergency unbind ───

    /**
     * 紧急解绑写库: 任意非 unbound 状态 → emergency_unbound.
     * 主文档 §3.1 v0.2: 复活码触发立刻生效, 不走 24h 冷却。
     */
    @Query(
        """
        UPDATE family_relationship
           SET status = 'emergency_unbound',
               emergency_unbind_at = :triggeredAt,
               emergency_unbind_reason = :reason,
               updated_at = :updatedAt
         WHERE id = :id AND status != 'unbound'
        """,
    )
    suspend fun markEmergencyUnbound(
        id: Long,
        triggeredAt: Long,
        reason: String,
        updatedAt: Long,
    ): Int
}

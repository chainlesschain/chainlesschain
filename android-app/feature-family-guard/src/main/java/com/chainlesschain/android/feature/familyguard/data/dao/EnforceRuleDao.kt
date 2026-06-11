package com.chainlesschain.android.feature.familyguard.data.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.chainlesschain.android.feature.familyguard.data.entity.EnforceRuleEntity
import kotlinx.coroutines.flow.Flow

/**
 * Placeholder DAO (FAMILY-02). Body methods land alongside Epic D Enforce in v0.2.
 */
@Dao
interface EnforceRuleDao {

    @Query("SELECT * FROM enforce_rules WHERE active = 1 ORDER BY source_priority ASC, created_at DESC")
    fun observeActive(): Flow<List<EnforceRuleEntity>>

    @Query("SELECT * FROM enforce_rules WHERE rule_type = :ruleType AND target = :target AND active = 1")
    suspend fun findActiveBy(ruleType: String, target: String): List<EnforceRuleEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: EnforceRuleEntity): Long

    @Query("UPDATE enforce_rules SET active = 0 WHERE id = :id")
    suspend fun deactivate(id: Long): Int

    /** v8 (M9→M4): 活跃且未到期的规则 (评估引擎用; 永久规则 expires_at IS NULL)。 */
    @Query(
        """
        SELECT * FROM enforce_rules
         WHERE active = 1 AND (expires_at IS NULL OR expires_at > :now)
         ORDER BY source_priority ASC, created_at DESC
        """,
    )
    fun observeActiveNonExpired(now: Long): Flow<List<EnforceRuleEntity>>

    /** v8 (M9→M4): 同 [findActiveBy] 但过滤已到期 (临时白名单评估用)。 */
    @Query(
        """
        SELECT * FROM enforce_rules
         WHERE rule_type = :ruleType AND target = :target AND active = 1
           AND (expires_at IS NULL OR expires_at > :now)
        """,
    )
    suspend fun findActiveNonExpiredBy(ruleType: String, target: String, now: Long): List<EnforceRuleEntity>

    /** v8 (M9→M4): 批量下线已到期临时规则 (app 启动/定时清理调)。返回下线行数。 */
    @Query("UPDATE enforce_rules SET active = 0 WHERE expires_at IS NOT NULL AND expires_at <= :now AND active = 1")
    suspend fun deactivateExpired(now: Long): Int
}

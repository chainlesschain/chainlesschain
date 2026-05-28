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
}

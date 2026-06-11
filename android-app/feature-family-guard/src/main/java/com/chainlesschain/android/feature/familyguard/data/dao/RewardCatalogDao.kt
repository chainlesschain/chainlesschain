package com.chainlesschain.android.feature.familyguard.data.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.chainlesschain.android.feature.familyguard.data.entity.RewardCatalogEntity
import kotlinx.coroutines.flow.Flow

/**
 * M9 reward_catalog DAO (主文档 §3.9)。家长 CRUD: 新增/改走 upsert,
 * 下架走 active=0 软删 (流水 related_reward_id 可回查)。
 */
@Dao
interface RewardCatalogDao {

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: RewardCatalogEntity)

    @Query(
        """
        SELECT * FROM reward_catalog
         WHERE family_group_id = :groupId AND active = 1
         ORDER BY cost ASC, created_at ASC
        """,
    )
    fun observeActiveForGroup(groupId: String): Flow<List<RewardCatalogEntity>>

    @Query("SELECT * FROM reward_catalog WHERE id = :id")
    suspend fun getById(id: String): RewardCatalogEntity?

    /** 下架/重新上架。返回受影响行数。 */
    @Query("UPDATE reward_catalog SET active = :active WHERE id = :id")
    suspend fun setActive(id: String, active: Boolean): Int

    @Query("SELECT COUNT(*) FROM reward_catalog WHERE family_group_id = :groupId")
    suspend fun countForGroup(groupId: String): Int
}

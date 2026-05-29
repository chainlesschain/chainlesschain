package com.chainlesschain.android.feature.familyguard.data.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.chainlesschain.android.feature.familyguard.data.entity.FamilyGroupEntity
import kotlinx.coroutines.flow.Flow

/**
 * Family group DAO. Originally FAMILY-02 placeholder; FAMILY-10 加 update/exists 路径
 * 让 Repository 直接走目标 SQL (而非读出 entity 改字段 upsert)。
 */
@Dao
interface FamilyGroupDao {

    @Query("SELECT * FROM family_group ORDER BY created_at DESC")
    fun observeAll(): Flow<List<FamilyGroupEntity>>

    @Query("SELECT * FROM family_group WHERE id = :id LIMIT 1")
    suspend fun findById(id: String): FamilyGroupEntity?

    @Query("SELECT COUNT(*) > 0 FROM family_group WHERE id = :id")
    suspend fun exists(id: String): Boolean

    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insert(entity: FamilyGroupEntity): Long

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: FamilyGroupEntity)

    @Query("UPDATE family_group SET name = :name WHERE id = :id")
    suspend fun updateName(id: String, name: String): Int

    @Query("UPDATE family_group SET metadata_json = :metadataJson WHERE id = :id")
    suspend fun updateMetadata(id: String, metadataJson: String?): Int

    @Query("DELETE FROM family_group WHERE id = :id")
    suspend fun deleteById(id: String): Int
}

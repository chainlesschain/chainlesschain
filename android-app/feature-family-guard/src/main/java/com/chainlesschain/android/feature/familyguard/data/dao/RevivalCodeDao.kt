package com.chainlesschain.android.feature.familyguard.data.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.chainlesschain.android.feature.familyguard.data.entity.RevivalCodeEntity

/**
 * Placeholder DAO (FAMILY-08). Body methods land alongside FAMILY-13 配对集成 +
 * FAMILY-16 紧急解绑 (将本 DAO 全套调通)。
 */
@Dao
interface RevivalCodeDao {

    /** 查所有可用 (未 consumed) 复活码; 一般预期 0 或 1 行。 */
    @Query("SELECT * FROM revival_code WHERE consumed_at IS NULL ORDER BY created_at DESC")
    suspend fun listAvailable(): List<RevivalCodeEntity>

    @Query("SELECT * FROM revival_code WHERE id = :id LIMIT 1")
    suspend fun findById(id: Long): RevivalCodeEntity?

    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insert(entity: RevivalCodeEntity): Long

    @Query("""
        UPDATE revival_code
           SET failed_attempts = :failedAttempts,
               locked_until = :lockedUntil
         WHERE id = :id
    """)
    suspend fun updateFailedAttempts(
        id: Long,
        failedAttempts: Int,
        lockedUntil: Long?,
    ): Int

    @Query("""
        UPDATE revival_code
           SET consumed_at = :consumedAt,
               failed_attempts = 0,
               locked_until = NULL
         WHERE id = :id
    """)
    suspend fun markConsumed(id: Long, consumedAt: Long): Int

    /** FAMILY-08 admin-only / 测试用; v0.1 UI 无入口。 */
    @Query("DELETE FROM revival_code WHERE id = :id")
    suspend fun deleteById(id: Long): Int
}

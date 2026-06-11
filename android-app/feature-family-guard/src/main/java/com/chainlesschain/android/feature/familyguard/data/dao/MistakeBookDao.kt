package com.chainlesschain.android.feature.familyguard.data.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.chainlesschain.android.feature.familyguard.data.entity.MistakeEntryEntity

/**
 * M6 mistake_book DAO (主文档 §3.6)。
 *
 * :app RoomMistakeBook 用 write-through 缓存模式消费: 启动 getAll 回灌内存,
 * 变更同步进内存 + 异步落库, 故无 Flow 查询 (内存 StateFlow 即真相源镜像)。
 */
@Dao
interface MistakeBookDao {

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(entity: MistakeEntryEntity)

    @Query("SELECT * FROM mistake_book ORDER BY created_at ASC, id ASC")
    suspend fun getAll(): List<MistakeEntryEntity>

    /** 间隔重复打点 (与内存侧 copy(reviewCount+1) 同语义)。 */
    @Query(
        """
        UPDATE mistake_book
           SET review_count = review_count + 1, last_reviewed_at = :at
         WHERE id = :id
        """,
    )
    suspend fun markReviewed(id: String, at: Long): Int

    @Query("DELETE FROM mistake_book WHERE id = :id")
    suspend fun delete(id: String): Int

    @Query("SELECT COUNT(*) FROM mistake_book")
    suspend fun count(): Int
}

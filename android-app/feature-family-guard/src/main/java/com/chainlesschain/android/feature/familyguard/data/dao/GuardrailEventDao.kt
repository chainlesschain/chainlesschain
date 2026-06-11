package com.chainlesschain.android.feature.familyguard.data.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.Query
import com.chainlesschain.android.feature.familyguard.data.entity.GuardrailEventEntity

/**
 * M6 guardrail_event DAO (主文档 §3.6)。append-only (审计事件不改不删,
 * 生命周期清理用 deleteOlderThan)。:app RoomGuardrailEventSink write-through 消费。
 */
@Dao
interface GuardrailEventDao {

    @Insert
    suspend fun insert(entity: GuardrailEventEntity): Long

    @Query("SELECT * FROM guardrail_event ORDER BY timestamp ASC, id ASC")
    suspend fun getAll(): List<GuardrailEventEntity>

    @Query("SELECT COUNT(*) FROM guardrail_event")
    suspend fun count(): Int

    /** 数据生命周期清理 (主文档 §4.6)。 */
    @Query("DELETE FROM guardrail_event WHERE timestamp < :cutoffMs")
    suspend fun deleteOlderThan(cutoffMs: Long): Int
}

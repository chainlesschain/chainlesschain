package com.chainlesschain.android.core.database.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.chainlesschain.android.core.database.entity.SyncRemoteCursorEntity

/**
 * sync_remote_cursor 数据访问对象（Phase 3d M3 step C）。
 *
 * 与 OfflineQueueDao 等同模式：纯接口，Room 编译期生成实现。所有读写都是
 * suspend，Hilt 注入到 SyncManager 后协程里直接调。
 *
 * 写入语义：upsert via REPLACE — 同 (remote_device_id, resource_type)
 * 主键覆盖。累加字段（items_pushed 等）由调用方读后加再写。
 */
@Dao
interface SyncRemoteCursorDao {

    /**
     * 取单 (设备, ResourceType) 的游标。null = 尚未建过。
     */
    @Query("""
        SELECT * FROM sync_remote_cursor
        WHERE remote_device_id = :deviceId AND resource_type = :resourceType
        LIMIT 1
    """)
    suspend fun getCursor(deviceId: String, resourceType: String): SyncRemoteCursorEntity?

    /**
     * 取一台设备的所有 ResourceType 游标。SyncManager startup reload 用。
     */
    @Query("""
        SELECT * FROM sync_remote_cursor
        WHERE remote_device_id = :deviceId
    """)
    suspend fun getCursorsForDevice(deviceId: String): List<SyncRemoteCursorEntity>

    /**
     * 取所有游标（startup load 用）。
     */
    @Query("SELECT * FROM sync_remote_cursor")
    suspend fun getAllCursors(): List<SyncRemoteCursorEntity>

    /**
     * upsert — 主键冲突 REPLACE。调用方负责把已读出的累加字段加好再写。
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(cursor: SyncRemoteCursorEntity)

    /**
     * 推进 lastPushTs（push 成功后调）。累加 itemsPushed。
     * upsert 路径：先 INSERT OR IGNORE 占位，再 UPDATE 推进，避免读改写竞态。
     */
    @Query("""
        INSERT INTO sync_remote_cursor
          (remote_device_id, resource_type, last_push_ts, items_pushed, updated_at)
        VALUES (:deviceId, :resourceType, :lastPushTs, :itemsPushedDelta, :now)
        ON CONFLICT(remote_device_id, resource_type) DO UPDATE SET
          last_push_ts = MAX(last_push_ts, :lastPushTs),
          items_pushed = items_pushed + :itemsPushedDelta,
          updated_at = :now
    """)
    suspend fun advancePush(
        deviceId: String,
        resourceType: String,
        lastPushTs: Long,
        itemsPushedDelta: Long = 1,
        now: Long = System.currentTimeMillis()
    )

    /**
     * 推进 lastPullTs/Id（pull 成功后调）。累加 itemsPulled。
     */
    @Query("""
        INSERT INTO sync_remote_cursor
          (remote_device_id, resource_type, last_pull_ts, last_pull_id, items_pulled, updated_at)
        VALUES (:deviceId, :resourceType, :lastPullTs, :lastPullId, :itemsPulledDelta, :now)
        ON CONFLICT(remote_device_id, resource_type) DO UPDATE SET
          last_pull_ts = MAX(last_pull_ts, :lastPullTs),
          last_pull_id = :lastPullId,
          items_pulled = items_pulled + :itemsPulledDelta,
          updated_at = :now
    """)
    suspend fun advancePull(
        deviceId: String,
        resourceType: String,
        lastPullTs: Long,
        lastPullId: String?,
        itemsPulledDelta: Long = 1,
        now: Long = System.currentTimeMillis()
    )

    /**
     * 写最终状态 + 时长（每轮 sync 收尾时调）。不动累加字段。
     */
    @Query("""
        INSERT INTO sync_remote_cursor
          (remote_device_id, resource_type, last_run_status, last_run_error,
           last_run_duration_ms, items_conflicted, updated_at)
        VALUES (:deviceId, :resourceType, :status, :error,
                :durationMs, :conflictedDelta, :now)
        ON CONFLICT(remote_device_id, resource_type) DO UPDATE SET
          last_run_status = :status,
          last_run_error = :error,
          last_run_duration_ms = :durationMs,
          items_conflicted = items_conflicted + :conflictedDelta,
          updated_at = :now
    """)
    suspend fun recordRunResult(
        deviceId: String,
        resourceType: String,
        status: String?,
        error: String?,
        durationMs: Long?,
        conflictedDelta: Long = 0,
        now: Long = System.currentTimeMillis()
    )

    /**
     * 删一台设备的所有游标（unpair 用）。
     */
    @Query("DELETE FROM sync_remote_cursor WHERE remote_device_id = :deviceId")
    suspend fun deleteCursorsForDevice(deviceId: String)

    /**
     * 清空全部游标（测试用）。
     */
    @Query("DELETE FROM sync_remote_cursor")
    suspend fun deleteAll()
}

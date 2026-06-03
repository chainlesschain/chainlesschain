package com.chainlesschain.android.core.database.entity

import androidx.room.ColumnInfo
import androidx.room.Entity

/**
 * 与远端设备的同步游标（Phase 3d M3 step C）。
 *
 * 主键 (remoteDeviceId, resourceType) — 每对 (设备, ResourceType) 一行，让
 * 后续可以分类型推进游标（例如 MESSAGE 已 sync 到 ts=100，FRIEND 已 sync 到
 * ts=200）。当前 v1 SyncManager 只用 resourceType="ALL" 一行/设备，跟原本
 * lastSyncTimestamp Map<String, Long> 的语义保持兼容。M3 step D 接 sync.pull
 * 时分辨 ResourceType 再细分。
 *
 * 字段说明：
 * - lastPullTs / lastPullId : 上次拉取到的远端游标，下次 sync.pull 用
 * - lastPushTs              : 上次成功推送给远端的最大本地 timestamp
 * - lastRunStatus           : "success" / "conflict" / "failed" / null（未跑过）
 * - lastRunDurationMs       : 监控用
 * - itemsPushed/Pulled/...  : 累加计数（监控 + UI 展示）
 *
 * 表名 sync_remote_cursor 与 desktop sync_external_provider_cursor 解耦——
 * 两端同一概念，物理存储独立。
 */
@Entity(
    tableName = "sync_remote_cursor",
    primaryKeys = ["remote_device_id", "resource_type"]
)
data class SyncRemoteCursorEntity(
    @ColumnInfo(name = "remote_device_id")
    val remoteDeviceId: String,

    @ColumnInfo(name = "resource_type")
    val resourceType: String,                // ResourceType.name 或 "ALL"

    @ColumnInfo(name = "last_pull_ts")
    val lastPullTs: Long = 0,

    @ColumnInfo(name = "last_pull_id")
    val lastPullId: String? = null,

    @ColumnInfo(name = "last_push_ts")
    val lastPushTs: Long = 0,

    @ColumnInfo(name = "last_run_status")
    val lastRunStatus: String? = null,

    @ColumnInfo(name = "last_run_error")
    val lastRunError: String? = null,

    @ColumnInfo(name = "last_run_duration_ms")
    val lastRunDurationMs: Long? = null,

    @ColumnInfo(name = "items_pushed")
    val itemsPushed: Long = 0,

    @ColumnInfo(name = "items_pulled")
    val itemsPulled: Long = 0,

    @ColumnInfo(name = "items_conflicted")
    val itemsConflicted: Long = 0,

    @ColumnInfo(name = "updated_at")
    val updatedAt: Long = System.currentTimeMillis()
)

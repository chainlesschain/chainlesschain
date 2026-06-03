package com.chainlesschain.android.feature.familyguard.data.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * 孩子端 telemetry 事件 (FAMILY-20, Epic C M2 起步).
 *
 * 主文档 §3.2 v0.2 三大数据源 (PDH collectors / UsageStatsManager / Plan C
 * snapshot writer) 都 emit 一条 child_event. 字段统一:
 *   - source: telemetry 来源 ('foreground_app' / 'pdh_wechat' / 'snapshot' / etc.)
 *   - kind: 事件细类 ('foreground_app_run' / 'message' / 'order' / etc.)
 *   - payload: JSON 自由结构 (按 source+kind 解析)
 *   - level: L0/L1/L2/L3 分级 (主文档 §3.2 数据分级表; 上行权限过滤层 FAMILY-25 用)
 *
 * v0.2 FAMILY-20 范围: ForegroundAppTimer 写 source='foreground_app' +
 * kind='run' (每 30min 聚合一行); 其他 source 后续 PDH collector ticket 加。
 *
 * @property timestamp 事件起始 epoch ms (聚合 run 用 startMs)
 * @property durationMs 持续时长; foreground_app run 为聚合段总长; 单次事件为 0
 */
@Entity(
    tableName = "child_event",
    indices = [
        Index(value = ["child_did", "timestamp"], name = "idx_child_event_did_time"),
        Index(value = ["source"], name = "idx_child_event_source"),
        Index(value = ["level"], name = "idx_child_event_level"),
    ],
)
data class ChildEventEntity(
    @PrimaryKey(autoGenerate = true)
    @ColumnInfo(name = "id")
    val id: Long = 0L,

    @ColumnInfo(name = "child_did")
    val childDid: String,

    @ColumnInfo(name = "source")
    val source: String,

    @ColumnInfo(name = "kind")
    val kind: String,

    @ColumnInfo(name = "payload")
    val payload: String,

    @ColumnInfo(name = "timestamp")
    val timestamp: Long,

    @ColumnInfo(name = "duration_ms")
    val durationMs: Long = 0L,

    @ColumnInfo(name = "level")
    val level: String = "L1", // 默认 L1; 主文档 §3.2 数据分级
)

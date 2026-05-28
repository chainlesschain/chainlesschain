package com.chainlesschain.android.feature.familyguard.data.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * 位置点 (FAMILY-02 placeholder schema, populated in FAMILY-50).
 *
 * 主文档 §3.8. source ∈ {'gps', 'fused', 'network', 'cell'};
 * battery_pct 让家长端能监控孩子手机电量 (低于 15% 时降频上报 +
 * 推送家长 "孩子手机快没电了"; FAMILY-56)。
 *
 * 上报频率按场景: 围栏内 10min / 围栏外 1min / SOS 后 5s (FAMILY-51)。
 * Quiet hours 不影响 M8 (安全围栏始终上报)。
 */
@Entity(
    tableName = "location_point",
    indices = [
        Index(value = ["child_did", "timestamp"], name = "idx_loc_child_time"),
        Index(value = ["device_id"]),
    ],
)
data class LocationPointEntity(
    @PrimaryKey(autoGenerate = true)
    @ColumnInfo(name = "id")
    val id: Long = 0L,

    @ColumnInfo(name = "child_did")
    val childDid: String,

    @ColumnInfo(name = "device_id")
    val deviceId: String,

    @ColumnInfo(name = "latitude")
    val latitude: Double,

    @ColumnInfo(name = "longitude")
    val longitude: Double,

    @ColumnInfo(name = "accuracy_m")
    val accuracyM: Double? = null,

    @ColumnInfo(name = "altitude_m")
    val altitudeM: Double? = null,

    @ColumnInfo(name = "speed_mps")
    val speedMps: Double? = null,

    @ColumnInfo(name = "source")
    val source: String,

    @ColumnInfo(name = "timestamp")
    val timestamp: Long,

    @ColumnInfo(name = "battery_pct")
    val batteryPct: Int? = null,
)

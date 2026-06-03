package com.chainlesschain.android.feature.familyguard.data.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * 电子围栏 (FAMILY-02 placeholder schema, populated in FAMILY-52).
 *
 * 主文档 §3.8. kind ∈ {'home', 'school', 'class', 'banned'}.
 * 每 family_group 共享围栏定义; 触发后 dispatch 给所有受影响 child。
 *
 * on_enter_action / on_exit_action / on_late_action ∈
 *   { 'notify_parent', 'silent', 'unlock_app:<pkg>', 'lock_app:<pkg>' }
 *
 * schedule + expected_arrival 为 JSON, 编码 weekday 配置 + 应到时间。
 */
@Entity(
    tableName = "geofence",
    indices = [
        Index(value = ["family_group_id"]),
        Index(value = ["kind"]),
        Index(value = ["active"]),
    ],
)
data class GeofenceEntity(
    @PrimaryKey
    @ColumnInfo(name = "id")
    val id: String,

    @ColumnInfo(name = "family_group_id")
    val familyGroupId: String,

    @ColumnInfo(name = "name")
    val name: String,

    @ColumnInfo(name = "kind")
    val kind: String,

    @ColumnInfo(name = "latitude")
    val latitude: Double,

    @ColumnInfo(name = "longitude")
    val longitude: Double,

    @ColumnInfo(name = "radius_m")
    val radiusM: Int,

    @ColumnInfo(name = "schedule")
    val schedule: String? = null,

    @ColumnInfo(name = "expected_arrival")
    val expectedArrival: String? = null,

    @ColumnInfo(name = "on_enter_action")
    val onEnterAction: String,

    @ColumnInfo(name = "on_exit_action")
    val onExitAction: String,

    @ColumnInfo(name = "on_late_action")
    val onLateAction: String,

    @ColumnInfo(name = "active")
    val active: Boolean = true,
)

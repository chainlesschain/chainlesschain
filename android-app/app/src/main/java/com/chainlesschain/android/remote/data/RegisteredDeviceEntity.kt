package com.chainlesschain.android.remote.data

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "registered_devices")
data class RegisteredDeviceEntity(
    @PrimaryKey
    val peerId: String,
    val did: String,
    val deviceName: String,
    val ipAddress: String,
    val createdAt: Long = System.currentTimeMillis(),
    val lastSeenAt: Long = System.currentTimeMillis(),

    // 新增：活动跟踪字段（与 PC 端对应）
    val lastActivityAt: Long = System.currentTimeMillis(),  // 最后活动时间
    val activityCount: Int = 0,  // 活动计数
    val permissionLevel: Int = 1  // 权限级别：1=PUBLIC, 2=NORMAL, 3=ADMIN, 4=ROOT
)

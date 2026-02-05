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
    val lastSeenAt: Long = System.currentTimeMillis()
)

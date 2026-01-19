package com.chainlesschain.android.feature.auth.domain.model

/**
 * 用户数据模型
 */
data class User(
    val id: String,
    val deviceId: String,
    val createdAt: Long = System.currentTimeMillis(),
    val lastLoginAt: Long = System.currentTimeMillis(),
    val biometricEnabled: Boolean = false
)

package com.chainlesschain.android.feature.auth.data.repository

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.chainlesschain.android.core.common.Result
import com.chainlesschain.android.core.security.KeyManager
import com.chainlesschain.android.feature.auth.domain.model.User
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import timber.log.Timber
import java.security.MessageDigest
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 认证数据仓库
 */
@Singleton
class AuthRepository @Inject constructor(
    @ApplicationContext private val context: Context,
    private val keyManager: KeyManager
) {
    private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "auth_prefs")

    companion object {
        private val KEY_USER_ID = stringPreferencesKey("user_id")
        private val KEY_DEVICE_ID = stringPreferencesKey("device_id")
        private val KEY_PIN_HASH = stringPreferencesKey("pin_hash")
        private val KEY_CREATED_AT = longPreferencesKey("created_at")
        private val KEY_LAST_LOGIN_AT = longPreferencesKey("last_login_at")
        private val KEY_BIOMETRIC_ENABLED = booleanPreferencesKey("biometric_enabled")
        private val KEY_IS_SETUP_COMPLETE = booleanPreferencesKey("is_setup_complete")
    }

    /**
     * 检查是否已完成初始设置
     */
    suspend fun isSetupComplete(): Boolean {
        return context.dataStore.data.map { prefs ->
            prefs[KEY_IS_SETUP_COMPLETE] ?: false
        }.first()
    }

    /**
     * 注册新用户（设置PIN码）
     */
    suspend fun register(pin: String): Result<User> {
        return try {
            // 检查是否已注册
            if (isSetupComplete()) {
                return Result.error(IllegalStateException("User already registered"))
            }

            // 生成用户ID和设备ID
            val userId = UUID.randomUUID().toString()
            val deviceId = getOrCreateDeviceId()

            // 哈希PIN码
            val pinHash = hashPin(pin)

            // 保存用户信息
            context.dataStore.edit { prefs ->
                prefs[KEY_USER_ID] = userId
                prefs[KEY_DEVICE_ID] = deviceId
                prefs[KEY_PIN_HASH] = pinHash
                prefs[KEY_CREATED_AT] = System.currentTimeMillis()
                prefs[KEY_LAST_LOGIN_AT] = System.currentTimeMillis()
                prefs[KEY_BIOMETRIC_ENABLED] = false
                prefs[KEY_IS_SETUP_COMPLETE] = true
            }

            // 初始化数据库密钥
            keyManager.getDatabaseKey()

            Timber.d("User registered successfully: $userId")

            Result.success(
                User(
                    id = userId,
                    deviceId = deviceId,
                    createdAt = System.currentTimeMillis(),
                    lastLoginAt = System.currentTimeMillis(),
                    biometricEnabled = false
                )
            )
        } catch (e: Exception) {
            Timber.e(e, "Failed to register user")
            Result.error(e, "注册失败")
        }
    }

    /**
     * 验证PIN码
     */
    suspend fun verifyPIN(pin: String): Result<User> {
        return try {
            val prefs = context.dataStore.data.first()
            val storedPinHash = prefs[KEY_PIN_HASH]

            if (storedPinHash == null) {
                return Result.error(IllegalStateException("No PIN set"), "未设置PIN码")
            }

            val pinHash = hashPin(pin)

            if (pinHash == storedPinHash) {
                // 更新最后登录时间
                context.dataStore.edit { it[KEY_LAST_LOGIN_AT] = System.currentTimeMillis() }

                Timber.d("PIN verification successful")

                Result.success(getCurrentUser()!!)
            } else {
                Timber.w("PIN verification failed")
                Result.error(IllegalArgumentException("Invalid PIN"), "PIN码错误")
            }
        } catch (e: Exception) {
            Timber.e(e, "Failed to verify PIN")
            Result.error(e, "验证失败")
        }
    }

    /**
     * 修改PIN码
     */
    suspend fun changePIN(oldPin: String, newPin: String): Result<Unit> {
        return try {
            // 先验证旧PIN码
            when (val result = verifyPIN(oldPin)) {
                is Result.Success -> {
                    // 保存新PIN码
                    val newPinHash = hashPin(newPin)
                    context.dataStore.edit { prefs ->
                        prefs[KEY_PIN_HASH] = newPinHash
                    }
                    Timber.d("PIN changed successfully")
                    Result.success(Unit)
                }
                is Result.Error -> result
                else -> Result.error(IllegalStateException("Unexpected result"))
            }
        } catch (e: Exception) {
            Timber.e(e, "Failed to change PIN")
            Result.error(e, "修改PIN码失败")
        }
    }

    /**
     * 启用/禁用生物识别
     */
    suspend fun setBiometricEnabled(enabled: Boolean): Result<Unit> {
        return try {
            context.dataStore.edit { prefs ->
                prefs[KEY_BIOMETRIC_ENABLED] = enabled
            }
            Timber.d("Biometric ${if (enabled) "enabled" else "disabled"}")
            Result.success(Unit)
        } catch (e: Exception) {
            Timber.e(e, "Failed to set biometric enabled")
            Result.error(e)
        }
    }

    /**
     * 获取当前用户
     */
    suspend fun getCurrentUser(): User? {
        return try {
            val prefs = context.dataStore.data.first()
            val userId = prefs[KEY_USER_ID] ?: return null
            val deviceId = prefs[KEY_DEVICE_ID] ?: return null

            User(
                id = userId,
                deviceId = deviceId,
                createdAt = prefs[KEY_CREATED_AT] ?: 0L,
                lastLoginAt = prefs[KEY_LAST_LOGIN_AT] ?: 0L,
                biometricEnabled = prefs[KEY_BIOMETRIC_ENABLED] ?: false
            )
        } catch (e: Exception) {
            Timber.e(e, "Failed to get current user")
            null
        }
    }

    /**
     * 观察当前用户
     */
    fun observeCurrentUser(): Flow<User?> {
        return context.dataStore.data.map { prefs ->
            val userId = prefs[KEY_USER_ID] ?: return@map null
            val deviceId = prefs[KEY_DEVICE_ID] ?: return@map null

            User(
                id = userId,
                deviceId = deviceId,
                createdAt = prefs[KEY_CREATED_AT] ?: 0L,
                lastLoginAt = prefs[KEY_LAST_LOGIN_AT] ?: 0L,
                biometricEnabled = prefs[KEY_BIOMETRIC_ENABLED] ?: false
            )
        }
    }

    /**
     * 退出登录（仅清除会话状态，保留PIN码和设备信息）
     */
    suspend fun logout(): Result<Unit> {
        return try {
            // 只清除最后登录时间，不清除PIN码和其他注册信息
            // 这样用户可以重新登录，而不需要重新设置PIN
            context.dataStore.edit { prefs ->
                prefs[KEY_LAST_LOGIN_AT] = 0L
            }
            Timber.d("User logged out (PIN and setup data preserved)")
            Result.success(Unit)
        } catch (e: Exception) {
            Timber.e(e, "Failed to logout")
            Result.error(e)
        }
    }

    /**
     * 哈希PIN码（SHA-256）
     */
    private fun hashPin(pin: String): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val hashBytes = digest.digest(pin.toByteArray())
        return hashBytes.joinToString("") { "%02x".format(it) }
    }

    /**
     * 获取或创建设备ID
     */
    private suspend fun getOrCreateDeviceId(): String {
        val prefs = context.dataStore.data.first()
        return prefs[KEY_DEVICE_ID] ?: run {
            val deviceId = UUID.randomUUID().toString()
            context.dataStore.edit { it[KEY_DEVICE_ID] = deviceId }
            deviceId
        }
    }
}

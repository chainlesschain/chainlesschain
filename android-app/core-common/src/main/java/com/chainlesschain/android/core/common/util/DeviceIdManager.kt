package com.chainlesschain.android.core.common.util

import android.content.Context
import android.content.SharedPreferences
import android.provider.Settings
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import dagger.hilt.android.qualifiers.ApplicationContext
import timber.log.Timber
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 设备ID管理器
 *
 * 负责生成和持久化设备唯一标识符
 * 使用 EncryptedSharedPreferences 安全存储
 */
@Singleton
class DeviceIdManager @Inject constructor(
    @ApplicationContext private val context: Context
) {
    // Test injection point - allows tests to provide plain SharedPreferences
    internal var testSharedPreferences: SharedPreferences? = null

    private val masterKey: MasterKey by lazy {
        MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
    }

    private val sharedPreferences: SharedPreferences by lazy {
        testSharedPreferences ?: EncryptedSharedPreferences.create(
            context,
            PREFS_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    /**
     * 获取设备ID
     *
     * 优先级：
     * 1. 从加密存储读取已存在的ID
     * 2. 生成新的UUID并持久化
     *
     * @return 设备唯一标识符（格式：device-uuid）
     */
    fun getDeviceId(): String {
        return synchronized(this) {
            // 1. 尝试读取已存储的设备ID
            val existingId = sharedPreferences.getString(KEY_DEVICE_ID, null)
            if (!existingId.isNullOrBlank()) {
                Timber.d("设备ID已存在: ${existingId.take(15)}...")
                return@synchronized existingId
            }

            // 2. 生成新的设备ID
            val newDeviceId = generateDeviceId()

            // 3. 持久化保存
            sharedPreferences.edit()
                .putString(KEY_DEVICE_ID, newDeviceId)
                .apply()

            Timber.i("设备ID已生成并保存: ${newDeviceId.take(15)}...")
            newDeviceId
        }
    }

    /**
     * 获取设备指纹
     *
     * 结合多个设备属性生成更稳定的标识符
     *
     * @return 设备指纹字符串
     */
    fun getDeviceFingerprint(): String {
        return synchronized(this) {
            val existingFingerprint = sharedPreferences.getString(KEY_DEVICE_FINGERPRINT, null)
            if (!existingFingerprint.isNullOrBlank()) {
                return@synchronized existingFingerprint
            }

            // 生成设备指纹
            val androidId = try {
                context.contentResolver?.let {
                    Settings.Secure.getString(it, Settings.Secure.ANDROID_ID)
                } ?: "unknown"
            } catch (e: Exception) {
                Timber.w(e, "无法获取 ANDROID_ID")
                "unknown"
            }

            val fingerprint = "fp-$androidId-${UUID.randomUUID()}"

            // 保存指纹
            sharedPreferences.edit()
                .putString(KEY_DEVICE_FINGERPRINT, fingerprint)
                .apply()

            Timber.i("设备指纹已生成: ${fingerprint.take(20)}...")
            fingerprint
        }
    }

    /**
     * 重置设备ID（仅用于测试或特殊场景）
     *
     * ⚠️ 警告：重置后会导致与旧设备ID关联的数据无法同步
     */
    fun resetDeviceId(): String {
        return synchronized(this) {
            Timber.w("正在重置设备ID...")

            val newDeviceId = generateDeviceId()

            sharedPreferences.edit()
                .putString(KEY_DEVICE_ID, newDeviceId)
                .remove(KEY_DEVICE_FINGERPRINT)
                .apply()

            Timber.i("设备ID已重置: ${newDeviceId.take(15)}...")
            newDeviceId
        }
    }

    /**
     * 获取设备信息摘要（用于调试）
     */
    fun getDeviceInfo(): DeviceInfo {
        return DeviceInfo(
            deviceId = getDeviceId(),
            fingerprint = getDeviceFingerprint(),
            androidId = try {
                context.contentResolver?.let {
                    Settings.Secure.getString(it, Settings.Secure.ANDROID_ID)
                } ?: "unavailable"
            } catch (e: Exception) {
                "unavailable"
            }
        )
    }

    /**
     * 生成设备ID
     *
     * 格式：device-{UUID}
     */
    private fun generateDeviceId(): String {
        val uuid = UUID.randomUUID().toString()
        return "device-$uuid"
    }

    /**
     * 设备信息数据类
     */
    data class DeviceInfo(
        val deviceId: String,
        val fingerprint: String,
        val androidId: String
    )

    companion object {
        private const val PREFS_NAME = "chainlesschain_device_prefs"
        private const val KEY_DEVICE_ID = "device_id"
        private const val KEY_DEVICE_FINGERPRINT = "device_fingerprint"
    }
}

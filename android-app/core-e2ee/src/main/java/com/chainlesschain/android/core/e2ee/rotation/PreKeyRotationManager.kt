package com.chainlesschain.android.core.e2ee.rotation

import android.util.Log
import com.chainlesschain.android.core.e2ee.crypto.X25519KeyPair
import kotlinx.coroutines.*
import java.util.concurrent.TimeUnit

/**
 * 预密钥轮转管理器
 *
 * 定期轮转签名预密钥和一次性预密钥以增强安全性
 */
class PreKeyRotationManager(
    private val onSignedPreKeyRotation: suspend (X25519KeyPair) -> Unit,
    private val onOneTimePreKeysGeneration: suspend (count: Int) -> Unit,
    private val onOneTimePreKeysCleanup: suspend () -> Unit
) {

    companion object {
        private const val TAG = "PreKeyRotationManager"

        // 默认轮转间隔
        private val SIGNED_PRE_KEY_ROTATION_INTERVAL = TimeUnit.DAYS.toMillis(7) // 7天
        private val ONE_TIME_PRE_KEY_CHECK_INTERVAL = TimeUnit.HOURS.toMillis(6) // 6小时
        private val ONE_TIME_PRE_KEY_CLEANUP_INTERVAL = TimeUnit.DAYS.toMillis(30) // 30天

        // 一次性预密钥阈值
        private const val ONE_TIME_PRE_KEY_LOW_THRESHOLD = 5
        private const val ONE_TIME_PRE_KEY_GENERATION_COUNT = 20
    }

    private val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())

    private var signedPreKeyRotationJob: Job? = null
    private var oneTimePreKeyManagementJob: Job? = null

    private var lastSignedPreKeyRotation: Long = System.currentTimeMillis()
    private var lastOneTimePreKeyCleanup: Long = System.currentTimeMillis()

    /**
     * 启动预密钥轮转
     *
     * @param signedPreKeyInterval 签名预密钥轮转间隔（毫秒）
     * @param oneTimePreKeyCheckInterval 一次性预密钥检查间隔（毫秒）
     */
    fun start(
        signedPreKeyInterval: Long = SIGNED_PRE_KEY_ROTATION_INTERVAL,
        oneTimePreKeyCheckInterval: Long = ONE_TIME_PRE_KEY_CHECK_INTERVAL
    ) {
        Log.i(TAG, "Starting pre-key rotation manager")

        // 启动签名预密钥轮转
        signedPreKeyRotationJob = scope.launch {
            while (isActive) {
                try {
                    delay(signedPreKeyInterval)
                    rotateSignedPreKey()
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    Log.e(TAG, "Error in signed pre-key rotation", e)
                }
            }
        }

        // 启动一次性预密钥管理
        oneTimePreKeyManagementJob = scope.launch {
            while (isActive) {
                try {
                    delay(oneTimePreKeyCheckInterval)
                    manageOneTimePreKeys()
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    Log.e(TAG, "Error in one-time pre-key management", e)
                }
            }
        }

        Log.i(TAG, "Pre-key rotation manager started")
    }

    /**
     * 停止预密钥轮转
     */
    fun stop() {
        Log.i(TAG, "Stopping pre-key rotation manager")

        signedPreKeyRotationJob?.cancel()
        oneTimePreKeyManagementJob?.cancel()

        signedPreKeyRotationJob = null
        oneTimePreKeyManagementJob = null

        Log.i(TAG, "Pre-key rotation manager stopped")
    }

    /**
     * 释放资源
     */
    fun release() {
        stop()
        scope.cancel()
    }

    /**
     * 立即轮转签名预密钥
     */
    suspend fun rotateSignedPreKey() {
        Log.i(TAG, "Rotating signed pre-key")

        try {
            val newSignedPreKeyPair = X25519KeyPair.generate()
            onSignedPreKeyRotation(newSignedPreKeyPair)

            lastSignedPreKeyRotation = System.currentTimeMillis()

            Log.i(TAG, "Signed pre-key rotated successfully")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to rotate signed pre-key", e)
            throw e
        }
    }

    /**
     * 管理一次性预密钥
     *
     * 检查数量并在需要时生成新密钥，定期清理过期密钥
     */
    private suspend fun manageOneTimePreKeys() {
        Log.d(TAG, "Managing one-time pre-keys")

        try {
            // 生成新的一次性预密钥
            onOneTimePreKeysGeneration(ONE_TIME_PRE_KEY_GENERATION_COUNT)

            // 定期清理过期的一次性预密钥
            val now = System.currentTimeMillis()
            if (now - lastOneTimePreKeyCleanup >= ONE_TIME_PRE_KEY_CLEANUP_INTERVAL) {
                cleanupOneTimePreKeys()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to manage one-time pre-keys", e)
        }
    }

    /**
     * 清理过期的一次性预密钥
     */
    private suspend fun cleanupOneTimePreKeys() {
        Log.i(TAG, "Cleaning up old one-time pre-keys")

        try {
            onOneTimePreKeysCleanup()
            lastOneTimePreKeyCleanup = System.currentTimeMillis()

            Log.i(TAG, "One-time pre-keys cleanup completed")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to cleanup one-time pre-keys", e)
        }
    }

    /**
     * 获取轮转状态
     */
    fun getRotationStatus(): RotationStatus {
        val now = System.currentTimeMillis()

        return RotationStatus(
            isRunning = signedPreKeyRotationJob?.isActive == true,
            lastSignedPreKeyRotation = lastSignedPreKeyRotation,
            timeSinceLastSignedPreKeyRotation = now - lastSignedPreKeyRotation,
            nextSignedPreKeyRotation = lastSignedPreKeyRotation + SIGNED_PRE_KEY_ROTATION_INTERVAL,
            lastOneTimePreKeyCleanup = lastOneTimePreKeyCleanup,
            timeSinceLastCleanup = now - lastOneTimePreKeyCleanup
        )
    }

    /**
     * 设置签名预密钥最后轮转时间
     *
     * 用于从持久化状态恢复
     */
    fun setLastSignedPreKeyRotation(timestamp: Long) {
        lastSignedPreKeyRotation = timestamp
    }

    /**
     * 设置一次性预密钥最后清理时间
     *
     * 用于从持久化状态恢复
     */
    fun setLastOneTimePreKeyCleanup(timestamp: Long) {
        lastOneTimePreKeyCleanup = timestamp
    }
}

/**
 * 轮转状态
 */
data class RotationStatus(
    /** 是否正在运行 */
    val isRunning: Boolean,

    /** 最后签名预密钥轮转时间 */
    val lastSignedPreKeyRotation: Long,

    /** 距离最后轮转的时间 */
    val timeSinceLastSignedPreKeyRotation: Long,

    /** 下次轮转时间 */
    val nextSignedPreKeyRotation: Long,

    /** 最后一次性预密钥清理时间 */
    val lastOneTimePreKeyCleanup: Long,

    /** 距离最后清理的时间 */
    val timeSinceLastCleanup: Long
) {
    /** 签名预密钥是否需要轮转 */
    val needsSignedPreKeyRotation: Boolean
        get() = System.currentTimeMillis() >= nextSignedPreKeyRotation

    /** 剩余轮转时间（毫秒） */
    val timeUntilNextRotation: Long
        get() = (nextSignedPreKeyRotation - System.currentTimeMillis()).coerceAtLeast(0)

    /** 剩余轮转时间（天） */
    val daysUntilNextRotation: Long
        get() = TimeUnit.MILLISECONDS.toDays(timeUntilNextRotation)
}

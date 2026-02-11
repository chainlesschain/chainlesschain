package com.chainlesschain.android.remote.crypto

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import timber.log.Timber
import java.security.SecureRandom
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Nonce 管理器
 *
 * 功能：
 * - 生成唯一的 Nonce 值（使用 SecureRandom）
 * - 持久化已使用的 Nonce（防重放攻击）
 * - 定期清理过期 Nonce
 * - 与 PC 端保持一致（10 分钟过期）
 */

/**
 * 已使用的 Nonce 实体
 */
@Entity(tableName = "used_nonces")
data class UsedNonceEntity(
    @PrimaryKey
    val nonceKey: String,  // Format: "${did}:${nonce}"
    val did: String,
    val timestamp: Long = System.currentTimeMillis()
)

/**
 * Nonce DAO
 */
@Dao
interface UsedNonceDao {
    @Query("SELECT * FROM used_nonces WHERE nonceKey = :nonceKey")
    suspend fun getNonce(nonceKey: String): UsedNonceEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertNonce(nonce: UsedNonceEntity)

    @Query("DELETE FROM used_nonces WHERE timestamp < :timestamp")
    suspend fun deleteOldNonces(timestamp: Long): Int

    @Query("SELECT COUNT(*) FROM used_nonces")
    suspend fun getCount(): Int

    @Query("DELETE FROM used_nonces")
    suspend fun clearAll()
}

/**
 * Nonce 数据库
 */
@Database(
    entities = [UsedNonceEntity::class],
    version = 1,
    exportSchema = false
)
abstract class NonceDatabase : RoomDatabase() {
    abstract fun usedNonceDao(): UsedNonceDao

    companion object {
        @Volatile
        private var INSTANCE: NonceDatabase? = null

        fun getInstance(context: Context): NonceDatabase {
            return INSTANCE ?: synchronized(this) {
                val instance = Room.databaseBuilder(
                    context.applicationContext,
                    NonceDatabase::class.java,
                    "nonce_database"
                ).build()
                INSTANCE = instance
                instance
            }
        }
    }
}

/**
 * Nonce 管理器实现
 */
@Singleton
class NonceManager @Inject constructor(
    private val context: Context
) {
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var cleanupJob: Job? = null
    private val secureRandom = SecureRandom()

    private val database: NonceDatabase by lazy {
        NonceDatabase.getInstance(context)
    }

    private val nonceDao: UsedNonceDao by lazy {
        database.usedNonceDao()
    }

    companion object {
        private const val NONCE_BYTE_LENGTH = 16  // 128-bit nonce
        private const val NONCE_EXPIRY_MS = 10 * 60 * 1000L  // 10 分钟（与 PC 端一致）
        private const val CLEANUP_INTERVAL_MS = 5 * 60 * 1000L  // 每 5 分钟清理
    }

    /**
     * 初始化 Nonce 管理器
     */
    fun initialize() {
        Timber.d("[NonceManager] 初始化 Nonce 管理器")
        startCleanupTask()
    }

    /**
     * 生成新的 Nonce 并持久化
     *
     * @param did 设备 DID
     * @return 生成的 Nonce 字符串
     */
    suspend fun generateNonce(did: String): String {
        val bytes = ByteArray(NONCE_BYTE_LENGTH)
        secureRandom.nextBytes(bytes)

        // 转换为十六进制字符串
        val nonce = bytes.joinToString("") { "%02x".format(it) }

        // 记录到数据库（防重放）
        try {
            val nonceKey = "$did:$nonce"
            val entity = UsedNonceEntity(
                nonceKey = nonceKey,
                did = did,
                timestamp = System.currentTimeMillis()
            )
            nonceDao.insertNonce(entity)
            Timber.v("[NonceManager] Nonce 已生成并持久化: ${nonce.take(8)}...")
        } catch (e: Exception) {
            Timber.w(e, "[NonceManager] Nonce 持久化失败，继续使用")
            // 继续使用 Nonce，但会降低重放攻击防护
        }

        return nonce
    }

    /**
     * 验证 Nonce 是否已使用（可用于本地验证）
     *
     * @param did 设备 DID
     * @param nonce Nonce 值
     * @return 是否已使用
     */
    suspend fun isNonceUsed(did: String, nonce: String): Boolean {
        return try {
            val nonceKey = "$did:$nonce"
            nonceDao.getNonce(nonceKey) != null
        } catch (e: Exception) {
            Timber.e(e, "[NonceManager] 检查 Nonce 失败")
            false
        }
    }

    /**
     * 启动定期清理任务
     */
    private fun startCleanupTask() {
        cleanupJob?.cancel()
        cleanupJob = scope.launch {
            while (isActive) {
                try {
                    delay(CLEANUP_INTERVAL_MS)
                    cleanupExpiredNonces()
                } catch (e: Exception) {
                    Timber.w(e, "[NonceManager] 清理任务异常")
                }
            }
        }
        Timber.d("[NonceManager] 清理任务已启动 (间隔: ${CLEANUP_INTERVAL_MS / 1000}s)")
    }

    /**
     * 清理过期 Nonce
     */
    private suspend fun cleanupExpiredNonces() {
        try {
            val threshold = System.currentTimeMillis() - NONCE_EXPIRY_MS
            val deleted = nonceDao.deleteOldNonces(threshold)
            if (deleted > 0) {
                Timber.d("[NonceManager] 清理了 $deleted 个过期 Nonce")
            }
        } catch (e: Exception) {
            Timber.e(e, "[NonceManager] 清理过期 Nonce 失败")
        }
    }

    /**
     * 获取统计信息
     */
    suspend fun getStats(): NonceStats {
        return try {
            NonceStats(
                count = nonceDao.getCount(),
                expiryMs = NONCE_EXPIRY_MS
            )
        } catch (e: Exception) {
            Timber.e(e, "[NonceManager] 获取统计失败")
            NonceStats(count = 0, expiryMs = NONCE_EXPIRY_MS)
        }
    }

    /**
     * 关闭 Nonce 管理器
     */
    fun shutdown() {
        cleanupJob?.cancel()
        cleanupJob = null
        Timber.d("[NonceManager] 已关闭")
    }
}

/**
 * Nonce 统计信息
 */
data class NonceStats(
    val count: Int,
    val expiryMs: Long
)

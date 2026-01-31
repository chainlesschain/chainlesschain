package com.chainlesschain.android.remote.offline

import androidx.room.*
import com.chainlesschain.android.remote.data.CommandRequest
import com.chainlesschain.android.remote.data.toJsonString
import com.chainlesschain.android.remote.data.fromJson
import com.chainlesschain.android.remote.p2p.P2PClient
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 离线命令实体
 */
@Entity(tableName = "offline_commands")
data class OfflineCommandEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "method") val method: String,
    @ColumnInfo(name = "params") val params: String,
    @ColumnInfo(name = "auth") val auth: String,
    @ColumnInfo(name = "timestamp") val timestamp: Long,
    @ColumnInfo(name = "retries") val retries: Int = 0,
    @ColumnInfo(name = "status") val status: String = "pending", // pending, sending, failed
    @ColumnInfo(name = "error_message") val errorMessage: String? = null
)

/**
 * 离线命令 DAO
 */
@Dao
interface OfflineCommandDao {
    @Query("SELECT * FROM offline_commands WHERE status = 'pending' ORDER BY timestamp ASC")
    suspend fun getPendingCommands(): List<OfflineCommandEntity>

    @Query("SELECT * FROM offline_commands ORDER BY timestamp DESC LIMIT :limit")
    suspend fun getRecentCommands(limit: Int = 50): List<OfflineCommandEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(command: OfflineCommandEntity)

    @Update
    suspend fun update(command: OfflineCommandEntity)

    @Delete
    suspend fun delete(command: OfflineCommandEntity)

    @Query("DELETE FROM offline_commands WHERE id = :id")
    suspend fun deleteById(id: String)

    @Query("DELETE FROM offline_commands WHERE status = 'pending' AND timestamp < :timestamp")
    suspend fun deleteOldCommands(timestamp: Long)

    @Query("SELECT COUNT(*) FROM offline_commands WHERE status = 'pending'")
    suspend fun countPending(): Int
}

/**
 * 离线命令队列管理器
 */
@Singleton
class OfflineCommandQueue @Inject constructor(
    private val dao: OfflineCommandDao,
    private val p2pClient: P2PClient
) {
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    // 队列统计
    private val _stats = MutableStateFlow(QueueStats())
    val stats: StateFlow<QueueStats> = _stats.asStateFlow()

    // 自动发送任务
    private var autoSendJob: Job? = null

    companion object {
        private const val MAX_RETRIES = 3
        private const val RETRY_DELAY = 5000L // 5 秒
        private const val OLD_COMMAND_THRESHOLD = 7 * 24 * 60 * 60 * 1000L // 7 天
    }

    /**
     * 初始化队列
     */
    suspend fun initialize() {
        Timber.d("初始化离线命令队列")

        // 清理旧命令
        cleanupOldCommands()

        // 更新统计
        updateStats()

        // 监听连接状态，自动发送
        p2pClient.connectionState.collect { state ->
            if (state == com.chainlesschain.android.remote.p2p.ConnectionState.CONNECTED) {
                Timber.d("连接已建立，开始自动发送队列命令")
                startAutoSend()
            } else {
                stopAutoSend()
            }
        }
    }

    /**
     * 入队命令
     */
    suspend fun enqueue(request: CommandRequest): Result<Unit> {
        return try {
            Timber.d("命令入队: ${request.method}")

            val entity = OfflineCommandEntity(
                id = request.id,
                method = request.method,
                params = request.params.toJsonString(),
                auth = request.auth.toJsonString(),
                timestamp = System.currentTimeMillis(),
                retries = 0,
                status = "pending"
            )

            dao.insert(entity)

            // 更新统计
            updateStats()

            Timber.d("✅ 命令已入队: ${request.id}")
            Result.success(Unit)
        } catch (e: Exception) {
            Timber.e(e, "❌ 命令入队失败")
            Result.failure(e)
        }
    }

    /**
     * 出队并发送命令
     */
    suspend fun dequeueAndSend(): Result<Int> {
        return try {
            val commands = dao.getPendingCommands()

            if (commands.isEmpty()) {
                Timber.d("队列为空，无命令需要发送")
                return Result.success(0)
            }

            Timber.d("开始发送 ${commands.size} 个待发命令")

            var successCount = 0
            var failCount = 0

            for (command in commands) {
                try {
                    // 标记为发送中
                    dao.update(command.copy(status = "sending"))

                    // 构造请求
                    val request = CommandRequest(
                        id = command.id,
                        method = command.method,
                        params = command.params.fromJson(),
                        auth = command.auth.fromJson()
                    )

                    // 发送命令
                    val result = p2pClient.sendCommand<Any>(
                        method = request.method,
                        params = request.params
                    )

                    if (result.isSuccess) {
                        // 发送成功，删除命令
                        dao.deleteById(command.id)
                        successCount++
                        Timber.d("✅ 命令发送成功: ${command.id}")
                    } else {
                        // 发送失败，增加重试次数
                        handleSendFailure(command, result.exceptionOrNull()?.message)
                        failCount++
                    }

                    // 避免过快发送
                    delay(100)

                } catch (e: Exception) {
                    Timber.e(e, "发送命令异常: ${command.id}")
                    handleSendFailure(command, e.message)
                    failCount++
                }
            }

            // 更新统计
            updateStats()

            Timber.d("队列发送完成: 成功 $successCount, 失败 $failCount")
            Result.success(successCount)
        } catch (e: Exception) {
            Timber.e(e, "出队发送失败")
            Result.failure(e)
        }
    }

    /**
     * 处理发送失败
     */
    private suspend fun handleSendFailure(command: OfflineCommandEntity, errorMessage: String?) {
        val newRetries = command.retries + 1

        if (newRetries >= MAX_RETRIES) {
            // 超过最大重试次数，标记为失败
            Timber.w("命令重试次数超限，标记为失败: ${command.id}")
            dao.update(
                command.copy(
                    status = "failed",
                    retries = newRetries,
                    errorMessage = errorMessage
                )
            )
        } else {
            // 恢复为待发送状态
            Timber.w("命令发送失败，将重试: ${command.id} (${newRetries}/$MAX_RETRIES)")
            dao.update(
                command.copy(
                    status = "pending",
                    retries = newRetries,
                    errorMessage = errorMessage
                )
            )

            // 延迟后重试
            delay(RETRY_DELAY)
        }
    }

    /**
     * 启动自动发送
     */
    private fun startAutoSend() {
        stopAutoSend()

        autoSendJob = scope.launch {
            while (isActive) {
                try {
                    // 检查是否有待发命令
                    val pendingCount = dao.countPending()

                    if (pendingCount > 0) {
                        Timber.d("检测到 $pendingCount 个待发命令，开始发送")
                        dequeueAndSend()
                    }

                    // 每 10 秒检查一次
                    delay(10000)
                } catch (e: Exception) {
                    Timber.e(e, "自动发送异常")
                }
            }
        }

        Timber.d("✅ 自动发送已启动")
    }

    /**
     * 停止自动发送
     */
    private fun stopAutoSend() {
        autoSendJob?.cancel()
        autoSendJob = null
        Timber.d("自动发送已停止")
    }

    /**
     * 获取最近命令列表
     */
    suspend fun getRecentCommands(limit: Int = 50): List<OfflineCommandEntity> {
        return dao.getRecentCommands(limit)
    }

    /**
     * 清理旧命令（超过 7 天）
     */
    suspend fun cleanupOldCommands() {
        try {
            val threshold = System.currentTimeMillis() - OLD_COMMAND_THRESHOLD
            dao.deleteOldCommands(threshold)
            Timber.d("旧命令已清理")
        } catch (e: Exception) {
            Timber.e(e, "清理旧命令失败")
        }
    }

    /**
     * 更新统计信息
     */
    private suspend fun updateStats() {
        try {
            val commands = dao.getRecentCommands(1000)

            _stats.value = QueueStats(
                total = commands.size,
                pending = commands.count { it.status == "pending" },
                sending = commands.count { it.status == "sending" },
                failed = commands.count { it.status == "failed" }
            )
        } catch (e: Exception) {
            Timber.e(e, "更新统计失败")
        }
    }

    /**
     * 重试失败的命令
     */
    suspend fun retryFailedCommands(): Result<Int> {
        return try {
            val failedCommands = dao.getRecentCommands(1000)
                .filter { it.status == "failed" }

            Timber.d("重试 ${failedCommands.size} 个失败命令")

            for (command in failedCommands) {
                dao.update(
                    command.copy(
                        status = "pending",
                        retries = 0,
                        errorMessage = null
                    )
                )
            }

            // 更新统计
            updateStats()

            // 立即尝试发送
            if (p2pClient.connectionState.value == com.chainlesschain.android.remote.p2p.ConnectionState.CONNECTED) {
                dequeueAndSend()
            }

            Result.success(failedCommands.size)
        } catch (e: Exception) {
            Timber.e(e, "重试失败命令异常")
            Result.failure(e)
        }
    }

    /**
     * 清空队列
     */
    suspend fun clear() {
        try {
            val commands = dao.getPendingCommands()
            for (command in commands) {
                dao.delete(command)
            }
            updateStats()
            Timber.d("队列已清空")
        } catch (e: Exception) {
            Timber.e(e, "清空队列失败")
        }
    }
}

/**
 * 队列统计
 */
data class QueueStats(
    val total: Int = 0,
    val pending: Int = 0,
    val sending: Int = 0,
    val failed: Int = 0
)

/**
 * 数据库定义
 */
@Database(
    entities = [OfflineCommandEntity::class],
    version = 1,
    exportSchema = false
)
abstract class OfflineCommandDatabase : RoomDatabase() {
    abstract fun offlineCommandDao(): OfflineCommandDao
}

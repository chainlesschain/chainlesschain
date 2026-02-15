package com.chainlesschain.android.remote.client

import com.chainlesschain.android.remote.p2p.CommandCancelledException
import com.chainlesschain.android.remote.p2p.P2PClient
import com.chainlesschain.android.remote.p2p.PendingCommandInfo
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 远程命令客户端
 *
 * 提供类型安全的命令 API 封装
 */
@Singleton
class RemoteCommandClient @Inject constructor(
    private val p2pClient: P2PClient
) {
    /**
     * 发送命令（通用方法）
     */
    suspend fun <T> invoke(
        method: String,
        params: Map<String, Any> = emptyMap(),
        timeout: Long = 30000
    ): Result<T> {
        return try {
            Timber.d("调用命令: $method")
            p2pClient.sendCommand(method, params, timeout)
        } catch (e: CommandCancelledException) {
            Timber.w("命令已取消: $method - ${e.message}")
            Result.failure(e)
        } catch (e: Exception) {
            Timber.e(e, "命令调用失败: $method")
            Result.failure(e)
        }
    }

    /**
     * 发送命令（带自动重试）
     * 注意：被取消的命令不会重试
     */
    suspend fun <T> invokeWithRetry(
        method: String,
        params: Map<String, Any> = emptyMap(),
        maxRetries: Int = 3,
        retryDelay: Long = 1000
    ): Result<T> {
        var lastError: Exception? = null

        repeat(maxRetries) { attempt ->
            val result = invoke<T>(method, params)

            if (result.isSuccess) {
                return result
            }

            lastError = result.exceptionOrNull() as? Exception

            // 如果是取消异常，不重试
            if (lastError is CommandCancelledException) {
                Timber.w("命令被取消，不重试: $method")
                return Result.failure(lastError ?: Exception("Command cancelled"))
            }

            if (attempt < maxRetries - 1) {
                Timber.w("命令失败，${retryDelay}ms 后重试 (${attempt + 1}/$maxRetries)")
                kotlinx.coroutines.delay(retryDelay)
            }
        }

        return Result.failure(lastError ?: Exception("Unknown error"))
    }

    /**
     * 取消正在执行的命令
     *
     * @param commandId 命令 ID
     * @param reason 取消原因
     */
    suspend fun cancelCommand(commandId: String, reason: String = "Cancelled by user"): Result<Unit> {
        return try {
            Timber.d("取消命令: $commandId")
            p2pClient.cancelCommand(commandId, reason)
        } catch (e: Exception) {
            Timber.e(e, "取消命令失败: $commandId")
            Result.failure(e)
        }
    }

    /**
     * 获取当前待处理的命令列表
     */
    fun getPendingCommands(): List<PendingCommandInfo> {
        return p2pClient.getPendingCommands()
    }

    /**
     * 取消所有待处理的命令
     */
    suspend fun cancelAllPendingCommands(reason: String = "Batch cancel"): Int {
        val pendingCommands = getPendingCommands()
        var cancelledCount = 0

        for (cmd in pendingCommands) {
            val result = cancelCommand(cmd.requestId, reason)
            if (result.isSuccess) {
                cancelledCount++
            }
        }

        Timber.i("批量取消命令: $cancelledCount/${pendingCommands.size}")
        return cancelledCount
    }
}

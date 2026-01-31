package com.chainlesschain.android.remote.client

import com.chainlesschain.android.remote.p2p.P2PClient
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
        } catch (e: Exception) {
            Timber.e(e, "命令调用失败: $method")
            Result.failure(e)
        }
    }

    /**
     * 发送命令（带自动重试）
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

            if (attempt < maxRetries - 1) {
                Timber.w("命令失败，${retryDelay}ms 后重试 (${attempt + 1}/$maxRetries)")
                kotlinx.coroutines.delay(retryDelay)
            }
        }

        return Result.failure(lastError ?: Exception("Unknown error"))
    }
}

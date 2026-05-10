package com.chainlesschain.android.remote.client

import com.chainlesschain.android.remote.p2p.CommandCancelledException
import com.chainlesschain.android.remote.p2p.P2PClient
import com.chainlesschain.android.remote.p2p.PendingCommandInfo
import com.google.gson.reflect.TypeToken
import timber.log.Timber
import java.lang.reflect.Type
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 远程命令客户端
 *
 * 提供类型安全的命令 API 封装。
 *
 * Phase 3d v1.3 fix (2026-05-10): invoke<T> 改为 inline reified，捕获调用点 T
 * 通过 Gson TypeToken 传给 P2PClient.sendCommand(typeOf=...)，避免 erased T
 * 直接 cast LinkedHashMap → 业务 data class 时的 ClassCastException。
 *
 * 之前 invoke 是 `<T>` 走 P2PClient.sendCommand 的非 typed overload (line 331)
 * 直接 `response.result as T`，T 编译期擦除，runtime 拿到 LinkedHashMap 但
 * 类型签名是 ModelsResponse，调用方 `.models` 立刻闪退。
 */
@Singleton
class RemoteCommandClient @Inject constructor(
    @PublishedApi internal val p2pClient: P2PClient
) {
    /**
     * 发送命令（通用方法）。inline + reified T 让 `T::class.java` 在调用点
     * 拿到具体 Class，把 typed deserialize 委托给 P2PClient.sendCommand 的
     * typed overload (走 Gson roundtrip)。
     *
     * 用 `T::class.java` 而不是 `object : TypeToken<T>(){}.type` —— 后者在
     * suspend inline 上下文中 reify 不稳，实测 v1.3 第一版栽过：返回 LinkedHashMap
     * 直接 cast 业务 data class 闪退。所有调用点目前都是 non-generic data class，
     * 用 Class 足够。后续要 List<Foo> 之类泛型再加 typed overload。
     */
    suspend inline fun <reified T : Any> invoke(
        method: String,
        params: Map<String, Any> = emptyMap(),
        timeout: Long = 30000
    ): Result<T> {
        return invokeTyped(method, params, timeout, T::class.java)
    }

    @PublishedApi
    internal suspend fun <T> invokeTyped(
        method: String,
        params: Map<String, Any>,
        timeout: Long,
        type: Type
    ): Result<T> {
        return try {
            Timber.d("调用命令: $method")
            p2pClient.sendCommand(method, params, timeout, type)
        } catch (e: CommandCancelledException) {
            Timber.w("命令已取消: $method - ${e.message}")
            Result.failure(e)
        } catch (e: Exception) {
            Timber.e(e, "命令调用失败: $method")
            Result.failure(e)
        }
    }

    /**
     * 发送命令（带自动重试）。同样 inline reified 透传 T。
     * 注意：被取消的命令不会重试。
     */
    suspend inline fun <reified T : Any> invokeWithRetry(
        method: String,
        params: Map<String, Any> = emptyMap(),
        maxRetries: Int = 3,
        retryDelay: Long = 1000
    ): Result<T> {
        var lastError: Exception? = null
        val type: Type = T::class.java

        repeat(maxRetries) { attempt ->
            val result = invokeTyped<T>(method, params, 30000, type)

            if (result.isSuccess) {
                return result
            }

            lastError = result.exceptionOrNull() as? Exception

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

package com.chainlesschain.android.remote.client

import com.chainlesschain.android.core.p2p.pairing.PairedPeersStore
import com.chainlesschain.android.remote.data.CommandRequest
import com.chainlesschain.android.remote.offline.OfflineCommandQueue
import com.chainlesschain.android.remote.p2p.CommandCancelledException
import com.chainlesschain.android.remote.p2p.P2PClient
import com.chainlesschain.android.remote.p2p.PendingCommandInfo
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import timber.log.Timber
import java.lang.reflect.Type
import java.util.UUID
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
    @PublishedApi internal val p2pClient: P2PClient,
    @PublishedApi internal val offlineCommandQueue: OfflineCommandQueue,
    @PublishedApi internal val signalingRpc: SignalingRpcClient,
    @PublishedApi internal val pairedPeersStore: PairedPeersStore,
) {
    @PublishedApi
    internal val gson: Gson = Gson()

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
            // Plan C 路径下 P2PClient.connectionState 默认 DISCONNECTED（没人调
            // P2PClient.connect()），sendCommand 第一行就 "Not connected" 返回。
            // 改走 SignalingRpcClient（terminal 验证过的 DC fast-path + signaling
            // fallback），pcPeerId 从 PairedPeersStore 取已配对桌面 firstOrNull。
            // 多桌面场景下后续可让 caller 显式传 pcPeerId。
            val pcPeerId = pairedPeersStore.devices.value.firstOrNull()?.pcPeerId
            if (pcPeerId == null) {
                Timber.w("invokeTyped: 无已配对桌面，method=$method 拒绝")
                return Result.failure(Exception("无已配对桌面"))
            }
            val nonNullParams: Map<String, Any?> = params
            val raw = signalingRpc.invoke(pcPeerId, method, nonNullParams, timeout)
                .getOrElse { return Result.failure(it) }
            // SignalingRpcClient.invoke 已经把响应里的 result 字段抽出来返回（标量
            // 会包成 {"value": ...}），失败会 Result.failure。这里把 JSONObject 通过
            // Gson roundtrip 转 T。注意 T 可能是 JSONObject 本身或 String。
            @Suppress("UNCHECKED_CAST")
            val converted: T = when {
                type === org.json.JSONObject::class.java -> raw as T
                type === String::class.java -> raw.toString() as T
                else -> {
                    val json = raw.toString()
                    gson.fromJson<T>(json, type)
                }
            }
            Result.success(converted)
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
     * v1.1 issue #19 OfflineQueue：peer 离线时 enqueue，在线时正常 invoke。
     *
     * 决策语义：
     *  - peer 已连接 → 委托给 [invoke]（typed deserialize 走 inline reified T 路径）
     *  - peer 未连接 → 不立即 fail，而是构造 [CommandRequest] 入队 [OfflineCommandQueue]，
     *    返回 `Result.failure(OfflineQueuedException(commandId))`。调用方语义上知道命令
     *    已被记下，恢复连接后由 [OfflineCommandQueue.dequeueAndSend] 自动重发。
     *  - peer 未连接 + 入队失败 → `Result.failure(<storage error>)`
     *
     * 用法（fire-and-forget 类）：
     * ```
     * val r = client.invokeOrEnqueue<Any>("notification.markRead", mapOf("id" to id))
     * if (r.exceptionOrNull() is OfflineQueuedException) showToast("已离线缓存，恢复后重发")
     * ```
     *
     * 不适合需要立即返回数据的同步场景（chat/search 等）— 那些 caller 应直接调 [invoke]
     * 让在线检查/失败立即冒上来。
     */
    suspend inline fun <reified T : Any> invokeOrEnqueue(
        method: String,
        params: Map<String, Any> = emptyMap(),
        timeout: Long = 30000,
    ): Result<T> {
        return invokeOrEnqueueTyped(method, params, timeout, T::class.java)
    }

    @PublishedApi
    internal suspend fun <T> invokeOrEnqueueTyped(
        method: String,
        params: Map<String, Any>,
        timeout: Long,
        type: Type,
    ): Result<T> {
        // v1.1 W2.4: 多 peer 检测用 connectedPeers Map 替代单 peer null check。
        // peers.isEmpty() == true → 所有 peer 都掉线，触发 enqueue。
        if (p2pClient.connectedPeers.value.isEmpty()) {
            val id = UUID.randomUUID().toString()
            val request = CommandRequest(id = id, method = method, params = params, auth = null)
            Timber.d("invokeOrEnqueue: no peers connected, enqueueing %s as %s", method, id)
            return offlineCommandQueue.enqueue(request).fold(
                onSuccess = { Result.failure(OfflineQueuedException(id, method)) },
                onFailure = { Result.failure(it) },
            )
        }
        return invokeTyped(method, params, timeout, type)
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

/**
 * v1.1 OfflineQueue：[RemoteCommandClient.invokeOrEnqueue] 在 peer 离线 + 成功入队时
 * 抛出此 exception 通过 [Result.failure] 返回。调用方通过 `is OfflineQueuedException`
 * 判断"已被缓存等待重发"语义，区别于真正的网络/桌面错误。
 *
 * @property commandId 入队命令的 UUID。可用于后续 status 查询 / 取消。
 * @property method 入队的 RPC method 名（debug 用）。
 */
class OfflineQueuedException(
    val commandId: String,
    val method: String,
) : Exception("OfflineQueued: $method (id=$commandId)")

package com.chainlesschain.android.remote.client

import com.chainlesschain.android.remote.data.StreamChunkMessage
import com.chainlesschain.android.remote.data.StreamEndMessage
import com.chainlesschain.android.remote.data.StreamStartMessage
import com.chainlesschain.android.remote.p2p.P2PClient
import com.chainlesschain.android.remote.p2p.StreamState
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.takeWhile
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 流式命令客户端
 *
 * 提供流式响应的高级 API 封装，支持 AI 聊天流、文件传输等场景
 */
@Singleton
class StreamingCommandClient @Inject constructor(
    private val p2pClient: P2PClient,
    private val commandClient: RemoteCommandClient
) {
    /**
     * 启动流式命令
     *
     * @param method 命令方法名
     * @param params 命令参数
     * @return 流式响应结果，包含 streamId 和数据流
     */
    suspend fun <T> startStream(
        method: String,
        params: Map<String, Any> = emptyMap()
    ): Result<StreamSession<T>> {
        return try {
            // 发送命令启动流
            val result = commandClient.invoke<Map<String, Any>>(method, params)

            if (result.isFailure) {
                return Result.failure(result.exceptionOrNull() ?: Exception("Failed to start stream"))
            }

            val response = result.getOrThrow()
            val streamId = response["streamId"] as? String
                ?: return Result.failure(Exception("No streamId in response"))

            Timber.d("Stream started: $streamId for method $method")

            Result.success(StreamSession(
                streamId = streamId,
                method = method,
                p2pClient = p2pClient
            ))
        } catch (e: Exception) {
            Timber.e(e, "Failed to start stream: $method")
            Result.failure(e)
        }
    }

    /**
     * AI 聊天流式响应
     */
    suspend fun chatStream(
        message: String,
        conversationId: String? = null,
        model: String? = null,
        systemPrompt: String? = null
    ): Result<StreamSession<String>> {
        val params = mutableMapOf<String, Any>(
            "message" to message,
            "stream" to true
        )
        conversationId?.let { params["conversationId"] = it }
        model?.let { params["model"] = it }
        systemPrompt?.let { params["systemPrompt"] = it }

        return startStream("ai.chatStream", params)
    }

    /**
     * 文件下载流
     */
    suspend fun downloadFileStream(
        path: String,
        chunkSize: Int = 65536
    ): Result<StreamSession<ByteArray>> {
        val params = mapOf(
            "path" to path,
            "chunkSize" to chunkSize,
            "stream" to true
        )
        return startStream("file.downloadStream", params)
    }

    /**
     * 获取活跃流列表
     */
    fun getActiveStreams(): List<StreamState> {
        return p2pClient.getActiveStreams()
    }

    /**
     * 取消流
     */
    suspend fun cancelStream(streamId: String): Result<Unit> {
        return p2pClient.cancelStream(streamId)
    }

    /**
     * 取消所有活跃流
     */
    suspend fun cancelAllStreams(): Int {
        val streams = getActiveStreams()
        var cancelledCount = 0

        for (stream in streams) {
            val result = cancelStream(stream.streamId)
            if (result.isSuccess) {
                cancelledCount++
            }
        }

        Timber.i("Cancelled $cancelledCount/${streams.size} streams")
        return cancelledCount
    }
}

/**
 * 流会话
 *
 * 代表一个活跃的流式响应会话
 */
class StreamSession<T>(
    val streamId: String,
    val method: String,
    private val p2pClient: P2PClient
) {
    /**
     * 流开始事件
     */
    val startEvents: Flow<StreamStartMessage> = p2pClient.streamStart
        .filter { it.streamId == streamId }

    /**
     * 流数据块
     */
    val chunks: Flow<StreamChunkMessage> = p2pClient.streamChunks
        .filter { it.streamId == streamId }

    /**
     * 流结束事件
     */
    val endEvents: Flow<StreamEndMessage> = p2pClient.streamEnd
        .filter { it.streamId == streamId }

    /**
     * 获取数据块流（自动在流结束时停止）
     */
    @Suppress("UNCHECKED_CAST")
    fun dataFlow(): Flow<T> = chunks
        .takeWhile { !it.isLast }
        .map { it.data as T }

    /**
     * 收集所有数据块直到流结束
     */
    suspend fun collectAll(): Result<List<T>> {
        return try {
            val results = mutableListOf<T>()
            chunks.collect { chunk ->
                @Suppress("UNCHECKED_CAST")
                results.add(chunk.data as T)
                if (chunk.isLast) {
                    return@collect
                }
            }
            Result.success(results)
        } catch (e: Exception) {
            Timber.e(e, "Failed to collect stream data: $streamId")
            Result.failure(e)
        }
    }

    /**
     * 收集所有字符串数据块并拼接
     */
    suspend fun collectAsString(): Result<String> {
        return try {
            val builder = StringBuilder()
            chunks.collect { chunk ->
                val data = chunk.data
                when (data) {
                    is String -> builder.append(data)
                    is Map<*, *> -> {
                        // AI 聊天响应通常是 { "text": "..." } 格式
                        val text = data["text"] as? String
                            ?: data["content"] as? String
                            ?: data["chunk"] as? String
                            ?: data.toString()
                        builder.append(text)
                    }
                    else -> builder.append(data.toString())
                }
                if (chunk.isLast) {
                    return@collect
                }
            }
            Result.success(builder.toString())
        } catch (e: Exception) {
            Timber.e(e, "Failed to collect stream as string: $streamId")
            Result.failure(e)
        }
    }

    /**
     * 取消流
     */
    suspend fun cancel(): Result<Unit> {
        return p2pClient.cancelStream(streamId)
    }

    /**
     * 获取流状态
     */
    fun getState(): StreamState? {
        return p2pClient.getActiveStreams().find { it.streamId == streamId }
    }

    /**
     * 检查流是否仍然活跃
     */
    fun isActive(): Boolean {
        return getState() != null
    }
}

/**
 * 流式响应构建器
 *
 * 用于构建复杂的流式请求
 */
class StreamRequestBuilder(
    private val client: StreamingCommandClient,
    private val method: String
) {
    private val params = mutableMapOf<String, Any>()

    fun param(key: String, value: Any): StreamRequestBuilder {
        params[key] = value
        return this
    }

    fun params(vararg pairs: Pair<String, Any>): StreamRequestBuilder {
        params.putAll(pairs)
        return this
    }

    suspend fun <T> execute(): Result<StreamSession<T>> {
        return client.startStream(method, params)
    }
}

/**
 * 扩展函数：创建流式请求构建器
 */
fun StreamingCommandClient.stream(method: String): StreamRequestBuilder {
    return StreamRequestBuilder(this, method)
}

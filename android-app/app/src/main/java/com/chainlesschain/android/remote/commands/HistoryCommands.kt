package com.chainlesschain.android.remote.commands

import com.chainlesschain.android.remote.client.RemoteCommandClient
import kotlinx.serialization.Serializable
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 命令历史 API
 *
 * 提供类型安全的命令历史相关命令
 */
@Singleton
class HistoryCommands @Inject constructor(
    private val client: RemoteCommandClient
) {
    /**
     * 获取命令历史
     *
     * @param limit 返回数量限制
     * @param offset 分页偏移量
     * @param method 方法名过滤
     * @param startTime 开始时间戳
     * @param endTime 结束时间戳
     */
    suspend fun getHistory(
        limit: Int = 50,
        offset: Int = 0,
        method: String? = null,
        startTime: Long? = null,
        endTime: Long? = null
    ): Result<CommandHistoryResponse> {
        val params = mutableMapOf<String, Any>(
            "limit" to limit,
            "offset" to offset
        )
        method?.let { params["method"] = it }
        startTime?.let { params["startTime"] = it }
        endTime?.let { params["endTime"] = it }

        return client.invoke("history.getHistory", params)
    }

    /**
     * 搜索命令历史
     *
     * @param query 搜索关键词
     * @param limit 返回数量限制
     */
    suspend fun search(
        query: String,
        limit: Int = 20
    ): Result<CommandHistoryResponse> {
        val params = mapOf(
            "query" to query,
            "limit" to limit
        )
        return client.invoke("history.search", params)
    }

    /**
     * 获取命令详情
     *
     * @param commandId 命令 ID
     */
    suspend fun getCommand(commandId: String): Result<CommandDetailResponse> {
        val params = mapOf("commandId" to commandId)
        return client.invoke("history.getCommand", params)
    }

    /**
     * 获取命令统计
     *
     * @param days 统计天数
     */
    suspend fun getStats(days: Int = 7): Result<CommandStatsResponse> {
        val params = mapOf("days" to days)
        return client.invoke("history.getStats", params)
    }

    /**
     * 清除命令历史
     *
     * @param before 清除此时间戳之前的记录
     * @param method 只清除特定方法的记录
     */
    suspend fun clearHistory(
        before: Long? = null,
        method: String? = null
    ): Result<ClearHistoryResponse> {
        val params = mutableMapOf<String, Any>()
        before?.let { params["before"] = it }
        method?.let { params["method"] = it }

        return client.invoke("history.clearHistory", params)
    }

    /**
     * 重新执行命令
     *
     * @param commandId 命令 ID
     */
    suspend fun replay(commandId: String): Result<ReplayResponse> {
        val params = mapOf("commandId" to commandId)
        return client.invoke("history.replay", params)
    }

    /**
     * 获取常用命令
     *
     * @param limit 返回数量限制
     */
    suspend fun getFrequent(limit: Int = 10): Result<FrequentCommandsResponse> {
        val params = mapOf("limit" to limit)
        return client.invoke("history.getFrequent", params)
    }
}

// 响应数据类

@Serializable
data class CommandHistoryResponse(
    val success: Boolean,
    val commands: List<CommandRecord>,
    val total: Int,
    val limit: Int,
    val offset: Int
)

@Serializable
data class CommandRecord(
    val id: String,
    val method: String,
    val params: Map<String, String>? = null,
    val success: Boolean,
    val duration: Long,
    val timestamp: Long,
    val deviceDid: String? = null,
    val error: String? = null
)

@Serializable
data class CommandDetailResponse(
    val success: Boolean,
    val command: CommandRecordDetail
)

@Serializable
data class CommandRecordDetail(
    val id: String,
    val method: String,
    val params: Map<String, String>? = null,
    val result: Map<String, String>? = null,
    val success: Boolean,
    val duration: Long,
    val timestamp: Long,
    val deviceDid: String? = null,
    val deviceName: String? = null,
    val error: String? = null
)

@Serializable
data class CommandStatsResponse(
    val success: Boolean,
    val stats: CommandStats
)

@Serializable
data class CommandStats(
    val totalCommands: Int,
    val successCommands: Int,
    val failedCommands: Int,
    val successRate: Double,
    val avgDuration: Double,
    val byMethod: Map<String, Int>,
    val byDay: List<DailyStats>
)

@Serializable
data class DailyStats(
    val date: String,
    val total: Int,
    val success: Int,
    val failed: Int
)

@Serializable
data class ClearHistoryResponse(
    val success: Boolean,
    val deletedCount: Int,
    val message: String
)

@Serializable
data class ReplayResponse(
    val success: Boolean,
    val commandId: String,
    val result: Map<String, String>? = null,
    val error: String? = null
)

@Serializable
data class FrequentCommandsResponse(
    val success: Boolean,
    val commands: List<FrequentCommand>
)

@Serializable
data class FrequentCommand(
    val method: String,
    val count: Int,
    val lastUsed: Long,
    val avgDuration: Double
)

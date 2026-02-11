package com.chainlesschain.android.remote.commands

import com.chainlesschain.android.remote.client.RemoteCommandClient
import kotlinx.serialization.Serializable
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 进程管理命令 API
 *
 * 提供类型安全的进程管理相关命令
 */
@Singleton
class ProcessCommands @Inject constructor(
    private val client: RemoteCommandClient
) {
    /**
     * 列出进程
     *
     * @param sortBy 排序方式：cpu, memory, name, pid
     * @param limit 返回数量限制
     * @param offset 分页偏移量
     */
    suspend fun list(
        sortBy: String = "cpu",
        limit: Int = 50,
        offset: Int = 0
    ): Result<ProcessListResponse> {
        val params = mapOf(
            "sortBy" to sortBy,
            "limit" to limit,
            "offset" to offset
        )
        return client.invoke("process.list", params)
    }

    /**
     * 获取进程详情
     *
     * @param pid 进程 ID
     */
    suspend fun get(pid: Int): Result<ProcessDetailResponse> {
        val params = mapOf("pid" to pid)
        return client.invoke("process.get", params)
    }

    /**
     * 终止进程
     *
     * @param pid 进程 ID
     * @param signal 信号类型（默认 SIGTERM）
     * @param force 是否强制终止（使用 SIGKILL）
     */
    suspend fun kill(
        pid: Int,
        signal: String = "SIGTERM",
        force: Boolean = false
    ): Result<KillProcessResponse> {
        val params = mapOf(
            "pid" to pid,
            "signal" to signal,
            "force" to force
        )
        return client.invoke("process.kill", params)
    }

    /**
     * 启动进程
     *
     * @param command 命令
     * @param args 命令参数
     * @param cwd 工作目录
     * @param env 环境变量
     * @param detached 是否分离进程
     */
    suspend fun start(
        command: String,
        args: List<String> = emptyList(),
        cwd: String? = null,
        env: Map<String, String>? = null,
        detached: Boolean = true
    ): Result<StartProcessResponse> {
        val params = mutableMapOf<String, Any>(
            "command" to command,
            "args" to args,
            "detached" to detached
        )
        cwd?.let { params["cwd"] = it }
        env?.let { params["env"] = it }

        return client.invoke("process.start", params)
    }

    /**
     * 获取系统资源使用情况
     */
    suspend fun getResources(): Result<ResourcesResponse> {
        return client.invoke("process.getResources", emptyMap())
    }

    /**
     * 搜索进程
     *
     * @param query 搜索关键词
     * @param limit 返回数量限制
     */
    suspend fun search(
        query: String,
        limit: Int = 20
    ): Result<ProcessSearchResponse> {
        val params = mapOf(
            "query" to query,
            "limit" to limit
        )
        return client.invoke("process.search", params)
    }
}

// 响应数据类

@Serializable
data class ProcessListResponse(
    val success: Boolean,
    val processes: List<ProcessInfo>,
    val total: Int,
    val offset: Int,
    val limit: Int
)

@Serializable
data class ProcessInfo(
    val pid: Int,
    val name: String,
    val cpu: Double? = null,
    val memory: Long? = null,
    val memoryBytes: Long? = null,
    val memoryPercent: Double? = null,
    val user: String? = null,
    val command: String? = null,
    val vsz: Long? = null
)

@Serializable
data class ProcessDetailResponse(
    val success: Boolean,
    val process: ProcessDetail
)

@Serializable
data class ProcessDetail(
    val pid: Int,
    val name: String,
    val ppid: Int? = null,
    val user: String? = null,
    val cpu: Double? = null,
    val memoryPercent: Double? = null,
    val memory: Long? = null,
    val vsz: Long? = null,
    val rss: Long? = null,
    val status: String? = null,
    val startTime: String? = null,
    val cpuTime: String? = null,
    val command: String? = null,
    val executablePath: String? = null,
    val createdAt: String? = null
)

@Serializable
data class KillProcessResponse(
    val success: Boolean,
    val pid: Int,
    val message: String,
    val signal: String
)

@Serializable
data class StartProcessResponse(
    val success: Boolean,
    val pid: Int,
    val command: String,
    val args: List<String>,
    val message: String
)

@Serializable
data class ResourcesResponse(
    val success: Boolean,
    val resources: SystemResources
)

@Serializable
data class SystemResources(
    val cpu: CpuResources,
    val memory: MemoryResources,
    val loadAverage: LoadAverage,
    val uptime: Long,
    val platform: String,
    val arch: String
)

@Serializable
data class CpuResources(
    val usage: Double,
    val cores: Int,
    val model: String,
    val speed: Int
)

@Serializable
data class MemoryResources(
    val total: Double,
    val used: Double,
    val free: Double,
    val usagePercent: Double
)

@Serializable
data class LoadAverage(
    @kotlinx.serialization.SerialName("1min")
    val oneMin: Double,
    @kotlinx.serialization.SerialName("5min")
    val fiveMin: Double,
    @kotlinx.serialization.SerialName("15min")
    val fifteenMin: Double
)

@Serializable
data class ProcessSearchResponse(
    val success: Boolean,
    val processes: List<ProcessInfo>,
    val total: Int,
    val query: String
)

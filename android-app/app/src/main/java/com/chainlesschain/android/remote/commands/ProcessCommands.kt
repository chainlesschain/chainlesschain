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

    // ==================== 进程优先级 ====================

    /**
     * 设置进程优先级
     *
     * @param pid 进程 ID
     * @param priority 优先级 (-20 到 19，越小优先级越高)
     */
    suspend fun setPriority(
        pid: Int,
        priority: Int
    ): Result<SetPriorityResponse> {
        return client.invoke("process.setPriority", mapOf(
            "pid" to pid,
            "priority" to priority
        ))
    }

    /**
     * 获取进程优先级
     *
     * @param pid 进程 ID
     */
    suspend fun getPriority(pid: Int): Result<GetPriorityResponse> {
        return client.invoke("process.getPriority", mapOf("pid" to pid))
    }

    // ==================== 进程树 ====================

    /**
     * 获取进程树
     */
    suspend fun getTree(): Result<ProcessTreeResponse> {
        return client.invoke("process.getTree", emptyMap())
    }

    /**
     * 获取子进程
     *
     * @param pid 父进程 ID
     */
    suspend fun getChildren(pid: Int): Result<ProcessChildrenResponse> {
        return client.invoke("process.getChildren", mapOf("pid" to pid))
    }

    /**
     * 获取父进程
     *
     * @param pid 进程 ID
     */
    suspend fun getParent(pid: Int): Result<ProcessParentResponse> {
        return client.invoke("process.getParent", mapOf("pid" to pid))
    }

    /**
     * 终止进程树（包含所有子进程）
     *
     * @param pid 进程 ID
     * @param force 是否强制
     */
    suspend fun killTree(
        pid: Int,
        force: Boolean = false
    ): Result<KillTreeResponse> {
        return client.invoke("process.killTree", mapOf(
            "pid" to pid,
            "force" to force
        ))
    }

    // ==================== 进程监控 ====================

    /**
     * 开始监控进程
     *
     * @param pid 进程 ID
     * @param interval 监控间隔（毫秒）
     */
    suspend fun startMonitor(
        pid: Int,
        interval: Int = 1000
    ): Result<MonitorStartResponse> {
        return client.invoke("process.startMonitor", mapOf(
            "pid" to pid,
            "interval" to interval
        ))
    }

    /**
     * 停止监控进程
     *
     * @param monitorId 监控 ID
     */
    suspend fun stopMonitor(monitorId: String): Result<MonitorStopResponse> {
        return client.invoke("process.stopMonitor", mapOf("monitorId" to monitorId))
    }

    /**
     * 获取监控数据
     *
     * @param monitorId 监控 ID
     */
    suspend fun getMonitorData(monitorId: String): Result<MonitorDataResponse> {
        return client.invoke("process.getMonitorData", mapOf("monitorId" to monitorId))
    }

    /**
     * 获取进程历史统计
     *
     * @param pid 进程 ID
     * @param duration 时间范围（秒）
     */
    suspend fun getHistory(
        pid: Int,
        duration: Int = 60
    ): Result<ProcessHistoryResponse> {
        return client.invoke("process.getHistory", mapOf(
            "pid" to pid,
            "duration" to duration
        ))
    }

    // ==================== 进程信号 ====================

    /**
     * 发送信号
     *
     * @param pid 进程 ID
     * @param signal 信号（SIGTERM, SIGKILL, SIGHUP, SIGUSR1, etc.）
     */
    suspend fun sendSignal(
        pid: Int,
        signal: String
    ): Result<SignalResponse> {
        return client.invoke("process.sendSignal", mapOf(
            "pid" to pid,
            "signal" to signal
        ))
    }

    /**
     * 暂停进程
     *
     * @param pid 进程 ID
     */
    suspend fun suspend(pid: Int): Result<ProcessControlResponse> {
        return client.invoke("process.suspend", mapOf("pid" to pid))
    }

    /**
     * 恢复进程
     *
     * @param pid 进程 ID
     */
    suspend fun resume(pid: Int): Result<ProcessControlResponse> {
        return client.invoke("process.resume", mapOf("pid" to pid))
    }

    // ==================== 进程限制 ====================

    /**
     * 设置 CPU 限制
     *
     * @param pid 进程 ID
     * @param limit CPU 限制百分比 (0-100)
     */
    suspend fun setCpuLimit(
        pid: Int,
        limit: Int
    ): Result<SetLimitResponse> {
        return client.invoke("process.setCpuLimit", mapOf(
            "pid" to pid,
            "limit" to limit
        ))
    }

    /**
     * 设置内存限制
     *
     * @param pid 进程 ID
     * @param limitMb 内存限制（MB）
     */
    suspend fun setMemoryLimit(
        pid: Int,
        limitMb: Long
    ): Result<SetLimitResponse> {
        return client.invoke("process.setMemoryLimit", mapOf(
            "pid" to pid,
            "limitMb" to limitMb
        ))
    }

    /**
     * 获取进程限制
     *
     * @param pid 进程 ID
     */
    suspend fun getLimits(pid: Int): Result<ProcessLimitsResponse> {
        return client.invoke("process.getLimits", mapOf("pid" to pid))
    }

    // ==================== 进程分组 ====================

    /**
     * 按名称杀死进程
     *
     * @param name 进程名称
     * @param force 是否强制
     */
    suspend fun killByName(
        name: String,
        force: Boolean = false
    ): Result<KillByNameResponse> {
        return client.invoke("process.killByName", mapOf(
            "name" to name,
            "force" to force
        ))
    }

    /**
     * 获取进程端口
     *
     * @param pid 进程 ID
     */
    suspend fun getPorts(pid: Int): Result<ProcessPortsResponse> {
        return client.invoke("process.getPorts", mapOf("pid" to pid))
    }

    /**
     * 获取使用端口的进程
     *
     * @param port 端口号
     */
    suspend fun getByPort(port: Int): Result<ProcessByPortResponse> {
        return client.invoke("process.getByPort", mapOf("port" to port))
    }

    /**
     * 获取进程环境变量
     *
     * @param pid 进程 ID
     */
    suspend fun getEnvironment(pid: Int): Result<ProcessEnvironmentResponse> {
        return client.invoke("process.getEnvironment", mapOf("pid" to pid))
    }

    /**
     * 获取进程打开的文件
     *
     * @param pid 进程 ID
     */
    suspend fun getOpenFiles(pid: Int): Result<ProcessOpenFilesResponse> {
        return client.invoke("process.getOpenFiles", mapOf("pid" to pid))
    }

    /**
     * 获取 CPU 占用最高的进程
     *
     * @param limit 数量
     */
    suspend fun getTopCpu(limit: Int = 10): Result<TopProcessesResponse> {
        return client.invoke("process.getTopCpu", mapOf("limit" to limit))
    }

    /**
     * 获取内存占用最高的进程
     *
     * @param limit 数量
     */
    suspend fun getTopMemory(limit: Int = 10): Result<TopProcessesResponse> {
        return client.invoke("process.getTopMemory", mapOf("limit" to limit))
    }

    /**
     * 获取进程统计
     */
    suspend fun getStats(): Result<ProcessStatsResponse> {
        return client.invoke("process.getStats", emptyMap())
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
    val createdAt: String? = null,
    val threads: Int? = null
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

/**
 * 简化的资源使用情况（供 UI 层使用）
 */
@Serializable
data class ResourceUsage(
    val cpuUsage: Double = 0.0,
    val memoryUsage: Double = 0.0,
    val processCount: Int = 0
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

// ==================== 优先级响应 ====================

@Serializable
data class SetPriorityResponse(
    val success: Boolean,
    val pid: Int,
    val oldPriority: Int,
    val newPriority: Int,
    val message: String
)

@Serializable
data class GetPriorityResponse(
    val success: Boolean,
    val pid: Int,
    val priority: Int,
    val priorityClass: String? = null  // Windows: IDLE, NORMAL, HIGH, REALTIME
)

// ==================== 进程树响应 ====================

@Serializable
data class ProcessTreeResponse(
    val success: Boolean,
    val tree: List<ProcessTreeNode>,
    val totalProcesses: Int
)

@Serializable
data class ProcessTreeNode(
    val pid: Int,
    val name: String,
    val cpu: Double? = null,
    val memory: Long? = null,
    val children: List<ProcessTreeNode>
)

@Serializable
data class ProcessChildrenResponse(
    val success: Boolean,
    val pid: Int,
    val children: List<ProcessInfo>,
    val total: Int
)

@Serializable
data class ProcessParentResponse(
    val success: Boolean,
    val pid: Int,
    val parent: ProcessInfo? = null
)

@Serializable
data class KillTreeResponse(
    val success: Boolean,
    val pid: Int,
    val killedCount: Int,
    val killedPids: List<Int>,
    val message: String
)

// ==================== 监控响应 ====================

@Serializable
data class MonitorStartResponse(
    val success: Boolean,
    val monitorId: String,
    val pid: Int,
    val interval: Int,
    val message: String
)

@Serializable
data class MonitorStopResponse(
    val success: Boolean,
    val monitorId: String,
    val duration: Long,
    val dataPoints: Int
)

@Serializable
data class MonitorDataResponse(
    val success: Boolean,
    val monitorId: String,
    val pid: Int,
    val data: List<ProcessDataPoint>,
    val currentCpu: Double,
    val currentMemory: Long
)

@Serializable
data class ProcessDataPoint(
    val timestamp: Long,
    val cpu: Double,
    val memory: Long,
    val threads: Int? = null
)

@Serializable
data class ProcessHistoryResponse(
    val success: Boolean,
    val pid: Int,
    val history: List<ProcessDataPoint>,
    val avgCpu: Double,
    val avgMemory: Long,
    val peakCpu: Double,
    val peakMemory: Long
)

// ==================== 信号响应 ====================

@Serializable
data class SignalResponse(
    val success: Boolean,
    val pid: Int,
    val signal: String,
    val delivered: Boolean,
    val message: String
)

@Serializable
data class ProcessControlResponse(
    val success: Boolean,
    val pid: Int,
    val action: String,
    val status: String,
    val message: String
)

// ==================== 限制响应 ====================

@Serializable
data class SetLimitResponse(
    val success: Boolean,
    val pid: Int,
    val limitType: String,
    val limitValue: Long,
    val message: String
)

@Serializable
data class ProcessLimitsResponse(
    val success: Boolean,
    val pid: Int,
    val cpuLimit: Int? = null,
    val memoryLimit: Long? = null,
    val openFilesLimit: Int? = null,
    val threadsLimit: Int? = null
)

// ==================== 进程信息响应 ====================

@Serializable
data class KillByNameResponse(
    val success: Boolean,
    val name: String,
    val killedCount: Int,
    val killedPids: List<Int>,
    val message: String
)

@Serializable
data class ProcessPortsResponse(
    val success: Boolean,
    val pid: Int,
    val ports: List<ProcessPort>,
    val total: Int
)

@Serializable
data class ProcessPort(
    val port: Int,
    val protocol: String,
    val state: String,
    val localAddress: String,
    val remoteAddress: String? = null
)

@Serializable
data class ProcessByPortResponse(
    val success: Boolean,
    val port: Int,
    val process: ProcessInfo? = null
)

@Serializable
data class ProcessEnvironmentResponse(
    val success: Boolean,
    val pid: Int,
    val environment: Map<String, String>,
    val total: Int
)

@Serializable
data class ProcessOpenFilesResponse(
    val success: Boolean,
    val pid: Int,
    val files: List<OpenFile>,
    val total: Int
)

@Serializable
data class OpenFile(
    val fd: Int,
    val path: String,
    val type: String,  // "file", "socket", "pipe", etc.
    val mode: String? = null
)

@Serializable
data class TopProcessesResponse(
    val success: Boolean,
    val processes: List<ProcessInfo>,
    val sortBy: String,
    val total: Int
)

@Serializable
data class ProcessStatsResponse(
    val success: Boolean,
    val totalProcesses: Int,
    val runningProcesses: Int,
    val sleepingProcesses: Int,
    val stoppedProcesses: Int,
    val zombieProcesses: Int,
    val threads: Int,
    val cpuUsage: Double,
    val memoryUsage: Double
)

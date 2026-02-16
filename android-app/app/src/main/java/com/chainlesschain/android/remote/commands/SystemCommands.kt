package com.chainlesschain.android.remote.commands

import com.chainlesschain.android.remote.client.RemoteCommandClient
import kotlinx.serialization.Serializable
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 系统命令 API
 *
 * 提供类型安全的系统相关命令
 */
@Singleton
class SystemCommands @Inject constructor(
    private val client: RemoteCommandClient
) {
    /**
     * 获取系统状态
     */
    suspend fun getStatus(): Result<SystemStatus> {
        return client.invoke("system.getStatus", emptyMap())
    }

    /**
     * 获取系统信息
     */
    suspend fun getInfo(): Result<SystemInfo> {
        return client.invoke("system.getInfo", emptyMap())
    }

    /**
     * 截图
     */
    suspend fun screenshot(
        display: Int = 0,
        format: String = "png",
        quality: Int = 80
    ): Result<SystemScreenshotResponse> {
        val params = mapOf(
            "display" to display,
            "format" to format,
            "quality" to quality
        )

        return client.invoke("system.screenshot", params)
    }

    /**
     * 发送通知
     */
    suspend fun notify(
        title: String,
        body: String,
        urgency: NotificationUrgency = NotificationUrgency.NORMAL
    ): Result<NotifyResponse> {
        val params = mapOf(
            "title" to title,
            "body" to body,
            "urgency" to urgency.value
        )

        return client.invoke("system.notify", params)
    }

    /**
     * 执行 Shell 命令（需要高权限）
     */
    suspend fun execCommand(
        command: String,
        cwd: String? = null,
        timeout: Long = 30000
    ): Result<ExecCommandResponse> {
        val params = mutableMapOf<String, Any>(
            "command" to command,
            "timeout" to timeout
        )

        cwd?.let { params["cwd"] = it }

        return client.invoke("system.execCommand", params)
    }

    // ==================== 进程管理 ====================

    /**
     * 列出进程
     *
     * @param sortBy 排序字段 (cpu, memory, pid, name)
     * @param limit 最大数量
     * @param filter 过滤关键词
     */
    suspend fun listProcesses(
        sortBy: String = "cpu",
        limit: Int = 100,
        filter: String? = null
    ): Result<SystemProcessListResponse> {
        val params = mutableMapOf<String, Any>(
            "sortBy" to sortBy,
            "limit" to limit
        )
        filter?.let { params["filter"] = it }
        return client.invoke("system.listProcesses", params)
    }

    /**
     * 获取进程详情
     *
     * @param pid 进程 ID
     */
    suspend fun getProcessInfo(pid: Int): Result<SystemProcessInfoResponse> {
        return client.invoke("system.getProcessInfo", mapOf("pid" to pid))
    }

    /**
     * 杀死进程
     *
     * @param pid 进程 ID
     * @param force 是否强制
     */
    suspend fun killProcess(
        pid: Int,
        force: Boolean = false
    ): Result<ProcessKillResponse> {
        return client.invoke("system.killProcess", mapOf(
            "pid" to pid,
            "force" to force
        ))
    }

    /**
     * 按名称杀死进程
     *
     * @param name 进程名称
     * @param force 是否强制
     */
    suspend fun killProcessByName(
        name: String,
        force: Boolean = false
    ): Result<ProcessKillByNameResponse> {
        return client.invoke("system.killProcessByName", mapOf(
            "name" to name,
            "force" to force
        ))
    }

    /**
     * 启动进程
     *
     * @param command 命令
     * @param args 参数列表
     * @param cwd 工作目录
     * @param env 环境变量
     * @param detached 是否后台运行
     */
    suspend fun startProcess(
        command: String,
        args: List<String> = emptyList(),
        cwd: String? = null,
        env: Map<String, String>? = null,
        detached: Boolean = false
    ): Result<ProcessStartResponse> {
        val params = mutableMapOf<String, Any>(
            "command" to command,
            "args" to args,
            "detached" to detached
        )
        cwd?.let { params["cwd"] = it }
        env?.let { params["env"] = it }
        return client.invoke("system.startProcess", params)
    }

    // ==================== 网络信息 ====================

    /**
     * 获取网络接口列表
     */
    suspend fun getNetworkInterfaces(): Result<NetworkInterfacesResponse> {
        return client.invoke("system.getNetworkInterfaces", emptyMap())
    }

    /**
     * 获取网络连接列表
     *
     * @param state 连接状态过滤 (all, established, listening, etc.)
     * @param protocol 协议过滤 (tcp, udp, all)
     */
    suspend fun getNetworkConnections(
        state: String = "all",
        protocol: String = "all"
    ): Result<NetworkConnectionsResponse> {
        return client.invoke("system.getNetworkConnections", mapOf(
            "state" to state,
            "protocol" to protocol
        ))
    }

    /**
     * 获取网络带宽统计
     *
     * @param interfaceName 接口名称（可选）
     */
    suspend fun getNetworkStats(interfaceName: String? = null): Result<NetworkStatsResponse> {
        val params = mutableMapOf<String, Any>()
        interfaceName?.let { params["interface"] = it }
        return client.invoke("system.getNetworkStats", params)
    }

    /**
     * Ping 测试
     *
     * @param host 目标主机
     * @param count 次数
     * @param timeout 超时（毫秒）
     */
    suspend fun ping(
        host: String,
        count: Int = 4,
        timeout: Int = 5000
    ): Result<PingResponse> {
        return client.invoke("system.ping", mapOf(
            "host" to host,
            "count" to count,
            "timeout" to timeout
        ))
    }

    /**
     * DNS 查询
     *
     * @param hostname 域名
     * @param type 记录类型 (A, AAAA, MX, TXT, etc.)
     */
    suspend fun dnsLookup(
        hostname: String,
        type: String = "A"
    ): Result<DnsLookupResponse> {
        return client.invoke("system.dnsLookup", mapOf(
            "hostname" to hostname,
            "type" to type
        ))
    }

    // ==================== 磁盘信息 ====================

    /**
     * 获取磁盘列表
     */
    suspend fun getDisks(): Result<DisksResponse> {
        return client.invoke("system.getDisks", emptyMap())
    }

    /**
     * 获取磁盘使用情况
     *
     * @param path 路径
     */
    suspend fun getDiskUsage(path: String = "/"): Result<DiskUsageResponse> {
        return client.invoke("system.getDiskUsage", mapOf("path" to path))
    }

    /**
     * 获取磁盘 I/O 统计
     */
    suspend fun getDiskIO(): Result<DiskIOResponse> {
        return client.invoke("system.getDiskIO", emptyMap())
    }

    // ==================== 服务管理 ====================

    /**
     * 列出系统服务
     *
     * @param status 状态过滤 (all, running, stopped)
     */
    suspend fun listServices(status: String = "all"): Result<ServicesListResponse> {
        return client.invoke("system.listServices", mapOf("status" to status))
    }

    /**
     * 获取服务状态
     *
     * @param serviceName 服务名称
     */
    suspend fun getServiceStatus(serviceName: String): Result<ServiceStatusResponse> {
        return client.invoke("system.getServiceStatus", mapOf("serviceName" to serviceName))
    }

    /**
     * 启动服务
     *
     * @param serviceName 服务名称
     */
    suspend fun startService(serviceName: String): Result<ServiceOperationResponse> {
        return client.invoke("system.startService", mapOf("serviceName" to serviceName))
    }

    /**
     * 停止服务
     *
     * @param serviceName 服务名称
     */
    suspend fun stopService(serviceName: String): Result<ServiceOperationResponse> {
        return client.invoke("system.stopService", mapOf("serviceName" to serviceName))
    }

    /**
     * 重启服务
     *
     * @param serviceName 服务名称
     */
    suspend fun restartService(serviceName: String): Result<ServiceOperationResponse> {
        return client.invoke("system.restartService", mapOf("serviceName" to serviceName))
    }

    // ==================== 环境变量 ====================

    /**
     * 获取环境变量
     *
     * @param name 变量名（可选，不传返回全部）
     */
    suspend fun getEnv(name: String? = null): Result<EnvResponse> {
        val params = mutableMapOf<String, Any>()
        name?.let { params["name"] = it }
        return client.invoke("system.getEnv", params)
    }

    /**
     * 设置环境变量
     *
     * @param name 变量名
     * @param value 变量值
     * @param persistent 是否持久化
     */
    suspend fun setEnv(
        name: String,
        value: String,
        persistent: Boolean = false
    ): Result<EnvSetResponse> {
        return client.invoke("system.setEnv", mapOf(
            "name" to name,
            "value" to value,
            "persistent" to persistent
        ))
    }

    // ==================== 用户信息 ====================

    /**
     * 获取当前用户信息
     */
    suspend fun getCurrentUser(): Result<UserInfoResponse> {
        return client.invoke("system.getCurrentUser", emptyMap())
    }

    /**
     * 列出系统用户
     */
    suspend fun listUsers(): Result<UsersListResponse> {
        return client.invoke("system.listUsers", emptyMap())
    }

    /**
     * 获取登录用户列表
     */
    suspend fun getLoggedInUsers(): Result<LoggedInUsersResponse> {
        return client.invoke("system.getLoggedInUsers", emptyMap())
    }

    // ==================== 性能监控 ====================

    /**
     * 获取 CPU 使用历史
     *
     * @param duration 时间范围（秒）
     * @param interval 采样间隔（秒）
     */
    suspend fun getCpuHistory(
        duration: Int = 60,
        interval: Int = 1
    ): Result<CpuHistoryResponse> {
        return client.invoke("system.getCpuHistory", mapOf(
            "duration" to duration,
            "interval" to interval
        ))
    }

    /**
     * 获取内存使用历史
     *
     * @param duration 时间范围（秒）
     * @param interval 采样间隔（秒）
     */
    suspend fun getMemoryHistory(
        duration: Int = 60,
        interval: Int = 1
    ): Result<MemoryHistoryResponse> {
        return client.invoke("system.getMemoryHistory", mapOf(
            "duration" to duration,
            "interval" to interval
        ))
    }

    /**
     * 获取系统负载
     */
    suspend fun getLoadAverage(): Result<LoadAverageResponse> {
        return client.invoke("system.getLoadAverage", emptyMap())
    }

    /**
     * 获取电池状态
     */
    suspend fun getBatteryStatus(): Result<BatteryStatusResponse> {
        return client.invoke("system.getBatteryStatus", emptyMap())
    }

    /**
     * 获取温度传感器数据
     */
    suspend fun getTemperatures(): Result<TemperaturesResponse> {
        return client.invoke("system.getTemperatures", emptyMap())
    }

    // ==================== 已安装软件 ====================

    /**
     * 列出已安装软件
     *
     * @param filter 过滤关键词
     * @param limit 最大数量
     */
    suspend fun listInstalledApps(
        filter: String? = null,
        limit: Int = 500
    ): Result<InstalledAppsResponse> {
        val params = mutableMapOf<String, Any>("limit" to limit)
        filter?.let { params["filter"] = it }
        return client.invoke("system.listInstalledApps", params)
    }

    /**
     * 获取应用信息
     *
     * @param appName 应用名称
     */
    suspend fun getAppInfo(appName: String): Result<AppInfoResponse> {
        return client.invoke("system.getAppInfo", mapOf("appName" to appName))
    }

    // ==================== 启动项管理 ====================

    /**
     * 列出启动项
     */
    suspend fun listStartupItems(): Result<StartupItemsResponse> {
        return client.invoke("system.listStartupItems", emptyMap())
    }

    /**
     * 启用启动项
     *
     * @param itemId 启动项 ID
     */
    suspend fun enableStartupItem(itemId: String): Result<StartupItemOperationResponse> {
        return client.invoke("system.enableStartupItem", mapOf("itemId" to itemId))
    }

    /**
     * 禁用启动项
     *
     * @param itemId 启动项 ID
     */
    suspend fun disableStartupItem(itemId: String): Result<StartupItemOperationResponse> {
        return client.invoke("system.disableStartupItem", mapOf("itemId" to itemId))
    }

    // ==================== 定时任务 ====================

    /**
     * 列出定时任务
     */
    suspend fun listScheduledTasks(): Result<ScheduledTasksResponse> {
        return client.invoke("system.listScheduledTasks", emptyMap())
    }

    /**
     * 创建定时任务
     *
     * @param name 任务名称
     * @param command 命令
     * @param schedule Cron 表达式
     * @param enabled 是否启用
     */
    suspend fun createScheduledTask(
        name: String,
        command: String,
        schedule: String,
        enabled: Boolean = true
    ): Result<ScheduledTaskResponse> {
        return client.invoke("system.createScheduledTask", mapOf(
            "name" to name,
            "command" to command,
            "schedule" to schedule,
            "enabled" to enabled
        ))
    }

    /**
     * 删除定时任务
     *
     * @param taskId 任务 ID
     */
    suspend fun deleteScheduledTask(taskId: String): Result<ScheduledTaskOperationResponse> {
        return client.invoke("system.deleteScheduledTask", mapOf("taskId" to taskId))
    }

    /**
     * 运行定时任务
     *
     * @param taskId 任务 ID
     */
    suspend fun runScheduledTask(taskId: String): Result<ScheduledTaskOperationResponse> {
        return client.invoke("system.runScheduledTask", mapOf("taskId" to taskId))
    }

    // ==================== 系统日志 ====================

    /**
     * 获取系统日志
     *
     * @param source 日志来源 (system, application, security)
     * @param level 日志级别 (info, warning, error, all)
     * @param limit 最大数量
     * @param since 起始时间戳
     */
    suspend fun getLogs(
        source: String = "system",
        level: String = "all",
        limit: Int = 100,
        since: Long? = null
    ): Result<SystemLogsResponse> {
        val params = mutableMapOf<String, Any>(
            "source" to source,
            "level" to level,
            "limit" to limit
        )
        since?.let { params["since"] = it }
        return client.invoke("system.getLogs", params)
    }

    /**
     * 清除系统日志
     *
     * @param source 日志来源
     * @param olderThan 清除多少天之前的日志
     */
    suspend fun clearLogs(
        source: String,
        olderThan: Int? = null
    ): Result<ClearLogsResponse> {
        val params = mutableMapOf<String, Any>("source" to source)
        olderThan?.let { params["olderThan"] = it }
        return client.invoke("system.clearLogs", params)
    }

    // ==================== 时区和时间 ====================

    /**
     * 获取系统时间
     */
    suspend fun getTime(): Result<SystemTimeResponse> {
        return client.invoke("system.getTime", emptyMap())
    }

    /**
     * 设置系统时间
     *
     * @param timestamp 时间戳（毫秒）
     */
    suspend fun setTime(timestamp: Long): Result<SetTimeResponse> {
        return client.invoke("system.setTime", mapOf("timestamp" to timestamp))
    }

    /**
     * 获取时区列表
     */
    suspend fun getTimezones(): Result<TimezonesResponse> {
        return client.invoke("system.getTimezones", emptyMap())
    }

    /**
     * 设置时区
     *
     * @param timezone 时区名称
     */
    suspend fun setTimezone(timezone: String): Result<SetTimezoneResponse> {
        return client.invoke("system.setTimezone", mapOf("timezone" to timezone))
    }

    /**
     * NTP 时间同步
     *
     * @param server NTP 服务器（可选）
     */
    suspend fun syncTime(server: String? = null): Result<SyncTimeResponse> {
        val params = mutableMapOf<String, Any>()
        server?.let { params["server"] = it }
        return client.invoke("system.syncTime", params)
    }
}

/**
 * 系统状态
 */
@Serializable
data class SystemStatus(
    val cpu: CPUStatus,
    val memory: MemoryStatus,
    val system: SystemBasicInfo,
    val timestamp: Long
)

/**
 * CPU 状态
 */
@Serializable
data class CPUStatus(
    val usage: String,
    val cores: Int,
    val model: String
)

/**
 * 内存状态
 */
@Serializable
data class MemoryStatus(
    val total: Long,
    val used: Long,
    val free: Long,
    val usagePercent: String
)

/**
 * 系统基本信息
 */
@Serializable
data class SystemBasicInfo(
    val platform: String,
    val arch: String,
    val hostname: String,
    val uptime: Long
)

/**
 * 系统详细信息
 */
@Serializable
data class SystemInfo(
    val os: OSInfo,
    val cpu: CPUInfo,
    val memory: MemoryInfo,
    val hostname: String,
    val uptime: Long,
    val timestamp: Long
)

/**
 * 操作系统信息
 */
@Serializable
data class OSInfo(
    val type: String,
    val platform: String,
    val arch: String,
    val release: String,
    val version: String
)

/**
 * CPU 详细信息
 */
@Serializable
data class CPUInfo(
    val model: String,
    val cores: Int,
    val speed: Int
)

/**
 * 内存详细信息
 */
@Serializable
data class MemoryInfo(
    val total: Long,
    val free: Long
)

/**
 * 截图响应
 */
@Serializable
data class SystemScreenshotResponse(
    val format: String,
    val data: String,  // Base64 encoded
    val width: Int,
    val height: Int,
    val display: Int,
    val timestamp: Long
)

/**
 * 通知响应
 */
@Serializable
data class NotifyResponse(
    val success: Boolean,
    val title: String,
    val body: String,
    val timestamp: Long
)

/**
 * 执行命令响应
 */
@Serializable
data class ExecCommandResponse(
    val success: Boolean,
    val command: String,
    val stdout: String,
    val stderr: String,
    val exitCode: Int,
    val timestamp: Long
)

/**
 * 通知紧急程度
 */
enum class NotificationUrgency(val value: String) {
    LOW("low"),
    NORMAL("normal"),
    CRITICAL("critical")
}

// ==================== 进程管理响应 ====================

@Serializable
data class SystemProcessListResponse(
    val success: Boolean,
    val processes: List<ProcessItem>,
    val total: Int
)

@Serializable
data class ProcessItem(
    val pid: Int,
    val name: String,
    val cpu: Double,
    val memory: Long,
    val memoryPercent: Double,
    val user: String? = null,
    val status: String,
    val startTime: Long? = null,
    val command: String? = null
)

@Serializable
data class SystemProcessInfoResponse(
    val success: Boolean,
    val process: SystemProcessDetail? = null,
    val message: String? = null
)

@Serializable
data class SystemProcessDetail(
    val pid: Int,
    val name: String,
    val cpu: Double,
    val memory: Long,
    val memoryPercent: Double,
    val user: String,
    val status: String,
    val priority: Int,
    val threads: Int,
    val handles: Int? = null,
    val startTime: Long,
    val command: String,
    val cwd: String? = null,
    val parent: Int? = null,
    val children: List<Int>? = null
)

@Serializable
data class ProcessKillResponse(
    val success: Boolean,
    val pid: Int,
    val message: String
)

@Serializable
data class ProcessKillByNameResponse(
    val success: Boolean,
    val name: String,
    val killedCount: Int,
    val pids: List<Int>,
    val message: String
)

@Serializable
data class ProcessStartResponse(
    val success: Boolean,
    val pid: Int,
    val command: String,
    val message: String? = null
)

// ==================== 网络信息响应 ====================

@Serializable
data class NetworkConnectionsResponse(
    val success: Boolean,
    val connections: List<NetworkConnection>,
    val total: Int
)

@Serializable
data class DnsLookupResponse(
    val success: Boolean,
    val hostname: String,
    val type: String,
    val records: List<DnsRecord>,
    val ttl: Int? = null
)

@Serializable
data class DnsRecord(
    val type: String,
    val value: String,
    val priority: Int? = null  // for MX records
)

// ==================== 服务管理响应 ====================

@Serializable
data class ServicesListResponse(
    val success: Boolean,
    val services: List<ServiceItem>,
    val total: Int
)

@Serializable
data class ServiceItem(
    val name: String,
    val displayName: String,
    val status: String,  // "running", "stopped", "starting", "stopping"
    val startType: String,  // "automatic", "manual", "disabled"
    val description: String? = null
)

@Serializable
data class ServiceStatusResponse(
    val success: Boolean,
    val service: ServiceItem? = null,
    val message: String? = null
)

@Serializable
data class ServiceOperationResponse(
    val success: Boolean,
    val serviceName: String,
    val operation: String,
    val newStatus: String,
    val message: String? = null
)

// ==================== 环境变量响应 ====================

@Serializable
data class EnvResponse(
    val success: Boolean,
    val variables: Map<String, String>,
    val count: Int
)

@Serializable
data class EnvSetResponse(
    val success: Boolean,
    val name: String,
    val value: String,
    val persistent: Boolean,
    val message: String? = null
)

// ==================== 用户信息响应 ====================

@Serializable
data class UserInfoResponse(
    val success: Boolean,
    val username: String,
    val uid: Int? = null,
    val gid: Int? = null,
    val homeDir: String,
    val shell: String? = null,
    val groups: List<String>? = null,
    val isAdmin: Boolean
)

@Serializable
data class UsersListResponse(
    val success: Boolean,
    val users: List<SystemUser>,
    val total: Int
)

@Serializable
data class SystemUser(
    val username: String,
    val uid: Int? = null,
    val homeDir: String? = null,
    val shell: String? = null,
    val enabled: Boolean
)

@Serializable
data class LoggedInUsersResponse(
    val success: Boolean,
    val users: List<LoggedInUser>,
    val total: Int
)

@Serializable
data class LoggedInUser(
    val username: String,
    val terminal: String? = null,
    val host: String? = null,
    val loginTime: Long,
    val session: String? = null
)

// ==================== 性能监控响应 ====================

@Serializable
data class CpuHistoryResponse(
    val success: Boolean,
    val history: List<CpuDataPoint>,
    val duration: Int,
    val interval: Int
)

@Serializable
data class CpuDataPoint(
    val timestamp: Long,
    val usage: Double,
    val user: Double? = null,
    val system: Double? = null,
    val idle: Double? = null
)

@Serializable
data class MemoryHistoryResponse(
    val success: Boolean,
    val history: List<MemoryDataPoint>,
    val duration: Int,
    val interval: Int
)

@Serializable
data class MemoryDataPoint(
    val timestamp: Long,
    val used: Long,
    val free: Long,
    val usedPercent: Double
)

@Serializable
data class LoadAverageResponse(
    val success: Boolean,
    val load1: Double,
    val load5: Double,
    val load15: Double,
    val cpuCount: Int
)

@Serializable
data class TemperaturesResponse(
    val success: Boolean,
    val sensors: List<TemperatureSensor>
)

// ==================== 启动项响应 ====================

@Serializable
data class StartupItemsResponse(
    val success: Boolean,
    val items: List<StartupItem>,
    val total: Int
)

@Serializable
data class StartupItem(
    val id: String,
    val name: String,
    val command: String,
    val location: String,
    val enabled: Boolean,
    val publisher: String? = null
)

@Serializable
data class StartupItemOperationResponse(
    val success: Boolean,
    val itemId: String,
    val enabled: Boolean,
    val message: String? = null
)

// ==================== 定时任务响应 ====================

@Serializable
data class ScheduledTasksResponse(
    val success: Boolean,
    val tasks: List<ScheduledTaskItem>,
    val total: Int
)

@Serializable
data class ScheduledTaskItem(
    val id: String,
    val name: String,
    val command: String,
    val schedule: String,
    val enabled: Boolean,
    val lastRun: Long? = null,
    val nextRun: Long? = null,
    val lastResult: String? = null
)

@Serializable
data class ScheduledTaskResponse(
    val success: Boolean,
    val task: ScheduledTaskItem,
    val message: String? = null
)

@Serializable
data class ScheduledTaskOperationResponse(
    val success: Boolean,
    val taskId: String,
    val operation: String,
    val message: String? = null
)

// ==================== 系统日志响应 ====================

@Serializable
data class ClearLogsResponse(
    val success: Boolean,
    val source: String,
    val deletedCount: Int,
    val message: String? = null
)

// ==================== 时区和时间响应 ====================

@Serializable
data class SystemTimeResponse(
    val success: Boolean,
    val timestamp: Long,
    val iso8601: String,
    val timezone: String,
    val offset: Int,  // minutes from UTC
    val isDST: Boolean
)

@Serializable
data class SetTimeResponse(
    val success: Boolean,
    val timestamp: Long,
    val message: String? = null
)

@Serializable
data class TimezonesResponse(
    val success: Boolean,
    val timezones: List<TimezoneInfo>,
    val current: String
)

@Serializable
data class TimezoneInfo(
    val name: String,
    val offset: Int,
    val displayName: String
)

@Serializable
data class SetTimezoneResponse(
    val success: Boolean,
    val timezone: String,
    val message: String? = null
)

@Serializable
data class SyncTimeResponse(
    val success: Boolean,
    val server: String,
    val offset: Long,  // milliseconds
    val synced: Boolean,
    val message: String? = null
)

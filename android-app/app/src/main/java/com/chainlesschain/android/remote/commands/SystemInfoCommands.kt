package com.chainlesschain.android.remote.commands

import com.chainlesschain.android.remote.client.RemoteCommandClient
import kotlinx.serialization.Serializable
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 系统信息命令 API（扩展）
 *
 * 提供类型安全的扩展系统信息相关命令
 */
@Singleton
class SystemInfoCommands @Inject constructor(
    private val client: RemoteCommandClient
) {
    /**
     * 获取 CPU 信息
     */
    suspend fun getCPU(): Result<CpuInfoResponse> {
        return client.invoke("sysinfo.getCPU", emptyMap())
    }

    /**
     * 获取内存信息
     */
    suspend fun getMemory(): Result<MemoryInfoResponse> {
        return client.invoke("sysinfo.getMemory", emptyMap())
    }

    /**
     * 获取电池状态
     */
    suspend fun getBattery(): Result<BatteryInfoResponse> {
        return client.invoke("sysinfo.getBattery", emptyMap())
    }

    /**
     * 获取温度信息
     */
    suspend fun getTemperature(): Result<TemperatureInfoResponse> {
        return client.invoke("sysinfo.getTemperature", emptyMap())
    }

    /**
     * 获取系统运行时间
     */
    suspend fun getUptime(): Result<UptimeInfoResponse> {
        return client.invoke("sysinfo.getUptime", emptyMap())
    }

    /**
     * 获取操作系统信息
     */
    suspend fun getOS(): Result<OSInfoResponse> {
        return client.invoke("sysinfo.getOS", emptyMap())
    }

    /**
     * 获取硬件信息
     */
    suspend fun getHardware(): Result<HardwareInfoResponse> {
        return client.invoke("sysinfo.getHardware", emptyMap())
    }

    /**
     * 获取系统日志
     *
     * @param lines 返回行数
     */
    suspend fun getLogs(lines: Int = 100): Result<SystemLogsResponse> {
        val params = mapOf("lines" to lines)
        return client.invoke("sysinfo.getLogs", params)
    }

    /**
     * 获取服务状态
     */
    suspend fun getServices(): Result<ServicesResponse> {
        return client.invoke("sysinfo.getServices", emptyMap())
    }

    /**
     * 获取性能摘要
     */
    suspend fun getPerformance(): Result<PerformanceInfoResponse> {
        return client.invoke("sysinfo.getPerformance", emptyMap())
    }
}

// 响应数据类

@Serializable
data class CpuInfoResponse(
    val success: Boolean,
    val cpu: CpuDetail
)

@Serializable
data class CpuDetail(
    val model: String,
    val cores: Int,
    val speed: Int? = null,
    val usage: Double? = null,
    val times: CpuTimes? = null
)

@Serializable
data class CpuTimes(
    val user: Long? = null,
    val nice: Long? = null,
    val sys: Long? = null,
    val idle: Long? = null,
    val irq: Long? = null
)

@Serializable
data class MemoryInfoResponse(
    val success: Boolean,
    val memory: MemoryDetail
)

@Serializable
data class MemoryDetail(
    val total: Long,
    val used: Long,
    val free: Long,
    val active: Long? = null,
    val available: Long? = null,
    val usagePercent: Double,
    val totalFormatted: String? = null,
    val usedFormatted: String? = null,
    val freeFormatted: String? = null
)

@Serializable
data class BatteryInfoResponse(
    val success: Boolean,
    val hasBattery: Boolean,
    val battery: BatteryDetail? = null
)

@Serializable
data class BatteryDetail(
    val percent: Int,
    val isCharging: Boolean,
    val acConnected: Boolean,
    val timeRemaining: Int? = null,
    val voltage: Double? = null,
    val designedCapacity: Int? = null,
    val currentCapacity: Int? = null,
    val maxCapacity: Int? = null,
    val capacityUnit: String? = null
)

@Serializable
data class TemperatureInfoResponse(
    val success: Boolean,
    val temperatures: List<TemperatureSensor>
)

@Serializable
data class TemperatureSensor(
    val label: String,
    val value: Double,
    val max: Double? = null,
    val critical: Double? = null
)

@Serializable
data class UptimeInfoResponse(
    val success: Boolean,
    val uptime: UptimeDetail
)

@Serializable
data class UptimeDetail(
    val seconds: Long,
    val formatted: String,
    val days: Int? = null,
    val hours: Int? = null,
    val minutes: Int? = null
)

@Serializable
data class OSInfoResponse(
    val success: Boolean,
    val os: OSDetail
)

@Serializable
data class OSDetail(
    val platform: String,
    val distro: String? = null,
    val release: String? = null,
    val codename: String? = null,
    val kernel: String? = null,
    val arch: String,
    val hostname: String,
    val fqdn: String? = null,
    val codepage: String? = null,
    val logofile: String? = null,
    val serial: String? = null,
    val build: String? = null,
    val servicepack: String? = null,
    val uefi: Boolean? = null
)

@Serializable
data class HardwareInfoResponse(
    val success: Boolean,
    val hardware: HardwareDetail,
    val cached: Boolean
)

@Serializable
data class HardwareDetail(
    val cpus: Int,
    val cpuModel: String,
    val totalMemory: Long,
    val totalMemoryFormatted: String? = null,
    val platform: String,
    val arch: String,
    val hostname: String,
    val manufacturer: String? = null,
    val model: String? = null,
    val serial: String? = null,
    val uuid: String? = null,
    val sku: String? = null,
    val version: String? = null,
    val virtual: Boolean? = null
)

@Serializable
data class SystemLogsResponse(
    val success: Boolean,
    val logs: List<LogEntry>,
    val total: Int
)

@Serializable
data class LogEntry(
    val timestamp: String? = null,
    val level: String? = null,
    val source: String? = null,
    val message: String
)

@Serializable
data class ServicesResponse(
    val success: Boolean,
    val services: List<ServiceInfo>,
    val total: Int
)

@Serializable
data class ServiceInfo(
    val name: String,
    val displayName: String? = null,
    val state: String,
    val startType: String? = null,
    val pid: Int? = null,
    val cpu: Double? = null,
    val memory: Long? = null
)

@Serializable
data class PerformanceInfoResponse(
    val success: Boolean,
    val performance: PerformanceDetail
)

@Serializable
data class PerformanceDetail(
    val cpu: CpuPerformance,
    val memory: MemoryPerformance,
    val uptime: Long,
    val loadAverage: List<Double>? = null
)

@Serializable
data class CpuPerformance(
    val usage: Double,
    val cores: Int,
    val model: String
)

@Serializable
data class MemoryPerformance(
    val total: Long,
    val used: Long,
    val free: Long,
    val usagePercent: Double
)

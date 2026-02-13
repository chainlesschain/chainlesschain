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

    // ==================== GPU 信息 ====================

    /**
     * 获取 GPU 信息
     */
    suspend fun getGPU(): Result<GpuInfoResponse> {
        return client.invoke("sysinfo.getGPU", emptyMap())
    }

    /**
     * 获取 GPU 使用情况
     */
    suspend fun getGPUUsage(): Result<GpuUsageResponse> {
        return client.invoke("sysinfo.getGPUUsage", emptyMap())
    }

    // ==================== 主板和 BIOS ====================

    /**
     * 获取 BIOS 信息
     */
    suspend fun getBIOS(): Result<BiosInfoResponse> {
        return client.invoke("sysinfo.getBIOS", emptyMap())
    }

    /**
     * 获取主板信息
     */
    suspend fun getMotherboard(): Result<MotherboardInfoResponse> {
        return client.invoke("sysinfo.getMotherboard", emptyMap())
    }

    /**
     * 获取机箱信息
     */
    suspend fun getChassis(): Result<ChassisInfoResponse> {
        return client.invoke("sysinfo.getChassis", emptyMap())
    }

    // ==================== 外设信息 ====================

    /**
     * 获取 USB 设备列表
     */
    suspend fun getUSBDevices(): Result<UsbDevicesResponse> {
        return client.invoke("sysinfo.getUSBDevices", emptyMap())
    }

    /**
     * 获取蓝牙设备列表
     */
    suspend fun getBluetoothDevices(): Result<BluetoothDevicesResponse> {
        return client.invoke("sysinfo.getBluetoothDevices", emptyMap())
    }

    /**
     * 获取音频设备列表
     */
    suspend fun getAudioDevices(): Result<AudioDevicesInfoResponse> {
        return client.invoke("sysinfo.getAudioDevices", emptyMap())
    }

    /**
     * 获取打印机列表
     */
    suspend fun getPrinters(): Result<PrintersInfoResponse> {
        return client.invoke("sysinfo.getPrinters", emptyMap())
    }

    // ==================== 显示器信息 ====================

    /**
     * 获取显示器列表
     */
    suspend fun getDisplays(): Result<DisplaysInfoResponse> {
        return client.invoke("sysinfo.getDisplays", emptyMap())
    }

    /**
     * 获取当前分辨率
     */
    suspend fun getResolution(): Result<ResolutionInfoResponse> {
        return client.invoke("sysinfo.getResolution", emptyMap())
    }

    // ==================== 网络硬件 ====================

    /**
     * 获取网卡信息
     */
    suspend fun getNetworkAdapters(): Result<NetworkAdaptersResponse> {
        return client.invoke("sysinfo.getNetworkAdapters", emptyMap())
    }

    /**
     * 获取网关信息
     */
    suspend fun getGateway(): Result<GatewayInfoResponse> {
        return client.invoke("sysinfo.getGateway", emptyMap())
    }

    // ==================== 存储硬件 ====================

    /**
     * 获取磁盘布局
     */
    suspend fun getDiskLayout(): Result<DiskLayoutResponse> {
        return client.invoke("sysinfo.getDiskLayout", emptyMap())
    }

    /**
     * 获取块设备信息
     */
    suspend fun getBlockDevices(): Result<BlockDevicesResponse> {
        return client.invoke("sysinfo.getBlockDevices", emptyMap())
    }

    // ==================== Docker 信息 ====================

    /**
     * 获取 Docker 信息
     */
    suspend fun getDockerInfo(): Result<DockerInfoResponse> {
        return client.invoke("sysinfo.getDockerInfo", emptyMap())
    }

    /**
     * 获取 Docker 容器列表
     */
    suspend fun getDockerContainers(): Result<DockerContainersResponse> {
        return client.invoke("sysinfo.getDockerContainers", emptyMap())
    }

    /**
     * 获取 Docker 镜像列表
     */
    suspend fun getDockerImages(): Result<DockerImagesResponse> {
        return client.invoke("sysinfo.getDockerImages", emptyMap())
    }

    // ==================== 虚拟化信息 ====================

    /**
     * 获取虚拟化信息
     */
    suspend fun getVirtualization(): Result<VirtualizationInfoResponse> {
        return client.invoke("sysinfo.getVirtualization", emptyMap())
    }

    /**
     * 获取虚拟机列表
     */
    suspend fun getVirtualMachines(): Result<VirtualMachinesResponse> {
        return client.invoke("sysinfo.getVirtualMachines", emptyMap())
    }

    // ==================== 启动信息 ====================

    /**
     * 获取启动信息
     */
    suspend fun getBootInfo(): Result<BootInfoResponse> {
        return client.invoke("sysinfo.getBootInfo", emptyMap())
    }

    /**
     * 获取启动时间分析
     */
    suspend fun getBootTime(): Result<BootTimeResponse> {
        return client.invoke("sysinfo.getBootTime", emptyMap())
    }

    // ==================== 区域设置 ====================

    /**
     * 获取时区信息
     */
    suspend fun getTimezone(): Result<TimezoneInfoResponse> {
        return client.invoke("sysinfo.getTimezone", emptyMap())
    }

    /**
     * 获取区域设置
     */
    suspend fun getLocale(): Result<LocaleInfoResponse> {
        return client.invoke("sysinfo.getLocale", emptyMap())
    }

    // ==================== 用户信息 ====================

    /**
     * 获取用户列表
     */
    suspend fun getUsers(): Result<UsersInfoResponse> {
        return client.invoke("sysinfo.getUsers", emptyMap())
    }

    /**
     * 获取当前用户
     */
    suspend fun getCurrentUser(): Result<CurrentUserInfoResponse> {
        return client.invoke("sysinfo.getCurrentUser", emptyMap())
    }

    // ==================== 进程统计 ====================

    /**
     * 获取进程统计
     */
    suspend fun getProcessStats(): Result<ProcessStatsInfoResponse> {
        return client.invoke("sysinfo.getProcessStats", emptyMap())
    }

    // ==================== 完整系统报告 ====================

    /**
     * 获取完整系统报告
     */
    suspend fun getFullReport(): Result<FullSystemReportResponse> {
        return client.invoke("sysinfo.getFullReport", emptyMap())
    }

    /**
     * 导出系统信息
     *
     * @param format 格式 (json, html, txt)
     */
    suspend fun exportSystemInfo(format: String = "json"): Result<ExportSystemInfoResponse> {
        return client.invoke("sysinfo.exportSystemInfo", mapOf("format" to format))
    }

    // ==================== 基准测试 ====================

    /**
     * 运行 CPU 基准测试
     */
    suspend fun runCpuBenchmark(): Result<CpuBenchmarkResponse> {
        return client.invoke("sysinfo.runCpuBenchmark", emptyMap())
    }

    /**
     * 运行内存基准测试
     */
    suspend fun runMemoryBenchmark(): Result<MemoryBenchmarkResponse> {
        return client.invoke("sysinfo.runMemoryBenchmark", emptyMap())
    }

    /**
     * 运行磁盘基准测试
     *
     * @param path 测试路径
     */
    suspend fun runDiskBenchmark(path: String? = null): Result<DiskBenchmarkResponse> {
        val params = mutableMapOf<String, Any>()
        path?.let { params["path"] = it }
        return client.invoke("sysinfo.runDiskBenchmark", params)
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

// ==================== GPU 响应 ====================

@Serializable
data class GpuInfoResponse(
    val success: Boolean,
    val gpus: List<GpuDetail>,
    val total: Int
)

@Serializable
data class GpuDetail(
    val vendor: String,
    val model: String,
    val bus: String? = null,
    val vram: Long? = null,
    val vramFormatted: String? = null,
    val driverVersion: String? = null,
    val subDeviceId: String? = null,
    val name: String? = null
)

@Serializable
data class GpuUsageResponse(
    val success: Boolean,
    val gpus: List<GpuUsageDetail>
)

@Serializable
data class GpuUsageDetail(
    val index: Int,
    val name: String,
    val utilizationGpu: Int? = null,
    val utilizationMemory: Int? = null,
    val memoryTotal: Long? = null,
    val memoryUsed: Long? = null,
    val memoryFree: Long? = null,
    val temperature: Double? = null,
    val powerDraw: Double? = null,
    val clockCore: Int? = null,
    val clockMemory: Int? = null
)

// ==================== 主板和 BIOS 响应 ====================

@Serializable
data class BiosInfoResponse(
    val success: Boolean,
    val bios: BiosDetail
)

@Serializable
data class BiosDetail(
    val vendor: String,
    val version: String,
    val releaseDate: String? = null,
    val revision: String? = null,
    val serial: String? = null,
    val language: String? = null,
    val features: List<String>? = null
)

@Serializable
data class MotherboardInfoResponse(
    val success: Boolean,
    val motherboard: MotherboardDetail
)

@Serializable
data class MotherboardDetail(
    val manufacturer: String,
    val model: String,
    val version: String? = null,
    val serial: String? = null,
    val assetTag: String? = null,
    val memoryMax: Long? = null,
    val memorySlots: Int? = null
)

@Serializable
data class ChassisInfoResponse(
    val success: Boolean,
    val chassis: ChassisDetail
)

@Serializable
data class ChassisDetail(
    val manufacturer: String,
    val model: String? = null,
    val type: String,
    val version: String? = null,
    val serial: String? = null,
    val assetTag: String? = null,
    val sku: String? = null
)

// ==================== 外设响应 ====================

@Serializable
data class UsbDevicesResponse(
    val success: Boolean,
    val devices: List<UsbDevice>,
    val total: Int
)

@Serializable
data class UsbDevice(
    val bus: Int? = null,
    val deviceId: Int? = null,
    val id: String,
    val name: String,
    val type: String,
    val vendor: String? = null,
    val manufacturer: String? = null,
    val maxPower: String? = null,
    val serialNumber: String? = null
)

@Serializable
data class BluetoothDevicesResponse(
    val success: Boolean,
    val devices: List<BluetoothDevice>,
    val total: Int
)

@Serializable
data class BluetoothDevice(
    val address: String,
    val name: String,
    val type: String,
    val connected: Boolean,
    val paired: Boolean,
    val batteryLevel: Int? = null,
    val manufacturer: String? = null
)

@Serializable
data class AudioDevicesInfoResponse(
    val success: Boolean,
    val devices: List<AudioDeviceDetail>,
    val total: Int
)

@Serializable
data class AudioDeviceDetail(
    val id: String,
    val name: String,
    val manufacturer: String? = null,
    val type: String,  // "playback", "recording", "default"
    val driver: String? = null,
    val status: String,
    val default: Boolean,
    val channel: String? = null
)

@Serializable
data class PrintersInfoResponse(
    val success: Boolean,
    val printers: List<PrinterDetail>,
    val total: Int
)

@Serializable
data class PrinterDetail(
    val id: String,
    val name: String,
    val model: String? = null,
    val uri: String? = null,
    val status: String,
    val isDefault: Boolean,
    val isShared: Boolean? = null,
    val local: Boolean
)

// ==================== 显示器响应 ====================

@Serializable
data class DisplaysInfoResponse(
    val success: Boolean,
    val displays: List<DisplayDetail>,
    val total: Int
)

@Serializable
data class DisplayDetail(
    val vendor: String? = null,
    val model: String,
    val deviceName: String? = null,
    val main: Boolean,
    val builtin: Boolean,
    val connection: String? = null,
    val resolutionX: Int,
    val resolutionY: Int,
    val sizeX: Int? = null,
    val sizeY: Int? = null,
    val pixelDepth: Int? = null,
    val refreshRate: Int? = null,
    val positionX: Int? = null,
    val positionY: Int? = null,
    val currentResX: Int? = null,
    val currentResY: Int? = null
)

@Serializable
data class ResolutionInfoResponse(
    val success: Boolean,
    val width: Int,
    val height: Int,
    val colorDepth: Int? = null,
    val refreshRate: Int? = null,
    val scaleFactor: Double? = null
)

// ==================== 网络硬件响应 ====================

@Serializable
data class NetworkAdaptersResponse(
    val success: Boolean,
    val adapters: List<NetworkAdapterDetail>,
    val total: Int
)

@Serializable
data class NetworkAdapterDetail(
    val iface: String,
    val ifaceName: String,
    val ip4: String? = null,
    val ip6: String? = null,
    val mac: String,
    val type: String,
    val speed: Long? = null,
    val duplex: String? = null,
    val mtu: Int? = null,
    val operstate: String,
    val dhcp: Boolean? = null,
    val virtual: Boolean? = null,
    val manufacturer: String? = null
)

@Serializable
data class GatewayInfoResponse(
    val success: Boolean,
    val gateway: String,
    val interface_: String? = null
)

// ==================== 存储硬件响应 ====================

@Serializable
data class DiskLayoutResponse(
    val success: Boolean,
    val disks: List<DiskLayoutDetail>,
    val total: Int
)

@Serializable
data class DiskLayoutDetail(
    val device: String,
    val type: String,
    val name: String,
    val vendor: String? = null,
    val size: Long,
    val sizeFormatted: String? = null,
    val bytesPerSector: Int? = null,
    val totalCylinders: Long? = null,
    val totalHeads: Int? = null,
    val totalSectors: Long? = null,
    val totalTracks: Long? = null,
    val tracksPerCylinder: Int? = null,
    val sectorsPerTrack: Int? = null,
    val firmwareRevision: String? = null,
    val serialNum: String? = null,
    val interfaceType: String? = null,
    val smartStatus: String? = null
)

@Serializable
data class BlockDevicesResponse(
    val success: Boolean,
    val devices: List<BlockDeviceDetail>,
    val total: Int
)

@Serializable
data class BlockDeviceDetail(
    val name: String,
    val type: String,
    val fsType: String? = null,
    val mount: String? = null,
    val size: Long,
    val physical: String? = null,
    val uuid: String? = null,
    val label: String? = null,
    val model: String? = null,
    val serial: String? = null,
    val removable: Boolean,
    val protocol: String? = null
)

// ==================== Docker 响应 ====================

@Serializable
data class DockerInfoResponse(
    val success: Boolean,
    val installed: Boolean,
    val running: Boolean,
    val version: String? = null,
    val containersTotal: Int? = null,
    val containersRunning: Int? = null,
    val containersPaused: Int? = null,
    val containersStopped: Int? = null,
    val images: Int? = null,
    val driver: String? = null,
    val memoryLimit: Boolean? = null,
    val swapLimit: Boolean? = null,
    val cpuCfs: Boolean? = null
)

@Serializable
data class DockerContainersResponse(
    val success: Boolean,
    val containers: List<DockerContainer>,
    val total: Int
)

@Serializable
data class DockerContainer(
    val id: String,
    val name: String,
    val image: String,
    val imageId: String? = null,
    val command: String? = null,
    val created: Long,
    val started: Long? = null,
    val finished: Long? = null,
    val state: String,
    val restartCount: Int? = null,
    val platform: String? = null,
    val ports: List<DockerPort>? = null,
    val mounts: List<DockerMount>? = null
)

@Serializable
data class DockerPort(
    val ip: String? = null,
    val privatePort: Int,
    val publicPort: Int? = null,
    val type: String
)

@Serializable
data class DockerMount(
    val type: String,
    val source: String,
    val destination: String,
    val mode: String,
    val rw: Boolean
)

@Serializable
data class DockerImagesResponse(
    val success: Boolean,
    val images: List<DockerImage>,
    val total: Int
)

@Serializable
data class DockerImage(
    val id: String,
    val container: String? = null,
    val comment: String? = null,
    val os: String? = null,
    val architecture: String? = null,
    val parent: String? = null,
    val dockerVersion: String? = null,
    val size: Long,
    val virtualSize: Long? = null,
    val author: String? = null,
    val created: Long,
    val containerConfig: String? = null,
    val repoTags: List<String>? = null,
    val repoDigests: List<String>? = null
)

// ==================== 虚拟化响应 ====================

@Serializable
data class VirtualizationInfoResponse(
    val success: Boolean,
    val virtual: Boolean,
    val hypervisor: String? = null,  // "vmware", "virtualbox", "hyper-v", "kvm", etc.
    val vmType: String? = null
)

@Serializable
data class VirtualMachinesResponse(
    val success: Boolean,
    val vms: List<VirtualMachine>,
    val total: Int
)

@Serializable
data class VirtualMachine(
    val id: String,
    val name: String,
    val state: String,
    val os: String? = null,
    val cpus: Int? = null,
    val memory: Long? = null,
    val hypervisor: String? = null
)

// ==================== 启动信息响应 ====================

@Serializable
data class BootInfoResponse(
    val success: Boolean,
    val bootTime: Long,
    val bootTimeFormatted: String,
    val uefi: Boolean? = null,
    val secureBoot: Boolean? = null,
    val lastShutdown: Long? = null,
    val lastShutdownReason: String? = null
)

@Serializable
data class BootTimeResponse(
    val success: Boolean,
    val totalBootTime: Long,  // milliseconds
    val firmwareTime: Long? = null,
    val loaderTime: Long? = null,
    val kernelTime: Long? = null,
    val initrdTime: Long? = null,
    val userspaceTime: Long? = null,
    val graphicsTime: Long? = null
)

// ==================== 区域设置响应 ====================

@Serializable
data class TimezoneInfoResponse(
    val success: Boolean,
    val timezone: String,
    val offset: Int,  // minutes
    val offsetString: String,
    val dstActive: Boolean
)

@Serializable
data class LocaleInfoResponse(
    val success: Boolean,
    val locale: String,
    val language: String,
    val country: String? = null,
    val codepage: String? = null,
    val dateFormat: String? = null,
    val timeFormat: String? = null,
    val currency: String? = null,
    val decimalSeparator: String? = null,
    val thousandsSeparator: String? = null
)

// ==================== 用户信息响应 ====================

@Serializable
data class UsersInfoResponse(
    val success: Boolean,
    val users: List<UserDetail>,
    val total: Int
)

@Serializable
data class UserDetail(
    val user: String,
    val uid: Int? = null,
    val gid: Int? = null,
    val home: String? = null,
    val shell: String? = null,
    val fullName: String? = null,
    val admin: Boolean,
    val active: Boolean
)

@Serializable
data class CurrentUserInfoResponse(
    val success: Boolean,
    val user: String,
    val uid: Int? = null,
    val gid: Int? = null,
    val home: String,
    val shell: String? = null,
    val groups: List<String>? = null,
    val isAdmin: Boolean
)

// ==================== 进程统计响应 ====================

@Serializable
data class ProcessStatsInfoResponse(
    val success: Boolean,
    val all: Int,
    val running: Int,
    val blocked: Int,
    val sleeping: Int,
    val unknown: Int,
    val threads: Int? = null
)

// ==================== 完整系统报告响应 ====================

@Serializable
data class FullSystemReportResponse(
    val success: Boolean,
    val generatedAt: Long,
    val system: OSDetail,
    val hardware: HardwareDetail,
    val cpu: CpuDetail,
    val memory: MemoryDetail,
    val gpus: List<GpuDetail>? = null,
    val disks: List<DiskLayoutDetail>? = null,
    val network: List<NetworkAdapterDetail>? = null,
    val battery: BatteryDetail? = null
)

@Serializable
data class ExportSystemInfoResponse(
    val success: Boolean,
    val format: String,
    val content: String,
    val size: Int,
    val generatedAt: Long
)

// ==================== 基准测试响应 ====================

@Serializable
data class CpuBenchmarkResponse(
    val success: Boolean,
    val score: Int,
    val singleThreadScore: Int? = null,
    val multiThreadScore: Int? = null,
    val duration: Long,
    val cpuModel: String,
    val cores: Int
)

@Serializable
data class MemoryBenchmarkResponse(
    val success: Boolean,
    val readSpeed: Long,  // MB/s
    val writeSpeed: Long,
    val copySpeed: Long? = null,
    val latency: Double? = null,  // ns
    val duration: Long
)

@Serializable
data class DiskBenchmarkResponse(
    val success: Boolean,
    val path: String,
    val sequentialRead: Long,  // MB/s
    val sequentialWrite: Long,
    val randomRead: Long? = null,
    val randomWrite: Long? = null,
    val iops: Int? = null,
    val duration: Long
)

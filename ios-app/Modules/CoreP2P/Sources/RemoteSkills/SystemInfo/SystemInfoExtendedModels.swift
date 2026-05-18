import Foundation

/// Phase 6.1B3 — sysinfo skill 扩展 model（10 个 `sysinfo.X` 单组件查询响应）。
///
/// 与既有 SystemInfoModels.swift `SystemInfo` (`system.info` 单调用聚合) 区分：
/// - `system.info` 旧 API：单次返 cpu+memory+disk+network 聚合（Phase 3.5 v0.1）— 留存
/// - `sysinfo.X` 新 API：每组件单独查询，可独立失败 — Phase 6.1B3 接通 Coverage 验证的
///   桌面端真正 register namespace `sysinfo`（10 method）
///
/// **wire 协议**：`sysinfo.getCPU` / `getMemory` / `getOS` / `getUptime` / `getBattery` /
/// `getTemperature` / `getHardware` / `getPerformance` / `getServices` / `getLogs`

/// `sysinfo.getCPU` 响应（详细 CPU 信息）。
public struct CpuExtendedResponse: Sendable, Equatable {
    public let success: Bool
    public let brand: String?
    public let cores: Int
    public let threads: Int
    public let speed: Double           // GHz
    public let speedMin: Double?
    public let speedMax: Double?
    public let usage: Double           // 0-100%
    public let architecture: String?

    public init(success: Bool, brand: String? = nil, cores: Int, threads: Int,
                speed: Double, speedMin: Double? = nil, speedMax: Double? = nil,
                usage: Double, architecture: String? = nil) {
        self.success = success; self.brand = brand
        self.cores = cores; self.threads = threads
        self.speed = speed; self.speedMin = speedMin; self.speedMax = speedMax
        self.usage = usage; self.architecture = architecture
    }

    public static func decode(_ json: String) throws -> CpuExtendedResponse {
        let d = try parseDict(json)
        let cpu = (d["cpu"] as? [String: Any]) ?? d
        return CpuExtendedResponse(
            success: (d["success"] as? Bool) ?? false,
            brand: cpu["brand"] as? String,
            cores: (cpu["cores"] as? Int) ?? 0,
            threads: (cpu["threads"] as? Int) ?? 0,
            speed: (cpu["speed"] as? Double) ?? 0.0,
            speedMin: cpu["speedMin"] as? Double,
            speedMax: cpu["speedMax"] as? Double,
            usage: (cpu["usage"] as? Double) ?? 0.0,
            architecture: cpu["architecture"] as? String
        )
    }
}

/// `sysinfo.getMemory` 响应。
public struct MemoryExtendedResponse: Sendable, Equatable {
    public let success: Bool
    public let totalBytes: Int64
    public let freeBytes: Int64
    public let usedBytes: Int64
    public let availableBytes: Int64?
    public let usagePercent: Double
    public let swapTotalBytes: Int64?
    public let swapUsedBytes: Int64?

    public init(success: Bool, totalBytes: Int64, freeBytes: Int64, usedBytes: Int64,
                availableBytes: Int64? = nil, usagePercent: Double,
                swapTotalBytes: Int64? = nil, swapUsedBytes: Int64? = nil) {
        self.success = success
        self.totalBytes = totalBytes; self.freeBytes = freeBytes; self.usedBytes = usedBytes
        self.availableBytes = availableBytes; self.usagePercent = usagePercent
        self.swapTotalBytes = swapTotalBytes; self.swapUsedBytes = swapUsedBytes
    }

    private static func int64(_ d: [String: Any], _ k: String) -> Int64 {
        if let n = d[k] as? Int64 { return n }
        if let n = d[k] as? Int { return Int64(n) }
        return 0
    }
    private static func int64Opt(_ d: [String: Any], _ k: String) -> Int64? {
        if let n = d[k] as? Int64 { return n }
        if let n = d[k] as? Int { return Int64(n) }
        return nil
    }

    public static func decode(_ json: String) throws -> MemoryExtendedResponse {
        let d = try parseDict(json)
        let m = (d["memory"] as? [String: Any]) ?? d
        return MemoryExtendedResponse(
            success: (d["success"] as? Bool) ?? false,
            totalBytes: int64(m, "totalBytes"),
            freeBytes: int64(m, "freeBytes"),
            usedBytes: int64(m, "usedBytes"),
            availableBytes: int64Opt(m, "availableBytes"),
            usagePercent: (m["usagePercent"] as? Double) ?? 0.0,
            swapTotalBytes: int64Opt(m, "swapTotalBytes"),
            swapUsedBytes: int64Opt(m, "swapUsedBytes")
        )
    }
}

/// `sysinfo.getOS` 响应。
public struct OSInfoResponse: Sendable, Equatable {
    public let success: Bool
    public let platform: String        // darwin / win32 / linux
    public let distro: String?         // e.g. Ubuntu 22.04 / macOS 15.0 / Windows 11
    public let release: String?
    public let kernel: String?
    public let arch: String?
    public let hostname: String?

    public init(success: Bool, platform: String, distro: String? = nil,
                release: String? = nil, kernel: String? = nil,
                arch: String? = nil, hostname: String? = nil) {
        self.success = success; self.platform = platform; self.distro = distro
        self.release = release; self.kernel = kernel
        self.arch = arch; self.hostname = hostname
    }

    public static func decode(_ json: String) throws -> OSInfoResponse {
        let d = try parseDict(json)
        let o = (d["os"] as? [String: Any]) ?? d
        return OSInfoResponse(
            success: (d["success"] as? Bool) ?? false,
            platform: (o["platform"] as? String) ?? "",
            distro: o["distro"] as? String,
            release: o["release"] as? String,
            kernel: o["kernel"] as? String,
            arch: o["arch"] as? String,
            hostname: o["hostname"] as? String
        )
    }
}

/// `sysinfo.getUptime` 响应。
public struct UptimeResponse: Sendable, Equatable {
    public let success: Bool
    public let uptimeSeconds: Int64
    public let bootTime: String?

    public init(success: Bool, uptimeSeconds: Int64, bootTime: String? = nil) {
        self.success = success; self.uptimeSeconds = uptimeSeconds; self.bootTime = bootTime
    }

    public static func decode(_ json: String) throws -> UptimeResponse {
        let d = try parseDict(json)
        let up: Int64
        if let n = d["uptimeSeconds"] as? Int64 { up = n }
        else if let n = d["uptimeSeconds"] as? Int { up = Int64(n) }
        else if let n = d["uptime"] as? Int64 { up = n }
        else if let n = d["uptime"] as? Int { up = Int64(n) }
        else { up = 0 }
        return UptimeResponse(
            success: (d["success"] as? Bool) ?? false,
            uptimeSeconds: up,
            bootTime: d["bootTime"] as? String
        )
    }
}

/// `sysinfo.getBattery` 响应。
public struct BatteryInfoResponse: Sendable, Equatable {
    public let success: Bool
    public let hasBattery: Bool
    public let percent: Int?
    public let isCharging: Bool?
    public let timeRemainingMinutes: Int?
    public let acConnected: Bool?

    public init(success: Bool, hasBattery: Bool, percent: Int? = nil,
                isCharging: Bool? = nil, timeRemainingMinutes: Int? = nil,
                acConnected: Bool? = nil) {
        self.success = success; self.hasBattery = hasBattery
        self.percent = percent; self.isCharging = isCharging
        self.timeRemainingMinutes = timeRemainingMinutes; self.acConnected = acConnected
    }

    public static func decode(_ json: String) throws -> BatteryInfoResponse {
        let d = try parseDict(json)
        let b = (d["battery"] as? [String: Any]) ?? d
        return BatteryInfoResponse(
            success: (d["success"] as? Bool) ?? false,
            hasBattery: (b["hasBattery"] as? Bool) ?? false,
            percent: b["percent"] as? Int,
            isCharging: b["isCharging"] as? Bool,
            timeRemainingMinutes: b["timeRemainingMinutes"] as? Int,
            acConnected: b["acConnected"] as? Bool
        )
    }
}

/// `sysinfo.getTemperature` 响应。
public struct TemperatureSensor: Sendable, Equatable {
    public let name: String
    public let celsius: Double

    public init(name: String, celsius: Double) {
        self.name = name; self.celsius = celsius
    }
}

public struct TemperatureResponse: Sendable, Equatable {
    public let success: Bool
    public let cpuCelsius: Double?
    public let gpuCelsius: Double?
    public let sensors: [TemperatureSensor]
    public let error: String?

    public init(success: Bool, cpuCelsius: Double? = nil, gpuCelsius: Double? = nil,
                sensors: [TemperatureSensor] = [], error: String? = nil) {
        self.success = success
        self.cpuCelsius = cpuCelsius; self.gpuCelsius = gpuCelsius
        self.sensors = sensors; self.error = error
    }

    public static func decode(_ json: String) throws -> TemperatureResponse {
        let d = try parseDict(json)
        let arr = (d["sensors"] as? [[String: Any]]) ?? []
        return TemperatureResponse(
            success: (d["success"] as? Bool) ?? false,
            cpuCelsius: d["cpuCelsius"] as? Double,
            gpuCelsius: d["gpuCelsius"] as? Double,
            sensors: arr.map {
                TemperatureSensor(
                    name: ($0["name"] as? String) ?? "",
                    celsius: ($0["celsius"] as? Double) ?? 0.0
                )
            },
            error: d["error"] as? String
        )
    }
}

/// `sysinfo.getHardware` 响应（厂商 / 型号 / 序列号）。
public struct HardwareInfoResponse: Sendable, Equatable {
    public let success: Bool
    public let manufacturer: String?
    public let model: String?
    public let version: String?
    public let serial: String?
    public let uuid: String?

    public init(success: Bool, manufacturer: String? = nil, model: String? = nil,
                version: String? = nil, serial: String? = nil, uuid: String? = nil) {
        self.success = success
        self.manufacturer = manufacturer; self.model = model
        self.version = version; self.serial = serial; self.uuid = uuid
    }

    public static func decode(_ json: String) throws -> HardwareInfoResponse {
        let d = try parseDict(json)
        let h = (d["hardware"] as? [String: Any]) ?? d
        return HardwareInfoResponse(
            success: (d["success"] as? Bool) ?? false,
            manufacturer: h["manufacturer"] as? String,
            model: h["model"] as? String,
            version: h["version"] as? String,
            serial: h["serial"] as? String,
            uuid: h["uuid"] as? String
        )
    }
}

/// `sysinfo.getPerformance` 响应（瞬时性能快照）。
public struct PerformanceSnapshotResponse: Sendable, Equatable {
    public let success: Bool
    public let cpuUsage: Double          // 0-100
    public let memoryUsagePercent: Double
    public let diskIoPercent: Double?
    public let networkIoBytesPerSec: Int64?
    public let loadAvg1m: Double?
    public let loadAvg5m: Double?
    public let loadAvg15m: Double?

    public init(success: Bool, cpuUsage: Double, memoryUsagePercent: Double,
                diskIoPercent: Double? = nil, networkIoBytesPerSec: Int64? = nil,
                loadAvg1m: Double? = nil, loadAvg5m: Double? = nil, loadAvg15m: Double? = nil) {
        self.success = success
        self.cpuUsage = cpuUsage; self.memoryUsagePercent = memoryUsagePercent
        self.diskIoPercent = diskIoPercent; self.networkIoBytesPerSec = networkIoBytesPerSec
        self.loadAvg1m = loadAvg1m; self.loadAvg5m = loadAvg5m; self.loadAvg15m = loadAvg15m
    }

    public static func decode(_ json: String) throws -> PerformanceSnapshotResponse {
        let d = try parseDict(json)
        let p = (d["performance"] as? [String: Any]) ?? d
        let net: Int64?
        if let n = p["networkIoBytesPerSec"] as? Int64 { net = n }
        else if let n = p["networkIoBytesPerSec"] as? Int { net = Int64(n) }
        else { net = nil }
        return PerformanceSnapshotResponse(
            success: (d["success"] as? Bool) ?? false,
            cpuUsage: (p["cpuUsage"] as? Double) ?? 0.0,
            memoryUsagePercent: (p["memoryUsagePercent"] as? Double) ?? 0.0,
            diskIoPercent: p["diskIoPercent"] as? Double,
            networkIoBytesPerSec: net,
            loadAvg1m: p["loadAvg1m"] as? Double,
            loadAvg5m: p["loadAvg5m"] as? Double,
            loadAvg15m: p["loadAvg15m"] as? Double
        )
    }
}

/// `sysinfo.getServices` 响应（系统服务列表）。
public struct ServiceInfo: Sendable, Equatable {
    public let name: String
    public let displayName: String?
    public let state: String?        // running / stopped / paused
    public let startType: String?

    public init(name: String, displayName: String? = nil,
                state: String? = nil, startType: String? = nil) {
        self.name = name; self.displayName = displayName
        self.state = state; self.startType = startType
    }
}

public struct ServicesListResponse: Sendable, Equatable {
    public let success: Bool
    public let services: [ServiceInfo]
    public let total: Int

    public init(success: Bool, services: [ServiceInfo], total: Int) {
        self.success = success; self.services = services; self.total = total
    }

    public static func decode(_ json: String) throws -> ServicesListResponse {
        let d = try parseDict(json)
        let arr = (d["services"] as? [[String: Any]]) ?? []
        return ServicesListResponse(
            success: (d["success"] as? Bool) ?? false,
            services: arr.map {
                ServiceInfo(
                    name: ($0["name"] as? String) ?? "",
                    displayName: $0["displayName"] as? String,
                    state: $0["state"] as? String,
                    startType: $0["startType"] as? String
                )
            },
            total: (d["total"] as? Int) ?? arr.count
        )
    }
}

/// `sysinfo.getLogs` 响应（系统日志条目）。
public struct LogEntry: Sendable, Equatable {
    public let timestamp: String
    public let level: String         // info / warn / error / debug
    public let source: String?
    public let message: String

    public init(timestamp: String, level: String, source: String? = nil, message: String) {
        self.timestamp = timestamp; self.level = level
        self.source = source; self.message = message
    }
}

public struct SystemLogsResponse: Sendable, Equatable {
    public let success: Bool
    public let logs: [LogEntry]
    public let total: Int

    public init(success: Bool, logs: [LogEntry], total: Int) {
        self.success = success; self.logs = logs; self.total = total
    }

    public static func decode(_ json: String) throws -> SystemLogsResponse {
        let d = try parseDict(json)
        let arr = (d["logs"] as? [[String: Any]]) ?? []
        return SystemLogsResponse(
            success: (d["success"] as? Bool) ?? false,
            logs: arr.map {
                LogEntry(
                    timestamp: ($0["timestamp"] as? String) ?? "",
                    level: ($0["level"] as? String) ?? "info",
                    source: $0["source"] as? String,
                    message: ($0["message"] as? String) ?? ""
                )
            },
            total: (d["total"] as? Int) ?? arr.count
        )
    }
}

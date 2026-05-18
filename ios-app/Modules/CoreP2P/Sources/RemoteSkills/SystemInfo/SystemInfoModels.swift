import Foundation

/// 系统信息聚合 — Phase 3.5。
///
/// 与桌面 `desktop-app-vue/.../handlers/system-info-handler.js` 字段对齐
/// （`system.info` 单调用返 4 个 sub-block）。各字段桌面端可能 nil（如某些
/// 平台无 SMART / disk health 信息）— 解码时容忍缺失。
public struct SystemInfo: Sendable, Equatable {
    public let cpu: CpuInfo?
    public let memory: MemoryInfo?
    public let disk: DiskInfo?
    public let network: NetworkInfo?
    public let uptime: Int64?         // 秒
    public let timestamp: Int64?      // epoch ms (桌面采样时间)

    public init(
        cpu: CpuInfo? = nil,
        memory: MemoryInfo? = nil,
        disk: DiskInfo? = nil,
        network: NetworkInfo? = nil,
        uptime: Int64? = nil,
        timestamp: Int64? = nil
    ) {
        self.cpu = cpu
        self.memory = memory
        self.disk = disk
        self.network = network
        self.uptime = uptime
        self.timestamp = timestamp
    }

    public static func decode(_ json: String) throws -> SystemInfo {
        guard let data = json.data(using: .utf8),
              let dict = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw RemoteSkillError.malformedResult("system.info: invalid JSON")
        }
        return SystemInfo(
            cpu: (dict["cpu"] as? [String: Any]).flatMap(CpuInfo.fromDict),
            memory: (dict["memory"] as? [String: Any]).flatMap(MemoryInfo.fromDict),
            disk: (dict["disk"] as? [String: Any]).flatMap(DiskInfo.fromDict),
            network: (dict["network"] as? [String: Any]).flatMap(NetworkInfo.fromDict),
            uptime: int64Field(dict["uptime"]),
            timestamp: int64Field(dict["timestamp"])
        )
    }
}

public struct CpuInfo: Sendable, Equatable {
    public let usagePercent: Double?  // 0-100
    public let cores: Int?
    public let model: String?
    public let speedMhz: Int?

    static func fromDict(_ dict: [String: Any]) -> CpuInfo {
        CpuInfo(
            usagePercent: doubleField(dict["usage"] ?? dict["usagePercent"]),
            cores: intField(dict["cores"]),
            model: dict["model"] as? String,
            speedMhz: intField(dict["speedMhz"] ?? dict["speed"])
        )
    }
}

public struct MemoryInfo: Sendable, Equatable {
    public let totalBytes: Int64?
    public let usedBytes: Int64?
    public let freeBytes: Int64?

    public var usagePercent: Double? {
        guard let total = totalBytes, let used = usedBytes, total > 0 else { return nil }
        return Double(used) / Double(total) * 100
    }

    static func fromDict(_ dict: [String: Any]) -> MemoryInfo {
        MemoryInfo(
            totalBytes: int64Field(dict["total"]),
            usedBytes: int64Field(dict["used"]),
            freeBytes: int64Field(dict["free"])
        )
    }
}

public struct DiskInfo: Sendable, Equatable {
    public let totalBytes: Int64?
    public let usedBytes: Int64?
    public let freeBytes: Int64?
    public let mountPoint: String?

    public var usagePercent: Double? {
        guard let total = totalBytes, let used = usedBytes, total > 0 else { return nil }
        return Double(used) / Double(total) * 100
    }

    static func fromDict(_ dict: [String: Any]) -> DiskInfo {
        DiskInfo(
            totalBytes: int64Field(dict["total"]),
            usedBytes: int64Field(dict["used"]),
            freeBytes: int64Field(dict["free"]),
            mountPoint: dict["mountPoint"] as? String ?? dict["mount"] as? String
        )
    }
}

public struct NetworkInfo: Sendable, Equatable {
    public let interfaceName: String?
    public let ipv4: String?
    public let bytesSent: Int64?
    public let bytesReceived: Int64?

    static func fromDict(_ dict: [String: Any]) -> NetworkInfo {
        NetworkInfo(
            interfaceName: dict["interface"] as? String ?? dict["interfaceName"] as? String,
            ipv4: dict["ipv4"] as? String ?? dict["ip"] as? String,
            bytesSent: int64Field(dict["bytesSent"] ?? dict["sent"]),
            bytesReceived: int64Field(dict["bytesReceived"] ?? dict["received"])
        )
    }
}

// MARK: - Field helpers

private func int64Field(_ raw: Any?) -> Int64? {
    if let n = raw as? Int64 { return n > 0 ? n : nil }
    if let n = raw as? Int { return n > 0 ? Int64(n) : nil }
    if let d = raw as? Double { return d > 0 ? Int64(d) : nil }
    if let s = raw as? String, let n = Int64(s), n > 0 { return n }
    return nil
}

private func intField(_ raw: Any?) -> Int? {
    if let n = raw as? Int { return n > 0 ? n : nil }
    if let n = raw as? Int64 { return n > 0 ? Int(n) : nil }
    if let d = raw as? Double { return d > 0 ? Int(d) : nil }
    return nil
}

private func doubleField(_ raw: Any?) -> Double? {
    if let d = raw as? Double { return d }
    if let n = raw as? Int { return Double(n) }
    if let n = raw as? Int64 { return Double(n) }
    if let s = raw as? String, let d = Double(s) { return d }
    return nil
}

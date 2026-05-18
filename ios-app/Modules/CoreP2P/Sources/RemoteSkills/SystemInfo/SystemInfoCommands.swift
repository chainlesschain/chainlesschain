import Foundation

/// 系统信息 typed RPC wrapper — Phase 3.5 v0.1 + Phase 6.1B3 扩展。
///
/// Phase 3.5 v0.1：单调用 `system.info` 聚合返 4 sub-block（cpu/memory/disk/network）。
/// Phase 6.1B3：新增 10 个 `sysinfo.X` 单组件查询方法，与桌面端真实注册的
/// namespace `sysinfo` 接通（Coverage doc §1.4：A=42 D=10 ✓=10）。
///
/// **重要**：Phase 3.5 `info()` 方法实测桌面端无对应 case（namespace `system` 与
/// `sysinfo` 是两个不同 handler）。该方法在桌面 E2E 时会返 `Unknown action`。
/// Phase 6.1.7 UI 收口时把 SystemInfoView 切到新 10 method API，然后即可 deprecate
/// `info()` 旧 API。
///
/// **wire 协议**（与桌面 `system-info-handler.js` + `system-handler.js` 对齐）：
/// - `system.info` (旧 Phase 3.5 — 实际未 wired，仅留存): `{}` → SystemInfo 聚合
/// - `sysinfo.getCPU` / `getMemory` / `getOS` / `getUptime` / `getBattery` /
///   `getTemperature` / `getHardware` / `getPerformance` / `getServices` / `getLogs`
public actor SystemInfoCommands {

    private let client: RemoteCommandClient

    public init(client: RemoteCommandClient) {
        self.client = client
    }

    /// **Phase 3.5 v0.1**: 一次性拉所有系统信息。**桌面端实际未 wire**，留存以兼容
    /// 既有 SystemInfoView。Phase 6.1.7 切换到 `getCPU` + `getMemory` + ... 单查 API。
    @available(*, deprecated, message: "Phase 6.1B3: 桌面端未注册 system.info；改用 getCPU/getMemory/... 单组件查询")
    public func info(
        pcPeerId: String,
        mobileDid: String? = nil
    ) async throws -> SystemInfo {
        let response = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "system.info",
            params: [:],
            mobileDid: mobileDid
        )
        switch response {
        case .success(_, let resultJson):
            return try SystemInfo.decode(resultJson)
        case .failure(let reqId, let msg):
            throw RemoteSkillError.remoteError(reqId: reqId, message: msg)
        }
    }

    // MARK: - Phase 6.1B3 sysinfo.X 10 method

    /// CPU 详情（品牌 / 核心数 / 主频 / 用量）。
    public func getCPU(
        pcPeerId: String,
        mobileDid: String? = nil
    ) async throws -> CpuExtendedResponse {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "sysinfo.getCPU",
            params: [:],
            mobileDid: mobileDid
        )
        return try Self.decodeExt(resp, CpuExtendedResponse.decode)
    }

    /// 内存详情（含 swap）。
    public func getMemory(
        pcPeerId: String,
        mobileDid: String? = nil
    ) async throws -> MemoryExtendedResponse {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "sysinfo.getMemory",
            params: [:],
            mobileDid: mobileDid
        )
        return try Self.decodeExt(resp, MemoryExtendedResponse.decode)
    }

    /// OS 信息（平台 / 发行版 / 内核 / hostname）。
    public func getOS(
        pcPeerId: String,
        mobileDid: String? = nil
    ) async throws -> OSInfoResponse {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "sysinfo.getOS",
            params: [:],
            mobileDid: mobileDid
        )
        return try Self.decodeExt(resp, OSInfoResponse.decode)
    }

    /// 系统运行时长（秒）。
    public func getUptime(
        pcPeerId: String,
        mobileDid: String? = nil
    ) async throws -> UptimeResponse {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "sysinfo.getUptime",
            params: [:],
            mobileDid: mobileDid
        )
        return try Self.decodeExt(resp, UptimeResponse.decode)
    }

    /// 电池状态（笔记本 only；台式机返 hasBattery: false）。
    public func getBattery(
        pcPeerId: String,
        mobileDid: String? = nil
    ) async throws -> BatteryInfoResponse {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "sysinfo.getBattery",
            params: [:],
            mobileDid: mobileDid
        )
        return try Self.decodeExt(resp, BatteryInfoResponse.decode)
    }

    /// 温度传感器（CPU / GPU / 系统板等）。部分平台不支持返 error。
    public func getTemperature(
        pcPeerId: String,
        mobileDid: String? = nil
    ) async throws -> TemperatureResponse {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "sysinfo.getTemperature",
            params: [:],
            mobileDid: mobileDid
        )
        return try Self.decodeExt(resp, TemperatureResponse.decode)
    }

    /// 硬件 / 主板信息（厂商 / 型号 / 序列号）。
    public func getHardware(
        pcPeerId: String,
        mobileDid: String? = nil
    ) async throws -> HardwareInfoResponse {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "sysinfo.getHardware",
            params: [:],
            mobileDid: mobileDid
        )
        return try Self.decodeExt(resp, HardwareInfoResponse.decode)
    }

    /// 性能瞬时快照（CPU% / 内存% / IO / load avg）。
    public func getPerformance(
        pcPeerId: String,
        mobileDid: String? = nil
    ) async throws -> PerformanceSnapshotResponse {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "sysinfo.getPerformance",
            params: [:],
            mobileDid: mobileDid
        )
        return try Self.decodeExt(resp, PerformanceSnapshotResponse.decode)
    }

    /// 系统服务列表（systemd / SCM / launchd 等）。
    public func getServices(
        pcPeerId: String,
        limit: Int = 100,
        mobileDid: String? = nil
    ) async throws -> ServicesListResponse {
        guard limit > 0 else {
            throw RemoteSkillError.invalidArgument("sysinfo.getServices: limit must be > 0")
        }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "sysinfo.getServices",
            params: ["limit": limit],
            mobileDid: mobileDid
        )
        return try Self.decodeExt(resp, ServicesListResponse.decode)
    }

    /// 系统日志（按 level / source / limit 过滤）。
    public func getLogs(
        pcPeerId: String,
        level: String? = nil,         // info / warn / error / debug
        source: String? = nil,
        limit: Int = 100,
        mobileDid: String? = nil
    ) async throws -> SystemLogsResponse {
        guard limit > 0 else {
            throw RemoteSkillError.invalidArgument("sysinfo.getLogs: limit must be > 0")
        }
        var params: [String: Any] = ["limit": limit]
        if let l = level { params["level"] = l }
        if let s = source { params["source"] = s }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "sysinfo.getLogs",
            params: params,
            mobileDid: mobileDid
        )
        return try Self.decodeExt(resp, SystemLogsResponse.decode)
    }

    private static func decodeExt<T>(
        _ resp: TerminalRpcResponse,
        _ decoder: (String) throws -> T
    ) throws -> T {
        switch resp {
        case .success(_, let resultJson):  return try decoder(resultJson)
        case .failure(let reqId, let msg): throw RemoteSkillError.remoteError(reqId: reqId, message: msg)
        }
    }
}

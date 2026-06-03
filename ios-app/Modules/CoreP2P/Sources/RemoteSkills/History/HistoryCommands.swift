import Foundation

/// 命令历史 typed RPC wrapper — Phase 6.5 (红档子集 batch 2)。
///
/// **特殊**：history 是 Phase 6.1B3 Coverage 审计的"名称分化"namespace 之一
/// （A=7 D=8 ✓=3 严格匹配 42%）。iOS 跟桌面 case 名（桌面为运行时 ground truth）。
///
/// 桌面 8 method (本 iOS impl): clear / export / getByDevice / getById /
///   getByTimeRange / getHistory / getStats / search
/// Android 7 method 不全匹配（含 clearHistory/getCommand/getFrequent/replay 等
/// 不同命名 + 1 extra method `replay` 桌面无 — 留 Phase 7+ debt 或桌面端补 alias）
///
/// **wire 协议**（与桌面 `command-history-handler.js` 对齐）：
/// - 查询: getHistory (通用 list) / getById / getByDevice / getByTimeRange / search
/// - 统计: getStats
/// - 维护: clear (mutating; 高危) / export
public actor HistoryCommands {

    private let client: RemoteCommandClient

    public init(client: RemoteCommandClient) {
        self.client = client
    }

    /// 通用历史列表。
    public func getHistory(
        pcPeerId: String,
        limit: Int = 100,
        offset: Int? = nil,
        mobileDid: String? = nil
    ) async throws -> HistoryListResponse {
        guard limit > 0 else {
            throw RemoteSkillError.invalidArgument("history.getHistory: limit must be > 0")
        }
        var params: [String: Any] = ["limit": limit]
        if let o = offset {
            guard o >= 0 else {
                throw RemoteSkillError.invalidArgument("history.getHistory: offset must be ≥ 0")
            }
            params["offset"] = o
        }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "history.getHistory",
            params: params,
            mobileDid: mobileDid
        )
        return try Self.decode(resp, HistoryListResponse.decode)
    }

    /// 按 id 查询单条。
    public func getById(
        pcPeerId: String,
        id: String,
        mobileDid: String? = nil
    ) async throws -> HistoryGetByIdResponse {
        guard !id.isEmpty else {
            throw RemoteSkillError.invalidArgument("history.getById: id empty")
        }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "history.getById",
            params: ["id": id],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, HistoryGetByIdResponse.decode)
    }

    /// 按设备 id 过滤。
    public func getByDevice(
        pcPeerId: String,
        deviceId: String,
        limit: Int = 100,
        mobileDid: String? = nil
    ) async throws -> HistoryListResponse {
        guard !deviceId.isEmpty else {
            throw RemoteSkillError.invalidArgument("history.getByDevice: deviceId empty")
        }
        guard limit > 0 else {
            throw RemoteSkillError.invalidArgument("history.getByDevice: limit must be > 0")
        }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "history.getByDevice",
            params: ["deviceId": deviceId, "limit": limit],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, HistoryListResponse.decode)
    }

    /// 按时间范围过滤（epoch ms）。
    public func getByTimeRange(
        pcPeerId: String,
        startTime: Int64,
        endTime: Int64,
        limit: Int = 100,
        mobileDid: String? = nil
    ) async throws -> HistoryListResponse {
        guard endTime >= startTime else {
            throw RemoteSkillError.invalidArgument("history.getByTimeRange: endTime must ≥ startTime")
        }
        guard limit > 0 else {
            throw RemoteSkillError.invalidArgument("history.getByTimeRange: limit must be > 0")
        }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "history.getByTimeRange",
            params: [
                "startTime": startTime, "endTime": endTime, "limit": limit
            ],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, HistoryListResponse.decode)
    }

    /// 搜索（query 匹配 command 或 cwd）。
    public func search(
        pcPeerId: String,
        query: String,
        limit: Int = 50,
        mobileDid: String? = nil
    ) async throws -> HistoryListResponse {
        guard !query.isEmpty else {
            throw RemoteSkillError.invalidArgument("history.search: query empty")
        }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "history.search",
            params: ["query": query, "limit": limit],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, HistoryListResponse.decode)
    }

    /// 统计信息。
    public func getStats(
        pcPeerId: String,
        mobileDid: String? = nil
    ) async throws -> HistoryStatsResponse {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "history.getStats",
            params: [:],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, HistoryStatsResponse.decode)
    }

    /// 清空历史（mutating; 高危 — 不可逆，桌面端应配 ApprovalGate）。
    public func clear(
        pcPeerId: String,
        beforeTimestamp: Int64? = nil,
        deviceId: String? = nil,
        mobileDid: String? = nil
    ) async throws -> HistoryClearResponse {
        var params: [String: Any] = [:]
        if let b = beforeTimestamp { params["beforeTimestamp"] = b }
        if let d = deviceId { params["deviceId"] = d }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "history.clear",
            params: params,
            mobileDid: mobileDid
        )
        return try Self.decode(resp, HistoryClearResponse.decode)
    }

    /// 导出历史（json / csv / text）。
    public func export(
        pcPeerId: String,
        format: String = "json",
        savePath: String? = nil,
        mobileDid: String? = nil
    ) async throws -> HistoryExportResponse {
        let validFormats = ["json", "csv", "text"]
        guard validFormats.contains(format) else {
            let joined = validFormats.joined(separator: "/")
            throw RemoteSkillError.invalidArgument(
                "history.export: format must be one of \(joined)"
            )
        }
        var params: [String: Any] = ["format": format]
        if let p = savePath { params["savePath"] = p }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "history.export",
            params: params,
            mobileDid: mobileDid
        )
        return try Self.decode(resp, HistoryExportResponse.decode)
    }

    private static func decode<T>(
        _ resp: TerminalRpcResponse,
        _ decoder: (String) throws -> T
    ) throws -> T {
        switch resp {
        case .success(_, let resultJson):  return try decoder(resultJson)
        case .failure(let reqId, let msg): throw RemoteSkillError.remoteError(reqId: reqId, message: msg)
        }
    }
}

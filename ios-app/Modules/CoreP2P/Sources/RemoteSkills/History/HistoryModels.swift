import Foundation

/// 命令历史记录项。
public struct HistoryEntry: Sendable, Equatable {
    public let id: String
    public let command: String
    public let timestamp: Int64
    public let deviceId: String?
    public let exitCode: Int?
    public let durationMs: Int?
    public let cwd: String?
    public let user: String?

    public init(id: String, command: String, timestamp: Int64,
                deviceId: String? = nil, exitCode: Int? = nil,
                durationMs: Int? = nil, cwd: String? = nil, user: String? = nil) {
        self.id = id; self.command = command; self.timestamp = timestamp
        self.deviceId = deviceId; self.exitCode = exitCode
        self.durationMs = durationMs; self.cwd = cwd; self.user = user
    }

    internal static func from(_ d: [String: Any]) -> HistoryEntry {
        let ts: Int64
        if let n = d["timestamp"] as? Int64 { ts = n }
        else if let n = d["timestamp"] as? Int { ts = Int64(n) }
        else { ts = 0 }
        return HistoryEntry(
            id: (d["id"] as? String) ?? "",
            command: (d["command"] as? String) ?? "",
            timestamp: ts,
            deviceId: d["deviceId"] as? String,
            exitCode: d["exitCode"] as? Int,
            durationMs: d["durationMs"] as? Int,
            cwd: d["cwd"] as? String,
            user: d["user"] as? String
        )
    }
}

/// `history.getHistory` 通用 list 响应。
public struct HistoryListResponse: Sendable, Equatable {
    public let success: Bool
    public let entries: [HistoryEntry]
    public let total: Int

    public init(success: Bool, entries: [HistoryEntry], total: Int) {
        self.success = success; self.entries = entries; self.total = total
    }

    public static func decode(_ json: String) throws -> HistoryListResponse {
        let d = try parseDict(json)
        let arr = (d["entries"] as? [[String: Any]]) ?? (d["history"] as? [[String: Any]]) ?? []
        return HistoryListResponse(
            success: (d["success"] as? Bool) ?? false,
            entries: arr.map { HistoryEntry.from($0) },
            total: (d["total"] as? Int) ?? arr.count
        )
    }
}

/// `history.getById` 响应（单条详情）。
public struct HistoryGetByIdResponse: Sendable, Equatable {
    public let success: Bool
    public let entry: HistoryEntry?
    public let message: String?

    public init(success: Bool, entry: HistoryEntry? = nil, message: String? = nil) {
        self.success = success; self.entry = entry; self.message = message
    }

    public static func decode(_ json: String) throws -> HistoryGetByIdResponse {
        let d = try parseDict(json)
        let e = d["entry"] as? [String: Any]
        return HistoryGetByIdResponse(
            success: (d["success"] as? Bool) ?? false,
            entry: e.map { HistoryEntry.from($0) },
            message: d["message"] as? String
        )
    }
}

/// `history.getStats` 响应（统计：总条数 / 设备数 / 时间范围等）。
public struct HistoryStatsResponse: Sendable, Equatable {
    public let success: Bool
    public let totalEntries: Int
    public let deviceCount: Int?
    public let firstTimestamp: Int64?
    public let lastTimestamp: Int64?
    public let topCommands: [String]

    public init(success: Bool, totalEntries: Int, deviceCount: Int? = nil,
                firstTimestamp: Int64? = nil, lastTimestamp: Int64? = nil,
                topCommands: [String] = []) {
        self.success = success; self.totalEntries = totalEntries
        self.deviceCount = deviceCount
        self.firstTimestamp = firstTimestamp; self.lastTimestamp = lastTimestamp
        self.topCommands = topCommands
    }

    private static func int64Opt(_ d: [String: Any], _ k: String) -> Int64? {
        if let n = d[k] as? Int64 { return n }
        if let n = d[k] as? Int { return Int64(n) }
        return nil
    }

    public static func decode(_ json: String) throws -> HistoryStatsResponse {
        let d = try parseDict(json)
        return HistoryStatsResponse(
            success: (d["success"] as? Bool) ?? false,
            totalEntries: (d["totalEntries"] as? Int) ?? 0,
            deviceCount: d["deviceCount"] as? Int,
            firstTimestamp: int64Opt(d, "firstTimestamp"),
            lastTimestamp: int64Opt(d, "lastTimestamp"),
            topCommands: (d["topCommands"] as? [String]) ?? []
        )
    }
}

/// `history.clear` 响应。
public struct HistoryClearResponse: Sendable, Equatable {
    public let success: Bool
    public let removed: Int
    public let message: String

    public init(success: Bool, removed: Int, message: String) {
        self.success = success; self.removed = removed; self.message = message
    }

    public static func decode(_ json: String) throws -> HistoryClearResponse {
        let d = try parseDict(json)
        return HistoryClearResponse(
            success: (d["success"] as? Bool) ?? false,
            removed: (d["removed"] as? Int) ?? 0,
            message: (d["message"] as? String) ?? ""
        )
    }
}

/// `history.export` 响应。
public struct HistoryExportResponse: Sendable, Equatable {
    public let success: Bool
    public let format: String
    public let path: String?
    public let data: String?
    public let size: Int
    public let entries: Int

    public init(success: Bool, format: String, path: String? = nil,
                data: String? = nil, size: Int = 0, entries: Int = 0) {
        self.success = success; self.format = format
        self.path = path; self.data = data; self.size = size; self.entries = entries
    }

    public static func decode(_ json: String) throws -> HistoryExportResponse {
        let d = try parseDict(json)
        return HistoryExportResponse(
            success: (d["success"] as? Bool) ?? false,
            format: (d["format"] as? String) ?? "",
            path: d["path"] as? String,
            data: d["data"] as? String,
            size: (d["size"] as? Int) ?? 0,
            entries: (d["entries"] as? Int) ?? 0
        )
    }
}

import Foundation

/// 进程信息 — 嵌套于 ProcessListResponse / ProcessGetResponse。
public struct RemoteProcessInfo: Sendable, Equatable {
    public let pid: Int
    public let name: String
    public let cpu: Double?
    public let memory: Int64?
    public let user: String?
    public let command: String?
    public let parentPid: Int?
    public let status: String?

    public init(pid: Int, name: String, cpu: Double? = nil, memory: Int64? = nil,
                user: String? = nil, command: String? = nil,
                parentPid: Int? = nil, status: String? = nil) {
        self.pid = pid; self.name = name; self.cpu = cpu; self.memory = memory
        self.user = user; self.command = command
        self.parentPid = parentPid; self.status = status
    }

    internal static func from(_ d: [String: Any]) -> RemoteProcessInfo {
        let mem: Int64?
        if let n = d["memory"] as? Int64 { mem = n }
        else if let n = d["memory"] as? Int { mem = Int64(n) }
        else { mem = nil }
        return RemoteProcessInfo(
            pid: (d["pid"] as? Int) ?? 0,
            name: (d["name"] as? String) ?? "",
            cpu: d["cpu"] as? Double,
            memory: mem,
            user: d["user"] as? String,
            command: d["command"] as? String,
            parentPid: d["parentPid"] as? Int,
            status: d["status"] as? String
        )
    }
}

/// `process.list` 响应。
public struct ProcessListResponse: Sendable, Equatable {
    public let success: Bool
    public let processes: [RemoteProcessInfo]
    public let total: Int

    public init(success: Bool, processes: [RemoteProcessInfo], total: Int) {
        self.success = success; self.processes = processes; self.total = total
    }

    public static func decode(_ json: String) throws -> ProcessListResponse {
        let d = try parseDict(json)
        let arr = (d["processes"] as? [[String: Any]]) ?? []
        return ProcessListResponse(
            success: (d["success"] as? Bool) ?? false,
            processes: arr.map { RemoteProcessInfo.from($0) },
            total: (d["total"] as? Int) ?? arr.count
        )
    }
}

/// `process.get` 响应（单进程详情）。
public struct ProcessGetResponse: Sendable, Equatable {
    public let success: Bool
    public let process: RemoteProcessInfo?
    public let message: String?

    public init(success: Bool, process: RemoteProcessInfo? = nil, message: String? = nil) {
        self.success = success; self.process = process; self.message = message
    }

    public static func decode(_ json: String) throws -> ProcessGetResponse {
        let d = try parseDict(json)
        let p = d["process"] as? [String: Any]
        return ProcessGetResponse(
            success: (d["success"] as? Bool) ?? false,
            process: p.map { RemoteProcessInfo.from($0) },
            message: d["message"] as? String
        )
    }
}

/// `process.search` 响应。
public struct ProcessSearchResponse: Sendable, Equatable {
    public let success: Bool
    public let query: String
    public let processes: [RemoteProcessInfo]
    public let total: Int

    public init(success: Bool, query: String, processes: [RemoteProcessInfo], total: Int) {
        self.success = success; self.query = query; self.processes = processes; self.total = total
    }

    public static func decode(_ json: String) throws -> ProcessSearchResponse {
        let d = try parseDict(json)
        let arr = (d["processes"] as? [[String: Any]]) ?? []
        return ProcessSearchResponse(
            success: (d["success"] as? Bool) ?? false,
            query: (d["query"] as? String) ?? "",
            processes: arr.map { RemoteProcessInfo.from($0) },
            total: (d["total"] as? Int) ?? arr.count
        )
    }
}

/// `process.kill` 响应。
public struct ProcessKillResponse: Sendable, Equatable {
    public let success: Bool
    public let pid: Int
    public let force: Bool
    public let message: String

    public init(success: Bool, pid: Int, force: Bool, message: String) {
        self.success = success; self.pid = pid; self.force = force; self.message = message
    }

    public static func decode(_ json: String) throws -> ProcessKillResponse {
        let d = try parseDict(json)
        return ProcessKillResponse(
            success: (d["success"] as? Bool) ?? false,
            pid: (d["pid"] as? Int) ?? 0,
            force: (d["force"] as? Bool) ?? false,
            message: (d["message"] as? String) ?? ""
        )
    }
}

/// `process.start` 响应。
public struct ProcessStartResponse: Sendable, Equatable {
    public let success: Bool
    public let pid: Int
    public let command: String
    public let message: String

    public init(success: Bool, pid: Int, command: String, message: String) {
        self.success = success; self.pid = pid; self.command = command; self.message = message
    }

    public static func decode(_ json: String) throws -> ProcessStartResponse {
        let d = try parseDict(json)
        return ProcessStartResponse(
            success: (d["success"] as? Bool) ?? false,
            pid: (d["pid"] as? Int) ?? 0,
            command: (d["command"] as? String) ?? "",
            message: (d["message"] as? String) ?? ""
        )
    }
}

/// `process.getResources` 响应（指定 pid 的资源占用快照）。
public struct ProcessResourcesResponse: Sendable, Equatable {
    public let success: Bool
    public let pid: Int
    public let cpu: Double
    public let memory: Int64
    public let memoryPercent: Double
    public let threads: Int?
    public let handles: Int?

    public init(success: Bool, pid: Int, cpu: Double, memory: Int64,
                memoryPercent: Double, threads: Int? = nil, handles: Int? = nil) {
        self.success = success; self.pid = pid; self.cpu = cpu
        self.memory = memory; self.memoryPercent = memoryPercent
        self.threads = threads; self.handles = handles
    }

    public static func decode(_ json: String) throws -> ProcessResourcesResponse {
        let d = try parseDict(json)
        let mem: Int64
        if let n = d["memory"] as? Int64 { mem = n }
        else if let n = d["memory"] as? Int { mem = Int64(n) }
        else { mem = 0 }
        return ProcessResourcesResponse(
            success: (d["success"] as? Bool) ?? false,
            pid: (d["pid"] as? Int) ?? 0,
            cpu: (d["cpu"] as? Double) ?? 0.0,
            memory: mem,
            memoryPercent: (d["memoryPercent"] as? Double) ?? 0.0,
            threads: d["threads"] as? Int,
            handles: d["handles"] as? Int
        )
    }
}

import Foundation

/// 进程管理 typed RPC wrapper — Phase 6.1B3。
///
/// 镜像 Android `app/src/main/java/.../remote/commands/ProcessCommands.kt` 桌面已支持 6 method 子集
/// （桌面 case ⊂ Android 30 method invoke；Android 多 24 method 缺桌面 impl 留 Phase 7+ debt
///  — 含进程树 / 优先级 / IO 监控 / Ports 等）。
///
/// **wire 协议**（与桌面 `process-handler.js` 对齐）：
/// - `process.list` — 列出所有进程（filter / sort / limit）
/// - `process.get` — 按 pid / name 查单进程
/// - `process.search` — 模糊搜索
/// - `process.kill` — 终止进程（mutating; 高危）
/// - `process.start` — 启动新进程（mutating）
/// - `process.getResources` — 单进程资源占用快照
public actor ProcessCommands {

    private let client: RemoteCommandClient

    public init(client: RemoteCommandClient) {
        self.client = client
    }

    /// 列出进程。
    public func list(
        pcPeerId: String,
        limit: Int = 100,
        sortBy: String? = nil,  // cpu / memory / name / pid
        mobileDid: String? = nil
    ) async throws -> ProcessListResponse {
        guard limit > 0 else {
            throw RemoteSkillError.invalidArgument("process.list: limit must be > 0")
        }
        var params: [String: Any] = ["limit": limit]
        if let s = sortBy { params["sortBy"] = s }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "process.list",
            params: params,
            mobileDid: mobileDid
        )
        return try Self.decode(resp, ProcessListResponse.decode)
    }

    /// 按 pid 或 name 查询单个进程。
    public func get(
        pcPeerId: String,
        pid: Int? = nil,
        name: String? = nil,
        mobileDid: String? = nil
    ) async throws -> ProcessGetResponse {
        guard pid != nil || name != nil else {
            throw RemoteSkillError.invalidArgument("process.get: pid or name required")
        }
        var params: [String: Any] = [:]
        if let p = pid { params["pid"] = p }
        if let n = name { params["name"] = n }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "process.get",
            params: params,
            mobileDid: mobileDid
        )
        return try Self.decode(resp, ProcessGetResponse.decode)
    }

    /// 模糊搜索进程。
    public func search(
        pcPeerId: String,
        query: String,
        limit: Int = 50,
        mobileDid: String? = nil
    ) async throws -> ProcessSearchResponse {
        guard !query.isEmpty else {
            throw RemoteSkillError.invalidArgument("process.search: query empty")
        }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "process.search",
            params: ["query": query, "limit": limit],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, ProcessSearchResponse.decode)
    }

    /// 终止进程（mutating; force = SIGKILL/-9）。
    public func kill(
        pcPeerId: String,
        pid: Int,
        force: Bool = false,
        mobileDid: String? = nil
    ) async throws -> ProcessKillResponse {
        guard pid > 0 else {
            throw RemoteSkillError.invalidArgument("process.kill: pid must be > 0")
        }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "process.kill",
            params: ["pid": pid, "force": force],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, ProcessKillResponse.decode)
    }

    /// 启动新进程（mutating; 命令注入风险，桌面端应做沙箱）。
    public func start(
        pcPeerId: String,
        command: String,
        args: [String] = [],
        cwd: String? = nil,
        mobileDid: String? = nil
    ) async throws -> ProcessStartResponse {
        guard !command.isEmpty else {
            throw RemoteSkillError.invalidArgument("process.start: command empty")
        }
        var params: [String: Any] = ["command": command, "args": args]
        if let c = cwd { params["cwd"] = c }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "process.start",
            params: params,
            mobileDid: mobileDid
        )
        return try Self.decode(resp, ProcessStartResponse.decode)
    }

    /// 单进程资源占用快照（CPU% / Memory bytes）。
    public func getResources(
        pcPeerId: String,
        pid: Int,
        mobileDid: String? = nil
    ) async throws -> ProcessResourcesResponse {
        guard pid > 0 else {
            throw RemoteSkillError.invalidArgument("process.getResources: pid must be > 0")
        }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "process.getResources",
            params: ["pid": pid],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, ProcessResourcesResponse.decode)
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

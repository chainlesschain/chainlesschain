import Foundation

/// 应用程序管理 typed RPC wrapper — Phase 6.1B1。
///
/// 镜像 Android `app/src/main/java/.../remote/commands/ApplicationCommands.kt`。
/// **namespace = `app`**（与 Android invoke 一致，与 SeedRegistry display 字段
/// `application` 不同 — 后者待 Phase 6.0.9 修对齐）。
///
/// 8 method 全 wired，桌面 `application-handler.js` 与 Android 100% 名称对齐
/// （Coverage doc §1.4：A=8 D=8 ✓=8）。
///
/// **wire 协议**（与桌面 `application-handler.js` 对齐）：
/// - `app.listInstalled` / `app.listRunning` / `app.getRecent` — 列表查询
/// - `app.getInfo` / `app.search` — 应用详情 / 搜索
/// - `app.launch` / `app.close` / `app.focus` — 启停 / 聚焦（mutating）
public actor ApplicationCommands {

    private let client: RemoteCommandClient

    public init(client: RemoteCommandClient) {
        self.client = client
    }

    /// 列已安装应用。
    public func listInstalled(
        pcPeerId: String,
        limit: Int = 100,
        filter: String? = nil,
        mobileDid: String? = nil
    ) async throws -> InstalledAppsResponse {
        guard limit > 0 else {
            throw RemoteSkillError.invalidArgument("app.listInstalled: limit must be > 0")
        }
        var params: [String: Any] = ["limit": limit]
        if let f = filter { params["filter"] = f }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "app.listInstalled",
            params: params,
            mobileDid: mobileDid
        )
        return try Self.decode(resp, InstalledAppsResponse.decode)
    }

    /// 列运行中应用。
    public func listRunning(
        pcPeerId: String,
        limit: Int = 100,
        mobileDid: String? = nil
    ) async throws -> RunningAppsResponse {
        guard limit > 0 else {
            throw RemoteSkillError.invalidArgument("app.listRunning: limit must be > 0")
        }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "app.listRunning",
            params: ["limit": limit],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, RunningAppsResponse.decode)
    }

    /// 获取应用详情（name / path 至少传一个）。
    public func getInfo(
        pcPeerId: String,
        name: String? = nil,
        path: String? = nil,
        mobileDid: String? = nil
    ) async throws -> AppInfoResponse {
        guard name != nil || path != nil else {
            throw RemoteSkillError.invalidArgument("app.getInfo: name or path required")
        }
        var params: [String: Any] = [:]
        if let n = name { params["name"] = n }
        if let p = path { params["path"] = p }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "app.getInfo",
            params: params,
            mobileDid: mobileDid
        )
        return try Self.decode(resp, AppInfoResponse.decode)
    }

    /// 启动应用（mutating）。
    public func launch(
        pcPeerId: String,
        name: String? = nil,
        path: String? = nil,
        args: [String] = [],
        mobileDid: String? = nil
    ) async throws -> LaunchAppResponse {
        guard name != nil || path != nil else {
            throw RemoteSkillError.invalidArgument("app.launch: name or path required")
        }
        var params: [String: Any] = ["args": args]
        if let n = name { params["name"] = n }
        if let p = path { params["path"] = p }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "app.launch",
            params: params,
            mobileDid: mobileDid
        )
        return try Self.decode(resp, LaunchAppResponse.decode)
    }

    /// 关闭应用（mutating；force = 强制 kill）。
    public func close(
        pcPeerId: String,
        name: String? = nil,
        pid: Int? = nil,
        force: Bool = false,
        mobileDid: String? = nil
    ) async throws -> CloseAppResponse {
        guard name != nil || pid != nil else {
            throw RemoteSkillError.invalidArgument("app.close: name or pid required")
        }
        var params: [String: Any] = ["force": force]
        if let n = name { params["name"] = n }
        if let p = pid { params["pid"] = p }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "app.close",
            params: params,
            mobileDid: mobileDid
        )
        return try Self.decode(resp, CloseAppResponse.decode)
    }

    /// 聚焦应用窗口（mutating UI 状态）。
    public func focus(
        pcPeerId: String,
        name: String? = nil,
        pid: Int? = nil,
        mobileDid: String? = nil
    ) async throws -> FocusAppResponse {
        guard name != nil || pid != nil else {
            throw RemoteSkillError.invalidArgument("app.focus: name or pid required")
        }
        var params: [String: Any] = [:]
        if let n = name { params["name"] = n }
        if let p = pid { params["pid"] = p }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "app.focus",
            params: params,
            mobileDid: mobileDid
        )
        return try Self.decode(resp, FocusAppResponse.decode)
    }

    /// 搜索应用。
    public func search(
        pcPeerId: String,
        query: String,
        limit: Int = 20,
        mobileDid: String? = nil
    ) async throws -> SearchAppsResponse {
        guard !query.isEmpty else {
            throw RemoteSkillError.invalidArgument("app.search: query empty")
        }
        guard limit > 0 else {
            throw RemoteSkillError.invalidArgument("app.search: limit must be > 0")
        }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "app.search",
            params: ["query": query, "limit": limit],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, SearchAppsResponse.decode)
    }

    /// 最近使用应用。
    public func getRecent(
        pcPeerId: String,
        limit: Int = 10,
        mobileDid: String? = nil
    ) async throws -> RecentAppsResponse {
        guard limit > 0 else {
            throw RemoteSkillError.invalidArgument("app.getRecent: limit must be > 0")
        }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "app.getRecent",
            params: ["limit": limit],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, RecentAppsResponse.decode)
    }

    private static func decode<T>(
        _ resp: TerminalRpcResponse,
        _ decoder: (String) throws -> T
    ) throws -> T {
        switch resp {
        case .success(_, let resultJson):
            return try decoder(resultJson)
        case .failure(let reqId, let msg):
            throw RemoteSkillError.remoteError(reqId: reqId, message: msg)
        }
    }
}

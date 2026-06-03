import Foundation

/// 系统通用 typed RPC wrapper — Phase 6.5 (红档子集 batch 2)。
///
/// 镜像 Android `app/src/main/java/.../remote/commands/SystemCommands.kt` 桌面已支持 5 method 子集
/// （桌面 case ⊂ Android 49 method invoke；Android 多 44 method 缺桌面 impl — 含 scheduled tasks /
///  processes / services / network / DNS / 用户管理 / time/timezone / 启动项等留 Phase 7+ debt；
///  这些多数已在其它 namespace 部分覆盖 — 如 process/network/storage 等）。
///
/// **namespace 区分**：
/// - `system.*` (本): 通用 shell 执行 + 系统简要信息 + 通知 / 截屏入口 (5 method)
/// - `sysinfo.*` (Phase 6.1B3 SystemInfoCommands extension): 详细组件查询 (10 method)
///
/// **wire 协议**（与桌面 `system-handler.js` 对齐）：
/// - `system.execCommand` — shell 命令执行（高危；mutating）
/// - `system.getInfo` — 系统简要 platform/arch/hostname/uptime (vs sysinfo.getOS 详细版)
/// - `system.getStatus` — CPU/内存/磁盘 % (vs sysinfo.getPerformance 含 loadAvg 等)
/// - `system.notify` — 桌面端弹通知
/// - `system.screenshot` — 系统级截屏 (简化版；display.screenshot 是完整版)
public actor SystemCommands {

    private let client: RemoteCommandClient

    public init(client: RemoteCommandClient) {
        self.client = client
    }

    /// 执行 shell 命令（mutating，高危 — 桌面端应配 ApprovalGate + 命令白名单）。
    public func execCommand(
        pcPeerId: String,
        command: String,
        args: [String] = [],
        cwd: String? = nil,
        timeoutMs: Int? = nil,
        mobileDid: String? = nil
    ) async throws -> ExecCommandResponse {
        guard !command.isEmpty else {
            throw RemoteSkillError.invalidArgument("system.execCommand: command empty")
        }
        var params: [String: Any] = ["command": command, "args": args]
        if let c = cwd { params["cwd"] = c }
        if let t = timeoutMs {
            guard t > 0 else {
                throw RemoteSkillError.invalidArgument("system.execCommand: timeoutMs must be > 0")
            }
            params["timeoutMs"] = t
        }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "system.execCommand",
            params: params,
            mobileDid: mobileDid
        )
        return try Self.decode(resp, ExecCommandResponse.decode)
    }

    /// 系统简要信息（区别于 sysinfo.getOS 详细版）。
    public func getInfo(
        pcPeerId: String,
        mobileDid: String? = nil
    ) async throws -> SystemBriefInfoResponse {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "system.getInfo",
            params: [:],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, SystemBriefInfoResponse.decode)
    }

    /// 系统状态实时百分比（CPU/内存/磁盘）。
    public func getStatus(
        pcPeerId: String,
        mobileDid: String? = nil
    ) async throws -> SystemStatusResponse {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "system.getStatus",
            params: [:],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, SystemStatusResponse.decode)
    }

    /// 在桌面弹通知。
    public func notify(
        pcPeerId: String,
        title: String,
        message: String,
        urgency: String? = nil,    // low / normal / critical
        mobileDid: String? = nil
    ) async throws -> SystemNotifyResponse {
        guard !title.isEmpty else {
            throw RemoteSkillError.invalidArgument("system.notify: title empty")
        }
        var params: [String: Any] = ["title": title, "message": message]
        if let u = urgency { params["urgency"] = u }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "system.notify",
            params: params,
            mobileDid: mobileDid
        )
        return try Self.decode(resp, SystemNotifyResponse.decode)
    }

    /// 系统级截屏（简化版；display.screenshot 含 displayId/quality 完整参数）。
    public func screenshot(
        pcPeerId: String,
        savePath: String? = nil,
        mobileDid: String? = nil
    ) async throws -> SystemScreenshotResponse {
        var params: [String: Any] = [:]
        if let p = savePath { params["savePath"] = p }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "system.screenshot",
            params: params,
            mobileDid: mobileDid
        )
        return try Self.decode(resp, SystemScreenshotResponse.decode)
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

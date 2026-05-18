import Foundation

/// 电源控制 typed RPC wrapper — Phase 6.1B3。
///
/// 镜像 Android `app/src/main/java/.../remote/commands/PowerCommands.kt` 桌面已支持 10 method 子集
/// （桌面 case ⊂ Android 34 method invoke；Android 多 24 method 缺桌面 impl 留 Phase 7+ debt）。
///
/// **wire 协议**（与桌面 `power-handler.js` 对齐）：
/// - `power.shutdown` / `restart` / `sleep` / `hibernate` / `lock` / `logout` —
///   mutating 高危操作（桌面端 requireConfirmation 模式下首次调用返
///   `{requiresConfirmation: true, confirmId}`，二次 `power.confirm` 真执行）
/// - `power.scheduleShutdown` — 定时关机 (返 taskId)
/// - `power.cancelSchedule` / `getSchedule` — 定时任务管理
/// - `power.confirm` — 二次确认（携带 confirmId）
public actor PowerCommands {

    private let client: RemoteCommandClient

    public init(client: RemoteCommandClient) {
        self.client = client
    }

    /// 关机（mutating; 桌面默认 requireConfirmation 模式需 confirm 二次调用）。
    public func shutdown(
        pcPeerId: String,
        delay: Int = 0,
        force: Bool = false,
        confirm: Bool = true,
        mobileDid: String? = nil
    ) async throws -> PowerActionResponse {
        guard delay >= 0 else {
            throw RemoteSkillError.invalidArgument("power.shutdown: delay must be ≥ 0")
        }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "power.shutdown",
            params: ["delay": delay, "force": force, "confirm": confirm],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, PowerActionResponse.decode)
    }

    /// 重启（mutating）。
    public func restart(
        pcPeerId: String,
        delay: Int = 0,
        confirm: Bool = true,
        mobileDid: String? = nil
    ) async throws -> PowerActionResponse {
        guard delay >= 0 else {
            throw RemoteSkillError.invalidArgument("power.restart: delay must be ≥ 0")
        }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "power.restart",
            params: ["delay": delay, "confirm": confirm],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, PowerActionResponse.decode)
    }

    /// 进入睡眠模式。
    public func sleep(
        pcPeerId: String,
        confirm: Bool = true,
        mobileDid: String? = nil
    ) async throws -> PowerActionResponse {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "power.sleep",
            params: ["confirm": confirm],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, PowerActionResponse.decode)
    }

    /// 休眠（hibernate）。
    public func hibernate(
        pcPeerId: String,
        confirm: Bool = true,
        mobileDid: String? = nil
    ) async throws -> PowerActionResponse {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "power.hibernate",
            params: ["confirm": confirm],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, PowerActionResponse.decode)
    }

    /// 锁屏（NORMAL 权限，桌面端通常无需 confirm）。
    public func lock(
        pcPeerId: String,
        mobileDid: String? = nil
    ) async throws -> PowerActionResponse {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "power.lock",
            params: [:],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, PowerActionResponse.decode)
    }

    /// 注销当前用户。
    public func logout(
        pcPeerId: String,
        confirm: Bool = true,
        mobileDid: String? = nil
    ) async throws -> PowerActionResponse {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "power.logout",
            params: ["confirm": confirm],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, PowerActionResponse.decode)
    }

    /// 定时关机 / 重启 (action: "shutdown"/"restart"/"sleep"/"hibernate")。
    public func scheduleShutdown(
        pcPeerId: String,
        scheduledTime: String,
        action: String = "shutdown",
        mobileDid: String? = nil
    ) async throws -> ScheduledTaskResponse {
        guard !scheduledTime.isEmpty else {
            throw RemoteSkillError.invalidArgument("power.scheduleShutdown: scheduledTime empty")
        }
        let validActions = ["shutdown", "restart", "sleep", "hibernate"]
        guard validActions.contains(action) else {
            throw RemoteSkillError.invalidArgument("power.scheduleShutdown: invalid action '\(action)'")
        }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "power.scheduleShutdown",
            params: ["scheduledTime": scheduledTime, "action": action],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, ScheduledTaskResponse.decode)
    }

    /// 取消定时任务。
    public func cancelSchedule(
        pcPeerId: String,
        taskId: String,
        mobileDid: String? = nil
    ) async throws -> CancelScheduleResponse {
        guard !taskId.isEmpty else {
            throw RemoteSkillError.invalidArgument("power.cancelSchedule: taskId empty")
        }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "power.cancelSchedule",
            params: ["taskId": taskId],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, CancelScheduleResponse.decode)
    }

    /// 查询所有定时任务。
    public func getSchedule(
        pcPeerId: String,
        mobileDid: String? = nil
    ) async throws -> PowerScheduleListResponse {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "power.getSchedule",
            params: [:],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, PowerScheduleListResponse.decode)
    }

    /// 二次确认（携带上次返的 confirmId）。
    public func confirm(
        pcPeerId: String,
        confirmId: String,
        mobileDid: String? = nil
    ) async throws -> PowerActionResponse {
        guard !confirmId.isEmpty else {
            throw RemoteSkillError.invalidArgument("power.confirm: confirmId empty")
        }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "power.confirm",
            params: ["confirmId": confirmId],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, PowerActionResponse.decode)
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

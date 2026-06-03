import Foundation

/// 安全状态查询 typed RPC wrapper — Phase 6.1B1。
///
/// 镜像 Android `app/src/main/java/.../remote/commands/SecurityCommands.kt`。
/// 8 method 全 wired，桌面 `security-handler.js` 与 Android 100% 名称对齐
/// （Coverage doc §1.4：A=8 D=8 ✓=8）。
///
/// **wire 协议**（与桌面 `security-handler.js` 对齐）：
/// - `security.lockWorkstation` — 锁屏（mutating；高危需 ApprovalGate）
/// - `security.getStatus` — 安全状态摘要（防火墙/AV/加密/更新四合一）
/// - `security.getActiveUsers` / `security.getLoginHistory` — 用户/登录历史
/// - `security.getFirewallStatus` / `security.getAntivirusStatus` /
///   `security.getEncryptionStatus` / `security.getUpdates` — 单项详情
public actor SecurityCommands {

    private let client: RemoteCommandClient

    public init(client: RemoteCommandClient) {
        self.client = client
    }

    /// 锁屏（mutating；桌面端高危，应配 ApprovalGate UI）。
    public func lockWorkstation(
        pcPeerId: String,
        mobileDid: String? = nil
    ) async throws -> LockResponse {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "security.lockWorkstation",
            params: [:],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, LockResponse.decode)
    }

    /// 安全状态摘要（4 字段：防火墙 / AV / 加密 / 待更新数）。
    public func getStatus(
        pcPeerId: String,
        mobileDid: String? = nil
    ) async throws -> SecurityStatusResponse {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "security.getStatus",
            params: [:],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, SecurityStatusResponse.decode)
    }

    /// 当前活动用户列表。
    public func getActiveUsers(
        pcPeerId: String,
        mobileDid: String? = nil
    ) async throws -> ActiveUsersResponse {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "security.getActiveUsers",
            params: [:],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, ActiveUsersResponse.decode)
    }

    /// 登录历史（默认最近 50 条）。
    public func getLoginHistory(
        pcPeerId: String,
        limit: Int = 50,
        mobileDid: String? = nil
    ) async throws -> LoginHistoryResponse {
        guard limit > 0 else {
            throw RemoteSkillError.invalidArgument("security.getLoginHistory: limit must be > 0")
        }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "security.getLoginHistory",
            params: ["limit": limit],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, LoginHistoryResponse.decode)
    }

    /// 防火墙状态（含 profiles 列表 + ruleCount）。
    public func getFirewallStatus(
        pcPeerId: String,
        mobileDid: String? = nil
    ) async throws -> FirewallStatusResponse {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "security.getFirewallStatus",
            params: [:],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, FirewallStatusResponse.decode)
    }

    /// 杀毒软件状态（installed + products 列表）。
    public func getAntivirusStatus(
        pcPeerId: String,
        mobileDid: String? = nil
    ) async throws -> AntivirusStatusResponse {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "security.getAntivirusStatus",
            params: [:],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, AntivirusStatusResponse.decode)
    }

    /// 加密状态（BitLocker / FileVault / LUKS 等）。
    public func getEncryptionStatus(
        pcPeerId: String,
        mobileDid: String? = nil
    ) async throws -> EncryptionStatusResponse {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "security.getEncryptionStatus",
            params: [:],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, EncryptionStatusResponse.decode)
    }

    /// 待安装系统更新。
    public func getUpdates(
        pcPeerId: String,
        mobileDid: String? = nil
    ) async throws -> UpdatesStatusResponse {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "security.getUpdates",
            params: [:],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, UpdatesStatusResponse.decode)
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

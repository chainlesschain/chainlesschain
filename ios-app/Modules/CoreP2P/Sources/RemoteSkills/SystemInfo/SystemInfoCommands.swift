import Foundation

/// 系统信息 typed RPC wrapper — Phase 3.5 v0.1。
///
/// **wire 协议**（与桌面 `system-info-handler.js` 对齐）：
/// - `system.info` params: `{}` → `{cpu, memory, disk, network, uptime, timestamp}`
///   各 sub-block 桌面端按平台返 nil/缺省（如 macOS 无 SMART）— 解码时容忍。
public actor SystemInfoCommands {

    private let client: RemoteCommandClient

    public init(client: RemoteCommandClient) {
        self.client = client
    }

    /// 一次性拉所有系统信息。Polling 由 caller (SystemInfoViewModel) 控制。
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
}

import Foundation

/// 剪贴板 typed RPC wrapper — Phase 3.3。
///
/// 镜像 Android `app/src/main/java/.../remote/commands/ClipboardCommands.kt`。
/// v0.1 实现 get/set 两个 method（text 类型已端到端验证）；watch / clear /
/// history 等留 v0.2。
///
/// **依赖**：`RemoteCommandClient` (Phase 3.1 抽出) 提供通用 invoke。
///
/// **wire 协议**（与桌面 `clipboard-handler.js` 对齐）：
/// - `clipboard.get` params: `{type: "text"}` → result: `{content, type, timestamp}`
/// - `clipboard.set` params: `{type: "text", content}` → result: `{ok, bytesWritten?}`
public actor ClipboardCommands {

    private let client: RemoteCommandClient

    public init(client: RemoteCommandClient) {
        self.client = client
    }

    /// 读桌面剪贴板。v0.1 仅支持 text。
    public func get(
        pcPeerId: String,
        type: ClipboardContentType = .text,
        mobileDid: String? = nil
    ) async throws -> ClipboardContent {
        let response = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "clipboard.get",
            params: ["type": type.rawValue],
            mobileDid: mobileDid
        )
        switch response {
        case .success(_, let resultJson):
            return try ClipboardContent.decode(resultJson)
        case .failure(let reqId, let msg):
            throw RemoteSkillError.remoteError(reqId: reqId, message: msg)
        }
    }

    /// 写桌面剪贴板。v0.1 仅支持 text。
    public func set(
        pcPeerId: String,
        content: String,
        type: ClipboardContentType = .text,
        mobileDid: String? = nil
    ) async throws -> ClipboardSetResponse {
        guard !content.isEmpty else {
            throw RemoteSkillError.invalidArgument("clipboard.set content is empty")
        }
        let response = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "clipboard.set",
            params: [
                "type": type.rawValue,
                "content": content
            ],
            mobileDid: mobileDid
        )
        switch response {
        case .success(_, let resultJson):
            return try ClipboardSetResponse.decode(resultJson)
        case .failure(let reqId, let msg):
            throw RemoteSkillError.remoteError(reqId: reqId, message: msg)
        }
    }
}

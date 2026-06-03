import Foundation

/// 远程 skill 调用错误 — Phase 3.3 通用错误类型，所有 typed skill commands
/// (Clipboard / File / Screenshot / SystemInfo) 共用。
public enum RemoteSkillError: Error, Equatable, Sendable {
    /// 通信层错误（DC + signaling 都失败 / timeout）— 透传 caller 见的下层 message。
    case transportFailed(String)

    /// 桌面端返 error response（如 "permission denied" / "shell not found"）。
    case remoteError(reqId: String, message: String)

    /// 响应 JSON 解码失败（schema 不对 / 字段缺失）。
    case malformedResult(String)

    /// 用户未提供必要参数（如 clipboard.set 内容空）。
    case invalidArgument(String)
}

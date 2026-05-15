import Foundation

/// `TerminalRpcClient` 数据模型 — Phase 2.2。字段与 Android `TerminalRpcClient`
/// data class 1:1 对齐（design doc §3.2 method 列表的 result 形状）。

/// `terminal.create` 返回。
public struct CreatedSession: Sendable, Equatable {
    public let sessionId: String
    public let pid: Int
    public let shell: String
    public let createdAt: Int64

    public init(sessionId: String, pid: Int, shell: String, createdAt: Int64) {
        self.sessionId = sessionId
        self.pid = pid
        self.shell = shell
        self.createdAt = createdAt
    }
}

/// `terminal.list` 返回单条。
public struct SessionRow: Sendable, Equatable, Identifiable {
    public let id: String          // = sessionId
    public let shell: String
    public let cwd: String?
    public let alive: Bool
    public let lastSeq: Int64

    public init(id: String, shell: String, cwd: String?, alive: Bool, lastSeq: Int64) {
        self.id = id
        self.shell = shell
        self.cwd = cwd
        self.alive = alive
        self.lastSeq = lastSeq
    }
}

/// `terminal.stdout` push event。
public struct StdoutEvent: Sendable, Equatable {
    public let sessionId: String
    public let data: String       // utf-8 plain，不 base64
    public let seq: Int64

    public init(sessionId: String, data: String, seq: Int64) {
        self.sessionId = sessionId
        self.data = data
        self.seq = seq
    }
}

/// `terminal.exit` push event。
public struct ExitEvent: Sendable, Equatable {
    public let sessionId: String
    public let exitCode: Int?
    public let signal: String?

    public init(sessionId: String, exitCode: Int?, signal: String?) {
        self.sessionId = sessionId
        self.exitCode = exitCode
        self.signal = signal
    }
}

/// `terminal.history` 返回的单 chunk。
public struct HistoryChunk: Sendable, Equatable {
    public let seq: Int64
    public let data: String

    public init(seq: Int64, data: String) {
        self.seq = seq
        self.data = data
    }
}

/// `terminal.history` 完整返回。
public struct HistoryResponse: Sendable, Equatable {
    public let chunks: [HistoryChunk]
    public let truncated: Bool

    public init(chunks: [HistoryChunk], truncated: Bool) {
        self.chunks = chunks
        self.truncated = truncated
    }
}

/// `TerminalRpcClient.invoke` 返回 — 含 reqId + raw result/error。
/// caller (六个 method wrapper) 用 [TerminalRpcEnvelope] 帮手解码到上面的
/// 强类型 struct。
public enum TerminalRpcResponse: Sendable, Equatable {
    case success(reqId: String, resultJson: String)
    case failure(reqId: String, errorMessage: String)
}

/// `TerminalRpcClient` 调用错误。
public enum TerminalRpcError: Error, Equatable, Sendable {
    /// 响应超时（默认 30s）。
    case timeout(reqId: String)
    /// DC + signaling 路径都失败。
    case allTransportsFailed(lastError: String)
    /// 响应里 result 缺必需字段。
    case malformedResult(reqId: String, detail: String)
    /// desktop 端返了 error 字段。
    case remoteError(reqId: String, message: String)
}

import Foundation

/// 远程终端 RPC 客户端 — Phase 2.2 + Phase 3.3 refactor。
///
/// **Phase 3.3 改动**（与 Phase 2 设计的关键差异）：
/// - 删除 invoke / dispatchSend / pendingResponses / failPending — Phase 3.1
///   抽出的 `RemoteCommandClient` 接管所有通用 RPC 工作
/// - 删除 inboundMessages 直接订阅（commandClient 现在是 webRTCClient.
///   inboundMessages 的唯一订阅者，避免 AsyncStream 单消费者切分事件）
/// - 改为订阅 `commandClient.events` 流，仅处理 chainlesschain:event 类型
///   (terminal.stdout / terminal.exit)
/// - 6 个 method wrapper 内部委托 `commandClient.invoke(...)`
///
/// **保留**：LRU dedup (stdout 按 (sessionId, seq) / exit 按 sessionId) +
/// stdoutEvents/exitEvents AsyncStream 输出 + start/stop lifecycle。
///
/// **wire 协议**：完全不变，仍是 `chainlesschain:command:request/response/event`。
public actor TerminalRpcClient {

    // Deps
    private let commandClient: RemoteCommandClient
    private let eventStream: AsyncStream<String>  // commandClient.events

    // State
    private var seenStdoutKeys = LRUSet<String>(capacity: 256)
    private var seenExitKeys = LRUSet<String>(capacity: 64)
    private var inboundTask: Task<Void, Never>?

    // AsyncStream outputs
    private let stdoutContinuation: AsyncStream<StdoutEvent>.Continuation
    private let exitContinuation: AsyncStream<ExitEvent>.Continuation

    public nonisolated let stdoutEvents: AsyncStream<StdoutEvent>
    public nonisolated let exitEvents: AsyncStream<ExitEvent>

    // MARK: Init

    public init(
        commandClient: RemoteCommandClient,
        eventStream: AsyncStream<String>
    ) {
        self.commandClient = commandClient
        self.eventStream = eventStream

        var stdoutLocal: AsyncStream<StdoutEvent>.Continuation!
        self.stdoutEvents = AsyncStream(bufferingPolicy: .bufferingNewest(256)) { c in stdoutLocal = c }
        self.stdoutContinuation = stdoutLocal

        var exitLocal: AsyncStream<ExitEvent>.Continuation!
        self.exitEvents = AsyncStream(bufferingPolicy: .bufferingNewest(32)) { c in exitLocal = c }
        self.exitContinuation = exitLocal
    }

    // MARK: Lifecycle

    /// 启动 event 监听。caller 应在创建后调一次（与 Android `TerminalRpcClient.start`
    /// 对齐）。idempotent — 重复调忽略后续。
    public func start() {
        guard inboundTask == nil else { return }
        let stream = eventStream
        inboundTask = Task { [weak self] in
            for await raw in stream {
                await self?.handleEvent(raw)
            }
        }
    }

    /// 停止 event 监听。
    public func stop() {
        inboundTask?.cancel()
        inboundTask = nil
    }

    // MARK: Public — 6 method wrappers (delegate to commandClient.invoke)

    public func create(pcPeerId: String, shell: String, mobileDid: String? = nil) async throws -> CreatedSession {
        let resp = try await commandClient.invoke(pcPeerId: pcPeerId, method: "terminal.create", params: ["shell": shell], mobileDid: mobileDid)
        let json = try resultJsonOrThrow(resp)
        return try TerminalRpcEnvelope.decodeCreatedSession(json)
    }

    public func list(pcPeerId: String, mobileDid: String? = nil) async throws -> [SessionRow] {
        let resp = try await commandClient.invoke(pcPeerId: pcPeerId, method: "terminal.list", params: [:], mobileDid: mobileDid)
        let json = try resultJsonOrThrow(resp)
        return try TerminalRpcEnvelope.decodeSessionList(json)
    }

    public func stdin(pcPeerId: String, sessionId: String, data: String, mobileDid: String? = nil) async throws {
        let resp = try await commandClient.invoke(pcPeerId: pcPeerId, method: "terminal.stdin", params: ["sessionId": sessionId, "data": data], mobileDid: mobileDid)
        let json = try resultJsonOrThrow(resp)
        let ok = try TerminalRpcEnvelope.decodeOk(json)
        if !ok {
            throw TerminalRpcError.malformedResult(reqId: resp.reqId, detail: "stdin returned ok=false")
        }
    }

    public func resize(pcPeerId: String, sessionId: String, cols: Int, rows: Int, mobileDid: String? = nil) async throws {
        let resp = try await commandClient.invoke(pcPeerId: pcPeerId, method: "terminal.resize", params: ["sessionId": sessionId, "cols": cols, "rows": rows], mobileDid: mobileDid)
        let json = try resultJsonOrThrow(resp)
        _ = try TerminalRpcEnvelope.decodeOk(json)
    }

    public func close(pcPeerId: String, sessionId: String, mobileDid: String? = nil) async throws {
        let resp = try await commandClient.invoke(pcPeerId: pcPeerId, method: "terminal.close", params: ["sessionId": sessionId], mobileDid: mobileDid)
        let json = try resultJsonOrThrow(resp)
        _ = try TerminalRpcEnvelope.decodeOk(json)
    }

    public func history(pcPeerId: String, sessionId: String, fromSeq: Int64? = nil, mobileDid: String? = nil) async throws -> HistoryResponse {
        var params: [String: Any] = ["sessionId": sessionId]
        if let fromSeq = fromSeq {
            params["fromSeq"] = fromSeq
        }
        let resp = try await commandClient.invoke(pcPeerId: pcPeerId, method: "terminal.history", params: params, mobileDid: mobileDid)
        let json = try resultJsonOrThrow(resp)
        return try TerminalRpcEnvelope.decodeHistoryResponse(json)
    }

    // MARK: Private

    private func handleEvent(_ raw: String) {
        let frame = TerminalRpcEnvelope.parseInbound(raw)
        switch frame {
        case .stdout(let event):
            let key = "\(event.sessionId)|\(event.seq)"
            if seenStdoutKeys.insert(key) {
                stdoutContinuation.yield(event)
            }
        case .exit(let event):
            let key = "\(event.sessionId)|exit"
            if seenExitKeys.insert(key) {
                exitContinuation.yield(event)
            }
        case .commandResponse, .unknown:
            // commandResponse 已被 commandClient 路由到 pending pool，不该到这
            // unknown 类型忽略
            break
        }
    }

    private func resultJsonOrThrow(_ resp: TerminalRpcResponse) throws -> String {
        switch resp {
        case .success(_, let json):
            return json
        case .failure(let reqId, let msg):
            throw TerminalRpcError.remoteError(reqId: reqId, message: msg)
        }
    }
}

// MARK: - Convenience accessors

private extension TerminalRpcResponse {
    var reqId: String {
        switch self {
        case .success(let id, _), .failure(let id, _): return id
        }
    }
}

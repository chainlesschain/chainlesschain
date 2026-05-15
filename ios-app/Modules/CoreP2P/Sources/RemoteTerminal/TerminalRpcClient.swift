import Foundation

/// 远程终端 RPC 客户端 — Phase 2.2。
///
/// 镜像 Android `TerminalRpcClient.kt` 1:1（design doc §3.2 / §5.2）：
/// - `invoke()` 双路径 routing：DC ready + flag → DC 优先；DC 失败/不可用 →
///   signaling fallback（同 reqId 池，响应不论从哪条路回都能匹配）
/// - 6 个 method wrapper：create / list / stdin / resize / close / history
/// - LRU dedup：stdout 按 (sessionId, seq)，exit 按 sessionId
/// - 双路监听：DC 入站 + signaling forward 入站统一通过 [inboundMessages]
///   AsyncStream（caller 由 RemoteWebRTCClient 提供）
///
/// **依赖注入设计**：closures 而非具体类型，让单测注入 fake 干净
/// （wired by `Phase 2.4 RemoteDependencies` 时关联到真 `RemoteWebRTCClient`
/// + `PairingSignalingGate`）。
public actor TerminalRpcClient {

    public typealias DataChannelSender = @Sendable (String) async throws -> Void
    public typealias SignalingSender = @Sendable (String /*pcPeerId*/, String /*envelopeJson*/) async throws -> Void
    public typealias DataChannelReadinessProvider = @Sendable () async -> Bool
    public typealias UuidGenerator = @Sendable () -> String

    // Deps
    private let dataChannelSender: DataChannelSender
    private let signalingSender: SignalingSender
    private let isDataChannelReady: DataChannelReadinessProvider
    private let inboundMessages: AsyncStream<String>
    private let featureFlags: PlanA1FeatureFlags
    private let uuidGen: UuidGenerator
    private let responseTimeoutSeconds: UInt64

    // State
    private var pendingResponses: [String: CheckedContinuation<TerminalRpcResponse, Error>] = [:]
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
        dataChannelSender: @escaping DataChannelSender,
        signalingSender: @escaping SignalingSender,
        isDataChannelReady: @escaping DataChannelReadinessProvider,
        inboundMessages: AsyncStream<String>,
        featureFlags: PlanA1FeatureFlags = PlanA1FeatureFlags(),
        responseTimeoutSeconds: UInt64 = 30,
        uuidGen: @escaping UuidGenerator = { UUID().uuidString }
    ) {
        self.dataChannelSender = dataChannelSender
        self.signalingSender = signalingSender
        self.isDataChannelReady = isDataChannelReady
        self.inboundMessages = inboundMessages
        self.featureFlags = featureFlags
        self.responseTimeoutSeconds = responseTimeoutSeconds
        self.uuidGen = uuidGen

        var stdoutLocal: AsyncStream<StdoutEvent>.Continuation!
        self.stdoutEvents = AsyncStream(bufferingPolicy: .bufferingNewest(256)) { c in stdoutLocal = c }
        self.stdoutContinuation = stdoutLocal

        var exitLocal: AsyncStream<ExitEvent>.Continuation!
        self.exitEvents = AsyncStream(bufferingPolicy: .bufferingNewest(32)) { c in exitLocal = c }
        self.exitContinuation = exitLocal
    }

    // MARK: Lifecycle

    /// 启动入站消息监听。caller 应在创建后调一次（与 Android `TerminalRpcClient.start`
    /// 对齐）。idempotent — 重复调忽略后续。
    public func start() {
        guard inboundTask == nil else { return }
        let stream = inboundMessages
        inboundTask = Task { [weak self] in
            for await raw in stream {
                await self?.handleInbound(raw)
            }
        }
    }

    /// 停止入站监听 + cancel 所有 pending continuations。
    public func stop() {
        inboundTask?.cancel()
        inboundTask = nil
        for (_, cont) in pendingResponses {
            cont.resume(throwing: TerminalRpcError.allTransportsFailed(lastError: "stopped"))
        }
        pendingResponses.removeAll()
    }

    // MARK: Public — invoke (lower level)

    /// 通用 RPC 入口。caller 通常用下面 6 个 method wrapper；本方法暴露给
    /// Phase 2.4+ 自定义 method 用。
    public func invoke(
        pcPeerId: String,
        method: String,
        params: [String: Any],
        mobileDid: String? = nil
    ) async throws -> TerminalRpcResponse {
        let reqId = uuidGen()
        let envelopeJson = try TerminalRpcEnvelope.buildCommandRequest(
            id: reqId,
            method: method,
            params: params,
            mobileDid: mobileDid
        )

        // 注册 pending 先于 send，避免响应先到导致漏 emit
        let response: TerminalRpcResponse = try await withThrowingTaskGroup(of: TerminalRpcResponse.self) { group in
            group.addTask { [self] in
                try await withCheckedThrowingContinuation { cont in
                    Task { await self.registerPending(reqId: reqId, cont: cont) }
                    Task { await self.dispatchSend(reqId: reqId, pcPeerId: pcPeerId, envelopeJson: envelopeJson) }
                }
            }
            group.addTask { [self] in
                try await Task.sleep(nanoseconds: self.responseTimeoutSeconds * 1_000_000_000)
                throw TerminalRpcError.timeout(reqId: reqId)
            }
            guard let result = try await group.next() else {
                throw TerminalRpcError.timeout(reqId: reqId)
            }
            group.cancelAll()
            return result
        }

        return response
    }

    // MARK: Public — 6 method wrappers

    public func create(pcPeerId: String, shell: String, mobileDid: String? = nil) async throws -> CreatedSession {
        let resp = try await invoke(pcPeerId: pcPeerId, method: "terminal.create", params: ["shell": shell], mobileDid: mobileDid)
        let json = try resultJsonOrThrow(resp)
        return try TerminalRpcEnvelope.decodeCreatedSession(json)
    }

    public func list(pcPeerId: String, mobileDid: String? = nil) async throws -> [SessionRow] {
        let resp = try await invoke(pcPeerId: pcPeerId, method: "terminal.list", params: [:], mobileDid: mobileDid)
        let json = try resultJsonOrThrow(resp)
        return try TerminalRpcEnvelope.decodeSessionList(json)
    }

    public func stdin(pcPeerId: String, sessionId: String, data: String, mobileDid: String? = nil) async throws {
        let resp = try await invoke(pcPeerId: pcPeerId, method: "terminal.stdin", params: ["sessionId": sessionId, "data": data], mobileDid: mobileDid)
        let json = try resultJsonOrThrow(resp)
        let ok = try TerminalRpcEnvelope.decodeOk(json)
        if !ok {
            throw TerminalRpcError.malformedResult(reqId: resp.reqId, detail: "stdin returned ok=false")
        }
    }

    public func resize(pcPeerId: String, sessionId: String, cols: Int, rows: Int, mobileDid: String? = nil) async throws {
        let resp = try await invoke(pcPeerId: pcPeerId, method: "terminal.resize", params: ["sessionId": sessionId, "cols": cols, "rows": rows], mobileDid: mobileDid)
        let json = try resultJsonOrThrow(resp)
        _ = try TerminalRpcEnvelope.decodeOk(json)
    }

    public func close(pcPeerId: String, sessionId: String, mobileDid: String? = nil) async throws {
        let resp = try await invoke(pcPeerId: pcPeerId, method: "terminal.close", params: ["sessionId": sessionId], mobileDid: mobileDid)
        let json = try resultJsonOrThrow(resp)
        _ = try TerminalRpcEnvelope.decodeOk(json)
    }

    public func history(pcPeerId: String, sessionId: String, fromSeq: Int64? = nil, mobileDid: String? = nil) async throws -> HistoryResponse {
        var params: [String: Any] = ["sessionId": sessionId]
        if let fromSeq = fromSeq {
            params["fromSeq"] = fromSeq
        }
        let resp = try await invoke(pcPeerId: pcPeerId, method: "terminal.history", params: params, mobileDid: mobileDid)
        let json = try resultJsonOrThrow(resp)
        return try TerminalRpcEnvelope.decodeHistoryResponse(json)
    }

    // MARK: Private

    private func registerPending(reqId: String, cont: CheckedContinuation<TerminalRpcResponse, Error>) {
        pendingResponses[reqId] = cont
    }

    /// DC 优先 + signaling fallback。失败时 cleanup pending 并 resume continuation
    /// 抛 [TerminalRpcError.allTransportsFailed]。
    private func dispatchSend(reqId: String, pcPeerId: String, envelopeJson: String) async {
        var lastError: String = "unknown"
        // 试 DC
        let dcReady = await isDataChannelReady() && featureFlags.preferDataChannel
        if dcReady {
            do {
                try await dataChannelSender(envelopeJson)
                return  // success — wait for response on continuation
            } catch {
                lastError = "DC: \((error as NSError).localizedDescription)"
                if !featureFlags.fallbackOnDcFailure {
                    failPending(reqId: reqId, message: lastError)
                    return
                }
                // 落到 signaling
            }
        }
        // signaling fallback
        do {
            try await signalingSender(pcPeerId, envelopeJson)
        } catch {
            lastError = "signaling: \((error as NSError).localizedDescription)"
            failPending(reqId: reqId, message: lastError)
        }
    }

    private func failPending(reqId: String, message: String) {
        if let cont = pendingResponses.removeValue(forKey: reqId) {
            cont.resume(throwing: TerminalRpcError.allTransportsFailed(lastError: message))
        }
    }

    private func handleInbound(_ raw: String) {
        let frame = TerminalRpcEnvelope.parseInbound(raw)
        switch frame {
        case .commandResponse(let reqId, let resultJson, let errorMessage):
            guard let cont = pendingResponses.removeValue(forKey: reqId) else {
                // 重复响应 / late arrival — 静默忽略（与 Android 同行为）
                return
            }
            if let err = errorMessage {
                cont.resume(returning: .failure(reqId: reqId, errorMessage: err))
            } else {
                cont.resume(returning: .success(reqId: reqId, resultJson: resultJson ?? "{}"))
            }
        case .stdout(let event):
            let key = "\(event.sessionId)|\(event.seq)"
            if seenStdoutKeys.insert(key) {
                stdoutContinuation.yield(event)
            }
            // 重复入忽略
        case .exit(let event):
            let key = "\(event.sessionId)|exit"
            if seenExitKeys.insert(key) {
                exitContinuation.yield(event)
            }
        case .unknown:
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

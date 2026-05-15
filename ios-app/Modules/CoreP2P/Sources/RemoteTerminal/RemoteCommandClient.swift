import Foundation

/// 通用远程命令 RPC 客户端 — Phase 3.1。
///
/// 从 Phase 2 `TerminalRpcClient.invoke` 抽出独立 actor，让 4 + N 个 skill
/// commands wrapper（ClipboardCommands / FileCommands / ...）共享同一个 invoke
/// 池 + DC/signaling 双路径 routing + LRU dedup + pending pool。
///
/// **wire 协议**：与 Phase 2 完全相同（`chainlesschain:command:request/response`），
/// 只是 method 名 + params shape 因 skill 而异。
///
/// **架构关系**：
/// - Phase 3.1 (本)：作为 sibling 与 TerminalRpcClient 共存，未替换其内部 invoke
/// - Phase 3.6 (refactor)：TerminalRpcClient.invoke 改 delegate 到本类，避免代码重复
///
/// **events stream**：所有非 `command:response` 的入站 envelope（如
/// `chainlesschain:event` terminal.stdout / clipboard.changed 等）yield 到
/// [events] 流。caller 订阅按需 dispatch。
///
/// **依赖注入**：closures (与 TerminalRpcClient 同模式)，单测注入 fake 干净。
public actor RemoteCommandClient {

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
    private var inboundTask: Task<Void, Never>?

    // 事件流 — 非 response 的入站 envelope 全部 yield 到此（caller 按 type / payload.event 分发）
    private let eventsContinuation: AsyncStream<String>.Continuation
    public nonisolated let events: AsyncStream<String>

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

        var local: AsyncStream<String>.Continuation!
        self.events = AsyncStream(bufferingPolicy: .bufferingNewest(256)) { c in local = c }
        self.eventsContinuation = local
    }

    // MARK: - Lifecycle

    /// 起 inbound 监听。idempotent。
    public func start() {
        guard inboundTask == nil else { return }
        let stream = inboundMessages
        inboundTask = Task { [weak self] in
            for await raw in stream {
                await self?.handleInbound(raw)
            }
        }
    }

    /// 停 inbound 监听 + cancel 所有 pending continuation。
    public func stop() {
        inboundTask?.cancel()
        inboundTask = nil
        for (_, cont) in pendingResponses {
            cont.resume(throwing: TerminalRpcError.allTransportsFailed(lastError: "stopped"))
        }
        pendingResponses.removeAll()
    }

    // MARK: - Public RPC

    /// 通用 RPC 入口。caller 通常不直接调本方法 — 而是用 typed wrapper
    /// (ClipboardCommands.get / FileCommands.list / ...)。
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

    // MARK: - Internals

    private func registerPending(reqId: String, cont: CheckedContinuation<TerminalRpcResponse, Error>) {
        pendingResponses[reqId] = cont
    }

    /// DC 优先 + signaling fallback。失败时 cleanup pending 并 resume 抛
    /// [TerminalRpcError.allTransportsFailed]。
    private func dispatchSend(reqId: String, pcPeerId: String, envelopeJson: String) async {
        var lastError: String = "unknown"
        let dcReady = await isDataChannelReady() && featureFlags.preferDataChannel
        if dcReady {
            do {
                try await dataChannelSender(envelopeJson)
                return  // success — 等响应 on continuation
            } catch {
                lastError = "DC: \((error as NSError).localizedDescription)"
                if !featureFlags.fallbackOnDcFailure {
                    failPending(reqId: reqId, message: lastError)
                    return
                }
                // 落到 signaling
            }
        }
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
                return  // 重复响应 / late arrival — 静默忽略
            }
            if let err = errorMessage {
                cont.resume(returning: .failure(reqId: reqId, errorMessage: err))
            } else {
                cont.resume(returning: .success(reqId: reqId, resultJson: resultJson ?? "{}"))
            }
        case .stdout, .exit:
            // 把整条 raw envelope yield 到 events 流，caller (TerminalRpcClient /
            // 其它 skill events listener) 自己 parse + dispatch。
            eventsContinuation.yield(raw)
        case .unknown:
            // 也 yield — 让 caller 看到未知 type，便于诊断
            eventsContinuation.yield(raw)
        }
    }
}

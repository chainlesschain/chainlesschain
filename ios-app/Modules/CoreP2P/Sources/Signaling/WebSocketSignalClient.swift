import Foundation

/// `SignalClient` 的 production 实现 — Phase 1.2。
///
/// 镜像 Android `app/.../remote/webrtc/WebRTCClient.kt` 的 `WebSocketSignalClient`
/// (line 596+)，wire protocol 完全对齐 `signaling-server/index.js` (line 165+)。
///
/// **关键不变量（Plan A.1 echo-loop bug 防御）**：`currentPeerId` 仅在 [register]
/// 内赋值；任何 `send*` 方法都禁止 `currentPeerId = peerId`（peerId 是 target 不是
/// self）。grep `currentPeerId\s*=` 必须只命中 register。
///
/// **iOS 特化的 3 处 OkHttp gap 自实现**（design doc §6.2）：
/// 1. 自动重连：onClose / receive() 抛 closed 时按指数退避重连（500ms→1s→2s→5s→10s 上限）
/// 2. WS 帧级 ping：30s 周期由本类主动调 transport.sendPing()
/// 3. 递归 receive：内部 receiveLoop Task 收一条立即再 receive，无停顿
///
/// **重连后自动重发 register**（line 666-683 of Android）：保存 lastRegisterPayload，
/// 重连成功后无需调用方再调 register。
public actor WebSocketSignalClient: SignalClient {
    private let signalingConfig: SignalingConfig
    private let messageBus: PairingMessageBus
    private let transportFactory: () -> WebSocketTransport
    private let backoff: ReconnectBackoff
    private let pingIntervalSeconds: UInt64

    private var transport: WebSocketTransport?
    private var receiveLoopTask: Task<Void, Never>?
    private var pingLoopTask: Task<Void, Never>?

    /// **owner 唯一是 register()**。任何其它路径写入都属于 Plan A.1 echo-loop bug。
    private var currentPeerId: String?
    private var lastDeviceInfo: [String: String]?

    private var explicitlyClosed = false

    public init(
        signalingConfig: SignalingConfig,
        messageBus: PairingMessageBus,
        transportFactory: @escaping () -> WebSocketTransport = { URLSessionWebSocketTransport() },
        backoff: ReconnectBackoff = .standard,
        pingIntervalSeconds: UInt64 = 25
    ) {
        self.signalingConfig = signalingConfig
        self.messageBus = messageBus
        self.transportFactory = transportFactory
        self.backoff = backoff
        self.pingIntervalSeconds = pingIntervalSeconds
    }

    // MARK: SignalClient

    public func connect() async throws {
        if let t = transport, t.isOpen {
            return  // idempotent
        }
        explicitlyClosed = false
        try await openOnce()
    }

    public func disconnect() async {
        explicitlyClosed = true
        receiveLoopTask?.cancel()
        pingLoopTask?.cancel()
        transport?.close()
        transport = nil
        receiveLoopTask = nil
        pingLoopTask = nil
        currentPeerId = nil
        lastDeviceInfo = nil
    }

    public func register(peerId: String, metadata: [String: String]) async throws {
        // 唯一允许写 currentPeerId 的地方
        currentPeerId = peerId
        lastDeviceInfo = metadata
        try await sendRegisterMessage(peerId: peerId, deviceInfo: metadata)
    }

    public func sendForwardedMessage(toPeerId: String, payload: [String: Any]) async throws {
        // ⚠️ DO NOT touch currentPeerId here — toPeerId is target, not self
        guard let transport = transport, transport.isOpen else {
            throw WebSocketTransportError.notConnected
        }
        let envelope: [String: Any] = [
            "type": "message",
            "to": toPeerId,
            "payload": payload
        ]
        let json = try Self.encodeJSON(envelope)
        try await transport.send(text: json)
    }

    // MARK: Internals

    private func openOnce() async throws {
        let urlString = signalingConfig.getCustomSignalingUrl() ?? signalingConfig.getRelayUrl()
        guard let url = URL(string: urlString) else {
            throw WebSocketTransportError.notConnected
        }
        let t = transportFactory()
        try await t.connect(to: url)
        transport = t

        // 启动 receive loop
        receiveLoopTask?.cancel()
        receiveLoopTask = Task { [weak self] in
            await self?.receiveLoop()
        }

        // 启动 ping loop（WS 帧级）
        pingLoopTask?.cancel()
        pingLoopTask = Task { [weak self] in
            await self?.pingLoop()
        }

        // 重连后自动重发 register（line 666-683 Android 对齐）
        if let pid = currentPeerId, let info = lastDeviceInfo {
            try? await sendRegisterMessage(peerId: pid, deviceInfo: info)
        }
    }

    private func sendRegisterMessage(peerId: String, deviceInfo: [String: String]) async throws {
        guard let transport = transport, transport.isOpen else {
            throw WebSocketTransportError.notConnected
        }
        let envelope: [String: Any] = [
            "type": "register",
            "peerId": peerId,
            "deviceType": "mobile",
            "deviceInfo": deviceInfo
        ]
        let json = try Self.encodeJSON(envelope)
        try await transport.send(text: json)
    }

    private func receiveLoop() async {
        while !Task.isCancelled, let transport = transport, transport.isOpen {
            do {
                let text = try await transport.receive()
                handleIncoming(text: text)
            } catch {
                // 连接中断 — 触发自动重连（除非用户显式 disconnect）
                if !explicitlyClosed {
                    await scheduleReconnect()
                }
                return
            }
        }
    }

    private func pingLoop() async {
        while !Task.isCancelled, let transport = transport, transport.isOpen {
            do {
                try await Task.sleep(nanoseconds: pingIntervalSeconds * 1_000_000_000)
            } catch { return }  // task cancelled
            guard let transport = self.transport, transport.isOpen else { return }
            do {
                try await transport.sendPing()
            } catch {
                // ping 失败一次不算挂；下一次循环若 socket 真断会从 receive 路径触发重连
            }
        }
    }

    private func scheduleReconnect() async {
        guard !explicitlyClosed else { return }
        for attempt in 0..<backoff.maxAttempts {
            if explicitlyClosed { return }
            let delayMs = backoff.delayMillis(attempt: attempt)
            try? await Task.sleep(nanoseconds: UInt64(delayMs) * 1_000_000)
            if explicitlyClosed { return }
            do {
                try await openOnce()
                return  // 重连成功（openOnce 已自动重发 register）
            } catch {
                continue
            }
        }
    }

    private func handleIncoming(text: String) {
        guard let data = text.data(using: .utf8),
              let raw = try? JSONSerialization.jsonObject(with: data),
              let json = raw as? [String: Any],
              let type = json["type"] as? String else {
            return
        }
        switch type {
        case "registered", "pong":
            // ack 类型，无需上层动作
            break
        case "message":
            // 检查 payload 是不是 pairing:confirmation；是则路由到 messageBus
            guard let payload = json["payload"] as? [String: Any] else { return }
            if payload["type"] as? String == "pairing:confirmation" {
                routePairingConfirmation(payload: payload)
            }
            // 非 pairing payload：Phase 1 不处理（Phase 2+ 远程终端会扩展为多订阅）
        case "peer-offline", "error", "peer-status", "offline-message":
            // Phase 1 不处理；保留 type 走 default 不让 noisy log
            break
        default:
            break
        }
    }

    private func routePairingConfirmation(payload: [String: Any]) {
        guard let pairingCode = payload["pairingCode"] as? String,
              let pcPeerId = payload["pcPeerId"] as? String,
              !pairingCode.isEmpty, !pcPeerId.isEmpty else {
            return
        }
        let timestamp = (payload["timestamp"] as? Int64)
            ?? Int64(payload["timestamp"] as? Int ?? 0)
        let deviceInfo = (payload["deviceInfo"] as? [String: Any])?.compactMapValues { $0 as? String }
        let confirmation = PairingConfirmation(
            pairingCode: pairingCode,
            pcPeerId: pcPeerId,
            deviceInfo: deviceInfo,
            timestamp: timestamp
        )
        messageBus.emit(confirmation)
    }

    private static func encodeJSON(_ obj: [String: Any]) throws -> String {
        let data = try JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys])
        guard let s = String(data: data, encoding: .utf8) else {
            throw WebSocketTransportError.notConnected
        }
        return s
    }
}

/// 重连退避策略。生产用 [.standard]（500ms / 1s / 2s / 5s / 10s 上限，最多 10 次）。
public struct ReconnectBackoff: Sendable {
    public let initialDelayMs: Int
    public let maxDelayMs: Int
    public let multiplier: Double
    public let maxAttempts: Int

    public init(initialDelayMs: Int, maxDelayMs: Int, multiplier: Double, maxAttempts: Int) {
        self.initialDelayMs = initialDelayMs
        self.maxDelayMs = maxDelayMs
        self.multiplier = multiplier
        self.maxAttempts = maxAttempts
    }

    public static let standard = ReconnectBackoff(
        initialDelayMs: 500,
        maxDelayMs: 10_000,
        multiplier: 2.0,
        maxAttempts: 10
    )

    public func delayMillis(attempt: Int) -> Int {
        let raw = Double(initialDelayMs) * pow(multiplier, Double(attempt))
        return min(Int(raw), maxDelayMs)
    }
}

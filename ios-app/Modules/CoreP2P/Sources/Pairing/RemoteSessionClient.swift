import Foundation
import CcAgentProtocol

/// Canonical schema-generated decision used by the Remote Session wire API.
public typealias RemoteApprovalDecision = CcAgentProtocol.ApprovalDecision

/// iOS port of the Android `RemoteSessionClient` — WebSocket relay connection +
/// E2EE pairing handshake. This is the protocol-driven core (transport injected),
/// so it is fully unit-testable with a fake socket. Auto-reconnect + status
/// streams beyond callbacks are follow-up slices; the wire protocol
/// (register → pair.join → pair.accepted → encrypted control/events) matches
/// `RemoteSessionClient.kt` and the desktop relay exactly.

public enum RemoteSessionStatus: String, Sendable, Equatable {
    case idle
    case connecting
    case pairing
    case connected
    case reconnecting
    case disconnected
    case revoked
    case error
}

public struct RemoteSessionReconnectPolicy: Sendable, Equatable {
    public let maximumAttempts: Int
    public let initialDelaySeconds: TimeInterval
    public let maximumDelaySeconds: TimeInterval

    public init(
        maximumAttempts: Int = 5,
        initialDelaySeconds: TimeInterval = 1,
        maximumDelaySeconds: TimeInterval = 30
    ) {
        precondition(maximumAttempts >= 0)
        precondition(initialDelaySeconds >= 0)
        precondition(maximumDelaySeconds >= initialDelaySeconds)
        self.maximumAttempts = maximumAttempts
        self.initialDelaySeconds = initialDelaySeconds
        self.maximumDelaySeconds = maximumDelaySeconds
    }

    fileprivate func delay(forAttempt attempt: Int) -> TimeInterval {
        guard attempt > 1 else { return initialDelaySeconds }
        return min(
            maximumDelaySeconds,
            initialDelaySeconds * pow(2, Double(attempt - 1))
        )
    }
}

public typealias RemoteSessionReconnectScheduler =
    (_ delaySeconds: TimeInterval, _ action: @escaping () -> Void) -> Void

/// A decrypted inbound Remote Session event. Known Agent stream events expose
/// their schema-generated envelope while `json` preserves the complete payload,
/// including additive future event types this client does not know yet.
public struct RemoteSessionEvent: Sendable, Equatable {
    public let type: String
    public let json: String
    public let agentStreamEnvelope: CcAgentProtocol.AgentStreamEventEnvelope?

    public init(type: String, json: String) {
        self.type = type
        self.json = json
        if let data = json.data(using: .utf8),
           let envelope = try? JSONDecoder().decode(
               CcAgentProtocol.AgentStreamEventEnvelope.self,
               from: data
           ),
           envelope.type.rawValue == type {
            agentStreamEnvelope = envelope
        } else {
            agentStreamEnvelope = nil
        }
    }

    public static func == (lhs: RemoteSessionEvent, rhs: RemoteSessionEvent) -> Bool {
        // The typed envelope is deterministically derived from the preserved
        // JSON, so retain the struct's existing wire-level equality semantics.
        lhs.type == rhs.type && lhs.json == rhs.json
    }
}

/// Minimal WebSocket surface the client drives — mirrors okhttp's `WebSocket`.
public protocol RemoteSessionWebSocket: AnyObject {
    func send(_ text: String)
    func close(code: Int, reason: String)
}

/// Callbacks the transport delivers back to the client — mirrors okhttp's
/// `WebSocketListener`.
public protocol RemoteSessionWebSocketListener: AnyObject {
    func webSocketDidOpen(_ socket: RemoteSessionWebSocket)
    func webSocket(_ socket: RemoteSessionWebSocket, didReceiveText text: String)
    func webSocket(_ socket: RemoteSessionWebSocket, didCloseWithCode code: Int, reason: String)
    func webSocket(_ socket: RemoteSessionWebSocket, didFailWithError error: Error?)
}

public typealias RemoteSessionWebSocketFactory =
    (_ url: String, _ listener: RemoteSessionWebSocketListener) -> RemoteSessionWebSocket

/// Not thread-safe by design (mirrors the Android client): the transport is
/// expected to deliver listener callbacks on one queue, and public methods are
/// called from the same context. The app layer serializes (e.g. @MainActor).
public final class RemoteSessionClient: RemoteSessionWebSocketListener {

    private let webSocketFactory: RemoteSessionWebSocketFactory
    private let peerIdFactory: () -> String
    private let reconnectPolicy: RemoteSessionReconnectPolicy
    private let reconnectScheduler: RemoteSessionReconnectScheduler

    public var onStatusChange: ((RemoteSessionStatus) -> Void)?
    public var onEvent: ((RemoteSessionEvent) -> Void)?
    public var onError: ((String) -> Void)?

    public private(set) var status: RemoteSessionStatus = .idle {
        didSet { if oldValue != status { onStatusChange?(status) } }
    }

    private var socket: RemoteSessionWebSocket?
    private var pairing: RemoteSessionPairing?
    private var crypto: RemoteSessionCrypto?
    private var peerId: String?
    private var paired = false
    private var closedExplicitly = false
    private var reconnectAttempt = 0
    private var reconnectGeneration = 0

    // Optional vendor-push credentials — ride in the encrypted pair.join so the
    // host can wake this device while backgrounded (sourced by the app layer via
    // RemoteSessionPushTokenResolver, then handed here).
    private var pushToken: String?
    private var pushProvider: String?

    public var currentPairing: RemoteSessionPairing? { pairing }
    public var localPeerId: String? { peerId }

    public init(
        webSocketFactory: @escaping RemoteSessionWebSocketFactory,
        peerIdFactory: @escaping () -> String = { "ios-\(UUID().uuidString)" },
        reconnectPolicy: RemoteSessionReconnectPolicy = .init(),
        reconnectScheduler: @escaping RemoteSessionReconnectScheduler = { delay, action in
            DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: action)
        }
    ) {
        self.webSocketFactory = webSocketFactory
        self.peerIdFactory = peerIdFactory
        self.reconnectPolicy = reconnectPolicy
        self.reconnectScheduler = reconnectScheduler
    }

    // MARK: Push credentials

    public func setPushCredentials(token: String?, provider: String? = nil) {
        let trimmed = token?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let trimmed, !trimmed.isEmpty {
            pushToken = trimmed
            pushProvider = provider
        } else {
            pushToken = nil
            pushProvider = nil
        }
    }

    @discardableResult
    public func updatePushCredentials(token: String?, provider: String? = nil) -> Bool {
        setPushCredentials(token: token, provider: provider)
        guard paired else { return false }
        var event: [String: Any] = ["type": "push.register"]
        if let pushToken { event["pushToken"] = pushToken }
        if let pushProvider { event["pushProvider"] = pushProvider }
        return sendControl(event)
    }

    // MARK: Lifecycle

    public func connect(_ uri: String) throws {
        disconnect()
        let parsed = try RemoteSessionPairingParser.parse(uri)
        let mobilePeerId = peerIdFactory()
        let context = RemoteSessionCrypto(sessionId: parsed.remoteSessionId, localPeerId: mobilePeerId)
        try context.pair(hostPublicKey: parsed.hostPublicKey, pairingToken: parsed.pairingToken)
        pairing = parsed
        crypto = context
        peerId = mobilePeerId
        paired = false
        closedExplicitly = false
        reconnectAttempt = 0
        reconnectGeneration += 1
        status = .connecting
        openSocket()
    }

    public func disconnect() {
        closedExplicitly = true
        paired = false
        reconnectAttempt = 0
        reconnectGeneration += 1
        socket?.close(code: 1000, reason: "iOS Remote Session closed")
        socket = nil
        status = .disconnected
    }

    private func openSocket() {
        guard let pairing else { return }
        socket = webSocketFactory(pairing.relayUrl, self)
    }

    /// Retry an exhausted or interrupted transient connection without creating a
    /// second pairing identity. Reconnect retains the exact E2EE context and peer.
    @discardableResult
    public func resumeAfterTransientFailure() -> Bool {
        guard pairing != nil, crypto != nil, peerId != nil, status != .revoked else {
            return false
        }
        closedExplicitly = false
        reconnectAttempt = 0
        reconnectGeneration += 1
        scheduleReconnect(immediate: true)
        return true
    }

    private func scheduleReconnect(immediate: Bool = false) {
        guard !closedExplicitly, pairing != nil else { return }
        guard reconnectAttempt < reconnectPolicy.maximumAttempts else {
            status = .error
            return
        }
        reconnectAttempt += 1
        reconnectGeneration += 1
        let generation = reconnectGeneration
        let delay = immediate ? 0 : reconnectPolicy.delay(forAttempt: reconnectAttempt)
        status = .reconnecting
        reconnectScheduler(delay) { [weak self] in
            guard let self,
                  !self.closedExplicitly,
                  self.reconnectGeneration == generation,
                  self.socket == nil
            else { return }
            self.openSocket()
        }
    }

    // MARK: Control messages

    @discardableResult
    public func sendPrompt(_ content: String) -> Bool {
        sendControl(["type": "prompt", "content": content])
    }

    @discardableResult
    public func resolveApproval(
        requestId: String,
        decision: RemoteApprovalDecision,
        fingerprint: String? = nil,
        binding: String? = nil,
        revision: Any? = nil
    ) -> Bool {
        guard let (wireDecision, approved) = encodeRemoteApprovalDecision(decision) else {
            return false
        }
        let hasDurableTuple = fingerprint != nil || binding != nil || revision != nil
        if hasDurableTuple {
            guard let fingerprint, !fingerprint.isEmpty,
                  let binding, !binding.isEmpty,
                  let revision = normalizedApprovalRevision(revision)
            else { return false }
            return sendControl([
                "type": "approval.resolve",
                "requestId": requestId,
                "decision": wireDecision,
                "approved": approved,
                "fingerprint": fingerprint,
                "binding": binding,
                "revision": revision,
            ])
        }
        return sendControl([
            "type": "approval.resolve",
            "requestId": requestId,
            "decision": wireDecision,
            "approved": approved,
        ])
    }

    /// N-1 source compatibility. New callers must construct the generated
    /// schema type so an unreviewed turn/session grant cannot enter this binary UI.
    @available(*, deprecated, message: "Use the canonical decision overload")
    @discardableResult
    public func resolveApproval(
        requestId: String,
        approved: Bool,
        fingerprint: String? = nil,
        binding: String? = nil,
        revision: Any? = nil
    ) -> Bool {
        resolveApproval(
            requestId: requestId,
            decision: approved ? .acceptOnce : .decline(reason: nil),
            fingerprint: fingerprint,
            binding: binding,
            revision: revision
        )
    }

    @discardableResult
    public func interrupt() -> Bool {
        sendControl(["type": "interrupt"])
    }

    @discardableResult
    private func sendControl(_ event: [String: Any]) -> Bool {
        guard let socket, let pairing, let crypto, paired else { return false }
        guard let plaintext = try? JSONSerialization.data(withJSONObject: event),
              let envelope = try? crypto.encrypt(plaintext)
        else { return false }
        socket.send(wireMessage(to: pairing.hostPeerId, payload: [
            "type": "remote-session.encrypted",
            "envelope": envelope.toJSONObject(),
        ]))
        return true
    }

    private func sendPairRequest(_ socket: RemoteSessionWebSocket) {
        guard let pairing, let crypto, let peerId else { return }
        var joinPayload: [String: Any] = [
            "type": "pair.join",
            "remoteSessionId": pairing.remoteSessionId,
            "token": pairing.pairingToken,
            "capabilities": ["approval-binding-v1", "approval-decision-v1"],
        ]
        if let pushToken { joinPayload["pushToken"] = pushToken }
        if let pushProvider { joinPayload["pushProvider"] = pushProvider }
        guard let plaintext = try? JSONSerialization.data(withJSONObject: joinPayload),
              let envelope = try? crypto.encrypt(plaintext)
        else { return }
        socket.send(wireMessage(to: pairing.hostPeerId, payload: [
            "type": "remote-session.pair",
            "mobilePeerId": peerId,
            "mobilePublicKey": crypto.publicKeyBase64(),
            "envelope": envelope.toJSONObject(),
        ]))
    }

    private func wireMessage(to: String, payload: [String: Any]) -> String {
        let message: [String: Any] = ["type": "message", "to": to, "payload": payload]
        guard let data = try? JSONSerialization.data(withJSONObject: message),
              let text = String(data: data, encoding: .utf8)
        else { return "{}" }
        return text
    }

    private func normalizedApprovalRevision(_ value: Any?) -> Any? {
        if value is Bool { return nil }
        if let value = value as? Int, value > 0 { return value }
        if let value = value as? Int64, value > 0 { return value }
        if let value = value as? NSNumber {
            let integer = value.int64Value
            if integer > 0, value.doubleValue == Double(integer) { return integer }
        }
        if let value = value as? String,
           value.range(of: #"^[1-9]\d*$"#, options: .regularExpression) != nil {
            return value
        }
        return nil
    }

    private func encodeRemoteApprovalDecision(
        _ decision: RemoteApprovalDecision
    ) -> ([String: Any], Bool)? {
        let approved: Bool
        switch decision {
        case .acceptOnce:
            approved = true
        case .decline, .cancel:
            approved = false
        case .acceptForTurn, .acceptForSession:
            // The current binary UI cannot review scoped persistent grants.
            return nil
        }

        guard let data = try? JSONEncoder().encode(decision),
              let value = try? JSONSerialization.jsonObject(with: data),
              let object = value as? [String: Any]
        else { return nil }
        return (object, approved)
    }

    // MARK: Inbound

    private func handle(text: String) {
        guard let data = text.data(using: .utf8),
              var message = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        else { return }
        if message["type"] as? String == "offline-message",
           let original = message["originalMessage"] as? [String: Any] {
            message = original
        }
        switch message["type"] as? String {
        case "registered":
            if paired {
                // The exact peer/E2EE identity survives a transient relay drop.
                reconnectAttempt = 0
                status = .connected
            } else {
                status = .pairing
                if let socket { sendPairRequest(socket) }
            }
        case "message":
            handleEncrypted(message)
        default:
            break
        }
    }

    private func handleEncrypted(_ message: [String: Any]) {
        guard let payload = message["payload"] as? [String: Any],
              payload["type"] as? String == "remote-session.encrypted",
              let envelopeJSON = payload["envelope"] as? [String: Any],
              let crypto
        else { return }
        do {
            let envelope = try RemoteEncryptedEnvelope.fromJSONObject(envelopeJSON)
            let plaintext = try crypto.decrypt(envelope)
            let json = String(data: plaintext, encoding: .utf8) ?? ""
            let event = (try? JSONSerialization.jsonObject(with: plaintext)) as? [String: Any]
            let type = event?["type"] as? String ?? ""
            switch type {
            case "pair.accepted":
                paired = true
                reconnectAttempt = 0
                status = .connected
            case "session.revoked":
                closedExplicitly = true
                paired = false
                reconnectAttempt = 0
                reconnectGeneration += 1
                socket?.close(code: 1000, reason: "Revoked by host")
                socket = nil
                status = .revoked
            default:
                onEvent?(RemoteSessionEvent(type: type, json: json))
            }
        } catch {
            status = .error
            let message = (error as? RemoteSessionCryptoError).map { "\($0)" }
                ?? "Remote Session protocol error"
            onError?(message)
        }
    }

    // MARK: RemoteSessionWebSocketListener

    public func webSocketDidOpen(_ socket: RemoteSessionWebSocket) {
        let register: [String: Any] = [
            "type": "register",
            "peerId": peerId ?? "",
            "deviceType": "mobile",
            "deviceInfo": ["protocol": "remote-session.e2ee.v1"],
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: register),
              let text = String(data: data, encoding: .utf8)
        else { return }
        socket.send(text)
    }

    public func webSocket(_ socket: RemoteSessionWebSocket, didReceiveText text: String) {
        handle(text: text)
    }

    public func webSocket(_ socket: RemoteSessionWebSocket, didCloseWithCode code: Int, reason: String) {
        guard socket === self.socket else { return }
        self.socket = nil
        if closedExplicitly {
            status = .disconnected
        } else {
            scheduleReconnect()
        }
    }

    public func webSocket(_ socket: RemoteSessionWebSocket, didFailWithError error: Error?) {
        guard socket === self.socket else { return }
        self.socket = nil
        onError?(error?.localizedDescription ?? "Remote Session relay failed")
        if closedExplicitly {
            status = .error
        } else {
            scheduleReconnect()
        }
    }
}

import Foundation

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

/// A decrypted inbound Remote Session event. `json` is the raw decrypted JSON so
/// callers can decode whatever fields the event type carries.
public struct RemoteSessionEvent: Sendable, Equatable {
    public let type: String
    public let json: String

    public init(type: String, json: String) {
        self.type = type
        self.json = json
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

    // Optional vendor-push credentials — ride in the encrypted pair.join so the
    // host can wake this device while backgrounded (sourced by the app layer via
    // RemoteSessionPushTokenResolver, then handed here).
    private var pushToken: String?
    private var pushProvider: String?

    public var currentPairing: RemoteSessionPairing? { pairing }
    public var localPeerId: String? { peerId }

    public init(
        webSocketFactory: @escaping RemoteSessionWebSocketFactory,
        peerIdFactory: @escaping () -> String = { "ios-\(UUID().uuidString)" }
    ) {
        self.webSocketFactory = webSocketFactory
        self.peerIdFactory = peerIdFactory
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
        status = .connecting
        openSocket()
    }

    public func disconnect() {
        closedExplicitly = true
        paired = false
        socket?.close(code: 1000, reason: "iOS Remote Session closed")
        socket = nil
        status = .disconnected
    }

    private func openSocket() {
        guard let pairing else { return }
        socket = webSocketFactory(pairing.relayUrl, self)
    }

    // MARK: Control messages

    @discardableResult
    public func sendPrompt(_ content: String) -> Bool {
        sendControl(["type": "prompt", "content": content])
    }

    @discardableResult
    public func resolveApproval(requestId: String, approved: Bool) -> Bool {
        sendControl(["type": "approval.resolve", "requestId": requestId, "approved": approved])
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
                // Reconnected after a transient drop — shared secret still valid.
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
                status = .connected
            case "session.revoked":
                closedExplicitly = true
                paired = false
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
        // Auto-reconnect lands in the next slice; for now a drop ends the session.
        status = .disconnected
    }

    public func webSocket(_ socket: RemoteSessionWebSocket, didFailWithError error: Error?) {
        guard socket === self.socket else { return }
        self.socket = nil
        onError?(error?.localizedDescription ?? "Remote Session relay failed")
        status = closedExplicitly ? .error : .disconnected
    }
}

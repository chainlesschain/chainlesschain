import Foundation
import WebRTC

/// P2P Manager - Coordinates WebRTC, Signal Protocol, and Message Management
/// Reference: desktop-app-vue/src/main/p2p/p2p-manager.js
@MainActor
class P2PManager: ObservableObject {
    static let shared = P2PManager()

    // Sub-managers
    private let webrtcManager = WebRTCManager.shared
    private let signalManager = SignalProtocolManager.shared
    private let messageManager = MessageManager.shared

    // Connection state
    @Published var isInitialized = false
    @Published var connectedPeers: Set<String> = []
    @Published var connectionStatus: [String: ConnectionStatus] = [:]

    // Signaling
    private var signalingService: SignalingService?

    enum ConnectionStatus: String {
        case disconnected
        case connecting
        case connected
        case failed
    }

    private init() {
        setupNotificationObservers()
    }

    // MARK: - Initialization

    /// Initialize P2P Manager
    func initialize(signalingServerURL: String? = nil) async throws {
        AppLogger.log("[P2P] Initializing P2P Manager...")

        // Initialize WebRTC
        webrtcManager.initialize()

        // Initialize Signal Protocol
        try await signalManager.initialize()

        // Initialize signaling service if URL provided
        if let url = signalingServerURL {
            signalingService = SignalingService(serverURL: url)
            try await signalingService?.connect()
        }

        isInitialized = true
        AppLogger.log("[P2P] P2P Manager initialized")
    }

    // MARK: - Connection Management

    /// Connect to a peer
    func connectToPeer(peerId: String, preKeyBundle: SignalProtocolManager.PreKeyBundle? = nil) async throws {
        guard isInitialized else {
            throw P2PError.notInitialized
        }

        AppLogger.log("[P2P] Connecting to peer: \(peerId)")
        connectionStatus[peerId] = .connecting

        do {
            // 1. Establish Signal Protocol session
            if let bundle = preKeyBundle {
                try await signalManager.processPreKeyBundle(recipientId: peerId, bundle: bundle)
            } else {
                // Request pre-key bundle from peer via signaling
                if let bundle = try await requestPreKeyBundle(from: peerId) {
                    try await signalManager.processPreKeyBundle(recipientId: peerId, bundle: bundle)
                } else {
                    throw P2PError.preKeyBundleNotAvailable
                }
            }

            // 2. Create WebRTC peer connection
            let peerConnection = try webrtcManager.createPeerConnection(for: peerId)

            // 3. Create data channel
            _ = try webrtcManager.createDataChannel(for: peerId, label: "data")

            // 4. Create and send offer
            let offer = try await webrtcManager.createOffer(for: peerId)
            try await sendSignalingMessage(to: peerId, type: .offer, sdp: offer)

            // Wait for answer (handled by notification observer)

            connectedPeers.insert(peerId)
            connectionStatus[peerId] = .connected

            AppLogger.log("[P2P] Connected to peer: \(peerId)")

            // Notify observers
            NotificationCenter.default.post(
                name: .p2pPeerConnected,
                object: nil,
                userInfo: ["peerId": peerId]
            )

        } catch {
            connectionStatus[peerId] = .failed
            AppLogger.error("[P2P] Failed to connect to peer: \(error)")
            throw error
        }
    }

    /// Accept connection from peer
    func acceptConnection(from peerId: String, offer: RTCSessionDescription) async throws {
        guard isInitialized else {
            throw P2PError.notInitialized
        }

        AppLogger.log("[P2P] Accepting connection from: \(peerId)")
        connectionStatus[peerId] = .connecting

        do {
            // 1. Create peer connection
            _ = try webrtcManager.createPeerConnection(for: peerId)

            // 2. Set remote description (offer)
            try await webrtcManager.setRemoteDescription(offer, for: peerId)

            // 3. Create answer
            let answer = try await webrtcManager.createAnswer(for: peerId)

            // 4. Send answer
            try await sendSignalingMessage(to: peerId, type: .answer, sdp: answer)

            connectedPeers.insert(peerId)
            connectionStatus[peerId] = .connected

            AppLogger.log("[P2P] Accepted connection from: \(peerId)")

            NotificationCenter.default.post(
                name: .p2pPeerConnected,
                object: nil,
                userInfo: ["peerId": peerId]
            )

        } catch {
            connectionStatus[peerId] = .failed
            AppLogger.error("[P2P] Failed to accept connection: \(error)")
            throw error
        }
    }

    /// Disconnect from peer
    func disconnectFromPeer(peerId: String) {
        AppLogger.log("[P2P] Disconnecting from peer: \(peerId)")

        webrtcManager.closeConnection(for: peerId)
        signalManager.removeSession(recipientId: peerId)
        messageManager.clearQueues()

        connectedPeers.remove(peerId)
        connectionStatus[peerId] = .disconnected

        NotificationCenter.default.post(
            name: .p2pPeerDisconnected,
            object: nil,
            userInfo: ["peerId": peerId]
        )
    }

    // MARK: - Messaging

    /// Send encrypted message to peer
    func sendMessage(
        to peerId: String,
        content: String,
        type: MessageManager.Message.MessageType = .text,
        priority: MessageManager.Message.Priority = .normal
    ) async throws -> String {
        guard connectedPeers.contains(peerId) else {
            throw P2PError.peerNotConnected
        }

        // 1. Encrypt message using Signal Protocol
        let encryptedData = try signalManager.encryptMessage(content, for: peerId)
        let encryptedBase64 = encryptedData.base64EncodedString()

        // 2. Send via message manager (handles batching, deduplication)
        let messageId = await messageManager.sendMessage(
            to: peerId,
            payload: encryptedBase64,
            type: type,
            priority: priority,
            requireAck: true,
            immediate: priority == .high
        )

        AppLogger.log("[P2P] Sent encrypted message to \(peerId): \(messageId)")

        return messageId
    }

    /// Handle received message
    private func handleReceivedMessage(from peerId: String, message: MessageManager.Message) {
        do {
            // 1. Check for duplicates
            guard messageManager.receiveMessage(from: peerId, message: message) else {
                return // Duplicate, ignore
            }

            // 2. Decrypt message
            guard let encryptedData = Data(base64Encoded: message.payload) else {
                throw P2PError.invalidMessageFormat
            }

            let decryptedContent = try signalManager.decryptMessage(encryptedData, from: peerId)

            // 3. Notify observers
            NotificationCenter.default.post(
                name: .p2pMessageReceived,
                object: nil,
                userInfo: [
                    "peerId": peerId,
                    "messageId": message.id,
                    "content": decryptedContent,
                    "type": message.type.rawValue,
                    "timestamp": message.timestamp
                ]
            )

            AppLogger.log("[P2P] Received and decrypted message from \(peerId)")

        } catch {
            AppLogger.error("[P2P] Failed to handle received message: \(error)")
        }
    }

    // MARK: - Signaling

    /// Send signaling message
    private func sendSignalingMessage(
        to peerId: String,
        type: SignalingMessageType,
        sdp: RTCSessionDescription? = nil,
        candidate: RTCIceCandidate? = nil
    ) async throws {
        guard let signalingService = signalingService else {
            throw P2PError.signalingNotAvailable
        }

        let message = SignalingMessage(
            from: getCurrentUserId(),
            to: peerId,
            type: type,
            sdp: sdp?.sdp,
            sdpType: sdp?.type.rawValue,
            candidate: candidate?.sdp,
            candidateSdpMid: candidate?.sdpMid,
            candidateSdpMLineIndex: candidate?.sdpMLineIndex
        )

        try await signalingService.send(message)
    }

    /// Request pre-key bundle from peer
    private func requestPreKeyBundle(from peerId: String) async throws -> SignalProtocolManager.PreKeyBundle? {
        guard let signalingService = signalingService else {
            throw P2PError.signalingNotAvailable
        }

        // Send request
        let message = SignalingMessage(
            from: getCurrentUserId(),
            to: peerId,
            type: .preKeyBundleRequest
        )

        try await signalingService.send(message)

        // Wait for response (simplified - in production use proper async waiting)
        // This would be handled by the signaling service callback
        return nil
    }

    /// Get our pre-key bundle to share with peers
    func getPreKeyBundle() throws -> SignalProtocolManager.PreKeyBundle {
        return try signalManager.getPreKeyBundle()
    }

    // MARK: - Notification Observers

    private func setupNotificationObservers() {
        // WebRTC connection state changes
        NotificationCenter.default.addObserver(
            forName: .webrtcConnectionStateChanged,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let peerId = notification.userInfo?["peerId"] as? String,
                  let state = notification.userInfo?["state"] as? RTCPeerConnectionState else {
                return
            }

            Task { @MainActor in
                self?.handleConnectionStateChange(peerId: peerId, state: state)
            }
        }

        // WebRTC ICE candidates
        NotificationCenter.default.addObserver(
            forName: .webrtcIceCandidate,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let peerId = notification.userInfo?["peerId"] as? String,
                  let candidate = notification.userInfo?["candidate"] as? RTCIceCandidate else {
                return
            }

            Task { @MainActor in
                try? await self?.sendSignalingMessage(to: peerId, type: .iceCandidate, candidate: candidate)
            }
        }

        // WebRTC messages received
        NotificationCenter.default.addObserver(
            forName: .webrtcMessageReceived,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let peerId = notification.userInfo?["peerId"] as? String,
                  let messageJson = notification.userInfo?["message"] as? String,
                  let messageData = messageJson.data(using: .utf8),
                  let message = try? JSONDecoder().decode(MessageManager.Message.self, from: messageData) else {
                return
            }

            Task { @MainActor in
                self?.handleReceivedMessage(from: peerId, message: message)
            }
        }

        // Message manager send requests
        NotificationCenter.default.addObserver(
            forName: .p2pSendMessage,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let peerId = notification.userInfo?["peerId"] as? String,
                  let message = notification.userInfo?["message"] as? MessageManager.Message else {
                return
            }

            Task { @MainActor in
                try? await self?.sendMessageViaWebRTC(to: peerId, message: message)
            }
        }

        // Message manager batch send requests
        NotificationCenter.default.addObserver(
            forName: .p2pSendBatch,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let peerId = notification.userInfo?["peerId"] as? String,
                  let messages = notification.userInfo?["messages"] as? [MessageManager.Message] else {
                return
            }

            Task { @MainActor in
                for message in messages {
                    try? await self?.sendMessageViaWebRTC(to: peerId, message: message)
                }
            }
        }
    }

    private func handleConnectionStateChange(peerId: String, state: RTCPeerConnectionState) {
        switch state {
        case .connected:
            connectionStatus[peerId] = .connected
            connectedPeers.insert(peerId)
        case .disconnected, .closed:
            connectionStatus[peerId] = .disconnected
            connectedPeers.remove(peerId)
        case .failed:
            connectionStatus[peerId] = .failed
            connectedPeers.remove(peerId)
        default:
            break
        }
    }

    private func sendMessageViaWebRTC(to peerId: String, message: MessageManager.Message) async throws {
        let encoder = JSONEncoder()
        let messageData = try encoder.encode(message)
        let messageJson = String(data: messageData, encoding: .utf8)!

        try webrtcManager.sendMessage(messageJson, to: peerId)
    }

    // MARK: - Utilities

    private func getCurrentUserId() -> String {
        // Get from DID manager or user session
        return UserDefaults.standard.string(forKey: "current_user_id") ?? "unknown"
    }

    /// Get connection statistics
    func getStatistics() -> P2PStatistics {
        return P2PStatistics(
            connectedPeers: connectedPeers.count,
            messageStats: messageManager.getStats(),
            isInitialized: isInitialized
        )
    }

    /// Cleanup
    func cleanup() {
        connectedPeers.forEach { disconnectFromPeer(peerId: $0) }
        webrtcManager.cleanup()
        signalManager.clearSessions()
        messageManager.clearQueues()

        AppLogger.log("[P2P] Cleanup complete")
    }
}

// MARK: - Supporting Types

struct P2PStatistics {
    let connectedPeers: Int
    let messageStats: MessageManager.MessageStats
    let isInitialized: Bool
}

enum P2PError: LocalizedError {
    case notInitialized
    case peerNotConnected
    case signalingNotAvailable
    case preKeyBundleNotAvailable
    case invalidMessageFormat

    var errorDescription: String? {
        switch self {
        case .notInitialized:
            return "P2P Manager not initialized"
        case .peerNotConnected:
            return "Peer not connected"
        case .signalingNotAvailable:
            return "Signaling service not available"
        case .preKeyBundleNotAvailable:
            return "Pre-key bundle not available"
        case .invalidMessageFormat:
            return "Invalid message format"
        }
    }
}

// MARK: - Signaling Service

class SignalingService {
    private let serverURL: String
    private var webSocket: URLSessionWebSocketTask?

    init(serverURL: String) {
        self.serverURL = serverURL
    }

    func connect() async throws {
        guard let url = URL(string: serverURL) else {
            throw P2PError.signalingNotAvailable
        }

        let session = URLSession(configuration: .default)
        webSocket = session.webSocketTask(with: url)
        webSocket?.resume()

        // Start receiving messages
        receiveMessage()

        AppLogger.log("[Signaling] Connected to signaling server")
    }

    func send(_ message: SignalingMessage) async throws {
        guard let webSocket = webSocket else {
            throw P2PError.signalingNotAvailable
        }

        let encoder = JSONEncoder()
        let data = try encoder.encode(message)
        let string = String(data: data, encoding: .utf8)!

        try await webSocket.send(.string(string))
    }

    private func receiveMessage() {
        webSocket?.receive { [weak self] result in
            switch result {
            case .success(let message):
                switch message {
                case .string(let text):
                    self?.handleMessage(text)
                case .data(let data):
                    if let text = String(data: data, encoding: .utf8) {
                        self?.handleMessage(text)
                    }
                @unknown default:
                    break
                }

                // Continue receiving
                self?.receiveMessage()

            case .failure(let error):
                AppLogger.error("[Signaling] Receive error: \(error)")
            }
        }
    }

    private func handleMessage(_ text: String) {
        guard let data = text.data(using: .utf8),
              let message = try? JSONDecoder().decode(SignalingMessage.self, from: data) else {
            return
        }

        // Notify P2P manager
        NotificationCenter.default.post(
            name: .signalingMessageReceived,
            object: nil,
            userInfo: ["message": message]
        )
    }

    func disconnect() {
        webSocket?.cancel(with: .goingAway, reason: nil)
        webSocket = nil
    }
}

struct SignalingMessage: Codable {
    let from: String
    let to: String
    let type: SignalingMessageType
    let sdp: String?
    let sdpType: String?
    let candidate: String?
    let candidateSdpMid: String?
    let candidateSdpMLineIndex: Int32?

    init(
        from: String,
        to: String,
        type: SignalingMessageType,
        sdp: String? = nil,
        sdpType: String? = nil,
        candidate: String? = nil,
        candidateSdpMid: String? = nil,
        candidateSdpMLineIndex: Int32? = nil
    ) {
        self.from = from
        self.to = to
        self.type = type
        self.sdp = sdp
        self.sdpType = sdpType
        self.candidate = candidate
        self.candidateSdpMid = candidateSdpMid
        self.candidateSdpMLineIndex = candidateSdpMLineIndex
    }
}

enum SignalingMessageType: String, Codable {
    case offer
    case answer
    case iceCandidate
    case preKeyBundleRequest
    case preKeyBundleResponse
}

// MARK: - Notification Names

extension Notification.Name {
    static let p2pPeerConnected = Notification.Name("p2pPeerConnected")
    static let p2pPeerDisconnected = Notification.Name("p2pPeerDisconnected")
    static let signalingMessageReceived = Notification.Name("signalingMessageReceived")
}

// MARK: - Logger

private struct AppLogger {
    static func log(_ message: String) {
        print(message)
    }

    static func error(_ message: String) {
        print("❌ \(message)")
    }
}

import Foundation
import WebRTC
import CoreCommon

/// WebRTC Manager - Manages peer-to-peer WebRTC connections
/// Reference: desktop-app-vue/src/main/p2p/p2p-manager.js
@MainActor
class WebRTCManager: NSObject, ObservableObject {
    static let shared = WebRTCManager()

    private let logger = Logger.shared

    // WebRTC Components
    private var peerConnectionFactory: RTCPeerConnectionFactory!
    private var peerConnections: [String: RTCPeerConnection] = [:]
    private var dataChannels: [String: RTCDataChannel] = [:]

    // ICE Configuration
    private let iceServers = [
        RTCIceServer(urlStrings: ["stun:stun.l.google.com:19302"]),
        RTCIceServer(urlStrings: ["stun:stun1.l.google.com:19302"]),
        RTCIceServer(urlStrings: ["stun:stun2.l.google.com:19302"])
    ]

    // Connection state
    @Published var connectionStates: [String: RTCPeerConnectionState] = [:]
    @Published var isInitialized = false

    // Delegates
    private var connectionDelegates: [String: PeerConnectionDelegate] = [:]

    override private init() {
        super.init()
    }

    // MARK: - Initialization

    /// Initialize WebRTC Manager
    func initialize() {
        logger.debug("[WebRTC] Initializing WebRTC Manager...")

        // Initialize factory
        RTCInitializeSSL()
        let encoderFactory = RTCDefaultVideoEncoderFactory()
        let decoderFactory = RTCDefaultVideoDecoderFactory()

        peerConnectionFactory = RTCPeerConnectionFactory(
            encoderFactory: encoderFactory,
            decoderFactory: decoderFactory
        )

        isInitialized = true
        logger.debug("[WebRTC] WebRTC Manager initialized")
    }

    // MARK: - Connection Management

    /// Create peer connection
    func createPeerConnection(for peerId: String) throws -> RTCPeerConnection {
        guard isInitialized else {
            throw WebRTCError.notInitialized
        }

        // Configuration
        let config = RTCConfiguration()
        config.iceServers = iceServers
        config.sdpSemantics = .unifiedPlan
        config.continualGatheringPolicy = .gatherContinually

        // Constraints
        let constraints = RTCMediaConstraints(
            mandatoryConstraints: nil,
            optionalConstraints: ["DtlsSrtpKeyAgreement": "true"]
        )

        // Create peer connection
        guard let peerConnection = peerConnectionFactory.peerConnection(
            with: config,
            constraints: constraints,
            delegate: nil
        ) else {
            throw WebRTCError.connectionCreationFailed
        }

        // Create delegate
        let delegate = PeerConnectionDelegate(peerId: peerId, manager: self)
        peerConnection.delegate = delegate
        connectionDelegates[peerId] = delegate

        peerConnections[peerId] = peerConnection
        connectionStates[peerId] = .new

        logger.debug("[WebRTC] Peer connection created for: \(peerId)")

        return peerConnection
    }

    /// Create data channel
    func createDataChannel(for peerId: String, label: String = "data") throws -> RTCDataChannel {
        guard let peerConnection = peerConnections[peerId] else {
            throw WebRTCError.peerConnectionNotFound
        }

        let config = RTCDataChannelConfiguration()
        config.isOrdered = true

        guard let dataChannel = peerConnection.dataChannel(
            forLabel: label,
            configuration: config
        ) else {
            throw WebRTCError.dataChannelCreationFailed
        }

        dataChannels[peerId] = dataChannel

        logger.debug("[WebRTC] Data channel created for: \(peerId)")

        return dataChannel
    }

    /// Create offer
    func createOffer(for peerId: String) async throws -> RTCSessionDescription {
        guard let peerConnection = peerConnections[peerId] else {
            throw WebRTCError.peerConnectionNotFound
        }

        let constraints = RTCMediaConstraints(
            mandatoryConstraints: [
                "OfferToReceiveAudio": "false",
                "OfferToReceiveVideo": "false"
            ],
            optionalConstraints: nil
        )

        return try await withCheckedThrowingContinuation { continuation in
            peerConnection.offer(for: constraints) { sdp, error in
                if let error = error {
                    continuation.resume(throwing: error)
                } else if let sdp = sdp {
                    peerConnection.setLocalDescription(sdp) { error in
                        if let error = error {
                            continuation.resume(throwing: error)
                        } else {
                            continuation.resume(returning: sdp)
                        }
                    }
                } else {
                    continuation.resume(throwing: WebRTCError.offerCreationFailed)
                }
            }
        }
    }

    /// Create answer
    func createAnswer(for peerId: String) async throws -> RTCSessionDescription {
        guard let peerConnection = peerConnections[peerId] else {
            throw WebRTCError.peerConnectionNotFound
        }

        let constraints = RTCMediaConstraints(
            mandatoryConstraints: [
                "OfferToReceiveAudio": "false",
                "OfferToReceiveVideo": "false"
            ],
            optionalConstraints: nil
        )

        return try await withCheckedThrowingContinuation { continuation in
            peerConnection.answer(for: constraints) { sdp, error in
                if let error = error {
                    continuation.resume(throwing: error)
                } else if let sdp = sdp {
                    peerConnection.setLocalDescription(sdp) { error in
                        if let error = error {
                            continuation.resume(throwing: error)
                        } else {
                            continuation.resume(returning: sdp)
                        }
                    }
                } else {
                    continuation.resume(throwing: WebRTCError.answerCreationFailed)
                }
            }
        }
    }

    /// Set remote description
    func setRemoteDescription(_ sdp: RTCSessionDescription, for peerId: String) async throws {
        guard let peerConnection = peerConnections[peerId] else {
            throw WebRTCError.peerConnectionNotFound
        }

        return try await withCheckedThrowingContinuation { continuation in
            peerConnection.setRemoteDescription(sdp) { error in
                if let error = error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume()
                }
            }
        }
    }

    /// Add ICE candidate
    func addIceCandidate(_ candidate: RTCIceCandidate, for peerId: String) async throws {
        guard let peerConnection = peerConnections[peerId] else {
            throw WebRTCError.peerConnectionNotFound
        }

        return try await withCheckedThrowingContinuation { continuation in
            peerConnection.add(candidate) { error in
                if let error = error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume()
                }
            }
        }
    }

    // MARK: - Data Channel

    /// Send message via data channel
    func sendMessage(_ message: String, to peerId: String) throws {
        guard let dataChannel = dataChannels[peerId] else {
            throw WebRTCError.dataChannelNotFound
        }

        guard dataChannel.readyState == .open else {
            throw WebRTCError.dataChannelNotOpen
        }

        guard let data = message.data(using: .utf8) else {
            throw WebRTCError.sendFailed
        }
        let buffer = RTCDataBuffer(data: data, isBinary: false)

        let success = dataChannel.sendData(buffer)

        if !success {
            throw WebRTCError.sendFailed
        }

        logger.debug("[WebRTC] Message sent to \(peerId)")
    }

    /// Send data via data channel
    func sendData(_ data: Data, to peerId: String) throws {
        guard let dataChannel = dataChannels[peerId] else {
            throw WebRTCError.dataChannelNotFound
        }

        guard dataChannel.readyState == .open else {
            throw WebRTCError.dataChannelNotOpen
        }

        let buffer = RTCDataBuffer(data: data, isBinary: true)

        let success = dataChannel.sendData(buffer)

        if !success {
            throw WebRTCError.sendFailed
        }

        logger.debug("[WebRTC] Data sent to \(peerId)")
    }

    // MARK: - Connection State

    /// Close connection
    func closeConnection(for peerId: String) {
        dataChannels[peerId]?.close()
        dataChannels.removeValue(forKey: peerId)

        peerConnections[peerId]?.close()
        peerConnections.removeValue(forKey: peerId)

        connectionDelegates.removeValue(forKey: peerId)
        connectionStates.removeValue(forKey: peerId)

        logger.debug("[WebRTC] Connection closed for: \(peerId)")
    }

    /// Get connection state
    func getConnectionState(for peerId: String) -> RTCPeerConnectionState? {
        return connectionStates[peerId]
    }

    /// Cleanup
    func cleanup() {
        peerConnections.keys.forEach { closeConnection(for: $0) }
        RTCCleanupSSL()

        logger.debug("[WebRTC] Cleanup complete")
    }

    // MARK: - Delegate Callbacks

    fileprivate func handleConnectionStateChange(peerId: String, state: RTCPeerConnectionState) {
        connectionStates[peerId] = state

        logger.debug("[WebRTC] Connection state changed for \(peerId): \(state.rawValue)")

        // Notify observers
        NotificationCenter.default.post(
            name: .webrtcConnectionStateChanged,
            object: nil,
            userInfo: ["peerId": peerId, "state": state]
        )
    }

    fileprivate func handleIceCandidate(peerId: String, candidate: RTCIceCandidate) {
        logger.debug("[WebRTC] ICE candidate for \(peerId)")

        // Notify observers to send candidate to remote peer
        NotificationCenter.default.post(
            name: .webrtcIceCandidate,
            object: nil,
            userInfo: ["peerId": peerId, "candidate": candidate]
        )
    }

    fileprivate func handleDataChannelMessage(peerId: String, data: Data, isBinary: Bool) {
        if isBinary {
            // Binary data
            NotificationCenter.default.post(
                name: .webrtcDataReceived,
                object: nil,
                userInfo: ["peerId": peerId, "data": data]
            )
        } else {
            // Text message
            if let message = String(data: data, encoding: .utf8) {
                NotificationCenter.default.post(
                    name: .webrtcMessageReceived,
                    object: nil,
                    userInfo: ["peerId": peerId, "message": message]
                )
            }
        }
    }
}

// MARK: - Peer Connection Delegate

private class PeerConnectionDelegate: NSObject, RTCPeerConnectionDelegate {
    let peerId: String
    weak var manager: WebRTCManager?

    init(peerId: String, manager: WebRTCManager) {
        self.peerId = peerId
        self.manager = manager
    }

    func peerConnection(_ peerConnection: RTCPeerConnection, didChange state: RTCPeerConnectionState) {
        Task { @MainActor in
            manager?.handleConnectionStateChange(peerId: peerId, state: state)
        }
    }

    func peerConnection(_ peerConnection: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {
        Task { @MainActor in
            manager?.handleIceCandidate(peerId: peerId, candidate: candidate)
        }
    }

    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceConnectionState) {
        logger.debug("[WebRTC] ICE connection state: \(newState.rawValue)")
    }

    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceGatheringState) {
        logger.debug("[WebRTC] ICE gathering state: \(newState.rawValue)")
    }

    func peerConnection(_ peerConnection: RTCPeerConnection, didAdd stream: RTCMediaStream) {
        logger.debug("[WebRTC] Media stream added")
    }

    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove stream: RTCMediaStream) {
        logger.debug("[WebRTC] Media stream removed")
    }

    func peerConnection(_ peerConnection: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) {
        logger.debug("[WebRTC] Data channel opened")
        dataChannel.delegate = DataChannelDelegate(peerId: peerId, manager: manager)
    }

    func peerConnectionShouldNegotiate(_ peerConnection: RTCPeerConnection) {
        logger.debug("[WebRTC] Should negotiate")
    }
}

// MARK: - Data Channel Delegate

private class DataChannelDelegate: NSObject, RTCDataChannelDelegate {
    let peerId: String
    weak var manager: WebRTCManager?

    init(peerId: String, manager: WebRTCManager?) {
        self.peerId = peerId
        self.manager = manager
    }

    func dataChannelDidChangeState(_ dataChannel: RTCDataChannel) {
        logger.debug("[WebRTC] Data channel state: \(dataChannel.readyState.rawValue)")
    }

    func dataChannel(_ dataChannel: RTCDataChannel, didReceiveMessageWith buffer: RTCDataBuffer) {
        Task { @MainActor in
            manager?.handleDataChannelMessage(peerId: peerId, data: buffer.data, isBinary: buffer.isBinary)
        }
    }
}

// MARK: - Error Types

enum WebRTCError: LocalizedError {
    case notInitialized
    case peerConnectionNotFound
    case dataChannelNotFound
    case dataChannelNotOpen
    case connectionCreationFailed
    case dataChannelCreationFailed
    case offerCreationFailed
    case answerCreationFailed
    case sendFailed

    var errorDescription: String? {
        switch self {
        case .notInitialized:
            return "WebRTC not initialized"
        case .peerConnectionNotFound:
            return "Peer connection not found"
        case .dataChannelNotFound:
            return "Data channel not found"
        case .dataChannelNotOpen:
            return "Data channel is not open"
        case .connectionCreationFailed:
            return "Failed to create peer connection"
        case .dataChannelCreationFailed:
            return "Failed to create data channel"
        case .offerCreationFailed:
            return "Failed to create offer"
        case .answerCreationFailed:
            return "Failed to create answer"
        case .sendFailed:
            return "Failed to send message"
        }
    }
}

// MARK: - Notification Names

extension Notification.Name {
    static let webrtcConnectionStateChanged = Notification.Name("webrtcConnectionStateChanged")
    static let webrtcIceCandidate = Notification.Name("webrtcIceCandidate")
    static let webrtcMessageReceived = Notification.Name("webrtcMessageReceived")
    static let webrtcDataReceived = Notification.Name("webrtcDataReceived")
}


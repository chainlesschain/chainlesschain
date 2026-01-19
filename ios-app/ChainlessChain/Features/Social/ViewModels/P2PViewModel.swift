import Foundation
import SwiftUI

/// P2P View Model - Manages P2P connections and messaging for UI
@MainActor
class P2PViewModel: ObservableObject {
    @Published var connectedPeers: [PeerInfo] = []
    @Published var messages: [ChatMessage] = []
    @Published var isInitialized = false
    @Published var isConnecting = false
    @Published var errorMessage: String?
    @Published var statistics: P2PStatistics?

    private let p2pManager = P2PManager.shared
    private var selectedPeerId: String?

    struct PeerInfo: Identifiable {
        let id: String
        let name: String
        let status: P2PManager.ConnectionStatus
        let lastSeen: Date?
    }

    struct ChatMessage: Identifiable {
        let id: String
        let peerId: String
        let content: String
        let type: MessageManager.Message.MessageType
        let timestamp: Date
        let isOutgoing: Bool
        let status: MessageStatus

        enum MessageStatus {
            case sending
            case sent
            case delivered
            case failed
        }
    }

    init() {
        setupNotificationObservers()
    }

    // MARK: - Initialization

    func initialize(signalingServerURL: String? = nil) async {
        guard !isInitialized else { return }

        do {
            try await p2pManager.initialize(signalingServerURL: signalingServerURL)
            isInitialized = true
            updateStatistics()
        } catch {
            handleError(error)
        }
    }

    // MARK: - Connection Management

    func connectToPeer(peerId: String, peerName: String, preKeyBundle: SignalProtocolManager.PreKeyBundle? = nil) async {
        isConnecting = true
        defer { isConnecting = false }

        do {
            try await p2pManager.connectToPeer(peerId: peerId, preKeyBundle: preKeyBundle)

            // Add to connected peers
            let peerInfo = PeerInfo(
                id: peerId,
                name: peerName,
                status: .connected,
                lastSeen: Date()
            )
            connectedPeers.append(peerInfo)

            updateStatistics()
        } catch {
            handleError(error)
        }
    }

    func disconnectFromPeer(peerId: String) {
        p2pManager.disconnectFromPeer(peerId: peerId)
        connectedPeers.removeAll { $0.id == peerId }
        updateStatistics()
    }

    func selectPeer(peerId: String) {
        selectedPeerId = peerId
        loadMessages(for: peerId)
    }

    // MARK: - Messaging

    func sendMessage(to peerId: String, content: String, type: MessageManager.Message.MessageType = .text) async {
        do {
            let messageId = try await p2pManager.sendMessage(
                to: peerId,
                content: content,
                type: type,
                priority: .normal
            )

            // Add to local messages
            let message = ChatMessage(
                id: messageId,
                peerId: peerId,
                content: content,
                type: type,
                timestamp: Date(),
                isOutgoing: true,
                status: .sending
            )

            messages.append(message)

            // Update status to sent after a delay (simplified)
            Task {
                try? await Task.sleep(nanoseconds: 500_000_000) // 0.5s
                if let index = messages.firstIndex(where: { $0.id == messageId }) {
                    messages[index] = ChatMessage(
                        id: message.id,
                        peerId: message.peerId,
                        content: message.content,
                        type: message.type,
                        timestamp: message.timestamp,
                        isOutgoing: message.isOutgoing,
                        status: .sent
                    )
                }
            }

        } catch {
            handleError(error)
        }
    }

    private func loadMessages(for peerId: String) {
        // Load messages from local storage
        // This would integrate with a local database
        messages = []
    }

    // MARK: - Pre-Key Bundle Sharing

    func getPreKeyBundle() -> SignalProtocolManager.PreKeyBundle? {
        return try? p2pManager.getPreKeyBundle()
    }

    func sharePreKeyBundle() -> String? {
        guard let bundle = try? p2pManager.getPreKeyBundle() else {
            return nil
        }

        // Convert to shareable format (QR code, deep link, etc.)
        let bundleData = PreKeyBundleData(
            registrationId: bundle.registrationId,
            identityKey: bundle.identityKey.rawRepresentation.base64EncodedString(),
            signedPreKeyId: bundle.signedPreKey.keyId,
            signedPreKey: bundle.signedPreKey.publicKey.rawRepresentation.base64EncodedString(),
            signedPreKeySignature: bundle.signedPreKey.signature.base64EncodedString(),
            preKeyId: bundle.preKey.keyId,
            preKey: bundle.preKey.publicKey.rawRepresentation.base64EncodedString()
        )

        guard let jsonData = try? JSONEncoder().encode(bundleData),
              let jsonString = String(data: jsonData, encoding: .utf8) else {
            return nil
        }

        return jsonString.data(using: .utf8)?.base64EncodedString()
    }

    func importPreKeyBundle(from base64String: String) -> SignalProtocolManager.PreKeyBundle? {
        guard let data = Data(base64Encoded: base64String),
              let jsonString = String(data: data, encoding: .utf8),
              let jsonData = jsonString.data(using: .utf8),
              let bundleData = try? JSONDecoder().decode(PreKeyBundleData.self, from: jsonData) else {
            return nil
        }

        // Convert back to PreKeyBundle
        guard let identityKeyData = Data(base64Encoded: bundleData.identityKey),
              let identityKey = try? P256.KeyAgreement.PublicKey(rawRepresentation: identityKeyData),
              let signedPreKeyData = Data(base64Encoded: bundleData.signedPreKey),
              let signedPreKey = try? P256.KeyAgreement.PublicKey(rawRepresentation: signedPreKeyData),
              let signatureData = Data(base64Encoded: bundleData.signedPreKeySignature),
              let preKeyData = Data(base64Encoded: bundleData.preKey),
              let preKey = try? P256.KeyAgreement.PublicKey(rawRepresentation: preKeyData) else {
            return nil
        }

        return SignalProtocolManager.PreKeyBundle(
            registrationId: bundleData.registrationId,
            identityKey: identityKey,
            signedPreKey: SignalProtocolManager.PreKeyBundle.SignedPreKeyInfo(
                keyId: bundleData.signedPreKeyId,
                publicKey: signedPreKey,
                signature: signatureData
            ),
            preKey: SignalProtocolManager.PreKeyBundle.PreKeyInfo(
                keyId: bundleData.preKeyId,
                publicKey: preKey
            )
        )
    }

    // MARK: - Statistics

    private func updateStatistics() {
        statistics = p2pManager.getStatistics()
    }

    // MARK: - Notification Observers

    private func setupNotificationObservers() {
        // Peer connected
        NotificationCenter.default.addObserver(
            forName: .p2pPeerConnected,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let peerId = notification.userInfo?["peerId"] as? String else { return }

            Task { @MainActor in
                if let index = self?.connectedPeers.firstIndex(where: { $0.id == peerId }) {
                    self?.connectedPeers[index] = PeerInfo(
                        id: peerId,
                        name: self?.connectedPeers[index].name ?? peerId,
                        status: .connected,
                        lastSeen: Date()
                    )
                }
                self?.updateStatistics()
            }
        }

        // Peer disconnected
        NotificationCenter.default.addObserver(
            forName: .p2pPeerDisconnected,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let peerId = notification.userInfo?["peerId"] as? String else { return }

            Task { @MainActor in
                if let index = self?.connectedPeers.firstIndex(where: { $0.id == peerId }) {
                    self?.connectedPeers[index] = PeerInfo(
                        id: peerId,
                        name: self?.connectedPeers[index].name ?? peerId,
                        status: .disconnected,
                        lastSeen: Date()
                    )
                }
                self?.updateStatistics()
            }
        }

        // Message received
        NotificationCenter.default.addObserver(
            forName: .p2pMessageReceived,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let peerId = notification.userInfo?["peerId"] as? String,
                  let messageId = notification.userInfo?["messageId"] as? String,
                  let content = notification.userInfo?["content"] as? String,
                  let typeString = notification.userInfo?["type"] as? String,
                  let type = MessageManager.Message.MessageType(rawValue: typeString),
                  let timestamp = notification.userInfo?["timestamp"] as? Date else {
                return
            }

            Task { @MainActor in
                let message = ChatMessage(
                    id: messageId,
                    peerId: peerId,
                    content: content,
                    type: type,
                    timestamp: timestamp,
                    isOutgoing: false,
                    status: .delivered
                )

                self?.messages.append(message)
            }
        }
    }

    // MARK: - Error Handling

    private func handleError(_ error: Error) {
        errorMessage = error.localizedDescription
        print("❌ [P2PViewModel] Error: \(error)")
    }

    func clearError() {
        errorMessage = nil
    }

    // MARK: - Cleanup

    func cleanup() {
        p2pManager.cleanup()
        connectedPeers.removeAll()
        messages.removeAll()
        isInitialized = false
    }
}

// MARK: - Supporting Types

private struct PreKeyBundleData: Codable {
    let registrationId: UInt32
    let identityKey: String
    let signedPreKeyId: UInt32
    let signedPreKey: String
    let signedPreKeySignature: String
    let preKeyId: UInt32
    let preKey: String
}

// Import CryptoKit for P256
import CryptoKit

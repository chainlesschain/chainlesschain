import Foundation
import SwiftUI
import CoreCommon

/// P2P View Model - Manages P2P connections and messaging for UI
@MainActor
class P2PViewModel: ObservableObject {
    @Published var connectedPeers: [PeerInfo] = []
    @Published var conversations: [P2PConversationEntity] = []
    @Published var messages: [ChatMessage] = []
    @Published var isInitialized = false
    @Published var isConnecting = false
    @Published var errorMessage: String?
    @Published var statistics: P2PStatistics?

    private let p2pManager = P2PManager.shared
    private let messageRepository = P2PMessageRepository.shared
    private let logger = Logger.shared
    private var selectedPeerId: String?
    private var currentConversationId: String?
    private var myDid: String = ""

    // Notification observer tokens for cleanup
    private var notificationObservers: [NSObjectProtocol] = []

    // Rate limiting
    private var messageTimestamps: [String: [Date]] = [:]  // peerId -> timestamps
    private let maxMessagesPerSecond = 10
    private let rateLimitWindow: TimeInterval = 1.0
    private let maxTrackedPeersForRateLimit = 50
    private let staleEntryTimeout: TimeInterval = 3600  // 1 hour

    // Contact name cache (avoids N+1 database queries)
    private var contactNameCache: [String: String] = [:]
    private let maxContactCacheSize = 200

    struct PeerInfo: Identifiable {
        let id: String
        let name: String
        let status: P2PManager.ConnectionStatus
        let lastSeen: Date?
    }

    struct ChatMessage: Identifiable {
        let id: String
        let peerId: String
        var content: String
        let type: MessageManager.Message.MessageType
        let timestamp: Date
        let isOutgoing: Bool
        var status: MessageStatus
        var isRecalled: Bool = false
        var isEdited: Bool = false
        var editCount: Int = 0

        // Image support
        var imageData: Data?
        var thumbnailData: Data?
        var imageSize: CGSize?

        // Audio/voice support
        var audioData: Data?
        var audioDuration: TimeInterval?
        var audioFormat: String?        // "m4a"
        var voiceTranscription: String?
        var isPlaying: Bool = false
        var playbackProgress: Double = 0.0

        enum MessageStatus {
            case sending
            case sent
            case delivered
            case read
            case failed
            case recalled
            case edited
        }

        /// Check if this is an image message
        var isImageMessage: Bool {
            return type == .image && (imageData != nil || content.hasPrefix("data:image"))
        }

        /// Check if this is a voice message
        var isVoiceMessage: Bool {
            return type == .audio && (audioData != nil || content.hasPrefix("data:audio"))
        }

        /// Get UIImage from image data
        func getImage() -> UIImage? {
            if let data = imageData {
                return UIImage(data: data)
            }
            // Try to decode from base64 content
            if content.hasPrefix("data:image") {
                if let base64Start = content.range(of: ";base64,") {
                    let base64String = String(content[base64Start.upperBound...])
                    if let data = Data(base64Encoded: base64String) {
                        return UIImage(data: data)
                    }
                }
            } else if let data = Data(base64Encoded: content) {
                return UIImage(data: data)
            }
            return nil
        }

        /// Get thumbnail image
        func getThumbnail() -> UIImage? {
            if let data = thumbnailData {
                return UIImage(data: data)
            }
            return getImage()
        }
    }

    init() {
        setupNotificationObservers()
    }

    deinit {
        // Remove all notification observers to prevent memory leaks
        notificationObservers.forEach { NotificationCenter.default.removeObserver($0) }
        notificationObservers.removeAll()
    }

    // MARK: - Initialization

    func initialize(signalingServerURL: String? = nil) async {
        guard !isInitialized else { return }

        do {
            // Get my DID from UserDefaults or DID manager
            myDid = UserDefaults.standard.string(forKey: "current_user_id") ?? UUID().uuidString

            try await p2pManager.initialize(signalingServerURL: signalingServerURL)
            isInitialized = true

            // Load saved conversations
            await loadConversations()

            updateStatistics()
            logger.debug("[P2PViewModel] Initialized with myDid: \(myDid)")
        } catch {
            handleError(error)
        }
    }

    /// Load saved conversations
    func loadConversations() async {
        do {
            conversations = try messageRepository.getAllConversations()
            logger.debug("[P2PViewModel] Loaded \(conversations.count) conversations")

            // Restore peer list from conversations
            for conversation in conversations {
                if let otherDid = conversation.getOtherParticipant(myDid: myDid) {
                    let peerInfo = PeerInfo(
                        id: otherDid,
                        name: conversation.title ?? String(otherDid.prefix(8)),
                        status: .disconnected,
                        lastSeen: conversation.lastMessageAt
                    )

                    if !connectedPeers.contains(where: { $0.id == otherDid }) {
                        connectedPeers.append(peerInfo)
                    }
                }
            }
        } catch {
            logger.debug("[P2PViewModel] Error loading conversations: \(error)")
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

    /// Send image messages
    func sendImageMessages(to peerId: String, images: [UIImage]) async {
        for image in images {
            await sendImageMessage(to: peerId, image: image)
        }
    }

    /// Send single image message
    func sendImageMessage(to peerId: String, image: UIImage) async {
        do {
            // Ensure we have a conversation
            let conversation = try messageRepository.getOrCreateConversation(with: peerId, myDid: myDid)
            currentConversationId = conversation.id

            // Compress image on background thread to avoid blocking UI
            let (compressedData, thumbnailData, imageSize) = await compressImageInBackground(image)

            guard let imageData = compressedData else {
                handleError(P2PError.invalidMessageFormat)
                return
            }

            // Create base64 content with data URI
            let base64Content = "data:image/jpeg;base64,\(imageData.base64EncodedString())"

            let messageId = try await p2pManager.sendMessage(
                to: peerId,
                content: base64Content,
                type: .image,
                priority: .normal
            )

            let timestamp = Date()

            // Add to local messages with image data
            let message = ChatMessage(
                id: messageId,
                peerId: peerId,
                content: base64Content,
                type: .image,
                timestamp: timestamp,
                isOutgoing: true,
                status: .sending,
                imageData: imageData,
                thumbnailData: thumbnailData,
                imageSize: imageSize
            )

            messages.append(message)

            // Save to database
            let metadata = ImageMessageMetadata(
                width: Int(imageSize.width),
                height: Int(imageSize.height),
                size: imageData.count,
                mimeType: "image/jpeg"
            )

            let messageEntity = P2PMessageEntity(
                id: messageId,
                conversationId: conversation.id,
                senderDid: myDid,
                contentEncrypted: base64Content,
                contentType: "image",
                status: "sending",
                replyToId: nil,
                metadata: try? JSONEncoder().encode(metadata).base64EncodedString(),
                createdAt: timestamp,
                updatedAt: timestamp
            )

            try messageRepository.saveMessage(messageEntity)

            // Update status to sent after a delay
            Task {
                do {
                    try await Task.sleep(nanoseconds: 500_000_000) // 0.5s
                } catch {
                    logger.debug("[P2PViewModel] Sleep interrupted for message status update: \(messageId)")
                }
                if let index = messages.firstIndex(where: { $0.id == messageId }) {
                    var updatedMessage = messages[index]
                    updatedMessage.status = .sent
                    messages[index] = updatedMessage

                    // Update status in database
                    do {
                        try messageRepository.updateMessageStatus(id: messageId, status: "sent")
                    } catch {
                        logger.error("[P2PViewModel] Failed to update message status to sent: \(error)")
                    }
                }
            }

            logger.debug("[P2PViewModel] Image message sent and saved: \(messageId)")

        } catch {
            handleError(error)
        }
    }

    /// Compress image in background to avoid blocking UI
    private func compressImageInBackground(_ image: UIImage) async -> (Data?, Data?, CGSize) {
        // Run compression on background thread
        return await Task.detached(priority: .userInitiated) {
            Self.compressImageSync(image)
        }.value
    }

    /// Synchronous image compression (runs off main thread)
    private static func compressImageSync(_ image: UIImage) -> (Data?, Data?, CGSize) {
        let maxDimension: CGFloat = 1920
        let thumbnailDimension: CGFloat = 200
        let compressionQuality: CGFloat = 0.7

        // Get original size
        let originalSize = image.size

        // Resize if needed using UIGraphicsImageRenderer for better memory management
        var processedImage = image
        if max(originalSize.width, originalSize.height) > maxDimension {
            let scale = maxDimension / max(originalSize.width, originalSize.height)
            let newSize = CGSize(
                width: originalSize.width * scale,
                height: originalSize.height * scale
            )

            let renderer = UIGraphicsImageRenderer(size: newSize)
            processedImage = renderer.image { _ in
                image.draw(in: CGRect(origin: .zero, size: newSize))
            }
        }

        // Compress to JPEG
        let compressedData = processedImage.jpegData(compressionQuality: compressionQuality)

        // Create thumbnail using UIGraphicsImageRenderer
        let thumbnailScale = thumbnailDimension / max(processedImage.size.width, processedImage.size.height)
        let thumbnailSize = CGSize(
            width: processedImage.size.width * thumbnailScale,
            height: processedImage.size.height * thumbnailScale
        )

        let thumbnailRenderer = UIGraphicsImageRenderer(size: thumbnailSize)
        let thumbnailImage = thumbnailRenderer.image { _ in
            processedImage.draw(in: CGRect(origin: .zero, size: thumbnailSize))
        }

        let thumbnailData = thumbnailImage.jpegData(compressionQuality: 0.5)

        return (compressedData, thumbnailData, processedImage.size)
    }

    /// Send voice message
    func sendVoiceMessage(to peerId: String, audioData: Data, duration: TimeInterval) async {
        // Rate limiting check
        guard checkRateLimit(for: peerId) else {
            errorMessage = "发送过于频繁，请稍后再试"
            return
        }

        do {
            // Ensure we have a conversation
            let conversation = try messageRepository.getOrCreateConversation(with: peerId, myDid: myDid)
            currentConversationId = conversation.id

            // Encode audio as data URI
            let base64Content = "data:audio/m4a;base64,\(audioData.base64EncodedString())"

            let messageId = try await p2pManager.sendMessage(
                to: peerId,
                content: base64Content,
                type: .audio,
                priority: .normal
            )

            let timestamp = Date()

            // Add to local messages with audio data
            let message = ChatMessage(
                id: messageId,
                peerId: peerId,
                content: base64Content,
                type: .audio,
                timestamp: timestamp,
                isOutgoing: true,
                status: .sending,
                audioData: audioData,
                audioDuration: duration,
                audioFormat: "m4a"
            )

            messages.append(message)

            // Save to database
            let metadata = AudioMessageMetadata(
                duration: duration,
                format: "m4a",
                size: audioData.count
            )

            let messageEntity = P2PMessageEntity(
                id: messageId,
                conversationId: conversation.id,
                senderDid: myDid,
                contentEncrypted: base64Content,
                contentType: "audio",
                status: "sending",
                replyToId: nil,
                metadata: try? JSONEncoder().encode(metadata).base64EncodedString(),
                createdAt: timestamp,
                updatedAt: timestamp
            )

            try messageRepository.saveMessage(messageEntity)

            // Update status to sent after a delay
            Task {
                do {
                    try await Task.sleep(nanoseconds: 500_000_000) // 0.5s
                } catch {
                    logger.debug("[P2PViewModel] Sleep interrupted for voice message status: \(messageId)")
                }
                if let index = messages.firstIndex(where: { $0.id == messageId }) {
                    var updatedMessage = messages[index]
                    updatedMessage.status = .sent
                    messages[index] = updatedMessage

                    do {
                        try messageRepository.updateMessageStatus(id: messageId, status: "sent")
                    } catch {
                        logger.error("[P2PViewModel] Failed to update voice message status: \(error)")
                    }
                }
            }

            logger.debug("[P2PViewModel] Voice message sent: \(messageId), duration: \(duration)s")

        } catch {
            handleError(error)
        }
    }

    func sendMessage(to peerId: String, content: String, type: MessageManager.Message.MessageType = .text) async {
        // Rate limiting check
        guard checkRateLimit(for: peerId) else {
            errorMessage = "发送过于频繁，请稍后再试"
            logger.warning("[P2PViewModel] Rate limit exceeded for peer: \(peerId)", category: "P2P")
            return
        }

        do {
            // Ensure we have a conversation
            let conversation = try messageRepository.getOrCreateConversation(with: peerId, myDid: myDid)
            currentConversationId = conversation.id

            let messageId = try await p2pManager.sendMessage(
                to: peerId,
                content: content,
                type: type,
                priority: .normal
            )

            let timestamp = Date()

            // Add to local messages
            let message = ChatMessage(
                id: messageId,
                peerId: peerId,
                content: content,
                type: type,
                timestamp: timestamp,
                isOutgoing: true,
                status: .sending
            )

            messages.append(message)

            // Save to database
            let messageEntity = P2PMessageEntity(
                id: messageId,
                conversationId: conversation.id,
                senderDid: myDid,
                contentEncrypted: content, // Note: Already encrypted by P2PManager
                contentType: type.rawValue,
                status: "sending",
                replyToId: nil,
                metadata: nil,
                createdAt: timestamp,
                updatedAt: timestamp
            )

            try messageRepository.saveMessage(messageEntity)

            // Update status to sent after a delay
            Task {
                do {
                    try await Task.sleep(nanoseconds: 500_000_000) // 0.5s
                } catch {
                    logger.debug("[P2PViewModel] Sleep interrupted for message status update: \(messageId)")
                }
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

                    // Update status in database
                    do {
                        try messageRepository.updateMessageStatus(id: messageId, status: "sent")
                    } catch {
                        logger.error("[P2PViewModel] Failed to update message status to sent: \(error)")
                    }
                }
            }

            logger.debug("[P2PViewModel] Message sent and saved: \(messageId)")

        } catch {
            handleError(error)
        }
    }

    private func loadMessages(for peerId: String) {
        do {
            // Find or create conversation for this peer
            let conversation = try messageRepository.getOrCreateConversation(with: peerId, myDid: myDid)
            currentConversationId = conversation.id

            // Load messages from database
            let messageEntities = try messageRepository.getRecentMessages(conversationId: conversation.id, limit: 100)

            // Convert to ChatMessage
            messages = messageEntities.map { entity in
                ChatMessage(
                    id: entity.id,
                    peerId: peerId,
                    content: entity.contentEncrypted, // Note: In production, this should be decrypted
                    type: MessageManager.Message.MessageType(rawValue: entity.contentType) ?? .text,
                    timestamp: entity.createdAt,
                    isOutgoing: entity.isOutgoing(myDid: myDid),
                    status: mapMessageStatus(entity.status)
                )
            }

            // Reset unread count
            try messageRepository.resetUnreadCount(conversationId: conversation.id)

            logger.debug("[P2PViewModel] Loaded \(messages.count) messages for peer: \(peerId)")
        } catch {
            logger.debug("[P2PViewModel] Error loading messages: \(error)")
            messages = []
        }
    }

    private func mapMessageStatus(_ status: String) -> ChatMessage.MessageStatus {
        switch status {
        case "sending":
            return .sending
        case "sent":
            return .sent
        case "delivered":
            return .delivered
        case "read":
            return .read
        case "failed":
            return .failed
        case "recalled":
            return .recalled
        case "edited":
            return .edited
        default:
            return .sent
        }
    }

    // MARK: - Message Recall

    /// 撤回消息
    func recallMessage(messageId: String) async {
        do {
            let success = try await MessageStatusManager.shared.recallMessage(messageId: messageId)
            if success {
                // Update local message
                if let index = messages.firstIndex(where: { $0.id == messageId }) {
                    messages[index].isRecalled = true
                    messages[index].status = .recalled
                    messages[index].content = "[消息已撤回]"
                }
                logger.debug("[P2PViewModel] Message recalled: \(messageId)")
            }
        } catch {
            handleError(error)
        }
    }

    // MARK: - Message Edit

    /// 编辑消息
    func editMessage(messageId: String, newContent: String) async {
        do {
            let success = try await MessageStatusManager.shared.editMessage(messageId: messageId, newContent: newContent)
            if success {
                // Update local message
                if let index = messages.firstIndex(where: { $0.id == messageId }) {
                    messages[index].content = newContent
                    messages[index].isEdited = true
                    messages[index].editCount += 1
                    messages[index].status = .edited
                }
                logger.debug("[P2PViewModel] Message edited: \(messageId)")
            }
        } catch {
            handleError(error)
        }
    }

    // MARK: - Mark As Read

    /// 标记会话为已读
    func markConversationAsRead() async {
        guard let conversationId = currentConversationId else { return }

        do {
            try await MessageStatusManager.shared.markConversationAsRead(conversationId: conversationId, myDid: myDid)

            // Update local messages
            for index in messages.indices {
                if !messages[index].isOutgoing && messages[index].status != .read {
                    messages[index].status = .read
                }
            }
        } catch {
            logger.debug("[P2PViewModel] Error marking as read: \(error)")
        }
    }

    // MARK: - Typing Indicator

    /// 发送正在输入指示
    func sendTypingIndicator(to peerId: String) {
        MessageStatusManager.shared.sendTypingIndicator(to: peerId, myDid: myDid)
    }

    /// 发送停止输入指示
    func sendStopTypingIndicator(to peerId: String) {
        MessageStatusManager.shared.sendStopTypingIndicator(to: peerId, myDid: myDid)
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
        let peerConnectedObserver = NotificationCenter.default.addObserver(
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
        notificationObservers.append(peerConnectedObserver)

        // Peer disconnected
        let peerDisconnectedObserver = NotificationCenter.default.addObserver(
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
        notificationObservers.append(peerDisconnectedObserver)

        // Message received
        let messageReceivedObserver = NotificationCenter.default.addObserver(
            forName: .p2pMessageReceived,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let self = self,
                  let peerId = notification.userInfo?["peerId"] as? String,
                  let messageId = notification.userInfo?["messageId"] as? String,
                  let content = notification.userInfo?["content"] as? String,
                  let typeString = notification.userInfo?["type"] as? String,
                  let type = MessageManager.Message.MessageType(rawValue: typeString),
                  let timestamp = notification.userInfo?["timestamp"] as? Date else {
                return
            }

            Task { @MainActor in
                // Create chat message with type-specific data
                var audioData: Data?
                var audioDuration: TimeInterval?

                if type == .audio, content.hasPrefix("data:audio") {
                    if let base64Start = content.range(of: ";base64,") {
                        let base64String = String(content[base64Start.upperBound...])
                        audioData = Data(base64Encoded: base64String)
                    }
                }

                let message = ChatMessage(
                    id: messageId,
                    peerId: peerId,
                    content: content,
                    type: type,
                    timestamp: timestamp,
                    isOutgoing: false,
                    status: .delivered,
                    audioData: audioData,
                    audioDuration: audioDuration
                )

                self.messages.append(message)

                // Save to database
                do {
                    let conversation = try self.messageRepository.getOrCreateConversation(with: peerId, myDid: self.myDid)

                    let messageEntity = P2PMessageEntity(
                        id: messageId,
                        conversationId: conversation.id,
                        senderDid: peerId,
                        contentEncrypted: content,
                        contentType: type.rawValue,
                        status: "delivered",
                        replyToId: nil,
                        metadata: nil,
                        createdAt: timestamp,
                        updatedAt: timestamp
                    )

                    try self.messageRepository.saveMessage(messageEntity)

                    // Increment unread count if not viewing this conversation
                    if self.selectedPeerId != peerId {
                        try self.messageRepository.incrementUnreadCount(conversationId: conversation.id)

                        // Trigger push notification for new message
                        await self.triggerMessageNotification(
                            from: peerId,
                            content: content,
                            type: type,
                            conversationId: conversation.id
                        )
                    }

                    logger.debug("[P2PViewModel] Received and saved message: \(messageId)")
                } catch {
                    logger.debug("[P2PViewModel] Error saving received message: \(error)")
                }
            }
        }
        notificationObservers.append(messageReceivedObserver)

        // Message status updated
        let statusUpdatedObserver = NotificationCenter.default.addObserver(
            forName: .messageStatusUpdated,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let self = self,
                  let messageId = notification.userInfo?["messageId"] as? String,
                  let status = notification.userInfo?["status"] as? MessageStatusManager.MessageStatus else {
                return
            }

            Task { @MainActor in
                if let index = self.messages.firstIndex(where: { $0.id == messageId }) {
                    self.messages[index].status = self.mapManagerStatus(status)
                }
            }
        }
        notificationObservers.append(statusUpdatedObserver)

        // Message recalled
        let messageRecalledObserver = NotificationCenter.default.addObserver(
            forName: .messageRecalled,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let self = self,
                  let messageId = notification.userInfo?["messageId"] as? String else {
                return
            }

            Task { @MainActor in
                if let index = self.messages.firstIndex(where: { $0.id == messageId }) {
                    self.messages[index].isRecalled = true
                    self.messages[index].status = .recalled
                    self.messages[index].content = "[消息已撤回]"
                }
            }
        }
        notificationObservers.append(messageRecalledObserver)

        // Message edited
        let messageEditedObserver = NotificationCenter.default.addObserver(
            forName: .messageEdited,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let self = self,
                  let messageId = notification.userInfo?["messageId"] as? String,
                  let newContent = notification.userInfo?["newContent"] as? String else {
                return
            }

            Task { @MainActor in
                if let index = self.messages.firstIndex(where: { $0.id == messageId }) {
                    self.messages[index].content = newContent
                    self.messages[index].isEdited = true
                    self.messages[index].editCount += 1
                }
            }
        }
        notificationObservers.append(messageEditedObserver)

        // Peer typing
        let peerTypingObserver = NotificationCenter.default.addObserver(
            forName: .peerTyping,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let senderDid = notification.userInfo?["senderDid"] as? String else { return }

            Task { @MainActor in
                if let index = self?.connectedPeers.firstIndex(where: { $0.id == senderDid }) {
                    // Could add typing indicator state to PeerInfo
                    self?.logger.debug("[P2PViewModel] Peer typing: \(senderDid)")
                }
            }
        }
        notificationObservers.append(peerTypingObserver)
    }

    /// Map MessageStatusManager status to ChatMessage status
    private func mapManagerStatus(_ status: MessageStatusManager.MessageStatus) -> ChatMessage.MessageStatus {
        switch status {
        case .sending: return .sending
        case .sent: return .sent
        case .delivered: return .delivered
        case .read: return .read
        case .failed: return .failed
        case .recalled: return .recalled
        case .edited: return .edited
        }
    }

    // MARK: - Push Notifications

    /// Trigger a push notification for incoming message
    private func triggerMessageNotification(
        from peerId: String,
        content: String,
        type: MessageManager.Message.MessageType,
        conversationId: String
    ) async {
        // Get sender name from contacts or use peer ID
        let senderName = getPeerName(peerId: peerId)

        // Prepare notification content based on message type
        let notificationContent: String
        switch type {
        case .image:
            notificationContent = "[图片消息]"
        case .audio:
            notificationContent = "[语音消息]"
        case .video:
            notificationContent = "[视频消息]"
        case .file:
            notificationContent = "[文件]"
        default:
            notificationContent = content
        }

        await PushNotificationManager.shared.scheduleMessageNotification(
            from: senderName,
            senderId: peerId,
            content: notificationContent,
            conversationId: conversationId,
            isGroupMessage: false
        )
    }

    /// Get peer display name (with caching to avoid repeated database queries)
    private func getPeerName(peerId: String) -> String {
        // Check connected peers first
        if let peer = connectedPeers.first(where: { $0.id == peerId }) {
            contactNameCache[peerId] = peer.name
            return peer.name
        }

        // Check cache
        if let cachedName = contactNameCache[peerId] {
            return cachedName
        }

        // Try to get from contacts repository
        if let contact = try? P2PContactRepository.shared.getContact(did: peerId) {
            let name = contact.displayName ?? String(peerId.prefix(8))

            // Cache the result
            if contactNameCache.count >= maxContactCacheSize {
                // Remove oldest entry (simple LRU approximation)
                contactNameCache.removeValue(forKey: contactNameCache.keys.first ?? "")
            }
            contactNameCache[peerId] = name

            return name
        }

        // Fallback to truncated peer ID
        let name = String(peerId.prefix(8))
        contactNameCache[peerId] = name
        return name
    }

    /// Invalidate cached contact name (call when contact is updated)
    func invalidateContactNameCache(for peerId: String? = nil) {
        if let peerId = peerId {
            contactNameCache.removeValue(forKey: peerId)
        } else {
            contactNameCache.removeAll()
        }
    }

    // MARK: - Rate Limiting

    /// Check if sending a message is within rate limits
    private func checkRateLimit(for peerId: String) -> Bool {
        let now = Date()

        // Get existing timestamps for this peer
        var timestamps = messageTimestamps[peerId] ?? []

        // Remove timestamps outside the rate limit window
        timestamps = timestamps.filter { now.timeIntervalSince($0) < rateLimitWindow }

        // Check if we're at the limit
        if timestamps.count >= maxMessagesPerSecond {
            return false
        }

        // Record this message timestamp
        timestamps.append(now)
        messageTimestamps[peerId] = timestamps

        // Clean up old entries periodically (every 100 messages)
        if messageTimestamps.values.flatMap({ $0 }).count > 100 {
            cleanupRateLimitTracking()
        }

        return true
    }

    /// Clean up old rate limit tracking data
    private func cleanupRateLimitTracking() {
        let now = Date()

        // First pass: remove expired timestamps and stale entries
        for (peerId, timestamps) in messageTimestamps {
            let validTimestamps = timestamps.filter { now.timeIntervalSince($0) < rateLimitWindow }
            if validTimestamps.isEmpty {
                // Check if entry is stale (no activity for staleEntryTimeout)
                if let lastTimestamp = timestamps.max(), now.timeIntervalSince(lastTimestamp) > staleEntryTimeout {
                    messageTimestamps.removeValue(forKey: peerId)
                } else if timestamps.isEmpty {
                    messageTimestamps.removeValue(forKey: peerId)
                } else {
                    // Keep empty array for recent peers to track rate limiting
                    messageTimestamps[peerId] = validTimestamps
                }
            } else {
                messageTimestamps[peerId] = validTimestamps
            }
        }

        // Second pass: enforce max tracked peers limit (LRU eviction)
        if messageTimestamps.count > maxTrackedPeersForRateLimit {
            // Sort by most recent timestamp and keep only the newest entries
            let sortedPeers = messageTimestamps.sorted { entry1, entry2 in
                let max1 = entry1.value.max() ?? Date.distantPast
                let max2 = entry2.value.max() ?? Date.distantPast
                return max1 > max2  // Descending order (newest first)
            }

            let peersToKeep = Set(sortedPeers.prefix(maxTrackedPeersForRateLimit).map { $0.key })
            messageTimestamps = messageTimestamps.filter { peersToKeep.contains($0.key) }
        }
    }

    // MARK: - Error Handling

    private func handleError(_ error: Error) {
        errorMessage = error.localizedDescription
        logger.error("P2PViewModel error", error: error, category: "P2P")
    }

    func clearError() {
        errorMessage = nil
    }

    // MARK: - Cleanup

    func cleanup() {
        // Remove notification observers
        notificationObservers.forEach { NotificationCenter.default.removeObserver($0) }
        notificationObservers.removeAll()

        p2pManager.cleanup()
        connectedPeers.removeAll()
        messages.removeAll()
        isInitialized = false
    }
}

// MARK: - Supporting Types

/// Image message metadata
struct ImageMessageMetadata: Codable {
    let width: Int
    let height: Int
    let size: Int  // bytes
    let mimeType: String
}

/// Audio message metadata
struct AudioMessageMetadata: Codable {
    let duration: TimeInterval  // seconds
    let format: String          // "m4a"
    let size: Int               // bytes
}

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

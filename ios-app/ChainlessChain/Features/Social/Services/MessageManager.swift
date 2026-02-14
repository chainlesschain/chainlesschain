import Foundation
import CoreCommon

/// Message Manager - Handles message deduplication, batching, and delivery
/// Reference: desktop-app-vue/src/main/p2p/message-manager.js
@MainActor
class MessageManager: ObservableObject {
    static let shared = MessageManager()

    private let logger = Logger.shared

    // Configuration
    private let batchSize: Int = AppConfig.P2P.batchSize
    private let batchInterval: TimeInterval = AppConfig.P2P.batchInterval
    private let deduplicationWindow: TimeInterval = AppConfig.P2P.deduplicationWindow
    private let maxDeduplicationCache: Int = AppConfig.P2P.maxDeduplicationCache

    // Message queues
    private var outgoingQueues: [String: [Message]] = [:] // peerId -> messages
    private var batchTimers: [String: Timer] = [:]

    // Cleanup timer
    private var cleanupTimer: Timer?

    // Deduplication cache
    private var receivedMessages: [String: Date] = [:] // messageId -> timestamp
    private var sentMessages: [String: SentMessage] = [:] // messageId -> message info

    // Statistics
    @Published var stats = MessageStats()

    struct MessageStats {
        var messagesSent: Int = 0
        var messagesReceived: Int = 0
        var messagesDuplicated: Int = 0
        var batchesSent: Int = 0
    }

    struct Message: Codable, Identifiable {
        let id: String
        let type: MessageType
        let payload: String
        let timestamp: Date
        let priority: Priority
        let requireAck: Bool

        enum MessageType: String, Codable {
            case text
            case image
            case audio
            case video
            case file
            case system
        }

        enum Priority: String, Codable {
            case high
            case normal
            case low
        }
    }

    struct SentMessage {
        let message: Message
        let peerId: String
        let sentAt: Date
        var retries: Int
    }

    private init() {
        // Start cleanup timer
        startCleanupTimer()
    }

    // MARK: - Message Sending

    /// Send message with deduplication and batching
    func sendMessage(
        to peerId: String,
        payload: String,
        type: Message.MessageType = .text,
        priority: Message.Priority = .normal,
        requireAck: Bool = false,
        immediate: Bool = false
    ) async -> String {
        // Generate message ID
        let messageId = generateMessageId()

        // Build message
        let message = Message(
            id: messageId,
            type: type,
            payload: payload,
            timestamp: Date(),
            priority: priority,
            requireAck: requireAck
        )

        // Record sent message
        sentMessages[messageId] = SentMessage(
            message: message,
            peerId: peerId,
            sentAt: Date(),
            retries: 0
        )

        // High priority or immediate send
        if priority == .high || immediate {
            await sendImmediately(peerId: peerId, message: message)
        } else {
            // Add to batch queue
            queueMessage(peerId: peerId, message: message)
        }

        stats.messagesSent += 1

        return messageId
    }

    /// Receive message with deduplication
    func receiveMessage(from peerId: String, message: Message) -> Bool {
        // Check for duplicates
        if isDuplicate(messageId: message.id) {
            logger.debug("[MessageManager] Duplicate message ignored: \(message.id)")
            stats.messagesDuplicated += 1
            return false
        }

        // Record received message
        receivedMessages[message.id] = Date()

        stats.messagesReceived += 1

        logger.debug("[MessageManager] Message received from \(peerId): \(message.id)")

        return true
    }

    // MARK: - Batching

    /// Queue message for batch sending
    private func queueMessage(peerId: String, message: Message) {
        if outgoingQueues[peerId] == nil {
            outgoingQueues[peerId] = []
        }

        outgoingQueues[peerId]?.append(message)

        // Check if batch size reached
        if let queue = outgoingQueues[peerId], queue.count >= batchSize {
            Task {
                await flushQueue(peerId: peerId)
            }
        } else {
            // Schedule batch send
            scheduleBatchSend(peerId: peerId)
        }
    }

    /// Schedule batch send
    private func scheduleBatchSend(peerId: String) {
        // Cancel existing timer
        batchTimers[peerId]?.invalidate()

        // Create new timer
        let timer = Timer.scheduledTimer(withTimeInterval: batchInterval, repeats: false) { [weak self] _ in
            Task { @MainActor in
                await self?.flushQueue(peerId: peerId)
            }
        }

        batchTimers[peerId] = timer
    }

    /// Flush queue (batch send)
    private func flushQueue(peerId: String) async {
        guard let queue = outgoingQueues[peerId], !queue.isEmpty else {
            return
        }

        logger.debug("[MessageManager] Batch sending \(queue.count) messages to: \(peerId)")

        // Cancel timer
        batchTimers[peerId]?.invalidate()
        batchTimers.removeValue(forKey: peerId)

        // Send batch
        await sendBatch(peerId: peerId, messages: queue)

        // Clear queue
        outgoingQueues[peerId] = []

        stats.batchesSent += 1
    }

    /// Send immediately
    private func sendImmediately(peerId: String, message: Message) async {
        logger.debug("[MessageManager] Sending message immediately: \(message.id)")

        // Notify P2P manager to send
        NotificationCenter.default.post(
            name: .p2pSendMessage,
            object: nil,
            userInfo: ["peerId": peerId, "message": message]
        )
    }

    /// Send batch
    private func sendBatch(peerId: String, messages: [Message]) async {
        logger.debug("[MessageManager] Sending batch: \(messages.count) messages")

        // Notify P2P manager to send batch
        NotificationCenter.default.post(
            name: .p2pSendBatch,
            object: nil,
            userInfo: ["peerId": peerId, "messages": messages]
        )
    }

    // MARK: - Deduplication

    /// Check if message is duplicate
    private func isDuplicate(messageId: String) -> Bool {
        return receivedMessages[messageId] != nil
    }

    /// Generate message ID
    private func generateMessageId() -> String {
        let timestamp = Date().timeIntervalSince1970
        let random = UUID().uuidString.prefix(8)
        let counter = stats.messagesSent

        return "\(Int(timestamp))-\(random)-\(counter)"
    }

    // MARK: - Cleanup

    /// Start cleanup timer
    private func startCleanupTimer() {
        // Invalidate existing timer if any
        cleanupTimer?.invalidate()

        cleanupTimer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.cleanupExpiredMessages()
            }
        }
    }

    /// Stop cleanup timer
    func stopCleanupTimer() {
        cleanupTimer?.invalidate()
        cleanupTimer = nil
    }

    /// Cleanup expired messages
    private func cleanupExpiredMessages() {
        let now = Date()

        // Clean received messages
        receivedMessages = receivedMessages.filter { _, timestamp in
            now.timeIntervalSince(timestamp) < deduplicationWindow
        }

        // Limit cache size using LRU eviction
        if receivedMessages.count > maxDeduplicationCache {
            // Sort by timestamp (oldest first) using safe optional binding
            let sorted = receivedMessages.sorted { entry1, entry2 in
                entry1.value < entry2.value
            }
            let keysToRemove = sorted.prefix(receivedMessages.count - maxDeduplicationCache).map { $0.key }
            keysToRemove.forEach { receivedMessages.removeValue(forKey: $0) }
        }

        logger.debug("[MessageManager] Cleanup: \(receivedMessages.count) messages in cache")
    }

    /// Clear all queues
    func clearQueues() {
        outgoingQueues.removeAll()
        batchTimers.values.forEach { $0.invalidate() }
        batchTimers.removeAll()

        logger.debug("[MessageManager] All queues cleared")
    }

    /// Get statistics
    func getStats() -> MessageStats {
        return stats
    }
}

// MARK: - Notification Names

extension Notification.Name {
    static let p2pSendMessage = Notification.Name("p2pSendMessage")
    static let p2pSendBatch = Notification.Name("p2pSendBatch")
    static let p2pMessageReceived = Notification.Name("p2pMessageReceived")
}


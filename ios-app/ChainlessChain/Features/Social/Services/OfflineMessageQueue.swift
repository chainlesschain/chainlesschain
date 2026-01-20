import Foundation
import SQLite3
import CoreDatabase
import CoreCommon

/// 离线消息队列管理器
/// 负责在断线时持久化待发送消息，并在重连后自动发送
class OfflineMessageQueue {
    // MARK: - Singleton

    static let shared = OfflineMessageQueue()

    // MARK: - Private Properties

    private let database = DatabaseManager.shared
    private let logger = Logger.shared

    // In-memory queue for quick access
    private var pendingMessages: [String: [QueuedMessage]] = [:]  // peerId -> messages

    // Configuration
    private let maxRetries = 5
    private let retryDelays: [TimeInterval] = [1, 2, 5, 10, 30]  // seconds

    private init() {
        createTableIfNeeded()
        loadPendingMessages()
    }

    // MARK: - Table Creation

    private func createTableIfNeeded() {
        let sql = """
            CREATE TABLE IF NOT EXISTS offline_message_queue (
                id TEXT PRIMARY KEY,
                peer_id TEXT NOT NULL,
                message_type TEXT NOT NULL,
                payload TEXT NOT NULL,
                priority TEXT DEFAULT 'normal',
                require_ack INTEGER DEFAULT 0,
                retry_count INTEGER DEFAULT 0,
                max_retries INTEGER DEFAULT 5,
                last_retry_at INTEGER,
                expires_at INTEGER,
                status TEXT DEFAULT 'pending',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )
        """

        do {
            try database.execute(sql)

            // Create index for efficient queries
            try database.execute("CREATE INDEX IF NOT EXISTS idx_offline_queue_peer ON offline_message_queue(peer_id, status)")
            try database.execute("CREATE INDEX IF NOT EXISTS idx_offline_queue_status ON offline_message_queue(status, created_at)")

            logger.database("Offline message queue table ready")
        } catch {
            logger.error("Failed to create offline_message_queue table", error: error, category: "P2P")
        }
    }

    // MARK: - Queue Operations

    /// Add message to offline queue
    func enqueue(
        peerId: String,
        messageType: String,
        payload: String,
        priority: MessageManager.Message.Priority = .normal,
        requireAck: Bool = false,
        expiresIn: TimeInterval? = nil
    ) throws -> String {
        let messageId = generateMessageId()
        let now = Date()

        let message = QueuedMessage(
            id: messageId,
            peerId: peerId,
            messageType: messageType,
            payload: payload,
            priority: priority,
            requireAck: requireAck,
            retryCount: 0,
            maxRetries: maxRetries,
            lastRetryAt: nil,
            expiresAt: expiresIn.map { now.addingTimeInterval($0) },
            status: .pending,
            createdAt: now,
            updatedAt: now
        )

        // Save to database
        try saveMessage(message)

        // Add to in-memory queue
        if pendingMessages[peerId] == nil {
            pendingMessages[peerId] = []
        }
        pendingMessages[peerId]?.append(message)

        // Sort by priority
        sortQueueByPriority(peerId: peerId)

        logger.info("Enqueued offline message: \(messageId) for peer: \(peerId)", category: "P2P")

        return messageId
    }

    /// Get pending messages for a peer
    func getPendingMessages(for peerId: String) -> [QueuedMessage] {
        return pendingMessages[peerId]?.filter { $0.status == .pending && !$0.isExpired } ?? []
    }

    /// Get all pending messages
    func getAllPendingMessages() -> [QueuedMessage] {
        return pendingMessages.values.flatMap { $0 }.filter { $0.status == .pending && !$0.isExpired }
    }

    /// Mark message as sent
    func markAsSent(messageId: String) throws {
        try updateStatus(messageId: messageId, status: .sent)

        // Remove from in-memory queue
        for (peerId, var messages) in pendingMessages {
            if let index = messages.firstIndex(where: { $0.id == messageId }) {
                messages.remove(at: index)
                pendingMessages[peerId] = messages
                break
            }
        }

        logger.info("Marked message as sent: \(messageId)", category: "P2P")
    }

    /// Mark message as failed
    func markAsFailed(messageId: String, shouldRetry: Bool = true) throws {
        guard var message = findMessage(id: messageId) else { return }

        if shouldRetry && message.retryCount < message.maxRetries {
            // Schedule retry
            message.retryCount += 1
            message.lastRetryAt = Date()
            message.status = .retrying
            try updateMessage(message)

            logger.info("Message scheduled for retry: \(messageId) (attempt \(message.retryCount)/\(message.maxRetries))", category: "P2P")
        } else {
            // Mark as permanently failed
            try updateStatus(messageId: messageId, status: .failed)
            removeFromMemory(messageId: messageId)

            logger.error("Message permanently failed: \(messageId)", category: "P2P")
        }
    }

    /// Process retry queue
    func processRetryQueue() async {
        let now = Date()

        for (peerId, messages) in pendingMessages {
            for message in messages where message.status == .retrying {
                // Check if enough time has passed for retry
                if let lastRetry = message.lastRetryAt {
                    let delayIndex = min(message.retryCount - 1, retryDelays.count - 1)
                    let requiredDelay = retryDelays[delayIndex]

                    if now.timeIntervalSince(lastRetry) >= requiredDelay {
                        // Ready for retry - notify observers
                        NotificationCenter.default.post(
                            name: .offlineMessageReadyForRetry,
                            object: nil,
                            userInfo: ["peerId": peerId, "message": message]
                        )
                    }
                }
            }
        }
    }

    /// Remove expired messages
    func cleanupExpiredMessages() throws {
        let now = Date()
        var expiredIds: [String] = []

        for (_, messages) in pendingMessages {
            for message in messages where message.isExpired {
                expiredIds.append(message.id)
            }
        }

        for id in expiredIds {
            try updateStatus(messageId: id, status: .expired)
            removeFromMemory(messageId: id)
        }

        if !expiredIds.isEmpty {
            logger.info("Cleaned up \(expiredIds.count) expired messages", category: "P2P")
        }
    }

    /// Clear queue for a peer
    func clearQueue(for peerId: String) throws {
        try database.execute("DELETE FROM offline_message_queue WHERE peer_id = '\(peerId)'")
        pendingMessages.removeValue(forKey: peerId)

        logger.info("Cleared offline queue for peer: \(peerId)", category: "P2P")
    }

    /// Clear all queues
    func clearAllQueues() throws {
        try database.execute("DELETE FROM offline_message_queue")
        pendingMessages.removeAll()

        logger.info("Cleared all offline queues", category: "P2P")
    }

    // MARK: - Database Operations

    private func saveMessage(_ message: QueuedMessage) throws {
        let sql = """
            INSERT INTO offline_message_queue
            (id, peer_id, message_type, payload, priority, require_ack, retry_count, max_retries,
             last_retry_at, expires_at, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """

        _ = try database.query(sql, parameters: [
            message.id,
            message.peerId,
            message.messageType,
            message.payload,
            message.priority.rawValue,
            message.requireAck ? 1 : 0,
            message.retryCount,
            message.maxRetries,
            message.lastRetryAt?.timestampMs as Any?,
            message.expiresAt?.timestampMs as Any?,
            message.status.rawValue,
            message.createdAt.timestampMs,
            message.updatedAt.timestampMs
        ]) { _ in () }
    }

    private func updateMessage(_ message: QueuedMessage) throws {
        let sql = """
            UPDATE offline_message_queue
            SET retry_count = ?, last_retry_at = ?, status = ?, updated_at = ?
            WHERE id = ?
        """

        _ = try database.query(sql, parameters: [
            message.retryCount,
            message.lastRetryAt?.timestampMs as Any?,
            message.status.rawValue,
            Date().timestampMs,
            message.id
        ]) { _ in () }

        // Update in-memory
        updateInMemory(message)
    }

    private func updateStatus(messageId: String, status: QueuedMessage.Status) throws {
        let sql = "UPDATE offline_message_queue SET status = ?, updated_at = ? WHERE id = ?"

        _ = try database.query(sql, parameters: [
            status.rawValue,
            Date().timestampMs,
            messageId
        ]) { _ in () }
    }

    private func loadPendingMessages() {
        let sql = """
            SELECT id, peer_id, message_type, payload, priority, require_ack, retry_count, max_retries,
                   last_retry_at, expires_at, status, created_at, updated_at
            FROM offline_message_queue
            WHERE status IN ('pending', 'retrying')
            ORDER BY created_at ASC
        """

        do {
            let messages: [QueuedMessage] = try database.query(sql, parameters: []) { stmt in
                QueuedMessage(
                    id: String(cString: sqlite3_column_text(stmt, 0)),
                    peerId: String(cString: sqlite3_column_text(stmt, 1)),
                    messageType: String(cString: sqlite3_column_text(stmt, 2)),
                    payload: String(cString: sqlite3_column_text(stmt, 3)),
                    priority: MessageManager.Message.Priority(rawValue: String(cString: sqlite3_column_text(stmt, 4))) ?? .normal,
                    requireAck: sqlite3_column_int(stmt, 5) == 1,
                    retryCount: Int(sqlite3_column_int(stmt, 6)),
                    maxRetries: Int(sqlite3_column_int(stmt, 7)),
                    lastRetryAt: sqlite3_column_type(stmt, 8) != SQLITE_NULL ? Date(timeIntervalSince1970: TimeInterval(sqlite3_column_int64(stmt, 8)) / 1000) : nil,
                    expiresAt: sqlite3_column_type(stmt, 9) != SQLITE_NULL ? Date(timeIntervalSince1970: TimeInterval(sqlite3_column_int64(stmt, 9)) / 1000) : nil,
                    status: QueuedMessage.Status(rawValue: String(cString: sqlite3_column_text(stmt, 10))) ?? .pending,
                    createdAt: Date(timeIntervalSince1970: TimeInterval(sqlite3_column_int64(stmt, 11)) / 1000),
                    updatedAt: Date(timeIntervalSince1970: TimeInterval(sqlite3_column_int64(stmt, 12)) / 1000)
                )
            }

            // Group by peer
            for message in messages {
                if pendingMessages[message.peerId] == nil {
                    pendingMessages[message.peerId] = []
                }
                pendingMessages[message.peerId]?.append(message)
            }

            // Sort each queue
            for peerId in pendingMessages.keys {
                sortQueueByPriority(peerId: peerId)
            }

            logger.info("Loaded \(messages.count) pending offline messages", category: "P2P")

        } catch {
            logger.error("Failed to load pending messages", error: error, category: "P2P")
        }
    }

    // MARK: - Helper Methods

    private func findMessage(id: String) -> QueuedMessage? {
        for messages in pendingMessages.values {
            if let message = messages.first(where: { $0.id == id }) {
                return message
            }
        }
        return nil
    }

    private func removeFromMemory(messageId: String) {
        for (peerId, var messages) in pendingMessages {
            if let index = messages.firstIndex(where: { $0.id == messageId }) {
                messages.remove(at: index)
                pendingMessages[peerId] = messages
                return
            }
        }
    }

    private func updateInMemory(_ message: QueuedMessage) {
        if var messages = pendingMessages[message.peerId],
           let index = messages.firstIndex(where: { $0.id == message.id }) {
            messages[index] = message
            pendingMessages[message.peerId] = messages
        }
    }

    private func sortQueueByPriority(peerId: String) {
        pendingMessages[peerId]?.sort { m1, m2 in
            if m1.priority != m2.priority {
                return priorityOrder(m1.priority) < priorityOrder(m2.priority)
            }
            return m1.createdAt < m2.createdAt
        }
    }

    private func priorityOrder(_ priority: MessageManager.Message.Priority) -> Int {
        switch priority {
        case .high: return 0
        case .normal: return 1
        case .low: return 2
        }
    }

    private func generateMessageId() -> String {
        let timestamp = Date().timeIntervalSince1970
        let random = UUID().uuidString.prefix(8)
        return "offline-\(Int(timestamp))-\(random)"
    }

    // MARK: - Statistics

    func getStatistics() -> QueueStatistics {
        var totalPending = 0
        var totalRetrying = 0
        var byPeer: [String: Int] = [:]

        for (peerId, messages) in pendingMessages {
            let pending = messages.filter { $0.status == .pending }.count
            let retrying = messages.filter { $0.status == .retrying }.count

            totalPending += pending
            totalRetrying += retrying
            byPeer[peerId] = pending + retrying
        }

        return QueueStatistics(
            totalPending: totalPending,
            totalRetrying: totalRetrying,
            byPeer: byPeer
        )
    }
}

// MARK: - Data Models

struct QueuedMessage: Identifiable {
    let id: String
    let peerId: String
    let messageType: String
    let payload: String
    let priority: MessageManager.Message.Priority
    let requireAck: Bool
    var retryCount: Int
    let maxRetries: Int
    var lastRetryAt: Date?
    let expiresAt: Date?
    var status: Status
    let createdAt: Date
    var updatedAt: Date

    enum Status: String {
        case pending
        case retrying
        case sent
        case failed
        case expired
    }

    var isExpired: Bool {
        if let expiresAt = expiresAt {
            return Date() > expiresAt
        }
        return false
    }
}

struct QueueStatistics {
    let totalPending: Int
    let totalRetrying: Int
    let byPeer: [String: Int]
}

// MARK: - Notification Names

extension Notification.Name {
    static let offlineMessageReadyForRetry = Notification.Name("offlineMessageReadyForRetry")
    static let offlineMessageSent = Notification.Name("offlineMessageSent")
    static let offlineMessageFailed = Notification.Name("offlineMessageFailed")
}

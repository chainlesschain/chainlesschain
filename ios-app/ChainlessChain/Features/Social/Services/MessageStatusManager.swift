import Foundation
import CoreCommon

/// 消息状态管理器
/// 负责消息的已读/已送达状态同步、消息撤回和编辑功能
@MainActor
class MessageStatusManager: ObservableObject {
    // MARK: - Singleton

    static let shared = MessageStatusManager()

    // MARK: - Dependencies

    private let messageRepository = P2PMessageRepository.shared
    private let logger = Logger.shared

    // MARK: - Published Properties

    @Published var pendingReceipts: [String: [MessageReceipt]] = [:]  // peerId -> receipts
    @Published var recentStatusUpdates: [MessageStatusUpdate] = []

    // MARK: - Configuration

    private let receiptBatchSize = 20
    private let receiptBatchInterval: TimeInterval = 1.0  // 1 second
    private var receiptTimers: [String: Timer] = [:]

    // MARK: - Message Status Types

    /// 消息状态枚举
    enum MessageStatus: String, Codable {
        case sending = "sending"       // 发送中
        case sent = "sent"             // 已发送（服务器收到）
        case delivered = "delivered"   // 已送达（对方设备收到）
        case read = "read"             // 已读
        case failed = "failed"         // 发送失败
        case recalled = "recalled"     // 已撤回
        case edited = "edited"         // 已编辑

        var displayText: String {
            switch self {
            case .sending: return "发送中"
            case .sent: return "已发送"
            case .delivered: return "已送达"
            case .read: return "已读"
            case .failed: return "发送失败"
            case .recalled: return "已撤回"
            case .edited: return "已编辑"
            }
        }

        var icon: String {
            switch self {
            case .sending: return "clock"
            case .sent: return "checkmark"
            case .delivered: return "checkmark.circle"
            case .read: return "checkmark.circle.fill"
            case .failed: return "exclamationmark.circle"
            case .recalled: return "arrow.uturn.backward"
            case .edited: return "pencil"
            }
        }
    }

    /// 消息回执类型
    enum ReceiptType: String, Codable {
        case delivered = "delivered"
        case read = "read"
        case typing = "typing"
        case stopTyping = "stop_typing"
    }

    /// 消息回执
    struct MessageReceipt: Codable {
        let messageId: String
        let receiptType: ReceiptType
        let timestamp: Date
        let senderDid: String

        init(messageId: String, receiptType: ReceiptType, senderDid: String) {
            self.messageId = messageId
            self.receiptType = receiptType
            self.timestamp = Date()
            self.senderDid = senderDid
        }
    }

    /// 消息状态更新
    struct MessageStatusUpdate: Identifiable {
        let id = UUID()
        let messageId: String
        let oldStatus: MessageStatus
        let newStatus: MessageStatus
        let timestamp: Date
    }

    /// 消息撤回请求
    struct RecallRequest: Codable {
        let messageId: String
        let reason: String?
        let timestamp: Date
    }

    /// 消息编辑请求
    struct EditRequest: Codable {
        let messageId: String
        let newContent: String
        let editedAt: Date
        let editCount: Int
    }

    private init() {}

    // MARK: - Status Updates

    /// 更新消息状态
    func updateMessageStatus(messageId: String, status: MessageStatus) async throws {
        // Get current status for tracking
        let currentStatusStr = try await getCurrentStatus(messageId: messageId)
        let currentStatus = MessageStatus(rawValue: currentStatusStr) ?? .sending

        // Don't downgrade status (except for recall/edit)
        if !shouldUpdateStatus(from: currentStatus, to: status) {
            logger.debug("Status update skipped: \(currentStatus) -> \(status)", category: "MessageStatus")
            return
        }

        // Update in database
        try messageRepository.updateMessageStatus(id: messageId, status: status.rawValue)

        // Track update
        let update = MessageStatusUpdate(
            messageId: messageId,
            oldStatus: currentStatus,
            newStatus: status,
            timestamp: Date()
        )
        recentStatusUpdates.insert(update, at: 0)

        // Keep only last 100 updates
        if recentStatusUpdates.count > 100 {
            recentStatusUpdates = Array(recentStatusUpdates.prefix(100))
        }

        // Post notification
        NotificationCenter.default.post(
            name: .messageStatusUpdated,
            object: nil,
            userInfo: ["messageId": messageId, "status": status]
        )

        logger.info("Message status updated: \(messageId) -> \(status.rawValue)", category: "MessageStatus")
    }

    /// 批量更新消息状态
    func updateMessagesStatus(messageIds: [String], status: MessageStatus) async throws {
        for messageId in messageIds {
            try await updateMessageStatus(messageId: messageId, status: status)
        }
    }

    /// 标记消息为已送达
    func markAsDelivered(messageId: String, senderDid: String) async throws {
        try await updateMessageStatus(messageId: messageId, status: .delivered)

        // Send delivery receipt
        let receipt = MessageReceipt(
            messageId: messageId,
            receiptType: .delivered,
            senderDid: senderDid
        )
        queueReceipt(receipt, for: senderDid)
    }

    /// 标记消息为已读
    func markAsRead(messageId: String, senderDid: String) async throws {
        try await updateMessageStatus(messageId: messageId, status: .read)

        // Send read receipt
        let receipt = MessageReceipt(
            messageId: messageId,
            receiptType: .read,
            senderDid: senderDid
        )
        queueReceipt(receipt, for: senderDid)
    }

    /// 标记会话所有消息为已读
    func markConversationAsRead(conversationId: String, myDid: String) async throws {
        // Get all unread messages
        let messages = try messageRepository.getMessages(conversationId: conversationId)
        let unreadMessages = messages.filter { msg in
            !msg.isOutgoing(myDid: myDid) &&
            msg.status != MessageStatus.read.rawValue
        }

        for message in unreadMessages {
            try await markAsRead(messageId: message.id, senderDid: message.senderDid)
        }

        // Reset unread count
        try messageRepository.resetUnreadCount(conversationId: conversationId)

        logger.info("Marked \(unreadMessages.count) messages as read in conversation: \(conversationId)", category: "MessageStatus")
    }

    // MARK: - Receipt Handling

    /// 队列回执发送（批量优化）
    private func queueReceipt(_ receipt: MessageReceipt, for peerId: String) {
        if pendingReceipts[peerId] == nil {
            pendingReceipts[peerId] = []
        }
        pendingReceipts[peerId]?.append(receipt)

        // Check batch size
        if let receipts = pendingReceipts[peerId], receipts.count >= receiptBatchSize {
            sendReceiptBatch(for: peerId)
        } else {
            scheduleReceiptSend(for: peerId)
        }
    }

    /// 调度批量发送
    private func scheduleReceiptSend(for peerId: String) {
        receiptTimers[peerId]?.invalidate()

        let timer = Timer.scheduledTimer(withTimeInterval: receiptBatchInterval, repeats: false) { [weak self] _ in
            Task { @MainActor in
                self?.sendReceiptBatch(for: peerId)
            }
        }
        receiptTimers[peerId] = timer
    }

    /// 发送回执批次
    private func sendReceiptBatch(for peerId: String) {
        guard let receipts = pendingReceipts[peerId], !receipts.isEmpty else { return }

        receiptTimers[peerId]?.invalidate()
        receiptTimers.removeValue(forKey: peerId)

        // Create batch message
        let batchMessage = ReceiptBatchMessage(receipts: receipts)

        // Post notification for P2PManager to send
        NotificationCenter.default.post(
            name: .sendMessageReceipts,
            object: nil,
            userInfo: ["peerId": peerId, "batch": batchMessage]
        )

        // Clear pending receipts
        pendingReceipts[peerId] = []

        logger.debug("Sent \(receipts.count) receipts to: \(peerId)", category: "MessageStatus")
    }

    /// 处理收到的回执
    func handleReceivedReceipts(_ receipts: [MessageReceipt]) async {
        for receipt in receipts {
            switch receipt.receiptType {
            case .delivered:
                try? await updateMessageStatus(messageId: receipt.messageId, status: .delivered)
            case .read:
                try? await updateMessageStatus(messageId: receipt.messageId, status: .read)
            case .typing:
                NotificationCenter.default.post(
                    name: .peerTyping,
                    object: nil,
                    userInfo: ["senderDid": receipt.senderDid]
                )
            case .stopTyping:
                NotificationCenter.default.post(
                    name: .peerStoppedTyping,
                    object: nil,
                    userInfo: ["senderDid": receipt.senderDid]
                )
            }
        }
    }

    // MARK: - Message Recall

    /// 撤回消息
    /// - Parameters:
    ///   - messageId: 消息 ID
    ///   - reason: 撤回原因（可选）
    /// - Returns: 是否成功
    func recallMessage(messageId: String, reason: String? = nil) async throws -> Bool {
        // Check if message can be recalled (within time limit)
        guard let message = try await getMessage(messageId: messageId) else {
            throw MessageStatusError.messageNotFound(messageId)
        }

        // Check time limit (2 minutes)
        let recallTimeLimit: TimeInterval = 2 * 60
        guard Date().timeIntervalSince(message.createdAt) <= recallTimeLimit else {
            throw MessageStatusError.recallTimeExpired
        }

        // Update local status
        try await updateMessageStatus(messageId: messageId, status: .recalled)

        // Update metadata with recall info
        try updateMessageMetadata(messageId: messageId, metadata: [
            "recalled": true,
            "recallReason": reason ?? "",
            "recalledAt": Date().timestampMs
        ])

        // Send recall request to peer
        let recallRequest = RecallRequest(
            messageId: messageId,
            reason: reason,
            timestamp: Date()
        )

        NotificationCenter.default.post(
            name: .sendRecallRequest,
            object: nil,
            userInfo: ["request": recallRequest, "conversationId": message.conversationId]
        )

        logger.info("Message recalled: \(messageId)", category: "MessageStatus")

        return true
    }

    /// 处理收到的撤回请求
    func handleRecallRequest(_ request: RecallRequest) async throws {
        // Verify message exists
        guard let message = try await getMessage(messageId: request.messageId) else {
            logger.warn("Recall request for unknown message: \(request.messageId)", category: "MessageStatus")
            return
        }

        // Update status
        try await updateMessageStatus(messageId: request.messageId, status: .recalled)

        // Update metadata
        try updateMessageMetadata(messageId: request.messageId, metadata: [
            "recalled": true,
            "recallReason": request.reason ?? "",
            "recalledAt": request.timestamp.timestampMs
        ])

        // Notify UI
        NotificationCenter.default.post(
            name: .messageRecalled,
            object: nil,
            userInfo: ["messageId": request.messageId]
        )

        logger.info("Message recalled by sender: \(request.messageId)", category: "MessageStatus")
    }

    // MARK: - Message Edit

    /// 编辑消息
    /// - Parameters:
    ///   - messageId: 消息 ID
    ///   - newContent: 新内容（已加密）
    /// - Returns: 是否成功
    func editMessage(messageId: String, newContent: String) async throws -> Bool {
        // Check if message can be edited
        guard let message = try await getMessage(messageId: messageId) else {
            throw MessageStatusError.messageNotFound(messageId)
        }

        // Check time limit (15 minutes)
        let editTimeLimit: TimeInterval = 15 * 60
        guard Date().timeIntervalSince(message.createdAt) <= editTimeLimit else {
            throw MessageStatusError.editTimeExpired
        }

        // Check edit count limit
        let metadata = message.getMetadata() ?? [:]
        let currentEditCount = (metadata["editCount"] as? Int) ?? 0
        let maxEdits = 5
        guard currentEditCount < maxEdits else {
            throw MessageStatusError.maxEditsReached
        }

        // Update content
        try updateMessageContent(messageId: messageId, content: newContent)

        // Update metadata with edit info
        try updateMessageMetadata(messageId: messageId, metadata: [
            "edited": true,
            "editCount": currentEditCount + 1,
            "lastEditedAt": Date().timestampMs
        ])

        // Update status
        try await updateMessageStatus(messageId: messageId, status: .edited)

        // Send edit request to peer
        let editRequest = EditRequest(
            messageId: messageId,
            newContent: newContent,
            editedAt: Date(),
            editCount: currentEditCount + 1
        )

        NotificationCenter.default.post(
            name: .sendEditRequest,
            object: nil,
            userInfo: ["request": editRequest, "conversationId": message.conversationId]
        )

        logger.info("Message edited: \(messageId) (edit #\(currentEditCount + 1))", category: "MessageStatus")

        return true
    }

    /// 处理收到的编辑请求
    func handleEditRequest(_ request: EditRequest) async throws {
        // Update content
        try updateMessageContent(messageId: request.messageId, content: request.newContent)

        // Update metadata
        try updateMessageMetadata(messageId: request.messageId, metadata: [
            "edited": true,
            "editCount": request.editCount,
            "lastEditedAt": request.editedAt.timestampMs
        ])

        // Update status
        try await updateMessageStatus(messageId: request.messageId, status: .edited)

        // Notify UI
        NotificationCenter.default.post(
            name: .messageEdited,
            object: nil,
            userInfo: ["messageId": request.messageId, "newContent": request.newContent]
        )

        logger.info("Message edited by sender: \(request.messageId)", category: "MessageStatus")
    }

    // MARK: - Typing Indicator

    /// 发送正在输入指示
    func sendTypingIndicator(to peerId: String, myDid: String) {
        let receipt = MessageReceipt(
            messageId: UUID().uuidString,
            receiptType: .typing,
            senderDid: myDid
        )

        NotificationCenter.default.post(
            name: .sendMessageReceipts,
            object: nil,
            userInfo: ["peerId": peerId, "batch": ReceiptBatchMessage(receipts: [receipt])]
        )
    }

    /// 发送停止输入指示
    func sendStopTypingIndicator(to peerId: String, myDid: String) {
        let receipt = MessageReceipt(
            messageId: UUID().uuidString,
            receiptType: .stopTyping,
            senderDid: myDid
        )

        NotificationCenter.default.post(
            name: .sendMessageReceipts,
            object: nil,
            userInfo: ["peerId": peerId, "batch": ReceiptBatchMessage(receipts: [receipt])]
        )
    }

    // MARK: - Helper Methods

    /// 检查是否应该更新状态
    private func shouldUpdateStatus(from current: MessageStatus, to new: MessageStatus) -> Bool {
        // Always allow recall and edit
        if new == .recalled || new == .edited {
            return true
        }

        // Status progression order
        let order: [MessageStatus] = [.sending, .sent, .delivered, .read]

        guard let currentIndex = order.firstIndex(of: current),
              let newIndex = order.firstIndex(of: new) else {
            // Allow failed status
            return new == .failed
        }

        return newIndex > currentIndex
    }

    /// 获取当前状态
    private func getCurrentStatus(messageId: String) async throws -> String {
        // This would query the database
        // For now, return a default
        return MessageStatus.sending.rawValue
    }

    /// 获取消息
    private func getMessage(messageId: String) async throws -> P2PMessageEntity? {
        // Search across conversations
        let conversations = try messageRepository.getAllConversations()
        for conversation in conversations {
            let messages = try messageRepository.getMessages(conversationId: conversation.id)
            if let message = messages.first(where: { $0.id == messageId }) {
                return message
            }
        }
        return nil
    }

    /// 更新消息内容
    private func updateMessageContent(messageId: String, content: String) throws {
        let sql = "UPDATE messages SET content_encrypted = ?, updated_at = ? WHERE id = ?"
        // Execute through repository
        // This is a simplified version - actual implementation would need database access
    }

    /// 更新消息元数据
    private func updateMessageMetadata(messageId: String, metadata: [String: Any]) throws {
        let jsonData = try JSONSerialization.data(withJSONObject: metadata)
        let jsonString = String(data: jsonData, encoding: .utf8)

        let sql = "UPDATE messages SET metadata = ?, updated_at = ? WHERE id = ?"
        // Execute through repository
    }
}

// MARK: - Receipt Batch Message

struct ReceiptBatchMessage: Codable {
    let type: String = "receipt_batch"
    let receipts: [MessageStatusManager.MessageReceipt]
    let timestamp: Date

    init(receipts: [MessageStatusManager.MessageReceipt]) {
        self.receipts = receipts
        self.timestamp = Date()
    }
}

// MARK: - Errors

enum MessageStatusError: LocalizedError {
    case messageNotFound(String)
    case recallTimeExpired
    case editTimeExpired
    case maxEditsReached
    case updateFailed(String)

    var errorDescription: String? {
        switch self {
        case .messageNotFound(let id):
            return "Message not found: \(id)"
        case .recallTimeExpired:
            return "Message recall time expired (2 minutes limit)"
        case .editTimeExpired:
            return "Message edit time expired (15 minutes limit)"
        case .maxEditsReached:
            return "Maximum edit count reached (5 edits)"
        case .updateFailed(let reason):
            return "Status update failed: \(reason)"
        }
    }
}

// MARK: - Notification Names

extension Notification.Name {
    static let messageStatusUpdated = Notification.Name("messageStatusUpdated")
    static let sendMessageReceipts = Notification.Name("sendMessageReceipts")
    static let sendRecallRequest = Notification.Name("sendRecallRequest")
    static let sendEditRequest = Notification.Name("sendEditRequest")
    static let messageRecalled = Notification.Name("messageRecalled")
    static let messageEdited = Notification.Name("messageEdited")
    static let peerTyping = Notification.Name("peerTyping")
    static let peerStoppedTyping = Notification.Name("peerStoppedTyping")
}

import Foundation
import CoreCommon

/// 消息投递管理器
/// 负责消息的可靠投递、状态跟踪和确认机制
@MainActor
class MessageDeliveryManager: ObservableObject {
    // MARK: - Singleton

    static let shared = MessageDeliveryManager()

    // MARK: - Dependencies

    private let messageRepository = P2PMessageRepository.shared
    private let statusManager = MessageStatusManager.shared
    private let logger = Logger.shared

    // MARK: - Published Properties

    @Published var pendingDeliveries: [String: DeliveryInfo] = [:]
    @Published var deliveryStats = DeliveryStatistics()

    // MARK: - Configuration

    private let deliveryTimeout: TimeInterval = AppConfig.Delivery.timeout
    private let maxRetries = AppConfig.Delivery.maxRetries
    private var deliveryTimers: [String: Timer] = [:]

    // Notification observer tokens for cleanup
    private var notificationObservers: [NSObjectProtocol] = []

    // MARK: - Types

    /// 投递信息
    struct DeliveryInfo: Identifiable {
        let id: String  // messageId
        let peerId: String
        let timestamp: Date
        var retryCount: Int
        var status: DeliveryStatus
        var lastError: String?

        enum DeliveryStatus: String {
            case pending = "pending"
            case sending = "sending"
            case sent = "sent"
            case delivered = "delivered"
            case failed = "failed"
            case timeout = "timeout"
        }
    }

    /// 投递统计
    struct DeliveryStatistics {
        var totalSent: Int = 0
        var totalDelivered: Int = 0
        var totalFailed: Int = 0
        var totalTimeout: Int = 0
        var averageDeliveryTime: TimeInterval = 0
        var deliverySuccessRate: Double = 0

        mutating func update() {
            let total = totalSent + totalFailed + totalTimeout
            if total > 0 {
                deliverySuccessRate = Double(totalDelivered) / Double(total) * 100
            }
        }
    }

    /// 投递确认
    struct DeliveryAck: Codable {
        let messageId: String
        let status: String  // "delivered" or "read"
        let timestamp: Date
        let senderDid: String
    }

    /// 投递请求
    struct DeliveryRequest: Codable {
        let messageId: String
        let peerId: String
        let type: String
        let timestamp: Date
    }

    private init() {
        setupNotificationObservers()
    }

    // MARK: - Delivery Tracking

    /// 开始跟踪消息投递
    func trackDelivery(messageId: String, peerId: String) {
        let info = DeliveryInfo(
            id: messageId,
            peerId: peerId,
            timestamp: Date(),
            retryCount: 0,
            status: .sending
        )

        pendingDeliveries[messageId] = info

        // Set timeout timer
        startDeliveryTimeout(messageId: messageId)

        deliveryStats.totalSent += 1

        logger.debug("Started tracking delivery: \(messageId)", category: "Delivery")
    }

    /// 确认消息已发送（本地确认）
    func confirmSent(messageId: String) async {
        guard var info = pendingDeliveries[messageId] else { return }

        info.status = .sent
        pendingDeliveries[messageId] = info

        // Update database
        do {
            try messageRepository.updateMessageStatus(id: messageId, status: "sent")
        } catch {
            logger.error("Failed to update message status to sent: \(error)", category: "Delivery")
        }

        // Notify UI
        NotificationCenter.default.post(
            name: .messageStatusUpdated,
            object: nil,
            userInfo: ["messageId": messageId, "status": MessageStatusManager.MessageStatus.sent]
        )

        logger.debug("Message confirmed sent: \(messageId)", category: "Delivery")
    }

    /// 确认消息已投递
    func confirmDelivered(messageId: String, senderDid: String) async {
        guard var info = pendingDeliveries[messageId] else {
            // Message might not be tracked, update directly
            do {
                try await statusManager.updateMessageStatus(messageId: messageId, status: .delivered)
            } catch {
                logger.error("Failed to update untracked message status: \(error)", category: "Delivery")
            }
            return
        }

        // Cancel timeout timer
        cancelDeliveryTimeout(messageId: messageId)

        // Calculate delivery time
        let deliveryTime = Date().timeIntervalSince(info.timestamp)
        updateAverageDeliveryTime(deliveryTime)

        info.status = .delivered
        pendingDeliveries[messageId] = info

        deliveryStats.totalDelivered += 1
        deliveryStats.update()

        // Update status
        do {
            try await statusManager.updateMessageStatus(messageId: messageId, status: .delivered)
        } catch {
            logger.error("Failed to update message delivered status: \(error)", category: "Delivery")
        }

        // Remove from pending after a delay
        Task {
            try? await Task.sleep(nanoseconds: 5_000_000_000)  // 5 seconds
            await MainActor.run {
                self.pendingDeliveries.removeValue(forKey: messageId)
            }
        }

        logger.info("Message delivered in \(String(format: "%.2f", deliveryTime))s: \(messageId)", category: "Delivery")
    }

    /// 确认消息已读
    func confirmRead(messageId: String, senderDid: String) async {
        // Cancel any pending tracking
        cancelDeliveryTimeout(messageId: messageId)
        pendingDeliveries.removeValue(forKey: messageId)

        // Update status
        do {
            try await statusManager.updateMessageStatus(messageId: messageId, status: .read)
        } catch {
            logger.error("Failed to update message read status: \(error)", category: "Delivery")
        }

        logger.info("Message read: \(messageId)", category: "Delivery")
    }

    /// 处理投递失败
    func handleDeliveryFailure(messageId: String, error: String) async {
        guard var info = pendingDeliveries[messageId] else { return }

        info.lastError = error

        if info.retryCount < maxRetries {
            // Retry
            info.retryCount += 1
            info.status = .pending
            pendingDeliveries[messageId] = info

            // Schedule retry
            scheduleRetry(messageId: messageId, peerId: info.peerId)

            logger.warn("Message delivery failed, retrying (\(info.retryCount)/\(maxRetries)): \(messageId)", category: "Delivery")
        } else {
            // Mark as failed
            info.status = .failed
            pendingDeliveries[messageId] = info

            deliveryStats.totalFailed += 1
            deliveryStats.update()

            // Update database
            do {
                try await statusManager.updateMessageStatus(messageId: messageId, status: .failed)
            } catch {
                logger.error("Failed to update message failed status: \(error)", category: "Delivery")
            }

            logger.error("Message delivery failed permanently: \(messageId)", category: "Delivery")

            // Notify UI
            NotificationCenter.default.post(
                name: .messageDeliveryFailed,
                object: nil,
                userInfo: ["messageId": messageId, "error": error]
            )
        }
    }

    // MARK: - Timeout Management

    private func startDeliveryTimeout(messageId: String) {
        cancelDeliveryTimeout(messageId: messageId)

        let timer = Timer.scheduledTimer(withTimeInterval: deliveryTimeout, repeats: false) { [weak self] _ in
            Task { @MainActor in
                self?.handleTimeout(messageId: messageId)
            }
        }

        deliveryTimers[messageId] = timer
    }

    private func cancelDeliveryTimeout(messageId: String) {
        deliveryTimers[messageId]?.invalidate()
        deliveryTimers.removeValue(forKey: messageId)
    }

    private func handleTimeout(messageId: String) {
        guard var info = pendingDeliveries[messageId] else { return }

        if info.retryCount < maxRetries {
            // Retry
            info.retryCount += 1
            pendingDeliveries[messageId] = info

            scheduleRetry(messageId: messageId, peerId: info.peerId)

            logger.warn("Message delivery timeout, retrying: \(messageId)", category: "Delivery")
        } else {
            // Mark as timeout
            info.status = .timeout
            pendingDeliveries[messageId] = info

            deliveryStats.totalTimeout += 1
            deliveryStats.update()

            Task {
                do {
                    try await statusManager.updateMessageStatus(messageId: messageId, status: .failed)
                } catch {
                    logger.error("Failed to update timeout status: \(error)", category: "Delivery")
                }
            }

            logger.error("Message delivery timed out: \(messageId)", category: "Delivery")
        }
    }

    // MARK: - Retry Logic

    private func scheduleRetry(messageId: String, peerId: String) {
        let delay = calculateRetryDelay(messageId: messageId)

        Task {
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            await retryDelivery(messageId: messageId, peerId: peerId)
        }
    }

    private let maxRetryDelay: TimeInterval = 300  // 5 minutes max

    private func calculateRetryDelay(messageId: String) -> TimeInterval {
        let retryCount = pendingDeliveries[messageId]?.retryCount ?? 0
        // Exponential backoff: 1s, 2s, 4s, ... capped at maxRetryDelay
        let delay = pow(2.0, Double(max(0, retryCount - 1)))
        return min(delay, maxRetryDelay)
    }

    private func retryDelivery(messageId: String, peerId: String) async {
        guard var info = pendingDeliveries[messageId],
              info.status == .pending else { return }

        info.status = .sending
        pendingDeliveries[messageId] = info

        // Request resend
        NotificationCenter.default.post(
            name: .requestMessageResend,
            object: nil,
            userInfo: ["messageId": messageId, "peerId": peerId]
        )

        // Restart timeout
        startDeliveryTimeout(messageId: messageId)
    }

    // MARK: - ACK Handling

    /// 发送投递确认
    func sendDeliveryAck(messageId: String, to peerId: String, status: String, myDid: String) {
        let ack = DeliveryAck(
            messageId: messageId,
            status: status,
            timestamp: Date(),
            senderDid: myDid
        )

        // Send via MessageStatusManager
        if status == "delivered" {
            Task {
                do {
                    try await statusManager.markAsDelivered(messageId: messageId, senderDid: peerId)
                } catch {
                    logger.error("Failed to mark as delivered: \(error)", category: "Delivery")
                }
            }
        } else if status == "read" {
            Task {
                do {
                    try await statusManager.markAsRead(messageId: messageId, senderDid: peerId)
                } catch {
                    logger.error("Failed to mark as read: \(error)", category: "Delivery")
                }
            }
        }

        logger.debug("Sent delivery ACK: \(messageId) -> \(status)", category: "Delivery")
    }

    /// 处理收到的投递确认
    func handleReceivedAck(_ ack: DeliveryAck) async {
        switch ack.status {
        case "delivered":
            await confirmDelivered(messageId: ack.messageId, senderDid: ack.senderDid)
        case "read":
            await confirmRead(messageId: ack.messageId, senderDid: ack.senderDid)
        default:
            logger.warn("Unknown ACK status: \(ack.status)", category: "Delivery")
        }
    }

    // MARK: - Statistics

    private func updateAverageDeliveryTime(_ newTime: TimeInterval) {
        let totalDelivered = deliveryStats.totalDelivered
        if totalDelivered == 0 {
            deliveryStats.averageDeliveryTime = newTime
        } else {
            // Running average
            let currentAvg = deliveryStats.averageDeliveryTime
            deliveryStats.averageDeliveryTime = currentAvg + (newTime - currentAvg) / Double(totalDelivered + 1)
        }
    }

    func getStatistics() -> DeliveryStatistics {
        return deliveryStats
    }

    func resetStatistics() {
        deliveryStats = DeliveryStatistics()
    }

    // MARK: - Bulk Operations

    /// 获取所有待处理的投递
    func getPendingDeliveries(for peerId: String? = nil) -> [DeliveryInfo] {
        if let peerId = peerId {
            return pendingDeliveries.values.filter { $0.peerId == peerId }
        }
        return Array(pendingDeliveries.values)
    }

    /// 取消所有待处理的投递
    func cancelAllPending(for peerId: String? = nil) {
        let keysToRemove: [String]

        if let peerId = peerId {
            keysToRemove = pendingDeliveries.filter { $0.value.peerId == peerId }.map { $0.key }
        } else {
            keysToRemove = Array(pendingDeliveries.keys)
        }

        for key in keysToRemove {
            cancelDeliveryTimeout(messageId: key)
            pendingDeliveries.removeValue(forKey: key)
        }

        logger.info("Cancelled \(keysToRemove.count) pending deliveries", category: "Delivery")
    }

    // MARK: - Notification Observers

    private func setupNotificationObservers() {
        // Handle incoming ACKs
        let ackObserver = NotificationCenter.default.addObserver(
            forName: .deliveryAckReceived,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let ackData = notification.userInfo?["ack"] as? Data,
                  let ack = try? JSONDecoder().decode(DeliveryAck.self, from: ackData) else {
                return
            }

            Task { @MainActor in
                await self?.handleReceivedAck(ack)
            }
        }
        notificationObservers.append(ackObserver)

        // Handle connection state changes
        let disconnectedObserver = NotificationCenter.default.addObserver(
            forName: .p2pPeerDisconnected,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let peerId = notification.userInfo?["peerId"] as? String else { return }

            Task { @MainActor in
                // Pause deliveries for disconnected peer
                self?.pauseDeliveries(for: peerId)
            }
        }
        notificationObservers.append(disconnectedObserver)

        let connectedObserver = NotificationCenter.default.addObserver(
            forName: .p2pPeerConnected,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let peerId = notification.userInfo?["peerId"] as? String else { return }

            Task { @MainActor in
                // Resume deliveries for reconnected peer
                self?.resumeDeliveries(for: peerId)
            }
        }
        notificationObservers.append(connectedObserver)
    }

    private func pauseDeliveries(for peerId: String) {
        for (messageId, var info) in pendingDeliveries where info.peerId == peerId {
            cancelDeliveryTimeout(messageId: messageId)
            info.status = .pending
            pendingDeliveries[messageId] = info
        }

        logger.info("Paused deliveries for disconnected peer: \(peerId)", category: "Delivery")
    }

    private func resumeDeliveries(for peerId: String) {
        for (messageId, info) in pendingDeliveries where info.peerId == peerId && info.status == .pending {
            scheduleRetry(messageId: messageId, peerId: peerId)
        }

        logger.info("Resumed deliveries for reconnected peer: \(peerId)", category: "Delivery")
    }

    // MARK: - Cleanup

    func cleanup() {
        // Remove notification observers
        notificationObservers.forEach { NotificationCenter.default.removeObserver($0) }
        notificationObservers.removeAll()

        // Cancel all timers
        for (_, timer) in deliveryTimers {
            timer.invalidate()
        }
        deliveryTimers.removeAll()
        pendingDeliveries.removeAll()
    }

    deinit {
        // Remove notification observers
        notificationObservers.forEach { NotificationCenter.default.removeObserver($0) }
    }
}

// MARK: - Notification Names Extension

extension Notification.Name {
    static let messageDeliveryFailed = Notification.Name("messageDeliveryFailed")
    static let requestMessageResend = Notification.Name("requestMessageResend")
    static let deliveryAckReceived = Notification.Name("deliveryAckReceived")
}

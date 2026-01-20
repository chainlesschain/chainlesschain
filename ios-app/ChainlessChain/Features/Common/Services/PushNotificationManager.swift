import Foundation
import UserNotifications
import UIKit
import Combine
import CoreCommon

/// Push Notification Manager - Handles both local and remote notifications
/// Integrates with APNs for remote push notifications
@MainActor
class PushNotificationManager: NSObject, ObservableObject {
    // MARK: - Singleton

    static let shared = PushNotificationManager()

    // MARK: - Published Properties

    @Published var isAuthorized = false
    @Published var authorizationStatus: UNAuthorizationStatus = .notDetermined
    @Published var deviceToken: String?
    @Published var notificationSettings: NotificationSettings

    // MARK: - Private Properties

    private let notificationCenter = UNUserNotificationCenter.current()
    private var cancellables = Set<AnyCancellable>()
    private let logger = Logger.shared

    // Notification categories
    private let messageCategoryIdentifier = "MESSAGE_CATEGORY"
    private let groupMessageCategoryIdentifier = "GROUP_MESSAGE_CATEGORY"

    // MARK: - Types

    struct NotificationSettings: Codable {
        var messagesEnabled: Bool = true
        var groupMessagesEnabled: Bool = true
        var soundEnabled: Bool = true
        var badgeEnabled: Bool = true
        var previewEnabled: Bool = true
        var quietHoursEnabled: Bool = false
        var quietHoursStart: Int = 22  // 10 PM
        var quietHoursEnd: Int = 8     // 8 AM

        static let `default` = NotificationSettings()
    }

    enum NotificationType: String {
        case message = "message"
        case groupMessage = "group_message"
        case connectionRequest = "connection_request"
        case system = "system"
    }

    // MARK: - Initialization

    private override init() {
        // Load saved settings
        if let data = UserDefaults.standard.data(forKey: "notification_settings"),
           let settings = try? JSONDecoder().decode(NotificationSettings.self, from: data) {
            self.notificationSettings = settings
        } else {
            self.notificationSettings = .default
        }

        super.init()
        setupNotificationCategories()
        checkAuthorizationStatus()
    }

    // MARK: - Authorization

    /// Request notification authorization
    func requestAuthorization() async -> Bool {
        do {
            let options: UNAuthorizationOptions = [.alert, .sound, .badge, .provisional]
            let granted = try await notificationCenter.requestAuthorization(options: options)

            await MainActor.run {
                self.isAuthorized = granted
            }

            if granted {
                await registerForRemoteNotifications()
            }

            await checkAuthorizationStatus()
            return granted
        } catch {
            logger.debug("[PushNotification] Authorization error: \(error)")
            return false
        }
    }

    /// Check current authorization status
    func checkAuthorizationStatus() async {
        let settings = await notificationCenter.notificationSettings()

        await MainActor.run {
            self.authorizationStatus = settings.authorizationStatus
            self.isAuthorized = settings.authorizationStatus == .authorized ||
                               settings.authorizationStatus == .provisional
        }
    }

    /// Register for remote notifications
    private func registerForRemoteNotifications() async {
        await MainActor.run {
            UIApplication.shared.registerForRemoteNotifications()
        }
    }

    // MARK: - Device Token

    /// Handle device token registration
    func didRegisterForRemoteNotifications(deviceToken: Data) {
        let tokenParts = deviceToken.map { String(format: "%02.2hhx", $0) }
        let token = tokenParts.joined()

        self.deviceToken = token
        logger.debug("[PushNotification] Device token: \(token)")

        // Save token for later use (e.g., sending to server)
        UserDefaults.standard.set(token, forKey: "device_push_token")

        // Notify observers
        NotificationCenter.default.post(
            name: .deviceTokenRegistered,
            object: nil,
            userInfo: ["token": token]
        )
    }

    /// Handle registration failure
    func didFailToRegisterForRemoteNotifications(error: Error) {
        logger.debug("[PushNotification] Failed to register: \(error)")
    }

    // MARK: - Local Notifications

    /// Schedule a local notification for a new message
    func scheduleMessageNotification(
        from senderName: String,
        senderId: String,
        content: String,
        conversationId: String,
        isGroupMessage: Bool = false
    ) async {
        // Check if notifications are enabled
        guard notificationSettings.messagesEnabled else { return }
        if isGroupMessage && !notificationSettings.groupMessagesEnabled { return }

        // Check quiet hours
        if isInQuietHours() { return }

        // Create notification content
        let notificationContent = UNMutableNotificationContent()
        notificationContent.title = senderName

        if notificationSettings.previewEnabled {
            notificationContent.body = content
        } else {
            notificationContent.body = "发来了一条消息"
        }

        if notificationSettings.soundEnabled {
            notificationContent.sound = .default
        }

        if notificationSettings.badgeEnabled {
            // Increment badge count
            let currentBadge = await UIApplication.shared.applicationIconBadgeNumber
            notificationContent.badge = NSNumber(value: currentBadge + 1)
        }

        notificationContent.categoryIdentifier = isGroupMessage ?
            groupMessageCategoryIdentifier : messageCategoryIdentifier

        notificationContent.userInfo = [
            "type": isGroupMessage ? NotificationType.groupMessage.rawValue : NotificationType.message.rawValue,
            "senderId": senderId,
            "conversationId": conversationId
        ]

        notificationContent.threadIdentifier = conversationId

        // Create trigger (immediate)
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 0.1, repeats: false)

        // Create request
        let identifier = UUID().uuidString
        let request = UNNotificationRequest(
            identifier: identifier,
            content: notificationContent,
            trigger: trigger
        )

        do {
            try await notificationCenter.add(request)
            logger.debug("[PushNotification] Scheduled message notification")
        } catch {
            logger.debug("[PushNotification] Failed to schedule notification: \(error)")
        }
    }

    /// Schedule a connection request notification
    func scheduleConnectionRequestNotification(
        from peerName: String,
        peerId: String
    ) async {
        let content = UNMutableNotificationContent()
        content.title = "连接请求"
        content.body = "\(peerName) 想要与你建立加密连接"

        if notificationSettings.soundEnabled {
            content.sound = .default
        }

        content.userInfo = [
            "type": NotificationType.connectionRequest.rawValue,
            "peerId": peerId
        ]

        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 0.1, repeats: false)
        let request = UNNotificationRequest(
            identifier: UUID().uuidString,
            content: content,
            trigger: trigger
        )

        try? await notificationCenter.add(request)
    }

    /// Schedule a system notification
    func scheduleSystemNotification(
        title: String,
        body: String,
        userInfo: [String: Any] = [:]
    ) async {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body

        if notificationSettings.soundEnabled {
            content.sound = .default
        }

        var info = userInfo
        info["type"] = NotificationType.system.rawValue
        content.userInfo = info

        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 0.1, repeats: false)
        let request = UNNotificationRequest(
            identifier: UUID().uuidString,
            content: content,
            trigger: trigger
        )

        try? await notificationCenter.add(request)
    }

    // MARK: - Badge Management

    /// Clear badge count
    func clearBadge() async {
        await MainActor.run {
            UIApplication.shared.applicationIconBadgeNumber = 0
        }
    }

    /// Set badge count
    func setBadge(_ count: Int) async {
        await MainActor.run {
            UIApplication.shared.applicationIconBadgeNumber = count
        }
    }

    // MARK: - Pending Notifications

    /// Get all pending notifications
    func getPendingNotifications() async -> [UNNotificationRequest] {
        return await notificationCenter.pendingNotificationRequests()
    }

    /// Remove pending notifications for a conversation
    func removePendingNotifications(for conversationId: String) async {
        let pending = await getPendingNotifications()
        let identifiersToRemove = pending.filter {
            $0.content.userInfo["conversationId"] as? String == conversationId
        }.map { $0.identifier }

        notificationCenter.removePendingNotificationRequests(withIdentifiers: identifiersToRemove)
    }

    /// Remove all pending notifications
    func removeAllPendingNotifications() {
        notificationCenter.removeAllPendingNotificationRequests()
    }

    // MARK: - Delivered Notifications

    /// Get all delivered notifications
    func getDeliveredNotifications() async -> [UNNotification] {
        return await notificationCenter.deliveredNotifications()
    }

    /// Remove delivered notifications for a conversation
    func removeDeliveredNotifications(for conversationId: String) async {
        let delivered = await getDeliveredNotifications()
        let identifiersToRemove = delivered.filter {
            $0.request.content.userInfo["conversationId"] as? String == conversationId
        }.map { $0.request.identifier }

        notificationCenter.removeDeliveredNotifications(withIdentifiers: identifiersToRemove)
    }

    /// Remove all delivered notifications
    func removeAllDeliveredNotifications() {
        notificationCenter.removeAllDeliveredNotifications()
    }

    // MARK: - Settings

    /// Save notification settings
    func saveSettings() {
        if let data = try? JSONEncoder().encode(notificationSettings) {
            UserDefaults.standard.set(data, forKey: "notification_settings")
        }
    }

    /// Update settings
    func updateSettings(_ settings: NotificationSettings) {
        notificationSettings = settings
        saveSettings()
    }

    // MARK: - Private Methods

    private func setupNotificationCategories() {
        // Message actions
        let replyAction = UNTextInputNotificationAction(
            identifier: "REPLY_ACTION",
            title: "回复",
            options: [],
            textInputButtonTitle: "发送",
            textInputPlaceholder: "输入回复..."
        )

        let markReadAction = UNNotificationAction(
            identifier: "MARK_READ_ACTION",
            title: "标记已读",
            options: []
        )

        // Message category
        let messageCategory = UNNotificationCategory(
            identifier: messageCategoryIdentifier,
            actions: [replyAction, markReadAction],
            intentIdentifiers: [],
            options: [.customDismissAction]
        )

        // Group message category
        let groupMessageCategory = UNNotificationCategory(
            identifier: groupMessageCategoryIdentifier,
            actions: [replyAction, markReadAction],
            intentIdentifiers: [],
            options: [.customDismissAction]
        )

        notificationCenter.setNotificationCategories([messageCategory, groupMessageCategory])
    }

    private func isInQuietHours() -> Bool {
        guard notificationSettings.quietHoursEnabled else { return false }

        let calendar = Calendar.current
        let now = Date()
        let hour = calendar.component(.hour, from: now)

        let start = notificationSettings.quietHoursStart
        let end = notificationSettings.quietHoursEnd

        if start < end {
            // Same day range (e.g., 8 AM to 10 PM)
            return hour >= start && hour < end
        } else {
            // Overnight range (e.g., 10 PM to 8 AM)
            return hour >= start || hour < end
        }
    }
}

// MARK: - UNUserNotificationCenterDelegate

extension PushNotificationManager: UNUserNotificationCenterDelegate {
    /// Handle notification when app is in foreground
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        // Show notification even when app is in foreground
        completionHandler([.banner, .sound, .badge])
    }

    /// Handle notification tap
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let userInfo = response.notification.request.content.userInfo

        Task { @MainActor in
            handleNotificationResponse(response: response, userInfo: userInfo)
        }

        completionHandler()
    }

    @MainActor
    private func handleNotificationResponse(
        response: UNNotificationResponse,
        userInfo: [AnyHashable: Any]
    ) {
        guard let typeString = userInfo["type"] as? String,
              let type = NotificationType(rawValue: typeString) else {
            return
        }

        switch response.actionIdentifier {
        case "REPLY_ACTION":
            if let textResponse = response as? UNTextInputNotificationResponse {
                handleReplyAction(text: textResponse.userText, userInfo: userInfo, type: type)
            }

        case "MARK_READ_ACTION":
            handleMarkReadAction(userInfo: userInfo, type: type)

        case UNNotificationDefaultActionIdentifier:
            // User tapped notification
            handleNotificationTap(userInfo: userInfo, type: type)

        case UNNotificationDismissActionIdentifier:
            // User dismissed notification
            break

        default:
            break
        }
    }

    private func handleReplyAction(text: String, userInfo: [AnyHashable: Any], type: NotificationType) {
        guard let conversationId = userInfo["conversationId"] as? String,
              let senderId = userInfo["senderId"] as? String else {
            return
        }

        // Post notification to handle reply
        NotificationCenter.default.post(
            name: .notificationReplyAction,
            object: nil,
            userInfo: [
                "conversationId": conversationId,
                "senderId": senderId,
                "replyText": text,
                "type": type.rawValue
            ]
        )

        logger.debug("[PushNotification] Reply action: \(text) for conversation \(conversationId)")
    }

    private func handleMarkReadAction(userInfo: [AnyHashable: Any], type: NotificationType) {
        guard let conversationId = userInfo["conversationId"] as? String else {
            return
        }

        // Post notification to mark as read
        NotificationCenter.default.post(
            name: .notificationMarkReadAction,
            object: nil,
            userInfo: [
                "conversationId": conversationId,
                "type": type.rawValue
            ]
        )

        logger.debug("[PushNotification] Mark read action for conversation \(conversationId)")
    }

    private func handleNotificationTap(userInfo: [AnyHashable: Any], type: NotificationType) {
        var navigationInfo: [String: Any] = ["type": type.rawValue]

        switch type {
        case .message, .groupMessage:
            if let conversationId = userInfo["conversationId"] as? String {
                navigationInfo["conversationId"] = conversationId
            }
            if let senderId = userInfo["senderId"] as? String {
                navigationInfo["senderId"] = senderId
            }

        case .connectionRequest:
            if let peerId = userInfo["peerId"] as? String {
                navigationInfo["peerId"] = peerId
            }

        case .system:
            break
        }

        // Post notification to navigate
        NotificationCenter.default.post(
            name: .notificationTapAction,
            object: nil,
            userInfo: navigationInfo
        )

        logger.debug("[PushNotification] Notification tap: \(navigationInfo)")
    }
}

// MARK: - Notification Names

extension Notification.Name {
    static let deviceTokenRegistered = Notification.Name("deviceTokenRegistered")
    static let notificationReplyAction = Notification.Name("notificationReplyAction")
    static let notificationMarkReadAction = Notification.Name("notificationMarkReadAction")
    static let notificationTapAction = Notification.Name("notificationTapAction")
}

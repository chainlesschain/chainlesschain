import Foundation

// MARK: - Priority

/// 通知优先级 — 镜像 Android `NotificationPriority` enum。
///
/// 桌面端按 priority 决定 (1) 是否在 quiet hours 内 silence
/// (`urgent` 通常 bypass) (2) iOS 端 UN center sound / haptic 强度。
public enum NotificationPriority: String, Codable, Sendable, Equatable {
    case low
    case normal
    case high
    case urgent
}

// MARK: - HistoryItem

/// 通知历史项 — 镜像 Android `NotificationHistoryItem`。
///
/// 桌面 `notification.getHistory` 返。`source` = "pc"（桌面本地通知）或
/// "mobile"（其它已配对手机来的）；iOS 端目前只关注 source=="pc" 的项。
public struct NotificationHistoryItem: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let title: String
    public let body: String
    public let priority: NotificationPriority
    public let read: Bool
    public let source: String           // "pc" / "mobile"
    public let createdAt: Int64         // ms epoch
    public let readAt: Int64?
    public let data: [String: String]?

    public init(
        id: String,
        title: String,
        body: String,
        priority: NotificationPriority = .normal,
        read: Bool = false,
        source: String = "pc",
        createdAt: Int64,
        readAt: Int64? = nil,
        data: [String: String]? = nil
    ) {
        self.id = id
        self.title = title
        self.body = body
        self.priority = priority
        self.read = read
        self.source = source
        self.createdAt = createdAt
        self.readAt = readAt
        self.data = data
    }

    /// 单个 item 解码（用于嵌套 + 测试便利）。
    public static func decodeItem(_ dict: [String: Any]) -> NotificationHistoryItem? {
        guard let id = dict["id"] as? String,
              let title = dict["title"] as? String,
              let body = dict["body"] as? String else { return nil }
        let priorityStr = (dict["priority"] as? String) ?? "normal"
        let priority = NotificationPriority(rawValue: priorityStr) ?? .normal
        let read = (dict["read"] as? Bool) ?? false
        let source = (dict["source"] as? String) ?? "pc"
        // createdAt 桌面端可能返 Int 也可能 Int64 — 容错
        let createdAt: Int64
        if let v = dict["createdAt"] as? Int64 {
            createdAt = v
        } else if let v = dict["createdAt"] as? Int {
            createdAt = Int64(v)
        } else if let v = dict["createdAt"] as? Double {
            createdAt = Int64(v)
        } else {
            createdAt = 0
        }
        let readAt: Int64?
        if let v = dict["readAt"] as? Int64 {
            readAt = v
        } else if let v = dict["readAt"] as? Int {
            readAt = Int64(v)
        } else {
            readAt = nil
        }
        let data = dict["data"] as? [String: String]
        return NotificationHistoryItem(
            id: id, title: title, body: body,
            priority: priority, read: read, source: source,
            createdAt: createdAt, readAt: readAt, data: data
        )
    }
}

// MARK: - Settings

/// 通知设置 — 镜像 Android `NotificationSettings`。
///
/// **桌面 source of truth**（per Phase 4 design OQ-4）。iOS 端 settings UI
/// 通过 `getSettings` / `updateSettings` 与桌面同步；iOS 本地 quiet hours
/// 由 `PushNotificationManager` 独立判（`isInQuietHours()`），与本设置不冲突。
public struct NotificationSettings: Codable, Sendable, Equatable {
    public let enabled: Bool
    public let quietHoursEnabled: Bool
    public let quietHoursStart: String?     // "HH:mm" e.g. "22:00"
    public let quietHoursEnd: String?       // "HH:mm" e.g. "08:00"
    public let soundEnabled: Bool
    public let vibrationEnabled: Bool
    public let showPreview: Bool

    public init(
        enabled: Bool = true,
        quietHoursEnabled: Bool = false,
        quietHoursStart: String? = nil,
        quietHoursEnd: String? = nil,
        soundEnabled: Bool = true,
        vibrationEnabled: Bool = true,
        showPreview: Bool = true
    ) {
        self.enabled = enabled
        self.quietHoursEnabled = quietHoursEnabled
        self.quietHoursStart = quietHoursStart
        self.quietHoursEnd = quietHoursEnd
        self.soundEnabled = soundEnabled
        self.vibrationEnabled = vibrationEnabled
        self.showPreview = showPreview
    }

    public static func decode(_ json: String) throws -> NotificationSettings {
        guard let data = json.data(using: .utf8),
              let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw RemoteSkillError.malformedResult("notification settings: invalid JSON")
        }
        return decodeFromDict(dict)
    }

    static func decodeFromDict(_ dict: [String: Any]) -> NotificationSettings {
        NotificationSettings(
            enabled: (dict["enabled"] as? Bool) ?? true,
            quietHoursEnabled: (dict["quietHoursEnabled"] as? Bool) ?? false,
            quietHoursStart: dict["quietHoursStart"] as? String,
            quietHoursEnd: dict["quietHoursEnd"] as? String,
            soundEnabled: (dict["soundEnabled"] as? Bool) ?? true,
            vibrationEnabled: (dict["vibrationEnabled"] as? Bool) ?? true,
            showPreview: (dict["showPreview"] as? Bool) ?? true
        )
    }
}

// MARK: - Responses (6 个 with decode)

/// `notification.send` 响应。silenced=true 表示桌面端 quiet hours 内静音。
public struct NotificationSendResponse: Sendable, Equatable {
    public let success: Bool
    public let notificationId: String?
    public let silenced: Bool
    public let error: String?
    public let timestamp: Int64

    public init(success: Bool, notificationId: String? = nil, silenced: Bool = false, error: String? = nil, timestamp: Int64 = 0) {
        self.success = success
        self.notificationId = notificationId
        self.silenced = silenced
        self.error = error
        self.timestamp = timestamp
    }

    public static func decode(_ json: String) throws -> NotificationSendResponse {
        guard let data = json.data(using: .utf8),
              let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw RemoteSkillError.malformedResult("notification.send response: invalid JSON")
        }
        let timestamp: Int64
        if let v = dict["timestamp"] as? Int64 { timestamp = v }
        else if let v = dict["timestamp"] as? Int { timestamp = Int64(v) }
        else { timestamp = 0 }
        return NotificationSendResponse(
            success: (dict["success"] as? Bool) ?? false,
            notificationId: dict["notificationId"] as? String,
            silenced: (dict["silenced"] as? Bool) ?? false,
            error: dict["error"] as? String,
            timestamp: timestamp
        )
    }
}

/// `notification.sendToMobile` 响应。
public struct NotificationPushResponse: Sendable, Equatable {
    public let success: Bool
    public let delivered: Bool
    public let deviceId: String?
    public let error: String?

    public init(success: Bool, delivered: Bool = false, deviceId: String? = nil, error: String? = nil) {
        self.success = success
        self.delivered = delivered
        self.deviceId = deviceId
        self.error = error
    }

    public static func decode(_ json: String) throws -> NotificationPushResponse {
        guard let data = json.data(using: .utf8),
              let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw RemoteSkillError.malformedResult("notification.sendToMobile response: invalid JSON")
        }
        return NotificationPushResponse(
            success: (dict["success"] as? Bool) ?? false,
            delivered: (dict["delivered"] as? Bool) ?? false,
            deviceId: dict["deviceId"] as? String,
            error: dict["error"] as? String
        )
    }
}

/// `notification.broadcast` 响应。
public struct NotificationBroadcastResponse: Sendable, Equatable {
    public let success: Bool
    public let deliveredCount: Int
    public let failedCount: Int
    public let error: String?

    public init(success: Bool, deliveredCount: Int = 0, failedCount: Int = 0, error: String? = nil) {
        self.success = success
        self.deliveredCount = deliveredCount
        self.failedCount = failedCount
        self.error = error
    }

    public static func decode(_ json: String) throws -> NotificationBroadcastResponse {
        guard let data = json.data(using: .utf8),
              let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw RemoteSkillError.malformedResult("notification.broadcast response: invalid JSON")
        }
        return NotificationBroadcastResponse(
            success: (dict["success"] as? Bool) ?? false,
            deliveredCount: (dict["deliveredCount"] as? Int) ?? 0,
            failedCount: (dict["failedCount"] as? Int) ?? 0,
            error: dict["error"] as? String
        )
    }
}

/// `notification.getHistory` 响应。
public struct NotificationHistoryResponse: Sendable, Equatable {
    public let success: Bool
    public let notifications: [NotificationHistoryItem]
    public let total: Int
    public let unreadCount: Int

    public init(success: Bool, notifications: [NotificationHistoryItem] = [], total: Int = 0, unreadCount: Int = 0) {
        self.success = success
        self.notifications = notifications
        self.total = total
        self.unreadCount = unreadCount
    }

    public static func decode(_ json: String) throws -> NotificationHistoryResponse {
        guard let data = json.data(using: .utf8),
              let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw RemoteSkillError.malformedResult("notification.getHistory response: invalid JSON")
        }
        let rawList = (dict["notifications"] as? [[String: Any]]) ?? []
        let items = rawList.compactMap { NotificationHistoryItem.decodeItem($0) }
        return NotificationHistoryResponse(
            success: (dict["success"] as? Bool) ?? false,
            notifications: items,
            total: (dict["total"] as? Int) ?? items.count,
            unreadCount: (dict["unreadCount"] as? Int) ?? 0
        )
    }
}

/// `notification.markAsRead` / `markAllAsRead` 共用响应。
public struct NotificationMarkResponse: Sendable, Equatable {
    public let success: Bool
    public let markedCount: Int
    public let error: String?

    public init(success: Bool, markedCount: Int = 0, error: String? = nil) {
        self.success = success
        self.markedCount = markedCount
        self.error = error
    }

    public static func decode(_ json: String) throws -> NotificationMarkResponse {
        guard let data = json.data(using: .utf8),
              let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw RemoteSkillError.malformedResult("notification.markAsRead response: invalid JSON")
        }
        return NotificationMarkResponse(
            success: (dict["success"] as? Bool) ?? false,
            markedCount: (dict["markedCount"] as? Int) ?? 0,
            error: dict["error"] as? String
        )
    }
}

/// `notification.delete` 响应。
public struct NotificationDeleteResponse: Sendable, Equatable {
    public let success: Bool
    public let error: String?

    public init(success: Bool, error: String? = nil) {
        self.success = success
        self.error = error
    }

    public static func decode(_ json: String) throws -> NotificationDeleteResponse {
        guard let data = json.data(using: .utf8),
              let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw RemoteSkillError.malformedResult("notification.delete response: invalid JSON")
        }
        return NotificationDeleteResponse(
            success: (dict["success"] as? Bool) ?? false,
            error: dict["error"] as? String
        )
    }
}

/// `notification.clearAll` 响应。
public struct NotificationClearResponse: Sendable, Equatable {
    public let success: Bool
    public let clearedCount: Int
    public let error: String?

    public init(success: Bool, clearedCount: Int = 0, error: String? = nil) {
        self.success = success
        self.clearedCount = clearedCount
        self.error = error
    }

    public static func decode(_ json: String) throws -> NotificationClearResponse {
        guard let data = json.data(using: .utf8),
              let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw RemoteSkillError.malformedResult("notification.clearAll response: invalid JSON")
        }
        return NotificationClearResponse(
            success: (dict["success"] as? Bool) ?? false,
            clearedCount: (dict["clearedCount"] as? Int) ?? 0,
            error: dict["error"] as? String
        )
    }
}

/// `notification.getUnreadCount` 响应。
public struct NotificationUnreadCountResponse: Sendable, Equatable {
    public let success: Bool
    public let count: Int

    public init(success: Bool, count: Int = 0) {
        self.success = success
        self.count = count
    }

    public static func decode(_ json: String) throws -> NotificationUnreadCountResponse {
        guard let data = json.data(using: .utf8),
              let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw RemoteSkillError.malformedResult("notification.getUnreadCount response: invalid JSON")
        }
        return NotificationUnreadCountResponse(
            success: (dict["success"] as? Bool) ?? false,
            count: (dict["count"] as? Int) ?? 0
        )
    }
}

/// `notification.updateSettings` 响应。
public struct NotificationSettingsUpdateResponse: Sendable, Equatable {
    public let success: Bool
    public let settings: NotificationSettings?
    public let error: String?

    public init(success: Bool, settings: NotificationSettings? = nil, error: String? = nil) {
        self.success = success
        self.settings = settings
        self.error = error
    }

    public static func decode(_ json: String) throws -> NotificationSettingsUpdateResponse {
        guard let data = json.data(using: .utf8),
              let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw RemoteSkillError.malformedResult("notification.updateSettings response: invalid JSON")
        }
        let settings: NotificationSettings?
        if let inner = dict["settings"] as? [String: Any] {
            settings = NotificationSettings.decodeFromDict(inner)
        } else {
            settings = nil
        }
        return NotificationSettingsUpdateResponse(
            success: (dict["success"] as? Bool) ?? false,
            settings: settings,
            error: dict["error"] as? String
        )
    }
}

// MARK: - Push Event (server → iOS)

/// `notification.received` push event payload — Phase 4.2 dispatcher 用。
///
/// 桌面端 `notification.send` 触发或 `sendToMobile` 转发时，桌面端经 DC 或
/// signaling forward 推送本 envelope 到所有连接的 mobile peer。
///
/// envelope 结构：
/// ```json
/// {
///   "type": "chainlesschain:event",
///   "payload": {
///     "event": "notification.received",
///     "notificationId": "uuid",
///     "title": "...",
///     "body": "...",
///     "priority": "normal",
///     "source": "pc",
///     "timestamp": 1234567890,
///     "data": {...}
///   }
/// }
/// ```
public struct NotificationReceivedEvent: Sendable, Equatable {
    public let notificationId: String
    public let title: String
    public let body: String
    public let priority: NotificationPriority
    public let source: String       // "pc" / "mobile"
    public let timestamp: Int64
    public let data: [String: String]?

    public init(
        notificationId: String,
        title: String,
        body: String,
        priority: NotificationPriority = .normal,
        source: String = "pc",
        timestamp: Int64,
        data: [String: String]? = nil
    ) {
        self.notificationId = notificationId
        self.title = title
        self.body = body
        self.priority = priority
        self.source = source
        self.timestamp = timestamp
        self.data = data
    }

    /// 从完整 envelope JSON 字符串解析。
    /// 验 type=="chainlesschain:event" + payload.event=="notification.received"，
    /// 不符合 returns nil（dispatcher 应 silent drop）。
    public static func parseFromEnvelope(_ raw: String) -> NotificationReceivedEvent? {
        guard let data = raw.data(using: .utf8),
              let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }
        guard (dict["type"] as? String) == "chainlesschain:event" else { return nil }
        guard let payload = dict["payload"] as? [String: Any] else { return nil }
        guard (payload["event"] as? String) == "notification.received" else { return nil }
        guard let id = payload["notificationId"] as? String,
              let title = payload["title"] as? String,
              let body = payload["body"] as? String else {
            return nil
        }
        let priorityStr = (payload["priority"] as? String) ?? "normal"
        let priority = NotificationPriority(rawValue: priorityStr) ?? .normal
        let source = (payload["source"] as? String) ?? "pc"
        let timestamp: Int64
        if let v = payload["timestamp"] as? Int64 { timestamp = v }
        else if let v = payload["timestamp"] as? Int { timestamp = Int64(v) }
        else if let v = payload["timestamp"] as? Double { timestamp = Int64(v) }
        else { timestamp = 0 }
        let data = payload["data"] as? [String: String]
        return NotificationReceivedEvent(
            notificationId: id,
            title: title,
            body: body,
            priority: priority,
            source: source,
            timestamp: timestamp,
            data: data
        )
    }
}

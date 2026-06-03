import Foundation

/// 通知 typed RPC wrapper — Phase 4.1。
///
/// 镜像 Android `app/src/main/java/.../remote/commands/NotificationCommands.kt`。
/// 11 个 method 全部 delegate 到 Phase 3 抽出的通用 [RemoteCommandClient]，
/// 与 ClipboardCommands / FileCommands / ScreenshotCommands / SystemInfoCommands
/// 共享同一 invoke 池 + DC/signaling 双路径 + LRU dedup + continuation 池清理。
///
/// **wire 协议**（与桌面 `notification-handler.js` 对齐，与 Android 完全一致）：
/// - `notification.send` params `{title, body, icon?, priority, respectQuietHours}`
///   → `{success, notificationId?, silenced, error?, timestamp}`
/// - `notification.sendToMobile` params `{title, body, deviceId?, data?}`
///   → `{success, delivered, deviceId?, error?}`
/// - `notification.broadcast` params `{title, body}`
///   → `{success, deliveredCount, failedCount, error?}`
/// - `notification.getHistory` params `{limit, offset, unreadOnly}`
///   → `{success, notifications[], total, unreadCount}`
/// - `notification.markAsRead` params `{notificationId}` → `{success, markedCount, error?}`
/// - `notification.markAllAsRead` params `{}` → `{success, markedCount, error?}`
/// - `notification.getSettings` params `{}` → settings 对象本身
/// - `notification.updateSettings` params 部分 settings 字段
///   → `{success, settings?, error?}`
/// - `notification.delete` params `{notificationId}` → `{success, error?}`
/// - `notification.clearAll` params `{}` → `{success, clearedCount, error?}`
/// - `notification.getUnreadCount` params `{}` → `{success, count}`
///
/// **server-push event**（dispatcher 处理，不在本类）：
/// - `notification.received` event — 桌面端 send 触发 → push envelope；
///   Phase 4.2 [NotificationEventDispatcher] 订阅 commandClient.events 流过滤
public actor NotificationCommands {

    private let client: RemoteCommandClient

    public init(client: RemoteCommandClient) {
        self.client = client
    }

    // MARK: - Send (3 method)

    /// 在桌面端发本地通知。
    public func send(
        pcPeerId: String,
        title: String,
        body: String,
        icon: String? = nil,
        priority: NotificationPriority = .normal,
        respectQuietHours: Bool = true,
        mobileDid: String? = nil
    ) async throws -> NotificationSendResponse {
        guard !title.isEmpty else {
            throw RemoteSkillError.invalidArgument("notification.send title is empty")
        }
        var params: [String: Any] = [
            "title": title,
            "body": body,
            "priority": priority.rawValue,
            "respectQuietHours": respectQuietHours
        ]
        if let icon = icon { params["icon"] = icon }
        let response = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "notification.send",
            params: params,
            mobileDid: mobileDid
        )
        return try unwrap(response, decoder: NotificationSendResponse.decode)
    }

    /// 桌面端推送通知到移动设备（非本机）。
    public func sendToMobile(
        pcPeerId: String,
        title: String,
        body: String,
        deviceId: String? = nil,
        data: [String: String]? = nil,
        mobileDid: String? = nil
    ) async throws -> NotificationPushResponse {
        guard !title.isEmpty else {
            throw RemoteSkillError.invalidArgument("notification.sendToMobile title is empty")
        }
        var params: [String: Any] = [
            "title": title,
            "body": body
        ]
        if let deviceId = deviceId { params["deviceId"] = deviceId }
        if let data = data { params["data"] = data }
        let response = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "notification.sendToMobile",
            params: params,
            mobileDid: mobileDid
        )
        return try unwrap(response, decoder: NotificationPushResponse.decode)
    }

    /// 广播到所有连接的设备。
    public func broadcast(
        pcPeerId: String,
        title: String,
        body: String,
        mobileDid: String? = nil
    ) async throws -> NotificationBroadcastResponse {
        guard !title.isEmpty else {
            throw RemoteSkillError.invalidArgument("notification.broadcast title is empty")
        }
        let params: [String: Any] = ["title": title, "body": body]
        let response = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "notification.broadcast",
            params: params,
            mobileDid: mobileDid
        )
        return try unwrap(response, decoder: NotificationBroadcastResponse.decode)
    }

    // MARK: - History (1 method)

    /// 拉历史通知列表。
    public func getHistory(
        pcPeerId: String,
        limit: Int = 50,
        offset: Int = 0,
        unreadOnly: Bool = false,
        mobileDid: String? = nil
    ) async throws -> NotificationHistoryResponse {
        let params: [String: Any] = [
            "limit": max(1, limit),
            "offset": max(0, offset),
            "unreadOnly": unreadOnly
        ]
        let response = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "notification.getHistory",
            params: params,
            mobileDid: mobileDid
        )
        return try unwrap(response, decoder: NotificationHistoryResponse.decode)
    }

    // MARK: - Mark / Delete / Clear (5 method)

    /// 标某条通知为已读。
    public func markAsRead(
        pcPeerId: String,
        notificationId: String,
        mobileDid: String? = nil
    ) async throws -> NotificationMarkResponse {
        guard !notificationId.isEmpty else {
            throw RemoteSkillError.invalidArgument("notification.markAsRead notificationId is empty")
        }
        let response = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "notification.markAsRead",
            params: ["notificationId": notificationId],
            mobileDid: mobileDid
        )
        return try unwrap(response, decoder: NotificationMarkResponse.decode)
    }

    /// 标所有通知为已读。
    public func markAllAsRead(
        pcPeerId: String,
        mobileDid: String? = nil
    ) async throws -> NotificationMarkResponse {
        let response = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "notification.markAllAsRead",
            params: [:],
            mobileDid: mobileDid
        )
        return try unwrap(response, decoder: NotificationMarkResponse.decode)
    }

    /// 删除某条通知。
    public func delete(
        pcPeerId: String,
        notificationId: String,
        mobileDid: String? = nil
    ) async throws -> NotificationDeleteResponse {
        guard !notificationId.isEmpty else {
            throw RemoteSkillError.invalidArgument("notification.delete notificationId is empty")
        }
        let response = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "notification.delete",
            params: ["notificationId": notificationId],
            mobileDid: mobileDid
        )
        return try unwrap(response, decoder: NotificationDeleteResponse.decode)
    }

    /// 清空所有通知。
    public func clearAll(
        pcPeerId: String,
        mobileDid: String? = nil
    ) async throws -> NotificationClearResponse {
        let response = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "notification.clearAll",
            params: [:],
            mobileDid: mobileDid
        )
        return try unwrap(response, decoder: NotificationClearResponse.decode)
    }

    /// 获取未读通知数量。
    public func getUnreadCount(
        pcPeerId: String,
        mobileDid: String? = nil
    ) async throws -> NotificationUnreadCountResponse {
        let response = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "notification.getUnreadCount",
            params: [:],
            mobileDid: mobileDid
        )
        return try unwrap(response, decoder: NotificationUnreadCountResponse.decode)
    }

    // MARK: - Settings (2 method)

    /// 获取桌面端通知设置。
    public func getSettings(
        pcPeerId: String,
        mobileDid: String? = nil
    ) async throws -> NotificationSettings {
        let response = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "notification.getSettings",
            params: [:],
            mobileDid: mobileDid
        )
        return try unwrap(response, decoder: NotificationSettings.decode)
    }

    /// 部分更新桌面端通知设置。所有字段可选；nil 表示不改。
    public func updateSettings(
        pcPeerId: String,
        enabled: Bool? = nil,
        quietHoursEnabled: Bool? = nil,
        quietHoursStart: String? = nil,
        quietHoursEnd: String? = nil,
        soundEnabled: Bool? = nil,
        mobileDid: String? = nil
    ) async throws -> NotificationSettingsUpdateResponse {
        var params: [String: Any] = [:]
        if let v = enabled { params["enabled"] = v }
        if let v = quietHoursEnabled { params["quietHoursEnabled"] = v }
        if let v = quietHoursStart { params["quietHoursStart"] = v }
        if let v = quietHoursEnd { params["quietHoursEnd"] = v }
        if let v = soundEnabled { params["soundEnabled"] = v }
        guard !params.isEmpty else {
            throw RemoteSkillError.invalidArgument("notification.updateSettings: no fields to update")
        }
        let response = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "notification.updateSettings",
            params: params,
            mobileDid: mobileDid
        )
        return try unwrap(response, decoder: NotificationSettingsUpdateResponse.decode)
    }

    // MARK: - Private

    /// 通用 response → typed result 解包。
    /// failure 路径 throw RemoteSkillError.remoteError，
    /// success 路径调 decoder（可能再抛 malformedResult）。
    private func unwrap<T>(
        _ response: TerminalRpcResponse,
        decoder: (String) throws -> T
    ) throws -> T {
        switch response {
        case .success(_, let resultJson):
            return try decoder(resultJson)
        case .failure(let reqId, let msg):
            throw RemoteSkillError.remoteError(reqId: reqId, message: msg)
        }
    }
}

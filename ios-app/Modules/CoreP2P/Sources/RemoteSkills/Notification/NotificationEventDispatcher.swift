import Foundation
import Combine

// MARK: - PushNotificationServicing protocol

/// PushNotificationManager 集成的最小抽象 — Phase 4.2 dispatcher 单测注入 mock 用。
///
/// 既有 `ChainlessChain/Features/Common/Services/PushNotificationManager.swift`
/// 的 `scheduleSystemNotification(title:body:userInfo:)` 方法符合本协议；
/// 让 PushNotificationManager extension 显式 conform 即可（在 app target 内做，不
/// 跨 module；CoreP2P 不依赖 PushNotificationManager 具体类型）。
@MainActor
public protocol RemoteNotificationPushTarget: AnyObject {
    func scheduleSystemNotification(
        title: String,
        body: String,
        userInfo: [String: Any]
    ) async
}

// MARK: - ReceivedNotification (SwiftUI-friendly wrapper)

/// SwiftUI 端 dispatcher 暴露的最近一条 push — 与 wire 层 `NotificationReceivedEvent`
/// 区别：用 `Date` 而非 `Int64` 时间戳，便于 `.formatted(.relative(...))` 渲染。
public struct ReceivedNotification: Identifiable, Sendable, Equatable {
    public let id: String                        // notificationId
    public let title: String
    public let body: String
    public let priority: NotificationPriority
    public let source: String                    // "pc" / "mobile"
    public let receivedAt: Date
    public let data: [String: String]?

    public init(
        id: String,
        title: String,
        body: String,
        priority: NotificationPriority,
        source: String,
        receivedAt: Date,
        data: [String: String]? = nil
    ) {
        self.id = id
        self.title = title
        self.body = body
        self.priority = priority
        self.source = source
        self.receivedAt = receivedAt
        self.data = data
    }

    /// 从 wire event 转 UI-friendly。timestamp = 0 兜底为现在。
    public static func from(event: NotificationReceivedEvent) -> ReceivedNotification {
        let date: Date
        if event.timestamp > 0 {
            date = Date(timeIntervalSince1970: TimeInterval(event.timestamp) / 1000.0)
        } else {
            date = Date()
        }
        return ReceivedNotification(
            id: event.notificationId,
            title: event.title,
            body: event.body,
            priority: event.priority,
            source: event.source,
            receivedAt: date,
            data: event.data
        )
    }
}

// MARK: - NotificationEventDispatcher

/// 订阅 `RemoteCommandClient.events` 流 + filter `notification.received` 事件 +
/// LRU dedup + 触发 iOS 系统通知 — Phase 4.2。
///
/// **架构定位**（与 Phase 4 设计 §4.2.2 对齐）：
/// 桌面 NotificationCommands.send → mobile-bridge 经 DC/signaling 发 envelope →
/// iOS RemoteWebRTCClient.inboundMessages → RemoteCommandClient.handleInbound →
/// events 流 yield → **本类**订阅 → parseFromEnvelope → LRU dedup → PushTarget.
/// scheduleSystemNotification → iOS UN center 弹 banner / 锁屏 push / 进 NC。
///
/// **LRU dedup**（per OQ-3 + §7.3 trap）：notificationId 256-LRU。30s TTL 由
/// LRU 容量隐式实现（无显式 TTL；256 长度下 30s 内不会自然 evict）。防 DC +
/// signaling 双发同一通知重复弹 banner。
///
/// **quiet hours**（per §7.2 trap）：不在本类判 — 信任 PushTarget 内部行为
/// （PushNotificationManager 既有 `isInQuietHours` 私有方法，在 schedule 调用前
/// 不会主动 silence；这是既有 behavior，Phase 4 v0.1 接受）。iOS 端 settings
/// `enabled` toggle 由 `RemoteNotificationsViewModel` 在调用前 gate（Phase 4.3）。
///
/// **lifecycle**：start() 起 subscription Task；stop() cancel；idempotent。
/// **不持久化**：unreadCount 仅内存（per OQ-2 lean 决策；进 ViewModel 调
/// `getUnreadCount` 拉桌面 SoT 校准）。
///
/// **@MainActor**：与 PushNotificationManager 一致；@Published 自然驱动 SwiftUI；
/// dedup struct + Task lifecycle 都在 main isolation 内安全。
@MainActor
public final class NotificationEventDispatcher: ObservableObject {

    /// 最近一条收到的 push — UI 可显 toast 短暂提示 "已收到桌面通知"。
    @Published public private(set) var latestPush: ReceivedNotification?

    /// 收到但未读的累计数 — 给 RemoteOperateView 第 6 tab badge / app icon badge 用。
    /// 被 ViewModel `markAsRead` / `clearAll` 等动作调用 `resetUnreadCount` 重置。
    @Published public private(set) var unreadCount: Int = 0

    private let eventStream: AsyncStream<String>
    private weak var pushTarget: RemoteNotificationPushTarget?
    private var seenIds = LRUSet<String>(capacity: 256)
    private var subscription: Task<Void, Never>?

    public init(
        eventStream: AsyncStream<String>,
        pushTarget: RemoteNotificationPushTarget?
    ) {
        self.eventStream = eventStream
        self.pushTarget = pushTarget
    }

    deinit {
        subscription?.cancel()
    }

    /// 起 subscription。idempotent — 已起则 no-op。
    /// 通常由 RemoteDependencies init 时调一次（与 Phase 3 OfflineQueueDrainer
    /// 同模式）；不需要 stop / restart。
    public func start() {
        guard subscription == nil else { return }
        let stream = eventStream
        subscription = Task { [weak self] in
            for await raw in stream {
                await self?.handle(raw: raw)
            }
        }
    }

    /// 停 subscription。idempotent。
    public func stop() {
        subscription?.cancel()
        subscription = nil
    }

    /// ViewModel 调 markAsRead / clearAll 后调本方法清 unreadCount + app icon badge。
    /// 保留 latestPush（不主动清，避免 UI banner 闪退）。
    public func resetUnreadCount() {
        unreadCount = 0
    }

    /// 测试 helper — 验 LRU 是否含某 id。Phase 4.2 单测用。
    public func _testHasSeenId(_ id: String) -> Bool {
        seenIds.contains(id)
    }

    // MARK: - Private

    private func handle(raw: String) async {
        // 1) parse envelope — 非 notification.received / malformed → silent drop
        guard let event = NotificationReceivedEvent.parseFromEnvelope(raw) else {
            return
        }

        // 2) LRU dedup — 同 id 第二次 silent drop（DC + signaling 双发兜底）
        guard seenIds.insert(event.notificationId) else {
            return
        }

        // 3) 调 PushTarget 触发 iOS 系统通知
        let userInfo: [String: Any] = [
            "remote_notification_id": event.notificationId,
            "remote_source": event.source,
            "remote_priority": event.priority.rawValue
        ]
        // 注意：scheduleSystemNotification 实现内 try? — 失败不抛；
        // 即使 PushTarget = nil 也 silent skip（dispatcher 仍维护内部状态）
        await pushTarget?.scheduleSystemNotification(
            title: event.title,
            body: event.body,
            userInfo: userInfo
        )

        // 4) 更新 @Published 状态（SwiftUI 自动 react）
        latestPush = ReceivedNotification.from(event: event)
        unreadCount += 1
    }
}

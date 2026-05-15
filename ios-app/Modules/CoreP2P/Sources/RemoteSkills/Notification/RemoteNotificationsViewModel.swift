import Foundation
import Combine

/// 通知 tab 的 ViewModel — Phase 4.3。
///
/// **职责**：
/// 1. 持有 `@Published` history list / unreadCount / isLoading / lastError 给
///    SwiftUI 订阅
/// 2. 调 `NotificationCommands` 完成 user action（load/markAsRead/delete/clearAll）
/// 3. DC 不通时 mutating action 走 `OfflineCommandQueue.enqueue` (per Phase 4
///    设计 §6.3)；网络恢复 `OfflineQueueDrainer` 自动 drain
/// 4. mirror `NotificationEventDispatcher.unreadCount` 让 View 一处订阅
/// 5. 缓存桌面 `NotificationSettings` 给 settings sheet readonly section 用
///
/// **乐观更新**：mutating action 成功立即本地 update history item；server 失败
/// → 调 refresh() 拉服务器 SoT 重对齐（eventual consistency 接受）。
///
/// **unreadCount 模型**：VM owner；初始 mirror dispatcher；每次 loadHistory
/// 用 server response.unreadCount 覆写；markAsRead 成功后本地 -=1 + dispatcher
/// reset。
///
/// **isLoading**：单 bool；多并发 action 不区分（Phase 4.3 v0.1 lean；v0.2 加
/// per-action counter）。
@MainActor
public final class RemoteNotificationsViewModel: ObservableObject {

    // MARK: - Published state

    @Published public private(set) var history: [NotificationHistoryItem] = []
    @Published public private(set) var unreadCount: Int = 0
    @Published public private(set) var isLoading: Bool = false
    @Published public private(set) var lastError: String?

    /// 桌面端 settings 缓存（按需 loadDesktopSettings 拉）。settings sheet 显
    /// readonly section 用。本地 iOS UN center 设置由 PushNotificationManager
    /// 独立管，与本字段不冲突（per OQ-4）。
    @Published public private(set) var desktopSettings: NotificationSettings?

    // MARK: - User-controlled state

    /// 历史列表 filter — 切换后调 loadHistory 拉新数据。
    @Published public var unreadOnly: Bool = false

    // MARK: - Deps

    public let pcPeerId: String
    private let commands: NotificationCommands
    private let dispatcher: NotificationEventDispatcher
    private let offlineQueue: OfflineCommandQueue?
    private let isDataChannelReady: @Sendable () async -> Bool
    private let currentDIDProvider: () -> String?

    private var dispatcherSubscription: AnyCancellable?

    // MARK: - Init

    public init(
        pcPeerId: String,
        commands: NotificationCommands,
        dispatcher: NotificationEventDispatcher,
        offlineQueue: OfflineCommandQueue? = nil,
        isDataChannelReady: @escaping @Sendable () async -> Bool = { true },
        currentDIDProvider: @escaping () -> String? = { nil }
    ) {
        self.pcPeerId = pcPeerId
        self.commands = commands
        self.dispatcher = dispatcher
        self.offlineQueue = offlineQueue
        self.isDataChannelReady = isDataChannelReady
        self.currentDIDProvider = currentDIDProvider
        // 初始 unreadCount = dispatcher snapshot
        self.unreadCount = dispatcher.unreadCount
        // mirror dispatcher.unreadCount 改动 → 本 VM
        self.dispatcherSubscription = dispatcher.$unreadCount
            .removeDuplicates()
            .sink { [weak self] newValue in
                guard let self = self else { return }
                // 仅在 dispatcher 涨时 mirror（避免 dispatcher reset 后又被 mirror 拉低）
                // 简化：直接 mirror，loadHistory 后会被 server 值覆写
                self.unreadCount = newValue
            }
    }

    // MARK: - Public actions (history)

    /// 拉历史 + 用 server response.unreadCount 覆写本地 + reset dispatcher 计数。
    public func loadHistory() async {
        await runWithLoading {
            do {
                let resp = try await self.commands.getHistory(
                    pcPeerId: self.pcPeerId,
                    limit: 50,
                    offset: 0,
                    unreadOnly: self.unreadOnly,
                    mobileDid: self.currentDIDProvider()
                )
                self.history = resp.notifications
                self.unreadCount = resp.unreadCount
                self.dispatcher.resetUnreadCount()
                self.lastError = nil
            } catch let RemoteSkillError.remoteError(_, msg) {
                self.lastError = "桌面端错误：\(msg)"
            } catch {
                self.lastError = "拉取历史失败：\((error as NSError).localizedDescription)"
            }
        }
    }

    /// loadHistory 别名 — 给 .refreshable 用语义清晰。
    public func refresh() async {
        await loadHistory()
    }

    // MARK: - Public actions (mark / delete)

    /// 标某条已读。乐观更新：本地立即 read=true + unreadCount -= 1；
    /// server 失败时调 refresh 重对齐。
    public func markAsRead(id: String) async {
        guard !id.isEmpty else { return }
        // 乐观：本地立即更新（找到 → 改 → 替换 array）
        let originalIndex = history.firstIndex(where: { $0.id == id })
        let originalItem = originalIndex.map { history[$0] }
        if let idx = originalIndex, !history[idx].read {
            history[idx] = readItem(history[idx])
            unreadCount = max(0, unreadCount - 1)
        }

        // DC ready → 直调；否则 enqueue
        if await isDataChannelReady() {
            do {
                _ = try await commands.markAsRead(
                    pcPeerId: pcPeerId, notificationId: id,
                    mobileDid: currentDIDProvider()
                )
                lastError = nil
            } catch {
                // 回滚乐观更新 + refresh
                if let idx = originalIndex, let item = originalItem {
                    history[idx] = item
                }
                lastError = "标已读失败，正在重新刷新：\((error as NSError).localizedDescription)"
                await loadHistory()
            }
        } else if let q = offlineQueue {
            await q.enqueue(
                method: "notification.markAsRead",
                paramsJson: #"{"notificationId":"\#(escapeJsonString(id))"}"#,
                mobileDid: currentDIDProvider()
            )
            lastError = "已加入离线队列，恢复连接后自动同步"
        } else {
            // 既无 DC 也无 queue — 回滚 + 报错
            if let idx = originalIndex, let item = originalItem {
                history[idx] = item
            }
            lastError = "桌面端未连接"
        }
    }

    /// 标全部已读。乐观更新整个列表。
    public func markAllAsRead() async {
        let snapshot = history
        // 乐观：本地立即所有 → read=true
        history = history.map { $0.read ? $0 : readItem($0) }
        unreadCount = 0

        if await isDataChannelReady() {
            do {
                _ = try await commands.markAllAsRead(
                    pcPeerId: pcPeerId, mobileDid: currentDIDProvider()
                )
                dispatcher.resetUnreadCount()
                lastError = nil
            } catch {
                history = snapshot
                lastError = "标全部已读失败，正在重新刷新：\((error as NSError).localizedDescription)"
                await loadHistory()
            }
        } else if let q = offlineQueue {
            await q.enqueue(
                method: "notification.markAllAsRead",
                paramsJson: "{}",
                mobileDid: currentDIDProvider()
            )
            dispatcher.resetUnreadCount()
            lastError = "已加入离线队列"
        } else {
            history = snapshot
            lastError = "桌面端未连接"
        }
    }

    /// 删除某条。乐观删本地。
    public func delete(id: String) async {
        guard !id.isEmpty else { return }
        let originalIndex = history.firstIndex(where: { $0.id == id })
        let originalItem = originalIndex.map { history[$0] }
        if let idx = originalIndex {
            let wasUnread = !history[idx].read
            history.remove(at: idx)
            if wasUnread { unreadCount = max(0, unreadCount - 1) }
        }

        if await isDataChannelReady() {
            do {
                _ = try await commands.delete(
                    pcPeerId: pcPeerId, notificationId: id,
                    mobileDid: currentDIDProvider()
                )
                lastError = nil
            } catch {
                if let idx = originalIndex, let item = originalItem {
                    history.insert(item, at: min(idx, history.count))
                }
                lastError = "删除失败，正在重新刷新：\((error as NSError).localizedDescription)"
                await loadHistory()
            }
        } else if let q = offlineQueue {
            await q.enqueue(
                method: "notification.delete",
                paramsJson: #"{"notificationId":"\#(escapeJsonString(id))"}"#,
                mobileDid: currentDIDProvider()
            )
            lastError = "已加入离线队列"
        } else {
            if let idx = originalIndex, let item = originalItem {
                history.insert(item, at: min(idx, history.count))
            }
            lastError = "桌面端未连接"
        }
    }

    /// 清空全部。乐观清本地。
    public func clearAll() async {
        let snapshot = history
        history = []
        unreadCount = 0

        if await isDataChannelReady() {
            do {
                _ = try await commands.clearAll(
                    pcPeerId: pcPeerId, mobileDid: currentDIDProvider()
                )
                dispatcher.resetUnreadCount()
                lastError = nil
            } catch {
                history = snapshot
                lastError = "清空失败，正在重新刷新：\((error as NSError).localizedDescription)"
                await loadHistory()
            }
        } else if let q = offlineQueue {
            await q.enqueue(
                method: "notification.clearAll",
                paramsJson: "{}",
                mobileDid: currentDIDProvider()
            )
            dispatcher.resetUnreadCount()
            lastError = "已加入离线队列"
        } else {
            history = snapshot
            lastError = "桌面端未连接"
        }
    }

    // MARK: - Public actions (settings)

    /// 拉桌面端 settings 缓存。settings sheet 进入时按需调一次。
    public func loadDesktopSettings() async {
        do {
            let s = try await commands.getSettings(
                pcPeerId: pcPeerId, mobileDid: currentDIDProvider()
            )
            desktopSettings = s
            lastError = nil
        } catch {
            lastError = "拉取桌面 settings 失败：\((error as NSError).localizedDescription)"
        }
    }

    // MARK: - Public utility

    /// View 显示 error toast 后调本方法清。
    public func clearError() {
        lastError = nil
    }

    // MARK: - Private helpers

    private func runWithLoading(_ op: () async -> Void) async {
        isLoading = true
        await op()
        isLoading = false
    }

    /// 创建一个 read=true 副本（保留其它字段 + 设 readAt = now）。
    private func readItem(_ item: NotificationHistoryItem) -> NotificationHistoryItem {
        NotificationHistoryItem(
            id: item.id, title: item.title, body: item.body,
            priority: item.priority, read: true, source: item.source,
            createdAt: item.createdAt,
            readAt: Int64(Date().timeIntervalSince1970 * 1000),
            data: item.data
        )
    }

    /// 简易 JSON string 字段 escape（仅处理 backslash + quote + control）。
    /// notificationId 通常是 UUID hex 不会含特殊字符，但防御性处理。
    private func escapeJsonString(_ s: String) -> String {
        var out = ""
        for c in s {
            switch c {
            case "\\": out.append("\\\\")
            case "\"": out.append("\\\"")
            case "\n": out.append("\\n")
            case "\r": out.append("\\r")
            case "\t": out.append("\\t")
            default: out.append(c)
            }
        }
        return out
    }
}

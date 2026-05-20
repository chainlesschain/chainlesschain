import Foundation
import Combine

// MARK: - HubSyncEventDispatcher

/// 订阅 `RemoteCommandClient.events` 流 + filter `personal-data-hub.sync.progress`
/// 事件 + 按 adapter 解复用 — Phase 14.3.2。
///
/// **架构定位**（与 Phase 14.3 设计 §5.4 + Android Phase 14.3.1 镜像）：
/// 桌面 `hub.registry.syncAdapter` 跑 → `onSyncEvent` 回调被 `route-mobile.
/// runSyncStream` 钩 → `mobileBridge.sendToMobile` 发 envelope →
/// iOS RemoteWebRTCClient.inboundMessages → RemoteCommandClient.handleInbound →
/// events 流 yield → RemoteDependencies fan-out 第 4 子流 (hubSyncEventsStream)
/// → **本类**订阅 → `HubSyncEvent.parseFromEnvelope` → @Published progress
/// 字典更新 → SwiftUI HubAdaptersView 自动渲染进度文字。
///
/// **wire 格式**（per Android dispatcher + desktop badc1e108）：
/// ```
/// {
///   "type": "chainlesschain:event:notification",
///   "payload": {
///     "jsonrpc": "2.0",
///     "method": "personal-data-hub.sync.progress",
///     "params": { kind, adapter, partition?, detail?, report?, message? }
///   }
/// }
/// ```
///
/// **多 adapter 并发隔离**（per design §5.4）：progress / completedReports /
/// errors 都按 adapter key 字典化；连发两个 syncAdapter 不同 adapter 时各自 state
/// 互不覆盖（不同于 Android 单 SharedFlow 走 VM filter — iOS 在 dispatcher 层
/// pre-split，VM 端可直接读对应 adapter 的状态）。
///
/// **不做 LRU dedup**（与 Phase 4/5 不同）：sync progress 是有序生成的，重复 emit
/// 极小可能（仅 DC + signaling 双发，但 sendToMobile 已抽象 DC fallback signaling，
/// 单路径发送）。最坏 case 同一 kind 重复 emit 不破坏 UI（同 kind 覆盖同 kind 是 idempotent）。
///
/// **done / error 终态处理**：
/// - `done` 事件：把 SyncReport 写 completedReports[adapter]，progress[adapter] 清
///   （VM 通过 latest done 知道同步完成 + 上次 ingested 数量）。
/// - `error` 事件：把 message 写 errors[adapter]，progress[adapter] 清。
///   VM 显示 banner + 用户重试时新一轮 syncStream 调用会覆盖。
///
/// **lifecycle**：start() 起 subscription Task；stop() cancel；idempotent。
/// 通常由 RemoteDependencies init 时调一次（与 Phase 4/5 同模式）。
///
/// **@MainActor**：@Published 自然驱动 SwiftUI；进度字典都在 main isolation 内安全。
@MainActor
public final class HubSyncEventDispatcher: ObservableObject {

    /// adapter → 当前 in-flight 进度事件（connecting/fetching/normalizing）。
    /// done / error 到达后会从字典移除，由 completedReports / errors 接管。
    @Published public private(set) var progress: [String: HubSyncEvent] = [:]

    /// adapter → 最近一次完成时的 SyncReport。同步成功累计；用户触发新一轮
    /// syncStream 时本字典**不清**（保留"上次同步 +N 事件"显示）。
    @Published public private(set) var completedReports: [String: HubSyncReport] = [:]

    /// adapter → 最近一次同步失败的 error message。用户触发新一轮 syncStream 时
    /// 本字典**不清**（保留错误信息直到下一次成功）；新一轮 done 会覆盖。
    @Published public private(set) var errors: [String: String] = [:]

    private let eventStream: AsyncStream<String>
    private var subscription: Task<Void, Never>?

    public init(eventStream: AsyncStream<String>) {
        self.eventStream = eventStream
    }

    deinit {
        subscription?.cancel()
    }

    // MARK: - Lifecycle

    /// 起 subscription。idempotent — 已起则 no-op。
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

    // MARK: - ViewModel hooks

    /// VM 触发新一轮 syncStream 前调用，清当前 adapter 的 progress / error。
    /// completedReports 保留 — UI 可继续显"上次 +N 事件"直到 done 覆盖。
    public func resetForNewSync(adapter: String) {
        progress.removeValue(forKey: adapter)
        errors.removeValue(forKey: adapter)
    }

    /// 完全清掉某 adapter 的所有状态（progress + completed + error）— UI"清除"按钮调。
    public func clearAdapter(_ adapter: String) {
        progress.removeValue(forKey: adapter)
        completedReports.removeValue(forKey: adapter)
        errors.removeValue(forKey: adapter)
    }

    // MARK: - Test helpers

    /// 测试 helper — 直接喂一个 HubSyncEvent，绕过 envelope parse。
    /// Phase 14.3.2 dispatcher 单测用。
    internal func _testApply(_ event: HubSyncEvent) {
        applyParsed(event)
    }

    /// 测试 helper — 直接喂 envelope raw 字符串，走完整 parse + apply 路径。
    internal func _testHandle(raw: String) async {
        await handle(raw: raw)
    }

    // MARK: - Private

    private func handle(raw: String) async {
        // 1) parse — 非 PDH sync.progress / malformed → silent drop
        guard let event = HubSyncEvent.parseFromEnvelope(raw) else { return }
        applyParsed(event)
    }

    private func applyParsed(_ event: HubSyncEvent) {
        switch event.kind {
        case "connecting", "fetching", "normalizing":
            progress[event.adapter] = event
            // 进入新一轮 in-flight；不主动清 error/completed — 让 done/error 覆盖
        case "done":
            progress.removeValue(forKey: event.adapter)
            errors.removeValue(forKey: event.adapter)
            if let report = event.report {
                completedReports[event.adapter] = report
            }
        case "error":
            progress.removeValue(forKey: event.adapter)
            errors[event.adapter] = event.message ?? "未知错误"
        default:
            // forward-compat: unknown kind treated as in-flight progress
            progress[event.adapter] = event
        }
    }
}

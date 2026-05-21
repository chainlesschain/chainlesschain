import Foundation
import Combine

// MARK: - HubAskViewModel

/// Hub 提问页 VM — Phase 14.2.2 mirror Android `HubAskViewModel`.
///
/// **职责**：
/// 1. 提问 → `commands.ask` → 渲染 answer + citation chips
/// 2. 隐私 gate：当桌面返回 "Non-local LLM blocked" 错误时弹
///    `showAcceptNonLocalSheet`，用户确认后 acceptNonLocal=true 重发
/// 3. citation chip 点击 → `commands.eventDetail` → bottom sheet 显事件
/// 4. init 时拉一次 health 缓存（顶部健康卡片用）
@MainActor
public final class HubAskViewModel: ObservableObject {

    // MARK: - Published state

    @Published public var question: String = ""
    @Published public private(set) var isLoading: Bool = false
    @Published public private(set) var answer: String?
    @Published public private(set) var citations: [HubCitation] = []
    @Published public private(set) var llmName: String?
    @Published public private(set) var isLocal: Bool = true
    @Published public private(set) var errorMessage: String?

    /// 当 acceptNonLocal=false 且桌面拒绝时设 true — UI 弹 AcceptNonLocalSheet。
    @Published public private(set) var showAcceptNonLocalSheet: Bool = false
    @Published public private(set) var pendingNonLocalQuestion: String?
    /// 用户「我同意」后置 true 重发；每次 reset（per Android 设计 §7 trap T7）。
    @Published public private(set) var acceptNonLocalConfirmed: Bool = false

    /// citation chip tap → eventDetail 拉详情（loading 期间 chip 灰）。
    @Published public private(set) var activeCitationDetail: HubEventDetailResponse?
    @Published public private(set) var activeCitationLoading: Bool = false

    /// 健康卡片缓存（init 拉一次；用户可手动 refreshHealth() 刷新）。
    @Published public private(set) var health: HubHealth?

    // MARK: - Deps

    public let pcPeerId: String
    private let commands: PersonalDataHubCommands
    private let currentDIDProvider: () -> String?

    public init(
        pcPeerId: String,
        commands: PersonalDataHubCommands,
        currentDIDProvider: @escaping () -> String? = { nil }
    ) {
        self.pcPeerId = pcPeerId
        self.commands = commands
        self.currentDIDProvider = currentDIDProvider
        Task { await self.refreshHealth() }
    }

    // MARK: - Question input

    public func onQuestionChange(_ value: String) {
        question = value
        if errorMessage != nil { errorMessage = nil }
    }

    // MARK: - Submit

    /// 提交问题。空白或 isLoading 时 no-op。
    public func submit() async {
        let q = question.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty, !isLoading else { return }

        isLoading = true
        errorMessage = nil
        answer = nil
        citations = []
        defer { isLoading = false }

        do {
            let result = try await commands.ask(
                pcPeerId: pcPeerId,
                question: q,
                acceptNonLocal: acceptNonLocalConfirmed ? true : nil,
                mobileDid: currentDIDProvider()
            )
            apply(result: result)
        } catch {
            handleAskFailure(question: q, error: error)
        }
    }

    private func apply(result: HubAskResult) {
        answer = result.answer
        citations = result.citations
        llmName = result.llmName
        isLocal = result.isLocal
        errorMessage = nil
    }

    private func handleAskFailure(question: String, error: Error) {
        let message: String = {
            if case let RemoteSkillError.remoteError(_, msg) = error { return msg }
            return (error as NSError).localizedDescription
        }()
        // Mirror Android: detect "Non-local LLM" / "acceptNonLocal" substring
        // → show sheet instead of error banner (Android Phase 14.1 §5.2).
        let lower = message.lowercased()
        let isNonLocalBlocked = lower.contains("non-local llm") ||
            lower.contains("acceptnonlocal")
        if isNonLocalBlocked && !acceptNonLocalConfirmed {
            showAcceptNonLocalSheet = true
            pendingNonLocalQuestion = question
            errorMessage = nil  // sheet IS the UX; no double-warn toast
        } else {
            errorMessage = message
        }
    }

    /// 用户在 sheet 中点「我同意，继续」— set confirmed + resubmit.
    public func acceptNonLocalAndRetry() async {
        guard let pending = pendingNonLocalQuestion else { return }
        acceptNonLocalConfirmed = true
        showAcceptNonLocalSheet = false
        pendingNonLocalQuestion = nil
        question = pending
        await submit()
    }

    public func dismissAcceptNonLocalSheet() {
        showAcceptNonLocalSheet = false
        pendingNonLocalQuestion = nil
        // acceptNonLocalConfirmed stays false — user did NOT consent
    }

    // MARK: - Citation chip flow

    public func openCitation(eventId: String) async {
        guard !eventId.isEmpty else { return }
        activeCitationLoading = true
        activeCitationDetail = nil
        defer { activeCitationLoading = false }
        do {
            let detail = try await commands.eventDetail(
                pcPeerId: pcPeerId,
                eventId: eventId,
                mobileDid: currentDIDProvider()
            )
            activeCitationDetail = detail
        } catch {
            errorMessage = "无法加载事件详情：\((error as NSError).localizedDescription)"
        }
    }

    public func closeCitation() {
        activeCitationDetail = nil
        activeCitationLoading = false
    }

    // MARK: - Misc

    public func clear() {
        question = ""
        answer = nil
        citations = []
        errorMessage = nil
    }

    public func refreshHealth() async {
        do {
            health = try await commands.health(
                pcPeerId: pcPeerId, mobileDid: currentDIDProvider()
            )
        } catch {
            // health failure 不弹 errorMessage（顶部卡片自己显 "?"），仅 log
            // 故意 swallow — kg/rag/llm 单项失败不阻拦提问流
        }
    }
}

// MARK: - HubAdaptersViewModel

/// Hub Adapter 管理页 VM — Phase 14.2.3 + 14.3.2 streaming integration.
///
/// 镜像 Android `HubAdaptersViewModel`：list / sync / syncStream 三入口 +
/// `HubSyncEventDispatcher` 进度订阅。dispatcher.progress[adapter] 直接绑 UI
/// 显进度文字；done 后 dispatcher 写 completedReports[adapter]，VM 通过 sink
/// 把它 mirror 到 `lastReport` 字段（保留 Android 兼容字段名）。
@MainActor
public final class HubAdaptersViewModel: ObservableObject {

    // MARK: - Published state

    @Published public private(set) var adapters: [HubAdapterMeta] = []
    @Published public private(set) var isLoading: Bool = false
    @Published public private(set) var syncingAdapter: String?
    @Published public private(set) var errorMessage: String?
    @Published public private(set) var lastReport: HubSyncReport?

    /// dispatcher.progress 镜像 — 每次 dispatcher 更新由 sink 同步过来。
    @Published public private(set) var progress: [String: HubSyncEvent] = [:]
    @Published public private(set) var completedReports: [String: HubSyncReport] = [:]
    @Published public private(set) var adapterErrors: [String: String] = [:]

    // MARK: - Deps

    public let pcPeerId: String
    private let commands: PersonalDataHubCommands
    private let dispatcher: HubSyncEventDispatcher
    private let currentDIDProvider: () -> String?

    private var subscriptions = Set<AnyCancellable>()

    public init(
        pcPeerId: String,
        commands: PersonalDataHubCommands,
        dispatcher: HubSyncEventDispatcher,
        currentDIDProvider: @escaping () -> String? = { nil }
    ) {
        self.pcPeerId = pcPeerId
        self.commands = commands
        self.dispatcher = dispatcher
        self.currentDIDProvider = currentDIDProvider

        // mirror dispatcher.progress → self.progress (SwiftUI 直接绑 self)
        dispatcher.$progress.sink { [weak self] new in
            self?.progress = new
        }.store(in: &subscriptions)

        dispatcher.$completedReports.sink { [weak self] new in
            self?.completedReports = new
            // 清 syncingAdapter 如果 done 事件刚到（adapter 不在 progress 字典里）
            // syncingAdapter 仅对当前用户触发的那一次同步有效
            if let adapter = self?.syncingAdapter,
               new[adapter] != nil,
               self?.progress[adapter] == nil {
                self?.syncingAdapter = nil
                self?.lastReport = new[adapter]
            }
        }.store(in: &subscriptions)

        dispatcher.$errors.sink { [weak self] new in
            self?.adapterErrors = new
            if let adapter = self?.syncingAdapter, let msg = new[adapter] {
                self?.syncingAdapter = nil
                self?.errorMessage = msg
            }
        }.store(in: &subscriptions)

        Task { await self.reload() }
    }

    // MARK: - List

    public func reload() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            let resp = try await commands.listAdapters(
                pcPeerId: pcPeerId, mobileDid: currentDIDProvider()
            )
            adapters = resp.adapters
        } catch {
            errorMessage = "无法加载 Adapter 列表：\((error as NSError).localizedDescription)"
        }
    }

    // MARK: - Sync (non-stream)

    /// v0.1 非流式 — 一次性 await SyncReport，期间无中间进度。
    public func sync(name: String) async {
        guard !name.isEmpty else { return }
        syncingAdapter = name
        errorMessage = nil
        defer {
            if syncingAdapter == name { syncingAdapter = nil }
        }
        do {
            let report = try await commands.syncAdapter(
                pcPeerId: pcPeerId, name: name, options: nil,
                mobileDid: currentDIDProvider()
            )
            lastReport = report
        } catch {
            errorMessage = "同步失败：\((error as NSError).localizedDescription)"
        }
    }

    // MARK: - SyncStream (Phase 14.3)

    /// Phase 14.3 流式 — 触发桌面 syncAdapterStream + 让 dispatcher 推进度事件。
    /// 状态由 dispatcher.$progress sink mirror 到本 VM；done/error 终态由
    /// dispatcher.$completedReports / $errors sink 处理。
    public func syncStream(name: String) async {
        guard !name.isEmpty else { return }
        dispatcher.resetForNewSync(adapter: name)
        syncingAdapter = name
        errorMessage = nil

        do {
            _ = try await commands.syncAdapterStream(
                pcPeerId: pcPeerId, name: name, options: nil,
                mobileDid: currentDIDProvider()
            )
            // streamId/name 返回但 VM 不存 — dispatcher progress 字典就是 SoT
        } catch {
            syncingAdapter = nil
            errorMessage = "启动同步失败：\((error as NSError).localizedDescription)"
        }
    }
}

// MARK: - HubAuditViewModel

/// Hub 审计回查页 VM — Phase 14.2.4 mirror Android `HubAuditViewModel`.
///
/// 简单 list with filter — 只读，无 mutating。
///
/// Phase 14.3.3.b — 加入 eventId 深链：每行的 eventId 可点 → invoke
/// `commands.eventDetail` → bottom sheet 显事件元数据。复用 HubAskViewModel
/// 同款 (activeCitationDetail) 模式，沿用 Android 设计 §7 T12 race 保护：
/// 用户连点 2 个 eventId 时第 1 个的 RPC 回响不能覆盖第 2 个的状态。
@MainActor
public final class HubAuditViewModel: ObservableObject {

    // MARK: - Published state

    @Published public private(set) var rows: [HubAuditRow] = []
    @Published public private(set) var isLoading: Bool = false
    @Published public private(set) var errorMessage: String?
    @Published public var actionFilter: String?  // nil = 全部
    @Published public var limit: Int = 50

    // Phase 14.3.3.b — eventId deep-link state (mirror Android HubAuditViewModel).
    @Published public private(set) var activeEventId: String?
    @Published public private(set) var activeEventDetail: HubEventDetailResponse?
    @Published public private(set) var isEventDetailLoading: Bool = false
    @Published public private(set) var eventDetailError: String?

    /// Stale-response guard (per design §7 T12). Monotonically increasing
    /// per `openEventDetail` call; only the last-issued requestId may
    /// commit results back into Published state. Otherwise a slow first
    /// RPC reply could overwrite the user's second tap.
    private var currentDetailRequestId: Int64 = 0

    // MARK: - Deps

    public let pcPeerId: String
    private let commands: PersonalDataHubCommands
    private let currentDIDProvider: () -> String?

    public init(
        pcPeerId: String,
        commands: PersonalDataHubCommands,
        currentDIDProvider: @escaping () -> String? = { nil }
    ) {
        self.pcPeerId = pcPeerId
        self.commands = commands
        self.currentDIDProvider = currentDIDProvider
        Task { await self.reload() }
    }

    public func setActionFilter(_ action: String?) async {
        actionFilter = action
        await reload()
    }

    public func reload() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            let resp = try await commands.recentAudit(
                pcPeerId: pcPeerId,
                since: nil,
                action: actionFilter,
                limit: limit,
                mobileDid: currentDIDProvider()
            )
            rows = resp.rows
        } catch {
            errorMessage = "无法加载审计：\((error as NSError).localizedDescription)"
        }
    }

    // MARK: - Phase 14.3.3.b — eventId deep-link

    /// 点击 audit row 的 eventId 触发详情拉取。
    ///
    /// - 立即把 sheet 打开（spinner 状态）；
    /// - 异步 invoke `commands.eventDetail`；
    /// - 通过 requestId 校验防止旧 RPC 回响覆盖新点击 (race per design §7 T12)。
    public func openEventDetail(eventId: String) async {
        guard !eventId.isEmpty else { return }
        currentDetailRequestId &+= 1
        let myRequestId = currentDetailRequestId

        activeEventId = eventId
        activeEventDetail = nil
        isEventDetailLoading = true
        eventDetailError = nil

        do {
            let detail = try await commands.eventDetail(
                pcPeerId: pcPeerId,
                eventId: eventId,
                mobileDid: currentDIDProvider()
            )
            // race guard: 若用户已点了下一行 eventId 此 RPC 回响要丢弃
            guard myRequestId == currentDetailRequestId else { return }
            activeEventDetail = detail
            isEventDetailLoading = false
        } catch {
            guard myRequestId == currentDetailRequestId else { return }
            eventDetailError = (error as NSError).localizedDescription
            isEventDetailLoading = false
        }
    }

    /// 用户 dismiss sheet → 清状态。新一次 openEventDetail 会再写 requestId。
    public func closeEventDetail() {
        activeEventId = nil
        activeEventDetail = nil
        isEventDetailLoading = false
        eventDetailError = nil
    }
}

import Foundation

/// 系统信息 SwiftUI ViewModel — Phase 3.5 (OQ-3: 5s polling 间隔)。
///
/// **行为**：
/// - `onAppear` 立刻拉一次 + 起 polling timer
/// - `onDisappear` 停 polling
/// - 每 5s tick 触发新一次 invoke；新 tick 到时若上一次 pending 未完则 cancel 它
///   （避免堆积 stale invoke）
/// - `refresh()` 手动触发（用户 tap 刷新按钮）
@MainActor
public final class SystemInfoViewModel: ObservableObject {

    @Published public private(set) var info: SystemInfo?
    @Published public private(set) var lastUpdated: Date?
    @Published public private(set) var busy: Bool = false
    @Published public private(set) var lastError: String?

    public let pcPeerId: String
    public let pollingIntervalSeconds: TimeInterval

    private let systemInfo: SystemInfoCommands
    private let currentDIDProvider: () -> String?

    private var pollingTask: Task<Void, Never>?
    private var inflightTask: Task<Void, Never>?

    public init(
        pcPeerId: String,
        systemInfo: SystemInfoCommands,
        currentDIDProvider: @escaping () -> String?,
        pollingIntervalSeconds: TimeInterval = 5
    ) {
        self.pcPeerId = pcPeerId
        self.systemInfo = systemInfo
        self.currentDIDProvider = currentDIDProvider
        self.pollingIntervalSeconds = pollingIntervalSeconds
    }

    deinit {
        pollingTask?.cancel()
        inflightTask?.cancel()
    }

    /// View onAppear 调一次。立刻拉 + 起 polling。idempotent。
    public func onAppear() {
        guard pollingTask == nil else { return }
        Task { await fetch() }
        startPolling()
    }

    /// View onDisappear 调一次。停 polling + cancel inflight。
    public func onDisappear() {
        stopPolling()
        inflightTask?.cancel()
        inflightTask = nil
    }

    /// 手动触发刷新（用户 tap 刷新按钮）。
    public func refresh() async {
        await fetch()
    }

    public func clearError() {
        lastError = nil
    }

    // MARK: - Private

    private func startPolling() {
        let interval = pollingIntervalSeconds
        pollingTask = Task { [weak self] in
            while !Task.isCancelled {
                do {
                    try await Task.sleep(nanoseconds: UInt64(interval * 1_000_000_000))
                } catch { return }  // task cancelled
                guard let self = self else { return }
                await self.fetch()
            }
        }
    }

    private func stopPolling() {
        pollingTask?.cancel()
        pollingTask = nil
    }

    /// 拉一次 system.info。新 tick 到时若上一次 pending 未完则 cancel。
    private func fetch() async {
        // cancel 上一次（如果 pending）
        inflightTask?.cancel()

        let task = Task { @MainActor [weak self] in
            guard let self = self else { return }
            self.busy = true
            defer { self.busy = false }
            do {
                let result = try await self.systemInfo.info(
                    pcPeerId: self.pcPeerId,
                    mobileDid: self.currentDIDProvider()
                )
                if Task.isCancelled { return }
                self.info = result
                self.lastUpdated = Date()
                self.lastError = nil
            } catch {
                if Task.isCancelled { return }
                self.lastError = self.formatError(error)
            }
        }
        inflightTask = task
        await task.value
    }

    private func formatError(_ error: Error) -> String {
        switch error {
        case RemoteSkillError.remoteError(_, let msg):
            return "桌面端错误：\(msg)"
        case RemoteSkillError.malformedResult(let detail):
            return "响应解析失败：\(detail)"
        default:
            return (error as NSError).localizedDescription
        }
    }
}

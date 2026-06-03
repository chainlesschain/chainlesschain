import Foundation

/// 剪贴板 SwiftUI ViewModel — Phase 3.3 (OQ-1 决策：CoreP2P placement)。
///
/// 镜像 Android `feature-clipboard` ViewModel pattern。@MainActor + @Published
/// 状态供 SwiftUI 直接订阅。
///
/// **行为**：
/// - `copyFromDesktop()` → `ClipboardCommands.get` → 把内容塞 iOS UIPasteboard
///   （或仅暴露给 UI 显示让用户手动复制）
/// - `pasteToDesktop(content:)` → `ClipboardCommands.set` 把字符串写桌面剪贴板
/// - `busy` 标记 invoke 进行中，UI 可 disable 按钮
/// - `lastError` 暴露最近一次错误文案
@MainActor
public final class ClipboardViewModel: ObservableObject {

    @Published public private(set) var lastFetchedContent: ClipboardContent?
    @Published public private(set) var busy: Bool = false
    @Published public private(set) var lastError: String?
    @Published public private(set) var lastSentBytes: Int?

    public let pcPeerId: String

    private let clipboard: ClipboardCommands
    private let currentDIDProvider: () -> String?

    public init(
        pcPeerId: String,
        clipboard: ClipboardCommands,
        currentDIDProvider: @escaping () -> String?
    ) {
        self.pcPeerId = pcPeerId
        self.clipboard = clipboard
        self.currentDIDProvider = currentDIDProvider
    }

    /// 拉桌面剪贴板内容 → 更新 [lastFetchedContent]。
    /// UI 拿到后自行决定是否回写 iOS UIPasteboard（在 View 层做，避免 CoreP2P 依赖 UIKit）。
    public func copyFromDesktop() async {
        busy = true
        defer { busy = false }
        do {
            let content = try await clipboard.get(
                pcPeerId: pcPeerId,
                type: .text,
                mobileDid: currentDIDProvider()
            )
            lastFetchedContent = content
            lastError = nil
        } catch {
            lastError = formatError(error)
        }
    }

    /// 把字符串发到桌面剪贴板。
    public func pasteToDesktop(content: String) async {
        guard !content.isEmpty else {
            lastError = "内容为空，请输入要发送的文字"
            return
        }
        busy = true
        defer { busy = false }
        do {
            let resp = try await clipboard.set(
                pcPeerId: pcPeerId,
                content: content,
                type: .text,
                mobileDid: currentDIDProvider()
            )
            if resp.ok {
                lastError = nil
                lastSentBytes = resp.bytesWritten ?? content.count
            } else {
                lastError = "桌面端返回 ok=false，未成功写入"
            }
        } catch {
            lastError = formatError(error)
        }
    }

    public func clearError() {
        lastError = nil
    }

    public func clearFetched() {
        lastFetchedContent = nil
    }

    private func formatError(_ error: Error) -> String {
        switch error {
        case RemoteSkillError.transportFailed(let msg):
            return "通信失败：\(msg)（DC + 中继都失败，命令可能已进离线队列）"
        case RemoteSkillError.remoteError(_, let msg):
            return "桌面端错误：\(msg)"
        case RemoteSkillError.malformedResult(let detail):
            return "响应解析失败：\(detail)"
        case RemoteSkillError.invalidArgument(let detail):
            return "参数错误：\(detail)"
        default:
            return (error as NSError).localizedDescription
        }
    }
}

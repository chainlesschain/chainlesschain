import SwiftUI
import CoreP2P

/// 远程操控主屏 — Phase 3.3 → Phase 4.5 加第 6 tab "通知" → Phase 5.5 加第 7 tab "AI"。
///
/// **7 tab horizontal-scroll shell** (Phase 4.5 起从 5-tab segmented 升级):
/// - Terminal (Phase 2 ✓) — 嵌入既有 TerminalListView
/// - Clipboard (Phase 3.3 ✓)
/// - File (Phase 3.4 ✓)
/// - Screenshot (Phase 3.5 ✓)
/// - System (Phase 3.5 ✓)
/// - Notification (Phase 4.5 ✓) — 桌面 push 收件箱 + 历史 + 设置
/// - **AI (Phase 5.5 ✓ NEW)** — 远程 LLM 对话 + 流式响应 + 对话管理
///
/// **入口**：Settings → 桌面配对 → 已配对桌面 → 单击桌面行 → **本屏**。
/// 用户感知零损失（Terminal tab 默认选中，与 Phase 2 直接进 TerminalListView UX 等价）。
///
/// **Phase 4.5 picker 改造** (per Phase 4 design §7.9 备选 B):
/// 5 tab 是 iOS HIG SegmentedPicker 软上限; 6 tab 视觉拥挤 + segmented 无原生
/// badge → 切到 horizontal ScrollView + button row + 自定义未读 badge overlay
/// (与 Discord/Slack 移动端 pattern 一致)。Phase 5.5 加第 7 tab 视觉 0 改造
/// （picker `.allCases` 自动 pick）。
struct RemoteOperateView: View {
    let pcPeerId: String
    let deviceName: String

    @EnvironmentObject var remoteDeps: RemoteDependencies
    @EnvironmentObject var pairingDeps: PairingDependencies

    @State private var selectedTab: SkillTab = .terminal

    public enum SkillTab: String, CaseIterable, Identifiable {
        case terminal
        case clipboard
        case file
        case screenshot
        case system
        case notification
        case aiChat

        public var id: String { rawValue }

        var label: String {
            switch self {
            case .terminal:     return "终端"
            case .clipboard:    return "剪贴板"
            case .file:         return "文件"
            case .screenshot:   return "截屏"
            case .system:       return "系统"
            case .notification: return "通知"
            case .aiChat:       return "AI"
            }
        }

        var icon: String {
            switch self {
            case .terminal:     return "terminal"
            case .clipboard:    return "doc.on.clipboard"
            case .file:         return "folder"
            case .screenshot:   return "camera"
            case .system:       return "cpu"
            case .notification: return "bell"
            case .aiChat:       return "brain.head.profile"
            }
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            SkillTabPickerView(
                selected: $selectedTab,
                dispatcher: remoteDeps.notificationDispatcher
            )
            .background(Color(.systemBackground))

            Divider()

            Group {
                switch selectedTab {
                case .terminal:
                    TerminalListView(pcPeerId: pcPeerId, deviceName: deviceName)
                case .clipboard:
                    ClipboardView(pcPeerId: pcPeerId)
                case .file:
                    FileBrowserView(pcPeerId: pcPeerId)
                case .screenshot:
                    ScreenshotView(pcPeerId: pcPeerId)
                case .system:
                    SystemInfoView(pcPeerId: pcPeerId)
                case .notification:
                    NotificationsView(pcPeerId: pcPeerId)
                case .aiChat:
                    RemoteAIChatView(pcPeerId: pcPeerId)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .navigationTitle(deviceName)
        .navigationBarTitleDisplayMode(.inline)
        .onChange(of: selectedTab) { newValue in
            // 用户进 通知 tab 时清 dispatcher unread 累计 (badge 立即消失;
            // 真实未读由 NotificationsView.task → loadHistory → server SoT 决定)
            if newValue == .notification {
                remoteDeps.notificationDispatcher.resetUnreadCount()
            }
        }
    }
}

// Phase 3.5: 5 个 tab 全部接通真 skill view，删除原 SkillStubView 占位
// Phase 4.5: 加第 6 tab Notification 接通 NotificationsView。
// Phase 5.5: 加第 7 tab "AI" 接通 AIChatView (远程 LLM 对话 + 流式响应 + 对话管理)。

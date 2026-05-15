import SwiftUI
import CoreP2P

/// 远程操控主屏 — Phase 3.3 (替换 Phase 2 直接进 TerminalListView 的入口)。
///
/// **5 tab segmented shell**：
/// - Terminal (Phase 2 ✓) — 嵌入既有 TerminalListView
/// - Clipboard (Phase 3.3 ✓) — 真接通
/// - File (Phase 3.4 待实) — 占位
/// - Screenshot (Phase 3.5 待实) — 占位
/// - System (Phase 3.5 待实) — 占位
///
/// **入口**：Settings → 桌面配对 → 已配对桌面 → 单击桌面行 → **本屏**。
/// 用户感知零损失（Terminal tab 默认选中，与 Phase 2 直接进 TerminalListView UX 等价）。
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

        public var id: String { rawValue }

        var label: String {
            switch self {
            case .terminal:    return "终端"
            case .clipboard:   return "剪贴板"
            case .file:        return "文件"
            case .screenshot:  return "截屏"
            case .system:      return "系统"
            }
        }

        var icon: String {
            switch self {
            case .terminal:    return "terminal"
            case .clipboard:   return "doc.on.clipboard"
            case .file:        return "folder"
            case .screenshot:  return "camera"
            case .system:      return "cpu"
            }
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            SkillTabPickerView(selected: $selectedTab)
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
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .navigationTitle(deviceName)
        .navigationBarTitleDisplayMode(.inline)
    }
}

// Phase 3.5: 5 个 tab 全部接通真 skill view，删除原 SkillStubView 占位
// （Phase 3.3 时引入用作 file/screenshot/system 占位；Phase 3.4 替换 file，
// Phase 3.5 替换 screenshot+system，无 caller 留存）。

import SwiftUI

/// 桌面配对主屏 — 3 tab 容器（对应 Android 端 Settings → 移动桥 3-tab UX）。
///
/// **布局优先参考已真机验证的 Android 端**（memory `feedback_ios_ui_mirrors_validated_android.md`）：
/// 桌面 web-panel `packages/web-panel/src/views/MobileBridge.vue` 3-tab 布局
/// + Android Settings 入口。tab 顺序 (扫描/显示/手输) 与 Android 一致；右
/// 上角入口去已配对列表。
///
/// 注意：本 View 由 `SettingsView` 的 NavigationLink 推入，**不要**自己再包
/// `NavigationView`（嵌套会让 navigationTitle 显示异常）。
struct PairingHomeView: View {
    @EnvironmentObject var deps: PairingDependencies
    @State private var selectedTab: Tab = .scan

    enum Tab: Int, CaseIterable, Identifiable {
        case scan = 0
        case display = 1
        case manual = 2

        var id: Int { rawValue }
        var label: String {
            switch self {
            case .scan: return "扫描桌面"
            case .display: return "显示我的"
            case .manual: return "手动输入"
            }
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            Picker("配对方式", selection: $selectedTab) {
                ForEach(Tab.allCases) { tab in
                    Text(tab.label).tag(tab)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal)
            .padding(.top, 12)
            .padding(.bottom, 8)

            Group {
                switch selectedTab {
                case .scan:
                    ScanDesktopPairingView()
                case .display:
                    DesktopPairingView()
                case .manual:
                    ManualPairingView()
                }
            }

            Spacer(minLength: 0)
        }
        .navigationTitle("桌面配对")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                NavigationLink {
                    PairedDevicesListView()
                } label: {
                    Image(systemName: "list.bullet")
                }
            }
        }
    }
}

#Preview {
    NavigationView {
        PairingHomeView()
            .environmentObject(PairingDependencies())
    }
}

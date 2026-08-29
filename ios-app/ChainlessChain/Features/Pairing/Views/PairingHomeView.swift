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
    @State private var remoteSessionURI = ""

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

            Divider()
            remoteSessionRecoveryPanel
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
    private var remoteSessionRecoveryPanel: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Encrypted Remote Session").font(.headline)
            TextField("chainlesschain://remote-session/pair#...", text: $remoteSessionURI)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .textFieldStyle(.roundedBorder)
                .accessibilityLabel("Remote Session pairing link")
            HStack {
                Button("Connect") {
                    _ = deps.connectRemoteSession(uri: remoteSessionURI)
                }
                .disabled(remoteSessionURI.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                if deps.remoteSessionStatus == .reconnecting || deps.remoteSessionStatus == .error {
                    Button("Retry exact session") { _ = deps.resumeRemoteSession() }
                        .accessibilityHint("Reconnects with the existing encrypted pairing identity")
                }
                if deps.remoteSessionStatus != .idle && deps.remoteSessionStatus != .disconnected {
                    Button("Disconnect", role: .destructive) {
                        deps.disconnectRemoteSession()
                    }
                }
            }
            Label(remoteSessionStatusText, systemImage: remoteSessionStatusIcon)
                .font(.footnote)
                .accessibilityIdentifier("remote-session-status")
            if let error = deps.remoteSessionError, !error.isEmpty {
                Text(error).font(.footnote).foregroundColor(.secondary)
            }
            ForEach(deps.remoteSessionApprovals) { card in
                VStack(alignment: .leading, spacing: 6) {
                    Text(card.tool ?? "Approval request").font(.subheadline.bold())
                    if let detail = card.detail, !detail.isEmpty {
                        Text(detail).font(.footnote)
                    }
                    ForEach(card.requestedPermissionDescriptions, id: \.self) { permission in
                        Text(permission).font(.caption.monospaced())
                    }
                    HStack {
                        Button("Allow once") {
                            _ = deps.resolveRemoteApproval(card, choice: .once)
                        }
                        Button("Decline", role: .destructive) {
                            _ = deps.resolveRemoteApproval(card, choice: .decline)
                        }
                    }
                    if !card.requestedPermissions.isEmpty {
                        HStack {
                            Button("Allow for turn") {
                                _ = deps.resolveRemoteApproval(card, choice: .turn)
                            }
                            Button("Allow for session") {
                                _ = deps.resolveRemoteApproval(card, choice: .session)
                            }
                        }
                    }
                }
                .padding(8)
                .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 8))
                .accessibilityIdentifier("remote-approval-\(card.requestId)")
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
    }

    private var remoteSessionStatusText: String {
        switch deps.remoteSessionStatus {
        case .idle: return "Not connected"
        case .connecting: return "Connecting"
        case .pairing: return "Verifying encrypted pairing"
        case .connected: return "Connected"
        case .reconnecting: return "Connection interrupted; retrying safely"
        case .disconnected: return "Disconnected"
        case .revoked: return "Access revoked by host"
        case .error: return "Automatic recovery stopped"
        }
    }

    private var remoteSessionStatusIcon: String {
        switch deps.remoteSessionStatus {
        case .connected: return "checkmark.shield.fill"
        case .connecting, .pairing, .reconnecting: return "arrow.triangle.2.circlepath"
        case .revoked, .error: return "exclamationmark.shield.fill"
        default: return "network.slash"
        }
    }
}

#Preview {
    NavigationView {
        PairingHomeView()
            .environmentObject(PairingDependencies())
    }
}

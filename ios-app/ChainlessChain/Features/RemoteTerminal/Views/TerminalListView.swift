import SwiftUI
import CoreP2P

/// 远程终端 session 列表屏 — Phase 2.4。
///
/// **布局优先参考已真机验证的 Android 端**（memory `feedback_ios_ui_mirrors_validated_android.md`）：
/// `android-app/app/src/main/java/.../remote/terminal/ui/TerminalListScreen.kt`
/// 顶部 status chip + List of sessions + create FAB。HIG 偏离：Compose
/// `FloatingActionButton` → SwiftUI `.toolbar` `+` button（更 iOS-native）。
///
/// **入口路径**：Settings → 桌面配对 → 已配对桌面 → 单击桌面行 → 本屏。
/// pcPeerId 通过 init 传入，决定连哪台桌面。
struct TerminalListView: View {
    let pcPeerId: String
    let deviceName: String

    @EnvironmentObject var remoteDeps: RemoteDependencies
    @EnvironmentObject var pairingDeps: PairingDependencies

    var body: some View {
        Inner(
            pcPeerId: pcPeerId,
            deviceName: deviceName,
            remoteDeps: remoteDeps,
            pairingDeps: pairingDeps
        )
    }
}

private struct Inner: View {
    let deviceName: String
    @StateObject private var vm: TerminalListViewModel
    @State private var showCreateSheet = false
    @State private var navigatingSession: CreatedSession?

    init(
        pcPeerId: String,
        deviceName: String,
        remoteDeps: RemoteDependencies,
        pairingDeps: PairingDependencies
    ) {
        self.deviceName = deviceName
        _vm = StateObject(wrappedValue: TerminalListViewModel(
            pcPeerId: pcPeerId,
            webRTCClient: remoteDeps.webRTCClient,
            terminalRpc: remoteDeps.terminalRpc,
            currentDIDProvider: pairingDeps.currentDIDProvider
        ))
    }

    var body: some View {
        Group {
            if vm.sessions.isEmpty && vm.handshakeState != .connecting {
                emptyState
            } else {
                List {
                    ForEach(vm.sessions) { session in
                        sessionRow(session)
                    }
                    .onDelete { idx in
                        Task { await deleteSessions(at: idx) }
                    }
                }
                .listStyle(.insetGrouped)
                .refreshable { await vm.refresh() }
            }
        }
        .navigationTitle(deviceName)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                DcStatusChipView(state: vm.handshakeState)
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                Button {
                    showCreateSheet = true
                } label: {
                    Image(systemName: "plus.circle.fill")
                }
            }
        }
        .task {
            await vm.onAppear()
        }
        .alert("错误", isPresented: errorBinding, presenting: vm.lastError) { _ in
            Button("确定", role: .cancel) {}
        } message: { msg in
            Text(msg)
        }
        .sheet(isPresented: $showCreateSheet) {
            CreateTerminalSheet { shell in
                showCreateSheet = false
                Task {
                    if let created = await vm.createSession(shell: shell) {
                        navigatingSession = created
                    }
                }
            }
        }
        // Phase 2.5 — NavigationLink 跳 TerminalSessionView
        // iOS 15 兼容：用 isActive Binding（NavigationStack 是 iOS 16+）
        .background(
            NavigationLink(
                isActive: navigationBinding,
                destination: {
                    if let session = navigatingSession {
                        TerminalSessionView(
                            pcPeerId: vm.pcPeerId,
                            sessionId: session.sessionId,
                            shell: session.shell
                        )
                    }
                },
                label: { EmptyView() }
            )
            .hidden()
        )
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "terminal")
                .font(.system(size: 50))
                .foregroundColor(.secondary)
            Text("暂无终端 session")
                .font(.headline)
            Text("点击右上角 ＋ 按钮创建新 session\n命令将走 P2P 直连或中继兜底")
                .font(.callout)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func sessionRow(_ session: SessionRow) -> some View {
        HStack(spacing: 12) {
            Image(systemName: session.alive ? "terminal.fill" : "terminal")
                .foregroundColor(session.alive ? .green : .secondary)
            VStack(alignment: .leading, spacing: 2) {
                Text(session.shell)
                    .font(.body).fontWeight(.medium)
                Text("id=\(session.id.prefix(8))…  seq=\(session.lastSeq)")
                    .font(.caption2)
                    .foregroundColor(.secondary)
                if let cwd = session.cwd {
                    Text(cwd)
                        .font(.caption2)
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }
            Spacer()
        }
        .padding(.vertical, 4)
    }

    private func deleteSessions(at offsets: IndexSet) async {
        for idx in offsets {
            await vm.closeSession(sessionId: vm.sessions[idx].id)
        }
    }

    private var errorBinding: Binding<Bool> {
        Binding(
            get: { vm.lastError != nil },
            set: { if !$0 { /* lastError clear handled by VM next refresh */ } }
        )
    }

    private var navigationBinding: Binding<Bool> {
        Binding(
            get: { navigatingSession != nil },
            set: { if !$0 { navigatingSession = nil } }
        )
    }
}

// MARK: - Create sheet

private struct CreateTerminalSheet: View {
    @State private var shell: String = "/bin/zsh"
    @Environment(\.dismiss) private var dismiss
    let onCreate: (String) -> Void

    var body: some View {
        NavigationView {
            Form {
                Section("Shell 路径") {
                    TextField("/bin/zsh", text: $shell)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled(true)
                        .font(.system(.body, design: .monospaced))
                }
                Section {
                    Button {
                        onCreate(shell)
                    } label: {
                        Label("创建 Session", systemImage: "play.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .disabled(shell.trimmingCharacters(in: .whitespaces).isEmpty)
                } footer: {
                    Text("常用: /bin/zsh (mac/linux) · /bin/bash · powershell.exe (Windows)")
                        .font(.caption2)
                }
            }
            .navigationTitle("新建终端")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("取消") { dismiss() }
                }
            }
        }
    }
}

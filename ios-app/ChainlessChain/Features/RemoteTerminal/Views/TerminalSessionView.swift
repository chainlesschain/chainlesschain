import SwiftUI
import CoreP2P

/// 单 session 终端屏 — Phase 2.5。
///
/// **布局优先参考已真机验证的 Android 端**（memory `feedback_ios_ui_mirrors_validated_android.md`）：
/// `android-app/app/src/main/java/.../remote/terminal/ui/TerminalSessionScreen.kt`
/// 顶部 status banner + xterm WebView 占满 + 软键盘工具栏（esc/tab/arrow）。
///
/// HIG 偏离白名单：Compose `Column + Box(weight=1f)` → SwiftUI `VStack` +
/// `Spacer/.frame(maxHeight: .infinity)`；Compose `BottomAppBar` softkey →
/// SwiftUI `ToolbarItemGroup(placement: .keyboard)` (iOS 15+ 原生)。
struct TerminalSessionView: View {
    let pcPeerId: String
    let sessionId: String
    let shell: String

    @EnvironmentObject var remoteDeps: RemoteDependencies
    @EnvironmentObject var pairingDeps: PairingDependencies

    var body: some View {
        Inner(
            pcPeerId: pcPeerId,
            sessionId: sessionId,
            shell: shell,
            remoteDeps: remoteDeps,
            pairingDeps: pairingDeps
        )
    }
}

private struct Inner: View {
    @StateObject private var vm: TerminalSessionViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var showCloseConfirm = false
    private let shell: String

    init(
        pcPeerId: String,
        sessionId: String,
        shell: String,
        remoteDeps: RemoteDependencies,
        pairingDeps: PairingDependencies
    ) {
        self.shell = shell
        _vm = StateObject(wrappedValue: TerminalSessionViewModel(
            pcPeerId: pcPeerId,
            sessionId: sessionId,
            shell: shell,
            terminalRpc: remoteDeps.terminalRpc,
            currentDIDProvider: pairingDeps.currentDIDProvider
        ))
    }

    var body: some View {
        VStack(spacing: 0) {
            if let err = vm.lastError {
                ErrorBanner(message: err)
            }
            TerminalWebView(
                onReady: { cols, rows in
                    Task { await vm.onReady(cols: cols, rows: rows) }
                },
                onResize: { cols, rows in
                    Task { await vm.onResize(cols: cols, rows: rows) }
                },
                onUserInput: { data in
                    Task { await vm.onStdin(data: data) }
                },
                pendingStdout: $vm.pendingStdout,
                pendingExit: $vm.pendingExit
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(red: 0x1e/255.0, green: 0x1e/255.0, blue: 0x1e/255.0))
        .navigationTitle(displayTitle)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button {
                    showCloseConfirm = true
                } label: {
                    Image(systemName: "xmark.circle.fill")
                }
            }
            ToolbarItemGroup(placement: .keyboard) {
                SoftKeyButton(label: "Esc",  data: "\u{001b}",      action: dispatchKey)
                SoftKeyButton(label: "Tab",  data: "\t",            action: dispatchKey)
                SoftKeyButton(label: "↑",    data: "\u{001b}[A",    action: dispatchKey)
                SoftKeyButton(label: "↓",    data: "\u{001b}[B",    action: dispatchKey)
                SoftKeyButton(label: "←",    data: "\u{001b}[D",    action: dispatchKey)
                SoftKeyButton(label: "→",    data: "\u{001b}[C",    action: dispatchKey)
                Spacer()
                SoftKeyButton(label: "Ctrl-C", data: "\u{0003}",    action: dispatchKey)
            }
        }
        .task {
            await vm.onAppear()
        }
        .alert("关闭终端", isPresented: $showCloseConfirm) {
            Button("关闭", role: .destructive) {
                Task {
                    await vm.close()
                    dismiss()
                }
            }
            Button("取消", role: .cancel) {}
        } message: {
            Text("将关闭桌面端 PTY session。已运行的进程会终止。")
        }
    }

    private var displayTitle: String {
        let suffix = shell.split(separator: "/").last.map(String.init) ?? shell
        if vm.hasExited {
            return "\(suffix) (已退出)"
        }
        return suffix
    }

    private func dispatchKey(_ data: String) {
        Task { await vm.onStdin(data: data) }
    }
}

// MARK: - Subviews

private struct ErrorBanner: View {
    let message: String
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundColor(.orange)
            Text(message)
                .font(.caption)
                .foregroundColor(.white)
                .lineLimit(2)
            Spacer()
        }
        .padding(8)
        .background(Color.red.opacity(0.6))
    }
}

private struct SoftKeyButton: View {
    let label: String
    let data: String
    let action: (String) -> Void
    var body: some View {
        Button(label) { action(data) }
            .font(.system(.caption, design: .monospaced).weight(.semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
    }
}

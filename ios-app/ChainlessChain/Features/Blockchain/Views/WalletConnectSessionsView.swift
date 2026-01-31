import SwiftUI

/// WalletConnectSessionsView - Active WalletConnect sessions management
/// Phase 2.0: DApp Browser
struct WalletConnectSessionsView: View {
    @StateObject private var wcManager = WalletConnectManager.shared
    @State private var showingPairSheet = false
    @State private var pairUri = ""
    @State private var showingDisconnectConfirmation = false
    @State private var sessionToDisconnect: WalletConnectSession?
    @State private var errorMessage: String?
    @State private var successMessage: String?

    private var activeSessions: [WalletConnectSession] {
        wcManager.getActiveSessions()
    }

    var body: some View {
        List {
            // Active Sessions Section
            if !activeSessions.isEmpty {
                Section("活跃连接") {
                    ForEach(activeSessions) { session in
                        SessionRow(session: session, onDisconnect: {
                            sessionToDisconnect = session
                            showingDisconnectConfirmation = true
                        })
                    }
                }
            }

            // Pair New DApp Section
            Section {
                Button(action: { showingPairSheet = true }) {
                    Label("连接新的 DApp", systemImage: "plus.circle.fill")
                        .font(.headline)
                        .foregroundColor(.blue)
                }
            }

            // Info Section
            Section("关于 WalletConnect") {
                VStack(alignment: .leading, spacing: 8) {
                    Text("WalletConnect 是一个开放协议,用于在钱包和 DApp 之间建立安全连接。")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    Text("扫描 DApp 的 QR 码或粘贴连接 URI 来建立连接。")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
        }
        .navigationTitle("WalletConnect")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $showingPairSheet) {
            PairDAppSheet(pairUri: $pairUri, onPair: {
                Task { await pairWithDApp() }
            })
        }
        .confirmationDialog("断开连接", isPresented: $showingDisconnectConfirmation, presenting: sessionToDisconnect) { session in
            Button("断开 \(session.dappName)", role: .destructive) {
                Task { await disconnectSession(session) }
            }
            Button("取消", role: .cancel) {}
        } message: { session in
            Text("确定要断开与 \(session.dappName) 的连接吗?")
        }
        .alert("错误", isPresented: .constant(errorMessage != nil)) {
            Button("确定") { errorMessage = nil }
        } message: {
            if let error = errorMessage {
                Text(error)
            }
        }
        .alert("成功", isPresented: .constant(successMessage != nil)) {
            Button("确定") { successMessage = nil }
        } message: {
            if let success = successMessage {
                Text(success)
            }
        }
    }

    // MARK: - Actions

    @MainActor
    private func pairWithDApp() async {
        guard !pairUri.isEmpty else {
            errorMessage = "请输入连接 URI"
            return
        }

        do {
            try await wcManager.pair(uri: pairUri)
            successMessage = "配对成功,等待 DApp 确认..."
            pairUri = ""
            showingPairSheet = false
        } catch {
            errorMessage = "配对失败: \(error.localizedDescription)"
        }
    }

    @MainActor
    private func disconnectSession(_ session: WalletConnectSession) async {
        do {
            try await wcManager.disconnectSession(sessionId: session.id)
            successMessage = "已断开连接"
        } catch {
            errorMessage = "断开失败: \(error.localizedDescription)"
        }
    }
}

// MARK: - Session Row

struct SessionRow: View {
    let session: WalletConnectSession
    let onDisconnect: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            // DApp Icon
            if let iconUrl = session.dappIconUrl, let url = URL(string: iconUrl) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .aspectRatio(contentMode: .fit)
                            .frame(width: 50, height: 50)
                            .cornerRadius(10)
                    default:
                        placeholderIcon
                    }
                }
            } else {
                placeholderIcon
            }

            // Session Info
            VStack(alignment: .leading, spacing: 4) {
                Text(session.dappName)
                    .font(.headline)

                Text(session.displayUrl)
                    .font(.caption)
                    .foregroundColor(.blue)

                HStack(spacing: 8) {
                    // Connected Account
                    if let account = session.mainAccount {
                        HStack(spacing: 4) {
                            Image(systemName: "person.fill")
                                .font(.caption2)
                            Text(shortAddress(account))
                                .font(.caption2)
                        }
                        .foregroundColor(.secondary)
                    }

                    // Chain Count
                    HStack(spacing: 4) {
                        Image(systemName: "link")
                            .font(.caption2)
                        Text("\(session.chainIds.count) 链")
                            .font(.caption2)
                    }
                    .foregroundColor(.secondary)
                }

                // Expiry
                Text("过期: \(session.expiryDate, style: .relative)")
                    .font(.caption2)
                    .foregroundColor(session.isExpired ? .red : .secondary)
            }

            Spacer()

            // Disconnect Button
            Button(action: onDisconnect) {
                Image(systemName: "xmark.circle.fill")
                    .foregroundColor(.red)
                    .font(.title3)
            }
            .buttonStyle(.plain)
        }
        .padding(.vertical, 4)
    }

    private var placeholderIcon: some View {
        Image(systemName: "link.circle.fill")
            .font(.largeTitle)
            .foregroundColor(.blue)
            .frame(width: 50, height: 50)
    }

    private func shortAddress(_ address: String) -> String {
        guard address.count > 10 else { return address }
        return "\(address.prefix(6))...\(address.suffix(4))"
    }
}

// MARK: - Pair DApp Sheet

struct PairDAppSheet: View {
    @Binding var pairUri: String
    let onPair: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationView {
            Form {
                Section("连接 URI") {
                    TextEditor(text: $pairUri)
                        .frame(height: 100)
                        .font(.system(.body, design: .monospaced))

                    Text("从 DApp 复制 WalletConnect URI 并粘贴到此处")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }

                Section {
                    Button(action: {
                        onPair()
                    }) {
                        Text("连接")
                            .fontWeight(.semibold)
                            .frame(maxWidth: .infinity)
                            .foregroundColor(.white)
                    }
                    .disabled(pairUri.isEmpty)
                    .listRowBackground(pairUri.isEmpty ? Color.gray : Color.blue)
                }

                Section {
                    Button("扫描 QR 码") {
                        // TODO: Implement QR scanner
                    }
                }
            }
            .navigationTitle("连接 DApp")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("取消") { dismiss() }
                }
            }
        }
    }
}

struct WalletConnectSessionsView_Previews: PreviewProvider {
    static var previews: some View {
        NavigationView {
            WalletConnectSessionsView()
        }
    }
}

import SwiftUI
import CoreImage.CIFilterBuiltins

/// P2P Chat View - Direct encrypted peer-to-peer messaging
struct P2PChatView: View {
    @StateObject private var viewModel = P2PViewModel()
    @State private var messageText = ""
    @State private var showingConnectionSheet = false
    @State private var showingQRScanner = false
    @State private var showingQRCode = false
    @State private var selectedPeer: P2PViewModel.PeerInfo?

    var body: some View {
        NavigationView {
            ZStack {
                if !viewModel.isInitialized {
                    initializationView
                } else if viewModel.connectedPeers.isEmpty {
                    emptyView
                } else {
                    chatView
                }
            }
            .navigationTitle("P2P 聊天")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Menu {
                        Button(action: { showingConnectionSheet = true }) {
                            Label("连接新设备", systemImage: "plus.circle")
                        }

                        Button(action: { showingQRCode = true }) {
                            Label("显示我的二维码", systemImage: "qrcode")
                        }

                        Button(action: { showingQRScanner = true }) {
                            Label("扫描二维码", systemImage: "qrcode.viewfinder")
                        }

                        Divider()

                        if let stats = viewModel.statistics {
                            Button(action: {}) {
                                Label("统计: \(stats.messageStats.messagesSent) 已发送", systemImage: "chart.bar")
                            }
                            .disabled(true)
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                }
            }
            .sheet(isPresented: $showingConnectionSheet) {
                ConnectionSheet(viewModel: viewModel)
            }
            .sheet(isPresented: $showingQRCode) {
                QRCodeView(viewModel: viewModel)
            }
            .alert("错误", isPresented: .constant(viewModel.errorMessage != nil)) {
                Button("确定") {
                    viewModel.clearError()
                }
            } message: {
                if let error = viewModel.errorMessage {
                    Text(error)
                }
            }
        }
        .task {
            await viewModel.initialize(signalingServerURL: "ws://localhost:9001")
        }
    }

    // MARK: - Initialization View

    private var initializationView: some View {
        VStack(spacing: 20) {
            ProgressView()
                .scaleEffect(1.5)

            Text("初始化 P2P 系统...")
                .font(.headline)
                .foregroundColor(.gray)

            Text("正在设置端到端加密")
                .font(.caption)
                .foregroundColor(.gray)
        }
    }

    // MARK: - Empty View

    private var emptyView: some View {
        VStack(spacing: 20) {
            Image(systemName: "lock.shield")
                .resizable()
                .frame(width: 80, height: 80)
                .foregroundColor(.blue)

            Text("安全的 P2P 聊天")
                .font(.title2)
                .fontWeight(.bold)

            Text("端到端加密，无需服务器存储")
                .font(.subheadline)
                .foregroundColor(.gray)
                .multilineTextAlignment(.center)
                .padding(.horizontal)

            VStack(spacing: 12) {
                Button(action: { showingConnectionSheet = true }) {
                    HStack {
                        Image(systemName: "plus.circle.fill")
                        Text("连接新设备")
                    }
                    .font(.headline)
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(Color.blue)
                    .cornerRadius(12)
                }

                Button(action: { showingQRCode = true }) {
                    HStack {
                        Image(systemName: "qrcode")
                        Text("显示我的二维码")
                    }
                    .font(.headline)
                    .foregroundColor(.blue)
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(Color.blue.opacity(0.1))
                    .cornerRadius(12)
                }

                Button(action: { showingQRScanner = true }) {
                    HStack {
                        Image(systemName: "qrcode.viewfinder")
                        Text("扫描二维码连接")
                    }
                    .font(.headline)
                    .foregroundColor(.blue)
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(Color.blue.opacity(0.1))
                    .cornerRadius(12)
                }
            }
            .padding(.horizontal)
        }
    }

    // MARK: - Chat View

    private var chatView: some View {
        VStack(spacing: 0) {
            // Peer list
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(viewModel.connectedPeers) { peer in
                        PeerButton(peer: peer, isSelected: selectedPeer?.id == peer.id) {
                            selectedPeer = peer
                            viewModel.selectPeer(peerId: peer.id)
                        }
                    }
                }
                .padding()
            }
            .background(Color(.systemGroupedBackground))

            Divider()

            // Messages
            if let peer = selectedPeer {
                ScrollView {
                    LazyVStack(spacing: 8) {
                        ForEach(viewModel.messages.filter { $0.peerId == peer.id }) { message in
                            MessageBubble(message: message)
                        }
                    }
                    .padding()
                }

                // Input
                HStack(spacing: 12) {
                    TextField("输入消息...", text: $messageText)
                        .textFieldStyle(.roundedBorder)
                        .submitLabel(.send)
                        .onSubmit {
                            sendMessage()
                        }

                    Button(action: sendMessage) {
                        Image(systemName: "paperplane.fill")
                            .foregroundColor(.white)
                            .padding(10)
                            .background(messageText.isEmpty ? Color.gray : Color.blue)
                            .clipShape(Circle())
                    }
                    .disabled(messageText.isEmpty)
                }
                .padding()
                .background(Color(.systemGroupedBackground))
            } else {
                Spacer()
                Text("选择一个设备开始聊天")
                    .foregroundColor(.gray)
                Spacer()
            }
        }
    }

    // MARK: - Actions

    private func sendMessage() {
        guard !messageText.isEmpty, let peer = selectedPeer else { return }

        Task {
            await viewModel.sendMessage(to: peer.id, content: messageText, type: .text)
            messageText = ""
        }
    }
}

// MARK: - Peer Button

struct PeerButton: View {
    let peer: P2PViewModel.PeerInfo
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 4) {
                ZStack(alignment: .topTrailing) {
                    Circle()
                        .fill(isSelected ? Color.blue : Color.gray.opacity(0.3))
                        .frame(width: 50, height: 50)
                        .overlay(
                            Text(String(peer.name.prefix(1)).uppercased())
                                .font(.title3)
                                .fontWeight(.bold)
                                .foregroundColor(isSelected ? .white : .gray)
                        )

                    // Status indicator
                    Circle()
                        .fill(statusColor)
                        .frame(width: 12, height: 12)
                        .overlay(
                            Circle()
                                .stroke(Color.white, lineWidth: 2)
                        )
                }

                Text(peer.name)
                    .font(.caption)
                    .foregroundColor(isSelected ? .blue : .primary)
                    .lineLimit(1)
            }
        }
    }

    private var statusColor: Color {
        switch peer.status {
        case .connected:
            return .green
        case .connecting:
            return .yellow
        case .disconnected:
            return .gray
        case .failed:
            return .red
        }
    }
}

// MARK: - Message Bubble

struct MessageBubble: View {
    let message: P2PViewModel.ChatMessage

    var body: some View {
        HStack {
            if message.isOutgoing {
                Spacer()
            }

            VStack(alignment: message.isOutgoing ? .trailing : .leading, spacing: 4) {
                Text(message.content)
                    .padding(12)
                    .background(message.isOutgoing ? Color.blue : Color(.systemGray5))
                    .foregroundColor(message.isOutgoing ? .white : .primary)
                    .cornerRadius(16)

                HStack(spacing: 4) {
                    Text(message.timestamp, style: .time)
                        .font(.caption2)
                        .foregroundColor(.gray)

                    if message.isOutgoing {
                        statusIcon
                    }
                }
            }

            if !message.isOutgoing {
                Spacer()
            }
        }
    }

    @ViewBuilder
    private var statusIcon: some View {
        switch message.status {
        case .sending:
            ProgressView()
                .scaleEffect(0.5)
        case .sent:
            Image(systemName: "checkmark")
                .font(.caption2)
                .foregroundColor(.gray)
        case .delivered:
            Image(systemName: "checkmark.circle.fill")
                .font(.caption2)
                .foregroundColor(.blue)
        case .failed:
            Image(systemName: "exclamationmark.circle.fill")
                .font(.caption2)
                .foregroundColor(.red)
        }
    }
}

// MARK: - Connection Sheet

struct ConnectionSheet: View {
    @ObservedObject var viewModel: P2PViewModel
    @Environment(\.dismiss) var dismiss

    @State private var peerId = ""
    @State private var peerName = ""
    @State private var preKeyBundleString = ""

    var body: some View {
        NavigationView {
            Form {
                Section("设备信息") {
                    TextField("设备 ID", text: $peerId)
                        .autocapitalization(.none)

                    TextField("设备名称", text: $peerName)
                }

                Section("Pre-Key Bundle (可选)") {
                    TextEditor(text: $preKeyBundleString)
                        .frame(height: 100)
                        .font(.caption)

                    Text("从对方设备获取 Pre-Key Bundle 或扫描二维码")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }

                Section {
                    Button("连接") {
                        Task {
                            let bundle = preKeyBundleString.isEmpty ? nil : viewModel.importPreKeyBundle(from: preKeyBundleString)
                            await viewModel.connectToPeer(peerId: peerId, peerName: peerName, preKeyBundle: bundle)
                            dismiss()
                        }
                    }
                    .disabled(peerId.isEmpty || peerName.isEmpty)
                }
            }
            .navigationTitle("连接新设备")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("取消") {
                        dismiss()
                    }
                }
            }
        }
    }
}

// MARK: - QR Code View

struct QRCodeView: View {
    @ObservedObject var viewModel: P2PViewModel
    @Environment(\.dismiss) var dismiss

    var body: some View {
        NavigationView {
            VStack(spacing: 20) {
                Text("扫描此二维码连接")
                    .font(.headline)

                if let qrCodeString = viewModel.sharePreKeyBundle(),
                   let qrImage = generateQRCode(from: qrCodeString) {
                    Image(uiImage: qrImage)
                        .interpolation(.none)
                        .resizable()
                        .frame(width: 300, height: 300)
                } else {
                    Rectangle()
                        .fill(Color.gray.opacity(0.3))
                        .frame(width: 300, height: 300)
                        .overlay(
                            Text("无法生成二维码")
                                .foregroundColor(.gray)
                        )
                }

                Text("对方扫描后即可建立加密连接")
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
            }
            .padding()
            .navigationTitle("我的二维码")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("完成") {
                        dismiss()
                    }
                }
            }
        }
    }

    private func generateQRCode(from string: String) -> UIImage? {
        let context = CIContext()
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(string.utf8)

        if let outputImage = filter.outputImage,
           let cgImage = context.createCGImage(outputImage, from: outputImage.extent) {
            return UIImage(cgImage: cgImage)
        }

        return nil
    }
}

#Preview {
    P2PChatView()
}

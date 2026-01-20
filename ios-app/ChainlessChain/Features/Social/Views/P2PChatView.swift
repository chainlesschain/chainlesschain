import SwiftUI
import CoreImage.CIFilterBuiltins

/// P2P Chat View - Direct encrypted peer-to-peer messaging
struct P2PChatView: View {
    @StateObject private var viewModel = P2PViewModel()
    @StateObject private var performanceManager = PerformanceManager.shared
    @Environment(\.colorScheme) var colorScheme

    @State private var messageText = ""
    @State private var showingConnectionSheet = false
    @State private var showingQRScanner = false
    @State private var showingQRCode = false
    @State private var selectedPeer: P2PViewModel.PeerInfo?
    @State private var isTyping = false
    @State private var typingTimer: Timer?
    @State private var peerIsTyping = false

    // Image picking
    @State private var showingImagePicker = false
    @State private var selectedImages: [UIImage] = []

    // Toast
    @State private var showToast = false
    @State private var toastMessage = ""
    @State private var toastType: ToastView.ToastType = .info

    // Connection status
    @State private var connectionStatus: ConnectionStatusBanner.ConnectionStatus = .disconnected

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

                // Connection status banner
                VStack {
                    ConnectionStatusBanner(status: connectionStatus)
                        .padding(.top, 8)
                    Spacer()
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

                        // Memory stats in debug
                        #if DEBUG
                        Divider()
                        Button(action: {}) {
                            Label("内存: \(performanceManager.memoryUsage.formattedApp)", systemImage: "memorychip")
                        }
                        .disabled(true)
                        #endif
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
            .sheet(isPresented: $showingImagePicker) {
                ImagePickerView(
                    selectedImages: $selectedImages,
                    isPresented: $showingImagePicker,
                    maxSelection: 9
                ) { images in
                    // Handle selected images
                    sendImages(images)
                }
            }
            .toast(isPresented: $showToast, message: toastMessage, type: toastType)
            .alert("错误", isPresented: .constant(viewModel.errorMessage != nil)) {
                Button("确定") {
                    viewModel.clearError()
                }
            } message: {
                if let error = viewModel.errorMessage {
                    Text(error)
                }
            }
            .onReceive(NotificationCenter.default.publisher(for: .peerTyping)) { notification in
                if let senderDid = notification.userInfo?["senderDid"] as? String,
                   senderDid == selectedPeer?.id {
                    withAnimation {
                        peerIsTyping = true
                    }
                    // Auto hide after 3 seconds
                    DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
                        withAnimation {
                            peerIsTyping = false
                        }
                    }
                }
            }
            .onReceive(NotificationCenter.default.publisher(for: .peerStoppedTyping)) { _ in
                withAnimation {
                    peerIsTyping = false
                }
            }
        }
        .task {
            performanceManager.startMonitoring()
            await viewModel.initialize(signalingServerURL: "ws://localhost:9001")
            connectionStatus = viewModel.isInitialized ? .connected : .disconnected
        }
        .onDisappear {
            performanceManager.stopMonitoring()
        }
    }

    private func sendImages(_ images: [UIImage]) {
        guard let peer = selectedPeer else { return }
        guard !images.isEmpty else { return }

        // Show sending toast
        showToast(message: "正在发送 \(images.count) 张图片...", type: .info)

        // Clear selected images
        selectedImages = []

        // Send images via P2P
        Task {
            await viewModel.sendImageMessages(to: peer.id, images: images)
            showToast(message: "图片发送完成", type: .success)
        }
    }

    private func showToast(message: String, type: ToastView.ToastType) {
        toastMessage = message
        toastType = type
        withAnimation {
            showToast = true
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
                            withAnimation(.easeInOut(duration: 0.2)) {
                                selectedPeer = peer
                            }
                            viewModel.selectPeer(peerId: peer.id)
                            UIImpactFeedbackGenerator(style: .light).impactOccurred()
                        }
                    }
                }
                .padding()
            }
            .background(Color(.systemGroupedBackground))

            Divider()

            // Messages
            if let peer = selectedPeer {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 8) {
                            ForEach(viewModel.messages.filter { $0.peerId == peer.id }) { message in
                                EnhancedMessageBubble(
                                    message: message,
                                    colorScheme: colorScheme,
                                    onRecall: { messageId in
                                        Task {
                                            await viewModel.recallMessage(messageId: messageId)
                                        }
                                    },
                                    onEdit: { messageId, newContent in
                                        Task {
                                            await viewModel.editMessage(messageId: messageId, newContent: newContent)
                                        }
                                    },
                                    onResend: { messageId in
                                        if let msg = viewModel.messages.first(where: { $0.id == messageId }) {
                                            Task {
                                                await viewModel.sendMessage(to: peer.id, content: msg.content, type: msg.type)
                                            }
                                        }
                                    }
                                )
                                .id(message.id)
                                .transition(.asymmetric(
                                    insertion: .scale.combined(with: .opacity),
                                    removal: .opacity
                                ))
                            }
                        }
                        .padding()
                    }
                    .onChange(of: viewModel.messages.count) { _ in
                        if let lastMessage = viewModel.messages.filter({ $0.peerId == peer.id }).last {
                            withAnimation(.easeOut(duration: 0.3)) {
                                proxy.scrollTo(lastMessage.id, anchor: .bottom)
                            }
                        }
                    }
                    .onAppear {
                        Task {
                            await viewModel.markConversationAsRead()
                        }
                    }
                }

                // Typing indicator
                if peerIsTyping {
                    HStack {
                        TypingIndicator()
                        Text("\(peer.name) 正在输入...")
                            .font(.caption)
                            .foregroundColor(.gray)
                        Spacer()
                    }
                    .padding(.horizontal)
                    .transition(.opacity.combined(with: .move(edge: .bottom)))
                }

                // Input bar
                inputBar(peer: peer)
            } else {
                Spacer()
                EmptyStateView(
                    icon: "person.2.circle",
                    title: "选择一个设备",
                    subtitle: "从上方列表中选择设备开始聊天"
                )
                Spacer()
            }
        }
    }

    // MARK: - Input Bar

    private func inputBar(peer: P2PViewModel.PeerInfo) -> some View {
        VStack(spacing: 0) {
            // Selected images preview
            if !selectedImages.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(Array(selectedImages.enumerated()), id: \.offset) { index, image in
                            ZStack(alignment: .topTrailing) {
                                Image(uiImage: image)
                                    .resizable()
                                    .scaledToFill()
                                    .frame(width: 60, height: 60)
                                    .clipShape(RoundedRectangle(cornerRadius: 8))

                                Button(action: {
                                    withAnimation {
                                        selectedImages.remove(at: index)
                                    }
                                }) {
                                    Image(systemName: "xmark.circle.fill")
                                        .foregroundColor(.white)
                                        .background(Color.black.opacity(0.5))
                                        .clipShape(Circle())
                                        .font(.caption)
                                }
                                .offset(x: 6, y: -6)
                            }
                        }
                    }
                    .padding(.horizontal)
                    .padding(.top, 8)
                }
            }

            HStack(spacing: 12) {
                // Image picker button
                Button(action: { showingImagePicker = true }) {
                    Image(systemName: "photo")
                        .foregroundColor(.blue)
                        .font(.title3)
                }

                // Text input
                TextField("输入消息...", text: $messageText)
                    .textFieldStyle(.roundedBorder)
                    .submitLabel(.send)
                    .onSubmit {
                        sendMessage()
                    }
                    .onChange(of: messageText) { newValue in
                        if !newValue.isEmpty {
                            viewModel.sendTypingIndicator(to: peer.id)
                            typingTimer?.invalidate()
                            typingTimer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: false) { _ in
                                Task { @MainActor in
                                    viewModel.sendStopTypingIndicator(to: peer.id)
                                }
                            }
                        }
                    }

                // Send button
                HapticButton(feedbackStyle: .medium) {
                    sendMessage()
                } content: {
                    Image(systemName: "paperplane.fill")
                        .foregroundColor(.white)
                        .padding(10)
                        .background(messageText.isEmpty && selectedImages.isEmpty ? Color.gray : Color.blue)
                        .clipShape(Circle())
                }
                .disabled(messageText.isEmpty && selectedImages.isEmpty)
            }
            .padding()
            .background(
                colorScheme == .dark
                    ? Color(.systemGray6)
                    : Color(.systemGroupedBackground)
            )
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

// MARK: - Enhanced Message Bubble

struct EnhancedMessageBubble: View {
    let message: P2PViewModel.ChatMessage
    let colorScheme: ColorScheme
    var onRecall: ((String) -> Void)?
    var onEdit: ((String, String) -> Void)?
    var onResend: ((String) -> Void)?
    var onImageTap: ((UIImage) -> Void)?

    @State private var showEditSheet = false
    @State private var editedContent = ""
    @State private var isPressed = false
    @State private var showFullScreenImage = false
    @State private var loadedImage: UIImage?

    var body: some View {
        HStack {
            if message.isOutgoing {
                Spacer(minLength: 60)
            }

            VStack(alignment: message.isOutgoing ? .trailing : .leading, spacing: 4) {
                // Message content
                messageContent
                    .scaleEffect(isPressed ? 0.98 : 1.0)
                    .animation(.easeInOut(duration: 0.1), value: isPressed)
                    .onLongPressGesture(minimumDuration: 0.5, pressing: { pressing in
                        withAnimation {
                            isPressed = pressing
                        }
                        if pressing {
                            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                        }
                    }) {}
                    .contextMenu {
                        contextMenuItems
                    }

                // Status row
                HStack(spacing: 4) {
                    if message.isEdited {
                        Text("已编辑")
                            .font(.caption2)
                            .foregroundColor(.gray)
                    }

                    Text(message.timestamp, style: .time)
                        .font(.caption2)
                        .foregroundColor(.gray)

                    if message.isOutgoing {
                        AnimatedMessageStatus(status: mapStatus(message.status))
                    }
                }
            }

            if !message.isOutgoing {
                Spacer(minLength: 60)
            }
        }
        .sheet(isPresented: $showEditSheet) {
            EditMessageSheet(
                content: editedContent,
                onSave: { newContent in
                    onEdit?(message.id, newContent)
                }
            )
        }
        .fullScreenCover(isPresented: $showFullScreenImage) {
            if let image = loadedImage {
                ImageViewerOverlay(image: image, isPresented: $showFullScreenImage)
            }
        }
    }

    @ViewBuilder
    private var messageContent: some View {
        if message.isRecalled {
            HStack(spacing: 6) {
                Image(systemName: "arrow.uturn.backward")
                    .font(.caption)
                Text("消息已撤回")
                    .font(.subheadline)
            }
            .foregroundColor(.gray)
            .padding(12)
            .background(Color(.systemGray6))
            .cornerRadius(16)
        } else if message.isImageMessage {
            // Image message
            ImageMessageView(
                message: message,
                isOutgoing: message.isOutgoing,
                onTap: { image in
                    loadedImage = image
                    showFullScreenImage = true
                }
            )
        } else {
            Text(message.content)
                .padding(12)
                .background(bubbleColor)
                .foregroundColor(textColor)
                .cornerRadius(16)
                .shadow(color: .black.opacity(0.05), radius: 2, x: 0, y: 1)
        }
    }

    private var bubbleColor: Color {
        AdaptiveColor.messageBubble(isOutgoing: message.isOutgoing, colorScheme: colorScheme)
    }

    private var textColor: Color {
        AdaptiveColor.textColor(isOutgoing: message.isOutgoing, colorScheme: colorScheme)
    }

    @ViewBuilder
    private var contextMenuItems: some View {
        if message.isImageMessage {
            // Image-specific actions
            if let image = message.getImage() {
                Button {
                    UIImageWriteToSavedPhotosAlbum(image, nil, nil, nil)
                    UINotificationFeedbackGenerator().notificationOccurred(.success)
                } label: {
                    Label("保存图片", systemImage: "square.and.arrow.down")
                }

                Button {
                    let activityVC = UIActivityViewController(
                        activityItems: [image],
                        applicationActivities: nil
                    )
                    if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
                       let window = windowScene.windows.first,
                       let rootVC = window.rootViewController {
                        rootVC.present(activityVC, animated: true)
                    }
                } label: {
                    Label("分享", systemImage: "square.and.arrow.up")
                }
            }
        } else {
            // Text message - Copy
            Button {
                UIPasteboard.general.string = message.content
                UINotificationFeedbackGenerator().notificationOccurred(.success)
            } label: {
                Label("复制", systemImage: "doc.on.doc")
            }

            if message.isOutgoing && !message.isRecalled {
                // Edit (text only)
                if canEdit {
                    Button {
                        editedContent = message.content
                        showEditSheet = true
                    } label: {
                        Label("编辑", systemImage: "pencil")
                    }
                }
            }
        }

        // Common actions
        if message.isOutgoing && !message.isRecalled {
            // Recall
            if canRecall {
                Button(role: .destructive) {
                    UIImpactFeedbackGenerator(style: .heavy).impactOccurred()
                    onRecall?(message.id)
                } label: {
                    Label("撤回", systemImage: "arrow.uturn.backward")
                }
            }
        }

        // Resend if failed
        if message.status == .failed {
            Button {
                onResend?(message.id)
            } label: {
                Label("重新发送", systemImage: "arrow.clockwise")
            }
        }
    }

    private func mapStatus(_ status: P2PViewModel.ChatMessage.MessageStatus) -> AnimatedMessageStatus.MessageStatusType {
        switch status {
        case .sending: return .sending
        case .sent: return .sent
        case .delivered: return .delivered
        case .read: return .read
        case .failed: return .failed
        case .recalled: return .sent
        case .edited: return .delivered
        }
    }

    private var canRecall: Bool {
        let recallTimeLimit: TimeInterval = 2 * 60
        return Date().timeIntervalSince(message.timestamp) <= recallTimeLimit
    }

    private var canEdit: Bool {
        let editTimeLimit: TimeInterval = 15 * 60
        return Date().timeIntervalSince(message.timestamp) <= editTimeLimit && message.editCount < 5
    }
}

// MARK: - Legacy Message Bubble (for compatibility)

struct MessageBubble: View {
    let message: P2PViewModel.ChatMessage
    var onRecall: ((String) -> Void)?
    var onEdit: ((String, String) -> Void)?
    var onResend: ((String) -> Void)?

    @Environment(\.colorScheme) var colorScheme

    var body: some View {
        EnhancedMessageBubble(
            message: message,
            colorScheme: colorScheme,
            onRecall: onRecall,
            onEdit: onEdit,
            onResend: onResend
        )
    }
}

// MARK: - Edit Message Sheet

struct EditMessageSheet: View {
    @State var content: String
    let onSave: (String) -> Void
    @Environment(\.dismiss) var dismiss

    var body: some View {
        NavigationView {
            VStack {
                TextEditor(text: $content)
                    .padding()
                    .background(Color(.systemGray6))
                    .cornerRadius(8)
                    .padding()

                Spacer()
            }
            .navigationTitle("编辑消息")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("取消") {
                        dismiss()
                    }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("保存") {
                        onSave(content)
                        dismiss()
                    }
                    .disabled(content.isEmpty)
                }
            }
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

// MARK: - Image Message View

struct ImageMessageView: View {
    let message: P2PViewModel.ChatMessage
    let isOutgoing: Bool
    var onTap: ((UIImage) -> Void)?

    @State private var image: UIImage?
    @State private var isLoading = true

    private let maxWidth: CGFloat = 220
    private let maxHeight: CGFloat = 280

    var body: some View {
        Group {
            if let displayImage = image {
                let aspectRatio = displayImage.size.width / displayImage.size.height
                let displaySize = calculateDisplaySize(aspectRatio: aspectRatio)

                Button {
                    UIImpactFeedbackGenerator(style: .light).impactOccurred()
                    onTap?(displayImage)
                } label: {
                    Image(uiImage: displayImage)
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                        .frame(width: displaySize.width, height: displaySize.height)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                        .overlay(
                            RoundedRectangle(cornerRadius: 12)
                                .stroke(Color.gray.opacity(0.2), lineWidth: 1)
                        )
                        .shadow(color: .black.opacity(0.1), radius: 4, x: 0, y: 2)
                }
                .buttonStyle(PlainButtonStyle())
            } else if isLoading {
                // Loading placeholder
                RoundedRectangle(cornerRadius: 12)
                    .fill(Color.gray.opacity(0.2))
                    .frame(width: maxWidth, height: 150)
                    .overlay(
                        ProgressView()
                            .scaleEffect(1.2)
                    )
            } else {
                // Failed to load
                RoundedRectangle(cornerRadius: 12)
                    .fill(Color.gray.opacity(0.2))
                    .frame(width: maxWidth, height: 100)
                    .overlay(
                        VStack(spacing: 8) {
                            Image(systemName: "photo.badge.exclamationmark")
                                .font(.title2)
                                .foregroundColor(.gray)
                            Text("图片加载失败")
                                .font(.caption)
                                .foregroundColor(.gray)
                        }
                    )
            }
        }
        .onAppear {
            loadImage()
        }
    }

    private func loadImage() {
        let cacheKey = "p2p_image_\(message.id)"

        Task {
            // Check cache first
            if let cachedImage = await ImageCacheManager.shared.getImage(forKey: cacheKey) {
                await MainActor.run {
                    self.image = cachedImage
                    self.isLoading = false
                }
                return
            }

            // Load from message data
            let loadedImage = await Task.detached(priority: .userInitiated) {
                return self.message.getImage()
            }.value

            await MainActor.run {
                self.image = loadedImage
                self.isLoading = false
            }

            // Cache the loaded image
            if let img = loadedImage {
                await ImageCacheManager.shared.storeImage(img, forKey: cacheKey)
            }
        }
    }

    private func calculateDisplaySize(aspectRatio: CGFloat) -> CGSize {
        if aspectRatio > 1 {
            // Landscape
            let width = min(maxWidth, maxWidth)
            let height = width / aspectRatio
            return CGSize(width: width, height: min(height, maxHeight))
        } else {
            // Portrait or square
            let height = min(maxHeight, maxHeight)
            let width = height * aspectRatio
            return CGSize(width: min(width, maxWidth), height: height)
        }
    }
}

// MARK: - Image Viewer Overlay

struct ImageViewerOverlay: View {
    let image: UIImage
    @Binding var isPresented: Bool

    @State private var scale: CGFloat = 1.0
    @State private var lastScale: CGFloat = 1.0
    @State private var offset: CGSize = .zero
    @State private var lastOffset: CGSize = .zero

    var body: some View {
        ZStack {
            Color.black.edgesIgnoringSafeArea(.all)

            Image(uiImage: image)
                .resizable()
                .aspectRatio(contentMode: .fit)
                .scaleEffect(scale)
                .offset(offset)
                .gesture(
                    MagnificationGesture()
                        .onChanged { value in
                            scale = lastScale * value
                        }
                        .onEnded { _ in
                            lastScale = scale
                            if scale < 1.0 {
                                withAnimation {
                                    scale = 1.0
                                    lastScale = 1.0
                                }
                            }
                        }
                )
                .gesture(
                    DragGesture()
                        .onChanged { value in
                            offset = CGSize(
                                width: lastOffset.width + value.translation.width,
                                height: lastOffset.height + value.translation.height
                            )
                        }
                        .onEnded { _ in
                            lastOffset = offset
                        }
                )
                .onTapGesture(count: 2) {
                    withAnimation {
                        if scale > 1.0 {
                            scale = 1.0
                            lastScale = 1.0
                            offset = .zero
                            lastOffset = .zero
                        } else {
                            scale = 2.0
                            lastScale = 2.0
                        }
                    }
                }

            // Close button
            VStack {
                HStack {
                    Spacer()
                    Button {
                        isPresented = false
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.title)
                            .foregroundColor(.white)
                            .padding()
                    }
                }
                Spacer()
            }

            // Bottom toolbar
            VStack {
                Spacer()
                HStack(spacing: 40) {
                    // Save button
                    Button {
                        saveImage()
                    } label: {
                        VStack(spacing: 4) {
                            Image(systemName: "square.and.arrow.down")
                                .font(.title2)
                            Text("保存")
                                .font(.caption)
                        }
                        .foregroundColor(.white)
                    }

                    // Share button
                    Button {
                        shareImage()
                    } label: {
                        VStack(spacing: 4) {
                            Image(systemName: "square.and.arrow.up")
                                .font(.title2)
                            Text("分享")
                                .font(.caption)
                        }
                        .foregroundColor(.white)
                    }
                }
                .padding(.bottom, 40)
            }
        }
        .onTapGesture {
            // Single tap to dismiss if not zoomed
            if scale <= 1.0 {
                isPresented = false
            }
        }
    }

    private func saveImage() {
        UIImageWriteToSavedPhotosAlbum(image, nil, nil, nil)
        UINotificationFeedbackGenerator().notificationOccurred(.success)
    }

    private func shareImage() {
        let activityVC = UIActivityViewController(
            activityItems: [image],
            applicationActivities: nil
        )

        if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
           let window = windowScene.windows.first,
           let rootVC = window.rootViewController {
            rootVC.present(activityVC, animated: true)
        }
    }
}

// MARK: - Multiple Images Grid View

struct MultipleImagesMessageView: View {
    let images: [UIImage]
    let isOutgoing: Bool
    var onImageTap: ((UIImage, Int) -> Void)?

    private let spacing: CGFloat = 2
    private let cornerRadius: CGFloat = 12

    var body: some View {
        let columns = calculateColumns()

        LazyVGrid(columns: columns, spacing: spacing) {
            ForEach(Array(images.enumerated()), id: \.offset) { index, image in
                Button {
                    onImageTap?(image, index)
                } label: {
                    Image(uiImage: image)
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                        .frame(width: cellSize, height: cellSize)
                        .clipped()
                }
                .buttonStyle(PlainButtonStyle())
            }
        }
        .frame(width: gridWidth)
        .clipShape(RoundedRectangle(cornerRadius: cornerRadius))
        .overlay(
            RoundedRectangle(cornerRadius: cornerRadius)
                .stroke(Color.gray.opacity(0.2), lineWidth: 1)
        )
    }

    private var gridWidth: CGFloat {
        switch images.count {
        case 1: return 200
        case 2...4: return 160
        default: return 180
        }
    }

    private var cellSize: CGFloat {
        let columnsCount = CGFloat(calculateColumnCount())
        return (gridWidth - spacing * (columnsCount - 1)) / columnsCount
    }

    private func calculateColumnCount() -> Int {
        switch images.count {
        case 1: return 1
        case 2: return 2
        case 3: return 3
        case 4: return 2
        default: return 3
        }
    }

    private func calculateColumns() -> [GridItem] {
        let count = calculateColumnCount()
        return Array(repeating: GridItem(.flexible(), spacing: spacing), count: count)
    }
}

#Preview {
    P2PChatView()
}

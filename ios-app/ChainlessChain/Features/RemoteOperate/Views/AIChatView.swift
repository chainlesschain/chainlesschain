import SwiftUI
import CoreP2P

/// 远程 AI chat skill 主 view — Phase 5.4。
///
/// **命名**：`RemoteAIChatView` 而非 `AIChatView`，避开既有
/// `Features/AI/Views/AIChatView.swift` 顶层 struct 同名冲突
/// （那是项目自有 AI chat，走 AIConversationEntity / MessageBubble；
/// 与本 view 走 RemoteAIChatViewModel + AIChatCommands 通过 P2P 远程
/// 桌面 LLM 是两套独立 stack — per Phase 5 design OQ-4 决议 A）。
///
/// **布局参考**（per Phase 5 design §6.4）：
/// Apple Messages / ChatGPT iOS 公开布局子集。顶部 toolbar 标题 + "更多" Menu
/// （新对话 / 历史对话 / 删除当前 / 复制全文）+ 中部 ScrollView 含 ChatBubble +
/// 底部 send box (TextField + send/cancel button) + sheet for ConversationListView。
///
/// HIG 偏离白名单 (per Phase 5 design):
/// - chat bubble 自定义（user 右蓝 / assistant 左灰 / system 居中）
/// - 长按 bubble 触发 .contextMenu 复制（per §7.9）
/// - send box 跟随键盘 inset 上推
/// - streaming 状态闪烁 cursor 提示
struct RemoteAIChatView: View {
    let pcPeerId: String

    @EnvironmentObject var remoteDeps: RemoteDependencies
    @EnvironmentObject var pairingDeps: PairingDependencies

    var body: some View {
        let webRTC = remoteDeps.webRTCClient
        return Inner(
            pcPeerId: pcPeerId,
            commands: remoteDeps.aiChat,
            dispatcher: remoteDeps.aiChatDispatcher,
            offlineQueue: remoteDeps.offlineQueue,
            isDataChannelReady: { await webRTC.currentState == .ready },
            currentDIDProvider: pairingDeps.currentDIDProvider
        )
    }
}

// MARK: - Inner View

private struct Inner: View {
    @StateObject private var vm: RemoteAIChatViewModel
    @State private var showConversationList = false
    @State private var showCreateAlert = false
    @State private var newConversationTitle = ""
    @State private var showDeleteConfirm = false
    @FocusState private var inputFocused: Bool

    init(
        pcPeerId: String,
        commands: AIChatCommands,
        dispatcher: AIChatEventDispatcher,
        offlineQueue: OfflineCommandQueue?,
        isDataChannelReady: @escaping @Sendable () async -> Bool,
        currentDIDProvider: @escaping () -> String?
    ) {
        _vm = StateObject(wrappedValue: RemoteAIChatViewModel(
            pcPeerId: pcPeerId,
            commands: commands,
            dispatcher: dispatcher,
            offlineQueue: offlineQueue,
            isDataChannelReady: isDataChannelReady,
            currentDIDProvider: currentDIDProvider
        ))
    }

    var body: some View {
        VStack(spacing: 0) {
            if let err = vm.lastError {
                errorBanner(err)
            }

            // Body
            if vm.currentConversation == nil && vm.conversations.isEmpty && vm.isLoading {
                loadingState
            } else if vm.currentConversation == nil {
                noConversationState
            } else if vm.messages.isEmpty && !vm.isStreamingMessage {
                emptyMessagesState
            } else {
                messagesScroll
            }

            sendBox
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle(vm.currentConversation?.title ?? "AI 对话")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                moreMenu
            }
        }
        .task {
            await vm.loadConversations()
        }
        .sheet(isPresented: $showConversationList) {
            ConversationListView(vm: vm) {
                showConversationList = false
            }
        }
        .alert("新建对话", isPresented: $showCreateAlert) {
            TextField("对话标题（可选）", text: $newConversationTitle)
            Button("创建") {
                let title = newConversationTitle.trimmingCharacters(in: .whitespacesAndNewlines)
                Task {
                    await vm.createConversation(title: title.isEmpty ? nil : title)
                    newConversationTitle = ""
                }
            }
            Button("取消", role: .cancel) {
                newConversationTitle = ""
            }
        }
        .alert("删除当前对话？", isPresented: $showDeleteConfirm) {
            Button("删除", role: .destructive) {
                if let id = vm.currentConversation?.id {
                    Task { await vm.deleteConversation(id: id) }
                }
            }
            Button("取消", role: .cancel) {}
        } message: {
            Text("将删除桌面端的该对话及全部消息，无法撤销。")
        }
    }

    // MARK: - States

    private var loadingState: some View {
        VStack(spacing: 12) {
            ProgressView()
            Text("加载中…")
                .font(.callout)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var noConversationState: some View {
        VStack(spacing: 12) {
            Image(systemName: "brain.head.profile")
                .font(.system(size: 50))
                .foregroundColor(.secondary)
            Text("暂无对话")
                .font(.headline)
            Text(vm.conversations.isEmpty
                 ? "点击右上角「+ 新对话」开始你的第一次 AI 对话"
                 : "从「历史对话」选一个，或点击右上角「+ 新对话」")
                .font(.callout)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            if !vm.conversations.isEmpty {
                Button {
                    showConversationList = true
                } label: {
                    Label("打开历史对话", systemImage: "list.bullet.rectangle")
                }
                .buttonStyle(.borderedProminent)
                .padding(.top, 8)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var emptyMessagesState: some View {
        VStack(spacing: 12) {
            Image(systemName: "bubble.left.and.bubble.right")
                .font(.system(size: 40))
                .foregroundColor(.secondary)
            Text("发条消息开始对话")
                .font(.callout)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var messagesScroll: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 10) {
                    ForEach(vm.messages) { msg in
                        ChatBubble(message: msg)
                            .id(msg.id)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 12)
            }
            .onChange(of: vm.messages.count) { _ in
                scrollToLast(proxy: proxy)
            }
            .onChange(of: vm.messages.last?.content) { _ in
                scrollToLast(proxy: proxy)
            }
            .refreshable {
                await vm.loadMessages()
            }
        }
    }

    private func scrollToLast(proxy: ScrollViewProxy) {
        guard let last = vm.messages.last else { return }
        withAnimation(.easeOut(duration: 0.2)) {
            proxy.scrollTo(last.id, anchor: .bottom)
        }
    }

    // MARK: - Send box

    private var sendBox: some View {
        VStack(spacing: 0) {
            Divider()
            HStack(spacing: 8) {
                TextField("发条消息…", text: $vm.inputDraft, axis: .vertical)
                    .lineLimit(1...6)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(Color(.systemBackground))
                    .cornerRadius(18)
                    .overlay(
                        RoundedRectangle(cornerRadius: 18)
                            .stroke(Color(.systemGray4), lineWidth: 0.5)
                    )
                    .focused($inputFocused)
                    .disabled(vm.currentConversation == nil)

                if vm.isStreamingMessage {
                    Button {
                        Task { await vm.cancelCurrentStream() }
                    } label: {
                        Image(systemName: "stop.circle.fill")
                            .font(.system(size: 30))
                            .foregroundColor(.red)
                    }
                } else {
                    Button {
                        inputFocused = false
                        Task { await vm.sendMessage() }
                    } label: {
                        Image(systemName: "arrow.up.circle.fill")
                            .font(.system(size: 30))
                            .foregroundColor(canSend ? .accentColor : .secondary.opacity(0.5))
                    }
                    .disabled(!canSend)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(Color(.systemGroupedBackground))
        }
    }

    private var canSend: Bool {
        vm.currentConversation != nil &&
        !vm.inputDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    // MARK: - Toolbar

    private var moreMenu: some View {
        Menu {
            Button {
                showCreateAlert = true
            } label: {
                Label("新对话", systemImage: "plus.bubble")
            }

            Button {
                showConversationList = true
            } label: {
                Label("历史对话", systemImage: "list.bullet.rectangle")
            }
            .disabled(vm.conversations.isEmpty && vm.currentConversation == nil)

            Divider()

            Button {
                copyAllToClipboard()
            } label: {
                Label("复制全文", systemImage: "doc.on.doc")
            }
            .disabled(vm.messages.isEmpty)

            Button(role: .destructive) {
                showDeleteConfirm = true
            } label: {
                Label("删除当前对话", systemImage: "trash")
            }
            .disabled(vm.currentConversation == nil)
        } label: {
            Image(systemName: "ellipsis.circle")
        }
    }

    private func copyAllToClipboard() {
        let full = vm.messages.map { msg in
            "[\(msg.role.rawValue)] \(msg.content)"
        }.joined(separator: "\n\n")
        UIPasteboard.general.string = full
    }

    // MARK: - Banner

    private func errorBanner(_ message: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "info.circle.fill")
                .foregroundColor(.white)
            Text(message)
                .font(.caption)
                .foregroundColor(.white)
                .lineLimit(2)
            Spacer()
            Button {
                vm.clearError()
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .foregroundColor(.white.opacity(0.8))
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(
            message.contains("离线") || message.contains("加入离线队列")
            ? Color.orange
            : Color.red
        )
    }
}

// MARK: - ChatBubble

private struct ChatBubble: View {
    let message: ChatMessage

    var body: some View {
        switch message.role {
        case .user:
            HStack {
                Spacer(minLength: 40)
                bubbleContent
                    .background(Color.accentColor)
                    .foregroundColor(.white)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
        case .assistant:
            HStack {
                bubbleContent
                    .background(Color(.systemBackground))
                    .foregroundColor(.primary)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 14)
                            .stroke(Color(.systemGray4), lineWidth: 0.5)
                    )
                Spacer(minLength: 40)
            }
        case .system:
            HStack {
                Spacer()
                Text(message.content)
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(Color(.systemGray6))
                    .clipShape(Capsule())
                Spacer()
            }
        }
    }

    @ViewBuilder
    private var bubbleContent: some View {
        VStack(alignment: .leading, spacing: 4) {
            // body — 用 Text 接受 .contextMenu 长按复制
            HStack(alignment: .bottom, spacing: 2) {
                Text(message.content)
                    .font(.body)
                    .textSelection(.enabled)
                if message.isStreaming {
                    BlinkingCursor()
                }
            }
            // footer: model badge + time
            HStack(spacing: 6) {
                if let model = message.modelUsed, !model.isEmpty {
                    Text(model)
                        .font(.system(size: 9, weight: .medium))
                        .padding(.horizontal, 4)
                        .padding(.vertical, 1)
                        .background(Color.black.opacity(0.18))
                        .foregroundColor(.white.opacity(0.95))
                        .cornerRadius(3)
                }
                Text(relativeTime)
                    .font(.system(size: 10))
                    .foregroundColor(footerColor)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .contextMenu {
            Button {
                UIPasteboard.general.string = message.content
            } label: {
                Label("复制", systemImage: "doc.on.doc")
            }
        }
    }

    private var footerColor: Color {
        message.role == .user
        ? Color.white.opacity(0.7)
        : Color.secondary
    }

    private var relativeTime: String {
        let date = Date(timeIntervalSince1970: TimeInterval(message.createdAt) / 1000.0)
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .short
        return formatter.localizedString(for: date, relativeTo: Date())
    }
}

// MARK: - BlinkingCursor

/// 1Hz 闪烁 cursor — streaming 中 assistant bubble 末尾给用户 "正在输入" 感。
private struct BlinkingCursor: View {
    @State private var visible: Bool = true

    var body: some View {
        Rectangle()
            .fill(Color.primary.opacity(0.7))
            .frame(width: 2, height: 14)
            .opacity(visible ? 1.0 : 0.0)
            .onAppear {
                withAnimation(.easeInOut(duration: 0.6).repeatForever(autoreverses: true)) {
                    visible = false
                }
            }
    }
}

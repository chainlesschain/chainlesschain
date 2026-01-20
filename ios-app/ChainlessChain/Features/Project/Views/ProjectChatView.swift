import SwiftUI
import CoreCommon

/// 项目AI对话视图
/// Reference: desktop-app-vue/src/renderer/components/projects/ChatPanel.vue
struct ProjectChatView: View {
    let projectId: String
    var currentFile: ProjectFileEntity?
    var onFileOperation: ((String, String) -> Void)?  // (type, path)

    @StateObject private var viewModel: ProjectChatViewModel
    @FocusState private var isInputFocused: Bool
    @State private var showQuickActions = false
    @State private var scrollToBottom = false

    init(projectId: String, currentFile: ProjectFileEntity? = nil, onFileOperation: ((String, String) -> Void)? = nil) {
        self.projectId = projectId
        self.currentFile = currentFile
        self.onFileOperation = onFileOperation
        _viewModel = StateObject(wrappedValue: ProjectChatViewModel(projectId: projectId))
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header
            chatHeader

            // Messages
            messagesScrollView

            // Quick actions bar
            if showQuickActions {
                quickActionsBar
            }

            // Input area
            inputArea
        }
        .background(Color(.systemGroupedBackground))
        .onChange(of: currentFile) { newFile in
            viewModel.currentFile = newFile
        }
        .alert("错误", isPresented: .constant(viewModel.error != nil)) {
            Button("确定") { viewModel.error = nil }
        } message: {
            Text(viewModel.error ?? "")
        }
    }

    // MARK: - Chat Header

    private var chatHeader: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("AI助手")
                    .font(.headline)

                if let file = currentFile {
                    Text("当前文件: \(file.name)")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }

            Spacer()

            Menu {
                Button(role: .destructive) {
                    viewModel.clearHistory()
                } label: {
                    Label("清空对话", systemImage: "trash")
                }
            } label: {
                Image(systemName: "ellipsis.circle")
                    .font(.title3)
                    .foregroundColor(.secondary)
            }
        }
        .padding()
        .background(Color(.systemBackground))
    }

    // MARK: - Messages Scroll View

    private var messagesScrollView: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 16) {
                    if viewModel.messages.isEmpty {
                        emptyStateView
                    } else {
                        ForEach(viewModel.messages) { message in
                            ChatMessageView(
                                message: message,
                                onCopy: { viewModel.copyMessage(message) },
                                onFileOperation: onFileOperation
                            )
                            .id(message.id)
                        }
                    }
                }
                .padding()
            }
            .onChange(of: viewModel.messages.count) { _ in
                if let lastMessage = viewModel.messages.last {
                    withAnimation {
                        proxy.scrollTo(lastMessage.id, anchor: .bottom)
                    }
                }
            }
        }
    }

    // MARK: - Empty State

    private var emptyStateView: some View {
        VStack(spacing: 20) {
            Image(systemName: "bubble.left.and.bubble.right")
                .font(.system(size: 48))
                .foregroundColor(.secondary)

            Text("开始与AI助手对话")
                .font(.headline)

            Text("您可以询问关于项目的问题，让AI帮您创建文件、解释代码、重构代码等")
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)

            // Suggestion chips
            VStack(spacing: 12) {
                ForEach(suggestedPrompts, id: \.self) { prompt in
                    Button {
                        viewModel.inputText = prompt
                    } label: {
                        HStack {
                            Image(systemName: "lightbulb")
                                .font(.caption)
                            Text(prompt)
                                .font(.subheadline)
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .background(Color.blue.opacity(0.1))
                        .foregroundColor(.blue)
                        .cornerRadius(20)
                    }
                }
            }
        }
        .padding(.vertical, 40)
    }

    private var suggestedPrompts: [String] {
        [
            "帮我创建一个README.md文件",
            "解释这个项目的结构",
            "生成项目的API文档"
        ]
    }

    // MARK: - Quick Actions Bar

    private var quickActionsBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 12) {
                ForEach(ProjectChatViewModel.QuickAction.allCases) { action in
                    Button {
                        viewModel.sendQuickAction(action)
                        showQuickActions = false
                    } label: {
                        VStack(spacing: 4) {
                            Image(systemName: action.icon)
                                .font(.title3)
                            Text(action.title)
                                .font(.caption2)
                        }
                        .frame(width: 60, height: 50)
                        .background(Color(.systemBackground))
                        .cornerRadius(8)
                    }
                    .foregroundColor(.primary)
                }
            }
            .padding(.horizontal)
            .padding(.vertical, 8)
        }
        .background(Color(.secondarySystemBackground))
    }

    // MARK: - Input Area

    private var inputArea: some View {
        VStack(spacing: 0) {
            Divider()

            HStack(alignment: .bottom, spacing: 12) {
                // Quick actions toggle
                Button {
                    withAnimation {
                        showQuickActions.toggle()
                    }
                } label: {
                    Image(systemName: showQuickActions ? "xmark.circle.fill" : "plus.circle.fill")
                        .font(.title2)
                        .foregroundColor(.blue)
                }

                // Text input
                HStack(alignment: .bottom) {
                    TextField("输入消息...", text: $viewModel.inputText, axis: .vertical)
                        .lineLimit(1...5)
                        .focused($isInputFocused)
                        .textFieldStyle(.plain)

                    if viewModel.isLoading {
                        ProgressView()
                            .scaleEffect(0.8)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(Color(.systemGray6))
                .cornerRadius(20)

                // Send button
                Button {
                    Task {
                        await viewModel.sendMessage()
                    }
                } label: {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.title)
                        .foregroundColor(canSend ? .blue : .gray)
                }
                .disabled(!canSend)
            }
            .padding()
            .background(Color(.systemBackground))
        }
    }

    private var canSend: Bool {
        !viewModel.inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !viewModel.isLoading
    }
}

// MARK: - Chat Message View

struct ChatMessageView: View {
    let message: ProjectChatViewModel.ChatMessage
    let onCopy: () -> Void
    let onFileOperation: ((String, String) -> Void)?

    @State private var showActions = false

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            if message.role == .assistant {
                // AI Avatar
                Circle()
                    .fill(Color.blue.opacity(0.2))
                    .frame(width: 32, height: 32)
                    .overlay(
                        Image(systemName: "sparkles")
                            .font(.system(size: 14))
                            .foregroundColor(.blue)
                    )
            }

            VStack(alignment: message.role == .user ? .trailing : .leading, spacing: 8) {
                // Message bubble
                messageBubble

                // File operations
                if !message.fileOperations.isEmpty {
                    fileOperationsView
                }

                // Timestamp and actions
                HStack(spacing: 8) {
                    Text(message.timestamp.formatted(date: .omitted, time: .shortened))
                        .font(.caption2)
                        .foregroundColor(.secondary)

                    if message.role == .assistant && !message.isStreaming {
                        Button {
                            onCopy()
                        } label: {
                            Image(systemName: "doc.on.doc")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: message.role == .user ? .trailing : .leading)

            if message.role == .user {
                // User Avatar
                Circle()
                    .fill(Color.green.opacity(0.2))
                    .frame(width: 32, height: 32)
                    .overlay(
                        Image(systemName: "person.fill")
                            .font(.system(size: 14))
                            .foregroundColor(.green)
                    )
            }
        }
    }

    private var messageBubble: some View {
        Group {
            if message.isStreaming {
                HStack(spacing: 4) {
                    ForEach(0..<3) { index in
                        Circle()
                            .fill(Color.gray)
                            .frame(width: 8, height: 8)
                            .opacity(0.4)
                    }
                }
                .padding()
                .background(Color(.systemGray6))
                .cornerRadius(16)
            } else {
                Text(message.content)
                    .font(.body)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(message.role == .user ? Color.blue : Color(.systemGray6))
                    .foregroundColor(message.role == .user ? .white : .primary)
                    .cornerRadius(16)
            }
        }
    }

    private var fileOperationsView: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(message.fileOperations, id: \.path) { operation in
                Button {
                    onFileOperation?(operation.type.rawValue, operation.path)
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: operationIcon(operation.type))
                            .foregroundColor(operationColor(operation.type))

                        Text(operation.path)
                            .font(.caption)
                            .foregroundColor(.primary)

                        Spacer()

                        Image(systemName: "chevron.right")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(Color(.systemBackground))
                    .cornerRadius(8)
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(Color(.systemGray4), lineWidth: 1)
                    )
                }
            }
        }
    }

    private func operationIcon(_ type: ProjectChatViewModel.ChatMessage.FileOperation.OperationType) -> String {
        switch type {
        case .create: return "doc.badge.plus"
        case .update: return "doc.badge.arrow.up"
        case .delete: return "doc.badge.minus"
        }
    }

    private func operationColor(_ type: ProjectChatViewModel.ChatMessage.FileOperation.OperationType) -> Color {
        switch type {
        case .create: return .green
        case .update: return .blue
        case .delete: return .red
        }
    }
}

#Preview {
    ProjectChatView(projectId: "test-project")
}

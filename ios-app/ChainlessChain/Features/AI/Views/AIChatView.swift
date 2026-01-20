import SwiftUI

struct AIChatView: View {
    let conversation: AIConversation
    @StateObject private var viewModel: AIChatViewModel
    @State private var messageText = ""
    @FocusState private var isInputFocused: Bool

    init(conversation: AIConversation) {
        self.conversation = conversation
        _viewModel = StateObject(wrappedValue: AIChatViewModel(conversationId: conversation.id))
    }

    var body: some View {
        VStack(spacing: 0) {
            // 消息列表
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 16) {
                        ForEach(viewModel.messages) { message in
                            MessageBubble(message: message)
                                .id(message.id)
                        }

                        if viewModel.isLoading {
                            HStack {
                                ProgressView()
                                Text("思考中...")
                                    .font(.caption)
                                    .foregroundColor(.gray)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding()
                        }
                    }
                    .padding()
                }
                .onChange(of: viewModel.messages.count) { _, _ in
                    if let lastMessage = viewModel.messages.last {
                        withAnimation {
                            proxy.scrollTo(lastMessage.id, anchor: .bottom)
                        }
                    }
                }
            }

            Divider()

            // 输入框
            HStack(spacing: 12) {
                TextField("输入消息...", text: $messageText, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .focused($isInputFocused)
                    .lineLimit(1...5)

                Button(action: sendMessage) {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.title2)
                        .foregroundColor(messageText.isEmpty ? .gray : .blue)
                }
                .disabled(messageText.isEmpty || viewModel.isLoading)
            }
            .padding()
        }
        .navigationTitle(conversation.title ?? "AI 对话")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            Task {
                await viewModel.loadMessages()
            }
        }
    }

    private func sendMessage() {
        let text = messageText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }

        messageText = ""
        isInputFocused = true

        Task {
            await viewModel.sendMessage(content: text)
        }
    }
}

struct MessageBubble: View {
    let message: AIMessage

    var body: some View {
        HStack {
            if message.role == .user {
                Spacer(minLength: 60)
            }

            VStack(alignment: message.role == .user ? .trailing : .leading, spacing: 4) {
                Text(message.content)
                    .padding(12)
                    .background(message.role == .user ? Color.blue : Color.gray.opacity(0.2))
                    .foregroundColor(message.role == .user ? .white : .primary)
                    .cornerRadius(16)

                Text(message.createdAt, style: .time)
                    .font(.caption2)
                    .foregroundColor(.gray)
            }

            if message.role == .assistant {
                Spacer(minLength: 60)
            }
        }
    }
}

@MainActor
class AIChatViewModel: ObservableObject {
    @Published var messages: [AIMessage] = []
    @Published var isLoading = false
    @Published var errorMessage: String?

    let conversationId: String
    private let llmManager = LLMManager.shared
    private let repository = AIConversationRepository.shared

    init(conversationId: String) {
        self.conversationId = conversationId
    }

    func loadMessages() async {
        do {
            let entities = try repository.getMessages(conversationId: conversationId)
            messages = entities.map { $0.toMessage() }
            print("[AIChatViewModel] Loaded \(messages.count) messages from database")
        } catch {
            print("[AIChatViewModel] Error loading messages: \(error)")
            errorMessage = error.localizedDescription
            messages = []
        }
    }

    func sendMessage(content: String) async {
        let userMessageId = UUID().uuidString
        let userMessage = AIMessage(
            id: userMessageId,
            role: .user,
            content: content,
            createdAt: Date()
        )
        messages.append(userMessage)

        // Save user message to database
        saveMessage(userMessage)

        isLoading = true
        errorMessage = nil

        do {
            // Initialize LLM if needed
            if !llmManager.isInitialized {
                try await llmManager.initialize()
            }

            // Create assistant message placeholder for streaming
            let assistantMessageId = UUID().uuidString
            let assistantMessage = AIMessage(
                id: assistantMessageId,
                role: .assistant,
                content: "",
                createdAt: Date()
            )
            messages.append(assistantMessage)

            // Convert messages to LLM format
            let llmMessages = messages.dropLast().map { message in
                LLMMessage(
                    role: message.role == .user ? "user" : "assistant",
                    content: message.content
                )
            }

            // Call LLM with streaming
            var fullResponse = ""
            let response = try await llmManager.chatStream(
                messages: llmMessages,
                options: ChatOptions(
                    temperature: 0.7,
                    topP: 0.9,
                    maxTokens: 2048,
                    model: nil
                )
            ) { chunk in
                Task { @MainActor in
                    fullResponse += chunk
                    // Update the last message with accumulated content
                    if let index = self.messages.firstIndex(where: { $0.id == assistantMessageId }) {
                        self.messages[index] = AIMessage(
                            id: assistantMessageId,
                            role: .assistant,
                            content: fullResponse,
                            createdAt: Date()
                        )
                    }
                }
            }

            // Update with final response
            let finalMessage = AIMessage(
                id: assistantMessageId,
                role: .assistant,
                content: response.text,
                createdAt: Date()
            )

            if let index = messages.firstIndex(where: { $0.id == assistantMessageId }) {
                messages[index] = finalMessage
            }

            // Save assistant message to database
            saveMessage(finalMessage, tokens: response.tokens)

            // Auto-generate title if this is the first message pair
            if messages.count == 2 {
                await autoGenerateTitle(from: content)
            }

        } catch {
            errorMessage = error.localizedDescription
            print("[AIChatViewModel] Error sending message: \(error)")

            // Add error message (not saved to database)
            let errorMsg = AIMessage(
                id: UUID().uuidString,
                role: .assistant,
                content: "抱歉，发生错误：\(error.localizedDescription)",
                createdAt: Date()
            )
            messages.append(errorMsg)
        }

        isLoading = false
    }

    /// Save message to database
    private func saveMessage(_ message: AIMessage, tokens: Int = 0) {
        let role: String
        switch message.role {
        case .user:
            role = "user"
        case .assistant:
            role = "assistant"
        case .system:
            role = "system"
        }

        let entity = AIMessageEntity(
            id: message.id,
            conversationId: conversationId,
            role: role,
            content: message.content,
            tokens: tokens,
            createdAt: message.createdAt
        )

        do {
            try repository.addMessage(entity)
            print("[AIChatViewModel] Saved message: \(message.id)")
        } catch {
            print("[AIChatViewModel] Error saving message: \(error)")
        }
    }

    /// Auto-generate conversation title from first user message
    private func autoGenerateTitle(from content: String) async {
        // Use first 20 characters or first sentence as title
        var title = content.trimmingCharacters(in: .whitespacesAndNewlines)

        // Truncate at first newline or 30 characters
        if let newlineIndex = title.firstIndex(of: "\n") {
            title = String(title[..<newlineIndex])
        }

        if title.count > 30 {
            let index = title.index(title.startIndex, offsetBy: 27)
            title = String(title[..<index]) + "..."
        }

        do {
            try repository.updateConversationTitle(id: conversationId, title: title)
            print("[AIChatViewModel] Auto-generated title: \(title)")
        } catch {
            print("[AIChatViewModel] Error updating title: \(error)")
        }
    }

    /// Clear all messages in this conversation
    func clearMessages() async {
        do {
            try repository.clearMessages(conversationId: conversationId)
            messages = []
            print("[AIChatViewModel] Cleared all messages")
        } catch {
            print("[AIChatViewModel] Error clearing messages: \(error)")
            errorMessage = error.localizedDescription
        }
    }
}

struct AIMessage: Identifiable {
    let id: String
    let role: MessageRole
    let content: String
    let createdAt: Date

    enum MessageRole {
        case user
        case assistant
        case system
    }
}

#Preview {
    NavigationView {
        AIChatView(conversation: AIConversation(
            id: "1",
            title: "测试对话",
            model: "gpt-4",
            messageCount: 0,
            totalTokens: 0,
            updatedAt: Date()
        ))
    }
}

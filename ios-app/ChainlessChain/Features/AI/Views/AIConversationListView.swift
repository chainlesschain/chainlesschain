import SwiftUI

struct AIConversationListView: View {
    @StateObject private var viewModel = AIConversationListViewModel()
    @State private var showingNewChat = false
    @State private var selectedConversation: AIConversation?
    @State private var navigateToNewChat = false

    var body: some View {
        NavigationView {
            ZStack {
                if viewModel.isLoading && viewModel.conversations.isEmpty {
                    ProgressView("加载中...")
                } else if viewModel.conversations.isEmpty {
                    emptyView
                } else {
                    listView
                }

                // Hidden navigation link for programmatic navigation
                NavigationLink(
                    destination: Group {
                        if let conversation = selectedConversation {
                            AIChatView(conversation: conversation)
                        }
                    },
                    isActive: $navigateToNewChat
                ) {
                    EmptyView()
                }
            }
            .navigationTitle("AI 对话")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: { showingNewChat = true }) {
                        Image(systemName: "plus")
                    }
                }
            }
            .sheet(isPresented: $showingNewChat) {
                NewAIChatView { model in
                    Task {
                        if let conversation = await viewModel.createConversation(model: model) {
                            selectedConversation = conversation
                            showingNewChat = false
                            // Small delay to allow sheet dismissal before navigation
                            try? await Task.sleep(nanoseconds: 300_000_000)
                            navigateToNewChat = true
                        }
                    }
                }
            }
            .onAppear {
                Task {
                    await viewModel.loadConversations()
                }
            }
            .refreshable {
                await viewModel.loadConversations()
            }
            .alert("错误", isPresented: .constant(viewModel.errorMessage != nil)) {
                Button("确定") {
                    viewModel.errorMessage = nil
                }
            } message: {
                Text(viewModel.errorMessage ?? "")
            }
        }
    }

    private var listView: some View {
        List {
            ForEach(viewModel.conversations) { conversation in
                NavigationLink(destination: AIChatView(conversation: conversation)
                    .onDisappear {
                        // Refresh conversation stats when returning from chat
                        Task {
                            await viewModel.refreshConversation(id: conversation.id)
                        }
                    }
                ) {
                    AIConversationRow(conversation: conversation)
                }
                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                    Button(role: .destructive) {
                        Task {
                            await viewModel.deleteConversation(id: conversation.id)
                        }
                    } label: {
                        Label("删除", systemImage: "trash")
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    private var emptyView: some View {
        VStack(spacing: 20) {
            Image(systemName: "message.fill")
                .resizable()
                .frame(width: 80, height: 80)
                .foregroundColor(.gray)

            Text("暂无对话")
                .font(.headline)
                .foregroundColor(.gray)

            Button(action: { showingNewChat = true }) {
                Text("开始新对话")
                    .font(.headline)
                    .foregroundColor(.white)
                    .padding()
                    .background(Color.blue)
                    .cornerRadius(12)
            }
        }
    }
}

struct AIConversationRow: View {
    let conversation: AIConversation

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(conversation.title ?? "新对话")
                    .font(.headline)
                Spacer()
                Text(conversation.updatedAt, style: .relative)
                    .font(.caption)
                    .foregroundColor(.gray)
            }

            HStack {
                Label(conversation.model, systemImage: "cpu")
                    .font(.caption)
                    .foregroundColor(.blue)

                Spacer()

                Label("\(conversation.messageCount)", systemImage: "bubble.left.and.bubble.right")
                    .font(.caption)
                    .foregroundColor(.gray)

                if conversation.totalTokens > 0 {
                    Label("\(conversation.totalTokens)", systemImage: "doc.text")
                        .font(.caption)
                        .foregroundColor(.gray)
                }
            }
        }
        .padding(.vertical, 4)
    }
}

struct NewAIChatView: View {
    let onCreate: (String) -> Void
    @State private var selectedModel = "gpt-4"
    @Environment(\.dismiss) var dismiss

    let availableModels = [
        "gpt-4",
        "gpt-3.5-turbo",
        "claude-3-opus",
        "claude-3-sonnet",
        "qwen2:7b"
    ]

    var body: some View {
        NavigationView {
            Form {
                Section("选择模型") {
                    Picker("AI 模型", selection: $selectedModel) {
                        ForEach(availableModels, id: \.self) { model in
                            Text(model).tag(model)
                        }
                    }
                }
            }
            .navigationTitle("新对话")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("创建") {
                        onCreate(selectedModel)
                    }
                }
            }
        }
    }
}

@MainActor
class AIConversationListViewModel: ObservableObject {
    @Published var conversations: [AIConversation] = []
    @Published var isLoading = false
    @Published var errorMessage: String?

    private let repository = AIConversationRepository.shared

    func loadConversations() async {
        isLoading = true
        defer { isLoading = false }

        do {
            let entities = try repository.getAllConversations()
            conversations = entities.map { $0.toConversation() }
            print("[AIConversationListViewModel] Loaded \(conversations.count) conversations")
        } catch {
            print("[AIConversationListViewModel] Error loading conversations: \(error)")
            errorMessage = error.localizedDescription
            conversations = []
        }
    }

    func createConversation(model: String) async -> AIConversation? {
        let entity = AIConversationEntity(
            id: UUID().uuidString,
            title: nil,
            model: model,
            systemPrompt: nil,
            temperature: 0.7,
            totalTokens: 0,
            messageCount: 0,
            createdAt: Date(),
            updatedAt: Date()
        )

        do {
            try repository.createConversation(entity)
            let conversation = entity.toConversation()
            conversations.insert(conversation, at: 0)
            print("[AIConversationListViewModel] Created conversation: \(entity.id)")
            return conversation
        } catch {
            print("[AIConversationListViewModel] Error creating conversation: \(error)")
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func deleteConversation(id: String) async {
        do {
            try repository.deleteConversation(id: id)
            conversations.removeAll { $0.id == id }
            print("[AIConversationListViewModel] Deleted conversation: \(id)")
        } catch {
            print("[AIConversationListViewModel] Error deleting conversation: \(error)")
            errorMessage = error.localizedDescription
        }
    }

    func refreshConversation(id: String) async {
        // Reload a specific conversation to update its stats
        do {
            if let entity = try repository.getConversation(id: id) {
                if let index = conversations.firstIndex(where: { $0.id == id }) {
                    conversations[index] = entity.toConversation()
                }
            }
        } catch {
            print("[AIConversationListViewModel] Error refreshing conversation: \(error)")
        }
    }
}

struct AIConversation: Identifiable, Hashable {
    let id: String
    let title: String?
    let model: String
    let messageCount: Int
    let totalTokens: Int
    let updatedAt: Date

    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }

    static func == (lhs: AIConversation, rhs: AIConversation) -> Bool {
        lhs.id == rhs.id
    }
}

#Preview {
    AIConversationListView()
}

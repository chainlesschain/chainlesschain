import SwiftUI

struct AIConversationListView: View {
    @StateObject private var viewModel = AIConversationListViewModel()
    @State private var showingNewChat = false

    var body: some View {
        NavigationView {
            ZStack {
                if viewModel.conversations.isEmpty {
                    emptyView
                } else {
                    listView
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
                        await viewModel.createConversation(model: model)
                        showingNewChat = false
                    }
                }
            }
            .onAppear {
                Task {
                    await viewModel.loadConversations()
                }
            }
        }
    }

    private var listView: some View {
        List {
            ForEach(viewModel.conversations) { conversation in
                NavigationLink(destination: AIChatView(conversation: conversation)) {
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

    func loadConversations() async {
        // TODO: Load from database
        conversations = []
    }

    func createConversation(model: String) async {
        // TODO: Create in database
    }

    func deleteConversation(id: String) async {
        // TODO: Delete from database
        conversations.removeAll { $0.id == id }
    }
}

struct AIConversation: Identifiable {
    let id: String
    let title: String?
    let model: String
    let messageCount: Int
    let totalTokens: Int
    let updatedAt: Date
}

#Preview {
    AIConversationListView()
}

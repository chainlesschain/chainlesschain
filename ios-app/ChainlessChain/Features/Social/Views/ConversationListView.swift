import SwiftUI

struct ConversationListView: View {
    @StateObject private var viewModel = ConversationListViewModel()

    var body: some View {
        NavigationView {
            ZStack {
                if viewModel.conversations.isEmpty {
                    emptyView
                } else {
                    listView
                }
            }
            .navigationTitle("消息")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: {}) {
                        Image(systemName: "square.and.pencil")
                    }
                }
            }
        }
    }

    private var listView: some View {
        List(viewModel.conversations) { conversation in
            NavigationLink(destination: ChatView(conversation: conversation)) {
                ConversationRow(conversation: conversation)
            }
        }
    }

    private var emptyView: some View {
        VStack(spacing: 20) {
            Image(systemName: "bubble.left.and.bubble.right.fill")
                .resizable()
                .frame(width: 80, height: 80)
                .foregroundColor(.gray)

            Text("暂无对话")
                .font(.headline)
                .foregroundColor(.gray)

            Text("使用 DID 与好友开始加密对话")
                .font(.subheadline)
                .foregroundColor(.gray)
                .multilineTextAlignment(.center)
        }
    }
}

struct ConversationRow: View {
    let conversation: Conversation

    var body: some View {
        HStack(spacing: 12) {
            // 头像
            Circle()
                .fill(Color.blue.opacity(0.2))
                .frame(width: 50, height: 50)
                .overlay(
                    Text(conversation.title.prefix(1))
                        .font(.title3)
                        .foregroundColor(.blue)
                )

            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(conversation.title)
                        .font(.headline)
                    Spacer()
                    Text(conversation.lastMessageAt ?? Date(), style: .relative)
                        .font(.caption)
                        .foregroundColor(.gray)
                }

                HStack {
                    Text("端到端加密")
                        .font(.caption)
                        .foregroundColor(.green)

                    Spacer()

                    if conversation.unreadCount > 0 {
                        Text("\(conversation.unreadCount)")
                            .font(.caption)
                            .foregroundColor(.white)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 2)
                            .background(Color.red)
                            .cornerRadius(10)
                    }
                }
            }
        }
        .padding(.vertical, 4)
    }
}

struct ChatView: View {
    let conversation: Conversation

    var body: some View {
        VStack {
            Text("P2P 加密聊天界面")
                .font(.headline)
                .foregroundColor(.gray)

            Text("即将推出")
                .font(.subheadline)
                .foregroundColor(.gray)
        }
        .navigationTitle(conversation.title)
        .navigationBarTitleDisplayMode(.inline)
    }
}

@MainActor
class ConversationListViewModel: ObservableObject {
    @Published var conversations: [Conversation] = []

    init() {
        // TODO: Load from database
    }
}

struct Conversation: Identifiable {
    let id: String
    let title: String
    let lastMessageAt: Date?
    let unreadCount: Int
}

#Preview {
    ConversationListView()
}

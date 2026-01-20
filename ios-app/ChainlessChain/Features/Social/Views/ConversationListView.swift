import SwiftUI
import CoreCommon
import CoreDID

struct ConversationListView: View {
    @StateObject private var viewModel = ConversationListViewModel()
    @State private var showNewChat = false

    var body: some View {
        NavigationView {
            ZStack {
                if viewModel.isLoading {
                    ProgressView("加载中...")
                } else if viewModel.conversations.isEmpty {
                    emptyView
                } else {
                    listView
                }
            }
            .navigationTitle("消息")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: { showNewChat = true }) {
                        Image(systemName: "square.and.pencil")
                    }
                }
            }
            .sheet(isPresented: $showNewChat) {
                NewChatView { contact in
                    viewModel.startConversation(with: contact)
                    showNewChat = false
                }
            }
            .refreshable {
                await viewModel.loadConversations()
            }
        }
        .task {
            await viewModel.loadConversations()
        }
    }

    private var listView: some View {
        List {
            ForEach(viewModel.conversations) { conversation in
                NavigationLink(destination: P2PChatDetailView(conversation: conversation)) {
                    ConversationRow(conversation: conversation)
                }
                .swipeActions(edge: .trailing) {
                    Button(role: .destructive) {
                        viewModel.deleteConversation(conversation)
                    } label: {
                        Label("删除", systemImage: "trash")
                    }

                    Button {
                        viewModel.togglePin(conversation)
                    } label: {
                        Label(conversation.isPinned ? "取消置顶" : "置顶",
                              systemImage: conversation.isPinned ? "pin.slash" : "pin")
                    }
                    .tint(.orange)
                }
            }
        }
        .listStyle(.plain)
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

            Button(action: { showNewChat = true }) {
                Label("开始新对话", systemImage: "plus.message")
                    .padding()
                    .background(Color.blue)
                    .foregroundColor(.white)
                    .cornerRadius(10)
            }
        }
    }
}

struct ConversationRow: View {
    let conversation: ConversationDisplayModel

    var body: some View {
        HStack(spacing: 12) {
            // Avatar
            ZStack {
                Circle()
                    .fill(avatarColor)
                    .frame(width: 50, height: 50)

                Text(conversation.displayTitle.prefix(1).uppercased())
                    .font(.title3)
                    .fontWeight(.medium)
                    .foregroundColor(.white)
            }

            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    if conversation.isPinned {
                        Image(systemName: "pin.fill")
                            .font(.caption2)
                            .foregroundColor(.orange)
                    }

                    Text(conversation.displayTitle)
                        .font(.headline)
                        .lineLimit(1)

                    Spacer()

                    if let lastMessageAt = conversation.lastMessageAt {
                        Text(lastMessageAt, style: .relative)
                            .font(.caption)
                            .foregroundColor(.gray)
                    }
                }

                HStack {
                    if conversation.isMuted {
                        Image(systemName: "bell.slash.fill")
                            .font(.caption2)
                            .foregroundColor(.gray)
                    }

                    Text(conversation.lastMessagePreview)
                        .font(.subheadline)
                        .foregroundColor(.gray)
                        .lineLimit(1)

                    Spacer()

                    if conversation.unreadCount > 0 {
                        Text("\(min(conversation.unreadCount, 99))\(conversation.unreadCount > 99 ? "+" : "")")
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

    private var avatarColor: Color {
        let colors: [Color] = [.blue, .green, .orange, .purple, .pink, .teal]
        let index = abs(conversation.id.hashValue) % colors.count
        return colors[index]
    }
}

// MARK: - P2P Chat Detail View

struct P2PChatDetailView: View {
    let conversation: ConversationDisplayModel

    var body: some View {
        VStack {
            // Placeholder for actual P2P chat
            Text("P2P 加密聊天")
                .font(.headline)
                .foregroundColor(.gray)

            HStack(spacing: 4) {
                Image(systemName: "lock.fill")
                    .foregroundColor(.green)
                Text("端到端加密")
                    .font(.caption)
                    .foregroundColor(.green)
            }

            Text("与 \(conversation.displayTitle) 的对话")
                .font(.subheadline)
                .foregroundColor(.gray)
                .padding(.top, 8)
        }
        .navigationTitle(conversation.displayTitle)
        .navigationBarTitleDisplayMode(.inline)
    }
}

// MARK: - New Chat View

struct NewChatView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var viewModel = NewChatViewModel()
    let onSelectContact: (P2PContactEntity) -> Void

    var body: some View {
        NavigationView {
            VStack {
                // Search bar
                HStack {
                    Image(systemName: "magnifyingglass")
                        .foregroundColor(.gray)
                    TextField("搜索联系人或输入 DID", text: $viewModel.searchText)
                        .textFieldStyle(.plain)
                }
                .padding()
                .background(Color(.systemGray6))
                .cornerRadius(10)
                .padding(.horizontal)

                if viewModel.contacts.isEmpty && !viewModel.searchText.isEmpty {
                    // Option to add new contact by DID
                    VStack(spacing: 12) {
                        Text("未找到联系人")
                            .foregroundColor(.gray)

                        if viewModel.searchText.hasPrefix("did:") {
                            Button {
                                viewModel.addContactByDid(viewModel.searchText)
                            } label: {
                                Label("添加为联系人", systemImage: "person.badge.plus")
                            }
                        }
                    }
                    .padding(.top, 40)
                } else {
                    List(viewModel.filteredContacts) { contact in
                        Button {
                            onSelectContact(contact)
                        } label: {
                            HStack(spacing: 12) {
                                Circle()
                                    .fill(Color.blue.opacity(0.2))
                                    .frame(width: 44, height: 44)
                                    .overlay(
                                        Text(contact.initials)
                                            .font(.headline)
                                            .foregroundColor(.blue)
                                    )

                                VStack(alignment: .leading, spacing: 2) {
                                    Text(contact.displayName)
                                        .font(.headline)
                                        .foregroundColor(.primary)

                                    Text(String(contact.did.prefix(20)) + "...")
                                        .font(.caption)
                                        .foregroundColor(.gray)
                                }

                                Spacer()

                                if contact.isVerified {
                                    Image(systemName: "checkmark.seal.fill")
                                        .foregroundColor(.blue)
                                }
                            }
                        }
                    }
                    .listStyle(.plain)
                }

                Spacer()
            }
            .navigationTitle("新对话")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("取消") {
                        dismiss()
                    }
                }
            }
        }
        .task {
            await viewModel.loadContacts()
        }
    }
}

// MARK: - View Models

@MainActor
class ConversationListViewModel: ObservableObject {
    @Published var conversations: [ConversationDisplayModel] = []
    @Published var isLoading = false

    private let messageRepository = P2PMessageRepository.shared
    private let contactRepository = P2PContactRepository.shared
    private let logger = Logger.shared

    func loadConversations() async {
        isLoading = true
        defer { isLoading = false }

        do {
            // Load conversations from database
            let entities = try messageRepository.getAllConversations(limit: 100)

            // Get current user's DID
            let myDid = DIDManager.shared.currentDID?.did ?? ""

            // Convert to display models with contact info
            var displayModels: [ConversationDisplayModel] = []

            for entity in entities {
                // Get the other participant's DID
                let otherDid = entity.getOtherParticipant(myDid: myDid) ?? ""

                // Try to get contact name
                var displayTitle = entity.title ?? ""
                if displayTitle.isEmpty {
                    if let contact = try? contactRepository.getContactByDid(did: otherDid) {
                        displayTitle = contact.displayName
                    } else {
                        displayTitle = String(otherDid.prefix(16)) + "..."
                    }
                }

                let model = ConversationDisplayModel(
                    id: entity.id,
                    displayTitle: displayTitle,
                    participantDid: otherDid,
                    lastMessagePreview: "端到端加密",
                    lastMessageAt: entity.lastMessageAt,
                    unreadCount: entity.unreadCount,
                    isPinned: entity.isPinned,
                    isMuted: entity.isMuted
                )
                displayModels.append(model)
            }

            // Sort: pinned first, then by last message time
            conversations = displayModels.sorted { a, b in
                if a.isPinned != b.isPinned {
                    return a.isPinned
                }
                return (a.lastMessageAt ?? .distantPast) > (b.lastMessageAt ?? .distantPast)
            }

            logger.info("Loaded \(conversations.count) conversations", category: "P2P")
        } catch {
            logger.error("Failed to load conversations", error: error, category: "P2P")
        }
    }

    func startConversation(with contact: P2PContactEntity) {
        Task {
            do {
                let myDid = DIDManager.shared.currentDID?.did ?? ""
                _ = try messageRepository.getOrCreateConversation(with: contact.did, myDid: myDid)
                await loadConversations()
            } catch {
                logger.error("Failed to start conversation", error: error, category: "P2P")
            }
        }
    }

    func deleteConversation(_ conversation: ConversationDisplayModel) {
        Task {
            do {
                try messageRepository.deleteConversation(id: conversation.id)
                await loadConversations()
            } catch {
                logger.error("Failed to delete conversation", error: error, category: "P2P")
            }
        }
    }

    func togglePin(_ conversation: ConversationDisplayModel) {
        Task {
            do {
                let sql = "UPDATE conversations SET is_pinned = ?, updated_at = ? WHERE id = ?"
                _ = try DatabaseManager.shared.query(sql, parameters: [
                    !conversation.isPinned ? 1 : 0,
                    Date().timestampMs,
                    conversation.id
                ]) { _ in () }
                await loadConversations()
            } catch {
                logger.error("Failed to toggle pin", error: error, category: "P2P")
            }
        }
    }
}

@MainActor
class NewChatViewModel: ObservableObject {
    @Published var contacts: [P2PContactEntity] = []
    @Published var searchText = ""

    private let contactRepository = P2PContactRepository.shared
    private let logger = Logger.shared

    var filteredContacts: [P2PContactEntity] {
        if searchText.isEmpty {
            return contacts
        }
        return contacts.filter {
            $0.name.localizedCaseInsensitiveContains(searchText) ||
            $0.did.localizedCaseInsensitiveContains(searchText)
        }
    }

    func loadContacts() async {
        do {
            contacts = try contactRepository.getAllContacts()
            logger.info("Loaded \(contacts.count) contacts", category: "P2P")
        } catch {
            logger.error("Failed to load contacts", error: error, category: "P2P")
        }
    }

    func addContactByDid(_ did: String) {
        let contact = P2PContactEntity(
            did: did,
            name: String(did.prefix(16)) + "..."
        )

        do {
            try contactRepository.addContact(contact)
            contacts.append(contact)
        } catch {
            logger.error("Failed to add contact", error: error, category: "P2P")
        }
    }
}

// MARK: - Display Model

struct ConversationDisplayModel: Identifiable {
    let id: String
    let displayTitle: String
    let participantDid: String
    let lastMessagePreview: String
    let lastMessageAt: Date?
    let unreadCount: Int
    let isPinned: Bool
    let isMuted: Bool
}

#Preview {
    ConversationListView()
}

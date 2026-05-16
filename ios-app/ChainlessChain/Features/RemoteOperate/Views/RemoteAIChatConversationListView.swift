import SwiftUI
import CoreP2P

/// 远程 AI 对话列表 sheet — Phase 5.4。
///
/// **命名**：`RemoteAIChatConversationListView` 而非 `ConversationListView`，
/// 避开 `Features/Social/Views/ConversationListView.swift:5` 同名 struct 冲突
/// （那是 P2P 社交聊天会话列表，与本 view 远程 AI 对话是两套独立 stack）。
///
/// 从 [RemoteAIChatView] toolbar Menu "历史对话" 或空状态 button 弹出。
/// List(.insetGrouped) of Conversation rows，swipe-to-delete + tap → selectConversation。
/// 顶部 "+ 新对话" toolbar button + pull-to-refresh + 空状态。
///
/// **owner**: 父 view 持有 vm（@StateObject）；本 view 用 @ObservedObject 共享。
/// dismiss callback 由父决定（@State var showConversationList）。
struct RemoteAIChatConversationListView: View {
    @ObservedObject var vm: RemoteAIChatViewModel
    let onDismiss: () -> Void

    @State private var showCreateAlert = false
    @State private var newConversationTitle = ""

    var body: some View {
        NavigationView {
            content
                .navigationTitle("历史对话")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .navigationBarLeading) {
                        Button("关闭") { onDismiss() }
                    }
                    ToolbarItem(placement: .navigationBarTrailing) {
                        Button {
                            showCreateAlert = true
                        } label: {
                            Image(systemName: "plus")
                        }
                    }
                }
                .alert("新建对话", isPresented: $showCreateAlert) {
                    TextField("对话标题（可选）", text: $newConversationTitle)
                    Button("创建") {
                        let title = newConversationTitle.trimmingCharacters(in: .whitespacesAndNewlines)
                        Task {
                            await vm.createConversation(title: title.isEmpty ? nil : title)
                            newConversationTitle = ""
                            onDismiss()
                        }
                    }
                    Button("取消", role: .cancel) {
                        newConversationTitle = ""
                    }
                }
        }
    }

    @ViewBuilder
    private var content: some View {
        if vm.isLoading && vm.conversations.isEmpty {
            loadingState
        } else if vm.conversations.isEmpty {
            emptyState
        } else {
            listView
        }
    }

    private var listView: some View {
        List {
            ForEach(vm.conversations) { conv in
                RemoteAIChatConversationRow(
                    conversation: conv,
                    isCurrent: conv.id == vm.currentConversation?.id
                )
                .contentShape(Rectangle())
                .onTapGesture {
                    Task {
                        await vm.selectConversation(id: conv.id)
                        onDismiss()
                    }
                }
                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                    Button(role: .destructive) {
                        Task { await vm.deleteConversation(id: conv.id) }
                    } label: {
                        Label("删除", systemImage: "trash")
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .refreshable { await vm.refresh() }
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "tray")
                .font(.system(size: 50))
                .foregroundColor(.secondary)
            Text("暂无对话")
                .font(.headline)
            Text("桌面端创建的对话会同步到这里；也可以从右上角 + 新建。")
                .font(.callout)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var loadingState: some View {
        VStack(spacing: 12) {
            ProgressView()
            Text("加载中…")
                .font(.callout)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Row

private struct RemoteAIChatConversationRow: View {
    let conversation: Conversation
    let isCurrent: Bool

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "brain.head.profile")
                .font(.title3)
                .foregroundColor(isCurrent ? .accentColor : .secondary)
                .frame(width: 32, height: 32)
                .background(
                    Circle()
                        .fill(isCurrent ? Color.accentColor.opacity(0.15) : Color(.systemGray5))
                )

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(conversation.title.isEmpty ? "(无标题)" : conversation.title)
                        .font(.body)
                        .fontWeight(isCurrent ? .semibold : .regular)
                        .lineLimit(1)
                    if isCurrent {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.caption)
                            .foregroundColor(.accentColor)
                    }
                    Spacer()
                    if let model = conversation.model, !model.isEmpty {
                        Text(model)
                            .font(.system(size: 9, weight: .medium))
                            .padding(.horizontal, 4)
                            .padding(.vertical, 1)
                            .background(Color(.systemGray5))
                            .foregroundColor(.secondary)
                            .cornerRadius(3)
                    }
                }
                HStack(spacing: 8) {
                    Text("\(conversation.messageCount) 条")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    Text(relativeDate)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
        }
        .padding(.vertical, 2)
    }

    private var relativeDate: String {
        let ms = conversation.lastMessageAt ?? conversation.createdAt
        let date = Date(timeIntervalSince1970: TimeInterval(ms) / 1000.0)
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .short
        return formatter.localizedString(for: date, relativeTo: Date())
    }
}

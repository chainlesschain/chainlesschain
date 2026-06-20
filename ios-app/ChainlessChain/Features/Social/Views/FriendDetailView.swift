import SwiftUI

/// 好友资料 + 操作（与 Android `FriendDetailScreen` 对齐）
struct FriendDetailView: View {
    let contact: P2PContactEntity
    @ObservedObject var viewModel: FriendsViewModel
    @Environment(\.dismiss) private var dismiss

    @State private var isVerified: Bool
    @State private var chatStartedAlert = false

    init(contact: P2PContactEntity, viewModel: FriendsViewModel) {
        self.contact = contact
        self.viewModel = viewModel
        _isVerified = State(initialValue: contact.isVerified)
    }

    var body: some View {
        List {
            Section {
                HStack(spacing: 16) {
                    Circle()
                        .fill(Color.blue.opacity(0.2))
                        .frame(width: 64, height: 64)
                        .overlay(
                            Text(contact.initials.isEmpty ? "?" : contact.initials)
                                .font(.title)
                                .foregroundColor(.blue)
                        )
                    VStack(alignment: .leading, spacing: 4) {
                        Text(contact.displayName)
                            .font(.title3)
                            .fontWeight(.semibold)
                        if isVerified {
                            Label("已验证", systemImage: "checkmark.seal.fill")
                                .font(.caption)
                                .foregroundColor(.blue)
                        } else {
                            Text("未验证")
                                .font(.caption)
                                .foregroundColor(.gray)
                        }
                    }
                }
                .padding(.vertical, 6)
            }

            Section(header: Text("DID")) {
                Text(contact.did)
                    .font(.system(.footnote, design: .monospaced))
                    .textSelection(.enabled)
            }

            Section {
                Button {
                    if viewModel.startChat(with: contact) {
                        chatStartedAlert = true
                    }
                } label: {
                    Label("发消息", systemImage: "message")
                }

                NavigationLink(destination: UserPostsView(authorDID: contact.did, title: contact.displayName)) {
                    Label("查看 TA 的动态", systemImage: "list.bullet.rectangle")
                }
            }

            Section {
                Toggle(isOn: $isVerified) {
                    Label("标记为已验证", systemImage: "checkmark.shield")
                }
                .onChange(of: isVerified) { newValue in
                    viewModel.setVerified(contact, verified: newValue)
                }

                Button {
                    Task {
                        await viewModel.setBlocked(contact, blocked: true)
                        dismiss()
                    }
                } label: {
                    Label("屏蔽该好友", systemImage: "hand.raised")
                        .foregroundColor(.orange)
                }
            }

            Section {
                Button(role: .destructive) {
                    viewModel.deleteFriend(contact)
                    dismiss()
                } label: {
                    Label("删除好友", systemImage: "trash")
                }
            }
        }
        .navigationTitle("好友资料")
        .navigationBarTitleDisplayMode(.inline)
        .alert("对话已就绪", isPresented: $chatStartedAlert) {
            Button("好", role: .cancel) {}
        } message: {
            Text("已为你创建与 \(contact.displayName) 的会话，请到「消息」列表查看。")
        }
    }
}

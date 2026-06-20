import SwiftUI

/// 已屏蔽用户管理（与 Android `BlockedUsersScreen` 对齐）
struct BlockedUsersView: View {
    @ObservedObject var viewModel: FriendsViewModel

    var body: some View {
        ZStack {
            if viewModel.blocked.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "hand.raised.slash")
                        .font(.largeTitle)
                        .foregroundColor(.gray)
                    Text("没有被屏蔽的用户")
                        .foregroundColor(.gray)
                }
            } else {
                List {
                    ForEach(viewModel.blocked) { contact in
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(contact.displayName)
                                    .font(.headline)
                                Text(String(contact.did.prefix(24)) + "…")
                                    .font(.caption)
                                    .foregroundColor(.gray)
                                    .lineLimit(1)
                            }
                            Spacer()
                            Button("解除屏蔽") {
                                Task { await viewModel.setBlocked(contact, blocked: false) }
                            }
                            .buttonStyle(.borderless)
                            .foregroundColor(.blue)
                        }
                    }
                }
            }
        }
        .navigationTitle("已屏蔽")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await viewModel.loadBlocked()
        }
    }
}

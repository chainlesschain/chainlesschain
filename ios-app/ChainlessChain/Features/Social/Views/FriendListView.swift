import SwiftUI
import CoreCommon

/// 好友列表（与 Android `FriendListScreen` 对齐）
struct FriendListView: View {
    @StateObject private var viewModel = FriendsViewModel()
    @State private var showAddFriend = false
    @State private var showMyDID = false

    var body: some View {
        NavigationView {
            ZStack {
                if viewModel.isLoading && viewModel.friends.isEmpty {
                    ProgressView("加载中...")
                } else if viewModel.friends.isEmpty {
                    emptyView
                } else {
                    friendList
                }
            }
            .navigationTitle("好友")
            .searchable(text: $viewModel.searchText, prompt: "搜索好友或 DID")
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button(action: { showMyDID = true }) {
                        Image(systemName: "qrcode")
                    }
                    .accessibilityLabel("我的二维码")
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: { showAddFriend = true }) {
                        Image(systemName: "person.badge.plus")
                    }
                }
            }
            .sheet(isPresented: $showAddFriend) {
                AddFriendView(viewModel: viewModel)
            }
            .sheet(isPresented: $showMyDID) {
                MyDIDView(did: viewModel.myDID)
            }
            .refreshable {
                await viewModel.load()
            }
        }
        .task {
            await viewModel.load()
        }
    }

    private var friendList: some View {
        List {
            Section {
                ForEach(viewModel.filteredFriends) { friend in
                    NavigationLink(destination: FriendDetailView(contact: friend, viewModel: viewModel)) {
                        FriendRow(contact: friend)
                    }
                    .swipeActions(edge: .trailing) {
                        Button(role: .destructive) {
                            viewModel.deleteFriend(friend)
                        } label: {
                            Label("删除", systemImage: "trash")
                        }
                        Button {
                            Task { await viewModel.setBlocked(friend, blocked: true) }
                        } label: {
                            Label("屏蔽", systemImage: "hand.raised")
                        }
                        .tint(.orange)
                    }
                }
            }

            Section {
                NavigationLink(destination: BlockedUsersView(viewModel: viewModel)) {
                    Label("已屏蔽的用户", systemImage: "hand.raised.slash")
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    private var emptyView: some View {
        VStack(spacing: 20) {
            Image(systemName: "person.2.fill")
                .resizable()
                .scaledToFit()
                .frame(width: 80, height: 60)
                .foregroundColor(.gray)

            Text("还没有好友")
                .font(.headline)
                .foregroundColor(.gray)

            Text("通过 DID 添加好友，开始去中心化社交")
                .font(.subheadline)
                .foregroundColor(.gray)
                .multilineTextAlignment(.center)

            Button(action: { showAddFriend = true }) {
                Label("添加好友", systemImage: "person.badge.plus")
                    .padding()
                    .background(Color.blue)
                    .foregroundColor(.white)
                    .cornerRadius(10)
            }
        }
        .padding()
    }
}

// MARK: - Friend Row

struct FriendRow: View {
    let contact: P2PContactEntity

    var body: some View {
        HStack(spacing: 12) {
            Circle()
                .fill(Color.blue.opacity(0.2))
                .frame(width: 44, height: 44)
                .overlay(
                    Text(contact.initials.isEmpty ? "?" : contact.initials)
                        .font(.headline)
                        .foregroundColor(.blue)
                )

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    Text(contact.displayName)
                        .font(.headline)
                    if contact.isVerified {
                        Image(systemName: "checkmark.seal.fill")
                            .font(.caption)
                            .foregroundColor(.blue)
                    }
                }
                Text(String(contact.did.prefix(24)) + "…")
                    .font(.caption)
                    .foregroundColor(.gray)
                    .lineLimit(1)
            }

            Spacer()
        }
        .padding(.vertical, 4)
    }
}

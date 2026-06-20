import SwiftUI
import CoreCommon

/// 去中心化社交「广场」时间线（与 Android `TimelineScreen` 对齐）
struct SocialFeedView: View {
    @StateObject private var viewModel = SocialFeedViewModel()
    @State private var showPublish = false

    var body: some View {
        NavigationView {
            ZStack {
                if viewModel.isLoading && viewModel.posts.isEmpty {
                    ProgressView("加载中...")
                } else if viewModel.posts.isEmpty {
                    emptyView
                } else {
                    listView
                }
            }
            .navigationTitle("社交广场")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: { showPublish = true }) {
                        Image(systemName: "square.and.pencil")
                    }
                }
            }
            .sheet(isPresented: $showPublish) {
                PublishPostView { content, visibility in
                    Task { await viewModel.publish(content: content, visibility: visibility) }
                }
            }
            .refreshable {
                await viewModel.refresh()
            }
        }
        .task {
            await viewModel.loadFeed()
        }
    }

    private var listView: some View {
        List {
            ForEach(viewModel.posts) { post in
                ZStack {
                    PostRow(post: post, onLike: { viewModel.toggleLike(post) })
                    NavigationLink(destination: PostDetailView(post: post)) {
                        EmptyView()
                    }
                    .opacity(0)
                }
                .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                .swipeActions(edge: .trailing) {
                    if viewModel.canDelete(post) {
                        Button(role: .destructive) {
                            viewModel.deletePost(post)
                        } label: {
                            Label("删除", systemImage: "trash")
                        }
                    }
                }
            }
        }
        .listStyle(.plain)
    }

    private var emptyView: some View {
        VStack(spacing: 20) {
            Image(systemName: "person.3.fill")
                .resizable()
                .scaledToFit()
                .frame(width: 80, height: 60)
                .foregroundColor(.gray)

            Text("还没有动态")
                .font(.headline)
                .foregroundColor(.gray)

            Text("发布第一条去中心化动态，与好友分享")
                .font(.subheadline)
                .foregroundColor(.gray)
                .multilineTextAlignment(.center)

            Button(action: { showPublish = true }) {
                Label("发布动态", systemImage: "square.and.pencil")
                    .padding()
                    .background(Color.blue)
                    .foregroundColor(.white)
                    .cornerRadius(10)
            }
        }
        .padding()
    }
}

// MARK: - Post Row

struct PostRow: View {
    let post: SocialPost
    let onLike: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                ZStack {
                    Circle()
                        .fill(Color.blue.opacity(0.7))
                        .frame(width: 40, height: 40)
                    Text(post.displayAuthor.suffix(1).uppercased())
                        .font(.headline)
                        .foregroundColor(.white)
                }

                VStack(alignment: .leading, spacing: 2) {
                    Text(post.displayAuthor)
                        .font(.subheadline)
                        .fontWeight(.medium)
                    Text(post.createdAt, style: .relative)
                        .font(.caption)
                        .foregroundColor(.gray)
                }

                Spacer()

                Image(systemName: post.visibility.systemImage)
                    .font(.caption)
                    .foregroundColor(.gray)
            }

            Text(post.content)
                .font(.body)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 24) {
                Button(action: onLike) {
                    Label("\(post.likeCount)", systemImage: post.isLiked ? "heart.fill" : "heart")
                        .foregroundColor(post.isLiked ? .red : .gray)
                }
                .buttonStyle(.borderless)

                Label("\(post.commentCount)", systemImage: "bubble.right")
                    .foregroundColor(.gray)

                Spacer()
            }
            .font(.subheadline)
        }
        .padding(.vertical, 6)
        .contentShape(Rectangle())
    }
}

#Preview {
    SocialFeedView()
}

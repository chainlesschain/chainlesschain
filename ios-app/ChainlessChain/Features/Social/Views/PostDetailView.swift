import SwiftUI

/// 动态详情 + 评论（与 Android `PostDetailScreen` 对齐）
struct PostDetailView: View {
    @StateObject private var viewModel: PostDetailViewModel
    @State private var newComment = ""
    @FocusState private var commentFocused: Bool

    init(post: SocialPost) {
        _viewModel = StateObject(wrappedValue: PostDetailViewModel(post: post))
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    PostRow(post: viewModel.post, onLike: {})
                        .padding(.horizontal)

                    Divider()

                    Text("评论 (\(viewModel.comments.count))")
                        .font(.headline)
                        .padding(.horizontal)

                    if viewModel.isLoading && viewModel.comments.isEmpty {
                        ProgressView()
                            .frame(maxWidth: .infinity)
                            .padding(.top, 24)
                    } else if viewModel.comments.isEmpty {
                        Text("还没有评论，来抢沙发吧")
                            .font(.subheadline)
                            .foregroundColor(.gray)
                            .frame(maxWidth: .infinity)
                            .padding(.top, 24)
                    } else {
                        ForEach(viewModel.comments) { comment in
                            CommentRow(comment: comment)
                                .padding(.horizontal)
                                .swipeActions(edge: .trailing) {
                                    if viewModel.canDelete(comment) {
                                        Button(role: .destructive) {
                                            viewModel.deleteComment(comment)
                                        } label: {
                                            Label("删除", systemImage: "trash")
                                        }
                                    }
                                }
                        }
                    }
                }
                .padding(.vertical)
            }

            Divider()

            HStack(spacing: 8) {
                TextField("写评论…", text: $newComment)
                    .textFieldStyle(.roundedBorder)
                    .focused($commentFocused)

                Button(action: submitComment) {
                    Image(systemName: "paperplane.fill")
                        .foregroundColor(canSend ? .blue : .gray)
                }
                .disabled(!canSend)
            }
            .padding()
        }
        .navigationTitle("动态详情")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await viewModel.load()
        }
    }

    private var canSend: Bool {
        !newComment.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func submitComment() {
        let text = newComment
        newComment = ""
        commentFocused = false
        Task { await viewModel.addComment(text) }
    }
}

// MARK: - Comment Row

struct CommentRow: View {
    let comment: SocialComment

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(comment.displayAuthor)
                    .font(.subheadline)
                    .fontWeight(.medium)
                Spacer()
                Text(comment.createdAt, style: .relative)
                    .font(.caption)
                    .foregroundColor(.gray)
            }
            Text(comment.content)
                .font(.body)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, 4)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

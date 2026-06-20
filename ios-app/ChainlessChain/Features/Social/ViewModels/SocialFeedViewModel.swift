import Foundation
import SwiftUI
import CoreCommon

/// 社交「广场」时间线 ViewModel
@MainActor
class SocialFeedViewModel: ObservableObject {
    @Published var posts: [SocialPost] = []
    @Published var isLoading = false
    @Published var errorMessage: String?

    private let repository = SocialRepository.shared
    private let logger = Logger.shared

    private var currentDID: String { AppState.shared.currentDID ?? "" }

    func loadFeed() async {
        guard !currentDID.isEmpty else {
            posts = []
            return
        }

        isLoading = true
        defer { isLoading = false }

        do {
            posts = try repository.getFeed(currentDID: currentDID)
        } catch {
            logger.error("Failed to load social feed", error: error, category: "Social")
            errorMessage = error.localizedDescription
        }
    }

    func refresh() async {
        await loadFeed()
    }

    func publish(content: String, visibility: PostVisibility) async {
        let trimmed = content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !currentDID.isEmpty else { return }

        do {
            let post = try repository.createPost(authorDID: currentDID, content: trimmed, visibility: visibility)
            posts.insert(post, at: 0)
        } catch {
            logger.error("Failed to publish post", error: error, category: "Social")
            errorMessage = error.localizedDescription
        }
    }

    func toggleLike(_ post: SocialPost) {
        guard !currentDID.isEmpty else { return }
        do {
            let result = try repository.toggleLike(postID: post.id, likerDID: currentDID)
            if let idx = posts.firstIndex(where: { $0.id == post.id }) {
                posts[idx].isLiked = result.isLiked
                posts[idx].likeCount = result.likeCount
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func deletePost(_ post: SocialPost) {
        do {
            try repository.deletePost(id: post.id)
            posts.removeAll { $0.id == post.id }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func canDelete(_ post: SocialPost) -> Bool {
        post.authorDID == currentDID
    }
}

/// 动态详情（评论）ViewModel
@MainActor
class PostDetailViewModel: ObservableObject {
    @Published var comments: [SocialComment] = []
    @Published var isLoading = false
    @Published var errorMessage: String?

    let post: SocialPost
    private let repository = SocialRepository.shared

    private var currentDID: String { AppState.shared.currentDID ?? "" }

    init(post: SocialPost) {
        self.post = post
    }

    func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            comments = try repository.getComments(postID: post.id)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func addComment(_ content: String) async {
        let trimmed = content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !currentDID.isEmpty else { return }
        do {
            let comment = try repository.addComment(postID: post.id, authorDID: currentDID, content: trimmed)
            comments.append(comment)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func canDelete(_ comment: SocialComment) -> Bool {
        comment.authorDID == currentDID
    }

    func deleteComment(_ comment: SocialComment) {
        do {
            try repository.deleteComment(id: comment.id, postID: post.id)
            comments.removeAll { $0.id == comment.id }
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

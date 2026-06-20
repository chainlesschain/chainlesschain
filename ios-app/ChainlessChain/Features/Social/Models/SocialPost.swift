import Foundation

/// 帖子可见性（与 Android `PostEntity.visibility` 对齐）
enum PostVisibility: String, CaseIterable, Identifiable {
    case publicAll = "public"
    case friends = "friends"
    case privateOnly = "private"

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .publicAll: return "公开"
        case .friends: return "仅好友"
        case .privateOnly: return "仅自己"
        }
    }

    var systemImage: String {
        switch self {
        case .publicAll: return "globe"
        case .friends: return "person.2"
        case .privateOnly: return "lock"
        }
    }
}

/// 去中心化社交「动态」帖子
struct SocialPost: Identifiable, Equatable {
    let id: String
    let authorDID: String
    var content: String
    var mediaURLs: [String]
    var likeCount: Int
    var commentCount: Int
    var shareCount: Int
    var isLiked: Bool
    var visibility: PostVisibility
    let createdAt: Date
    var updatedAt: Date

    /// 作者展示名（DID 末尾片段兜底；好友昵称由调用方覆盖）
    var displayAuthor: String {
        if authorDID.count > 12 {
            return "…" + authorDID.suffix(8)
        }
        return authorDID
    }

    static func == (lhs: SocialPost, rhs: SocialPost) -> Bool {
        lhs.id == rhs.id &&
        lhs.content == rhs.content &&
        lhs.likeCount == rhs.likeCount &&
        lhs.commentCount == rhs.commentCount &&
        lhs.isLiked == rhs.isLiked
    }
}

/// 帖子评论
struct SocialComment: Identifiable, Equatable {
    let id: String
    let postID: String
    let authorDID: String
    var content: String
    let parentCommentID: String?
    let createdAt: Date

    var displayAuthor: String {
        if authorDID.count > 12 {
            return "…" + authorDID.suffix(8)
        }
        return authorDID
    }
}

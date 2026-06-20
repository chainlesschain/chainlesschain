import Foundation
import SQLite3
import CoreCommon
import CoreDatabase

/// 去中心化社交「动态」仓储（帖子 / 评论 / 点赞）。
/// 与 Android `PostRepository` / `PostInteractionDao` 对齐。
/// 作者 DID 由调用方（@MainActor 的 ViewModel）从 `AppState.currentDID` 传入，
/// 避免在非主线程上下文里访问 @MainActor 隔离的全局状态。
class SocialRepository {
    static let shared = SocialRepository()

    private let logger = Logger.shared
    private let db = DatabaseManager.shared

    private init() {}

    // MARK: - Posts

    @discardableResult
    func createPost(authorDID: String, content: String, visibility: PostVisibility, mediaURLs: [String] = []) throws -> SocialPost {
        let id = UUID().uuidString
        let now = Date()
        let ts = now.timestampMs
        let media = mediaURLs.joined(separator: ",")

        let sql = """
            INSERT INTO social_posts (
                id, author_did, content, media_urls, like_count, comment_count,
                share_count, is_liked, visibility, created_at, updated_at
            ) VALUES (?, ?, ?, ?, 0, 0, 0, 0, ?, ?, ?);
        """
        try db.execute(sql, parameters: [id, authorDID, content, media, visibility.rawValue, ts, ts])
        logger.info("Created social post: \(id)", category: "Social")

        return SocialPost(
            id: id, authorDID: authorDID, content: content, mediaURLs: mediaURLs,
            likeCount: 0, commentCount: 0, shareCount: 0, isLiked: false,
            visibility: visibility, createdAt: now, updatedAt: now
        )
    }

    /// 时间线：公开 + 仅好友的帖子，外加自己的全部帖子（含 private）。
    func getFeed(currentDID: String, limit: Int = 100, offset: Int = 0) throws -> [SocialPost] {
        let sql = """
            SELECT p.id, p.author_did, p.content, p.media_urls, p.like_count,
                   p.comment_count, p.share_count, p.visibility, p.created_at, p.updated_at,
                   CASE WHEN l.liker_did IS NOT NULL THEN 1 ELSE 0 END AS is_liked
            FROM social_posts p
            LEFT JOIN social_post_likes l ON l.post_id = p.id AND l.liker_did = ?
            WHERE p.visibility != 'private' OR p.author_did = ?
            ORDER BY p.created_at DESC
            LIMIT ? OFFSET ?;
        """
        return try db.query(sql, parameters: [currentDID, currentDID, limit, offset], mapper: mapPost)
    }

    func getUserPosts(authorDID: String, currentDID: String, limit: Int = 100) throws -> [SocialPost] {
        let sql = """
            SELECT p.id, p.author_did, p.content, p.media_urls, p.like_count,
                   p.comment_count, p.share_count, p.visibility, p.created_at, p.updated_at,
                   CASE WHEN l.liker_did IS NOT NULL THEN 1 ELSE 0 END AS is_liked
            FROM social_posts p
            LEFT JOIN social_post_likes l ON l.post_id = p.id AND l.liker_did = ?
            WHERE p.author_did = ?
            ORDER BY p.created_at DESC
            LIMIT ?;
        """
        return try db.query(sql, parameters: [currentDID, authorDID, limit], mapper: mapPost)
    }

    func deletePost(id: String) throws {
        try db.execute("DELETE FROM social_post_likes WHERE post_id = ?;", parameters: [id])
        try db.execute("DELETE FROM social_post_comments WHERE post_id = ?;", parameters: [id])
        try db.execute("DELETE FROM social_posts WHERE id = ?;", parameters: [id])
        logger.info("Deleted social post: \(id)", category: "Social")
    }

    /// 点赞 / 取消点赞，返回最新 (isLiked, likeCount)。
    @discardableResult
    func toggleLike(postID: String, likerDID: String) throws -> (isLiked: Bool, likeCount: Int) {
        let existing: Int = try db.queryOne(
            "SELECT COUNT(*) FROM social_post_likes WHERE post_id = ? AND liker_did = ?;",
            parameters: [postID, likerDID]
        ) { stmt in Int(sqlite3_column_int(stmt, 0)) } ?? 0

        if existing > 0 {
            try db.execute("DELETE FROM social_post_likes WHERE post_id = ? AND liker_did = ?;", parameters: [postID, likerDID])
            try db.execute("UPDATE social_posts SET like_count = MAX(like_count - 1, 0), is_liked = 0 WHERE id = ?;", parameters: [postID])
        } else {
            try db.execute(
                "INSERT INTO social_post_likes (post_id, liker_did, created_at) VALUES (?, ?, ?);",
                parameters: [postID, likerDID, Date().timestampMs]
            )
            try db.execute("UPDATE social_posts SET like_count = like_count + 1, is_liked = 1 WHERE id = ?;", parameters: [postID])
        }

        let count: Int = try db.queryOne("SELECT like_count FROM social_posts WHERE id = ?;", parameters: [postID]) { stmt in
            Int(sqlite3_column_int(stmt, 0))
        } ?? 0
        return (isLiked: existing == 0, likeCount: count)
    }

    // MARK: - Comments

    @discardableResult
    func addComment(postID: String, authorDID: String, content: String, parentCommentID: String? = nil) throws -> SocialComment {
        let id = UUID().uuidString
        let now = Date()
        try db.execute(
            "INSERT INTO social_post_comments (id, post_id, author_did, content, parent_comment_id, created_at) VALUES (?, ?, ?, ?, ?, ?);",
            parameters: [id, postID, authorDID, content, parentCommentID, now.timestampMs]
        )
        try db.execute("UPDATE social_posts SET comment_count = comment_count + 1 WHERE id = ?;", parameters: [postID])
        logger.info("Added comment \(id) to post \(postID)", category: "Social")

        return SocialComment(
            id: id, postID: postID, authorDID: authorDID,
            content: content, parentCommentID: parentCommentID, createdAt: now
        )
    }

    func getComments(postID: String) throws -> [SocialComment] {
        let sql = """
            SELECT id, post_id, author_did, content, parent_comment_id, created_at
            FROM social_post_comments
            WHERE post_id = ?
            ORDER BY created_at ASC;
        """
        return try db.query(sql, parameters: [postID], mapper: mapComment)
    }

    func deleteComment(id: String, postID: String) throws {
        try db.execute("DELETE FROM social_post_comments WHERE id = ?;", parameters: [id])
        try db.execute("UPDATE social_posts SET comment_count = MAX(comment_count - 1, 0) WHERE id = ?;", parameters: [postID])
    }

    // MARK: - Mappers

    private func mapPost(_ stmt: OpaquePointer) -> SocialPost? {
        guard let idC = sqlite3_column_text(stmt, 0),
              let authorC = sqlite3_column_text(stmt, 1),
              let contentC = sqlite3_column_text(stmt, 2) else {
            return nil
        }

        let mediaStr = sqlite3_column_text(stmt, 3).map { String(cString: $0) } ?? ""
        let media = mediaStr.isEmpty ? [] : mediaStr.split(separator: ",").map(String.init)
        let visStr = sqlite3_column_text(stmt, 7).map { String(cString: $0) } ?? "public"

        return SocialPost(
            id: String(cString: idC),
            authorDID: String(cString: authorC),
            content: String(cString: contentC),
            mediaURLs: media,
            likeCount: Int(sqlite3_column_int(stmt, 4)),
            commentCount: Int(sqlite3_column_int(stmt, 5)),
            shareCount: Int(sqlite3_column_int(stmt, 6)),
            isLiked: Int(sqlite3_column_int(stmt, 10)) == 1,
            visibility: PostVisibility(rawValue: visStr) ?? .publicAll,
            createdAt: Date(timestampMs: sqlite3_column_int64(stmt, 8)),
            updatedAt: Date(timestampMs: sqlite3_column_int64(stmt, 9))
        )
    }

    private func mapComment(_ stmt: OpaquePointer) -> SocialComment? {
        guard let idC = sqlite3_column_text(stmt, 0),
              let postC = sqlite3_column_text(stmt, 1),
              let authorC = sqlite3_column_text(stmt, 2),
              let contentC = sqlite3_column_text(stmt, 3) else {
            return nil
        }
        let parent = sqlite3_column_text(stmt, 4).map { String(cString: $0) }

        return SocialComment(
            id: String(cString: idC),
            postID: String(cString: postC),
            authorDID: String(cString: authorC),
            content: String(cString: contentC),
            parentCommentID: parent,
            createdAt: Date(timestampMs: sqlite3_column_int64(stmt, 5))
        )
    }
}

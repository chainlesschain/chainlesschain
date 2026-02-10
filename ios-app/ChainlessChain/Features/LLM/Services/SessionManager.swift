import Foundation
import CoreCommon
import Combine

/// 会话上下文管理器
/// 功能：
/// - 会话持久化
/// - 智能上下文压缩
/// - 跨会话连续对话
/// - Token 使用优化（减少 30-40%）
/// - 自动摘要生成
/// - 预压缩记忆刷新
@MainActor
public class SessionManager: ObservableObject {

    // MARK: - Singleton

    public static let shared = SessionManager()

    // MARK: - Configuration

    public struct Config {
        public var maxHistoryMessages: Int = 10
        public var compressionThreshold: Int = 10
        public var enableAutoSave: Bool = true
        public var enableCompression: Bool = true
        public var enableAutoSummary: Bool = true
        public var autoSummaryThreshold: Int = 5
        public var enableMemoryFlush: Bool = true

        public init() {}
    }

    // MARK: - Properties

    private let database: Database
    private var config: Config

    /// 会话缓存
    private var sessionCache: [String: Session] = [:]

    /// 后台摘要队列
    private var summaryQueue: [String] = []
    private var isGeneratingSummary = false

    /// 事件发布器
    public let sessionCreated = PassthroughSubject<Session, Never>()
    public let sessionUpdated = PassthroughSubject<Session, Never>()
    public let sessionDeleted = PassthroughSubject<String, Never>()
    public let messageAdded = PassthroughSubject<(String, SessionMessage), Never>()
    public let sessionCompressed = PassthroughSubject<(String, Double, Int), Never>()

    // MARK: - Initialization

    private init() {
        self.database = Database.shared
        self.config = Config()
        Logger.shared.info("[SessionManager] 会话管理器已初始化")
    }

    /// 配置会话管理器
    public func configure(_ config: Config) {
        self.config = config
        Logger.shared.info("[SessionManager] 配置已更新")
    }

    /// 初始化数据库表
    public func initialize() async throws {
        Logger.shared.info("[SessionManager] 初始化数据库表...")

        let createTableSQL = """
        CREATE TABLE IF NOT EXISTS llm_sessions (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            title TEXT NOT NULL,
            messages_json TEXT NOT NULL,
            compressed_history_json TEXT,
            metadata_json TEXT NOT NULL,
            tags_json TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )
        """

        try await database.execute(createTableSQL)

        // 创建索引
        try await database.execute("CREATE INDEX IF NOT EXISTS idx_llm_sessions_conversation ON llm_sessions(conversation_id)")
        try await database.execute("CREATE INDEX IF NOT EXISTS idx_llm_sessions_updated ON llm_sessions(updated_at DESC)")

        Logger.shared.info("[SessionManager] 数据库表初始化成功")
    }

    // MARK: - Session CRUD

    /// 创建新会话
    public func createSession(
        conversationId: String,
        title: String? = nil,
        metadata: SessionMetadata? = nil
    ) async throws -> Session {
        guard !conversationId.isEmpty else {
            throw SessionError.invalidConversationId
        }

        let session = Session(
            conversationId: conversationId,
            title: title,
            metadata: metadata
        )

        try await saveSessionToDatabase(session)

        // 缓存
        sessionCache[session.id] = session

        Logger.shared.info("[SessionManager] 会话已创建: \(session.id)")

        sessionCreated.send(session)

        return session
    }

    /// 加载会话
    public func loadSession(
        sessionId: String,
        fromCache: Bool = true
    ) async throws -> Session {
        // 尝试从缓存加载
        if fromCache, let cached = sessionCache[sessionId] {
            return cached
        }

        // 从数据库加载
        let query = "SELECT * FROM llm_sessions WHERE id = ?"
        let rows = try await database.query(query, [sessionId])

        guard let row = rows.first else {
            throw SessionError.sessionNotFound
        }

        guard let session = parseSession(from: row) else {
            throw SessionError.loadFailed
        }

        // 缓存
        sessionCache[sessionId] = session

        return session
    }

    /// 添加消息到会话
    public func addMessage(
        sessionId: String,
        message: SessionMessage
    ) async throws -> Session {
        var session = try await loadSession(sessionId: sessionId)

        // 添加消息
        session.messages.append(message)
        session.metadata.messageCount = session.messages.count
        session.updatedAt = Date()

        // 检查是否需要压缩
        if config.enableCompression && session.messages.count >= config.compressionThreshold {
            Logger.shared.info("[SessionManager] 消息数达到阈值，触发压缩")
            session = try await compressSession(session)
        }

        // 自动保存
        if config.enableAutoSave {
            try await saveSession(session)
        }

        // 检查是否需要自动生成摘要
        if config.enableAutoSummary && shouldAutoGenerateSummary(session) {
            queueAutoSummary(sessionId: sessionId)
        }

        messageAdded.send((sessionId, message))

        return session
    }

    /// 保存会话
    public func saveSession(_ session: Session) async throws {
        var updatedSession = session
        updatedSession.updatedAt = Date()

        try await saveSessionToDatabase(updatedSession)

        // 更新缓存
        sessionCache[session.id] = updatedSession

        Logger.shared.info("[SessionManager] 会话已保存: \(session.id)")

        sessionUpdated.send(updatedSession)
    }

    /// 删除会话
    public func deleteSession(sessionId: String) async throws {
        try await database.execute("DELETE FROM llm_sessions WHERE id = ?", [sessionId])

        // 从缓存删除
        sessionCache.removeValue(forKey: sessionId)

        Logger.shared.info("[SessionManager] 会话已删除: \(sessionId)")

        sessionDeleted.send(sessionId)
    }

    /// 列出会话
    public func listSessions(
        conversationId: String? = nil,
        limit: Int = 50,
        offset: Int = 0
    ) async throws -> [Session] {
        var query = "SELECT * FROM llm_sessions"
        var params: [Any] = []

        if let convId = conversationId {
            query += " WHERE conversation_id = ?"
            params.append(convId)
        }

        query += " ORDER BY updated_at DESC LIMIT ? OFFSET ?"
        params.append(limit)
        params.append(offset)

        let rows = try await database.query(query, params)
        return rows.compactMap { parseSession(from: $0) }
    }

    // MARK: - Compression

    /// 压缩会话
    public func compressSession(_ session: Session) async throws -> Session {
        var compressedSession = session

        guard session.messages.count > config.maxHistoryMessages else {
            return session
        }

        Logger.shared.info("[SessionManager] 开始压缩会话: \(session.id)")

        // 预压缩记忆刷新
        if config.enableMemoryFlush {
            try? await flushMemoryBeforeCompaction(session)
        }

        let originalCount = session.messages.count

        // 保留系统消息和最近的用户消息
        var preservedMessages: [SessionMessage] = []

        // 保留系统消息
        if let systemMessage = session.messages.first(where: { $0.role == .system }) {
            preservedMessages.append(systemMessage)
        }

        // 保留最近的消息
        let recentMessages = Array(session.messages.suffix(config.maxHistoryMessages))
        preservedMessages.append(contentsOf: recentMessages.filter { $0.role != .system })

        // 生成压缩摘要（可选）
        let summary = await generateCompressionSummary(for: session.messages)
        if let summaryMessage = summary {
            preservedMessages.insert(summaryMessage, at: 1)  // 在系统消息后插入
        }

        compressedSession.messages = preservedMessages

        let compressedCount = preservedMessages.count
        let compressionRatio = Double(originalCount - compressedCount) / Double(originalCount)

        compressedSession.compressedHistory = CompressedHistory(
            originalCount: originalCount,
            compressedCount: compressedCount,
            compressionRatio: compressionRatio,
            strategy: .hybrid
        )

        compressedSession.metadata.compressionCount += 1
        compressedSession.metadata.totalTokensSaved += (originalCount - compressedCount) * 50  // 估算

        try await saveSession(compressedSession)

        Logger.shared.info("[SessionManager] 压缩完成: 原始=\(originalCount), 压缩后=\(compressedCount), 压缩率=\(String(format: "%.2f", compressionRatio))")

        sessionCompressed.send((session.id, compressionRatio, originalCount - compressedCount))

        return compressedSession
    }

    /// 生成压缩摘要
    private func generateCompressionSummary(for messages: [SessionMessage]) async -> SessionMessage? {
        // 简化版本：生成文本摘要
        let conversations = messages.prefix(messages.count - config.maxHistoryMessages)

        guard !conversations.isEmpty else { return nil }

        let summaryText = conversations.map { msg in
            let role = msg.role == .user ? "用户" : "AI"
            return "[\(role)] \(msg.content.prefix(100))"
        }.joined(separator: "\n")

        let summary = "【历史对话摘要】\n\(summaryText)"

        return SessionMessage(
            role: .system,
            content: summary
        )
    }

    // MARK: - Memory Flush

    /// 预压缩记忆刷新
    private func flushMemoryBeforeCompaction(_ session: Session) async throws {
        Logger.shared.info("[SessionManager] 开始预压缩记忆刷新: \(session.id)")

        // 提取最近的消息
        let recentMessages = Array(session.messages.suffix(10))

        guard !recentMessages.isEmpty else {
            Logger.shared.info("[SessionManager] 没有消息需要提取记忆")
            return
        }

        // 集成 PermanentMemoryManager
        let memoryManager = PermanentMemoryManager.shared

        // 1. 格式化对话内容用于 Daily Notes
        let timestamp = formatTime(Date())
        let sessionTitle = session.metadata.title ?? "对话"

        var dailyNoteContent = "### \(timestamp) - \(sessionTitle)\n\n"

        // 提取对话要点
        for message in recentMessages {
            let roleLabel = message.role == .user ? "👤 用户" : "🤖 AI"
            let contentPreview = String(message.content.prefix(150))
            dailyNoteContent += "- \(roleLabel): \(contentPreview)\n"
        }

        // 生成对话摘要
        if let summary = extractConversationSummary(from: recentMessages) {
            dailyNoteContent += "\n**摘要**: \(summary)\n"
        }

        // 2. 写入 Daily Notes
        do {
            _ = try await memoryManager.writeDailyNote(dailyNoteContent, append: true)
            Logger.shared.info("[SessionManager] Daily Note 已更新")
        } catch {
            Logger.shared.warning("[SessionManager] 写入 Daily Note 失败: \(error)")
        }

        // 3. 提取重要信息到 MEMORY.md (可选)
        if let insight = extractImportantInsight(from: recentMessages) {
            do {
                let section = MemorySection.detect(from: insight)
                try await memoryManager.appendToMemory(insight, section: section)
                Logger.shared.info("[SessionManager] 重要信息已保存到 MEMORY.md")
            } catch {
                Logger.shared.warning("[SessionManager] 写入 MEMORY.md 失败: \(error)")
            }
        }

        Logger.shared.info("[SessionManager] 预压缩记忆刷新完成")
    }

    /// 格式化时间
    private func formatTime(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm"
        return formatter.string(from: date)
    }

    /// 提取对话摘要
    private func extractConversationSummary(from messages: [SessionMessage]) -> String? {
        guard messages.count >= 2 else { return nil }

        // 提取用户的主要问题
        let userMessages = messages.filter { $0.role == .user }
        guard let firstUserMessage = userMessages.first else { return nil }

        let question = String(firstUserMessage.content.prefix(100))

        // 提取AI的回答要点
        let assistantMessages = messages.filter { $0.role == .assistant }
        guard let lastAssistantMessage = assistantMessages.last else {
            return "用户询问: \(question)"
        }

        let answer = String(lastAssistantMessage.content.prefix(100))

        return "用户询问「\(question)」，AI回复「\(answer)」"
    }

    /// 提取重要信息 (用于长期记忆)
    private func extractImportantInsight(from messages: [SessionMessage]) -> String? {
        // 检测是否包含重要信息的关键词
        let importantKeywords = ["决定", "决策", "解决方案", "发现", "问题", "偏好", "配置", "架构", "设计"]

        for message in messages where message.role == .assistant {
            let content = message.content.lowercased()
            for keyword in importantKeywords {
                if content.contains(keyword) {
                    // 提取包含关键词的段落
                    let preview = String(message.content.prefix(200))
                    let dateStr = formatDate(message.timestamp)
                    return "[\(dateStr)] \(preview)"
                }
            }
        }

        return nil
    }

    /// 格式化日期
    private func formatDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }

    // MARK: - Auto Summary

    private func shouldAutoGenerateSummary(_ session: Session) -> Bool {
        // 已有摘要且最近更新过
        if let _ = session.metadata.summary,
           let _ = session.metadata.summaryGeneratedAt {
            let messagesAfterSummary = session.metadata.messageCount - (session.metadata.messageCountAtSummary ?? 0)
            if messagesAfterSummary < config.autoSummaryThreshold {
                return false
            }
        }

        return session.messages.count >= config.autoSummaryThreshold
    }

    private func queueAutoSummary(sessionId: String) {
        guard !summaryQueue.contains(sessionId) else { return }

        summaryQueue.append(sessionId)
        Logger.shared.info("[SessionManager] 会话 \(sessionId) 加入自动摘要队列")

        if !isGeneratingSummary {
            Task {
                await processAutoSummaryQueue()
            }
        }
    }

    private func processAutoSummaryQueue() async {
        guard !isGeneratingSummary, !summaryQueue.isEmpty else { return }

        isGeneratingSummary = true

        while !summaryQueue.isEmpty {
            let sessionId = summaryQueue.removeFirst()

            do {
                try await generateAutoSummary(sessionId: sessionId)
            } catch {
                Logger.shared.error("[SessionManager] 自动摘要生成失败 \(sessionId): \(error)")
            }

            try? await Task.sleep(nanoseconds: 500_000_000)  // 0.5秒延迟
        }

        isGeneratingSummary = false
    }

    private func generateAutoSummary(sessionId: String) async throws {
        var session = try await loadSession(sessionId: sessionId)

        guard shouldAutoGenerateSummary(session) else {
            Logger.shared.info("[SessionManager] 会话 \(sessionId) 不需要自动摘要")
            return
        }

        Logger.shared.info("[SessionManager] 开始自动生成摘要: \(sessionId)")

        // 生成摘要
        let summaryContent = generateTextSummary(for: session.messages)

        session.metadata.summary = summaryContent
        session.metadata.summaryGeneratedAt = Date()
        session.metadata.messageCountAtSummary = session.metadata.messageCount
        session.metadata.autoSummaryGenerated = true

        try await saveSession(session)

        Logger.shared.info("[SessionManager] 自动摘要完成: \(sessionId)")
    }

    private func generateTextSummary(for messages: [SessionMessage]) -> String {
        // 简单的文本摘要
        let userMessages = messages.filter { $0.role == .user }
        let topics = userMessages.prefix(5).map { $0.content.prefix(50) }

        return "讨论主题: \(topics.joined(separator: "; "))"
    }

    // MARK: - Search

    /// 搜索会话
    public func searchSessions(
        query: String,
        searchContent: Bool = true,
        searchTitle: Bool = true,
        tags: [String] = [],
        limit: Int = 20,
        offset: Int = 0
    ) async throws -> [SessionSearchResult] {
        guard !query.trimmingCharacters(in: .whitespaces).isEmpty else {
            let sessions = try await listSessions(limit: limit, offset: offset)
            return sessions.map { SessionSearchResult(session: $0, matchType: .title) }
        }

        var results: [SessionSearchResult] = []
        let searchTerm = "%\(query)%"

        // 搜索标题
        if searchTitle {
            let titleQuery = """
            SELECT * FROM llm_sessions
            WHERE title LIKE ?
            ORDER BY updated_at DESC
            LIMIT ? OFFSET ?
            """
            let titleRows = try await database.query(titleQuery, [searchTerm, limit, offset])
            for row in titleRows {
                if let session = parseSession(from: row) {
                    results.append(SessionSearchResult(session: session, matchType: .title))
                }
            }
        }

        // 搜索内容
        if searchContent {
            let contentQuery = """
            SELECT * FROM llm_sessions
            WHERE messages_json LIKE ?
            ORDER BY updated_at DESC
            LIMIT ? OFFSET ?
            """
            let contentRows = try await database.query(contentQuery, [searchTerm, limit, offset])
            for row in contentRows {
                if let session = parseSession(from: row) {
                    // 避免重复
                    if !results.contains(where: { $0.session.id == session.id }) {
                        results.append(SessionSearchResult(session: session, matchType: .content, matchedContent: query))
                    }
                }
            }
        }

        return results
    }

    // MARK: - Tags

    /// 添加标签
    public func addTag(sessionId: String, tag: String) async throws {
        var session = try await loadSession(sessionId: sessionId)

        guard !session.tags.contains(tag) else { return }

        session.tags.append(tag)
        try await saveSession(session)
    }

    /// 移除标签
    public func removeTag(sessionId: String, tag: String) async throws {
        var session = try await loadSession(sessionId: sessionId)

        session.tags.removeAll { $0 == tag }
        try await saveSession(session)
    }

    // MARK: - Export/Import

    /// 导出会话
    public func exportSession(
        sessionId: String,
        format: SessionExportFormat
    ) async throws -> Data {
        let session = try await loadSession(sessionId: sessionId)

        switch format {
        case .json:
            return try JSONEncoder().encode(session)

        case .markdown:
            let markdown = generateMarkdownExport(session)
            return markdown.data(using: .utf8) ?? Data()

        case .plainText:
            let text = generatePlainTextExport(session)
            return text.data(using: .utf8) ?? Data()
        }
    }

    /// 导入会话
    public func importSession(
        data: Data,
        format: SessionExportFormat
    ) async throws -> Session {
        switch format {
        case .json:
            var session = try JSONDecoder().decode(Session.self, from: data)
            session = Session(
                id: UUID().uuidString,  // 新ID
                conversationId: session.conversationId,
                title: session.title,
                messages: session.messages,
                metadata: session.metadata,
                tags: session.tags
            )
            try await saveSessionToDatabase(session)
            return session

        case .markdown, .plainText:
            throw SessionError.importFailed
        }
    }

    private func generateMarkdownExport(_ session: Session) -> String {
        var markdown = "# \(session.title)\n\n"
        markdown += "**创建时间**: \(session.createdAt.formatted())\n"
        markdown += "**更新时间**: \(session.updatedAt.formatted())\n\n"
        markdown += "---\n\n"

        for message in session.messages {
            let role = message.role == .user ? "👤 用户" : "🤖 AI"
            markdown += "### \(role)\n\n"
            markdown += message.content + "\n\n"
        }

        return markdown
    }

    private func generatePlainTextExport(_ session: Session) -> String {
        var text = "\(session.title)\n"
        text += String(repeating: "=", count: session.title.count) + "\n\n"

        for message in session.messages {
            let role = message.role == .user ? "[用户]" : "[AI]"
            text += "\(role)\n\(message.content)\n\n"
        }

        return text
    }

    // MARK: - Stats

    /// 获取会话统计
    public func getSessionStats(sessionId: String) async throws -> SessionStats {
        let session = try await loadSession(sessionId: sessionId)

        var lastCompression: CompressionStats?
        if let history = session.compressedHistory {
            lastCompression = CompressionStats(
                originalTokens: history.originalCount,
                compressedTokens: history.compressedCount,
                compressionRatio: history.compressionRatio,
                compressedAt: history.compressedAt
            )
        }

        return SessionStats(
            sessionId: session.id,
            conversationId: session.conversationId,
            messageCount: session.messages.count,
            compressionCount: session.metadata.compressionCount,
            totalTokensSaved: session.metadata.totalTokensSaved,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
            lastCompression: lastCompression
        )
    }

    // MARK: - Cleanup

    /// 清理旧会话
    public func cleanupOldSessions(daysToKeep: Int = 30) async throws -> Int {
        let cutoffTimestamp = Int(Date().timeIntervalSince1970) - (daysToKeep * 24 * 60 * 60)

        let query = "SELECT id FROM llm_sessions WHERE updated_at < ?"
        let rows = try await database.query(query, [cutoffTimestamp])

        var deletedCount = 0
        for row in rows {
            if let sessionId = row["id"] as? String {
                try await deleteSession(sessionId: sessionId)
                deletedCount += 1
            }
        }

        Logger.shared.info("[SessionManager] 已清理 \(deletedCount) 个旧会话")

        return deletedCount
    }

    // MARK: - Database Operations

    private func saveSessionToDatabase(_ session: Session) async throws {
        let messagesJson = try JSONEncoder().encode(session.messages).utf8String ?? "[]"
        let compressedHistoryJson = session.compressedHistory != nil
            ? try? JSONEncoder().encode(session.compressedHistory).utf8String
            : nil
        let metadataJson = try JSONEncoder().encode(session.metadata).utf8String ?? "{}"
        let tagsJson = try JSONEncoder().encode(session.tags).utf8String ?? "[]"

        let sql = """
        INSERT OR REPLACE INTO llm_sessions (
            id, conversation_id, title, messages_json, compressed_history_json,
            metadata_json, tags_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """

        try await database.execute(sql, [
            session.id,
            session.conversationId,
            session.title,
            messagesJson,
            compressedHistoryJson as Any,
            metadataJson,
            tagsJson,
            Int(session.createdAt.timeIntervalSince1970),
            Int(session.updatedAt.timeIntervalSince1970)
        ])
    }

    private func parseSession(from row: [String: Any]) -> Session? {
        guard
            let id = row["id"] as? String,
            let conversationId = row["conversation_id"] as? String,
            let title = row["title"] as? String,
            let messagesJson = row["messages_json"] as? String,
            let metadataJson = row["metadata_json"] as? String,
            let createdAtTimestamp = row["created_at"] as? Int,
            let updatedAtTimestamp = row["updated_at"] as? Int,
            let messagesData = messagesJson.data(using: .utf8),
            let metadataData = metadataJson.data(using: .utf8),
            let messages = try? JSONDecoder().decode([SessionMessage].self, from: messagesData),
            let metadata = try? JSONDecoder().decode(SessionMetadata.self, from: metadataData)
        else {
            return nil
        }

        var compressedHistory: CompressedHistory?
        if let historyJson = row["compressed_history_json"] as? String,
           let historyData = historyJson.data(using: .utf8) {
            compressedHistory = try? JSONDecoder().decode(CompressedHistory.self, from: historyData)
        }

        var tags: [String] = []
        if let tagsJson = row["tags_json"] as? String,
           let tagsData = tagsJson.data(using: .utf8) {
            tags = (try? JSONDecoder().decode([String].self, from: tagsData)) ?? []
        }

        return Session(
            id: id,
            conversationId: conversationId,
            title: title,
            messages: messages,
            compressedHistory: compressedHistory,
            metadata: metadata,
            tags: tags,
            createdAt: Date(timeIntervalSince1970: TimeInterval(createdAtTimestamp)),
            updatedAt: Date(timeIntervalSince1970: TimeInterval(updatedAtTimestamp))
        )
    }
}

// MARK: - Data Extension

private extension Data {
    var utf8String: String? {
        return String(data: self, encoding: .utf8)
    }
}

import Foundation
import CoreCommon
import Combine
import CryptoKit

/// 永久记忆管理器
/// 实现 Clawdbot 风格的永久记忆机制:
/// 1. Daily Notes (每日日志) - memory/daily/YYYY-MM-DD.md
/// 2. MEMORY.md (长期知识库) - memory/MEMORY.md
/// 3. 自动索引更新
/// 4. 混合搜索 (Vector + BM25)
@MainActor
public class PermanentMemoryManager: ObservableObject {

    // MARK: - Singleton

    public static let shared = PermanentMemoryManager()

    // MARK: - Configuration

    public struct Config {
        public var enableDailyNotes: Bool = true
        public var enableLongTermMemory: Bool = true
        public var enableAutoIndexing: Bool = true
        public var maxDailyNotesRetention: Int = 30  // 保留天数
        public var vectorWeight: Double = 0.6
        public var textWeight: Double = 0.4
        public var rrfK: Int = 60

        public init() {}
    }

    // MARK: - Properties

    private let database: Database
    private let fileManager = FileManager.default
    private var config: Config

    /// 目录路径
    private var memoryDir: URL {
        let documentsDir = fileManager.urls(for: .documentDirectory, in: .userDomainMask)[0]
        return documentsDir.appendingPathComponent(".chainlesschain/memory")
    }

    private var dailyNotesDir: URL {
        return memoryDir.appendingPathComponent("daily")
    }

    private var memoryFilePath: URL {
        return memoryDir.appendingPathComponent("MEMORY.md")
    }

    private var indexDir: URL {
        return memoryDir.appendingPathComponent("index")
    }

    /// 缓存
    private var dailyNotesCache: [String: String] = [:]
    private var memoryContentCache: String?
    private var fileHashCache: [String: String] = [:]

    /// 事件发布器
    public let dailyNoteUpdated = PassthroughSubject<String, Never>()  // date
    public let memoryUpdated = PassthroughSubject<String?, Never>()    // section

    // MARK: - Initialization

    private init() {
        self.database = Database.shared
        self.config = Config()
        Logger.shared.info("[PermanentMemoryManager] 永久记忆管理器已初始化")
    }

    /// 配置管理器
    public func configure(_ config: Config) {
        self.config = config
    }

    /// 初始化目录结构和数据库表
    public func initialize() async throws {
        Logger.shared.info("[PermanentMemoryManager] 初始化...")

        // 创建目录
        try fileManager.createDirectory(at: memoryDir, withIntermediateDirectories: true)

        if config.enableDailyNotes {
            try fileManager.createDirectory(at: dailyNotesDir, withIntermediateDirectories: true)
        }

        if config.enableAutoIndexing {
            try fileManager.createDirectory(at: indexDir, withIntermediateDirectories: true)
        }

        // 创建 MEMORY.md
        if config.enableLongTermMemory {
            try await ensureMemoryFileExists()
        }

        // 初始化数据库表
        try await initializeTables()

        // 清理过期 Daily Notes
        if config.enableDailyNotes {
            try await cleanupExpiredDailyNotes()
        }

        // 初始化今日统计
        try await initializeTodayStats()

        Logger.shared.info("[PermanentMemoryManager] 初始化完成")
    }

    private func initializeTables() async throws {
        // Daily Notes 元数据表
        let createDailyNotesTableSQL = """
        CREATE TABLE IF NOT EXISTS daily_notes_metadata (
            date TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            conversation_count INTEGER DEFAULT 0,
            completed_tasks INTEGER DEFAULT 0,
            pending_tasks INTEGER DEFAULT 0,
            discoveries_count INTEGER DEFAULT 0,
            word_count INTEGER DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )
        """

        // 记忆统计表
        let createStatsTableSQL = """
        CREATE TABLE IF NOT EXISTS memory_stats (
            date TEXT PRIMARY KEY,
            daily_notes_count INTEGER DEFAULT 0,
            memory_sections_count INTEGER DEFAULT 0,
            cached_embeddings_count INTEGER DEFAULT 0,
            indexed_files_count INTEGER DEFAULT 0,
            updated_at INTEGER NOT NULL
        )
        """

        // Embedding 缓存表
        let createEmbeddingCacheTableSQL = """
        CREATE TABLE IF NOT EXISTS embedding_cache (
            content_hash TEXT PRIMARY KEY,
            embedding_json TEXT NOT NULL,
            content_preview TEXT,
            created_at INTEGER NOT NULL,
            accessed_at INTEGER NOT NULL
        )
        """

        // 文件哈希表
        let createFileHashesTableSQL = """
        CREATE TABLE IF NOT EXISTS memory_file_hashes (
            file_path TEXT PRIMARY KEY,
            content_hash TEXT NOT NULL,
            index_status TEXT DEFAULT 'pending',
            indexed_at INTEGER,
            updated_at INTEGER NOT NULL
        )
        """

        try await database.execute(createDailyNotesTableSQL)
        try await database.execute(createStatsTableSQL)
        try await database.execute(createEmbeddingCacheTableSQL)
        try await database.execute(createFileHashesTableSQL)
    }

    // MARK: - Daily Notes

    /// 写入今日 Daily Note
    public func writeDailyNote(
        _ content: String,
        append: Bool = true
    ) async throws -> URL {
        guard config.enableDailyNotes else {
            throw PermanentMemoryError.dailyNotesDisabled
        }

        let today = DailyNote.todayDateString()
        let filePath = dailyNotesDir.appendingPathComponent("\(today).md")

        var existingContent = ""
        var fileExists = false

        // 检查文件是否存在
        if fileManager.fileExists(atPath: filePath.path) {
            fileExists = true
            existingContent = try String(contentsOf: filePath, encoding: .utf8)
        }

        let fullContent: String
        if fileExists && append {
            fullContent = existingContent + "\n\n" + content
        } else if fileExists {
            fullContent = existingContent + "\n\n" + content
        } else {
            let header = getDailyNoteHeader(today)
            fullContent = header + "\n\n" + content
        }

        try fullContent.write(to: filePath, atomically: true, encoding: .utf8)

        // 更新缓存
        dailyNotesCache.removeValue(forKey: today)

        // 更新元数据
        try await updateDailyNoteMetadata(date: today, content: fullContent)

        Logger.shared.info("[PermanentMemoryManager] Daily Note 已更新: \(today)")

        dailyNoteUpdated.send(today)

        return filePath
    }

    /// 读取指定日期的 Daily Note
    public func readDailyNote(date: String) async throws -> String? {
        guard config.enableDailyNotes else {
            throw PermanentMemoryError.dailyNotesDisabled
        }

        // 检查缓存
        if let cached = dailyNotesCache[date] {
            return cached
        }

        let filePath = dailyNotesDir.appendingPathComponent("\(date).md")

        guard fileManager.fileExists(atPath: filePath.path) else {
            return nil
        }

        let content = try String(contentsOf: filePath, encoding: .utf8)
        dailyNotesCache[date] = content

        return content
    }

    /// 获取最近的 Daily Notes
    public func getRecentDailyNotes(limit: Int = 7) async throws -> [DailyNote] {
        let query = """
        SELECT * FROM daily_notes_metadata
        ORDER BY date DESC
        LIMIT ?
        """

        let rows = try await database.query(query, [limit])

        return rows.compactMap { row -> DailyNote? in
            guard
                let date = row["date"] as? String,
                let title = row["title"] as? String,
                let createdAtTimestamp = row["created_at"] as? Int,
                let updatedAtTimestamp = row["updated_at"] as? Int
            else {
                return nil
            }

            let metadata = DailyNoteMetadata(
                conversationCount: row["conversation_count"] as? Int ?? 0,
                completedTasks: row["completed_tasks"] as? Int ?? 0,
                pendingTasks: row["pending_tasks"] as? Int ?? 0,
                discoveriesCount: row["discoveries_count"] as? Int ?? 0,
                wordCount: row["word_count"] as? Int ?? 0
            )

            return DailyNote(
                date: date,
                title: title,
                metadata: metadata,
                createdAt: Date(timeIntervalSince1970: TimeInterval(createdAtTimestamp)),
                updatedAt: Date(timeIntervalSince1970: TimeInterval(updatedAtTimestamp))
            )
        }
    }

    private func getDailyNoteHeader(_ date: String) -> String {
        return """
        # \(date) 运行日志

        ## 📌 今日概览
        - 总对话数: 0
        - 活跃会话: 0
        - 创建笔记: 0

        ## 💬 重要对话

        ## ✅ 完成任务

        ## 📝 待办事项

        ## 💡 技术发现
        """
    }

    private func updateDailyNoteMetadata(date: String, content: String) async throws {
        let metadata = parseDailyNoteMetadata(content)

        let sql = """
        INSERT OR REPLACE INTO daily_notes_metadata
        (date, title, conversation_count, completed_tasks, pending_tasks, discoveries_count, word_count, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """

        let now = Int(Date().timeIntervalSince1970)

        try await database.execute(sql, [
            date,
            "\(date) 运行日志",
            metadata.conversationCount,
            metadata.completedTasks,
            metadata.pendingTasks,
            metadata.discoveriesCount,
            metadata.wordCount,
            now,
            now
        ])
    }

    private func parseDailyNoteMetadata(_ content: String) -> DailyNoteMetadata {
        // 统计对话数
        let conversationCount = content.matches(of: /### \d{2}:\d{2} - /).count

        // 统计完成任务
        let completedTasks = content.matches(of: /- \[x\]/i).count

        // 统计待办任务
        let pendingTasks = content.matches(of: /- \[ \]/).count

        // 统计技术发现
        var discoveriesCount = 0
        if let range = content.range(of: "## 💡 技术发现", options: .caseInsensitive) {
            let section = content[range.upperBound...]
            discoveriesCount = section.matches(of: /^- /m).count
        }

        return DailyNoteMetadata(
            conversationCount: conversationCount,
            completedTasks: completedTasks,
            pendingTasks: pendingTasks,
            discoveriesCount: discoveriesCount,
            wordCount: content.count
        )
    }

    // MARK: - Long Term Memory (MEMORY.md)

    /// 读取 MEMORY.md
    public func readMemory() async throws -> String {
        guard config.enableLongTermMemory else {
            throw PermanentMemoryError.longTermMemoryDisabled
        }

        if let cached = memoryContentCache {
            return cached
        }

        guard fileManager.fileExists(atPath: memoryFilePath.path) else {
            throw PermanentMemoryError.fileNotFound
        }

        let content = try String(contentsOf: memoryFilePath, encoding: .utf8)
        memoryContentCache = content

        return content
    }

    /// 追加到 MEMORY.md
    public func appendToMemory(
        _ content: String,
        section: MemorySection? = nil
    ) async throws {
        guard config.enableLongTermMemory else {
            throw PermanentMemoryError.longTermMemoryDisabled
        }

        let currentContent = try await readMemory()

        var newContent: String
        if let section = section {
            newContent = appendToSection(currentContent, section: section, newContent: content)
        } else {
            newContent = currentContent + "\n\n" + content
        }

        // 更新最后更新时间
        let today = DailyNote.todayDateString()
        if newContent.contains("> 最后更新:") {
            newContent = newContent.replacingOccurrences(
                of: #"> 最后更新: .+"#,
                with: "> 最后更新: \(today)",
                options: .regularExpression
            )
        }

        try newContent.write(to: memoryFilePath, atomically: true, encoding: .utf8)

        memoryContentCache = nil

        Logger.shared.info("[PermanentMemoryManager] MEMORY.md 已更新: \(section?.rawValue ?? "末尾")")

        memoryUpdated.send(section?.rawValue)
    }

    /// 更新 MEMORY.md (完整覆盖)
    public func updateMemory(_ content: String) async throws {
        guard config.enableLongTermMemory else {
            throw PermanentMemoryError.longTermMemoryDisabled
        }

        let today = DailyNote.todayDateString()
        var newContent = content

        if newContent.contains("> 最后更新:") {
            newContent = newContent.replacingOccurrences(
                of: #"> 最后更新: .+"#,
                with: "> 最后更新: \(today)",
                options: .regularExpression
            )
        }

        try newContent.write(to: memoryFilePath, atomically: true, encoding: .utf8)

        memoryContentCache = nil

        Logger.shared.info("[PermanentMemoryManager] MEMORY.md 已完整更新")

        memoryUpdated.send(nil)
    }

    private func appendToSection(_ content: String, section: MemorySection, newContent: String) -> String {
        let pattern = "(## \(section.rawValue)[\\s\\S]*?)(?=\\n## |$)"

        if let regex = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive),
           let match = regex.firstMatch(in: content, range: NSRange(content.startIndex..., in: content)) {
            let sectionRange = Range(match.range(at: 1), in: content)!
            let sectionContent = String(content[sectionRange]).trimmingCharacters(in: .whitespacesAndNewlines)
            let updatedSection = sectionContent + "\n\n" + newContent + "\n"
            return content.replacingCharacters(in: sectionRange, with: updatedSection)
        } else {
            // 章节不存在，追加到末尾
            return content + "\n\n## \(section.rawValue)\n\n" + newContent
        }
    }

    private func ensureMemoryFileExists() async throws {
        guard !fileManager.fileExists(atPath: memoryFilePath.path) else {
            Logger.shared.info("[PermanentMemoryManager] MEMORY.md 已存在")
            return
        }

        let defaultContent = getDefaultMemoryContent()
        try defaultContent.write(to: memoryFilePath, atomically: true, encoding: .utf8)

        Logger.shared.info("[PermanentMemoryManager] MEMORY.md 已创建")
    }

    private func getDefaultMemoryContent() -> String {
        let today = DailyNote.todayDateString()
        return """
        # ChainlessChain 长期记忆

        > 本文件由 PermanentMemoryManager 自动维护
        > 最后更新: \(today)

        ---

        ## 🧑 用户偏好

        ### 开发习惯
        <!-- 用户的开发偏好和习惯 -->

        ### 技术栈偏好
        <!-- 用户偏好的技术栈和工具 -->

        ---

        ## 🏗️ 架构决策

        <!-- 使用 ADR (Architecture Decision Record) 格式记录架构决策 -->

        ---

        ## 🐛 常见问题解决方案

        <!-- 记录遇到的问题和解决方案 -->

        ---

        ## 📚 重要技术发现

        <!-- 记录重要的技术发现和最佳实践 -->

        ---

        ## 🔧 系统配置

        <!-- 记录系统配置和环境变量 -->

        ---

        _此文件会自动更新,也可手动编辑。_
        """
    }

    // MARK: - Search

    /// 混合搜索记忆 (简化版)
    public func searchMemory(
        query: String,
        limit: Int = 10,
        searchDailyNotes: Bool = true,
        searchMemory: Bool = true
    ) async throws -> [MemorySearchResult] {
        var results: [MemorySearchResult] = []
        let queryLower = query.lowercased()

        // 搜索 Daily Notes
        if searchDailyNotes && config.enableDailyNotes {
            let dailyResults = try await searchDailyNotes(query: queryLower, limit: limit)
            results.append(contentsOf: dailyResults)
        }

        // 搜索 MEMORY.md
        if searchMemory && config.enableLongTermMemory {
            let memoryResults = try await searchLongTermMemory(query: queryLower, limit: limit)
            results.append(contentsOf: memoryResults)
        }

        // 按分数排序
        results.sort { $0.score > $1.score }

        return Array(results.prefix(limit))
    }

    private func searchDailyNotes(query: String, limit: Int) async throws -> [MemorySearchResult] {
        var results: [MemorySearchResult] = []

        let files = try fileManager.contentsOfDirectory(at: dailyNotesDir, includingPropertiesForKeys: nil)

        for file in files where file.pathExtension == "md" {
            let content = try String(contentsOf: file, encoding: .utf8)
            let contentLower = content.lowercased()

            if contentLower.contains(query) {
                let score = calculateBM25Score(query: query, content: contentLower)
                let date = file.deletingPathExtension().lastPathComponent

                results.append(MemorySearchResult(
                    source: .dailyNote,
                    content: content.prefix(200).description,
                    score: score,
                    matchType: .bm25,
                    date: date
                ))
            }
        }

        return results
    }

    private func searchLongTermMemory(query: String, limit: Int) async throws -> [MemorySearchResult] {
        let content = try await readMemory()
        let contentLower = content.lowercased()

        guard contentLower.contains(query) else {
            return []
        }

        let score = calculateBM25Score(query: query, content: contentLower)

        return [MemorySearchResult(
            source: .longTermMemory,
            content: content.prefix(200).description,
            score: score,
            matchType: .bm25,
            date: nil
        )]
    }

    private func calculateBM25Score(query: String, content: String) -> Double {
        // 简化的 BM25 计算
        let k1 = 1.2
        let b = 0.75
        let avgDocLength = 1000.0

        let queryTerms = query.split(separator: " ")
        let docLength = Double(content.count)

        var score = 0.0

        for term in queryTerms {
            let tf = Double(content.components(separatedBy: term).count - 1)
            let numerator = tf * (k1 + 1)
            let denominator = tf + k1 * (1 - b + b * docLength / avgDocLength)

            if denominator > 0 {
                score += numerator / denominator
            }
        }

        return score
    }

    // MARK: - Stats

    /// 获取记忆统计
    public func getStats() async throws -> MemoryStats {
        let today = DailyNote.todayDateString()

        // 统计 Daily Notes
        var dailyNotesCount = 0
        if let files = try? fileManager.contentsOfDirectory(at: dailyNotesDir, includingPropertiesForKeys: nil) {
            dailyNotesCount = files.filter { $0.pathExtension == "md" }.count
        }

        // 统计 MEMORY.md 章节
        var memorySectionsCount = 0
        if let content = try? await readMemory() {
            memorySectionsCount = content.matches(of: /^## /m).count
        }

        // 统计缓存
        let cacheQuery = "SELECT COUNT(*) as count FROM embedding_cache"
        let cacheRows = try await database.query(cacheQuery, [])
        let cachedEmbeddingsCount = cacheRows.first?["count"] as? Int ?? 0

        // 统计索引文件
        let indexQuery = "SELECT COUNT(*) as count FROM memory_file_hashes WHERE index_status = 'indexed'"
        let indexRows = try await database.query(indexQuery, [])
        let indexedFilesCount = indexRows.first?["count"] as? Int ?? 0

        // 更新统计表
        let now = Int(Date().timeIntervalSince1970)
        let updateSQL = """
        INSERT OR REPLACE INTO memory_stats
        (date, daily_notes_count, memory_sections_count, cached_embeddings_count, indexed_files_count, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """
        try await database.execute(updateSQL, [today, dailyNotesCount, memorySectionsCount, cachedEmbeddingsCount, indexedFilesCount, now])

        return MemoryStats(
            date: today,
            dailyNotesCount: dailyNotesCount,
            memorySectionsCount: memorySectionsCount,
            cachedEmbeddingsCount: cachedEmbeddingsCount,
            indexedFilesCount: indexedFilesCount
        )
    }

    // MARK: - Cleanup

    /// 清理过期 Daily Notes
    public func cleanupExpiredDailyNotes() async throws {
        guard config.enableDailyNotes else { return }

        let files = try fileManager.contentsOfDirectory(at: dailyNotesDir, includingPropertiesForKeys: [.contentModificationDateKey])
        let now = Date()
        let retentionInterval = TimeInterval(config.maxDailyNotesRetention * 24 * 60 * 60)

        var deletedCount = 0

        for file in files where file.pathExtension == "md" {
            let attributes = try file.resourceValues(forKeys: [.contentModificationDateKey])
            if let modDate = attributes.contentModificationDate {
                let age = now.timeIntervalSince(modDate)
                if age > retentionInterval {
                    try fileManager.removeItem(at: file)
                    deletedCount += 1
                    Logger.shared.info("[PermanentMemoryManager] 已删除过期 Daily Note: \(file.lastPathComponent)")
                }
            }
        }

        if deletedCount > 0 {
            Logger.shared.info("[PermanentMemoryManager] 清理完成，删除 \(deletedCount) 个过期文件")
        }
    }

    private func initializeTodayStats() async throws {
        let today = DailyNote.todayDateString()
        let now = Int(Date().timeIntervalSince1970)

        let sql = "INSERT OR IGNORE INTO memory_stats (date, updated_at) VALUES (?, ?)"
        try await database.execute(sql, [today, now])
    }

    // MARK: - Embedding Cache

    /// 获取或创建 embedding
    public func getOrCreateEmbedding(content: String) async throws -> [Float]? {
        let contentHash = hashContent(content)

        // 检查缓存
        let query = "SELECT embedding_json FROM embedding_cache WHERE content_hash = ?"
        let rows = try await database.query(query, [contentHash])

        if let row = rows.first,
           let embeddingJson = row["embedding_json"] as? String,
           let data = embeddingJson.data(using: .utf8),
           let embedding = try? JSONDecoder().decode([Float].self, from: data) {
            // 更新访问时间
            let updateSQL = "UPDATE embedding_cache SET accessed_at = ? WHERE content_hash = ?"
            try await database.execute(updateSQL, [Int(Date().timeIntervalSince1970), contentHash])
            return embedding
        }

        // 使用 LLMManager 生成 embedding
        do {
            let embedding = try await LLMManager.shared.generateEmbedding(content)

            // 缓存生成的 embedding
            try await cacheEmbedding(content: content, embedding: embedding)

            return embedding
        } catch {
            Logger.shared.warning("[PermanentMemoryManager] 生成 embedding 失败: \(error)")
            return nil
        }
    }

    /// 缓存 embedding
    public func cacheEmbedding(content: String, embedding: [Float]) async throws {
        let contentHash = hashContent(content)
        let embeddingJson = try JSONEncoder().encode(embedding).utf8String ?? "[]"
        let now = Int(Date().timeIntervalSince1970)

        let sql = """
        INSERT OR REPLACE INTO embedding_cache
        (content_hash, embedding_json, content_preview, created_at, accessed_at)
        VALUES (?, ?, ?, ?, ?)
        """

        try await database.execute(sql, [
            contentHash,
            embeddingJson,
            String(content.prefix(100)),
            now,
            now
        ])
    }

    private func hashContent(_ content: String) -> String {
        let data = Data(content.utf8)
        let hash = SHA256.hash(data: data)
        return hash.compactMap { String(format: "%02x", $0) }.joined()
    }
}

// MARK: - Data Extension

private extension Data {
    var utf8String: String? {
        return String(data: self, encoding: .utf8)
    }
}

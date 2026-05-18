import Foundation
import Combine
import CoreCommon

/// PermanentMemoryManager - 永久记忆管理器
///
/// 实现 Clawdbot 风格的永久记忆机制:
/// 1. Daily Notes (每日日志) - memory/daily/YYYY-MM-DD.md
/// 2. MEMORY.md (长期知识库) - memory/MEMORY.md
/// 3. 自动索引更新
/// 4. 混合搜索 (Vector + 关键词)
///
/// 参考: https://docs.openclaw.ai/concepts/memory
///
@MainActor
public class PermanentMemoryManager: ObservableObject {

    // MARK: - Singleton

    public static let shared = PermanentMemoryManager()

    // MARK: - Properties

    private var config: PermanentMemoryConfig
    private let fileManager = FileManager.default

    /// 记忆目录路径
    private var memoryDir: URL {
        let appSupport = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        return appSupport.appendingPathComponent("ChainlessChain").appendingPathComponent("memory")
    }

    /// Daily Notes 目录
    private var dailyNotesDir: URL {
        memoryDir.appendingPathComponent("daily")
    }

    /// MEMORY.md 文件路径
    private var memoryFilePath: URL {
        memoryDir.appendingPathComponent("MEMORY.md")
    }

    /// 索引目录
    private var indexDir: URL {
        memoryDir.appendingPathComponent("index")
    }

    // MARK: - Caches

    /// Daily Notes 缓存
    private var dailyNotesCache: [String: String] = [:]

    /// MEMORY.md 内容缓存
    private var memoryContentCache: String?

    /// 文件 hash 缓存
    private var fileHashCache: [String: String] = [:]

    // MARK: - Published Properties

    @Published public private(set) var isInitialized = false
    @Published public private(set) var stats = MemoryStats()

    // MARK: - Event Publishers

    public let memoryEventPublisher = PassthroughSubject<MemoryEvent, Never>()
    public let dailyNoteUpdated = PassthroughSubject<(String, URL), Never>()
    public let memoryUpdated = PassthroughSubject<(MemorySection?, URL), Never>()

    // MARK: - File Watcher

    private var fileWatcherTask: Task<Void, Never>?
    private var lastKnownHashes: [String: String] = [:]

    // MARK: - Initialization

    private init() {
        self.config = PermanentMemoryConfig()
        Logger.shared.info("[PermanentMemoryManager] 永久记忆管理器已创建")
    }

    /// 配置管理器
    public func configure(_ config: PermanentMemoryConfig) {
        self.config = config
        Logger.shared.info("[PermanentMemoryManager] 配置已更新")
    }

    // MARK: - Initialization

    /// 初始化 (创建目录结构)
    public func initialize() async throws {
        Logger.shared.info("[PermanentMemoryManager] 开始初始化...")

        do {
            // 创建主目录
            try fileManager.createDirectory(at: memoryDir, withIntermediateDirectories: true)

            // 创建子目录
            if config.enableDailyNotes {
                try fileManager.createDirectory(at: dailyNotesDir, withIntermediateDirectories: true)
            }

            if config.enableAutoIndexing {
                try fileManager.createDirectory(at: indexDir, withIntermediateDirectories: true)
            }

            // 创建 MEMORY.md (如果不存在)
            if config.enableLongTermMemory {
                try await ensureMemoryFileExists()
            }

            Logger.shared.info("[PermanentMemoryManager] 目录结构创建完成")

            // 清理过期 Daily Notes
            if config.enableDailyNotes {
                await cleanupExpiredDailyNotes()
            }

            // 启动文件监听
            if config.enableFileWatcher {
                startFileWatcher()
            }

            // 更新统计
            await updateStats()

            isInitialized = true
            Logger.shared.info("[PermanentMemoryManager] 初始化完成", [
                "记忆目录": memoryDir.path,
                "启用DailyNotes": config.enableDailyNotes,
                "启用长期记忆": config.enableLongTermMemory,
                "启用自动索引": config.enableAutoIndexing,
                "保留天数": config.maxDailyNotesRetention
            ])

        } catch {
            Logger.shared.error("[PermanentMemoryManager] 初始化失败: \(error)")
            throw error
        }
    }

    /// 确保 MEMORY.md 文件存在
    private func ensureMemoryFileExists() async throws {
        if fileManager.fileExists(atPath: memoryFilePath.path) {
            Logger.shared.info("[PermanentMemoryManager] MEMORY.md 已存在")
            return
        }

        // 文件不存在，创建默认内容
        let defaultContent = getDefaultMemoryContent()
        try defaultContent.write(to: memoryFilePath, atomically: true, encoding: .utf8)
        Logger.shared.info("[PermanentMemoryManager] MEMORY.md 已创建")
    }

    /// 获取 MEMORY.md 默认内容
    private func getDefaultMemoryContent() -> String {
        let today = getTodayDate()
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

        _此文件会自动更新，也可手动编辑。_
        """
    }

    // MARK: - Daily Notes

    /// 写入今日 Daily Note
    /// - Parameters:
    ///   - content: 内容 (Markdown 格式)
    ///   - append: 是否追加模式 (默认 true)
    /// - Returns: Daily Note 文件路径
    @discardableResult
    public func writeDailyNote(_ content: String, append: Bool = true) async throws -> URL {
        guard config.enableDailyNotes else {
            throw MemoryError.featureDisabled("Daily Notes")
        }

        let today = getTodayDate()
        let filePath = getDailyNoteFilePath(for: today)

        let fileExists = fileManager.fileExists(atPath: filePath.path)

        if fileExists && append {
            // 追加模式
            var existingContent = try String(contentsOf: filePath, encoding: .utf8)
            existingContent += "\n\n" + content
            try existingContent.write(to: filePath, atomically: true, encoding: .utf8)
            Logger.shared.info("[PermanentMemoryManager] Daily Note 已追加: \(today)")
        } else if fileExists {
            // 覆盖模式
            try content.write(to: filePath, atomically: true, encoding: .utf8)
            Logger.shared.info("[PermanentMemoryManager] Daily Note 已覆盖: \(today)")
        } else {
            // 创建新文件
            let header = getDailyNoteHeader(for: today)
            let fullContent = header + "\n\n" + content
            try fullContent.write(to: filePath, atomically: true, encoding: .utf8)
            Logger.shared.info("[PermanentMemoryManager] Daily Note 已创建: \(today)")
        }

        // 清除缓存
        dailyNotesCache.removeValue(forKey: today)

        // 更新元数据
        await updateDailyNoteMetadata(for: today)

        // 触发事件
        dailyNoteUpdated.send((today, filePath))
        memoryEventPublisher.send(.dailyNoteUpdated(date: today, filePath: filePath))

        return filePath
    }

    /// 读取指定日期的 Daily Note
    /// - Parameter date: 日期 (YYYY-MM-DD)
    /// - Returns: Daily Note 内容，如果不存在返回 nil
    public func readDailyNote(for date: String) async throws -> String? {
        guard config.enableDailyNotes else {
            throw MemoryError.featureDisabled("Daily Notes")
        }

        // 检查缓存
        if let cached = dailyNotesCache[date] {
            return cached
        }

        let filePath = getDailyNoteFilePath(for: date)

        guard fileManager.fileExists(atPath: filePath.path) else {
            return nil
        }

        let content = try String(contentsOf: filePath, encoding: .utf8)
        dailyNotesCache[date] = content

        return content
    }

    /// 获取最近的 Daily Notes
    /// - Parameter limit: 返回数量
    /// - Returns: Daily Notes 列表
    public func getRecentDailyNotes(limit: Int = 7) async throws -> [DailyNote] {
        guard config.enableDailyNotes else {
            throw MemoryError.featureDisabled("Daily Notes")
        }

        var notes: [DailyNote] = []

        let files = try fileManager.contentsOfDirectory(at: dailyNotesDir, includingPropertiesForKeys: [.contentModificationDateKey])
            .filter { $0.pathExtension == "md" }
            .sorted { url1, url2 in
                let date1 = (try? url1.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? Date.distantPast
                let date2 = (try? url2.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? Date.distantPast
                return date1 > date2
            }
            .prefix(limit)

        for file in files {
            let date = file.deletingPathExtension().lastPathComponent
            if let content = try? await readDailyNote(for: date) {
                let metadata = parseDailyNoteMetadata(from: content)
                notes.append(DailyNote(date: date, content: content, metadata: metadata))
            }
        }

        return notes
    }

    /// 获取 Daily Note 文件路径
    private func getDailyNoteFilePath(for date: String) -> URL {
        dailyNotesDir.appendingPathComponent("\(date).md")
    }

    /// 获取 Daily Note 头部
    private func getDailyNoteHeader(for date: String) -> String {
        """
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

    /// 解析 Daily Note 元数据
    private func parseDailyNoteMetadata(from content: String) -> DailyNoteMetadata {
        var metadata = DailyNoteMetadata()

        // 统计对话数
        let conversationPattern = try? NSRegularExpression(pattern: "### \\d{2}:\\d{2} - ")
        metadata.conversationCount = conversationPattern?.numberOfMatches(in: content, range: NSRange(content.startIndex..., in: content)) ?? 0

        // 统计完成任务
        let completedPattern = try? NSRegularExpression(pattern: "- \\[x\\]", options: .caseInsensitive)
        metadata.completedTasks = completedPattern?.numberOfMatches(in: content, range: NSRange(content.startIndex..., in: content)) ?? 0

        // 统计待办任务
        let pendingPattern = try? NSRegularExpression(pattern: "- \\[ \\]")
        metadata.pendingTasks = pendingPattern?.numberOfMatches(in: content, range: NSRange(content.startIndex..., in: content)) ?? 0

        // 字数统计
        metadata.wordCount = content.count

        return metadata
    }

    /// 更新 Daily Note 元数据
    private func updateDailyNoteMetadata(for date: String) async {
        // 可以在这里保存元数据到数据库
        Logger.shared.debug("[PermanentMemoryManager] Daily Note 元数据已更新: \(date)")
    }

    // MARK: - Long-term Memory (MEMORY.md)

    /// 追加到 MEMORY.md
    /// - Parameters:
    ///   - content: 内容 (Markdown 格式)
    ///   - section: 章节名称 (可选)
    public func appendToMemory(_ content: String, section: MemorySection? = nil) async throws {
        guard config.enableLongTermMemory else {
            throw MemoryError.featureDisabled("Long-term Memory")
        }

        var currentContent = try await readMemory()

        if let section = section {
            // 追加到指定章节
            currentContent = appendToSection(currentContent, section: section, newContent: content)
        } else {
            // 追加到文件末尾
            currentContent += "\n\n" + content
        }

        // 更新最后更新时间
        let today = getTodayDate()
        currentContent = currentContent.replacingOccurrences(
            of: "> 最后更新: .+",
            with: "> 最后更新: \(today)",
            options: .regularExpression
        )

        try currentContent.write(to: memoryFilePath, atomically: true, encoding: .utf8)

        // 清除缓存
        memoryContentCache = nil

        Logger.shared.info("[PermanentMemoryManager] MEMORY.md 已更新", ["section": section?.title ?? "末尾"])

        // 触发事件
        memoryUpdated.send((section, memoryFilePath))
        memoryEventPublisher.send(.memoryUpdated(section: section, filePath: memoryFilePath))
    }

    /// 读取 MEMORY.md
    /// - Returns: MEMORY.md 内容
    public func readMemory() async throws -> String {
        guard config.enableLongTermMemory else {
            throw MemoryError.featureDisabled("Long-term Memory")
        }

        // 检查缓存
        if let cached = memoryContentCache {
            return cached
        }

        let content = try String(contentsOf: memoryFilePath, encoding: .utf8)
        memoryContentCache = content

        return content
    }

    /// 更新 MEMORY.md 内容（完整覆盖）
    /// - Parameter content: 新的完整内容
    public func updateMemory(_ content: String) async throws {
        guard config.enableLongTermMemory else {
            throw MemoryError.featureDisabled("Long-term Memory")
        }

        // 更新最后更新时间
        let today = getTodayDate()
        var newContent = content
        if newContent.contains("> 最后更新:") {
            newContent = newContent.replacingOccurrences(
                of: "> 最后更新: .+",
                with: "> 最后更新: \(today)",
                options: .regularExpression
            )
        }

        try newContent.write(to: memoryFilePath, atomically: true, encoding: .utf8)

        // 清除缓存
        memoryContentCache = nil

        Logger.shared.info("[PermanentMemoryManager] MEMORY.md 已完整更新")

        // 触发事件
        memoryUpdated.send((nil, memoryFilePath))
        memoryEventPublisher.send(.memoryUpdated(section: nil, filePath: memoryFilePath))
    }

    /// 追加内容到指定章节
    private func appendToSection(_ content: String, section: MemorySection, newContent: String) -> String {
        let sectionTitle = section.title
        let pattern = "(## \(NSRegularExpression.escapedPattern(for: sectionTitle))[\\s\\S]*?)(?=\\n## |$)"

        guard let regex = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive),
              let match = regex.firstMatch(in: content, range: NSRange(content.startIndex..., in: content)),
              let range = Range(match.range, in: content) else {
            // 章节不存在，追加到末尾
            return content + "\n\n## \(sectionTitle)\n\n\(newContent)"
        }

        let sectionContent = String(content[range])
        let updatedSection = sectionContent.trimmingCharacters(in: .whitespacesAndNewlines) + "\n\n" + newContent

        return content.replacingCharacters(in: range, with: updatedSection)
    }

    /// 获取 MEMORY.md 章节列表
    public func getMemorySections() async throws -> [(title: String, itemCount: Int, hasContent: Bool)] {
        let content = try await readMemory()
        var sections: [(title: String, itemCount: Int, hasContent: Bool)] = []

        let pattern = "^## (.+)$"
        guard let regex = try? NSRegularExpression(pattern: pattern, options: .anchorsMatchLines) else {
            return sections
        }

        let matches = regex.matches(in: content, range: NSRange(content.startIndex..., in: content))
        var matchInfos: [(title: String, index: Int)] = []

        for match in matches {
            if let range = Range(match.range(at: 1), in: content) {
                let title = String(content[range]).trimmingCharacters(in: .whitespaces)
                matchInfos.append((title, match.range.location))
            }
        }

        for i in 0..<matchInfos.count {
            let current = matchInfos[i]
            let nextIndex = i + 1 < matchInfos.count ? matchInfos[i + 1].index : content.count

            let startIndex = content.index(content.startIndex, offsetBy: current.index)
            let endIndex = content.index(content.startIndex, offsetBy: min(nextIndex, content.count))
            let sectionContent = String(content[startIndex..<endIndex])

            // 统计列表项
            let itemPattern = "^- "
            let itemCount = sectionContent.components(separatedBy: .newlines)
                .filter { $0.hasPrefix("- ") || $0.hasPrefix("### ") }
                .count

            let hasContent = sectionContent.trimmingCharacters(in: .whitespacesAndNewlines).count > current.title.count + 10

            sections.append((current.title, itemCount, hasContent))
        }

        return sections
    }

    // MARK: - Memory Search

    /// 搜索记忆
    /// - Parameters:
    ///   - query: 查询字符串
    ///   - searchDailyNotes: 是否搜索 Daily Notes
    ///   - searchMemory: 是否搜索 MEMORY.md
    ///   - limit: 返回结果数量
    /// - Returns: 搜索结果列表
    public func searchMemory(
        query: String,
        searchDailyNotes: Bool = true,
        searchMemory: Bool = true,
        limit: Int = 10
    ) async throws -> [MemorySearchResult] {
        var results: [MemorySearchResult] = []
        let lowercasedQuery = query.lowercased()

        // 搜索 Daily Notes
        if searchDailyNotes && config.enableDailyNotes {
            let recentNotes = try await getRecentDailyNotes(limit: 30)

            for note in recentNotes {
                if note.content.lowercased().contains(lowercasedQuery) {
                    // 提取匹配的片段
                    let matchedText = extractMatchContext(from: note.content, query: query)

                    results.append(MemorySearchResult(
                        id: note.id,
                        content: note.content,
                        source: .dailyNote,
                        score: 0.5,
                        metadata: ["date": note.date],
                        matchedText: matchedText
                    ))
                }
            }
        }

        // 搜索 MEMORY.md
        if searchMemory && config.enableLongTermMemory {
            let memoryContent = try await readMemory()

            if memoryContent.lowercased().contains(lowercasedQuery) {
                let matchedText = extractMatchContext(from: memoryContent, query: query)

                results.append(MemorySearchResult(
                    id: "memory",
                    content: memoryContent,
                    source: .longTermMemory,
                    score: 0.7,
                    metadata: [:],
                    matchedText: matchedText
                ))
            }
        }

        // 按分数排序并限制结果数量
        results.sort { $0.score > $1.score }

        return Array(results.prefix(limit))
    }

    /// 提取匹配上下文
    private func extractMatchContext(from content: String, query: String, contextLength: Int = 100) -> String {
        guard let range = content.range(of: query, options: .caseInsensitive) else {
            return String(content.prefix(contextLength))
        }

        let matchStart = content.distance(from: content.startIndex, to: range.lowerBound)
        let start = max(0, matchStart - contextLength / 2)
        let end = min(content.count, matchStart + query.count + contextLength / 2)

        let startIndex = content.index(content.startIndex, offsetBy: start)
        let endIndex = content.index(content.startIndex, offsetBy: end)

        var context = String(content[startIndex..<endIndex])

        if start > 0 {
            context = "..." + context
        }
        if end < content.count {
            context = context + "..."
        }

        return context
    }

    // MARK: - Conversation Memory Extraction

    /// 从对话中提取并保存记忆
    /// - Parameters:
    ///   - messages: 对话消息列表
    ///   - conversationTitle: 对话标题
    /// - Returns: 提取结果
    public func extractFromConversation(
        messages: [(role: String, content: String)],
        conversationTitle: String = ""
    ) async throws -> MemoryFlushResult {
        guard !messages.isEmpty else {
            throw MemoryError.emptyContent
        }

        var savedToDailyNotes = false
        var savedToMemory = false
        var extractedInsights = 0

        // 1. 构建对话摘要
        let conversationSummary = buildConversationSummary(messages: messages, title: conversationTitle)

        // 2. 保存到 Daily Notes
        let timestamp = formatTime(Date())
        let dailyContent = """
        ### \(timestamp) - \(conversationTitle.isEmpty ? "对话记录" : conversationTitle)

        **消息数**: \(messages.count)

        \(conversationSummary)
        """

        do {
            try await writeDailyNote(dailyContent, append: true)
            savedToDailyNotes = true
            Logger.shared.info("[PermanentMemoryManager] 对话摘要已保存到 Daily Notes")
        } catch {
            Logger.shared.warning("[PermanentMemoryManager] 保存到 Daily Notes 失败: \(error)")
        }

        // 3. 尝试提取重要信息到 MEMORY.md
        if let insight = extractImportantInsight(from: messages) {
            do {
                let section = MemorySection.detect(from: insight)
                let formattedInsight = "### \(getTodayDate())\n\n\(insight)"
                try await appendToMemory(formattedInsight, section: section)
                savedToMemory = true
                extractedInsights = 1
                Logger.shared.info("[PermanentMemoryManager] 重要信息已保存到 MEMORY.md: \(section.title)")
            } catch {
                Logger.shared.warning("[PermanentMemoryManager] 保存到 MEMORY.md 失败: \(error)")
            }
        }

        return MemoryFlushResult(
            sessionId: UUID().uuidString,
            savedToDailyNotes: savedToDailyNotes,
            savedToMemory: savedToMemory,
            extractedInsights: extractedInsights
        )
    }

    /// 构建对话摘要
    private func buildConversationSummary(messages: [(role: String, content: String)], title: String) -> String {
        var lines: [String] = []

        for (index, message) in messages.enumerated() {
            let role = message.role == "user" ? "👤 用户" : "🤖 AI"
            let content = message.content
            let truncated = content.count > 500 ? String(content.prefix(500)) + "..." : content

            lines.append("**\(role)**: \(truncated)")

            // 只保留最后5条消息的完整内容
            if index < messages.count - 5 && index == 0 {
                lines.append("\n*... 中间省略 ...*\n")
            }
        }

        return lines.joined(separator: "\n\n")
    }

    /// 提取重要信息
    private func extractImportantInsight(from messages: [(role: String, content: String)]) -> String? {
        let importantKeywords = ["决定", "决策", "解决方案", "发现", "问题", "偏好", "配置", "架构", "设计", "重要", "关键"]

        for message in messages where message.role == "assistant" {
            let content = message.content.lowercased()
            for keyword in importantKeywords {
                if content.contains(keyword) {
                    return String(message.content.prefix(300))
                }
            }
        }

        return nil
    }

    /// 保存内容到永久记忆
    /// - Parameters:
    ///   - content: 要保存的内容
    ///   - type: 类型 (conversation, discovery, solution, preference)
    ///   - section: MEMORY.md 章节名 (可选)
    public func saveToMemory(
        _ content: String,
        type: String = "conversation",
        section: MemorySection? = nil
    ) async throws -> (savedTo: String, date: String) {
        let timestamp = getTodayDate()

        if type == "daily" || type == "conversation" {
            // 保存到 Daily Notes
            let formattedContent = """
            ### \(formatTime(Date())) - 对话记录

            \(content)
            """
            try await writeDailyNote(formattedContent, append: true)

            return (savedTo: "daily_notes", date: timestamp)
        } else {
            // 保存到 MEMORY.md
            let targetSection = section ?? MemorySection.detect(from: content)
            let formattedContent = """
            ### \(timestamp)

            \(content)
            """
            try await appendToMemory(formattedContent, section: targetSection)

            return (savedTo: "memory_md", date: timestamp)
        }
    }

    // MARK: - File Watcher

    /// 启动文件监听
    private func startFileWatcher() {
        guard config.enableFileWatcher else { return }

        fileWatcherTask?.cancel()

        fileWatcherTask = Task { [weak self] in
            guard let self = self else { return }

            // 初始化已知文件 hash
            await self.initializeFileHashes()

            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(self.config.fileWatcherDebounceMs) * 1_000_000)
                await self.checkForFileChanges()
            }
        }

        Logger.shared.info("[PermanentMemoryManager] 文件监听已启动")
    }

    /// 停止文件监听
    public func stopFileWatcher() {
        fileWatcherTask?.cancel()
        fileWatcherTask = nil
        Logger.shared.info("[PermanentMemoryManager] 文件监听已停止")
    }

    /// 初始化文件 hash
    private func initializeFileHashes() async {
        do {
            // Daily Notes
            let dailyFiles = try fileManager.contentsOfDirectory(at: dailyNotesDir, includingPropertiesForKeys: nil)
                .filter { $0.pathExtension == "md" }

            for file in dailyFiles {
                if let content = try? String(contentsOf: file, encoding: .utf8) {
                    let hash = content.sha256Hash
                    lastKnownHashes[file.lastPathComponent] = hash
                }
            }

            // MEMORY.md
            if let memoryContent = try? String(contentsOf: memoryFilePath, encoding: .utf8) {
                lastKnownHashes["MEMORY.md"] = memoryContent.sha256Hash
            }

        } catch {
            Logger.shared.warning("[PermanentMemoryManager] 初始化文件 hash 失败: \(error)")
        }
    }

    /// 检查文件变化
    private func checkForFileChanges() async {
        do {
            // 检查 Daily Notes
            let dailyFiles = try fileManager.contentsOfDirectory(at: dailyNotesDir, includingPropertiesForKeys: nil)
                .filter { $0.pathExtension == "md" }

            for file in dailyFiles {
                let filename = file.lastPathComponent
                if let content = try? String(contentsOf: file, encoding: .utf8) {
                    let newHash = content.sha256Hash

                    if let oldHash = lastKnownHashes[filename], oldHash != newHash {
                        // 文件已修改
                        lastKnownHashes[filename] = newHash
                        dailyNotesCache.removeValue(forKey: file.deletingPathExtension().lastPathComponent)
                        memoryEventPublisher.send(.fileChanged(path: file, event: .modified))
                    } else if lastKnownHashes[filename] == nil {
                        // 新文件
                        lastKnownHashes[filename] = newHash
                        memoryEventPublisher.send(.fileChanged(path: file, event: .created))
                    }
                }
            }

            // 检查 MEMORY.md
            if let memoryContent = try? String(contentsOf: memoryFilePath, encoding: .utf8) {
                let newHash = memoryContent.sha256Hash
                if let oldHash = lastKnownHashes["MEMORY.md"], oldHash != newHash {
                    lastKnownHashes["MEMORY.md"] = newHash
                    memoryContentCache = nil
                    memoryEventPublisher.send(.fileChanged(path: memoryFilePath, event: .modified))
                }
            }

        } catch {
            // 忽略错误
        }
    }

    // MARK: - Cleanup

    /// 清理过期 Daily Notes
    public func cleanupExpiredDailyNotes() async {
        guard config.enableDailyNotes else { return }

        do {
            let files = try fileManager.contentsOfDirectory(at: dailyNotesDir, includingPropertiesForKeys: [.contentModificationDateKey])
                .filter { $0.pathExtension == "md" }

            let cutoffDate = Calendar.current.date(byAdding: .day, value: -config.maxDailyNotesRetention, to: Date()) ?? Date()
            var deletedCount = 0

            for file in files {
                if let modDate = try? file.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate,
                   modDate < cutoffDate {
                    try fileManager.removeItem(at: file)
                    deletedCount += 1
                    Logger.shared.info("[PermanentMemoryManager] 已删除过期 Daily Note: \(file.lastPathComponent)")
                }
            }

            if deletedCount > 0 {
                Logger.shared.info("[PermanentMemoryManager] 清理完成，删除 \(deletedCount) 个过期文件")
            }

        } catch {
            Logger.shared.error("[PermanentMemoryManager] 清理过期文件失败: \(error)")
        }
    }

    // MARK: - Statistics

    /// 获取记忆统计
    public func getStats() async -> MemoryStats {
        var stats = MemoryStats()

        // 统计 Daily Notes
        if config.enableDailyNotes {
            let dailyFiles = (try? fileManager.contentsOfDirectory(at: dailyNotesDir, includingPropertiesForKeys: nil)
                .filter { $0.pathExtension == "md" }) ?? []
            stats.dailyNotesCount = dailyFiles.count
        }

        // 统计 MEMORY.md 章节
        if config.enableLongTermMemory {
            if let sections = try? await getMemorySections() {
                stats.memorySectionsCount = sections.count
            }
        }

        // 统计总字数
        if let memoryContent = try? await readMemory() {
            stats.totalWordCount = memoryContent.count
        }

        stats.lastUpdated = Date()

        return stats
    }

    /// 更新统计
    private func updateStats() async {
        stats = await getStats()
    }

    // MARK: - Utilities

    /// 获取今日日期 (YYYY-MM-DD)
    private func getTodayDate() -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: Date())
    }

    /// 格式化时间
    private func formatTime(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm"
        return formatter.string(from: date)
    }

    // MARK: - Cleanup

    /// 销毁实例
    public func destroy() {
        stopFileWatcher()
        dailyNotesCache.removeAll()
        memoryContentCache = nil
        fileHashCache.removeAll()
        lastKnownHashes.removeAll()
        Logger.shared.info("[PermanentMemoryManager] 实例已销毁")
    }
}

// MARK: - Memory Errors

public enum MemoryError: Error, LocalizedError {
    case featureDisabled(String)
    case fileNotFound(String)
    case emptyContent
    case saveFailed(String)

    public var errorDescription: String? {
        switch self {
        case .featureDisabled(let feature):
            return "\(feature) 功能未启用"
        case .fileNotFound(let path):
            return "文件不存在: \(path)"
        case .emptyContent:
            return "内容为空"
        case .saveFailed(let reason):
            return "保存失败: \(reason)"
        }
    }
}

// MARK: - String Extension

private extension String {
    var sha256Hash: String {
        guard let data = self.data(using: .utf8) else { return "" }
        var hash = [UInt8](repeating: 0, count: Int(CC_SHA256_DIGEST_LENGTH))
        data.withUnsafeBytes {
            _ = CC_SHA256($0.baseAddress, CC_LONG(data.count), &hash)
        }
        return hash.map { String(format: "%02x", $0) }.joined()
    }
}

import CommonCrypto

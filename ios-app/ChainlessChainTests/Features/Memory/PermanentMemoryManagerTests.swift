import XCTest
@testable import ChainlessChain

/// PermanentMemoryManager 测试
final class PermanentMemoryManagerTests: XCTestCase {

    var manager: PermanentMemoryManager!

    override func setUp() async throws {
        try await super.setUp()
        manager = await PermanentMemoryManager.shared

        // 配置测试环境
        var config = PermanentMemoryConfig()
        config.enableDailyNotes = true
        config.enableLongTermMemory = true
        config.enableAutoIndexing = false  // 测试中禁用
        config.enableFileWatcher = false   // 测试中禁用
        config.maxDailyNotesRetention = 7

        await manager.configure(config)
    }

    override func tearDown() async throws {
        await manager.destroy()
        try await super.tearDown()
    }

    // MARK: - Initialization Tests

    func testInitialization() async throws {
        // Given
        let manager = await PermanentMemoryManager.shared

        // When
        try await manager.initialize()

        // Then
        let isInitialized = await manager.isInitialized
        XCTAssertTrue(isInitialized, "管理器应该已初始化")
    }

    // MARK: - Daily Notes Tests

    func testWriteDailyNote() async throws {
        // Given
        try await manager.initialize()
        let content = "这是一条测试笔记 - \(Date())"

        // When
        let filePath = try await manager.writeDailyNote(content, append: true)

        // Then
        XCTAssertNotNil(filePath, "应该返回文件路径")
        XCTAssertTrue(FileManager.default.fileExists(atPath: filePath.path), "文件应该存在")
    }

    func testReadDailyNote() async throws {
        // Given
        try await manager.initialize()
        let testContent = "测试内容 - \(UUID().uuidString)"
        try await manager.writeDailyNote(testContent, append: true)

        let today = DateFormatter.yyyyMMdd.string(from: Date())

        // When
        let content = try await manager.readDailyNote(for: today)

        // Then
        XCTAssertNotNil(content, "应该能读取 Daily Note")
        XCTAssertTrue(content!.contains(testContent), "内容应该包含写入的测试内容")
    }

    func testGetRecentDailyNotes() async throws {
        // Given
        try await manager.initialize()
        try await manager.writeDailyNote("测试笔记1", append: true)

        // When
        let notes = try await manager.getRecentDailyNotes(limit: 5)

        // Then
        XCTAssertFalse(notes.isEmpty, "应该返回至少一条 Daily Note")
        XCTAssertTrue(notes.count <= 5, "不应超过限制数量")
    }

    // MARK: - Long-term Memory Tests

    func testReadMemory() async throws {
        // Given
        try await manager.initialize()

        // When
        let content = try await manager.readMemory()

        // Then
        XCTAssertFalse(content.isEmpty, "MEMORY.md 应该有内容")
        XCTAssertTrue(content.contains("ChainlessChain 长期记忆"), "应该包含默认标题")
    }

    func testAppendToMemory() async throws {
        // Given
        try await manager.initialize()
        let testContent = "测试技术发现 - \(UUID().uuidString)"

        // When
        try await manager.appendToMemory(testContent, section: .discoveries)

        // Then
        let content = try await manager.readMemory()
        XCTAssertTrue(content.contains(testContent), "MEMORY.md 应该包含追加的内容")
    }

    func testAppendToSpecificSection() async throws {
        // Given
        try await manager.initialize()
        let testContent = "用户偏好测试 - \(UUID().uuidString)"

        // When
        try await manager.appendToMemory(testContent, section: .userPreferences)

        // Then
        let content = try await manager.readMemory()
        XCTAssertTrue(content.contains(testContent), "应该包含追加的内容")

        // 验证内容在正确的章节中
        if let range = content.range(of: "## 🧑 用户偏好") {
            let sectionStart = range.upperBound
            let sectionContent = String(content[sectionStart...])
            XCTAssertTrue(sectionContent.contains(testContent), "内容应该在用户偏好章节中")
        }
    }

    func testGetMemorySections() async throws {
        // Given
        try await manager.initialize()

        // When
        let sections = try await manager.getMemorySections()

        // Then
        XCTAssertFalse(sections.isEmpty, "应该有章节")
        XCTAssertTrue(sections.contains { $0.title.contains("用户偏好") }, "应该包含用户偏好章节")
        XCTAssertTrue(sections.contains { $0.title.contains("架构决策") }, "应该包含架构决策章节")
    }

    // MARK: - Search Tests

    func testSearchMemory() async throws {
        // Given
        try await manager.initialize()
        let uniqueKeyword = "UniqueTestKeyword_\(UUID().uuidString.prefix(8))"
        try await manager.writeDailyNote("包含 \(uniqueKeyword) 的笔记", append: true)

        // When
        let results = try await manager.searchMemory(query: uniqueKeyword, limit: 10)

        // Then
        XCTAssertFalse(results.isEmpty, "应该找到搜索结果")
        XCTAssertTrue(results.first?.matchedText?.contains(uniqueKeyword) ?? false, "匹配文本应该包含关键词")
    }

    func testSearchMemoryNoResults() async throws {
        // Given
        try await manager.initialize()
        let nonExistentKeyword = "ThisKeywordDoesNotExist_\(UUID().uuidString)"

        // When
        let results = try await manager.searchMemory(query: nonExistentKeyword, limit: 10)

        // Then
        XCTAssertTrue(results.isEmpty, "不应该有搜索结果")
    }

    // MARK: - Conversation Extraction Tests

    func testExtractFromConversation() async throws {
        // Given
        try await manager.initialize()
        let messages: [(role: String, content: String)] = [
            ("user", "如何优化 Swift 的性能？"),
            ("assistant", "这是一个很好的问题。关于 Swift 性能优化，有几个关键点：1. 使用值类型 2. 避免不必要的对象创建 3. 利用编译器优化")
        ]

        // When
        let result = try await manager.extractFromConversation(
            messages: messages,
            conversationTitle: "Swift 性能优化讨论"
        )

        // Then
        XCTAssertTrue(result.savedToDailyNotes, "应该保存到 Daily Notes")
    }

    func testExtractFromConversationWithInsight() async throws {
        // Given
        try await manager.initialize()
        let messages: [(role: String, content: String)] = [
            ("user", "项目架构应该如何设计？"),
            ("assistant", "根据我们的决策，建议采用 MVVM 架构模式，这是一个重要的架构决定。")
        ]

        // When
        let result = try await manager.extractFromConversation(
            messages: messages,
            conversationTitle: "架构设计讨论"
        )

        // Then
        XCTAssertTrue(result.savedToDailyNotes, "应该保存到 Daily Notes")
        // 可能会提取到重要信息
    }

    // MARK: - Save to Memory Tests

    func testSaveToMemoryDaily() async throws {
        // Given
        try await manager.initialize()
        let content = "日常对话内容 - \(UUID().uuidString)"

        // When
        let result = try await manager.saveToMemory(content, type: "conversation")

        // Then
        XCTAssertEqual(result.savedTo, "daily_notes", "应该保存到 Daily Notes")
    }

    func testSaveToMemoryDiscovery() async throws {
        // Given
        try await manager.initialize()
        let content = "重要发现 - \(UUID().uuidString)"

        // When
        let result = try await manager.saveToMemory(content, type: "discovery", section: .discoveries)

        // Then
        XCTAssertEqual(result.savedTo, "memory_md", "应该保存到 MEMORY.md")
    }

    // MARK: - Section Detection Tests

    func testSectionDetection() {
        // Given & When & Then
        XCTAssertEqual(MemorySection.detect(from: "用户偏好使用 Vim"), .userPreferences)
        XCTAssertEqual(MemorySection.detect(from: "架构设计采用微服务"), .architecture)
        XCTAssertEqual(MemorySection.detect(from: "问题解决方案是重启服务"), .solutions)
        XCTAssertEqual(MemorySection.detect(from: "配置环境变量"), .config)
        XCTAssertEqual(MemorySection.detect(from: "这是一个普通内容"), .discoveries)
    }

    // MARK: - Statistics Tests

    func testGetStats() async throws {
        // Given
        try await manager.initialize()
        try await manager.writeDailyNote("统计测试", append: true)

        // When
        let stats = await manager.getStats()

        // Then
        XCTAssertGreaterThanOrEqual(stats.dailyNotesCount, 1, "应该有至少一个 Daily Note")
        XCTAssertGreaterThanOrEqual(stats.memorySectionsCount, 1, "应该有至少一个章节")
    }

    // MARK: - Cleanup Tests

    func testCleanupExpiredDailyNotes() async throws {
        // Given
        try await manager.initialize()

        // When
        await manager.cleanupExpiredDailyNotes()

        // Then
        // 验证没有崩溃即可
    }

    // MARK: - Error Handling Tests

    func testFeatureDisabledError() async throws {
        // Given
        var config = PermanentMemoryConfig()
        config.enableDailyNotes = false
        await manager.configure(config)
        try await manager.initialize()

        // When & Then
        do {
            _ = try await manager.writeDailyNote("测试")
            XCTFail("应该抛出错误")
        } catch let error as MemoryError {
            XCTAssertEqual(error.localizedDescription, "Daily Notes 功能未启用")
        }
    }

    func testEmptyConversationError() async throws {
        // Given
        try await manager.initialize()
        let emptyMessages: [(role: String, content: String)] = []

        // When & Then
        do {
            _ = try await manager.extractFromConversation(messages: emptyMessages)
            XCTFail("应该抛出错误")
        } catch let error as MemoryError {
            XCTAssertEqual(error.localizedDescription, "内容为空")
        }
    }
}

// MARK: - DateFormatter Extension

private extension DateFormatter {
    static let yyyyMMdd: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()
}

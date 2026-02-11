import XCTest
@testable import ChainlessChain

/// Context Engineering 测试
final class ContextEngineeringTests: XCTestCase {

    var contextEngineering: ContextEngineering!

    override func setUp() async throws {
        try await super.setUp()
        contextEngineering = await ContextEngineering.shared
        await contextEngineering.resetStats()
        await contextEngineering.clearErrors()
        await contextEngineering.clearTask()
    }

    // MARK: - System Prompt Cleaning Tests

    func testCleanSystemPromptRemovesTimestamp() async {
        // Given
        let prompt = "Current time is 2026-02-11T12:30:45.123Z. Please help."

        // When
        let cleaned = await contextEngineering.cleanSystemPrompt(prompt)

        // Then
        XCTAssertFalse(cleaned.contains("2026-02-11"), "应该移除日期")
        XCTAssertTrue(cleaned.contains("[DATE]"), "应该替换为占位符")
    }

    func testCleanSystemPromptRemovesTime() async {
        // Given
        let prompt = "Meeting at 14:30:00 today."

        // When
        let cleaned = await contextEngineering.cleanSystemPrompt(prompt)

        // Then
        XCTAssertFalse(cleaned.contains("14:30:00"), "应该移除时间")
        XCTAssertTrue(cleaned.contains("[TIME]"), "应该替换为占位符")
    }

    func testCleanSystemPromptRemovesUUID() async {
        // Given
        let prompt = "Session: 550e8400-e29b-41d4-a716-446655440000"

        // When
        let cleaned = await contextEngineering.cleanSystemPrompt(prompt)

        // Then
        XCTAssertFalse(cleaned.contains("550e8400"), "应该移除 UUID")
        XCTAssertTrue(cleaned.contains("[UUID]"), "应该替换为占位符")
    }

    func testCleanSystemPromptRemovesSessionId() async {
        // Given
        let prompt = "session_id: abc123xyz"

        // When
        let cleaned = await contextEngineering.cleanSystemPrompt(prompt)

        // Then
        XCTAssertFalse(cleaned.contains("abc123xyz"), "应该移除会话 ID")
        XCTAssertTrue(cleaned.contains("[SESSION]"), "应该替换为占位符")
    }

    // MARK: - Build Optimized Prompt Tests

    func testBuildOptimizedPromptStructure() async {
        // Given
        let systemPrompt = "You are a helpful assistant."
        let messages: [(role: String, content: String)] = [
            ("user", "Hello"),
            ("assistant", "Hi there!")
        ]
        let tools = [
            ToolDefinition(name: "search", description: "Search the web")
        ]

        // When
        let result = await contextEngineering.buildOptimizedPrompt(
            systemPrompt: systemPrompt,
            messages: messages,
            tools: tools
        )

        // Then
        XCTAssertFalse(result.messages.isEmpty, "应该有消息")
        XCTAssertEqual(result.messages.first?.role, "system", "第一条应该是系统消息")
        XCTAssertGreaterThan(result.metadata.staticPartLength, 0, "静态部分应该大于0")
    }

    func testBuildOptimizedPromptWithTaskContext() async {
        // Given
        let systemPrompt = "You are a helpful assistant."
        let messages: [(role: String, content: String)] = [
            ("user", "Help me with coding")
        ]
        let task = TaskContext(
            objective: "Write a function",
            steps: [
                TaskStep(description: "Analyze requirements"),
                TaskStep(description: "Write code"),
                TaskStep(description: "Test")
            ],
            currentStep: 1
        )

        // When
        let result = await contextEngineering.buildOptimizedPrompt(
            systemPrompt: systemPrompt,
            messages: messages,
            taskContext: task
        )

        // Then
        let lastMessage = result.messages.last
        XCTAssertTrue(lastMessage?.content.contains("Current Task Status") ?? false, "应该包含任务状态")
        XCTAssertTrue(lastMessage?.content.contains("Write a function") ?? false, "应该包含任务目标")
    }

    // MARK: - Cache Hit Tests

    func testCacheHitOnSamePrompt() async {
        // Given
        let systemPrompt = "You are a helpful assistant."
        let messages: [(role: String, content: String)] = [("user", "Hello")]

        // When - First call
        _ = await contextEngineering.buildOptimizedPrompt(
            systemPrompt: systemPrompt,
            messages: messages
        )

        // Second call with same system prompt
        let result = await contextEngineering.buildOptimizedPrompt(
            systemPrompt: systemPrompt,
            messages: messages
        )

        // Then
        let stats = await contextEngineering.getStats()
        XCTAssertEqual(stats.cacheHits, 1, "应该有1次缓存命中")
        XCTAssertTrue(result.metadata.wasCacheOptimized, "应该标记为缓存优化")
    }

    func testCacheMissOnDifferentPrompt() async {
        // Given
        let messages: [(role: String, content: String)] = [("user", "Hello")]

        // When - First call
        _ = await contextEngineering.buildOptimizedPrompt(
            systemPrompt: "Prompt A",
            messages: messages
        )

        // Second call with different system prompt
        let result = await contextEngineering.buildOptimizedPrompt(
            systemPrompt: "Prompt B",
            messages: messages
        )

        // Then
        let stats = await contextEngineering.getStats()
        XCTAssertEqual(stats.cacheMisses, 2, "应该有2次缓存未命中")
        XCTAssertFalse(result.metadata.wasCacheOptimized, "不应该标记为缓存优化")
    }

    // MARK: - Tool Serialization Tests

    func testToolSerializationDeterministic() async {
        // Given
        let tools1 = [
            ToolDefinition(name: "z_tool", description: "Z tool"),
            ToolDefinition(name: "a_tool", description: "A tool")
        ]
        let tools2 = [
            ToolDefinition(name: "a_tool", description: "A tool"),
            ToolDefinition(name: "z_tool", description: "Z tool")
        ]

        // When
        let serialized1 = await contextEngineering.serializeToolDefinitions(tools1)
        let serialized2 = await contextEngineering.serializeToolDefinitions(tools2)

        // Then
        XCTAssertEqual(serialized1, serialized2, "相同工具不同顺序应该产生相同序列化结果")
        XCTAssertTrue(serialized1.contains("### a_tool"), "应该包含工具名")
    }

    // MARK: - Error Management Tests

    func testRecordError() async {
        // Given
        let errorMessage = "Connection failed"

        // When
        await contextEngineering.recordError(step: "network", message: errorMessage)

        // Then
        let errors = await contextEngineering.errorHistory
        XCTAssertEqual(errors.count, 1, "应该有1个错误")
        XCTAssertEqual(errors.first?.message, errorMessage, "错误消息应该匹配")
        XCTAssertEqual(errors.first?.step, "network", "步骤应该匹配")
    }

    func testResolveError() async {
        // Given
        await contextEngineering.recordError(message: "Error occurred")
        let errors = await contextEngineering.errorHistory
        guard let errorId = errors.first?.id else {
            XCTFail("应该有错误 ID")
            return
        }

        // When
        await contextEngineering.resolveError(errorId: errorId, resolution: "Fixed by retry")

        // Then
        let updatedErrors = await contextEngineering.errorHistory
        XCTAssertEqual(updatedErrors.first?.resolution, "Fixed by retry", "解决方案应该被记录")
    }

    func testErrorContextBuilding() async {
        // Given
        await contextEngineering.recordError(step: "step1", message: "Error 1")
        await contextEngineering.recordError(step: "step2", message: "Error 2", resolution: "Fixed")

        // When
        let context = await contextEngineering.buildErrorContext()

        // Then
        XCTAssertTrue(context.contains("Recent Errors"), "应该包含标题")
        XCTAssertTrue(context.contains("Error 1"), "应该包含错误1")
        XCTAssertTrue(context.contains("Error 2"), "应该包含错误2")
        XCTAssertTrue(context.contains("Fixed"), "应该包含解决方案")
    }

    // MARK: - Task Management Tests

    func testCreateTask() async {
        // Given
        let objective = "Build a feature"
        let steps = ["Design", "Implement", "Test"]

        // When
        let task = await contextEngineering.createTask(objective: objective, steps: steps)

        // Then
        XCTAssertEqual(task.objective, objective, "目标应该匹配")
        XCTAssertEqual(task.steps.count, 3, "应该有3个步骤")
        XCTAssertEqual(task.currentStep, 0, "当前步骤应该是0")
        XCTAssertEqual(task.status, .pending, "状态应该是待处理")
    }

    func testUpdateTaskProgress() async {
        // Given
        _ = await contextEngineering.createTask(
            objective: "Task",
            steps: ["Step 1", "Step 2", "Step 3"]
        )

        // When
        await contextEngineering.updateTaskProgress(currentStep: 1, status: .inProgress)

        // Then
        let task = await contextEngineering.getCurrentTask()
        XCTAssertEqual(task?.currentStep, 1, "当前步骤应该更新")
        XCTAssertEqual(task?.status, .inProgress, "状态应该更新")
        XCTAssertEqual(task?.steps[0].status, .completed, "步骤0应该完成")
        XCTAssertEqual(task?.steps[1].status, .inProgress, "步骤1应该进行中")
    }

    func testCompleteCurrentStep() async {
        // Given
        _ = await contextEngineering.createTask(
            objective: "Task",
            steps: ["Step 1", "Step 2"]
        )
        await contextEngineering.updateTaskProgress(currentStep: 0, status: .inProgress)

        // When
        await contextEngineering.completeCurrentStep(result: "Step 1 done")

        // Then
        let task = await contextEngineering.getCurrentTask()
        XCTAssertEqual(task?.currentStep, 1, "应该移动到下一步")
        XCTAssertEqual(task?.steps[0].status, .completed, "步骤0应该完成")
        XCTAssertEqual(task?.steps[0].result, "Step 1 done", "应该保存结果")
    }

    func testTaskReminder() async {
        // Given
        let task = TaskContext(
            objective: "Build feature",
            steps: [
                TaskStep(description: "Design", status: .completed),
                TaskStep(description: "Implement", status: .inProgress),
                TaskStep(description: "Test", status: .pending)
            ],
            currentStep: 1
        )

        // When
        let reminder = await contextEngineering.buildTaskReminder(task)

        // Then
        XCTAssertTrue(reminder.contains("Build feature"), "应该包含目标")
        XCTAssertTrue(reminder.contains("[x] Step 1: Design"), "应该显示已完成步骤")
        XCTAssertTrue(reminder.contains("[>] Step 2: Implement"), "应该显示当前步骤")
        XCTAssertTrue(reminder.contains("[ ] Step 3: Test"), "应该显示待完成步骤")
        XCTAssertTrue(reminder.contains("Current Focus"), "应该包含当前焦点")
    }

    // MARK: - Token Estimation Tests

    func testTokenEstimationEnglish() async {
        // Given
        let text = "Hello world, this is a test message."  // 约 37 字符

        // When
        let tokens = await contextEngineering.estimateTokens(text)

        // Then
        XCTAssertGreaterThan(tokens, 0, "Token 数应该大于0")
        XCTAssertLessThan(tokens, 20, "英文文本 Token 估算应该合理")
    }

    func testTokenEstimationChinese() async {
        // Given
        let text = "你好世界，这是一条测试消息。"  // 13 个中文字符

        // When
        let tokens = await contextEngineering.estimateTokens(text)

        // Then
        XCTAssertGreaterThan(tokens, 0, "Token 数应该大于0")
        XCTAssertGreaterThan(tokens, 5, "中文文本 Token 估算应该合理")
    }

    func testTokenEstimationMixed() async {
        // Given
        let text = "Hello 你好 World 世界"

        // When
        let tokens = await contextEngineering.estimateTokens(text)

        // Then
        XCTAssertGreaterThan(tokens, 0, "Token 数应该大于0")
    }

    // MARK: - Statistics Tests

    func testStatistics() async {
        // Given
        let messages: [(role: String, content: String)] = [("user", "test")]

        // When
        _ = await contextEngineering.buildOptimizedPrompt(systemPrompt: "A", messages: messages)
        _ = await contextEngineering.buildOptimizedPrompt(systemPrompt: "A", messages: messages)
        _ = await contextEngineering.buildOptimizedPrompt(systemPrompt: "B", messages: messages)

        // Then
        let stats = await contextEngineering.getStats()
        XCTAssertEqual(stats.totalCalls, 3, "应该有3次调用")
        XCTAssertEqual(stats.cacheHits, 1, "应该有1次缓存命中")
        XCTAssertEqual(stats.cacheMisses, 2, "应该有2次缓存未命中")
        XCTAssertGreaterThan(stats.hitRate, 0, "命中率应该大于0")
    }

    func testResetStatistics() async {
        // Given
        let messages: [(role: String, content: String)] = [("user", "test")]
        _ = await contextEngineering.buildOptimizedPrompt(systemPrompt: "A", messages: messages)

        // When
        await contextEngineering.resetStats()

        // Then
        let stats = await contextEngineering.getStats()
        XCTAssertEqual(stats.totalCalls, 0, "调用次数应该重置")
        XCTAssertEqual(stats.cacheHits, 0, "缓存命中应该重置")
    }
}

// MARK: - Recoverable Compressor Tests

final class RecoverableCompressorTests: XCTestCase {

    var compressor: RecoverableCompressor!

    override func setUp() {
        super.setUp()
        compressor = RecoverableCompressor.shared
    }

    func testCompressShortText() {
        // Given
        let shortText = "Hello"

        // When
        let ref = compressor.compressString(shortText, type: .text)

        // Then
        XCTAssertNil(ref, "短文本不应该被压缩")
    }

    func testCompressLongText() {
        // Given
        let longText = String(repeating: "a", count: 5000)

        // When
        let ref = compressor.compressString(longText, type: .text)

        // Then
        XCTAssertNotNil(ref, "长文本应该被压缩")
        XCTAssertEqual(ref?.refType, .text, "类型应该是 text")
        XCTAssertEqual(ref?.originalLength, 5000, "原始长度应该正确")
        XCTAssertFalse(ref?.recoverable ?? true, "不应该可恢复")
    }

    func testIsCompressedRef() {
        // Given
        let ref = CompressedRef(refType: .text, preview: "...", recoverable: false)

        // When & Then
        XCTAssertTrue(compressor.isCompressedRef(ref), "应该识别为压缩引用")
        XCTAssertFalse(compressor.isCompressedRef("plain string"), "普通字符串不是压缩引用")
    }

    func testRecoverableWebpage() {
        // Given
        let webpage = WebpageContent(url: "https://example.com", content: String(repeating: "x", count: 3000))

        // When
        let result = compressor.compress(webpage, type: .webpage)

        // Then
        if let ref = result as? CompressedRef {
            XCTAssertTrue(ref.recoverable, "应该可恢复")
            XCTAssertEqual(ref.url, "https://example.com", "URL 应该保留")
        } else {
            XCTFail("应该返回压缩引用")
        }
    }

    func testRecoverableFile() {
        // Given
        let file = FileContent(path: "/path/to/file.txt", content: String(repeating: "x", count: 6000))

        // When
        let result = compressor.compress(file, type: .file)

        // Then
        if let ref = result as? CompressedRef {
            XCTAssertTrue(ref.recoverable, "应该可恢复")
            XCTAssertEqual(ref.path, "/path/to/file.txt", "路径应该保留")
        } else {
            XCTFail("应该返回压缩引用")
        }
    }
}

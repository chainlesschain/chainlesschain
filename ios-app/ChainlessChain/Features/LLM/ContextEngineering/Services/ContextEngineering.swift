import Foundation
import Combine
import CommonCrypto
import CoreCommon

/// Context Engineering 管理器
///
/// 基于 Manus AI 的最佳实践，优化 LLM 上下文构建以最大化 KV-Cache 命中率。
///
/// 核心原则（来自 Manus Blog）：
/// 1. 保持 prompt 前缀稳定 - 避免时间戳等动态内容破坏缓存
/// 2. 采用只读追加模式 - 确保序列化确定性
/// 3. 显式标记缓存断点 - 优化缓存边界
/// 4. 将任务目标重述到上下文末尾 - 解决"丢失中间"问题
///
/// @see https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus
///
@MainActor
public class ContextEngineering: ObservableObject {

    // MARK: - Singleton

    public static let shared = ContextEngineering()

    // MARK: - Configuration

    private var config: ContextEngineeringConfig

    // MARK: - Cache State

    /// 静态 Prompt Hash (用于检测变化)
    private var staticPromptHash: String?

    /// 工具定义 Hash
    private var toolDefinitionsHash: String?

    /// 缓存的工具定义字符串
    private var cachedToolDefinitions: String?

    // MARK: - Error History

    /// 错误历史（供模型学习）
    @Published public private(set) var errorHistory: [ErrorRecord] = []

    // MARK: - Task Tracking

    /// 当前任务上下文
    @Published public private(set) var currentTask: TaskContext?

    // MARK: - Statistics

    /// 缓存统计
    @Published public private(set) var stats = CacheStats()

    // MARK: - Token Estimator

    private let tokenEstimator = TokenEstimator()

    // MARK: - Initialization

    private init() {
        self.config = ContextEngineeringConfig()
        Logger.shared.info("[ContextEngineering] 上下文工程管理器已初始化")
    }

    /// 配置管理器
    public func configure(_ config: ContextEngineeringConfig) {
        self.config = config
        Logger.shared.info("[ContextEngineering] 配置已更新")
    }

    // MARK: - Build Optimized Prompt

    /// 构建 KV-Cache 友好的 Prompt
    ///
    /// 关键策略：
    /// - 静态部分（system prompt + 工具定义）放在最前面
    /// - 动态部分（对话历史 + 用户输入）追加在后面
    /// - 任务目标重述在最末尾
    ///
    /// - Parameters:
    ///   - systemPrompt: 系统提示词
    ///   - messages: 对话历史
    ///   - tools: 工具定义
    ///   - taskContext: 任务上下文 (可选)
    /// - Returns: 优化后的 Prompt 结果
    public func buildOptimizedPrompt(
        systemPrompt: String,
        messages: [(role: String, content: String)],
        tools: [ToolDefinition] = [],
        taskContext: TaskContext? = nil
    ) -> OptimizedPromptResult {
        stats.totalCalls += 1

        var resultMessages: [OptimizedMessage] = []
        var metadata = PromptMetadata()

        // === 第一部分：静态内容（高度稳定，可缓存） ===

        // 1. System Prompt（清理动态内容）
        let cleanedSystemPrompt = cleanSystemPrompt(systemPrompt)
        resultMessages.append(OptimizedMessage(
            role: "system",
            content: cleanedSystemPrompt
        ))

        // 2. 工具定义（确定性序列化）
        if !tools.isEmpty {
            let toolDefinitions = serializeToolDefinitions(tools)
            resultMessages.append(OptimizedMessage(
                role: "system",
                content: "## Available Tools\n\(toolDefinitions)"
            ))
        }

        // 标记静态部分结束位置（缓存断点）
        metadata.cacheBreakpoints.append(resultMessages.count)
        metadata.staticPartLength = resultMessages.count

        // === 第二部分：动态内容（只追加，不修改） ===

        // 3. 对话历史（清理后追加）
        let cleanedMessages = cleanMessages(messages)
        resultMessages.append(contentsOf: cleanedMessages)

        // 4. 错误上下文（如果启用且有错误历史）
        if config.preserveErrors && !errorHistory.isEmpty {
            let errorContext = buildErrorContext()
            resultMessages.append(OptimizedMessage(
                role: "system",
                content: errorContext
            ))
        }

        // === 第三部分：任务重述（解决"丢失中间"问题） ===

        // 5. 任务目标重述
        let effectiveTaskContext = taskContext ?? currentTask
        if let task = effectiveTaskContext, config.enableTodoMechanism {
            let taskReminder = buildTaskReminder(task)
            resultMessages.append(OptimizedMessage(
                role: "system",
                content: taskReminder
            ))
        }

        metadata.dynamicPartLength = resultMessages.count - metadata.staticPartLength

        // 检查是否命中缓存（静态部分未变化）
        let currentHash = computeStaticHash(systemPrompt: cleanedSystemPrompt, tools: tools)
        if staticPromptHash == currentHash {
            stats.cacheHits += 1
            metadata.wasCacheOptimized = true
        } else {
            stats.cacheMisses += 1
            staticPromptHash = currentHash
        }

        // 估算 Token 数
        let totalContent = resultMessages.map { $0.content }.joined(separator: "\n")
        metadata.estimatedTokens = tokenEstimator.estimateTokens(totalContent)

        return OptimizedPromptResult(messages: resultMessages, metadata: metadata)
    }

    // MARK: - System Prompt Cleaning

    /// 清理 System Prompt，移除动态内容
    public func cleanSystemPrompt(_ systemPrompt: String) -> String {
        guard !systemPrompt.isEmpty else { return "" }

        var cleaned = systemPrompt

        // 移除 ISO 日期时间戳模式 (2026-02-11T12:30:45.123Z)
        cleaned = cleaned.replacingOccurrences(
            of: #"\b\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?Z?)?\b"#,
            with: "[DATE]",
            options: .regularExpression
        )

        // 移除时间模式 (12:30:45)
        cleaned = cleaned.replacingOccurrences(
            of: #"\b\d{2}:\d{2}(:\d{2})?\b"#,
            with: "[TIME]",
            options: .regularExpression
        )

        // 移除 UUID 模式
        cleaned = cleaned.replacingOccurrences(
            of: #"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b"#,
            with: "[UUID]",
            options: [.regularExpression, .caseInsensitive]
        )

        // 移除会话 ID 等动态标识
        cleaned = cleaned.replacingOccurrences(
            of: #"session[_-]?id\s*[:=]\s*\S+"#,
            with: "session_id: [SESSION]",
            options: [.regularExpression, .caseInsensitive]
        )

        return cleaned
    }

    // MARK: - Tool Definitions Serialization

    /// 序列化工具定义（确保确定性）
    public func serializeToolDefinitions(_ tools: [ToolDefinition]) -> String {
        // 按名称排序，确保顺序一致
        let sorted = tools.sorted { $0.name < $1.name }

        // 计算哈希检查是否需要重新序列化
        let hash = computeHash(sorted.map { $0.name }.joined())

        if hash == toolDefinitionsHash, let cached = cachedToolDefinitions {
            return cached
        }

        // 生成格式化的工具定义
        let definitions = sorted.enumerated().map { index, tool in
            var result = "### \(tool.name)\n\(tool.description)"

            if let params = tool.parameters {
                let encoder = JSONEncoder()
                encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
                if let data = try? encoder.encode(params),
                   let json = String(data: data, encoding: .utf8) {
                    result += "\n\nParameters:\n\(json)"
                }
            }

            return result
        }

        let serialized = definitions.joined(separator: "\n\n")
        toolDefinitionsHash = hash
        cachedToolDefinitions = serialized

        return serialized
    }

    // MARK: - Message Cleaning

    /// 清理消息数组，移除动态内容
    public func cleanMessages(_ messages: [(role: String, content: String)]) -> [OptimizedMessage] {
        return messages.map { msg in
            OptimizedMessage(
                role: msg.role,
                content: msg.content
            )
        }
    }

    // MARK: - Error Context

    /// 构建错误上下文（供模型学习）
    public func buildErrorContext() -> String {
        guard !errorHistory.isEmpty else { return "" }

        let errors = Array(errorHistory.suffix(config.maxPreservedErrors))

        var lines = [
            "## Recent Errors (for learning)",
            ""
        ]

        for (index, error) in errors.enumerated() {
            lines.append("### Error \(index + 1)")
            if let step = error.step {
                lines.append("- Step: \(step)")
            }
            lines.append("- Error: \(error.message)")
            if let resolution = error.resolution {
                lines.append("- Resolution: \(resolution)")
            }
            lines.append("")
        }

        return lines.joined(separator: "\n")
    }

    // MARK: - Task Reminder

    /// 构建任务提醒（重述目标到上下文末尾）
    public func buildTaskReminder(_ task: TaskContext) -> String {
        var lines = [
            "## Current Task Status",
            "",
            "**Objective**: \(task.objective)",
            ""
        ]

        if !task.steps.isEmpty {
            lines.append("**Progress**:")
            for (index, step) in task.steps.enumerated() {
                let marker: String
                if index < task.currentStep {
                    marker = "[x]"  // 已完成
                } else if index == task.currentStep {
                    marker = "[>]"  // 当前步骤
                } else {
                    marker = "[ ]"  // 待完成
                }
                lines.append("\(marker) Step \(index + 1): \(step.description)")
            }
            lines.append("")
        }

        if task.currentStep < task.steps.count {
            let currentStepDesc = task.steps[task.currentStep].description
            lines.append("**Current Focus**: Step \(task.currentStep + 1) - \(currentStepDesc)")
        }

        return lines.joined(separator: "\n")
    }

    // MARK: - Hash Computation

    /// 计算静态部分的哈希值
    private func computeStaticHash(systemPrompt: String, tools: [ToolDefinition]) -> String {
        let content = systemPrompt + tools.map { $0.name + $0.description }.joined()
        return computeHash(content)
    }

    /// 计算字符串 MD5 哈希
    private func computeHash(_ content: String) -> String {
        guard let data = content.data(using: .utf8) else { return "" }

        var hash = [UInt8](repeating: 0, count: Int(CC_MD5_DIGEST_LENGTH))
        data.withUnsafeBytes {
            _ = CC_MD5($0.baseAddress, CC_LONG(data.count), &hash)
        }

        return hash.map { String(format: "%02x", $0) }.joined()
    }

    // MARK: - Error Management

    /// 记录错误（供模型学习）
    public func recordError(step: String? = nil, message: String, resolution: String? = nil) {
        let error = ErrorRecord(step: step, message: message, resolution: resolution)
        errorHistory.append(error)

        // 保持历史记录在限制内
        if errorHistory.count > config.maxPreservedErrors * 2 {
            errorHistory = Array(errorHistory.suffix(config.maxPreservedErrors))
        }

        Logger.shared.info("[ContextEngineering] 错误已记录: \(message)")
    }

    /// 标记错误已解决
    public func resolveError(errorId: String, resolution: String) {
        if let index = errorHistory.firstIndex(where: { $0.id == errorId }) {
            var error = errorHistory[index]
            error.resolution = resolution
            errorHistory[index] = error
            Logger.shared.info("[ContextEngineering] 错误已解决: \(errorId)")
        }
    }

    /// 清除错误历史
    public func clearErrors() {
        errorHistory.removeAll()
        Logger.shared.info("[ContextEngineering] 错误历史已清除")
    }

    // MARK: - Task Management

    /// 设置当前任务上下文
    public func setCurrentTask(_ task: TaskContext) {
        currentTask = task
        Logger.shared.info("[ContextEngineering] 任务已设置: \(task.objective)")
    }

    /// 创建新任务
    public func createTask(objective: String, steps: [String]) -> TaskContext {
        let taskSteps = steps.map { TaskStep(description: $0) }
        let task = TaskContext(objective: objective, steps: taskSteps)
        currentTask = task
        Logger.shared.info("[ContextEngineering] 新任务已创建: \(objective)")
        return task
    }

    /// 更新任务进度
    public func updateTaskProgress(currentStep: Int, status: TaskStatus = .inProgress) {
        guard var task = currentTask else { return }

        task.currentStep = currentStep
        task.status = status
        task.updatedAt = Date()

        // 更新步骤状态
        for i in 0..<task.steps.count {
            if i < currentStep {
                task.steps[i].status = .completed
            } else if i == currentStep {
                task.steps[i].status = .inProgress
            } else {
                task.steps[i].status = .pending
            }
        }

        currentTask = task
        Logger.shared.info("[ContextEngineering] 任务进度已更新: 步骤 \(currentStep + 1)")
    }

    /// 完成当前步骤
    public func completeCurrentStep(result: String? = nil) {
        guard var task = currentTask else { return }

        if task.currentStep < task.steps.count {
            task.steps[task.currentStep].status = .completed
            task.steps[task.currentStep].result = result

            if task.currentStep + 1 < task.steps.count {
                task.currentStep += 1
                task.steps[task.currentStep].status = .inProgress
            } else {
                task.status = .completed
            }

            task.updatedAt = Date()
            currentTask = task
        }
    }

    /// 获取当前任务上下文
    public func getCurrentTask() -> TaskContext? {
        return currentTask
    }

    /// 清除任务上下文
    public func clearTask() {
        currentTask = nil
        Logger.shared.info("[ContextEngineering] 任务上下文已清除")
    }

    // MARK: - Statistics

    /// 获取统计信息
    public func getStats() -> CacheStats {
        return stats
    }

    /// 重置统计
    public func resetStats() {
        stats = CacheStats()
        Logger.shared.info("[ContextEngineering] 统计已重置")
    }

    // MARK: - Token Estimation

    /// 估算 Token 数
    public func estimateTokens(_ text: String) -> Int {
        return tokenEstimator.estimateTokens(text)
    }

    /// 估算消息数组的 Token 数
    public func estimateMessagesTokens(_ messages: [OptimizedMessage]) -> Int {
        let totalContent = messages.map { $0.content }.joined(separator: "\n")
        return tokenEstimator.estimateTokens(totalContent)
    }
}

// MARK: - Token Estimator

/// Token 估算器
public class TokenEstimator {

    /// 估算文本的 Token 数
    /// 使用简化的估算规则：
    /// - 英文：约 4 个字符 = 1 token
    /// - 中文：约 1.5 个字符 = 1 token
    public func estimateTokens(_ text: String) -> Int {
        guard !text.isEmpty else { return 0 }

        var chineseCount = 0
        var otherCount = 0

        for char in text {
            if char.isChineseCharacter {
                chineseCount += 1
            } else {
                otherCount += 1
            }
        }

        // 中文字符估算
        let chineseTokens = Int(ceil(Double(chineseCount) / 1.5))

        // 其他字符估算（主要是英文）
        let otherTokens = Int(ceil(Double(otherCount) / 4.0))

        return chineseTokens + otherTokens
    }

    /// 检测文本是否主要是中文
    public func isPrimarilyChinese(_ text: String) -> Bool {
        guard !text.isEmpty else { return false }

        var chineseCount = 0
        var totalCount = 0

        for char in text where !char.isWhitespace {
            totalCount += 1
            if char.isChineseCharacter {
                chineseCount += 1
            }
        }

        guard totalCount > 0 else { return false }
        return Double(chineseCount) / Double(totalCount) > 0.3
    }
}

// MARK: - Character Extension

private extension Character {
    /// 判断是否为中文字符
    var isChineseCharacter: Bool {
        guard let scalar = unicodeScalars.first else { return false }

        // CJK Unified Ideographs
        if (0x4E00...0x9FFF).contains(scalar.value) { return true }

        // CJK Unified Ideographs Extension A
        if (0x3400...0x4DBF).contains(scalar.value) { return true }

        // CJK Unified Ideographs Extension B
        if (0x20000...0x2A6DF).contains(scalar.value) { return true }

        // CJK Compatibility Ideographs
        if (0xF900...0xFAFF).contains(scalar.value) { return true }

        // Chinese punctuation
        if (0x3000...0x303F).contains(scalar.value) { return true }
        if (0xFF00...0xFFEF).contains(scalar.value) { return true }

        return false
    }
}

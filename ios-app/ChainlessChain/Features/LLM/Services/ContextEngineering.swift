import Foundation
import CoreCommon
import CryptoKit

/// Context Engineering 模块
/// 基于 Manus AI 的最佳实践，优化 LLM 上下文构建以最大化 KV-Cache 命中率
///
/// 核心原则（来自 Manus Blog）：
/// 1. 保持 prompt 前缀稳定 - 避免时间戳等动态内容破坏缓存
/// 2. 采用只读追加模式 - 确保序列化确定性
/// 3. 显式标记缓存断点 - 优化缓存边界
/// 4. 将任务目标重述到上下文末尾 - 解决"丢失中间"问题
@MainActor
public class ContextEngineering: ObservableObject {

    // MARK: - Singleton

    public static let shared = ContextEngineering()

    // MARK: - Configuration

    public struct Config {
        public var enableKVCacheOptimization: Bool = true
        public var enableTodoMechanism: Bool = true
        public var maxHistoryMessages: Int = 50
        public var preserveErrors: Bool = true
        public var maxPreservedErrors: Int = 5

        public init() {}
    }

    // MARK: - Properties

    private var config: Config

    /// 静态 prompt 缓存哈希
    private var staticPromptHash: String?

    /// 工具定义缓存
    private var toolDefinitionsHash: String?
    private var cachedToolDefinitions: String?

    /// 错误历史（用于模型学习）
    @Published public var errorHistory: [ErrorRecord] = []

    /// 当前任务上下文
    @Published public var currentTask: TaskContext?

    /// 统计数据
    @Published public var stats: ContextStats

    // MARK: - Initialization

    private init() {
        self.config = Config()
        self.stats = ContextStats()
        Logger.shared.info("[ContextEngineering] 上下文工程已初始化")
    }

    /// 配置
    public func configure(_ config: Config) {
        self.config = config
    }

    // MARK: - Build Optimized Prompt

    /// 构建 KV-Cache 友好的 Prompt
    ///
    /// 关键策略：
    /// - 静态部分（system prompt + 工具定义）放在最前面
    /// - 动态部分（对话历史 + 用户输入）追加在后面
    /// - 任务目标重述在最末尾
    public func buildOptimizedPrompt(
        systemPrompt: String?,
        messages: [PromptMessage],
        tools: [ToolDefinition] = [],
        taskContext: TaskContext? = nil
    ) -> OptimizedPromptResult {
        stats.totalCalls += 1

        var resultMessages: [PromptMessage] = []
        var cacheBreakpoints: [Int] = []

        // === 第一部分：静态内容（高度稳定，可缓存） ===

        // 1. System Prompt（不包含时间戳等动态内容）
        let cleanedSystemPrompt = cleanSystemPrompt(systemPrompt ?? "")
        if !cleanedSystemPrompt.isEmpty {
            resultMessages.append(PromptMessage(role: .system, content: cleanedSystemPrompt))
        }

        // 2. 工具定义（确定性序列化）
        if !tools.isEmpty {
            let toolDefinitions = serializeToolDefinitions(tools)
            resultMessages.append(PromptMessage(
                role: .system,
                content: "## Available Tools\n\(toolDefinitions)"
            ))
        }

        // 标记静态部分结束位置（缓存断点）
        cacheBreakpoints.append(resultMessages.count)
        let staticPartLength = resultMessages.count

        // === 第二部分：动态内容（只追加，不修改） ===

        // 3. 对话历史（清理后追加）
        let cleanedMessages = cleanMessages(messages)
        resultMessages.append(contentsOf: cleanedMessages)

        // 4. 错误上下文（如果启用且有错误历史）
        if config.preserveErrors && !errorHistory.isEmpty {
            let errorContext = buildErrorContext()
            resultMessages.append(PromptMessage(role: .system, content: errorContext))
        }

        // === 第三部分：任务重述（解决"丢失中间"问题） ===

        // 5. 任务目标重述（如果有任务上下文）
        let effectiveTaskContext = taskContext ?? currentTask
        if let task = effectiveTaskContext, config.enableTodoMechanism {
            let taskReminder = buildTaskReminder(task)
            resultMessages.append(PromptMessage(role: .system, content: taskReminder))
        }

        let dynamicPartLength = resultMessages.count - staticPartLength

        // 检查是否命中缓存（静态部分未变化）
        let currentHash = computeStaticHash(systemPrompt: cleanedSystemPrompt, tools: tools)
        let wasCacheOptimized: Bool
        if staticPromptHash == currentHash {
            stats.cacheHits += 1
            wasCacheOptimized = true
        } else {
            stats.cacheMisses += 1
            staticPromptHash = currentHash
            wasCacheOptimized = false
        }

        return OptimizedPromptResult(
            messages: resultMessages,
            metadata: PromptMetadata(
                cacheBreakpoints: cacheBreakpoints,
                staticPartLength: staticPartLength,
                dynamicPartLength: dynamicPartLength,
                wasCacheOptimized: wasCacheOptimized
            )
        )
    }

    // MARK: - Clean System Prompt

    /// 清理 System Prompt，移除动态内容
    private func cleanSystemPrompt(_ systemPrompt: String) -> String {
        guard !systemPrompt.isEmpty else { return "" }

        var cleaned = systemPrompt

        // 移除时间戳模式 (YYYY-MM-DD, HH:MM:SS)
        cleaned = cleaned.replacingOccurrences(
            of: #"\b\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?Z?)?\b"#,
            with: "[DATE]",
            options: .regularExpression
        )

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

        // 移除会话 ID
        cleaned = cleaned.replacingOccurrences(
            of: #"session[_-]?id\s*[:=]\s*\S+"#,
            with: "session_id: [SESSION]",
            options: [.regularExpression, .caseInsensitive]
        )

        return cleaned
    }

    // MARK: - Serialize Tool Definitions

    /// 序列化工具定义（确保确定性）
    private func serializeToolDefinitions(_ tools: [ToolDefinition]) -> String {
        // 按名称排序，确保顺序一致
        let sorted = tools.sorted { $0.name < $1.name }

        // 计算哈希检查是否需要重新序列化
        let hash = computeHash(sorted.description)
        if hash == toolDefinitionsHash, let cached = cachedToolDefinitions {
            return cached
        }

        // 生成格式化的工具定义
        let definitions = sorted.enumerated().map { index, tool in
            """
            ### \(tool.name)
            \(tool.description)

            Parameters:
            \(formatParameters(tool.parameters))
            """
        }

        toolDefinitionsHash = hash
        cachedToolDefinitions = definitions.joined(separator: "\n\n")

        return cachedToolDefinitions!
    }

    private func formatParameters(_ parameters: [String: Any]) -> String {
        if let data = try? JSONSerialization.data(withJSONObject: parameters, options: .prettyPrinted),
           let json = String(data: data, encoding: .utf8) {
            return json
        }
        return "{}"
    }

    // MARK: - Clean Messages

    /// 清理消息数组，移除动态内容
    private func cleanMessages(_ messages: [PromptMessage]) -> [PromptMessage] {
        return messages.map { msg in
            // 保留核心字段，移除时间戳和 ID
            return PromptMessage(
                role: msg.role,
                content: msg.content,
                functionCall: msg.functionCall,
                toolCalls: msg.toolCalls,
                name: msg.name
            )
        }
    }

    // MARK: - Error Context

    /// 构建错误上下文（供模型学习）
    private func buildErrorContext() -> String {
        guard !errorHistory.isEmpty else { return "" }

        let errors = Array(errorHistory.suffix(config.maxPreservedErrors))

        var lines = ["## Recent Errors (for learning)", ""]

        for (index, error) in errors.enumerated() {
            lines.append("### Error \(index + 1)")
            lines.append("- Step: \(error.step ?? "unknown")")
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
    private func buildTaskReminder(_ task: TaskContext) -> String {
        var lines = [
            "## Current Task Status",
            "",
            "**Objective**: \(task.objective ?? "Complete the user request")",
            ""
        ]

        if !task.steps.isEmpty {
            lines.append("**Progress**:")
            for (index, step) in task.steps.enumerated() {
                let marker: String
                if index < task.currentStep {
                    marker = "[x]"
                } else if index == task.currentStep {
                    marker = "[>]"
                } else {
                    marker = "[ ]"
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

    private func computeStaticHash(systemPrompt: String, tools: [ToolDefinition]) -> String {
        let content = "\(systemPrompt)\(tools.description)"
        return computeHash(content)
    }

    private func computeHash(_ content: String) -> String {
        let data = Data(content.utf8)
        let hash = Insecure.MD5.hash(data: data)
        return hash.compactMap { String(format: "%02x", $0) }.joined()
    }

    // MARK: - Error Management

    /// 记录错误（供模型学习）
    public func recordError(
        step: String? = nil,
        message: String,
        resolution: String? = nil
    ) {
        let error = ErrorRecord(
            step: step,
            message: message,
            resolution: resolution
        )

        errorHistory.append(error)

        // 保持历史记录在限制内
        if errorHistory.count > config.maxPreservedErrors * 2 {
            errorHistory = Array(errorHistory.suffix(config.maxPreservedErrors))
        }

        Logger.shared.info("[ContextEngineering] 错误已记录: \(message)")
    }

    /// 标记错误已解决
    public func resolveError(at index: Int, resolution: String) {
        guard index >= 0 && index < errorHistory.count else { return }
        errorHistory[index].resolution = resolution
    }

    /// 清除错误历史
    public func clearErrorHistory() {
        errorHistory.removeAll()
    }

    // MARK: - Task Management

    /// 设置当前任务上下文
    public func setCurrentTask(_ task: TaskContext) {
        currentTask = task
        Logger.shared.info("[ContextEngineering] 任务已设置: \(task.objective ?? "未命名")")
    }

    /// 更新任务进度
    public func updateTaskProgress(currentStep: Int, status: TaskStatus? = nil) {
        guard var task = currentTask else { return }

        task.currentStep = currentStep
        if let status = status {
            task.status = status
        }

        currentTask = task
    }

    /// 清除当前任务
    public func clearCurrentTask() {
        currentTask = nil
    }

    // MARK: - Statistics

    /// 重置统计
    public func resetStats() {
        stats = ContextStats()
    }

    /// 获取缓存命中率
    public var cacheHitRate: Double {
        guard stats.totalCalls > 0 else { return 0 }
        return Double(stats.cacheHits) / Double(stats.totalCalls)
    }

    // MARK: - Token Estimation

    /// 估算 Token 数量（支持中英文）
    public func estimateTokens(_ text: String) -> Int {
        // 简化的 Token 估算
        // 中文：约 1.5 token/字
        // 英文：约 0.75 token/单词

        var chineseCharCount = 0
        var otherCharCount = 0

        for char in text {
            if char.isChineseCharacter {
                chineseCharCount += 1
            } else {
                otherCharCount += 1
            }
        }

        let chineseTokens = Int(Double(chineseCharCount) * 1.5)
        let otherTokens = Int(Double(otherCharCount) * 0.25)  // 约 4 字符 = 1 token

        return chineseTokens + otherTokens
    }
}

// MARK: - Supporting Types

/// Prompt 消息
public struct PromptMessage: Codable {
    public let role: MessageRole
    public let content: String
    public let functionCall: FunctionCall?
    public let toolCalls: [ToolCall]?
    public let name: String?

    public init(
        role: MessageRole,
        content: String,
        functionCall: FunctionCall? = nil,
        toolCalls: [ToolCall]? = nil,
        name: String? = nil
    ) {
        self.role = role
        self.content = content
        self.functionCall = functionCall
        self.toolCalls = toolCalls
        self.name = name
    }
}

/// 函数调用
public struct FunctionCall: Codable {
    public let name: String
    public let arguments: String

    public init(name: String, arguments: String) {
        self.name = name
        self.arguments = arguments
    }
}

/// 工具调用
public struct ToolCall: Codable {
    public let id: String
    public let type: String
    public let function: FunctionCall

    public init(id: String, type: String, function: FunctionCall) {
        self.id = id
        self.type = type
        self.function = function
    }
}

/// 工具定义
public struct ToolDefinition {
    public let name: String
    public let description: String
    public let parameters: [String: Any]

    public init(name: String, description: String, parameters: [String: Any] = [:]) {
        self.name = name
        self.description = description
        self.parameters = parameters
    }
}

/// 优化后的 Prompt 结果
public struct OptimizedPromptResult {
    public let messages: [PromptMessage]
    public let metadata: PromptMetadata

    public init(messages: [PromptMessage], metadata: PromptMetadata) {
        self.messages = messages
        self.metadata = metadata
    }
}

/// Prompt 元数据
public struct PromptMetadata {
    public let cacheBreakpoints: [Int]
    public let staticPartLength: Int
    public let dynamicPartLength: Int
    public let wasCacheOptimized: Bool

    public init(
        cacheBreakpoints: [Int],
        staticPartLength: Int,
        dynamicPartLength: Int,
        wasCacheOptimized: Bool
    ) {
        self.cacheBreakpoints = cacheBreakpoints
        self.staticPartLength = staticPartLength
        self.dynamicPartLength = dynamicPartLength
        self.wasCacheOptimized = wasCacheOptimized
    }
}

/// 错误记录
public struct ErrorRecord: Identifiable {
    public let id = UUID()
    public let step: String?
    public let message: String
    public var resolution: String?
    public let timestamp: Date

    public init(step: String? = nil, message: String, resolution: String? = nil) {
        self.step = step
        self.message = message
        self.resolution = resolution
        self.timestamp = Date()
    }
}

/// 任务上下文
public struct TaskContext {
    public var objective: String?
    public var steps: [TaskStep]
    public var currentStep: Int
    public var status: TaskStatus

    public init(
        objective: String? = nil,
        steps: [TaskStep] = [],
        currentStep: Int = 0,
        status: TaskStatus = .pending
    ) {
        self.objective = objective
        self.steps = steps
        self.currentStep = currentStep
        self.status = status
    }
}

/// 任务步骤
public struct TaskStep {
    public let description: String
    public var completed: Bool

    public init(description: String, completed: Bool = false) {
        self.description = description
        self.completed = completed
    }
}

/// 任务状态
public enum TaskStatus: String {
    case pending
    case inProgress = "in_progress"
    case completed
    case failed
    case cancelled
}

/// 上下文统计
public struct ContextStats {
    public var cacheHits: Int = 0
    public var cacheMisses: Int = 0
    public var totalCalls: Int = 0
    public var compressionSavings: Int = 0

    public init() {}
}

// MARK: - Character Extension

private extension Character {
    /// 检查是否是中文字符
    var isChineseCharacter: Bool {
        guard let scalar = unicodeScalars.first else { return false }
        return (0x4E00...0x9FFF).contains(scalar.value) ||
               (0x3400...0x4DBF).contains(scalar.value) ||
               (0x20000...0x2A6DF).contains(scalar.value)
    }
}

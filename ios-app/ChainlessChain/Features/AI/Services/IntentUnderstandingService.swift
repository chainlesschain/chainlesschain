import Foundation
import CoreCommon

/// 意图理解服务
/// 负责用户输入的纠错和意图识别
/// Reference: desktop-app-vue/src/main/project/project-ai-ipc.js (understandIntent)
@MainActor
class IntentUnderstandingService: ObservableObject {
    // MARK: - Singleton

    static let shared = IntentUnderstandingService()

    // MARK: - Dependencies

    private let llmManager = LLMManager.shared
    private let logger = Logger.shared

    // MARK: - Published Properties

    @Published var isProcessing = false
    @Published var lastResult: IntentResult?
    @Published var error: String?

    // MARK: - Types

    /// 意图理解结果
    struct IntentResult: Codable {
        let success: Bool
        let correctedInput: String      // 纠错后的输入
        let intent: String              // 用户意图描述
        let keyPoints: [String]         // 关键要点
        let confidence: Double?         // 置信度 (可选)
        let suggestions: [String]?      // 建议操作 (可选)

        /// 是否有纠错
        var hasCorrected: Bool {
            return correctedInput != correctedInput // This will be set properly during parsing
        }
    }

    /// 上下文模式
    enum ContextMode: String, Codable {
        case project = "project"
        case file = "file"
        case global = "global"
        case chat = "chat"
    }

    /// 意图类型
    enum IntentType: String, Codable {
        case create = "create"          // 创建内容
        case edit = "edit"              // 编辑内容
        case search = "search"          // 搜索查找
        case explain = "explain"        // 解释说明
        case generate = "generate"      // 生成代码/文档
        case analyze = "analyze"        // 分析内容
        case convert = "convert"        // 转换格式
        case organize = "organize"      // 整理组织
        case question = "question"      // 提问
        case command = "command"        // 执行命令
        case other = "other"            // 其他
    }

    private init() {}

    // MARK: - Public API

    /// 理解用户意图
    /// - Parameters:
    ///   - userInput: 用户输入文本
    ///   - contextMode: 上下文模式
    ///   - projectContext: 项目上下文信息（可选）
    /// - Returns: 意图理解结果
    func understandIntent(
        userInput: String,
        contextMode: ContextMode = .global,
        projectContext: ProjectContextInfo? = nil
    ) async throws -> IntentResult {
        guard !userInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw IntentError.emptyInput
        }

        isProcessing = true
        error = nil

        defer { isProcessing = false }

        // 构建系统提示词
        let systemPrompt = buildSystemPrompt(contextMode: contextMode, projectContext: projectContext)

        // 构建用户提示词
        let userPrompt = """
        请理解以下用户输入：

        用户输入：\(userInput)

        上下文模式：\(contextMode.rawValue)
        \(projectContext != nil ? "项目名称：\(projectContext!.projectName)" : "")
        """

        // 调用 LLM
        let messages: [[String: String]] = [
            ["role": "system", "content": systemPrompt],
            ["role": "user", "content": userPrompt]
        ]

        do {
            logger.info("[IntentService] 开始理解用户意图...", category: "AI")

            let result = try await llmManager.chat(messages: messages, options: [
                "temperature": 0.3,  // 较低温度以获得更准确的结果
                "maxTokens": 500
            ])

            let responseContent = result["content"] as? String ?? ""

            // 解析响应
            let intentResult = try parseIntentResponse(responseContent, originalInput: userInput)

            lastResult = intentResult
            logger.info("[IntentService] 意图理解成功: \(intentResult.intent)", category: "AI")

            return intentResult

        } catch {
            self.error = error.localizedDescription
            logger.error("[IntentService] 意图理解失败", error: error, category: "AI")

            // 返回默认结果
            let defaultResult = IntentResult(
                success: true,
                correctedInput: userInput,
                intent: "理解用户需求并提供帮助",
                keyPoints: [String(userInput.prefix(50)) + (userInput.count > 50 ? "..." : "")],
                confidence: 0.5,
                suggestions: nil
            )
            lastResult = defaultResult
            return defaultResult
        }
    }

    /// 快速纠错（不进行完整意图分析）
    func quickCorrect(userInput: String) async throws -> String {
        guard !userInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return userInput
        }

        let prompt = """
        请纠正以下文本中的打字错误、拼写错误和语法错误。
        如果没有错误，请原样返回。
        只返回纠正后的文本，不要添加任何解释。

        原文：\(userInput)
        """

        let messages: [[String: String]] = [
            ["role": "user", "content": prompt]
        ]

        let result = try await llmManager.chat(messages: messages, options: [
            "temperature": 0.1,
            "maxTokens": 200
        ])

        return result["content"] as? String ?? userInput
    }

    /// 提取关键词
    func extractKeywords(text: String, maxCount: Int = 5) async throws -> [String] {
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return []
        }

        let prompt = """
        请从以下文本中提取最多 \(maxCount) 个关键词。
        以 JSON 数组格式返回，例如：["关键词1", "关键词2"]

        文本：\(text)
        """

        let messages: [[String: String]] = [
            ["role": "user", "content": prompt]
        ]

        let result = try await llmManager.chat(messages: messages, options: [
            "temperature": 0.2,
            "maxTokens": 100
        ])

        let responseContent = result["content"] as? String ?? "[]"

        // 解析 JSON 数组
        if let jsonMatch = responseContent.range(of: #"\[[\s\S]*?\]"#, options: .regularExpression),
           let data = String(responseContent[jsonMatch]).data(using: .utf8),
           let keywords = try? JSONDecoder().decode([String].self, from: data) {
            return Array(keywords.prefix(maxCount))
        }

        return []
    }

    /// 识别意图类型
    func classifyIntent(userInput: String) async throws -> IntentType {
        let prompt = """
        请分析以下用户输入的意图类型，从以下选项中选择最匹配的一个：
        - create: 创建新内容
        - edit: 编辑修改内容
        - search: 搜索查找
        - explain: 解释说明
        - generate: 生成代码或文档
        - analyze: 分析内容
        - convert: 转换格式
        - organize: 整理组织
        - question: 提问
        - command: 执行命令
        - other: 其他

        只返回意图类型的英文标识，不要添加其他内容。

        用户输入：\(userInput)
        """

        let messages: [[String: String]] = [
            ["role": "user", "content": prompt]
        ]

        let result = try await llmManager.chat(messages: messages, options: [
            "temperature": 0.1,
            "maxTokens": 20
        ])

        let responseContent = (result["content"] as? String ?? "other")
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()

        return IntentType(rawValue: responseContent) ?? .other
    }

    // MARK: - Private Helpers

    private func buildSystemPrompt(contextMode: ContextMode, projectContext: ProjectContextInfo?) -> String {
        var prompt = """
        你是一个智能的意图理解助手。你的任务是：

        1. **纠错处理**：识别并纠正用户输入中的打字错误、拼写错误、语法错误等问题
        2. **意图识别**：理解用户的真实意图和需求
        3. **要点提取**：提取用户需求的关键要点

        请以JSON格式返回结果，格式如下：
        ```json
        {
          "correctedInput": "纠错后的输入（如果没有错误，则与原输入相同）",
          "intent": "用户的意图描述（简短的一句话）",
          "keyPoints": ["关键要点1", "关键要点2", "关键要点3"],
          "confidence": 0.9,
          "suggestions": ["建议操作1", "建议操作2"]
        }
        ```

        **注意事项：**
        - 如果输入没有错误，correctedInput应该与原输入完全相同
        - intent应该简洁明了，不超过30个字
        - keyPoints应该提取3-5个核心要点
        - confidence是你对理解结果的置信度，范围0-1
        - suggestions是可选的，提供1-3个建议操作
        - 必须返回有效的JSON格式
        """

        // 添加上下文相关提示
        switch contextMode {
        case .project:
            prompt += "\n\n当前上下文：项目管理模式，用户可能在进行项目相关操作。"
        case .file:
            prompt += "\n\n当前上下文：文件编辑模式，用户可能在编辑或处理文件。"
        case .chat:
            prompt += "\n\n当前上下文：对话模式，用户正在与AI进行对话。"
        case .global:
            prompt += "\n\n当前上下文：全局模式，用户可能进行任何类型的操作。"
        }

        if let context = projectContext {
            prompt += "\n项目信息：\(context.projectName)（\(context.projectType)）"
        }

        return prompt
    }

    private func parseIntentResponse(_ response: String, originalInput: String) throws -> IntentResult {
        // 尝试提取 JSON
        let jsonPatterns = [
            #"```json\s*([\s\S]*?)```"#,
            #"```\s*([\s\S]*?)```"#,
            #"\{[\s\S]*\}"#
        ]

        var jsonText: String?

        for pattern in jsonPatterns {
            if let regex = try? NSRegularExpression(pattern: pattern),
               let match = regex.firstMatch(in: response, range: NSRange(response.startIndex..., in: response)) {
                if match.numberOfRanges > 1, let range = Range(match.range(at: 1), in: response) {
                    jsonText = String(response[range])
                } else if let range = Range(match.range, in: response) {
                    jsonText = String(response[range])
                }
                break
            }
        }

        guard let json = jsonText, let data = json.data(using: .utf8) else {
            throw IntentError.parseError("无法从响应中提取JSON")
        }

        // 解析 JSON
        struct RawIntentResult: Codable {
            var correctedInput: String?
            var intent: String?
            var keyPoints: [String]?
            var confidence: Double?
            var suggestions: [String]?
        }

        let rawResult = try JSONDecoder().decode(RawIntentResult.self, from: data)

        return IntentResult(
            success: true,
            correctedInput: rawResult.correctedInput ?? originalInput,
            intent: rawResult.intent ?? "未能识别意图",
            keyPoints: rawResult.keyPoints ?? [],
            confidence: rawResult.confidence,
            suggestions: rawResult.suggestions
        )
    }
}

// MARK: - Supporting Types

struct ProjectContextInfo {
    let projectId: String
    let projectName: String
    let projectType: String
    let currentFile: String?
}

// MARK: - Errors

enum IntentError: LocalizedError {
    case emptyInput
    case llmNotAvailable
    case parseError(String)

    var errorDescription: String? {
        switch self {
        case .emptyInput:
            return "输入不能为空"
        case .llmNotAvailable:
            return "AI 服务不可用"
        case .parseError(let message):
            return "解析失败: \(message)"
        }
    }
}

// MARK: - Convenience Extensions

extension IntentUnderstandingService {
    /// 批量理解多个输入
    func understandIntents(
        inputs: [String],
        contextMode: ContextMode = .global
    ) async throws -> [IntentResult] {
        var results: [IntentResult] = []

        for input in inputs {
            let result = try await understandIntent(userInput: input, contextMode: contextMode)
            results.append(result)
        }

        return results
    }

    /// 检查输入是否需要纠错
    func needsCorrection(userInput: String) async throws -> Bool {
        let result = try await understandIntent(userInput: userInput)
        return result.correctedInput != userInput
    }
}

import Foundation
import CoreCommon

/// 项目 AI 管理器
/// 负责项目上下文中的 AI 功能集成
/// Reference: desktop-app-vue/src/main/project/project-ai-ipc.js
@MainActor
class ProjectAIManager: ObservableObject {
    // MARK: - Singleton

    static let shared = ProjectAIManager()

    // MARK: - Dependencies

    private let projectManager = ProjectManager.shared
    private let llmManager = LLMManager.shared
    private let aiConversationRepository = AIConversationRepository.shared
    private let logger = Logger.shared

    // MARK: - Published Properties

    @Published var currentConversationId: String?
    @Published var conversationHistory: [ConversationMessage] = []
    @Published var isProcessing = false
    @Published var error: String?

    // MARK: - Types

    struct ConversationMessage: Identifiable {
        let id = UUID().uuidString
        let role: String  // "user", "assistant", "system"
        let content: String
        let timestamp: Date
        var toolCalls: [ToolCall]?

        struct ToolCall: Codable {
            let name: String
            let arguments: [String: String]
            var result: String?
        }
    }

    struct ProjectContext {
        let projectId: String
        let projectName: String
        let projectType: ProjectType
        let currentFile: ProjectFileEntity?
        let fileList: [ProjectFileEntity]
        let contextMode: ContextMode

        enum ContextMode: String {
            case project = "project"
            case file = "file"
            case global = "global"
        }
    }

    struct AIResponse {
        let content: String
        let hasFileOperations: Bool
        let fileOperations: [FileOperation]
        let tokens: Int

        struct FileOperation: Codable {
            let type: String  // "create", "update", "delete"
            let path: String
            let content: String?
        }
    }

    private init() {}

    // MARK: - AI Chat

    /// 在项目上下文中进行 AI 对话
    func chat(
        projectId: String,
        userMessage: String,
        contextMode: ProjectContext.ContextMode = .project,
        currentFile: ProjectFileEntity? = nil
    ) async throws -> AIResponse {
        isProcessing = true
        error = nil

        defer { isProcessing = false }

        // Get project info
        guard let project = projectManager.projects.first(where: { $0.id == projectId }) else {
            throw ProjectAIError.projectNotFound
        }

        // Get project files for context
        let files = try? ProjectRepository.shared.getProjectFiles(projectId: projectId)

        // Build context
        let context = ProjectContext(
            projectId: projectId,
            projectName: project.name,
            projectType: project.type,
            currentFile: currentFile,
            fileList: files ?? [],
            contextMode: contextMode
        )

        // Build system prompt
        let systemPrompt = buildSystemPrompt(context: context)

        // Build messages
        var messages: [[String: String]] = [
            ["role": "system", "content": systemPrompt]
        ]

        // Add conversation history
        for msg in conversationHistory.suffix(10) {
            messages.append(["role": msg.role, "content": msg.content])
        }

        // Add user message
        messages.append(["role": "user", "content": userMessage])

        // Add to history
        let userMsg = ConversationMessage(
            role: "user",
            content: userMessage,
            timestamp: Date()
        )
        conversationHistory.append(userMsg)

        // Call LLM
        do {
            let result = try await llmManager.chat(messages: messages)
            let responseContent = result["content"] as? String ?? ""
            let tokens = result["tokens"] as? Int ?? 0

            // Parse response for file operations
            let (content, fileOps) = parseAIResponse(responseContent)

            // Add assistant response to history
            let assistantMsg = ConversationMessage(
                role: "assistant",
                content: content,
                timestamp: Date()
            )
            conversationHistory.append(assistantMsg)

            // Execute file operations if any
            if !fileOps.isEmpty {
                await executeFileOperations(fileOps, projectId: projectId)
            }

            // Save conversation
            try await saveConversation(projectId: projectId)

            logger.info("[ProjectAI] Chat completed for project: \(project.name)", category: "AI")

            return AIResponse(
                content: content,
                hasFileOperations: !fileOps.isEmpty,
                fileOperations: fileOps,
                tokens: tokens
            )

        } catch {
            self.error = error.localizedDescription
            logger.error("[ProjectAI] Chat failed", error: error, category: "AI")
            throw error
        }
    }

    /// 流式 AI 对话
    func chatStream(
        projectId: String,
        userMessage: String,
        contextMode: ProjectContext.ContextMode = .project,
        onChunk: @escaping (String) -> Void
    ) async throws -> AIResponse {
        isProcessing = true
        error = nil

        defer { isProcessing = false }

        // Get project info
        guard let project = projectManager.projects.first(where: { $0.id == projectId }) else {
            throw ProjectAIError.projectNotFound
        }

        // Get project files for context
        let files = try? ProjectRepository.shared.getProjectFiles(projectId: projectId)

        // Build context
        let context = ProjectContext(
            projectId: projectId,
            projectName: project.name,
            projectType: project.type,
            currentFile: nil,
            fileList: files ?? [],
            contextMode: contextMode
        )

        // Build system prompt
        let systemPrompt = buildSystemPrompt(context: context)

        // Build messages
        var messages: [[String: String]] = [
            ["role": "system", "content": systemPrompt]
        ]

        // Add conversation history (last 10 messages)
        for msg in conversationHistory.suffix(10) {
            messages.append(["role": msg.role, "content": msg.content])
        }

        // Add user message
        messages.append(["role": "user", "content": userMessage])

        // Add to history
        let userMsg = ConversationMessage(
            role: "user",
            content: userMessage,
            timestamp: Date()
        )
        conversationHistory.append(userMsg)

        // Call LLM with streaming
        var fullResponse = ""

        do {
            let result = try await llmManager.chatStream(messages: messages) { chunk in
                fullResponse += chunk
                onChunk(chunk)
            }

            let tokens = result["tokens"] as? Int ?? 0

            // Parse response for file operations
            let (content, fileOps) = parseAIResponse(fullResponse)

            // Add assistant response to history
            let assistantMsg = ConversationMessage(
                role: "assistant",
                content: content,
                timestamp: Date()
            )
            conversationHistory.append(assistantMsg)

            // Execute file operations if any
            if !fileOps.isEmpty {
                await executeFileOperations(fileOps, projectId: projectId)
            }

            // Save conversation
            try await saveConversation(projectId: projectId)

            logger.info("[ProjectAI] Stream chat completed for project: \(project.name)", category: "AI")

            return AIResponse(
                content: content,
                hasFileOperations: !fileOps.isEmpty,
                fileOperations: fileOps,
                tokens: tokens
            )

        } catch {
            self.error = error.localizedDescription
            logger.error("[ProjectAI] Stream chat failed", error: error, category: "AI")
            throw error
        }
    }

    // MARK: - Task Planning

    /// AI 任务拆解
    func decomposeTask(
        projectId: String,
        userRequest: String
    ) async throws -> [TaskItem] {
        guard let project = projectManager.projects.first(where: { $0.id == projectId }) else {
            throw ProjectAIError.projectNotFound
        }

        let prompt = """
        请将以下用户需求拆解为具体的可执行任务：

        项目名称: \(project.name)
        项目类型: \(project.type.displayName)
        用户需求: \(userRequest)

        请以 JSON 格式返回任务列表，格式如下：
        ```json
        {
          "tasks": [
            {
              "title": "任务标题",
              "description": "任务描述",
              "priority": "high/medium/low",
              "estimatedMinutes": 30
            }
          ]
        }
        ```
        """

        let messages: [[String: String]] = [
            ["role": "user", "content": prompt]
        ]

        let result = try await llmManager.chat(messages: messages)
        let responseContent = result["content"] as? String ?? ""

        // Parse JSON from response
        return parseTaskList(responseContent)
    }

    struct TaskItem: Identifiable, Codable {
        let id = UUID().uuidString
        let title: String
        let description: String
        let priority: String
        let estimatedMinutes: Int

        enum CodingKeys: String, CodingKey {
            case title, description, priority, estimatedMinutes
        }
    }

    // MARK: - Code Operations

    /// 代码生成
    func generateCode(
        projectId: String,
        description: String,
        language: String
    ) async throws -> String {
        let prompt = """
        请根据以下描述生成 \(language) 代码：

        描述: \(description)

        要求：
        1. 代码需要符合最佳实践
        2. 添加必要的注释
        3. 处理常见的边界情况
        """

        let messages: [[String: String]] = [
            ["role": "user", "content": prompt]
        ]

        let result = try await llmManager.chat(messages: messages)
        return result["content"] as? String ?? ""
    }

    /// 代码审查
    func reviewCode(
        code: String,
        language: String
    ) async throws -> String {
        let prompt = """
        请对以下 \(language) 代码进行审查：

        ```\(language)
        \(code)
        ```

        请从以下几个方面进行审查：
        1. 代码质量和可读性
        2. 潜在的 bug 或错误
        3. 性能问题
        4. 安全隐患
        5. 改进建议
        """

        let messages: [[String: String]] = [
            ["role": "user", "content": prompt]
        ]

        let result = try await llmManager.chat(messages: messages)
        return result["content"] as? String ?? ""
    }

    // MARK: - Content Processing (内容处理)

    /// 内容润色
    /// Reference: desktop-app-vue/src/main/project/project-ai-ipc.js (polishContent)
    func polishContent(
        content: String,
        style: ContentStyle? = nil
    ) async throws -> ContentProcessingResult {
        guard !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw ProjectAIError.chatFailed("内容不能为空")
        }

        isProcessing = true
        defer { isProcessing = false }

        var prompt = """
        请对以下内容进行润色，使其更加专业、流畅：

        \(content)

        要求：
        1. 保持原意不变
        2. 改进表达方式
        3. 修正语法错误
        4. 使用恰当的专业术语
        """

        if let style = style {
            prompt += "\n5. 风格：\(style.description)"
        }

        let messages: [[String: String]] = [
            ["role": "user", "content": prompt]
        ]

        let result = try await llmManager.chat(messages: messages, options: [
            "temperature": 0.7,
            "maxTokens": 3000
        ])

        let polished = result["content"] as? String ?? content
        let tokens = result["tokens"] as? Int ?? 0

        logger.info("[ProjectAI] Content polished successfully", category: "AI")

        return ContentProcessingResult(
            success: true,
            originalContent: content,
            processedContent: polished,
            processingType: .polish,
            tokens: tokens
        )
    }

    /// 内容扩写
    /// Reference: desktop-app-vue/src/main/project/project-ai-ipc.js (expandContent)
    func expandContent(
        content: String,
        targetLength: Int? = nil
    ) async throws -> ContentProcessingResult {
        guard !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw ProjectAIError.chatFailed("内容不能为空")
        }

        isProcessing = true
        defer { isProcessing = false }

        var prompt = "请扩展以下内容，增加更多细节和例子"
        if let length = targetLength {
            prompt += "，目标字数约\(length)字"
        }
        prompt += """
        ：

        \(content)

        要求：
        1. 保持原有观点和结构
        2. 增加具体例子和数据支持
        3. 使内容更加详实完整
        """

        let messages: [[String: String]] = [
            ["role": "user", "content": prompt]
        ]

        let result = try await llmManager.chat(messages: messages, options: [
            "temperature": 0.7,
            "maxTokens": 4000
        ])

        let expanded = result["content"] as? String ?? content
        let tokens = result["tokens"] as? Int ?? 0

        logger.info("[ProjectAI] Content expanded successfully", category: "AI")

        return ContentProcessingResult(
            success: true,
            originalContent: content,
            processedContent: expanded,
            processingType: .expand,
            tokens: tokens
        )
    }

    /// 内容摘要
    func summarizeContent(
        content: String,
        maxLength: Int = 200
    ) async throws -> ContentProcessingResult {
        guard !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw ProjectAIError.chatFailed("内容不能为空")
        }

        isProcessing = true
        defer { isProcessing = false }

        let prompt = """
        请对以下内容进行摘要，控制在\(maxLength)字以内：

        \(content)

        要求：
        1. 保留核心信息
        2. 语言简洁明了
        3. 不要添加原文没有的信息
        """

        let messages: [[String: String]] = [
            ["role": "user", "content": prompt]
        ]

        let result = try await llmManager.chat(messages: messages, options: [
            "temperature": 0.5,
            "maxTokens": 500
        ])

        let summary = result["content"] as? String ?? content
        let tokens = result["tokens"] as? Int ?? 0

        logger.info("[ProjectAI] Content summarized successfully", category: "AI")

        return ContentProcessingResult(
            success: true,
            originalContent: content,
            processedContent: summary,
            processingType: .summarize,
            tokens: tokens
        )
    }

    /// 内容翻译
    func translateContent(
        content: String,
        targetLanguage: String
    ) async throws -> ContentProcessingResult {
        guard !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw ProjectAIError.chatFailed("内容不能为空")
        }

        isProcessing = true
        defer { isProcessing = false }

        let prompt = """
        请将以下内容翻译成\(targetLanguage)：

        \(content)

        要求：
        1. 翻译准确，符合目标语言习惯
        2. 保持原文的语气和风格
        3. 专业术语使用准确
        """

        let messages: [[String: String]] = [
            ["role": "user", "content": prompt]
        ]

        let result = try await llmManager.chat(messages: messages, options: [
            "temperature": 0.3,
            "maxTokens": 4000
        ])

        let translated = result["content"] as? String ?? content
        let tokens = result["tokens"] as? Int ?? 0

        logger.info("[ProjectAI] Content translated to \(targetLanguage)", category: "AI")

        return ContentProcessingResult(
            success: true,
            originalContent: content,
            processedContent: translated,
            processingType: .translate,
            tokens: tokens
        )
    }

    // MARK: - Intent Understanding (意图理解)

    /// 理解用户意图
    /// Reference: desktop-app-vue/src/main/project/project-ai-ipc.js (understandIntent)
    func understandIntent(
        userInput: String,
        projectId: String? = nil
    ) async throws -> IntentUnderstandingService.IntentResult {
        let intentService = IntentUnderstandingService.shared

        var projectContext: ProjectContextInfo?
        if let projectId = projectId,
           let project = projectManager.projects.first(where: { $0.id == projectId }) {
            projectContext = ProjectContextInfo(
                projectId: projectId,
                projectName: project.name,
                projectType: project.type.displayName,
                currentFile: nil
            )
        }

        return try await intentService.understandIntent(
            userInput: userInput,
            contextMode: projectId != nil ? .project : .global,
            projectContext: projectContext
        )
    }

    /// 快速纠错
    func quickCorrect(userInput: String) async throws -> String {
        let intentService = IntentUnderstandingService.shared
        return try await intentService.quickCorrect(userInput: userInput)
    }

    /// 提取关键词
    func extractKeywords(text: String, maxCount: Int = 5) async throws -> [String] {
        let intentService = IntentUnderstandingService.shared
        return try await intentService.extractKeywords(text: text, maxCount: maxCount)
    }

    // MARK: - Content Processing Types

    /// 内容风格
    enum ContentStyle: String, CaseIterable {
        case formal = "formal"           // 正式
        case casual = "casual"           // 随意
        case academic = "academic"       // 学术
        case business = "business"       // 商务
        case creative = "creative"       // 创意
        case technical = "technical"     // 技术

        var description: String {
            switch self {
            case .formal: return "正式、专业"
            case .casual: return "轻松、口语化"
            case .academic: return "学术、严谨"
            case .business: return "商务、简洁"
            case .creative: return "创意、生动"
            case .technical: return "技术、精确"
            }
        }
    }

    /// 内容处理结果
    struct ContentProcessingResult {
        let success: Bool
        let originalContent: String
        let processedContent: String
        let processingType: ProcessingType
        let tokens: Int

        enum ProcessingType: String {
            case polish = "polish"
            case expand = "expand"
            case summarize = "summarize"
            case translate = "translate"
        }

        /// 内容变化百分比
        var changePercentage: Double {
            let originalLength = originalContent.count
            let processedLength = processedContent.count
            guard originalLength > 0 else { return 0 }
            return Double(abs(processedLength - originalLength)) / Double(originalLength) * 100
        }
    }

    // MARK: - Conversation Management

    /// 开始新会话
    func startNewConversation(projectId: String) async throws {
        // Create new conversation
        let conversation = AIConversationEntity(
            title: "项目对话 - \(Date().formatted())",
            summary: nil
        )

        try aiConversationRepository.saveConversation(conversation)
        currentConversationId = conversation.id
        conversationHistory = []

        logger.info("[ProjectAI] Started new conversation for project: \(projectId)", category: "AI")
    }

    /// 清除当前会话
    func clearConversation() {
        conversationHistory = []
        currentConversationId = nil
    }

    /// 获取项目会话历史
    func getProjectConversations(projectId: String) -> [AIConversationEntity] {
        // Filter conversations by project context
        // For now, return all conversations
        return aiConversationRepository.getAllConversations()
    }

    // MARK: - Private Helpers

    private func buildSystemPrompt(context: ProjectContext) -> String {
        var prompt = """
        你是一个智能项目助手，正在协助用户处理项目: \(context.projectName)
        项目类型: \(context.projectType.displayName)
        上下文模式: \(context.contextMode.rawValue)
        """

        if let currentFile = context.currentFile {
            prompt += "\n当前文件: \(currentFile.path)"
        }

        if !context.fileList.isEmpty {
            let fileNames = context.fileList.prefix(10).map { $0.name }.joined(separator: ", ")
            prompt += "\n项目文件: \(fileNames)"
            if context.fileList.count > 10 {
                prompt += " 等共 \(context.fileList.count) 个文件"
            }
        }

        prompt += """

        请根据用户的问题提供有帮助的回答。
        如果需要创建或修改文件，请使用以下格式：

        [FILE_OPERATION]
        type: create|update|delete
        path: 文件路径
        content: 文件内容（如果是 create 或 update）
        [/FILE_OPERATION]
        """

        return prompt
    }

    private func parseAIResponse(_ response: String) -> (String, [AIResponse.FileOperation]) {
        var content = response
        var fileOps: [AIResponse.FileOperation] = []

        // Extract file operations
        let pattern = #"\[FILE_OPERATION\]([\s\S]*?)\[\/FILE_OPERATION\]"#
        if let regex = try? NSRegularExpression(pattern: pattern) {
            let matches = regex.matches(in: response, range: NSRange(response.startIndex..., in: response))

            for match in matches.reversed() {
                if let range = Range(match.range(at: 1), in: response) {
                    let opContent = String(response[range])

                    // Parse operation
                    var opType = ""
                    var opPath = ""
                    var opFileContent: String?

                    for line in opContent.components(separatedBy: "\n") {
                        let trimmed = line.trimmingCharacters(in: .whitespaces)
                        if trimmed.hasPrefix("type:") {
                            opType = String(trimmed.dropFirst(5)).trimmingCharacters(in: .whitespaces)
                        } else if trimmed.hasPrefix("path:") {
                            opPath = String(trimmed.dropFirst(5)).trimmingCharacters(in: .whitespaces)
                        } else if trimmed.hasPrefix("content:") {
                            opFileContent = String(trimmed.dropFirst(8)).trimmingCharacters(in: .whitespaces)
                        }
                    }

                    if !opType.isEmpty && !opPath.isEmpty {
                        fileOps.append(AIResponse.FileOperation(
                            type: opType,
                            path: opPath,
                            content: opFileContent
                        ))
                    }
                }

                // Remove operation block from content
                if let range = Range(match.range, in: content) {
                    content.removeSubrange(range)
                }
            }
        }

        return (content.trimmingCharacters(in: .whitespacesAndNewlines), fileOps)
    }

    private func executeFileOperations(_ operations: [AIResponse.FileOperation], projectId: String) async {
        for op in operations {
            do {
                switch op.type {
                case "create":
                    let fileName = (op.path as NSString).lastPathComponent
                    let fileType = (op.path as NSString).pathExtension
                    _ = try projectManager.createFile(
                        projectId: projectId,
                        name: fileName,
                        type: fileType.isEmpty ? "txt" : fileType,
                        content: op.content
                    )
                    logger.info("[ProjectAI] Created file: \(op.path)", category: "AI")

                case "update":
                    // Find existing file and update
                    let files = try? ProjectRepository.shared.getProjectFiles(projectId: projectId)
                    if let file = files?.first(where: { $0.path == op.path }), let content = op.content {
                        try projectManager.updateFileContent(file: file, content: content)
                        logger.info("[ProjectAI] Updated file: \(op.path)", category: "AI")
                    }

                case "delete":
                    let files = try? ProjectRepository.shared.getProjectFiles(projectId: projectId)
                    if let file = files?.first(where: { $0.path == op.path }) {
                        try projectManager.deleteFile(file)
                        logger.info("[ProjectAI] Deleted file: \(op.path)", category: "AI")
                    }

                default:
                    logger.warn("[ProjectAI] Unknown file operation: \(op.type)", category: "AI")
                }
            } catch {
                logger.error("[ProjectAI] File operation failed: \(op.type) \(op.path)", error: error, category: "AI")
            }
        }
    }

    private func parseTaskList(_ response: String) -> [TaskItem] {
        // Extract JSON from response
        guard let jsonMatch = response.range(of: #"\{[\s\S]*\}"#, options: .regularExpression),
              let data = String(response[jsonMatch]).data(using: .utf8) else {
            return []
        }

        struct TaskResponse: Codable {
            let tasks: [TaskItem]
        }

        do {
            let taskResponse = try JSONDecoder().decode(TaskResponse.self, from: data)
            return taskResponse.tasks
        } catch {
            logger.error("[ProjectAI] Failed to parse task list", error: error, category: "AI")
            return []
        }
    }

    private func saveConversation(projectId: String) async throws {
        guard let conversationId = currentConversationId else { return }

        // Save messages to database
        for (index, msg) in conversationHistory.enumerated() {
            let messageEntity = AIMessageEntity(
                conversationId: conversationId,
                role: msg.role,
                content: msg.content,
                orderIndex: index
            )
            try aiConversationRepository.saveMessage(messageEntity)
        }
    }
}

// MARK: - Errors

enum ProjectAIError: LocalizedError {
    case projectNotFound
    case llmNotInitialized
    case chatFailed(String)

    var errorDescription: String? {
        switch self {
        case .projectNotFound:
            return "项目不存在"
        case .llmNotInitialized:
            return "AI 服务未初始化"
        case .chatFailed(let message):
            return "AI 对话失败: \(message)"
        }
    }
}

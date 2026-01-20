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
        let id: String
        let title: String
        let description: String
        let priority: String
        let estimatedMinutes: Int
        var status: TaskStatus = .pending
        var result: String?
        var startedAt: Date?
        var completedAt: Date?

        init(title: String, description: String, priority: String, estimatedMinutes: Int) {
            self.id = UUID().uuidString
            self.title = title
            self.description = description
            self.priority = priority
            self.estimatedMinutes = estimatedMinutes
        }

        enum TaskStatus: String, Codable {
            case pending = "pending"
            case inProgress = "in_progress"
            case completed = "completed"
            case failed = "failed"
            case cancelled = "cancelled"
        }

        enum CodingKeys: String, CodingKey {
            case id, title, description, priority, estimatedMinutes, status, result, startedAt, completedAt
        }
    }

    // MARK: - Task Plan Management

    /// 任务计划
    struct TaskPlan: Identifiable, Codable {
        let id: String
        let projectId: String
        let originalRequest: String
        var tasks: [TaskItem]
        let createdAt: Date
        var updatedAt: Date
        var status: TaskPlanStatus

        enum TaskPlanStatus: String, Codable {
            case created = "created"
            case executing = "executing"
            case completed = "completed"
            case failed = "failed"
            case cancelled = "cancelled"
        }

        var completedCount: Int {
            tasks.filter { $0.status == .completed }.count
        }

        var progress: Double {
            guard !tasks.isEmpty else { return 0 }
            return Double(completedCount) / Double(tasks.count)
        }
    }

    /// 任务计划存储
    @Published var taskPlans: [String: TaskPlan] = [:]
    @Published var currentTaskPlanId: String?

    /// 执行任务计划
    /// Reference: desktop-app-vue/src/main/project/project-ai-ipc.js (execute-task-plan)
    func executeTaskPlan(
        taskPlanId: String,
        projectId: String,
        onProgress: @escaping (TaskPlan, Int) -> Void
    ) async throws -> TaskPlan {
        guard var taskPlan = taskPlans[taskPlanId] else {
            throw ProjectAIError.chatFailed("任务计划不存在")
        }

        guard let project = projectManager.projects.first(where: { $0.id == projectId }) else {
            throw ProjectAIError.projectNotFound
        }

        taskPlan.status = .executing
        taskPlan.updatedAt = Date()
        taskPlans[taskPlanId] = taskPlan

        logger.info("[ProjectAI] Starting task plan execution: \(taskPlanId)", category: "AI")

        for (index, task) in taskPlan.tasks.enumerated() {
            // Check if cancelled
            if taskPlans[taskPlanId]?.status == .cancelled {
                logger.info("[ProjectAI] Task plan cancelled: \(taskPlanId)", category: "AI")
                break
            }

            // Update task status
            taskPlan.tasks[index].status = .inProgress
            taskPlan.tasks[index].startedAt = Date()
            taskPlans[taskPlanId] = taskPlan
            onProgress(taskPlan, index)

            do {
                // Execute the task using AI
                let result = try await executeTask(task: task, project: project)

                taskPlan.tasks[index].status = .completed
                taskPlan.tasks[index].result = result
                taskPlan.tasks[index].completedAt = Date()
                taskPlan.updatedAt = Date()
                taskPlans[taskPlanId] = taskPlan
                onProgress(taskPlan, index)

                logger.info("[ProjectAI] Task completed: \(task.title)", category: "AI")

            } catch {
                taskPlan.tasks[index].status = .failed
                taskPlan.tasks[index].result = error.localizedDescription
                taskPlan.tasks[index].completedAt = Date()
                taskPlan.updatedAt = Date()
                taskPlans[taskPlanId] = taskPlan
                onProgress(taskPlan, index)

                logger.error("[ProjectAI] Task failed: \(task.title)", error: error, category: "AI")
            }
        }

        // Update final status
        let hasFailures = taskPlan.tasks.contains { $0.status == .failed }
        let allCompleted = taskPlan.tasks.allSatisfy { $0.status == .completed || $0.status == .cancelled }

        if allCompleted && !hasFailures {
            taskPlan.status = .completed
        } else if hasFailures {
            taskPlan.status = .failed
        }

        taskPlan.updatedAt = Date()
        taskPlans[taskPlanId] = taskPlan

        logger.info("[ProjectAI] Task plan execution finished: \(taskPlan.status.rawValue)", category: "AI")

        return taskPlan
    }

    /// 获取任务计划
    func getTaskPlan(taskPlanId: String) -> TaskPlan? {
        return taskPlans[taskPlanId]
    }

    /// 获取任务计划历史
    func getTaskPlanHistory(projectId: String, limit: Int = 10) -> [TaskPlan] {
        return taskPlans.values
            .filter { $0.projectId == projectId }
            .sorted { $0.createdAt > $1.createdAt }
            .prefix(limit)
            .map { $0 }
    }

    /// 取消任务计划
    func cancelTaskPlan(taskPlanId: String) {
        guard var taskPlan = taskPlans[taskPlanId] else { return }

        taskPlan.status = .cancelled
        taskPlan.updatedAt = Date()

        // Cancel pending tasks
        for (index, task) in taskPlan.tasks.enumerated() where task.status == .pending {
            taskPlan.tasks[index].status = .cancelled
        }

        taskPlans[taskPlanId] = taskPlan
        logger.info("[ProjectAI] Task plan cancelled: \(taskPlanId)", category: "AI")
    }

    /// 创建任务计划
    func createTaskPlan(projectId: String, userRequest: String) async throws -> TaskPlan {
        let tasks = try await decomposeTask(projectId: projectId, userRequest: userRequest)

        let taskPlan = TaskPlan(
            id: UUID().uuidString,
            projectId: projectId,
            originalRequest: userRequest,
            tasks: tasks,
            createdAt: Date(),
            updatedAt: Date(),
            status: .created
        )

        taskPlans[taskPlan.id] = taskPlan
        currentTaskPlanId = taskPlan.id

        logger.info("[ProjectAI] Task plan created: \(taskPlan.id) with \(tasks.count) tasks", category: "AI")

        return taskPlan
    }

    /// 执行单个任务
    private func executeTask(task: TaskItem, project: ProjectEntity) async throws -> String {
        let prompt = """
        请执行以下任务：

        项目名称: \(project.name)
        项目类型: \(project.type.displayName)
        任务标题: \(task.title)
        任务描述: \(task.description)
        优先级: \(task.priority)

        请完成任务并返回执行结果。如果需要生成代码或文件，请按照以下格式：
        [FILE_OPERATION]
        type: create|update|delete
        path: 文件路径
        content: 文件内容
        [/FILE_OPERATION]
        """

        let messages: [[String: String]] = [
            ["role": "user", "content": prompt]
        ]

        let result = try await llmManager.chat(messages: messages, options: [
            "temperature": 0.5,
            "maxTokens": 4000
        ])

        let responseContent = result["content"] as? String ?? ""

        // Parse and execute file operations
        let (content, fileOps) = parseAIResponse(responseContent)

        if !fileOps.isEmpty {
            await executeFileOperations(fileOps, projectId: project.id)
        }

        return content
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
        language: String,
        focusAreas: [CodeReviewFocus] = CodeReviewFocus.allCases
    ) async throws -> CodeReviewResult {
        isProcessing = true
        defer { isProcessing = false }

        let focusDescription = focusAreas.map { $0.description }.joined(separator: "、")

        let prompt = """
        请对以下 \(language) 代码进行审查：

        ```\(language)
        \(code)
        ```

        请重点从以下方面进行审查：\(focusDescription)

        请以 JSON 格式返回结果：
        ```json
        {
          "overallScore": 85,
          "issues": [
            {"severity": "high/medium/low", "line": 10, "description": "问题描述", "suggestion": "修改建议"}
          ],
          "strengths": ["代码优点1", "代码优点2"],
          "summary": "总体评价"
        }
        ```
        """

        let messages: [[String: String]] = [
            ["role": "user", "content": prompt]
        ]

        let result = try await llmManager.chat(messages: messages, options: [
            "temperature": 0.3,
            "maxTokens": 2000
        ])

        let responseContent = result["content"] as? String ?? ""
        let tokens = result["tokens"] as? Int ?? 0

        logger.info("[ProjectAI] Code review completed for \(language)", category: "AI")

        return parseCodeReviewResult(responseContent, rawResponse: responseContent, tokens: tokens)
    }

    /// 代码重构
    /// Reference: desktop-app-vue/src/main/project/project-ai-ipc.js (code-refactor)
    func refactorCode(
        code: String,
        language: String,
        refactorType: RefactorType = .general
    ) async throws -> CodeOperationResult {
        isProcessing = true
        defer { isProcessing = false }

        let prompt = """
        请对以下 \(language) 代码进行\(refactorType.description)重构：

        ```\(language)
        \(code)
        ```

        要求：
        1. 保持代码功能不变
        2. 提高代码\(refactorType.goal)
        3. 添加必要的注释说明修改原因
        4. 遵循 \(language) 最佳实践

        请先输出重构后的代码，然后解释主要修改点。
        """

        let messages: [[String: String]] = [
            ["role": "user", "content": prompt]
        ]

        let result = try await llmManager.chat(messages: messages, options: [
            "temperature": 0.5,
            "maxTokens": 4000
        ])

        let responseContent = result["content"] as? String ?? ""
        let tokens = result["tokens"] as? Int ?? 0

        logger.info("[ProjectAI] Code refactored (\(refactorType.rawValue)) for \(language)", category: "AI")

        return CodeOperationResult(
            success: true,
            operationType: .refactor,
            originalCode: code,
            resultCode: extractCodeBlock(from: responseContent, language: language),
            explanation: extractExplanation(from: responseContent),
            tokens: tokens
        )
    }

    /// 代码解释
    /// Reference: desktop-app-vue/src/main/project/project-ai-ipc.js (code-explain)
    func explainCode(
        code: String,
        language: String,
        detailLevel: ExplanationDetail = .medium
    ) async throws -> CodeOperationResult {
        isProcessing = true
        defer { isProcessing = false }

        let prompt = """
        请\(detailLevel.instruction)解释以下 \(language) 代码的功能和工作原理：

        ```\(language)
        \(code)
        ```

        请包含以下内容：
        1. 代码的整体功能概述
        2. 关键部分的详细解释
        3. 使用的设计模式或算法（如果有）
        4. 潜在的注意事项或限制
        """

        let messages: [[String: String]] = [
            ["role": "user", "content": prompt]
        ]

        let result = try await llmManager.chat(messages: messages, options: [
            "temperature": 0.3,
            "maxTokens": 3000
        ])

        let responseContent = result["content"] as? String ?? ""
        let tokens = result["tokens"] as? Int ?? 0

        logger.info("[ProjectAI] Code explained for \(language)", category: "AI")

        return CodeOperationResult(
            success: true,
            operationType: .explain,
            originalCode: code,
            resultCode: nil,
            explanation: responseContent,
            tokens: tokens
        )
    }

    /// 修复 Bug
    /// Reference: desktop-app-vue/src/main/project/project-ai-ipc.js (code-fix-bug)
    func fixBug(
        code: String,
        language: String,
        bugDescription: String
    ) async throws -> CodeOperationResult {
        isProcessing = true
        defer { isProcessing = false }

        let prompt = """
        请修复以下 \(language) 代码中的 bug：

        ```\(language)
        \(code)
        ```

        问题描述：\(bugDescription)

        要求：
        1. 找出并修复 bug
        2. 保持代码其他部分不变
        3. 添加注释说明修复内容
        4. 如果需要，添加防御性代码防止类似问题

        请先输出修复后的代码，然后解释 bug 原因和修复方案。
        """

        let messages: [[String: String]] = [
            ["role": "user", "content": prompt]
        ]

        let result = try await llmManager.chat(messages: messages, options: [
            "temperature": 0.3,
            "maxTokens": 4000
        ])

        let responseContent = result["content"] as? String ?? ""
        let tokens = result["tokens"] as? Int ?? 0

        logger.info("[ProjectAI] Bug fixed for \(language)", category: "AI")

        return CodeOperationResult(
            success: true,
            operationType: .fixBug,
            originalCode: code,
            resultCode: extractCodeBlock(from: responseContent, language: language),
            explanation: extractExplanation(from: responseContent),
            tokens: tokens
        )
    }

    /// 生成测试代码
    /// Reference: desktop-app-vue/src/main/project/project-ai-ipc.js (code-generate-tests)
    func generateTests(
        code: String,
        language: String,
        testFramework: String? = nil
    ) async throws -> CodeOperationResult {
        isProcessing = true
        defer { isProcessing = false }

        let framework = testFramework ?? defaultTestFramework(for: language)

        let prompt = """
        请为以下 \(language) 代码生成单元测试：

        ```\(language)
        \(code)
        ```

        要求：
        1. 使用 \(framework) 测试框架
        2. 覆盖主要功能和边界情况
        3. 包含正常情况和异常情况测试
        4. 测试命名清晰，描述测试意图
        5. 添加必要的 mock 或 stub

        请生成完整的测试代码。
        """

        let messages: [[String: String]] = [
            ["role": "user", "content": prompt]
        ]

        let result = try await llmManager.chat(messages: messages, options: [
            "temperature": 0.5,
            "maxTokens": 4000
        ])

        let responseContent = result["content"] as? String ?? ""
        let tokens = result["tokens"] as? Int ?? 0

        logger.info("[ProjectAI] Tests generated for \(language) using \(framework)", category: "AI")

        return CodeOperationResult(
            success: true,
            operationType: .generateTests,
            originalCode: code,
            resultCode: extractCodeBlock(from: responseContent, language: language),
            explanation: extractExplanation(from: responseContent),
            tokens: tokens
        )
    }

    /// 代码优化
    /// Reference: desktop-app-vue/src/main/project/project-ai-ipc.js (code-optimize)
    func optimizeCode(
        code: String,
        language: String,
        optimizationType: OptimizationType = .performance
    ) async throws -> CodeOperationResult {
        isProcessing = true
        defer { isProcessing = false }

        let prompt = """
        请对以下 \(language) 代码进行\(optimizationType.description)优化：

        ```\(language)
        \(code)
        ```

        优化目标：\(optimizationType.goal)

        要求：
        1. 保持代码功能完全一致
        2. 显著提升\(optimizationType.metric)
        3. 不引入新的 bug 或安全问题
        4. 添加注释说明优化点

        请先输出优化后的代码，然后解释优化内容和预期效果。
        """

        let messages: [[String: String]] = [
            ["role": "user", "content": prompt]
        ]

        let result = try await llmManager.chat(messages: messages, options: [
            "temperature": 0.5,
            "maxTokens": 4000
        ])

        let responseContent = result["content"] as? String ?? ""
        let tokens = result["tokens"] as? Int ?? 0

        logger.info("[ProjectAI] Code optimized (\(optimizationType.rawValue)) for \(language)", category: "AI")

        return CodeOperationResult(
            success: true,
            operationType: .optimize,
            originalCode: code,
            resultCode: extractCodeBlock(from: responseContent, language: language),
            explanation: extractExplanation(from: responseContent),
            tokens: tokens
        )
    }

    // MARK: - Code Operation Types

    /// 代码审查重点
    enum CodeReviewFocus: String, CaseIterable {
        case quality = "quality"           // 代码质量
        case performance = "performance"   // 性能
        case security = "security"         // 安全
        case readability = "readability"   // 可读性
        case bestPractices = "bestPractices" // 最佳实践

        var description: String {
            switch self {
            case .quality: return "代码质量"
            case .performance: return "性能问题"
            case .security: return "安全隐患"
            case .readability: return "代码可读性"
            case .bestPractices: return "最佳实践"
            }
        }
    }

    /// 代码审查结果
    struct CodeReviewResult {
        let overallScore: Int
        let issues: [CodeIssue]
        let strengths: [String]
        let summary: String
        let rawResponse: String
        let tokens: Int

        struct CodeIssue: Codable {
            let severity: String
            let line: Int?
            let description: String
            let suggestion: String
        }
    }

    /// 重构类型
    enum RefactorType: String, CaseIterable {
        case general = "general"           // 通用重构
        case performance = "performance"   // 性能优化重构
        case security = "security"         // 安全加固重构
        case readability = "readability"   // 可读性重构
        case modularity = "modularity"     // 模块化重构

        var description: String {
            switch self {
            case .general: return "通用"
            case .performance: return "性能优化"
            case .security: return "安全加固"
            case .readability: return "可读性"
            case .modularity: return "模块化"
            }
        }

        var goal: String {
            switch self {
            case .general: return "整体质量"
            case .performance: return "执行效率"
            case .security: return "安全性"
            case .readability: return "可读性和可维护性"
            case .modularity: return "模块化程度"
            }
        }
    }

    /// 解释详细程度
    enum ExplanationDetail: String {
        case brief = "brief"     // 简要
        case medium = "medium"   // 中等
        case detailed = "detailed" // 详细

        var instruction: String {
            switch self {
            case .brief: return "简要"
            case .medium: return "详细"
            case .detailed: return "非常详细地"
            }
        }
    }

    /// 优化类型
    enum OptimizationType: String, CaseIterable {
        case performance = "performance"   // 性能优化
        case memory = "memory"             // 内存优化
        case readability = "readability"   // 可读性优化
        case size = "size"                 // 代码体积优化

        var description: String {
            switch self {
            case .performance: return "性能"
            case .memory: return "内存"
            case .readability: return "可读性"
            case .size: return "代码体积"
            }
        }

        var goal: String {
            switch self {
            case .performance: return "提高执行速度，减少 CPU 使用"
            case .memory: return "减少内存占用，优化内存分配"
            case .readability: return "提高代码可读性和可维护性"
            case .size: return "减少代码行数，简化逻辑"
            }
        }

        var metric: String {
            switch self {
            case .performance: return "执行效率"
            case .memory: return "内存效率"
            case .readability: return "代码清晰度"
            case .size: return "代码简洁度"
            }
        }
    }

    /// 代码操作结果
    struct CodeOperationResult {
        let success: Bool
        let operationType: OperationType
        let originalCode: String
        let resultCode: String?
        let explanation: String
        let tokens: Int

        enum OperationType: String {
            case refactor = "refactor"
            case explain = "explain"
            case fixBug = "fix_bug"
            case generateTests = "generate_tests"
            case optimize = "optimize"
        }
    }

    // MARK: - Code Operation Helpers

    private func extractCodeBlock(from response: String, language: String) -> String? {
        // Try to extract code block with language tag
        let patterns = [
            "```\(language)\\s*([\\s\\S]*?)```",
            "```\\s*([\\s\\S]*?)```"
        ]

        for pattern in patterns {
            if let regex = try? NSRegularExpression(pattern: pattern),
               let match = regex.firstMatch(in: response, range: NSRange(response.startIndex..., in: response)),
               let range = Range(match.range(at: 1), in: response) {
                return String(response[range]).trimmingCharacters(in: .whitespacesAndNewlines)
            }
        }

        return nil
    }

    private func extractExplanation(from response: String) -> String {
        // Remove code blocks and return the explanation text
        var text = response

        // Remove code blocks
        let pattern = "```[\\s\\S]*?```"
        if let regex = try? NSRegularExpression(pattern: pattern) {
            text = regex.stringByReplacingMatches(
                in: text,
                range: NSRange(text.startIndex..., in: text),
                withTemplate: ""
            )
        }

        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func defaultTestFramework(for language: String) -> String {
        switch language.lowercased() {
        case "swift": return "XCTest"
        case "kotlin": return "JUnit 5"
        case "java": return "JUnit 5"
        case "javascript", "typescript": return "Jest"
        case "python": return "pytest"
        case "go": return "testing"
        case "rust": return "内置测试框架"
        default: return "适合该语言的主流测试框架"
        }
    }

    private func parseCodeReviewResult(_ response: String, rawResponse: String, tokens: Int) -> CodeReviewResult {
        // Try to extract JSON from response
        if let jsonMatch = response.range(of: #"\{[\s\S]*\}"#, options: .regularExpression),
           let data = String(response[jsonMatch]).data(using: .utf8) {
            struct RawReviewResult: Codable {
                var overallScore: Int?
                var issues: [CodeReviewResult.CodeIssue]?
                var strengths: [String]?
                var summary: String?
            }

            if let raw = try? JSONDecoder().decode(RawReviewResult.self, from: data) {
                return CodeReviewResult(
                    overallScore: raw.overallScore ?? 70,
                    issues: raw.issues ?? [],
                    strengths: raw.strengths ?? [],
                    summary: raw.summary ?? "代码审查完成",
                    rawResponse: rawResponse,
                    tokens: tokens
                )
            }
        }

        // Fallback to text response
        return CodeReviewResult(
            overallScore: 70,
            issues: [],
            strengths: [],
            summary: response,
            rawResponse: rawResponse,
            tokens: tokens
        )
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

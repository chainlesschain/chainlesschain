import Foundation
import Combine

/// Agent角色类型
public enum AgentRole: String {
    case coordinator = "coordinator"       // 协调者
    case executor = "executor"             // 执行者
    case analyzer = "analyzer"             // 分析者
    case validator = "validator"           // 验证者
    case researcher = "researcher"         // 研究者
    case coder = "coder"                   // 编码者
    case documentWriter = "documentWriter" // 文档编写者
}

/// Agent状态
public enum AgentState {
    case idle
    case thinking
    case executing
    case waiting
    case completed
    case failed(Error)
}

/// Agent任务
public struct AgentTask: Identifiable {
    public let id: String
    public let description: String
    public let parameters: [String: Any]
    public let priority: Int
    public let requiredCapabilities: [String]
    public var dependencies: [String] // 依赖的任务ID

    public init(
        id: String = UUID().uuidString,
        description: String,
        parameters: [String: Any] = [:],
        priority: Int = 0,
        requiredCapabilities: [String] = [],
        dependencies: [String] = []
    ) {
        self.id = id
        self.description = description
        self.parameters = parameters
        self.priority = priority
        self.requiredCapabilities = requiredCapabilities
        self.dependencies = dependencies
    }
}

/// Agent任务结果
public struct AgentTaskResult {
    public let taskId: String
    public let success: Bool
    public let result: Any?
    public let error: Error?
    public let executionTime: TimeInterval
    public let metadata: [String: Any]

    public init(
        taskId: String,
        success: Bool,
        result: Any? = nil,
        error: Error? = nil,
        executionTime: TimeInterval = 0,
        metadata: [String: Any] = [:]
    ) {
        self.taskId = taskId
        self.success = success
        self.result = result
        self.error = error
        self.executionTime = executionTime
        self.metadata = metadata
    }
}

/// Agent协议
public protocol Agent: AnyObject {
    /// Agent唯一标识
    var id: String { get }

    /// Agent名称
    var name: String { get }

    /// Agent角色
    var role: AgentRole { get }

    /// Agent当前状态
    var state: AgentState { get }

    /// Agent能力列表
    var capabilities: [String] { get }

    /// Agent可访问的引擎类型
    var accessibleEngines: [AIEngineType] { get }

    /// 初始化Agent
    func initialize() async throws

    /// 执行任务
    func execute(task: AgentTask) async throws -> AgentTaskResult

    /// 思考和规划
    func think(about: String) async throws -> String

    /// 与其他Agent通信
    func communicate(with agent: Agent, message: String) async throws -> String
}

/// 基础Agent实现
open class BaseAgent: Agent, ObservableObject {
    public let id: String
    public let name: String
    public let role: AgentRole

    @Published public private(set) var state: AgentState = .idle

    public var capabilities: [String] = []
    public var accessibleEngines: [AIEngineType] = []

    // 依赖的管理器
    protected let engineManager = AIEngineManager.shared
    protected let skillManager = SkillManager.shared
    protected let toolManager = ToolManager.shared
    protected let llmManager = LLMManager.shared

    // Agent记忆（上下文）
    private var memory: [String] = []
    private let maxMemorySize = 10

    public init(id: String = UUID().uuidString, name: String, role: AgentRole) {
        self.id = id
        self.name = name
        self.role = role
    }

    // MARK: - 初始化

    open func initialize() async throws {
        Logger.shared.info("Agent \(name) 初始化中...")
        state = .idle
        Logger.shared.info("Agent \(name) 初始化完成")
    }

    // MARK: - 任务执行

    open func execute(task: AgentTask) async throws -> AgentTaskResult {
        let startTime = Date()
        state = .executing

        Logger.shared.info("Agent \(name) 开始执行任务: \(task.description)")

        do {
            // 1. 分析任务
            let analysis = try await analyzeTask(task)

            // 2. 制定执行计划
            let plan = try await createExecutionPlan(task, analysis: analysis)

            // 3. 执行计划
            let result = try await executePlan(plan, task: task)

            // 4. 验证结果
            let validated = try await validateResult(result, task: task)

            let executionTime = Date().timeIntervalSince(startTime)
            state = .completed

            // 更新记忆
            addToMemory("完成任务: \(task.description)")

            return AgentTaskResult(
                taskId: task.id,
                success: true,
                result: validated,
                executionTime: executionTime,
                metadata: ["plan": plan, "analysis": analysis]
            )

        } catch {
            state = .failed(error)
            Logger.shared.error("Agent \(name) 任务执行失败: \(error)")

            return AgentTaskResult(
                taskId: task.id,
                success: false,
                error: error,
                executionTime: Date().timeIntervalSince(startTime)
            )
        }
    }

    // MARK: - 思考和规划

    open func think(about topic: String) async throws -> String {
        state = .thinking

        let context = memory.joined(separator: "\n")

        let prompt = """
        作为\(name)（角色：\(role.rawValue)），请思考以下问题：

        \(topic)

        之前的上下文：
        \(context)

        请提供你的分析和建议。
        """

        let thought = try await llmManager.generateText(
            prompt: prompt,
            systemPrompt: "你是一个AI Agent，名为\(name)，负责\(role.rawValue)相关的工作。"
        )

        addToMemory("思考: \(topic) -> \(thought.prefix(100))...")
        state = .idle

        return thought
    }

    // MARK: - Agent通信

    open func communicate(with agent: Agent, message: String) async throws -> String {
        Logger.shared.info("Agent \(name) 向 \(agent.name) 发送消息: \(message)")

        let prompt = """
        Agent \(name)（\(role.rawValue)）向你发送消息：
        \(message)

        请作为Agent \(agent.name)（\(agent.role.rawValue)）回复。
        """

        return try await agent.think(about: prompt)
    }

    // MARK: - 内部方法

    /// 分析任务
    private func analyzeTask(_ task: AgentTask) async throws -> [String: Any] {
        let analysis = try await think(about: "分析任务需求和执行策略：\(task.description)")

        return [
            "description": task.description,
            "analysis": analysis,
            "requiredCapabilities": task.requiredCapabilities,
            "priority": task.priority
        ]
    }

    /// 创建执行计划
    private func createExecutionPlan(_ task: AgentTask, analysis: [String: Any]) async throws -> [String: Any] {
        let planningPrompt = """
        请为以下任务创建详细的执行计划：

        任务：\(task.description)
        分析结果：\(analysis["analysis"] ?? "")

        请提供：
        1. 执行步骤（按顺序）
        2. 需要使用的引擎/工具
        3. 预期结果
        4. 风险和注意事项
        """

        let plan = try await think(about: planningPrompt)

        return [
            "taskId": task.id,
            "plan": plan,
            "steps": extractSteps(from: plan),
            "requiredEngines": identifyRequiredEngines(task: task)
        ]
    }

    /// 执行计划
    private func executePlan(_ plan: [String: Any], task: AgentTask) async throws -> Any {
        let steps = plan["steps"] as? [String] ?? []
        let requiredEngines = plan["requiredEngines"] as? [AIEngineType] ?? []

        var results: [Any] = []

        // 执行每个步骤
        for (index, step) in steps.enumerated() {
            Logger.shared.info("Agent \(name) 执行步骤 \(index + 1): \(step)")

            // 根据步骤选择合适的引擎
            if let engine = selectEngine(for: step, from: requiredEngines) {
                let result = try await engineManager.execute(
                    engineType: engine,
                    task: step,
                    parameters: task.parameters
                )
                results.append(result)
            }
        }

        return results
    }

    /// 验证结果
    private func validateResult(_ result: Any, task: AgentTask) async throws -> Any {
        // 简单验证逻辑
        Logger.shared.info("Agent \(name) 验证任务结果")
        return result
    }

    /// 从计划中提取步骤
    private func extractSteps(from plan: String) -> [String] {
        // 简化实现：按行分割
        return plan.components(separatedBy: .newlines)
            .filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
            .filter { $0.contains("步骤") || $0.contains("Step") || $0.contains("1.") }
    }

    /// 识别所需引擎
    private func identifyRequiredEngines(task: AgentTask) -> [AIEngineType] {
        var engines: [AIEngineType] = []

        let description = task.description.lowercased()

        if description.contains("pdf") || description.contains("文档") {
            engines.append(.document)
        }
        if description.contains("数据") || description.contains("统计") {
            engines.append(.data)
        }
        if description.contains("代码") || description.contains("code") {
            engines.append(.code)
        }
        if description.contains("图片") || description.contains("image") {
            engines.append(.image)
        }
        if description.contains("网页") || description.contains("web") {
            engines.append(.web)
        }

        return engines.isEmpty ? [.knowledge] : engines
    }

    /// 选择引擎
    private func selectEngine(for step: String, from engines: [AIEngineType]) -> AIEngineType? {
        // 根据步骤描述选择最合适的引擎
        for engine in engines {
            if step.lowercased().contains(engine.rawValue) {
                return engine
            }
        }
        return engines.first
    }

    /// 添加到记忆
    private func addToMemory(_ item: String) {
        memory.append(item)
        if memory.count > maxMemorySize {
            memory.removeFirst()
        }
    }
}

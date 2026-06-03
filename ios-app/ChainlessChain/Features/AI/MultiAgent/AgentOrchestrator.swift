import Foundation
import Combine

/// Agent编排器
///
/// 负责协调多个Agent协同工作，分配任务，管理依赖关系
public class AgentOrchestrator: ObservableObject {
    public static let shared = AgentOrchestrator()

    @Published public private(set) var agents: [String: Agent] = [:]
    @Published public private(set) var activeTasks: [String: AgentTask] = [:]
    @Published public private(set) var taskResults: [String: AgentTaskResult] = [:]

    private let taskQueue = DispatchQueue(label: "com.chainlesschain.agent.orchestrator", attributes: .concurrent)
    private var taskDependencyGraph: [String: Set<String>] = [:] // taskId -> dependencies

    private init() {
        registerBuiltinAgents()
    }

    // MARK: - Agent注册

    /// 注册内置Agent
    private func registerBuiltinAgents() {
        // 协调者Agent
        let coordinator = CoordinatorAgent()
        register(agent: coordinator)

        // 代码Agent
        let coder = CoderAgent()
        register(agent: coder)

        // 数据分析Agent
        let analyzer = DataAnalyzerAgent()
        register(agent: analyzer)

        // 文档编写Agent
        let documentWriter = DocumentWriterAgent()
        register(agent: documentWriter)

        Logger.shared.info("已注册 \(agents.count) 个内置Agent")
    }

    /// 注册Agent
    public func register(agent: Agent) {
        agents[agent.id] = agent
        Logger.shared.info("注册Agent: \(agent.name) (\(agent.role.rawValue))")
    }

    /// 注销Agent
    public func unregister(agentId: String) {
        agents.removeValue(forKey: agentId)
        Logger.shared.info("注销Agent: \(agentId)")
    }

    // MARK: - 任务编排

    /// 执行复杂任务（自动分解和分配）
    public func executeComplexTask(
        description: String,
        parameters: [String: Any] = [:]
    ) async throws -> [String: Any] {
        Logger.shared.info("开始执行复杂任务: \(description)")

        // 1. 使用协调者Agent分解任务
        guard let coordinator = findAgent(byRole: .coordinator) else {
            throw OrchestratorError.noCoordinatorAvailable
        }

        let decompositionResult = try await coordinator.think(about: """
        请将以下复杂任务分解为可执行的子任务：

        任务：\(description)
        参数：\(parameters)

        请以JSON格式返回子任务列表，每个子任务包含：
        - id: 任务ID
        - description: 任务描述
        - role: 适合执行的Agent角色（coordinator/executor/analyzer/coder/documentWriter）
        - dependencies: 依赖的任务ID列表
        - parameters: 任务参数

        示例格式：
        [
          {
            "id": "task1",
            "description": "分析数据",
            "role": "analyzer",
            "dependencies": [],
            "parameters": {}
          }
        ]
        """)

        // 2. 解析子任务
        let subtasks = try parseSubtasks(from: decompositionResult)

        // 3. 构建依赖图
        buildDependencyGraph(tasks: subtasks)

        // 4. 按依赖顺序执行任务
        let results = try await executeTasksInOrder(subtasks)

        // 5. 汇总结果
        return [
            "originalTask": description,
            "subtasks": subtasks.map { ["id": $0.id, "description": $0.description] },
            "results": results,
            "totalTasks": subtasks.count,
            "successfulTasks": results.filter { $0.value.success }.count
        ]
    }

    /// 执行单个任务
    public func executeTask(_ task: AgentTask, withAgent agentId: String) async throws -> AgentTaskResult {
        guard let agent = agents[agentId] else {
            throw OrchestratorError.agentNotFound(agentId)
        }

        activeTasks[task.id] = task
        let result = try await agent.execute(task: task)
        taskResults[task.id] = result
        activeTasks.removeValue(forKey: task.id)

        return result
    }

    /// 并行执行多个独立任务
    public func executeTasksInParallel(_ tasks: [AgentTask]) async throws -> [String: AgentTaskResult] {
        var results: [String: AgentTaskResult] = [:]

        try await withThrowingTaskGroup(of: (String, AgentTaskResult).self) { group in
            for task in tasks {
                // 找到合适的Agent
                guard let agent = findSuitableAgent(for: task) else {
                    throw OrchestratorError.noSuitableAgent(task: task.description)
                }

                group.addTask {
                    let result = try await agent.execute(task: task)
                    return (task.id, result)
                }
            }

            for try await (taskId, result) in group {
                results[taskId] = result
            }
        }

        return results
    }

    // MARK: - Agent选择

    /// 查找指定角色的Agent
    public func findAgent(byRole role: AgentRole) -> Agent? {
        return agents.values.first { $0.role == role }
    }

    /// 查找所有指定角色的Agent
    public func findAgents(byRole role: AgentRole) -> [Agent] {
        return agents.values.filter { $0.role == role }
    }

    /// 为任务找到合适的Agent
    private func findSuitableAgent(for task: AgentTask) -> Agent? {
        // 1. 根据任务描述推断所需角色
        let requiredRole = inferRequiredRole(from: task.description)

        // 2. 查找该角色的Agent
        if let agent = findAgent(byRole: requiredRole) {
            return agent
        }

        // 3. 如果没有找到，返回协调者
        return findAgent(byRole: .coordinator)
    }

    /// 推断所需的Agent角色
    private func inferRequiredRole(from description: String) -> AgentRole {
        let lower = description.lowercased()

        if lower.contains("代码") || lower.contains("code") || lower.contains("编程") {
            return .coder
        }
        if lower.contains("数据") || lower.contains("分析") || lower.contains("统计") {
            return .analyzer
        }
        if lower.contains("文档") || lower.contains("报告") || lower.contains("写作") {
            return .documentWriter
        }
        if lower.contains("研究") || lower.contains("调查") || lower.contains("搜索") {
            return .researcher
        }
        if lower.contains("验证") || lower.contains("检查") || lower.contains("审查") {
            return .validator
        }

        return .executor
    }

    // MARK: - 任务依赖管理

    /// 构建依赖图
    private func buildDependencyGraph(tasks: [AgentTask]) {
        taskDependencyGraph.removeAll()

        for task in tasks {
            taskDependencyGraph[task.id] = Set(task.dependencies)
        }
    }

    /// 按依赖顺序执行任务
    private func executeTasksInOrder(_ tasks: [AgentTask]) async throws -> [String: AgentTaskResult] {
        var results: [String: AgentTaskResult] = [:]
        var completedTasks: Set<String> = []
        var remainingTasks = tasks

        while !remainingTasks.isEmpty {
            // 找到所有依赖已完成的任务
            let readyTasks = remainingTasks.filter { task in
                let dependencies = taskDependencyGraph[task.id] ?? []
                return dependencies.isSubset(of: completedTasks)
            }

            if readyTasks.isEmpty {
                throw OrchestratorError.circularDependency
            }

            // 并行执行就绪的任务
            let batchResults = try await executeTasksInParallel(readyTasks)
            results.merge(batchResults) { _, new in new }

            // 更新完成状态
            for task in readyTasks {
                completedTasks.insert(task.id)
            }

            // 移除已完成的任务
            remainingTasks.removeAll { task in readyTasks.contains { $0.id == task.id } }
        }

        return results
    }

    // MARK: - 辅助方法

    /// 解析子任务（从LLM返回的JSON）
    private func parseSubtasks(from json: String) throws -> [AgentTask] {
        // 清理可能的markdown代码块标记
        let cleanedJSON = json
            .replacingOccurrences(of: "```json", with: "")
            .replacingOccurrences(of: "```", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)

        guard let data = cleanedJSON.data(using: .utf8),
              let jsonArray = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
            throw OrchestratorError.invalidTaskFormat
        }

        return jsonArray.compactMap { dict -> AgentTask? in
            guard let id = dict["id"] as? String,
                  let description = dict["description"] as? String else {
                return nil
            }

            let parameters = dict["parameters"] as? [String: Any] ?? [:]
            let dependencies = dict["dependencies"] as? [String] ?? []
            let priority = dict["priority"] as? Int ?? 0

            return AgentTask(
                id: id,
                description: description,
                parameters: parameters,
                priority: priority,
                dependencies: dependencies
            )
        }
    }

    // MARK: - 统计信息

    /// 获取编排器统计信息
    public func getStatistics() -> [String: Any] {
        return [
            "totalAgents": agents.count,
            "activeAgents": agents.values.filter { $0.state != .idle }.count,
            "activeTasks": activeTasks.count,
            "completedTasks": taskResults.count,
            "agentsByRole": getAgentCountsByRole()
        ]
    }

    /// 获取各角色Agent数量
    private func getAgentCountsByRole() -> [String: Int] {
        var counts: [String: Int] = [:]
        for agent in agents.values {
            counts[agent.role.rawValue, default: 0] += 1
        }
        return counts
    }
}

// MARK: - 内置Agent实现

/// 协调者Agent
class CoordinatorAgent: BaseAgent {
    init() {
        super.init(name: "协调者", role: .coordinator)
        self.capabilities = ["任务分解", "任务分配", "进度监控", "结果汇总"]
        self.accessibleEngines = AIEngineType.allCases
    }
}

/// 代码Agent
class CoderAgent: BaseAgent {
    init() {
        super.init(name: "编码者", role: .coder)
        self.capabilities = ["代码生成", "代码审查", "代码重构", "Bug修复"]
        self.accessibleEngines = [.code, .git, .knowledge]
    }
}

/// 数据分析Agent
class DataAnalyzerAgent: BaseAgent {
    init() {
        super.init(name: "数据分析师", role: .analyzer)
        self.capabilities = ["数据分析", "统计计算", "趋势预测", "可视化"]
        self.accessibleEngines = [.data, .knowledge]
    }
}

/// 文档编写Agent
class DocumentWriterAgent: BaseAgent {
    init() {
        super.init(name: "文档编写者", role: .documentWriter)
        self.capabilities = ["文档生成", "报告撰写", "内容总结", "格式化"]
        self.accessibleEngines = [.document, .knowledge]
    }
}

// MARK: - 错误定义

public enum OrchestratorError: LocalizedError {
    case noCoordinatorAvailable
    case agentNotFound(String)
    case noSuitableAgent(task: String)
    case invalidTaskFormat
    case circularDependency

    public var errorDescription: String? {
        switch self {
        case .noCoordinatorAvailable:
            return "没有可用的协调者Agent"
        case .agentNotFound(let id):
            return "Agent未找到: \(id)"
        case .noSuitableAgent(let task):
            return "没有合适的Agent执行任务: \(task)"
        case .invalidTaskFormat:
            return "无效的任务格式"
        case .circularDependency:
            return "检测到任务循环依赖"
        }
    }
}

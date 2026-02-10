import Foundation
import Combine

/// 工具管理器
///
/// 负责管理所有工具的注册、查找、执行
/// 参考：PC端 desktop-app-vue/src/main/skill-tool-system/
public class ToolManager: ObservableObject {
    public static let shared = ToolManager()

    @Published public private(set) var tools: [Tool] = []
    @Published public private(set) var isLoading: Bool = false

    private var toolsById: [String: Tool] = [:]
    private var toolsByCategory: [SkillCategory: [Tool]] = [:]
    private var toolExecutors: [String: ToolExecutor] = [:]

    // 速率限制跟踪
    private var rateLimitCounters: [String: (count: Int, resetTime: Date)] = [:]
    private let rateLimitQueue = DispatchQueue(label: "com.chainlesschain.tool-rate-limit")
    private var toolUsageStats: [String: Int] = [:]
    private var toolFailureStats: [String: Int] = [:]
    private let statsQueue = DispatchQueue(label: "com.chainlesschain.tool-stats")

    private init() {
        loadBuiltinTools()
    }

    // MARK: - 工具注册

    /// 注册工具
    public func register(_ tool: Tool, executor: @escaping ToolExecutor) {
        // 检查是否已存在
        if toolsById[tool.id] != nil {
            Logger.shared.warning("工具 '\(tool.name)' 已存在，将覆盖")
        }

        // 注册工具定义
        toolsById[tool.id] = tool

        // 注册执行器
        toolExecutors[tool.id] = executor

        // 按分类组织
        if toolsByCategory[tool.category] == nil {
            toolsByCategory[tool.category] = []
        }
        toolsByCategory[tool.category]?.append(tool)

        // 更新数组
        updateToolsList()

        Logger.shared.info("工具已注册: \(tool.name) (\(tool.id))")
    }

    /// 批量注册工具
    public func registerAll(_ tools: [(tool: Tool, executor: ToolExecutor)]) {
        for (tool, executor) in tools {
            register(tool, executor: executor)
        }
    }

    /// 注销工具
    public func unregister(toolId: String) {
        guard let tool = toolsById[toolId] else {
            return
        }

        toolsById.removeValue(forKey: toolId)
        toolExecutors.removeValue(forKey: toolId)
        toolsByCategory[tool.category]?.removeAll { $0.id == toolId }
        statsQueue.sync {
            toolUsageStats.removeValue(forKey: toolId)
            toolFailureStats.removeValue(forKey: toolId)
        }

        updateToolsList()

        Logger.shared.info("工具已注销: \(tool.name)")
    }

    // MARK: - 工具查找

    /// 根据ID获取工具
    public func getTool(id: String) -> Tool? {
        return toolsById[id]
    }

    /// 根据分类获取工具
    public func getTools(category: SkillCategory) -> [Tool] {
        return toolsByCategory[category] ?? []
    }

    /// 搜索工具
    public func search(query: String) -> [Tool] {
        guard !query.isEmpty else {
            return tools
        }

        let lowercaseQuery = query.lowercased()

        return tools.filter { tool in
            tool.name.lowercased().contains(lowercaseQuery) ||
            tool.description.lowercased().contains(lowercaseQuery) ||
            tool.tags.contains(where: { $0.lowercased().contains(lowercaseQuery) })
        }
    }

    /// 根据标签获取工具
    public func getTools(withTag tag: String) -> [Tool] {
        return tools.filter { $0.tags.contains(tag) }
    }

    // MARK: - 工具执行

    /// 执行工具
    public func execute(toolId: String, input: ToolInput) async throws -> ToolOutput {
        guard let tool = toolsById[toolId] else {
            throw ToolError.toolNotFound(toolId)
        }

        guard let executor = toolExecutors[toolId] else {
            throw ToolError.executorNotFound(toolId)
        }

        // 验证输入
        try tool.validate(input: input)

        // 检查速率限制
        if let rateLimit = tool.rateLimit {
            try checkRateLimit(toolId: toolId, limit: rateLimit)
        }

        // 记录开始时间
        let startTime = Date()

        do {
            // 执行工具
            let output = try await executor(input)

            // 记录执行时间
            let executionTime = Date().timeIntervalSince(startTime)
            Logger.shared.debug("工具 '\(tool.name)' 执行耗时: \(String(format: "%.2f", executionTime))s")

            // 更新速率限制计数器
            if tool.rateLimit != nil {
                updateRateLimitCounter(toolId: toolId)
            }
            recordToolExecution(toolId: toolId, success: true)

            return output

        } catch {
            let executionTime = Date().timeIntervalSince(startTime)
            Logger.shared.error("工具 '\(tool.name)' 执行失败: \(error.localizedDescription), 耗时: \(String(format: "%.2f", executionTime))s")

            recordToolExecution(toolId: toolId, success: false)
            throw ToolError.executionFailed(tool.name, error.localizedDescription)
        }
    }

    // MARK: - 速率限制

    /// 检查速率限制
    private func checkRateLimit(toolId: String, limit: Int) throws {
        try rateLimitQueue.sync {
            let now = Date()

            if let counter = rateLimitCounters[toolId] {
                // 如果在同一分钟内
                if now < counter.resetTime {
                    if counter.count >= limit {
                        throw ToolError.rateLimitExceeded(limit)
                    }
                } else {
                    // 重置计数器
                    rateLimitCounters[toolId] = (count: 0, resetTime: now.addingTimeInterval(60))
                }
            } else {
                // 初始化计数器
                rateLimitCounters[toolId] = (count: 0, resetTime: now.addingTimeInterval(60))
            }
        }
    }

    /// 更新速率限制计数器
    private func updateRateLimitCounter(toolId: String) {
        rateLimitQueue.sync {
            if var counter = rateLimitCounters[toolId] {
                counter.count += 1
                rateLimitCounters[toolId] = counter
            }
        }
    }

    // MARK: - 工具统计

    /// 获取工具使用统计
    public func getToolStats() -> [String: Int] {
        // TODO: 实现工具使用统计
        return statsQueue.sync {
            var stats: [String: Int] = [
                "total_tools": toolsById.count,
                "tools_with_usage": toolUsageStats.count,
                "total_executions": toolUsageStats.values.reduce(0, +),
                "total_failures": toolFailureStats.values.reduce(0, +)
            ]
            for (toolId, count) in toolUsageStats {
                stats["tool.\(toolId).success"] = count
            }
            for (toolId, count) in toolFailureStats {
                stats["tool.\(toolId).failure"] = count
            }
            return stats
        }
    }

    // MARK: - 私有方法

    private func updateToolsList() {
        tools = Array(toolsById.values).sorted { $0.name < $1.name }
    }

    /// 加载内置工具
    private func recordToolExecution(toolId: String, success: Bool) {
        statsQueue.sync {
            if success {
                toolUsageStats[toolId, default: 0] += 1
            } else {
                toolFailureStats[toolId, default: 0] += 1
            }
        }
    }

    private func loadBuiltinTools() {
        isLoading = true

        // 加载内置工具
        let builtinTools = BuiltinTools.all

        for (tool, executor) in builtinTools {
            register(tool, executor: executor)
        }

        isLoading = false

        Logger.shared.info("加载了 \(tools.count) 个内置工具")
    }
}

// MARK: - 工具错误

public enum ToolError: LocalizedError {
    case toolNotFound(String)
    case executorNotFound(String)
    case executionFailed(String, String)
    case rateLimitExceeded(Int)

    public var errorDescription: String? {
        switch self {
        case .toolNotFound(let id):
            return "工具未找到: \(id)"
        case .executorNotFound(let id):
            return "工具执行器未找到: \(id)"
        case .executionFailed(let name, let error):
            return "工具执行失败 '\(name)': \(error)"
        case .rateLimitExceeded(let limit):
            return "超出速率限制: 每分钟最多 \(limit) 次调用"
        }
    }
}

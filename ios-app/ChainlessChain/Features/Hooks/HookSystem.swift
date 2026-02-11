import Foundation
import CoreCommon
import Combine

/// 钩子优先级
public enum HookPriority: Int, Comparable {
    case system = 0      // 系统级 (最先执行)
    case high = 100      // 高优先级
    case normal = 500    // 普通优先级
    case low = 900       // 低优先级
    case monitor = 1000  // 监控级 (最后执行, 不可阻止)

    public static func < (lhs: HookPriority, rhs: HookPriority) -> Bool {
        return lhs.rawValue < rhs.rawValue
    }
}

/// 钩子类型
public enum HookType: String, Codable, CaseIterable {
    case sync = "sync"       // 同步钩子
    case async = "async"     // 异步钩子
    case command = "command" // Shell 命令钩子
    case script = "script"   // 脚本文件钩子
}

/// 钩子事件类型
public enum HookEvent: String, CaseIterable, Codable {
    // IPC 相关
    case preIPCCall = "PreIPCCall"
    case postIPCCall = "PostIPCCall"
    case ipcError = "IPCError"

    // 工具调用相关
    case preToolUse = "PreToolUse"
    case postToolUse = "PostToolUse"
    case toolError = "ToolError"

    // 会话相关
    case sessionStart = "SessionStart"
    case sessionEnd = "SessionEnd"
    case preCompact = "PreCompact"
    case postCompact = "PostCompact"

    // 用户交互相关
    case userPromptSubmit = "UserPromptSubmit"
    case assistantResponse = "AssistantResponse"

    // Agent 相关
    case agentStart = "AgentStart"
    case agentStop = "AgentStop"
    case taskAssigned = "TaskAssigned"
    case taskCompleted = "TaskCompleted"

    // 文件操作相关
    case preFileAccess = "PreFileAccess"
    case postFileAccess = "PostFileAccess"
    case fileModified = "FileModified"

    // 内存系统相关
    case memorySave = "MemorySave"
    case memoryLoad = "MemoryLoad"
}

/// 钩子执行结果
public enum HookResult: String, Codable {
    case `continue` = "continue"  // 继续执行
    case reject = "reject"        // 拒绝执行
    case prevent = "prevent"      // 阻止执行 (同reject)
    case modify = "modify"        // 修改数据
    case skip = "skip"            // 跳过后续钩子
    case error = "error"          // 执行错误
}

/// 钩子配置
public struct HookConfig: Codable, Identifiable, Hashable {
    public let id: String
    public let event: HookEvent
    public var name: String
    public var type: HookType
    public var priority: Int
    public var enabled: Bool
    public var description: String?
    public var command: String?      // 用于 command 类型
    public var script: String?       // 用于 script 类型
    public var timeout: Int          // 超时时间（秒）
    public var metadata: [String: String]
    public let registeredAt: Date

    // 条件和匹配
    public var conditions: [String]      // 执行条件
    public var matchTools: [String]?     // 匹配的工具（用于工具相关事件）

    // 运行时统计
    public var executionCount: Int
    public var errorCount: Int
    public var lastExecutedAt: Date?
    public var avgExecutionTime: TimeInterval

    public init(
        id: String = UUID().uuidString,
        event: HookEvent,
        name: String,
        type: HookType = .async,
        priority: HookPriority = .normal,
        enabled: Bool = true,
        description: String? = nil,
        command: String? = nil,
        script: String? = nil,
        timeout: Int = 30,
        metadata: [String: String] = [:],
        conditions: [String] = [],
        matchTools: [String]? = nil
    ) {
        self.id = id
        self.event = event
        self.name = name
        self.type = type
        self.priority = priority.rawValue
        self.enabled = enabled
        self.description = description
        self.command = command
        self.script = script
        self.timeout = timeout
        self.metadata = metadata
        self.conditions = conditions
        self.matchTools = matchTools
        self.registeredAt = Date()
        self.executionCount = 0
        self.errorCount = 0
        self.lastExecutedAt = nil
        self.avgExecutionTime = 0
    }

    // Hashable 实现
    public func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }

    public static func == (lhs: HookConfig, rhs: HookConfig) -> Bool {
        lhs.id == rhs.id
    }
}

/// 钩子执行上下文
public struct HookContext {
    public let event: HookEvent
    public var data: [String: Any]
    public var sessionId: String?
    public var userId: String?
    public var timestamp: Date

    public init(
        event: HookEvent,
        data: [String: Any] = [:],
        sessionId: String? = nil,
        userId: String? = nil
    ) {
        self.event = event
        self.data = data
        self.sessionId = sessionId
        self.userId = userId
        self.timestamp = Date()
    }
}

/// 钩子执行响应
public struct HookResponse {
    public let result: HookResult
    public let reason: String?
    public var modifiedData: [String: Any]?
    public let executionTime: TimeInterval

    public init(
        result: HookResult,
        reason: String? = nil,
        modifiedData: [String: Any]? = nil,
        executionTime: TimeInterval = 0
    ) {
        self.result = result
        self.reason = reason
        self.modifiedData = modifiedData
        self.executionTime = executionTime
    }
}

/// 钩子处理器
public typealias HookHandler = (HookContext) async throws -> HookResponse

/// 已注册的钩子
public struct RegisteredHook {
    public let config: HookConfig
    public let handler: HookHandler?

    public init(config: HookConfig, handler: HookHandler?) {
        self.config = config
        self.handler = handler
    }
}

/// 钩子系统
@MainActor
public class HookSystem: ObservableObject {

    // MARK: - Singleton

    public static let shared = HookSystem()

    // MARK: - Configuration

    public struct Config {
        public var defaultTimeout: TimeInterval = 30
        public var continueOnError: Bool = true
        public var maxHistorySize: Int = 100

        public init() {}
    }

    // MARK: - Properties

    private var config: Config

    /// 事件名 -> 钩子数组
    private var hooks: [HookEvent: [RegisteredHook]] = [:]

    /// 钩子ID -> 钩子对象
    private var hookById: [String: RegisteredHook] = [:]

    /// 全局开关
    @Published public var enabled: Bool = true

    /// 统计信息
    @Published public var stats: HookStats

    /// 执行历史
    @Published public var executionHistory: [HookExecutionRecord] = []

    /// 事件发布器
    public let hookRegistered = PassthroughSubject<HookConfig, Never>()
    public let hookUnregistered = PassthroughSubject<String, Never>()
    public let hookExecutionStart = PassthroughSubject<(HookEvent, String), Never>()
    public let hookExecutionComplete = PassthroughSubject<(HookEvent, HookResponse), Never>()
    public let hookError = PassthroughSubject<(String, Error), Never>()

    // MARK: - Initialization

    private init() {
        self.config = Config()
        self.stats = HookStats()

        // 初始化所有事件类型
        for event in HookEvent.allCases {
            hooks[event] = []
        }

        Logger.shared.info("[HookSystem] 钩子系统已初始化")
    }

    /// 配置
    public func configure(_ config: Config) {
        self.config = config
    }

    /// 初始化（注册内置钩子）
    public func initialize() {
        registerBuiltinHooks()
        Logger.shared.info("[HookSystem] 内置钩子已注册")
    }

    // MARK: - Hook Registration

    /// 注册钩子
    @discardableResult
    public func register(
        event: HookEvent,
        name: String,
        priority: HookPriority = .normal,
        type: HookType = .async,
        description: String? = nil,
        timeout: TimeInterval = 30,
        handler: @escaping HookHandler
    ) -> String {
        let config = HookConfig(
            event: event,
            name: name,
            type: type,
            priority: priority,
            description: description,
            timeout: timeout
        )

        let registeredHook = RegisteredHook(config: config, handler: handler)

        // 添加到事件钩子列表
        hooks[event]?.append(registeredHook)

        // 按优先级排序
        hooks[event]?.sort { $0.config.priority < $1.config.priority }

        // 添加到 ID 映射
        hookById[config.id] = registeredHook

        stats.totalRegistered += 1

        Logger.shared.info("[HookSystem] 钩子已注册: \(name) (\(event.rawValue))")

        hookRegistered.send(config)

        return config.id
    }

    /// 注销钩子
    public func unregister(hookId: String) -> Bool {
        guard let hook = hookById[hookId] else {
            return false
        }

        // 从事件列表移除
        let event = hook.config.event
        hooks[event]?.removeAll { $0.config.id == hookId }

        // 从 ID 映射移除
        hookById.removeValue(forKey: hookId)

        Logger.shared.info("[HookSystem] 钩子已注销: \(hook.config.name)")

        hookUnregistered.send(hookId)

        return true
    }

    /// 启用/禁用钩子
    public func setHookEnabled(hookId: String, enabled: Bool) {
        guard let hook = hookById[hookId] else { return }

        let config = hook.config
        // Note: config is a struct, so we need to update in-place
        hookById[hookId] = RegisteredHook(
            config: HookConfig(
                id: config.id,
                event: config.event,
                name: config.name,
                type: config.type,
                priority: HookPriority(rawValue: config.priority) ?? .normal,
                enabled: enabled,
                description: config.description,
                command: config.command,
                script: config.script,
                timeout: config.timeout,
                metadata: config.metadata,
                conditions: config.conditions,
                matchTools: config.matchTools
            ),
            handler: hook.handler
        )
    }

    // MARK: - Hook Execution

    /// 触发钩子事件
    public func trigger(
        event: HookEvent,
        data: [String: Any] = [:],
        context: HookContext? = nil
    ) async -> HookResponse {
        guard enabled else {
            return HookResponse(result: .continue)
        }

        let effectiveContext = context ?? HookContext(event: event, data: data)

        hookExecutionStart.send((event, "all"))

        let eventHooks = hooks[event] ?? []
        let enabledHooks = eventHooks.filter { $0.config.enabled }

        if enabledHooks.isEmpty {
            return HookResponse(result: .continue)
        }

        var currentData = effectiveContext.data
        var finalResponse = HookResponse(result: .continue)
        let startTime = Date()

        for hook in enabledHooks {
            guard let handler = hook.handler else { continue }

            let hookStartTime = Date()

            do {
                var hookContext = effectiveContext
                hookContext.data = currentData

                let response = try await withTimeout(seconds: TimeInterval(hook.config.timeout)) {
                    try await handler(hookContext)
                }

                // 更新统计
                updateHookStats(hookId: hook.config.id, success: true, executionTime: Date().timeIntervalSince(hookStartTime))

                // 处理响应
                switch response.result {
                case .prevent:
                    // 记录执行历史
                    addExecutionRecord(event: event, hookId: hook.config.id, response: response, error: nil)
                    return response

                case .modify:
                    if let modifiedData = response.modifiedData {
                        currentData = modifiedData
                    }
                    finalResponse = response

                case .skip:
                    // 跳过后续钩子
                    finalResponse = response
                    break

                case .continue:
                    continue
                }

            } catch {
                // 更新错误统计
                updateHookStats(hookId: hook.config.id, success: false, executionTime: Date().timeIntervalSince(hookStartTime))

                hookError.send((hook.config.id, error))

                addExecutionRecord(event: event, hookId: hook.config.id, response: nil, error: error)

                if !config.continueOnError {
                    return HookResponse(result: .prevent, reason: "Hook error: \(error.localizedDescription)")
                }
            }
        }

        let totalTime = Date().timeIntervalSince(startTime)
        finalResponse = HookResponse(
            result: finalResponse.result,
            reason: finalResponse.reason,
            modifiedData: currentData != effectiveContext.data ? currentData : nil,
            executionTime: totalTime
        )

        hookExecutionComplete.send((event, finalResponse))

        return finalResponse
    }

    private func withTimeout<T>(seconds: TimeInterval, operation: @escaping () async throws -> T) async throws -> T {
        return try await withThrowingTaskGroup(of: T.self) { group in
            group.addTask {
                return try await operation()
            }

            group.addTask {
                try await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
                throw HookError.timeout
            }

            let result = try await group.next()!
            group.cancelAll()
            return result
        }
    }

    // MARK: - Statistics

    private func updateHookStats(hookId: String, success: Bool, executionTime: TimeInterval) {
        if success {
            stats.totalExecutions += 1
        } else {
            stats.totalErrors += 1
        }

        if let hook = hookById[hookId] {
            let event = hook.config.event
            stats.executionsByEvent[event, default: 0] += 1
        }
    }

    private func addExecutionRecord(event: HookEvent, hookId: String, response: HookResponse?, error: Error?) {
        let record = HookExecutionRecord(
            event: event,
            hookId: hookId,
            result: response?.result ?? .continue,
            reason: response?.reason ?? error?.localizedDescription,
            executionTime: response?.executionTime ?? 0,
            success: error == nil
        )

        executionHistory.insert(record, at: 0)

        // 限制历史大小
        if executionHistory.count > config.maxHistorySize {
            executionHistory = Array(executionHistory.prefix(config.maxHistorySize))
        }
    }

    // MARK: - Built-in Hooks

    private func registerBuiltinHooks() {
        // 性能监控钩子 - 记录慢速 IPC 调用
        register(
            event: .postIPCCall,
            name: "builtin:slow-ipc-logger",
            priority: .monitor,
            description: "Log slow IPC calls (>1000ms)"
        ) { context in
            if let executionTime = context.data["executionTime"] as? TimeInterval,
               executionTime > 1 {
                let channel = context.data["channel"] as? String ?? "unknown"
                Logger.shared.warning("[HookSystem] Slow IPC: \(channel) took \(executionTime)s")
            }
            return HookResponse(result: .continue)
        }

        // 工具使用监控钩子
        register(
            event: .postToolUse,
            name: "builtin:tool-usage-logger",
            priority: .monitor,
            description: "Log tool usage statistics"
        ) { context in
            if let executionTime = context.data["executionTime"] as? TimeInterval,
               executionTime > 5 {
                let toolName = context.data["toolName"] as? String ?? "unknown"
                Logger.shared.warning("[HookSystem] Slow tool: \(toolName) took \(executionTime)s")
            }
            return HookResponse(result: .continue)
        }
    }

    // MARK: - Query Methods

    /// 获取钩子列表
    public func listHooks(event: HookEvent? = nil) -> [HookConfig] {
        if let event = event {
            return hooks[event]?.map { $0.config } ?? []
        }

        return hookById.values.map { $0.config }
    }

    /// 获取单个钩子
    public func getHook(hookId: String) -> HookConfig? {
        return hookById[hookId]?.config
    }

    /// 获取统计信息
    public func getStats() -> HookStats {
        return stats
    }

    /// 清除执行历史
    public func clearHistory() {
        executionHistory.removeAll()
    }
}

// MARK: - Supporting Types

/// 钩子统计
public struct HookStats {
    public var totalRegistered: Int = 0
    public var totalExecutions: Int = 0
    public var totalErrors: Int = 0
    public var executionsByEvent: [HookEvent: Int] = [:]

    public init() {}
}

/// 钩子执行记录
public struct HookExecutionRecord: Identifiable {
    public let id = UUID()
    public let event: HookEvent
    public let hookId: String
    public let result: HookResult
    public let reason: String?
    public let executionTime: TimeInterval
    public let success: Bool
    public let timestamp: Date

    public init(
        event: HookEvent,
        hookId: String,
        result: HookResult,
        reason: String?,
        executionTime: TimeInterval,
        success: Bool
    ) {
        self.event = event
        self.hookId = hookId
        self.result = result
        self.reason = reason
        self.executionTime = executionTime
        self.success = success
        self.timestamp = Date()
    }
}

/// 钩子错误
public enum HookError: Error, LocalizedError {
    case timeout
    case notFound
    case invalidHandler
    case executionFailed(String)

    public var errorDescription: String? {
        switch self {
        case .timeout:
            return "钩子执行超时"
        case .notFound:
            return "钩子不存在"
        case .invalidHandler:
            return "无效的处理器"
        case .executionFailed(let message):
            return "钩子执行失败: \(message)"
        }
    }
}

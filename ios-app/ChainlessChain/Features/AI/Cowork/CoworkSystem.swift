import Foundation
import Combine
import CoreCommon

// MARK: - Agent Status

/// Agent状态
public enum AgentStatus: String, Codable, CaseIterable {
    case idle = "idle"
    case working = "working"
    case waiting = "waiting"
    case completed = "completed"
    case failed = "failed"
    case paused = "paused"
}

/// 团队状态
public enum TeamStatus: String, Codable, CaseIterable {
    case forming = "forming"       // 组建中
    case active = "active"         // 活跃
    case paused = "paused"         // 暂停
    case completed = "completed"   // 完成
    case dissolved = "dissolved"   // 解散
}

/// 任务状态
public enum CoworkTaskStatus: String, Codable, CaseIterable {
    case pending = "pending"
    case running = "running"
    case paused = "paused"
    case completed = "completed"
    case failed = "failed"
    case cancelled = "cancelled"
}

// MARK: - File Sandbox Permission

/// 文件权限
public enum SandboxPermission: String, Codable {
    case read = "read"
    case write = "write"
    case execute = "execute"
}

// MARK: - Agent

/// AI Agent
public struct CoworkAgent: Identifiable, Codable {
    public let id: String
    public var name: String
    public var role: String
    public var status: AgentStatus
    public var capabilities: [String]
    public var currentTask: String?
    public var metadata: [String: String]
    public var createdAt: Date
    public var lastActiveAt: Date

    public init(
        id: String = UUID().uuidString,
        name: String,
        role: String,
        capabilities: [String] = [],
        metadata: [String: String] = [:]
    ) {
        self.id = id
        self.name = name
        self.role = role
        self.status = .idle
        self.capabilities = capabilities
        self.currentTask = nil
        self.metadata = metadata
        self.createdAt = Date()
        self.lastActiveAt = Date()
    }
}

/// 团队
public struct CoworkTeam: Identifiable, Codable {
    public let id: String
    public var name: String
    public var description: String
    public var status: TeamStatus
    public var agents: [CoworkAgent]
    public var leadAgentId: String?
    public var goals: [String]
    public var createdAt: Date

    public init(
        id: String = UUID().uuidString,
        name: String,
        description: String = "",
        goals: [String] = []
    ) {
        self.id = id
        self.name = name
        self.description = description
        self.status = .forming
        self.agents = []
        self.leadAgentId = nil
        self.goals = goals
        self.createdAt = Date()
    }
}

/// 长时任务
public struct LongRunningTask: Identifiable, Codable {
    public let id: String
    public var name: String
    public var description: String
    public var status: CoworkTaskStatus
    public var progress: Double
    public var assignedAgentId: String?
    public var teamId: String?
    public var checkpoints: [TaskCheckpoint]
    public var result: String?
    public var error: String?
    public var createdAt: Date
    public var startedAt: Date?
    public var completedAt: Date?
    public var metadata: [String: String]

    public struct TaskCheckpoint: Codable {
        public let id: String
        public let name: String
        public let data: [String: String]
        public let createdAt: Date
    }

    public init(
        id: String = UUID().uuidString,
        name: String,
        description: String = "",
        teamId: String? = nil
    ) {
        self.id = id
        self.name = name
        self.description = description
        self.status = .pending
        self.progress = 0
        self.assignedAgentId = nil
        self.teamId = teamId
        self.checkpoints = []
        self.result = nil
        self.error = nil
        self.createdAt = Date()
        self.startedAt = nil
        self.completedAt = nil
        self.metadata = [:]
    }
}

// MARK: - File Sandbox

/// 文件沙箱
/// 实现安全的文件访问控制
public class FileSandbox: ObservableObject {

    // MARK: - Properties

    /// 允许的路径: path -> permissions
    private var allowedPaths: [String: Set<SandboxPermission>] = [:]

    /// 团队权限: teamId -> Set<path>
    private var teamPermissions: [String: Set<String>] = [:]

    /// 审计日志
    @Published public private(set) var auditLog: [AuditEntry] = []

    /// 敏感文件模式
    private let sensitivePatterns: [String] = [
        "\\.env$",
        "\\.env\\..+$",
        "credentials?\\.json$",
        "secrets?\\.json$",
        "\\.ssh/",
        "id_rsa$",
        "\\.pem$",
        "\\.key$",
        "password",
        "\\.keystore$"
    ]

    /// 最大文件大小
    public var maxFileSize: Int64 = 100 * 1024 * 1024 // 100MB

    /// 严格模式
    public var strictMode: Bool = true

    /// 事件发布
    public let accessRequested = PassthroughSubject<AccessRequest, Never>()
    public let accessDenied = PassthroughSubject<AccessDenial, Never>()

    // MARK: - Types

    public struct AuditEntry: Identifiable, Codable {
        public let id: String
        public let teamId: String
        public let path: String
        public let operation: String
        public let permission: String
        public let granted: Bool
        public let timestamp: Date
    }

    public struct AccessRequest {
        public let teamId: String
        public let path: String
        public let permissions: [SandboxPermission]
    }

    public struct AccessDenial {
        public let teamId: String
        public let path: String
        public let reason: String
    }

    // MARK: - Initialization

    public init() {
        Logger.shared.info("[FileSandbox] 已初始化")
    }

    // MARK: - Permission Management

    /// 请求访问权限
    public func requestAccess(
        teamId: String,
        folderPath: String,
        permissions: [SandboxPermission] = [.read]
    ) async -> Bool {
        let normalizedPath = normalizePath(folderPath)

        // 检查是否已授权
        if hasPermission(teamId: teamId, path: normalizedPath, permission: .read) {
            return true
        }

        // 检查敏感路径
        if isSensitivePath(normalizedPath) {
            Logger.shared.warning("[FileSandbox] 拒绝访问敏感路径: \(normalizedPath)")
            accessDenied.send(AccessDenial(
                teamId: teamId,
                path: normalizedPath,
                reason: "sensitive_path"
            ))
            return false
        }

        // 发送授权请求
        accessRequested.send(AccessRequest(
            teamId: teamId,
            path: normalizedPath,
            permissions: permissions
        ))

        return false
    }

    /// 授予访问权限
    public func grantAccess(
        teamId: String,
        folderPath: String,
        permissions: [SandboxPermission] = [.read]
    ) {
        let normalizedPath = normalizePath(folderPath)

        // 添加路径权限
        if allowedPaths[normalizedPath] == nil {
            allowedPaths[normalizedPath] = []
        }
        for permission in permissions {
            allowedPaths[normalizedPath]?.insert(permission)
        }

        // 添加团队权限
        if teamPermissions[teamId] == nil {
            teamPermissions[teamId] = []
        }
        teamPermissions[teamId]?.insert(normalizedPath)

        // 审计
        logAudit(
            teamId: teamId,
            path: normalizedPath,
            operation: "grant",
            permission: permissions.map { $0.rawValue }.joined(separator: ","),
            granted: true
        )

        Logger.shared.info("[FileSandbox] 已授权: \(teamId) -> \(normalizedPath)")
    }

    /// 撤销访问权限
    public func revokeAccess(teamId: String, folderPath: String) {
        let normalizedPath = normalizePath(folderPath)

        teamPermissions[teamId]?.remove(normalizedPath)
        allowedPaths.removeValue(forKey: normalizedPath)

        logAudit(
            teamId: teamId,
            path: normalizedPath,
            operation: "revoke",
            permission: "all",
            granted: true
        )

        Logger.shared.info("[FileSandbox] 已撤销: \(teamId) -> \(normalizedPath)")
    }

    /// 检查权限
    public func hasPermission(
        teamId: String,
        path: String,
        permission: SandboxPermission
    ) -> Bool {
        let normalizedPath = normalizePath(path)

        // 检查团队是否有此路径权限
        guard teamPermissions[teamId]?.contains(normalizedPath) == true else {
            // 检查父目录
            for allowedPath in teamPermissions[teamId] ?? [] {
                if normalizedPath.hasPrefix(allowedPath) {
                    if allowedPaths[allowedPath]?.contains(permission) == true {
                        return true
                    }
                }
            }
            return false
        }

        return allowedPaths[normalizedPath]?.contains(permission) == true
    }

    /// 验证文件操作
    public func validateOperation(
        teamId: String,
        path: String,
        operation: String
    ) -> (valid: Bool, reason: String?) {
        let normalizedPath = normalizePath(path)

        // 检查敏感路径
        if isSensitivePath(normalizedPath) {
            return (false, "访问敏感文件被拒绝")
        }

        // 确定需要的权限
        let requiredPermission: SandboxPermission
        switch operation {
        case "read", "list":
            requiredPermission = .read
        case "write", "create", "delete", "rename":
            requiredPermission = .write
        case "execute":
            requiredPermission = .execute
        default:
            requiredPermission = .read
        }

        // 检查权限
        if !hasPermission(teamId: teamId, path: normalizedPath, permission: requiredPermission) {
            return (false, "没有\(requiredPermission.rawValue)权限")
        }

        return (true, nil)
    }

    // MARK: - Helper Methods

    /// 检查是否为敏感路径
    private func isSensitivePath(_ path: String) -> Bool {
        for pattern in sensitivePatterns {
            if let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) {
                let range = NSRange(path.startIndex..., in: path)
                if regex.firstMatch(in: path, options: [], range: range) != nil {
                    return true
                }
            }
        }
        return false
    }

    /// 规范化路径
    private func normalizePath(_ path: String) -> String {
        return (path as NSString).standardizingPath
    }

    /// 记录审计日志
    private func logAudit(
        teamId: String,
        path: String,
        operation: String,
        permission: String,
        granted: Bool
    ) {
        let entry = AuditEntry(
            id: UUID().uuidString,
            teamId: teamId,
            path: path,
            operation: operation,
            permission: permission,
            granted: granted,
            timestamp: Date()
        )
        auditLog.append(entry)

        // 限制日志数量
        if auditLog.count > 1000 {
            auditLog.removeFirst(auditLog.count - 1000)
        }
    }

    /// 获取团队的所有已授权路径
    public func getAllowedPaths(teamId: String) -> [String] {
        return Array(teamPermissions[teamId] ?? [])
    }

    /// 清除团队的所有权限
    public func clearTeamPermissions(teamId: String) {
        if let paths = teamPermissions[teamId] {
            for path in paths {
                allowedPaths.removeValue(forKey: path)
            }
        }
        teamPermissions.removeValue(forKey: teamId)
    }
}

// MARK: - Long Running Task Manager

/// 长时任务管理器
public class LongRunningTaskManager: ObservableObject {

    // MARK: - Properties

    /// 任务列表
    @Published public private(set) var tasks: [String: LongRunningTask] = [:]

    /// 运行中的任务
    @Published public private(set) var runningTasks: Set<String> = []

    /// 最大并行任务数
    public var maxConcurrentTasks: Int = 5

    /// 检查点保存间隔
    public var checkpointInterval: TimeInterval = 60

    /// 事件发布
    public let taskStarted = PassthroughSubject<LongRunningTask, Never>()
    public let taskCompleted = PassthroughSubject<LongRunningTask, Never>()
    public let taskFailed = PassthroughSubject<(LongRunningTask, Error), Never>()
    public let taskProgress = PassthroughSubject<(String, Double), Never>()
    public let checkpointSaved = PassthroughSubject<(String, LongRunningTask.TaskCheckpoint), Never>()

    private var taskHandlers: [String: () async throws -> String] = [:]
    private let lock = NSLock()

    // MARK: - Initialization

    public init() {
        Logger.shared.info("[LongRunningTaskManager] 已初始化")
    }

    // MARK: - Task Management

    /// 创建任务
    @discardableResult
    public func createTask(
        name: String,
        description: String = "",
        teamId: String? = nil,
        metadata: [String: String] = [:]
    ) -> LongRunningTask {
        var task = LongRunningTask(name: name, description: description, teamId: teamId)
        task.metadata = metadata

        lock.lock()
        tasks[task.id] = task
        lock.unlock()

        Logger.shared.info("[LongRunningTaskManager] 创建任务: \(task.id) - \(name)")

        return task
    }

    /// 启动任务
    public func startTask(
        taskId: String,
        handler: @escaping () async throws -> String
    ) async throws {
        lock.lock()
        guard var task = tasks[taskId] else {
            lock.unlock()
            throw CoworkError.taskNotFound(taskId)
        }

        if runningTasks.count >= maxConcurrentTasks {
            lock.unlock()
            throw CoworkError.maxConcurrentTasksReached
        }

        task.status = .running
        task.startedAt = Date()
        tasks[taskId] = task
        runningTasks.insert(taskId)
        taskHandlers[taskId] = handler
        lock.unlock()

        taskStarted.send(task)

        // 执行任务
        do {
            let result = try await handler()

            lock.lock()
            if var completedTask = tasks[taskId] {
                completedTask.status = .completed
                completedTask.result = result
                completedTask.completedAt = Date()
                completedTask.progress = 1.0
                tasks[taskId] = completedTask
                runningTasks.remove(taskId)
                lock.unlock()

                taskCompleted.send(completedTask)
            } else {
                lock.unlock()
            }

        } catch {
            lock.lock()
            if var failedTask = tasks[taskId] {
                failedTask.status = .failed
                failedTask.error = error.localizedDescription
                failedTask.completedAt = Date()
                tasks[taskId] = failedTask
                runningTasks.remove(taskId)
                lock.unlock()

                taskFailed.send((failedTask, error))
            } else {
                lock.unlock()
            }

            throw error
        }
    }

    /// 暂停任务
    public func pauseTask(taskId: String) {
        lock.lock()
        defer { lock.unlock() }

        guard var task = tasks[taskId], task.status == .running else { return }

        task.status = .paused
        tasks[taskId] = task
        runningTasks.remove(taskId)

        Logger.shared.info("[LongRunningTaskManager] 暂停任务: \(taskId)")
    }

    /// 恢复任务
    public func resumeTask(taskId: String) async throws {
        lock.lock()
        guard var task = tasks[taskId], task.status == .paused else {
            lock.unlock()
            throw CoworkError.taskNotFound(taskId)
        }

        guard let handler = taskHandlers[taskId] else {
            lock.unlock()
            throw CoworkError.handlerNotFound(taskId)
        }

        task.status = .running
        tasks[taskId] = task
        runningTasks.insert(taskId)
        lock.unlock()

        try await startTask(taskId: taskId, handler: handler)
    }

    /// 取消任务
    public func cancelTask(taskId: String) {
        lock.lock()
        defer { lock.unlock() }

        guard var task = tasks[taskId] else { return }

        task.status = .cancelled
        task.completedAt = Date()
        tasks[taskId] = task
        runningTasks.remove(taskId)
        taskHandlers.removeValue(forKey: taskId)

        Logger.shared.info("[LongRunningTaskManager] 取消任务: \(taskId)")
    }

    /// 更新进度
    public func updateProgress(taskId: String, progress: Double) {
        lock.lock()
        defer { lock.unlock() }

        guard var task = tasks[taskId] else { return }

        task.progress = min(max(progress, 0), 1)
        tasks[taskId] = task

        taskProgress.send((taskId, progress))
    }

    /// 保存检查点
    public func saveCheckpoint(
        taskId: String,
        name: String,
        data: [String: String]
    ) {
        lock.lock()
        defer { lock.unlock() }

        guard var task = tasks[taskId] else { return }

        let checkpoint = LongRunningTask.TaskCheckpoint(
            id: UUID().uuidString,
            name: name,
            data: data,
            createdAt: Date()
        )

        task.checkpoints.append(checkpoint)
        tasks[taskId] = task

        checkpointSaved.send((taskId, checkpoint))

        Logger.shared.info("[LongRunningTaskManager] 保存检查点: \(taskId) - \(name)")
    }

    /// 获取最新检查点
    public func getLatestCheckpoint(taskId: String) -> LongRunningTask.TaskCheckpoint? {
        return tasks[taskId]?.checkpoints.last
    }

    /// 获取任务
    public func getTask(taskId: String) -> LongRunningTask? {
        return tasks[taskId]
    }

    /// 获取所有运行中的任务
    public func getRunningTasks() -> [LongRunningTask] {
        return runningTasks.compactMap { tasks[$0] }
    }

    /// 清理已完成的任务
    public func cleanupCompletedTasks(olderThan: TimeInterval = 3600) {
        lock.lock()
        defer { lock.unlock() }

        let cutoff = Date().addingTimeInterval(-olderThan)

        let toRemove = tasks.values.filter { task in
            (task.status == .completed || task.status == .failed || task.status == .cancelled) &&
            (task.completedAt ?? Date()) < cutoff
        }.map { $0.id }

        for taskId in toRemove {
            tasks.removeValue(forKey: taskId)
            taskHandlers.removeValue(forKey: taskId)
        }

        Logger.shared.info("[LongRunningTaskManager] 清理了 \(toRemove.count) 个已完成任务")
    }
}

// MARK: - Agent Pool

/// Agent池
public class AgentPool: ObservableObject {

    // MARK: - Properties

    /// Agent列表
    @Published public private(set) var agents: [String: CoworkAgent] = [:]

    /// 团队列表
    @Published public private(set) var teams: [String: CoworkTeam] = [:]

    /// 空闲Agent
    public var idleAgents: [CoworkAgent] {
        agents.values.filter { $0.status == .idle }
    }

    /// 事件发布
    public let agentCreated = PassthroughSubject<CoworkAgent, Never>()
    public let agentStatusChanged = PassthroughSubject<CoworkAgent, Never>()
    public let teamCreated = PassthroughSubject<CoworkTeam, Never>()
    public let teamStatusChanged = PassthroughSubject<CoworkTeam, Never>()

    private let lock = NSLock()

    // MARK: - Initialization

    public init() {
        Logger.shared.info("[AgentPool] 已初始化")
    }

    // MARK: - Agent Management

    /// 创建Agent
    @discardableResult
    public func createAgent(
        name: String,
        role: String,
        capabilities: [String] = []
    ) -> CoworkAgent {
        let agent = CoworkAgent(name: name, role: role, capabilities: capabilities)

        lock.lock()
        agents[agent.id] = agent
        lock.unlock()

        agentCreated.send(agent)

        Logger.shared.info("[AgentPool] 创建Agent: \(agent.id) - \(name)")

        return agent
    }

    /// 更新Agent状态
    public func updateAgentStatus(_ agentId: String, status: AgentStatus) {
        lock.lock()
        defer { lock.unlock() }

        guard var agent = agents[agentId] else { return }

        agent.status = status
        agent.lastActiveAt = Date()
        agents[agentId] = agent

        agentStatusChanged.send(agent)
    }

    /// 分配任务给Agent
    public func assignTask(_ agentId: String, taskId: String) {
        lock.lock()
        defer { lock.unlock() }

        guard var agent = agents[agentId] else { return }

        agent.currentTask = taskId
        agent.status = .working
        agent.lastActiveAt = Date()
        agents[agentId] = agent

        agentStatusChanged.send(agent)
    }

    /// 释放Agent
    public func releaseAgent(_ agentId: String) {
        lock.lock()
        defer { lock.unlock() }

        guard var agent = agents[agentId] else { return }

        agent.currentTask = nil
        agent.status = .idle
        agent.lastActiveAt = Date()
        agents[agentId] = agent

        agentStatusChanged.send(agent)
    }

    /// 获取具有特定能力的Agent
    public func getAgentWithCapability(_ capability: String) -> CoworkAgent? {
        return agents.values.first { agent in
            agent.status == .idle && agent.capabilities.contains(capability)
        }
    }

    /// 删除Agent
    public func removeAgent(_ agentId: String) {
        lock.lock()
        defer { lock.unlock() }

        agents.removeValue(forKey: agentId)
    }

    // MARK: - Team Management

    /// 创建团队
    @discardableResult
    public func createTeam(
        name: String,
        description: String = "",
        goals: [String] = []
    ) -> CoworkTeam {
        let team = CoworkTeam(name: name, description: description, goals: goals)

        lock.lock()
        teams[team.id] = team
        lock.unlock()

        teamCreated.send(team)

        Logger.shared.info("[AgentPool] 创建团队: \(team.id) - \(name)")

        return team
    }

    /// 添加Agent到团队
    public func addAgentToTeam(agentId: String, teamId: String) {
        lock.lock()
        defer { lock.unlock() }

        guard let agent = agents[agentId], var team = teams[teamId] else { return }

        team.agents.append(agent)
        teams[teamId] = team

        teamStatusChanged.send(team)
    }

    /// 从团队移除Agent
    public func removeAgentFromTeam(agentId: String, teamId: String) {
        lock.lock()
        defer { lock.unlock() }

        guard var team = teams[teamId] else { return }

        team.agents.removeAll { $0.id == agentId }
        teams[teamId] = team

        teamStatusChanged.send(team)
    }

    /// 设置团队领导
    public func setTeamLead(teamId: String, agentId: String) {
        lock.lock()
        defer { lock.unlock() }

        guard var team = teams[teamId] else { return }

        team.leadAgentId = agentId
        teams[teamId] = team

        teamStatusChanged.send(team)
    }

    /// 更新团队状态
    public func updateTeamStatus(_ teamId: String, status: TeamStatus) {
        lock.lock()
        defer { lock.unlock() }

        guard var team = teams[teamId] else { return }

        team.status = status
        teams[teamId] = team

        teamStatusChanged.send(team)
    }

    /// 解散团队
    public func dissolveTeam(_ teamId: String) {
        lock.lock()
        defer { lock.unlock() }

        guard var team = teams[teamId] else { return }

        // 释放所有Agent
        for agent in team.agents {
            var mutableAgent = agent
            mutableAgent.status = .idle
            mutableAgent.currentTask = nil
            agents[agent.id] = mutableAgent
        }

        team.status = .dissolved
        team.agents.removeAll()
        teams[teamId] = team

        teamStatusChanged.send(team)
    }
}

// MARK: - Cowork Orchestrator

/// Cowork编排器
@MainActor
public class CoworkOrchestrator: ObservableObject {

    // MARK: - Singleton

    public static let shared = CoworkOrchestrator()

    // MARK: - Components

    public let agentPool = AgentPool()
    public let taskManager = LongRunningTaskManager()
    public let fileSandbox = FileSandbox()

    // MARK: - Properties

    @Published public private(set) var isActive = false

    private var cancellables = Set<AnyCancellable>()

    // MARK: - Initialization

    private init() {
        setupSubscriptions()
        Logger.shared.info("[CoworkOrchestrator] 已初始化")
    }

    private func setupSubscriptions() {
        // 监听任务完成
        taskManager.taskCompleted
            .sink { [weak self] task in
                if let agentId = task.assignedAgentId {
                    self?.agentPool.releaseAgent(agentId)
                }
            }
            .store(in: &cancellables)

        // 监听任务失败
        taskManager.taskFailed
            .sink { [weak self] (task, _) in
                if let agentId = task.assignedAgentId {
                    self?.agentPool.releaseAgent(agentId)
                }
            }
            .store(in: &cancellables)
    }

    // MARK: - Orchestration

    /// 启动协作
    public func start() {
        isActive = true
        Logger.shared.info("[CoworkOrchestrator] 协作已启动")
    }

    /// 停止协作
    public func stop() {
        isActive = false

        // 暂停所有任务
        for taskId in taskManager.runningTasks {
            taskManager.pauseTask(taskId: taskId)
        }

        Logger.shared.info("[CoworkOrchestrator] 协作已停止")
    }

    /// 分配任务
    public func assignTask(
        task: LongRunningTask,
        capability: String? = nil
    ) async throws -> CoworkAgent {
        // 找到合适的Agent
        guard let agent = capability != nil ?
            agentPool.getAgentWithCapability(capability!) :
            agentPool.idleAgents.first else {
            throw CoworkError.noAvailableAgent
        }

        // 分配任务
        agentPool.assignTask(agent.id, taskId: task.id)

        var mutableTask = task
        mutableTask.assignedAgentId = agent.id
        // 更新任务

        Logger.shared.info("[CoworkOrchestrator] 分配任务 \(task.id) 给 Agent \(agent.id)")

        return agent
    }

    /// 创建并执行任务
    public func executeTask(
        name: String,
        description: String = "",
        capability: String? = nil,
        handler: @escaping () async throws -> String
    ) async throws -> LongRunningTask {
        let task = taskManager.createTask(name: name, description: description)

        let agent = try await assignTask(task: task, capability: capability)

        Logger.shared.info("[CoworkOrchestrator] 执行任务: \(task.id), Agent: \(agent.id)")

        try await taskManager.startTask(taskId: task.id, handler: handler)

        return taskManager.getTask(taskId: task.id) ?? task
    }
}

// MARK: - Errors

public enum CoworkError: Error, LocalizedError {
    case taskNotFound(String)
    case handlerNotFound(String)
    case noAvailableAgent
    case maxConcurrentTasksReached
    case permissionDenied(String)

    public var errorDescription: String? {
        switch self {
        case .taskNotFound(let id):
            return "任务未找到: \(id)"
        case .handlerNotFound(let id):
            return "任务处理器未找到: \(id)"
        case .noAvailableAgent:
            return "没有可用的Agent"
        case .maxConcurrentTasksReached:
            return "已达到最大并行任务数"
        case .permissionDenied(let path):
            return "权限被拒绝: \(path)"
        }
    }
}

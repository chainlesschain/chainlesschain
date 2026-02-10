import Foundation
import CoreCommon
import Combine

/// 计划模式状态
public enum PlanModeState: String, Codable {
    case inactive = "inactive"        // 非计划模式
    case analyzing = "analyzing"      // 分析中
    case planReady = "plan_ready"     // 计划就绪，等待审批
    case approved = "approved"        // 已审批，准备执行
    case executing = "executing"      // 执行中
    case completed = "completed"      // 完成
    case rejected = "rejected"        // 被拒绝
}

/// 工具分类
public enum ToolCategory: String, Codable {
    case read = "read"           // 只读操作
    case write = "write"         // 写入操作
    case execute = "execute"     // 执行操作
    case delete = "delete"       // 删除操作
    case search = "search"       // 搜索操作
    case analyze = "analyze"     // 分析操作
}

/// 计划项
public struct PlanItem: Codable, Identifiable {
    public let id: String
    public var order: Int
    public var title: String
    public var description: String
    public var tool: String?
    public var params: [String: String]
    public var dependencies: [String]
    public var estimatedImpact: ImpactLevel
    public var status: PlanItemStatus
    public var result: String?
    public var error: String?
    public let createdAt: Date
    public var updatedAt: Date

    public init(
        id: String = UUID().uuidString,
        order: Int = 0,
        title: String,
        description: String = "",
        tool: String? = nil,
        params: [String: String] = [:],
        dependencies: [String] = [],
        estimatedImpact: ImpactLevel = .low,
        status: PlanItemStatus = .pending
    ) {
        self.id = id
        self.order = order
        self.title = title
        self.description = description
        self.tool = tool
        self.params = params
        self.dependencies = dependencies
        self.estimatedImpact = estimatedImpact
        self.status = status
        self.result = nil
        self.error = nil
        self.createdAt = Date()
        self.updatedAt = Date()
    }
}

/// 计划项状态
public enum PlanItemStatus: String, Codable {
    case pending
    case approved
    case rejected
    case executing
    case completed
    case failed
}

/// 影响级别
public enum ImpactLevel: String, Codable {
    case low
    case medium
    case high
}

/// 执行计划
public class ExecutionPlan: Codable, Identifiable, ObservableObject {
    public let id: String
    @Published public var title: String
    @Published public var description: String
    @Published public var goal: String
    @Published public var items: [PlanItem]
    @Published public var status: PlanModeState
    public let createdAt: Date
    @Published public var updatedAt: Date
    @Published public var approvedAt: Date?
    @Published public var approvedBy: String?
    @Published public var completedAt: Date?
    @Published public var metadata: [String: String]

    enum CodingKeys: String, CodingKey {
        case id, title, description, goal, items, status
        case createdAt, updatedAt, approvedAt, approvedBy, completedAt, metadata
    }

    public init(
        id: String = UUID().uuidString,
        title: String = "Untitled Plan",
        description: String = "",
        goal: String = "",
        metadata: [String: String] = [:]
    ) {
        self.id = id
        self.title = title
        self.description = description
        self.goal = goal
        self.items = []
        self.status = .analyzing
        self.createdAt = Date()
        self.updatedAt = Date()
        self.approvedAt = nil
        self.approvedBy = nil
        self.completedAt = nil
        self.metadata = metadata
    }

    public required init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        title = try container.decode(String.self, forKey: .title)
        description = try container.decode(String.self, forKey: .description)
        goal = try container.decode(String.self, forKey: .goal)
        items = try container.decode([PlanItem].self, forKey: .items)
        status = try container.decode(PlanModeState.self, forKey: .status)
        createdAt = try container.decode(Date.self, forKey: .createdAt)
        updatedAt = try container.decode(Date.self, forKey: .updatedAt)
        approvedAt = try container.decodeIfPresent(Date.self, forKey: .approvedAt)
        approvedBy = try container.decodeIfPresent(String.self, forKey: .approvedBy)
        completedAt = try container.decodeIfPresent(Date.self, forKey: .completedAt)
        metadata = try container.decode([String: String].self, forKey: .metadata)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(title, forKey: .title)
        try container.encode(description, forKey: .description)
        try container.encode(goal, forKey: .goal)
        try container.encode(items, forKey: .items)
        try container.encode(status, forKey: .status)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encode(updatedAt, forKey: .updatedAt)
        try container.encodeIfPresent(approvedAt, forKey: .approvedAt)
        try container.encodeIfPresent(approvedBy, forKey: .approvedBy)
        try container.encodeIfPresent(completedAt, forKey: .completedAt)
        try container.encode(metadata, forKey: .metadata)
    }

    /// 添加计划项
    @discardableResult
    public func addItem(_ item: PlanItem) -> PlanItem {
        var newItem = item
        newItem.order = items.count
        items.append(newItem)
        updatedAt = Date()
        return newItem
    }

    /// 移除计划项
    public func removeItem(itemId: String) -> Bool {
        guard let index = items.firstIndex(where: { $0.id == itemId }) else {
            return false
        }
        items.remove(at: index)
        // 重新排序
        for i in 0..<items.count {
            items[i].order = i
        }
        updatedAt = Date()
        return true
    }

    /// 重新排序
    public func reorderItems(itemIds: [String]) {
        var newItems: [PlanItem] = []
        for id in itemIds {
            if var item = items.first(where: { $0.id == id }) {
                item.order = newItems.count
                newItems.append(item)
            }
        }
        items = newItems
        updatedAt = Date()
    }

    /// 获取计划项
    public func getItem(itemId: String) -> PlanItem? {
        return items.first { $0.id == itemId }
    }

    /// 审批计划
    public func approve(approvedBy: String = "user") {
        status = .approved
        approvedAt = Date()
        self.approvedBy = approvedBy
        updatedAt = Date()

        for i in 0..<items.count {
            items[i].status = .approved
            items[i].updatedAt = Date()
        }
    }

    /// 拒绝计划
    public func reject(reason: String = "") {
        status = .rejected
        updatedAt = Date()
        metadata["rejectionReason"] = reason
    }
}

/// 计划模式管理器
@MainActor
public class PlanModeManager: ObservableObject {

    // MARK: - Singleton

    public static let shared = PlanModeManager()

    // MARK: - Configuration

    public struct Config {
        public var autoSavePlans: Bool = true
        public var maxPlansHistory: Int = 50
        public var planTimeout: TimeInterval = 30 * 60  // 30分钟

        public init() {}
    }

    // MARK: - Tool Permissions

    /// 工具权限映射
    private static let toolPermissions: [String: ToolCategory] = [
        // 只读工具 - 计划模式允许
        "file_reader": .read,
        "Read": .read,
        "Glob": .search,
        "Grep": .search,
        "search": .search,
        "list_files": .search,
        "get_project_structure": .read,
        "analyze_code": .analyze,
        "explain_code": .analyze,
        "get_context": .read,
        "WebFetch": .read,
        "WebSearch": .search,

        // 写入工具 - 计划模式禁止
        "file_writer": .write,
        "Write": .write,
        "Edit": .write,
        "create_file": .write,
        "update_file": .write,
        "NotebookEdit": .write,

        // 执行工具 - 计划模式禁止
        "Bash": .execute,
        "execute_command": .execute,
        "run_script": .execute,
        "git_commit": .execute,
        "deploy": .execute,

        // 删除工具 - 计划模式禁止
        "delete_file": .delete,
        "remove_directory": .delete
    ]

    /// 计划模式允许的操作类别
    private static let allowedInPlanMode: Set<ToolCategory> = [.read, .search, .analyze]

    // MARK: - Properties

    private var config: Config

    @Published public var state: PlanModeState = .inactive
    @Published public var currentPlan: ExecutionPlan?
    @Published public var plansHistory: [ExecutionPlan] = []

    /// 统计
    @Published public var stats: PlanModeStats

    /// 事件发布器
    public let planEntered = PassthroughSubject<ExecutionPlan, Never>()
    public let planExited = PassthroughSubject<ExecutionPlan?, Never>()
    public let planApproved = PassthroughSubject<ExecutionPlan, Never>()
    public let planRejected = PassthroughSubject<(ExecutionPlan, String), Never>()
    public let toolBlocked = PassthroughSubject<ToolBlockedInfo, Never>()

    // MARK: - Initialization

    private init() {
        self.config = Config()
        self.stats = PlanModeStats()
        Logger.shared.info("[PlanMode] 计划模式管理器已初始化")
    }

    /// 配置
    public func configure(_ config: Config) {
        self.config = config
    }

    // MARK: - State Management

    /// 是否处于活动状态
    public var isActive: Bool {
        return state != .inactive
    }

    /// 进入计划模式
    @discardableResult
    public func enterPlanMode(
        title: String = "New Plan",
        description: String = "",
        goal: String = "",
        metadata: [String: String] = [:]
    ) -> ExecutionPlan {
        if isActive {
            Logger.shared.warning("[PlanMode] 已处于计划模式")
            return currentPlan!
        }

        state = .analyzing
        currentPlan = ExecutionPlan(
            title: title,
            description: description,
            goal: goal,
            metadata: metadata
        )

        stats.plansCreated += 1

        Logger.shared.info("[PlanMode] 进入计划模式: \(currentPlan!.id)")

        planEntered.send(currentPlan!)

        return currentPlan!
    }

    /// 退出计划模式
    @discardableResult
    public func exitPlanMode(savePlan: Bool = true, reason: String = "") -> (success: Bool, plan: ExecutionPlan?) {
        guard isActive else {
            Logger.shared.warning("[PlanMode] 不在计划模式中")
            return (false, nil)
        }

        let plan = currentPlan

        // 保存计划到历史
        if savePlan, let plan = plan {
            plansHistory.insert(plan, at: 0)
            if plansHistory.count > config.maxPlansHistory {
                plansHistory = Array(plansHistory.prefix(config.maxPlansHistory))
            }
        }

        state = .inactive
        currentPlan = nil

        Logger.shared.info("[PlanMode] 退出计划模式: \(plan?.id ?? "无计划")")

        planExited.send(plan)

        return (true, plan)
    }

    // MARK: - Plan Operations

    /// 添加计划项
    @discardableResult
    public func addPlanItem(
        title: String,
        description: String = "",
        tool: String? = nil,
        params: [String: String] = [:],
        dependencies: [String] = [],
        estimatedImpact: ImpactLevel = .low
    ) -> PlanItem? {
        guard let plan = currentPlan else {
            Logger.shared.warning("[PlanMode] 没有活动的计划")
            return nil
        }

        let item = PlanItem(
            title: title,
            description: description,
            tool: tool,
            params: params,
            dependencies: dependencies,
            estimatedImpact: estimatedImpact
        )

        return plan.addItem(item)
    }

    /// 移除计划项
    public func removePlanItem(itemId: String) -> Bool {
        guard let plan = currentPlan else { return false }
        return plan.removeItem(itemId: itemId)
    }

    /// 审批计划
    public func approvePlan(approvedBy: String = "user") {
        guard let plan = currentPlan else { return }

        plan.approve(approvedBy: approvedBy)
        state = .approved
        stats.plansApproved += 1

        Logger.shared.info("[PlanMode] 计划已审批: \(plan.id)")

        planApproved.send(plan)
    }

    /// 部分审批
    public func approveItems(itemIds: [String], approvedBy: String = "user") {
        guard let plan = currentPlan else { return }

        for i in 0..<plan.items.count {
            if itemIds.contains(plan.items[i].id) {
                plan.items[i].status = .approved
            } else {
                plan.items[i].status = .rejected
            }
            plan.items[i].updatedAt = Date()
        }

        plan.status = .approved
        plan.approvedAt = Date()
        plan.approvedBy = approvedBy
        plan.updatedAt = Date()

        state = .approved

        Logger.shared.info("[PlanMode] 部分审批完成: \(itemIds.count) 项")
    }

    /// 拒绝计划
    public func rejectPlan(reason: String = "") {
        guard let plan = currentPlan else { return }

        plan.reject(reason: reason)
        state = .rejected
        stats.plansRejected += 1

        Logger.shared.info("[PlanMode] 计划被拒绝: \(plan.id)")

        planRejected.send((plan, reason))
    }

    /// 将计划标记为就绪
    public func markPlanReady() {
        guard currentPlan != nil else { return }
        state = .planReady
        Logger.shared.info("[PlanMode] 计划就绪，等待审批")
    }

    // MARK: - Tool Permission Checking

    /// 获取工具类别
    public func getToolCategory(_ toolName: String) -> ToolCategory? {
        return Self.toolPermissions[toolName]
    }

    /// 检查工具是否在计划模式中允许
    public func isToolAllowedInPlanMode(_ toolName: String) -> Bool {
        guard let category = getToolCategory(toolName) else {
            // 未知工具默认禁止
            return false
        }
        return Self.allowedInPlanMode.contains(category)
    }

    /// 检查工具权限（集成 Hook 系统）
    public func checkToolPermission(toolName: String, params: [String: Any] = [:]) -> ToolPermissionResult {
        // 如果不在计划模式，允许所有操作
        guard isActive else {
            return ToolPermissionResult(allowed: true, reason: nil)
        }

        let category = getToolCategory(toolName)
        let allowed = isToolAllowedInPlanMode(toolName)

        if !allowed {
            stats.toolsBlocked += 1

            // 记录被阻止的操作到当前计划
            if let plan = currentPlan {
                let stringParams = params.mapValues { String(describing: $0) }
                plan.addItem(PlanItem(
                    title: "\(toolName) (blocked)",
                    description: "Tool \"\(toolName)\" was blocked in plan mode. Category: \(category?.rawValue ?? "unknown")",
                    tool: toolName,
                    params: stringParams,
                    estimatedImpact: estimateImpact(category)
                ))
            }

            let info = ToolBlockedInfo(
                toolName: toolName,
                category: category,
                params: params,
                reason: "Tool \"\(toolName)\" (\(category?.rawValue ?? "unknown")) is not allowed in plan mode"
            )

            toolBlocked.send(info)

            return ToolPermissionResult(
                allowed: false,
                reason: "[Plan Mode] Tool \"\(toolName)\" (\(category?.rawValue ?? "unknown")) is not allowed. Exit plan mode to execute."
            )
        }

        stats.toolsAllowed += 1
        return ToolPermissionResult(allowed: true, reason: nil)
    }

    private func estimateImpact(_ category: ToolCategory?) -> ImpactLevel {
        switch category {
        case .delete: return .high
        case .execute: return .high
        case .write: return .medium
        default: return .low
        }
    }

    // MARK: - Plan History

    /// 获取计划历史
    public func getPlansHistory(limit: Int = 10) -> [ExecutionPlan] {
        return Array(plansHistory.prefix(limit))
    }

    /// 清除计划历史
    public func clearHistory() {
        plansHistory.removeAll()
        Logger.shared.info("[PlanMode] 计划历史已清除")
    }

    // MARK: - Stats

    /// 重置统计
    public func resetStats() {
        stats = PlanModeStats()
    }
}

// MARK: - Supporting Types

/// 计划模式统计
public struct PlanModeStats {
    public var plansCreated: Int = 0
    public var plansApproved: Int = 0
    public var plansRejected: Int = 0
    public var plansCompleted: Int = 0
    public var toolsBlocked: Int = 0
    public var toolsAllowed: Int = 0

    public init() {}
}

/// 工具权限检查结果
public struct ToolPermissionResult {
    public let allowed: Bool
    public let reason: String?

    public init(allowed: Bool, reason: String?) {
        self.allowed = allowed
        self.reason = reason
    }
}

/// 工具被阻止信息
public struct ToolBlockedInfo {
    public let toolName: String
    public let category: ToolCategory?
    public let params: [String: Any]
    public let reason: String

    public init(
        toolName: String,
        category: ToolCategory?,
        params: [String: Any],
        reason: String
    ) {
        self.toolName = toolName
        self.category = category
        self.params = params
        self.reason = reason
    }
}

/// 计划模式错误
public enum PlanModeError: Error, LocalizedError {
    case notInPlanMode
    case planNotReady
    case alreadyInPlanMode
    case planNotFound
    case itemNotFound

    public var errorDescription: String? {
        switch self {
        case .notInPlanMode:
            return "不在计划模式中"
        case .planNotReady:
            return "计划未就绪"
        case .alreadyInPlanMode:
            return "已处于计划模式"
        case .planNotFound:
            return "计划不存在"
        case .itemNotFound:
            return "计划项不存在"
        }
    }
}

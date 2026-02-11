import Foundation

/// 审批工作流
/// 支持顺序/并行/任一审批流程
public struct ApprovalWorkflow: Codable, Identifiable {
    public let id: String
    public let orgId: String
    public let name: String
    public let description: String?
    public let triggerResourceType: String
    public let triggerAction: String
    public let triggerConditions: [String: String]?
    public let approvalType: ApprovalType
    public let approvers: [[String]]  // 每个步骤的审批人列表
    public let timeoutHours: Int
    public let onTimeout: TimeoutAction
    public let enabled: Bool
    public let createdAt: Date
    public let updatedAt: Date

    public init(
        id: String = UUID().uuidString,
        orgId: String,
        name: String,
        description: String? = nil,
        triggerResourceType: String,
        triggerAction: String,
        triggerConditions: [String: String]? = nil,
        approvalType: ApprovalType = .sequential,
        approvers: [[String]],
        timeoutHours: Int = 72,
        onTimeout: TimeoutAction = .reject,
        enabled: Bool = true,
        createdAt: Date = Date(),
        updatedAt: Date = Date()
    ) {
        self.id = id
        self.orgId = orgId
        self.name = name
        self.description = description
        self.triggerResourceType = triggerResourceType
        self.triggerAction = triggerAction
        self.triggerConditions = triggerConditions
        self.approvalType = approvalType
        self.approvers = approvers
        self.timeoutHours = timeoutHours
        self.onTimeout = onTimeout
        self.enabled = enabled
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

/// 审批类型
public enum ApprovalType: String, Codable {
    case sequential  // 顺序审批：每个步骤依次审批
    case parallel    // 并行审批：当前步骤所有人都需审批
    case anyOne      // 任一审批：当前步骤任一人审批即可
}

/// 超时操作
public enum TimeoutAction: String, Codable {
    case approve  // 自动通过
    case reject   // 自动拒绝
    case expire   // 标记过期
}

/// 审批请求
public struct ApprovalRequest: Codable, Identifiable {
    public let id: String
    public let workflowId: String
    public let orgId: String
    public let requesterDid: String
    public let requesterName: String
    public let resourceType: String
    public let resourceId: String?
    public let action: String
    public let requestData: [String: String]?
    public var status: ApprovalRequestStatus
    public var currentStep: Int
    public let totalSteps: Int
    public let createdAt: Date
    public var updatedAt: Date
    public var completedAt: Date?

    public init(
        id: String = UUID().uuidString,
        workflowId: String,
        orgId: String,
        requesterDid: String,
        requesterName: String,
        resourceType: String,
        resourceId: String? = nil,
        action: String,
        requestData: [String: String]? = nil,
        status: ApprovalRequestStatus = .pending,
        currentStep: Int = 0,
        totalSteps: Int,
        createdAt: Date = Date(),
        updatedAt: Date = Date(),
        completedAt: Date? = nil
    ) {
        self.id = id
        self.workflowId = workflowId
        self.orgId = orgId
        self.requesterDid = requesterDid
        self.requesterName = requesterName
        self.resourceType = resourceType
        self.resourceId = resourceId
        self.action = action
        self.requestData = requestData
        self.status = status
        self.currentStep = currentStep
        self.totalSteps = totalSteps
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.completedAt = completedAt
    }
}

/// 审批请求状态
public enum ApprovalRequestStatus: String, Codable {
    case pending   // 待审批
    case approved  // 已通过
    case rejected  // 已拒绝
    case expired   // 已过期
    case cancelled // 已取消
}

/// 审批响应
public struct ApprovalResponse: Codable, Identifiable {
    public let id: String
    public let requestId: String
    public let approverDid: String
    public let step: Int
    public let decision: ApprovalDecision
    public let comment: String?
    public let createdAt: Date

    public init(
        id: String = UUID().uuidString,
        requestId: String,
        approverDid: String,
        step: Int,
        decision: ApprovalDecision,
        comment: String? = nil,
        createdAt: Date = Date()
    ) {
        self.id = id
        self.requestId = requestId
        self.approverDid = approverDid
        self.step = step
        self.decision = decision
        self.comment = comment
        self.createdAt = createdAt
    }
}

/// 审批决定
public enum ApprovalDecision: String, Codable {
    case approve  // 同意
    case reject   // 拒绝
}

/// 审批请求摘要（用于列表显示）
public struct ApprovalRequestSummary: Identifiable {
    public let id: String
    public let workflowId: String
    public let workflowName: String
    public let requesterDid: String
    public let requesterName: String
    public let resourceType: String
    public let resourceId: String?
    public let action: String
    public let requestData: [String: String]?
    public let status: ApprovalRequestStatus
    public let currentStep: Int
    public let totalSteps: Int
    public let createdAt: Date
    public let completedAt: Date?

    public init(
        id: String,
        workflowId: String,
        workflowName: String,
        requesterDid: String,
        requesterName: String,
        resourceType: String,
        resourceId: String?,
        action: String,
        requestData: [String: String]?,
        status: ApprovalRequestStatus,
        currentStep: Int,
        totalSteps: Int,
        createdAt: Date,
        completedAt: Date?
    ) {
        self.id = id
        self.workflowId = workflowId
        self.workflowName = workflowName
        self.requesterDid = requesterDid
        self.requesterName = requesterName
        self.resourceType = resourceType
        self.resourceId = resourceId
        self.action = action
        self.requestData = requestData
        self.status = status
        self.currentStep = currentStep
        self.totalSteps = totalSteps
        self.createdAt = createdAt
        self.completedAt = completedAt
    }
}

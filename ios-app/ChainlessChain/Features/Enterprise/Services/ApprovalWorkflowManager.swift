import Foundation
import CoreCommon
import Combine

/// 审批工作流管理器
/// 管理权限请求和其他操作的审批工作流
///
/// 功能:
/// - 顺序/并行/任一审批流程
/// - 多步骤审批
/// - 超时处理
/// - 审批委派
@MainActor
public class ApprovalWorkflowManager: ObservableObject {

    // MARK: - Singleton

    public static let shared = ApprovalWorkflowManager()

    // MARK: - Properties

    private let database: Database

    /// 超时定时器
    private var timeoutTimers: [String: Timer] = [:]

    /// 事件发布器
    public let approvalRequested = PassthroughSubject<ApprovalRequestEvent, Never>()
    public let approvalApproved = PassthroughSubject<String, Never>()
    public let approvalRejected = PassthroughSubject<String, Never>()
    public let approvalTimeout = PassthroughSubject<ApprovalTimeoutEvent, Never>()
    public let approvalNextStep = PassthroughSubject<ApprovalNextStepEvent, Never>()

    // MARK: - Initialization

    private init() {
        self.database = Database.shared
        Logger.shared.info("[ApprovalWorkflow] 审批工作流管理器已初始化")
    }

    /// 初始化数据库表
    public func initialize() async throws {
        Logger.shared.info("[ApprovalWorkflow] 初始化数据库表...")

        // 审批工作流表
        let createWorkflowsTableSQL = """
        CREATE TABLE IF NOT EXISTS approval_workflows (
            id TEXT PRIMARY KEY,
            org_id TEXT NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            trigger_resource_type TEXT NOT NULL,
            trigger_action TEXT NOT NULL,
            trigger_conditions_json TEXT,
            approval_type TEXT NOT NULL DEFAULT 'sequential',
            approvers_json TEXT NOT NULL,
            timeout_hours INTEGER NOT NULL DEFAULT 72,
            on_timeout TEXT NOT NULL DEFAULT 'reject',
            enabled INTEGER NOT NULL DEFAULT 1,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )
        """

        // 审批请求表
        let createRequestsTableSQL = """
        CREATE TABLE IF NOT EXISTS approval_requests (
            id TEXT PRIMARY KEY,
            workflow_id TEXT NOT NULL,
            org_id TEXT NOT NULL,
            requester_did TEXT NOT NULL,
            requester_name TEXT NOT NULL,
            resource_type TEXT NOT NULL,
            resource_id TEXT,
            action TEXT NOT NULL,
            request_data_json TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            current_step INTEGER NOT NULL DEFAULT 0,
            total_steps INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            completed_at INTEGER,
            FOREIGN KEY (workflow_id) REFERENCES approval_workflows(id)
        )
        """

        // 审批响应表
        let createResponsesTableSQL = """
        CREATE TABLE IF NOT EXISTS approval_responses (
            id TEXT PRIMARY KEY,
            request_id TEXT NOT NULL,
            approver_did TEXT NOT NULL,
            step INTEGER NOT NULL,
            decision TEXT NOT NULL,
            comment TEXT,
            created_at INTEGER NOT NULL,
            FOREIGN KEY (request_id) REFERENCES approval_requests(id)
        )
        """

        try await database.execute(createWorkflowsTableSQL)
        try await database.execute(createRequestsTableSQL)
        try await database.execute(createResponsesTableSQL)

        // 创建索引
        try await database.execute("CREATE INDEX IF NOT EXISTS idx_approval_workflows_org ON approval_workflows(org_id)")
        try await database.execute("CREATE INDEX IF NOT EXISTS idx_approval_requests_org ON approval_requests(org_id)")
        try await database.execute("CREATE INDEX IF NOT EXISTS idx_approval_requests_workflow ON approval_requests(workflow_id)")
        try await database.execute("CREATE INDEX IF NOT EXISTS idx_approval_responses_request ON approval_responses(request_id)")

        Logger.shared.info("[ApprovalWorkflow] 数据库表初始化成功")
    }

    // MARK: - Workflow CRUD

    /// 创建审批工作流
    public func createWorkflow(_ workflow: ApprovalWorkflow) async throws -> ApprovalWorkflow {
        let conditionsJson = workflow.triggerConditions != nil
            ? try? JSONEncoder().encode(workflow.triggerConditions).utf8String
            : nil
        let approversJson = try JSONEncoder().encode(workflow.approvers).utf8String ?? "[]"

        let sql = """
        INSERT INTO approval_workflows (
            id, org_id, name, description, trigger_resource_type, trigger_action,
            trigger_conditions_json, approval_type, approvers_json, timeout_hours,
            on_timeout, enabled, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """

        try await database.execute(sql, [
            workflow.id,
            workflow.orgId,
            workflow.name,
            workflow.description as Any,
            workflow.triggerResourceType,
            workflow.triggerAction,
            conditionsJson as Any,
            workflow.approvalType.rawValue,
            approversJson,
            workflow.timeoutHours,
            workflow.onTimeout.rawValue,
            workflow.enabled ? 1 : 0,
            Int(workflow.createdAt.timeIntervalSince1970),
            Int(workflow.updatedAt.timeIntervalSince1970)
        ])

        Logger.shared.info("[ApprovalWorkflow] 已创建工作流: \(workflow.id)")

        return workflow
    }

    /// 更新审批工作流
    public func updateWorkflow(
        workflowId: String,
        name: String? = nil,
        description: String? = nil,
        approvalType: ApprovalType? = nil,
        approvers: [[String]]? = nil,
        timeoutHours: Int? = nil,
        onTimeout: TimeoutAction? = nil,
        enabled: Bool? = nil
    ) async throws {
        var updateParts: [String] = []
        var values: [Any] = []

        if let name = name {
            updateParts.append("name = ?")
            values.append(name)
        }

        if let description = description {
            updateParts.append("description = ?")
            values.append(description)
        }

        if let approvalType = approvalType {
            updateParts.append("approval_type = ?")
            values.append(approvalType.rawValue)
        }

        if let approvers = approvers {
            updateParts.append("approvers_json = ?")
            let json = try JSONEncoder().encode(approvers).utf8String ?? "[]"
            values.append(json)
        }

        if let timeoutHours = timeoutHours {
            updateParts.append("timeout_hours = ?")
            values.append(timeoutHours)
        }

        if let onTimeout = onTimeout {
            updateParts.append("on_timeout = ?")
            values.append(onTimeout.rawValue)
        }

        if let enabled = enabled {
            updateParts.append("enabled = ?")
            values.append(enabled ? 1 : 0)
        }

        guard !updateParts.isEmpty else { return }

        updateParts.append("updated_at = ?")
        values.append(Int(Date().timeIntervalSince1970))
        values.append(workflowId)

        let sql = "UPDATE approval_workflows SET \(updateParts.joined(separator: ", ")) WHERE id = ?"

        try await database.execute(sql, values)

        Logger.shared.info("[ApprovalWorkflow] 已更新工作流: \(workflowId)")
    }

    /// 删除审批工作流
    public func deleteWorkflow(workflowId: String) async throws -> Bool {
        // 检查是否有待处理的请求
        let query = """
        SELECT COUNT(*) as count FROM approval_requests
        WHERE workflow_id = ? AND status = 'pending'
        """
        let rows = try await database.query(query, [workflowId])

        if let count = rows.first?["count"] as? Int, count > 0 {
            throw ApprovalWorkflowError.hasPendingRequests(count: count)
        }

        try await database.execute("DELETE FROM approval_workflows WHERE id = ?", [workflowId])

        Logger.shared.info("[ApprovalWorkflow] 已删除工作流: \(workflowId)")

        return true
    }

    /// 获取工作流
    public func getWorkflow(workflowId: String) async throws -> ApprovalWorkflow? {
        let query = "SELECT * FROM approval_workflows WHERE id = ?"
        let rows = try await database.query(query, [workflowId])

        guard let row = rows.first else { return nil }
        return parseWorkflow(from: row)
    }

    /// 获取组织的所有工作流
    public func getWorkflows(orgId: String, enabledOnly: Bool = false) async throws -> [ApprovalWorkflow] {
        var query = "SELECT * FROM approval_workflows WHERE org_id = ?"
        if enabledOnly {
            query += " AND enabled = 1"
        }
        query += " ORDER BY created_at DESC"

        let rows = try await database.query(query, [orgId])
        return rows.compactMap { parseWorkflow(from: $0) }
    }

    // MARK: - Approval Request Operations

    /// 提交审批请求
    public func submitApproval(
        workflowId: String,
        requesterDid: String,
        requesterName: String,
        resourceType: String,
        resourceId: String? = nil,
        action: String,
        requestData: [String: String]? = nil
    ) async throws -> ApprovalRequest {
        // 获取工作流
        guard let workflow = try await getWorkflow(workflowId: workflowId), workflow.enabled else {
            throw ApprovalWorkflowError.workflowNotFound
        }

        let request = ApprovalRequest(
            workflowId: workflowId,
            orgId: workflow.orgId,
            requesterDid: requesterDid,
            requesterName: requesterName,
            resourceType: resourceType,
            resourceId: resourceId,
            action: action,
            requestData: requestData,
            totalSteps: workflow.approvers.count
        )

        let requestDataJson = requestData != nil
            ? try? JSONEncoder().encode(requestData).utf8String
            : nil

        let sql = """
        INSERT INTO approval_requests (
            id, workflow_id, org_id, requester_did, requester_name,
            resource_type, resource_id, action, request_data_json,
            status, current_step, total_steps, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)
        """

        try await database.execute(sql, [
            request.id,
            request.workflowId,
            request.orgId,
            request.requesterDid,
            request.requesterName,
            request.resourceType,
            request.resourceId as Any,
            request.action,
            requestDataJson as Any,
            request.totalSteps,
            Int(request.createdAt.timeIntervalSince1970),
            Int(request.updatedAt.timeIntervalSince1970)
        ])

        // 设置超时定时器
        setupTimeout(requestId: request.id, timeoutHours: workflow.timeoutHours, onTimeout: workflow.onTimeout)

        // 发送事件
        approvalRequested.send(ApprovalRequestEvent(
            requestId: request.id,
            workflow: workflow,
            requesterDid: requesterDid,
            nextApprovers: workflow.approvers.first ?? []
        ))

        Logger.shared.info("[ApprovalWorkflow] 已创建审批请求: \(request.id)")

        return request
    }

    /// 同意审批
    public func approveRequest(requestId: String, approverDid: String, comment: String? = nil) async throws -> ApprovalResult {
        return try await processDecision(requestId: requestId, approverDid: approverDid, decision: .approve, comment: comment)
    }

    /// 拒绝审批
    public func rejectRequest(requestId: String, approverDid: String, comment: String? = nil) async throws -> ApprovalResult {
        return try await processDecision(requestId: requestId, approverDid: approverDid, decision: .reject, comment: comment)
    }

    /// 处理审批决定
    private func processDecision(
        requestId: String,
        approverDid: String,
        decision: ApprovalDecision,
        comment: String?
    ) async throws -> ApprovalResult {
        let now = Date()
        let nowTimestamp = Int(now.timeIntervalSince1970)

        // 获取请求和工作流信息
        let query = """
        SELECT ar.*, aw.approval_type, aw.approvers_json
        FROM approval_requests ar
        INNER JOIN approval_workflows aw ON aw.id = ar.workflow_id
        WHERE ar.id = ? AND ar.status = 'pending'
        """
        let rows = try await database.query(query, [requestId])

        guard let row = rows.first else {
            throw ApprovalWorkflowError.requestNotFound
        }

        let currentStep = row["current_step"] as? Int ?? 0
        let totalSteps = row["total_steps"] as? Int ?? 0
        let approvalTypeRaw = row["approval_type"] as? String ?? "sequential"
        let approvalType = ApprovalType(rawValue: approvalTypeRaw) ?? .sequential

        guard let approversJson = row["approvers_json"] as? String,
              let approversData = approversJson.data(using: .utf8),
              let approvers = try? JSONDecoder().decode([[String]].self, from: approversData) else {
            throw ApprovalWorkflowError.invalidWorkflowData
        }

        let currentStepApprovers = currentStep < approvers.count ? approvers[currentStep] : []

        // 验证审批人权限
        guard isAuthorizedApprover(approverDid: approverDid, stepApprovers: currentStepApprovers) else {
            throw ApprovalWorkflowError.notAuthorized
        }

        // 记录响应
        let response = ApprovalResponse(
            requestId: requestId,
            approverDid: approverDid,
            step: currentStep,
            decision: decision,
            comment: comment
        )

        let responseSql = """
        INSERT INTO approval_responses (
            id, request_id, approver_did, step, decision, comment, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """

        try await database.execute(responseSql, [
            response.id,
            response.requestId,
            response.approverDid,
            response.step,
            response.decision.rawValue,
            response.comment as Any,
            Int(response.createdAt.timeIntervalSince1970)
        ])

        // 处理拒绝
        if decision == .reject {
            try await database.execute("""
                UPDATE approval_requests
                SET status = 'rejected', updated_at = ?, completed_at = ?
                WHERE id = ?
            """, [nowTimestamp, nowTimestamp, requestId])

            clearTimeout(requestId: requestId)
            approvalRejected.send(requestId)

            Logger.shared.info("[ApprovalWorkflow] 审批已拒绝: \(requestId)")

            return ApprovalResult(finalStatus: .rejected)
        }

        // 处理同意
        var shouldAdvance = false
        var isComplete = false

        switch approvalType {
        case .anyOne:
            // 任一审批通过即可
            shouldAdvance = true
            isComplete = currentStep >= totalSteps - 1

        case .parallel:
            // 检查当前步骤是否所有人都已审批
            let countQuery = """
            SELECT COUNT(DISTINCT approver_did) as count
            FROM approval_responses
            WHERE request_id = ? AND step = ? AND decision = 'approve'
            """
            let countRows = try await database.query(countQuery, [requestId, currentStep])
            let approvedCount = countRows.first?["count"] as? Int ?? 0

            if approvedCount >= currentStepApprovers.count {
                shouldAdvance = true
                isComplete = currentStep >= totalSteps - 1
            }

        case .sequential:
            // 顺序审批，直接进入下一步
            shouldAdvance = true
            isComplete = currentStep >= totalSteps - 1
        }

        if isComplete {
            try await database.execute("""
                UPDATE approval_requests
                SET status = 'approved', updated_at = ?, completed_at = ?
                WHERE id = ?
            """, [nowTimestamp, nowTimestamp, requestId])

            clearTimeout(requestId: requestId)
            approvalApproved.send(requestId)

            Logger.shared.info("[ApprovalWorkflow] 审批已通过: \(requestId)")

            return ApprovalResult(finalStatus: .approved)
        }

        if shouldAdvance {
            try await database.execute("""
                UPDATE approval_requests
                SET current_step = current_step + 1, updated_at = ?
                WHERE id = ?
            """, [nowTimestamp, requestId])

            // 通知下一步审批人
            let nextStep = currentStep + 1
            if nextStep < approvers.count {
                approvalNextStep.send(ApprovalNextStepEvent(
                    requestId: requestId,
                    step: nextStep,
                    nextApprovers: approvers[nextStep]
                ))
            }

            return ApprovalResult(currentStep: nextStep)
        }

        return ApprovalResult(currentStep: currentStep)
    }

    /// 取消审批请求
    public func cancelRequest(requestId: String, cancellerDid: String) async throws -> Bool {
        let now = Int(Date().timeIntervalSince1970)

        // 验证是请求者本人
        let query = "SELECT requester_did FROM approval_requests WHERE id = ? AND status = 'pending'"
        let rows = try await database.query(query, [requestId])

        guard let row = rows.first,
              let requesterDid = row["requester_did"] as? String,
              requesterDid == cancellerDid else {
            throw ApprovalWorkflowError.notAuthorized
        }

        try await database.execute("""
            UPDATE approval_requests
            SET status = 'cancelled', updated_at = ?, completed_at = ?
            WHERE id = ?
        """, [now, now, requestId])

        clearTimeout(requestId: requestId)

        Logger.shared.info("[ApprovalWorkflow] 审批请求已取消: \(requestId)")

        return true
    }

    /// 获取用户待审批的请求
    public func getPendingApprovals(approverDid: String, orgId: String) async throws -> [ApprovalRequestSummary] {
        let query = """
        SELECT ar.*, aw.name as workflow_name, aw.approvers_json
        FROM approval_requests ar
        INNER JOIN approval_workflows aw ON aw.id = ar.workflow_id
        WHERE ar.org_id = ? AND ar.status = 'pending'
        ORDER BY ar.created_at DESC
        """

        let rows = try await database.query(query, [orgId])

        // 过滤出用户可以审批的请求
        return rows.compactMap { row -> ApprovalRequestSummary? in
            guard let approversJson = row["approvers_json"] as? String,
                  let approversData = approversJson.data(using: .utf8),
                  let approvers = try? JSONDecoder().decode([[String]].self, from: approversData) else {
                return nil
            }

            let currentStep = row["current_step"] as? Int ?? 0
            let currentApprovers = currentStep < approvers.count ? approvers[currentStep] : []

            guard isAuthorizedApprover(approverDid: approverDid, stepApprovers: currentApprovers) else {
                return nil
            }

            return parseRequestSummary(from: row)
        }
    }

    /// 获取审批历史
    public func getApprovalHistory(
        orgId: String,
        status: ApprovalRequestStatus? = nil,
        requesterDid: String? = nil,
        limit: Int = 50
    ) async throws -> [ApprovalRequestSummary] {
        var query = """
        SELECT ar.*, aw.name as workflow_name
        FROM approval_requests ar
        INNER JOIN approval_workflows aw ON aw.id = ar.workflow_id
        WHERE ar.org_id = ?
        """
        var params: [Any] = [orgId]

        if let status = status {
            query += " AND ar.status = ?"
            params.append(status.rawValue)
        }

        if let requesterDid = requesterDid {
            query += " AND ar.requester_did = ?"
            params.append(requesterDid)
        }

        query += " ORDER BY ar.created_at DESC LIMIT ?"
        params.append(limit)

        let rows = try await database.query(query, params)
        return rows.compactMap { parseRequestSummary(from: $0) }
    }

    /// 获取请求的审批响应历史
    public func getApprovalResponses(requestId: String) async throws -> [ApprovalResponse] {
        let query = """
        SELECT * FROM approval_responses
        WHERE request_id = ?
        ORDER BY created_at ASC
        """

        let rows = try await database.query(query, [requestId])
        return rows.compactMap { parseResponse(from: $0) }
    }

    // MARK: - Helper Methods

    private func isAuthorizedApprover(approverDid: String, stepApprovers: [String]) -> Bool {
        return stepApprovers.contains(approverDid)
    }

    private func setupTimeout(requestId: String, timeoutHours: Int, onTimeout: TimeoutAction) {
        let timeoutInterval = TimeInterval(timeoutHours * 60 * 60)

        let timer = Timer.scheduledTimer(withTimeInterval: timeoutInterval, repeats: false) { [weak self] _ in
            Task { @MainActor in
                await self?.handleTimeout(requestId: requestId, action: onTimeout)
            }
        }

        timeoutTimers[requestId] = timer
    }

    private func clearTimeout(requestId: String) {
        timeoutTimers[requestId]?.invalidate()
        timeoutTimers.removeValue(forKey: requestId)
    }

    private func handleTimeout(requestId: String, action: TimeoutAction) async {
        let now = Int(Date().timeIntervalSince1970)

        let status: String
        switch action {
        case .approve:
            status = "approved"
        case .reject:
            status = "rejected"
        case .expire:
            status = "expired"
        }

        do {
            try await database.execute("""
                UPDATE approval_requests
                SET status = ?, updated_at = ?, completed_at = ?
                WHERE id = ? AND status = 'pending'
            """, [status, now, now, requestId])

            timeoutTimers.removeValue(forKey: requestId)

            approvalTimeout.send(ApprovalTimeoutEvent(requestId: requestId, action: status))

            Logger.shared.info("[ApprovalWorkflow] 请求超时: \(requestId), 操作: \(status)")
        } catch {
            Logger.shared.error("[ApprovalWorkflow] 处理超时失败: \(error)")
        }
    }

    // MARK: - Parsing Methods

    private func parseWorkflow(from row: [String: Any]) -> ApprovalWorkflow? {
        guard
            let id = row["id"] as? String,
            let orgId = row["org_id"] as? String,
            let name = row["name"] as? String,
            let triggerResourceType = row["trigger_resource_type"] as? String,
            let triggerAction = row["trigger_action"] as? String,
            let approvalTypeRaw = row["approval_type"] as? String,
            let approvalType = ApprovalType(rawValue: approvalTypeRaw),
            let approversJson = row["approvers_json"] as? String,
            let approversData = approversJson.data(using: .utf8),
            let approvers = try? JSONDecoder().decode([[String]].self, from: approversData),
            let timeoutHours = row["timeout_hours"] as? Int,
            let onTimeoutRaw = row["on_timeout"] as? String,
            let onTimeout = TimeoutAction(rawValue: onTimeoutRaw),
            let enabled = row["enabled"] as? Int,
            let createdAtTimestamp = row["created_at"] as? Int,
            let updatedAtTimestamp = row["updated_at"] as? Int
        else {
            return nil
        }

        var triggerConditions: [String: String]?
        if let conditionsJson = row["trigger_conditions_json"] as? String,
           let data = conditionsJson.data(using: .utf8) {
            triggerConditions = try? JSONDecoder().decode([String: String].self, from: data)
        }

        return ApprovalWorkflow(
            id: id,
            orgId: orgId,
            name: name,
            description: row["description"] as? String,
            triggerResourceType: triggerResourceType,
            triggerAction: triggerAction,
            triggerConditions: triggerConditions,
            approvalType: approvalType,
            approvers: approvers,
            timeoutHours: timeoutHours,
            onTimeout: onTimeout,
            enabled: enabled == 1,
            createdAt: Date(timeIntervalSince1970: TimeInterval(createdAtTimestamp)),
            updatedAt: Date(timeIntervalSince1970: TimeInterval(updatedAtTimestamp))
        )
    }

    private func parseRequestSummary(from row: [String: Any]) -> ApprovalRequestSummary? {
        guard
            let id = row["id"] as? String,
            let workflowId = row["workflow_id"] as? String,
            let requesterDid = row["requester_did"] as? String,
            let requesterName = row["requester_name"] as? String,
            let resourceType = row["resource_type"] as? String,
            let action = row["action"] as? String,
            let statusRaw = row["status"] as? String,
            let status = ApprovalRequestStatus(rawValue: statusRaw),
            let currentStep = row["current_step"] as? Int,
            let totalSteps = row["total_steps"] as? Int,
            let createdAtTimestamp = row["created_at"] as? Int
        else {
            return nil
        }

        var requestData: [String: String]?
        if let dataJson = row["request_data_json"] as? String,
           let data = dataJson.data(using: .utf8) {
            requestData = try? JSONDecoder().decode([String: String].self, from: data)
        }

        let completedAt = (row["completed_at"] as? Int).map { Date(timeIntervalSince1970: TimeInterval($0)) }

        return ApprovalRequestSummary(
            id: id,
            workflowId: workflowId,
            workflowName: row["workflow_name"] as? String ?? "",
            requesterDid: requesterDid,
            requesterName: requesterName,
            resourceType: resourceType,
            resourceId: row["resource_id"] as? String,
            action: action,
            requestData: requestData,
            status: status,
            currentStep: currentStep,
            totalSteps: totalSteps,
            createdAt: Date(timeIntervalSince1970: TimeInterval(createdAtTimestamp)),
            completedAt: completedAt
        )
    }

    private func parseResponse(from row: [String: Any]) -> ApprovalResponse? {
        guard
            let id = row["id"] as? String,
            let requestId = row["request_id"] as? String,
            let approverDid = row["approver_did"] as? String,
            let step = row["step"] as? Int,
            let decisionRaw = row["decision"] as? String,
            let decision = ApprovalDecision(rawValue: decisionRaw),
            let createdAtTimestamp = row["created_at"] as? Int
        else {
            return nil
        }

        return ApprovalResponse(
            id: id,
            requestId: requestId,
            approverDid: approverDid,
            step: step,
            decision: decision,
            comment: row["comment"] as? String,
            createdAt: Date(timeIntervalSince1970: TimeInterval(createdAtTimestamp))
        )
    }
}

// MARK: - Supporting Types

/// 审批结果
public struct ApprovalResult {
    public let finalStatus: ApprovalRequestStatus?
    public let currentStep: Int?

    public init(finalStatus: ApprovalRequestStatus? = nil, currentStep: Int? = nil) {
        self.finalStatus = finalStatus
        self.currentStep = currentStep
    }
}

/// 审批请求事件
public struct ApprovalRequestEvent {
    public let requestId: String
    public let workflow: ApprovalWorkflow
    public let requesterDid: String
    public let nextApprovers: [String]
}

/// 审批超时事件
public struct ApprovalTimeoutEvent {
    public let requestId: String
    public let action: String
}

/// 审批下一步事件
public struct ApprovalNextStepEvent {
    public let requestId: String
    public let step: Int
    public let nextApprovers: [String]
}

/// 审批工作流错误
public enum ApprovalWorkflowError: Error, LocalizedError {
    case workflowNotFound
    case requestNotFound
    case notAuthorized
    case hasPendingRequests(count: Int)
    case invalidWorkflowData

    public var errorDescription: String? {
        switch self {
        case .workflowNotFound:
            return "工作流不存在"
        case .requestNotFound:
            return "审批请求不存在"
        case .notAuthorized:
            return "没有审批权限"
        case .hasPendingRequests(let count):
            return "工作流还有 \(count) 个待处理的请求"
        case .invalidWorkflowData:
            return "工作流数据无效"
        }
    }
}

// MARK: - Data Extension

private extension Data {
    var utf8String: String? {
        return String(data: self, encoding: .utf8)
    }
}

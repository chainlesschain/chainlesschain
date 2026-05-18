import Foundation

/// 工作流元数据。
public struct WorkflowMetadata: Sendable, Equatable {
    public let id: String
    public let name: String
    public let description: String?
    public let createdAt: String?
    public let updatedAt: String?
    public let stepsCount: Int?
    public let enabled: Bool

    public init(id: String, name: String, description: String? = nil,
                createdAt: String? = nil, updatedAt: String? = nil,
                stepsCount: Int? = nil, enabled: Bool = true) {
        self.id = id; self.name = name; self.description = description
        self.createdAt = createdAt; self.updatedAt = updatedAt
        self.stepsCount = stepsCount; self.enabled = enabled
    }

    internal static func from(_ d: [String: Any]) -> WorkflowMetadata {
        return WorkflowMetadata(
            id: (d["id"] as? String) ?? "",
            name: (d["name"] as? String) ?? "",
            description: d["description"] as? String,
            createdAt: d["createdAt"] as? String,
            updatedAt: d["updatedAt"] as? String,
            stepsCount: d["stepsCount"] as? Int,
            enabled: (d["enabled"] as? Bool) ?? true
        )
    }
}

/// `workflow.list` 响应。
public struct WorkflowListResponse: Sendable, Equatable {
    public let success: Bool
    public let workflows: [WorkflowMetadata]
    public let total: Int

    public init(success: Bool, workflows: [WorkflowMetadata], total: Int) {
        self.success = success; self.workflows = workflows; self.total = total
    }

    public static func decode(_ json: String) throws -> WorkflowListResponse {
        let d = try parseDict(json)
        let arr = (d["workflows"] as? [[String: Any]]) ?? []
        return WorkflowListResponse(
            success: (d["success"] as? Bool) ?? false,
            workflows: arr.map { WorkflowMetadata.from($0) },
            total: (d["total"] as? Int) ?? arr.count
        )
    }
}

/// `workflow.get` 响应（单 workflow 详情）。
public struct WorkflowGetResponse: Sendable, Equatable {
    public let success: Bool
    public let workflow: WorkflowMetadata?
    public let message: String?

    public init(success: Bool, workflow: WorkflowMetadata? = nil, message: String? = nil) {
        self.success = success; self.workflow = workflow; self.message = message
    }

    public static func decode(_ json: String) throws -> WorkflowGetResponse {
        let d = try parseDict(json)
        let w = d["workflow"] as? [String: Any]
        return WorkflowGetResponse(
            success: (d["success"] as? Bool) ?? false,
            workflow: w.map { WorkflowMetadata.from($0) },
            message: d["message"] as? String
        )
    }
}

/// `workflow.create` / `update` / `delete` 通用响应。
public struct WorkflowActionResponse: Sendable, Equatable {
    public let success: Bool
    public let workflowId: String?
    public let message: String

    public init(success: Bool, workflowId: String? = nil, message: String) {
        self.success = success; self.workflowId = workflowId; self.message = message
    }

    public static func decode(_ json: String) throws -> WorkflowActionResponse {
        let d = try parseDict(json)
        return WorkflowActionResponse(
            success: (d["success"] as? Bool) ?? false,
            workflowId: d["workflowId"] as? String,
            message: (d["message"] as? String) ?? ""
        )
    }
}

/// `workflow.execute` 响应（启动执行返 executionId）。
public struct WorkflowExecuteResponse: Sendable, Equatable {
    public let success: Bool
    public let executionId: String
    public let workflowId: String
    public let status: String         // running / queued / failed
    public let message: String

    public init(success: Bool, executionId: String, workflowId: String,
                status: String, message: String) {
        self.success = success; self.executionId = executionId
        self.workflowId = workflowId; self.status = status; self.message = message
    }

    public static func decode(_ json: String) throws -> WorkflowExecuteResponse {
        let d = try parseDict(json)
        return WorkflowExecuteResponse(
            success: (d["success"] as? Bool) ?? false,
            executionId: (d["executionId"] as? String) ?? "",
            workflowId: (d["workflowId"] as? String) ?? "",
            status: (d["status"] as? String) ?? "",
            message: (d["message"] as? String) ?? ""
        )
    }
}

/// `workflow.cancel` 响应。
public struct WorkflowCancelResponse: Sendable, Equatable {
    public let success: Bool
    public let executionId: String
    public let cancelled: Bool
    public let message: String

    public init(success: Bool, executionId: String, cancelled: Bool, message: String) {
        self.success = success; self.executionId = executionId
        self.cancelled = cancelled; self.message = message
    }

    public static func decode(_ json: String) throws -> WorkflowCancelResponse {
        let d = try parseDict(json)
        return WorkflowCancelResponse(
            success: (d["success"] as? Bool) ?? false,
            executionId: (d["executionId"] as? String) ?? "",
            cancelled: (d["cancelled"] as? Bool) ?? false,
            message: (d["message"] as? String) ?? ""
        )
    }
}

/// 工作流执行记录。
public struct WorkflowExecution: Sendable, Equatable {
    public let executionId: String
    public let workflowId: String
    public let status: String         // running / completed / failed / cancelled
    public let startedAt: String?
    public let completedAt: String?
    public let durationMs: Int?
    public let error: String?

    public init(executionId: String, workflowId: String, status: String,
                startedAt: String? = nil, completedAt: String? = nil,
                durationMs: Int? = nil, error: String? = nil) {
        self.executionId = executionId; self.workflowId = workflowId
        self.status = status; self.startedAt = startedAt
        self.completedAt = completedAt; self.durationMs = durationMs; self.error = error
    }

    internal static func from(_ d: [String: Any]) -> WorkflowExecution {
        return WorkflowExecution(
            executionId: (d["executionId"] as? String) ?? "",
            workflowId: (d["workflowId"] as? String) ?? "",
            status: (d["status"] as? String) ?? "",
            startedAt: d["startedAt"] as? String,
            completedAt: d["completedAt"] as? String,
            durationMs: d["durationMs"] as? Int,
            error: d["error"] as? String
        )
    }
}

/// `workflow.getHistory` 响应。
public struct WorkflowHistoryResponse: Sendable, Equatable {
    public let success: Bool
    public let executions: [WorkflowExecution]
    public let total: Int

    public init(success: Bool, executions: [WorkflowExecution], total: Int) {
        self.success = success; self.executions = executions; self.total = total
    }

    public static func decode(_ json: String) throws -> WorkflowHistoryResponse {
        let d = try parseDict(json)
        let arr = (d["executions"] as? [[String: Any]]) ?? []
        return WorkflowHistoryResponse(
            success: (d["success"] as? Bool) ?? false,
            executions: arr.map { WorkflowExecution.from($0) },
            total: (d["total"] as? Int) ?? arr.count
        )
    }
}

/// `workflow.getRunning` 响应。
public struct WorkflowRunningResponse: Sendable, Equatable {
    public let success: Bool
    public let running: [WorkflowExecution]
    public let count: Int

    public init(success: Bool, running: [WorkflowExecution], count: Int) {
        self.success = success; self.running = running; self.count = count
    }

    public static func decode(_ json: String) throws -> WorkflowRunningResponse {
        let d = try parseDict(json)
        let arr = (d["running"] as? [[String: Any]]) ?? []
        return WorkflowRunningResponse(
            success: (d["success"] as? Bool) ?? false,
            running: arr.map { WorkflowExecution.from($0) },
            count: (d["count"] as? Int) ?? arr.count
        )
    }
}

/// `workflow.getStatus` 响应（单 execution 状态）。
public struct WorkflowStatusResponse: Sendable, Equatable {
    public let success: Bool
    public let executionId: String
    public let status: String
    public let progress: Double?      // 0.0 - 1.0
    public let currentStep: String?
    public let completedSteps: Int?
    public let totalSteps: Int?

    public init(success: Bool, executionId: String, status: String,
                progress: Double? = nil, currentStep: String? = nil,
                completedSteps: Int? = nil, totalSteps: Int? = nil) {
        self.success = success; self.executionId = executionId; self.status = status
        self.progress = progress; self.currentStep = currentStep
        self.completedSteps = completedSteps; self.totalSteps = totalSteps
    }

    public static func decode(_ json: String) throws -> WorkflowStatusResponse {
        let d = try parseDict(json)
        return WorkflowStatusResponse(
            success: (d["success"] as? Bool) ?? false,
            executionId: (d["executionId"] as? String) ?? "",
            status: (d["status"] as? String) ?? "",
            progress: d["progress"] as? Double,
            currentStep: d["currentStep"] as? String,
            completedSteps: d["completedSteps"] as? Int,
            totalSteps: d["totalSteps"] as? Int
        )
    }
}

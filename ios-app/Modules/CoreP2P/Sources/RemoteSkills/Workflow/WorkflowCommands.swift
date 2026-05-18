import Foundation

/// 工作流自动化 typed RPC wrapper — Phase 6.5 (红档子集 batch 2)。
///
/// 镜像 Android `app/src/main/java/.../remote/commands/WorkflowCommands.kt` 桌面已支持 10 method 子集
/// （桌面 case ⊂ Android 13 method invoke；Android 多 3 method 留 Phase 7+ debt: clone, export, import）。
///
/// **wire 协议**（与桌面 `workflow-handler.js` 对齐）：
/// - CRUD: list / get / create / update / delete
/// - 执行: execute / cancel / getStatus
/// - 历史: getHistory / getRunning
public actor WorkflowCommands {

    private let client: RemoteCommandClient

    public init(client: RemoteCommandClient) {
        self.client = client
    }

    // MARK: - CRUD

    public func list(
        pcPeerId: String,
        limit: Int = 50,
        mobileDid: String? = nil
    ) async throws -> WorkflowListResponse {
        guard limit > 0 else {
            throw RemoteSkillError.invalidArgument("workflow.list: limit must be > 0")
        }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "workflow.list",
            params: ["limit": limit],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, WorkflowListResponse.decode)
    }

    public func get(
        pcPeerId: String,
        workflowId: String,
        mobileDid: String? = nil
    ) async throws -> WorkflowGetResponse {
        guard !workflowId.isEmpty else {
            throw RemoteSkillError.invalidArgument("workflow.get: workflowId empty")
        }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "workflow.get",
            params: ["workflowId": workflowId],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, WorkflowGetResponse.decode)
    }

    /// 创建工作流（mutating; definition 是 JSON 字符串，由 caller 序列化）。
    public func create(
        pcPeerId: String,
        name: String,
        description: String? = nil,
        definitionJson: String,
        mobileDid: String? = nil
    ) async throws -> WorkflowActionResponse {
        guard !name.isEmpty else {
            throw RemoteSkillError.invalidArgument("workflow.create: name empty")
        }
        guard !definitionJson.isEmpty else {
            throw RemoteSkillError.invalidArgument("workflow.create: definitionJson empty")
        }
        var params: [String: Any] = ["name": name, "definitionJson": definitionJson]
        if let d = description { params["description"] = d }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "workflow.create",
            params: params,
            mobileDid: mobileDid
        )
        return try Self.decode(resp, WorkflowActionResponse.decode)
    }

    public func update(
        pcPeerId: String,
        workflowId: String,
        name: String? = nil,
        description: String? = nil,
        definitionJson: String? = nil,
        enabled: Bool? = nil,
        mobileDid: String? = nil
    ) async throws -> WorkflowActionResponse {
        guard !workflowId.isEmpty else {
            throw RemoteSkillError.invalidArgument("workflow.update: workflowId empty")
        }
        var params: [String: Any] = ["workflowId": workflowId]
        if let n = name { params["name"] = n }
        if let d = description { params["description"] = d }
        if let j = definitionJson { params["definitionJson"] = j }
        if let e = enabled { params["enabled"] = e }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "workflow.update",
            params: params,
            mobileDid: mobileDid
        )
        return try Self.decode(resp, WorkflowActionResponse.decode)
    }

    public func delete(
        pcPeerId: String,
        workflowId: String,
        mobileDid: String? = nil
    ) async throws -> WorkflowActionResponse {
        guard !workflowId.isEmpty else {
            throw RemoteSkillError.invalidArgument("workflow.delete: workflowId empty")
        }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "workflow.delete",
            params: ["workflowId": workflowId],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, WorkflowActionResponse.decode)
    }

    // MARK: - 执行

    /// 触发执行 workflow，返 executionId 用于后续查询/取消。
    public func execute(
        pcPeerId: String,
        workflowId: String,
        inputJson: String? = nil,
        mobileDid: String? = nil
    ) async throws -> WorkflowExecuteResponse {
        guard !workflowId.isEmpty else {
            throw RemoteSkillError.invalidArgument("workflow.execute: workflowId empty")
        }
        var params: [String: Any] = ["workflowId": workflowId]
        if let i = inputJson { params["inputJson"] = i }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "workflow.execute",
            params: params,
            mobileDid: mobileDid
        )
        return try Self.decode(resp, WorkflowExecuteResponse.decode)
    }

    public func cancel(
        pcPeerId: String,
        executionId: String,
        mobileDid: String? = nil
    ) async throws -> WorkflowCancelResponse {
        guard !executionId.isEmpty else {
            throw RemoteSkillError.invalidArgument("workflow.cancel: executionId empty")
        }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "workflow.cancel",
            params: ["executionId": executionId],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, WorkflowCancelResponse.decode)
    }

    public func getStatus(
        pcPeerId: String,
        executionId: String,
        mobileDid: String? = nil
    ) async throws -> WorkflowStatusResponse {
        guard !executionId.isEmpty else {
            throw RemoteSkillError.invalidArgument("workflow.getStatus: executionId empty")
        }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "workflow.getStatus",
            params: ["executionId": executionId],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, WorkflowStatusResponse.decode)
    }

    // MARK: - 历史

    public func getHistory(
        pcPeerId: String,
        workflowId: String? = nil,
        limit: Int = 50,
        mobileDid: String? = nil
    ) async throws -> WorkflowHistoryResponse {
        guard limit > 0 else {
            throw RemoteSkillError.invalidArgument("workflow.getHistory: limit must be > 0")
        }
        var params: [String: Any] = ["limit": limit]
        if let w = workflowId { params["workflowId"] = w }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "workflow.getHistory",
            params: params,
            mobileDid: mobileDid
        )
        return try Self.decode(resp, WorkflowHistoryResponse.decode)
    }

    public func getRunning(
        pcPeerId: String,
        mobileDid: String? = nil
    ) async throws -> WorkflowRunningResponse {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "workflow.getRunning",
            params: [:],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, WorkflowRunningResponse.decode)
    }

    private static func decode<T>(
        _ resp: TerminalRpcResponse,
        _ decoder: (String) throws -> T
    ) throws -> T {
        switch resp {
        case .success(_, let resultJson):  return try decoder(resultJson)
        case .failure(let reqId, let msg): throw RemoteSkillError.remoteError(reqId: reqId, message: msg)
        }
    }
}

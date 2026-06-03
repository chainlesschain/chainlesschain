import XCTest
@testable import ChainlessChain

/// 审批工作流测试
final class ApprovalWorkflowTests: XCTestCase {

    override func setUp() async throws {
        // 初始化审批工作流管理器
        try await ApprovalWorkflowManager.shared.initialize()
    }

    // MARK: - Workflow CRUD Tests

    func testCreateWorkflow() async throws {
        let orgId = "test-org-\(UUID().uuidString)"

        let workflow = ApprovalWorkflow(
            orgId: orgId,
            name: "知识库删除审批",
            description: "删除知识库内容需要审批",
            triggerResourceType: "knowledge",
            triggerAction: "delete",
            approvers: [["did:test:admin1"], ["did:test:admin2"]],
            timeoutHours: 48,
            onTimeout: .reject
        )

        let created = try await ApprovalWorkflowManager.shared.createWorkflow(workflow)

        XCTAssertEqual(created.id, workflow.id)
        XCTAssertEqual(created.name, "知识库删除审批")
        XCTAssertEqual(created.approvers.count, 2)
        XCTAssertTrue(created.enabled)
    }

    func testUpdateWorkflow() async throws {
        let orgId = "test-org-\(UUID().uuidString)"

        let workflow = ApprovalWorkflow(
            orgId: orgId,
            name: "原始名称",
            triggerResourceType: "project",
            triggerAction: "delete",
            approvers: [["did:test:admin"]]
        )

        _ = try await ApprovalWorkflowManager.shared.createWorkflow(workflow)

        try await ApprovalWorkflowManager.shared.updateWorkflow(
            workflowId: workflow.id,
            name: "更新后名称",
            timeoutHours: 24
        )

        let updated = try await ApprovalWorkflowManager.shared.getWorkflow(workflowId: workflow.id)

        XCTAssertEqual(updated?.name, "更新后名称")
        XCTAssertEqual(updated?.timeoutHours, 24)
    }

    func testDeleteWorkflow() async throws {
        let orgId = "test-org-\(UUID().uuidString)"

        let workflow = ApprovalWorkflow(
            orgId: orgId,
            name: "待删除工作流",
            triggerResourceType: "test",
            triggerAction: "delete",
            approvers: [["did:test:admin"]]
        )

        _ = try await ApprovalWorkflowManager.shared.createWorkflow(workflow)

        let deleted = try await ApprovalWorkflowManager.shared.deleteWorkflow(workflowId: workflow.id)
        XCTAssertTrue(deleted)

        let fetched = try await ApprovalWorkflowManager.shared.getWorkflow(workflowId: workflow.id)
        XCTAssertNil(fetched)
    }

    // MARK: - Approval Request Tests

    func testSubmitApproval() async throws {
        let orgId = "test-org-\(UUID().uuidString)"
        let adminDid = "did:test:admin-\(UUID().uuidString)"
        let requesterDid = "did:test:requester-\(UUID().uuidString)"

        // 创建工作流
        let workflow = ApprovalWorkflow(
            orgId: orgId,
            name: "测试审批",
            triggerResourceType: "knowledge",
            triggerAction: "delete",
            approvers: [[adminDid]]
        )
        _ = try await ApprovalWorkflowManager.shared.createWorkflow(workflow)

        // 提交审批请求
        let request = try await ApprovalWorkflowManager.shared.submitApproval(
            workflowId: workflow.id,
            requesterDid: requesterDid,
            requesterName: "测试用户",
            resourceType: "knowledge",
            resourceId: "doc-123",
            action: "delete",
            requestData: ["reason": "不再需要"]
        )

        XCTAssertEqual(request.workflowId, workflow.id)
        XCTAssertEqual(request.requesterDid, requesterDid)
        XCTAssertEqual(request.status, .pending)
        XCTAssertEqual(request.currentStep, 0)
        XCTAssertEqual(request.totalSteps, 1)
    }

    func testApproveRequest() async throws {
        let orgId = "test-org-\(UUID().uuidString)"
        let adminDid = "did:test:admin-\(UUID().uuidString)"
        let requesterDid = "did:test:requester-\(UUID().uuidString)"

        // 创建单步审批工作流
        let workflow = ApprovalWorkflow(
            orgId: orgId,
            name: "单步审批",
            triggerResourceType: "knowledge",
            triggerAction: "delete",
            approvers: [[adminDid]]
        )
        _ = try await ApprovalWorkflowManager.shared.createWorkflow(workflow)

        // 提交审批请求
        let request = try await ApprovalWorkflowManager.shared.submitApproval(
            workflowId: workflow.id,
            requesterDid: requesterDid,
            requesterName: "测试用户",
            resourceType: "knowledge",
            action: "delete"
        )

        // 审批通过
        let result = try await ApprovalWorkflowManager.shared.approveRequest(
            requestId: request.id,
            approverDid: adminDid,
            comment: "同意删除"
        )

        XCTAssertEqual(result.finalStatus, .approved)
    }

    func testRejectRequest() async throws {
        let orgId = "test-org-\(UUID().uuidString)"
        let adminDid = "did:test:admin-\(UUID().uuidString)"
        let requesterDid = "did:test:requester-\(UUID().uuidString)"

        let workflow = ApprovalWorkflow(
            orgId: orgId,
            name: "拒绝测试",
            triggerResourceType: "project",
            triggerAction: "delete",
            approvers: [[adminDid]]
        )
        _ = try await ApprovalWorkflowManager.shared.createWorkflow(workflow)

        let request = try await ApprovalWorkflowManager.shared.submitApproval(
            workflowId: workflow.id,
            requesterDid: requesterDid,
            requesterName: "测试用户",
            resourceType: "project",
            action: "delete"
        )

        let result = try await ApprovalWorkflowManager.shared.rejectRequest(
            requestId: request.id,
            approverDid: adminDid,
            comment: "不允许删除"
        )

        XCTAssertEqual(result.finalStatus, .rejected)
    }

    // MARK: - Multi-Step Approval Tests

    func testMultiStepApproval() async throws {
        let orgId = "test-org-\(UUID().uuidString)"
        let admin1Did = "did:test:admin1-\(UUID().uuidString)"
        let admin2Did = "did:test:admin2-\(UUID().uuidString)"
        let requesterDid = "did:test:requester-\(UUID().uuidString)"

        // 创建两步审批工作流
        let workflow = ApprovalWorkflow(
            orgId: orgId,
            name: "两步审批",
            triggerResourceType: "sensitive",
            triggerAction: "access",
            approvalType: .sequential,
            approvers: [[admin1Did], [admin2Did]]
        )
        _ = try await ApprovalWorkflowManager.shared.createWorkflow(workflow)

        let request = try await ApprovalWorkflowManager.shared.submitApproval(
            workflowId: workflow.id,
            requesterDid: requesterDid,
            requesterName: "测试用户",
            resourceType: "sensitive",
            action: "access"
        )

        // 第一步审批
        let result1 = try await ApprovalWorkflowManager.shared.approveRequest(
            requestId: request.id,
            approverDid: admin1Did
        )

        XCTAssertNil(result1.finalStatus)  // 还没完成
        XCTAssertEqual(result1.currentStep, 1)

        // 第二步审批
        let result2 = try await ApprovalWorkflowManager.shared.approveRequest(
            requestId: request.id,
            approverDid: admin2Did
        )

        XCTAssertEqual(result2.finalStatus, .approved)
    }

    // MARK: - Parallel Approval Tests

    func testParallelApproval() async throws {
        let orgId = "test-org-\(UUID().uuidString)"
        let admin1Did = "did:test:admin1-\(UUID().uuidString)"
        let admin2Did = "did:test:admin2-\(UUID().uuidString)"
        let requesterDid = "did:test:requester-\(UUID().uuidString)"

        // 创建并行审批工作流（需要所有人同意）
        let workflow = ApprovalWorkflow(
            orgId: orgId,
            name: "并行审批",
            triggerResourceType: "critical",
            triggerAction: "modify",
            approvalType: .parallel,
            approvers: [[admin1Did, admin2Did]]  // 一个步骤，两个审批人
        )
        _ = try await ApprovalWorkflowManager.shared.createWorkflow(workflow)

        let request = try await ApprovalWorkflowManager.shared.submitApproval(
            workflowId: workflow.id,
            requesterDid: requesterDid,
            requesterName: "测试用户",
            resourceType: "critical",
            action: "modify"
        )

        // 第一个人审批
        let result1 = try await ApprovalWorkflowManager.shared.approveRequest(
            requestId: request.id,
            approverDid: admin1Did
        )

        XCTAssertNil(result1.finalStatus)  // 还需要第二个人

        // 第二个人审批
        let result2 = try await ApprovalWorkflowManager.shared.approveRequest(
            requestId: request.id,
            approverDid: admin2Did
        )

        XCTAssertEqual(result2.finalStatus, .approved)
    }

    // MARK: - Any-One Approval Tests

    func testAnyOneApproval() async throws {
        let orgId = "test-org-\(UUID().uuidString)"
        let admin1Did = "did:test:admin1-\(UUID().uuidString)"
        let admin2Did = "did:test:admin2-\(UUID().uuidString)"
        let requesterDid = "did:test:requester-\(UUID().uuidString)"

        // 创建任一审批工作流
        let workflow = ApprovalWorkflow(
            orgId: orgId,
            name: "任一审批",
            triggerResourceType: "normal",
            triggerAction: "create",
            approvalType: .anyOne,
            approvers: [[admin1Did, admin2Did]]
        )
        _ = try await ApprovalWorkflowManager.shared.createWorkflow(workflow)

        let request = try await ApprovalWorkflowManager.shared.submitApproval(
            workflowId: workflow.id,
            requesterDid: requesterDid,
            requesterName: "测试用户",
            resourceType: "normal",
            action: "create"
        )

        // 任意一个人审批即可完成
        let result = try await ApprovalWorkflowManager.shared.approveRequest(
            requestId: request.id,
            approverDid: admin1Did
        )

        XCTAssertEqual(result.finalStatus, .approved)
    }

    // MARK: - Cancel Request Tests

    func testCancelRequest() async throws {
        let orgId = "test-org-\(UUID().uuidString)"
        let adminDid = "did:test:admin-\(UUID().uuidString)"
        let requesterDid = "did:test:requester-\(UUID().uuidString)"

        let workflow = ApprovalWorkflow(
            orgId: orgId,
            name: "取消测试",
            triggerResourceType: "test",
            triggerAction: "test",
            approvers: [[adminDid]]
        )
        _ = try await ApprovalWorkflowManager.shared.createWorkflow(workflow)

        let request = try await ApprovalWorkflowManager.shared.submitApproval(
            workflowId: workflow.id,
            requesterDid: requesterDid,
            requesterName: "测试用户",
            resourceType: "test",
            action: "test"
        )

        let cancelled = try await ApprovalWorkflowManager.shared.cancelRequest(
            requestId: request.id,
            cancellerDid: requesterDid
        )

        XCTAssertTrue(cancelled)
    }

    // MARK: - Get Pending Approvals Tests

    func testGetPendingApprovals() async throws {
        let orgId = "test-org-\(UUID().uuidString)"
        let adminDid = "did:test:admin-\(UUID().uuidString)"
        let requesterDid = "did:test:requester-\(UUID().uuidString)"

        let workflow = ApprovalWorkflow(
            orgId: orgId,
            name: "待审批列表测试",
            triggerResourceType: "knowledge",
            triggerAction: "delete",
            approvers: [[adminDid]]
        )
        _ = try await ApprovalWorkflowManager.shared.createWorkflow(workflow)

        // 创建多个审批请求
        for i in 1...3 {
            _ = try await ApprovalWorkflowManager.shared.submitApproval(
                workflowId: workflow.id,
                requesterDid: requesterDid,
                requesterName: "测试用户",
                resourceType: "knowledge",
                resourceId: "doc-\(i)",
                action: "delete"
            )
        }

        let pending = try await ApprovalWorkflowManager.shared.getPendingApprovals(
            approverDid: adminDid,
            orgId: orgId
        )

        XCTAssertEqual(pending.count, 3)
    }

    // MARK: - Approval History Tests

    func testGetApprovalHistory() async throws {
        let orgId = "test-org-\(UUID().uuidString)"
        let adminDid = "did:test:admin-\(UUID().uuidString)"
        let requesterDid = "did:test:requester-\(UUID().uuidString)"

        let workflow = ApprovalWorkflow(
            orgId: orgId,
            name: "历史测试",
            triggerResourceType: "project",
            triggerAction: "delete",
            approvers: [[adminDid]]
        )
        _ = try await ApprovalWorkflowManager.shared.createWorkflow(workflow)

        // 创建并完成请求
        let request = try await ApprovalWorkflowManager.shared.submitApproval(
            workflowId: workflow.id,
            requesterDid: requesterDid,
            requesterName: "测试用户",
            resourceType: "project",
            action: "delete"
        )

        _ = try await ApprovalWorkflowManager.shared.approveRequest(
            requestId: request.id,
            approverDid: adminDid
        )

        let history = try await ApprovalWorkflowManager.shared.getApprovalHistory(
            orgId: orgId,
            status: .approved
        )

        XCTAssertGreaterThanOrEqual(history.count, 1)
        XCTAssertTrue(history.contains { $0.id == request.id })
    }

    // MARK: - Approval Type Tests

    func testApprovalTypes() {
        XCTAssertEqual(ApprovalType.sequential.rawValue, "sequential")
        XCTAssertEqual(ApprovalType.parallel.rawValue, "parallel")
        XCTAssertEqual(ApprovalType.anyOne.rawValue, "anyOne")
    }

    func testTimeoutActions() {
        XCTAssertEqual(TimeoutAction.approve.rawValue, "approve")
        XCTAssertEqual(TimeoutAction.reject.rawValue, "reject")
        XCTAssertEqual(TimeoutAction.expire.rawValue, "expire")
    }

    // MARK: - Authorization Tests

    func testUnauthorizedApprover() async throws {
        let orgId = "test-org-\(UUID().uuidString)"
        let adminDid = "did:test:admin-\(UUID().uuidString)"
        let unauthorizedDid = "did:test:unauthorized-\(UUID().uuidString)"
        let requesterDid = "did:test:requester-\(UUID().uuidString)"

        let workflow = ApprovalWorkflow(
            orgId: orgId,
            name: "权限测试",
            triggerResourceType: "test",
            triggerAction: "test",
            approvers: [[adminDid]]
        )
        _ = try await ApprovalWorkflowManager.shared.createWorkflow(workflow)

        let request = try await ApprovalWorkflowManager.shared.submitApproval(
            workflowId: workflow.id,
            requesterDid: requesterDid,
            requesterName: "测试用户",
            resourceType: "test",
            action: "test"
        )

        // 未授权的用户尝试审批
        do {
            _ = try await ApprovalWorkflowManager.shared.approveRequest(
                requestId: request.id,
                approverDid: unauthorizedDid
            )
            XCTFail("应该抛出未授权错误")
        } catch let error as ApprovalWorkflowError {
            XCTAssertEqual(error.localizedDescription, "没有审批权限")
        }
    }
}

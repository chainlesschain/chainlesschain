/**
 * Approval Workflow Manager
 *
 * Manages approval workflows for permission requests and other actions.
 *
 * Features:
 * - Sequential/parallel/any-one approval flows
 * - Multi-step approvals
 * - Timeout handling
 * - Approval delegation
 *
 * @module permission/approval-workflow-manager
 */

const { logger } = require("../utils/logger.js");
const { v4: uuidv4 } = require("uuid");
const EventEmitter = require("events");

class ApprovalWorkflowManager extends EventEmitter {
  constructor(database) {
    super();
    this.database = database;
    this.timeoutTimers = new Map();
  }

  // ========================================
  // Workflow CRUD
  // ========================================

  /**
   * Create an approval workflow
   */
  async createWorkflow(workflowData) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();
      const workflowId = uuidv4();

      db.prepare(
        `
        INSERT INTO approval_workflows (
          id, org_id, name, description, trigger_resource_type, trigger_action,
          trigger_conditions, approval_type, approvers, timeout_hours, on_timeout,
          enabled, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      ).run(
        workflowId,
        workflowData.orgId,
        workflowData.name,
        workflowData.description,
        workflowData.triggerResourceType,
        workflowData.triggerAction,
        workflowData.triggerConditions
          ? JSON.stringify(workflowData.triggerConditions)
          : null,
        workflowData.approvalType || "sequential",
        JSON.stringify(workflowData.approvers),
        workflowData.timeoutHours || 72,
        workflowData.onTimeout || "reject",
        workflowData.enabled !== false ? 1 : 0,
        now,
        now,
      );

      logger.info(`[ApprovalWorkflow] Created workflow ${workflowId}`);

      return { success: true, workflowId };
    } catch (error) {
      logger.error("[ApprovalWorkflow] Error creating workflow:", error);
      throw error;
    }
  }

  /**
   * Update an approval workflow
   */
  async updateWorkflow(workflowId, updates) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();

      const allowedFields = [
        "name",
        "description",
        "trigger_conditions",
        "approval_type",
        "approvers",
        "timeout_hours",
        "on_timeout",
        "enabled",
      ];
      const updateParts = [];
      const values = [];

      for (const [key, value] of Object.entries(updates)) {
        const dbKey = key.replace(/([A-Z])/g, "_$1").toLowerCase();
        if (allowedFields.includes(dbKey)) {
          updateParts.push(`${dbKey} = ?`);
          values.push(
            ["approvers", "triggerConditions"].includes(key)
              ? JSON.stringify(value)
              : value,
          );
        }
      }

      if (updateParts.length === 0) {
        return { success: true };
      }

      updateParts.push("updated_at = ?");
      values.push(now);
      values.push(workflowId);

      db.prepare(
        `
        UPDATE approval_workflows SET ${updateParts.join(", ")} WHERE id = ?
      `,
      ).run(...values);

      return { success: true };
    } catch (error) {
      logger.error("[ApprovalWorkflow] Error updating workflow:", error);
      throw error;
    }
  }

  /**
   * Delete an approval workflow
   */
  async deleteWorkflow(workflowId) {
    try {
      const db = this.database.getDatabase();

      // Check for pending requests
      const pendingCount = db
        .prepare(
          `
        SELECT COUNT(*) as count FROM approval_requests
        WHERE workflow_id = ? AND status = 'pending'
      `,
        )
        .get(workflowId);

      if (pendingCount?.count > 0) {
        return {
          success: false,
          error: "HAS_PENDING_REQUESTS",
          message: `Workflow has ${pendingCount.count} pending requests`,
        };
      }

      db.prepare(`DELETE FROM approval_workflows WHERE id = ?`).run(workflowId);

      logger.info(`[ApprovalWorkflow] Deleted workflow ${workflowId}`);

      return { success: true };
    } catch (error) {
      logger.error("[ApprovalWorkflow] Error deleting workflow:", error);
      throw error;
    }
  }

  // ========================================
  // Approval Request Operations
  // ========================================

  /**
   * Submit an approval request
   */
  async submitApproval(requestData) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();
      const requestId = uuidv4();

      // Get the workflow
      const workflow = db
        .prepare(
          `
        SELECT * FROM approval_workflows WHERE id = ? AND enabled = 1
      `,
        )
        .get(requestData.workflowId);

      if (!workflow) {
        return { success: false, error: "WORKFLOW_NOT_FOUND" };
      }

      const approvers = JSON.parse(workflow.approvers);
      const totalSteps = approvers.length;

      db.prepare(
        `
        INSERT INTO approval_requests (
          id, workflow_id, org_id, requester_did, requester_name,
          resource_type, resource_id, action, request_data,
          status, current_step, total_steps, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)
      `,
      ).run(
        requestId,
        requestData.workflowId,
        workflow.org_id,
        requestData.requesterDid,
        requestData.requesterName,
        requestData.resourceType,
        requestData.resourceId,
        requestData.action,
        requestData.requestData
          ? JSON.stringify(requestData.requestData)
          : null,
        totalSteps,
        now,
        now,
      );

      // Set timeout timer
      const timeoutMs = workflow.timeout_hours * 60 * 60 * 1000;
      const timer = setTimeout(() => {
        this._handleTimeout(requestId, workflow.on_timeout);
      }, timeoutMs);
      this.timeoutTimers.set(requestId, timer);

      // Emit event for notification
      this.emit("approval-requested", {
        requestId,
        workflow,
        requesterDid: requestData.requesterDid,
        nextApprovers: approvers[0],
      });

      logger.info(`[ApprovalWorkflow] Created approval request ${requestId}`);

      return { success: true, requestId };
    } catch (error) {
      logger.error("[ApprovalWorkflow] Error submitting approval:", error);
      throw error;
    }
  }

  /**
   * Approve a request
   */
  async approveRequest(requestId, approverDid, comment = null) {
    return this._processDecision(requestId, approverDid, "approve", comment);
  }

  /**
   * Reject a request
   */
  async rejectRequest(requestId, approverDid, comment = null) {
    return this._processDecision(requestId, approverDid, "reject", comment);
  }

  /**
   * Process approval decision
   */
  async _processDecision(requestId, approverDid, decision, comment) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();

      const request = db
        .prepare(
          `
        SELECT ar.*, aw.approval_type, aw.approvers
        FROM approval_requests ar
        INNER JOIN approval_workflows aw ON aw.id = ar.workflow_id
        WHERE ar.id = ? AND ar.status = 'pending'
      `,
        )
        .get(requestId);

      if (!request) {
        return { success: false, error: "REQUEST_NOT_FOUND" };
      }

      const approvers = JSON.parse(request.approvers);
      const currentStepApprovers = approvers[request.current_step];

      // Verify approver is authorized
      if (!this._isAuthorizedApprover(approverDid, currentStepApprovers)) {
        return { success: false, error: "NOT_AUTHORIZED" };
      }

      // Record the response
      const responseId = uuidv4();
      db.prepare(
        `
        INSERT INTO approval_responses (
          id, request_id, approver_did, step, decision, comment, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      ).run(
        responseId,
        requestId,
        approverDid,
        request.current_step,
        decision,
        comment,
        now,
      );

      // Determine next action based on approval type
      if (decision === "reject") {
        // Rejection always ends the process
        db.prepare(
          `
          UPDATE approval_requests
          SET status = 'rejected', updated_at = ?, completed_at = ?
          WHERE id = ?
        `,
        ).run(now, now, requestId);

        this._clearTimeout(requestId);

        this.emit("approval-rejected", { requestId, approverDid });

        return { success: true, finalStatus: "rejected" };
      }

      // Handle approval
      let shouldAdvance = false;
      let isComplete = false;

      if (request.approval_type === "any_one") {
        // Any one approval is enough
        shouldAdvance = true;
        isComplete = request.current_step >= request.total_steps - 1;
      } else if (request.approval_type === "parallel") {
        // Check if all approvers in current step have approved
        const responses = db
          .prepare(
            `
          SELECT COUNT(DISTINCT approver_did) as count
          FROM approval_responses
          WHERE request_id = ? AND step = ? AND decision = 'approve'
        `,
          )
          .get(requestId, request.current_step);

        if (responses.count >= this._getApproverCount(currentStepApprovers)) {
          shouldAdvance = true;
          isComplete = request.current_step >= request.total_steps - 1;
        }
      } else {
        // Sequential - move to next step
        shouldAdvance = true;
        isComplete = request.current_step >= request.total_steps - 1;
      }

      if (isComplete) {
        db.prepare(
          `
          UPDATE approval_requests
          SET status = 'approved', updated_at = ?, completed_at = ?
          WHERE id = ?
        `,
        ).run(now, now, requestId);

        this._clearTimeout(requestId);

        this.emit("approval-approved", { requestId, approverDid });

        return { success: true, finalStatus: "approved" };
      }

      if (shouldAdvance) {
        db.prepare(
          `
          UPDATE approval_requests
          SET current_step = current_step + 1, updated_at = ?
          WHERE id = ?
        `,
        ).run(now, requestId);

        // Notify next approvers
        const nextApprovers = approvers[request.current_step + 1];
        this.emit("approval-next-step", {
          requestId,
          step: request.current_step + 1,
          nextApprovers,
        });
      }

      return {
        success: true,
        currentStep: request.current_step + (shouldAdvance ? 1 : 0),
      };
    } catch (error) {
      logger.error("[ApprovalWorkflow] Error processing decision:", error);
      throw error;
    }
  }

  /**
   * Get pending approvals for a user
   */
  async getPendingApprovals(approverDid, orgId) {
    try {
      const db = this.database.getDatabase();

      // This is a simplified query - in production you'd want to check
      // if the user is an authorized approver for the current step
      const requests = db
        .prepare(
          `
        SELECT ar.*, aw.name as workflow_name, aw.approvers
        FROM approval_requests ar
        INNER JOIN approval_workflows aw ON aw.id = ar.workflow_id
        WHERE ar.org_id = ? AND ar.status = 'pending'
        ORDER BY ar.created_at DESC
      `,
        )
        .all(orgId);

      // Filter to only show requests where user can approve
      const pendingForUser = requests.filter((r) => {
        const approvers = JSON.parse(r.approvers);
        const currentApprovers = approvers[r.current_step];
        return this._isAuthorizedApprover(approverDid, currentApprovers);
      });

      return {
        success: true,
        requests: pendingForUser.map((r) => ({
          id: r.id,
          workflowId: r.workflow_id,
          workflowName: r.workflow_name,
          requesterDid: r.requester_did,
          requesterName: r.requester_name,
          resourceType: r.resource_type,
          resourceId: r.resource_id,
          action: r.action,
          requestData: r.request_data ? JSON.parse(r.request_data) : null,
          currentStep: r.current_step,
          totalSteps: r.total_steps,
          createdAt: r.created_at,
        })),
      };
    } catch (error) {
      logger.error(
        "[ApprovalWorkflow] Error getting pending approvals:",
        error,
      );
      throw error;
    }
  }

  /**
   * Get approval history
   */
  async getApprovalHistory(orgId, options = {}) {
    try {
      const db = this.database.getDatabase();

      let query = `
        SELECT ar.*, aw.name as workflow_name
        FROM approval_requests ar
        INNER JOIN approval_workflows aw ON aw.id = ar.workflow_id
        WHERE ar.org_id = ?
      `;
      const params = [orgId];

      if (options.status) {
        query += ` AND ar.status = ?`;
        params.push(options.status);
      }

      if (options.requesterDid) {
        query += ` AND ar.requester_did = ?`;
        params.push(options.requesterDid);
      }

      query += ` ORDER BY ar.created_at DESC`;

      if (options.limit) {
        query += ` LIMIT ?`;
        params.push(options.limit);
      }

      const requests = db.prepare(query).all(...params);

      return {
        success: true,
        requests: requests.map((r) => ({
          id: r.id,
          workflowId: r.workflow_id,
          workflowName: r.workflow_name,
          requesterDid: r.requester_did,
          requesterName: r.requester_name,
          resourceType: r.resource_type,
          resourceId: r.resource_id,
          action: r.action,
          status: r.status,
          currentStep: r.current_step,
          totalSteps: r.total_steps,
          createdAt: r.created_at,
          completedAt: r.completed_at,
        })),
      };
    } catch (error) {
      logger.error("[ApprovalWorkflow] Error getting approval history:", error);
      throw error;
    }
  }

  // ========================================
  // Helper Methods
  // ========================================

  _isAuthorizedApprover(approverDid, stepApprovers) {
    if (!stepApprovers) {
      return false;
    }

    // stepApprovers can be a string (single DID), array of DIDs, or role-based
    if (typeof stepApprovers === "string") {
      return stepApprovers === approverDid;
    }

    if (Array.isArray(stepApprovers)) {
      return stepApprovers.includes(approverDid);
    }

    // Role-based check would go here
    return false;
  }

  _getApproverCount(stepApprovers) {
    if (typeof stepApprovers === "string") {
      return 1;
    }
    if (Array.isArray(stepApprovers)) {
      return stepApprovers.length;
    }
    return 1;
  }

  async _handleTimeout(requestId, action) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();

      let status = "expired";
      if (action === "approve") {
        status = "approved";
      } else if (action === "reject") {
        status = "rejected";
      }

      db.prepare(
        `
        UPDATE approval_requests
        SET status = ?, updated_at = ?, completed_at = ?
        WHERE id = ? AND status = 'pending'
      `,
      ).run(status, now, now, requestId);

      this.timeoutTimers.delete(requestId);

      this.emit("approval-timeout", { requestId, action: status });

      logger.info(
        `[ApprovalWorkflow] Request ${requestId} timed out with action: ${status}`,
      );
    } catch (error) {
      logger.error("[ApprovalWorkflow] Error handling timeout:", error);
    }
  }

  _clearTimeout(requestId) {
    const timer = this.timeoutTimers.get(requestId);
    if (timer) {
      clearTimeout(timer);
      this.timeoutTimers.delete(requestId);
    }
  }
}

let approvalWorkflowManager = null;

function getApprovalWorkflowManager(database) {
  if (!approvalWorkflowManager && database) {
    approvalWorkflowManager = new ApprovalWorkflowManager(database);
  }
  return approvalWorkflowManager;
}

module.exports = {
  ApprovalWorkflowManager,
  getApprovalWorkflowManager,
};

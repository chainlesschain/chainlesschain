/**
 * Plan Mode for CLI Agent REPL
 *
 * During plan mode, the AI can only use read-only tools (read_file, search_files, list_dir, list_skills).
 * Write/execute tools (write_file, edit_file, run_shell, run_skill) are blocked until the plan is approved.
 *
 * Lightweight port of desktop-app-vue/src/main/ai-engine/plan-mode/index.js
 */

import { EventEmitter } from "events";

/**
 * Plan item status
 */
export const PlanStatus = {
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
  EXECUTING: "executing",
  COMPLETED: "completed",
  FAILED: "failed",
};

/**
 * Plan mode states
 */
export const PlanState = {
  INACTIVE: "inactive",
  ANALYZING: "analyzing",
  PLAN_READY: "plan_ready",
  APPROVED: "approved",
  EXECUTING: "executing",
  COMPLETED: "completed",
  REJECTED: "rejected",
};

/**
 * Tool categories for permission control
 */
const READ_TOOLS = new Set([
  "read_file",
  "search_files",
  "list_dir",
  "list_skills",
]);

const WRITE_TOOLS = new Set([
  "write_file",
  "edit_file",
  "run_shell",
  "run_skill",
]);

/**
 * A single item in an execution plan
 */
export class PlanItem {
  constructor(data = {}) {
    this.id =
      data.id || `item-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    this.order = data.order || 0;
    this.title = data.title || "";
    this.description = data.description || "";
    this.tool = data.tool || null;
    this.params = data.params || {};
    this.dependencies = data.dependencies || [];
    this.estimatedImpact = data.estimatedImpact || "low"; // low, medium, high
    this.status = data.status || PlanStatus.PENDING;
    this.result = null;
    this.error = null;
  }
}

/**
 * An execution plan containing multiple items
 */
export class ExecutionPlan {
  constructor(data = {}) {
    this.id = data.id || `plan-${Date.now()}`;
    this.title = data.title || "Untitled Plan";
    this.description = data.description || "";
    this.goal = data.goal || "";
    this.items = (data.items || []).map((i) => new PlanItem(i));
    this.status = data.status || PlanState.ANALYZING;
    this.createdAt = new Date().toISOString();
  }

  addItem(item) {
    const planItem = item instanceof PlanItem ? item : new PlanItem(item);
    planItem.order = this.items.length;
    this.items.push(planItem);
    return planItem;
  }

  removeItem(itemId) {
    this.items = this.items.filter((i) => i.id !== itemId);
    this.items.forEach((item, idx) => {
      item.order = idx;
    });
  }

  getItem(itemId) {
    return this.items.find((i) => i.id === itemId);
  }
}

/**
 * Plan Mode Manager
 *
 * Controls the plan mode lifecycle in the agent REPL.
 */
export class PlanModeManager extends EventEmitter {
  constructor() {
    super();
    this.state = PlanState.INACTIVE;
    this.currentPlan = null;
    this.history = [];
    this.blockedToolLog = [];
  }

  /**
   * Check if plan mode is active
   */
  isActive() {
    return this.state !== PlanState.INACTIVE;
  }

  /**
   * Enter plan mode
   */
  enterPlanMode(options = {}) {
    if (this.isActive()) {
      return { error: "Already in plan mode" };
    }

    this.currentPlan = new ExecutionPlan({
      title: options.title || "New Plan",
      goal: options.goal || "",
    });
    this.state = PlanState.ANALYZING;
    this.blockedToolLog = [];

    this.emit("enter", { plan: this.currentPlan, state: this.state });
    return { plan: this.currentPlan };
  }

  /**
   * Exit plan mode
   */
  exitPlanMode(options = {}) {
    if (!this.isActive()) {
      return { error: "Not in plan mode" };
    }

    if (options.savePlan && this.currentPlan) {
      this.history.push(this.currentPlan);
    }

    const plan = this.currentPlan;
    this.state = PlanState.INACTIVE;
    this.currentPlan = null;
    this.blockedToolLog = [];

    this.emit("exit", { plan, reason: options.reason || "manual" });
    return { plan };
  }

  /**
   * Add a plan item
   */
  addPlanItem(itemData) {
    if (!this.currentPlan) {
      return { error: "No active plan" };
    }

    const item = this.currentPlan.addItem(itemData);
    this.emit("item-added", { planId: this.currentPlan.id, item });
    return { item };
  }

  /**
   * Mark the plan as ready for approval
   */
  markPlanReady() {
    if (this.state !== PlanState.ANALYZING) {
      return { error: "Plan is not in analyzing state" };
    }

    this.state = PlanState.PLAN_READY;
    this.currentPlan.status = PlanState.PLAN_READY;
    this.emit("plan-ready", { plan: this.currentPlan });
    return { plan: this.currentPlan };
  }

  /**
   * Approve the plan (or specific items)
   */
  approvePlan(options = {}) {
    if (
      this.state !== PlanState.PLAN_READY &&
      this.state !== PlanState.ANALYZING
    ) {
      return { error: "Plan is not ready for approval" };
    }

    const approvedItems = options.itemIds
      ? this.currentPlan.items.filter((i) => options.itemIds.includes(i.id))
      : this.currentPlan.items;

    for (const item of approvedItems) {
      item.status = PlanStatus.APPROVED;
    }

    this.state = PlanState.APPROVED;
    this.currentPlan.status = PlanState.APPROVED;
    this.emit("plan-approved", {
      plan: this.currentPlan,
      approvedCount: approvedItems.length,
    });
    return { plan: this.currentPlan, approvedCount: approvedItems.length };
  }

  /**
   * Reject the plan
   */
  rejectPlan(reason = "") {
    if (!this.isActive()) {
      return { error: "No active plan" };
    }

    for (const item of this.currentPlan.items) {
      item.status = PlanStatus.REJECTED;
    }

    this.state = PlanState.REJECTED;
    return this.exitPlanMode({ savePlan: true, reason: reason || "rejected" });
  }

  /**
   * Check if a tool is allowed in current state
   */
  isToolAllowed(toolName) {
    if (!this.isActive()) return true;
    if (
      this.state === PlanState.APPROVED ||
      this.state === PlanState.EXECUTING
    ) {
      return true;
    }

    // In analyzing/plan_ready state, only read tools are allowed
    if (READ_TOOLS.has(toolName)) return true;

    // Block write tools and log
    if (WRITE_TOOLS.has(toolName)) {
      this.blockedToolLog.push({
        tool: toolName,
        timestamp: new Date().toISOString(),
      });
      this.emit("tool-blocked", { toolName });
      return false;
    }

    // Unknown tools are blocked by default in plan mode
    return false;
  }

  /**
   * Generate a text summary of the current plan
   */
  generatePlanSummary() {
    if (!this.currentPlan) return "No active plan.";

    const plan = this.currentPlan;
    const lines = [
      `## Plan: ${plan.title}`,
      plan.goal ? `**Goal**: ${plan.goal}` : "",
      `**Status**: ${this.state}`,
      `**Items**: ${plan.items.length}`,
      "",
    ];

    for (const item of plan.items) {
      const icon =
        item.status === PlanStatus.COMPLETED
          ? "✅"
          : item.status === PlanStatus.FAILED
            ? "❌"
            : item.status === PlanStatus.APPROVED
              ? "✓"
              : "○";
      lines.push(
        `${icon} ${item.order + 1}. ${item.title} [${item.estimatedImpact}]`,
      );
      if (item.description) {
        lines.push(`   ${item.description}`);
      }
    }

    if (this.blockedToolLog.length > 0) {
      lines.push("");
      lines.push(
        `**Blocked tools**: ${this.blockedToolLog.map((b) => b.tool).join(", ")}`,
      );
    }

    return lines.filter(Boolean).join("\n");
  }

  /**
   * Get plans history
   */
  getHistory() {
    return this.history;
  }
}

// Singleton
let _instance = null;

export function getPlanModeManager() {
  if (!_instance) {
    _instance = new PlanModeManager();
  }
  return _instance;
}

export function destroyPlanModeManager() {
  if (_instance) {
    _instance.removeAllListeners();
    _instance = null;
  }
}

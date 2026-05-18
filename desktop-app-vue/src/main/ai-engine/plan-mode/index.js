/**
 * Plan Mode - 计划模式系统
 *
 * 提供安全的分析/规划阶段，不执行实际修改操作
 *
 * 功能：
 * - 进入/退出计划模式
 * - 工具权限控制（只允许读取操作）
 * - 计划生成和存储
 * - 用户审批流程
 * - 与 Hooks 系统集成
 *
 * @module plan-mode
 * @version 1.0.0
 */

const { EventEmitter } = require("events");
const { logger } = require("../../utils/logger");

// 计划模式状态
const PlanModeState = {
  INACTIVE: "inactive", // 非计划模式
  ANALYZING: "analyzing", // 分析中
  PLAN_READY: "plan_ready", // 计划就绪，等待审批
  APPROVED: "approved", // 已审批，准备执行
  EXECUTING: "executing", // 执行中
  COMPLETED: "completed", // 完成
  REJECTED: "rejected", // 被拒绝
};

// 工具分类
const ToolCategory = {
  READ: "read", // 只读操作
  WRITE: "write", // 写入操作
  EXECUTE: "execute", // 执行操作
  DELETE: "delete", // 删除操作
  SEARCH: "search", // 搜索操作
  ANALYZE: "analyze", // 分析操作
};

// 工具权限映射
const TOOL_PERMISSIONS = {
  // 只读工具 - 计划模式允许
  file_reader: ToolCategory.READ,
  Read: ToolCategory.READ,
  Glob: ToolCategory.SEARCH,
  Grep: ToolCategory.SEARCH,
  search: ToolCategory.SEARCH,
  list_files: ToolCategory.SEARCH,
  get_project_structure: ToolCategory.READ,
  analyze_code: ToolCategory.ANALYZE,
  explain_code: ToolCategory.ANALYZE,
  get_context: ToolCategory.READ,
  WebFetch: ToolCategory.READ,
  WebSearch: ToolCategory.SEARCH,

  // 写入工具 - 计划模式禁止
  file_writer: ToolCategory.WRITE,
  Write: ToolCategory.WRITE,
  Edit: ToolCategory.WRITE,
  create_file: ToolCategory.WRITE,
  update_file: ToolCategory.WRITE,
  NotebookEdit: ToolCategory.WRITE,

  // 执行工具 - 计划模式禁止
  Bash: ToolCategory.EXECUTE,
  execute_command: ToolCategory.EXECUTE,
  run_script: ToolCategory.EXECUTE,
  git_commit: ToolCategory.EXECUTE,
  deploy: ToolCategory.EXECUTE,

  // 删除工具 - 计划模式禁止
  delete_file: ToolCategory.DELETE,
  remove_directory: ToolCategory.DELETE,
};

// 计划模式允许的操作类别
const ALLOWED_IN_PLAN_MODE = new Set([
  ToolCategory.READ,
  ToolCategory.SEARCH,
  ToolCategory.ANALYZE,
]);

/**
 * 计划项
 */
class PlanItem {
  constructor(options) {
    this.id =
      options.id ||
      `step_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.order = options.order || 0;
    this.title = options.title || "";
    this.description = options.description || "";
    this.tool = options.tool || null;
    this.params = options.params || {};
    this.dependencies = options.dependencies || [];
    this.estimatedImpact = options.estimatedImpact || "low"; // low, medium, high
    this.status = "pending"; // pending, approved, rejected, executing, completed, failed
    this.result = null;
    this.error = null;
    this.createdAt = Date.now();
    this.updatedAt = Date.now();
  }

  toJSON() {
    return {
      id: this.id,
      order: this.order,
      title: this.title,
      description: this.description,
      tool: this.tool,
      params: this.params,
      dependencies: this.dependencies,
      estimatedImpact: this.estimatedImpact,
      status: this.status,
      result: this.result,
      error: this.error,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}

/**
 * 执行计划
 */
class ExecutionPlan {
  constructor(options = {}) {
    this.id =
      options.id ||
      `plan_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.title = options.title || "Untitled Plan";
    this.description = options.description || "";
    this.goal = options.goal || "";
    this.items = [];
    this.status = PlanModeState.ANALYZING;
    this.createdAt = Date.now();
    this.updatedAt = Date.now();
    this.approvedAt = null;
    this.approvedBy = null;
    this.completedAt = null;
    this.metadata = options.metadata || {};
  }

  addItem(item) {
    const planItem = item instanceof PlanItem ? item : new PlanItem(item);
    planItem.order = this.items.length;
    this.items.push(planItem);
    this.updatedAt = Date.now();
    return planItem;
  }

  removeItem(itemId) {
    const index = this.items.findIndex((item) => item.id === itemId);
    if (index !== -1) {
      this.items.splice(index, 1);
      // 重新排序
      this.items.forEach((item, i) => {
        item.order = i;
      });
      this.updatedAt = Date.now();
      return true;
    }
    return false;
  }

  reorderItems(itemIds) {
    const newItems = [];
    for (const id of itemIds) {
      const item = this.items.find((i) => i.id === id);
      if (item) {
        item.order = newItems.length;
        newItems.push(item);
      }
    }
    this.items = newItems;
    this.updatedAt = Date.now();
  }

  getItem(itemId) {
    return this.items.find((item) => item.id === itemId);
  }

  approve(approvedBy = "user") {
    this.status = PlanModeState.APPROVED;
    this.approvedAt = Date.now();
    this.approvedBy = approvedBy;
    this.updatedAt = Date.now();
    this.items.forEach((item) => {
      item.status = "approved";
      item.updatedAt = Date.now();
    });
  }

  reject(reason = "") {
    this.status = PlanModeState.REJECTED;
    this.updatedAt = Date.now();
    this.metadata.rejectionReason = reason;
  }

  toJSON() {
    return {
      id: this.id,
      title: this.title,
      description: this.description,
      goal: this.goal,
      items: this.items.map((item) => item.toJSON()),
      status: this.status,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      approvedAt: this.approvedAt,
      approvedBy: this.approvedBy,
      completedAt: this.completedAt,
      metadata: this.metadata,
    };
  }
}

/**
 * Plan Mode Manager - 计划模式管理器
 */
class PlanModeManager extends EventEmitter {
  constructor(options = {}) {
    super();

    this.options = {
      autoSavePlans: options.autoSavePlans !== false,
      maxPlansHistory: options.maxPlansHistory || 50,
      planTimeout: options.planTimeout || 30 * 60 * 1000, // 30分钟
      ...options,
    };

    // 当前状态
    this.state = PlanModeState.INACTIVE;
    this.currentPlan = null;
    this.plansHistory = [];

    // Hooks 系统集成
    this.hookSystem = null;
    this.hookId = null;

    // 统计
    this.stats = {
      plansCreated: 0,
      plansApproved: 0,
      plansRejected: 0,
      plansCompleted: 0,
      toolsBlocked: 0,
      toolsAllowed: 0,
    };

    logger.info("[PlanMode] Manager initialized");
  }

  /**
   * 设置 Hooks 系统
   * @param {Object} hookSystem - Hooks 系统实例
   */
  setHookSystem(hookSystem) {
    this.hookSystem = hookSystem;

    if (hookSystem) {
      // 注册计划模式钩子
      this._registerPlanModeHook();
    }
  }

  /**
   * 注册计划模式钩子
   * @private
   */
  _registerPlanModeHook() {
    if (!this.hookSystem) {
      return;
    }

    const { HookPriority, HookResult } = require("../../hooks");

    this.hookId = this.hookSystem.register({
      event: "PreToolUse",
      name: "plan-mode:tool-guard",
      priority: HookPriority.SYSTEM,
      description: "Guard tool execution in plan mode",
      handler: async ({ data, context }) => {
        // 如果不在计划模式，允许所有操作
        if (!this.isActive()) {
          return { result: HookResult.CONTINUE };
        }

        const toolName = data.toolName;
        const category = this.getToolCategory(toolName);
        const allowed = this.isToolAllowedInPlanMode(toolName);

        if (!allowed) {
          this.stats.toolsBlocked++;

          // 记录被阻止的操作到当前计划
          if (this.currentPlan) {
            this.currentPlan.addItem({
              title: `${toolName} (blocked)`,
              description: `Tool "${toolName}" was blocked in plan mode. Category: ${category}`,
              tool: toolName,
              params: data.params || {},
              estimatedImpact: this._estimateImpact(category),
            });
          }

          this.emit("tool-blocked", {
            toolName,
            category,
            params: data.params,
            reason: `Tool "${toolName}" (${category}) is not allowed in plan mode`,
          });

          return {
            result: HookResult.PREVENT,
            reason: `[Plan Mode] Tool "${toolName}" (${category}) is not allowed. Exit plan mode to execute.`,
          };
        }

        this.stats.toolsAllowed++;
        return { result: HookResult.CONTINUE };
      },
    });

    logger.info("[PlanMode] Tool guard hook registered");
  }

  /**
   * 进入计划模式
   * @param {Object} options - 选项
   * @returns {ExecutionPlan} 新创建的计划
   */
  enterPlanMode(options = {}) {
    if (this.isActive()) {
      logger.warn("[PlanMode] Already in plan mode");
      return this.currentPlan;
    }

    this.state = PlanModeState.ANALYZING;
    this.currentPlan = new ExecutionPlan({
      title: options.title || "New Plan",
      description: options.description || "",
      goal: options.goal || "",
      metadata: options.metadata || {},
    });

    this.stats.plansCreated++;

    this.emit("enter", {
      plan: this.currentPlan.toJSON(),
      state: this.state,
    });

    logger.info(`[PlanMode] Entered plan mode: ${this.currentPlan.id}`);
    return this.currentPlan;
  }

  /**
   * 退出计划模式
   * @param {Object} options - 选项
   * @returns {Object} 退出结果
   */
  exitPlanMode(options = {}) {
    const { savePlan = true, reason = "" } = options;

    if (!this.isActive()) {
      logger.warn("[PlanMode] Not in plan mode");
      return { success: false, reason: "Not in plan mode" };
    }

    const plan = this.currentPlan;

    // 保存计划到历史
    if (savePlan && plan) {
      this.plansHistory.unshift(plan.toJSON());
      if (this.plansHistory.length > this.options.maxPlansHistory) {
        this.plansHistory = this.plansHistory.slice(
          0,
          this.options.maxPlansHistory,
        );
      }
    }

    this.state = PlanModeState.INACTIVE;
    this.currentPlan = null;

    this.emit("exit", {
      plan: plan ? plan.toJSON() : null,
      reason,
    });

    logger.info(`[PlanMode] Exited plan mode: ${plan ? plan.id : "no plan"}`);

    return {
      success: true,
      plan: plan ? plan.toJSON() : null,
    };
  }

  /**
   * 检查是否处于计划模式
   * @returns {boolean}
   */
  isActive() {
    return this.state !== PlanModeState.INACTIVE;
  }

  /**
   * 获取当前状态
   * @returns {string}
   */
  getState() {
    return this.state;
  }

  /**
   * 获取当前计划
   * @returns {ExecutionPlan|null}
   */
  getCurrentPlan() {
    return this.currentPlan;
  }

  /**
   * 添加计划项
   * @param {Object} item - 计划项配置
   * @returns {PlanItem|null}
   */
  addPlanItem(item) {
    if (!this.currentPlan) {
      logger.warn("[PlanMode] No active plan");
      return null;
    }

    const planItem = this.currentPlan.addItem(item);

    this.emit("item-added", {
      planId: this.currentPlan.id,
      item: planItem.toJSON(),
    });

    return planItem;
  }

  /**
   * 移除计划项
   * @param {string} itemId - 计划项ID
   * @returns {boolean}
   */
  removePlanItem(itemId) {
    if (!this.currentPlan) {
      return false;
    }

    const removed = this.currentPlan.removeItem(itemId);

    if (removed) {
      this.emit("item-removed", {
        planId: this.currentPlan.id,
        itemId,
      });
    }

    return removed;
  }

  /**
   * 标记计划就绪（等待审批）
   * @param {Object} options - 选项
   * @returns {Object} 结果
   */
  markPlanReady(options = {}) {
    if (!this.currentPlan) {
      return { success: false, reason: "No active plan" };
    }

    if (this.currentPlan.items.length === 0) {
      return { success: false, reason: "Plan has no items" };
    }

    this.state = PlanModeState.PLAN_READY;
    this.currentPlan.status = PlanModeState.PLAN_READY;
    this.currentPlan.updatedAt = Date.now();

    this.emit("plan-ready", {
      plan: this.currentPlan.toJSON(),
    });

    logger.info(`[PlanMode] Plan ready for review: ${this.currentPlan.id}`);

    return {
      success: true,
      plan: this.currentPlan.toJSON(),
    };
  }

  /**
   * 审批计划
   * @param {Object} options - 选项
   * @returns {Object} 结果
   */
  approvePlan(options = {}) {
    const { approvedBy = "user", itemIds = null } = options;

    if (!this.currentPlan) {
      return { success: false, reason: "No active plan" };
    }

    if (this.state !== PlanModeState.PLAN_READY) {
      return { success: false, reason: "Plan is not ready for approval" };
    }

    // 部分审批
    if (itemIds && Array.isArray(itemIds)) {
      this.currentPlan.items.forEach((item) => {
        if (itemIds.includes(item.id)) {
          item.status = "approved";
        } else {
          item.status = "rejected";
        }
        item.updatedAt = Date.now();
      });
    } else {
      // 全部审批
      this.currentPlan.approve(approvedBy);
    }

    this.state = PlanModeState.APPROVED;
    this.stats.plansApproved++;

    this.emit("plan-approved", {
      plan: this.currentPlan.toJSON(),
      approvedBy,
      partialApproval: !!itemIds,
    });

    logger.info(`[PlanMode] Plan approved: ${this.currentPlan.id}`);

    return {
      success: true,
      plan: this.currentPlan.toJSON(),
    };
  }

  /**
   * 拒绝计划
   * @param {Object} options - 选项
   * @returns {Object} 结果
   */
  rejectPlan(options = {}) {
    const { reason = "" } = options;

    if (!this.currentPlan) {
      return { success: false, reason: "No active plan" };
    }

    this.currentPlan.reject(reason);
    this.state = PlanModeState.REJECTED;
    this.stats.plansRejected++;

    this.emit("plan-rejected", {
      plan: this.currentPlan.toJSON(),
      reason,
    });

    logger.info(`[PlanMode] Plan rejected: ${this.currentPlan.id}`);

    // 退出计划模式
    return this.exitPlanMode({ reason: `Plan rejected: ${reason}` });
  }

  /**
   * 执行已审批的计划
   * @param {Object} executor - 执行器（如 FunctionCaller）
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 执行结果
   */
  async executePlan(executor, options = {}) {
    if (!this.currentPlan) {
      return { success: false, reason: "No active plan" };
    }

    if (this.state !== PlanModeState.APPROVED) {
      return { success: false, reason: "Plan is not approved" };
    }

    this.state = PlanModeState.EXECUTING;
    this.currentPlan.status = PlanModeState.EXECUTING;

    const results = [];
    const approvedItems = this.currentPlan.items.filter(
      (item) => item.status === "approved",
    );

    this.emit("execution-start", {
      plan: this.currentPlan.toJSON(),
      totalItems: approvedItems.length,
    });

    // 临时退出计划模式以允许执行
    const wasActive = this.isActive();
    this.state = PlanModeState.EXECUTING;

    try {
      for (const item of approvedItems) {
        item.status = "executing";
        item.updatedAt = Date.now();

        this.emit("item-executing", {
          planId: this.currentPlan.id,
          item: item.toJSON(),
        });

        try {
          // 执行工具
          if (executor && item.tool) {
            const result = await executor.callTool(item.tool, item.params);
            item.result = result;
            item.status = "completed";
          } else {
            item.status = "completed";
            item.result = { message: "No executor or tool specified" };
          }
        } catch (error) {
          item.status = "failed";
          item.error = error.message;
          logger.error(`[PlanMode] Item execution failed: ${item.id}`, error);

          if (options.stopOnError) {
            break;
          }
        }

        item.updatedAt = Date.now();
        results.push(item.toJSON());

        this.emit("item-completed", {
          planId: this.currentPlan.id,
          item: item.toJSON(),
        });
      }

      this.state = PlanModeState.COMPLETED;
      this.currentPlan.status = PlanModeState.COMPLETED;
      this.currentPlan.completedAt = Date.now();
      this.stats.plansCompleted++;

      this.emit("execution-complete", {
        plan: this.currentPlan.toJSON(),
        results,
      });

      logger.info(
        `[PlanMode] Plan execution completed: ${this.currentPlan.id}`,
      );

      // 退出计划模式
      this.exitPlanMode({ reason: "Plan execution completed" });

      return {
        success: true,
        plan: this.currentPlan ? this.currentPlan.toJSON() : null,
        results,
      };
    } catch (error) {
      logger.error("[PlanMode] Plan execution error:", error);
      this.state = wasActive ? PlanModeState.APPROVED : PlanModeState.INACTIVE;
      return {
        success: false,
        reason: error.message,
        results,
      };
    }
  }

  /**
   * 获取工具类别
   * @param {string} toolName - 工具名称
   * @returns {string}
   */
  getToolCategory(toolName) {
    return TOOL_PERMISSIONS[toolName] || ToolCategory.EXECUTE; // 默认为执行类
  }

  /**
   * 检查工具是否在计划模式中允许
   * @param {string} toolName - 工具名称
   * @returns {boolean}
   */
  isToolAllowedInPlanMode(toolName) {
    const category = this.getToolCategory(toolName);
    return ALLOWED_IN_PLAN_MODE.has(category);
  }

  /**
   * 估算影响级别
   * @private
   */
  _estimateImpact(category) {
    switch (category) {
      case ToolCategory.DELETE:
        return "high";
      case ToolCategory.WRITE:
      case ToolCategory.EXECUTE:
        return "medium";
      default:
        return "low";
    }
  }

  /**
   * 获取计划历史
   * @param {Object} options - 选项
   * @returns {Array}
   */
  getPlansHistory(options = {}) {
    const { limit = 10, offset = 0 } = options;
    return this.plansHistory.slice(offset, offset + limit);
  }

  /**
   * 获取指定计划
   * @param {string} planId - 计划ID
   * @returns {Object|null}
   */
  getPlan(planId) {
    if (this.currentPlan && this.currentPlan.id === planId) {
      return this.currentPlan.toJSON();
    }
    return this.plansHistory.find((p) => p.id === planId) || null;
  }

  /**
   * 获取统计信息
   * @returns {Object}
   */
  getStats() {
    return {
      ...this.stats,
      currentState: this.state,
      currentPlanId: this.currentPlan ? this.currentPlan.id : null,
      plansInHistory: this.plansHistory.length,
    };
  }

  /**
   * 生成计划摘要（供 AI 使用）
   * @returns {string}
   */
  generatePlanSummary() {
    if (!this.currentPlan) {
      return "No active plan.";
    }

    const plan = this.currentPlan;
    const lines = [
      `# Plan: ${plan.title}`,
      `ID: ${plan.id}`,
      `Status: ${plan.status}`,
      `Goal: ${plan.goal || "Not specified"}`,
      "",
      "## Steps:",
    ];

    plan.items.forEach((item, index) => {
      lines.push(`${index + 1}. [${item.status}] ${item.title}`);
      if (item.description) {
        lines.push(`   ${item.description}`);
      }
      if (item.tool) {
        lines.push(`   Tool: ${item.tool}`);
      }
      lines.push(`   Impact: ${item.estimatedImpact}`);
      lines.push("");
    });

    return lines.join("\n");
  }

  /**
   * 清理资源
   */
  destroy() {
    if (this.hookSystem && this.hookId) {
      this.hookSystem.unregister(this.hookId);
    }
    this.removeAllListeners();
    this.currentPlan = null;
    this.plansHistory = [];
    logger.info("[PlanMode] Manager destroyed");
  }
}

// 单例管理
let planModeInstance = null;

function getPlanModeManager(options) {
  if (!planModeInstance) {
    planModeInstance = new PlanModeManager(options);
  }
  return planModeInstance;
}

function destroyPlanModeManager() {
  if (planModeInstance) {
    planModeInstance.destroy();
    planModeInstance = null;
  }
}

module.exports = {
  PlanModeManager,
  PlanModeState,
  ToolCategory,
  PlanItem,
  ExecutionPlan,
  TOOL_PERMISSIONS,
  ALLOWED_IN_PLAN_MODE,
  getPlanModeManager,
  destroyPlanModeManager,
};

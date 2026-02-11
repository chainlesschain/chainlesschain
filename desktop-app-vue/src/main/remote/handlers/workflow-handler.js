/**
 * 工作流处理器
 *
 * 提供工作流相关的远程命令接口：
 * - workflow.create: 创建工作流
 * - workflow.execute: 执行工作流
 * - workflow.getStatus: 获取执行状态
 * - workflow.cancel: 取消执行
 * - workflow.list: 列出工作流
 * - workflow.get: 获取工作流定义
 * - workflow.delete: 删除工作流
 * - workflow.getHistory: 获取执行历史
 *
 * @module remote/handlers/workflow-handler
 */

const { logger } = require("../../utils/logger");
const {
  WorkflowEngine,
  WORKFLOW_STATUS,
} = require("../workflow/workflow-engine");
const crypto = require("crypto");

/**
 * 工作流处理器类
 */
class WorkflowHandler {
  constructor(database, commandExecutor, options = {}) {
    this.database = database;
    this.options = {
      maxWorkflows: options.maxWorkflows || 100,
      maxHistorySize: options.maxHistorySize || 500,
      defaultTimeout: options.defaultTimeout || 300000, // 5分钟
      ...options,
    };

    // 创建工作流引擎
    this.engine = new WorkflowEngine(commandExecutor, {
      maxSteps: options.maxSteps || 1000,
      stepTimeout: options.stepTimeout || 60000,
      enableRollback: options.enableRollback !== false,
    });

    // 设置引擎事件监听
    this.setupEngineEvents();

    // 事件发射器（由外部设置）
    this.eventEmitter = null;

    // 初始化数据库表
    this.ensureTables();

    logger.info("[WorkflowHandler] 工作流处理器已初始化");
  }

  /**
   * 确保数据库表存在
   */
  ensureTables() {
    if (!this.database) {
      logger.warn("[WorkflowHandler] 数据库未提供，工作流将只保存在内存中");
      this.workflows = new Map();
      return;
    }

    try {
      // 工作流定义表
      this.database.exec(`
        CREATE TABLE IF NOT EXISTS workflows (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          definition TEXT NOT NULL,
          tags TEXT,
          enabled INTEGER DEFAULT 1,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          created_by TEXT
        )
      `);

      // 执行历史表
      this.database.exec(`
        CREATE TABLE IF NOT EXISTS workflow_executions (
          id TEXT PRIMARY KEY,
          workflow_id TEXT NOT NULL,
          status TEXT NOT NULL,
          start_time INTEGER NOT NULL,
          end_time INTEGER,
          duration INTEGER,
          input TEXT,
          output TEXT,
          error TEXT,
          steps_completed INTEGER DEFAULT 0,
          triggered_by TEXT
        )
      `);

      this.database.exec(`
        CREATE INDEX IF NOT EXISTS idx_workflow_executions_workflow_id
        ON workflow_executions(workflow_id)
      `);

      this.database.exec(`
        CREATE INDEX IF NOT EXISTS idx_workflow_executions_start_time
        ON workflow_executions(start_time DESC)
      `);

      logger.info("[WorkflowHandler] 工作流表已就绪");
    } catch (error) {
      logger.error("[WorkflowHandler] 创建工作流表失败:", error);
    }
  }

  /**
   * 设置引擎事件监听
   */
  setupEngineEvents() {
    this.engine.on("workflow:start", (data) => {
      this.emit("workflow:start", data);
    });

    this.engine.on("workflow:complete", (data) => {
      this.saveExecution(data);
      this.emit("workflow:complete", data);
    });

    this.engine.on("workflow:error", (data) => {
      this.saveExecution(data);
      this.emit("workflow:error", data);
    });

    this.engine.on("step:start", (data) => {
      this.emit("step:start", data);
    });

    this.engine.on("step:complete", (data) => {
      this.emit("step:complete", data);
    });

    this.engine.on("step:error", (data) => {
      this.emit("step:error", data);
    });
  }

  /**
   * 处理命令（统一入口）
   */
  async handle(action, params, context) {
    logger.debug(`[WorkflowHandler] 处理命令: ${action}`);

    switch (action) {
      case "create":
        return await this.createWorkflow(params, context);

      case "execute":
        return await this.executeWorkflow(params, context);

      case "getStatus":
        return await this.getStatus(params, context);

      case "cancel":
        return await this.cancelWorkflow(params, context);

      case "list":
        return await this.listWorkflows(params, context);

      case "get":
        return await this.getWorkflow(params, context);

      case "update":
        return await this.updateWorkflow(params, context);

      case "delete":
        return await this.deleteWorkflow(params, context);

      case "getHistory":
        return await this.getHistory(params, context);

      case "getRunning":
        return await this.getRunningWorkflows(params, context);

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  /**
   * 创建工作流
   */
  async createWorkflow(params, context) {
    const { name, description, steps, variables, rollback, tags } = params;

    logger.info(`[WorkflowHandler] 创建工作流: ${name}`);

    // 验证工作流定义
    const validation = this.engine.validateWorkflow({ steps });
    if (!validation.valid) {
      throw new Error(`Invalid workflow: ${validation.errors.join(", ")}`);
    }

    const id = this.generateWorkflowId();
    const now = Date.now();

    const workflow = {
      id,
      name,
      description: description || "",
      steps,
      variables: variables || {},
      rollback: rollback || null,
      tags: tags || [],
    };

    try {
      if (this.database) {
        this.database
          .prepare(
            `
            INSERT INTO workflows (id, name, description, definition, tags, created_at, updated_at, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `,
          )
          .run(
            id,
            name,
            description || "",
            JSON.stringify(workflow),
            JSON.stringify(tags || []),
            now,
            now,
            context.did || "system",
          );
      } else {
        this.workflows.set(id, { ...workflow, createdAt: now, updatedAt: now });
      }

      return {
        success: true,
        id,
        name,
        createdAt: now,
      };
    } catch (error) {
      logger.error("[WorkflowHandler] 创建工作流失败:", error);
      throw new Error(`Create workflow failed: ${error.message}`);
    }
  }

  /**
   * 执行工作流
   */
  async executeWorkflow(params, context) {
    const { id, workflowId, definition, variables } = params;

    logger.info(
      `[WorkflowHandler] 执行工作流: ${id || workflowId || "inline"}`,
    );

    let workflow;

    if (definition) {
      // 直接执行传入的工作流定义
      workflow = definition;
    } else if (id || workflowId) {
      // 从数据库加载工作流
      workflow = await this.loadWorkflow(id || workflowId);
      if (!workflow) {
        throw new Error(`Workflow not found: ${id || workflowId}`);
      }
    } else {
      throw new Error("Either id/workflowId or definition is required");
    }

    // 合并变量
    const mergedVariables = {
      ...workflow.variables,
      ...variables,
      _triggeredBy: context.did || "remote",
      _triggeredAt: Date.now(),
    };

    // 执行工作流
    const result = await this.engine.execute(workflow, mergedVariables);

    return result;
  }

  /**
   * 获取工作流执行状态
   */
  async getStatus(params, context) {
    const { executionId, workflowId } = params;

    if (executionId) {
      // 检查是否正在运行
      const running = this.engine.getWorkflowStatus(executionId);
      if (running) {
        return running;
      }

      // 从历史中查询
      if (this.database) {
        const row = this.database
          .prepare("SELECT * FROM workflow_executions WHERE id = ?")
          .get(executionId);

        if (row) {
          return {
            id: row.id,
            workflowId: row.workflow_id,
            status: row.status,
            startTime: row.start_time,
            endTime: row.end_time,
            duration: row.duration,
            stepsCompleted: row.steps_completed,
            error: row.error,
            output: row.output ? JSON.parse(row.output) : null,
          };
        }
      }

      return null;
    }

    if (workflowId) {
      // 获取工作流的最近执行
      if (this.database) {
        const rows = this.database
          .prepare(
            `
            SELECT * FROM workflow_executions
            WHERE workflow_id = ?
            ORDER BY start_time DESC
            LIMIT 10
          `,
          )
          .all(workflowId);

        return {
          workflowId,
          executions: rows.map((row) => ({
            id: row.id,
            status: row.status,
            startTime: row.start_time,
            endTime: row.end_time,
            duration: row.duration,
          })),
        };
      }
    }

    return null;
  }

  /**
   * 取消工作流执行
   */
  async cancelWorkflow(params, context) {
    const { executionId } = params;

    logger.info(`[WorkflowHandler] 取消工作流: ${executionId}`);

    const cancelled = this.engine.cancelWorkflow(executionId);

    return {
      success: cancelled,
      executionId,
      message: cancelled
        ? "Workflow cancelled"
        : "Workflow not found or already completed",
    };
  }

  /**
   * 列出工作流
   */
  async listWorkflows(params, context) {
    const { limit = 20, offset = 0, tag, enabled } = params;

    logger.info("[WorkflowHandler] 列出工作流");

    try {
      if (this.database) {
        let query =
          "SELECT id, name, description, tags, enabled, created_at, updated_at FROM workflows WHERE 1=1";
        const queryParams = [];

        if (tag) {
          query += " AND tags LIKE ?";
          queryParams.push(`%"${tag}"%`);
        }

        if (enabled !== undefined) {
          query += " AND enabled = ?";
          queryParams.push(enabled ? 1 : 0);
        }

        query += " ORDER BY updated_at DESC LIMIT ? OFFSET ?";
        queryParams.push(limit, offset);

        const rows = this.database.prepare(query).all(...queryParams);

        return {
          items: rows.map((row) => ({
            id: row.id,
            name: row.name,
            description: row.description,
            tags: JSON.parse(row.tags || "[]"),
            enabled: Boolean(row.enabled),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          })),
          total: this.database
            .prepare("SELECT COUNT(*) as count FROM workflows")
            .get().count,
        };
      } else {
        const items = Array.from(this.workflows.values())
          .slice(offset, offset + limit)
          .map((w) => ({
            id: w.id,
            name: w.name,
            description: w.description,
            tags: w.tags,
            createdAt: w.createdAt,
            updatedAt: w.updatedAt,
          }));

        return { items, total: this.workflows.size };
      }
    } catch (error) {
      logger.error("[WorkflowHandler] 列出工作流失败:", error);
      throw new Error(`List workflows failed: ${error.message}`);
    }
  }

  /**
   * 获取工作流定义
   */
  async getWorkflow(params, context) {
    const { id } = params;

    logger.info(`[WorkflowHandler] 获取工作流: ${id}`);

    const workflow = await this.loadWorkflow(id);

    if (!workflow) {
      throw new Error(`Workflow not found: ${id}`);
    }

    return workflow;
  }

  /**
   * 更新工作流
   */
  async updateWorkflow(params, context) {
    const { id, name, description, steps, variables, rollback, tags, enabled } =
      params;

    logger.info(`[WorkflowHandler] 更新工作流: ${id}`);

    const existing = await this.loadWorkflow(id);
    if (!existing) {
      throw new Error(`Workflow not found: ${id}`);
    }

    // 验证新的步骤定义
    if (steps) {
      const validation = this.engine.validateWorkflow({ steps });
      if (!validation.valid) {
        throw new Error(`Invalid workflow: ${validation.errors.join(", ")}`);
      }
    }

    const now = Date.now();
    const updated = {
      ...existing,
      name: name !== undefined ? name : existing.name,
      description:
        description !== undefined ? description : existing.description,
      steps: steps !== undefined ? steps : existing.steps,
      variables: variables !== undefined ? variables : existing.variables,
      rollback: rollback !== undefined ? rollback : existing.rollback,
      tags: tags !== undefined ? tags : existing.tags,
    };

    try {
      if (this.database) {
        this.database
          .prepare(
            `
            UPDATE workflows
            SET name = ?, description = ?, definition = ?, tags = ?, enabled = ?, updated_at = ?
            WHERE id = ?
          `,
          )
          .run(
            updated.name,
            updated.description,
            JSON.stringify(updated),
            JSON.stringify(updated.tags),
            enabled !== undefined ? (enabled ? 1 : 0) : 1,
            now,
            id,
          );
      } else {
        this.workflows.set(id, { ...updated, updatedAt: now });
      }

      return {
        success: true,
        id,
        updatedAt: now,
      };
    } catch (error) {
      logger.error("[WorkflowHandler] 更新工作流失败:", error);
      throw new Error(`Update workflow failed: ${error.message}`);
    }
  }

  /**
   * 删除工作流
   */
  async deleteWorkflow(params, context) {
    const { id } = params;

    logger.info(`[WorkflowHandler] 删除工作流: ${id}`);

    try {
      if (this.database) {
        const result = this.database
          .prepare("DELETE FROM workflows WHERE id = ?")
          .run(id);

        return {
          success: result.changes > 0,
          id,
        };
      } else {
        const deleted = this.workflows.delete(id);
        return { success: deleted, id };
      }
    } catch (error) {
      logger.error("[WorkflowHandler] 删除工作流失败:", error);
      throw new Error(`Delete workflow failed: ${error.message}`);
    }
  }

  /**
   * 获取执行历史
   */
  async getHistory(params, context) {
    const { workflowId, limit = 20, offset = 0, status } = params;

    logger.info("[WorkflowHandler] 获取执行历史");

    try {
      if (!this.database) {
        return { items: [], total: 0 };
      }

      let query = "SELECT * FROM workflow_executions WHERE 1=1";
      const queryParams = [];

      if (workflowId) {
        query += " AND workflow_id = ?";
        queryParams.push(workflowId);
      }

      if (status) {
        query += " AND status = ?";
        queryParams.push(status);
      }

      query += " ORDER BY start_time DESC LIMIT ? OFFSET ?";
      queryParams.push(limit, offset);

      const rows = this.database.prepare(query).all(...queryParams);

      // 获取总数
      let countQuery =
        "SELECT COUNT(*) as count FROM workflow_executions WHERE 1=1";
      const countParams = [];

      if (workflowId) {
        countQuery += " AND workflow_id = ?";
        countParams.push(workflowId);
      }

      if (status) {
        countQuery += " AND status = ?";
        countParams.push(status);
      }

      const total = this.database.prepare(countQuery).get(...countParams).count;

      return {
        items: rows.map((row) => ({
          id: row.id,
          workflowId: row.workflow_id,
          status: row.status,
          startTime: row.start_time,
          endTime: row.end_time,
          duration: row.duration,
          stepsCompleted: row.steps_completed,
          triggeredBy: row.triggered_by,
          error: row.error,
        })),
        total,
      };
    } catch (error) {
      logger.error("[WorkflowHandler] 获取执行历史失败:", error);
      throw new Error(`Get history failed: ${error.message}`);
    }
  }

  /**
   * 获取正在运行的工作流
   */
  async getRunningWorkflows(params, context) {
    const workflows = this.engine.getRunningWorkflows();

    return {
      count: workflows.length,
      items: workflows,
    };
  }

  /**
   * 加载工作流定义
   */
  async loadWorkflow(id) {
    try {
      if (this.database) {
        const row = this.database
          .prepare("SELECT definition FROM workflows WHERE id = ?")
          .get(id);

        if (row) {
          return JSON.parse(row.definition);
        }
      } else if (this.workflows) {
        return this.workflows.get(id);
      }
    } catch (error) {
      logger.error(`[WorkflowHandler] 加载工作流失败: ${id}`, error);
    }

    return null;
  }

  /**
   * 保存执行记录
   */
  saveExecution(data) {
    if (!this.database) {
      return;
    }

    const { workflowId, state, results, error } = data;

    try {
      this.database
        .prepare(
          `
          INSERT INTO workflow_executions
          (id, workflow_id, status, start_time, end_time, duration, output, error, steps_completed, triggered_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        )
        .run(
          state.id,
          workflowId || state.name,
          state.status,
          state.startTime,
          state.endTime,
          state.endTime ? state.endTime - state.startTime : null,
          results ? JSON.stringify(results) : null,
          error ? error.message : state.error,
          state.completedSteps ? state.completedSteps.length : 0,
          "remote",
        );

      // 清理超出限制的历史
      this.database
        .prepare(
          `
          DELETE FROM workflow_executions
          WHERE id NOT IN (
            SELECT id FROM workflow_executions
            ORDER BY start_time DESC
            LIMIT ?
          )
        `,
        )
        .run(this.options.maxHistorySize);
    } catch (err) {
      logger.error("[WorkflowHandler] 保存执行记录失败:", err);
    }
  }

  /**
   * 生成工作流 ID
   */
  generateWorkflowId() {
    return `wf-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  }

  /**
   * 发送事件
   */
  emit(event, data) {
    if (this.eventEmitter) {
      this.eventEmitter.emit(event, data);
    }
  }

  /**
   * 设置事件发射器
   */
  setEventEmitter(emitter) {
    this.eventEmitter = emitter;
  }

  /**
   * 获取引擎实例
   */
  getEngine() {
    return this.engine;
  }

  /**
   * 清理资源
   */
  cleanup() {
    this.eventEmitter = null;
    logger.info("[WorkflowHandler] 工作流处理器已清理");
  }
}

module.exports = { WorkflowHandler };

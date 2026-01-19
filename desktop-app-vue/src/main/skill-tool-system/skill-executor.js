/**
 * 技能执行器
 * 负责执行技能并调度相关工具
 */

const { logger, createLogger } = require('../utils/logger.js');
const path = require('path');
const EventEmitter = require('events');
const cron = require('node-cron');

class SkillExecutor extends EventEmitter {
  constructor(skillManager, toolManager) {
    super();
    this.skillManager = skillManager;
    this.toolManager = toolManager;
    this.executionQueue = [];
    this.isProcessing = false;
    this.executionHistory = [];
    this.scheduledTasks = new Map(); // 存储定时任务
  }

  /**
   * 执行技能
   * @param {string} skillId - 技能ID
   * @param {object} params - 执行参数
   * @param {object} options - 执行选项
   */
  async executeSkill(skillId, params = {}, options = {}) {
    try {
      logger.info(`[SkillExecutor] 开始执行技能: ${skillId}`);

      // 1. 获取技能信息
      const skill = await this.skillManager.getSkillById(skillId);
      if (!skill) {
        throw new Error(`技能不存在: ${skillId}`);
      }

      if (!skill.enabled) {
        throw new Error(`技能已禁用: ${skillId}`);
      }

      // 2. 记录执行开始
      const executionId = this.generateExecutionId();
      const startTime = Date.now();

      this.emit('execution:start', {
        executionId,
        skillId,
        params,
        timestamp: startTime
      });

      // 3. 获取技能关联的工具
      const tools = await this.skillManager.getSkillTools(skillId);
      logger.info(`[SkillExecutor] 技能包含 ${tools.length} 个工具`);

      // 4. 根据技能类型执行不同的策略
      let result;
      if (options.sequential) {
        // 顺序执行工具
        result = await this.executeToolsSequentially(tools, params, executionId);
      } else if (options.parallel) {
        // 并行执行工具
        result = await this.executeToolsInParallel(tools, params, executionId);
      } else {
        // 智能执行（根据技能配置决定）
        result = await this.executeToolsIntelligently(skill, tools, params, executionId);
      }

      // 5. 记录执行结果
      const endTime = Date.now();
      const executionTime = endTime - startTime;

      const executionRecord = {
        executionId,
        skillId,
        skill: skill.name,
        params,
        result,
        success: result.success,
        executionTime,
        timestamp: startTime,
        toolsExecuted: tools.length
      };

      this.executionHistory.push(executionRecord);

      // 6. 更新统计信息
      await this.skillManager.recordExecution(skillId, result.success, executionTime);

      this.emit('execution:end', executionRecord);

      logger.info(`[SkillExecutor] 技能执行完成: ${skillId}, 耗时: ${executionTime}ms`);

      return {
        success: true,
        executionId,
        result,
        executionTime,
        toolsExecuted: tools.length
      };

    } catch (error) {
      logger.error(`[SkillExecutor] 技能执行失败:`, error);

      this.emit('execution:error', {
        skillId,
        error: error.message,
        timestamp: Date.now()
      });

      return {
        success: false,
        error: error.message,
        skillId
      };
    }
  }

  /**
   * 顺序执行工具
   */
  async executeToolsSequentially(tools, params, executionId) {
    const results = [];
    let context = { ...params };

    for (const tool of tools) {
      try {
        logger.info(`[SkillExecutor] 执行工具: ${tool.name}`);

        // 执行工具
        const toolResult = await this.toolManager.executeTool(
          tool.name,
          this.prepareToolParams(tool, context),
          { executionId }
        );

        results.push({
          tool: tool.name,
          success: toolResult.success,
          result: toolResult.result,
          executionTime: toolResult.executionTime
        });

        // 更新上下文（将上一个工具的结果传递给下一个）
        if (toolResult.success && toolResult.result) {
          context = { ...context, ...toolResult.result };
        }

        // 如果工具执行失败且是必需的，停止执行
        if (!toolResult.success && tool.required) {
          throw new Error(`必需工具执行失败: ${tool.name}`);
        }

      } catch (error) {
        logger.error(`[SkillExecutor] 工具执行失败: ${tool.name}`, error);
        results.push({
          tool: tool.name,
          success: false,
          error: error.message
        });

        if (tool.required) {
          break;
        }
      }
    }

    const allSuccess = results.every(r => r.success);

    return {
      success: allSuccess,
      results,
      context,
      executionMode: 'sequential'
    };
  }

  /**
   * 并行执行工具
   */
  async executeToolsInParallel(tools, params, executionId) {
    logger.info(`[SkillExecutor] 并行执行 ${tools.length} 个工具`);

    const toolPromises = tools.map(tool =>
      this.toolManager.executeTool(
        tool.name,
        this.prepareToolParams(tool, params),
        { executionId }
      ).then(result => ({
        tool: tool.name,
        success: result.success,
        result: result.result,
        executionTime: result.executionTime
      })).catch(error => ({
        tool: tool.name,
        success: false,
        error: error.message
      }))
    );

    const results = await Promise.all(toolPromises);
    const allSuccess = results.every(r => r.success);

    return {
      success: allSuccess,
      results,
      executionMode: 'parallel'
    };
  }

  /**
   * 智能执行工具（根据依赖关系和配置）
   */
  async executeToolsIntelligently(skill, tools, params, executionId) {
    // 分析工具依赖关系
    const dependencies = this.analyzeToolDependencies(tools);

    // 构建执行计划
    const executionPlan = this.buildExecutionPlan(dependencies);

    logger.info(`[SkillExecutor] 智能执行计划:`, executionPlan);

    const results = [];
    const context = { ...params };

    for (const stage of executionPlan) {
      // 同一阶段的工具可以并行执行
      const stageResults = await Promise.all(
        stage.map(async (tool) => {
          try {
            const toolResult = await this.toolManager.executeTool(
              tool.name,
              this.prepareToolParams(tool, context),
              { executionId }
            );

            return {
              tool: tool.name,
              success: toolResult.success,
              result: toolResult.result,
              executionTime: toolResult.executionTime
            };
          } catch (error) {
            return {
              tool: tool.name,
              success: false,
              error: error.message
            };
          }
        })
      );

      results.push(...stageResults);

      // 更新上下文
      stageResults.forEach(result => {
        if (result.success && result.result) {
          Object.assign(context, result.result);
        }
      });
    }

    const allSuccess = results.every(r => r.success);

    return {
      success: allSuccess,
      results,
      context,
      executionMode: 'intelligent',
      executionPlan: executionPlan.map(stage => stage.map(t => t.name))
    };
  }

  /**
   * 准备工具参数
   */
  prepareToolParams(tool, context) {
    // 从上下文中提取工具需要的参数
    const paramsSchema = tool.parameters_schema;
    if (!paramsSchema || !paramsSchema.properties) {
      return context;
    }

    const toolParams = {};
    Object.keys(paramsSchema.properties).forEach(key => {
      if (context[key] !== undefined) {
        toolParams[key] = context[key];
      }
    });

    return toolParams;
  }

  /**
   * 分析工具依赖关系
   */
  analyzeToolDependencies(tools) {
    // 简化版：根据工具顺序和类型分析依赖
    // 实际应用中可以更复杂，例如分析参数依赖
    const dependencies = new Map();

    tools.forEach((tool, index) => {
      const deps = [];

      // 如果是写入类工具，依赖于前面的生成类工具
      if (tool.name.includes('writer') || tool.name.includes('commit')) {
        const prevGenerators = tools.slice(0, index).filter(t =>
          t.name.includes('generator') || t.name.includes('reader')
        );
        deps.push(...prevGenerators.map(t => t.name));
      }

      dependencies.set(tool.name, deps);
    });

    return dependencies;
  }

  /**
   * 构建执行计划（拓扑排序）
   */
  buildExecutionPlan(dependencies) {
    // 简化版拓扑排序
    const plan = [];
    const processed = new Set();

    // 找出没有依赖的工具（第一阶段）
    const firstStage = Array.from(dependencies.entries())
      .filter(([name, deps]) => deps.length === 0)
      .map(([name]) => ({ name }));

    if (firstStage.length > 0) {
      plan.push(firstStage);
      firstStage.forEach(tool => processed.add(tool.name));
    }

    // 处理有依赖的工具
    let hasChanges = true;
    while (hasChanges && processed.size < dependencies.size) {
      hasChanges = false;
      const nextStage = [];

      Array.from(dependencies.entries()).forEach(([name, deps]) => {
        if (!processed.has(name)) {
          // 检查所有依赖是否已处理
          const allDepsProcessed = deps.every(dep => processed.has(dep));
          if (allDepsProcessed) {
            nextStage.push({ name });
            processed.add(name);
            hasChanges = true;
          }
        }
      });

      if (nextStage.length > 0) {
        plan.push(nextStage);
      }
    }

    return plan;
  }

  /**
   * 批量执行技能
   */
  async executeBatch(tasks) {
    logger.info(`[SkillExecutor] 批量执行 ${tasks.length} 个任务`);

    const results = await Promise.all(
      tasks.map(task =>
        this.executeSkill(task.skillId, task.params, task.options)
      )
    );

    return {
      success: true,
      total: tasks.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results
    };
  }

  /**
   * 创建自动化工作流
   */
  async createWorkflow(workflowDef) {
    const { name, skills, schedule } = workflowDef;

    logger.info(`[SkillExecutor] 创建工作流: ${name}`);

    const workflow = {
      id: this.generateWorkflowId(),
      name,
      skills,
      schedule,
      enabled: true,
      createdAt: Date.now()
    };

    // 如果有定时执行，设置定时任务
    if (schedule) {
      this.scheduleWorkflow(workflow);
    }

    return workflow;
  }

  /**
   * 执行工作流
   */
  async executeWorkflow(workflow) {
    logger.info(`[SkillExecutor] 执行工作流: ${workflow.name}`);

    const results = [];
    let context = {};

    for (const skillDef of workflow.skills) {
      const result = await this.executeSkill(
        skillDef.skillId,
        { ...context, ...skillDef.params },
        skillDef.options
      );

      results.push({
        skillId: skillDef.skillId,
        success: result.success,
        result: result.result
      });

      // 传递上下文
      if (result.success && result.result && result.result.context) {
        context = { ...context, ...result.result.context };
      }

      // 如果某个技能失败且是必需的，停止工作流
      if (!result.success && skillDef.required) {
        break;
      }
    }

    return {
      success: results.every(r => r.success),
      workflowId: workflow.id,
      results,
      context
    };
  }

  /**
   * 获取执行历史
   */
  getExecutionHistory(limit = 100) {
    return this.executionHistory
      .slice(-limit)
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * 获取执行统计
   */
  getExecutionStats() {
    const total = this.executionHistory.length;
    const successful = this.executionHistory.filter(e => e.success).length;
    const failed = total - successful;

    const avgExecutionTime = total > 0
      ? this.executionHistory.reduce((sum, e) => sum + e.executionTime, 0) / total
      : 0;

    return {
      total,
      successful,
      failed,
      successRate: total > 0 ? (successful / total * 100).toFixed(2) : 0,
      avgExecutionTime: avgExecutionTime.toFixed(2)
    };
  }

  /**
   * 生成执行ID
   */
  generateExecutionId() {
    return `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 生成工作流ID
   */
  generateWorkflowId() {
    return `workflow_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 定时执行工作流
   * @param {object} workflow - 工作流配置
   * @param {string} workflow.name - 工作流名称
   * @param {string} workflow.schedule - Cron表达式 (e.g., '0 0 * * *' for daily at midnight)
   * @param {string} workflow.skillId - 技能ID
   * @param {object} workflow.params - 执行参数
   * @param {boolean} workflow.enabled - 是否启用
   * @returns {string} 任务ID
   */
  scheduleWorkflow(workflow) {
    const { name, schedule, skillId, params = {}, enabled = true } = workflow;

    if (!name || !schedule || !skillId) {
      throw new Error('工作流配置不完整: name, schedule 和 skillId 是必需的');
    }

    // 验证Cron表达式
    if (!cron.validate(schedule)) {
      throw new Error(`无效的Cron表达式: ${schedule}`);
    }

    const taskId = `workflow_${name}_${Date.now()}`;

    if (!enabled) {
      logger.info(`[SkillExecutor] 工作流已调度但未启用: ${name}`);
      this.scheduledTasks.set(taskId, { workflow, task: null, enabled: false });
      return taskId;
    }

    // 创建定时任务
    const task = cron.schedule(schedule, async () => {
      logger.info(`[SkillExecutor] 定时工作流触发: ${name}`);
      try {
        await this.executeSkill(skillId, params, {
          source: 'scheduled',
          workflowName: name
        });
        this.emit('workflow:success', { taskId, name, timestamp: Date.now() });
      } catch (error) {
        logger.error(`[SkillExecutor] 定时工作流执行失败: ${name}`, error);
        this.emit('workflow:error', { taskId, name, error: error.message, timestamp: Date.now() });
      }
    }, {
      scheduled: true,
      timezone: 'Asia/Shanghai' // 可根据需要配置时区
    });

    this.scheduledTasks.set(taskId, { workflow, task, enabled: true });
    logger.info(`[SkillExecutor] 工作流已调度: ${name}, 计划: ${schedule}, 任务ID: ${taskId}`);

    return taskId;
  }

  /**
   * 停止定时工作流
   * @param {string} taskId - 任务ID
   */
  stopWorkflow(taskId) {
    const scheduled = this.scheduledTasks.get(taskId);
    if (!scheduled) {
      throw new Error(`任务不存在: ${taskId}`);
    }

    if (scheduled.task) {
      scheduled.task.stop();
    }

    this.scheduledTasks.delete(taskId);
    logger.info(`[SkillExecutor] 工作流已停止: ${scheduled.workflow.name}`);
  }

  /**
   * 获取所有定时任务
   * @returns {Array} 定时任务列表
   */
  getScheduledWorkflows() {
    return Array.from(this.scheduledTasks.entries()).map(([taskId, scheduled]) => ({
      taskId,
      name: scheduled.workflow.name,
      schedule: scheduled.workflow.schedule,
      skillId: scheduled.workflow.skillId,
      enabled: scheduled.enabled
    }));
  }

  /**
   * 清理所有定时任务
   */
  cleanup() {
    for (const [taskId, scheduled] of this.scheduledTasks.entries()) {
      if (scheduled.task) {
        scheduled.task.stop();
      }
    }
    this.scheduledTasks.clear();
    logger.info('[SkillExecutor] 所有定时任务已清理');
  }
}

module.exports = SkillExecutor;

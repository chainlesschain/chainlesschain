/**
 * CoworkOrchestrator - 集成 Cowork 的增强型代理协调器
 *
 * 扩展 AgentOrchestrator，集成 TeammateTool、FileSandbox 和 Skills 系统。
 * 基于 Anthropic 的三种多代理适用场景进行智能决策。
 *
 * @module ai-engine/multi-agent/cowork-orchestrator
 */

const { logger } = require('../../utils/logger.js');
const { AgentOrchestrator } = require('./agent-orchestrator');
const { TeammateTool } = require('../cowork/teammate-tool');
const { FileSandbox } = require('../cowork/file-sandbox');
const { getSkillRegistry } = require('../cowork/skills');

/**
 * Cowork 集成的代理协调器
 */
class CoworkOrchestrator extends AgentOrchestrator {
  constructor(options = {}) {
    super(options);

    // Cowork 组件
    this.teammateTool = options.teammateTool || new TeammateTool();
    this.fileSandbox = options.fileSandbox || new FileSandbox();
    this.skillRegistry = options.skillRegistry || getSkillRegistry();

    // Cowork 配置
    this.coworkConfig = {
      // 是否启用 Cowork 多代理模式
      enabled: options.coworkEnabled !== false,
      // 上下文污染阈值（字符数）
      contextPollutionThreshold: options.contextPollutionThreshold || 10000,
      // 可并行化最小子任务数
      minParallelTasks: options.minParallelTasks || 2,
      // 专业化技能匹配最低分数
      minSkillScore: options.minSkillScore || 50,
      ...options.coworkConfig,
    };

    // 活跃团队: teamId -> Team
    this.activeTeams = new Map();

    this._log('CoworkOrchestrator 已初始化');
  }

  /**
   * 设置数据库实例
   * @param {Object} db - 数据库实例
   */
  setDatabase(db) {
    this.teammateTool.setDatabase(db);
    this.fileSandbox.setDatabase(db);
  }

  // ==========================================
  // 多代理决策（基于 Anthropic 三种场景）
  // ==========================================

  /**
   * 判断是否应该使用多代理模式
   * @param {Object} task - 任务对象
   * @param {Object} context - 上下文信息
   * @returns {Object} { useMultiAgent: boolean, reason: string, strategy: string }
   */
  shouldUseMultiAgent(task, context = {}) {
    if (!this.coworkConfig.enabled) {
      return { useMultiAgent: false, reason: 'cowork_disabled' };
    }

    // 场景 1: 上下文污染
    if (this.hasContextPollution(task, context)) {
      return {
        useMultiAgent: true,
        reason: 'context_pollution',
        strategy: 'divide_context',
        description: '任务上下文过大，分散到多个代理可减少污染',
      };
    }

    // 场景 2: 可并行化
    if (this.canParallelize(task, context)) {
      return {
        useMultiAgent: true,
        reason: 'parallelization',
        strategy: 'parallel_execution',
        description: '任务可分解为独立子任务，并行执行提升效率',
      };
    }

    // 场景 3: 需要专业化
    if (this.needsSpecialization(task, context)) {
      return {
        useMultiAgent: true,
        reason: 'specialization',
        strategy: 'specialized_agents',
        description: '任务需要不同领域的专业技能',
      };
    }

    return {
      useMultiAgent: false,
      reason: 'single_agent_sufficient',
      description: '单个代理即可高效完成任务',
    };
  }

  /**
   * 场景 1: 检测上下文污染
   * @private
   */
  hasContextPollution(task, context) {
    // 计算上下文大小
    const contextSize =
      JSON.stringify(context).length + (task.description?.length || 0);

    // 检查是否超过阈值
    if (contextSize > this.coworkConfig.contextPollutionThreshold) {
      this._log(`检测到上下文污染: ${contextSize} 字符 > ${this.coworkConfig.contextPollutionThreshold}`);
      return true;
    }

    // 检查是否有大量历史记录
    if (context.messageHistory && context.messageHistory.length > 50) {
      this._log(`检测到大量历史消息: ${context.messageHistory.length} 条`);
      return true;
    }

    return false;
  }

  /**
   * 场景 2: 检测可并行化
   * @private
   */
  canParallelize(task, context) {
    // 检查任务是否明确包含子任务
    if (task.subtasks && Array.isArray(task.subtasks)) {
      const independentTasks = task.subtasks.filter(
        subtask => !subtask.dependencies || subtask.dependencies.length === 0
      );

      if (independentTasks.length >= this.coworkConfig.minParallelTasks) {
        this._log(`检测到可并行子任务: ${independentTasks.length} 个`);
        return true;
      }
    }

    // 检查任务类型是否天然可并行
    const parallelizableTypes = [
      'batch_processing',
      'data_analysis',
      'multi_file_processing',
      'web_scraping',
      'concurrent_api_calls',
    ];

    if (parallelizableTypes.includes(task.type)) {
      this._log(`任务类型支持并行: ${task.type}`);
      return true;
    }

    // 检查输入数据是否可分批
    if (task.input && Array.isArray(task.input) && task.input.length >= this.coworkConfig.minParallelTasks) {
      this._log(`输入数据可分批: ${task.input.length} 项`);
      return true;
    }

    return false;
  }

  /**
   * 场景 3: 检测需要专业化
   * @private
   */
  needsSpecialization(task, context) {
    // 查找匹配的技能
    const skills = this.skillRegistry.findSkillsForTask(task);

    // 如果有多个高分技能匹配，说明需要专业化
    const highScoreSkills = skills.filter(
      ({ score }) => score >= this.coworkConfig.minSkillScore
    );

    if (highScoreSkills.length >= 2) {
      this._log(`检测到多个专业技能需求: ${highScoreSkills.length} 个技能`);
      return true;
    }

    // 检查任务是否需要多种工具
    if (task.requiredTools && task.requiredTools.length >= 3) {
      this._log(`任务需要多种工具: ${task.requiredTools.length} 个`);
      return true;
    }

    // 检查任务类型是否需要跨领域协作
    const specializationTypes = [
      'research_and_analysis',
      'document_generation_with_data',
      'end_to_end_automation',
      'multi_language_task',
    ];

    if (specializationTypes.includes(task.type)) {
      this._log(`任务类型需要专业化: ${task.type}`);
      return true;
    }

    return false;
  }

  // ==========================================
  // Cowork 任务执行
  // ==========================================

  /**
   * 使用 Cowork 执行任务
   * @param {Object} task - 任务对象
   * @param {Object} context - 执行上下文
   * @returns {Promise<any>} 执行结果
   */
  async executeWithCowork(task, context = {}) {
    const decision = this.shouldUseMultiAgent(task, context);

    if (!decision.useMultiAgent) {
      // 单代理模式
      this._log(`使用单代理模式: ${decision.reason}`);
      return await this.dispatch(task);
    }

    // 多代理模式
    this._log(`使用多代理模式: ${decision.reason}, 策略: ${decision.strategy}`);

    switch (decision.strategy) {
      case 'divide_context':
        return await this.executeDivideContext(task, context);

      case 'parallel_execution':
        return await this.executeParallel(task, context);

      case 'specialized_agents':
        return await this.executeSpecialized(task, context);

      default:
        return await this.dispatch(task);
    }
  }

  /**
   * 策略 1: 分散上下文执行
   * @private
   */
  async executeDivideContext(task, context) {
    // 创建团队
    const team = await this.teammateTool.spawnTeam(`ctx-${Date.now()}`, {
      maxAgents: 3,
      description: '分散上下文执行',
    });

    this.activeTeams.set(team.id, team);

    try {
      // 将上下文分片
      const contextChunks = this._divideContext(context);

      // 为每个上下文片段创建代理
      const agents = [];
      for (let i = 0; i < contextChunks.length; i++) {
        const agentId = `agent_${i + 1}`;
        await this.teammateTool.requestJoin(team.id, agentId, {
          name: `Context Agent ${i + 1}`,
          capabilities: ['context_processing'],
        });
        agents.push(agentId);
      }

      // 分配任务
      const subtasks = contextChunks.map((chunk, i) => ({
        ...task,
        context: chunk,
        agentId: agents[i],
      }));

      // 并行执行
      const results = await Promise.all(
        subtasks.map(subtask => this.dispatch(subtask))
      );

      // 合并结果
      const mergedResult = await this.teammateTool.mergeResults(
        team.id,
        results,
        { type: 'concatenate' }
      );

      return mergedResult.result;
    } finally {
      await this.teammateTool.destroyTeam(team.id);
      this.activeTeams.delete(team.id);
    }
  }

  /**
   * 策略 2: 并行执行
   * @private
   */
  async executeParallel(task, context) {
    // 创建团队
    const team = await this.teammateTool.spawnTeam(`parallel-${Date.now()}`, {
      maxAgents: 5,
      description: '并行任务执行',
    });

    this.activeTeams.set(team.id, team);

    try {
      // 提取子任务
      const subtasks = task.subtasks || this._splitTask(task);

      // 为每个子任务创建代理
      const agents = [];
      for (let i = 0; i < Math.min(subtasks.length, 5); i++) {
        const agentId = `agent_${i + 1}`;
        await this.teammateTool.requestJoin(team.id, agentId, {
          name: `Parallel Agent ${i + 1}`,
          capabilities: ['task_execution'],
        });
        agents.push(agentId);
      }

      // 分配并执行任务
      const taskPromises = subtasks.map((subtask, i) => {
        const agentId = agents[i % agents.length];
        return this.teammateTool.assignTask(team.id, agentId, subtask).then(() => {
          return this.dispatch(subtask);
        });
      });

      const results = await Promise.all(taskPromises);

      // 合并结果
      const mergedResult = await this.teammateTool.mergeResults(
        team.id,
        results,
        { type: task.mergeStrategy || 'aggregate' }
      );

      return mergedResult.result;
    } finally {
      await this.teammateTool.destroyTeam(team.id);
      this.activeTeams.delete(team.id);
    }
  }

  /**
   * 策略 3: 专业化代理执行
   * @private
   */
  async executeSpecialized(task, context) {
    // 创建团队
    const team = await this.teammateTool.spawnTeam(`specialized-${Date.now()}`, {
      maxAgents: 5,
      description: '专业化代理执行',
    });

    this.activeTeams.set(team.id, team);

    try {
      // 查找匹配的技能
      const skills = this.skillRegistry.findSkillsForTask(task);

      // 为每个技能创建代理
      const agents = [];
      for (const { skill } of skills.slice(0, 5)) {
        const agentId = `agent_${skill.skillId}`;
        await this.teammateTool.requestJoin(team.id, agentId, {
          name: skill.name,
          capabilities: skill.capabilities,
        });
        agents.push({ agentId, skill });
      }

      // 执行技能任务
      const results = await Promise.all(
        agents.map(async ({ agentId, skill }) => {
          try {
            return await skill.executeWithMetrics(task, context);
          } catch (error) {
            this._log(`技能执行失败: ${skill.name}, 错误: ${error.message}`, 'error');
            return { error: error.message };
          }
        })
      );

      // 过滤失败的结果
      const successfulResults = results.filter(r => !r.error);

      if (successfulResults.length === 0) {
        throw new Error('所有专业化代理执行失败');
      }

      // 合并结果（使用投票策略）
      const mergedResult = await this.teammateTool.mergeResults(
        team.id,
        successfulResults,
        { type: 'vote' }
      );

      return mergedResult.result;
    } finally {
      await this.teammateTool.destroyTeam(team.id);
      this.activeTeams.delete(team.id);
    }
  }

  // ==========================================
  // 辅助方法
  // ==========================================

  /**
   * 分散上下文
   * @private
   */
  _divideContext(context) {
    const chunks = [];
    const chunkSize = Math.ceil(this.coworkConfig.contextPollutionThreshold / 2);

    if (context.messageHistory && context.messageHistory.length > 0) {
      // 按消息历史分片
      const messages = context.messageHistory;
      const chunkCount = Math.ceil(messages.length / 10);

      for (let i = 0; i < chunkCount; i++) {
        chunks.push({
          ...context,
          messageHistory: messages.slice(i * 10, (i + 1) * 10),
        });
      }
    } else {
      // 简单分片
      chunks.push(context);
    }

    return chunks;
  }

  /**
   * 拆分任务
   * @private
   */
  _splitTask(task) {
    const subtasks = [];

    // 如果输入是数组，按批次拆分
    if (task.input && Array.isArray(task.input)) {
      const batchSize = Math.ceil(task.input.length / this.coworkConfig.minParallelTasks);

      for (let i = 0; i < task.input.length; i += batchSize) {
        subtasks.push({
          ...task,
          input: task.input.slice(i, i + batchSize),
        });
      }
    } else {
      // 默认不拆分
      subtasks.push(task);
    }

    return subtasks;
  }

  /**
   * 日志输出
   * @private
   */
  _log(message, level = 'info') {
    const prefix = '[CoworkOrchestrator]';

    if (level === 'error') {
      logger.error(`${prefix} ${message}`);
    } else if (level === 'warn') {
      logger.warn(`${prefix} ${message}`);
    } else {
      logger.info(`${prefix} ${message}`);
    }
  }

  /**
   * 获取 Cowork 统计信息
   * @returns {Object}
   */
  getCoworkStats() {
    return {
      ...this.getStats(),
      cowork: {
        enabled: this.coworkConfig.enabled,
        activeTeams: this.activeTeams.size,
        teammateTool: this.teammateTool.getStats(),
        fileSandbox: this.fileSandbox.getStats(),
        skillRegistry: this.skillRegistry.getStats(),
      },
    };
  }
}

module.exports = { CoworkOrchestrator };

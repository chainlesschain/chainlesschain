/**
 * TeammateTool - Claude Cowork 风格的多代理协作工具
 *
 * 基于 Claude Code 的 TeammateTool 设计，实现 13 个核心操作：
 * 1. spawnTeam - 创建团队
 * 2. discoverTeams - 发现团队
 * 3. requestJoin - 请求加入团队
 * 4. assignTask - 分配任务
 * 5. broadcastMessage - 广播消息
 * 6. sendMessage - 发送消息
 * 7. voteOnDecision - 投票决策
 * 8. getTeamStatus - 获取团队状态
 * 9. terminateAgent - 终止代理
 * 10. mergeResults - 合并结果
 * 11. createCheckpoint - 创建检查点
 * 12. listMembers - 列出成员
 * 13. updateTeamConfig - 更新团队配置
 *
 * @module ai-engine/cowork/teammate-tool
 */

const { logger } = require('../../utils/logger.js');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs').promises;
const EventEmitter = require('events');

/**
 * 团队状态
 */
const TeamStatus = {
  ACTIVE: 'active',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  FAILED: 'failed',
};

/**
 * 代理状态
 */
const AgentStatus = {
  IDLE: 'idle',
  BUSY: 'busy',
  WAITING: 'waiting',
  TERMINATED: 'terminated',
};

/**
 * TeammateTool 类
 */
class TeammateTool extends EventEmitter {
  constructor(options = {}) {
    super();

    this.options = {
      // 数据存储路径
      dataDir: options.dataDir || path.join(process.cwd(), '.chainlesschain', 'cowork'),
      // 最大团队数
      maxTeams: options.maxTeams || 10,
      // 单个团队最大代理数
      maxAgentsPerTeam: options.maxAgentsPerTeam || 5,
      // 消息保留时间（毫秒）
      messageRetention: options.messageRetention || 24 * 60 * 60 * 1000, // 24小时
      // 是否启用日志
      enableLogging: options.enableLogging !== false,
      ...options,
    };

    // 团队映射: teamId -> Team
    this.teams = new Map();

    // 代理映射: agentId -> Agent
    this.agents = new Map();

    // 消息队列: teamId -> Message[]
    this.messageQueues = new Map();

    // 数据库实例（延迟注入）
    this.db = null;

    this._log('TeammateTool 已初始化');
  }

  /**
   * 设置数据库实例
   * @param {Object} db - 数据库实例
   */
  setDatabase(db) {
    this.db = db;
  }

  /**
   * 初始化存储目录
   * @private
   */
  async _ensureDataDir() {
    try {
      await fs.mkdir(this.options.dataDir, { recursive: true });
      await fs.mkdir(path.join(this.options.dataDir, 'teams'), { recursive: true });
      await fs.mkdir(path.join(this.options.dataDir, 'checkpoints'), { recursive: true });
    } catch (error) {
      this._log(`初始化数据目录失败: ${error.message}`, 'error');
      throw error;
    }
  }

  // ==========================================
  // 核心操作 1-5
  // ==========================================

  /**
   * 1. spawnTeam - 创建团队
   * @param {string} teamName - 团队名称
   * @param {Object} config - 团队配置
   * @returns {Promise<Object>} 团队对象
   */
  async spawnTeam(teamName, config = {}) {
    // 检查团队数量限制
    if (this.teams.size >= this.options.maxTeams) {
      throw new Error(`已达到最大团队数限制: ${this.options.maxTeams}`);
    }

    const teamId = config.teamId || `team_${Date.now()}_${uuidv4().slice(0, 8)}`;

    // 创建团队对象
    const team = {
      id: teamId,
      name: teamName,
      status: TeamStatus.ACTIVE,
      maxAgents: config.maxAgents || this.options.maxAgentsPerTeam,
      agents: [],
      tasks: [],
      config: {
        allowDynamicJoin: config.allowDynamicJoin !== false,
        requireApproval: config.requireApproval || false,
        votingThreshold: config.votingThreshold || 0.5, // 50%
        ...config,
      },
      metadata: {
        createdAt: Date.now(),
        createdBy: config.createdBy || 'system',
        description: config.description || '',
      },
    };

    // 存储到内存
    this.teams.set(teamId, team);
    this.messageQueues.set(teamId, []);

    // 持久化到数据库
    if (this.db) {
      try {
        await this.db.run(
          `INSERT INTO cowork_teams (id, name, status, max_agents, created_at, metadata)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [teamId, teamName, team.status, team.maxAgents, team.metadata.createdAt, JSON.stringify(team)]
        );
      } catch (error) {
        this._log(`保存团队到数据库失败: ${error.message}`, 'error');
      }
    }

    // 保存到文件系统
    await this._ensureDataDir();
    const teamDir = path.join(this.options.dataDir, 'teams', teamId);
    await fs.mkdir(teamDir, { recursive: true });
    await fs.mkdir(path.join(teamDir, 'messages'), { recursive: true });
    await fs.mkdir(path.join(teamDir, 'tasks'), { recursive: true });
    await fs.mkdir(path.join(teamDir, 'results'), { recursive: true });

    // 写入配置文件
    await fs.writeFile(
      path.join(teamDir, 'config.json'),
      JSON.stringify(team, null, 2),
      'utf-8'
    );

    this._log(`团队已创建: ${teamName} (${teamId})`);
    this.emit('team-spawned', { team });

    return team;
  }

  /**
   * 2. discoverTeams - 发现团队
   * @param {Object} filters - 过滤条件
   * @returns {Promise<Array>} 团队列表
   */
  async discoverTeams(filters = {}) {
    let teams = Array.from(this.teams.values());

    // 应用过滤条件
    if (filters.status) {
      teams = teams.filter(t => t.status === filters.status);
    }

    if (filters.allowDynamicJoin !== undefined) {
      teams = teams.filter(t => t.config.allowDynamicJoin === filters.allowDynamicJoin);
    }

    if (filters.maxAgents) {
      teams = teams.filter(t => t.agents.length < t.maxAgents);
    }

    return teams.map(t => ({
      id: t.id,
      name: t.name,
      status: t.status,
      agentCount: t.agents.length,
      maxAgents: t.maxAgents,
      allowDynamicJoin: t.config.allowDynamicJoin,
      createdAt: t.metadata.createdAt,
    }));
  }

  /**
   * 3. requestJoin - 请求加入团队
   * @param {string} teamId - 团队 ID
   * @param {string} agentId - 代理 ID
   * @param {Object} agentInfo - 代理信息
   * @returns {Promise<Object>} 加入结果
   */
  async requestJoin(teamId, agentId, agentInfo = {}) {
    const team = this.teams.get(teamId);

    if (!team) {
      throw new Error(`团队不存在: ${teamId}`);
    }

    // 检查团队是否允许动态加入
    if (!team.config.allowDynamicJoin) {
      throw new Error(`团队 ${team.name} 不允许动态加入`);
    }

    // 检查代理数量限制
    if (team.agents.length >= team.maxAgents) {
      throw new Error(`团队已满: ${team.agents.length}/${team.maxAgents}`);
    }

    // 检查代理是否已加入
    if (team.agents.some(a => a.id === agentId)) {
      throw new Error(`代理 ${agentId} 已在团队中`);
    }

    // 创建代理对象
    const agent = {
      id: agentId,
      teamId,
      name: agentInfo.name || agentId,
      status: AgentStatus.IDLE,
      capabilities: agentInfo.capabilities || [],
      assignedTask: null,
      metadata: {
        joinedAt: Date.now(),
        ...agentInfo.metadata,
      },
    };

    // 添加到团队
    team.agents.push(agent);
    this.agents.set(agentId, agent);

    // 持久化到数据库
    if (this.db) {
      try {
        await this.db.run(
          `INSERT INTO cowork_agents (id, team_id, name, status, created_at)
           VALUES (?, ?, ?, ?, ?)`,
          [agentId, teamId, agent.name, agent.status, agent.metadata.joinedAt]
        );
      } catch (error) {
        this._log(`保存代理到数据库失败: ${error.message}`, 'error');
      }
    }

    // 更新团队配置文件
    await this._saveTeamConfig(team);

    this._log(`代理 ${agentId} 已加入团队 ${team.name}`);
    this.emit('agent-joined', { teamId, agent });

    return {
      success: true,
      agent,
      team: {
        id: team.id,
        name: team.name,
        agentCount: team.agents.length,
      },
    };
  }

  /**
   * 4. assignTask - 分配任务
   * @param {string} teamId - 团队 ID
   * @param {string} agentId - 代理 ID（可选，自动选择）
   * @param {Object} task - 任务对象
   * @returns {Promise<Object>} 分配结果
   */
  async assignTask(teamId, agentId, task) {
    const team = this.teams.get(teamId);

    if (!team) {
      throw new Error(`团队不存在: ${teamId}`);
    }

    // 创建任务对象
    const taskId = task.id || `task_${Date.now()}_${uuidv4().slice(0, 8)}`;
    const taskObj = {
      id: taskId,
      teamId,
      description: task.description || '',
      type: task.type || 'general',
      priority: task.priority || 0,
      status: 'pending',
      assignedTo: null,
      result: null,
      createdAt: Date.now(),
      completedAt: null,
      ...task,
    };

    // 如果未指定代理，自动选择
    if (!agentId) {
      agentId = this._selectAgentForTask(team, taskObj);
    }

    const agent = this.agents.get(agentId);

    if (!agent) {
      throw new Error(`代理不存在: ${agentId}`);
    }

    if (agent.teamId !== teamId) {
      throw new Error(`代理 ${agentId} 不在团队 ${teamId} 中`);
    }

    // 分配任务
    taskObj.assignedTo = agentId;
    taskObj.status = 'assigned';
    agent.assignedTask = taskId;
    agent.status = AgentStatus.BUSY;

    // 添加到团队任务列表
    team.tasks.push(taskObj);

    // 持久化到数据库
    if (this.db) {
      try {
        await this.db.run(
          `INSERT INTO cowork_tasks (id, team_id, description, status, priority, assigned_to, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [taskId, teamId, taskObj.description, taskObj.status, taskObj.priority, agentId, taskObj.createdAt]
        );

        await this.db.run(
          `UPDATE cowork_agents SET status = ?, assigned_task = ? WHERE id = ?`,
          [agent.status, taskId, agentId]
        );
      } catch (error) {
        this._log(`保存任务到数据库失败: ${error.message}`, 'error');
      }
    }

    // 保存任务文件
    const taskFile = path.join(this.options.dataDir, 'teams', teamId, 'tasks', `${taskId}.json`);
    await fs.writeFile(taskFile, JSON.stringify(taskObj, null, 2), 'utf-8');

    this._log(`任务 ${taskId} 已分配给代理 ${agentId}`);
    this.emit('task-assigned', { teamId, taskId, agentId, task: taskObj });

    return {
      success: true,
      taskId,
      agentId,
      task: taskObj,
    };
  }

  /**
   * 5. broadcastMessage - 广播消息
   * @param {string} teamId - 团队 ID
   * @param {string} fromAgent - 发送者代理 ID
   * @param {Object} message - 消息内容
   * @returns {Promise<Object>} 广播结果
   */
  async broadcastMessage(teamId, fromAgent, message) {
    const team = this.teams.get(teamId);

    if (!team) {
      throw new Error(`团队不存在: ${teamId}`);
    }

    const messageObj = {
      id: `msg_${Date.now()}_${uuidv4().slice(0, 8)}`,
      teamId,
      from: fromAgent,
      to: null, // null 表示广播
      type: message.type || 'broadcast',
      content: message.content || message,
      timestamp: Date.now(),
      metadata: message.metadata || {},
    };

    // 添加到消息队列
    const queue = this.messageQueues.get(teamId);
    queue.push(messageObj);

    // 限制队列长度
    if (queue.length > 1000) {
      this.messageQueues.set(teamId, queue.slice(-500));
    }

    // 持久化到数据库
    if (this.db) {
      try {
        await this.db.run(
          `INSERT INTO cowork_messages (id, team_id, from_agent, to_agent, message, timestamp)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [messageObj.id, teamId, fromAgent, null, JSON.stringify(messageObj.content), messageObj.timestamp]
        );
      } catch (error) {
        this._log(`保存消息到数据库失败: ${error.message}`, 'error');
      }
    }

    // 保存消息文件
    const messageFile = path.join(
      this.options.dataDir,
      'teams',
      teamId,
      'messages',
      `${messageObj.id}.json`
    );
    await fs.writeFile(messageFile, JSON.stringify(messageObj, null, 2), 'utf-8');

    this._log(`广播消息: ${fromAgent} -> 团队 ${team.name}`);
    this.emit('message-broadcast', { teamId, message: messageObj });

    return {
      success: true,
      messageId: messageObj.id,
      recipientCount: team.agents.length - 1, // 排除发送者
    };
  }

  // ==========================================
  // 核心操作 6-10
  // ==========================================

  /**
   * 6. sendMessage - 发送消息给特定代理
   * @param {string} fromAgent - 发送者代理 ID
   * @param {string} toAgent - 接收者代理 ID
   * @param {Object} message - 消息内容
   * @returns {Promise<Object>} 发送结果
   */
  async sendMessage(fromAgent, toAgent, message) {
    const sender = this.agents.get(fromAgent);
    const receiver = this.agents.get(toAgent);

    if (!sender) {
      throw new Error(`发送者代理不存在: ${fromAgent}`);
    }

    if (!receiver) {
      throw new Error(`接收者代理不存在: ${toAgent}`);
    }

    if (sender.teamId !== receiver.teamId) {
      throw new Error('代理不在同一团队中');
    }

    const teamId = sender.teamId;
    const messageObj = {
      id: `msg_${Date.now()}_${uuidv4().slice(0, 8)}`,
      teamId,
      from: fromAgent,
      to: toAgent,
      type: message.type || 'direct',
      content: message.content || message,
      timestamp: Date.now(),
      metadata: message.metadata || {},
    };

    // 添加到消息队列
    const queue = this.messageQueues.get(teamId);
    queue.push(messageObj);

    // 持久化到数据库
    if (this.db) {
      try {
        await this.db.run(
          `INSERT INTO cowork_messages (id, team_id, from_agent, to_agent, message, timestamp)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [messageObj.id, teamId, fromAgent, toAgent, JSON.stringify(messageObj.content), messageObj.timestamp]
        );
      } catch (error) {
        this._log(`保存消息到数据库失败: ${error.message}`, 'error');
      }
    }

    this._log(`消息发送: ${fromAgent} -> ${toAgent}`);
    this.emit('message-sent', { message: messageObj });

    return {
      success: true,
      messageId: messageObj.id,
    };
  }

  /**
   * 7. voteOnDecision - 投票决策
   * @param {string} teamId - 团队 ID
   * @param {Object} decision - 决策对象
   * @param {Array} votes - 投票数组 [{agentId, vote}]
   * @returns {Promise<Object>} 投票结果
   */
  async voteOnDecision(teamId, decision, votes = []) {
    const team = this.teams.get(teamId);

    if (!team) {
      throw new Error(`团队不存在: ${teamId}`);
    }

    const decisionId = decision.id || `decision_${Date.now()}_${uuidv4().slice(0, 8)}`;

    // 统计投票
    const voteCount = {
      approve: 0,
      reject: 0,
      abstain: 0,
      total: votes.length,
    };

    for (const { agentId, vote } of votes) {
      if (!this.agents.has(agentId)) {
        this._log(`投票代理不存在: ${agentId}`, 'warn');
        continue;
      }

      if (vote === 'approve') voteCount.approve++;
      else if (vote === 'reject') voteCount.reject++;
      else voteCount.abstain++;
    }

    // 计算投票率和通过率
    const votingRate = team.agents.length > 0 ? voteCount.total / team.agents.length : 0;
    const approvalRate = voteCount.total > 0 ? voteCount.approve / voteCount.total : 0;
    const threshold = team.config.votingThreshold || 0.5;

    // 决定结果
    const passed = approvalRate >= threshold;

    const result = {
      decisionId,
      decision,
      votes: voteCount,
      votingRate,
      approvalRate,
      threshold,
      passed,
      timestamp: Date.now(),
    };

    this._log(`投票决策: ${decisionId}, 通过: ${passed}, 赞成率: ${(approvalRate * 100).toFixed(2)}%`);
    this.emit('decision-voted', { teamId, result });

    return result;
  }

  /**
   * 8. getTeamStatus - 获取团队状态
   * @param {string} teamId - 团队 ID
   * @returns {Promise<Object>} 团队状态
   */
  async getTeamStatus(teamId) {
    const team = this.teams.get(teamId);

    if (!team) {
      throw new Error(`团队不存在: ${teamId}`);
    }

    // 统计任务状态
    const taskStats = {
      total: team.tasks.length,
      pending: team.tasks.filter(t => t.status === 'pending').length,
      assigned: team.tasks.filter(t => t.status === 'assigned').length,
      running: team.tasks.filter(t => t.status === 'running').length,
      completed: team.tasks.filter(t => t.status === 'completed').length,
      failed: team.tasks.filter(t => t.status === 'failed').length,
    };

    // 统计代理状态
    const agentStats = {
      total: team.agents.length,
      idle: team.agents.filter(a => a.status === AgentStatus.IDLE).length,
      busy: team.agents.filter(a => a.status === AgentStatus.BUSY).length,
      waiting: team.agents.filter(a => a.status === AgentStatus.WAITING).length,
      terminated: team.agents.filter(a => a.status === AgentStatus.TERMINATED).length,
    };

    // 获取消息队列
    const messageQueue = this.messageQueues.get(teamId) || [];

    return {
      id: team.id,
      name: team.name,
      status: team.status,
      agents: team.agents.map(a => ({
        id: a.id,
        name: a.name,
        status: a.status,
        assignedTask: a.assignedTask,
      })),
      agentStats,
      tasks: team.tasks.map(t => ({
        id: t.id,
        description: t.description,
        status: t.status,
        assignedTo: t.assignedTo,
        priority: t.priority,
      })),
      taskStats,
      messageCount: messageQueue.length,
      uptime: Date.now() - team.metadata.createdAt,
      metadata: team.metadata,
    };
  }

  /**
   * 9. terminateAgent - 终止代理
   * @param {string} agentId - 代理 ID
   * @param {string} reason - 终止原因
   * @returns {Promise<Object>} 终止结果
   */
  async terminateAgent(agentId, reason = '') {
    const agent = this.agents.get(agentId);

    if (!agent) {
      throw new Error(`代理不存在: ${agentId}`);
    }

    const team = this.teams.get(agent.teamId);

    if (!team) {
      throw new Error(`团队不存在: ${agent.teamId}`);
    }

    // 更新代理状态
    agent.status = AgentStatus.TERMINATED;
    agent.metadata.terminatedAt = Date.now();
    agent.metadata.terminationReason = reason;

    // 如果有未完成的任务，标记为失败
    if (agent.assignedTask) {
      const task = team.tasks.find(t => t.id === agent.assignedTask);
      if (task && task.status !== 'completed') {
        task.status = 'failed';
        task.result = { error: `代理被终止: ${reason}` };
        task.completedAt = Date.now();
      }
      agent.assignedTask = null;
    }

    // 持久化到数据库
    if (this.db) {
      try {
        await this.db.run(
          `UPDATE cowork_agents SET status = ? WHERE id = ?`,
          [agent.status, agentId]
        );
      } catch (error) {
        this._log(`更新代理状态失败: ${error.message}`, 'error');
      }
    }

    this._log(`代理已终止: ${agentId}, 原因: ${reason}`);
    this.emit('agent-terminated', { agentId, reason, teamId: agent.teamId });

    return {
      success: true,
      agentId,
      reason,
    };
  }

  /**
   * 10. mergeResults - 合并结果
   * @param {string} teamId - 团队 ID
   * @param {Array} results - 结果数组
   * @param {Object} strategy - 合并策略
   * @returns {Promise<Object>} 合并后的结果
   */
  async mergeResults(teamId, results, strategy = {}) {
    const team = this.teams.get(teamId);

    if (!team) {
      throw new Error(`团队不存在: ${teamId}`);
    }

    const mergeType = strategy.type || 'aggregate';

    let mergedResult = null;

    switch (mergeType) {
      case 'aggregate':
        // 聚合所有结果
        mergedResult = {
          type: 'aggregate',
          results: results,
          count: results.length,
          timestamp: Date.now(),
        };
        break;

      case 'vote': {
        // 投票选择最佳结果
        const voteCounts = new Map();
        for (const result of results) {
          const key = JSON.stringify(result);
          voteCounts.set(key, (voteCounts.get(key) || 0) + 1);
        }
        const winner = Array.from(voteCounts.entries()).sort((a, b) => b[1] - a[1])[0];
        mergedResult = {
          type: 'vote',
          result: JSON.parse(winner[0]),
          votes: winner[1],
          totalResults: results.length,
          timestamp: Date.now(),
        };
        break;
      }

      case 'concatenate':
        // 连接所有结果
        mergedResult = {
          type: 'concatenate',
          result: results.map(r => r.result || r).join('\n\n'),
          count: results.length,
          timestamp: Date.now(),
        };
        break;

      case 'average': {
        // 计算平均值（适用于数值结果）
        const numbers = results.filter(r => typeof r === 'number' || typeof r.value === 'number');
        if (numbers.length > 0) {
          const sum = numbers.reduce((acc, r) => acc + (typeof r === 'number' ? r : r.value), 0);
          mergedResult = {
            type: 'average',
            result: sum / numbers.length,
            count: numbers.length,
            timestamp: Date.now(),
          };
        } else {
          mergedResult = {
            type: 'average',
            result: null,
            error: '没有数值结果可以平均',
            timestamp: Date.now(),
          };
        }
        break;
      }

      default:
        mergedResult = {
          type: 'unknown',
          results,
          timestamp: Date.now(),
        };
    }

    // 保存合并结果
    const resultFile = path.join(
      this.options.dataDir,
      'teams',
      teamId,
      'results',
      `merged_${Date.now()}.json`
    );
    await fs.writeFile(resultFile, JSON.stringify(mergedResult, null, 2), 'utf-8');

    this._log(`结果已合并: 团队 ${team.name}, 策略: ${mergeType}`);
    this.emit('results-merged', { teamId, mergedResult });

    return mergedResult;
  }

  // ==========================================
  // 核心操作 11-13
  // ==========================================

  /**
   * 11. createCheckpoint - 创建检查点
   * @param {string} teamId - 团队 ID
   * @param {Object} metadata - 元数据
   * @returns {Promise<Object>} 检查点信息
   */
  async createCheckpoint(teamId, metadata = {}) {
    const team = this.teams.get(teamId);

    if (!team) {
      throw new Error(`团队不存在: ${teamId}`);
    }

    const checkpointId = `checkpoint_${Date.now()}_${uuidv4().slice(0, 8)}`;

    const checkpoint = {
      id: checkpointId,
      teamId,
      team: JSON.parse(JSON.stringify(team)), // 深拷贝
      agents: team.agents.map(a => this.agents.get(a.id)),
      tasks: team.tasks,
      messageQueue: this.messageQueues.get(teamId).slice(), // 拷贝消息队列
      timestamp: Date.now(),
      metadata,
    };

    // 保存检查点
    const checkpointFile = path.join(
      this.options.dataDir,
      'checkpoints',
      `${checkpointId}.json`
    );
    await fs.writeFile(checkpointFile, JSON.stringify(checkpoint, null, 2), 'utf-8');

    this._log(`检查点已创建: ${checkpointId}`);
    this.emit('checkpoint-created', { teamId, checkpointId });

    return {
      id: checkpointId,
      teamId,
      timestamp: checkpoint.timestamp,
    };
  }

  /**
   * 12. listMembers - 列出团队成员
   * @param {string} teamId - 团队 ID
   * @returns {Promise<Array>} 成员列表
   */
  async listMembers(teamId) {
    const team = this.teams.get(teamId);

    if (!team) {
      throw new Error(`团队不存在: ${teamId}`);
    }

    return team.agents.map(a => ({
      id: a.id,
      name: a.name,
      status: a.status,
      capabilities: a.capabilities,
      assignedTask: a.assignedTask,
      joinedAt: a.metadata.joinedAt,
    }));
  }

  /**
   * 13. updateTeamConfig - 更新团队配置
   * @param {string} teamId - 团队 ID
   * @param {Object} config - 新配置
   * @returns {Promise<Object>} 更新结果
   */
  async updateTeamConfig(teamId, config) {
    const team = this.teams.get(teamId);

    if (!team) {
      throw new Error(`团队不存在: ${teamId}`);
    }

    // 合并配置
    team.config = {
      ...team.config,
      ...config,
    };

    team.metadata.updatedAt = Date.now();

    // 持久化
    await this._saveTeamConfig(team);

    this._log(`团队配置已更新: ${team.name}`);
    this.emit('team-config-updated', { teamId, config: team.config });

    return {
      success: true,
      teamId,
      config: team.config,
    };
  }

  // ==========================================
  // 辅助方法
  // ==========================================

  /**
   * 选择代理来执行任务
   * @private
   */
  _selectAgentForTask(team, task) {
    // 找到所有空闲的代理
    const idleAgents = team.agents.filter(a => a.status === AgentStatus.IDLE);

    if (idleAgents.length === 0) {
      throw new Error('没有空闲的代理');
    }

    // 简单策略：选择第一个空闲的代理
    // TODO: 可以根据代理的 capabilities 进行智能匹配
    return idleAgents[0].id;
  }

  /**
   * 保存团队配置
   * @private
   */
  async _saveTeamConfig(team) {
    const teamDir = path.join(this.options.dataDir, 'teams', team.id);
    const configFile = path.join(teamDir, 'config.json');

    try {
      await fs.writeFile(configFile, JSON.stringify(team, null, 2), 'utf-8');
    } catch (error) {
      this._log(`保存团队配置失败: ${error.message}`, 'error');
    }
  }

  /**
   * 日志输出
   * @private
   */
  _log(message, level = 'info') {
    if (this.options.enableLogging) {
      if (level === 'error') {
        logger.error(`[TeammateTool] ${message}`);
      } else if (level === 'warn') {
        logger.warn(`[TeammateTool] ${message}`);
      } else {
        logger.info(`[TeammateTool] ${message}`);
      }
    }
  }

  /**
   * 获取统计信息
   * @returns {Object}
   */
  getStats() {
    const activeTeams = Array.from(this.teams.values()).filter(
      t => t.status === TeamStatus.ACTIVE
    );

    return {
      totalTeams: this.teams.size,
      activeTeams: activeTeams.length,
      totalAgents: this.agents.size,
      activeAgents: Array.from(this.agents.values()).filter(
        a => a.status !== AgentStatus.TERMINATED
      ).length,
      totalTasks: activeTeams.reduce((sum, t) => sum + t.tasks.length, 0),
      completedTasks: activeTeams.reduce(
        (sum, t) => sum + t.tasks.filter(task => task.status === 'completed').length,
        0
      ),
    };
  }

  /**
   * 清理过期消息
   */
  async cleanupOldMessages() {
    const now = Date.now();
    const retention = this.options.messageRetention;

    for (const [teamId, messages] of this.messageQueues.entries()) {
      const filtered = messages.filter(m => now - m.timestamp < retention);
      this.messageQueues.set(teamId, filtered);
    }

    this._log('过期消息已清理');
  }

  /**
   * 销毁团队
   * @param {string} teamId - 团队 ID
   */
  async destroyTeam(teamId) {
    const team = this.teams.get(teamId);

    if (!team) {
      throw new Error(`团队不存在: ${teamId}`);
    }

    // 终止所有代理
    for (const agent of team.agents) {
      await this.terminateAgent(agent.id, '团队被销毁');
      this.agents.delete(agent.id);
    }

    // 清理数据
    this.teams.delete(teamId);
    this.messageQueues.delete(teamId);

    // 更新数据库
    if (this.db) {
      try {
        await this.db.run(`UPDATE cowork_teams SET status = ? WHERE id = ?`, ['destroyed', teamId]);
      } catch (error) {
        this._log(`更新团队状态失败: ${error.message}`, 'error');
      }
    }

    this._log(`团队已销毁: ${team.name}`);
    this.emit('team-destroyed', { teamId });

    return { success: true };
  }
}

module.exports = { TeammateTool, TeamStatus, AgentStatus };

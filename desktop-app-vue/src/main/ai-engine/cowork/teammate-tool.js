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

const { logger } = require("../../utils/logger.js");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const fs = require("fs").promises;
const EventEmitter = require("events");
const { AgentPool } = require("./agent-pool.js");

/**
 * 团队状态
 */
const TeamStatus = {
  ACTIVE: "active",
  PAUSED: "paused",
  COMPLETED: "completed",
  FAILED: "failed",
};

/**
 * 代理状态
 */
const AgentStatus = {
  IDLE: "idle",
  BUSY: "busy",
  WAITING: "waiting",
  TERMINATED: "terminated",
  REMOVED: "removed",
};

/**
 * TeammateTool 类
 */
class TeammateTool extends EventEmitter {
  constructor(dbOrOptions = {}) {
    super();

    // 兼容性：检测是否传入的是数据库对象（用于测试）
    let options = {};
    if (dbOrOptions && typeof dbOrOptions.run === "function") {
      // 传入的是数据库对象
      this.db = dbOrOptions;
    } else {
      // 传入的是选项对象
      options = dbOrOptions || {};
      this.db = null;
    }

    this.options = {
      // 数据存储路径
      dataDir:
        options.dataDir ||
        path.join(process.cwd(), ".chainlesschain", "cowork"),
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

    // 代理池（可选）
    this.useAgentPool = options.useAgentPool !== false; // 默认启用
    if (this.useAgentPool) {
      this.agentPool = new AgentPool({
        minSize: options.agentPoolMinSize || 3,
        maxSize: options.agentPoolMaxSize || 10,
        idleTimeout: options.agentPoolIdleTimeout || 300000,
        warmupOnInit: options.agentPoolWarmup !== false,
      });

      // 初始化代理池
      this.agentPool.initialize().catch((error) => {
        this._log(`代理池初始化失败: ${error.message}`, "error");
      });

      this._log("代理池已启用");
    } else {
      this.agentPool = null;
      this._log("代理池未启用，使用传统代理创建模式");
    }

    this._log("TeammateTool 已初始化");
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
      await fs.mkdir(path.join(this.options.dataDir, "teams"), {
        recursive: true,
      });
      await fs.mkdir(path.join(this.options.dataDir, "checkpoints"), {
        recursive: true,
      });
    } catch (error) {
      this._log(`初始化数据目录失败: ${error.message}`, "error");
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
    // 检查团队数量限制（不包括已归档的团队）
    const activeTeamsCount = Array.from(this.teams.values()).filter(
      (t) => t.status !== "archived",
    ).length;
    if (activeTeamsCount >= this.options.maxTeams) {
      throw new Error(`已达到最大团队数限制: ${this.options.maxTeams}`);
    }

    const teamId =
      config.teamId || `team_${Date.now()}_${uuidv4().slice(0, 8)}`;

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
        createdBy: config.createdBy || "system",
        description: config.description || "",
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
          [
            teamId,
            teamName,
            team.status,
            team.maxAgents,
            team.metadata.createdAt,
            JSON.stringify(team),
          ],
        );
      } catch (error) {
        this._log(`保存团队到数据库失败: ${error.message}`, "error");
        // Clean up in-memory state before re-throwing
        this.teams.delete(teamId);
        this.messageQueues.delete(teamId);
        throw error;
      }
    }

    // 保存到文件系统
    await this._ensureDataDir();
    const teamDir = path.join(this.options.dataDir, "teams", teamId);
    await fs.mkdir(teamDir, { recursive: true });
    await fs.mkdir(path.join(teamDir, "messages"), { recursive: true });
    await fs.mkdir(path.join(teamDir, "tasks"), { recursive: true });
    await fs.mkdir(path.join(teamDir, "results"), { recursive: true });

    // 写入配置文件
    await fs.writeFile(
      path.join(teamDir, "config.json"),
      JSON.stringify(team, null, 2),
      "utf-8",
    );

    this._log(`团队已创建: ${teamName} (${teamId})`);
    this.emit("team-spawned", { team });

    // 兼容性：测试期望 members 而不是 agents
    return {
      ...team,
      members: team.agents,
    };
  }

  /**
   * 2. discoverTeams - 发现团队
   * @param {Object} filters - 过滤条件
   * @returns {Promise<Array>} 团队列表
   */
  async discoverTeams(filters = {}) {
    let teams = Array.from(this.teams.values());

    // 兼容性：默认过滤掉archived团队
    if (!filters.includeArchived) {
      teams = teams.filter((t) => t.status !== "archived");
    }

    // 应用过滤条件
    if (filters.status) {
      teams = teams.filter((t) => t.status === filters.status);
    }

    if (filters.allowDynamicJoin !== undefined) {
      teams = teams.filter(
        (t) => t.config.allowDynamicJoin === filters.allowDynamicJoin,
      );
    }

    if (filters.maxAgents) {
      teams = teams.filter((t) => t.agents.length < t.maxAgents);
    }

    return teams.map((t) => ({
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
    if (team.agents.some((a) => a.id === agentId)) {
      throw new Error(`代理 ${agentId} 已在团队中`);
    }

    // 创建或获取代理对象
    let agent;

    if (this.useAgentPool && this.agentPool) {
      // 从代理池获取代理
      agent = await this.agentPool.acquireAgent({
        capabilities: agentInfo.capabilities || [],
        role: agentInfo.role || "worker",
        teamId,
      });

      // 更新代理信息
      agent.id = agentId; // 使用请求的agentId
      agent.name = agentInfo.name || agentId;
      agent.teamId = teamId;
      agent.status = AgentStatus.IDLE; // 重置状态为空闲
      agent.assignedTask = null;
      agent.metadata = {
        ...agent.metadata,
        joinedAt: Date.now(),
        ...agentInfo.metadata,
      };

      this._log(`从代理池获取代理: ${agentId} (复用次数: ${agent.reuseCount})`);
    } else {
      // 传统方式创建代理
      agent = {
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

      this._log(`创建新代理: ${agentId}`);
    }

    // 添加到团队
    team.agents.push(agent);
    this.agents.set(agentId, agent);

    // 持久化到数据库
    if (this.db) {
      try {
        await this.db.run(
          `INSERT INTO cowork_agents (id, team_id, name, status, created_at)
           VALUES (?, ?, ?, ?, ?)`,
          [agentId, teamId, agent.name, agent.status, agent.metadata.joinedAt],
        );
      } catch (error) {
        this._log(`保存代理到数据库失败: ${error.message}`, "error");
      }
    }

    // 更新团队配置文件
    await this._saveTeamConfig(team);

    this._log(`代理 ${agentId} 已加入团队 ${team.name}`);
    this.emit("agent-joined", { teamId, agent });

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
  async assignTask(teamId, agentIdOrTask, task) {
    // 检测调用模式：2参数 vs 3参数
    let agentId;

    if (arguments.length === 2 && typeof agentIdOrTask === "object") {
      // 2参数模式: assignTask(teamId, task)
      agentId = null; // 触发自动选择
      task = agentIdOrTask;
    } else {
      // 3参数模式: assignTask(teamId, agentId, task)
      agentId = agentIdOrTask;
    }

    const team = this.teams.get(teamId);

    if (!team) {
      throw new Error(`团队不存在: ${teamId}`);
    }

    // 创建任务对象
    const taskId = task.id || `task_${Date.now()}_${uuidv4().slice(0, 8)}`;
    const taskObj = {
      id: taskId,
      teamId,
      description: task.description || "",
      type: task.type || "general",
      priority: task.priority || 0,
      status: "pending",
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

    // 兼容性：2参数模式保持pending状态，3参数模式更新为assigned
    if (arguments.length !== 2) {
      taskObj.status = "assigned";
    }

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
          [
            taskId,
            teamId,
            taskObj.description,
            taskObj.status,
            taskObj.priority,
            agentId,
            taskObj.createdAt,
          ],
        );

        await this.db.run(
          `UPDATE cowork_agents SET status = ?, assigned_task = ? WHERE id = ?`,
          [agent.status, taskId, agentId],
        );
      } catch (error) {
        this._log(`保存任务到数据库失败: ${error.message}`, "error");
      }
    }

    // 保存任务文件
    const taskFile = path.join(
      this.options.dataDir,
      "teams",
      teamId,
      "tasks",
      `${taskId}.json`,
    );
    await fs.writeFile(taskFile, JSON.stringify(taskObj, null, 2), "utf-8");

    this._log(`任务 ${taskId} 已分配给代理 ${agentId}`);
    this.emit("task-assigned", { teamId, taskId, agentId, task: taskObj });

    // 兼容性：2参数模式返回task对象，3参数模式返回完整响应
    if (arguments.length === 2) {
      // 2参数模式 (测试API): 直接返回task对象
      return taskObj;
    }

    // 3参数模式 (原始API): 返回完整响应
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
      type: message.type || "broadcast",
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
          [
            messageObj.id,
            teamId,
            fromAgent,
            null,
            JSON.stringify(messageObj.content),
            messageObj.timestamp,
          ],
        );
      } catch (error) {
        this._log(`保存消息到数据库失败: ${error.message}`, "error");
      }
    }

    // 保存消息文件
    const messageFile = path.join(
      this.options.dataDir,
      "teams",
      teamId,
      "messages",
      `${messageObj.id}.json`,
    );
    await fs.writeFile(
      messageFile,
      JSON.stringify(messageObj, null, 2),
      "utf-8",
    );

    this._log(`广播消息: ${fromAgent} -> 团队 ${team.name}`);
    this.emit("message-broadcast", { teamId, message: messageObj });

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
      throw new Error("代理不在同一团队中");
    }

    const teamId = sender.teamId;
    const messageObj = {
      id: `msg_${Date.now()}_${uuidv4().slice(0, 8)}`,
      teamId,
      from: fromAgent,
      to: toAgent,
      type: message.type || "direct",
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
          [
            messageObj.id,
            teamId,
            fromAgent,
            toAgent,
            JSON.stringify(messageObj.content),
            messageObj.timestamp,
          ],
        );
      } catch (error) {
        this._log(`保存消息到数据库失败: ${error.message}`, "error");
      }
    }

    this._log(`消息发送: ${fromAgent} -> ${toAgent}`);
    this.emit("message-sent", { message: messageObj });

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

    const decisionId =
      decision.id || `decision_${Date.now()}_${uuidv4().slice(0, 8)}`;

    // 统计投票
    const voteCount = {
      approve: 0,
      reject: 0,
      abstain: 0,
      total: votes.length,
    };

    for (const { agentId, vote } of votes) {
      if (!this.agents.has(agentId)) {
        this._log(`投票代理不存在: ${agentId}`, "warn");
        continue;
      }

      if (vote === "approve") {
        voteCount.approve++;
      } else if (vote === "reject") {
        voteCount.reject++;
      } else {
        voteCount.abstain++;
      }
    }

    // 计算投票率和通过率
    const votingRate =
      team.agents.length > 0 ? voteCount.total / team.agents.length : 0;
    const approvalRate =
      voteCount.total > 0 ? voteCount.approve / voteCount.total : 0;
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

    this._log(
      `投票决策: ${decisionId}, 通过: ${passed}, 赞成率: ${(approvalRate * 100).toFixed(2)}%`,
    );
    this.emit("decision-voted", { teamId, result });

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
      pending: team.tasks.filter((t) => t.status === "pending").length,
      assigned: team.tasks.filter((t) => t.status === "assigned").length,
      running: team.tasks.filter((t) => t.status === "running").length,
      completed: team.tasks.filter((t) => t.status === "completed").length,
      failed: team.tasks.filter((t) => t.status === "failed").length,
    };

    // 统计代理状态
    const agentStats = {
      total: team.agents.length,
      idle: team.agents.filter((a) => a.status === AgentStatus.IDLE).length,
      busy: team.agents.filter((a) => a.status === AgentStatus.BUSY).length,
      waiting: team.agents.filter((a) => a.status === AgentStatus.WAITING)
        .length,
      terminated: team.agents.filter((a) => a.status === AgentStatus.TERMINATED)
        .length,
    };

    // 获取消息队列
    const messageQueue = this.messageQueues.get(teamId) || [];

    return {
      id: team.id,
      name: team.name,
      status: team.status,
      agents: team.agents.map((a) => ({
        id: a.id,
        name: a.name,
        status: a.status,
        assignedTask: a.assignedTask,
      })),
      agentStats,
      tasks: team.tasks.map((t) => ({
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
  async terminateAgent(agentId, reason = "") {
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
      const task = team.tasks.find((t) => t.id === agent.assignedTask);
      if (task && task.status !== "completed") {
        task.status = "failed";
        task.result = { error: `代理被终止: ${reason}` };
        task.completedAt = Date.now();
      }
      agent.assignedTask = null;
    }

    // 释放代理回池（如果启用代理池）
    if (this.useAgentPool && this.agentPool) {
      try {
        this.agentPool.releaseAgent(agentId);
        this._log(`代理已释放回池: ${agentId}`, "debug");
      } catch (error) {
        this._log(`释放代理回池失败: ${error.message}`, "error");
      }
    }

    // 持久化到数据库
    if (this.db) {
      try {
        await this.db.run(`UPDATE cowork_agents SET status = ? WHERE id = ?`, [
          agent.status,
          agentId,
        ]);
      } catch (error) {
        this._log(`更新代理状态失败: ${error.message}`, "error");
      }
    }

    this._log(`代理已终止: ${agentId}, 原因: ${reason}`);
    this.emit("agent-terminated", { agentId, reason, teamId: agent.teamId });

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

    const mergeType = strategy.type || "aggregate";

    let mergedResult = null;

    switch (mergeType) {
      case "aggregate":
        // 聚合所有结果
        mergedResult = {
          type: "aggregate",
          results: results,
          count: results.length,
          timestamp: Date.now(),
        };
        break;

      case "vote": {
        // 投票选择最佳结果
        const voteCounts = new Map();
        for (const result of results) {
          const key = JSON.stringify(result);
          voteCounts.set(key, (voteCounts.get(key) || 0) + 1);
        }
        const winner = Array.from(voteCounts.entries()).sort(
          (a, b) => b[1] - a[1],
        )[0];
        mergedResult = {
          type: "vote",
          result: JSON.parse(winner[0]),
          votes: winner[1],
          totalResults: results.length,
          timestamp: Date.now(),
        };
        break;
      }

      case "concatenate":
        // 连接所有结果
        mergedResult = {
          type: "concatenate",
          result: results.map((r) => r.result || r).join("\n\n"),
          count: results.length,
          timestamp: Date.now(),
        };
        break;

      case "average": {
        // 计算平均值（适用于数值结果）
        const numbers = results.filter(
          (r) => typeof r === "number" || typeof r.value === "number",
        );
        if (numbers.length > 0) {
          const sum = numbers.reduce(
            (acc, r) => acc + (typeof r === "number" ? r : r.value),
            0,
          );
          mergedResult = {
            type: "average",
            result: sum / numbers.length,
            count: numbers.length,
            timestamp: Date.now(),
          };
        } else {
          mergedResult = {
            type: "average",
            result: null,
            error: "没有数值结果可以平均",
            timestamp: Date.now(),
          };
        }
        break;
      }

      default:
        mergedResult = {
          type: "unknown",
          results,
          timestamp: Date.now(),
        };
    }

    // 保存合并结果
    const resultFile = path.join(
      this.options.dataDir,
      "teams",
      teamId,
      "results",
      `merged_${Date.now()}.json`,
    );
    await fs.writeFile(
      resultFile,
      JSON.stringify(mergedResult, null, 2),
      "utf-8",
    );

    this._log(`结果已合并: 团队 ${team.name}, 策略: ${mergeType}`);
    this.emit("results-merged", { teamId, mergedResult });

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
      agents: team.agents.map((a) => this.agents.get(a.id)),
      tasks: team.tasks,
      messageQueue: this.messageQueues.get(teamId).slice(), // 拷贝消息队列
      timestamp: Date.now(),
      metadata,
    };

    // 保存检查点到团队
    if (!team.checkpoints) {
      team.checkpoints = [];
    }
    team.checkpoints.push(checkpoint);

    // 保存检查点到文件
    const checkpointFile = path.join(
      this.options.dataDir,
      "checkpoints",
      `${checkpointId}.json`,
    );
    await fs.writeFile(
      checkpointFile,
      JSON.stringify(checkpoint, null, 2),
      "utf-8",
    );

    this._log(`检查点已创建: ${checkpointId}`);
    this.emit("checkpoint-created", { teamId, checkpointId });

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

    return team.agents.map((a) => ({
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
    this.emit("team-config-updated", { teamId, config: team.config });

    return {
      success: true,
      teamId,
      config: team.config,
    };
  }

  /**
   * 14. pauseTeam - 暂停团队
   * @param {string} teamId - 团队 ID
   * @returns {Promise<Object>} 暂停结果
   */
  async pauseTeam(teamId) {
    const team = this.teams.get(teamId);

    if (!team) {
      throw new Error(`团队不存在: ${teamId}`);
    }

    if (team.status === TeamStatus.PAUSED) {
      return {
        success: true,
        message: "团队已处于暂停状态",
        teamId,
        status: team.status,
      };
    }

    if (team.status !== TeamStatus.ACTIVE) {
      throw new Error(`无法暂停状态为 ${team.status} 的团队`);
    }

    // 更新状态
    team.status = TeamStatus.PAUSED;
    team.metadata.pausedAt = Date.now();
    team.metadata.updatedAt = Date.now();

    // 暂停所有正在执行的任务
    for (const task of team.tasks) {
      if (task.status === "running") {
        task.status = "paused";
        task.pausedAt = Date.now();
      }
    }

    // 持久化
    await this._saveTeamConfig(team);

    this._log(`团队已暂停: ${team.name}`);
    this.emit("team-paused", { teamId, team });

    return {
      success: true,
      teamId,
      status: team.status,
      message: "团队已暂停",
    };
  }

  /**
   * 15. resumeTeam - 恢复团队
   * @param {string} teamId - 团队 ID
   * @returns {Promise<Object>} 恢复结果
   */
  async resumeTeam(teamId) {
    const team = this.teams.get(teamId);

    if (!team) {
      throw new Error(`团队不存在: ${teamId}`);
    }

    if (team.status === TeamStatus.ACTIVE) {
      return {
        success: true,
        message: "团队已处于活跃状态",
        teamId,
        status: team.status,
      };
    }

    if (team.status !== TeamStatus.PAUSED) {
      throw new Error(`无法恢复状态为 ${team.status} 的团队`);
    }

    // 计算暂停时长
    const pauseDuration = team.metadata.pausedAt
      ? Date.now() - team.metadata.pausedAt
      : 0;

    // 更新状态
    team.status = TeamStatus.ACTIVE;
    team.metadata.resumedAt = Date.now();
    team.metadata.updatedAt = Date.now();
    team.metadata.totalPauseDuration =
      (team.metadata.totalPauseDuration || 0) + pauseDuration;

    // 恢复所有暂停的任务
    for (const task of team.tasks) {
      if (task.status === "paused") {
        task.status = "running";
        task.resumedAt = Date.now();
      }
    }

    // 持久化
    await this._saveTeamConfig(team);

    this._log(`团队已恢复: ${team.name}`);
    this.emit("team-resumed", { teamId, team, pauseDuration });

    return {
      success: true,
      teamId,
      status: team.status,
      pauseDuration,
      message: "团队已恢复",
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
    const idleAgents = team.agents.filter((a) => a.status === AgentStatus.IDLE);

    if (idleAgents.length === 0) {
      throw new Error("没有空闲的代理");
    }

    // 根据任务类型和代理能力进行智能匹配
    const taskType = task.type || 'general';
    const taskDescription = (task.description || '').toLowerCase();

    // 计算每个代理的匹配分数
    const scoredAgents = idleAgents.map(agent => {
      let score = 0;
      const capabilities = agent.capabilities || [];

      // 1. 直接匹配任务类型
      if (capabilities.includes(taskType)) {
        score += 10;
      }

      // 2. 关键词匹配
      const keywordMatches = {
        'code': ['coding', 'programming', 'development', 'code-review'],
        'test': ['testing', 'qa', 'quality-assurance'],
        'doc': ['documentation', 'writing', 'docs'],
        'design': ['design', 'ui', 'ux'],
        'analysis': ['analysis', 'research', 'data'],
        'review': ['review', 'code-review', 'audit']
      };

      for (const [keyword, relatedCapabilities] of Object.entries(keywordMatches)) {
        if (taskDescription.includes(keyword)) {
          for (const cap of relatedCapabilities) {
            if (capabilities.includes(cap)) {
              score += 5;
            }
          }
        }
      }

      // 3. 通用能力加分
      if (capabilities.includes('general') || capabilities.includes('all')) {
        score += 2;
      }

      return { agent, score };
    });

    // 按分数排序，选择最高分的代理
    scoredAgents.sort((a, b) => b.score - a.score);

    // 如果没有匹配（所有分数为0），返回第一个空闲代理
    return scoredAgents[0].agent.id;
  }

  /**
   * 保存团队配置
   * @private
   */
  async _saveTeamConfig(team) {
    const teamDir = path.join(this.options.dataDir, "teams", team.id);
    const configFile = path.join(teamDir, "config.json");

    try {
      await fs.writeFile(configFile, JSON.stringify(team, null, 2), "utf-8");
    } catch (error) {
      this._log(`保存团队配置失败: ${error.message}`, "error");
    }
  }

  /**
   * 日志输出
   * @private
   */
  _log(message, level = "info") {
    if (this.options.enableLogging) {
      if (level === "error") {
        logger.error(`[TeammateTool] ${message}`);
      } else if (level === "warn") {
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
      (t) => t.status === TeamStatus.ACTIVE,
    );

    return {
      totalTeams: this.teams.size,
      activeTeams: activeTeams.length,
      totalAgents: this.agents.size,
      activeAgents: Array.from(this.agents.values()).filter(
        (a) => a.status !== AgentStatus.TERMINATED,
      ).length,
      totalTasks: activeTeams.reduce((sum, t) => sum + t.tasks.length, 0),
      completedTasks: activeTeams.reduce(
        (sum, t) =>
          sum + t.tasks.filter((task) => task.status === "completed").length,
        0,
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
      const filtered = messages.filter((m) => now - m.timestamp < retention);
      this.messageQueues.set(teamId, filtered);
    }

    this._log("过期消息已清理");
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

    // 终止所有代理（保留在Map中用于审计）
    for (const agent of team.agents) {
      await this.terminateAgent(agent.id, "团队被销毁");
      // 更新代理状态为removed
      agent.status = "removed";
      // 同步更新agents Map中的代理状态
      const agentInMap = this.agents.get(agent.id);
      if (agentInMap) {
        agentInMap.status = "removed";
      }
      // 更新数据库中的代理状态
      if (this.db) {
        try {
          await this.db.run(
            `UPDATE cowork_agents SET status = ? WHERE id = ?`,
            ["removed", agent.id],
          );
        } catch (error) {
          this._log(`更新代理状态失败: ${error.message}`, "error");
        }
      }
    }

    // 设置为archived状态（保留在Map中用于审计/历史查询）
    team.status = "archived";

    // 清理消息队列
    this.messageQueues.delete(teamId);

    // 更新数据库
    if (this.db) {
      try {
        await this.db.run(`UPDATE cowork_teams SET status = ? WHERE id = ?`, [
          "archived",
          teamId,
        ]);
      } catch (error) {
        this._log(`更新团队状态失败: ${error.message}`, "error");
      }
    }

    this._log(`团队已销毁: ${team.name}`);
    this.emit("team-destroyed", { teamId });

    return { success: true };
  }

  // ==========================================
  // API 兼容层（用于测试）
  // ==========================================

  /**
   * 添加代理到团队（别名：requestJoin）
   * @param {string} teamId - 团队ID
   * @param {object} agentInfo - 代理信息
   * @returns {Promise<object>} 代理对象
   */
  async addAgent(teamId, agentInfo = {}) {
    const agentId = `agent_${Date.now()}_${require("uuid").v4().slice(0, 8)}`;
    const result = await this.requestJoin(teamId, agentId, agentInfo);

    // 返回格式与测试期望一致
    return {
      id: agentId,
      teamId,
      name: agentInfo.name || "Agent",
      status: "active",
      capabilities: agentInfo.capabilities || [],
      role: agentInfo.role || "member",
      ...result,
    };
  }

  /**
   * 列出所有团队（别名：discoverTeams）
   * @param {object} filters - 筛选条件
   * @returns {Promise<Array>} 团队列表
   */
  async listTeams(filters = {}) {
    return await this.discoverTeams(filters);
  }

  /**
   * 解散团队（别名：destroyTeam）
   * @param {string} teamId - 团队ID
   * @returns {Promise<object>} 结果
   */
  async disbandTeam(teamId) {
    return await this.destroyTeam(teamId);
  }

  /**
   * 获取团队（别名：getTeamStatus）
   * @param {string} teamId - 团队ID
   * @returns {Promise<object>} 团队对象
   */
  async getTeam(teamId) {
    const status = await this.getTeamStatus(teamId);
    // 确保返回包含 members 和 tasks
    const team = this.teams.get(teamId);
    if (team) {
      return {
        ...status,
        members: team.agents || [],
        tasks: team.tasks || [],
      };
    }
    return status;
  }

  /**
   * 获取代理信息
   * @param {string} agentId - 代理ID
   * @returns {Promise<object>} 代理对象
   */
  async getAgent(agentId) {
    const agent = this.agents.get(agentId);

    if (!agent) {
      throw new Error(`代理不存在: ${agentId}`);
    }

    // 从数据库获取最新状态
    if (this.db) {
      try {
        const row = await this.db.get(
          `SELECT * FROM cowork_agents WHERE id = ?`,
          [agentId],
        );

        if (row) {
          return {
            id: row.id,
            teamId: row.team_id,
            name: row.name,
            status: row.status,
            assignedTask: row.assigned_task,
            createdAt: row.created_at,
            terminatedAt: row.terminated_at,
            metadata: row.metadata ? JSON.parse(row.metadata) : {},
          };
        }
      } catch (error) {
        this._log(`获取代理失败: ${error.message}`, "error");
      }
    }

    return agent;
  }

  /**
   * 获取任务信息
   * @param {string} taskId - 任务ID
   * @returns {Promise<object>} 任务对象
   */
  async getTask(taskId) {
    // 从数据库获取任务
    if (this.db) {
      try {
        const row = await this.db.get(
          `SELECT * FROM cowork_tasks WHERE id = ?`,
          [taskId],
        );

        if (row) {
          return {
            id: row.id,
            teamId: row.team_id,
            description: row.description,
            status: row.status,
            priority: row.priority,
            assignedTo: row.assigned_to,
            result: row.result ? JSON.parse(row.result) : null,
            createdAt: row.created_at,
            completedAt: row.completed_at,
            metadata: row.metadata ? JSON.parse(row.metadata) : {},
          };
        }
      } catch (error) {
        this._log(`获取任务失败: ${error.message}`, "error");
      }
    }

    throw new Error(`任务不存在: ${taskId}`);
  }

  /**
   * 更新任务状态
   * @param {string} taskId - 任务ID
   * @param {string} status - 新状态
   * @param {object} result - 结果数据
   * @returns {Promise<object>} 更新后的任务
   */
  async updateTaskStatus(taskId, status, result = {}) {
    if (this.db) {
      try {
        const now = Date.now();

        // Get the task first to find the assigned agent
        const task = await this.getTask(taskId);

        const updates = ["status = ?"];
        const values = [status];

        if (result && Object.keys(result).length > 0) {
          updates.push("result = ?");
          values.push(JSON.stringify(result));
        }

        if (status === "completed" || status === "failed") {
          updates.push("completed_at = ?");
          values.push(now);
        }

        values.push(taskId);

        await this.db.run(
          `UPDATE cowork_tasks SET ${updates.join(", ")} WHERE id = ?`,
          values,
        );

        // Release the assigned agent when task completes or fails
        if (
          (status === "completed" || status === "failed") &&
          task.assignedTo
        ) {
          const agentId = task.assignedTo;

          // Update agent status to idle and clear assigned task
          await this.db.run(
            `UPDATE cowork_agents SET status = ?, assigned_task = NULL WHERE id = ?`,
            ["idle", agentId],
          );

          // Update in-memory agent if it exists
          const agent = this.agents.get(agentId);
          if (agent) {
            agent.status = AgentStatus.IDLE;
            agent.assignedTask = null;
          }

          // Release agent back to pool
          if (this.useAgentPool && this.agentPool) {
            try {
              this.agentPool.releaseAgent(agentId);
              this._log(`代理已释放回池: ${agentId}`, "debug");
            } catch (error) {
              this._log(`释放代理回池失败: ${error.message}`, "error");
            }
          }

          this._log(`代理 ${agentId} 已释放（任务${status}）`);
        }

        return await this.getTask(taskId);
      } catch (error) {
        this._log(`更新任务状态失败: ${error.message}`, "error");
        throw error;
      }
    }

    throw new Error("数据库未初始化");
  }

  /**
   * 获取团队指标（兼容测试API）
   * @param {string} teamId - 团队ID
   * @returns {Promise<object>} 指标数据
   */
  async getMetrics(teamId) {
    if (!teamId) {
      return this.getStats();
    }

    // 获取特定团队的指标
    if (this.db) {
      try {
        // 获取任务统计
        const taskStats = await this.db.get(
          `SELECT
            COUNT(*) as total,
            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
          FROM cowork_tasks WHERE team_id = ?`,
          [teamId],
        );

        const tasksCompleted = taskStats?.completed || 0;
        const tasksFailed = taskStats?.failed || 0;
        const tasksTotal = taskStats?.total || 0;
        const successRate =
          tasksTotal > 0 ? Math.round((tasksCompleted / tasksTotal) * 100) : 0;

        return {
          teamId,
          tasksCompleted,
          tasksFailed,
          tasksTotal,
          successRate,
        };
      } catch (error) {
        this._log(`获取团队指标失败: ${error.message}`, "error");
      }
    }

    return {
      teamId,
      tasksCompleted: 0,
      tasksFailed: 0,
      tasksTotal: 0,
      successRate: 0,
    };
  }

  /**
   * 清理资源（销毁代理池等）
   */
  async cleanup() {
    this._log("[TeammateTool] 开始清理资源...");

    // 清理代理池
    if (this.useAgentPool && this.agentPool) {
      try {
        const poolStats = this.agentPool.getStats();
        this._log(
          `[TeammateTool] 代理池统计: 创建=${poolStats.created}, 复用=${poolStats.reused}, 复用率=${poolStats.reuseRate}%`,
        );

        await this.agentPool.clear();
        this._log("[TeammateTool] 代理池已清理");
      } catch (error) {
        this._log(`清理代理池失败: ${error.message}`, "error");
      }
    }

    // 清理消息队列定时器
    if (this.messageCleanupTimer) {
      clearInterval(this.messageCleanupTimer);
      this.messageCleanupTimer = null;
    }

    this._log("[TeammateTool] ✅ 资源清理完成");
  }

  /**
   * 获取代理池状态（调试用）
   */
  getAgentPoolStatus() {
    if (!this.useAgentPool || !this.agentPool) {
      return { enabled: false };
    }

    return {
      enabled: true,
      status: this.agentPool.getStatus(),
      stats: this.agentPool.getStats(),
    };
  }
}

module.exports = { TeammateTool, TeamStatus, AgentStatus };

/**
 * P2P Agent Network — v2.0.0
 *
 * Cross-device agent communication layer built on WebRTC DataChannel
 * and MobileBridge infrastructure. Manages remote agent registration,
 * task forwarding, result collection, and heartbeat monitoring across
 * Desktop / Android / iOS devices.
 *
 * @module ai-engine/cowork/p2p-agent-network
 */

const EventEmitter = require("events");
const { logger } = require("../../utils/logger.js");
const { v4: uuidv4 } = require("uuid");

/**
 * Message types for the P2P agent protocol
 */
const P2P_MSG_TYPES = {
  // Discovery & registration
  AGENT_ANNOUNCE: "cowork:agent-announce",
  AGENT_DEPART: "cowork:agent-depart",
  AGENT_HEARTBEAT: "cowork:agent-heartbeat",

  // Task delegation
  TASK_DELEGATE: "cowork:task-delegate",
  TASK_ACCEPT: "cowork:task-accept",
  TASK_REJECT: "cowork:task-reject",
  TASK_PROGRESS: "cowork:task-progress",
  TASK_RESULT: "cowork:task-result",
  TASK_CANCEL: "cowork:task-cancel",

  // Skill queries
  SKILL_QUERY: "cowork:skill-query",
  SKILL_RESPONSE: "cowork:skill-response",

  // Team coordination
  TEAM_SYNC: "cowork:team-sync",
  TEAM_INVITE: "cowork:team-invite",
  TEAM_INVITE_RESPONSE: "cowork:team-invite-response",
};

/**
 * Remote agent states
 */
const REMOTE_AGENT_STATES = {
  ONLINE: "online",
  BUSY: "busy",
  OFFLINE: "offline",
  UNREACHABLE: "unreachable",
};

/**
 * Default configuration
 */
const DEFAULTS = {
  heartbeatInterval: 30000, // 30s
  heartbeatTimeout: 90000, // 3 missed heartbeats
  taskDelegateTimeout: 60000, // 60s for accept/reject
  maxPendingTasks: 50,
  maxRemoteAgents: 50,
  retryAttempts: 3,
  retryDelay: 5000,
};

/**
 * P2PAgentNetwork — Cross-device agent communication
 */
class P2PAgentNetwork extends EventEmitter {
  /**
   * @param {Object} options
   * @param {Object} options.mobileBridge - MobileBridge instance
   * @param {Object} options.teammateTool - TeammateTool instance
   * @param {Object} options.skillRegistry - SkillRegistry instance
   * @param {Object} options.config - Override defaults
   */
  constructor(options = {}) {
    super();
    this.mobileBridge = options.mobileBridge || null;
    this.teammateTool = options.teammateTool || null;
    this.skillRegistry = options.skillRegistry || null;
    this.db = options.database || null;

    this.config = { ...DEFAULTS, ...options.config };
    this.initialized = false;

    // Remote agent registry: peerId → agent info
    this.remoteAgents = new Map();

    // Pending delegated tasks: taskId → { peerId, task, resolve, reject, timer }
    this.pendingDelegations = new Map();

    // Active remote tasks: taskId → { peerId, task, progress }
    this.activeRemoteTasks = new Map();

    // Local device info (advertised to peers)
    this.localDeviceInfo = null;

    // Heartbeat timer
    this._heartbeatTimer = null;
    this._heartbeatCheckTimer = null;
  }

  /**
   * Initialize the P2P agent network
   * @param {Object} localDevice - { deviceId, platform, skills[], resources }
   */
  async initialize(localDevice = {}) {
    if (this.initialized) {
      logger.warn("[P2PAgentNetwork] Already initialized");
      return;
    }

    this.localDeviceInfo = {
      deviceId: localDevice.deviceId || `device-${uuidv4().slice(0, 8)}`,
      platform: localDevice.platform || process.platform,
      skills: localDevice.skills || this._getLocalSkillList(),
      resources: localDevice.resources || this._getLocalResources(),
      version: "2.0.0",
      startedAt: new Date().toISOString(),
    };

    // Listen for P2P messages from MobileBridge
    if (this.mobileBridge) {
      this.mobileBridge.on("message-from-mobile", (peerId, data) => {
        this._handlePeerMessage(peerId, data);
      });

      this.mobileBridge.on("peer-connected", (peerId) => {
        this._onPeerConnected(peerId);
      });

      this.mobileBridge.on("peer-disconnected", (peerId) => {
        this._onPeerDisconnected(peerId);
      });
    }

    // Start heartbeat
    this._startHeartbeat();

    // Ensure DB tables
    if (this.db) {
      this._ensureTables();
    }

    this.initialized = true;
    logger.info(
      `[P2PAgentNetwork] Initialized — device: ${this.localDeviceInfo.deviceId}, platform: ${this.localDeviceInfo.platform}`,
    );
    this.emit("initialized", this.localDeviceInfo);
  }

  // ============================================================
  // Agent Discovery & Registration
  // ============================================================

  /**
   * Announce local agent capabilities to all connected peers
   */
  async announcePresence() {
    const message = {
      type: P2P_MSG_TYPES.AGENT_ANNOUNCE,
      payload: {
        device: this.localDeviceInfo,
        timestamp: Date.now(),
      },
    };

    await this._broadcastToPeers(message);
    logger.info("[P2PAgentNetwork] Presence announced to all peers");
  }

  /**
   * Register a remote agent from peer announcement
   * @param {string} peerId - Peer identifier
   * @param {Object} deviceInfo - Remote device capabilities
   */
  registerRemoteAgent(peerId, deviceInfo) {
    if (this.remoteAgents.size >= this.config.maxRemoteAgents) {
      logger.warn(
        `[P2PAgentNetwork] Max remote agents reached (${this.config.maxRemoteAgents})`,
      );
      return null;
    }

    const agent = {
      peerId,
      deviceId: deviceInfo.deviceId,
      platform: deviceInfo.platform,
      skills: deviceInfo.skills || [],
      resources: deviceInfo.resources || {},
      state: REMOTE_AGENT_STATES.ONLINE,
      lastHeartbeat: Date.now(),
      registeredAt: new Date().toISOString(),
      taskCount: 0,
    };

    this.remoteAgents.set(peerId, agent);

    // Persist to DB
    if (this.db) {
      this._persistRemoteAgent(agent);
    }

    this.emit("remote-agent-registered", agent);
    logger.info(
      `[P2PAgentNetwork] Remote agent registered: ${peerId} (${deviceInfo.platform}, ${(deviceInfo.skills || []).length} skills)`,
    );

    return agent;
  }

  /**
   * Unregister a remote agent
   * @param {string} peerId
   * @param {string} reason
   */
  unregisterRemoteAgent(peerId, reason = "departed") {
    const agent = this.remoteAgents.get(peerId);
    if (!agent) {
      return;
    }

    agent.state = REMOTE_AGENT_STATES.OFFLINE;
    this.remoteAgents.delete(peerId);

    // Fail any pending delegations to this peer
    for (const [taskId, delegation] of this.pendingDelegations) {
      if (delegation.peerId === peerId) {
        clearTimeout(delegation.timer);
        delegation.reject(
          new Error(`Remote agent ${peerId} disconnected: ${reason}`),
        );
        this.pendingDelegations.delete(taskId);
      }
    }

    // Mark active remote tasks as failed
    for (const [taskId, remoteTask] of this.activeRemoteTasks) {
      if (remoteTask.peerId === peerId) {
        this.activeRemoteTasks.delete(taskId);
        this.emit("remote-task-failed", {
          taskId,
          peerId,
          error: `Agent disconnected: ${reason}`,
        });
      }
    }

    this.emit("remote-agent-unregistered", { peerId, reason });
    logger.info(
      `[P2PAgentNetwork] Remote agent unregistered: ${peerId} (${reason})`,
    );
  }

  /**
   * Get all online remote agents
   * @param {Object} filters - { platform, skills, state }
   * @returns {Object[]}
   */
  getRemoteAgents(filters = {}) {
    let agents = Array.from(this.remoteAgents.values());

    if (filters.state) {
      agents = agents.filter((a) => a.state === filters.state);
    }
    if (filters.platform) {
      agents = agents.filter((a) => a.platform === filters.platform);
    }
    if (filters.skill) {
      agents = agents.filter(
        (a) => a.skills && a.skills.some((s) => s.name === filters.skill),
      );
    }

    return agents;
  }

  /**
   * Find remote agents capable of a specific skill
   * @param {string} skillId - Skill identifier
   * @returns {Object[]} Matching agents sorted by suitability
   */
  findAgentsForSkill(skillId) {
    const candidates = [];

    for (const [peerId, agent] of this.remoteAgents) {
      if (agent.state !== REMOTE_AGENT_STATES.ONLINE) {
        continue;
      }

      const skill = (agent.skills || []).find(
        (s) => s.name === skillId || s.id === skillId,
      );
      if (skill) {
        candidates.push({
          peerId,
          agent,
          skill,
          score: this._scoreAgent(agent, skillId),
        });
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    return candidates;
  }

  // ============================================================
  // Task Delegation
  // ============================================================

  /**
   * Delegate a task to a remote agent
   * @param {string} peerId - Target peer
   * @param {Object} task - Task definition { id, description, skillId, input, priority, timeout }
   * @returns {Promise<Object>} Task result
   */
  async delegateTask(peerId, task) {
    const agent = this.remoteAgents.get(peerId);
    if (!agent) {
      throw new Error(`Remote agent not found: ${peerId}`);
    }
    if (agent.state !== REMOTE_AGENT_STATES.ONLINE) {
      throw new Error(`Remote agent not available: ${peerId} (${agent.state})`);
    }

    const taskId = task.id || `rtask-${uuidv4().slice(0, 12)}`;
    const delegationMsg = {
      type: P2P_MSG_TYPES.TASK_DELEGATE,
      payload: {
        taskId,
        description: task.description,
        skillId: task.skillId,
        input: task.input || {},
        priority: task.priority || "MEDIUM",
        timeout: task.timeout || 300000,
        delegatedBy: this.localDeviceInfo.deviceId,
        delegatedAt: Date.now(),
      },
    };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingDelegations.delete(taskId);
        reject(
          new Error(
            `Task delegation timeout after ${this.config.taskDelegateTimeout}ms`,
          ),
        );
      }, this.config.taskDelegateTimeout);

      this.pendingDelegations.set(taskId, {
        peerId,
        task: delegationMsg.payload,
        resolve,
        reject,
        timer,
        createdAt: Date.now(),
      });

      this._sendToPeer(peerId, delegationMsg).catch((err) => {
        clearTimeout(timer);
        this.pendingDelegations.delete(taskId);
        reject(new Error(`Failed to send delegation: ${err.message}`));
      });

      agent.taskCount++;
      this.emit("task-delegated", {
        taskId,
        peerId,
        task: delegationMsg.payload,
      });
      logger.info(
        `[P2PAgentNetwork] Task delegated: ${taskId} → ${peerId} (skill: ${task.skillId})`,
      );
    });
  }

  /**
   * Cancel a delegated task
   * @param {string} taskId
   */
  async cancelDelegatedTask(taskId) {
    const delegation = this.pendingDelegations.get(taskId);
    const remoteTask = this.activeRemoteTasks.get(taskId);
    const peerId = delegation?.peerId || remoteTask?.peerId;

    if (!peerId) {
      throw new Error(`Delegated task not found: ${taskId}`);
    }

    await this._sendToPeer(peerId, {
      type: P2P_MSG_TYPES.TASK_CANCEL,
      payload: { taskId },
    });

    if (delegation) {
      clearTimeout(delegation.timer);
      delegation.reject(new Error("Task cancelled by delegator"));
      this.pendingDelegations.delete(taskId);
    }

    this.activeRemoteTasks.delete(taskId);
    this.emit("remote-task-cancelled", { taskId, peerId });
    logger.info(`[P2PAgentNetwork] Delegated task cancelled: ${taskId}`);
  }

  // ============================================================
  // Skill Queries
  // ============================================================

  /**
   * Query remote peers for a specific skill
   * @param {string} skillId
   * @param {number} timeout - ms to wait for responses
   * @returns {Promise<Object[]>} Responding peers with skill info
   */
  async queryRemoteSkill(skillId, timeout = 10000) {
    const queryId = `sq-${uuidv4().slice(0, 8)}`;
    const responses = [];

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.removeAllListeners(`skill-response:${queryId}`);
        resolve(responses);
      }, timeout);

      this.on(`skill-response:${queryId}`, (response) => {
        responses.push(response);
      });

      this._broadcastToPeers({
        type: P2P_MSG_TYPES.SKILL_QUERY,
        payload: { queryId, skillId },
      }).catch(() => {
        clearTimeout(timer);
        resolve(responses);
      });
    });
  }

  // ============================================================
  // Team Coordination
  // ============================================================

  /**
   * Invite a remote agent to join a local team
   * @param {string} peerId - Remote peer
   * @param {string} teamId - Local team
   * @param {Object} role - Agent role in team
   * @returns {Promise<boolean>} Whether invitation was accepted
   */
  async inviteToTeam(peerId, teamId, role = {}) {
    const agent = this.remoteAgents.get(peerId);
    if (!agent) {
      throw new Error(`Remote agent not found: ${peerId}`);
    }

    const inviteId = `inv-${uuidv4().slice(0, 8)}`;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.removeAllListeners(`team-invite-response:${inviteId}`);
        reject(new Error("Team invitation timed out"));
      }, 30000);

      this.once(`team-invite-response:${inviteId}`, (response) => {
        clearTimeout(timer);
        resolve(response.accepted);
      });

      this._sendToPeer(peerId, {
        type: P2P_MSG_TYPES.TEAM_INVITE,
        payload: {
          inviteId,
          teamId,
          role,
          teamInfo: this.teammateTool ? { name: teamId } : {},
        },
      }).catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  /**
   * Sync team state to remote participants
   * @param {string} teamId
   * @param {Object} teamState - Serialized team state
   */
  async syncTeamState(teamId, teamState) {
    const teamPeers = this._getTeamPeers(teamId);
    const message = {
      type: P2P_MSG_TYPES.TEAM_SYNC,
      payload: {
        teamId,
        state: teamState,
        syncedAt: Date.now(),
      },
    };

    for (const peerId of teamPeers) {
      await this._sendToPeer(peerId, message).catch((err) => {
        logger.warn(
          `[P2PAgentNetwork] Team sync failed for ${peerId}: ${err.message}`,
        );
      });
    }
  }

  // ============================================================
  // Statistics
  // ============================================================

  /**
   * Get network statistics
   * @returns {Object}
   */
  getStats() {
    const agents = Array.from(this.remoteAgents.values());
    return {
      localDevice: this.localDeviceInfo,
      remoteAgents: {
        total: agents.length,
        online: agents.filter((a) => a.state === REMOTE_AGENT_STATES.ONLINE)
          .length,
        busy: agents.filter((a) => a.state === REMOTE_AGENT_STATES.BUSY).length,
        offline: agents.filter((a) => a.state === REMOTE_AGENT_STATES.OFFLINE)
          .length,
      },
      tasks: {
        pendingDelegations: this.pendingDelegations.size,
        activeRemote: this.activeRemoteTasks.size,
      },
      platforms: this._countByPlatform(agents),
    };
  }

  /**
   * Cleanup and shutdown
   */
  async shutdown() {
    // Announce departure
    await this._broadcastToPeers({
      type: P2P_MSG_TYPES.AGENT_DEPART,
      payload: {
        deviceId: this.localDeviceInfo?.deviceId,
        reason: "shutdown",
      },
    }).catch(() => {});

    // Clear timers
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
    }
    if (this._heartbeatCheckTimer) {
      clearInterval(this._heartbeatCheckTimer);
    }

    // Reject pending delegations
    for (const [taskId, delegation] of this.pendingDelegations) {
      clearTimeout(delegation.timer);
      delegation.reject(new Error("Network shutting down"));
    }
    this.pendingDelegations.clear();
    this.activeRemoteTasks.clear();
    this.remoteAgents.clear();

    this.initialized = false;
    this.emit("shutdown");
    logger.info("[P2PAgentNetwork] Shutdown complete");
  }

  // ============================================================
  // Internal: Message Handling
  // ============================================================

  /**
   * Handle incoming P2P message from peer
   * @private
   */
  _handlePeerMessage(peerId, data) {
    let message;
    try {
      message = typeof data === "string" ? JSON.parse(data) : data;
    } catch {
      logger.warn(`[P2PAgentNetwork] Invalid message from ${peerId}`);
      return;
    }

    if (!message.type || !message.type.startsWith("cowork:")) {
      return;
    }

    switch (message.type) {
      case P2P_MSG_TYPES.AGENT_ANNOUNCE:
        this._handleAgentAnnounce(peerId, message.payload);
        break;
      case P2P_MSG_TYPES.AGENT_DEPART:
        this.unregisterRemoteAgent(peerId, "departed");
        break;
      case P2P_MSG_TYPES.AGENT_HEARTBEAT:
        this._handleHeartbeat(peerId, message.payload);
        break;
      case P2P_MSG_TYPES.TASK_DELEGATE:
        this._handleTaskDelegation(peerId, message.payload);
        break;
      case P2P_MSG_TYPES.TASK_ACCEPT:
        this._handleTaskAccept(peerId, message.payload);
        break;
      case P2P_MSG_TYPES.TASK_REJECT:
        this._handleTaskReject(peerId, message.payload);
        break;
      case P2P_MSG_TYPES.TASK_PROGRESS:
        this._handleTaskProgress(peerId, message.payload);
        break;
      case P2P_MSG_TYPES.TASK_RESULT:
        this._handleTaskResult(peerId, message.payload);
        break;
      case P2P_MSG_TYPES.TASK_CANCEL:
        this._handleTaskCancel(peerId, message.payload);
        break;
      case P2P_MSG_TYPES.SKILL_QUERY:
        this._handleSkillQuery(peerId, message.payload);
        break;
      case P2P_MSG_TYPES.SKILL_RESPONSE:
        this._handleSkillResponse(peerId, message.payload);
        break;
      case P2P_MSG_TYPES.TEAM_INVITE:
        this._handleTeamInvite(peerId, message.payload);
        break;
      case P2P_MSG_TYPES.TEAM_INVITE_RESPONSE:
        this._handleTeamInviteResponse(peerId, message.payload);
        break;
      case P2P_MSG_TYPES.TEAM_SYNC:
        this.emit("team-sync-received", {
          peerId,
          teamId: message.payload.teamId,
          state: message.payload.state,
        });
        break;
      default:
        logger.debug(`[P2PAgentNetwork] Unknown message type: ${message.type}`);
    }
  }

  _handleAgentAnnounce(peerId, payload) {
    const existing = this.remoteAgents.get(peerId);
    if (existing) {
      // Update existing agent info
      Object.assign(existing, {
        skills: payload.device.skills,
        resources: payload.device.resources,
        lastHeartbeat: Date.now(),
        state: REMOTE_AGENT_STATES.ONLINE,
      });
      this.emit("remote-agent-updated", existing);
    } else {
      this.registerRemoteAgent(peerId, payload.device);
    }

    // Reply with our own announcement
    this._sendToPeer(peerId, {
      type: P2P_MSG_TYPES.AGENT_ANNOUNCE,
      payload: {
        device: this.localDeviceInfo,
        timestamp: Date.now(),
        isReply: true,
      },
    }).catch(() => {});
  }

  _handleHeartbeat(peerId, payload) {
    const agent = this.remoteAgents.get(peerId);
    if (agent) {
      agent.lastHeartbeat = Date.now();
      agent.state = payload.state || REMOTE_AGENT_STATES.ONLINE;
      if (payload.resources) {
        agent.resources = payload.resources;
      }
    }
  }

  /**
   * Handle incoming task delegation (we are the executor)
   */
  async _handleTaskDelegation(peerId, payload) {
    const { taskId, skillId, input, description } = payload;

    // Check if we can execute this skill
    if (this.skillRegistry) {
      const skill = this.skillRegistry.getSkill(skillId);
      if (!skill) {
        await this._sendToPeer(peerId, {
          type: P2P_MSG_TYPES.TASK_REJECT,
          payload: {
            taskId,
            reason: `Skill not available: ${skillId}`,
          },
        });
        return;
      }
    }

    // Accept the task
    await this._sendToPeer(peerId, {
      type: P2P_MSG_TYPES.TASK_ACCEPT,
      payload: { taskId },
    });

    this.emit("task-received", { taskId, peerId, skillId, description });

    // Execute the skill
    try {
      let result;
      if (this.skillRegistry) {
        result = await this.skillRegistry.executeSkill(skillId, {
          description,
          ...input,
        });
      } else {
        result = {
          success: true,
          output: `Simulated execution of ${skillId}`,
        };
      }

      await this._sendToPeer(peerId, {
        type: P2P_MSG_TYPES.TASK_RESULT,
        payload: {
          taskId,
          success: true,
          result,
          completedAt: Date.now(),
        },
      });
    } catch (error) {
      await this._sendToPeer(peerId, {
        type: P2P_MSG_TYPES.TASK_RESULT,
        payload: {
          taskId,
          success: false,
          error: error.message,
          completedAt: Date.now(),
        },
      });
    }
  }

  _handleTaskAccept(peerId, payload) {
    const delegation = this.pendingDelegations.get(payload.taskId);
    if (!delegation) {
      return;
    }

    // Move to active remote tasks
    this.activeRemoteTasks.set(payload.taskId, {
      peerId,
      task: delegation.task,
      progress: 0,
      acceptedAt: Date.now(),
    });

    // Keep resolve/reject for result handling, clear timeout
    clearTimeout(delegation.timer);
    this.emit("task-accepted", { taskId: payload.taskId, peerId });
  }

  _handleTaskReject(peerId, payload) {
    const delegation = this.pendingDelegations.get(payload.taskId);
    if (!delegation) {
      return;
    }

    clearTimeout(delegation.timer);
    delegation.reject(
      new Error(`Task rejected by ${peerId}: ${payload.reason || "unknown"}`),
    );
    this.pendingDelegations.delete(payload.taskId);
    this.emit("task-rejected", {
      taskId: payload.taskId,
      peerId,
      reason: payload.reason,
    });
  }

  _handleTaskProgress(peerId, payload) {
    const remoteTask = this.activeRemoteTasks.get(payload.taskId);
    if (remoteTask) {
      remoteTask.progress = payload.progress || 0;
      this.emit("remote-task-progress", {
        taskId: payload.taskId,
        peerId,
        progress: payload.progress,
        message: payload.message,
      });
    }
  }

  _handleTaskResult(peerId, payload) {
    const { taskId, success, result, error } = payload;

    // Check pending delegations first
    const delegation = this.pendingDelegations.get(taskId);
    if (delegation) {
      clearTimeout(delegation.timer);
      if (success) {
        delegation.resolve(result);
      } else {
        delegation.reject(new Error(error || "Remote task failed"));
      }
      this.pendingDelegations.delete(taskId);
    }

    this.activeRemoteTasks.delete(taskId);

    // Update agent task count
    const agent = this.remoteAgents.get(peerId);
    if (agent && agent.taskCount > 0) {
      agent.taskCount--;
    }

    this.emit("remote-task-completed", {
      taskId,
      peerId,
      success,
      result,
      error,
    });
    logger.info(
      `[P2PAgentNetwork] Remote task result: ${taskId} — ${success ? "success" : "failed"}`,
    );
  }

  _handleTaskCancel(_peerId, payload) {
    // We are the executor — cancel local execution
    this.emit("task-cancel-requested", { taskId: payload.taskId });
  }

  _handleSkillQuery(peerId, payload) {
    const { queryId, skillId } = payload;
    const hasSkill = this.skillRegistry
      ? !!this.skillRegistry.getSkill(skillId)
      : false;

    this._sendToPeer(peerId, {
      type: P2P_MSG_TYPES.SKILL_RESPONSE,
      payload: {
        queryId,
        skillId,
        available: hasSkill,
        device: {
          deviceId: this.localDeviceInfo?.deviceId,
          platform: this.localDeviceInfo?.platform,
        },
      },
    }).catch(() => {});
  }

  _handleSkillResponse(_peerId, payload) {
    this.emit(`skill-response:${payload.queryId}`, payload);
  }

  _handleTeamInvite(peerId, payload) {
    // Auto-accept invitations (configurable policy)
    const accepted = true;
    this._sendToPeer(peerId, {
      type: P2P_MSG_TYPES.TEAM_INVITE_RESPONSE,
      payload: {
        inviteId: payload.inviteId,
        accepted,
      },
    }).catch(() => {});

    this.emit("team-invite-received", { peerId, ...payload, accepted });
  }

  _handleTeamInviteResponse(_peerId, payload) {
    this.emit(`team-invite-response:${payload.inviteId}`, payload);
  }

  // ============================================================
  // Internal: Heartbeat
  // ============================================================

  _startHeartbeat() {
    this._heartbeatTimer = setInterval(() => {
      this._broadcastToPeers({
        type: P2P_MSG_TYPES.AGENT_HEARTBEAT,
        payload: {
          deviceId: this.localDeviceInfo?.deviceId,
          state: REMOTE_AGENT_STATES.ONLINE,
          resources: this._getLocalResources(),
          timestamp: Date.now(),
        },
      }).catch(() => {});
    }, this.config.heartbeatInterval);

    // Check for stale agents
    this._heartbeatCheckTimer = setInterval(() => {
      const now = Date.now();
      for (const [peerId, agent] of this.remoteAgents) {
        if (now - agent.lastHeartbeat > this.config.heartbeatTimeout) {
          agent.state = REMOTE_AGENT_STATES.UNREACHABLE;
          this.emit("remote-agent-unreachable", { peerId });
          logger.warn(
            `[P2PAgentNetwork] Agent unreachable: ${peerId} (no heartbeat for ${Math.round((now - agent.lastHeartbeat) / 1000)}s)`,
          );
        }
      }
    }, this.config.heartbeatInterval);
  }

  // ============================================================
  // Internal: Communication
  // ============================================================

  async _sendToPeer(peerId, message) {
    if (!this.mobileBridge) {
      throw new Error("MobileBridge not available");
    }

    const serialized =
      typeof message === "string" ? message : JSON.stringify(message);
    await this.mobileBridge.sendToMobile(peerId, serialized);
  }

  async _broadcastToPeers(message) {
    if (!this.mobileBridge) {
      return;
    }

    const serialized =
      typeof message === "string" ? message : JSON.stringify(message);
    const peers = Array.from(this.remoteAgents.keys());

    const results = await Promise.allSettled(
      peers.map((peerId) => this.mobileBridge.sendToMobile(peerId, serialized)),
    );

    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed > 0) {
      logger.warn(
        `[P2PAgentNetwork] Broadcast: ${peers.length - failed}/${peers.length} delivered`,
      );
    }
  }

  _onPeerConnected(peerId) {
    // Send our announcement to newly connected peer
    this._sendToPeer(peerId, {
      type: P2P_MSG_TYPES.AGENT_ANNOUNCE,
      payload: {
        device: this.localDeviceInfo,
        timestamp: Date.now(),
      },
    }).catch(() => {});
  }

  _onPeerDisconnected(peerId) {
    this.unregisterRemoteAgent(peerId, "disconnected");
  }

  // ============================================================
  // Internal: Helpers
  // ============================================================

  _getLocalSkillList() {
    if (!this.skillRegistry) {
      return [];
    }
    try {
      return this.skillRegistry.getSkillList().map((s) => ({
        id: s.skillId || s.name,
        name: s.name,
        category: s.category,
      }));
    } catch {
      return [];
    }
  }

  _getLocalResources() {
    try {
      const mem = process.memoryUsage();
      return {
        heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
        rssMB: Math.round(mem.rss / 1024 / 1024),
        platform: process.platform,
        cpus: require("os").cpus().length,
        uptime: Math.round(process.uptime()),
      };
    } catch {
      return {};
    }
  }

  _scoreAgent(agent, skillId) {
    let score = 0;
    // Skill availability
    const skill = (agent.skills || []).find(
      (s) => s.name === skillId || s.id === skillId,
    );
    if (skill) {
      score += 50;
    }

    // Prefer agents with fewer active tasks
    score -= agent.taskCount * 10;

    // Prefer agents with more resources
    if (agent.resources?.cpus) {
      score += agent.resources.cpus * 2;
    }

    // Prefer online over busy
    if (agent.state === REMOTE_AGENT_STATES.ONLINE) {
      score += 20;
    }
    if (agent.state === REMOTE_AGENT_STATES.BUSY) {
      score += 5;
    }

    return score;
  }

  _countByPlatform(agents) {
    const counts = {};
    for (const agent of agents) {
      counts[agent.platform] = (counts[agent.platform] || 0) + 1;
    }
    return counts;
  }

  _getTeamPeers(teamId) {
    // Find remote agents that have joined this team
    const peers = [];
    for (const [peerId, agent] of this.remoteAgents) {
      if (agent.teamId === teamId) {
        peers.push(peerId);
      }
    }
    return peers;
  }

  _ensureTables() {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS p2p_remote_agents (
          peer_id TEXT PRIMARY KEY,
          device_id TEXT NOT NULL,
          platform TEXT,
          skills TEXT DEFAULT '[]',
          resources TEXT DEFAULT '{}',
          state TEXT DEFAULT 'offline',
          last_heartbeat TEXT,
          registered_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_remote_agents_state ON p2p_remote_agents(state);

        CREATE TABLE IF NOT EXISTS p2p_remote_tasks (
          task_id TEXT PRIMARY KEY,
          peer_id TEXT NOT NULL,
          skill_id TEXT,
          description TEXT,
          input TEXT DEFAULT '{}',
          status TEXT DEFAULT 'pending',
          result TEXT,
          delegated_at TEXT DEFAULT (datetime('now')),
          completed_at TEXT,
          FOREIGN KEY (peer_id) REFERENCES p2p_remote_agents(peer_id)
        );
        CREATE INDEX IF NOT EXISTS idx_remote_tasks_status ON p2p_remote_tasks(status);
        CREATE INDEX IF NOT EXISTS idx_remote_tasks_peer ON p2p_remote_tasks(peer_id);
      `);
    } catch (err) {
      logger.warn(`[P2PAgentNetwork] Table creation warning: ${err.message}`);
    }
  }

  _persistRemoteAgent(agent) {
    try {
      this.db.run(
        `INSERT OR REPLACE INTO p2p_remote_agents
         (peer_id, device_id, platform, skills, resources, state, last_heartbeat, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [
          agent.peerId,
          agent.deviceId,
          agent.platform,
          JSON.stringify(agent.skills),
          JSON.stringify(agent.resources),
          agent.state,
          new Date(agent.lastHeartbeat).toISOString(),
        ],
      );
    } catch (err) {
      logger.warn(`[P2PAgentNetwork] Agent persist warning: ${err.message}`);
    }
  }
}

// Singleton
let _instance = null;

function getP2PAgentNetwork() {
  if (!_instance) {
    _instance = new P2PAgentNetwork();
  }
  return _instance;
}

module.exports = {
  P2PAgentNetwork,
  getP2PAgentNetwork,
  P2P_MSG_TYPES,
  REMOTE_AGENT_STATES,
};

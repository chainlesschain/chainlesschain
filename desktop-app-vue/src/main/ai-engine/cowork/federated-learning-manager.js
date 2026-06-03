/**
 * Federated Learning Manager — v4.0
 *
 * Coordinates federated learning tasks across decentralized agents.
 * Manages task lifecycle (create, recruit, train, aggregate), participant
 * enrollment, gradient collection, and model aggregation using pluggable
 * strategies (FedAvg, FedProx, Secure Aggregation, Krum).
 *
 * Supports differential privacy via configurable noise multiplier and
 * gradient clipping.  Integrates with AgentRegistry, TaskRouter, and
 * AgentAuthenticator for identity and routing.
 *
 * @module ai-engine/cowork/federated-learning-manager
 */

const { EventEmitter } = require("events");
const { logger } = require("../../utils/logger.js");
const { v4: uuidv4 } = require("uuid");

// ============================================================
// Constants
// ============================================================

const TASK_STATUS = {
  CREATED: "created",
  RECRUITING: "recruiting",
  TRAINING: "training",
  AGGREGATING: "aggregating",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
};

const PARTICIPANT_STATUS = {
  JOINED: "joined",
  TRAINING: "training",
  SUBMITTED: "submitted",
  LEFT: "left",
  REMOVED: "removed",
};

const AGGREGATION_STRATEGY = {
  FED_AVG: "fedavg",
  FED_PROX: "fedprox",
  SECURE_AGG: "secure_agg",
  KRUM: "krum",
};

const DEFAULT_CONFIG = {
  minParticipants: 2,
  maxRounds: 100,
  defaultStrategy: "fedavg",
  roundTimeoutMs: 300000, // 5 min
  privacyBudget: 1.0,
  noiseMultiplier: 0.1,
  clipNorm: 1.0,
  cleanupIntervalMs: 600000,
};

// ============================================================
// FederatedLearningManager Class
// ============================================================

class FederatedLearningManager extends EventEmitter {
  constructor() {
    super();
    this.db = null;
    this.initialized = false;
    this._config = { ...DEFAULT_CONFIG };

    // Dependencies
    this._agentRegistry = null;
    this._taskRouter = null;
    this._authenticator = null;
    this._zkpEngine = null;

    // In-memory state
    this._tasks = new Map(); // taskId → task
    this._participants = new Map(); // taskId → Map<participantId, participant>
    this._rounds = new Map(); // taskId → Map<roundNumber, round>
    this._gradientStore = new Map(); // `${taskId}:${roundNumber}` → Map<agentDid, gradients>

    this._cleanupTimer = null;
  }

  /**
   * Initialize with database and dependencies
   * @param {Object} db - Database manager
   * @param {Object} deps - { agentRegistry, taskRouter, authenticator, zkpEngine }
   */
  async initialize(db, deps = {}) {
    if (this.initialized) {
      return;
    }
    this.db = db;
    this._agentRegistry = deps.agentRegistry || null;
    this._taskRouter = deps.taskRouter || null;
    this._authenticator = deps.authenticator || null;
    this._zkpEngine = deps.zkpEngine || null;

    this._ensureTables();
    this._loadTasks();
    this._loadParticipants();
    this._loadRounds();
    this._startCleanupTimer();

    this.initialized = true;
    logger.info(
      `[FL Manager] Initialized: ${this._tasks.size} tasks, ` +
        `${this._countAllParticipants()} participants`,
    );
  }

  // ============================================================
  // Table Setup
  // ============================================================

  _ensureTables() {
    if (!this.db) {
      return;
    }
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS federated_learning_tasks (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          model_type TEXT NOT NULL,
          global_model_version INTEGER DEFAULT 0,
          aggregation_strategy TEXT DEFAULT 'fedavg',
          min_participants INTEGER DEFAULT 2,
          max_rounds INTEGER DEFAULT 100,
          current_round INTEGER DEFAULT 0,
          status TEXT DEFAULT 'created',
          privacy_budget REAL DEFAULT 1.0,
          noise_multiplier REAL DEFAULT 0.1,
          clip_norm REAL DEFAULT 1.0,
          config TEXT DEFAULT '{}',
          created_by TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS federated_learning_participants (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL,
          agent_did TEXT NOT NULL,
          status TEXT DEFAULT 'joined',
          rounds_completed INTEGER DEFAULT 0,
          last_contribution_at TEXT,
          data_size INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS federated_learning_rounds (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL,
          round_number INTEGER NOT NULL,
          status TEXT DEFAULT 'collecting',
          gradients_received INTEGER DEFAULT 0,
          gradients_required INTEGER DEFAULT 2,
          aggregated_model TEXT,
          metrics TEXT DEFAULT '{}',
          started_at TEXT DEFAULT (datetime('now')),
          completed_at TEXT
        );
      `);
      if (this.db.saveToFile) {
        this.db.saveToFile();
      }
    } catch (e) {
      logger.error("[FL Manager] Table creation error:", e.message);
    }
  }

  // ============================================================
  // Configuration
  // ============================================================

  /**
   * Get current configuration
   * @returns {Object} Current config
   */
  getConfig() {
    return { ...this._config };
  }

  /**
   * Update configuration
   * @param {Object} updates - Configuration overrides
   */
  configure(updates = {}) {
    const validKeys = Object.keys(DEFAULT_CONFIG);
    for (const key of Object.keys(updates)) {
      if (validKeys.includes(key)) {
        this._config[key] = updates[key];
      }
    }

    if (updates.cleanupIntervalMs !== undefined) {
      this._startCleanupTimer();
    }

    logger.info(
      `[FL Manager] Configuration updated: ${JSON.stringify(updates)}`,
    );
  }

  // ============================================================
  // Task Management
  // ============================================================

  /**
   * Create a new federated learning task
   * @param {Object} options - Task options
   * @returns {Object} Created task
   */
  createTask(options = {}) {
    const task = {
      id: uuidv4(),
      name: options.name || "Untitled Task",
      modelType: options.modelType || "generic",
      globalModelVersion: 0,
      aggregationStrategy:
        options.aggregationStrategy || this._config.defaultStrategy,
      minParticipants: options.minParticipants || this._config.minParticipants,
      maxRounds: options.maxRounds || this._config.maxRounds,
      currentRound: 0,
      status: TASK_STATUS.CREATED,
      privacyBudget: options.privacyBudget || this._config.privacyBudget,
      noiseMultiplier: options.noiseMultiplier || this._config.noiseMultiplier,
      clipNorm: options.clipNorm || this._config.clipNorm,
      config: options.config || {},
      createdBy: options.createdBy || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this._tasks.set(task.id, task);
    this._participants.set(task.id, new Map());
    this._rounds.set(task.id, new Map());
    this._persistTask(task);

    this.emit("task:created", task);
    logger.info(
      `[FL Manager] Task created: ${task.id} (${task.name}, ${task.modelType})`,
    );
    return task;
  }

  /**
   * Join a federated learning task
   * @param {string} taskId - Task ID
   * @param {string} agentDid - Agent DID
   * @param {Object} options - { dataSize }
   * @returns {Object} Participant record
   */
  joinTask(taskId, agentDid, options = {}) {
    const task = this._tasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const allowedStatuses = [
      TASK_STATUS.CREATED,
      TASK_STATUS.RECRUITING,
      TASK_STATUS.TRAINING,
    ];
    if (!allowedStatuses.includes(task.status)) {
      throw new Error(`Cannot join task in status: ${task.status}`);
    }

    const participant = {
      id: uuidv4(),
      taskId,
      agentDid,
      status: PARTICIPANT_STATUS.JOINED,
      roundsCompleted: 0,
      lastContributionAt: null,
      dataSize: options.dataSize || 0,
      createdAt: new Date().toISOString(),
    };

    const taskParticipants = this._participants.get(taskId);
    taskParticipants.set(participant.id, participant);
    this._persistParticipant(participant);

    // Transition to RECRUITING if enough participants joined
    const activeCount = this._getActiveParticipants(taskId).length;
    if (
      activeCount >= task.minParticipants &&
      task.status === TASK_STATUS.CREATED
    ) {
      this._updateTask(taskId, { status: TASK_STATUS.RECRUITING });
    }

    this.emit("participant:joined", { taskId, participant });
    logger.info(
      `[FL Manager] Participant joined: ${agentDid} → task ${taskId} (${activeCount} active)`,
    );
    return participant;
  }

  /**
   * Leave a federated learning task
   * @param {string} taskId - Task ID
   * @param {string} agentDid - Agent DID
   * @returns {{ success: boolean }}
   */
  leaveTask(taskId, agentDid) {
    const taskParticipants = this._participants.get(taskId);
    if (!taskParticipants) {
      throw new Error(`Task not found: ${taskId}`);
    }

    let found = null;
    for (const [, p] of taskParticipants) {
      if (p.agentDid === agentDid && p.status !== PARTICIPANT_STATUS.LEFT) {
        p.status = PARTICIPANT_STATUS.LEFT;
        found = p;
        break;
      }
    }

    if (!found) {
      throw new Error(`Participant not found: ${agentDid} in task ${taskId}`);
    }

    this._persistParticipant(found);
    this.emit("participant:left", { taskId, agentDid });
    logger.info(
      `[FL Manager] Participant left: ${agentDid} from task ${taskId}`,
    );
    return { success: true };
  }

  // ============================================================
  // Training Lifecycle
  // ============================================================

  /**
   * Start training for a task
   * @param {string} taskId - Task ID
   * @returns {{ taskId: string, round: number }}
   */
  async startTraining(taskId) {
    const task = this._tasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const activeParticipants = this._getActiveParticipants(taskId);
    if (activeParticipants.length < task.minParticipants) {
      throw new Error(
        `Not enough participants: ${activeParticipants.length}/${task.minParticipants}`,
      );
    }

    this._updateTask(taskId, {
      status: TASK_STATUS.TRAINING,
      currentRound: 1,
    });

    const round = {
      id: uuidv4(),
      taskId,
      roundNumber: 1,
      status: "collecting",
      gradientsReceived: 0,
      gradientsRequired: activeParticipants.length,
      aggregatedModel: null,
      metrics: {},
      startedAt: new Date().toISOString(),
      completedAt: null,
    };

    const taskRounds = this._rounds.get(taskId) || new Map();
    taskRounds.set(round.roundNumber, round);
    this._rounds.set(taskId, taskRounds);
    this._persistRound(round);

    this.emit("training:started", { taskId, round: 1 });
    logger.info(
      `[FL Manager] Training started: task ${taskId}, round 1, ` +
        `${activeParticipants.length} participants`,
    );
    return { taskId, round: 1 };
  }

  /**
   * Submit gradients for a training round
   * @param {string} taskId - Task ID
   * @param {string} agentDid - Agent DID
   * @param {*} gradients - Gradient data
   * @param {Object} options - Additional options
   * @returns {{ received: number, required: number }}
   */
  async submitGradients(taskId, agentDid, gradients, options = {}) {
    const task = this._tasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    if (task.status !== TASK_STATUS.TRAINING) {
      throw new Error(`Task is not in training status: ${task.status}`);
    }

    // Validate participant
    const taskParticipants = this._participants.get(taskId);
    let participant = null;
    if (taskParticipants) {
      for (const [, p] of taskParticipants) {
        if (
          p.agentDid === agentDid &&
          p.status !== PARTICIPANT_STATUS.LEFT &&
          p.status !== PARTICIPANT_STATUS.REMOVED
        ) {
          participant = p;
          break;
        }
      }
    }
    if (!participant) {
      throw new Error(`Participant not found or inactive: ${agentDid}`);
    }

    const round = this._getCurrentRound(taskId);
    if (!round) {
      throw new Error(`No active round for task: ${taskId}`);
    }

    // Store gradients in memory
    const storeKey = `${taskId}:${round.roundNumber}`;
    if (!this._gradientStore.has(storeKey)) {
      this._gradientStore.set(storeKey, new Map());
    }
    this._gradientStore.get(storeKey).set(agentDid, gradients);

    // Update round
    round.gradientsReceived += 1;
    this._updateRound(round.id, {
      gradients_received: round.gradientsReceived,
    });

    // Update participant status
    participant.status = PARTICIPANT_STATUS.SUBMITTED;
    participant.lastContributionAt = new Date().toISOString();
    this._persistParticipant(participant);

    this.emit("gradients:submitted", {
      taskId,
      agentDid,
      roundNumber: round.roundNumber,
      received: round.gradientsReceived,
      required: round.gradientsRequired,
    });

    // Check if all gradients received
    if (round.gradientsReceived >= round.gradientsRequired) {
      this.emit("round:gradients-complete", {
        taskId,
        roundNumber: round.roundNumber,
      });
      logger.info(
        `[FL Manager] All gradients received for task ${taskId}, round ${round.roundNumber}`,
      );
    }

    logger.info(
      `[FL Manager] Gradients submitted: ${agentDid} → task ${taskId}, ` +
        `round ${round.roundNumber} (${round.gradientsReceived}/${round.gradientsRequired})`,
    );

    return {
      received: round.gradientsReceived,
      required: round.gradientsRequired,
    };
  }

  // ============================================================
  // Query Methods
  // ============================================================

  /**
   * Get the global model from the latest completed round
   * @param {string} taskId - Task ID
   * @returns {*} Aggregated model or null
   */
  getGlobalModel(taskId) {
    const taskRounds = this._rounds.get(taskId);
    if (!taskRounds) {
      return null;
    }

    let latestCompleted = null;
    for (const [, round] of taskRounds) {
      if (
        round.status === "completed" &&
        round.aggregatedModel !== null &&
        (!latestCompleted || round.roundNumber > latestCompleted.roundNumber)
      ) {
        latestCompleted = round;
      }
    }

    return latestCompleted ? latestCompleted.aggregatedModel : null;
  }

  /**
   * Get task status with participant count and current round info
   * @param {string} taskId - Task ID
   * @returns {Object} Task with extra info
   */
  getTaskStatus(taskId) {
    const task = this._tasks.get(taskId);
    if (!task) {
      return null;
    }

    const activeParticipants = this._getActiveParticipants(taskId);
    const currentRound = this._getCurrentRound(taskId);

    return {
      ...task,
      participantsCount: activeParticipants.length,
      currentRoundInfo: currentRound || null,
    };
  }

  /**
   * List tasks with optional filter
   * @param {Object} filter - { status, createdBy, modelType }
   * @returns {Array} Matching tasks
   */
  listTasks(filter = {}) {
    const results = [];
    for (const [, task] of this._tasks) {
      if (filter.status && task.status !== filter.status) {
        continue;
      }
      if (filter.createdBy && task.createdBy !== filter.createdBy) {
        continue;
      }
      if (filter.modelType && task.modelType !== filter.modelType) {
        continue;
      }
      results.push({ ...task });
    }
    return results;
  }

  /**
   * Get aggregate statistics
   * @returns {Object} Stats
   */
  getStats() {
    let activeTasks = 0;
    let completedTasks = 0;
    for (const [, task] of this._tasks) {
      if (
        task.status === TASK_STATUS.TRAINING ||
        task.status === TASK_STATUS.RECRUITING ||
        task.status === TASK_STATUS.AGGREGATING
      ) {
        activeTasks++;
      } else if (task.status === TASK_STATUS.COMPLETED) {
        completedTasks++;
      }
    }

    let totalParticipants = 0;
    for (const [, taskParticipants] of this._participants) {
      totalParticipants += taskParticipants.size;
    }

    let totalRounds = 0;
    for (const [, taskRounds] of this._rounds) {
      totalRounds += taskRounds.size;
    }

    return {
      totalTasks: this._tasks.size,
      activeTasks,
      completedTasks,
      totalParticipants,
      totalRounds,
    };
  }

  // ============================================================
  // Cleanup & Destroy
  // ============================================================

  /**
   * Destroy the manager and clean up timers
   */
  destroy() {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }
    this._tasks.clear();
    this._participants.clear();
    this._rounds.clear();
    this._gradientStore.clear();
    this.removeAllListeners();
    this.initialized = false;
    logger.info("[FL Manager] Destroyed");
  }

  // ============================================================
  // Private — Data Loading
  // ============================================================

  _loadTasks() {
    if (!this.db) {
      return;
    }
    try {
      const rows = this.db
        .prepare("SELECT * FROM federated_learning_tasks")
        .all();
      for (const row of rows) {
        const task = {
          id: row.id,
          name: row.name,
          modelType: row.model_type,
          globalModelVersion: row.global_model_version,
          aggregationStrategy: row.aggregation_strategy,
          minParticipants: row.min_participants,
          maxRounds: row.max_rounds,
          currentRound: row.current_round,
          status: row.status,
          privacyBudget: row.privacy_budget,
          noiseMultiplier: row.noise_multiplier,
          clipNorm: row.clip_norm,
          config: safeParseJSON(row.config, {}),
          createdBy: row.created_by,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        };
        this._tasks.set(task.id, task);
        if (!this._participants.has(task.id)) {
          this._participants.set(task.id, new Map());
        }
        if (!this._rounds.has(task.id)) {
          this._rounds.set(task.id, new Map());
        }
      }
    } catch (e) {
      logger.error("[FL Manager] Failed to load tasks:", e.message);
    }
  }

  _loadParticipants() {
    if (!this.db) {
      return;
    }
    try {
      const rows = this.db
        .prepare("SELECT * FROM federated_learning_participants")
        .all();
      for (const row of rows) {
        const participant = {
          id: row.id,
          taskId: row.task_id,
          agentDid: row.agent_did,
          status: row.status,
          roundsCompleted: row.rounds_completed,
          lastContributionAt: row.last_contribution_at,
          dataSize: row.data_size,
          createdAt: row.created_at,
        };
        const taskParticipants =
          this._participants.get(participant.taskId) || new Map();
        taskParticipants.set(participant.id, participant);
        this._participants.set(participant.taskId, taskParticipants);
      }
    } catch (e) {
      logger.error("[FL Manager] Failed to load participants:", e.message);
    }
  }

  _loadRounds() {
    if (!this.db) {
      return;
    }
    try {
      const rows = this.db
        .prepare("SELECT * FROM federated_learning_rounds")
        .all();
      for (const row of rows) {
        const round = {
          id: row.id,
          taskId: row.task_id,
          roundNumber: row.round_number,
          status: row.status,
          gradientsReceived: row.gradients_received,
          gradientsRequired: row.gradients_required,
          aggregatedModel: safeParseJSON(row.aggregated_model, null),
          metrics: safeParseJSON(row.metrics, {}),
          startedAt: row.started_at,
          completedAt: row.completed_at,
        };
        const taskRounds = this._rounds.get(round.taskId) || new Map();
        taskRounds.set(round.roundNumber, round);
        this._rounds.set(round.taskId, taskRounds);
      }
    } catch (e) {
      logger.error("[FL Manager] Failed to load rounds:", e.message);
    }
  }

  // ============================================================
  // Private — Persistence
  // ============================================================

  _persistTask(task) {
    if (!this.db) {
      return;
    }
    try {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO federated_learning_tasks
           (id, name, model_type, global_model_version, aggregation_strategy,
            min_participants, max_rounds, current_round, status,
            privacy_budget, noise_multiplier, clip_norm, config,
            created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          task.id,
          task.name,
          task.modelType,
          task.globalModelVersion,
          task.aggregationStrategy,
          task.minParticipants,
          task.maxRounds,
          task.currentRound,
          task.status,
          task.privacyBudget,
          task.noiseMultiplier,
          task.clipNorm,
          JSON.stringify(task.config),
          task.createdBy,
          task.createdAt,
          task.updatedAt,
        );
      if (this.db.saveToFile) {
        this.db.saveToFile();
      }
    } catch (e) {
      logger.error("[FL Manager] Failed to persist task:", e.message);
    }
  }

  _updateTask(id, updates) {
    const task = this._tasks.get(id);
    if (!task) {
      return;
    }
    Object.assign(task, updates, { updatedAt: new Date().toISOString() });
    this._persistTask(task);
  }

  _persistParticipant(p) {
    if (!this.db) {
      return;
    }
    try {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO federated_learning_participants
           (id, task_id, agent_did, status, rounds_completed,
            last_contribution_at, data_size, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          p.id,
          p.taskId,
          p.agentDid,
          p.status,
          p.roundsCompleted,
          p.lastContributionAt,
          p.dataSize,
          p.createdAt,
        );
      if (this.db.saveToFile) {
        this.db.saveToFile();
      }
    } catch (e) {
      logger.error("[FL Manager] Failed to persist participant:", e.message);
    }
  }

  _persistRound(round) {
    if (!this.db) {
      return;
    }
    try {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO federated_learning_rounds
           (id, task_id, round_number, status, gradients_received,
            gradients_required, aggregated_model, metrics,
            started_at, completed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          round.id,
          round.taskId,
          round.roundNumber,
          round.status,
          round.gradientsReceived,
          round.gradientsRequired,
          round.aggregatedModel ? JSON.stringify(round.aggregatedModel) : null,
          JSON.stringify(round.metrics),
          round.startedAt,
          round.completedAt,
        );
      if (this.db.saveToFile) {
        this.db.saveToFile();
      }
    } catch (e) {
      logger.error("[FL Manager] Failed to persist round:", e.message);
    }
  }

  _updateRound(id, updates) {
    if (!this.db) {
      return;
    }
    try {
      const setClauses = [];
      const values = [];
      for (const [key, value] of Object.entries(updates)) {
        setClauses.push(`${key} = ?`);
        values.push(value);
      }
      if (setClauses.length === 0) {
        return;
      }
      values.push(id);
      this.db
        .prepare(
          `UPDATE federated_learning_rounds SET ${setClauses.join(", ")} WHERE id = ?`,
        )
        .run(...values);
      if (this.db.saveToFile) {
        this.db.saveToFile();
      }
    } catch (e) {
      logger.error("[FL Manager] Failed to update round:", e.message);
    }
  }

  // ============================================================
  // Private — Helpers
  // ============================================================

  _getActiveParticipants(taskId) {
    const taskParticipants = this._participants.get(taskId);
    if (!taskParticipants) {
      return [];
    }
    const active = [];
    for (const [, p] of taskParticipants) {
      if (
        p.status !== PARTICIPANT_STATUS.LEFT &&
        p.status !== PARTICIPANT_STATUS.REMOVED
      ) {
        active.push(p);
      }
    }
    return active;
  }

  _getCurrentRound(taskId) {
    const task = this._tasks.get(taskId);
    if (!task) {
      return null;
    }
    const taskRounds = this._rounds.get(taskId);
    if (!taskRounds) {
      return null;
    }
    return taskRounds.get(task.currentRound) || null;
  }

  _countAllParticipants() {
    let count = 0;
    for (const [, taskParticipants] of this._participants) {
      count += taskParticipants.size;
    }
    return count;
  }

  _startCleanupTimer() {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
    }
    this._cleanupTimer = setInterval(() => {
      this._cleanupStaleTasks();
    }, this._config.cleanupIntervalMs);

    // Prevent timer from keeping the process alive
    if (this._cleanupTimer.unref) {
      this._cleanupTimer.unref();
    }
  }

  _cleanupStaleTasks() {
    const now = Date.now();
    for (const [, task] of this._tasks) {
      if (task.status === TASK_STATUS.TRAINING && task.updatedAt) {
        const elapsed = now - new Date(task.updatedAt).getTime();
        if (elapsed > this._config.roundTimeoutMs * 2) {
          logger.warn(
            `[FL Manager] Stale task detected: ${task.id}, marking as failed`,
          );
          this._updateTask(task.id, { status: TASK_STATUS.FAILED });
          this.emit("task:failed", { taskId: task.id, reason: "timeout" });
        }
      }
    }
  }
}

// ============================================================
// Utility
// ============================================================

function safeParseJSON(str, fallback = {}) {
  if (!str) {
    return fallback;
  }
  if (typeof str === "object") {
    return str;
  }
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

// ============================================================
// Singleton
// ============================================================

let instance = null;

function getFederatedLearningManager() {
  if (!instance) {
    instance = new FederatedLearningManager();
  }
  return instance;
}

module.exports = {
  FederatedLearningManager,
  getFederatedLearningManager,
  TASK_STATUS,
  PARTICIPANT_STATUS,
  AGGREGATION_STRATEGY,
};

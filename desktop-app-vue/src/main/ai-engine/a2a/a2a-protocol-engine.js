/**
 * @module ai-engine/a2a/a2a-protocol-engine
 * Phase 81: Google A2A Protocol Engine
 */
const EventEmitter = require("events");
const { logger } = require("../../utils/logger.js");

class A2AProtocolEngine extends EventEmitter {
  constructor() {
    super();
    this.db = null;
    this.initialized = false;
    this._agentCards = new Map();
    this._tasks = new Map();
    this._subscriptions = new Map();
    this._pushEndpoints = new Map();
    this._config = {
      taskTimeout: 300000,
      maxConcurrentTasks: 50,
      enableStreaming: true,
    };
  }

  async initialize(db, deps = {}) {
    if (this.initialized) {
      return;
    }
    this.db = db;
    this._ensureTables();
    await this._loadAgentCards();
    this.initialized = true;
    logger.info("[A2AProtocol] Initialized");
  }

  _ensureTables() {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS a2a_agent_cards (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          url TEXT,
          capabilities TEXT,
          skills TEXT,
          auth_type TEXT DEFAULT 'none',
          metadata TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS a2a_tasks (
          id TEXT PRIMARY KEY,
          agent_id TEXT,
          status TEXT DEFAULT 'submitted',
          input TEXT,
          output TEXT,
          artifacts TEXT,
          history TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );
      `);
    } catch (error) {
      logger.warn("[A2AProtocol] Table creation warning:", error.message);
    }
  }

  async _loadAgentCards() {
    try {
      const rows = this.db.prepare("SELECT * FROM a2a_agent_cards").all();
      for (const row of rows) {
        this._agentCards.set(row.id, {
          ...row,
          capabilities: JSON.parse(row.capabilities || "[]"),
          skills: JSON.parse(row.skills || "[]"),
          metadata: JSON.parse(row.metadata || "{}"),
        });
      }
    } catch (error) {
      logger.warn("[A2AProtocol] Failed to load agent cards:", error.message);
    }
  }

  // Agent Card Management
  registerCard(card) {
    const id =
      card.id ||
      `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const agentCard = {
      id,
      name: card.name || "Unknown Agent",
      description: card.description || "",
      url: card.url || null,
      capabilities: card.capabilities || [],
      skills: card.skills || [],
      auth_type: card.auth_type || "none",
      metadata: card.metadata || {},
    };
    this._agentCards.set(id, agentCard);
    this._persistCard(agentCard);
    this.emit("card:registered", { id, name: agentCard.name });
    return agentCard;
  }

  updateCard(id, updates) {
    const card = this._agentCards.get(id);
    if (!card) {
      return null;
    }
    const updated = { ...card, ...updates };
    this._agentCards.set(id, updated);
    this._persistCard(updated);
    this.emit("card:updated", { id });
    return updated;
  }

  _persistCard(card) {
    try {
      this.db
        .prepare(
          `
        INSERT OR REPLACE INTO a2a_agent_cards (id, name, description, url, capabilities, skills, auth_type, metadata, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `,
        )
        .run(
          card.id,
          card.name,
          card.description,
          card.url,
          JSON.stringify(card.capabilities),
          JSON.stringify(card.skills),
          card.auth_type,
          JSON.stringify(card.metadata),
        );
    } catch (error) {
      logger.error("[A2AProtocol] Failed to persist card:", error.message);
    }
  }

  // Agent Discovery
  discoverAgents(filter = {}) {
    let agents = Array.from(this._agentCards.values());
    if (filter.capability) {
      agents = agents.filter((a) => a.capabilities.includes(filter.capability));
    }
    if (filter.skill) {
      agents = agents.filter((a) =>
        a.skills.some((s) => s.name === filter.skill || s.id === filter.skill),
      );
    }
    if (filter.name) {
      agents = agents.filter((a) =>
        a.name.toLowerCase().includes(filter.name.toLowerCase()),
      );
    }
    return agents;
  }

  // Task Management
  async sendTask(agentId, input, options = {}) {
    const agent = this._agentCards.get(agentId);
    if (!agent) {
      throw new Error(`Agent '${agentId}' not found`);
    }

    const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const task = {
      id: taskId,
      agentId,
      status: "submitted",
      input,
      output: null,
      artifacts: [],
      history: [{ status: "submitted", timestamp: Date.now() }],
      createdAt: Date.now(),
    };

    this._tasks.set(taskId, task);
    this._persistTask(task);
    this.emit("task:submitted", { taskId, agentId });

    // Simulate async processing
    if (options.autoProcess !== false) {
      this._processTask(taskId);
    }

    return { taskId, status: task.status };
  }

  async _processTask(taskId) {
    const task = this._tasks.get(taskId);
    if (!task) {
      return;
    }

    task.status = "working";
    task.history.push({ status: "working", timestamp: Date.now() });
    this.emit("task:working", { taskId: task.id });
    this._notifySubscribers(task);
  }

  completeTask(taskId, output, artifacts = []) {
    const task = this._tasks.get(taskId);
    if (!task) {
      return null;
    }

    task.status = "completed";
    task.output = output;
    task.artifacts = artifacts;
    task.history.push({ status: "completed", timestamp: Date.now() });
    this._persistTask(task);
    this.emit("task:completed", { taskId, output });
    this._notifySubscribers(task);
    return task;
  }

  failTask(taskId, error) {
    const task = this._tasks.get(taskId);
    if (!task) {
      return null;
    }

    task.status = "failed";
    task.output = { error };
    task.history.push({ status: "failed", timestamp: Date.now(), error });
    this._persistTask(task);
    this.emit("task:failed", { taskId, error });
    this._notifySubscribers(task);
    return task;
  }

  requestInput(taskId, prompt) {
    const task = this._tasks.get(taskId);
    if (!task) {
      return null;
    }

    task.status = "input-required";
    task.history.push({
      status: "input-required",
      timestamp: Date.now(),
      prompt,
    });
    this.emit("task:input-required", { taskId, prompt });
    this._notifySubscribers(task);
    return task;
  }

  getTaskStatus(taskId) {
    return this._tasks.get(taskId) || null;
  }

  _persistTask(task) {
    try {
      this.db
        .prepare(
          `
        INSERT OR REPLACE INTO a2a_tasks (id, agent_id, status, input, output, artifacts, history, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `,
        )
        .run(
          task.id,
          task.agentId,
          task.status,
          JSON.stringify(task.input),
          JSON.stringify(task.output),
          JSON.stringify(task.artifacts),
          JSON.stringify(task.history),
        );
    } catch (error) {
      logger.error("[A2AProtocol] Failed to persist task:", error.message);
    }
  }

  // Subscriptions
  subscribeToTask(taskId, callback) {
    if (!this._subscriptions.has(taskId)) {
      this._subscriptions.set(taskId, []);
    }
    const subId = `sub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this._subscriptions.get(taskId).push({ id: subId, callback });
    return subId;
  }

  _notifySubscribers(task) {
    const subs = this._subscriptions.get(task.id);
    if (!subs) {
      return;
    }
    for (const sub of subs) {
      try {
        sub.callback(task);
      } catch (error) {
        logger.error(
          "[A2AProtocol] Subscriber notification error:",
          error.message,
        );
      }
    }
  }

  // Capability Negotiation
  negotiateCapability(agentId, requiredCapabilities) {
    const agent = this._agentCards.get(agentId);
    if (!agent) {
      return { compatible: false, missing: requiredCapabilities };
    }

    const missing = requiredCapabilities.filter(
      (c) => !agent.capabilities.includes(c),
    );
    return {
      compatible: missing.length === 0,
      supported: requiredCapabilities.filter((c) =>
        agent.capabilities.includes(c),
      ),
      missing,
    };
  }

  listPeers() {
    return Array.from(this._agentCards.values()).map((a) => ({
      id: a.id,
      name: a.name,
      capabilities: a.capabilities,
      url: a.url,
    }));
  }
}

let instance = null;
function getA2AProtocolEngine() {
  if (!instance) {
    instance = new A2AProtocolEngine();
  }
  return instance;
}

module.exports = { A2AProtocolEngine, getA2AProtocolEngine };

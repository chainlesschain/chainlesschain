/**
 * Webhook Manager — v2.0.0
 *
 * Event-driven webhook system for Cowork. Subscribes to events
 * (task-completed, vote-result, agent-status, etc.) and delivers
 * HTTP POST notifications to registered endpoints with retry,
 * HMAC signature verification, and delivery logging.
 *
 * @module ai-engine/cowork/webhook-manager
 */

const EventEmitter = require("events");
const http = require("http");
const https = require("https");
const { logger } = require("../../utils/logger.js");
const { v4: uuidv4 } = require("uuid");
const crypto = require("crypto");

/**
 * Webhook event types
 */
const WEBHOOK_EVENTS = {
  // Team lifecycle
  TEAM_CREATED: "team.created",
  TEAM_DESTROYED: "team.destroyed",
  TEAM_PAUSED: "team.paused",
  TEAM_RESUMED: "team.resumed",

  // Agent lifecycle
  AGENT_JOINED: "agent.joined",
  AGENT_TERMINATED: "agent.terminated",
  AGENT_REMOTE_CONNECTED: "agent.remote.connected",
  AGENT_REMOTE_DISCONNECTED: "agent.remote.disconnected",

  // Task events
  TASK_ASSIGNED: "task.assigned",
  TASK_COMPLETED: "task.completed",
  TASK_FAILED: "task.failed",
  TASK_DELEGATED: "task.delegated",

  // Skill events
  SKILL_EXECUTED: "skill.executed",
  SKILL_FAILED: "skill.failed",

  // Decision events
  VOTE_COMPLETED: "vote.completed",

  // Device events
  DEVICE_DISCOVERED: "device.discovered",
  DEVICE_OFFLINE: "device.offline",
};

/**
 * Delivery status
 */
const DELIVERY_STATUS = {
  PENDING: "pending",
  DELIVERED: "delivered",
  FAILED: "failed",
  RETRYING: "retrying",
};

/**
 * Default configuration
 */
const DEFAULTS = {
  maxWebhooks: 50,
  maxRetries: 3,
  retryDelays: [5000, 30000, 300000], // 5s, 30s, 5min
  deliveryTimeout: 10000, // 10s
  maxDeliveryLog: 1000,
  signatureAlgorithm: "sha256",
  userAgent: "ChainlessChain-Cowork/2.0.0",
};

/**
 * WebhookManager — Event notification delivery
 */
class WebhookManager extends EventEmitter {
  /**
   * @param {Object} options
   * @param {Object} options.teammateTool - TeammateTool instance
   * @param {Object} options.p2pNetwork - P2PAgentNetwork instance
   * @param {Object} options.deviceDiscovery - DeviceDiscovery instance
   * @param {Object} options.db - Database instance
   * @param {Object} options.config - Override defaults
   */
  constructor(options = {}) {
    super();
    this.teammateTool = options.teammateTool || null;
    this.p2pNetwork = options.p2pNetwork || null;
    this.deviceDiscovery = options.deviceDiscovery || null;
    this.db = options.db || null;

    this.config = { ...DEFAULTS, ...options.config };
    this.initialized = false;

    // Webhook registry: webhookId → WebhookConfig
    this.webhooks = new Map();

    // Delivery log
    this.deliveryLog = [];

    // Retry queue
    this._retryTimers = new Map();

    // Stats
    this.stats = {
      totalDeliveries: 0,
      successfulDeliveries: 0,
      failedDeliveries: 0,
      retries: 0,
    };
  }

  /**
   * Initialize webhook manager and bind event sources
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    // Bind to event sources
    this._bindEventSources();

    // Load webhooks from DB
    if (this.db) {
      this._ensureTables();
      this._loadWebhooksFromDB();
    }

    this.initialized = true;
    logger.info(
      `[WebhookManager] Initialized — ${this.webhooks.size} webhook(s) loaded`,
    );
    this.emit("initialized");
  }

  // ============================================================
  // Webhook Registration
  // ============================================================

  /**
   * Register a new webhook
   * @param {Object} config - { url, events, secret, metadata, active }
   * @returns {Object} Registered webhook
   */
  registerWebhook(config) {
    if (this.webhooks.size >= this.config.maxWebhooks) {
      throw new Error(`Max webhooks reached (${this.config.maxWebhooks})`);
    }
    if (!config.url) {
      throw new Error("Webhook URL is required");
    }
    if (
      !config.events ||
      !Array.isArray(config.events) ||
      config.events.length === 0
    ) {
      throw new Error("At least one event type is required");
    }

    const webhookId = `wh-${uuidv4().slice(0, 12)}`;
    const webhook = {
      id: webhookId,
      url: config.url,
      events: config.events,
      secret: config.secret || null,
      metadata: config.metadata || {},
      active: config.active !== false,
      createdAt: new Date().toISOString(),
      deliveryCount: 0,
      lastDelivery: null,
      failCount: 0,
    };

    this.webhooks.set(webhookId, webhook);

    // Persist
    if (this.db) {
      this._persistWebhook(webhook);
    }

    this.emit("webhook-registered", webhook);
    logger.info(
      `[WebhookManager] Webhook registered: ${webhookId} → ${config.url} (events: ${config.events.join(", ")})`,
    );

    return webhook;
  }

  /**
   * Unregister a webhook
   * @param {string} webhookId
   */
  unregisterWebhook(webhookId) {
    const webhook = this.webhooks.get(webhookId);
    if (!webhook) {
      throw new Error(`Webhook not found: ${webhookId}`);
    }

    this.webhooks.delete(webhookId);

    // Clear pending retries
    const retryTimer = this._retryTimers.get(webhookId);
    if (retryTimer) {
      clearTimeout(retryTimer);
      this._retryTimers.delete(webhookId);
    }

    // Remove from DB
    if (this.db) {
      try {
        this.db.run("DELETE FROM cowork_webhooks WHERE id = ?", [webhookId]);
      } catch {
        // Ignore
      }
    }

    this.emit("webhook-unregistered", { webhookId });
    logger.info(`[WebhookManager] Webhook unregistered: ${webhookId}`);
  }

  /**
   * Update webhook configuration
   * @param {string} webhookId
   * @param {Object} updates - { url, events, secret, active, metadata }
   * @returns {Object} Updated webhook
   */
  updateWebhook(webhookId, updates) {
    const webhook = this.webhooks.get(webhookId);
    if (!webhook) {
      throw new Error(`Webhook not found: ${webhookId}`);
    }

    if (updates.url !== undefined) {
      webhook.url = updates.url;
    }
    if (updates.events !== undefined) {
      webhook.events = updates.events;
    }
    if (updates.secret !== undefined) {
      webhook.secret = updates.secret;
    }
    if (updates.active !== undefined) {
      webhook.active = updates.active;
    }
    if (updates.metadata !== undefined) {
      Object.assign(webhook.metadata, updates.metadata);
    }

    if (this.db) {
      this._persistWebhook(webhook);
    }

    return webhook;
  }

  /**
   * List all webhooks
   * @returns {Object[]}
   */
  listWebhooks() {
    return Array.from(this.webhooks.values()).map((wh) => ({
      id: wh.id,
      url: wh.url,
      events: wh.events,
      active: wh.active,
      createdAt: wh.createdAt,
      deliveryCount: wh.deliveryCount,
      lastDelivery: wh.lastDelivery,
      failCount: wh.failCount,
    }));
  }

  // ============================================================
  // Event Dispatching
  // ============================================================

  /**
   * Dispatch an event to matching webhooks
   * @param {string} eventType - Event type (e.g. "task.completed")
   * @param {Object} data - Event payload
   */
  async dispatch(eventType, data) {
    const matchingWebhooks = Array.from(this.webhooks.values()).filter(
      (wh) =>
        wh.active && (wh.events.includes(eventType) || wh.events.includes("*")),
    );

    if (matchingWebhooks.length === 0) {
      return;
    }

    const deliveries = matchingWebhooks.map((webhook) =>
      this._deliver(webhook, eventType, data),
    );

    await Promise.allSettled(deliveries);
  }

  // ============================================================
  // Statistics
  // ============================================================

  /**
   * Get webhook manager statistics
   * @returns {Object}
   */
  getStats() {
    return {
      webhooks: {
        total: this.webhooks.size,
        active: Array.from(this.webhooks.values()).filter((w) => w.active)
          .length,
      },
      deliveries: { ...this.stats },
      recentDeliveries: this.deliveryLog.slice(-20),
    };
  }

  /**
   * Get delivery log for a specific webhook
   * @param {string} webhookId
   * @param {number} limit
   * @returns {Object[]}
   */
  getDeliveryLog(webhookId, limit = 20) {
    return this.deliveryLog
      .filter((d) => d.webhookId === webhookId)
      .slice(-limit);
  }

  /**
   * Shutdown webhook manager
   */
  async shutdown() {
    for (const [, timer] of this._retryTimers) {
      clearTimeout(timer);
    }
    this._retryTimers.clear();
    this.initialized = false;
    this.emit("shutdown");
    logger.info("[WebhookManager] Shutdown complete");
  }

  // ============================================================
  // Internal: Event Source Binding
  // ============================================================

  _bindEventSources() {
    // TeammateTool events
    if (this.teammateTool) {
      this.teammateTool.on("team-spawned", (team) =>
        this.dispatch(WEBHOOK_EVENTS.TEAM_CREATED, { team }),
      );
      this.teammateTool.on("team-destroyed", (data) =>
        this.dispatch(WEBHOOK_EVENTS.TEAM_DESTROYED, data),
      );
      this.teammateTool.on("team-paused", (data) =>
        this.dispatch(WEBHOOK_EVENTS.TEAM_PAUSED, data),
      );
      this.teammateTool.on("team-resumed", (data) =>
        this.dispatch(WEBHOOK_EVENTS.TEAM_RESUMED, data),
      );
      this.teammateTool.on("agent-joined", (data) =>
        this.dispatch(WEBHOOK_EVENTS.AGENT_JOINED, data),
      );
      this.teammateTool.on("agent-terminated", (data) =>
        this.dispatch(WEBHOOK_EVENTS.AGENT_TERMINATED, data),
      );
      this.teammateTool.on("task-assigned", (data) =>
        this.dispatch(WEBHOOK_EVENTS.TASK_ASSIGNED, data),
      );
      this.teammateTool.on("decision-voted", (data) =>
        this.dispatch(WEBHOOK_EVENTS.VOTE_COMPLETED, data),
      );
    }

    // P2P Network events
    if (this.p2pNetwork) {
      this.p2pNetwork.on("remote-agent-registered", (agent) =>
        this.dispatch(WEBHOOK_EVENTS.AGENT_REMOTE_CONNECTED, { agent }),
      );
      this.p2pNetwork.on("remote-agent-unregistered", (data) =>
        this.dispatch(WEBHOOK_EVENTS.AGENT_REMOTE_DISCONNECTED, data),
      );
      this.p2pNetwork.on("task-delegated", (data) =>
        this.dispatch(WEBHOOK_EVENTS.TASK_DELEGATED, data),
      );
      this.p2pNetwork.on("remote-task-completed", (data) => {
        if (data.success) {
          this.dispatch(WEBHOOK_EVENTS.TASK_COMPLETED, data);
        } else {
          this.dispatch(WEBHOOK_EVENTS.TASK_FAILED, data);
        }
      });
    }

    // Device Discovery events
    if (this.deviceDiscovery) {
      this.deviceDiscovery.on("device-discovered", (device) =>
        this.dispatch(WEBHOOK_EVENTS.DEVICE_DISCOVERED, { device }),
      );
      this.deviceDiscovery.on("device-offline", (device) =>
        this.dispatch(WEBHOOK_EVENTS.DEVICE_OFFLINE, { device }),
      );
    }
  }

  // ============================================================
  // Internal: Delivery
  // ============================================================

  async _deliver(webhook, eventType, data, attempt = 0) {
    const deliveryId = `dlv-${uuidv4().slice(0, 10)}`;
    const timestamp = new Date().toISOString();

    const payload = JSON.stringify({
      id: deliveryId,
      event: eventType,
      timestamp,
      data,
    });

    const headers = {
      "Content-Type": "application/json",
      "User-Agent": this.config.userAgent,
      "X-Webhook-Event": eventType,
      "X-Webhook-Delivery": deliveryId,
      "X-Webhook-Timestamp": timestamp,
    };

    // HMAC signature
    if (webhook.secret) {
      const signature = crypto
        .createHmac(this.config.signatureAlgorithm, webhook.secret)
        .update(payload)
        .digest("hex");
      headers["X-Webhook-Signature"] =
        `${this.config.signatureAlgorithm}=${signature}`;
    }

    this.stats.totalDeliveries++;

    try {
      const response = await this._httpPost(webhook.url, payload, headers);

      // Success
      webhook.deliveryCount++;
      webhook.lastDelivery = timestamp;
      this.stats.successfulDeliveries++;

      this._logDelivery(
        deliveryId,
        webhook.id,
        eventType,
        DELIVERY_STATUS.DELIVERED,
        response.statusCode,
        attempt,
      );
      this.emit("delivery-success", {
        deliveryId,
        webhookId: webhook.id,
        eventType,
      });
    } catch (error) {
      // Failure — retry?
      if (attempt < this.config.maxRetries) {
        this.stats.retries++;
        const delay = this.config.retryDelays[attempt] || 60000;

        this._logDelivery(
          deliveryId,
          webhook.id,
          eventType,
          DELIVERY_STATUS.RETRYING,
          null,
          attempt,
          error.message,
        );

        const timer = setTimeout(() => {
          this._deliver(webhook, eventType, data, attempt + 1);
          this._retryTimers.delete(`${webhook.id}:${deliveryId}`);
        }, delay);

        this._retryTimers.set(`${webhook.id}:${deliveryId}`, timer);

        logger.warn(
          `[WebhookManager] Delivery failed, retrying in ${delay}ms: ${error.message}`,
        );
      } else {
        // Give up
        webhook.failCount++;
        this.stats.failedDeliveries++;

        this._logDelivery(
          deliveryId,
          webhook.id,
          eventType,
          DELIVERY_STATUS.FAILED,
          null,
          attempt,
          error.message,
        );
        this.emit("delivery-failed", {
          deliveryId,
          webhookId: webhook.id,
          eventType,
          error: error.message,
        });

        logger.error(
          `[WebhookManager] Delivery permanently failed: ${webhook.url} — ${error.message}`,
        );
      }
    }
  }

  _httpPost(url, body, headers) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const transport = parsed.protocol === "https:" ? https : http;

      const req = transport.request(
        {
          hostname: parsed.hostname,
          port: parsed.port,
          path: parsed.pathname + parsed.search,
          method: "POST",
          headers: {
            ...headers,
            "Content-Length": Buffer.byteLength(body),
          },
          timeout: this.config.deliveryTimeout,
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => {
            data += chunk;
          });
          res.on("end", () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve({ statusCode: res.statusCode, body: data });
            } else {
              reject(
                new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`),
              );
            }
          });
        },
      );

      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Delivery timeout"));
      });

      req.write(body);
      req.end();
    });
  }

  // ============================================================
  // Internal: Logging & Persistence
  // ============================================================

  _logDelivery(
    deliveryId,
    webhookId,
    eventType,
    status,
    httpStatus,
    attempt,
    error,
  ) {
    const entry = {
      deliveryId,
      webhookId,
      eventType,
      status,
      httpStatus,
      attempt,
      error: error || null,
      timestamp: new Date().toISOString(),
    };

    this.deliveryLog.push(entry);
    if (this.deliveryLog.length > this.config.maxDeliveryLog) {
      this.deliveryLog = this.deliveryLog.slice(-500);
    }

    // Persist to DB
    if (this.db) {
      try {
        this.db.run(
          `INSERT INTO cowork_webhook_deliveries
           (id, webhook_id, event_type, status, http_status, attempt, error, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            deliveryId,
            webhookId,
            eventType,
            status,
            httpStatus,
            attempt,
            error,
            entry.timestamp,
          ],
        );
      } catch {
        // Ignore DB errors for logging
      }
    }
  }

  _ensureTables() {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS cowork_webhooks (
          id TEXT PRIMARY KEY,
          url TEXT NOT NULL,
          events TEXT DEFAULT '[]',
          secret TEXT,
          metadata TEXT DEFAULT '{}',
          active INTEGER DEFAULT 1,
          delivery_count INTEGER DEFAULT 0,
          last_delivery TEXT,
          fail_count INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS cowork_webhook_deliveries (
          id TEXT PRIMARY KEY,
          webhook_id TEXT NOT NULL,
          event_type TEXT NOT NULL,
          status TEXT DEFAULT 'pending',
          http_status INTEGER,
          attempt INTEGER DEFAULT 0,
          error TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          FOREIGN KEY (webhook_id) REFERENCES cowork_webhooks(id)
        );
        CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook ON cowork_webhook_deliveries(webhook_id);
        CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status ON cowork_webhook_deliveries(status);
      `);
    } catch (err) {
      logger.warn(`[WebhookManager] Table creation warning: ${err.message}`);
    }
  }

  _persistWebhook(webhook) {
    try {
      this.db.run(
        `INSERT OR REPLACE INTO cowork_webhooks
         (id, url, events, secret, metadata, active, delivery_count, last_delivery, fail_count, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          webhook.id,
          webhook.url,
          JSON.stringify(webhook.events),
          webhook.secret,
          JSON.stringify(webhook.metadata),
          webhook.active ? 1 : 0,
          webhook.deliveryCount,
          webhook.lastDelivery,
          webhook.failCount,
          webhook.createdAt,
        ],
      );
    } catch (err) {
      logger.warn(`[WebhookManager] Webhook persist error: ${err.message}`);
    }
  }

  _loadWebhooksFromDB() {
    try {
      const rows = this.db.prepare("SELECT * FROM cowork_webhooks").all();
      for (const row of rows) {
        this.webhooks.set(row.id, {
          id: row.id,
          url: row.url,
          events: JSON.parse(row.events || "[]"),
          secret: row.secret,
          metadata: JSON.parse(row.metadata || "{}"),
          active: !!row.active,
          deliveryCount: row.delivery_count || 0,
          lastDelivery: row.last_delivery,
          failCount: row.fail_count || 0,
          createdAt: row.created_at,
        });
      }
    } catch {
      // Table may not exist yet
    }
  }
}

// Singleton
let _instance = null;

function getWebhookManager() {
  if (!_instance) {
    _instance = new WebhookManager();
  }
  return _instance;
}

module.exports = {
  WebhookManager,
  getWebhookManager,
  WEBHOOK_EVENTS,
  DELIVERY_STATUS,
};

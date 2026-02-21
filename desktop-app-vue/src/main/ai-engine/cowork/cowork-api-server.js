/**
 * Cowork API Server — v2.0.0
 *
 * RESTful API server built on MCP SDK HTTP Server pattern.
 * Exposes core Cowork operations (teams, tasks, agents, skills, recordings)
 * for external system integration. Supports Bearer/API-Key authentication
 * and SSE streaming for real-time events.
 *
 * @module ai-engine/cowork/cowork-api-server
 */

const EventEmitter = require("events");
const http = require("http");
const { logger } = require("../../utils/logger.js");
const { v4: uuidv4 } = require("uuid");

/**
 * Default configuration
 */
const DEFAULTS = {
  port: 9100,
  host: "127.0.0.1",
  basePath: "/api/v1/cowork",
  enableSSE: true,
  enableCORS: true,
  maxBodySize: 1048576, // 1MB
  rateLimit: 100, // requests per minute
  rateLimitWindow: 60000, // 1 minute
};

/**
 * CoworkAPIServer — REST API for external Cowork integration
 */
class CoworkAPIServer extends EventEmitter {
  /**
   * @param {Object} options
   * @param {Object} options.teammateTool - TeammateTool instance
   * @param {Object} options.skillRegistry - SkillRegistry instance
   * @param {Object} options.hybridExecutor - HybridExecutor instance
   * @param {Object} options.deviceDiscovery - DeviceDiscovery instance
   * @param {Object} options.webhookManager - WebhookManager instance
   * @param {Object} options.auth - { type: 'bearer'|'api-key', tokens: string[] }
   * @param {Object} options.config - Override defaults
   */
  constructor(options = {}) {
    super();
    this.teammateTool = options.teammateTool || null;
    this.skillRegistry = options.skillRegistry || null;
    this.hybridExecutor = options.hybridExecutor || null;
    this.deviceDiscovery = options.deviceDiscovery || null;
    this.webhookManager = options.webhookManager || null;

    this.auth = options.auth || null;
    this.config = { ...DEFAULTS, ...options.config };

    this.server = null;
    this.sseClients = new Map(); // clientId → response
    this.running = false;

    // Rate limiting
    this._requestCounts = new Map();
    this._rateLimitTimer = null;
  }

  /**
   * Start the API server
   * @returns {Promise<void>}
   */
  async start() {
    if (this.running) {
      logger.warn("[CoworkAPIServer] Already running");
      return;
    }

    this.server = http.createServer((req, res) => {
      this._handleRequest(req, res);
    });

    return new Promise((resolve, reject) => {
      this.server.listen(this.config.port, this.config.host, () => {
        this.running = true;
        this._startRateLimitCleanup();
        logger.info(
          `[CoworkAPIServer] Listening on ${this.config.host}:${this.config.port}`,
        );
        this.emit("started", {
          host: this.config.host,
          port: this.config.port,
        });
        resolve();
      });

      this.server.on("error", (err) => {
        logger.error(`[CoworkAPIServer] Server error: ${err.message}`);
        reject(err);
      });
    });
  }

  /**
   * Stop the API server
   * @returns {Promise<void>}
   */
  async stop() {
    if (!this.running) {
      return;
    }

    // Close SSE connections
    for (const [clientId, res] of this.sseClients) {
      res.end();
    }
    this.sseClients.clear();

    if (this._rateLimitTimer) {
      clearInterval(this._rateLimitTimer);
    }

    return new Promise((resolve) => {
      this.server.close(() => {
        this.running = false;
        logger.info("[CoworkAPIServer] Stopped");
        this.emit("stopped");
        resolve();
      });
    });
  }

  /**
   * Broadcast event to all SSE clients
   * @param {string} eventType - Event name
   * @param {Object} data - Event data
   */
  broadcastSSE(eventType, data) {
    const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const [clientId, res] of this.sseClients) {
      try {
        res.write(payload);
      } catch {
        this.sseClients.delete(clientId);
      }
    }
  }

  // ============================================================
  // Request Handling
  // ============================================================

  async _handleRequest(req, res) {
    // CORS
    if (this.config.enableCORS) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, OPTIONS",
      );
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, X-API-Key",
      );
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }
    }

    // Rate limiting
    const clientIP = req.socket.remoteAddress;
    if (!this._checkRateLimit(clientIP)) {
      this._sendJSON(res, 429, { error: "Rate limit exceeded" });
      return;
    }

    // Authentication
    if (this.auth && !this._authenticate(req)) {
      this._sendJSON(res, 401, { error: "Unauthorized" });
      return;
    }

    const url = new URL(req.url, `http://${this.config.host}`);
    const path = url.pathname.replace(this.config.basePath, "");

    try {
      // SSE endpoint
      if (path === "/events" && req.method === "GET") {
        this._handleSSE(req, res);
        return;
      }

      // Parse body for POST/PUT
      let body = null;
      if (["POST", "PUT", "PATCH"].includes(req.method)) {
        body = await this._readBody(req);
      }

      // Route to handler
      const result = await this._route(
        req.method,
        path,
        body,
        url.searchParams,
      );
      this._sendJSON(res, result.status || 200, result.data);
    } catch (error) {
      logger.error(`[CoworkAPIServer] ${req.method} ${path}: ${error.message}`);
      this._sendJSON(res, error.status || 500, {
        error: error.message,
      });
    }
  }

  async _route(method, path, body, query) {
    // Teams
    if (path === "/teams" && method === "GET") {
      return this._getTeams(query);
    }
    if (path === "/teams" && method === "POST") {
      return this._createTeam(body);
    }
    if (path.match(/^\/teams\/[\w-]+$/) && method === "GET") {
      return this._getTeam(path.split("/")[2]);
    }
    if (path.match(/^\/teams\/[\w-]+$/) && method === "DELETE") {
      return this._destroyTeam(path.split("/")[2]);
    }

    // Tasks
    if (path.match(/^\/teams\/[\w-]+\/tasks$/) && method === "POST") {
      return this._assignTask(path.split("/")[2], body);
    }
    if (path.match(/^\/teams\/[\w-]+\/tasks$/) && method === "GET") {
      return this._getTeamTasks(path.split("/")[2]);
    }

    // Agents
    if (path.match(/^\/teams\/[\w-]+\/agents$/) && method === "POST") {
      return this._joinTeam(path.split("/")[2], body);
    }
    if (path.match(/^\/teams\/[\w-]+\/agents$/) && method === "GET") {
      return this._listMembers(path.split("/")[2]);
    }

    // Skills
    if (path === "/skills" && method === "GET") {
      return this._getSkills(query);
    }
    if (path === "/skills/execute" && method === "POST") {
      return this._executeSkill(body);
    }

    // Devices
    if (path === "/devices" && method === "GET") {
      return this._getDevices(query);
    }
    if (path === "/devices/skills" && method === "GET") {
      return this._getNetworkSkills();
    }

    // Webhooks
    if (path === "/webhooks" && method === "GET") {
      return this._getWebhooks();
    }
    if (path === "/webhooks" && method === "POST") {
      return this._createWebhook(body);
    }
    if (path.match(/^\/webhooks\/[\w-]+$/) && method === "DELETE") {
      return this._deleteWebhook(path.split("/")[2]);
    }

    // Stats
    if (path === "/stats" && method === "GET") {
      return this._getStats();
    }

    // Health
    if (path === "/health" && method === "GET") {
      return { status: 200, data: { status: "ok", uptime: process.uptime() } };
    }

    const err = new Error(`Not found: ${method} ${path}`);
    err.status = 404;
    throw err;
  }

  // ============================================================
  // Route Handlers
  // ============================================================

  async _getTeams(query) {
    if (!this.teammateTool) {
      throw this._unavailable("TeammateTool");
    }

    const filters = {};
    if (query.get("status")) {
      filters.status = query.get("status");
    }

    const teams = await this.teammateTool.discoverTeams(filters);
    return { data: { success: true, teams } };
  }

  async _createTeam(body) {
    if (!this.teammateTool) {
      throw this._unavailable("TeammateTool");
    }

    const result = await this.teammateTool.spawnTeam(
      body.name,
      body.config || {},
    );
    return { status: 201, data: { success: true, team: result } };
  }

  async _getTeam(teamId) {
    if (!this.teammateTool) {
      throw this._unavailable("TeammateTool");
    }

    const status = await this.teammateTool.getTeamStatus(teamId);
    return { data: { success: true, team: status } };
  }

  async _destroyTeam(teamId) {
    if (!this.teammateTool) {
      throw this._unavailable("TeammateTool");
    }

    await this.teammateTool.destroyTeam(teamId);
    return { data: { success: true, teamId } };
  }

  async _assignTask(teamId, body) {
    if (!this.teammateTool) {
      throw this._unavailable("TeammateTool");
    }

    const result = await this.teammateTool.assignTask(teamId, body.agentId, {
      description: body.description,
      type: body.type,
      priority: body.priority || "MEDIUM",
      timeout: body.timeout,
    });
    return { status: 201, data: { success: true, ...result } };
  }

  async _getTeamTasks(teamId) {
    if (!this.teammateTool) {
      throw this._unavailable("TeammateTool");
    }

    const status = await this.teammateTool.getTeamStatus(teamId);
    return {
      data: {
        success: true,
        tasks: status.tasks || [],
      },
    };
  }

  async _joinTeam(teamId, body) {
    if (!this.teammateTool) {
      throw this._unavailable("TeammateTool");
    }

    const result = await this.teammateTool.requestJoin(
      teamId,
      body.agentId,
      body.agentInfo || {},
    );
    return { status: 201, data: { success: true, ...result } };
  }

  async _listMembers(teamId) {
    if (!this.teammateTool) {
      throw this._unavailable("TeammateTool");
    }

    const members = await this.teammateTool.listMembers(teamId);
    return { data: { success: true, members } };
  }

  async _getSkills(query) {
    if (!this.skillRegistry) {
      throw this._unavailable("SkillRegistry");
    }

    let skills = this.skillRegistry.getSkillList();
    if (query.get("category")) {
      skills = skills.filter((s) => s.category === query.get("category"));
    }
    return { data: { success: true, skills, total: skills.length } };
  }

  async _executeSkill(body) {
    if (!body.skillId) {
      const err = new Error("skillId is required");
      err.status = 400;
      throw err;
    }

    if (this.hybridExecutor) {
      const result = await this.hybridExecutor.execute({
        skillId: body.skillId,
        description: body.description,
        input: body.input || {},
        strategy: body.strategy,
      });
      return { data: { success: true, result } };
    }

    if (this.skillRegistry) {
      const result = await this.skillRegistry.executeSkill(body.skillId, {
        description: body.description,
        ...body.input,
      });
      return { data: { success: true, result } };
    }

    throw this._unavailable("SkillRegistry/HybridExecutor");
  }

  async _getDevices(query) {
    if (!this.deviceDiscovery) {
      throw this._unavailable("DeviceDiscovery");
    }

    const filters = {};
    if (query.get("platform")) {
      filters.platform = query.get("platform");
    }
    if (query.get("state")) {
      filters.state = query.get("state");
    }

    const devices = this.deviceDiscovery.getDevices(filters);
    return { data: { success: true, devices, total: devices.length } };
  }

  async _getNetworkSkills() {
    if (!this.deviceDiscovery) {
      throw this._unavailable("DeviceDiscovery");
    }

    const catalog = this.deviceDiscovery.getNetworkSkillCatalog();
    return { data: { success: true, skills: catalog, total: catalog.length } };
  }

  async _getWebhooks() {
    if (!this.webhookManager) {
      throw this._unavailable("WebhookManager");
    }
    const webhooks = this.webhookManager.listWebhooks();
    return { data: { success: true, webhooks } };
  }

  async _createWebhook(body) {
    if (!this.webhookManager) {
      throw this._unavailable("WebhookManager");
    }

    if (!body.url || !body.events) {
      const err = new Error("url and events are required");
      err.status = 400;
      throw err;
    }

    const webhook = this.webhookManager.registerWebhook({
      url: body.url,
      events: body.events,
      secret: body.secret,
      metadata: body.metadata,
    });
    return { status: 201, data: { success: true, webhook } };
  }

  async _deleteWebhook(webhookId) {
    if (!this.webhookManager) {
      throw this._unavailable("WebhookManager");
    }

    this.webhookManager.unregisterWebhook(webhookId);
    return { data: { success: true, webhookId } };
  }

  async _getStats() {
    const stats = {};

    if (this.teammateTool) {
      stats.cowork = this.teammateTool.getStats();
    }
    if (this.deviceDiscovery) {
      stats.devices = this.deviceDiscovery.getStats();
    }
    if (this.hybridExecutor) {
      stats.executor = this.hybridExecutor.getStats();
    }
    if (this.webhookManager) {
      stats.webhooks = this.webhookManager.getStats();
    }

    stats.server = {
      uptime: process.uptime(),
      sseClients: this.sseClients.size,
    };

    return { data: { success: true, stats } };
  }

  // ============================================================
  // SSE
  // ============================================================

  _handleSSE(req, res) {
    const clientId = `sse-${uuidv4().slice(0, 8)}`;

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });

    res.write(`event: connected\ndata: ${JSON.stringify({ clientId })}\n\n`);
    this.sseClients.set(clientId, res);

    req.on("close", () => {
      this.sseClients.delete(clientId);
      this.emit("sse-client-disconnected", { clientId });
    });

    this.emit("sse-client-connected", { clientId });
    logger.info(`[CoworkAPIServer] SSE client connected: ${clientId}`);
  }

  // ============================================================
  // Internal: HTTP Helpers
  // ============================================================

  _sendJSON(res, status, data) {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  }

  _readBody(req) {
    return new Promise((resolve, reject) => {
      let body = "";
      let size = 0;

      req.on("data", (chunk) => {
        size += chunk.length;
        if (size > this.config.maxBodySize) {
          reject(
            Object.assign(new Error("Request body too large"), { status: 413 }),
          );
          req.destroy();
          return;
        }
        body += chunk;
      });

      req.on("end", () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch {
          reject(
            Object.assign(new Error("Invalid JSON body"), { status: 400 }),
          );
        }
      });

      req.on("error", reject);
    });
  }

  _authenticate(req) {
    if (!this.auth) {
      return true;
    }

    if (this.auth.type === "bearer") {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith("Bearer ")) {
        return false;
      }
      const token = authHeader.slice(7);
      return (this.auth.tokens || []).includes(token);
    }

    if (this.auth.type === "api-key") {
      const apiKey =
        req.headers["x-api-key"] ||
        new URL(req.url, `http://${this.config.host}`).searchParams.get(
          "api_key",
        );
      return (this.auth.tokens || []).includes(apiKey);
    }

    return false;
  }

  _checkRateLimit(clientIP) {
    const count = this._requestCounts.get(clientIP) || 0;
    if (count >= this.config.rateLimit) {
      return false;
    }
    this._requestCounts.set(clientIP, count + 1);
    return true;
  }

  _startRateLimitCleanup() {
    this._rateLimitTimer = setInterval(() => {
      this._requestCounts.clear();
    }, this.config.rateLimitWindow);
  }

  _unavailable(component) {
    const err = new Error(`${component} is not available`);
    err.status = 503;
    return err;
  }
}

// Singleton
let _instance = null;

function getCoworkAPIServer() {
  if (!_instance) {
    _instance = new CoworkAPIServer();
  }
  return _instance;
}

module.exports = {
  CoworkAPIServer,
  getCoworkAPIServer,
};

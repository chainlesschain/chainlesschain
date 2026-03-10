const { EventEmitter } = require("events");
const crypto = require("crypto");
const { logger } = require("../../utils/logger.js");

let graphqlLib = null;
try {
  graphqlLib = require("graphql");
} catch (_err) {
  logger.warn(
    "[GraphQL API] graphql package not available, using simulation mode",
  );
}

const OPERATION_TYPE = {
  QUERY: "query",
  MUTATION: "mutation",
  SUBSCRIPTION: "subscription",
};

const API_KEY_STATUS = {
  ACTIVE: "active",
  REVOKED: "revoked",
  EXPIRED: "expired",
};

const DEFAULT_CONFIG = {
  maxDepth: 10,
  maxComplexity: 1000,
  defaultRateLimit: 100,
  rateLimitWindowMs: 86400000, // 24h
  enableIntrospection: true,
  enableSubscriptions: true,
  cleanupIntervalMs: 3600000, // 1h
  logQueries: true,
};

class GraphQLAPIManager extends EventEmitter {
  constructor() {
    super();
    this.initialized = false;
    this.db = null;
    this._deps = {};
    this._schema = null;
    this._resolvers = null;
    this._apiKeys = new Map();
    this._subscribers = new Map();
    this._config = { ...DEFAULT_CONFIG };
    this._queryCount = 0;
    this._totalDurationMs = 0;
    this._cleanupTimer = null;
    this._subscriptionCounter = 0;
  }

  async initialize(db, deps = {}) {
    if (this.initialized) {
      logger.info("[GraphQL API] Already initialized, skipping");
      return;
    }

    this.db = db;
    this._deps = deps;

    this._ensureTables();
    this._loadApiKeys();
    this.buildSchema();
    this._startCleanupTimer();

    this.initialized = true;
    logger.info("[GraphQL API] Initialized successfully");
  }

  buildSchema() {
    const { typeDefs } = require("./graphql-schema.js");
    const { createResolvers } = require("./graphql-resolvers.js");

    this._resolvers = createResolvers({
      ...this._deps,
      graphqlManager: this,
    });

    if (graphqlLib) {
      this._schema = graphqlLib.buildSchema(typeDefs);
    } else {
      this._schema = null;
      logger.warn(
        "[GraphQL API] Schema built in simulation mode (no graphql library)",
      );
    }

    return this._schema;
  }

  getSchemaSDL() {
    const { typeDefs } = require("./graphql-schema.js");
    return typeDefs;
  }

  async executeQuery(query, variables = {}, context = {}) {
    if (!this.initialized) {
      throw new Error("GraphQL API Manager not initialized");
    }

    // Validate API key if provided
    if (context.apiKeyId) {
      const validation = this.validateAPIKey(context.apiKeyId);
      if (!validation.valid) {
        throw new Error(`API key validation failed: ${validation.reason}`);
      }
      this._checkRateLimit(validation.keyId);
    }

    const startTime = Date.now();
    let operationType = "query";
    let operationName = "anonymous";
    let result;

    if (graphqlLib) {
      const document = graphqlLib.parse(query);
      const operationDef = document.definitions.find(
        (d) => d.kind === "OperationDefinition",
      );
      operationType = operationDef ? operationDef.operation : "query";
      operationName = operationDef?.name?.value || "anonymous";

      result = await graphqlLib.graphql({
        schema: this._schema,
        source: query,
        variableValues: variables,
        contextValue: { ...this._deps, db: this.db },
        rootValue: this._resolvers,
      });
    } else {
      // Simulation mode
      const queryTrimmed = query.trim();
      if (queryTrimmed.startsWith("mutation")) {
        operationType = "mutation";
      } else if (queryTrimmed.startsWith("subscription")) {
        operationType = "subscription";
      }

      const nameMatch = queryTrimmed.match(
        /(?:query|mutation|subscription)\s+(\w+)/,
      );
      operationName = nameMatch ? nameMatch[1] : "anonymous";

      result = {
        data: {},
        _simulated: true,
      };
    }

    const durationMs = Date.now() - startTime;
    this._queryCount++;
    this._totalDurationMs += durationMs;

    this._logQuery({
      apiKeyId: context.apiKeyId,
      operationType,
      operationName,
      query,
      variables,
      durationMs,
      status: result.errors ? "error" : "success",
      error: result.errors?.[0]?.message,
    });

    this.emit("query:executed", {
      operationType,
      operationName,
      durationMs,
      status: result.errors ? "error" : "success",
    });

    return result;
  }

  createAPIKey(name, options = {}) {
    if (!this.initialized) {
      throw new Error("GraphQL API Manager not initialized");
    }

    const id = crypto.randomUUID();
    const key = crypto.randomBytes(32).toString("hex");
    const keyHash = this._hashKey(key);
    const permissions = options.permissions || ["query"];
    const rateLimit = options.rateLimit || this._config.defaultRateLimit;
    const expiresAt = options.expiresAt || null;
    const createdAt = new Date().toISOString();

    const apiKeyData = {
      id,
      keyHash,
      name,
      permissions,
      rateLimit,
      requestsToday: 0,
      status: API_KEY_STATUS.ACTIVE,
      lastUsedAt: null,
      expiresAt,
      createdAt,
    };

    this._persistApiKey(apiKeyData);
    this._apiKeys.set(id, apiKeyData);

    this.emit("apikey:created", { id, name });
    logger.info(`[GraphQL API] API key created: ${name} (${id})`);

    return {
      id,
      key,
      name,
      permissions,
      rateLimit,
      createdAt,
    };
  }

  revokeAPIKey(keyId) {
    if (!this.initialized) {
      throw new Error("GraphQL API Manager not initialized");
    }

    const apiKey = this._apiKeys.get(keyId);
    if (!apiKey) {
      throw new Error(`API key not found: ${keyId}`);
    }

    apiKey.status = API_KEY_STATUS.REVOKED;
    this._updateApiKey(keyId, { status: API_KEY_STATUS.REVOKED });

    this.emit("apikey:revoked", { id: keyId });
    logger.info(`[GraphQL API] API key revoked: ${keyId}`);
  }

  listAPIKeys() {
    if (!this.initialized) {
      return [];
    }

    const keys = [];
    for (const [, apiKey] of this._apiKeys) {
      keys.push({
        id: apiKey.id,
        name: apiKey.name,
        permissions: apiKey.permissions,
        rateLimit: apiKey.rateLimit,
        requestsToday: apiKey.requestsToday,
        status: apiKey.status,
        createdAt: apiKey.createdAt,
      });
    }
    return keys;
  }

  validateAPIKey(key) {
    if (!this.initialized) {
      return { valid: false, reason: "Not initialized" };
    }

    const keyHash = this._hashKey(key);

    for (const [id, apiKey] of this._apiKeys) {
      if (apiKey.keyHash === keyHash) {
        if (apiKey.status === API_KEY_STATUS.REVOKED) {
          return {
            valid: false,
            keyId: id,
            permissions: apiKey.permissions,
            reason: "Key revoked",
          };
        }

        if (apiKey.expiresAt && new Date(apiKey.expiresAt) < new Date()) {
          return {
            valid: false,
            keyId: id,
            permissions: apiKey.permissions,
            reason: "Key expired",
          };
        }

        if (apiKey.requestsToday >= apiKey.rateLimit) {
          return {
            valid: false,
            keyId: id,
            permissions: apiKey.permissions,
            reason: "Rate limit exceeded",
          };
        }

        apiKey.lastUsedAt = new Date().toISOString();
        apiKey.requestsToday++;
        this._updateApiKey(id, {
          lastUsedAt: apiKey.lastUsedAt,
          requestsToday: apiKey.requestsToday,
        });

        return { valid: true, keyId: id, permissions: apiKey.permissions };
      }
    }

    return { valid: false, reason: "Invalid key" };
  }

  getQueryLog(filter = {}) {
    if (!this.initialized) {
      return [];
    }

    let sql = "SELECT * FROM graphql_query_log WHERE 1=1";
    const params = [];

    if (filter.apiKeyId) {
      sql += " AND api_key_id = ?";
      params.push(filter.apiKeyId);
    }
    if (filter.operationType) {
      sql += " AND operation_type = ?";
      params.push(filter.operationType);
    }
    if (filter.status) {
      sql += " AND status = ?";
      params.push(filter.status);
    }

    sql += " ORDER BY created_at DESC LIMIT ?";
    params.push(filter.limit || 100);

    try {
      const stmt = this.db.prepare(sql);
      return stmt.all(...params);
    } catch (_err) {
      logger.error("[GraphQL API] Failed to get query log");
      return [];
    }
  }

  subscribe(channel, callback) {
    if (!this._subscribers.has(channel)) {
      this._subscribers.set(channel, new Map());
    }

    const subscriptionId = `sub_${++this._subscriptionCounter}`;
    this._subscribers.get(channel).set(subscriptionId, callback);

    logger.info(
      `[GraphQL API] Subscription added: ${channel} (${subscriptionId})`,
    );
    return subscriptionId;
  }

  publish(channel, data) {
    const channelSubs = this._subscribers.get(channel);
    if (!channelSubs || channelSubs.size === 0) {
      return;
    }

    for (const [, callback] of channelSubs) {
      try {
        callback(data);
      } catch (_err) {
        logger.error("[GraphQL API] Subscription callback error");
      }
    }

    this.emit("subscription:published", {
      channel,
      subscriberCount: channelSubs.size,
    });
  }

  unsubscribe(subscriptionId) {
    for (const [, channelSubs] of this._subscribers) {
      if (channelSubs.has(subscriptionId)) {
        channelSubs.delete(subscriptionId);
        logger.info(`[GraphQL API] Subscription removed: ${subscriptionId}`);
        return true;
      }
    }
    return false;
  }

  getStats() {
    const activeApiKeys = [...this._apiKeys.values()].filter(
      (k) => k.status === API_KEY_STATUS.ACTIVE,
    ).length;

    let totalSubscriptions = 0;
    for (const [, channelSubs] of this._subscribers) {
      totalSubscriptions += channelSubs.size;
    }

    // Query counts by type from DB
    const queriesByType = { query: 0, mutation: 0, subscription: 0 };
    if (this.db) {
      try {
        const stmt = this.db.prepare(
          "SELECT operation_type, COUNT(*) as count FROM graphql_query_log GROUP BY operation_type",
        );
        const rows = stmt.all();
        for (const row of rows) {
          queriesByType[row.operation_type] = row.count;
        }
      } catch (_err) {
        // Intentionally empty - stats are non-critical
      }
    }

    return {
      totalQueries: this._queryCount,
      queriesByType,
      avgDurationMs:
        this._queryCount > 0
          ? Math.round(this._totalDurationMs / this._queryCount)
          : 0,
      totalApiKeys: this._apiKeys.size,
      activeApiKeys,
      totalSubscriptions,
    };
  }

  getConfig() {
    return { ...this._config };
  }

  configure(updates) {
    Object.assign(this._config, updates);
    logger.info("[GraphQL API] Configuration updated");

    if (updates.cleanupIntervalMs) {
      this._startCleanupTimer();
    }
  }

  destroy() {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }

    this._apiKeys.clear();
    this._subscribers.clear();
    this._schema = null;
    this._resolvers = null;
    this._queryCount = 0;
    this._totalDurationMs = 0;
    this.initialized = false;

    logger.info("[GraphQL API] Destroyed");
  }

  // Private methods

  _ensureTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS graphql_api_keys (
        id TEXT PRIMARY KEY,
        key_hash TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        permissions TEXT DEFAULT '["query"]',
        rate_limit INTEGER DEFAULT 100,
        requests_today INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active',
        last_used_at TEXT,
        expires_at TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS graphql_query_log (
        id TEXT PRIMARY KEY,
        api_key_id TEXT,
        operation_type TEXT NOT NULL,
        operation_name TEXT,
        query_hash TEXT,
        variables TEXT DEFAULT '{}',
        duration_ms INTEGER DEFAULT 0,
        status TEXT DEFAULT 'success',
        error TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);
  }

  _loadApiKeys() {
    try {
      const stmt = this.db.prepare("SELECT * FROM graphql_api_keys");
      const rows = stmt.all();
      for (const row of rows) {
        this._apiKeys.set(row.id, {
          id: row.id,
          keyHash: row.key_hash,
          name: row.name,
          permissions: JSON.parse(row.permissions || '["query"]'),
          rateLimit: row.rate_limit,
          requestsToday: row.requests_today,
          status: row.status,
          lastUsedAt: row.last_used_at,
          expiresAt: row.expires_at,
          createdAt: row.created_at,
        });
      }
      logger.info(`[GraphQL API] Loaded ${rows.length} API keys`);
    } catch (_err) {
      logger.error("[GraphQL API] Failed to load API keys");
    }
  }

  _persistApiKey(apiKey) {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO graphql_api_keys (id, key_hash, name, permissions, rate_limit, requests_today, status, last_used_at, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        apiKey.id,
        apiKey.keyHash,
        apiKey.name,
        JSON.stringify(apiKey.permissions),
        apiKey.rateLimit,
        apiKey.requestsToday,
        apiKey.status,
        apiKey.lastUsedAt,
        apiKey.expiresAt,
        apiKey.createdAt,
      );
    } catch (_err) {
      logger.error("[GraphQL API] Failed to persist API key");
    }
  }

  _updateApiKey(id, updates) {
    try {
      const setClauses = [];
      const params = [];

      if (updates.status !== undefined) {
        setClauses.push("status = ?");
        params.push(updates.status);
      }
      if (updates.lastUsedAt !== undefined) {
        setClauses.push("last_used_at = ?");
        params.push(updates.lastUsedAt);
      }
      if (updates.requestsToday !== undefined) {
        setClauses.push("requests_today = ?");
        params.push(updates.requestsToday);
      }

      if (setClauses.length === 0) {
        return;
      }

      params.push(id);
      const stmt = this.db.prepare(
        `UPDATE graphql_api_keys SET ${setClauses.join(", ")} WHERE id = ?`,
      );
      stmt.run(...params);
    } catch (_err) {
      logger.error("[GraphQL API] Failed to update API key");
    }
  }

  _logQuery(entry) {
    if (!this._config.logQueries) {
      return;
    }

    try {
      const id = crypto.randomUUID();
      const queryHash = crypto
        .createHash("sha256")
        .update(entry.query)
        .digest("hex");

      const stmt = this.db.prepare(`
        INSERT INTO graphql_query_log (id, api_key_id, operation_type, operation_name, query_hash, variables, duration_ms, status, error)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        id,
        entry.apiKeyId || null,
        entry.operationType,
        entry.operationName,
        queryHash,
        JSON.stringify(entry.variables || {}),
        entry.durationMs,
        entry.status,
        entry.error || null,
      );
    } catch (_err) {
      logger.error("[GraphQL API] Failed to log query");
    }
  }

  _hashKey(key) {
    return crypto.createHash("sha256").update(key).digest("hex");
  }

  _checkRateLimit(keyId) {
    const apiKey = this._apiKeys.get(keyId);
    if (!apiKey) {
      return;
    }

    if (apiKey.requestsToday >= apiKey.rateLimit) {
      throw new Error("Rate limit exceeded");
    }
  }

  _startCleanupTimer() {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
    }

    this._cleanupTimer = setInterval(() => {
      this._resetDailyLimits();
    }, this._config.cleanupIntervalMs);

    // Prevent timer from keeping process alive
    if (this._cleanupTimer.unref) {
      this._cleanupTimer.unref();
    }
  }

  _resetDailyLimits() {
    try {
      const stmt = this.db.prepare(
        "UPDATE graphql_api_keys SET requests_today = 0",
      );
      stmt.run();

      for (const [, apiKey] of this._apiKeys) {
        apiKey.requestsToday = 0;
      }

      logger.info("[GraphQL API] Daily rate limits reset");
    } catch (_err) {
      logger.error("[GraphQL API] Failed to reset daily limits");
    }
  }
}

let instance = null;

function getGraphQLAPIManager() {
  if (!instance) {
    instance = new GraphQLAPIManager();
  }
  return instance;
}

module.exports = {
  GraphQLAPIManager,
  getGraphQLAPIManager,
  OPERATION_TYPE,
  API_KEY_STATUS,
};

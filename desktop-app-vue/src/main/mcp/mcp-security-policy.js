/**
 * MCP Security Policy
 *
 * Enforces security controls for MCP server operations.
 * Implements path restrictions, user consent, and audit logging.
 *
 * @module MCPSecurityPolicy
 */

const { logger } = require("../utils/logger.js");
const EventEmitter = require("events");
const crypto = require("crypto");

const DEFAULT_CONSENT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_PENDING_CONSENT_REQUESTS = 64;
const DEFAULT_MAX_PENDING_CONSENT_REQUESTS_PER_SERVER = 8;
const DEFAULT_MAX_CONSENT_CACHE_ENTRIES = 1024;
const CONSENT_OVERLOAD_RETRY_AFTER_MS = 1000;

function positiveInteger(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

const SENSITIVE_AUDIT_KEY =
  /(?:authorization|cookie|credential|password|private.?key|secret|token|api.?key)/i;
const LARGE_PAYLOAD_KEY = /^(?:body|content|data|input|payload)$/i;

function summarizeAuditPayload(value) {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  return {
    redacted: true,
    byteLength: Buffer.byteLength(serialized || "", "utf8"),
    sha256: crypto
      .createHash("sha256")
      .update(serialized || "")
      .digest("hex"),
  };
}

function sanitizeAuditValue(value, key = "", depth = 0) {
  if (SENSITIVE_AUDIT_KEY.test(key)) return "[REDACTED]";
  if (LARGE_PAYLOAD_KEY.test(key)) return summarizeAuditPayload(value);
  if (
    value == null ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return value;
  }
  if (typeof value === "string") return value.slice(0, 512);
  if (depth >= 4) return "[MAX_DEPTH]";
  if (Array.isArray(value)) {
    return value
      .slice(0, 20)
      .map((item) => sanitizeAuditValue(item, "", depth + 1));
  }
  if (typeof value === "object") {
    const sanitized = {};
    for (const [childKey, childValue] of Object.entries(value).slice(0, 50)) {
      sanitized[childKey] = sanitizeAuditValue(childValue, childKey, depth + 1);
    }
    return sanitized;
  }
  return String(value).slice(0, 512);
}

// Platform detection for cross-platform path handling
const isWindows = process.platform === "win32";

/**
 * Normalize a path for security comparison
 * Handles both Windows and Unix path formats
 * @param {string} inputPath - Path to normalize
 * @returns {string} Normalized path
 */
function normalizeSecurityPath(inputPath) {
  if (!inputPath) {
    return "";
  }

  // Always convert backslashes to forward slashes for consistent security comparison
  // (prevents cross-platform path confusion attacks)
  let normalized = inputPath.replace(/\\/g, "/");

  if (isWindows) {
    // Case-insensitive comparison on Windows
    normalized = normalized.toLowerCase();
  }

  // Remove trailing slashes
  normalized = normalized.replace(/\/+$/, "");

  // Normalize multiple slashes
  normalized = normalized.replace(/\/+/g, "/");

  // Remove leading ./ if present
  normalized = normalized.replace(/^\.\//, "");

  // Resolve '..' segments to prevent path traversal bypasses
  const parts = normalized.split("/");
  const resolved = [];
  for (const part of parts) {
    if (part === "..") {
      resolved.pop();
    } else if (part !== ".") {
      resolved.push(part);
    }
  }
  normalized = resolved.join("/");

  return normalized;
}

/**
 * Check if a path matches a pattern (supports wildcards)
 * @param {string} testPath - Path to test
 * @param {string} pattern - Pattern to match against
 * @returns {boolean}
 */
function pathMatchesPattern(testPath, pattern, strict = false) {
  const normalizedPath = normalizeSecurityPath(testPath);
  const normalizedPattern = normalizeSecurityPath(pattern);

  // Direct match
  if (normalizedPath === normalizedPattern) {
    return true;
  }

  // Check if path starts with pattern (directory match)
  if (normalizedPath.startsWith(normalizedPattern + "/")) {
    return true;
  }

  // Check if pattern ends with / and path is inside that directory
  if (
    normalizedPattern.endsWith("/") &&
    normalizedPath.startsWith(normalizedPattern)
  ) {
    return true;
  }

  // Pattern appears as a complete path segment (bounded on both sides).
  if (
    normalizedPath.includes("/" + normalizedPattern + "/") ||
    normalizedPath.endsWith("/" + normalizedPattern)
  ) {
    return true;
  }

  // Loose prefix-of-segment match (".../<pattern>...") — only for the
  // FORBIDDEN blacklist, where over-blocking sensitive variants (".env" also
  // matching ".env.local") is desirable. NEVER for the allowed whitelist:
  // there it would over-grant (allowed "app" matching ".../application/..."),
  // a sandbox-escape. Callers pass strict=true for whitelist checks.
  if (!strict && normalizedPath.includes("/" + normalizedPattern)) {
    return true;
  }

  return false;
}

/**
 * Security error class
 */
class SecurityError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "SecurityError";
    this.details = details;
    this.timestamp = Date.now();
  }
}

/**
 * MCP Security Policy
 */
class MCPSecurityPolicy extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = config;

    // Global forbidden paths (always blocked)
    this.FORBIDDEN_PATHS = [
      "chainlesschain.db", // Encrypted database
      "data/ukey/", // U-Key hardware data
      "data/did/private-keys/", // DID private keys
      "data/p2p/keys/", // P2P encryption keys
      ".env", // Environment variables
      "config/secrets/", // Secret configuration
    ];

    // Server-specific permissions
    this.serverPermissions = new Map();

    // User consent cache (for "always allow" decisions)
    // key: hash(serverName + toolName + paramsHash) -> consent decision
    this.consentCache = new Map();

    // Pending consent requests
    // key: requestId -> { resolve, reject, timeout, timestamp }
    this.pendingConsentRequests = new Map();

    // Consent flow control. Limits are deliberately independent from the
    // renderer so a compromised server cannot allocate an unbounded set of
    // promises/timers before the UI has a chance to respond.
    this.CONSENT_TIMEOUT = positiveInteger(
      config.consentTimeoutMs,
      DEFAULT_CONSENT_TIMEOUT_MS,
    );
    this.maxPendingConsentRequests = positiveInteger(
      config.maxPendingConsentRequests,
      DEFAULT_MAX_PENDING_CONSENT_REQUESTS,
    );
    this.maxPendingConsentRequestsPerServer = Math.min(
      this.maxPendingConsentRequests,
      positiveInteger(
        config.maxPendingConsentRequestsPerServer,
        DEFAULT_MAX_PENDING_CONSENT_REQUESTS_PER_SERVER,
      ),
    );
    this.maxConsentCacheEntries = positiveInteger(
      config.maxConsentCacheEntries,
      DEFAULT_MAX_CONSENT_CACHE_ENTRIES,
    );
    this.consentFlowStats = {
      overloads: 0,
      cacheEvictions: 0,
    };

    // Audit log
    this.auditLog = [];
    this.auditStore = config.auditStore || null;
    this.requirePersistentAudit = config.requirePersistentAudit === true;
    this.auditContextProvider =
      typeof config.auditContextProvider === "function"
        ? config.auditContextProvider
        : () => ({});
    if (
      this.requirePersistentAudit &&
      (!this.auditStore || typeof this.auditStore.append !== "function")
    ) {
      throw new SecurityError(
        "Persistent MCP security audit storage is required but unavailable",
      );
    }

    // Risk levels for operations
    this.RISK_LEVELS = {
      LOW: "low", // Read-only safe operations
      MEDIUM: "medium", // Write to allowed paths
      HIGH: "high", // Delete operations, sensitive reads
      CRITICAL: "critical", // System-level operations
    };

    // Main window reference (set by main process)
    this.mainWindow = null;

    logger.info("[MCPSecurityPolicy] Initialized");
  }

  /**
   * Set main window reference for IPC communication
   * @param {BrowserWindow} window - Electron BrowserWindow
   */
  setMainWindow(window) {
    this.mainWindow = window;
    logger.info("[MCPSecurityPolicy] Main window reference set");
  }

  /**
   * Set permissions for a specific server
   * @param {string} serverName - Server identifier
   * @param {Object} permissions - Permission configuration
   */
  setServerPermissions(serverName, permissions) {
    this.serverPermissions.set(serverName, {
      allowedPaths: permissions.allowedPaths || [],
      forbiddenPaths: permissions.forbiddenPaths || [],
      readOnly: permissions.readOnly || false,
      requireConsent:
        permissions.requireConsent !== undefined
          ? permissions.requireConsent
          : true,
    });

    logger.info(
      `[MCPSecurityPolicy] Set permissions for ${serverName}:`,
      permissions,
    );
  }

  clearServerPermissions(serverName) {
    this.serverPermissions.delete(serverName);
  }

  /**
   * Validate tool execution
   * @param {string} serverName - Server identifier
   * @param {string} toolName - Tool name
   * @param {Object} params - Tool parameters
   * @throws {SecurityError} If validation fails
   */
  async validateToolExecution(
    serverName,
    toolName,
    params,
    executionContext = {},
  ) {
    try {
      // 1. Check if server is trusted
      this._validateTrustedServer(serverName);

      // 2. Detect operation type and risk level
      const operation = this._detectOperation(toolName, params);
      const riskLevel = this._assessRiskLevel(toolName, params, operation);

      // 3. Validate path access (if applicable)
      if (params.path || params.uri || params.file) {
        const targetPath = params.path || params.uri || params.file;
        this._validatePathAccess(serverName, operation.type, targetPath);
      }

      // 4. Check read-only constraint
      if (operation.type !== "read") {
        this._validateWritePermission(serverName, operation.type);
      }

      // 5. Request user consent if needed
      if (
        riskLevel === this.RISK_LEVELS.HIGH ||
        riskLevel === this.RISK_LEVELS.CRITICAL
      ) {
        await this._requestUserConsent(serverName, toolName, params, riskLevel);
      }

      // 6. Log to audit trail
      this._logAudit(
        "ALLOWED",
        serverName,
        toolName,
        params,
        riskLevel,
        executionContext,
      );

      logger.info(
        `[MCPSecurityPolicy] Validation passed: ${serverName}.${toolName} (${riskLevel})`,
      );
    } catch (error) {
      // Log denied access
      if (error?.details?.auditPersistence !== true) {
        this._logAudit(
          "DENIED",
          serverName,
          toolName,
          params,
          error.message,
          executionContext,
        );
      }

      logger.error(`[MCPSecurityPolicy] Validation failed: ${error.message}`);

      throw error;
    }
  }

  /**
   * Validate path access
   * Uses cross-platform path normalization for consistent security checks
   * @param {string} serverName - Server identifier
   * @param {string} operation - Operation type (read/write/delete)
   * @param {string} targetPath - Path to validate
   * @throws {SecurityError} If access denied
   */
  _validatePathAccess(serverName, operation, targetPath) {
    // Use cross-platform path normalization
    const normalizedPath = normalizeSecurityPath(targetPath);

    // Check global forbidden paths using cross-platform matching
    for (const forbidden of this.FORBIDDEN_PATHS) {
      if (pathMatchesPattern(normalizedPath, forbidden)) {
        throw new SecurityError(
          `Access denied: ${targetPath} is globally forbidden`,
          { serverName, operation, targetPath, forbidden },
        );
      }
    }

    // Get server-specific permissions
    const permissions = this.serverPermissions.get(serverName);
    if (!permissions) {
      // No permissions configured - deny by default
      throw new SecurityError(
        `Access denied: No permissions configured for server ${serverName}`,
        { serverName, operation, targetPath },
      );
    }

    // Check server-specific forbidden paths using cross-platform matching
    for (const forbidden of permissions.forbiddenPaths) {
      if (pathMatchesPattern(normalizedPath, forbidden)) {
        throw new SecurityError(
          `Access denied: ${targetPath} is forbidden by server policy`,
          { serverName, operation, targetPath, forbidden },
        );
      }
    }

    // Check allowed paths (whitelist) using cross-platform matching
    if (permissions.allowedPaths.length === 0) {
      throw new SecurityError(
        `Access denied: No allowed paths configured for server ${serverName}`,
        { serverName, operation, targetPath },
      );
    }
    {
      const isAllowed = permissions.allowedPaths.some((allowed) => {
        // Support glob-like patterns
        if (allowed.endsWith("*")) {
          const prefix = normalizeSecurityPath(allowed.slice(0, -1));
          return normalizedPath.startsWith(prefix);
        }
        // strict: whitelist must match a complete segment, never a prefix of
        // one (allowed "app" must not grant ".../application/...").
        return pathMatchesPattern(normalizedPath, allowed, true);
      });

      if (!isAllowed) {
        throw new SecurityError(
          `Access denied: ${targetPath} is not in allowed paths`,
          {
            serverName,
            operation,
            targetPath,
            allowedPaths: permissions.allowedPaths,
          },
        );
      }
    }

    logger.info(
      `[MCPSecurityPolicy] Path access allowed: ${targetPath} (normalized: ${normalizedPath})`,
    );
  }

  /**
   * Validate write permission
   * @private
   */
  _validateWritePermission(serverName, operation) {
    const permissions = this.serverPermissions.get(serverName);

    if (!permissions) {
      throw new SecurityError(
        `Write operation denied: No permissions configured for server ${serverName}`,
        { serverName, operation },
      );
    }

    if (permissions.readOnly && operation !== "read") {
      throw new SecurityError(
        `Write operation denied: ${serverName} is configured as read-only`,
        { serverName, operation },
      );
    }
  }

  /**
   * Validate trusted server
   * @private
   */
  _validateTrustedServer(serverName) {
    // Check if server is in trusted list (if configured)
    if (this.config.trustedServers && !this.config.allowUntrustedServers) {
      if (!this.config.trustedServers.includes(serverName)) {
        throw new SecurityError(
          `Untrusted server: ${serverName} is not in trusted server list`,
          { serverName, trustedServers: this.config.trustedServers },
        );
      }
    }
  }

  /**
   * Detect operation type from tool name and params
   * @private
   */
  _detectOperation(toolName, _params) {
    const lowerName = toolName.toLowerCase();

    // Read operations
    if (
      lowerName.includes("read") ||
      lowerName.includes("get") ||
      lowerName.includes("list")
    ) {
      return { type: "read", isDestructive: false };
    }

    // Write operations
    if (
      lowerName.includes("write") ||
      lowerName.includes("create") ||
      lowerName.includes("update")
    ) {
      return { type: "write", isDestructive: false };
    }

    // Delete operations
    if (lowerName.includes("delete") || lowerName.includes("remove")) {
      return { type: "delete", isDestructive: true };
    }

    // Execute operations (potentially dangerous)
    if (
      lowerName.includes("exec") ||
      lowerName.includes("run") ||
      lowerName.includes("execute")
    ) {
      return { type: "execute", isDestructive: true };
    }

    // Default to read (safest assumption)
    return { type: "read", isDestructive: false };
  }

  /**
   * Assess risk level of operation
   * @private
   */
  _assessRiskLevel(toolName, params, operation) {
    // Critical: Destructive operations
    if (operation.isDestructive) {
      return this.RISK_LEVELS.CRITICAL;
    }

    // High: Write to system paths or execute
    if (operation.type === "execute" || operation.type === "write") {
      return this.RISK_LEVELS.HIGH;
    }

    // Medium: Write to user data
    if (operation.type === "write") {
      return this.RISK_LEVELS.MEDIUM;
    }

    // Low: Read operations
    return this.RISK_LEVELS.LOW;
  }

  /**
   * Request user consent for high-risk operations
   * @private
   * @returns {Promise<void>} Resolves if allowed, rejects if denied
   */
  async _requestUserConsent(serverName, toolName, params, riskLevel) {
    // Check consent cache
    const cacheKey = this._generateConsentKey(serverName, toolName, params);

    if (this.consentCache.has(cacheKey)) {
      const cached = this.consentCache.get(cacheKey);

      if (cached.decision === "always_allow") {
        logger.info(`[MCPSecurityPolicy] Using cached consent: always allow`);
        return; // Allowed
      }

      if (cached.decision === "always_deny") {
        throw new SecurityError(
          `Operation denied: User previously chose to always deny this operation`,
          { serverName, toolName },
        );
      }
    }

    logger.info(
      `[MCPSecurityPolicy] Requesting user consent for ${serverName}.${toolName}`,
    );

    // Generate unique request ID
    const requestId = crypto.randomUUID();

    // Detect operation type
    const operation = this._detectOperation(toolName, params);

    // Prepare consent request data
    const consentRequest = {
      requestId,
      serverName,
      toolName,
      params,
      riskLevel,
      operationType: operation.type,
      timestamp: Date.now(),
    };

    // If main window is available, send IPC message
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      return this._requestConsentViaIPC(consentRequest, cacheKey);
    }

    // An explicitly installed external consent handler is a valid UI adapter.
    // With neither renderer nor handler, reject immediately instead of leaving
    // a high-risk operation pending until a timeout.
    if (this.listenerCount("consent-required") > 0) {
      return this._requestConsentViaEvent(consentRequest, cacheKey);
    }
    throw new SecurityError("No user consent handler is available", {
      serverName,
      toolName,
      consentUnavailable: true,
    });
  }

  /**
   * Request consent via IPC to renderer process
   * @private
   */
  async _requestConsentViaIPC(consentRequest, cacheKey) {
    const { requestId, serverName, toolName } = consentRequest;

    this._assertConsentCapacity(serverName);

    return new Promise((resolve, reject) => {
      // Set up timeout
      const timeoutId = setTimeout(() => {
        this.pendingConsentRequests.delete(requestId);
        logger.warn(
          `[MCPSecurityPolicy] Consent request ${requestId} timed out`,
        );
        reject(
          new SecurityError("User consent request timed out", {
            serverName,
            toolName,
            timeout: this.CONSENT_TIMEOUT,
          }),
        );
      }, this.CONSENT_TIMEOUT);

      // Store pending request
      this.pendingConsentRequests.set(requestId, {
        resolve,
        reject,
        timeout: timeoutId,
        cacheKey,
        timestamp: Date.now(),
        serverName,
        toolName,
      });

      // Send IPC message to renderer
      try {
        logger.info(
          `[MCPSecurityPolicy] Sending consent request to renderer: ${requestId}`,
        );
        this.mainWindow.webContents.send("mcp:consent-request", consentRequest);
      } catch (error) {
        clearTimeout(timeoutId);
        this.pendingConsentRequests.delete(requestId);
        reject(error);
      }
    });
  }

  /**
   * Request consent via event emission (fallback)
   * @private
   */
  async _requestConsentViaEvent(consentRequest, cacheKey) {
    const { requestId, serverName, toolName } = consentRequest;

    this._assertConsentCapacity(serverName);

    return new Promise((resolve, reject) => {
      // Set up timeout
      const timeoutId = setTimeout(() => {
        this.pendingConsentRequests.delete(requestId);
        logger.warn(
          `[MCPSecurityPolicy] Consent request ${requestId} timed out (event mode)`,
        );
        reject(
          new SecurityError("User consent request timed out", {
            serverName,
            toolName,
            timeout: this.CONSENT_TIMEOUT,
          }),
        );
      }, this.CONSENT_TIMEOUT);

      // Store pending request
      this.pendingConsentRequests.set(requestId, {
        resolve,
        reject,
        timeout: timeoutId,
        cacheKey,
        timestamp: Date.now(),
        serverName,
        toolName,
      });

      // Emit event for external handler
      try {
        this.emit("consent-required", {
          ...consentRequest,
          respond: (decision) =>
            this.handleConsentResponse(requestId, decision),
        });

        logger.info(
          `[MCPSecurityPolicy] Emitted consent-required event: ${requestId}`,
        );
      } catch (error) {
        clearTimeout(timeoutId);
        this.pendingConsentRequests.delete(requestId);
        reject(error);
      }
    });
  }

  _assertConsentCapacity(serverName) {
    let pendingForServer = 0;
    for (const pending of this.pendingConsentRequests.values()) {
      if (pending.serverName === serverName) {
        pendingForServer++;
      }
    }

    const globalFull =
      this.pendingConsentRequests.size >= this.maxPendingConsentRequests;
    const serverFull =
      pendingForServer >= this.maxPendingConsentRequestsPerServer;
    if (!globalFull && !serverFull) {
      return;
    }

    const details = {
      serverName,
      reason: globalFull ? "global-limit" : "server-limit",
      pendingRequests: this.pendingConsentRequests.size,
      pendingForServer,
      maxPendingRequests: this.maxPendingConsentRequests,
      maxPendingRequestsPerServer: this.maxPendingConsentRequestsPerServer,
      retryAfterMs: CONSENT_OVERLOAD_RETRY_AFTER_MS,
    };
    const error = new SecurityError("User consent request backlog is full", {
      ...details,
      overloaded: true,
    });
    error.code = "OVERLOADED";
    error.retryAfterMs = CONSENT_OVERLOAD_RETRY_AFTER_MS;
    this.consentFlowStats.overloads++;
    this.emit("consent-overloaded", details);
    throw error;
  }

  _setConsentCache(cacheKey, decision) {
    if (this.consentCache.has(cacheKey)) {
      this.consentCache.delete(cacheKey);
    }
    while (this.consentCache.size >= this.maxConsentCacheEntries) {
      const oldestKey = this.consentCache.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      this.consentCache.delete(oldestKey);
      this.consentFlowStats.cacheEvictions++;
    }
    this.consentCache.set(cacheKey, {
      decision,
      timestamp: Date.now(),
    });
  }

  /**
   * Handle consent response from user
   * @param {string} requestId - Consent request ID
   * @param {string} decision - User decision: 'allow', 'deny', 'always_allow', 'always_deny'
   */
  handleConsentResponse(requestId, decision) {
    const pending = this.pendingConsentRequests.get(requestId);

    if (!pending) {
      logger.warn(`[MCPSecurityPolicy] Unknown consent request: ${requestId}`);
      return { success: false, error: "Unknown request ID" };
    }

    const { resolve, reject, timeout, cacheKey } = pending;

    // Clear timeout
    clearTimeout(timeout);

    // Remove from pending
    this.pendingConsentRequests.delete(requestId);

    logger.info(
      `[MCPSecurityPolicy] Consent response received: ${requestId} -> ${decision}`,
    );

    // Handle decision
    if (decision === "deny" || decision === "always_deny") {
      // Cache "always deny" decision
      if (decision === "always_deny") {
        this._setConsentCache(cacheKey, decision);
      }

      reject(
        new SecurityError(`Operation denied by user`, { requestId, decision }),
      );

      return { success: true, allowed: false };
    }

    // Allow the operation
    if (decision === "allow" || decision === "always_allow") {
      // Cache "always allow" decision
      if (decision === "always_allow") {
        this._setConsentCache(cacheKey, decision);
      }

      resolve();

      return { success: true, allowed: true };
    }

    // Unknown decision
    reject(
      new SecurityError(`Unknown consent decision: ${decision}`, {
        requestId,
        decision,
      }),
    );

    return { success: false, error: "Unknown decision" };
  }

  /**
   * Get pending consent requests
   * @returns {Object[]} List of pending requests
   */
  getPendingConsentRequests() {
    return Array.from(this.pendingConsentRequests.entries()).map(
      ([id, data]) => ({
        requestId: id,
        serverName: data.serverName,
        toolName: data.toolName,
        timestamp: data.timestamp,
        age: Date.now() - data.timestamp,
      }),
    );
  }

  /**
   * Cancel a pending consent request
   * @param {string} requestId - Request ID to cancel
   */
  cancelConsentRequest(requestId) {
    const pending = this.pendingConsentRequests.get(requestId);

    if (pending) {
      clearTimeout(pending.timeout);
      pending.reject(
        new SecurityError("Consent request cancelled", { requestId }),
      );
      this.pendingConsentRequests.delete(requestId);
      logger.info(
        `[MCPSecurityPolicy] Consent request cancelled: ${requestId}`,
      );
      return true;
    }

    return false;
  }

  /**
   * Generate consent cache key
   * @private
   */
  _generateConsentKey(serverName, toolName, params) {
    // Keep parameters (which may include paths, prompts, or credentials) out of
    // long-lived Map keys while retaining stable exact-request semantics.
    return crypto
      .createHash("sha256")
      .update(JSON.stringify([String(serverName), String(toolName), params]))
      .digest("hex");
  }

  /**
   * Log to audit trail
   * @private
   */
  _logAudit(
    decision,
    serverName,
    toolName,
    params,
    details,
    executionContext = {},
  ) {
    const context = {
      ...(this.auditContextProvider() || {}),
      ...(executionContext || {}),
    };
    const entry = {
      timestamp: Date.now(),
      auditId: crypto.randomUUID(),
      decision, // 'ALLOWED' or 'DENIED'
      serverName,
      toolName,
      params: sanitizeAuditValue(params),
      details,
      actor:
        context.actor || process.env.USER || process.env.USERNAME || "unknown",
      user:
        context.actor || process.env.USER || process.env.USERNAME || "unknown",
      sessionId: context.sessionId || null,
      authorization: context.authorization || {
        serverPermissionConfigured: this.serverPermissions.has(serverName),
      },
      policy: context.policy || {
        component: "mcp-security-policy",
        persistentAuditRequired: this.requirePersistentAudit,
        riskOrReason: details,
      },
      sandbox: context.sandbox || null,
      result: context.result || { decision },
    };

    if (this.auditStore) {
      try {
        this.auditStore.append(entry);
      } catch (error) {
        throw new SecurityError(
          `MCP security audit persistence failed: ${error.message}`,
          { auditPersistence: true, cause: error.message },
        );
      }
    } else if (this.requirePersistentAudit) {
      throw new SecurityError("MCP security audit persistence unavailable", {
        auditPersistence: true,
      });
    }

    this.auditLog.push(entry);

    // Keep only last 1000 entries in memory
    if (this.auditLog.length > 1000) {
      this.auditLog.shift();
    }

    // Emit for external logging
    this.emit("audit-log", entry);
  }

  /**
   * Get audit log
   * @param {Object} filters - Optional filters
   * @returns {Object[]} Audit log entries
   */
  getAuditLog(filters = {}) {
    let log = this.auditLog;

    if (filters.serverName) {
      log = log.filter((e) => e.serverName === filters.serverName);
    }

    if (filters.decision) {
      log = log.filter((e) => e.decision === filters.decision);
    }

    if (filters.since) {
      log = log.filter((e) => e.timestamp >= filters.since);
    }

    return log;
  }

  getPersistentAuditLog(filters = {}) {
    if (!this.auditStore || typeof this.auditStore.query !== "function") {
      throw new SecurityError(
        "Persistent MCP security audit query unavailable",
      );
    }
    return this.auditStore.query(filters);
  }

  /**
   * Clear consent cache
   */
  clearConsentCache() {
    this.consentCache.clear();
    logger.info("[MCPSecurityPolicy] Consent cache cleared");
  }

  /**
   * Get server permissions
   * @param {string} serverName - Server identifier
   * @returns {Object|null} Server permissions or null if not found
   */
  getServerPermissions(serverName) {
    return this.serverPermissions.get(serverName) || null;
  }

  /**
   * Request user consent for server connection (public method for IPC)
   * @param {Object} request - Consent request details
   * @param {string} request.operation - Operation type (e.g., 'connect-server')
   * @param {string} request.serverName - Server name
   * @param {string} request.securityLevel - Security level (e.g., 'high')
   * @param {string[]} request.permissions - Required permissions
   * @returns {Promise<boolean>} True if consent granted, false otherwise
   */
  async requestUserConsent(request) {
    const { operation, serverName, securityLevel, permissions } = request;

    logger.info(
      `[MCPSecurityPolicy] Requesting user consent for ${operation} on ${serverName}`,
    );

    // Generate consent request
    const requestId = crypto.randomUUID();
    const consentRequest = {
      requestId,
      serverName,
      toolName: operation,
      params: { permissions },
      riskLevel:
        securityLevel === "high"
          ? this.RISK_LEVELS.HIGH
          : this.RISK_LEVELS.MEDIUM,
      operationType: operation,
      timestamp: Date.now(),
    };

    // Check if main window is available
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      logger.warn(
        "[MCPSecurityPolicy] No main window available for consent request, denying",
      );
      return false;
    }

    try {
      await this._requestConsentViaIPC(
        consentRequest,
        `consent:${serverName}:${operation}`,
      );
      return true;
    } catch (error) {
      logger.info(`[MCPSecurityPolicy] Consent denied: ${error.message}`);
      return false;
    }
  }

  /**
   * Validate a tool call (synchronous check for IPC)
   * @param {string} serverName - Server name
   * @param {string} toolName - Tool name
   * @param {Object} args - Tool arguments
   * @returns {Object} { permitted: boolean, reason?: string }
   */
  validateToolCall(serverName, toolName, args) {
    try {
      // Check if server has permissions configured
      const permissions = this.serverPermissions.get(serverName);

      // Connection trust never implies tool authority.
      if (!permissions) {
        const reason = `No permissions configured for server ${serverName}`;
        this._logAudit("DENIED", serverName, toolName, args, reason);
        return { permitted: false, reason };
      }

      // Detect operation type
      const operation = this._detectOperation(toolName, args);

      // Check read-only constraint
      if (permissions.readOnly && operation.type !== "read") {
        return {
          permitted: false,
          reason: `Server ${serverName} is read-only, cannot perform ${operation.type} operation`,
        };
      }

      // Validate path access if applicable
      const targetPath = args?.path || args?.uri || args?.file;
      if (targetPath) {
        try {
          this._validatePathAccess(serverName, operation.type, targetPath);
        } catch (error) {
          return {
            permitted: false,
            reason: error.message,
          };
        }
      }

      // Log the allowed operation
      this._logAudit(
        "ALLOWED",
        serverName,
        toolName,
        args,
        this._assessRiskLevel(toolName, args, operation),
      );

      return { permitted: true };
    } catch (error) {
      return {
        permitted: false,
        reason: error.message,
      };
    }
  }

  /**
   * Validate resource access (synchronous check for IPC)
   * @param {string} serverName - Server name
   * @param {string} resourceUri - Resource URI
   * @returns {Object} { permitted: boolean, reason?: string }
   */
  validateResourceAccess(serverName, resourceUri) {
    try {
      const permissions = this.serverPermissions.get(serverName);

      // Resources require an explicit path capability.
      if (!permissions) {
        return {
          permitted: false,
          reason: `No permissions configured for server ${serverName}`,
        };
      }

      this._validatePathAccess(serverName, "read", resourceUri);

      return { permitted: true };
    } catch (error) {
      return {
        permitted: false,
        reason: error.message,
      };
    }
  }

  /**
   * Get security statistics
   */
  getStatistics() {
    const allowed = this.auditLog.filter(
      (e) => e.decision === "ALLOWED",
    ).length;
    const denied = this.auditLog.filter((e) => e.decision === "DENIED").length;

    return {
      totalOperations: this.auditLog.length,
      allowed,
      denied,
      allowRate: ((allowed / this.auditLog.length) * 100).toFixed(2) + "%",
      consentCacheSize: this.consentCache.size,
      maxConsentCacheEntries: this.maxConsentCacheEntries,
      consentCacheEvictions: this.consentFlowStats.cacheEvictions,
      pendingConsentRequests: this.pendingConsentRequests.size,
      maxPendingConsentRequests: this.maxPendingConsentRequests,
      maxPendingConsentRequestsPerServer:
        this.maxPendingConsentRequestsPerServer,
      consentOverloads: this.consentFlowStats.overloads,
      configuredServers: this.serverPermissions.size,
    };
  }
}

module.exports = {
  MCPSecurityPolicy,
  SecurityError,
  // exported for unit testing of the allowed/forbidden path-matching boundary
  pathMatchesPattern,
  normalizeSecurityPath,
  sanitizeAuditValue,
};

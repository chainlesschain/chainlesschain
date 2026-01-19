/**
 * MCP Security Policy
 *
 * Enforces security controls for MCP server operations.
 * Implements path restrictions, user consent, and audit logging.
 *
 * @module MCPSecurityPolicy
 */

const EventEmitter = require("events");
const crypto = require("crypto");

// Platform detection for cross-platform path handling
const isWindows = process.platform === "win32";

/**
 * Normalize a path for security comparison
 * Handles both Windows and Unix path formats
 * @param {string} inputPath - Path to normalize
 * @returns {string} Normalized path
 */
function normalizeSecurityPath(inputPath) {
  if (!inputPath) {return "";}

  // Convert to lowercase on Windows for case-insensitive comparison
  let normalized = inputPath;

  if (isWindows) {
    // Normalize Windows paths - convert backslashes to forward slashes
    normalized = normalized.replace(/\\/g, "/").toLowerCase();
  }

  // Remove trailing slashes
  normalized = normalized.replace(/\/+$/, "");

  // Normalize multiple slashes
  normalized = normalized.replace(/\/+/g, "/");

  // Remove leading ./ if present
  normalized = normalized.replace(/^\.\//, "");

  return normalized;
}

/**
 * Check if a path matches a pattern (supports wildcards)
 * @param {string} testPath - Path to test
 * @param {string} pattern - Pattern to match against
 * @returns {boolean}
 */
function pathMatchesPattern(testPath, pattern) {
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

  // Check if path contains the pattern
  if (
    normalizedPath.includes("/" + normalizedPattern + "/") ||
    normalizedPath.includes("/" + normalizedPattern) ||
    normalizedPath.endsWith("/" + normalizedPattern)
  ) {
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

    // Consent request timeout (30 seconds)
    this.CONSENT_TIMEOUT = 30000;

    // Audit log
    this.auditLog = [];

    // Risk levels for operations
    this.RISK_LEVELS = {
      LOW: "low", // Read-only safe operations
      MEDIUM: "medium", // Write to allowed paths
      HIGH: "high", // Delete operations, sensitive reads
      CRITICAL: "critical", // System-level operations
    };

    // Main window reference (set by main process)
    this.mainWindow = null;

    console.log("[MCPSecurityPolicy] Initialized");
  }

  /**
   * Set main window reference for IPC communication
   * @param {BrowserWindow} window - Electron BrowserWindow
   */
  setMainWindow(window) {
    this.mainWindow = window;
    console.log("[MCPSecurityPolicy] Main window reference set");
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

    console.log(
      `[MCPSecurityPolicy] Set permissions for ${serverName}:`,
      permissions,
    );
  }

  /**
   * Validate tool execution
   * @param {string} serverName - Server identifier
   * @param {string} toolName - Tool name
   * @param {Object} params - Tool parameters
   * @throws {SecurityError} If validation fails
   */
  async validateToolExecution(serverName, toolName, params) {
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
      this._logAudit("ALLOWED", serverName, toolName, params, riskLevel);

      console.log(
        `[MCPSecurityPolicy] Validation passed: ${serverName}.${toolName} (${riskLevel})`,
      );
    } catch (error) {
      // Log denied access
      this._logAudit("DENIED", serverName, toolName, params, error.message);

      console.error(`[MCPSecurityPolicy] Validation failed: ${error.message}`);

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
    if (permissions.allowedPaths.length > 0) {
      const isAllowed = permissions.allowedPaths.some((allowed) => {
        // Support glob-like patterns
        if (allowed.endsWith("*")) {
          const prefix = normalizeSecurityPath(allowed.slice(0, -1));
          return normalizedPath.startsWith(prefix);
        }
        return pathMatchesPattern(normalizedPath, allowed);
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

    console.log(
      `[MCPSecurityPolicy] Path access allowed: ${targetPath} (normalized: ${normalizedPath})`,
    );
  }

  /**
   * Validate write permission
   * @private
   */
  _validateWritePermission(serverName, operation) {
    const permissions = this.serverPermissions.get(serverName);

    if (permissions && permissions.readOnly && operation !== "read") {
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
        console.log(`[MCPSecurityPolicy] Using cached consent: always allow`);
        return; // Allowed
      }

      if (cached.decision === "always_deny") {
        throw new SecurityError(
          `Operation denied: User previously chose to always deny this operation`,
          { serverName, toolName },
        );
      }
    }

    console.log(
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

    // Fallback: emit event for external handler
    return this._requestConsentViaEvent(consentRequest, cacheKey);
  }

  /**
   * Request consent via IPC to renderer process
   * @private
   */
  async _requestConsentViaIPC(consentRequest, cacheKey) {
    const { requestId, serverName, toolName } = consentRequest;

    return new Promise((resolve, reject) => {
      // Set up timeout
      const timeoutId = setTimeout(() => {
        this.pendingConsentRequests.delete(requestId);
        console.warn(
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
      });

      // Send IPC message to renderer
      console.log(
        `[MCPSecurityPolicy] Sending consent request to renderer: ${requestId}`,
      );
      this.mainWindow.webContents.send("mcp:consent-request", consentRequest);
    });
  }

  /**
   * Request consent via event emission (fallback)
   * @private
   */
  async _requestConsentViaEvent(consentRequest, cacheKey) {
    const { requestId, serverName, toolName } = consentRequest;

    return new Promise((resolve, reject) => {
      // Set up timeout
      const timeoutId = setTimeout(() => {
        this.pendingConsentRequests.delete(requestId);
        console.warn(
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
      });

      // Emit event for external handler
      this.emit("consent-required", {
        ...consentRequest,
        respond: (decision) => this.handleConsentResponse(requestId, decision),
      });

      console.log(
        `[MCPSecurityPolicy] Emitted consent-required event: ${requestId}`,
      );
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
      console.warn(`[MCPSecurityPolicy] Unknown consent request: ${requestId}`);
      return { success: false, error: "Unknown request ID" };
    }

    const { resolve, reject, timeout, cacheKey } = pending;

    // Clear timeout
    clearTimeout(timeout);

    // Remove from pending
    this.pendingConsentRequests.delete(requestId);

    console.log(
      `[MCPSecurityPolicy] Consent response received: ${requestId} -> ${decision}`,
    );

    // Handle decision
    if (decision === "deny" || decision === "always_deny") {
      // Cache "always deny" decision
      if (decision === "always_deny") {
        this.consentCache.set(cacheKey, {
          decision,
          timestamp: Date.now(),
        });
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
        this.consentCache.set(cacheKey, {
          decision,
          timestamp: Date.now(),
        });
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
      console.log(
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
    // Simple hash: serverName:toolName:paramsHash
    const paramsHash = JSON.stringify(params);
    return `${serverName}:${toolName}:${paramsHash}`;
  }

  /**
   * Log to audit trail
   * @private
   */
  _logAudit(decision, serverName, toolName, params, details) {
    const entry = {
      timestamp: Date.now(),
      decision, // 'ALLOWED' or 'DENIED'
      serverName,
      toolName,
      params,
      details,
      user: process.env.USER || process.env.USERNAME || "unknown",
    };

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

  /**
   * Clear consent cache
   */
  clearConsentCache() {
    this.consentCache.clear();
    console.log("[MCPSecurityPolicy] Consent cache cleared");
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

    console.log(
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
      console.warn(
        "[MCPSecurityPolicy] No main window available for consent request, auto-allowing",
      );
      return true; // Auto-allow if no UI available
    }

    try {
      await this._requestConsentViaIPC(
        consentRequest,
        `consent:${serverName}:${operation}`,
      );
      return true;
    } catch (error) {
      console.log(`[MCPSecurityPolicy] Consent denied: ${error.message}`);
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

      // If no permissions configured, allow by default (server is already trusted)
      if (!permissions) {
        console.log(
          `[MCPSecurityPolicy] No permissions configured for ${serverName}, allowing by default`,
        );
        this._logAudit("ALLOWED", serverName, toolName, args, "low");
        return { permitted: true };
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
      if (targetPath && permissions.allowedPaths?.length > 0) {
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

      // If no permissions configured, allow by default
      if (!permissions) {
        console.log(
          `[MCPSecurityPolicy] No permissions configured for ${serverName}, allowing resource access`,
        );
        return { permitted: true };
      }

      // Only validate path if there are allowed paths configured
      if (permissions.allowedPaths?.length > 0) {
        this._validatePathAccess(serverName, "read", resourceUri);
      }

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
      configuredServers: this.serverPermissions.size,
    };
  }
}

module.exports = { MCPSecurityPolicy, SecurityError };

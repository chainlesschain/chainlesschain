/**
 * MCP Security Policy
 *
 * Enforces security controls for MCP server operations.
 * Implements path restrictions, user consent, and audit logging.
 *
 * @module MCPSecurityPolicy
 */

const path = require('path');
const EventEmitter = require('events');

/**
 * Security error class
 */
class SecurityError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'SecurityError';
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
      'chainlesschain.db',          // Encrypted database
      'data/ukey/',                 // U-Key hardware data
      'data/did/private-keys/',     // DID private keys
      'data/p2p/keys/',             // P2P encryption keys
      '.env',                       // Environment variables
      'config/secrets/',            // Secret configuration
    ];

    // Server-specific permissions
    this.serverPermissions = new Map();

    // User consent cache (for "always allow" decisions)
    // key: hash(serverName + toolName + paramsHash) -> consent decision
    this.consentCache = new Map();

    // Audit log
    this.auditLog = [];

    // Risk levels for operations
    this.RISK_LEVELS = {
      LOW: 'low',           // Read-only safe operations
      MEDIUM: 'medium',     // Write to allowed paths
      HIGH: 'high',         // Delete operations, sensitive reads
      CRITICAL: 'critical'  // System-level operations
    };

    console.log('[MCPSecurityPolicy] Initialized');
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
      requireConsent: permissions.requireConsent !== undefined ? permissions.requireConsent : true
    });

    console.log(`[MCPSecurityPolicy] Set permissions for ${serverName}:`, permissions);
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
      if (operation.type !== 'read') {
        this._validateWritePermission(serverName, operation.type);
      }

      // 5. Request user consent if needed
      if (riskLevel === this.RISK_LEVELS.HIGH || riskLevel === this.RISK_LEVELS.CRITICAL) {
        await this._requestUserConsent(serverName, toolName, params, riskLevel);
      }

      // 6. Log to audit trail
      this._logAudit('ALLOWED', serverName, toolName, params, riskLevel);

      console.log(`[MCPSecurityPolicy] Validation passed: ${serverName}.${toolName} (${riskLevel})`);

    } catch (error) {
      // Log denied access
      this._logAudit('DENIED', serverName, toolName, params, error.message);

      console.error(`[MCPSecurityPolicy] Validation failed: ${error.message}`);

      throw error;
    }
  }

  /**
   * Validate path access
   * @param {string} serverName - Server identifier
   * @param {string} operation - Operation type (read/write/delete)
   * @param {string} targetPath - Path to validate
   * @throws {SecurityError} If access denied
   */
  _validatePathAccess(serverName, operation, targetPath) {
    // Normalize path
    const normalizedPath = path.normalize(targetPath).replace(/\\/g, '/');

    // Check global forbidden paths
    for (const forbidden of this.FORBIDDEN_PATHS) {
      if (normalizedPath.includes(forbidden)) {
        throw new SecurityError(
          `Access denied: ${targetPath} is globally forbidden`,
          { serverName, operation, targetPath, forbidden }
        );
      }
    }

    // Get server-specific permissions
    const permissions = this.serverPermissions.get(serverName);
    if (!permissions) {
      // No permissions configured - deny by default
      throw new SecurityError(
        `Access denied: No permissions configured for server ${serverName}`,
        { serverName, operation, targetPath }
      );
    }

    // Check server-specific forbidden paths
    for (const forbidden of permissions.forbiddenPaths) {
      if (normalizedPath.includes(forbidden)) {
        throw new SecurityError(
          `Access denied: ${targetPath} is forbidden by server policy`,
          { serverName, operation, targetPath, forbidden }
        );
      }
    }

    // Check allowed paths (whitelist)
    if (permissions.allowedPaths.length > 0) {
      const isAllowed = permissions.allowedPaths.some(allowed => {
        // Support glob-like patterns
        if (allowed.endsWith('*')) {
          const prefix = allowed.slice(0, -1);
          return normalizedPath.startsWith(prefix);
        }
        return normalizedPath.includes(allowed);
      });

      if (!isAllowed) {
        throw new SecurityError(
          `Access denied: ${targetPath} is not in allowed paths`,
          { serverName, operation, targetPath, allowedPaths: permissions.allowedPaths }
        );
      }
    }

    console.log(`[MCPSecurityPolicy] Path access allowed: ${targetPath}`);
  }

  /**
   * Validate write permission
   * @private
   */
  _validateWritePermission(serverName, operation) {
    const permissions = this.serverPermissions.get(serverName);

    if (permissions && permissions.readOnly && operation !== 'read') {
      throw new SecurityError(
        `Write operation denied: ${serverName} is configured as read-only`,
        { serverName, operation }
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
          { serverName, trustedServers: this.config.trustedServers }
        );
      }
    }
  }

  /**
   * Detect operation type from tool name and params
   * @private
   */
  _detectOperation(toolName, params) {
    const lowerName = toolName.toLowerCase();

    // Read operations
    if (lowerName.includes('read') || lowerName.includes('get') || lowerName.includes('list')) {
      return { type: 'read', isDestructive: false };
    }

    // Write operations
    if (lowerName.includes('write') || lowerName.includes('create') || lowerName.includes('update')) {
      return { type: 'write', isDestructive: false };
    }

    // Delete operations
    if (lowerName.includes('delete') || lowerName.includes('remove')) {
      return { type: 'delete', isDestructive: true };
    }

    // Execute operations (potentially dangerous)
    if (lowerName.includes('exec') || lowerName.includes('run') || lowerName.includes('execute')) {
      return { type: 'execute', isDestructive: true };
    }

    // Default to read (safest assumption)
    return { type: 'read', isDestructive: false };
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
    if (operation.type === 'execute' || operation.type === 'write') {
      return this.RISK_LEVELS.HIGH;
    }

    // Medium: Write to user data
    if (operation.type === 'write') {
      return this.RISK_LEVELS.MEDIUM;
    }

    // Low: Read operations
    return this.RISK_LEVELS.LOW;
  }

  /**
   * Request user consent for high-risk operations
   * @private
   */
  async _requestUserConsent(serverName, toolName, params, riskLevel) {
    // Check consent cache
    const cacheKey = this._generateConsentKey(serverName, toolName, params);

    if (this.consentCache.has(cacheKey)) {
      const cached = this.consentCache.get(cacheKey);

      if (cached.decision === 'always_allow') {
        console.log(`[MCPSecurityPolicy] Using cached consent: always allow`);
        return; // Allowed
      }

      if (cached.decision === 'always_deny') {
        throw new SecurityError(
          `Operation denied: User previously chose to always deny this operation`,
          { serverName, toolName }
        );
      }
    }

    // Emit event for UI to handle
    // In POC, we'll just log and allow (production would show dialog)
    console.warn(`[MCPSecurityPolicy] ⚠️  HIGH RISK OPERATION - User consent required:`);
    console.warn(`  Server: ${serverName}`);
    console.warn(`  Tool: ${toolName}`);
    console.warn(`  Risk: ${riskLevel}`);
    console.warn(`  Params:`, params);

    // Emit event for potential UI handler
    this.emit('consent-required', {
      serverName,
      toolName,
      params,
      riskLevel,
      callback: (decision) => {
        if (decision === 'deny') {
          throw new SecurityError('Operation denied by user', { serverName, toolName });
        }

        // Cache decision if "always allow/deny"
        if (decision === 'always_allow' || decision === 'always_deny') {
          this.consentCache.set(cacheKey, {
            decision,
            timestamp: Date.now()
          });
        }
      }
    });

    // For POC, auto-allow with warning (production should block until user responds)
    console.warn(`[MCPSecurityPolicy] ⚠️  AUTO-ALLOWING for POC (production should require user approval)`);
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
      decision,        // 'ALLOWED' or 'DENIED'
      serverName,
      toolName,
      params,
      details,
      user: process.env.USER || process.env.USERNAME || 'unknown'
    };

    this.auditLog.push(entry);

    // Keep only last 1000 entries in memory
    if (this.auditLog.length > 1000) {
      this.auditLog.shift();
    }

    // Emit for external logging
    this.emit('audit-log', entry);
  }

  /**
   * Get audit log
   * @param {Object} filters - Optional filters
   * @returns {Object[]} Audit log entries
   */
  getAuditLog(filters = {}) {
    let log = this.auditLog;

    if (filters.serverName) {
      log = log.filter(e => e.serverName === filters.serverName);
    }

    if (filters.decision) {
      log = log.filter(e => e.decision === filters.decision);
    }

    if (filters.since) {
      log = log.filter(e => e.timestamp >= filters.since);
    }

    return log;
  }

  /**
   * Clear consent cache
   */
  clearConsentCache() {
    this.consentCache.clear();
    console.log('[MCPSecurityPolicy] Consent cache cleared');
  }

  /**
   * Get security statistics
   */
  getStatistics() {
    const allowed = this.auditLog.filter(e => e.decision === 'ALLOWED').length;
    const denied = this.auditLog.filter(e => e.decision === 'DENIED').length;

    return {
      totalOperations: this.auditLog.length,
      allowed,
      denied,
      allowRate: ((allowed / this.auditLog.length) * 100).toFixed(2) + '%',
      consentCacheSize: this.consentCache.size,
      configuredServers: this.serverPermissions.size
    };
  }
}

module.exports = { MCPSecurityPolicy, SecurityError };

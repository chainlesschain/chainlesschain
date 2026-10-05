/**
 * SCIM Sync Engine
 *
 * Outbound provider configuration and sync capability reporting.
 * Provider transports are not implemented; inbound SCIM is handled by SCIMServer.
 *
 * @module enterprise/scim-sync
 * @version 1.1.0
 */

import { logger } from "../utils/logger.js";
import EventEmitter from "events";
import { v4 as uuidv4 } from "uuid";

// ============================================================
// Constants
// ============================================================

const SYNC_PROVIDERS = {
  AZURE_AD: "azure_ad",
  OKTA: "okta",
  ONELOGIN: "onelogin",
  CUSTOM: "custom",
};

const SYNC_STATUS = {
  IDLE: "idle",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  UNSUPPORTED: "unsupported",
};

// ============================================================
// SCIMSync
// ============================================================

class SCIMSync extends EventEmitter {
  constructor(database, scimServer) {
    super();
    this.database = database;
    this.scimServer = scimServer;
    this.initialized = false;
    this._connectors = new Map();
    this._syncStatus = SYNC_STATUS.IDLE;
    this._lastSyncAt = null;
    this._syncInterval = null;
  }

  async initialize(options = {}) {
    logger.info("[SCIMSync] Initializing SCIM sync engine...");
    this.initialized = true;

    if (options.autoSync) {
      const interval = options.syncIntervalMs || 15 * 60 * 1000;
      this._syncInterval = setInterval(
        () =>
          this.syncAll().catch((e) =>
            logger.error("[SCIMSync] 定时 syncAll 失败:", e),
          ),
        interval,
      );
    }

    logger.info("[SCIMSync] SCIM sync engine initialized");
  }

  /**
   * Register a SCIM provider connector.
   * @param {string} provider - Provider name
   * @param {Object} config - Connector configuration
   * @returns {Object} Registration result
   */
  registerConnector(provider, config) {
    try {
      if (!config.endpoint) {
        throw new Error("Connector endpoint is required");
      }

      this._connectors.set(provider, {
        provider,
        endpoint: config.endpoint,
        token: config.token || null,
        tenantId: config.tenantId || null,
        enabled: config.enabled !== false,
        lastSync: null,
        syncCount: 0,
      });

      this.emit("connector:registered", { provider });
      logger.info("[SCIMSync] Registered connector:", provider);
      return {
        success: true,
        provider,
        status: "configured",
        syncSupported: false,
      };
    } catch (error) {
      logger.error("[SCIMSync] Register connector failed:", error);
      throw error;
    }
  }

  /**
   * Get all registered connectors.
   * @returns {Array} Connector list
   */
  getConnectors() {
    return Array.from(this._connectors.values()).map((c) => ({
      provider: c.provider,
      endpoint: c.endpoint,
      enabled: c.enabled,
      lastSync: c.lastSync,
      syncCount: c.syncCount,
      status: "configured",
      syncSupported: false,
    }));
  }

  /**
   * Sync users from a specific provider.
   * @param {string} provider - Provider name
   * @returns {Object} Sync result
   */
  async syncProvider(provider) {
    try {
      const connector = this._connectors.get(provider);
      if (!connector) {
        throw new Error(`Connector not found: ${provider}`);
      }
      if (!connector.enabled) {
        throw new Error(`Connector disabled: ${provider}`);
      }

      // Configuration does not establish a provider transport. Record the
      // unsupported attempt without claiming a successful zero-change sync.
      const result = {
        provider,
        success: false,
        status: SYNC_STATUS.UNSUPPORTED,
        executed: false,
        error: "Outbound SCIM synchronization is not available",
        created: 0,
        updated: 0,
        deactivated: 0,
        errors: 0,
        attemptedAt: Date.now(),
      };

      // Log sync attempt
      try {
        this.database.db
          .prepare(
            "INSERT INTO scim_sync_log (id, operation, resource_type, resource_id, provider, status, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          )
          .run(
            uuidv4(),
            "sync",
            "User",
            null,
            provider,
            result.status,
            JSON.stringify(result),
            Date.now(),
          );
        this.database.saveToFile();
      } catch {
        // Expected error, ignore
      }

      this._syncStatus = SYNC_STATUS.UNSUPPORTED;
      this.emit("sync:unsupported", result);

      return result;
    } catch (error) {
      this._syncStatus = SYNC_STATUS.FAILED;
      logger.error("[SCIMSync] Sync failed for provider:", provider, error);
      this.emit("sync:failed", { provider, error: error.message });
      throw error;
    }
  }

  /**
   * Sync all enabled connectors.
   * @returns {Object} Combined sync results
   */
  async syncAll() {
    const results = [];
    for (const [provider, connector] of this._connectors) {
      if (!connector.enabled) {
        continue;
      }
      try {
        const result = await this.syncProvider(provider);
        results.push(result);
      } catch (error) {
        results.push({
          provider,
          success: false,
          status: SYNC_STATUS.FAILED,
          error: error.message,
        });
      }
    }
    return {
      results,
      success: false,
      status: results.some((result) => result.status === SYNC_STATUS.FAILED)
        ? SYNC_STATUS.FAILED
        : results.length
          ? SYNC_STATUS.UNSUPPORTED
          : SYNC_STATUS.IDLE,
      attemptedAt: Date.now(),
      syncedAt: this._lastSyncAt,
    };
  }

  /**
   * Get sync status.
   * @returns {Object} Current sync status
   */
  getStatus() {
    return {
      status: this._syncStatus,
      lastSyncAt: this._lastSyncAt,
      syncSupported: false,
      connectorCount: this._connectors.size,
      enabledConnectors: Array.from(this._connectors.values()).filter(
        (c) => c.enabled,
      ).length,
    };
  }

  /**
   * Get sync history.
   * @param {Object} [options] - Query options
   * @returns {Array} Sync log entries
   */
  async getSyncHistory(options = {}) {
    try {
      if (!this.database || !this.database.db) {
        return [];
      }

      const limit = options.limit || 50;
      const provider = options.provider;

      const rows = provider
        ? this.database.db
            .prepare(
              "SELECT * FROM scim_sync_log WHERE provider = ? ORDER BY created_at DESC LIMIT ?",
            )
            .all(provider, limit)
        : this.database.db
            .prepare(
              "SELECT * FROM scim_sync_log ORDER BY created_at DESC LIMIT ?",
            )
            .all(limit);
      // The old outbound sync path logged success without a provider call.
      // Only normalize that operation for display; inbound provisioning and
      // the original stored audit rows keep their recorded evidence.
      return rows.map((row) =>
        row.operation === "sync" && row.status === "success"
          ? { ...row, status: "legacy-unverified", recordedStatus: row.status }
          : row,
      );
    } catch (error) {
      logger.error("[SCIMSync] Get sync history failed:", error);
      return [];
    }
  }

  async close() {
    if (this._syncInterval) {
      clearInterval(this._syncInterval);
      this._syncInterval = null;
    }
    this._connectors.clear();
    this.removeAllListeners();
    this.initialized = false;
    logger.info("[SCIMSync] Closed");
  }
}

let _instance;
function getSCIMSync() {
  if (!_instance) {
    _instance = new SCIMSync();
  }
  return _instance;
}

export { SCIMSync, getSCIMSync, SYNC_PROVIDERS, SYNC_STATUS };

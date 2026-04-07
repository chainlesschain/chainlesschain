/**
 * MCP Discovery Manager - Hot-loading & dynamic discovery
 *
 * Features:
 * - Directory watching: scan for package.json files with "mcp" key
 * - Health monitoring: ping connected servers via listTools() every 60s
 * - Config hot-apply: auto-connect/disconnect/reconnect on config changes
 * - Tool list change forwarding: listen to server-notification events
 *
 * @module mcp/mcp-discovery-manager
 * @version 1.0.0
 */

const EventEmitter = require("events");
const fs = require("fs");
const path = require("path");
const { logger } = require("../utils/logger.js");

const HEALTH_CHECK_INTERVAL = 60_000; // 60 seconds
const MAX_FAILURES_BEFORE_RESTART = 3;

class MCPDiscoveryManager extends EventEmitter {
  /**
   * @param {import('./mcp-client-manager').MCPClientManager} mcpManager
   * @param {import('./mcp-config-loader').MCPConfigLoader} mcpConfigLoader
   * @param {Object} [options]
   * @param {string[]} [options.scanDirs] - Directories to scan for MCP servers
   * @param {number} [options.healthCheckInterval] - Health check interval in ms
   */
  constructor(mcpManager, mcpConfigLoader, options = {}) {
    super();

    this.mcpManager = mcpManager;
    this.mcpConfigLoader = mcpConfigLoader;

    this.scanDirs = options.scanDirs || [];
    this.healthCheckInterval =
      options.healthCheckInterval || HEALTH_CHECK_INTERVAL;

    // Health tracking
    this.serverHealth = new Map(); // serverName -> { status, failures, lastCheck }
    this.healthTimer = null;

    // Directory watchers
    this.dirWatchers = new Map(); // dirPath -> FSWatcher
    this.discoveredServers = new Map(); // serverName -> { dir, packageJson }

    // Config change listener
    this._onConfigChanged = null;
    this._onServerNotification = null;

    this._running = false;

    logger.info("[MCPDiscovery] Initialized");
  }

  /**
   * Start health monitoring and config change listening
   */
  start() {
    if (this._running) {
      return;
    }
    this._running = true;

    // Listen for config changes → hot-apply
    this._onConfigChanged = ({ oldConfig, newConfig }) => {
      this._handleConfigChange(oldConfig, newConfig);
    };
    this.mcpConfigLoader.on("config-changed", this._onConfigChanged);

    // Listen for tool-list changes from connected servers
    this._onServerNotification = (notification) => {
      if (notification.type === "tools-changed") {
        logger.info(
          `[MCPDiscovery] Tools changed on server: ${notification.serverName}`,
        );
        this.emit("tools-changed", {
          serverName: notification.serverName,
          tools: notification.tools,
        });
      }
    };
    this.mcpManager.on("server-notification", this._onServerNotification);

    // Start health checks
    this._startHealthMonitoring();

    // Start directory watching if configured
    if (this.scanDirs.length > 0) {
      this._startDirectoryWatching();
    }

    logger.info("[MCPDiscovery] Started");
    this.emit("started");
  }

  /**
   * Stop all monitoring and watching
   */
  stop() {
    if (!this._running) {
      return;
    }
    this._running = false;

    // Stop health checks
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }

    // Stop config listener
    if (this._onConfigChanged) {
      this.mcpConfigLoader.off("config-changed", this._onConfigChanged);
      this._onConfigChanged = null;
    }

    // Stop server notification listener
    if (this._onServerNotification) {
      this.mcpManager.off("server-notification", this._onServerNotification);
      this._onServerNotification = null;
    }

    // Stop directory watchers
    for (const [dir, watcher] of this.dirWatchers) {
      watcher.close();
      logger.info(`[MCPDiscovery] Stopped watching directory: ${dir}`);
    }
    this.dirWatchers.clear();

    logger.info("[MCPDiscovery] Stopped");
    this.emit("stopped");
  }

  /**
   * Scan directories for MCP-compatible packages (M2: async fs.promises)
   * @param {string[]} [dirs] - Directories to scan (defaults to this.scanDirs)
   * @returns {Promise<Object[]>} Discovered servers
   */
  async scanDirectories(dirs = null) {
    const dirsToScan = dirs || this.scanDirs;
    const discovered = [];

    for (const dir of dirsToScan) {
      let entries;
      try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch (err) {
        if (err.code === "ENOENT") {
          logger.warn(`[MCPDiscovery] Scan directory not found: ${dir}`);
        } else {
          logger.error(`[MCPDiscovery] Error scanning ${dir}: ${err.message}`);
        }
        continue;
      }

      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }
        const pkgPath = path.join(dir, entry.name, "package.json");
        let pkg;
        try {
          const content = await fs.promises.readFile(pkgPath, "utf-8");
          pkg = JSON.parse(content);
        } catch (parseErr) {
          if (parseErr.code !== "ENOENT") {
            logger.warn(
              `[MCPDiscovery] Failed to parse ${pkgPath}: ${parseErr.message}`,
            );
          }
          continue;
        }
        if (pkg.mcp) {
          const serverInfo = {
            name: pkg.name || entry.name,
            version: pkg.version || "0.0.0",
            directory: path.join(dir, entry.name),
            mcpConfig: pkg.mcp,
            transport: pkg.mcp.transport || "stdio",
            command: pkg.mcp.command || "node",
            args: pkg.mcp.args || ["."],
          };
          discovered.push(serverInfo);
          this.discoveredServers.set(serverInfo.name, serverInfo);
          logger.info(
            `[MCPDiscovery] Found MCP server: ${serverInfo.name} in ${dir}`,
          );
        }
      }
    }

    this.emit("scan-complete", { dirs: dirsToScan, discovered });
    return discovered;
  }

  /**
   * Run a health check on all connected servers
   * @returns {Map<string, Object>} Health results per server
   */
  async healthCheck() {
    const connectedServers = this.mcpManager.getConnectedServers();
    const results = new Map();

    for (const serverName of connectedServers) {
      const result = await this._checkServerHealth(serverName);
      results.set(serverName, result);
    }

    this.emit("health-check-complete", Object.fromEntries(results));
    return results;
  }

  /**
   * Restart a specific server
   * @param {string} serverName
   */
  async restartServer(serverName) {
    logger.info(`[MCPDiscovery] Restarting server: ${serverName}`);

    try {
      // Disconnect
      await this.mcpManager.disconnectServer(serverName);

      // Get config
      const config = this.mcpConfigLoader.getServerConfig(serverName);
      if (!config) {
        throw new Error(`No config found for server: ${serverName}`);
      }

      // Reconnect
      await this.mcpManager.connectServer(serverName, config);

      // Reset health
      this.serverHealth.set(serverName, {
        status: "healthy",
        failures: 0,
        lastCheck: Date.now(),
      });

      this.emit("server-restarted", { serverName });
      logger.info(`[MCPDiscovery] Server restarted: ${serverName}`);
    } catch (err) {
      logger.error(
        `[MCPDiscovery] Failed to restart ${serverName}: ${err.message}`,
      );
      this.serverHealth.set(serverName, {
        status: "error",
        failures: MAX_FAILURES_BEFORE_RESTART,
        lastCheck: Date.now(),
        error: err.message,
      });
      this.emit("server-restart-failed", { serverName, error: err.message });
    }
  }

  /**
   * Get current status
   * @returns {Object} Discovery status
   */
  getStatus() {
    return {
      running: this._running,
      watchedDirs: Array.from(this.dirWatchers.keys()),
      discoveredServers: Array.from(this.discoveredServers.values()),
      serverHealth: Object.fromEntries(this.serverHealth),
      healthCheckInterval: this.healthCheckInterval,
    };
  }

  // ===================================
  // Private Methods
  // ===================================

  /**
   * Start periodic health monitoring
   * @private
   */
  _startHealthMonitoring() {
    this.healthTimer = setInterval(async () => {
      try {
        await this.healthCheck();
      } catch (err) {
        logger.error(`[MCPDiscovery] Health check cycle error: ${err.message}`);
      }
    }, this.healthCheckInterval);

    logger.info(
      `[MCPDiscovery] Health monitoring started (interval: ${this.healthCheckInterval}ms)`,
    );
  }

  /**
   * Check health of a single server
   * @private
   */
  async _checkServerHealth(serverName) {
    const current = this.serverHealth.get(serverName) || {
      status: "unknown",
      failures: 0,
      lastCheck: 0,
    };

    try {
      await this.mcpManager.listTools(serverName);
      const health = {
        status: "healthy",
        failures: 0,
        lastCheck: Date.now(),
      };
      this.serverHealth.set(serverName, health);
      return health;
    } catch (err) {
      const failures = current.failures + 1;
      const health = {
        status:
          failures >= MAX_FAILURES_BEFORE_RESTART ? "unhealthy" : "degraded",
        failures,
        lastCheck: Date.now(),
        error: err.message,
      };
      this.serverHealth.set(serverName, health);

      logger.warn(
        `[MCPDiscovery] Health check failed for ${serverName} (${failures}/${MAX_FAILURES_BEFORE_RESTART}): ${err.message}`,
      );

      // Auto-restart after max failures
      if (failures >= MAX_FAILURES_BEFORE_RESTART) {
        logger.info(
          `[MCPDiscovery] Auto-restarting unhealthy server: ${serverName}`,
        );
        await this.restartServer(serverName);
      }

      return health;
    }
  }

  /**
   * Handle config changes - hot-apply server additions/removals/changes
   * @private
   */
  async _handleConfigChange(oldConfig, newConfig) {
    logger.info("[MCPDiscovery] Config changed, applying hot-update...");

    const oldServers = new Set(Object.keys(oldConfig?.servers || {}));
    const newServers = new Set(Object.keys(newConfig?.servers || {}));

    // Disconnect removed servers
    for (const name of oldServers) {
      if (!newServers.has(name)) {
        logger.info(`[MCPDiscovery] Disconnecting removed server: ${name}`);
        try {
          await this.mcpManager.disconnectServer(name);
          this.serverHealth.delete(name);
          this.emit("server-removed", { serverName: name });
        } catch (err) {
          logger.error(
            `[MCPDiscovery] Error disconnecting ${name}: ${err.message}`,
          );
        }
      }
    }

    // Connect new servers
    for (const name of newServers) {
      if (!oldServers.has(name)) {
        const serverConfig = newConfig.servers[name];
        if (serverConfig.enabled !== false) {
          logger.info(`[MCPDiscovery] Connecting new server: ${name}`);
          try {
            await this.mcpManager.connectServer(name, serverConfig);
            this.emit("server-added", { serverName: name });
          } catch (err) {
            logger.error(
              `[MCPDiscovery] Error connecting ${name}: ${err.message}`,
            );
          }
        }
      }
    }

    // Reconnect changed servers
    for (const name of newServers) {
      if (oldServers.has(name)) {
        const oldCfg = oldConfig.servers[name];
        const newCfg = newConfig.servers[name];

        if (JSON.stringify(oldCfg) !== JSON.stringify(newCfg)) {
          logger.info(`[MCPDiscovery] Reconnecting changed server: ${name}`);
          try {
            await this.mcpManager.disconnectServer(name);
            if (newCfg.enabled !== false) {
              await this.mcpManager.connectServer(name, newCfg);
            }
            this.emit("server-reconnected", { serverName: name });
          } catch (err) {
            logger.error(
              `[MCPDiscovery] Error reconnecting ${name}: ${err.message}`,
            );
          }
        }
      }
    }

    this.emit("config-applied", {
      added: [...newServers].filter((s) => !oldServers.has(s)),
      removed: [...oldServers].filter((s) => !newServers.has(s)),
    });
  }

  /**
   * Start watching directories for new MCP servers
   * @private
   */
  _startDirectoryWatching() {
    for (const dir of this.scanDirs) {
      try {
        const watcher = fs.watch(
          dir,
          { recursive: false },
          (eventType, filename) => {
            if (!filename) {
              return;
            }
            // Debounce: re-scan after changes
            setTimeout(() => {
              logger.info(
                `[MCPDiscovery] Directory change detected in ${dir}, re-scanning...`,
              );
              this.scanDirectories([dir]).catch((err) => {
                logger.error(`[MCPDiscovery] Re-scan failed: ${err.message}`);
              });
            }, 1000);
          },
        );

        this.dirWatchers.set(dir, watcher);
        logger.info(`[MCPDiscovery] Watching directory: ${dir}`);
      } catch (err) {
        if (err.code === "ENOENT") {
          logger.warn(`[MCPDiscovery] Watch directory not found: ${dir}`);
        } else {
          logger.error(`[MCPDiscovery] Failed to watch ${dir}: ${err.message}`);
        }
      }
    }

    // Initial scan (fire-and-forget; result emitted via 'scan-complete')
    this.scanDirectories().catch((err) => {
      logger.error(`[MCPDiscovery] Initial scan failed: ${err.message}`);
    });
  }
}

module.exports = { MCPDiscoveryManager };

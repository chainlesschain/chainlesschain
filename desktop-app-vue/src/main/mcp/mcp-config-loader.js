/**
 * MCP Configuration Loader
 *
 * Loads and manages MCP configuration from .chainlesschain/config.json
 * Supports hot-reload and validation.
 *
 * @module MCPConfigLoader
 */

const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

class MCPConfigLoader extends EventEmitter {
  constructor(configPath = null) {
    super();

    // Default config path
    this.configPath = configPath || path.join(
      process.cwd(),
      '.chainlesschain',
      'config.json'
    );

    this.config = null;
    this.lastLoadTime = null;
    this.watchHandle = null;

    console.log('[MCPConfigLoader] Initialized with config path:', this.configPath);
  }

  /**
   * Load configuration from file
   * @param {boolean} watch - Enable file watching for hot-reload
   * @returns {Object} MCP configuration
   */
  load(watch = false) {
    try {
      console.log('[MCPConfigLoader] Loading configuration...');

      // Check if config file exists
      if (!fs.existsSync(this.configPath)) {
        console.warn(`[MCPConfigLoader] Config file not found: ${this.configPath}`);
        console.warn('[MCPConfigLoader] Using default configuration');
        this.config = this._getDefaultConfig();
        return this.config;
      }

      // Read and parse config
      const configContent = fs.readFileSync(this.configPath, 'utf-8');
      const fullConfig = JSON.parse(configContent);

      // Extract MCP section
      this.config = fullConfig.mcp || this._getDefaultConfig();

      // Validate configuration
      this._validateConfig(this.config);

      this.lastLoadTime = Date.now();

      console.log('[MCPConfigLoader] Configuration loaded successfully');
      console.log(`  Enabled: ${this.config.enabled}`);
      console.log(`  Servers: ${Object.keys(this.config.servers || {}).length}`);

      // Set up file watching if requested
      if (watch && !this.watchHandle) {
        this._setupWatcher();
      }

      this.emit('config-loaded', this.config);

      return this.config;

    } catch (error) {
      console.error('[MCPConfigLoader] Failed to load configuration:', error);

      // Fall back to default config
      this.config = this._getDefaultConfig();

      this.emit('config-error', error);

      return this.config;
    }
  }

  /**
   * Get current configuration
   * @returns {Object} MCP configuration
   */
  getConfig() {
    if (!this.config) {
      return this.load();
    }
    return this.config;
  }

  /**
   * Get configuration for a specific server
   * @param {string} serverName - Server identifier
   * @returns {Object|null} Server configuration
   */
  getServerConfig(serverName) {
    const config = this.getConfig();

    if (!config.servers || !config.servers[serverName]) {
      return null;
    }

    return config.servers[serverName];
  }

  /**
   * Get list of enabled servers
   * @returns {string[]} Array of enabled server names
   */
  getEnabledServers() {
    const config = this.getConfig();

    if (!config.servers) {
      return [];
    }

    return Object.entries(config.servers)
      .filter(([_, serverConfig]) => serverConfig.enabled)
      .map(([name, _]) => name);
  }

  /**
   * Reload configuration from file
   * @returns {Object} Updated configuration
   */
  reload() {
    console.log('[MCPConfigLoader] Reloading configuration...');

    const oldConfig = this.config;
    const newConfig = this.load(false);

    // Detect changes
    const changes = this._detectChanges(oldConfig, newConfig);

    if (changes.length > 0) {
      console.log('[MCPConfigLoader] Configuration changed:');
      changes.forEach(change => console.log(`  - ${change}`));

      this.emit('config-changed', { oldConfig, newConfig, changes });
    }

    return newConfig;
  }

  /**
   * Stop watching configuration file
   */
  stopWatching() {
    if (this.watchHandle) {
      this.watchHandle.close();
      this.watchHandle = null;
      console.log('[MCPConfigLoader] Stopped watching configuration file');
    }
  }

  // ===================================
  // Private Methods
  // ===================================

  /**
   * Get default configuration
   * @private
   */
  _getDefaultConfig() {
    return {
      enabled: false,
      servers: {},
      trustedServers: [
        '@modelcontextprotocol/server-filesystem',
        '@modelcontextprotocol/server-postgres',
        '@modelcontextprotocol/server-github'
      ],
      allowUntrustedServers: false,
      defaultPermissions: {
        requireConsent: true,
        readOnly: false
      }
    };
  }

  /**
   * Validate configuration structure
   * @private
   */
  _validateConfig(config) {
    if (typeof config !== 'object') {
      throw new Error('Config must be an object');
    }

    if (config.enabled !== undefined && typeof config.enabled !== 'boolean') {
      throw new Error('config.enabled must be a boolean');
    }

    if (config.servers !== undefined && typeof config.servers !== 'object') {
      throw new Error('config.servers must be an object');
    }

    // Validate each server config
    if (config.servers) {
      for (const [serverName, serverConfig] of Object.entries(config.servers)) {
        this._validateServerConfig(serverName, serverConfig);
      }
    }
  }

  /**
   * Validate server configuration
   * @private
   */
  _validateServerConfig(serverName, config) {
    if (!config.command) {
      throw new Error(`Server ${serverName}: missing 'command' field`);
    }

    if (!Array.isArray(config.args)) {
      throw new Error(`Server ${serverName}: 'args' must be an array`);
    }

    if (config.enabled !== undefined && typeof config.enabled !== 'boolean') {
      throw new Error(`Server ${serverName}: 'enabled' must be a boolean`);
    }
  }

  /**
   * Setup file watcher for hot-reload
   * @private
   */
  _setupWatcher() {
    try {
      this.watchHandle = fs.watch(this.configPath, (eventType) => {
        if (eventType === 'change') {
          console.log('[MCPConfigLoader] Configuration file changed, reloading...');

          // Debounce: wait 500ms before reloading
          setTimeout(() => {
            this.reload();
          }, 500);
        }
      });

      console.log('[MCPConfigLoader] Watching configuration file for changes');

    } catch (error) {
      console.error('[MCPConfigLoader] Failed to setup file watcher:', error);
    }
  }

  /**
   * Detect changes between old and new config
   * @private
   */
  _detectChanges(oldConfig, newConfig) {
    const changes = [];

    if (!oldConfig) {
      return ['Initial configuration loaded'];
    }

    // Check enabled status
    if (oldConfig.enabled !== newConfig.enabled) {
      changes.push(`MCP ${newConfig.enabled ? 'enabled' : 'disabled'}`);
    }

    // Check server changes
    const oldServers = new Set(Object.keys(oldConfig.servers || {}));
    const newServers = new Set(Object.keys(newConfig.servers || {}));

    // Added servers
    for (const server of newServers) {
      if (!oldServers.has(server)) {
        changes.push(`Added server: ${server}`);
      }
    }

    // Removed servers
    for (const server of oldServers) {
      if (!newServers.has(server)) {
        changes.push(`Removed server: ${server}`);
      }
    }

    // Changed servers
    for (const server of newServers) {
      if (oldServers.has(server)) {
        const oldServer = oldConfig.servers[server];
        const newServer = newConfig.servers[server];

        if (oldServer.enabled !== newServer.enabled) {
          changes.push(`Server ${server}: ${newServer.enabled ? 'enabled' : 'disabled'}`);
        }

        if (JSON.stringify(oldServer.permissions) !== JSON.stringify(newServer.permissions)) {
          changes.push(`Server ${server}: permissions changed`);
        }
      }
    }

    return changes;
  }
}

module.exports = { MCPConfigLoader };

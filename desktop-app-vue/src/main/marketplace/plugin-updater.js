/**
 * Plugin Updater - Plugin marketplace update manager
 *
 * Handles checking for plugin updates, auto-update notifications,
 * update history tracking, and marketplace settings management.
 *
 * @module marketplace/plugin-updater
 */

const { logger } = require('../utils/logger.js');
const { v4: uuidv4 } = require('uuid');
const { EventEmitter } = require('events');

/**
 * Default marketplace settings
 */
const DEFAULT_SETTINGS = {
  checkInterval: 86400000, // 24 hours in ms
  autoUpdateEnabled: false,
  notificationsEnabled: true,
  maxConcurrentUpdates: 3,
  updateChannel: 'stable', // 'stable' | 'beta' | 'nightly'
  lastCheckTime: null,
};

/**
 * Version comparison utility
 * @param {string} v1 - First version string (semver)
 * @param {string} v2 - Second version string (semver)
 * @returns {number} 1 if v1 > v2, -1 if v1 < v2, 0 if equal
 */
function compareVersions(v1, v2) {
  const parts1 = v1.replace(/^v/, '').split('.').map(Number);
  const parts2 = v2.replace(/^v/, '').split('.').map(Number);

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const part1 = parts1[i] || 0;
    const part2 = parts2[i] || 0;

    if (part1 > part2) return 1;
    if (part1 < part2) return -1;
  }

  return 0;
}

class PluginUpdater extends EventEmitter {
  /**
   * @param {Object} options
   * @param {Object} options.database - Database instance for querying installed plugins
   * @param {Object} options.marketplaceClient - Marketplace API client for fetching remote data
   * @param {Object} options.pluginInstaller - Plugin installer for performing updates
   */
  constructor({ database, marketplaceClient, pluginInstaller }) {
    super();

    if (!database) {
      throw new Error('PluginUpdater requires a database instance');
    }
    if (!marketplaceClient) {
      throw new Error('PluginUpdater requires a marketplaceClient instance');
    }
    if (!pluginInstaller) {
      throw new Error('PluginUpdater requires a pluginInstaller instance');
    }

    this.database = database;
    this.marketplaceClient = marketplaceClient;
    this.pluginInstaller = pluginInstaller;

    // Internal state
    this._checking = false;
    this._updating = false;
    this._checkTimer = null;
    this._pendingUpdates = new Map();
    this._activeUpdates = new Set();

    logger.info('[PluginUpdater] Initialized');
  }

  // ============================================================
  // Update Checking
  // ============================================================

  /**
   * Check all installed plugins for available updates.
   * Queries installed_plugins table and compares versions with marketplace.
   *
   * @returns {Object} { success: boolean, data?: Array, error?: string }
   */
  async checkUpdates() {
    if (this._checking) {
      logger.info('[PluginUpdater] Update check already in progress, skipping');
      return {
        success: true,
        data: Array.from(this._pendingUpdates.values()),
      };
    }

    this._checking = true;
    logger.info('[PluginUpdater] Checking all installed plugins for updates...');

    try {
      // Query all installed plugins from the database
      const installedPlugins = this._getInstalledPlugins();

      if (!installedPlugins || installedPlugins.length === 0) {
        logger.info('[PluginUpdater] No installed plugins found');
        this._checking = false;
        return { success: true, data: [] };
      }

      const availableUpdates = [];
      this._pendingUpdates.clear();

      // Check each plugin against the marketplace
      for (const plugin of installedPlugins) {
        try {
          const remoteInfo = await this.marketplaceClient.getPlugin(plugin.plugin_id, false);

          if (!remoteInfo || !remoteInfo.version) {
            logger.warn(`[PluginUpdater] No remote info found for plugin: ${plugin.plugin_id}`);
            continue;
          }

          const comparison = compareVersions(remoteInfo.version, plugin.version);

          if (comparison > 0) {
            const updateInfo = {
              pluginId: plugin.plugin_id,
              name: plugin.name,
              currentVersion: plugin.version,
              latestVersion: remoteInfo.version,
              changelog: remoteInfo.changelog || null,
              releaseDate: remoteInfo.releaseDate || remoteInfo.updated_at || null,
              downloadSize: remoteInfo.downloadSize || null,
              critical: remoteInfo.critical || false,
              autoUpdate: plugin.auto_update === 1,
            };

            availableUpdates.push(updateInfo);
            this._pendingUpdates.set(plugin.plugin_id, updateInfo);

            logger.info(
              `[PluginUpdater] Update available: ${plugin.plugin_id} ${plugin.version} -> ${remoteInfo.version}`
            );

            this.emit('update-available', updateInfo);
          }
        } catch (err) {
          logger.warn(
            `[PluginUpdater] Failed to check update for ${plugin.plugin_id}: ${err.message}`
          );
        }
      }

      // Update last check time in settings
      this._saveSettingValue('marketplace.lastCheckTime', Date.now());

      logger.info(
        `[PluginUpdater] Update check complete: ${availableUpdates.length} updates available`
      );

      this._checking = false;
      return { success: true, data: availableUpdates };
    } catch (error) {
      this._checking = false;
      logger.error('[PluginUpdater] checkUpdates failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Check a single plugin for updates.
   *
   * @param {string} pluginId - The plugin ID to check
   * @returns {Object} { success: boolean, data?: Object|null, error?: string }
   */
  async checkSingleUpdate(pluginId) {
    if (!pluginId) {
      return { success: false, error: 'pluginId is required' };
    }

    logger.info(`[PluginUpdater] Checking update for plugin: ${pluginId}`);

    try {
      // Get installed plugin info
      const plugin = this._getInstalledPlugin(pluginId);

      if (!plugin) {
        return { success: false, error: `Plugin not installed: ${pluginId}` };
      }

      // Fetch remote info (bypass cache)
      const remoteInfo = await this.marketplaceClient.getPlugin(pluginId, false);

      if (!remoteInfo || !remoteInfo.version) {
        return { success: true, data: null }; // No remote info, no update
      }

      const comparison = compareVersions(remoteInfo.version, plugin.version);

      if (comparison > 0) {
        const updateInfo = {
          pluginId: plugin.plugin_id,
          name: plugin.name,
          currentVersion: plugin.version,
          latestVersion: remoteInfo.version,
          changelog: remoteInfo.changelog || null,
          releaseDate: remoteInfo.releaseDate || remoteInfo.updated_at || null,
          downloadSize: remoteInfo.downloadSize || null,
          critical: remoteInfo.critical || false,
          autoUpdate: plugin.auto_update === 1,
        };

        this._pendingUpdates.set(pluginId, updateInfo);
        this.emit('update-available', updateInfo);

        logger.info(
          `[PluginUpdater] Update available for ${pluginId}: ${plugin.version} -> ${remoteInfo.version}`
        );

        return { success: true, data: updateInfo };
      }

      logger.info(`[PluginUpdater] Plugin ${pluginId} is up to date (v${plugin.version})`);
      return { success: true, data: null };
    } catch (error) {
      logger.error(`[PluginUpdater] checkSingleUpdate failed for ${pluginId}:`, error);
      return { success: false, error: error.message };
    }
  }

  // ============================================================
  // Auto-Update
  // ============================================================

  /**
   * Auto-update all plugins that have auto_update=1.
   * Only updates plugins that have pending updates and auto-update enabled.
   *
   * @returns {Object} { success: boolean, data?: { updated: Array, failed: Array, skipped: Array }, error?: string }
   */
  async autoUpdateAll() {
    if (this._updating) {
      logger.warn('[PluginUpdater] Auto-update already in progress');
      return { success: false, error: 'Update already in progress' };
    }

    this._updating = true;
    logger.info('[PluginUpdater] Starting auto-update for eligible plugins...');

    const results = {
      updated: [],
      failed: [],
      skipped: [],
    };

    try {
      // First ensure we have current update information
      if (this._pendingUpdates.size === 0) {
        const checkResult = await this.checkUpdates();
        if (!checkResult.success) {
          this._updating = false;
          return { success: false, error: `Update check failed: ${checkResult.error}` };
        }
      }

      // Filter plugins that have auto_update enabled
      const autoUpdatePlugins = Array.from(this._pendingUpdates.values()).filter(
        (update) => update.autoUpdate
      );

      if (autoUpdatePlugins.length === 0) {
        logger.info('[PluginUpdater] No plugins eligible for auto-update');
        this._updating = false;
        return { success: true, data: results };
      }

      logger.info(
        `[PluginUpdater] ${autoUpdatePlugins.length} plugins eligible for auto-update`
      );

      // Process updates sequentially to avoid conflicts
      for (const update of autoUpdatePlugins) {
        try {
          this.emit('update-started', {
            pluginId: update.pluginId,
            fromVersion: update.currentVersion,
            toVersion: update.latestVersion,
          });

          // Perform the update via plugin installer
          await this.pluginInstaller.updatePlugin(update.pluginId, update.latestVersion);

          // Record update history
          this._recordUpdateHistory(
            update.pluginId,
            update.currentVersion,
            update.latestVersion,
            true,
            null
          );

          // Remove from pending updates
          this._pendingUpdates.delete(update.pluginId);
          this._activeUpdates.delete(update.pluginId);

          results.updated.push({
            pluginId: update.pluginId,
            fromVersion: update.currentVersion,
            toVersion: update.latestVersion,
          });

          this.emit('update-completed', {
            pluginId: update.pluginId,
            fromVersion: update.currentVersion,
            toVersion: update.latestVersion,
          });

          logger.info(
            `[PluginUpdater] Auto-updated ${update.pluginId}: ${update.currentVersion} -> ${update.latestVersion}`
          );
        } catch (err) {
          // Record failed update
          this._recordUpdateHistory(
            update.pluginId,
            update.currentVersion,
            update.latestVersion,
            false,
            err.message
          );

          results.failed.push({
            pluginId: update.pluginId,
            error: err.message,
          });

          this.emit('update-failed', {
            pluginId: update.pluginId,
            error: err.message,
          });

          logger.error(
            `[PluginUpdater] Auto-update failed for ${update.pluginId}: ${err.message}`
          );
        }
      }

      // Count skipped plugins (pending but no auto-update)
      const skippedPlugins = Array.from(this._pendingUpdates.values()).filter(
        (update) => !update.autoUpdate
      );
      for (const update of skippedPlugins) {
        results.skipped.push({
          pluginId: update.pluginId,
          reason: 'auto-update disabled',
        });
      }

      logger.info(
        `[PluginUpdater] Auto-update complete: ${results.updated.length} updated, ` +
          `${results.failed.length} failed, ${results.skipped.length} skipped`
      );

      this._updating = false;
      return { success: true, data: results };
    } catch (error) {
      this._updating = false;
      logger.error('[PluginUpdater] autoUpdateAll failed:', error);
      return { success: false, error: error.message };
    }
  }

  // ============================================================
  // Update History
  // ============================================================

  /**
   * Get update history for a specific plugin or all plugins.
   *
   * @param {string} [pluginId] - Optional plugin ID to filter by
   * @returns {Object} { success: boolean, data?: Array, error?: string }
   */
  getUpdateHistory(pluginId) {
    try {
      let rows;

      if (pluginId) {
        logger.info(`[PluginUpdater] Getting update history for plugin: ${pluginId}`);
        const stmt = this.database.db.prepare(
          'SELECT * FROM plugin_update_history WHERE plugin_id = ? ORDER BY updated_at DESC'
        );
        rows = stmt.all([pluginId]);
        stmt.free();
      } else {
        logger.info('[PluginUpdater] Getting all update history');
        const stmt = this.database.db.prepare(
          'SELECT * FROM plugin_update_history ORDER BY updated_at DESC LIMIT 100'
        );
        rows = stmt.all();
        stmt.free();
      }

      const history = (rows || []).map((row) => ({
        id: row.id,
        pluginId: row.plugin_id,
        fromVersion: row.from_version,
        toVersion: row.to_version,
        updatedAt: row.updated_at,
        success: row.success === 1,
        errorMessage: row.error_message || null,
      }));

      return { success: true, data: history };
    } catch (error) {
      logger.error('[PluginUpdater] getUpdateHistory failed:', error);
      return { success: false, error: error.message };
    }
  }

  // ============================================================
  // Auto-Update Settings (per plugin)
  // ============================================================

  /**
   * Toggle auto-update for a specific plugin.
   *
   * @param {string} pluginId - The plugin ID
   * @param {boolean} enabled - Whether auto-update should be enabled
   * @returns {Object} { success: boolean, error?: string }
   */
  setAutoUpdate(pluginId, enabled) {
    if (!pluginId) {
      return { success: false, error: 'pluginId is required' };
    }

    try {
      const value = enabled ? 1 : 0;
      const stmt = this.database.db.prepare(
        'UPDATE installed_plugins SET auto_update = ? WHERE plugin_id = ?'
      );
      stmt.run([value, pluginId]);
      stmt.free();

      // Update cached pending update info if present
      if (this._pendingUpdates.has(pluginId)) {
        const update = this._pendingUpdates.get(pluginId);
        update.autoUpdate = enabled;
      }

      logger.info(
        `[PluginUpdater] Auto-update for ${pluginId} set to ${enabled ? 'enabled' : 'disabled'}`
      );

      return { success: true };
    } catch (error) {
      logger.error(`[PluginUpdater] setAutoUpdate failed for ${pluginId}:`, error);
      return { success: false, error: error.message };
    }
  }

  // ============================================================
  // Marketplace Settings
  // ============================================================

  /**
   * Get marketplace settings (check interval, auto-update global toggle, etc.).
   *
   * @returns {Object} { success: boolean, data?: Object, error?: string }
   */
  getSettings() {
    try {
      const settings = { ...DEFAULT_SETTINGS };

      // Load settings from system_settings table
      const keys = [
        'marketplace.checkInterval',
        'marketplace.autoUpdateEnabled',
        'marketplace.notificationsEnabled',
        'marketplace.maxConcurrentUpdates',
        'marketplace.updateChannel',
        'marketplace.lastCheckTime',
      ];

      for (const key of keys) {
        const value = this._getSettingValue(key);
        if (value !== null && value !== undefined) {
          const shortKey = key.replace('marketplace.', '');
          settings[shortKey] = value;
        }
      }

      logger.info('[PluginUpdater] Retrieved marketplace settings');
      return { success: true, data: settings };
    } catch (error) {
      logger.error('[PluginUpdater] getSettings failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Save marketplace settings.
   *
   * @param {Object} settings - Settings to update
   * @param {number} [settings.checkInterval] - Update check interval in ms
   * @param {boolean} [settings.autoUpdateEnabled] - Global auto-update toggle
   * @param {boolean} [settings.notificationsEnabled] - Notification toggle
   * @param {number} [settings.maxConcurrentUpdates] - Max concurrent updates
   * @param {string} [settings.updateChannel] - Update channel: 'stable' | 'beta' | 'nightly'
   * @returns {Object} { success: boolean, error?: string }
   */
  updateSettings(settings) {
    if (!settings || typeof settings !== 'object') {
      return { success: false, error: 'settings must be an object' };
    }

    try {
      const allowedKeys = [
        'checkInterval',
        'autoUpdateEnabled',
        'notificationsEnabled',
        'maxConcurrentUpdates',
        'updateChannel',
      ];

      for (const [key, value] of Object.entries(settings)) {
        if (!allowedKeys.includes(key)) {
          logger.warn(`[PluginUpdater] Ignoring unknown setting: ${key}`);
          continue;
        }

        // Validate specific settings
        if (key === 'checkInterval' && (typeof value !== 'number' || value < 60000)) {
          logger.warn('[PluginUpdater] checkInterval must be at least 60000ms (1 minute)');
          continue;
        }

        if (key === 'maxConcurrentUpdates' && (typeof value !== 'number' || value < 1 || value > 10)) {
          logger.warn('[PluginUpdater] maxConcurrentUpdates must be between 1 and 10');
          continue;
        }

        if (key === 'updateChannel' && !['stable', 'beta', 'nightly'].includes(value)) {
          logger.warn('[PluginUpdater] updateChannel must be stable, beta, or nightly');
          continue;
        }

        this._saveSettingValue(`marketplace.${key}`, value);
      }

      // If check interval changed, restart the auto-check timer
      if (settings.checkInterval && this._checkTimer) {
        this._restartCheckTimer(settings.checkInterval);
      }

      logger.info('[PluginUpdater] Marketplace settings updated');
      return { success: true };
    } catch (error) {
      logger.error('[PluginUpdater] updateSettings failed:', error);
      return { success: false, error: error.message };
    }
  }

  // ============================================================
  // Timer Management
  // ============================================================

  /**
   * Start periodic update checking.
   *
   * @param {number} [interval] - Check interval in ms (defaults to settings)
   */
  startAutoCheck(interval) {
    if (this._checkTimer) {
      logger.info('[PluginUpdater] Auto-check timer already running');
      return;
    }

    const checkInterval = interval || this._getCheckInterval();
    logger.info(
      `[PluginUpdater] Starting auto-check timer (interval: ${checkInterval}ms)`
    );

    this._checkTimer = setInterval(async () => {
      try {
        const result = await this.checkUpdates();
        if (result.success && result.data && result.data.length > 0) {
          // Check if global auto-update is enabled
          const settings = this.getSettings();
          if (settings.success && settings.data && settings.data.autoUpdateEnabled) {
            await this.autoUpdateAll();
          }
        }
      } catch (err) {
        logger.error('[PluginUpdater] Periodic update check failed:', err);
      }
    }, checkInterval);
  }

  /**
   * Stop periodic update checking.
   */
  stopAutoCheck() {
    if (this._checkTimer) {
      clearInterval(this._checkTimer);
      this._checkTimer = null;
      logger.info('[PluginUpdater] Auto-check timer stopped');
    }
  }

  /**
   * Restart the auto-check timer with a new interval.
   *
   * @param {number} interval - New check interval in ms
   * @private
   */
  _restartCheckTimer(interval) {
    this.stopAutoCheck();
    this.startAutoCheck(interval);
  }

  // ============================================================
  // Database Helpers (Private)
  // ============================================================

  /**
   * Get all installed plugins from the database.
   *
   * @returns {Array} List of installed plugin records
   * @private
   */
  _getInstalledPlugins() {
    try {
      const stmt = this.database.db.prepare(
        'SELECT * FROM installed_plugins WHERE enabled = 1 ORDER BY installed_at DESC'
      );
      const rows = stmt.all();
      stmt.free();
      return rows || [];
    } catch (error) {
      logger.error('[PluginUpdater] _getInstalledPlugins failed:', error);
      return [];
    }
  }

  /**
   * Get a single installed plugin by ID.
   *
   * @param {string} pluginId - The plugin ID
   * @returns {Object|null} Plugin record or null
   * @private
   */
  _getInstalledPlugin(pluginId) {
    try {
      const stmt = this.database.db.prepare(
        'SELECT * FROM installed_plugins WHERE plugin_id = ?'
      );
      const row = stmt.get([pluginId]);
      stmt.free();
      return row || null;
    } catch (error) {
      logger.error(`[PluginUpdater] _getInstalledPlugin failed for ${pluginId}:`, error);
      return null;
    }
  }

  /**
   * Record an update attempt in plugin_update_history.
   *
   * @param {string} pluginId - Plugin ID
   * @param {string} fromVersion - Previous version
   * @param {string} toVersion - New version
   * @param {boolean} success - Whether update succeeded
   * @param {string|null} errorMessage - Error message if failed
   * @private
   */
  _recordUpdateHistory(pluginId, fromVersion, toVersion, success, errorMessage) {
    try {
      const stmt = this.database.db.prepare(
        `INSERT INTO plugin_update_history (id, plugin_id, from_version, to_version, updated_at, success, error_message)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      stmt.run([
        uuidv4(),
        pluginId,
        fromVersion,
        toVersion,
        Date.now(),
        success ? 1 : 0,
        errorMessage || null,
      ]);
      stmt.free();
    } catch (error) {
      logger.error(`[PluginUpdater] _recordUpdateHistory failed for ${pluginId}:`, error);
    }
  }

  /**
   * Get a single setting value from system_settings.
   *
   * @param {string} key - Setting key
   * @returns {*} Setting value or null
   * @private
   */
  _getSettingValue(key) {
    try {
      if (typeof this.database.getSetting === 'function') {
        return this.database.getSetting(key);
      }

      const stmt = this.database.db.prepare(
        'SELECT value, type FROM system_settings WHERE key = ?'
      );
      const row = stmt.get([key]);
      stmt.free();

      if (!row) return null;

      // Parse value based on type
      switch (row.type) {
        case 'number':
          return Number(row.value);
        case 'boolean':
          return row.value === 'true' || row.value === '1';
        case 'json':
          try {
            return JSON.parse(row.value);
          } catch {
            return row.value;
          }
        default:
          return row.value;
      }
    } catch (error) {
      logger.error(`[PluginUpdater] _getSettingValue failed for ${key}:`, error);
      return null;
    }
  }

  /**
   * Save a single setting value to system_settings.
   *
   * @param {string} key - Setting key
   * @param {*} value - Setting value
   * @private
   */
  _saveSettingValue(key, value) {
    try {
      if (typeof this.database.setSetting === 'function') {
        this.database.setSetting(key, value);
        return;
      }

      // Determine type
      let type = 'string';
      let stringValue = String(value);

      if (typeof value === 'number') {
        type = 'number';
        stringValue = String(value);
      } else if (typeof value === 'boolean') {
        type = 'boolean';
        stringValue = String(value);
      } else if (typeof value === 'object') {
        type = 'json';
        stringValue = JSON.stringify(value);
      }

      const now = Date.now();
      const stmt = this.database.db.prepare(
        `INSERT OR REPLACE INTO system_settings (key, value, type, updated_at, created_at)
         VALUES (?, ?, ?, ?, COALESCE((SELECT created_at FROM system_settings WHERE key = ?), ?))`
      );
      stmt.run([key, stringValue, type, now, key, now]);
      stmt.free();
    } catch (error) {
      logger.error(`[PluginUpdater] _saveSettingValue failed for ${key}:`, error);
    }
  }

  /**
   * Get the configured check interval from settings.
   *
   * @returns {number} Check interval in ms
   * @private
   */
  _getCheckInterval() {
    const value = this._getSettingValue('marketplace.checkInterval');
    return (typeof value === 'number' && value >= 60000) ? value : DEFAULT_SETTINGS.checkInterval;
  }

  // ============================================================
  // Cleanup
  // ============================================================

  /**
   * Destroy the updater, stopping all timers and clearing state.
   */
  destroy() {
    this.stopAutoCheck();
    this._pendingUpdates.clear();
    this._activeUpdates.clear();
    this._checking = false;
    this._updating = false;
    this.removeAllListeners();
    logger.info('[PluginUpdater] Destroyed');
  }
}

module.exports = { PluginUpdater };

/**
 * Marketplace IPC Handlers
 *
 * Registers 22 IPC handlers for the plugin marketplace system.
 * Covers browsing, installation, updates, ratings, publishing, and configuration.
 *
 * @module marketplace/marketplace-ipc
 */

const { ipcMain } = require('electron');
const { logger } = require('../utils/logger.js');

/**
 * Register all marketplace IPC handlers.
 *
 * @param {Object} dependencies
 * @param {Object} dependencies.database - Database instance
 */
function registerMarketplaceIPC(dependencies) {
  const { database } = dependencies;

  let marketplaceClient = null;
  let pluginInstaller = null;
  let pluginUpdater = null;

  /**
   * Lazy-initialize the marketplace client.
   * @returns {Object} MarketplaceClient instance
   */
  function getMarketplaceClient() {
    if (!marketplaceClient) {
      const { MarketplaceClient } = require('./marketplace-client');
      marketplaceClient = new MarketplaceClient({ baseURL: 'http://localhost:8090/api' });
    }
    return marketplaceClient;
  }

  /**
   * Lazy-initialize the plugin installer.
   * @returns {Object} PluginInstaller instance
   */
  function getPluginInstaller() {
    if (!pluginInstaller) {
      const { PluginInstaller } = require('./plugin-installer');
      pluginInstaller = new PluginInstaller({ database, marketplaceClient: getMarketplaceClient() });
    }
    return pluginInstaller;
  }

  /**
   * Lazy-initialize the plugin updater.
   * @returns {Object} PluginUpdater instance
   */
  function getPluginUpdater() {
    if (!pluginUpdater) {
      const { PluginUpdater } = require('./plugin-updater');
      pluginUpdater = new PluginUpdater({
        database,
        marketplaceClient: getMarketplaceClient(),
        pluginInstaller: getPluginInstaller(),
      });
    }
    return pluginUpdater;
  }

  // ============================================================
  // Browse - Plugin discovery and search (6 handlers)
  // ============================================================

  /**
   * List plugins from the marketplace with optional filters.
   * @channel marketplace:list-plugins
   * @param {Object} options - { category, sort, page, pageSize, verified }
   * @returns {Object} { success, data/error }
   */
  ipcMain.handle('marketplace:list-plugins', async (event, options = {}) => {
    try {
      const client = getMarketplaceClient();
      const result = await client.listPlugins(options);
      return { success: true, data: result };
    } catch (error) {
      logger.error('[IPC] marketplace:list-plugins error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Search plugins by query string.
   * @channel marketplace:search-plugins
   * @param {string} query - Search query
   * @param {Object} options - { category, sort, page, pageSize }
   * @returns {Object} { success, data/error }
   */
  ipcMain.handle('marketplace:search-plugins', async (event, query, options = {}) => {
    try {
      const client = getMarketplaceClient();
      const result = await client.searchPlugins(query, options);
      return { success: true, data: result };
    } catch (error) {
      logger.error('[IPC] marketplace:search-plugins error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get detailed information about a specific plugin.
   * @channel marketplace:get-plugin-detail
   * @param {string} pluginId - The plugin ID
   * @returns {Object} { success, data/error }
   */
  ipcMain.handle('marketplace:get-plugin-detail', async (event, pluginId) => {
    try {
      const client = getMarketplaceClient();
      const result = await client.getPlugin(pluginId);
      return { success: true, data: result };
    } catch (error) {
      logger.error('[IPC] marketplace:get-plugin-detail error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get featured / recommended plugins.
   * @channel marketplace:get-featured
   * @param {number} limit - Maximum number of results
   * @returns {Object} { success, data/error }
   */
  ipcMain.handle('marketplace:get-featured', async (event, limit = 10) => {
    try {
      const client = getMarketplaceClient();
      const result = await client.getFeaturedPlugins(limit);
      return { success: true, data: result };
    } catch (error) {
      logger.error('[IPC] marketplace:get-featured error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get popular plugins sorted by download count.
   * @channel marketplace:get-popular
   * @param {Object} options - { page, pageSize }
   * @returns {Object} { success, data/error }
   */
  ipcMain.handle('marketplace:get-popular', async (event, options = {}) => {
    try {
      const client = getMarketplaceClient();
      const result = await client.listPlugins({
        ...options,
        sort: 'popular',
      });
      return { success: true, data: result };
    } catch (error) {
      logger.error('[IPC] marketplace:get-popular error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get all available plugin categories.
   * @channel marketplace:get-categories
   * @returns {Object} { success, data/error }
   */
  ipcMain.handle('marketplace:get-categories', async (event) => {
    try {
      const client = getMarketplaceClient();
      const result = await client.getCategories();
      return { success: true, data: result };
    } catch (error) {
      logger.error('[IPC] marketplace:get-categories error:', error);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Install - Plugin lifecycle management (6 handlers)
  // ============================================================

  /**
   * Install a plugin from the marketplace.
   * @channel marketplace:install-plugin
   * @param {string} pluginId - The plugin ID to install
   * @param {string} [version] - Specific version or 'latest'
   * @returns {Object} { success, data/error }
   */
  ipcMain.handle('marketplace:install-plugin', async (event, pluginId, version = 'latest') => {
    try {
      const installer = getPluginInstaller();
      const result = await installer.installPlugin(pluginId, version);
      return { success: true, data: result };
    } catch (error) {
      logger.error('[IPC] marketplace:install-plugin error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Uninstall an installed plugin.
   * @channel marketplace:uninstall-plugin
   * @param {string} pluginId - The plugin ID to uninstall
   * @returns {Object} { success, error? }
   */
  ipcMain.handle('marketplace:uninstall-plugin', async (event, pluginId) => {
    try {
      const installer = getPluginInstaller();
      await installer.uninstallPlugin(pluginId);
      return { success: true };
    } catch (error) {
      logger.error('[IPC] marketplace:uninstall-plugin error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Update a specific plugin to a newer version.
   * @channel marketplace:update-plugin
   * @param {string} pluginId - The plugin ID to update
   * @param {string} [version] - Target version or 'latest'
   * @returns {Object} { success, data/error }
   */
  ipcMain.handle('marketplace:update-plugin', async (event, pluginId, version = 'latest') => {
    try {
      const installer = getPluginInstaller();
      const result = await installer.updatePlugin(pluginId, version);

      // Record in update history
      const updater = getPluginUpdater();
      if (result && result.fromVersion) {
        updater._recordUpdateHistory(pluginId, result.fromVersion, version, true, null);
      }

      return { success: true, data: result };
    } catch (error) {
      logger.error('[IPC] marketplace:update-plugin error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Enable a disabled plugin.
   * @channel marketplace:enable-plugin
   * @param {string} pluginId - The plugin ID to enable
   * @returns {Object} { success, error? }
   */
  ipcMain.handle('marketplace:enable-plugin', async (event, pluginId) => {
    try {
      const stmt = database.db.prepare(
        'UPDATE installed_plugins SET enabled = 1 WHERE plugin_id = ?'
      );
      stmt.run([pluginId]);
      stmt.free();
      logger.info(`[IPC] marketplace:enable-plugin - Enabled plugin: ${pluginId}`);
      return { success: true };
    } catch (error) {
      logger.error('[IPC] marketplace:enable-plugin error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Disable an installed plugin without uninstalling it.
   * @channel marketplace:disable-plugin
   * @param {string} pluginId - The plugin ID to disable
   * @returns {Object} { success, error? }
   */
  ipcMain.handle('marketplace:disable-plugin', async (event, pluginId) => {
    try {
      const stmt = database.db.prepare(
        'UPDATE installed_plugins SET enabled = 0 WHERE plugin_id = ?'
      );
      stmt.run([pluginId]);
      stmt.free();
      logger.info(`[IPC] marketplace:disable-plugin - Disabled plugin: ${pluginId}`);
      return { success: true };
    } catch (error) {
      logger.error('[IPC] marketplace:disable-plugin error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Check all installed plugins for available updates.
   * @channel marketplace:check-updates
   * @returns {Object} { success, data/error }
   */
  ipcMain.handle('marketplace:check-updates', async (event) => {
    try {
      const updater = getPluginUpdater();
      const result = await updater.checkUpdates();
      return result;
    } catch (error) {
      logger.error('[IPC] marketplace:check-updates error:', error);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Installed - Installed plugin management (3 handlers)
  // ============================================================

  /**
   * List all installed plugins.
   * @channel marketplace:list-installed
   * @param {Object} [options] - { enabledOnly, sort }
   * @returns {Object} { success, data/error }
   */
  ipcMain.handle('marketplace:list-installed', async (event, options = {}) => {
    try {
      let query = 'SELECT * FROM installed_plugins';
      const params = [];

      if (options.enabledOnly) {
        query += ' WHERE enabled = 1';
      }

      query += ' ORDER BY installed_at DESC';

      const stmt = database.db.prepare(query);
      const rows = stmt.all(params);
      stmt.free();

      const plugins = (rows || []).map((row) => ({
        id: row.id,
        pluginId: row.plugin_id,
        name: row.name,
        version: row.version,
        author: row.author,
        installPath: row.install_path,
        installedAt: row.installed_at,
        enabled: row.enabled === 1,
        autoUpdate: row.auto_update === 1,
        source: row.source,
        metadata: row.metadata ? JSON.parse(row.metadata) : null,
      }));

      return { success: true, data: plugins };
    } catch (error) {
      logger.error('[IPC] marketplace:list-installed error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get detailed information about a specific installed plugin.
   * @channel marketplace:get-installed-detail
   * @param {string} pluginId - The plugin ID
   * @returns {Object} { success, data/error }
   */
  ipcMain.handle('marketplace:get-installed-detail', async (event, pluginId) => {
    try {
      const stmt = database.db.prepare(
        'SELECT * FROM installed_plugins WHERE plugin_id = ?'
      );
      const row = stmt.get([pluginId]);
      stmt.free();

      if (!row) {
        return { success: false, error: `Plugin not found: ${pluginId}` };
      }

      // Also fetch update history
      const historyStmt = database.db.prepare(
        'SELECT * FROM plugin_update_history WHERE plugin_id = ? ORDER BY updated_at DESC LIMIT 10'
      );
      const historyRows = historyStmt.all([pluginId]);
      historyStmt.free();

      const plugin = {
        id: row.id,
        pluginId: row.plugin_id,
        name: row.name,
        version: row.version,
        author: row.author,
        installPath: row.install_path,
        installedAt: row.installed_at,
        enabled: row.enabled === 1,
        autoUpdate: row.auto_update === 1,
        source: row.source,
        metadata: row.metadata ? JSON.parse(row.metadata) : null,
        updateHistory: (historyRows || []).map((h) => ({
          id: h.id,
          fromVersion: h.from_version,
          toVersion: h.to_version,
          updatedAt: h.updated_at,
          success: h.success === 1,
          errorMessage: h.error_message,
        })),
      };

      return { success: true, data: plugin };
    } catch (error) {
      logger.error('[IPC] marketplace:get-installed-detail error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Export the list of installed plugins (for backup or sharing).
   * @channel marketplace:export-list
   * @returns {Object} { success, data/error }
   */
  ipcMain.handle('marketplace:export-list', async (event) => {
    try {
      const stmt = database.db.prepare(
        'SELECT plugin_id, name, version, author, source FROM installed_plugins ORDER BY name ASC'
      );
      const rows = stmt.all();
      stmt.free();

      const exportData = {
        exportedAt: new Date().toISOString(),
        pluginCount: (rows || []).length,
        plugins: (rows || []).map((row) => ({
          pluginId: row.plugin_id,
          name: row.name,
          version: row.version,
          author: row.author,
          source: row.source,
        })),
      };

      return { success: true, data: exportData };
    } catch (error) {
      logger.error('[IPC] marketplace:export-list error:', error);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Rating - Plugin ratings and reports (3 handlers)
  // ============================================================

  /**
   * Submit a rating for a plugin.
   * @channel marketplace:rate-plugin
   * @param {string} pluginId - The plugin ID
   * @param {number} rating - Rating value (1-5)
   * @param {string} [comment] - Optional review comment
   * @returns {Object} { success, data/error }
   */
  ipcMain.handle('marketplace:rate-plugin', async (event, pluginId, rating, comment) => {
    try {
      if (!pluginId || !rating) {
        return { success: false, error: 'pluginId and rating are required' };
      }

      if (rating < 1 || rating > 5) {
        return { success: false, error: 'Rating must be between 1 and 5' };
      }

      const client = getMarketplaceClient();
      const result = await client.ratePlugin(pluginId, rating, comment || null);
      return { success: true, data: result };
    } catch (error) {
      logger.error('[IPC] marketplace:rate-plugin error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get ratings and reviews for a plugin.
   * @channel marketplace:get-ratings
   * @param {string} pluginId - The plugin ID
   * @param {number} [page=1] - Page number
   * @param {number} [pageSize=10] - Results per page
   * @returns {Object} { success, data/error }
   */
  ipcMain.handle('marketplace:get-ratings', async (event, pluginId, page = 1, pageSize = 10) => {
    try {
      if (!pluginId) {
        return { success: false, error: 'pluginId is required' };
      }

      const client = getMarketplaceClient();
      const result = await client.getPluginReviews(pluginId, page, pageSize);
      return { success: true, data: result };
    } catch (error) {
      logger.error('[IPC] marketplace:get-ratings error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Report a plugin for policy violations or issues.
   * @channel marketplace:report-plugin
   * @param {string} pluginId - The plugin ID
   * @param {string} reason - Report reason category
   * @param {string} description - Detailed description
   * @returns {Object} { success, data/error }
   */
  ipcMain.handle('marketplace:report-plugin', async (event, pluginId, reason, description) => {
    try {
      if (!pluginId || !reason) {
        return { success: false, error: 'pluginId and reason are required' };
      }

      const client = getMarketplaceClient();
      const result = await client.reportPlugin(pluginId, reason, description || '');
      return { success: true, data: result };
    } catch (error) {
      logger.error('[IPC] marketplace:report-plugin error:', error);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Publish - Developer plugin management (3 handlers)
  // ============================================================

  /**
   * Publish a new plugin to the marketplace.
   * @channel marketplace:publish-plugin
   * @param {Object} pluginData - Plugin manifest data
   * @param {string} pluginFilePath - Path to the plugin package file
   * @returns {Object} { success, data/error }
   */
  ipcMain.handle('marketplace:publish-plugin', async (event, pluginData, pluginFilePath) => {
    try {
      if (!pluginData || !pluginFilePath) {
        return { success: false, error: 'pluginData and pluginFilePath are required' };
      }

      const fs = require('fs');
      if (!fs.existsSync(pluginFilePath)) {
        return { success: false, error: `Plugin file not found: ${pluginFilePath}` };
      }

      const pluginFile = fs.readFileSync(pluginFilePath);
      const client = getMarketplaceClient();
      const result = await client.publishPlugin(pluginData, pluginFile);
      return { success: true, data: result };
    } catch (error) {
      logger.error('[IPC] marketplace:publish-plugin error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Update the metadata of an already published plugin.
   * @channel marketplace:update-metadata
   * @param {string} pluginId - The plugin ID
   * @param {Object} metadata - Updated metadata fields
   * @returns {Object} { success, data/error }
   */
  ipcMain.handle('marketplace:update-metadata', async (event, pluginId, metadata) => {
    try {
      if (!pluginId || !metadata) {
        return { success: false, error: 'pluginId and metadata are required' };
      }

      const client = getMarketplaceClient();
      const result = await client.updatePlugin(pluginId, metadata.version, null, metadata.changelog);
      return { success: true, data: result };
    } catch (error) {
      logger.error('[IPC] marketplace:update-metadata error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Delete / unpublish a plugin from the marketplace.
   * @channel marketplace:delete-plugin
   * @param {string} pluginId - The plugin ID to remove
   * @returns {Object} { success, error? }
   */
  ipcMain.handle('marketplace:delete-plugin', async (event, pluginId) => {
    try {
      if (!pluginId) {
        return { success: false, error: 'pluginId is required' };
      }

      const client = getMarketplaceClient();
      // Use the client to request deletion from the remote marketplace
      const result = await client.deletePlugin(pluginId);
      return { success: true, data: result };
    } catch (error) {
      logger.error('[IPC] marketplace:delete-plugin error:', error);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Config - Marketplace settings (2 handlers)
  // ============================================================

  /**
   * Get marketplace settings (check interval, auto-update toggle, etc.).
   * @channel marketplace:get-settings
   * @returns {Object} { success, data/error }
   */
  ipcMain.handle('marketplace:get-settings', async (event) => {
    try {
      const updater = getPluginUpdater();
      const result = updater.getSettings();
      return result;
    } catch (error) {
      logger.error('[IPC] marketplace:get-settings error:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Update marketplace settings.
   * @channel marketplace:update-settings
   * @param {Object} settings - Settings to update
   * @returns {Object} { success, error? }
   */
  ipcMain.handle('marketplace:update-settings', async (event, settings) => {
    try {
      if (!settings || typeof settings !== 'object') {
        return { success: false, error: 'settings must be an object' };
      }

      const updater = getPluginUpdater();
      const result = updater.updateSettings(settings);
      return result;
    } catch (error) {
      logger.error('[IPC] marketplace:update-settings error:', error);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Event forwarding from PluginUpdater to renderer
  // ============================================================

  const updater = getPluginUpdater();

  updater.on('update-available', (updateInfo) => {
    try {
      const { BrowserWindow } = require('electron');
      const windows = BrowserWindow.getAllWindows();
      if (windows.length > 0) {
        windows[0].webContents.send('marketplace:update-available', updateInfo);
      }
    } catch (err) {
      logger.warn('[IPC] Failed to forward update-available event:', err.message);
    }
  });

  updater.on('update-completed', (info) => {
    try {
      const { BrowserWindow } = require('electron');
      const windows = BrowserWindow.getAllWindows();
      if (windows.length > 0) {
        windows[0].webContents.send('marketplace:update-completed', info);
      }
    } catch (err) {
      logger.warn('[IPC] Failed to forward update-completed event:', err.message);
    }
  });

  updater.on('update-failed', (info) => {
    try {
      const { BrowserWindow } = require('electron');
      const windows = BrowserWindow.getAllWindows();
      if (windows.length > 0) {
        windows[0].webContents.send('marketplace:update-failed', info);
      }
    } catch (err) {
      logger.warn('[IPC] Failed to forward update-failed event:', err.message);
    }
  });

  logger.info('[IPC Registry] Marketplace IPC registered (22 handlers)');

  // Return cleanup function
  return () => {
    if (pluginUpdater) {
      pluginUpdater.destroy();
    }
    marketplaceClient = null;
    pluginInstaller = null;
    pluginUpdater = null;
  };
}

module.exports = { registerMarketplaceIPC };

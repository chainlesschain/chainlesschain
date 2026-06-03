/**
 * PluginInstaller - Marketplace Plugin Installer
 *
 * Handles downloading, verifying, extracting, and registering plugins
 * from the marketplace. Manages the full plugin lifecycle including
 * install, uninstall, update, enable/disable, and query operations.
 *
 * Tables used:
 * - installed_plugins (id, plugin_id, name, version, author, install_path,
 *   installed_at, enabled, auto_update, source, metadata)
 * - plugin_update_history (id, plugin_id, from_version, to_version,
 *   updated_at, success, error_message)
 */

const { logger } = require("../utils/logger.js");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const fs = require("fs").promises;
const crypto = require("crypto");

// Optional dependency for zip extraction
let AdmZip;
try {
  AdmZip = require("adm-zip");
} catch (e) {
  logger.warn(
    "[PluginInstaller] adm-zip not available, will use fallback extraction",
  );
}

/**
 * Plugin installation states
 */
const InstallState = {
  PENDING: "pending",
  DOWNLOADING: "downloading",
  VERIFYING: "verifying",
  EXTRACTING: "extracting",
  REGISTERING: "registering",
  COMPLETED: "completed",
  FAILED: "failed",
};

/**
 * Plugin source types
 */
const PluginSource = {
  MARKETPLACE: "marketplace",
  LOCAL: "local",
  URL: "url",
  GIT: "git",
};

class PluginInstaller {
  /**
   * Create a PluginInstaller instance
   * @param {Object} options - Configuration options
   * @param {Object} options.database - Database instance with run/get/all methods
   * @param {Object} options.marketplaceClient - Marketplace API client
   * @param {string} [options.pluginsDir] - Plugin installation directory
   */
  constructor({ database, marketplaceClient, pluginsDir } = {}) {
    if (!database) {
      throw new Error("[PluginInstaller] database is required");
    }
    if (!marketplaceClient) {
      throw new Error("[PluginInstaller] marketplaceClient is required");
    }

    this.db = database;
    this.marketplaceClient = marketplaceClient;

    // Default pluginsDir to .chainlesschain/plugins/ under Electron userData
    if (pluginsDir) {
      this.pluginsDir = pluginsDir;
    } else {
      try {
        const { app } = require("electron");
        this.pluginsDir = path.join(
          app.getPath("userData"),
          ".chainlesschain",
          "plugins",
        );
      } catch (e) {
        // Fallback for non-Electron environments (testing, etc.)
        this.pluginsDir = path.join(
          process.cwd(),
          ".chainlesschain",
          "plugins",
        );
      }
    }

    // Active installations tracker
    this.activeInstalls = new Map();

    // Temp directory for downloads
    this.tempDir = path.join(this.pluginsDir, ".tmp");

    this.initialized = false;

    logger.info(
      `[PluginInstaller] Created with pluginsDir: ${this.pluginsDir}`,
    );
  }

  /**
   * Initialize the installer - ensure directories and database tables exist
   * @returns {Promise<{success: boolean}>}
   */
  async initialize() {
    try {
      // Ensure directories exist
      await fs.mkdir(this.pluginsDir, { recursive: true });
      await fs.mkdir(this.tempDir, { recursive: true });

      // Create database tables
      await this._ensureTables();

      this.initialized = true;
      logger.info("[PluginInstaller] Initialized successfully");

      return { success: true };
    } catch (error) {
      logger.error("[PluginInstaller] Initialization failed:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Ensure required database tables exist
   * @private
   */
  async _ensureTables() {
    const createInstalledPlugins = `
      CREATE TABLE IF NOT EXISTS installed_plugins (
        id TEXT PRIMARY KEY,
        plugin_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        version TEXT NOT NULL,
        author TEXT DEFAULT '',
        install_path TEXT NOT NULL,
        installed_at INTEGER NOT NULL,
        enabled INTEGER DEFAULT 1,
        auto_update INTEGER DEFAULT 0,
        source TEXT DEFAULT 'marketplace',
        metadata TEXT DEFAULT '{}'
      )
    `;

    const createUpdateHistory = `
      CREATE TABLE IF NOT EXISTS plugin_update_history (
        id TEXT PRIMARY KEY,
        plugin_id TEXT NOT NULL,
        from_version TEXT NOT NULL,
        to_version TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        success INTEGER DEFAULT 0,
        error_message TEXT DEFAULT NULL
      )
    `;

    const createIndexPluginId = `
      CREATE INDEX IF NOT EXISTS idx_installed_plugins_plugin_id
      ON installed_plugins(plugin_id)
    `;

    const createIndexUpdateHistory = `
      CREATE INDEX IF NOT EXISTS idx_plugin_update_history_plugin_id
      ON plugin_update_history(plugin_id)
    `;

    await this.db.run(createInstalledPlugins);
    await this.db.run(createUpdateHistory);
    await this.db.run(createIndexPluginId);
    await this.db.run(createIndexUpdateHistory);

    logger.info("[PluginInstaller] Database tables ensured");
  }

  // ---------------------------------------------------------------------------
  // Core Installation Methods
  // ---------------------------------------------------------------------------

  /**
   * Install a plugin from the marketplace
   *
   * Full installation flow:
   * 1. Get download URL from marketplaceClient
   * 2. Download the zip file
   * 3. Verify file hash (SHA256)
   * 4. Create plugin directory
   * 5. Extract zip to plugin directory
   * 6. Read and validate plugin manifest (plugin.json)
   * 7. Register in installed_plugins database table
   *
   * @param {string} pluginId - The plugin identifier
   * @param {string} [version='latest'] - The version to install
   * @returns {Promise<{success: boolean, data?: Object, error?: string}>}
   */
  async installPlugin(pluginId, version = "latest") {
    const installId = uuidv4();

    logger.info(
      `[PluginInstaller] Starting installation: ${pluginId}@${version} (installId: ${installId})`,
    );

    // Check if already installing
    if (this.activeInstalls.has(pluginId)) {
      return {
        success: false,
        error: `Plugin ${pluginId} is already being installed`,
      };
    }

    // Check if already installed
    const existing = await this.getInstalledDetail(pluginId);
    if (existing.success && existing.data) {
      return {
        success: false,
        error: `Plugin ${pluginId} is already installed (version: ${existing.data.version}). Use updatePlugin() to update.`,
      };
    }

    // Track active installation
    this.activeInstalls.set(pluginId, {
      installId,
      state: InstallState.PENDING,
      startedAt: Date.now(),
    });

    let downloadPath = null;
    const pluginDir = this.getPluginDir(pluginId);

    try {
      // Step 1: Get plugin info and download URL from marketplace
      this._updateInstallState(pluginId, InstallState.DOWNLOADING);
      logger.info(
        `[PluginInstaller] Fetching plugin info for ${pluginId}@${version}`,
      );

      const pluginInfo = await this.marketplaceClient.getPlugin(pluginId);
      if (!pluginInfo) {
        throw new Error(`Plugin ${pluginId} not found in marketplace`);
      }

      const targetVersion =
        version === "latest"
          ? pluginInfo.latestVersion || pluginInfo.version
          : version;
      const expectedHash = pluginInfo.hash || pluginInfo.sha256 || null;

      // Step 2: Download the zip file
      logger.info(
        `[PluginInstaller] Downloading ${pluginId}@${targetVersion}...`,
      );

      downloadPath = path.join(
        this.tempDir,
        `${pluginId}-${targetVersion}.zip`,
      );
      await this._downloadPlugin(pluginId, targetVersion, downloadPath);

      // Step 3: Verify file hash (SHA256)
      this._updateInstallState(pluginId, InstallState.VERIFYING);

      if (expectedHash) {
        logger.info(`[PluginInstaller] Verifying hash for ${pluginId}...`);
        const hashResult = await this.verifyPluginHash(
          downloadPath,
          expectedHash,
        );
        if (!hashResult.success) {
          throw new Error(
            `Hash verification failed: expected ${expectedHash}, got ${hashResult.data?.actualHash}`,
          );
        }
        logger.info(`[PluginInstaller] Hash verified for ${pluginId}`);
      } else {
        logger.warn(
          `[PluginInstaller] No hash provided for ${pluginId}, skipping verification`,
        );
      }

      // Step 4: Create plugin directory
      this._updateInstallState(pluginId, InstallState.EXTRACTING);
      await fs.mkdir(pluginDir, { recursive: true });

      // Step 5: Extract zip to plugin directory
      logger.info(
        `[PluginInstaller] Extracting ${pluginId} to ${pluginDir}...`,
      );
      const extractResult = await this.extractPlugin(downloadPath, pluginDir);
      if (!extractResult.success) {
        throw new Error(`Extraction failed: ${extractResult.error}`);
      }

      // Step 6: Read and validate plugin manifest
      logger.info(`[PluginInstaller] Reading manifest for ${pluginId}...`);
      const manifestResult = await this.readManifest(pluginDir);
      if (!manifestResult.success) {
        throw new Error(`Invalid manifest: ${manifestResult.error}`);
      }

      const manifest = manifestResult.data;

      // Step 7: Register in database
      this._updateInstallState(pluginId, InstallState.REGISTERING);
      logger.info(`[PluginInstaller] Registering ${pluginId} in database...`);

      const now = Date.now();
      const recordId = uuidv4();

      await this.db.run(
        `INSERT INTO installed_plugins
         (id, plugin_id, name, version, author, install_path, installed_at, enabled, auto_update, source, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          recordId,
          pluginId,
          manifest.name || pluginId,
          targetVersion,
          manifest.author || pluginInfo.author || "",
          pluginDir,
          now,
          1,
          pluginInfo.autoUpdate ? 1 : 0,
          PluginSource.MARKETPLACE,
          JSON.stringify({
            description: manifest.description || "",
            homepage: manifest.homepage || "",
            license: manifest.license || "",
            categories: manifest.categories || [],
            dependencies: manifest.dependencies || {},
            installId,
          }),
        ],
      );

      // v1.1.0: Hot-load skill if plugin contains SKILL.md
      try {
        const skillMdPath = path.join(pluginDir, "SKILL.md");
        const hasSkillMd = await fs
          .access(skillMdPath)
          .then(() => true)
          .catch(() => false);

        if (hasSkillMd) {
          logger.info(
            `[PluginInstaller] Found SKILL.md in ${pluginId}, hot-loading skill...`,
          );
          const {
            getSkillRegistry,
          } = require("../ai-engine/cowork/skills/skill-registry");
          const {
            SkillLoader,
          } = require("../ai-engine/cowork/skills/skill-loader");

          const registry = getSkillRegistry?.();
          if (registry && registry._loader) {
            const definition = await registry._loader.loadSingleSkill?.(
              pluginDir,
              "marketplace",
            );
            if (definition) {
              registry.hotLoadSkill(definition.name, definition);
              logger.info(
                `[PluginInstaller] Skill hot-loaded: ${definition.name}`,
              );
            }
          }
        }
      } catch (skillError) {
        logger.warn(
          `[PluginInstaller] Skill hot-load failed (non-fatal): ${skillError.message}`,
        );
      }

      // Cleanup: remove downloaded zip
      await this._safeDelete(downloadPath);

      this._updateInstallState(pluginId, InstallState.COMPLETED);
      this.activeInstalls.delete(pluginId);

      const result = {
        pluginId,
        version: targetVersion,
        installPath: pluginDir,
        name: manifest.name || pluginId,
        author: manifest.author || "",
        installedAt: now,
      };

      logger.info(
        `[PluginInstaller] Successfully installed ${pluginId}@${targetVersion}`,
      );

      return { success: true, data: result };
    } catch (error) {
      logger.error(
        `[PluginInstaller] Installation failed for ${pluginId}:`,
        error,
      );

      // Cleanup on failure
      this._updateInstallState(pluginId, InstallState.FAILED);
      this.activeInstalls.delete(pluginId);

      await this._safeDelete(downloadPath);
      await this._safeDeleteDir(pluginDir);

      return { success: false, error: error.message };
    }
  }

  /**
   * Uninstall a plugin
   *
   * Removes the plugin directory and database record.
   *
   * @param {string} pluginId - The plugin identifier
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async uninstallPlugin(pluginId) {
    logger.info(`[PluginInstaller] Uninstalling plugin: ${pluginId}`);

    try {
      // Check if plugin is installed
      const installed = await this.getInstalledDetail(pluginId);
      if (!installed.success || !installed.data) {
        return {
          success: false,
          error: `Plugin ${pluginId} is not installed`,
        };
      }

      const pluginDir =
        installed.data.install_path || this.getPluginDir(pluginId);

      // Step 1: Delete plugin directory recursively
      logger.info(`[PluginInstaller] Removing plugin directory: ${pluginDir}`);
      await this._safeDeleteDir(pluginDir);

      // Step 2: Remove from database
      await this.db.run("DELETE FROM installed_plugins WHERE plugin_id = ?", [
        pluginId,
      ]);

      logger.info(`[PluginInstaller] Successfully uninstalled ${pluginId}`);

      return { success: true };
    } catch (error) {
      logger.error(
        `[PluginInstaller] Uninstall failed for ${pluginId}:`,
        error,
      );
      return { success: false, error: error.message };
    }
  }

  /**
   * Update a plugin to a new version
   *
   * Flow:
   * 1. Backup current version
   * 2. Install new version
   * 3. Record in plugin_update_history table
   * 4. If install fails, restore backup
   *
   * @param {string} pluginId - The plugin identifier
   * @param {string} newVersion - The new version to install
   * @returns {Promise<{success: boolean, data?: Object, error?: string}>}
   */
  async updatePlugin(pluginId, newVersion) {
    logger.info(
      `[PluginInstaller] Updating plugin: ${pluginId} to ${newVersion}`,
    );

    let backupDir = null;
    let fromVersion = null;

    try {
      // Check if plugin is installed
      const installed = await this.getInstalledDetail(pluginId);
      if (!installed.success || !installed.data) {
        return {
          success: false,
          error: `Plugin ${pluginId} is not installed`,
        };
      }

      fromVersion = installed.data.version;
      const pluginDir =
        installed.data.install_path || this.getPluginDir(pluginId);

      // Check if versions are the same
      if (fromVersion === newVersion) {
        return {
          success: false,
          error: `Plugin ${pluginId} is already at version ${newVersion}`,
        };
      }

      // Step 1: Backup current version
      backupDir = path.join(
        this.tempDir,
        `${pluginId}-backup-${fromVersion}-${Date.now()}`,
      );
      logger.info(
        `[PluginInstaller] Backing up ${pluginId}@${fromVersion} to ${backupDir}`,
      );
      await this._copyDir(pluginDir, backupDir);

      // Step 2: Remove current version files (keep database record)
      await this._safeDeleteDir(pluginDir);

      // Step 3: Download and extract new version
      const downloadPath = path.join(
        this.tempDir,
        `${pluginId}-${newVersion}.zip`,
      );

      // Download new version
      logger.info(`[PluginInstaller] Downloading ${pluginId}@${newVersion}...`);
      await this._downloadPlugin(pluginId, newVersion, downloadPath);

      // Get plugin info for hash verification
      const pluginInfo = await this.marketplaceClient.getPlugin(pluginId);
      const expectedHash = pluginInfo?.hash || pluginInfo?.sha256 || null;

      // Verify hash if available
      if (expectedHash) {
        const hashResult = await this.verifyPluginHash(
          downloadPath,
          expectedHash,
        );
        if (!hashResult.success) {
          throw new Error(
            `Hash verification failed for update: expected ${expectedHash}, got ${hashResult.data?.actualHash}`,
          );
        }
      }

      // Extract new version
      await fs.mkdir(pluginDir, { recursive: true });
      const extractResult = await this.extractPlugin(downloadPath, pluginDir);
      if (!extractResult.success) {
        throw new Error(
          `Extraction failed during update: ${extractResult.error}`,
        );
      }

      // Read new manifest
      const manifestResult = await this.readManifest(pluginDir);
      if (!manifestResult.success) {
        throw new Error(
          `Invalid manifest in new version: ${manifestResult.error}`,
        );
      }

      const manifest = manifestResult.data;

      // Step 4: Update database record
      const now = Date.now();
      await this.db.run(
        `UPDATE installed_plugins
         SET version = ?, name = ?, author = ?, metadata = ?, install_path = ?
         WHERE plugin_id = ?`,
        [
          newVersion,
          manifest.name || pluginId,
          manifest.author || installed.data.author || "",
          JSON.stringify({
            ...(installed.data.metadata
              ? JSON.parse(installed.data.metadata)
              : {}),
            description: manifest.description || "",
            lastUpdated: now,
            previousVersion: fromVersion,
          }),
          pluginDir,
          pluginId,
        ],
      );

      // Step 5: Record in update history
      await this.db.run(
        `INSERT INTO plugin_update_history
         (id, plugin_id, from_version, to_version, updated_at, success, error_message)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [uuidv4(), pluginId, fromVersion, newVersion, now, 1, null],
      );

      // Cleanup
      await this._safeDelete(downloadPath);
      await this._safeDeleteDir(backupDir);

      logger.info(
        `[PluginInstaller] Successfully updated ${pluginId} from ${fromVersion} to ${newVersion}`,
      );

      return {
        success: true,
        data: {
          pluginId,
          fromVersion,
          toVersion: newVersion,
          installPath: pluginDir,
        },
      };
    } catch (error) {
      logger.error(`[PluginInstaller] Update failed for ${pluginId}:`, error);

      // Restore from backup if available
      if (backupDir) {
        try {
          const pluginDir = this.getPluginDir(pluginId);
          logger.info(
            `[PluginInstaller] Restoring backup for ${pluginId} from ${backupDir}`,
          );
          await this._safeDeleteDir(pluginDir);
          await this._copyDir(backupDir, pluginDir);
          await this._safeDeleteDir(backupDir);
          logger.info(`[PluginInstaller] Backup restored for ${pluginId}`);
        } catch (restoreError) {
          logger.error(
            `[PluginInstaller] Backup restore failed for ${pluginId}:`,
            restoreError,
          );
        }
      }

      // Record failed update in history
      try {
        await this.db.run(
          `INSERT INTO plugin_update_history
           (id, plugin_id, from_version, to_version, updated_at, success, error_message)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            uuidv4(),
            pluginId,
            fromVersion || "unknown",
            newVersion,
            Date.now(),
            0,
            error.message,
          ],
        );
      } catch (historyError) {
        logger.error(
          "[PluginInstaller] Failed to record update history:",
          historyError,
        );
      }

      return { success: false, error: error.message };
    }
  }

  // ---------------------------------------------------------------------------
  // Enable / Disable
  // ---------------------------------------------------------------------------

  /**
   * Enable an installed plugin
   * @param {string} pluginId - The plugin identifier
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async enablePlugin(pluginId) {
    logger.info(`[PluginInstaller] Enabling plugin: ${pluginId}`);

    try {
      const installed = await this.getInstalledDetail(pluginId);
      if (!installed.success || !installed.data) {
        return {
          success: false,
          error: `Plugin ${pluginId} is not installed`,
        };
      }

      if (installed.data.enabled === 1) {
        return {
          success: false,
          error: `Plugin ${pluginId} is already enabled`,
        };
      }

      await this.db.run(
        "UPDATE installed_plugins SET enabled = 1 WHERE plugin_id = ?",
        [pluginId],
      );

      logger.info(`[PluginInstaller] Plugin ${pluginId} enabled`);

      return { success: true };
    } catch (error) {
      logger.error(`[PluginInstaller] Enable failed for ${pluginId}:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Disable an installed plugin
   * @param {string} pluginId - The plugin identifier
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async disablePlugin(pluginId) {
    logger.info(`[PluginInstaller] Disabling plugin: ${pluginId}`);

    try {
      const installed = await this.getInstalledDetail(pluginId);
      if (!installed.success || !installed.data) {
        return {
          success: false,
          error: `Plugin ${pluginId} is not installed`,
        };
      }

      if (installed.data.enabled === 0) {
        return {
          success: false,
          error: `Plugin ${pluginId} is already disabled`,
        };
      }

      await this.db.run(
        "UPDATE installed_plugins SET enabled = 0 WHERE plugin_id = ?",
        [pluginId],
      );

      logger.info(`[PluginInstaller] Plugin ${pluginId} disabled`);

      return { success: true };
    } catch (error) {
      logger.error(`[PluginInstaller] Disable failed for ${pluginId}:`, error);
      return { success: false, error: error.message };
    }
  }

  // ---------------------------------------------------------------------------
  // Query Methods
  // ---------------------------------------------------------------------------

  /**
   * List installed plugins with optional filters
   * @param {Object} [filters={}] - Query filters
   * @param {boolean} [filters.enabled] - Filter by enabled status
   * @param {string} [filters.source] - Filter by source type
   * @param {string} [filters.search] - Search by name or plugin_id
   * @param {string} [filters.author] - Filter by author
   * @param {string} [filters.sortBy='installed_at'] - Sort field
   * @param {string} [filters.sortOrder='DESC'] - Sort order (ASC/DESC)
   * @param {number} [filters.limit] - Max results
   * @param {number} [filters.offset] - Result offset
   * @returns {Promise<{success: boolean, data?: Array, error?: string}>}
   */
  async listInstalled(filters = {}) {
    try {
      let sql = "SELECT * FROM installed_plugins WHERE 1=1";
      const params = [];

      // Apply filters
      if (filters.enabled !== undefined) {
        sql += " AND enabled = ?";
        params.push(filters.enabled ? 1 : 0);
      }

      if (filters.source) {
        sql += " AND source = ?";
        params.push(filters.source);
      }

      if (filters.search) {
        sql += " AND (name LIKE ? OR plugin_id LIKE ?)";
        const searchTerm = `%${filters.search}%`;
        params.push(searchTerm, searchTerm);
      }

      if (filters.author) {
        sql += " AND author = ?";
        params.push(filters.author);
      }

      // Sort
      const allowedSortFields = [
        "installed_at",
        "name",
        "plugin_id",
        "version",
        "author",
      ];
      const sortBy = allowedSortFields.includes(filters.sortBy)
        ? filters.sortBy
        : "installed_at";
      const sortOrder =
        filters.sortOrder && filters.sortOrder.toUpperCase() === "ASC"
          ? "ASC"
          : "DESC";
      sql += ` ORDER BY ${sortBy} ${sortOrder}`;

      // Pagination
      if (filters.limit) {
        sql += " LIMIT ?";
        params.push(filters.limit);

        if (filters.offset) {
          sql += " OFFSET ?";
          params.push(filters.offset);
        }
      }

      const rows = await this.db.all(sql, params);

      // Parse metadata JSON for each row
      const plugins = (rows || []).map((row) => this._parsePluginRow(row));

      logger.info(
        `[PluginInstaller] Listed ${plugins.length} installed plugins`,
      );

      return { success: true, data: plugins };
    } catch (error) {
      logger.error("[PluginInstaller] List installed failed:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get details for a single installed plugin
   * @param {string} pluginId - The plugin identifier
   * @returns {Promise<{success: boolean, data?: Object, error?: string}>}
   */
  async getInstalledDetail(pluginId) {
    try {
      const row = await this.db.get(
        "SELECT * FROM installed_plugins WHERE plugin_id = ?",
        [pluginId],
      );

      if (!row) {
        return { success: true, data: null };
      }

      const plugin = this._parsePluginRow(row);

      // Also load update history
      const history = await this.db.all(
        `SELECT * FROM plugin_update_history
         WHERE plugin_id = ?
         ORDER BY updated_at DESC
         LIMIT 10`,
        [pluginId],
      );

      plugin.updateHistory = history || [];

      return { success: true, data: plugin };
    } catch (error) {
      logger.error(
        `[PluginInstaller] Get detail failed for ${pluginId}:`,
        error,
      );
      return { success: false, error: error.message };
    }
  }

  /**
   * Export the list of installed plugins as JSON
   * @returns {Promise<{success: boolean, data?: Object, error?: string}>}
   */
  async exportInstalledList() {
    try {
      const listResult = await this.listInstalled();
      if (!listResult.success) {
        return listResult;
      }

      const exportData = {
        exportedAt: new Date().toISOString(),
        version: "1.0",
        pluginCount: listResult.data.length,
        plugins: listResult.data.map((plugin) => ({
          pluginId: plugin.plugin_id,
          name: plugin.name,
          version: plugin.version,
          author: plugin.author,
          enabled: plugin.enabled === 1,
          autoUpdate: plugin.auto_update === 1,
          source: plugin.source,
          installedAt: plugin.installed_at,
        })),
      };

      logger.info(
        `[PluginInstaller] Exported ${exportData.pluginCount} installed plugins`,
      );

      return { success: true, data: exportData };
    } catch (error) {
      logger.error("[PluginInstaller] Export failed:", error);
      return { success: false, error: error.message };
    }
  }

  // ---------------------------------------------------------------------------
  // Verification and Extraction
  // ---------------------------------------------------------------------------

  /**
   * Verify a plugin file's SHA256 hash
   * @param {string} filePath - Path to the file to verify
   * @param {string} expectedHash - Expected SHA256 hash (hex string)
   * @returns {Promise<{success: boolean, data?: Object, error?: string}>}
   */
  async verifyPluginHash(filePath, expectedHash) {
    try {
      if (!filePath) {
        return { success: false, error: "filePath is required" };
      }
      if (!expectedHash) {
        return { success: false, error: "expectedHash is required" };
      }

      const fileBuffer = await fs.readFile(filePath);
      const hash = crypto.createHash("sha256");
      hash.update(fileBuffer);
      const actualHash = hash.digest("hex");

      const normalizedExpected = expectedHash.toLowerCase().trim();
      const normalizedActual = actualHash.toLowerCase();

      if (normalizedActual === normalizedExpected) {
        logger.info(`[PluginInstaller] Hash verified: ${normalizedActual}`);
        return {
          success: true,
          data: {
            actualHash: normalizedActual,
            expectedHash: normalizedExpected,
          },
        };
      } else {
        logger.warn(
          `[PluginInstaller] Hash mismatch: expected=${normalizedExpected}, actual=${normalizedActual}`,
        );
        return {
          success: false,
          data: {
            actualHash: normalizedActual,
            expectedHash: normalizedExpected,
          },
          error: `Hash mismatch: expected ${normalizedExpected}, got ${normalizedActual}`,
        };
      }
    } catch (error) {
      logger.error("[PluginInstaller] Hash verification error:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Extract a zip file to a destination directory
   * @param {string} zipPath - Path to the zip file
   * @param {string} destDir - Destination directory
   * @returns {Promise<{success: boolean, data?: Object, error?: string}>}
   */
  async extractPlugin(zipPath, destDir) {
    try {
      if (!zipPath) {
        return { success: false, error: "zipPath is required" };
      }
      if (!destDir) {
        return { success: false, error: "destDir is required" };
      }

      // Ensure destination directory exists
      await fs.mkdir(destDir, { recursive: true });

      if (AdmZip) {
        // Use adm-zip for extraction
        return await this._extractWithAdmZip(zipPath, destDir);
      } else {
        // Fallback: try extract-zip
        return await this._extractWithExtractZip(zipPath, destDir);
      }
    } catch (error) {
      logger.error("[PluginInstaller] Extraction error:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Extract using adm-zip library
   * @private
   * @param {string} zipPath - Path to the zip file
   * @param {string} destDir - Destination directory
   * @returns {Promise<{success: boolean, data?: Object, error?: string}>}
   */
  async _extractWithAdmZip(zipPath, destDir) {
    try {
      const zip = new AdmZip(zipPath);
      const entries = zip.getEntries();

      // Security: validate entries to prevent zip slip attack
      for (const entry of entries) {
        const entryPath = path.join(destDir, entry.entryName);
        const resolvedPath = path.resolve(entryPath);
        const resolvedDest = path.resolve(destDir);

        if (!resolvedPath.startsWith(resolvedDest)) {
          throw new Error(
            `Zip slip detected: entry "${entry.entryName}" would extract outside target directory`,
          );
        }
      }

      zip.extractAllTo(destDir, true);

      logger.info(
        `[PluginInstaller] Extracted ${entries.length} entries to ${destDir}`,
      );

      return {
        success: true,
        data: {
          entryCount: entries.length,
          destDir,
          method: "adm-zip",
        },
      };
    } catch (error) {
      logger.error("[PluginInstaller] adm-zip extraction error:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Extract using extract-zip library (fallback)
   * @private
   * @param {string} zipPath - Path to the zip file
   * @param {string} destDir - Destination directory
   * @returns {Promise<{success: boolean, data?: Object, error?: string}>}
   */
  async _extractWithExtractZip(zipPath, destDir) {
    try {
      let extractZip;
      try {
        extractZip = require("extract-zip");
      } catch (e) {
        return {
          success: false,
          error:
            "No zip extraction library available. Install adm-zip or extract-zip.",
        };
      }

      await extractZip(zipPath, { dir: path.resolve(destDir) });

      logger.info(
        `[PluginInstaller] Extracted to ${destDir} using extract-zip`,
      );

      return {
        success: true,
        data: {
          destDir,
          method: "extract-zip",
        },
      };
    } catch (error) {
      logger.error("[PluginInstaller] extract-zip extraction error:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Read and validate a plugin manifest (plugin.json) from a plugin directory
   * @param {string} pluginDir - The plugin directory
   * @returns {Promise<{success: boolean, data?: Object, error?: string}>}
   */
  async readManifest(pluginDir) {
    try {
      if (!pluginDir) {
        return { success: false, error: "pluginDir is required" };
      }

      // Look for plugin.json - could be at root or inside a subdirectory
      let manifestPath = path.join(pluginDir, "plugin.json");

      try {
        await fs.access(manifestPath);
      } catch (e) {
        // Try to find plugin.json in first subdirectory (common with zip extraction)
        const entries = await fs.readdir(pluginDir, { withFileTypes: true });
        const subdirs = entries.filter((entry) => entry.isDirectory());

        let found = false;
        for (const subdir of subdirs) {
          const subManifestPath = path.join(
            pluginDir,
            subdir.name,
            "plugin.json",
          );
          try {
            await fs.access(subManifestPath);
            manifestPath = subManifestPath;
            found = true;
            break;
          } catch (e2) {
            // Continue searching
          }
        }

        if (!found) {
          return {
            success: false,
            error: `No plugin.json found in ${pluginDir}`,
          };
        }
      }

      // Read and parse manifest
      const manifestContent = await fs.readFile(manifestPath, "utf-8");
      let manifest;

      try {
        manifest = JSON.parse(manifestContent);
      } catch (parseError) {
        return {
          success: false,
          error: `Invalid JSON in plugin.json: ${parseError.message}`,
        };
      }

      // Validate required fields
      const validationErrors = this._validateManifest(manifest);
      if (validationErrors.length > 0) {
        return {
          success: false,
          error: `Manifest validation failed: ${validationErrors.join(", ")}`,
        };
      }

      logger.info(
        `[PluginInstaller] Manifest loaded: ${manifest.name}@${manifest.version}`,
      );

      return { success: true, data: manifest };
    } catch (error) {
      logger.error("[PluginInstaller] Read manifest error:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get the plugin installation directory for a given pluginId
   * @param {string} pluginId - The plugin identifier
   * @returns {string} Full path to the plugin directory
   */
  getPluginDir(pluginId) {
    // Sanitize pluginId to prevent directory traversal
    const sanitized = pluginId.replace(/[^a-zA-Z0-9._-]/g, "_");
    return path.join(this.pluginsDir, sanitized);
  }

  // ---------------------------------------------------------------------------
  // Auto-Update Support
  // ---------------------------------------------------------------------------

  /**
   * Set auto-update preference for a plugin
   * @param {string} pluginId - The plugin identifier
   * @param {boolean} enabled - Whether auto-update should be enabled
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async setAutoUpdate(pluginId, enabled) {
    try {
      const installed = await this.getInstalledDetail(pluginId);
      if (!installed.success || !installed.data) {
        return {
          success: false,
          error: `Plugin ${pluginId} is not installed`,
        };
      }

      await this.db.run(
        "UPDATE installed_plugins SET auto_update = ? WHERE plugin_id = ?",
        [enabled ? 1 : 0, pluginId],
      );

      logger.info(
        `[PluginInstaller] Auto-update ${enabled ? "enabled" : "disabled"} for ${pluginId}`,
      );

      return { success: true };
    } catch (error) {
      logger.error(
        `[PluginInstaller] Set auto-update failed for ${pluginId}:`,
        error,
      );
      return { success: false, error: error.message };
    }
  }

  /**
   * Get plugins that have auto-update enabled
   * @returns {Promise<{success: boolean, data?: Array, error?: string}>}
   */
  async getAutoUpdatePlugins() {
    try {
      const rows = await this.db.all(
        "SELECT * FROM installed_plugins WHERE auto_update = 1 AND enabled = 1",
      );

      const plugins = (rows || []).map((row) => this._parsePluginRow(row));

      return { success: true, data: plugins };
    } catch (error) {
      logger.error("[PluginInstaller] Get auto-update plugins failed:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get update history for a plugin
   * @param {string} pluginId - The plugin identifier
   * @param {number} [limit=20] - Maximum number of history records
   * @returns {Promise<{success: boolean, data?: Array, error?: string}>}
   */
  async getUpdateHistory(pluginId, limit = 20) {
    try {
      const rows = await this.db.all(
        `SELECT * FROM plugin_update_history
         WHERE plugin_id = ?
         ORDER BY updated_at DESC
         LIMIT ?`,
        [pluginId, limit],
      );

      return { success: true, data: rows || [] };
    } catch (error) {
      logger.error(
        `[PluginInstaller] Get update history failed for ${pluginId}:`,
        error,
      );
      return { success: false, error: error.message };
    }
  }

  // ---------------------------------------------------------------------------
  // Installation Status
  // ---------------------------------------------------------------------------

  /**
   * Get the current installation status for a plugin
   * @param {string} pluginId - The plugin identifier
   * @returns {{active: boolean, state?: string, startedAt?: number}}
   */
  getInstallStatus(pluginId) {
    if (this.activeInstalls.has(pluginId)) {
      const install = this.activeInstalls.get(pluginId);
      return {
        active: true,
        state: install.state,
        startedAt: install.startedAt,
        installId: install.installId,
      };
    }
    return { active: false };
  }

  /**
   * Get all active installations
   * @returns {Array<Object>} List of active installation states
   */
  getActiveInstallations() {
    const active = [];
    for (const [pluginId, install] of this.activeInstalls) {
      active.push({
        pluginId,
        state: install.state,
        startedAt: install.startedAt,
        installId: install.installId,
      });
    }
    return active;
  }

  // ---------------------------------------------------------------------------
  // Batch Operations
  // ---------------------------------------------------------------------------

  /**
   * Install multiple plugins
   * @param {Array<{pluginId: string, version?: string}>} plugins - Plugins to install
   * @returns {Promise<{success: boolean, data?: Object, error?: string}>}
   */
  async batchInstall(plugins) {
    if (!Array.isArray(plugins) || plugins.length === 0) {
      return {
        success: false,
        error: "plugins array is required and must not be empty",
      };
    }

    logger.info(`[PluginInstaller] Batch installing ${plugins.length} plugins`);

    const results = {
      total: plugins.length,
      succeeded: 0,
      failed: 0,
      details: [],
    };

    for (const plugin of plugins) {
      const result = await this.installPlugin(
        plugin.pluginId,
        plugin.version || "latest",
      );

      results.details.push({
        pluginId: plugin.pluginId,
        version: plugin.version || "latest",
        ...result,
      });

      if (result.success) {
        results.succeeded++;
      } else {
        results.failed++;
      }
    }

    logger.info(
      `[PluginInstaller] Batch install complete: ${results.succeeded} succeeded, ${results.failed} failed`,
    );

    return {
      success: results.failed === 0,
      data: results,
    };
  }

  /**
   * Uninstall multiple plugins
   * @param {Array<string>} pluginIds - Plugin identifiers to uninstall
   * @returns {Promise<{success: boolean, data?: Object, error?: string}>}
   */
  async batchUninstall(pluginIds) {
    if (!Array.isArray(pluginIds) || pluginIds.length === 0) {
      return {
        success: false,
        error: "pluginIds array is required and must not be empty",
      };
    }

    logger.info(
      `[PluginInstaller] Batch uninstalling ${pluginIds.length} plugins`,
    );

    const results = {
      total: pluginIds.length,
      succeeded: 0,
      failed: 0,
      details: [],
    };

    for (const pluginId of pluginIds) {
      const result = await this.uninstallPlugin(pluginId);

      results.details.push({
        pluginId,
        ...result,
      });

      if (result.success) {
        results.succeeded++;
      } else {
        results.failed++;
      }
    }

    logger.info(
      `[PluginInstaller] Batch uninstall complete: ${results.succeeded} succeeded, ${results.failed} failed`,
    );

    return {
      success: results.failed === 0,
      data: results,
    };
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  /**
   * Download a plugin zip from the marketplace
   * @private
   * @param {string} pluginId - The plugin identifier
   * @param {string} version - The version to download
   * @param {string} destPath - Destination file path
   * @returns {Promise<void>}
   */
  async _downloadPlugin(pluginId, version, destPath) {
    try {
      // Try using marketplaceClient's download method
      const data = await this.marketplaceClient.downloadPlugin(
        pluginId,
        version,
      );

      if (Buffer.isBuffer(data)) {
        await fs.writeFile(destPath, data);
      } else if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
        await fs.writeFile(destPath, Buffer.from(data));
      } else if (typeof data === "string") {
        // If it returns a URL, download it with https
        await this._downloadFromUrl(data, destPath);
      } else {
        // Assume it's a buffer-like object
        await fs.writeFile(destPath, Buffer.from(data));
      }

      // Verify file was created
      const stat = await fs.stat(destPath);
      if (stat.size === 0) {
        throw new Error("Downloaded file is empty");
      }

      logger.info(
        `[PluginInstaller] Downloaded ${pluginId}@${version} (${stat.size} bytes)`,
      );
    } catch (error) {
      logger.error(
        `[PluginInstaller] Download failed for ${pluginId}@${version}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Download a file from a URL
   * @private
   * @param {string} url - The URL to download from
   * @param {string} destPath - Destination file path
   * @returns {Promise<void>}
   */
  async _downloadFromUrl(url, destPath) {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith("https")
        ? require("https")
        : require("http");
      const fsSync = require("fs");
      const file = fsSync.createWriteStream(destPath);

      const request = protocol.get(url, (response) => {
        // Handle redirects
        if (
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          file.close();
          fsSync.unlinkSync(destPath);
          this._downloadFromUrl(response.headers.location, destPath)
            .then(resolve)
            .catch(reject);
          return;
        }

        if (response.statusCode !== 200) {
          file.close();
          fsSync.unlinkSync(destPath);
          reject(
            new Error(
              `HTTP ${response.statusCode}: Failed to download from ${url}`,
            ),
          );
          return;
        }

        response.pipe(file);

        file.on("finish", () => {
          file.close(resolve);
        });
      });

      request.on("error", (error) => {
        file.close();
        try {
          fsSync.unlinkSync(destPath);
        } catch (e) {
          // Ignore cleanup errors
        }
        reject(error);
      });

      file.on("error", (error) => {
        file.close();
        try {
          fsSync.unlinkSync(destPath);
        } catch (e) {
          // Ignore cleanup errors
        }
        reject(error);
      });

      // Set a timeout
      request.setTimeout(60000, () => {
        request.destroy();
        file.close();
        try {
          fsSync.unlinkSync(destPath);
        } catch (e) {
          // Ignore cleanup errors
        }
        reject(new Error(`Download timeout for ${url}`));
      });
    });
  }

  /**
   * Update the installation state for tracking
   * @private
   * @param {string} pluginId - The plugin identifier
   * @param {string} state - The new installation state
   */
  _updateInstallState(pluginId, state) {
    if (this.activeInstalls.has(pluginId)) {
      this.activeInstalls.get(pluginId).state = state;
    }
    logger.info(`[PluginInstaller] Install state for ${pluginId}: ${state}`);
  }

  /**
   * Validate a plugin manifest has required fields
   * @private
   * @param {Object} manifest - The manifest object
   * @returns {Array<string>} List of validation errors
   */
  _validateManifest(manifest) {
    const errors = [];

    if (!manifest.name || typeof manifest.name !== "string") {
      errors.push("missing or invalid 'name' field");
    }

    if (!manifest.version || typeof manifest.version !== "string") {
      errors.push("missing or invalid 'version' field");
    }

    // Validate version format (basic semver check)
    if (manifest.version && !/^\d+\.\d+\.\d+/.test(manifest.version)) {
      errors.push(
        `invalid version format: '${manifest.version}' (expected semver)`,
      );
    }

    if (manifest.main && typeof manifest.main !== "string") {
      errors.push("invalid 'main' field (must be a string)");
    }

    if (manifest.permissions && !Array.isArray(manifest.permissions)) {
      errors.push("invalid 'permissions' field (must be an array)");
    }

    if (manifest.dependencies && typeof manifest.dependencies !== "object") {
      errors.push("invalid 'dependencies' field (must be an object)");
    }

    return errors;
  }

  /**
   * Parse a database row, deserializing JSON metadata
   * @private
   * @param {Object} row - Database row
   * @returns {Object} Parsed plugin object
   */
  _parsePluginRow(row) {
    if (!row) {
      return null;
    }

    const parsed = { ...row };

    if (parsed.metadata && typeof parsed.metadata === "string") {
      try {
        parsed.metadata = JSON.parse(parsed.metadata);
      } catch (e) {
        parsed.metadata = {};
      }
    }

    return parsed;
  }

  /**
   * Safely delete a file (ignore errors if it does not exist)
   * @private
   * @param {string} filePath - Path to the file
   */
  async _safeDelete(filePath) {
    if (!filePath) {
      return;
    }

    try {
      await fs.unlink(filePath);
    } catch (error) {
      if (error.code !== "ENOENT") {
        logger.warn(
          `[PluginInstaller] Failed to delete file: ${filePath}`,
          error.message,
        );
      }
    }
  }

  /**
   * Safely delete a directory recursively (ignore errors if it does not exist)
   * @private
   * @param {string} dirPath - Path to the directory
   */
  async _safeDeleteDir(dirPath) {
    if (!dirPath) {
      return;
    }

    try {
      await fs.rm(dirPath, { recursive: true, force: true });
    } catch (error) {
      if (error.code !== "ENOENT") {
        logger.warn(
          `[PluginInstaller] Failed to delete directory: ${dirPath}`,
          error.message,
        );
      }
    }
  }

  /**
   * Copy a directory recursively
   * @private
   * @param {string} srcDir - Source directory
   * @param {string} destDir - Destination directory
   */
  async _copyDir(srcDir, destDir) {
    await fs.mkdir(destDir, { recursive: true });

    const entries = await fs.readdir(srcDir, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(srcDir, entry.name);
      const destPath = path.join(destDir, entry.name);

      if (entry.isDirectory()) {
        await this._copyDir(srcPath, destPath);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }

  /**
   * Cleanup temporary files and stale installations
   * @returns {Promise<{success: boolean, data?: Object, error?: string}>}
   */
  async cleanup() {
    try {
      let cleanedFiles = 0;

      // Clean temp directory
      try {
        const entries = await fs.readdir(this.tempDir, { withFileTypes: true });
        const now = Date.now();
        const maxAge = 24 * 60 * 60 * 1000; // 24 hours

        for (const entry of entries) {
          const entryPath = path.join(this.tempDir, entry.name);

          try {
            const stat = await fs.stat(entryPath);
            if (now - stat.mtimeMs > maxAge) {
              if (entry.isDirectory()) {
                await fs.rm(entryPath, { recursive: true, force: true });
              } else {
                await fs.unlink(entryPath);
              }
              cleanedFiles++;
            }
          } catch (e) {
            // Skip entries that fail
          }
        }
      } catch (e) {
        // Temp dir may not exist, that's fine
      }

      // Clear stale active installations (stuck for more than 30 minutes)
      const staleThreshold = 30 * 60 * 1000;
      const now = Date.now();

      for (const [pluginId, install] of this.activeInstalls) {
        if (now - install.startedAt > staleThreshold) {
          logger.warn(
            `[PluginInstaller] Clearing stale installation: ${pluginId}`,
          );
          this.activeInstalls.delete(pluginId);
        }
      }

      logger.info(
        `[PluginInstaller] Cleanup complete: ${cleanedFiles} temp files removed`,
      );

      return {
        success: true,
        data: { cleanedFiles },
      };
    } catch (error) {
      logger.error("[PluginInstaller] Cleanup error:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Destroy the installer and clean up resources
   */
  async destroy() {
    this.activeInstalls.clear();
    logger.info("[PluginInstaller] Destroyed");
  }
}

module.exports = PluginInstaller;

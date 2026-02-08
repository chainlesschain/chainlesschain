/**
 * AutoBackupManager - Automatic Backup Management
 *
 * Provides automatic backup functionality for memory system data:
 * - Full and incremental backups
 * - Scheduled backup execution
 * - Backup retention and cleanup
 * - Backup restoration
 *
 * @module auto-backup-manager
 * @version 1.0.0
 * @since 2026-01-18
 */

const { logger } = require("../utils/logger.js");
const fs = require("fs").promises;
const path = require("path");
const crypto = require("crypto");
const { EventEmitter } = require("events");
const { v4: uuidv4 } = require("uuid");

/**
 * AutoBackupManager class
 */
class AutoBackupManager extends EventEmitter {
  /**
   * Create an AutoBackupManager instance
   * @param {Object} options - Configuration options
   * @param {Object} options.database - SQLite database instance
   * @param {string} options.backupsDir - Directory for backup files
   * @param {Object} [options.configManager] - UnifiedConfigManager instance
   */
  constructor(options = {}) {
    super();

    if (!options.database) {
      throw new Error("[AutoBackupManager] database parameter is required");
    }

    this.db = options.database;
    this.backupsDir =
      options.backupsDir ||
      path.join(process.cwd(), ".chainlesschain", "memory", "backups");
    this.configManager = options.configManager || null;

    // Backup subdirectories
    this.fullBackupsDir = path.join(this.backupsDir, "full");
    this.incrementalBackupsDir = path.join(this.backupsDir, "incremental");

    // Schedule timer
    this.scheduleTimer = null;
    this.scheduleCheckInterval = 60 * 1000; // Check every minute

    // Backup scopes and their table mappings
    this.scopeTableMap = {
      patterns: [
        "prompt_patterns",
        "error_fix_patterns",
        "code_snippets",
        "workflow_patterns",
      ],
      preferences: ["user_preferences", "usage_history", "search_history"],
      sessions: ["llm_sessions", "llm_session_templates"],
    };

    logger.info("[AutoBackupManager] Initialized", {
      backupsDir: this.backupsDir,
    });
  }

  /**
   * Initialize the manager
   */
  async initialize() {
    try {
      // Ensure directories exist
      await fs.mkdir(this.fullBackupsDir, { recursive: true });
      await fs.mkdir(this.incrementalBackupsDir, { recursive: true });

      // Ensure tables exist
      await this._ensureTables();

      // Create manifest file if not exists
      await this._initializeManifest();

      // Start schedule checker
      this._startScheduleChecker();

      logger.info("[AutoBackupManager] Initialization complete");
    } catch (error) {
      logger.error("[AutoBackupManager] Initialization failed:", error);
      throw error;
    }
  }

  /**
   * Ensure database tables exist
   * @private
   */
  async _ensureTables() {
    try {
      const tableCheck = this.db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type='table' AND name='backup_history'
      `);
      const exists = tableCheck.get();

      if (!exists) {
        // Create backup_history table
        this.db
          .prepare(
            `
          CREATE TABLE IF NOT EXISTS backup_history (
            id TEXT PRIMARY KEY,
            backup_type TEXT NOT NULL,
            backup_scope TEXT NOT NULL,
            file_path TEXT NOT NULL,
            file_size INTEGER,
            items_backed_up INTEGER,
            items_changed INTEGER,
            checksum TEXT,
            parent_backup_id TEXT,
            status TEXT DEFAULT 'completed',
            error_message TEXT,
            started_at INTEGER NOT NULL,
            completed_at INTEGER,
            created_at INTEGER NOT NULL
          )
        `,
          )
          .run();

        // Create backup_schedule table
        this.db
          .prepare(
            `
          CREATE TABLE IF NOT EXISTS backup_schedule (
            id TEXT PRIMARY KEY,
            schedule_name TEXT NOT NULL,
            backup_scope TEXT NOT NULL,
            backup_type TEXT DEFAULT 'full',
            frequency TEXT NOT NULL,
            hour INTEGER DEFAULT 3,
            minute INTEGER DEFAULT 0,
            day_of_week INTEGER,
            day_of_month INTEGER,
            retention_count INTEGER DEFAULT 10,
            retention_days INTEGER DEFAULT 30,
            is_enabled INTEGER DEFAULT 1,
            last_run_at INTEGER,
            next_run_at INTEGER,
            last_run_status TEXT,
            last_run_backup_id TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          )
        `,
          )
          .run();

        // Create indexes
        this.db
          .prepare(
            `CREATE INDEX IF NOT EXISTS idx_backup_history_scope ON backup_history(backup_scope, created_at DESC)`,
          )
          .run();
        this.db
          .prepare(
            `CREATE INDEX IF NOT EXISTS idx_backup_schedule_enabled ON backup_schedule(is_enabled, next_run_at)`,
          )
          .run();

        logger.info("[AutoBackupManager] Database tables created");
      }
    } catch (error) {
      logger.error("[AutoBackupManager] Failed to ensure tables:", error);
      throw error;
    }
  }

  /**
   * Initialize manifest file
   * @private
   */
  async _initializeManifest() {
    const manifestPath = path.join(this.backupsDir, "manifest.json");
    try {
      await fs.access(manifestPath);
    } catch {
      // Create initial manifest
      const manifest = {
        version: "1.0.0",
        created_at: Date.now(),
        last_full_backup: null,
        last_incremental_backup: null,
        scopes: Object.keys(this.scopeTableMap),
      };
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    }
  }

  /**
   * Start schedule checker
   * @private
   */
  _startScheduleChecker() {
    if (this.scheduleTimer) {
      clearInterval(this.scheduleTimer);
    }

    this.scheduleTimer = setInterval(async () => {
      await this._checkAndRunSchedules();
    }, this.scheduleCheckInterval);

    logger.info("[AutoBackupManager] Schedule checker started");
  }

  /**
   * Stop schedule checker
   */
  stopScheduleChecker() {
    if (this.scheduleTimer) {
      clearInterval(this.scheduleTimer);
      this.scheduleTimer = null;
      logger.info("[AutoBackupManager] Schedule checker stopped");
    }
  }

  /**
   * Check and run due schedules
   * @private
   */
  async _checkAndRunSchedules() {
    try {
      const now = Date.now();
      const stmt = this.db.prepare(`
        SELECT * FROM backup_schedule
        WHERE is_enabled = 1 AND next_run_at <= ?
      `);
      const dueSchedules = stmt.all(now);

      for (const schedule of dueSchedules) {
        logger.info(
          `[AutoBackupManager] Running scheduled backup: ${schedule.schedule_name}`,
        );

        try {
          const backup =
            schedule.backup_type === "incremental"
              ? await this.createIncrementalBackup(schedule.backup_scope)
              : await this.createFullBackup(schedule.backup_scope);

          // Update schedule
          const nextRun = this._calculateNextRun(schedule);
          this.db
            .prepare(
              `
            UPDATE backup_schedule
            SET last_run_at = ?, next_run_at = ?, last_run_status = 'success',
                last_run_backup_id = ?, updated_at = ?
            WHERE id = ?
          `,
            )
            .run(now, nextRun, backup.id, now, schedule.id);

          // Cleanup old backups
          await this._cleanupOldBackups(schedule);

          this.emit("schedule-completed", { schedule, backup });
        } catch (error) {
          logger.error(
            `[AutoBackupManager] Scheduled backup failed: ${schedule.schedule_name}`,
            error,
          );

          const nextRun = this._calculateNextRun(schedule);
          this.db
            .prepare(
              `
            UPDATE backup_schedule
            SET last_run_at = ?, next_run_at = ?, last_run_status = 'failed',
                updated_at = ?
            WHERE id = ?
          `,
            )
            .run(now, nextRun, now, schedule.id);

          this.emit("schedule-failed", { schedule, error: error.message });
        }
      }
    } catch (error) {
      logger.error("[AutoBackupManager] Schedule check failed:", error);
    }
  }

  /**
   * Calculate next run time for a schedule
   * @param {Object} schedule - Schedule config
   * @returns {number} Next run timestamp
   * @private
   */
  _calculateNextRun(schedule) {
    const now = new Date();
    const next = new Date();

    switch (schedule.frequency) {
      case "hourly":
        next.setHours(next.getHours() + 1);
        next.setMinutes(schedule.minute || 0);
        next.setSeconds(0);
        break;

      case "daily":
        next.setDate(next.getDate() + 1);
        next.setHours(schedule.hour || 3);
        next.setMinutes(schedule.minute || 0);
        next.setSeconds(0);
        break;

      case "weekly": {
        const daysUntilNext =
          (7 + (schedule.day_of_week || 0) - now.getDay()) % 7 || 7;
        next.setDate(next.getDate() + daysUntilNext);
        next.setHours(schedule.hour || 3);
        next.setMinutes(schedule.minute || 0);
        next.setSeconds(0);
        break;
      }

      case "monthly":
        next.setMonth(next.getMonth() + 1);
        next.setDate(schedule.day_of_month || 1);
        next.setHours(schedule.hour || 3);
        next.setMinutes(schedule.minute || 0);
        next.setSeconds(0);
        break;

      default:
        // Default to daily
        next.setDate(next.getDate() + 1);
        next.setHours(3);
        next.setMinutes(0);
        next.setSeconds(0);
    }

    return next.getTime();
  }

  /**
   * Create a full backup
   * @param {string} scope - Backup scope ('patterns', 'preferences', 'sessions', 'all')
   * @returns {Promise<Object>} Backup result
   */
  async createFullBackup(scope = "all") {
    const id = uuidv4();
    const startedAt = Date.now();

    logger.info(`[AutoBackupManager] Creating full backup: scope=${scope}`);

    try {
      // Get tables to backup
      const tables = this._getTablesForScope(scope);

      // Collect data from tables
      const backupData = {
        id,
        type: "full",
        scope,
        created_at: startedAt,
        version: "1.0.0",
        tables: {},
      };

      let totalItems = 0;

      for (const table of tables) {
        try {
          const stmt = this.db.prepare(`SELECT * FROM ${table}`);
          const rows = stmt.all();
          backupData.tables[table] = rows;
          totalItems += rows.length;
        } catch (tableError) {
          logger.warn(`[AutoBackupManager] Table ${table} not found, skipping`);
        }
      }

      // Generate filename
      const dateStr = new Date(startedAt).toISOString().split("T")[0];
      const filename = `${scope}-${dateStr}-${id.slice(0, 8)}.json`;
      const filePath = path.join(this.fullBackupsDir, filename);

      // Write backup file
      const content = JSON.stringify(backupData, null, 2);
      await fs.writeFile(filePath, content, "utf-8");

      // Calculate checksum
      const checksum = crypto
        .createHash("sha256")
        .update(content)
        .digest("hex");

      // Get file size
      const stats = await fs.stat(filePath);
      const fileSize = stats.size;

      const completedAt = Date.now();

      // Record in database
      this.db
        .prepare(
          `
        INSERT INTO backup_history (
          id, backup_type, backup_scope, file_path, file_size,
          items_backed_up, checksum, status, started_at, completed_at, created_at
        ) VALUES (?, 'full', ?, ?, ?, ?, ?, 'completed', ?, ?, ?)
      `,
        )
        .run(
          id,
          scope,
          filePath,
          fileSize,
          totalItems,
          checksum,
          startedAt,
          completedAt,
          startedAt,
        );

      // Update manifest
      await this._updateManifest({ lastFullBackup: id, scope });

      const result = {
        id,
        type: "full",
        scope,
        filePath,
        fileSize,
        itemsBackedUp: totalItems,
        checksum,
        duration: completedAt - startedAt,
      };

      this.emit("backup-completed", result);
      logger.info(
        `[AutoBackupManager] Full backup completed: ${totalItems} items, ${fileSize} bytes`,
      );

      return result;
    } catch (error) {
      logger.error("[AutoBackupManager] Full backup failed:", error);

      // Record failure
      this.db
        .prepare(
          `
        INSERT INTO backup_history (
          id, backup_type, backup_scope, file_path, status, error_message,
          started_at, created_at
        ) VALUES (?, 'full', ?, '', 'failed', ?, ?, ?)
      `,
        )
        .run(id, scope, error.message, startedAt, startedAt);

      this.emit("backup-failed", { id, scope, error: error.message });
      throw error;
    }
  }

  /**
   * Create an incremental backup
   * @param {string} scope - Backup scope
   * @returns {Promise<Object>} Backup result
   */
  async createIncrementalBackup(scope = "all") {
    const id = uuidv4();
    const startedAt = Date.now();

    logger.info(
      `[AutoBackupManager] Creating incremental backup: scope=${scope}`,
    );

    try {
      // Get last full backup for this scope
      const lastFullStmt = this.db.prepare(`
        SELECT * FROM backup_history
        WHERE backup_scope = ? AND backup_type = 'full' AND status = 'completed'
        ORDER BY created_at DESC LIMIT 1
      `);
      const lastFull = lastFullStmt.get(scope === "all" ? "all" : scope);

      if (!lastFull) {
        logger.info(
          "[AutoBackupManager] No previous full backup, creating full backup instead",
        );
        return this.createFullBackup(scope);
      }

      // Load previous backup data for comparison
      let previousData = {};
      try {
        const previousContent = await fs.readFile(lastFull.file_path, "utf-8");
        previousData = JSON.parse(previousContent).tables || {};
      } catch {
        logger.warn(
          "[AutoBackupManager] Could not load previous backup, creating full backup",
        );
        return this.createFullBackup(scope);
      }

      // Get tables to backup
      const tables = this._getTablesForScope(scope);

      // Collect changed data
      const backupData = {
        id,
        type: "incremental",
        scope,
        parent_backup_id: lastFull.id,
        created_at: startedAt,
        version: "1.0.0",
        changes: {},
      };

      let totalItems = 0;
      let changedItems = 0;

      for (const table of tables) {
        try {
          const stmt = this.db.prepare(`SELECT * FROM ${table}`);
          const currentRows = stmt.all();
          const previousRows = previousData[table] || [];

          // Create hash maps for comparison
          const previousMap = new Map(
            previousRows.map((r) => [r.id, JSON.stringify(r)]),
          );
          const currentMap = new Map(
            currentRows.map((r) => [r.id, JSON.stringify(r)]),
          );

          const added = [];
          const modified = [];
          const deleted = [];

          // Find added and modified
          for (const row of currentRows) {
            const prevJson = previousMap.get(row.id);
            const currJson = JSON.stringify(row);

            if (!prevJson) {
              added.push(row);
              changedItems++;
            } else if (prevJson !== currJson) {
              modified.push(row);
              changedItems++;
            }
            totalItems++;
          }

          // Find deleted
          for (const prevRow of previousRows) {
            if (!currentMap.has(prevRow.id)) {
              deleted.push(prevRow.id);
              changedItems++;
            }
          }

          if (added.length > 0 || modified.length > 0 || deleted.length > 0) {
            backupData.changes[table] = { added, modified, deleted };
          }
        } catch (tableError) {
          logger.warn(`[AutoBackupManager] Table ${table} not found, skipping`);
        }
      }

      // Generate filename
      const dateStr = new Date(startedAt).toISOString().split("T")[0];
      const filename = `${scope}-${dateStr}-incr-${id.slice(0, 8)}.json`;
      const filePath = path.join(this.incrementalBackupsDir, filename);

      // Write backup file
      const content = JSON.stringify(backupData, null, 2);
      await fs.writeFile(filePath, content, "utf-8");

      // Calculate checksum
      const checksum = crypto
        .createHash("sha256")
        .update(content)
        .digest("hex");

      // Get file size
      const stats = await fs.stat(filePath);
      const fileSize = stats.size;

      const completedAt = Date.now();

      // Record in database
      this.db
        .prepare(
          `
        INSERT INTO backup_history (
          id, backup_type, backup_scope, file_path, file_size,
          items_backed_up, items_changed, checksum, parent_backup_id,
          status, started_at, completed_at, created_at
        ) VALUES (?, 'incremental', ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?)
      `,
        )
        .run(
          id,
          scope,
          filePath,
          fileSize,
          totalItems,
          changedItems,
          checksum,
          lastFull.id,
          startedAt,
          completedAt,
          startedAt,
        );

      // Update manifest
      await this._updateManifest({ lastIncrementalBackup: id, scope });

      const result = {
        id,
        type: "incremental",
        scope,
        parentBackupId: lastFull.id,
        filePath,
        fileSize,
        itemsBackedUp: totalItems,
        itemsChanged: changedItems,
        checksum,
        duration: completedAt - startedAt,
      };

      this.emit("backup-completed", result);
      logger.info(
        `[AutoBackupManager] Incremental backup completed: ${changedItems} changes, ${fileSize} bytes`,
      );

      return result;
    } catch (error) {
      logger.error("[AutoBackupManager] Incremental backup failed:", error);

      this.db
        .prepare(
          `
        INSERT INTO backup_history (
          id, backup_type, backup_scope, file_path, status, error_message,
          started_at, created_at
        ) VALUES (?, 'incremental', ?, '', 'failed', ?, ?, ?)
      `,
        )
        .run(id, scope, error.message, startedAt, startedAt);

      this.emit("backup-failed", { id, scope, error: error.message });
      throw error;
    }
  }

  /**
   * Configure a backup schedule
   * @param {Object} config - Schedule configuration
   * @returns {Promise<Object>} Created schedule
   */
  async configureSchedule(config) {
    const {
      name,
      scope = "all",
      type = "full",
      frequency = "daily",
      hour = 3,
      minute = 0,
      dayOfWeek,
      dayOfMonth,
      retentionCount = 10,
      retentionDays = 30,
      enabled = true,
    } = config;

    if (!name) {
      throw new Error("Schedule name is required");
    }

    const id = uuidv4();
    const now = Date.now();

    // Calculate first run time
    const schedule = {
      frequency,
      hour,
      minute,
      day_of_week: dayOfWeek,
      day_of_month: dayOfMonth,
    };
    const nextRun = this._calculateNextRun(schedule);

    try {
      this.db
        .prepare(
          `
        INSERT INTO backup_schedule (
          id, schedule_name, backup_scope, backup_type, frequency,
          hour, minute, day_of_week, day_of_month,
          retention_count, retention_days, is_enabled, next_run_at,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        )
        .run(
          id,
          name,
          scope,
          type,
          frequency,
          hour,
          minute,
          dayOfWeek || null,
          dayOfMonth || null,
          retentionCount,
          retentionDays,
          enabled ? 1 : 0,
          nextRun,
          now,
          now,
        );

      const result = {
        id,
        name,
        scope,
        type,
        frequency,
        hour,
        minute,
        dayOfWeek,
        dayOfMonth,
        retentionCount,
        retentionDays,
        enabled,
        nextRun,
      };

      this.emit("schedule-created", result);
      logger.info(`[AutoBackupManager] Schedule created: ${name}`);

      return result;
    } catch (error) {
      logger.error("[AutoBackupManager] Failed to create schedule:", error);
      throw error;
    }
  }

  /**
   * Update a backup schedule
   * @param {string} id - Schedule ID
   * @param {Object} updates - Updates to apply
   * @returns {Promise<Object>} Updated schedule
   */
  async updateSchedule(id, updates) {
    const now = Date.now();

    try {
      const current = this.db
        .prepare(`SELECT * FROM backup_schedule WHERE id = ?`)
        .get(id);

      if (!current) {
        throw new Error("Schedule not found");
      }

      const updated = { ...current, ...updates };

      // Recalculate next run if schedule changed
      let nextRun = current.next_run_at;
      if (
        updates.frequency ||
        updates.hour !== undefined ||
        updates.minute !== undefined ||
        updates.dayOfWeek !== undefined ||
        updates.dayOfMonth !== undefined
      ) {
        nextRun = this._calculateNextRun({
          frequency: updated.frequency,
          hour: updated.hour,
          minute: updated.minute,
          day_of_week: updated.day_of_week,
          day_of_month: updated.day_of_month,
        });
      }

      this.db
        .prepare(
          `
        UPDATE backup_schedule
        SET schedule_name = ?, backup_scope = ?, backup_type = ?,
            frequency = ?, hour = ?, minute = ?, day_of_week = ?, day_of_month = ?,
            retention_count = ?, retention_days = ?, is_enabled = ?,
            next_run_at = ?, updated_at = ?
        WHERE id = ?
      `,
        )
        .run(
          updates.name || current.schedule_name,
          updates.scope || current.backup_scope,
          updates.type || current.backup_type,
          updated.frequency,
          updated.hour,
          updated.minute,
          updated.day_of_week,
          updated.day_of_month,
          updates.retentionCount || current.retention_count,
          updates.retentionDays || current.retention_days,
          updates.enabled !== undefined
            ? updates.enabled
              ? 1
              : 0
            : current.is_enabled,
          nextRun,
          now,
          id,
        );

      logger.info(`[AutoBackupManager] Schedule updated: ${id}`);
      return { id, ...updates, nextRun };
    } catch (error) {
      logger.error("[AutoBackupManager] Failed to update schedule:", error);
      throw error;
    }
  }

  /**
   * Delete a backup schedule
   * @param {string} id - Schedule ID
   */
  async deleteSchedule(id) {
    try {
      this.db.prepare(`DELETE FROM backup_schedule WHERE id = ?`).run(id);
      logger.info(`[AutoBackupManager] Schedule deleted: ${id}`);
      this.emit("schedule-deleted", { id });
    } catch (error) {
      logger.error("[AutoBackupManager] Failed to delete schedule:", error);
      throw error;
    }
  }

  /**
   * Get all schedules
   * @returns {Promise<Array>} List of schedules
   */
  async getSchedules() {
    try {
      const stmt = this.db.prepare(
        `SELECT * FROM backup_schedule ORDER BY created_at DESC`,
      );
      return stmt.all().map((s) => ({
        id: s.id,
        name: s.schedule_name,
        scope: s.backup_scope,
        type: s.backup_type,
        frequency: s.frequency,
        hour: s.hour,
        minute: s.minute,
        dayOfWeek: s.day_of_week,
        dayOfMonth: s.day_of_month,
        retentionCount: s.retention_count,
        retentionDays: s.retention_days,
        enabled: s.is_enabled === 1,
        lastRunAt: s.last_run_at,
        nextRunAt: s.next_run_at,
        lastRunStatus: s.last_run_status,
      }));
    } catch (error) {
      logger.error("[AutoBackupManager] Failed to get schedules:", error);
      return [];
    }
  }

  /**
   * Restore from backup
   * @param {string} backupId - Backup ID to restore from
   * @param {Object} options - Restore options
   * @returns {Promise<Object>} Restore result
   */
  async restoreFromBackup(backupId, options = {}) {
    const { dryRun = false, tables } = options;

    logger.info(`[AutoBackupManager] Restoring from backup: ${backupId}`);

    try {
      // Get backup record
      const backup = this.db
        .prepare(`SELECT * FROM backup_history WHERE id = ?`)
        .get(backupId);

      if (!backup) {
        throw new Error("Backup not found");
      }

      if (backup.status !== "completed") {
        throw new Error("Cannot restore from incomplete backup");
      }

      // Load backup data
      const content = await fs.readFile(backup.file_path, "utf-8");
      const backupData = JSON.parse(content);

      // Verify checksum
      const checksum = crypto
        .createHash("sha256")
        .update(content)
        .digest("hex");
      if (checksum !== backup.checksum) {
        throw new Error("Backup checksum mismatch - file may be corrupted");
      }

      if (backupData.type === "full") {
        return this._restoreFullBackup(backupData, { dryRun, tables });
      } else if (backupData.type === "incremental") {
        return this._restoreIncrementalBackup(backupData, backup, {
          dryRun,
          tables,
        });
      }

      throw new Error(`Unknown backup type: ${backupData.type}`);
    } catch (error) {
      logger.error("[AutoBackupManager] Restore failed:", error);
      throw error;
    }
  }

  /**
   * Restore from full backup
   * @private
   */
  async _restoreFullBackup(backupData, options = {}) {
    const { dryRun, tables: filterTables } = options;
    const results = { restored: {}, errors: [] };

    for (const [table, rows] of Object.entries(backupData.tables)) {
      if (filterTables && !filterTables.includes(table)) {
        continue;
      }

      try {
        if (dryRun) {
          results.restored[table] = { count: rows.length, dryRun: true };
          continue;
        }

        // Clear existing data
        this.db.prepare(`DELETE FROM ${table}`).run();

        // Insert backup data
        if (rows.length > 0) {
          const columns = Object.keys(rows[0]);
          const placeholders = columns.map(() => "?").join(", ");
          const stmt = this.db.prepare(
            `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`,
          );

          for (const row of rows) {
            stmt.run(...columns.map((c) => row[c]));
          }
        }

        results.restored[table] = { count: rows.length };
      } catch (tableError) {
        logger.error(
          `[AutoBackupManager] Failed to restore table ${table}:`,
          tableError,
        );
        results.errors.push({ table, error: tableError.message });
      }
    }

    this.emit("restore-completed", results);
    logger.info(`[AutoBackupManager] Full restore completed`);

    return results;
  }

  /**
   * Restore from incremental backup
   * @private
   */
  async _restoreIncrementalBackup(backupData, backup, options = {}) {
    const { dryRun, tables: filterTables } = options;
    const results = { restored: {}, errors: [] };

    // First restore parent (full) backup
    if (backupData.parent_backup_id) {
      const parentBackup = this.db
        .prepare(`SELECT * FROM backup_history WHERE id = ?`)
        .get(backupData.parent_backup_id);

      if (parentBackup) {
        const parentContent = await fs.readFile(
          parentBackup.file_path,
          "utf-8",
        );
        const parentData = JSON.parse(parentContent);
        await this._restoreFullBackup(parentData, {
          dryRun,
          tables: filterTables,
        });
      }
    }

    // Apply incremental changes
    for (const [table, changes] of Object.entries(backupData.changes)) {
      if (filterTables && !filterTables.includes(table)) {
        continue;
      }

      try {
        if (dryRun) {
          results.restored[table] = {
            added: changes.added.length,
            modified: changes.modified.length,
            deleted: changes.deleted.length,
            dryRun: true,
          };
          continue;
        }

        // Apply deletions
        if (changes.deleted.length > 0) {
          const deleteStmt = this.db.prepare(
            `DELETE FROM ${table} WHERE id = ?`,
          );
          for (const id of changes.deleted) {
            deleteStmt.run(id);
          }
        }

        // Apply additions
        if (changes.added.length > 0) {
          const columns = Object.keys(changes.added[0]);
          const placeholders = columns.map(() => "?").join(", ");
          const insertStmt = this.db.prepare(
            `INSERT OR REPLACE INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`,
          );

          for (const row of changes.added) {
            insertStmt.run(...columns.map((c) => row[c]));
          }
        }

        // Apply modifications
        if (changes.modified.length > 0) {
          const columns = Object.keys(changes.modified[0]);
          const placeholders = columns.map(() => "?").join(", ");
          const updateStmt = this.db.prepare(
            `INSERT OR REPLACE INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`,
          );

          for (const row of changes.modified) {
            updateStmt.run(...columns.map((c) => row[c]));
          }
        }

        results.restored[table] = {
          added: changes.added.length,
          modified: changes.modified.length,
          deleted: changes.deleted.length,
        };
      } catch (tableError) {
        logger.error(
          `[AutoBackupManager] Failed to restore table ${table}:`,
          tableError,
        );
        results.errors.push({ table, error: tableError.message });
      }
    }

    this.emit("restore-completed", results);
    logger.info(`[AutoBackupManager] Incremental restore completed`);

    return results;
  }

  /**
   * Cleanup old backups based on retention policy
   * @param {Object} schedule - Schedule with retention settings
   * @private
   */
  async _cleanupOldBackups(schedule) {
    try {
      const { retention_count, retention_days, backup_scope } = schedule;
      const cutoffTime = Date.now() - retention_days * 24 * 60 * 60 * 1000;

      // Get backups to delete
      const stmt = this.db.prepare(`
        SELECT * FROM backup_history
        WHERE backup_scope = ? AND status = 'completed'
          AND (created_at < ? OR id IN (
            SELECT id FROM (
              SELECT id FROM backup_history
              WHERE backup_scope = ? AND status = 'completed'
              ORDER BY created_at DESC
              LIMIT -1 OFFSET ?
            )
          ))
        ORDER BY created_at ASC
      `);

      const toDelete = stmt.all(
        backup_scope,
        cutoffTime,
        backup_scope,
        retention_count,
      );

      for (const backup of toDelete) {
        await this.deleteBackup(backup.id);
      }

      if (toDelete.length > 0) {
        logger.info(
          `[AutoBackupManager] Cleaned up ${toDelete.length} old backups for scope: ${backup_scope}`,
        );
      }
    } catch (error) {
      logger.error("[AutoBackupManager] Cleanup failed:", error);
    }
  }

  /**
   * Delete a backup
   * @param {string} backupId - Backup ID
   */
  async deleteBackup(backupId) {
    try {
      const backup = this.db
        .prepare(`SELECT * FROM backup_history WHERE id = ?`)
        .get(backupId);

      if (!backup) {
        return;
      }

      // Delete file
      try {
        await fs.unlink(backup.file_path);
      } catch (fileError) {
        logger.warn(
          `[AutoBackupManager] Could not delete file: ${backup.file_path}`,
        );
      }

      // Delete record
      this.db.prepare(`DELETE FROM backup_history WHERE id = ?`).run(backupId);

      logger.info(`[AutoBackupManager] Backup deleted: ${backupId}`);
      this.emit("backup-deleted", { id: backupId });
    } catch (error) {
      logger.error("[AutoBackupManager] Failed to delete backup:", error);
      throw error;
    }
  }

  /**
   * Get backup history
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Backup history
   */
  async getBackupHistory(options = {}) {
    const { scope, type, limit = 50, status } = options;

    try {
      let sql = `SELECT * FROM backup_history WHERE 1=1`;
      const params = [];

      if (scope) {
        sql += ` AND backup_scope = ?`;
        params.push(scope);
      }

      if (type) {
        sql += ` AND backup_type = ?`;
        params.push(type);
      }

      if (status) {
        sql += ` AND status = ?`;
        params.push(status);
      }

      sql += ` ORDER BY created_at DESC LIMIT ?`;
      params.push(limit);

      const stmt = this.db.prepare(sql);
      return stmt.all(...params).map((b) => ({
        id: b.id,
        type: b.backup_type,
        scope: b.backup_scope,
        filePath: b.file_path,
        fileSize: b.file_size,
        itemsBackedUp: b.items_backed_up,
        itemsChanged: b.items_changed,
        checksum: b.checksum,
        parentBackupId: b.parent_backup_id,
        status: b.status,
        errorMessage: b.error_message,
        startedAt: b.started_at,
        completedAt: b.completed_at,
        createdAt: b.created_at,
      }));
    } catch (error) {
      logger.error("[AutoBackupManager] Failed to get backup history:", error);
      return [];
    }
  }

  /**
   * Get backup statistics
   * @returns {Promise<Object>} Backup statistics
   */
  async getStats() {
    try {
      const totalStmt = this.db.prepare(`
        SELECT
          COUNT(*) as total_count,
          SUM(file_size) as total_size,
          SUM(items_backed_up) as total_items,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as successful,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
        FROM backup_history
      `);
      const totals = totalStmt.get();

      const byTypeStmt = this.db.prepare(`
        SELECT backup_type, COUNT(*) as count, SUM(file_size) as size
        FROM backup_history
        WHERE status = 'completed'
        GROUP BY backup_type
      `);
      const byType = byTypeStmt.all();

      const byScopeStmt = this.db.prepare(`
        SELECT backup_scope, COUNT(*) as count, MAX(created_at) as last_backup
        FROM backup_history
        WHERE status = 'completed'
        GROUP BY backup_scope
      `);
      const byScope = byScopeStmt.all();

      const lastBackupStmt = this.db.prepare(`
        SELECT * FROM backup_history
        WHERE status = 'completed'
        ORDER BY created_at DESC LIMIT 1
      `);
      const lastBackup = lastBackupStmt.get();

      const activeSchedulesStmt = this.db.prepare(`
        SELECT COUNT(*) as count FROM backup_schedule WHERE is_enabled = 1
      `);
      const activeSchedules = activeSchedulesStmt.get();

      return {
        totalBackups: totals.total_count || 0,
        totalSize: totals.total_size || 0,
        totalItems: totals.total_items || 0,
        successful: totals.successful || 0,
        failed: totals.failed || 0,
        byType,
        byScope,
        lastBackup: lastBackup
          ? {
              id: lastBackup.id,
              type: lastBackup.backup_type,
              scope: lastBackup.backup_scope,
              createdAt: lastBackup.created_at,
            }
          : null,
        activeSchedules: activeSchedules.count || 0,
      };
    } catch (error) {
      logger.error("[AutoBackupManager] Failed to get stats:", error);
      return {};
    }
  }

  /**
   * Get tables for a scope
   * @param {string} scope - Backup scope
   * @returns {string[]} Table names
   * @private
   */
  _getTablesForScope(scope) {
    if (scope === "all") {
      return Object.values(this.scopeTableMap).flat();
    }
    return this.scopeTableMap[scope] || [];
  }

  /**
   * Update manifest file
   * @param {Object} updates - Updates to apply
   * @private
   */
  async _updateManifest(updates) {
    const manifestPath = path.join(this.backupsDir, "manifest.json");
    try {
      let manifest = {};
      try {
        const content = await fs.readFile(manifestPath, "utf-8");
        manifest = JSON.parse(content);
      } catch {
        manifest = { version: "1.0.0", created_at: Date.now() };
      }

      manifest.updated_at = Date.now();
      if (updates.lastFullBackup) {
        manifest.last_full_backup = updates.lastFullBackup;
      }
      if (updates.lastIncrementalBackup) {
        manifest.last_incremental_backup = updates.lastIncrementalBackup;
      }
      if (updates.scope) {
        manifest[`last_${updates.scope}_backup`] =
          updates.lastFullBackup || updates.lastIncrementalBackup;
      }

      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    } catch (error) {
      logger.warn("[AutoBackupManager] Failed to update manifest:", error);
    }
  }
}

module.exports = {
  AutoBackupManager,
};

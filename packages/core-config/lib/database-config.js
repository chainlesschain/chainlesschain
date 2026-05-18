/**
 * Database configuration manager
 * Manages database path, backups, and migration.
 *
 * Extracted from desktop-app-vue/src/main/config/database-config.js
 * Electron dependency replaced with @chainlesschain/core-env
 */

const { getLogger } = require("./logger-adapter.js");
const fs = require("fs");
const path = require("path");

// Lazy import core-env (ESM) — resolved at first call
let _coreEnv = null;
function getCoreEnv() {
  if (_coreEnv) return _coreEnv;
  // core-env is ESM, but we only need sync functions
  // Use a sync require workaround: the functions are loaded on demand
  try {
    // Try dynamic import cached result
    _coreEnv = require("@chainlesschain/core-env/lib/paths.cjs.js");
  } catch {
    // Fallback: use process env or homedir
    const os = require("os");
    const fallbackUserData =
      process.env.CHAINLESSCHAIN_HOME ||
      path.join(os.homedir(), ".chainlesschain-data");
    _coreEnv = {
      getUserDataPath: () => fallbackUserData,
      getDataDir: () => path.join(fallbackUserData, "data"),
    };
  }
  return _coreEnv;
}

// Allow injection for cross-module-system compatibility
let _getUserDataPath = null;
let _getDataDir = null;

function setPathResolvers(resolvers) {
  _getUserDataPath = resolvers.getUserDataPath;
  _getDataDir = resolvers.getDataDir;
}

function getUserDataPath() {
  if (_getUserDataPath) return _getUserDataPath();
  return getCoreEnv().getUserDataPath();
}

function getDataDir() {
  if (_getDataDir) return _getDataDir();
  return getCoreEnv().getDataDir();
}

const DEFAULT_CONFIG = {
  database: {
    path: null,
    autoBackup: true,
    backupInterval: 86400000,
    maxBackups: 7,
  },
  app: {
    language: "zh-CN",
    theme: "light",
    startOnBoot: false,
    minimizeToTray: true,
  },
  logging: {
    level: "info",
    maxSize: 10485760,
    maxFiles: 5,
  },
};

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

class AppConfigManager {
  constructor(options = {}) {
    this.configPath = options.configPath || this.getConfigPath();
    this.config = deepClone(DEFAULT_CONFIG);
    this.loaded = false;
  }

  getConfigPath() {
    return path.join(getUserDataPath(), "app-config.json");
  }

  getDefaultDatabasePath() {
    const dbDir = getDataDir();
    return path.join(dbDir, "chainlesschain.db");
  }

  getDataPath() {
    return getDataDir();
  }

  load() {
    const logger = getLogger();
    try {
      if (fs.existsSync(this.configPath)) {
        const content = fs.readFileSync(this.configPath, "utf8");
        const savedConfig = JSON.parse(content);

        this.config = {
          ...DEFAULT_CONFIG,
          database: {
            ...DEFAULT_CONFIG.database,
            ...(savedConfig.database || {}),
          },
          app: { ...DEFAULT_CONFIG.app, ...(savedConfig.app || {}) },
          logging: {
            ...DEFAULT_CONFIG.logging,
            ...(savedConfig.logging || {}),
          },
        };

        this.loaded = true;
        logger.info("[AppConfig] Configuration loaded");
      } else {
        logger.info("[AppConfig] No config file, using defaults");
        this.loaded = false;
        this.save();
      }
    } catch (error) {
      logger.error("[AppConfig] Failed to load config:", error);
      this.config = deepClone(DEFAULT_CONFIG);
      this.loaded = false;
    }

    return this.config;
  }

  save() {
    const logger = getLogger();
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(
        this.configPath,
        JSON.stringify(this.config, null, 2),
        "utf8",
      );

      logger.info("[AppConfig] Configuration saved");
      return true;
    } catch (error) {
      logger.error("[AppConfig] Failed to save config:", error);
      return false;
    }
  }

  get(key, defaultValue = null) {
    const keys = key.split(".");
    let value = this.config;

    for (const k of keys) {
      if (value && typeof value === "object" && k in value) {
        value = value[k];
      } else {
        return defaultValue;
      }
    }

    return value;
  }

  set(key, value) {
    const keys = key.split(".");
    let target = this.config;

    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (!(k in target) || typeof target[k] !== "object") {
        target[k] = {};
      }
      target = target[k];
    }

    target[keys[keys.length - 1]] = value;
    this.save();
  }

  getAll() {
    return { ...this.config };
  }

  reset() {
    this.config = deepClone(DEFAULT_CONFIG);
    this.save();
  }

  getDatabasePath() {
    const customPath = this.config.database.path;
    if (customPath && customPath.trim() !== "") {
      return customPath;
    }
    return this.getDefaultDatabasePath();
  }

  setDatabasePath(newPath) {
    this.config.database.path = newPath;
    this.save();
  }

  getDatabaseDir() {
    return path.dirname(this.getDatabasePath());
  }

  ensureDatabaseDir() {
    const logger = getLogger();
    const dbDir = this.getDatabaseDir();
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
      logger.info(`[AppConfig] Created database dir: ${dbDir}`);
    }
    return dbDir;
  }

  databaseExists() {
    return fs.existsSync(this.getDatabasePath());
  }

  async migrateDatabaseTo(newPath) {
    const logger = getLogger();
    try {
      const currentPath = this.getDatabasePath();

      if (!fs.existsSync(currentPath)) {
        logger.info("[AppConfig] Source db does not exist, skipping migration");
        this.setDatabasePath(newPath);
        return true;
      }

      if (currentPath === newPath) {
        return true;
      }

      const newDir = path.dirname(newPath);
      if (!fs.existsSync(newDir)) {
        fs.mkdirSync(newDir, { recursive: true });
      }

      if (fs.existsSync(newPath)) {
        throw new Error("Target path already contains a database");
      }

      fs.copyFileSync(currentPath, newPath);

      const originalSize = fs.statSync(currentPath).size;
      const copiedSize = fs.statSync(newPath).size;

      if (originalSize !== copiedSize) {
        fs.unlinkSync(newPath);
        throw new Error("Database copy incomplete");
      }

      const backupPath = `${currentPath}.backup.${Date.now()}`;
      fs.copyFileSync(currentPath, backupPath);

      this.setDatabasePath(newPath);
      logger.info("[AppConfig] Database migration successful");
      return true;
    } catch (error) {
      logger.error("[AppConfig] Database migration failed:", error);
      throw error;
    }
  }

  createDatabaseBackup() {
    const logger = getLogger();
    const dbPath = this.getDatabasePath();

    if (!fs.existsSync(dbPath)) {
      throw new Error("Database file does not exist");
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = `${dbPath}.backup.${timestamp}`;
    fs.copyFileSync(dbPath, backupPath);
    logger.info(`[AppConfig] Database backup: ${backupPath}`);

    this.cleanupOldBackups();
    return backupPath;
  }

  cleanupOldBackups() {
    const logger = getLogger();
    try {
      const dbPath = this.getDatabasePath();
      const dbDir = path.dirname(dbPath);
      const dbName = path.basename(dbPath);

      const files = fs.readdirSync(dbDir);
      const backupFiles = files
        .filter((file) => file.startsWith(`${dbName}.backup.`))
        .map((file) => ({
          name: file,
          path: path.join(dbDir, file),
          time: fs.statSync(path.join(dbDir, file)).mtime.getTime(),
        }))
        .sort((a, b) => b.time - a.time);

      const maxBackups = this.config.database.maxBackups || 7;
      const toDelete = backupFiles.slice(maxBackups);

      for (const file of toDelete) {
        fs.unlinkSync(file.path);
        logger.info(`[AppConfig] Deleted old backup: ${file.name}`);
      }
    } catch (error) {
      logger.error("[AppConfig] Failed to cleanup backups:", error);
    }
  }

  listBackups() {
    const logger = getLogger();
    try {
      const dbPath = this.getDatabasePath();
      const dbDir = path.dirname(dbPath);
      const dbName = path.basename(dbPath);

      const files = fs.readdirSync(dbDir);
      return files
        .filter((file) => file.startsWith(`${dbName}.backup.`))
        .map((file) => {
          const filePath = path.join(dbDir, file);
          const stats = fs.statSync(filePath);
          return {
            name: file,
            path: filePath,
            size: stats.size,
            created: stats.mtime,
          };
        })
        .sort((a, b) => b.created - a.created);
    } catch (error) {
      logger.error("[AppConfig] Failed to list backups:", error);
      return [];
    }
  }

  restoreFromBackup(backupPath) {
    const logger = getLogger();
    const dbPath = this.getDatabasePath();

    if (!fs.existsSync(backupPath)) {
      throw new Error("Backup file does not exist");
    }

    if (fs.existsSync(dbPath)) {
      const tempBackup = `${dbPath}.temp.${Date.now()}`;
      fs.copyFileSync(dbPath, tempBackup);
    }

    fs.copyFileSync(backupPath, dbPath);
    logger.info(`[AppConfig] Database restored from: ${backupPath}`);
    return true;
  }

  applyInitialSetup(initialConfig) {
    const logger = getLogger();
    logger.info("[AppConfig] Applying initial setup:", initialConfig);

    if (initialConfig.paths?.database) {
      this.setDatabasePath(initialConfig.paths.database);
    }
    if (initialConfig.edition) {
      this.set("app.edition", initialConfig.edition);
    }
    if (initialConfig.paths?.projectRoot) {
      this.set("project.rootPath", initialConfig.paths.projectRoot);
    }

    this.save();
  }
}

let instance = null;

function getAppConfig(options) {
  if (!instance) {
    instance = new AppConfigManager(options);
    instance.load();
  }
  return instance;
}

module.exports = {
  AppConfigManager,
  getAppConfig,
  DEFAULT_CONFIG,
  setPathResolvers,
};

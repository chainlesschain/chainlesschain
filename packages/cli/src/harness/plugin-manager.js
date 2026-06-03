/**
 * Plugin Manager — Plugin installation, management, and marketplace for CLI.
 * Manages plugin lifecycle: install, enable, disable, remove, update.
 *
 * Canonical location (moved from src/lib/plugin-manager.js as part of the
 * CLI Runtime Convergence roadmap, Phase 4). src/lib/plugin-manager.js is
 * now a thin re-export shim for backwards compatibility.
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { getElectronUserDataDir } from "../lib/paths.js";

/**
 * Ensure plugin tables exist.
 */
export function ensurePluginTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS plugins (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      version TEXT NOT NULL,
      description TEXT,
      author TEXT,
      homepage TEXT,
      entry_point TEXT,
      permissions TEXT,
      status TEXT DEFAULT 'installed',
      enabled INTEGER DEFAULT 1,
      install_path TEXT,
      installed_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS plugin_settings (
      id TEXT PRIMARY KEY,
      plugin_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS plugin_skills (
      id TEXT PRIMARY KEY,
      plugin_name TEXT NOT NULL,
      skill_name TEXT NOT NULL,
      skill_path TEXT NOT NULL,
      installed_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS plugin_registry (
      name TEXT PRIMARY KEY,
      latest_version TEXT,
      description TEXT,
      author TEXT,
      downloads INTEGER DEFAULT 0,
      rating REAL DEFAULT 0,
      tags TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

/**
 * Install a plugin (record in DB).
 */
export function installPlugin(db, pluginInfo) {
  ensurePluginTables(db);
  const {
    name,
    version,
    description,
    author,
    homepage,
    entryPoint,
    permissions,
    installPath,
  } = pluginInfo;

  if (!name || !version) {
    throw new Error("Plugin name and version are required");
  }

  // Check if already installed
  const existing = getPlugin(db, name);
  if (existing) {
    throw new Error(`Plugin already installed: ${name}`);
  }

  const id = `plugin-${crypto.randomBytes(8).toString("hex")}`;

  db.prepare(
    `INSERT INTO plugins (id, name, version, description, author, homepage, entry_point, permissions, status, enabled, install_path)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    name,
    version,
    description || null,
    author || null,
    homepage || null,
    entryPoint || null,
    permissions ? JSON.stringify(permissions) : null,
    "installed",
    1,
    installPath || null,
  );

  return {
    id,
    name,
    version,
    description,
    author,
    status: "installed",
    enabled: true,
  };
}

/**
 * Get a plugin by name.
 */
export function getPlugin(db, name) {
  ensurePluginTables(db);
  return db.prepare("SELECT * FROM plugins WHERE name = ?").get(name);
}

/**
 * Get a plugin by ID.
 */
export function getPluginById(db, pluginId) {
  ensurePluginTables(db);
  return db.prepare("SELECT * FROM plugins WHERE id = ?").get(pluginId);
}

/**
 * List all installed plugins.
 */
export function listPlugins(db, options = {}) {
  ensurePluginTables(db);
  const { enabledOnly = false } = options;

  if (enabledOnly) {
    return db
      .prepare("SELECT * FROM plugins WHERE enabled = 1 ORDER BY name ASC")
      .all();
  }
  return db.prepare("SELECT * FROM plugins ORDER BY name ASC").all();
}

/**
 * Enable a plugin.
 */
export function enablePlugin(db, name) {
  ensurePluginTables(db);
  const result = db
    .prepare("UPDATE plugins SET enabled = ?, status = ? WHERE name = ?")
    .run(1, "installed", name);
  return result.changes > 0;
}

/**
 * Disable a plugin.
 */
export function disablePlugin(db, name) {
  ensurePluginTables(db);
  const result = db
    .prepare("UPDATE plugins SET enabled = ?, status = ? WHERE name = ?")
    .run(0, "disabled", name);
  return result.changes > 0;
}

/**
 * Remove (uninstall) a plugin.
 */
export function removePlugin(db, name) {
  ensurePluginTables(db);
  // Remove settings first
  const plugin = getPlugin(db, name);
  if (!plugin) return false;

  db.prepare("DELETE FROM plugin_settings WHERE plugin_id = ?").run(plugin.id);
  const result = db.prepare("DELETE FROM plugins WHERE name = ?").run(name);
  return result.changes > 0;
}

/**
 * Update a plugin version.
 */
export function updatePlugin(db, name, newVersion) {
  ensurePluginTables(db);
  const result = db
    .prepare(
      "UPDATE plugins SET version = ?, updated_at = datetime('now') WHERE name = ?",
    )
    .run(newVersion, name);
  return result.changes > 0;
}

/**
 * Set a plugin setting.
 */
export function setPluginSetting(db, pluginName, key, value) {
  ensurePluginTables(db);
  const plugin = getPlugin(db, pluginName);
  if (!plugin) throw new Error(`Plugin not found: ${pluginName}`);

  // Remove existing setting for this key
  db.prepare("DELETE FROM plugin_settings WHERE plugin_id = ? AND key = ?").run(
    plugin.id,
    key,
  );
  const settingId = `ps-${crypto.randomBytes(4).toString("hex")}`;
  db.prepare(
    `INSERT INTO plugin_settings (id, plugin_id, key, value) VALUES (?, ?, ?, ?)`,
  ).run(
    settingId,
    plugin.id,
    key,
    typeof value === "string" ? value : JSON.stringify(value),
  );

  return true;
}

/**
 * Get a plugin setting.
 */
export function getPluginSetting(db, pluginName, key) {
  ensurePluginTables(db);
  const plugin = getPlugin(db, pluginName);
  if (!plugin) return null;

  const row = db
    .prepare(
      "SELECT value FROM plugin_settings WHERE plugin_id = ? AND key = ?",
    )
    .get(plugin.id, key);
  return row ? row.value : null;
}

/**
 * Get all settings for a plugin.
 */
export function getPluginSettings(db, pluginName) {
  ensurePluginTables(db);
  const plugin = getPlugin(db, pluginName);
  if (!plugin) return {};

  const rows = db
    .prepare("SELECT key, value FROM plugin_settings WHERE plugin_id = ?")
    .all(plugin.id);
  const settings = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  return settings;
}

// ─── Registry / Marketplace ─────────────────────────────

/**
 * Add/update a plugin in the registry.
 */
export function registerInMarketplace(db, pluginInfo) {
  ensurePluginTables(db);
  const { name, latestVersion, description, author, tags } = pluginInfo;

  db.prepare(
    `INSERT OR REPLACE INTO plugin_registry (name, latest_version, description, author, tags)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    name,
    latestVersion,
    description || null,
    author || null,
    tags ? JSON.stringify(tags) : null,
  );

  return { name, latestVersion, description, author };
}

/**
 * Search plugins in registry.
 */
export function searchRegistry(db, query) {
  ensurePluginTables(db);
  return db
    .prepare(
      "SELECT * FROM plugin_registry WHERE name LIKE ? OR description LIKE ? ORDER BY downloads DESC",
    )
    .all(`%${query}%`, `%${query}%`);
}

/**
 * List all registry plugins.
 */
export function listRegistry(db) {
  ensurePluginTables(db);
  return db
    .prepare("SELECT * FROM plugin_registry ORDER BY downloads DESC")
    .all();
}

/**
 * Get plugin summary.
 */
export function getPluginSummary(db) {
  ensurePluginTables(db);
  const total = db.prepare("SELECT COUNT(*) as c FROM plugins").get();
  const enabled = db
    .prepare("SELECT COUNT(*) as c FROM plugins WHERE enabled = ?")
    .get(1);
  const registry = db
    .prepare("SELECT COUNT(*) as c FROM plugin_registry")
    .get();

  return {
    installed: total?.c || 0,
    enabled: enabled?.c || 0,
    registryCount: registry?.c || 0,
  };
}

// ─── Plugin Skills ──────────────────────────────────────

/**
 * Get the marketplace skills directory
 */
function getMarketplaceSkillsDir() {
  return path.join(getElectronUserDataDir(), "marketplace", "skills");
}

/**
 * Install skills from a plugin manifest.
 * Copies skill directories to the marketplace/skills/ layer.
 *
 * @param {object} db - Database instance
 * @param {string} pluginName - Plugin name
 * @param {string} pluginPath - Root path of the plugin package
 * @param {{ name: string, path: string }[]} skills - Skills declared in manifest
 * @returns {{ installed: string[] }} Names of installed skills
 */
export function installPluginSkills(db, pluginName, pluginPath, skills) {
  ensurePluginTables(db);
  if (!skills || skills.length === 0) return { installed: [] };

  const marketplaceDir = getMarketplaceSkillsDir();
  const installed = [];

  for (const skill of skills) {
    const srcDir = path.resolve(pluginPath, skill.path);
    if (!fs.existsSync(srcDir)) continue;

    const destDir = path.join(marketplaceDir, skill.name);
    fs.mkdirSync(destDir, { recursive: true });

    // Copy skill files
    _copyDirSync(srcDir, destDir);

    // Record in DB
    const id = `ps-${crypto.randomBytes(6).toString("hex")}`;
    db.prepare(
      `INSERT OR REPLACE INTO plugin_skills (id, plugin_name, skill_name, skill_path)
       VALUES (?, ?, ?, ?)`,
    ).run(id, pluginName, skill.name, destDir);

    installed.push(skill.name);
  }

  return { installed };
}

/**
 * Remove all skills installed by a plugin.
 *
 * @param {object} db - Database instance
 * @param {string} pluginName - Plugin name
 * @returns {{ removed: string[] }} Names of removed skills
 */
export function removePluginSkills(db, pluginName) {
  ensurePluginTables(db);
  const rows = db
    .prepare("SELECT * FROM plugin_skills WHERE plugin_name = ?")
    .all(pluginName);

  const removed = [];
  for (const row of rows) {
    // Remove the skill directory
    if (fs.existsSync(row.skill_path)) {
      fs.rmSync(row.skill_path, { recursive: true, force: true });
    }
    removed.push(row.skill_name);
  }

  db.prepare("DELETE FROM plugin_skills WHERE plugin_name = ?").run(pluginName);
  return { removed };
}

/**
 * List skills installed by a specific plugin.
 *
 * @param {object} db - Database instance
 * @param {string} pluginName - Plugin name
 * @returns {{ skill_name: string, skill_path: string }[]}
 */
export function getPluginSkills(db, pluginName) {
  ensurePluginTables(db);
  return db
    .prepare(
      "SELECT skill_name, skill_path FROM plugin_skills WHERE plugin_name = ?",
    )
    .all(pluginName);
}

/**
 * Recursively copy a directory
 */
function _copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      _copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Low-Code App Builder — create, design, preview, publish, and manage
 * low-code applications with built-in components and data sources.
 */

import crypto from "crypto";

/** @type {Map<string, object>} In-memory app cache */
const _apps = new Map();

/** @type {Map<string, object>} In-memory data sources */
const _dataSources = new Map();

/** @type {Map<string, object[]>} In-memory version history */
const _versions = new Map();

/** @type {object[]|null} Cached built-in component list */
let _components = null;

/**
 * Return the 15 built-in components, initializing on first call.
 *
 * @returns {object[]}
 */
export function listComponents() {
  if (!_components) {
    _components = [
      {
        name: "Form",
        category: "input",
        props: ["fields", "onSubmit", "validation"],
      },
      {
        name: "DataTable",
        category: "display",
        props: ["columns", "data", "pagination", "sortable"],
      },
      {
        name: "BarChart",
        category: "chart",
        props: ["data", "xAxis", "yAxis", "colors"],
      },
      {
        name: "LineChart",
        category: "chart",
        props: ["data", "xAxis", "yAxis", "smooth"],
      },
      {
        name: "PieChart",
        category: "chart",
        props: ["data", "labels", "colors"],
      },
      {
        name: "Dashboard",
        category: "layout",
        props: ["widgets", "layout", "refreshInterval"],
      },
      {
        name: "Button",
        category: "input",
        props: ["label", "onClick", "variant", "disabled"],
      },
      {
        name: "TextInput",
        category: "input",
        props: ["placeholder", "value", "onChange", "type"],
      },
      {
        name: "Select",
        category: "input",
        props: ["options", "value", "onChange", "multiple"],
      },
      {
        name: "Modal",
        category: "overlay",
        props: ["visible", "title", "onClose", "width"],
      },
      {
        name: "Card",
        category: "layout",
        props: ["title", "content", "footer"],
      },
      {
        name: "List",
        category: "display",
        props: ["items", "renderItem", "pagination"],
      },
      {
        name: "Image",
        category: "display",
        props: ["src", "alt", "width", "height"],
      },
      {
        name: "Tabs",
        category: "layout",
        props: ["tabs", "activeKey", "onChange"],
      },
      {
        name: "Calendar",
        category: "display",
        props: ["events", "view", "onSelect"],
      },
    ];
  }
  return _components;
}

/**
 * Ensure low-code tables exist in the database.
 *
 * @param {object} db
 */
export function ensureLowcodeTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS lowcode_apps (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      design TEXT,
      status TEXT DEFAULT 'draft',
      version INTEGER DEFAULT 1,
      platform TEXT DEFAULT 'web',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS lowcode_datasources (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      config TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS lowcode_versions (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      snapshot TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

/**
 * Create a new low-code application.
 *
 * @param {object} db
 * @param {{ name: string, description?: string, platform?: string, design?: object }} definition
 * @returns {{ id: string, name: string, status: string }}
 */
export function createApp(db, definition) {
  const id = crypto.randomUUID().slice(0, 12);
  const name = definition.name || "Untitled App";
  const description = definition.description || "";
  const platform = definition.platform || "web";
  const design = definition.design || { components: [], layout: {} };

  const stmt = db.prepare(
    `INSERT INTO lowcode_apps (id, name, description, design, status, version, platform)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  stmt.run(id, name, description, JSON.stringify(design), "draft", 1, platform);

  const app = {
    id,
    name,
    description,
    platform,
    design,
    status: "draft",
    version: 1,
  };
  _apps.set(id, app);

  // Create initial version snapshot
  const versionId = crypto.randomUUID().slice(0, 12);
  const vStmt = db.prepare(
    `INSERT INTO lowcode_versions (id, app_id, version, snapshot)
     VALUES (?, ?, ?, ?)`,
  );
  vStmt.run(versionId, id, 1, JSON.stringify(design));

  if (!_versions.has(id)) _versions.set(id, []);
  _versions
    .get(id)
    .push({ id: versionId, app_id: id, version: 1, snapshot: design });

  return { id, name, status: "draft" };
}

/**
 * Save a new design for an app, bump the version, and create a snapshot.
 *
 * @param {object} db
 * @param {string} appId
 * @param {object} design
 * @returns {{ appId: string, version: number }}
 */
export function saveDesign(db, appId, design) {
  // Get current version
  const row = db
    .prepare(`SELECT version FROM lowcode_apps WHERE id = ?`)
    .get(appId);
  const currentVersion = row ? row.version || 1 : 1;
  const newVersion = currentVersion + 1;

  db.prepare(
    `UPDATE lowcode_apps SET design = ?, version = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(JSON.stringify(design), newVersion, appId);

  // Create version snapshot
  const versionId = crypto.randomUUID().slice(0, 12);
  db.prepare(
    `INSERT INTO lowcode_versions (id, app_id, version, snapshot) VALUES (?, ?, ?, ?)`,
  ).run(versionId, appId, newVersion, JSON.stringify(design));

  if (!_versions.has(appId)) _versions.set(appId, []);
  _versions
    .get(appId)
    .push({
      id: versionId,
      app_id: appId,
      version: newVersion,
      snapshot: design,
    });

  if (_apps.has(appId)) {
    _apps.get(appId).design = design;
    _apps.get(appId).version = newVersion;
  }

  return { appId, version: newVersion };
}

/**
 * Get preview info for an application.
 *
 * @param {string} appId
 * @returns {{ appId: string, design: object, previewUrl: string, platform: string }}
 */
export function previewApp(appId) {
  const app = _apps.get(appId);
  const design = app ? app.design : { components: [], layout: {} };
  const platform = app ? app.platform : "web";

  return {
    appId,
    design,
    previewUrl: `http://localhost:5173/lowcode/preview/${appId}`,
    platform,
  };
}

/**
 * Publish an application (set status to 'published').
 *
 * @param {object} db
 * @param {string} appId
 * @returns {{ appId: string, status: string }}
 */
export function publishApp(db, appId) {
  db.prepare(
    `UPDATE lowcode_apps SET status = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run("published", appId);

  if (_apps.has(appId)) {
    _apps.get(appId).status = "published";
  }

  return { appId, status: "published" };
}

/**
 * Add a data source to an application.
 *
 * @param {object} db
 * @param {string} appId
 * @param {string} name
 * @param {string} type - e.g. "rest", "graphql", "database", "csv"
 * @param {object} config
 * @returns {{ id: string, appId: string, name: string, type: string }}
 */
export function addDataSource(db, appId, name, type, config) {
  const id = crypto.randomUUID().slice(0, 12);
  const stmt = db.prepare(
    `INSERT INTO lowcode_datasources (id, app_id, name, type, config, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  stmt.run(id, appId, name, type, JSON.stringify(config || {}), "active");

  _dataSources.set(id, { id, appId, name, type, config, status: "active" });

  return { id, appId, name, type };
}

/**
 * Get version history for an application.
 *
 * @param {string} appId
 * @returns {object[]}
 */
export function getVersions(appId) {
  return _versions.get(appId) || [];
}

/**
 * Rollback an application to a previous version.
 *
 * @param {object} db
 * @param {string} appId
 * @param {number} version
 * @returns {{ appId: string, version: number, restored: boolean }}
 */
export function rollbackApp(db, appId, version) {
  const versions = _versions.get(appId) || [];
  const target = versions.find((v) => v.version === version);

  if (!target) {
    return { appId, version, restored: false };
  }

  const design = target.snapshot;
  db.prepare(
    `UPDATE lowcode_apps SET design = ?, version = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(JSON.stringify(design), version, appId);

  if (_apps.has(appId)) {
    _apps.get(appId).design = design;
    _apps.get(appId).version = version;
  }

  return { appId, version, restored: true };
}

/**
 * Export an app definition with data sources.
 *
 * @param {string} appId
 * @returns {{ appId: string, app: object|null, dataSources: object[], versions: object[] }}
 */
export function exportApp(appId) {
  const app = _apps.get(appId) || null;
  const dataSources = [];
  for (const [, ds] of _dataSources) {
    if (ds.appId === appId) dataSources.push(ds);
  }
  const versions = _versions.get(appId) || [];

  return { appId, app, dataSources, versions };
}

/**
 * List all applications from the database.
 *
 * @param {object} db
 * @returns {object[]}
 */
export function listApps(db) {
  const rows = db
    .prepare(`SELECT * FROM lowcode_apps ORDER BY updated_at DESC`)
    .all();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    status: r.status,
    version: r.version,
    platform: r.platform,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
}

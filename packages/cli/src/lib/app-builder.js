/**
 * Low-Code App Builder — create, design, preview, publish, and manage
 * low-code applications with built-in components and data sources.
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";

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
  _versions.get(appId).push({
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

/**
 * Get a single application by ID from the database.
 *
 * @param {object} db
 * @param {string} appId
 * @returns {object|null}
 */
export function getApp(db, appId) {
  const row = db.prepare(`SELECT * FROM lowcode_apps WHERE id = ?`).get(appId);
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    design: row.design
      ? JSON.parse(row.design)
      : { components: [], layout: {} },
    status: row.status,
    version: row.version,
    platform: row.platform,
  };
}

/**
 * Generate a static HTML bundle string for an app's design.
 *
 * @param {object} app - App object with design
 * @returns {{ "index.html": string, "app.js": string, "style.css": string }}
 */
function generateStaticBundle(app) {
  const design = app.design || { components: [], layout: {} };
  const components = design.components || [];

  const componentHtml = components
    .map(
      (c, i) =>
        `    <div class="lc-component lc-${(c.type || c.name || "widget").toLowerCase()}" id="comp-${i}">${c.label || c.type || c.name || "Component"}</div>`,
    )
    .join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${app.name || "Low-Code App"}</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div id="app">
    <h1>${app.name || "Low-Code App"}</h1>
    <p>${app.description || ""}</p>
    <div class="lc-container">
${componentHtml || "      <p>No components defined</p>"}
    </div>
  </div>
  <script src="app.js"><\/script>
</body>
</html>`;

  const css = `/* Generated by ChainlessChain Low-Code Platform */
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 24px; background: #f5f5f5; }
#app { max-width: 1200px; margin: 0 auto; }
h1 { margin-bottom: 8px; color: #1a1a1a; }
p { margin-bottom: 16px; color: #666; }
.lc-container { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; }
.lc-component { background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px; }
`;

  const js = `// Generated by ChainlessChain Low-Code Platform
// App: ${app.name || "Untitled"} v${app.version || 1}
(function() {
  console.log("Low-Code App initialized: ${app.name || "Untitled"}");
  var config = ${JSON.stringify({ id: app.id, name: app.name, version: app.version, platform: app.platform })};
  document.querySelectorAll(".lc-component").forEach(function(el) {
    el.addEventListener("click", function() { el.classList.toggle("active"); });
  });
})();
`;

  return { "index.html": html, "app.js": js, "style.css": css };
}

/**
 * Deploy an application by generating a static bundle and writing it to disk.
 *
 * @param {object} db
 * @param {string} appId
 * @param {{ outputDir?: string }} options
 * @returns {{ appId: string, outputDir: string, files: string[], deployedAt: string }}
 */
export function deployApp(db, appId, options = {}) {
  const app = getApp(db, appId);
  if (!app) {
    throw new Error(`App '${appId}' not found`);
  }
  if (app.status !== "published") {
    throw new Error(
      `App '${appId}' must be published before deploying (current status: ${app.status})`,
    );
  }

  const outputDir =
    options.outputDir ||
    path.join(process.cwd(), ".chainlesschain", "deploys", appId);
  fs.mkdirSync(outputDir, { recursive: true });

  const bundle = generateStaticBundle(app);
  const fileNames = [];
  for (const [fileName, content] of Object.entries(bundle)) {
    fs.writeFileSync(path.join(outputDir, fileName), content, "utf-8");
    fileNames.push(fileName);
  }

  // Update app status to deployed
  db.prepare(
    `UPDATE lowcode_apps SET status = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run("deployed", appId);

  if (_apps.has(appId)) {
    _apps.get(appId).status = "deployed";
  }

  const deployedAt = new Date().toISOString();
  return { appId, outputDir, files: fileNames, deployedAt };
}

// ─── Phase 93 V2 surface (strictly additive) ───────────────────────────

export const COMPONENT_CATEGORY = Object.freeze({
  INPUT: "input",
  DISPLAY: "display",
  CHART: "chart",
  LAYOUT: "layout",
  OVERLAY: "overlay",
});

export const DATASOURCE_TYPE = Object.freeze({
  REST: "rest",
  GRAPHQL: "graphql",
  DATABASE: "database",
  CSV: "csv",
});

export const APP_STATUS = Object.freeze({
  DRAFT: "draft",
  PUBLISHED: "published",
  ARCHIVED: "archived",
});

const _allowedStatusTransitions = Object.freeze({
  draft: new Set(["published", "archived"]),
  published: new Set(["draft", "archived"]),
  archived: new Set(["draft"]),
});

const _v2DataSources = new Map();
const _v2StatusHistory = new Map();

function _isValidStatusTransition(from, to) {
  if (from === to) return true;
  const allowed = _allowedStatusTransitions[from];
  return !!(allowed && allowed.has(to));
}

export function listComponentsV2({ category } = {}) {
  const all = listComponents();
  if (!category) return all.map((c) => ({ ...c }));
  const valid = Object.values(COMPONENT_CATEGORY);
  if (!valid.includes(category)) {
    throw new Error(
      `Invalid category '${category}'. Expected one of ${valid.join(", ")}`,
    );
  }
  return all.filter((c) => c.category === category).map((c) => ({ ...c }));
}

export function registerDataSourceV2(db, { appId, name, type, config = {} }) {
  const valid = Object.values(DATASOURCE_TYPE);
  if (!valid.includes(type)) {
    throw new Error(
      `Invalid datasource type '${type}'. Expected one of ${valid.join(", ")}`,
    );
  }
  if (!appId) throw new Error("appId is required");
  if (!name) throw new Error("name is required");

  const result = addDataSource(db, appId, name, type, config);
  _v2DataSources.set(result.id, { ...result, config, validated: false });
  return result;
}

export function testDataSourceConnection(dataSourceId) {
  const ds = _v2DataSources.get(dataSourceId);
  if (!ds) {
    return { dataSourceId, ok: false, reason: "datasource not found" };
  }
  const config = ds.config || {};
  let ok = false;
  let reason = "";
  switch (ds.type) {
    case DATASOURCE_TYPE.REST:
      ok = typeof config.url === "string" && config.url.length > 0;
      reason = ok ? "ok" : "missing url";
      break;
    case DATASOURCE_TYPE.GRAPHQL:
      ok = typeof config.endpoint === "string" && config.endpoint.length > 0;
      reason = ok ? "ok" : "missing endpoint";
      break;
    case DATASOURCE_TYPE.DATABASE:
      ok = typeof config.host === "string" && config.host.length > 0;
      reason = ok ? "ok" : "missing host";
      break;
    case DATASOURCE_TYPE.CSV:
      ok = typeof config.path === "string" && config.path.length > 0;
      reason = ok ? "ok" : "missing path";
      break;
    default:
      reason = "unknown type";
  }
  if (ok) {
    ds.validated = true;
    _v2DataSources.set(dataSourceId, ds);
  }
  return { dataSourceId, type: ds.type, ok, reason };
}

export function updateAppStatus(db, { appId, status }) {
  const valid = Object.values(APP_STATUS);
  if (!valid.includes(status)) {
    throw new Error(
      `Invalid status '${status}'. Expected one of ${valid.join(", ")}`,
    );
  }
  const app = getApp(db, appId);
  if (!app) throw new Error(`App '${appId}' not found`);

  const currentStatus =
    app.status === "deployed" ? APP_STATUS.PUBLISHED : app.status;
  if (!_isValidStatusTransition(currentStatus, status)) {
    throw new Error(`Invalid status transition: ${currentStatus} → ${status}`);
  }

  db.prepare(
    `UPDATE lowcode_apps SET status = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(status, appId);
  if (_apps.has(appId)) _apps.get(appId).status = status;

  const hist = _v2StatusHistory.get(appId) || [];
  hist.push({
    from: currentStatus,
    to: status,
    at: new Date().toISOString(),
  });
  _v2StatusHistory.set(appId, hist);
  return { appId, status, previous: currentStatus };
}

export function archiveApp(db, appId) {
  return updateAppStatus(db, { appId, status: APP_STATUS.ARCHIVED });
}

export function getStatusHistory(appId) {
  return (_v2StatusHistory.get(appId) || []).slice();
}

export function cloneApp(db, { sourceId, newName }) {
  const source = getApp(db, sourceId);
  if (!source) throw new Error(`App '${sourceId}' not found`);
  const cloned = createApp(db, {
    name: newName || `${source.name} (Copy)`,
    description: source.description,
    platform: source.platform,
    design: source.design,
  });
  // Persist the copied design so version snapshot matches source
  if (
    source.design &&
    source.design.components &&
    source.design.components.length > 0
  ) {
    saveDesign(db, cloned.id, source.design);
  }
  return { sourceId, clonedId: cloned.id, name: cloned.name };
}

export function exportAppJSON(db, appId) {
  const app = getApp(db, appId);
  if (!app) throw new Error(`App '${appId}' not found`);
  const legacy = exportApp(appId);
  return {
    schema: "chainlesschain.lowcode.v2",
    exportedAt: new Date().toISOString(),
    app,
    dataSources: legacy.dataSources,
    versions: legacy.versions,
  };
}

export function importAppJSON(db, json) {
  if (!json || typeof json !== "object") {
    throw new Error("import payload must be a JSON object");
  }
  if (json.schema !== "chainlesschain.lowcode.v2") {
    throw new Error(
      `unsupported schema '${json.schema}'. Expected 'chainlesschain.lowcode.v2'`,
    );
  }
  if (!json.app || !json.app.name) {
    throw new Error("import payload missing app.name");
  }
  const imported = createApp(db, {
    name: json.app.name,
    description: json.app.description || "",
    platform: json.app.platform || "web",
    design: json.app.design || { components: [], layout: {} },
  });
  let dsCount = 0;
  for (const ds of json.dataSources || []) {
    if (!ds.type || !ds.name) continue;
    if (!Object.values(DATASOURCE_TYPE).includes(ds.type)) continue;
    registerDataSourceV2(db, {
      appId: imported.id,
      name: ds.name,
      type: ds.type,
      config: ds.config || {},
    });
    dsCount++;
  }
  return { importedId: imported.id, name: imported.name, dataSources: dsCount };
}

export function getLowcodeStatsV2(db) {
  const rows = db.prepare(`SELECT status, platform FROM lowcode_apps`).all();
  const byStatus = { draft: 0, published: 0, archived: 0, deployed: 0 };
  const byPlatform = {};
  for (const r of rows) {
    const s = r.status || "draft";
    byStatus[s] = (byStatus[s] || 0) + 1;
    const p = r.platform || "web";
    byPlatform[p] = (byPlatform[p] || 0) + 1;
  }

  const dsRows = db.prepare(`SELECT type FROM lowcode_datasources`).all();
  const byDataSourceType = {};
  for (const r of dsRows) {
    byDataSourceType[r.type] = (byDataSourceType[r.type] || 0) + 1;
  }

  return {
    totalApps: rows.length,
    byStatus,
    byPlatform,
    dataSources: {
      total: dsRows.length,
      byType: byDataSourceType,
    },
    componentsAvailable: listComponents().length,
  };
}

export function _resetV2State() {
  _v2DataSources.clear();
  _v2StatusHistory.clear();
}

// ===== V2 Surface: App Builder governance overlay (CLI v0.138.0) =====
export const APP_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  PAUSED: "paused",
  ARCHIVED: "archived",
});
export const APP_BUILD_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  BUILDING: "building",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

const _appTrans = new Map([
  [
    APP_MATURITY_V2.PENDING,
    new Set([APP_MATURITY_V2.ACTIVE, APP_MATURITY_V2.ARCHIVED]),
  ],
  [
    APP_MATURITY_V2.ACTIVE,
    new Set([APP_MATURITY_V2.PAUSED, APP_MATURITY_V2.ARCHIVED]),
  ],
  [
    APP_MATURITY_V2.PAUSED,
    new Set([APP_MATURITY_V2.ACTIVE, APP_MATURITY_V2.ARCHIVED]),
  ],
  [APP_MATURITY_V2.ARCHIVED, new Set()],
]);
const _appTerminal = new Set([APP_MATURITY_V2.ARCHIVED]);
const _appBuildTrans = new Map([
  [
    APP_BUILD_LIFECYCLE_V2.QUEUED,
    new Set([
      APP_BUILD_LIFECYCLE_V2.BUILDING,
      APP_BUILD_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    APP_BUILD_LIFECYCLE_V2.BUILDING,
    new Set([
      APP_BUILD_LIFECYCLE_V2.SUCCEEDED,
      APP_BUILD_LIFECYCLE_V2.FAILED,
      APP_BUILD_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [APP_BUILD_LIFECYCLE_V2.SUCCEEDED, new Set()],
  [APP_BUILD_LIFECYCLE_V2.FAILED, new Set()],
  [APP_BUILD_LIFECYCLE_V2.CANCELLED, new Set()],
]);

const _appsV2 = new Map();
const _appBuilds = new Map();
let _appMaxActivePerOwner = 10;
let _appMaxPendingBuildsPerApp = 20;
let _appIdleMs = 30 * 24 * 60 * 60 * 1000;
let _appBuildStuckMs = 10 * 60 * 1000;

function _appPos(n, lbl) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${lbl} must be positive integer`);
  return v;
}

export function setMaxActiveAppsPerOwnerV2(n) {
  _appMaxActivePerOwner = _appPos(n, "maxActiveAppsPerOwner");
}
export function getMaxActiveAppsPerOwnerV2() {
  return _appMaxActivePerOwner;
}
export function setMaxPendingAppBuildsPerAppV2(n) {
  _appMaxPendingBuildsPerApp = _appPos(n, "maxPendingAppBuildsPerApp");
}
export function getMaxPendingAppBuildsPerAppV2() {
  return _appMaxPendingBuildsPerApp;
}
export function setAppIdleMsV2(n) {
  _appIdleMs = _appPos(n, "appIdleMs");
}
export function getAppIdleMsV2() {
  return _appIdleMs;
}
export function setAppBuildStuckMsV2(n) {
  _appBuildStuckMs = _appPos(n, "appBuildStuckMs");
}
export function getAppBuildStuckMsV2() {
  return _appBuildStuckMs;
}

export function _resetStateAppBuilderV2() {
  _appsV2.clear();
  _appBuilds.clear();
  _appMaxActivePerOwner = 10;
  _appMaxPendingBuildsPerApp = 20;
  _appIdleMs = 30 * 24 * 60 * 60 * 1000;
  _appBuildStuckMs = 10 * 60 * 1000;
}

export function registerAppV2({ id, owner, name, metadata } = {}) {
  if (!id || typeof id !== "string") throw new Error("id is required");
  if (!owner || typeof owner !== "string") throw new Error("owner is required");
  if (_appsV2.has(id)) throw new Error(`app ${id} already registered`);
  const now = Date.now();
  const a = {
    id,
    owner,
    name: name || id,
    status: APP_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    activatedAt: null,
    archivedAt: null,
    lastTouchedAt: now,
    metadata: { ...(metadata || {}) },
  };
  _appsV2.set(id, a);
  return { ...a, metadata: { ...a.metadata } };
}
function _appCheckA(from, to) {
  const a = _appTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid app transition ${from} → ${to}`);
}
function _appCountActive(owner) {
  let n = 0;
  for (const a of _appsV2.values())
    if (a.owner === owner && a.status === APP_MATURITY_V2.ACTIVE) n++;
  return n;
}

export function activateAppV2(id) {
  const a = _appsV2.get(id);
  if (!a) throw new Error(`app ${id} not found`);
  _appCheckA(a.status, APP_MATURITY_V2.ACTIVE);
  const recovery = a.status === APP_MATURITY_V2.PAUSED;
  if (!recovery) {
    const c = _appCountActive(a.owner);
    if (c >= _appMaxActivePerOwner)
      throw new Error(
        `max active apps per owner (${_appMaxActivePerOwner}) reached for ${a.owner}`,
      );
  }
  const now = Date.now();
  a.status = APP_MATURITY_V2.ACTIVE;
  a.updatedAt = now;
  a.lastTouchedAt = now;
  if (!a.activatedAt) a.activatedAt = now;
  return { ...a, metadata: { ...a.metadata } };
}
export function pauseAppV2(id) {
  const a = _appsV2.get(id);
  if (!a) throw new Error(`app ${id} not found`);
  _appCheckA(a.status, APP_MATURITY_V2.PAUSED);
  a.status = APP_MATURITY_V2.PAUSED;
  a.updatedAt = Date.now();
  return { ...a, metadata: { ...a.metadata } };
}
export function archiveAppV2(id) {
  const a = _appsV2.get(id);
  if (!a) throw new Error(`app ${id} not found`);
  _appCheckA(a.status, APP_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  a.status = APP_MATURITY_V2.ARCHIVED;
  a.updatedAt = now;
  if (!a.archivedAt) a.archivedAt = now;
  return { ...a, metadata: { ...a.metadata } };
}
export function touchAppV2(id) {
  const a = _appsV2.get(id);
  if (!a) throw new Error(`app ${id} not found`);
  if (_appTerminal.has(a.status))
    throw new Error(`cannot touch terminal app ${id}`);
  const now = Date.now();
  a.lastTouchedAt = now;
  a.updatedAt = now;
  return { ...a, metadata: { ...a.metadata } };
}
export function getAppV2(id) {
  const a = _appsV2.get(id);
  if (!a) return null;
  return { ...a, metadata: { ...a.metadata } };
}
export function listAppsV2() {
  return [..._appsV2.values()].map((a) => ({
    ...a,
    metadata: { ...a.metadata },
  }));
}

function _appCountPendingBuilds(appId) {
  let n = 0;
  for (const b of _appBuilds.values())
    if (
      b.appId === appId &&
      (b.status === APP_BUILD_LIFECYCLE_V2.QUEUED ||
        b.status === APP_BUILD_LIFECYCLE_V2.BUILDING)
    )
      n++;
  return n;
}

export function createAppBuildV2({ id, appId, target, metadata } = {}) {
  if (!id || typeof id !== "string") throw new Error("id is required");
  if (!appId || typeof appId !== "string") throw new Error("appId is required");
  if (_appBuilds.has(id)) throw new Error(`app build ${id} already exists`);
  if (!_appsV2.has(appId)) throw new Error(`app ${appId} not found`);
  const pending = _appCountPendingBuilds(appId);
  if (pending >= _appMaxPendingBuildsPerApp)
    throw new Error(
      `max pending app builds per app (${_appMaxPendingBuildsPerApp}) reached for ${appId}`,
    );
  const now = Date.now();
  const b = {
    id,
    appId,
    target: target || "web",
    status: APP_BUILD_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _appBuilds.set(id, b);
  return { ...b, metadata: { ...b.metadata } };
}
function _appCheckB(from, to) {
  const a = _appBuildTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid app build transition ${from} → ${to}`);
}
export function startAppBuildV2(id) {
  const b = _appBuilds.get(id);
  if (!b) throw new Error(`app build ${id} not found`);
  _appCheckB(b.status, APP_BUILD_LIFECYCLE_V2.BUILDING);
  const now = Date.now();
  b.status = APP_BUILD_LIFECYCLE_V2.BUILDING;
  b.updatedAt = now;
  if (!b.startedAt) b.startedAt = now;
  return { ...b, metadata: { ...b.metadata } };
}
export function succeedAppBuildV2(id) {
  const b = _appBuilds.get(id);
  if (!b) throw new Error(`app build ${id} not found`);
  _appCheckB(b.status, APP_BUILD_LIFECYCLE_V2.SUCCEEDED);
  const now = Date.now();
  b.status = APP_BUILD_LIFECYCLE_V2.SUCCEEDED;
  b.updatedAt = now;
  if (!b.settledAt) b.settledAt = now;
  return { ...b, metadata: { ...b.metadata } };
}
export function failAppBuildV2(id, reason) {
  const b = _appBuilds.get(id);
  if (!b) throw new Error(`app build ${id} not found`);
  _appCheckB(b.status, APP_BUILD_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  b.status = APP_BUILD_LIFECYCLE_V2.FAILED;
  b.updatedAt = now;
  if (!b.settledAt) b.settledAt = now;
  if (reason) b.metadata.failReason = String(reason);
  return { ...b, metadata: { ...b.metadata } };
}
export function cancelAppBuildV2(id, reason) {
  const b = _appBuilds.get(id);
  if (!b) throw new Error(`app build ${id} not found`);
  _appCheckB(b.status, APP_BUILD_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  b.status = APP_BUILD_LIFECYCLE_V2.CANCELLED;
  b.updatedAt = now;
  if (!b.settledAt) b.settledAt = now;
  if (reason) b.metadata.cancelReason = String(reason);
  return { ...b, metadata: { ...b.metadata } };
}
export function getAppBuildV2(id) {
  const b = _appBuilds.get(id);
  if (!b) return null;
  return { ...b, metadata: { ...b.metadata } };
}
export function listAppBuildsV2() {
  return [..._appBuilds.values()].map((b) => ({
    ...b,
    metadata: { ...b.metadata },
  }));
}

export function autoPauseIdleAppsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const a of _appsV2.values())
    if (
      a.status === APP_MATURITY_V2.ACTIVE &&
      t - a.lastTouchedAt >= _appIdleMs
    ) {
      a.status = APP_MATURITY_V2.PAUSED;
      a.updatedAt = t;
      flipped.push(a.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckAppBuildsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const b of _appBuilds.values())
    if (
      b.status === APP_BUILD_LIFECYCLE_V2.BUILDING &&
      b.startedAt != null &&
      t - b.startedAt >= _appBuildStuckMs
    ) {
      b.status = APP_BUILD_LIFECYCLE_V2.FAILED;
      b.updatedAt = t;
      if (!b.settledAt) b.settledAt = t;
      b.metadata.failReason = "auto-fail-stuck";
      flipped.push(b.id);
    }
  return { flipped, count: flipped.length };
}

export function getAppBuilderGovStatsV2() {
  const appsByStatus = {};
  for (const s of Object.values(APP_MATURITY_V2)) appsByStatus[s] = 0;
  for (const a of _appsV2.values()) appsByStatus[a.status]++;
  const buildsByStatus = {};
  for (const s of Object.values(APP_BUILD_LIFECYCLE_V2)) buildsByStatus[s] = 0;
  for (const b of _appBuilds.values()) buildsByStatus[b.status]++;
  return {
    totalAppsV2: _appsV2.size,
    totalAppBuildsV2: _appBuilds.size,
    maxActiveAppsPerOwner: _appMaxActivePerOwner,
    maxPendingAppBuildsPerApp: _appMaxPendingBuildsPerApp,
    appIdleMs: _appIdleMs,
    appBuildStuckMs: _appBuildStuckMs,
    appsByStatus,
    buildsByStatus,
  };
}

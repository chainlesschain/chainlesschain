/**
 * @module enterprise/low-code/app-builder
 * Phase 93: Visual app builder with drag-drop UI, logic orchestration, data connectors
 */
const EventEmitter = require("events");
const { logger } = require("../../utils/logger.js");
const { probeRestConnection } = require("./rest-connection-probe.js");

class AppBuilder extends EventEmitter {
  constructor() {
    super();
    this.db = null;
    this.initialized = false;
    this._apps = new Map();
    this._components = new Map();
    this._dataSources = new Map();
    this._versions = new Map();
  }

  async initialize(db, deps = {}) {
    if (this.initialized) {
      return;
    }
    this.db = db;
    this._ensureTables();
    this._loadDefaultComponents();
    await this._loadApps();
    this._loadVersions();
    this._loadDataSources();
    this.initialized = true;
    logger.info(
      `[AppBuilder] Initialized with ${this._apps.size} apps, ${this._components.size} components`,
    );
  }

  _ensureTables() {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS lowcode_apps (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
          design TEXT, status TEXT DEFAULT 'draft', version INTEGER DEFAULT 1,
          platform TEXT DEFAULT 'all', created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS lowcode_datasources (
          id TEXT PRIMARY KEY, app_id TEXT, name TEXT, type TEXT,
          config TEXT, status TEXT DEFAULT 'active', created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS lowcode_versions (
          id TEXT PRIMARY KEY, app_id TEXT, version INTEGER,
          snapshot TEXT, created_at TEXT DEFAULT (datetime('now'))
        );
      `);
    } catch (error) {
      logger.warn("[AppBuilder] Table creation warning:", error.message);
    }
  }

  _loadDefaultComponents() {
    const components = [
      {
        id: "form",
        name: "Form",
        category: "input",
        props: ["fields", "validation", "onSubmit"],
      },
      {
        id: "table",
        name: "Data Table",
        category: "display",
        props: ["columns", "dataSource", "pagination"],
      },
      {
        id: "chart-bar",
        name: "Bar Chart",
        category: "chart",
        props: ["data", "xAxis", "yAxis"],
      },
      {
        id: "chart-line",
        name: "Line Chart",
        category: "chart",
        props: ["data", "xAxis", "yAxis"],
      },
      {
        id: "chart-pie",
        name: "Pie Chart",
        category: "chart",
        props: ["data", "labels"],
      },
      {
        id: "dashboard",
        name: "Dashboard",
        category: "layout",
        props: ["widgets", "layout"],
      },
      {
        id: "button",
        name: "Button",
        category: "input",
        props: ["label", "onClick", "variant"],
      },
      {
        id: "text-input",
        name: "Text Input",
        category: "input",
        props: ["label", "placeholder", "validation"],
      },
      {
        id: "select",
        name: "Select",
        category: "input",
        props: ["options", "label", "multiple"],
      },
      {
        id: "modal",
        name: "Modal",
        category: "layout",
        props: ["title", "content", "actions"],
      },
      {
        id: "card",
        name: "Card",
        category: "layout",
        props: ["title", "content", "actions"],
      },
      {
        id: "list",
        name: "List",
        category: "display",
        props: ["items", "renderItem", "pagination"],
      },
      {
        id: "image",
        name: "Image",
        category: "media",
        props: ["src", "alt", "width"],
      },
      {
        id: "tabs",
        name: "Tabs",
        category: "layout",
        props: ["items", "activeKey"],
      },
      {
        id: "calendar",
        name: "Calendar",
        category: "display",
        props: ["events", "view"],
      },
    ];
    for (const c of components) {
      this._components.set(c.id, c);
    }
  }

  async _loadApps() {
    try {
      const rows = this.db.prepare("SELECT * FROM lowcode_apps").all();
      for (const row of rows) {
        // Per-row guard: one corrupt design JSON must not abort the loop and
        // silently drop every app ordered after it.
        try {
          this._apps.set(row.id, {
            ...row,
            design: JSON.parse(row.design || "{}"),
            // Older versions used "published" for a local design flag.
            status:
              row.status === "published" ? "design-published" : row.status,
          });
        } catch (rowErr) {
          logger.warn(
            `[AppBuilder] Skipping app ${row.id} with bad design JSON: ${rowErr.message}`,
          );
        }
      }
    } catch (error) {
      logger.warn("[AppBuilder] Failed to load apps:", error.message);
    }
  }

  // Versions are persisted by _saveVersion but were never reloaded on init, so
  // getVersions/rollback saw an empty Map after restart ("Version not found"
  // for versions that exist in the DB). Rehydrate _versions here.
  _loadVersions() {
    try {
      const rows = this.db
        .prepare("SELECT * FROM lowcode_versions ORDER BY version ASC")
        .all();
      for (const row of rows) {
        try {
          const entry = {
            id: row.id,
            appId: row.app_id,
            version: row.version,
            snapshot: JSON.parse(row.snapshot || "{}"),
          };
          if (!this._versions.has(row.app_id)) {
            this._versions.set(row.app_id, []);
          }
          this._versions.get(row.app_id).push(entry);
        } catch (rowErr) {
          logger.warn(
            `[AppBuilder] Skipping version ${row.id} with bad snapshot JSON: ${rowErr.message}`,
          );
        }
      }
    } catch (error) {
      // lowcode_versions may be absent on an older schema — non-fatal.
      logger.warn("[AppBuilder] Failed to load versions:", error.message);
    }
  }

  // Same as versions: data sources were write-only to the DB, so after restart
  // testConnection returned "DataSource not found" and exportApp lost them.
  _loadDataSources() {
    try {
      const rows = this.db.prepare("SELECT * FROM lowcode_datasources").all();
      for (const row of rows) {
        try {
          this._dataSources.set(row.id, {
            id: row.id,
            app_id: row.app_id,
            name: row.name,
            type: row.type,
            config: JSON.parse(row.config || "{}"),
            status: "configured",
          });
        } catch (rowErr) {
          logger.warn(
            `[AppBuilder] Skipping datasource ${row.id} with bad config JSON: ${rowErr.message}`,
          );
        }
      }
    } catch (error) {
      logger.warn("[AppBuilder] Failed to load datasources:", error.message);
    }
  }

  createApp(definition) {
    const id =
      definition.id ||
      `app-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const app = {
      id,
      name: definition.name || "Untitled App",
      description: definition.description || "",
      design: definition.design || { pages: [], components: [], logic: [] },
      status: "draft",
      version: 1,
      platform: definition.platform || "all",
    };
    this._apps.set(id, app);
    this._persistApp(app);
    this.emit("lowcode:app-created", { id, name: app.name });
    return { id, name: app.name, status: app.status };
  }

  saveDesign(appId, design) {
    const app = this._apps.get(appId);
    if (!app) {
      throw new Error("App not found");
    }
    app.design = design;
    app.version++;
    app.status = "draft";
    this._persistApp(app);
    this._saveVersion(appId, app.version, design);
    this.emit("lowcode:design-saved", { appId, version: app.version });
    return { appId, version: app.version };
  }

  preview(appId) {
    const app = this._apps.get(appId);
    if (!app) {
      throw new Error("App not found");
    }
    return {
      appId,
      design: app.design,
      previewUrl: null,
      platform: app.platform,
      status: "design-preview",
      deployed: false,
    };
  }

  publish(appId) {
    const app = this._apps.get(appId);
    if (!app) {
      throw new Error("App not found");
    }
    const previousStatus = app.status;
    app.status = "design-published";
    if (!this._persistApp(app)) {
      app.status = previousStatus;
      throw new Error("Design publication could not be persisted");
    }
    const result = {
      appId,
      status: app.status,
      version: app.version,
      publicationKind: "design",
      deployed: false,
      runtimeStatus: "unsupported",
    };
    this.emit("lowcode:design-published", result);
    return result;
  }

  listComponents() {
    return Array.from(this._components.values());
  }

  addDataSource(appId, name, type, config) {
    if (!this._apps.has(appId)) {
      throw new Error("App not found");
    }
    const id = `ds-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const ds = { id, app_id: appId, name, type, config, status: "configured" };
    try {
      this.db
        .prepare(
          "INSERT INTO lowcode_datasources (id, app_id, name, type, config, status) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(id, appId, name, type, JSON.stringify(config), ds.status);
    } catch (error) {
      logger.error("[AppBuilder] DataSource persistence failed");
      throw new Error("DataSource configuration could not be persisted");
    }
    this._dataSources.set(id, ds);
    return ds;
  }

  async testConnection(dataSourceId) {
    const ds = this._dataSources.get(dataSourceId);
    if (!ds) {
      return {
        success: false,
        status: "not-found",
        probed: false,
        error: "DataSource not found",
        errorCode: "DATASOURCE_NOT_FOUND",
      };
    }
    if (ds.type === "rest") {
      return {
        ...(await probeRestConnection(ds.config)),
        configured: true,
        dataSourceId,
        type: ds.type,
      };
    }
    return {
      success: false,
      status: "unsupported",
      configured: true,
      probed: false,
      dataSourceId,
      type: ds.type,
      error: "Connection probing is not available for this data source",
      errorCode: "DATASOURCE_PROBE_UNSUPPORTED",
    };
  }

  getVersions(appId) {
    return this._versions.get(appId) || [];
  }

  rollback(appId, version) {
    const versions = this._versions.get(appId) || [];
    const target = versions.find((v) => v.version === version);
    if (!target) {
      throw new Error("Version not found");
    }
    const app = this._apps.get(appId);
    if (!app) {
      throw new Error("App not found");
    }
    app.design = target.snapshot;
    app.version = version;
    app.status = "draft";
    this._persistApp(app);
    return { appId, restoredVersion: version };
  }

  exportApp(appId) {
    const app = this._apps.get(appId);
    if (!app) {
      return null;
    }
    const dataSources = Array.from(this._dataSources.values()).filter(
      (ds) => ds.app_id === appId,
    );
    return { ...app, dataSources, exportedAt: Date.now() };
  }

  _persistApp(app) {
    try {
      this.db
        .prepare(
          "INSERT OR REPLACE INTO lowcode_apps (id, name, description, design, status, version, platform, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))",
        )
        .run(
          app.id,
          app.name,
          app.description,
          JSON.stringify(app.design),
          app.status,
          app.version,
          app.platform,
        );
      return true;
    } catch (error) {
      logger.error("[AppBuilder] App persist failed:", error.message);
      return false;
    }
  }

  _saveVersion(appId, version, snapshot) {
    const id = `ver-${appId}-${version}`;
    const entry = { id, appId, version, snapshot };
    if (!this._versions.has(appId)) {
      this._versions.set(appId, []);
    }
    const verArr = this._versions.get(appId);
    verArr.push(entry);
    // Bound in-memory growth across a long editing session (the DB retains the
    // full history); 200 versions per app is far beyond practical use.
    if (verArr.length > 200) {
      verArr.shift();
    }
    try {
      this.db
        .prepare(
          "INSERT INTO lowcode_versions (id, app_id, version, snapshot) VALUES (?, ?, ?, ?)",
        )
        .run(id, appId, version, JSON.stringify(snapshot));
    } catch (error) {
      logger.error("[AppBuilder] Version persist failed:", error.message);
    }
  }
}

let instance = null;
function getAppBuilder() {
  if (!instance) {
    instance = new AppBuilder();
  }
  return instance;
}
module.exports = { AppBuilder, getAppBuilder };

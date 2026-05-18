import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  ensureLowcodeTables,
  createApp,
  saveDesign,
  previewApp,
  publishApp,
  listComponents,
  addDataSource,
  getVersions,
  rollbackApp,
  exportApp,
  listApps,
  getApp,
  deployApp,
  // V2 additions (Phase 93)
  COMPONENT_CATEGORY,
  DATASOURCE_TYPE,
  APP_STATUS,
  listComponentsV2,
  registerDataSourceV2,
  testDataSourceConnection,
  updateAppStatus,
  archiveApp,
  getStatusHistory,
  cloneApp,
  exportAppJSON,
  importAppJSON,
  getLowcodeStatsV2,
  _resetV2State,
} from "../../src/lib/app-builder.js";
import fs from "fs";
import path from "path";
import os from "os";

describe("app-builder", () => {
  let db;

  beforeEach(() => {
    db = new MockDatabase();
    ensureLowcodeTables(db);
    _resetV2State();
  });

  // ─── ensureLowcodeTables ─────────────────────────────

  describe("ensureLowcodeTables", () => {
    it("creates lowcode_apps table", () => {
      expect(db.tables.has("lowcode_apps")).toBe(true);
    });

    it("creates lowcode_datasources table", () => {
      expect(db.tables.has("lowcode_datasources")).toBe(true);
    });

    it("creates lowcode_versions table", () => {
      expect(db.tables.has("lowcode_versions")).toBe(true);
    });

    it("is idempotent", () => {
      ensureLowcodeTables(db);
      ensureLowcodeTables(db);
      expect(db.tables.has("lowcode_apps")).toBe(true);
    });
  });

  // ─── createApp ───────────────────────────────────────

  describe("createApp", () => {
    it("creates an app and returns id, name, status", () => {
      const result = createApp(db, { name: "My App" });
      expect(result.id).toBeTruthy();
      expect(result.name).toBe("My App");
      expect(result.status).toBe("draft");
    });

    it("stores app in database", () => {
      createApp(db, { name: "DB App" });
      const rows = db.data.get("lowcode_apps") || [];
      expect(rows.length).toBe(1);
      expect(rows[0].name).toBe("DB App");
    });

    it("defaults to web platform", () => {
      createApp(db, { name: "Web App" });
      const rows = db.data.get("lowcode_apps") || [];
      expect(rows[0].platform).toBe("web");
    });

    it("respects custom platform", () => {
      createApp(db, { name: "Mobile App", platform: "mobile" });
      const rows = db.data.get("lowcode_apps") || [];
      expect(rows[0].platform).toBe("mobile");
    });

    it("creates initial version snapshot", () => {
      const result = createApp(db, { name: "Versioned App" });
      const versions = getVersions(result.id);
      expect(versions.length).toBe(1);
      expect(versions[0].version).toBe(1);
    });
  });

  // ─── saveDesign ──────────────────────────────────────

  describe("saveDesign", () => {
    it("bumps version on save", () => {
      const app = createApp(db, { name: "Design App" });
      const result = saveDesign(db, app.id, {
        components: [{ type: "Button" }],
      });
      expect(result.version).toBe(2);
    });

    it("creates version snapshot on save", () => {
      const app = createApp(db, { name: "Snapshot App" });
      saveDesign(db, app.id, { components: [{ type: "Form" }] });
      const versions = getVersions(app.id);
      expect(versions.length).toBe(2);
      expect(versions[1].version).toBe(2);
    });

    it("increments version correctly on multiple saves", () => {
      const app = createApp(db, { name: "Multi Save" });
      saveDesign(db, app.id, { v: 2 });
      const result = saveDesign(db, app.id, { v: 3 });
      expect(result.version).toBe(3);
    });
  });

  // ─── previewApp ──────────────────────────────────────

  describe("previewApp", () => {
    it("returns preview info with URL", () => {
      const app = createApp(db, { name: "Preview App" });
      const preview = previewApp(app.id);
      expect(preview.appId).toBe(app.id);
      expect(preview.previewUrl).toContain(app.id);
      expect(preview.platform).toBe("web");
    });

    it("returns default design for unknown app", () => {
      const preview = previewApp("nonexistent");
      expect(preview.design).toHaveProperty("components");
    });
  });

  // ─── publishApp ──────────────────────────────────────

  describe("publishApp", () => {
    it("sets status to published", () => {
      const app = createApp(db, { name: "Pub App" });
      const result = publishApp(db, app.id);
      expect(result.status).toBe("published");
    });
  });

  // ─── listComponents ──────────────────────────────────

  describe("listComponents", () => {
    it("returns exactly 15 built-in components", () => {
      const components = listComponents();
      expect(components).toHaveLength(15);
    });

    it("includes Form component", () => {
      const components = listComponents();
      const form = components.find((c) => c.name === "Form");
      expect(form).toBeTruthy();
      expect(form.category).toBe("input");
    });

    it("includes DataTable component", () => {
      const components = listComponents();
      expect(components.find((c) => c.name === "DataTable")).toBeTruthy();
    });

    it("includes chart components", () => {
      const components = listComponents();
      const charts = components.filter((c) => c.category === "chart");
      expect(charts).toHaveLength(3);
    });

    it("all components have name, category, props", () => {
      for (const comp of listComponents()) {
        expect(comp.name).toBeTruthy();
        expect(comp.category).toBeTruthy();
        expect(Array.isArray(comp.props)).toBe(true);
      }
    });

    it("returns same reference on second call (cached)", () => {
      const a = listComponents();
      const b = listComponents();
      expect(a).toBe(b);
    });
  });

  // ─── addDataSource ───────────────────────────────────

  describe("addDataSource", () => {
    it("adds a data source to an app", () => {
      const app = createApp(db, { name: "DS App" });
      const ds = addDataSource(db, app.id, "API", "rest", {
        url: "https://api.example.com",
      });
      expect(ds.id).toBeTruthy();
      expect(ds.name).toBe("API");
      expect(ds.type).toBe("rest");
    });

    it("stores data source in database", () => {
      const app = createApp(db, { name: "DS DB App" });
      addDataSource(db, app.id, "MyDB", "database", { host: "localhost" });
      const rows = db.data.get("lowcode_datasources") || [];
      expect(rows.length).toBe(1);
    });
  });

  // ─── getVersions ─────────────────────────────────────

  describe("getVersions", () => {
    it("returns empty for unknown app", () => {
      expect(getVersions("unknown")).toEqual([]);
    });

    it("returns version history", () => {
      const app = createApp(db, { name: "V App" });
      saveDesign(db, app.id, { v: 2 });
      const versions = getVersions(app.id);
      expect(versions.length).toBe(2);
    });
  });

  // ─── rollbackApp ─────────────────────────────────────

  describe("rollbackApp", () => {
    it("restores app to a previous version", () => {
      const app = createApp(db, { name: "Rollback App" });
      saveDesign(db, app.id, { components: [{ type: "Button" }] });
      const result = rollbackApp(db, app.id, 1);
      expect(result.restored).toBe(true);
      expect(result.version).toBe(1);
    });

    it("returns restored: false for missing version", () => {
      const app = createApp(db, { name: "No Version" });
      const result = rollbackApp(db, app.id, 999);
      expect(result.restored).toBe(false);
    });
  });

  // ─── exportApp ───────────────────────────────────────

  describe("exportApp", () => {
    it("exports app with data sources and versions", () => {
      const app = createApp(db, { name: "Export App" });
      addDataSource(db, app.id, "DS1", "rest", {});
      saveDesign(db, app.id, { exported: true });

      const result = exportApp(app.id);
      expect(result.appId).toBe(app.id);
      expect(result.app).toBeTruthy();
      expect(result.dataSources.length).toBe(1);
      expect(result.versions.length).toBe(2);
    });

    it("returns null app for unknown id", () => {
      const result = exportApp("ghost");
      expect(result.app).toBeNull();
    });
  });

  // ─── listApps ────────────────────────────────────────

  describe("listApps", () => {
    it("lists all apps from database", () => {
      createApp(db, { name: "App A" });
      createApp(db, { name: "App B" });
      const apps = listApps(db);
      expect(apps.length).toBe(2);
    });

    it("returns empty array when no apps", () => {
      const apps = listApps(db);
      expect(apps).toEqual([]);
    });
  });

  // ─── getApp ──────────────────────────────────────────

  describe("getApp", () => {
    it("returns app by ID with parsed design", () => {
      const app = createApp(db, { name: "Get App", description: "test" });
      const result = getApp(db, app.id);
      expect(result).toBeTruthy();
      expect(result.name).toBe("Get App");
      expect(result.design).toEqual({ components: [], layout: {} });
    });

    it("returns null for unknown ID", () => {
      expect(getApp(db, "nonexistent")).toBeNull();
    });
  });

  // ─── deployApp ───────────────────────────────────────

  describe("deployApp", () => {
    let tmpDir;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lc-deploy-"));
    });

    it("throws for non-existent app", () => {
      expect(() => deployApp(db, "ghost")).toThrow("not found");
    });

    it("throws for unpublished app", () => {
      const app = createApp(db, { name: "Draft App" });
      expect(() => deployApp(db, app.id)).toThrow("must be published");
    });

    it("deploys published app and generates 3 files", () => {
      const app = createApp(db, {
        name: "Deploy Test",
        description: "A test app",
      });
      publishApp(db, app.id);

      const result = deployApp(db, app.id, { outputDir: tmpDir });
      expect(result.appId).toBe(app.id);
      expect(result.files).toContain("index.html");
      expect(result.files).toContain("app.js");
      expect(result.files).toContain("style.css");
      expect(result.files.length).toBe(3);
      expect(result.deployedAt).toBeTruthy();
    });

    it("writes valid HTML file to output directory", () => {
      const app = createApp(db, { name: "HTML Check" });
      publishApp(db, app.id);
      deployApp(db, app.id, { outputDir: tmpDir });

      const html = fs.readFileSync(path.join(tmpDir, "index.html"), "utf-8");
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("HTML Check");
      expect(html).toContain('<meta charset="UTF-8">');
    });

    it("includes components in generated HTML", () => {
      const app = createApp(db, { name: "Components App" });
      saveDesign(db, app.id, {
        components: [
          { type: "Button", label: "Click Me" },
          { type: "DataTable", label: "My Table" },
        ],
        layout: {},
      });
      publishApp(db, app.id);
      deployApp(db, app.id, { outputDir: tmpDir });

      const html = fs.readFileSync(path.join(tmpDir, "index.html"), "utf-8");
      expect(html).toContain("Click Me");
      expect(html).toContain("My Table");
    });

    it("updates app status to deployed", () => {
      const app = createApp(db, { name: "Status App" });
      publishApp(db, app.id);
      deployApp(db, app.id, { outputDir: tmpDir });

      const updated = getApp(db, app.id);
      expect(updated.status).toBe("deployed");
    });

    it("creates output directory if it does not exist", () => {
      const app = createApp(db, { name: "Mkdir App" });
      publishApp(db, app.id);
      const nested = path.join(tmpDir, "sub", "dir");

      const result = deployApp(db, app.id, { outputDir: nested });
      expect(fs.existsSync(nested)).toBe(true);
      expect(result.outputDir).toBe(nested);
    });

    it("generates valid JS file", () => {
      const app = createApp(db, { name: "JS Check" });
      publishApp(db, app.id);
      deployApp(db, app.id, { outputDir: tmpDir });

      const js = fs.readFileSync(path.join(tmpDir, "app.js"), "utf-8");
      expect(js).toContain("JS Check");
      expect(js).toContain("console.log");
    });

    it("generates valid CSS file", () => {
      const app = createApp(db, { name: "CSS Check" });
      publishApp(db, app.id);
      deployApp(db, app.id, { outputDir: tmpDir });

      const css = fs.readFileSync(path.join(tmpDir, "style.css"), "utf-8");
      expect(css).toContain(".lc-container");
      expect(css).toContain(".lc-component");
    });
  });

  // ─── V2 frozen enums ─────────────────────────────────

  describe("V2 frozen enums", () => {
    it("COMPONENT_CATEGORY is frozen", () => {
      expect(Object.isFrozen(COMPONENT_CATEGORY)).toBe(true);
      expect(COMPONENT_CATEGORY.INPUT).toBe("input");
      expect(COMPONENT_CATEGORY.DISPLAY).toBe("display");
      expect(COMPONENT_CATEGORY.CHART).toBe("chart");
      expect(COMPONENT_CATEGORY.LAYOUT).toBe("layout");
      expect(COMPONENT_CATEGORY.OVERLAY).toBe("overlay");
    });

    it("DATASOURCE_TYPE is frozen and covers 4 types", () => {
      expect(Object.isFrozen(DATASOURCE_TYPE)).toBe(true);
      expect(Object.values(DATASOURCE_TYPE).length).toBe(4);
      expect(DATASOURCE_TYPE.REST).toBe("rest");
      expect(DATASOURCE_TYPE.GRAPHQL).toBe("graphql");
      expect(DATASOURCE_TYPE.DATABASE).toBe("database");
      expect(DATASOURCE_TYPE.CSV).toBe("csv");
    });

    it("APP_STATUS is frozen and covers 3 canonical states", () => {
      expect(Object.isFrozen(APP_STATUS)).toBe(true);
      expect(APP_STATUS.DRAFT).toBe("draft");
      expect(APP_STATUS.PUBLISHED).toBe("published");
      expect(APP_STATUS.ARCHIVED).toBe("archived");
    });
  });

  // ─── listComponentsV2 ────────────────────────────────

  describe("listComponentsV2", () => {
    it("returns all 15 components when no category filter", () => {
      expect(listComponentsV2()).toHaveLength(15);
    });

    it("returns copies (not the cached reference)", () => {
      const first = listComponentsV2();
      const second = listComponentsV2();
      expect(first).not.toBe(second);
    });

    it("filters by category=input", () => {
      const inputs = listComponentsV2({ category: COMPONENT_CATEGORY.INPUT });
      expect(inputs.every((c) => c.category === "input")).toBe(true);
      expect(inputs.length).toBeGreaterThan(0);
    });

    it("filters by category=chart (3 components)", () => {
      const charts = listComponentsV2({ category: COMPONENT_CATEGORY.CHART });
      expect(charts).toHaveLength(3);
    });

    it("rejects invalid category", () => {
      expect(() => listComponentsV2({ category: "bogus" })).toThrow(
        "Invalid category",
      );
    });
  });

  // ─── registerDataSourceV2 ────────────────────────────

  describe("registerDataSourceV2", () => {
    it("registers a REST datasource", () => {
      const app = createApp(db, { name: "DS V2" });
      const result = registerDataSourceV2(db, {
        appId: app.id,
        name: "API",
        type: DATASOURCE_TYPE.REST,
        config: { url: "https://api.x.com" },
      });
      expect(result.id).toBeTruthy();
      expect(result.type).toBe("rest");
    });

    it("rejects unknown datasource type", () => {
      const app = createApp(db, { name: "DS Bad" });
      expect(() =>
        registerDataSourceV2(db, {
          appId: app.id,
          name: "Weird",
          type: "quantum",
        }),
      ).toThrow("Invalid datasource type");
    });

    it("rejects missing appId", () => {
      expect(() =>
        registerDataSourceV2(db, {
          name: "x",
          type: DATASOURCE_TYPE.REST,
        }),
      ).toThrow("appId is required");
    });

    it("rejects missing name", () => {
      const app = createApp(db, { name: "DS No Name" });
      expect(() =>
        registerDataSourceV2(db, {
          appId: app.id,
          type: DATASOURCE_TYPE.REST,
        }),
      ).toThrow("name is required");
    });
  });

  // ─── testDataSourceConnection ────────────────────────

  describe("testDataSourceConnection", () => {
    it("validates REST datasource with URL", () => {
      const app = createApp(db, { name: "Test REST" });
      const ds = registerDataSourceV2(db, {
        appId: app.id,
        name: "API",
        type: DATASOURCE_TYPE.REST,
        config: { url: "https://example.com" },
      });
      const check = testDataSourceConnection(ds.id);
      expect(check.ok).toBe(true);
      expect(check.reason).toBe("ok");
    });

    it("fails REST datasource without URL", () => {
      const app = createApp(db, { name: "Bad REST" });
      const ds = registerDataSourceV2(db, {
        appId: app.id,
        name: "API",
        type: DATASOURCE_TYPE.REST,
        config: {},
      });
      const check = testDataSourceConnection(ds.id);
      expect(check.ok).toBe(false);
      expect(check.reason).toBe("missing url");
    });

    it("validates GRAPHQL datasource with endpoint", () => {
      const app = createApp(db, { name: "GQL" });
      const ds = registerDataSourceV2(db, {
        appId: app.id,
        name: "G",
        type: DATASOURCE_TYPE.GRAPHQL,
        config: { endpoint: "https://gql.example.com" },
      });
      expect(testDataSourceConnection(ds.id).ok).toBe(true);
    });

    it("validates DATABASE datasource with host", () => {
      const app = createApp(db, { name: "DB" });
      const ds = registerDataSourceV2(db, {
        appId: app.id,
        name: "PG",
        type: DATASOURCE_TYPE.DATABASE,
        config: { host: "localhost" },
      });
      expect(testDataSourceConnection(ds.id).ok).toBe(true);
    });

    it("validates CSV datasource with path", () => {
      const app = createApp(db, { name: "CSV" });
      const ds = registerDataSourceV2(db, {
        appId: app.id,
        name: "F",
        type: DATASOURCE_TYPE.CSV,
        config: { path: "/tmp/data.csv" },
      });
      expect(testDataSourceConnection(ds.id).ok).toBe(true);
    });

    it("returns not found for unknown datasource id", () => {
      const check = testDataSourceConnection("does-not-exist");
      expect(check.ok).toBe(false);
      expect(check.reason).toBe("datasource not found");
    });
  });

  // ─── updateAppStatus / archiveApp / getStatusHistory ─

  describe("updateAppStatus state machine", () => {
    it("allows draft → published", () => {
      const app = createApp(db, { name: "S1" });
      const result = updateAppStatus(db, {
        appId: app.id,
        status: APP_STATUS.PUBLISHED,
      });
      expect(result.status).toBe("published");
      expect(result.previous).toBe("draft");
    });

    it("allows draft → archived", () => {
      const app = createApp(db, { name: "S2" });
      const result = updateAppStatus(db, {
        appId: app.id,
        status: APP_STATUS.ARCHIVED,
      });
      expect(result.status).toBe("archived");
    });

    it("allows published → archived", () => {
      const app = createApp(db, { name: "S3" });
      updateAppStatus(db, { appId: app.id, status: APP_STATUS.PUBLISHED });
      const result = updateAppStatus(db, {
        appId: app.id,
        status: APP_STATUS.ARCHIVED,
      });
      expect(result.status).toBe("archived");
    });

    it("rejects archived → published (must go via draft)", () => {
      const app = createApp(db, { name: "S4" });
      updateAppStatus(db, { appId: app.id, status: APP_STATUS.ARCHIVED });
      expect(() =>
        updateAppStatus(db, {
          appId: app.id,
          status: APP_STATUS.PUBLISHED,
        }),
      ).toThrow("Invalid status transition");
    });

    it("allows archived → draft", () => {
      const app = createApp(db, { name: "S5" });
      updateAppStatus(db, { appId: app.id, status: APP_STATUS.ARCHIVED });
      const result = updateAppStatus(db, {
        appId: app.id,
        status: APP_STATUS.DRAFT,
      });
      expect(result.status).toBe("draft");
    });

    it("rejects invalid status value", () => {
      const app = createApp(db, { name: "S6" });
      expect(() =>
        updateAppStatus(db, { appId: app.id, status: "launched" }),
      ).toThrow("Invalid status");
    });

    it("throws when app not found", () => {
      expect(() =>
        updateAppStatus(db, {
          appId: "ghost",
          status: APP_STATUS.PUBLISHED,
        }),
      ).toThrow("not found");
    });

    it("records status history entries", () => {
      const app = createApp(db, { name: "Hist" });
      updateAppStatus(db, { appId: app.id, status: APP_STATUS.PUBLISHED });
      updateAppStatus(db, { appId: app.id, status: APP_STATUS.ARCHIVED });
      const hist = getStatusHistory(app.id);
      expect(hist).toHaveLength(2);
      expect(hist[0].from).toBe("draft");
      expect(hist[0].to).toBe("published");
      expect(hist[1].from).toBe("published");
      expect(hist[1].to).toBe("archived");
    });

    it("treats deployed apps as published for transition purposes", () => {
      const app = createApp(db, { name: "Deployed" });
      // Manually set to deployed (legacy state)
      db.prepare(`UPDATE lowcode_apps SET status = ? WHERE id = ?`).run(
        "deployed",
        app.id,
      );
      const result = updateAppStatus(db, {
        appId: app.id,
        status: APP_STATUS.ARCHIVED,
      });
      expect(result.status).toBe("archived");
      expect(result.previous).toBe("published");
    });
  });

  describe("archiveApp", () => {
    it("archives a draft app", () => {
      const app = createApp(db, { name: "Arch" });
      const result = archiveApp(db, app.id);
      expect(result.status).toBe("archived");
    });
  });

  // ─── cloneApp ────────────────────────────────────────

  describe("cloneApp", () => {
    it("clones an app with a new name", () => {
      const app = createApp(db, { name: "Original", description: "orig" });
      saveDesign(db, app.id, {
        components: [{ type: "Button" }],
        layout: {},
      });
      const result = cloneApp(db, { sourceId: app.id, newName: "Copy" });
      expect(result.clonedId).toBeTruthy();
      expect(result.clonedId).not.toBe(app.id);
      expect(result.name).toBe("Copy");
    });

    it("uses default name when newName omitted", () => {
      const app = createApp(db, { name: "Base" });
      const result = cloneApp(db, { sourceId: app.id });
      expect(result.name).toBe("Base (Copy)");
    });

    it("throws for missing source app", () => {
      expect(() => cloneApp(db, { sourceId: "ghost" })).toThrow("not found");
    });
  });

  // ─── exportAppJSON / importAppJSON ───────────────────

  describe("exportAppJSON + importAppJSON", () => {
    it("exports with schema + timestamp", () => {
      const app = createApp(db, { name: "Exp" });
      const json = exportAppJSON(db, app.id);
      expect(json.schema).toBe("chainlesschain.lowcode.v2");
      expect(json.exportedAt).toBeTruthy();
      expect(json.app.name).toBe("Exp");
    });

    it("exports throws for missing app", () => {
      expect(() => exportAppJSON(db, "ghost")).toThrow("not found");
    });

    it("imports a valid export payload", () => {
      const app = createApp(db, { name: "Source" });
      registerDataSourceV2(db, {
        appId: app.id,
        name: "API",
        type: DATASOURCE_TYPE.REST,
        config: { url: "x" },
      });
      const json = exportAppJSON(db, app.id);
      const result = importAppJSON(db, json);
      expect(result.importedId).toBeTruthy();
      expect(result.name).toBe("Source");
      expect(result.dataSources).toBe(1);
    });

    it("rejects non-object payload", () => {
      expect(() => importAppJSON(db, null)).toThrow("JSON object");
    });

    it("rejects wrong schema", () => {
      expect(() =>
        importAppJSON(db, {
          schema: "wrong",
          app: { name: "X" },
        }),
      ).toThrow("unsupported schema");
    });

    it("rejects missing app.name", () => {
      expect(() =>
        importAppJSON(db, {
          schema: "chainlesschain.lowcode.v2",
          app: {},
        }),
      ).toThrow("missing app.name");
    });

    it("skips datasources with unknown types", () => {
      const result = importAppJSON(db, {
        schema: "chainlesschain.lowcode.v2",
        app: { name: "With Bad DS", platform: "web" },
        dataSources: [
          { name: "ok", type: "rest", config: { url: "y" } },
          { name: "bad", type: "quantum", config: {} },
        ],
        versions: [],
      });
      expect(result.dataSources).toBe(1);
    });
  });

  // ─── getLowcodeStatsV2 ───────────────────────────────

  describe("getLowcodeStatsV2", () => {
    it("returns zeros for empty database", () => {
      const stats = getLowcodeStatsV2(db);
      expect(stats.totalApps).toBe(0);
      expect(stats.dataSources.total).toBe(0);
      expect(stats.componentsAvailable).toBe(15);
    });

    it("aggregates apps by status", () => {
      const a = createApp(db, { name: "A" });
      const b = createApp(db, { name: "B" });
      updateAppStatus(db, { appId: a.id, status: APP_STATUS.PUBLISHED });
      updateAppStatus(db, { appId: b.id, status: APP_STATUS.ARCHIVED });
      createApp(db, { name: "C" }); // draft
      const stats = getLowcodeStatsV2(db);
      expect(stats.totalApps).toBe(3);
      expect(stats.byStatus.draft).toBe(1);
      expect(stats.byStatus.published).toBe(1);
      expect(stats.byStatus.archived).toBe(1);
    });

    it("aggregates datasources by type", () => {
      const app = createApp(db, { name: "Stats DS" });
      registerDataSourceV2(db, {
        appId: app.id,
        name: "r",
        type: DATASOURCE_TYPE.REST,
        config: { url: "x" },
      });
      registerDataSourceV2(db, {
        appId: app.id,
        name: "r2",
        type: DATASOURCE_TYPE.REST,
        config: { url: "y" },
      });
      registerDataSourceV2(db, {
        appId: app.id,
        name: "db",
        type: DATASOURCE_TYPE.DATABASE,
        config: { host: "h" },
      });
      const stats = getLowcodeStatsV2(db);
      expect(stats.dataSources.total).toBe(3);
      expect(stats.dataSources.byType.rest).toBe(2);
      expect(stats.dataSources.byType.database).toBe(1);
    });
  });
});

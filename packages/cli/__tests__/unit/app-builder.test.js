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
} from "../../src/lib/app-builder.js";
import fs from "fs";
import path from "path";
import os from "os";

describe("app-builder", () => {
  let db;

  beforeEach(() => {
    db = new MockDatabase();
    ensureLowcodeTables(db);
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
});

/**
 * Integration test — Low-Code Deploy (app-builder)
 *
 * Covers the full workflow:
 *   create app → save design → publish → deploy → verify output files
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  ensureLowcodeTables,
  createApp,
  saveDesign,
  publishApp,
  deployApp,
  getApp,
  listApps,
  addDataSource,
  getVersions,
  rollbackApp,
  exportApp,
} from "../../src/lib/app-builder.js";

describe("Low-Code Deploy Integration", () => {
  let db, tmpDir;

  beforeEach(() => {
    db = new MockDatabase();
    ensureLowcodeTables(db);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lc-int-"));
  });

  afterEach(() => {
    // Cleanup temp directory
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  describe("full app lifecycle", () => {
    it("create → design → publish → deploy → verify files", () => {
      // Step 1: Create app
      const app = createApp(db, {
        name: "Integration App",
        description: "Full lifecycle test",
        platform: "web",
      });
      expect(app.id).toBeTruthy();
      expect(app.status).toBe("draft");

      // Step 2: Save design with components
      const design = {
        components: [
          { type: "Form", label: "Contact Form" },
          { type: "DataTable", label: "User List" },
          { type: "BarChart", label: "Sales Chart" },
        ],
        layout: { type: "grid", columns: 2 },
      };
      const saved = saveDesign(db, app.id, design);
      expect(saved.version).toBe(2);

      // Step 3: Add data source
      const ds = addDataSource(db, app.id, "API", "rest", {
        url: "https://api.example.com",
      });
      expect(ds.type).toBe("rest");

      // Step 4: Publish
      const published = publishApp(db, app.id);
      expect(published.status).toBe("published");

      // Step 5: Deploy
      const result = deployApp(db, app.id, { outputDir: tmpDir });
      expect(result.files).toContain("index.html");
      expect(result.files).toContain("app.js");
      expect(result.files).toContain("style.css");

      // Step 6: Verify HTML content
      const html = fs.readFileSync(path.join(tmpDir, "index.html"), "utf-8");
      expect(html).toContain("Integration App");
      expect(html).toContain("Contact Form");
      expect(html).toContain("User List");
      expect(html).toContain("Sales Chart");
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain('<meta charset="UTF-8">');

      // Step 7: Verify JS content
      const js = fs.readFileSync(path.join(tmpDir, "app.js"), "utf-8");
      expect(js).toContain("Integration App");

      // Step 8: Verify CSS content
      const css = fs.readFileSync(path.join(tmpDir, "style.css"), "utf-8");
      expect(css).toContain(".lc-component");

      // Step 9: App status updated
      const updated = getApp(db, app.id);
      expect(updated.status).toBe("deployed");
    });

    it("version history preserved through lifecycle", () => {
      const app = createApp(db, { name: "Version Test" });

      // Save multiple designs
      saveDesign(db, app.id, { v: 2 });
      saveDesign(db, app.id, { v: 3 });
      saveDesign(db, app.id, { v: 4 });

      const versions = getVersions(app.id);
      expect(versions.length).toBe(4); // initial + 3 saves
      expect(versions[3].version).toBe(4);

      // Rollback to v2
      const rollback = rollbackApp(db, app.id, 2);
      expect(rollback.restored).toBe(true);
    });

    it("export includes all data sources and versions", () => {
      const app = createApp(db, { name: "Export Test" });
      addDataSource(db, app.id, "DB", "database", { host: "localhost" });
      addDataSource(db, app.id, "API", "rest", { url: "http://api" });
      saveDesign(db, app.id, { exported: true });

      const result = exportApp(app.id);
      expect(result.app).toBeTruthy();
      expect(result.dataSources.length).toBe(2);
      expect(result.versions.length).toBe(2);
    });

    it("multiple apps coexist correctly", () => {
      createApp(db, { name: "App A" });
      createApp(db, { name: "App B" });
      createApp(db, { name: "App C" });

      const apps = listApps(db);
      expect(apps.length).toBe(3);
    });
  });

  describe("error paths", () => {
    it("cannot deploy draft app", () => {
      const app = createApp(db, { name: "Draft" });
      expect(() => deployApp(db, app.id)).toThrow("must be published");
    });

    it("cannot deploy nonexistent app", () => {
      expect(() => deployApp(db, "ghost")).toThrow("not found");
    });
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  ensurePluginTables,
  installPlugin,
  getPlugin,
  getPluginById,
  listPlugins,
  enablePlugin,
  disablePlugin,
  removePlugin,
  updatePlugin,
  setPluginSetting,
  getPluginSetting,
  getPluginSettings,
  registerInMarketplace,
  searchRegistry,
  listRegistry,
  getPluginSummary,
} from "../../src/lib/plugin-manager.js";

describe("Plugin Manager", () => {
  let db;

  beforeEach(() => {
    db = new MockDatabase();
  });

  // ─── ensurePluginTables ───────────────────────────────

  describe("ensurePluginTables", () => {
    it("should create plugin tables", () => {
      ensurePluginTables(db);
      expect(db.tables.has("plugins")).toBe(true);
      expect(db.tables.has("plugin_settings")).toBe(true);
      expect(db.tables.has("plugin_registry")).toBe(true);
    });

    it("should be idempotent", () => {
      ensurePluginTables(db);
      ensurePluginTables(db);
      expect(db.tables.has("plugins")).toBe(true);
    });
  });

  // ─── installPlugin ────────────────────────────────────

  describe("installPlugin", () => {
    it("should install a plugin", () => {
      const p = installPlugin(db, {
        name: "test-plugin",
        version: "1.0.0",
        description: "A test plugin",
        author: "test",
      });
      expect(p.id).toMatch(/^plugin-/);
      expect(p.name).toBe("test-plugin");
      expect(p.version).toBe("1.0.0");
      expect(p.enabled).toBe(true);
    });

    it("should throw when name/version missing", () => {
      expect(() => installPlugin(db, { name: "test" })).toThrow("required");
    });

    it("should throw when plugin already installed", () => {
      installPlugin(db, { name: "test-plugin", version: "1.0.0" });
      expect(() =>
        installPlugin(db, { name: "test-plugin", version: "1.0.1" }),
      ).toThrow("already installed");
    });
  });

  // ─── getPlugin ────────────────────────────────────────

  describe("getPlugin", () => {
    it("should find a plugin by name", () => {
      installPlugin(db, { name: "test-plugin", version: "1.0.0" });
      const found = getPlugin(db, "test-plugin");
      expect(found).toBeDefined();
      expect(found.name).toBe("test-plugin");
    });

    it("should return null for non-existent plugin", () => {
      ensurePluginTables(db);
      expect(getPlugin(db, "nonexistent")).toBeNull();
    });
  });

  // ─── getPluginById ────────────────────────────────────

  describe("getPluginById", () => {
    it("should find a plugin by ID", () => {
      const p = installPlugin(db, { name: "test-plugin", version: "1.0.0" });
      const found = getPluginById(db, p.id);
      expect(found).toBeDefined();
      expect(found.name).toBe("test-plugin");
    });
  });

  // ─── listPlugins ──────────────────────────────────────

  describe("listPlugins", () => {
    it("should list all plugins", () => {
      installPlugin(db, { name: "p1", version: "1.0.0" });
      installPlugin(db, { name: "p2", version: "1.0.0" });
      expect(listPlugins(db)).toHaveLength(2);
    });

    it("should return empty when no plugins", () => {
      ensurePluginTables(db);
      expect(listPlugins(db)).toHaveLength(0);
    });
  });

  // ─── enablePlugin / disablePlugin ─────────────────────

  describe("enablePlugin", () => {
    it("should enable a plugin", () => {
      installPlugin(db, { name: "test", version: "1.0.0" });
      disablePlugin(db, "test");
      const ok = enablePlugin(db, "test");
      expect(ok).toBe(true);
    });

    it("should return false for non-existent plugin", () => {
      ensurePluginTables(db);
      expect(enablePlugin(db, "nope")).toBe(false);
    });
  });

  describe("disablePlugin", () => {
    it("should disable a plugin", () => {
      installPlugin(db, { name: "test", version: "1.0.0" });
      const ok = disablePlugin(db, "test");
      expect(ok).toBe(true);
    });
  });

  // ─── removePlugin ─────────────────────────────────────

  describe("removePlugin", () => {
    it("should remove a plugin", () => {
      installPlugin(db, { name: "test", version: "1.0.0" });
      const ok = removePlugin(db, "test");
      expect(ok).toBe(true);
      expect(getPlugin(db, "test")).toBeNull();
    });

    it("should return false for non-existent plugin", () => {
      ensurePluginTables(db);
      expect(removePlugin(db, "nope")).toBe(false);
    });

    it("should remove plugin settings", () => {
      installPlugin(db, { name: "test", version: "1.0.0" });
      setPluginSetting(db, "test", "key", "value");
      removePlugin(db, "test");
      // Plugin gone, settings should be gone too
      ensurePluginTables(db);
      expect(getPlugin(db, "test")).toBeNull();
    });
  });

  // ─── updatePlugin ─────────────────────────────────────

  describe("updatePlugin", () => {
    it("should update plugin version", () => {
      installPlugin(db, { name: "test", version: "1.0.0" });
      const ok = updatePlugin(db, "test", "2.0.0");
      expect(ok).toBe(true);
    });

    it("should return false for non-existent plugin", () => {
      ensurePluginTables(db);
      expect(updatePlugin(db, "nope", "2.0.0")).toBe(false);
    });
  });

  // ─── Plugin settings ──────────────────────────────────

  describe("setPluginSetting", () => {
    it("should set a plugin setting", () => {
      installPlugin(db, { name: "test", version: "1.0.0" });
      const ok = setPluginSetting(db, "test", "theme", "dark");
      expect(ok).toBe(true);
    });

    it("should throw for non-existent plugin", () => {
      ensurePluginTables(db);
      expect(() => setPluginSetting(db, "nope", "key", "val")).toThrow(
        "Plugin not found",
      );
    });
  });

  describe("getPluginSetting", () => {
    it("should get a plugin setting", () => {
      installPlugin(db, { name: "test", version: "1.0.0" });
      setPluginSetting(db, "test", "theme", "dark");
      expect(getPluginSetting(db, "test", "theme")).toBe("dark");
    });

    it("should return null for non-existent key", () => {
      installPlugin(db, { name: "test", version: "1.0.0" });
      expect(getPluginSetting(db, "test", "nope")).toBeNull();
    });

    it("should return null for non-existent plugin", () => {
      ensurePluginTables(db);
      expect(getPluginSetting(db, "nope", "key")).toBeNull();
    });
  });

  describe("getPluginSettings", () => {
    it("should get all settings for a plugin", () => {
      installPlugin(db, { name: "test", version: "1.0.0" });
      setPluginSetting(db, "test", "theme", "dark");
      setPluginSetting(db, "test", "lang", "en");
      const settings = getPluginSettings(db, "test");
      expect(settings.theme).toBe("dark");
      expect(settings.lang).toBe("en");
    });

    it("should return empty object for non-existent plugin", () => {
      ensurePluginTables(db);
      expect(getPluginSettings(db, "nope")).toEqual({});
    });
  });

  // ─── Registry / Marketplace ───────────────────────────

  describe("registerInMarketplace", () => {
    it("should register a plugin in marketplace", () => {
      const r = registerInMarketplace(db, {
        name: "awesome-plugin",
        latestVersion: "1.0.0",
        description: "An awesome plugin",
        author: "dev",
        tags: ["ai", "tools"],
      });
      expect(r.name).toBe("awesome-plugin");
    });
  });

  describe("searchRegistry", () => {
    it("should search plugins by name", () => {
      registerInMarketplace(db, {
        name: "ai-assistant",
        latestVersion: "1.0.0",
        description: "AI helper",
      });
      registerInMarketplace(db, {
        name: "theme-dark",
        latestVersion: "1.0.0",
        description: "Dark theme",
      });
      const results = searchRegistry(db, "ai");
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it("should return empty for no match", () => {
      ensurePluginTables(db);
      expect(searchRegistry(db, "nonexistent")).toHaveLength(0);
    });
  });

  describe("listRegistry", () => {
    it("should list all registry plugins", () => {
      registerInMarketplace(db, { name: "p1", latestVersion: "1.0.0" });
      registerInMarketplace(db, { name: "p2", latestVersion: "1.0.0" });
      expect(listRegistry(db)).toHaveLength(2);
    });
  });

  // ─── getPluginSummary ─────────────────────────────────

  describe("getPluginSummary", () => {
    it("should return plugin summary", () => {
      installPlugin(db, { name: "p1", version: "1.0.0" });
      installPlugin(db, { name: "p2", version: "1.0.0" });
      disablePlugin(db, "p2");
      registerInMarketplace(db, { name: "p3", latestVersion: "1.0.0" });

      const summary = getPluginSummary(db);
      expect(summary.installed).toBe(2);
      expect(summary.enabled).toBe(1);
      expect(summary.registryCount).toBe(1);
    });

    it("should return zeroes when empty", () => {
      ensurePluginTables(db);
      const summary = getPluginSummary(db);
      expect(summary.installed).toBe(0);
      expect(summary.enabled).toBe(0);
    });
  });
});

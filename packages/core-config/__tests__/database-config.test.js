import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

const {
  AppConfigManager,
  DEFAULT_CONFIG,
  setPathResolvers,
} = require("../lib/database-config.js");

describe("AppConfigManager", () => {
  let testDir;
  let manager;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `core-config-test-${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });

    // Inject test path resolvers
    setPathResolvers({
      getUserDataPath: () => testDir,
      getDataDir: () => path.join(testDir, "data"),
    });

    manager = new AppConfigManager({
      configPath: path.join(testDir, "app-config.json"),
    });
  });

  afterEach(() => {
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Cleanup best-effort
    }
  });

  describe("constructor", () => {
    it("uses custom config path", () => {
      expect(manager.configPath).toBe(path.join(testDir, "app-config.json"));
    });

    it("starts with default config", () => {
      expect(manager.config.database.autoBackup).toBe(true);
      expect(manager.config.app.language).toBe("zh-CN");
    });
  });

  describe("load and save", () => {
    it("saves and loads config", () => {
      manager.set("app.language", "en-US");

      const manager2 = new AppConfigManager({
        configPath: path.join(testDir, "app-config.json"),
      });
      manager2.load();

      expect(manager2.get("app.language")).toBe("en-US");
    });

    it("creates default config file on first load", () => {
      manager.load();
      expect(
        fs.existsSync(path.join(testDir, "app-config.json")),
      ).toBe(true);
    });
  });

  describe("get and set", () => {
    it("gets nested values with dot notation", () => {
      expect(manager.get("database.maxBackups")).toBe(7);
    });

    it("returns default for missing keys", () => {
      expect(manager.get("nonexistent", "fallback")).toBe("fallback");
    });

    it("sets nested values", () => {
      manager.set("database.maxBackups", 10);
      expect(manager.get("database.maxBackups")).toBe(10);
    });

    it("creates intermediate objects", () => {
      manager.set("custom.nested.key", "value");
      expect(manager.get("custom.nested.key")).toBe("value");
    });
  });

  describe("database paths", () => {
    it("returns default database path", () => {
      const dbPath = manager.getDatabasePath();
      expect(dbPath).toContain("chainlesschain.db");
      expect(dbPath).toContain("data");
    });

    it("uses custom path when set", () => {
      manager.setDatabasePath("/custom/db.sqlite");
      expect(manager.getDatabasePath()).toBe("/custom/db.sqlite");
    });

    it("ensures database directory exists", () => {
      manager.ensureDatabaseDir();
      expect(fs.existsSync(manager.getDatabaseDir())).toBe(true);
    });

    it("reports database existence", () => {
      expect(manager.databaseExists()).toBe(false);
      // Create the database file
      manager.ensureDatabaseDir();
      fs.writeFileSync(manager.getDatabasePath(), "test");
      expect(manager.databaseExists()).toBe(true);
    });
  });

  describe("reset", () => {
    it("resets to default config", () => {
      manager.set("app.language", "en-US");
      manager.reset();
      expect(manager.get("app.language")).toBe("zh-CN");
    });
  });

  describe("getAll", () => {
    it("returns config object with all sections", () => {
      const all = manager.getAll();
      expect(all.database).toBeDefined();
      expect(all.app).toBeDefined();
      expect(all.logging).toBeDefined();
    });
  });

  describe("backup and restore", () => {
    it("creates and lists backups", () => {
      manager.ensureDatabaseDir();
      const dbPath = manager.getDatabasePath();
      fs.writeFileSync(dbPath, "test-db-content");

      const backupPath = manager.createDatabaseBackup();
      expect(fs.existsSync(backupPath)).toBe(true);

      const backups = manager.listBackups();
      expect(backups.length).toBeGreaterThanOrEqual(1);
    });

    it("restores from backup", () => {
      manager.ensureDatabaseDir();
      const dbPath = manager.getDatabasePath();
      fs.writeFileSync(dbPath, "original-content");

      const backupPath = manager.createDatabaseBackup();
      fs.writeFileSync(dbPath, "modified-content");

      manager.restoreFromBackup(backupPath);
      const restored = fs.readFileSync(dbPath, "utf8");
      expect(restored).toBe("original-content");
    });
  });
});

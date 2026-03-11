import { describe, it, expect, vi } from "vitest";

const { DatabaseManager } = require("../lib/database-manager.js");

describe("DatabaseManager", () => {
  describe("constructor", () => {
    it("creates uninitialized instance", () => {
      const mgr = new DatabaseManager();
      expect(mgr.initialized).toBe(false);
      expect(mgr.db).toBeNull();
    });

    it("accepts dbPath option", () => {
      const mgr = new DatabaseManager({ dbPath: "/tmp/test.db" });
      expect(mgr.dbPath).toBe("/tmp/test.db");
    });
  });

  describe("getDatabase", () => {
    it("throws when not initialized", () => {
      const mgr = new DatabaseManager();
      expect(() => mgr.getDatabase()).toThrow("not initialized");
    });
  });

  describe("initialize", () => {
    it("throws when no dbPath provided", async () => {
      const mgr = new DatabaseManager();
      await expect(mgr.initialize()).rejects.toThrow("path not specified");
    });
  });

  describe("close", () => {
    it("handles close on uninitialized db", () => {
      const mgr = new DatabaseManager();
      // Should not throw
      mgr.close();
      expect(mgr.initialized).toBe(false);
    });
  });

  describe("getInfo", () => {
    it("returns error info when not initialized", () => {
      const mgr = new DatabaseManager();
      const info = mgr.getInfo();
      expect(info.error).toBeDefined();
    });
  });
});

import { describe, it, expect, vi } from "vitest";

const {
  DatabaseManager,
  buildKeyPragma,
} = require("../lib/database-manager.js");

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

  describe("buildKeyPragma (SQLCipher key escaping)", () => {
    it("leaves a quote-free key byte-identical", () => {
      expect(buildKeyPragma("S3cretKey-abc123")).toBe("key='S3cretKey-abc123'");
    });

    it("escapes single quotes so the key cannot break out of the literal", () => {
      // The whole key must remain inside one '...' literal; ' is doubled to ''.
      expect(buildKeyPragma("pa'ss")).toBe("key='pa''ss'");
    });

    it("contains a quote-injection attempt as data, not SQL", () => {
      const malicious = "x'; ATTACH DATABASE '/tmp/evil.db' AS e; --";
      const pragma = buildKeyPragma(malicious);
      // Every original ' is doubled; the pragma is `key='...'` with no
      // unescaped quote that could terminate the literal early.
      expect(pragma.startsWith("key='")).toBe(true);
      expect(pragma.endsWith("'")).toBe(true);
      const body = pragma.slice("key='".length, -1);
      expect(body.includes("''")).toBe(true); // injected quotes were escaped
      expect(body.replace(/''/g, "")).not.toContain("'"); // no lone quote left
    });

    it("coerces non-string keys without throwing", () => {
      expect(buildKeyPragma(12345)).toBe("key='12345'");
    });
  });
});

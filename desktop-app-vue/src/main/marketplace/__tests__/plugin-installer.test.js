/**
 * PluginInstaller Unit Tests
 *
 * Covers constructor, initialize, verifyPluginHash, extractPlugin,
 * _validateManifest, getPluginDir, getInstallStatus, getActiveInstallations,
 * listInstalled, getInstalledDetail, enablePlugin, disablePlugin,
 * batchInstall, batchUninstall, _parsePluginRow, destroy, setAutoUpdate.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("uuid", () => ({ v4: vi.fn(() => "test-uuid-installer") }));

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => "/mock/userData") },
}));

// Mock 'fs' so that initialize() doesn't fail on CI due to permission errors
// when trying to create directories like /test/plugins.
vi.mock("fs", () => ({
  promises: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(Buffer.from("")),
    writeFile: vi.fn().mockResolvedValue(undefined),
    access: vi.fn().mockResolvedValue(undefined),
  },
  // Provide synchronous stubs expected by some require("fs") callers
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
}));

vi.mock("adm-zip", () => ({
  default: vi.fn(() => ({
    getEntries: vi.fn(() => [
      { entryName: "plugin.json" },
      { entryName: "index.js" },
    ]),
    extractAllTo: vi.fn(),
  })),
}));

// ── Import ─────────────────────────────────────────────────────────────────

const PluginInstallerModule = await import("../plugin-installer.js");
const PluginInstaller = PluginInstallerModule.default || PluginInstallerModule;

// ── Helpers ────────────────────────────────────────────────────────────────

function createMockDb() {
  return {
    run: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    all: vi.fn().mockResolvedValue([]),
  };
}

function createMockClient() {
  return {
    getPlugin: vi.fn().mockResolvedValue({
      id: "p1",
      name: "Test Plugin",
      version: "1.0.0",
      latestVersion: "1.0.0",
      hash: null,
      author: "TestAuthor",
    }),
    downloadPlugin: vi.fn().mockResolvedValue(Buffer.from("fake-zip")),
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("PluginInstaller", () => {
  let installer;
  let mockDb;
  let mockClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDb();
    mockClient = createMockClient();
    installer = new PluginInstaller({
      database: mockDb,
      marketplaceClient: mockClient,
      pluginsDir: "/test/plugins",
    });
  });

  // ── Constructor ────────────────────────────────────────────────────────

  describe("constructor", () => {
    it("should throw when database is missing", () => {
      expect(
        () => new PluginInstaller({ marketplaceClient: mockClient }),
      ).toThrow("database is required");
    });

    it("should throw when marketplaceClient is missing", () => {
      expect(() => new PluginInstaller({ database: mockDb })).toThrow(
        "marketplaceClient is required",
      );
    });

    it("should set pluginsDir from options", () => {
      expect(installer.pluginsDir).toBe("/test/plugins");
    });

    it("should initialize with empty activeInstalls map", () => {
      expect(installer.activeInstalls.size).toBe(0);
    });

    it("should not be initialized by default", () => {
      expect(installer.initialized).toBe(false);
    });
  });

  // ── initialize ────────────────────────────────────────────────────────

  describe("initialize", () => {
    it("should create directories and ensure tables", async () => {
      const result = await installer.initialize();
      expect(result.success).toBe(true);
      expect(installer.initialized).toBe(true);
      expect(mockDb.run).toHaveBeenCalled();
    });

    it("should return error on DB failure", async () => {
      mockDb.run.mockRejectedValue(new Error("DB error"));
      const result = await installer.initialize();
      expect(result.success).toBe(false);
      expect(result.error).toBe("DB error");
    });
  });

  // ── verifyPluginHash ──────────────────────────────────────────────────

  describe("verifyPluginHash", () => {
    it("should return error when filePath is missing", async () => {
      const result = await installer.verifyPluginHash(null, "abc");
      expect(result.success).toBe(false);
      expect(result.error).toContain("filePath");
    });

    it("should return error when expectedHash is missing", async () => {
      const result = await installer.verifyPluginHash("/path/file.zip", null);
      expect(result.success).toBe(false);
      expect(result.error).toContain("expectedHash");
    });
  });

  // ── extractPlugin ─────────────────────────────────────────────────────

  describe("extractPlugin", () => {
    it("should return error when zipPath is missing", async () => {
      const result = await installer.extractPlugin(null, "/dest");
      expect(result.success).toBe(false);
      expect(result.error).toContain("zipPath");
    });

    it("should return error when destDir is missing", async () => {
      const result = await installer.extractPlugin("/path/file.zip", null);
      expect(result.success).toBe(false);
      expect(result.error).toContain("destDir");
    });
  });

  // ── _validateManifest ─────────────────────────────────────────────────

  describe("_validateManifest", () => {
    it("should return empty array for valid manifest", () => {
      const errors = installer._validateManifest({
        name: "test-plugin",
        version: "1.0.0",
      });
      expect(errors).toHaveLength(0);
    });

    it("should detect missing name", () => {
      const errors = installer._validateManifest({ version: "1.0.0" });
      expect(errors.some((e) => e.includes("name"))).toBe(true);
    });

    it("should detect missing version", () => {
      const errors = installer._validateManifest({ name: "test" });
      expect(errors.some((e) => e.includes("version"))).toBe(true);
    });

    it("should detect invalid version format", () => {
      const errors = installer._validateManifest({
        name: "test",
        version: "abc",
      });
      expect(errors.some((e) => e.includes("version format"))).toBe(true);
    });

    it("should detect invalid permissions field", () => {
      const errors = installer._validateManifest({
        name: "test",
        version: "1.0.0",
        permissions: "not-array",
      });
      expect(errors.some((e) => e.includes("permissions"))).toBe(true);
    });

    it("should detect invalid dependencies field", () => {
      const errors = installer._validateManifest({
        name: "test",
        version: "1.0.0",
        dependencies: "not-object",
      });
      expect(errors.some((e) => e.includes("dependencies"))).toBe(true);
    });
  });

  // ── getPluginDir ──────────────────────────────────────────────────────

  describe("getPluginDir", () => {
    it("should sanitize plugin ID", () => {
      const dir = installer.getPluginDir("my-plugin_v1.0");
      expect(dir).toContain("my-plugin_v1.0");
    });

    it("should replace slashes to prevent traversal", () => {
      const dir = installer.getPluginDir("../../../etc/passwd");
      // The regex replaces / and . (only alphanumeric, dot, dash, underscore kept)
      // so path traversal via ".." is prevented
      expect(dir).not.toContain("..");
    });
  });

  // ── getInstallStatus / getActiveInstallations ─────────────────────────

  describe("getInstallStatus", () => {
    it("should return inactive when no active install", () => {
      const status = installer.getInstallStatus("p1");
      expect(status.active).toBe(false);
    });

    it("should return active when install is in progress", () => {
      installer.activeInstalls.set("p1", {
        installId: "i1",
        state: "downloading",
        startedAt: Date.now(),
      });
      const status = installer.getInstallStatus("p1");
      expect(status.active).toBe(true);
      expect(status.state).toBe("downloading");
    });
  });

  describe("getActiveInstallations", () => {
    it("should return empty list when no active installs", () => {
      expect(installer.getActiveInstallations()).toHaveLength(0);
    });

    it("should return all active installs", () => {
      installer.activeInstalls.set("p1", {
        installId: "i1",
        state: "downloading",
        startedAt: Date.now(),
      });
      installer.activeInstalls.set("p2", {
        installId: "i2",
        state: "extracting",
        startedAt: Date.now(),
      });
      expect(installer.getActiveInstallations()).toHaveLength(2);
    });
  });

  // ── listInstalled ─────────────────────────────────────────────────────

  describe("listInstalled", () => {
    it("should return empty list", async () => {
      mockDb.all.mockResolvedValue([]);
      const result = await installer.listInstalled();
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(0);
    });

    it("should apply enabled filter", async () => {
      mockDb.all.mockResolvedValue([]);
      await installer.listInstalled({ enabled: true });
      const call = mockDb.all.mock.calls[0];
      expect(call[0]).toContain("enabled = ?");
      expect(call[1]).toContain(1);
    });

    it("should apply search filter", async () => {
      mockDb.all.mockResolvedValue([]);
      await installer.listInstalled({ search: "test" });
      const call = mockDb.all.mock.calls[0];
      expect(call[0]).toContain("LIKE");
    });

    it("should handle DB errors", async () => {
      mockDb.all.mockRejectedValue(new Error("DB fail"));
      const result = await installer.listInstalled();
      expect(result.success).toBe(false);
    });
  });

  // ── getInstalledDetail ────────────────────────────────────────────────

  describe("getInstalledDetail", () => {
    it("should return null for non-existent plugin", async () => {
      mockDb.get.mockResolvedValue(null);
      const result = await installer.getInstalledDetail("non-existent");
      expect(result.success).toBe(true);
      expect(result.data).toBeNull();
    });

    it("should return plugin with history", async () => {
      mockDb.get.mockResolvedValue({
        id: "1",
        plugin_id: "p1",
        name: "Test",
        version: "1.0.0",
        metadata: "{}",
      });
      mockDb.all.mockResolvedValue([]);
      const result = await installer.getInstalledDetail("p1");
      expect(result.success).toBe(true);
      expect(result.data.plugin_id).toBe("p1");
      expect(result.data.updateHistory).toBeDefined();
    });
  });

  // ── enablePlugin / disablePlugin ──────────────────────────────────────

  describe("enablePlugin", () => {
    it("should return error if not installed", async () => {
      mockDb.get.mockResolvedValue(null);
      const result = await installer.enablePlugin("p1");
      expect(result.success).toBe(false);
      expect(result.error).toContain("not installed");
    });

    it("should return error if already enabled", async () => {
      mockDb.get.mockResolvedValue({
        plugin_id: "p1",
        enabled: 1,
        metadata: "{}",
      });
      mockDb.all.mockResolvedValue([]);
      const result = await installer.enablePlugin("p1");
      expect(result.success).toBe(false);
      expect(result.error).toContain("already enabled");
    });
  });

  describe("disablePlugin", () => {
    it("should return error if not installed", async () => {
      mockDb.get.mockResolvedValue(null);
      const result = await installer.disablePlugin("p1");
      expect(result.success).toBe(false);
      expect(result.error).toContain("not installed");
    });

    it("should return error if already disabled", async () => {
      mockDb.get.mockResolvedValue({
        plugin_id: "p1",
        enabled: 0,
        metadata: "{}",
      });
      mockDb.all.mockResolvedValue([]);
      const result = await installer.disablePlugin("p1");
      expect(result.success).toBe(false);
      expect(result.error).toContain("already disabled");
    });
  });

  // ── batchInstall / batchUninstall ─────────────────────────────────────

  describe("batchInstall", () => {
    it("should reject empty array", async () => {
      const result = await installer.batchInstall([]);
      expect(result.success).toBe(false);
    });

    it("should reject non-array", async () => {
      const result = await installer.batchInstall(null);
      expect(result.success).toBe(false);
    });
  });

  describe("batchUninstall", () => {
    it("should reject empty array", async () => {
      const result = await installer.batchUninstall([]);
      expect(result.success).toBe(false);
    });

    it("should reject non-array", async () => {
      const result = await installer.batchUninstall(null);
      expect(result.success).toBe(false);
    });
  });

  // ── _parsePluginRow ───────────────────────────────────────────────────

  describe("_parsePluginRow", () => {
    it("should return null for null input", () => {
      expect(installer._parsePluginRow(null)).toBeNull();
    });

    it("should parse JSON metadata", () => {
      const parsed = installer._parsePluginRow({
        id: "1",
        metadata: '{"key":"value"}',
      });
      expect(parsed.metadata).toEqual({ key: "value" });
    });

    it("should handle invalid JSON gracefully", () => {
      const parsed = installer._parsePluginRow({
        id: "1",
        metadata: "not-json",
      });
      expect(parsed.metadata).toEqual({});
    });
  });

  // ── setAutoUpdate ─────────────────────────────────────────────────────

  describe("setAutoUpdate", () => {
    it("should return error if not installed", async () => {
      mockDb.get.mockResolvedValue(null);
      const result = await installer.setAutoUpdate("p1", true);
      expect(result.success).toBe(false);
      expect(result.error).toContain("not installed");
    });
  });

  // ── destroy ───────────────────────────────────────────────────────────

  describe("destroy", () => {
    it("should clear active installs", async () => {
      installer.activeInstalls.set("p1", { state: "downloading" });
      await installer.destroy();
      expect(installer.activeInstalls.size).toBe(0);
    });
  });
});

/**
 * Community Registry Unit Tests
 *
 * Comprehensive tests for the CommunityRegistry class covering
 * listing, searching, installing, uninstalling, custom servers,
 * update checks, stats, and version comparison.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const {
  CommunityRegistry,
  SERVER_STATUS,
  SERVER_CATEGORIES,
  BUILTIN_CATALOG,
} = require("../../../src/main/mcp/community-registry");

describe("CommunityRegistry", () => {
  let registry;

  beforeEach(() => {
    registry = new CommunityRegistry();
  });

  // ==========================================
  // Constructor
  // ==========================================

  describe("constructor", () => {
    it("should load 8 builtin catalog entries", () => {
      expect(registry.catalog.size).toBe(8);
    });

    it("should start with no installed servers", () => {
      expect(registry.installedServers.size).toBe(0);
    });

    it("should accept empty options", () => {
      const r = new CommunityRegistry({});
      expect(r.catalog.size).toBe(8);
      expect(r.database).toBeUndefined();
    });
  });

  // ==========================================
  // listServers
  // ==========================================

  describe("listServers", () => {
    it("should return all servers with no filters", () => {
      const result = registry.listServers();
      expect(result.total).toBe(8);
      expect(result.servers).toHaveLength(8);
      expect(result.servers[0]).toHaveProperty("installed", false);
      expect(result.servers[0]).toHaveProperty("installInfo", null);
    });

    it("should filter by category", () => {
      const result = registry.listServers({
        category: SERVER_CATEGORIES.DATABASE,
      });
      // postgresql and sqlite are both database category
      expect(result.total).toBe(2);
      expect(
        result.servers.every((s) => s.category === SERVER_CATEGORIES.DATABASE),
      ).toBe(true);
    });

    it("should filter by tags (case-insensitive, any match)", () => {
      const result = registry.listServers({ tags: ["GIT"] });
      expect(result.total).toBeGreaterThanOrEqual(1);
      expect(result.servers.some((s) => s.name === "git")).toBe(true);
    });

    it("should filter by author (case-insensitive includes)", () => {
      const result = registry.listServers({ author: "anthropic" });
      expect(result.total).toBe(8); // all builtin servers are by Anthropic
    });

    it("should filter by status installed", async () => {
      await registry.installServer("mcp-server-git");
      const result = registry.listServers({ status: "installed" });
      expect(result.total).toBe(1);
      expect(result.servers[0].id).toBe("mcp-server-git");
      expect(result.servers[0].installed).toBe(true);
    });

    it("should filter by status available", async () => {
      await registry.installServer("mcp-server-git");
      const result = registry.listServers({ status: "available" });
      expect(result.total).toBe(7);
      expect(result.servers.every((s) => s.id !== "mcp-server-git")).toBe(true);
    });

    it("should sort by rating descending", () => {
      const result = registry.listServers({
        sortBy: "rating",
        sortOrder: "desc",
      });
      for (let i = 1; i < result.servers.length; i++) {
        expect(result.servers[i - 1].rating).toBeGreaterThanOrEqual(
          result.servers[i].rating,
        );
      }
    });

    it("should apply limit and offset for pagination", () => {
      const result = registry.listServers({ limit: 3, offset: 2 });
      expect(result.servers).toHaveLength(3);
      expect(result.total).toBe(8); // total is before pagination
    });
  });

  // ==========================================
  // searchServers
  // ==========================================

  describe("searchServers", () => {
    it("should return empty array for null keyword", () => {
      expect(registry.searchServers(null)).toEqual([]);
    });

    it("should return empty array for empty string", () => {
      expect(registry.searchServers("")).toEqual([]);
    });

    it("should return empty array for non-string keyword", () => {
      expect(registry.searchServers(123)).toEqual([]);
    });

    it("should find servers by exact name match", () => {
      const results = registry.searchServers("git");
      expect(results.length).toBeGreaterThanOrEqual(1);
      // The exact name match "git" should be ranked highest
      expect(results[0].name).toBe("git");
      expect(results[0].relevanceScore).toBeGreaterThan(0);
    });

    it("should search across description and tags", () => {
      const results = registry.searchServers("database");
      expect(results.length).toBeGreaterThanOrEqual(2); // postgresql and sqlite
      expect(results.every((r) => r.relevanceScore > 0)).toBe(true);
    });

    it("should sort results by relevance descending", () => {
      const results = registry.searchServers("file");
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].relevanceScore).toBeGreaterThanOrEqual(
          results[i].relevanceScore,
        );
      }
    });

    it("should annotate results with installed and installInfo", async () => {
      await registry.installServer("mcp-server-filesystem");
      const results = registry.searchServers("filesystem");
      const fsResult = results.find((r) => r.id === "mcp-server-filesystem");
      expect(fsResult.installed).toBe(true);
      expect(fsResult.installInfo).not.toBeNull();
    });
  });

  // ==========================================
  // getServerDetail
  // ==========================================

  describe("getServerDetail", () => {
    it("should return server detail with metadata", () => {
      const detail = registry.getServerDetail("mcp-server-git");
      expect(detail).not.toBeNull();
      expect(detail.name).toBe("git");
      expect(detail.catalogSize).toBe(8);
      expect(detail.installed).toBe(false);
      expect(detail.installInfo).toBeNull();
      expect(detail.lastRefreshTime).toBeNull();
    });

    it("should return null for non-existent server", () => {
      expect(registry.getServerDetail("non-existent")).toBeNull();
    });
  });

  // ==========================================
  // installServer
  // ==========================================

  describe("installServer", () => {
    it("should install a server from catalog", async () => {
      const result = await registry.installServer("mcp-server-git");
      expect(result.success).toBe(true);
      expect(result.alreadyInstalled).toBe(false);
      expect(result.server).toBeDefined();
      expect(result.mcpConfig).toBeDefined();
      expect(result.mcpConfig.command).toBe("npx");
      expect(registry.installedServers.has("mcp-server-git")).toBe(true);
    });

    it("should return alreadyInstalled if installed twice", async () => {
      await registry.installServer("mcp-server-git");
      const result = await registry.installServer("mcp-server-git");
      expect(result.success).toBe(true);
      expect(result.alreadyInstalled).toBe(true);
    });

    it("should throw for unknown server id", async () => {
      await expect(registry.installServer("does-not-exist")).rejects.toThrow(
        "Server not found in catalog",
      );
    });

    it("should warn about missing required config but not block", async () => {
      // postgresql requires "database" and "user"
      const result = await registry.installServer("mcp-server-postgresql", {});
      expect(result.success).toBe(true);
    });
  });

  // ==========================================
  // uninstallServer
  // ==========================================

  describe("uninstallServer", () => {
    it("should uninstall an installed server", async () => {
      await registry.installServer("mcp-server-git");
      const result = await registry.uninstallServer("mcp-server-git");
      expect(result.success).toBe(true);
      expect(result.uninstalledServer).toBeDefined();
      expect(registry.installedServers.has("mcp-server-git")).toBe(false);
    });

    it("should return failure if server is not installed", async () => {
      const result = await registry.uninstallServer("mcp-server-git");
      expect(result.success).toBe(false);
      expect(result.reason).toBe("Server is not installed");
    });
  });

  // ==========================================
  // getInstalledServers
  // ==========================================

  describe("getInstalledServers", () => {
    it("should return empty array when nothing installed", () => {
      expect(registry.getInstalledServers()).toEqual([]);
    });

    it("should return installed servers with catalogInfo and hasUpdate", async () => {
      await registry.installServer("mcp-server-git");
      const installed = registry.getInstalledServers();
      expect(installed).toHaveLength(1);
      expect(installed[0].catalogInfo).not.toBeNull();
      expect(installed[0].hasUpdate).toBe(false);
    });
  });

  // ==========================================
  // checkUpdates
  // ==========================================

  describe("checkUpdates", () => {
    it("should return empty array when no updates available", async () => {
      await registry.installServer("mcp-server-git");
      const updates = registry.checkUpdates();
      expect(updates).toEqual([]);
    });

    it("should detect update when catalog version is newer", async () => {
      await registry.installServer("mcp-server-git");
      // Simulate catalog having a newer version
      const catalogEntry = registry.catalog.get("mcp-server-git");
      catalogEntry.version = "2.0.0";

      const updates = registry.checkUpdates();
      expect(updates).toHaveLength(1);
      expect(updates[0].id).toBe("mcp-server-git");
      expect(updates[0].currentVersion).toBe("1.0.0");
      expect(updates[0].latestVersion).toBe("2.0.0");
    });
  });

  // ==========================================
  // addCustomServer / removeCustomServer
  // ==========================================

  describe("addCustomServer", () => {
    it("should add a custom server with isCustom flag", () => {
      const entry = registry.addCustomServer({
        name: "my-server",
        description: "Test custom server",
      });
      expect(entry.isCustom).toBe(true);
      expect(entry.name).toBe("my-server");
      expect(registry.catalog.has(entry.id)).toBe(true);
      expect(registry.catalog.size).toBe(9);
    });

    it("should use provided id if given", () => {
      const entry = registry.addCustomServer({
        id: "my-custom-id",
        name: "my-server",
      });
      expect(entry.id).toBe("my-custom-id");
    });

    it("should generate an id if not provided", () => {
      const entry = registry.addCustomServer({ name: "my-server" });
      expect(entry.id).toMatch(/^custom-my-server-/);
    });

    it("should throw if name is missing", () => {
      expect(() => registry.addCustomServer({})).toThrow(
        "Server definition must include a name",
      );
    });
  });

  describe("removeCustomServer", () => {
    it("should return false if server not found", () => {
      expect(registry.removeCustomServer("non-existent")).toBe(false);
    });

    it("should throw when trying to remove a builtin server", () => {
      expect(() => registry.removeCustomServer("mcp-server-git")).toThrow(
        "Cannot remove built-in server from catalog",
      );
    });

    it("should remove a custom server and uninstall if installed", async () => {
      const entry = registry.addCustomServer({
        id: "custom-test",
        name: "test-server",
      });
      await registry.installServer("custom-test");
      expect(registry.installedServers.has("custom-test")).toBe(true);

      const removed = registry.removeCustomServer("custom-test");
      expect(removed).toBe(true);
      expect(registry.catalog.has("custom-test")).toBe(false);
      expect(registry.installedServers.has("custom-test")).toBe(false);
    });
  });

  // ==========================================
  // getStats
  // ==========================================

  describe("getStats", () => {
    it("should return correct statistics", async () => {
      await registry.installServer("mcp-server-git");
      const stats = registry.getStats();
      expect(stats.totalServers).toBe(8);
      expect(stats.installedCount).toBe(1);
      expect(stats.availableCount).toBe(7);
      expect(stats.categories).toBeDefined();
      expect(stats.lastRefreshTime).toBeNull();
    });
  });

  // ==========================================
  // _compareVersions
  // ==========================================

  describe("_compareVersions", () => {
    it("should return positive when A > B", () => {
      expect(registry._compareVersions("2.0.0", "1.0.0")).toBeGreaterThan(0);
    });

    it("should return negative when A < B", () => {
      expect(registry._compareVersions("1.0.0", "2.0.0")).toBeLessThan(0);
    });

    it("should return 0 when equal", () => {
      expect(registry._compareVersions("1.2.3", "1.2.3")).toBe(0);
    });

    it("should handle different lengths (1.0 vs 1.0.0)", () => {
      expect(registry._compareVersions("1.0", "1.0.0")).toBe(0);
    });

    it("should return 0 for NaN parts", () => {
      expect(registry._compareVersions("1.0.0-beta", "1.0.0")).toBe(0);
    });
  });
});

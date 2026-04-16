/**
 * Tests for src/lib/mcp-registry.js — bundled read-only catalog of
 * community MCP servers. Validates catalog shape, filtering, search,
 * sorting, pagination, and lookup.
 */

import { describe, it, expect } from "vitest";
import {
  CATALOG,
  CATEGORIES,
  TRANSPORTS,
  listServers,
  searchServers,
  getServer,
} from "../../src/lib/mcp-registry.js";

describe("mcp-registry", () => {
  describe("catalog shape", () => {
    it("ships at least 8 entries", () => {
      expect(CATALOG.length).toBeGreaterThanOrEqual(8);
    });

    it("freezes the catalog and constant arrays", () => {
      expect(Object.isFrozen(CATALOG)).toBe(true);
      expect(Object.isFrozen(CATEGORIES)).toBe(true);
      expect(Object.isFrozen(TRANSPORTS)).toBe(true);
    });

    it("every entry has id/name/command/args/category/transport", () => {
      for (const entry of CATALOG) {
        expect(typeof entry.id).toBe("string");
        expect(entry.id).toMatch(/^[a-z0-9-]+$/);
        expect(typeof entry.name).toBe("string");
        expect(entry.name).toMatch(/^[a-z0-9-]+$/);
        expect(typeof entry.command).toBe("string");
        expect(Array.isArray(entry.args)).toBe(true);
        expect(CATEGORIES).toContain(entry.category);
        expect(TRANSPORTS).toContain(entry.transport);
      }
    });

    it("ids are unique", () => {
      const ids = CATALOG.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("names are unique", () => {
      const names = CATALOG.map((s) => s.name);
      expect(new Set(names).size).toBe(names.length);
    });

    it("ships the canonical first-party servers", () => {
      const names = CATALOG.map((s) => s.name);
      for (const expected of [
        "filesystem",
        "postgresql",
        "sqlite",
        "git",
        "brave-search",
        "puppeteer",
        "slack",
        "github",
      ]) {
        expect(names).toContain(expected);
      }
    });
  });

  describe("listServers", () => {
    it("returns everything by default", () => {
      const { servers, total } = listServers();
      expect(total).toBe(CATALOG.length);
      expect(servers.length).toBe(CATALOG.length);
    });

    it("filters by category", () => {
      const { servers, total } = listServers({ category: "database" });
      expect(total).toBe(2); // postgresql + sqlite
      for (const s of servers) expect(s.category).toBe("database");
    });

    it("filters case-insensitively by category", () => {
      const { total } = listServers({ category: "DATABASE" });
      expect(total).toBe(2);
    });

    it("filters by tags (any match)", () => {
      const { servers } = listServers({ tags: ["browser"] });
      expect(servers.map((s) => s.name)).toContain("puppeteer");
    });

    it("tag filter is case-insensitive", () => {
      const { servers } = listServers({ tags: ["BROWSER"] });
      expect(servers.some((s) => s.name === "puppeteer")).toBe(true);
    });

    it("filters by author substring", () => {
      const { total } = listServers({ author: "anthropic" });
      expect(total).toBe(CATALOG.length); // all bundled entries are Anthropic
    });

    it("returns [] for an unknown author", () => {
      const { total, servers } = listServers({ author: "no-such-author" });
      expect(total).toBe(0);
      expect(servers).toEqual([]);
    });

    it("sorts by name ascending by default", () => {
      const { servers } = listServers();
      for (let i = 1; i < servers.length; i++) {
        expect(
          servers[i - 1].name.localeCompare(servers[i].name),
        ).toBeLessThanOrEqual(0);
      }
    });

    it("sorts by rating descending", () => {
      const { servers } = listServers({ sortBy: "rating", sortOrder: "desc" });
      for (let i = 1; i < servers.length; i++) {
        expect(servers[i - 1].rating).toBeGreaterThanOrEqual(servers[i].rating);
      }
    });

    it("applies pagination (limit/offset)", () => {
      const { servers: page1 } = listServers({ limit: 3, offset: 0 });
      const { servers: page2 } = listServers({ limit: 3, offset: 3 });
      expect(page1.length).toBe(3);
      expect(page2.length).toBeGreaterThan(0);
      const overlap = page1.filter((s) => page2.some((p) => p.id === s.id));
      expect(overlap).toEqual([]);
    });

    it("limit=0 and negative offset fall back to defaults", () => {
      const { servers } = listServers({ limit: 0, offset: -5 });
      expect(servers.length).toBe(CATALOG.length);
    });

    it("total reflects filter count, servers reflect pagination", () => {
      const { servers, total } = listServers({
        category: "version-control",
        limit: 1,
      });
      expect(total).toBe(2); // git + github
      expect(servers.length).toBe(1);
    });
  });

  describe("searchServers", () => {
    it("returns [] for empty/non-string keyword", () => {
      expect(searchServers("")).toEqual([]);
      expect(searchServers("   ")).toEqual([]);
      expect(searchServers(null)).toEqual([]);
      expect(searchServers(undefined)).toEqual([]);
      expect(searchServers(42)).toEqual([]);
    });

    it("finds an exact name match and ranks it first", () => {
      const hits = searchServers("git");
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].name).toBe("git");
    });

    it("matches via tags", () => {
      const hits = searchServers("browser");
      expect(hits.map((s) => s.name)).toContain("puppeteer");
    });

    it("matches via description substring", () => {
      const hits = searchServers("workspace");
      expect(hits.map((s) => s.name)).toContain("slack");
    });

    it("is case-insensitive", () => {
      const a = searchServers("GIT");
      const b = searchServers("git");
      expect(a.map((s) => s.id)).toEqual(b.map((s) => s.id));
    });

    it("returns empty on no match", () => {
      expect(searchServers("totally-not-a-real-thing-zzz")).toEqual([]);
    });

    it("ranks exact name above description-only match", () => {
      // "git" should prefer `git` over `github` (exact-name beats id-substring)
      const hits = searchServers("git");
      const gitIdx = hits.findIndex((s) => s.name === "git");
      const ghIdx = hits.findIndex((s) => s.name === "github");
      expect(gitIdx).toBeGreaterThanOrEqual(0);
      expect(ghIdx).toBeGreaterThan(gitIdx);
    });
  });

  describe("getServer", () => {
    it("looks up by short name", () => {
      const s = getServer("filesystem");
      expect(s).not.toBeNull();
      expect(s.id).toBe("mcp-server-filesystem");
    });

    it("looks up by full id", () => {
      const s = getServer("mcp-server-github");
      expect(s?.name).toBe("github");
    });

    it("is case-insensitive", () => {
      expect(getServer("FILESYSTEM")?.name).toBe("filesystem");
      expect(getServer("MCP-Server-Git")?.name).toBe("git");
    });

    it("trims whitespace", () => {
      expect(getServer("  sqlite  ")?.name).toBe("sqlite");
    });

    it("returns null for unknown id/name", () => {
      expect(getServer("no-such-server")).toBeNull();
    });

    it("returns null for empty/non-string input", () => {
      expect(getServer("")).toBeNull();
      expect(getServer(null)).toBeNull();
      expect(getServer(undefined)).toBeNull();
      expect(getServer(42)).toBeNull();
    });
  });
});

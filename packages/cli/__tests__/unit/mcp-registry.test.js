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

// ===== V2 Surface Tests (cli 0.131.0) =====
import {
  describe as describeV2,
  it as itV2,
  expect as expectV2,
  beforeEach as beforeEachV2,
} from "vitest";
import {
  MCP_SERVER_MATURITY_V2,
  MCP_INVOCATION_LIFECYCLE_V2,
  registerServerV2,
  activateServerV2,
  degradeServerV2,
  retireServerV2,
  touchServerV2,
  getServerV2,
  listServersV2,
  createInvocationV2,
  dispatchInvocationV2,
  completeInvocationV2,
  failInvocationV2,
  cancelInvocationV2,
  getInvocationV2,
  listInvocationsV2,
  autoDegradeIdleServersV2,
  autoFailStuckInvocationsV2,
  getMcpRegistryStatsV2,
  setMaxActiveServersPerOwnerV2,
  setMaxPendingInvocationsPerServerV2,
  setServerIdleMsV2,
  setInvocationStuckMsV2,
  getMaxActiveServersPerOwnerV2,
  getMaxPendingInvocationsPerServerV2,
  getServerIdleMsV2,
  getInvocationStuckMsV2,
  _resetStateMcpRegistryV2,
} from "../../src/lib/mcp-registry.js";

describeV2("MCP Registry V2", () => {
  beforeEachV2(() => _resetStateMcpRegistryV2());

  describeV2("enums", () => {
    itV2("server maturity has 4 states", () => {
      expectV2(Object.keys(MCP_SERVER_MATURITY_V2).sort()).toEqual([
        "ACTIVE",
        "DEGRADED",
        "PENDING",
        "RETIRED",
      ]);
    });
    itV2("invocation lifecycle has 5 states", () => {
      expectV2(Object.keys(MCP_INVOCATION_LIFECYCLE_V2).sort()).toEqual([
        "CANCELLED",
        "COMPLETED",
        "DISPATCHING",
        "FAILED",
        "QUEUED",
      ]);
    });
    itV2("enums are frozen", () => {
      expectV2(Object.isFrozen(MCP_SERVER_MATURITY_V2)).toBe(true);
      expectV2(Object.isFrozen(MCP_INVOCATION_LIFECYCLE_V2)).toBe(true);
    });
  });

  describeV2("server lifecycle", () => {
    itV2("registers in pending", () => {
      const s = registerServerV2({
        id: "s1",
        owner: "alice",
        transport: "stdio",
      });
      expectV2(s.status).toBe("pending");
      expectV2(s.activatedAt).toBeNull();
    });
    itV2("rejects duplicate id", () => {
      registerServerV2({ id: "s1", owner: "alice", transport: "stdio" });
      expectV2(() =>
        registerServerV2({ id: "s1", owner: "bob", transport: "http" }),
      ).toThrow();
    });
    itV2("rejects missing required fields", () => {
      expectV2(() => registerServerV2({})).toThrow();
      expectV2(() => registerServerV2({ id: "s1" })).toThrow();
      expectV2(() => registerServerV2({ id: "s1", owner: "x" })).toThrow();
    });
    itV2("activates pending → active", () => {
      registerServerV2({ id: "s1", owner: "alice", transport: "stdio" });
      const s = activateServerV2("s1");
      expectV2(s.status).toBe("active");
      expectV2(s.activatedAt).toBeGreaterThan(0);
    });
    itV2("degrades active → degraded", () => {
      registerServerV2({ id: "s1", owner: "alice", transport: "stdio" });
      activateServerV2("s1");
      expectV2(degradeServerV2("s1").status).toBe("degraded");
    });
    itV2("recovers degraded → active (preserves activatedAt)", () => {
      registerServerV2({ id: "s1", owner: "alice", transport: "stdio" });
      const first = activateServerV2("s1").activatedAt;
      degradeServerV2("s1");
      const r = activateServerV2("s1");
      expectV2(r.activatedAt).toBe(first);
    });
    itV2("retires (terminal)", () => {
      registerServerV2({ id: "s1", owner: "alice", transport: "stdio" });
      retireServerV2("s1");
      expectV2(() => activateServerV2("s1")).toThrow();
    });
    itV2("rejects invalid transition", () => {
      registerServerV2({ id: "s1", owner: "alice", transport: "stdio" });
      expectV2(() => degradeServerV2("s1")).toThrow();
    });
    itV2("touches lastSeenAt", async () => {
      registerServerV2({ id: "s1", owner: "alice", transport: "stdio" });
      const before = getServerV2("s1").lastSeenAt;
      await new Promise((r) => setTimeout(r, 5));
      expectV2(touchServerV2("s1").lastSeenAt).toBeGreaterThan(before);
    });
  });

  describeV2("active-server cap", () => {
    itV2("enforces per-owner cap on pending → active", () => {
      setMaxActiveServersPerOwnerV2(2);
      ["a", "b", "c"].forEach((id) =>
        registerServerV2({ id, owner: "alice", transport: "stdio" }),
      );
      activateServerV2("a");
      activateServerV2("b");
      expectV2(() => activateServerV2("c")).toThrow(/cap reached/);
    });
    itV2("does not apply to other owners", () => {
      setMaxActiveServersPerOwnerV2(1);
      registerServerV2({ id: "a", owner: "alice", transport: "stdio" });
      registerServerV2({ id: "b", owner: "bob", transport: "http" });
      activateServerV2("a");
      expectV2(activateServerV2("b").status).toBe("active");
    });
    itV2("recovery exempt", () => {
      setMaxActiveServersPerOwnerV2(1);
      registerServerV2({ id: "a", owner: "alice", transport: "stdio" });
      activateServerV2("a");
      degradeServerV2("a");
      registerServerV2({ id: "b", owner: "alice", transport: "stdio" });
      activateServerV2("b");
      expectV2(activateServerV2("a").status).toBe("active");
    });
  });

  describeV2("invocation lifecycle", () => {
    beforeEachV2(() => {
      registerServerV2({ id: "s1", owner: "alice", transport: "stdio" });
      activateServerV2("s1");
    });
    itV2("creates queued", () => {
      const i = createInvocationV2({ id: "I1", serverId: "s1", tool: "echo" });
      expectV2(i.status).toBe("queued");
      expectV2(i.tool).toBe("echo");
    });
    itV2("rejects on retired server", () => {
      retireServerV2("s1");
      expectV2(() => createInvocationV2({ id: "I1", serverId: "s1" })).toThrow(
        /retired/,
      );
    });
    itV2("dispatches queued → dispatching", () => {
      createInvocationV2({ id: "I1", serverId: "s1" });
      const i = dispatchInvocationV2("I1");
      expectV2(i.status).toBe("dispatching");
      expectV2(i.startedAt).toBeGreaterThan(0);
    });
    itV2("completes (terminal)", () => {
      createInvocationV2({ id: "I1", serverId: "s1" });
      dispatchInvocationV2("I1");
      const i = completeInvocationV2("I1");
      expectV2(i.status).toBe("completed");
      expectV2(i.settledAt).toBeGreaterThan(0);
      expectV2(() => failInvocationV2("I1", "x")).toThrow();
    });
    itV2("fails (terminal) with error", () => {
      createInvocationV2({ id: "I1", serverId: "s1" });
      dispatchInvocationV2("I1");
      expectV2(failInvocationV2("I1", "boom").metadata.error).toBe("boom");
    });
    itV2("cancels from queued", () => {
      createInvocationV2({ id: "I1", serverId: "s1" });
      expectV2(cancelInvocationV2("I1").status).toBe("cancelled");
    });
  });

  describeV2("pending-invocation cap", () => {
    beforeEachV2(() => {
      registerServerV2({ id: "s1", owner: "alice", transport: "stdio" });
      activateServerV2("s1");
    });
    itV2("enforces at create time", () => {
      setMaxPendingInvocationsPerServerV2(2);
      createInvocationV2({ id: "I1", serverId: "s1" });
      createInvocationV2({ id: "I2", serverId: "s1" });
      expectV2(() => createInvocationV2({ id: "I3", serverId: "s1" })).toThrow(
        /cap reached/,
      );
    });
    itV2("frees up after terminal", () => {
      setMaxPendingInvocationsPerServerV2(2);
      createInvocationV2({ id: "I1", serverId: "s1" });
      createInvocationV2({ id: "I2", serverId: "s1" });
      dispatchInvocationV2("I1");
      completeInvocationV2("I1");
      expectV2(createInvocationV2({ id: "I3", serverId: "s1" }).status).toBe(
        "queued",
      );
    });
  });

  describeV2("auto-flip", () => {
    itV2("auto-degrade idle servers", () => {
      registerServerV2({ id: "s1", owner: "alice", transport: "stdio" });
      activateServerV2("s1");
      const flipped = autoDegradeIdleServersV2({
        now: Date.now() + 8 * 24 * 60 * 60 * 1000,
      });
      expectV2(flipped.length).toBe(1);
      expectV2(flipped[0].status).toBe("degraded");
    });
    itV2("auto-fail stuck invocations", () => {
      registerServerV2({ id: "s1", owner: "alice", transport: "stdio" });
      activateServerV2("s1");
      createInvocationV2({ id: "I1", serverId: "s1" });
      dispatchInvocationV2("I1");
      const flipped = autoFailStuckInvocationsV2({
        now: Date.now() + 5 * 60 * 1000,
      });
      expectV2(flipped.length).toBe(1);
      expectV2(flipped[0].metadata.error).toBe("stuck-timeout");
    });
  });

  describeV2("config setters", () => {
    itV2("rejects bad inputs", () => {
      expectV2(() => setMaxActiveServersPerOwnerV2(0)).toThrow();
      expectV2(() => setMaxPendingInvocationsPerServerV2(-1)).toThrow();
      expectV2(() => setServerIdleMsV2(NaN)).toThrow();
      expectV2(() => setInvocationStuckMsV2("x")).toThrow();
    });
    itV2("floors floats", () => {
      setMaxActiveServersPerOwnerV2(9.7);
      expectV2(getMaxActiveServersPerOwnerV2()).toBe(9);
    });
    itV2("setters update config", () => {
      setMaxPendingInvocationsPerServerV2(33);
      setServerIdleMsV2(7777);
      setInvocationStuckMsV2(3333);
      expectV2(getMaxPendingInvocationsPerServerV2()).toBe(33);
      expectV2(getServerIdleMsV2()).toBe(7777);
      expectV2(getInvocationStuckMsV2()).toBe(3333);
    });
  });

  describeV2("listing & defensive copy", () => {
    itV2("filters work", () => {
      registerServerV2({ id: "s1", owner: "alice", transport: "stdio" });
      registerServerV2({ id: "s2", owner: "bob", transport: "http" });
      activateServerV2("s1");
      expectV2(listServersV2({ owner: "alice" }).length).toBe(1);
      expectV2(listServersV2({ status: "active" }).length).toBe(1);
      expectV2(listServersV2({ transport: "http" }).length).toBe(1);
    });
    itV2("listInvocationsV2 filters by tool", () => {
      registerServerV2({ id: "s1", owner: "alice", transport: "stdio" });
      activateServerV2("s1");
      createInvocationV2({ id: "I1", serverId: "s1", tool: "echo" });
      createInvocationV2({ id: "I2", serverId: "s1", tool: "ping" });
      expectV2(listInvocationsV2({ tool: "echo" }).length).toBe(1);
    });
    itV2("deep copy on read", () => {
      registerServerV2({
        id: "s1",
        owner: "alice",
        transport: "stdio",
        metadata: { tag: "x" },
      });
      const s = getServerV2("s1");
      s.metadata.tag = "MUT";
      expectV2(getServerV2("s1").metadata.tag).toBe("x");
    });
  });

  describeV2("stats", () => {
    itV2("zero-initializes all enum keys", () => {
      const s = getMcpRegistryStatsV2();
      expectV2(s.serversByStatus.pending).toBe(0);
      expectV2(s.serversByStatus.degraded).toBe(0);
      expectV2(s.invocationsByStatus.dispatching).toBe(0);
    });
    itV2("counts match state", () => {
      registerServerV2({ id: "s1", owner: "alice", transport: "stdio" });
      activateServerV2("s1");
      createInvocationV2({ id: "I1", serverId: "s1" });
      const s = getMcpRegistryStatsV2();
      expectV2(s.totalServersV2).toBe(1);
      expectV2(s.serversByStatus.active).toBe(1);
      expectV2(s.invocationsByStatus.queued).toBe(1);
    });
  });

  describeV2("reset", () => {
    itV2("clears + restores defaults", () => {
      setMaxActiveServersPerOwnerV2(99);
      registerServerV2({ id: "s1", owner: "alice", transport: "stdio" });
      _resetStateMcpRegistryV2();
      expectV2(getMaxActiveServersPerOwnerV2()).toBe(10);
      expectV2(listServersV2({}).length).toBe(0);
    });
  });
});

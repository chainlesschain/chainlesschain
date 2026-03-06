/**
 * NostrBridge Unit Tests
 *
 * Covers:
 * - EVENT_KINDS: has all 8 kinds (0-7)
 * - Constructor: initialized=false, _relays is Map
 * - initialize(): sets initialized, calls _ensureTables
 * - _ensureTables(): creates nostr_relays and nostr_events tables
 * - addRelay(): rejects invalid URLs, accepts valid wss:// URL, inserts to DB
 * - removeRelay(): removes from DB
 * - publishEvent(): creates event with id/pubkey/kind/content/tags/sig/created_at, stores in DB
 * - getEvents(): queries with optional kind/since filters
 * - listRelays(): returns all relays
 * - _serializeEvent(): returns [0, pubkey, created_at, kind, tags, content]
 * - Singleton: getNostrBridge returns same instance
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mock logger ──────────────────────────────────────────────────────────────
vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── Mock uuid ────────────────────────────────────────────────────────────────
let uuidCounter = 0;
vi.mock("uuid", () => ({
  v4: () => `test-uuid-${++uuidCounter}`,
}));

// ─── Mock crypto ──────────────────────────────────────────────────────────────
vi.mock("crypto", () => {
  const hashDigest = "a".repeat(64);
  return {
    default: {
      randomBytes: (n) => ({
        toString: () => "b".repeat(n * 2),
      }),
      createHash: () => ({
        update: () => ({
          digest: () => hashDigest,
        }),
      }),
      createECDH: () => {
        throw new Error("not available in test");
      },
    },
    randomBytes: (n) => ({
      toString: () => "b".repeat(n * 2),
    }),
    createHash: () => ({
      update: () => ({
        digest: () => hashDigest,
      }),
    }),
  };
});

// ─── DB mock factory ─────────────────────────────────────────────────────────
let mockRunStmt, mockGetStmt, mockAllStmt, mockDb;

beforeEach(() => {
  uuidCounter = 0;
  mockRunStmt = { run: vi.fn() };
  mockGetStmt = { get: vi.fn(() => null) };
  mockAllStmt = { all: vi.fn(() => []) };
  mockDb = {
    exec: vi.fn(),
    prepare: vi.fn((sql) => {
      if (
        sql.includes("INSERT") ||
        sql.includes("UPDATE") ||
        sql.includes("DELETE")
      ) {
        return mockRunStmt;
      }
      if (
        sql.includes("SELECT") &&
        (sql.includes("= ?") || sql.includes("id"))
      ) {
        return mockGetStmt;
      }
      if (sql.includes("SELECT")) {
        return mockAllStmt;
      }
      return { run: vi.fn(), get: vi.fn(() => null), all: vi.fn(() => []) };
    }),
    saveToFile: vi.fn(),
  };
});

// ─── Module under test (ESM - dynamic import) ───────────────────────────────
let NostrBridge, getNostrBridge, EVENT_KINDS;

beforeEach(async () => {
  const mod = await import("../../../src/main/social/nostr-bridge.js");
  NostrBridge = mod.NostrBridge;
  getNostrBridge = mod.getNostrBridge;
  EVENT_KINDS = mod.EVENT_KINDS;
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("NostrBridge", () => {
  // ── EVENT_KINDS ─────────────────────────────────────────────────────────────
  describe("EVENT_KINDS", () => {
    it("should have all 8 event kinds (0-7)", () => {
      expect(EVENT_KINDS.SET_METADATA).toBe(0);
      expect(EVENT_KINDS.TEXT_NOTE).toBe(1);
      expect(EVENT_KINDS.RECOMMEND_RELAY).toBe(2);
      expect(EVENT_KINDS.CONTACTS).toBe(3);
      expect(EVENT_KINDS.ENCRYPTED_DM).toBe(4);
      expect(EVENT_KINDS.DELETE).toBe(5);
      expect(EVENT_KINDS.REPOST).toBe(6);
      expect(EVENT_KINDS.REACTION).toBe(7);
    });
  });

  // ── Constructor ──────────────────────────────────────────────────────────────
  describe("constructor", () => {
    it("should set initialized to false", () => {
      const bridge = new NostrBridge({ db: mockDb });
      expect(bridge.initialized).toBe(false);
    });

    it("should initialize _relays as a Map", () => {
      const bridge = new NostrBridge({ db: mockDb });
      expect(bridge._relays).toBeInstanceOf(Map);
      expect(bridge._relays.size).toBe(0);
    });

    it("should store the database reference", () => {
      const database = { db: mockDb };
      const bridge = new NostrBridge(database);
      expect(bridge.database).toBe(database);
    });
  });

  // ── initialize() ────────────────────────────────────────────────────────────
  describe("initialize()", () => {
    it("should set initialized to true", async () => {
      mockAllStmt.all.mockReturnValue([]);
      const bridge = new NostrBridge({ db: mockDb });
      await bridge.initialize();
      expect(bridge.initialized).toBe(true);
    });

    it("should call _ensureTables", async () => {
      mockAllStmt.all.mockReturnValue([]);
      const bridge = new NostrBridge({ db: mockDb });
      const spy = vi.spyOn(bridge, "_ensureTables");
      await bridge.initialize();
      expect(spy).toHaveBeenCalled();
    });
  });

  // ── _ensureTables() ─────────────────────────────────────────────────────────
  describe("_ensureTables()", () => {
    it("should create nostr_relays table", () => {
      const bridge = new NostrBridge({ db: mockDb });
      bridge._ensureTables();
      const sql = mockDb.exec.mock.calls[0][0];
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS nostr_relays");
    });

    it("should create nostr_events table", () => {
      const bridge = new NostrBridge({ db: mockDb });
      bridge._ensureTables();
      const sql = mockDb.exec.mock.calls[0][0];
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS nostr_events");
    });

    it("should not throw if database is null", () => {
      const bridge = new NostrBridge(null);
      expect(() => bridge._ensureTables()).not.toThrow();
    });
  });

  // ── addRelay() ──────────────────────────────────────────────────────────────
  describe("addRelay()", () => {
    it("should reject invalid URLs (not ws/wss)", async () => {
      const bridge = new NostrBridge({ db: mockDb });
      await expect(bridge.addRelay("http://example.com")).rejects.toThrow(
        "Invalid relay URL",
      );
      await expect(bridge.addRelay("https://example.com")).rejects.toThrow(
        "Invalid relay URL",
      );
      await expect(bridge.addRelay("")).rejects.toThrow("Invalid relay URL");
    });

    it("should accept valid wss:// URL", async () => {
      const bridge = new NostrBridge({ db: mockDb });
      const result = await bridge.addRelay("wss://relay.example.com");
      expect(result.success).toBe(true);
      expect(result.url).toBe("wss://relay.example.com");
    });

    it("should accept valid ws:// URL", async () => {
      const bridge = new NostrBridge({ db: mockDb });
      const result = await bridge.addRelay("ws://relay.local");
      expect(result.success).toBe(true);
    });

    it("should insert relay to DB", async () => {
      const bridge = new NostrBridge({ db: mockDb });
      await bridge.addRelay("wss://relay.test.com");
      expect(mockDb.prepare).toHaveBeenCalled();
      const insertCalls = mockDb.prepare.mock.calls.filter(([sql]) =>
        sql.includes("INSERT"),
      );
      expect(insertCalls.length).toBeGreaterThan(0);
      expect(mockRunStmt.run).toHaveBeenCalledWith(
        expect.any(String),
        "wss://relay.test.com",
        "disconnected",
      );
    });

    it("should return success=false for duplicate relay", async () => {
      const bridge = new NostrBridge({ db: mockDb });
      await bridge.addRelay("wss://relay.dup.com");
      const result = await bridge.addRelay("wss://relay.dup.com");
      expect(result.success).toBe(false);
      expect(result.message).toContain("already exists");
    });

    it("should add relay to _relays Map", async () => {
      const bridge = new NostrBridge({ db: mockDb });
      await bridge.addRelay("wss://relay.map.com");
      expect(bridge._relays.has("wss://relay.map.com")).toBe(true);
    });
  });

  // ── removeRelay() ───────────────────────────────────────────────────────────
  describe("removeRelay()", () => {
    it("should remove relay from DB and Map", async () => {
      const bridge = new NostrBridge({ db: mockDb });
      await bridge.addRelay("wss://relay.remove.com");
      mockDb.prepare.mockClear();

      const result = await bridge.removeRelay("wss://relay.remove.com");
      expect(result.success).toBe(true);
      expect(bridge._relays.has("wss://relay.remove.com")).toBe(false);

      const deleteCalls = mockDb.prepare.mock.calls.filter(([sql]) =>
        sql.includes("DELETE"),
      );
      expect(deleteCalls.length).toBeGreaterThan(0);
    });

    it("should return success=false for unknown relay", async () => {
      const bridge = new NostrBridge({ db: mockDb });
      const result = await bridge.removeRelay("wss://unknown.com");
      expect(result.success).toBe(false);
    });
  });

  // ── publishEvent() ─────────────────────────────────────────────────────────
  describe("publishEvent()", () => {
    it("should throw if kind is missing", async () => {
      const bridge = new NostrBridge({ db: mockDb });
      await expect(bridge.publishEvent({ content: "test" })).rejects.toThrow(
        "Event kind is required",
      );
    });

    it("should create event with all required fields", async () => {
      const bridge = new NostrBridge({ db: mockDb });
      const result = await bridge.publishEvent({
        kind: 1,
        content: "Hello Nostr",
        tags: [["p", "abc"]],
        pubkey: "deadbeef",
      });

      expect(result.success).toBe(true);
      const event = result.event;
      expect(event).toHaveProperty("id");
      expect(event.pubkey).toBe("deadbeef");
      expect(event.kind).toBe(1);
      expect(event.content).toBe("Hello Nostr");
      expect(event.tags).toEqual([["p", "abc"]]);
      expect(event).toHaveProperty("sig");
      expect(event).toHaveProperty("created_at");
      expect(typeof event.created_at).toBe("number");
    });

    it("should store event in DB", async () => {
      const bridge = new NostrBridge({ db: mockDb });
      await bridge.publishEvent({ kind: 1, content: "test" });

      const insertCalls = mockDb.prepare.mock.calls.filter(
        ([sql]) => sql.includes("INSERT") && sql.includes("nostr_events"),
      );
      expect(insertCalls.length).toBeGreaterThan(0);
    });
  });

  // ── getEvents() ─────────────────────────────────────────────────────────────
  describe("getEvents()", () => {
    it("should return empty array when no DB", async () => {
      const bridge = new NostrBridge(null);
      const events = await bridge.getEvents();
      expect(events).toEqual([]);
    });

    it("should return events from DB", async () => {
      const rows = [
        {
          id: "e1",
          pubkey: "pk1",
          kind: 1,
          content: "hello",
          tags: "[]",
          created_at: 1000,
        },
      ];
      mockAllStmt.all.mockReturnValue(rows);
      mockDb.prepare.mockReturnValue(mockAllStmt);

      const bridge = new NostrBridge({ db: mockDb });
      const events = await bridge.getEvents();
      expect(events.length).toBe(1);
      expect(events[0].tags).toEqual([]);
    });

    it("should apply kind filter", async () => {
      mockAllStmt.all.mockReturnValue([]);
      mockDb.prepare.mockReturnValue(mockAllStmt);

      const bridge = new NostrBridge({ db: mockDb });
      await bridge.getEvents({ kinds: [1, 4] });

      const sql = mockDb.prepare.mock.calls[0][0];
      expect(sql).toContain("kind IN");
    });

    it("should apply since filter", async () => {
      mockAllStmt.all.mockReturnValue([]);
      mockDb.prepare.mockReturnValue(mockAllStmt);

      const bridge = new NostrBridge({ db: mockDb });
      await bridge.getEvents({ since: 1700000000 });

      const sql = mockDb.prepare.mock.calls[0][0];
      expect(sql).toContain("created_at >= ?");
    });
  });

  // ── listRelays() ────────────────────────────────────────────────────────────
  describe("listRelays()", () => {
    it("should return all relays from DB", async () => {
      const dbRelays = [
        { url: "wss://r1.com", status: "disconnected" },
        { url: "wss://r2.com", status: "connected" },
      ];
      mockAllStmt.all.mockReturnValue(dbRelays);
      mockDb.prepare.mockReturnValue(mockAllStmt);

      const bridge = new NostrBridge({ db: mockDb });
      const relays = await bridge.listRelays();
      expect(relays.length).toBe(2);
    });

    it("should return in-memory relays when no DB", async () => {
      const bridge = new NostrBridge(null);
      bridge._relays.set("wss://mem.com", { ws: null, status: "disconnected" });
      const relays = await bridge.listRelays();
      expect(relays.length).toBe(1);
      expect(relays[0].url).toBe("wss://mem.com");
    });
  });

  // ── _serializeEvent() ──────────────────────────────────────────────────────
  describe("_serializeEvent()", () => {
    it("should return [0, pubkey, created_at, kind, tags, content]", () => {
      const bridge = new NostrBridge({ db: mockDb });
      const event = {
        pubkey: "abc123",
        created_at: 1700000000,
        kind: 1,
        tags: [["p", "def"]],
        content: "Hello",
      };
      const serialized = bridge._serializeEvent(event);
      expect(serialized).toEqual([
        0,
        "abc123",
        1700000000,
        1,
        [["p", "def"]],
        "Hello",
      ]);
    });
  });

  // ── Singleton ───────────────────────────────────────────────────────────────
  describe("Singleton", () => {
    it("getNostrBridge returns the same instance", () => {
      const a = getNostrBridge({ db: mockDb });
      const b = getNostrBridge({ db: mockDb });
      expect(a).toBe(b);
    });
  });
});

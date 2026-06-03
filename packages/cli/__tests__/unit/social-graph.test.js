/**
 * Tests for src/lib/social-graph.js — typed edges + realtime event stream.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  ensureGraphTables,
  addEdge,
  removeEdge,
  getNode,
  getOutgoing,
  getIncoming,
  getNeighbors,
  getGraphSnapshot,
  loadFromDb,
  subscribe,
  getEventBus,
  EDGE_TYPES,
  _resetState,
} from "../../src/lib/social-graph.js";

describe("social-graph", () => {
  beforeEach(() => {
    _resetState();
  });

  // ── Schema & constants ──────────────────────────────────────

  describe("EDGE_TYPES", () => {
    it("exposes a frozen list of supported edge types", () => {
      expect(Object.isFrozen(EDGE_TYPES)).toBe(true);
      expect(EDGE_TYPES).toEqual([
        "follow",
        "friend",
        "like",
        "mention",
        "block",
      ]);
    });
  });

  describe("ensureGraphTables", () => {
    it("creates the social_graph_edges table", () => {
      const db = new MockDatabase();
      ensureGraphTables(db);
      expect(db.tables.has("social_graph_edges")).toBe(true);
    });

    it("is a no-op when db is falsy", () => {
      expect(() => ensureGraphTables(null)).not.toThrow();
      expect(() => ensureGraphTables(undefined)).not.toThrow();
    });
  });

  // ── Mutations ───────────────────────────────────────────────

  describe("addEdge", () => {
    it("adds a new edge and creates both endpoint nodes", () => {
      const { edge, created } = addEdge(null, "alice", "bob", "follow");
      expect(created).toBe(true);
      expect(edge.sourceDid).toBe("alice");
      expect(edge.targetDid).toBe("bob");
      expect(edge.edgeType).toBe("follow");
      expect(edge.weight).toBe(1.0);
      expect(getNode("alice")).toBeTruthy();
      expect(getNode("bob")).toBeTruthy();
    });

    it("accepts custom weight and metadata", () => {
      const { edge } = addEdge(null, "alice", "bob", "like", {
        weight: 0.42,
        metadata: { note: "first like" },
      });
      expect(edge.weight).toBe(0.42);
      expect(edge.metadata).toEqual({ note: "first like" });
    });

    it("is idempotent — second call updates instead of duplicates", () => {
      addEdge(null, "alice", "bob", "follow", { weight: 1 });
      const { edge, created } = addEdge(null, "alice", "bob", "follow", {
        weight: 2.5,
      });
      expect(created).toBe(false);
      expect(edge.weight).toBe(2.5);
      // Exactly one edge from alice→bob
      expect(getOutgoing("alice")).toHaveLength(1);
    });

    it("allows multiple edge types between same pair", () => {
      addEdge(null, "alice", "bob", "follow");
      addEdge(null, "alice", "bob", "like");
      const out = getOutgoing("alice");
      expect(out).toHaveLength(2);
      expect(out.map((e) => e.edgeType).sort()).toEqual(["follow", "like"]);
    });

    it("rejects invalid edge types", () => {
      expect(() => addEdge(null, "a", "b", "kiss")).toThrow(
        /Invalid edge type/,
      );
    });

    it("rejects self-edges", () => {
      expect(() => addEdge(null, "alice", "alice", "follow")).toThrow(
        /Self-edges/,
      );
    });

    it("requires both sourceDid and targetDid", () => {
      expect(() => addEdge(null, "", "bob", "follow")).toThrow();
      expect(() => addEdge(null, "alice", "", "follow")).toThrow();
    });
  });

  describe("removeEdge", () => {
    it("removes an existing edge", () => {
      addEdge(null, "alice", "bob", "follow");
      const { removed, edge } = removeEdge(null, "alice", "bob", "follow");
      expect(removed).toBe(true);
      expect(edge.sourceDid).toBe("alice");
      expect(getOutgoing("alice")).toHaveLength(0);
    });

    it("returns removed=false if edge missing", () => {
      const { removed } = removeEdge(null, "alice", "bob", "follow");
      expect(removed).toBe(false);
    });

    it("drops nodes whose last edge is removed", () => {
      addEdge(null, "alice", "bob", "follow");
      removeEdge(null, "alice", "bob", "follow");
      expect(getNode("alice")).toBeNull();
      expect(getNode("bob")).toBeNull();
    });

    it("keeps node when other edges still reference it", () => {
      addEdge(null, "alice", "bob", "follow");
      addEdge(null, "alice", "bob", "like");
      removeEdge(null, "alice", "bob", "follow");
      expect(getNode("alice")).toBeTruthy();
      expect(getNode("bob")).toBeTruthy();
    });
  });

  // ── Queries ─────────────────────────────────────────────────

  describe("getOutgoing / getIncoming", () => {
    it("lists outgoing edges", () => {
      addEdge(null, "alice", "bob", "follow");
      addEdge(null, "alice", "carol", "follow");
      const out = getOutgoing("alice");
      expect(out.map((e) => e.targetDid).sort()).toEqual(["bob", "carol"]);
    });

    it("lists incoming edges", () => {
      addEdge(null, "alice", "bob", "follow");
      addEdge(null, "carol", "bob", "follow");
      const inc = getIncoming("bob");
      expect(inc.map((e) => e.sourceDid).sort()).toEqual(["alice", "carol"]);
    });

    it("filters by edgeType", () => {
      addEdge(null, "alice", "bob", "follow");
      addEdge(null, "alice", "bob", "like");
      expect(getOutgoing("alice", "follow")).toHaveLength(1);
      expect(getOutgoing("alice", "like")).toHaveLength(1);
      expect(getOutgoing("alice", "block")).toHaveLength(0);
    });

    it("returns empty array for unknown node", () => {
      expect(getOutgoing("ghost")).toEqual([]);
      expect(getIncoming("ghost")).toEqual([]);
    });
  });

  describe("getNeighbors", () => {
    beforeEach(() => {
      addEdge(null, "alice", "bob", "follow");
      addEdge(null, "carol", "bob", "follow");
      addEdge(null, "bob", "dave", "follow");
    });

    it("returns union of out+in neighbors by default", () => {
      expect(getNeighbors("bob").sort()).toEqual(["alice", "carol", "dave"]);
    });

    it("filters by direction=out", () => {
      expect(getNeighbors("bob", { direction: "out" })).toEqual(["dave"]);
    });

    it("filters by direction=in", () => {
      expect(getNeighbors("bob", { direction: "in" }).sort()).toEqual([
        "alice",
        "carol",
      ]);
    });

    it("filters by edgeType", () => {
      addEdge(null, "alice", "bob", "like");
      const neighbors = getNeighbors("bob", { edgeType: "like" });
      expect(neighbors).toEqual(["alice"]);
    });

    it("deduplicates when source appears as both in and out", () => {
      _resetState();
      addEdge(null, "alice", "bob", "follow");
      addEdge(null, "bob", "alice", "follow");
      expect(getNeighbors("alice").sort()).toEqual(["bob"]);
    });
  });

  describe("getGraphSnapshot", () => {
    it("returns nodes, edges, and stats", () => {
      addEdge(null, "alice", "bob", "follow");
      addEdge(null, "alice", "carol", "like");
      const snap = getGraphSnapshot();
      expect(snap.nodes).toHaveLength(3);
      expect(snap.edges).toHaveLength(2);
      expect(snap.stats.nodeCount).toBe(3);
      expect(snap.stats.edgeCount).toBe(2);
      expect(snap.stats.types).toEqual({ follow: 1, like: 1 });
      expect(snap.stats.generatedAt).toBeDefined();
    });

    it("filters by edgeType", () => {
      addEdge(null, "alice", "bob", "follow");
      addEdge(null, "alice", "carol", "like");
      const snap = getGraphSnapshot({ edgeType: "follow" });
      expect(snap.edges).toHaveLength(1);
      expect(snap.edges[0].edgeType).toBe("follow");
    });

    it("is a deep copy — snapshot doesn't mutate on further edits", () => {
      addEdge(null, "alice", "bob", "follow");
      const snap = getGraphSnapshot();
      addEdge(null, "alice", "carol", "follow");
      expect(snap.edges).toHaveLength(1);
    });
  });

  // ── Subscription ────────────────────────────────────────────

  describe("subscribe", () => {
    it("delivers edge:added events", () => {
      const events = [];
      const unsub = subscribe((e) => events.push(e));
      addEdge(null, "alice", "bob", "follow");
      expect(events.some((e) => e.type === "edge:added")).toBe(true);
      const added = events.find((e) => e.type === "edge:added");
      expect(added.payload.sourceDid).toBe("alice");
      unsub();
    });

    it("delivers edge:updated on upsert", () => {
      const events = [];
      addEdge(null, "alice", "bob", "follow");
      const unsub = subscribe((e) => events.push(e));
      addEdge(null, "alice", "bob", "follow", { weight: 2 });
      expect(events.some((e) => e.type === "edge:updated")).toBe(true);
      unsub();
    });

    it("delivers edge:removed events", () => {
      addEdge(null, "alice", "bob", "follow");
      const events = [];
      const unsub = subscribe((e) => events.push(e));
      removeEdge(null, "alice", "bob", "follow");
      expect(events.some((e) => e.type === "edge:removed")).toBe(true);
      unsub();
    });

    it("delivers node:added and node:removed", () => {
      const events = [];
      const unsub = subscribe((e) => events.push(e));
      addEdge(null, "alice", "bob", "follow");
      removeEdge(null, "alice", "bob", "follow");
      const types = events.map((e) => e.type);
      expect(types).toContain("node:added");
      expect(types).toContain("node:removed");
      unsub();
    });

    it("honors events filter list", () => {
      const events = [];
      const unsub = subscribe((e) => events.push(e), {
        events: ["edge:added"],
      });
      addEdge(null, "alice", "bob", "follow");
      removeEdge(null, "alice", "bob", "follow");
      const types = events.map((e) => e.type);
      expect(types).toContain("edge:added");
      expect(types).not.toContain("edge:removed");
      expect(types).not.toContain("node:added");
      unsub();
    });

    it("unsubscribe stops further delivery", () => {
      const events = [];
      const unsub = subscribe((e) => events.push(e));
      unsub();
      addEdge(null, "alice", "bob", "follow");
      expect(events).toHaveLength(0);
    });

    it("emits union 'change' event (via raw bus)", () => {
      const changes = [];
      const bus = getEventBus();
      bus.on("change", (c) => changes.push(c));
      addEdge(null, "alice", "bob", "follow");
      removeEdge(null, "alice", "bob", "follow");
      expect(changes).toHaveLength(2);
      expect(changes[0].kind).toBe("edge:added");
      expect(changes[1].kind).toBe("edge:removed");
    });
  });

  // ── Persistence ─────────────────────────────────────────────

  describe("loadFromDb", () => {
    it("hydrates edges and nodes from SQLite rows", () => {
      const db = new MockDatabase();
      ensureGraphTables(db);
      // Seed rows directly (bypasses ON CONFLICT UPSERT mock limitations)
      db.data.set("social_graph_edges", [
        {
          source_did: "alice",
          target_did: "bob",
          edge_type: "follow",
          weight: 1.0,
          metadata: null,
          created_at: "2026-04-16T00:00:00.000Z",
          updated_at: "2026-04-16T00:00:00.000Z",
        },
        {
          source_did: "alice",
          target_did: "carol",
          edge_type: "like",
          weight: 0.5,
          metadata: JSON.stringify({ from: "seed" }),
          created_at: "2026-04-16T00:00:00.000Z",
          updated_at: "2026-04-16T00:00:00.000Z",
        },
      ]);

      const count = loadFromDb(db);
      expect(count).toBe(2);
      expect(getOutgoing("alice")).toHaveLength(2);
      const likeEdge = getOutgoing("alice", "like")[0];
      expect(likeEdge.weight).toBe(0.5);
      expect(likeEdge.metadata).toEqual({ from: "seed" });
    });

    it("returns 0 when db is falsy", () => {
      expect(loadFromDb(null)).toBe(0);
    });

    it("clears in-memory state before hydrating", () => {
      addEdge(null, "x", "y", "follow");
      const db = new MockDatabase();
      ensureGraphTables(db);
      db.data.set("social_graph_edges", []);
      loadFromDb(db);
      expect(getNode("x")).toBeNull();
      expect(getNode("y")).toBeNull();
    });
  });
});

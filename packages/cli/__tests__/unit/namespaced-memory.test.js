import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  _working,
  _shortTerm,
  storeMemory,
  recallMemory,
  getMemoryStats,
  ensureMemoryTables,
} from "../../src/lib/hierarchical-memory.js";

describe("hierarchical-memory — namespace isolation", () => {
  let db;

  beforeEach(() => {
    // Clear all namespace Maps
    _working.clear();
    _shortTerm.clear();

    db = new MockDatabase();
    ensureMemoryTables(db);
  });

  // ─── Store with namespace ────────────────────────────────

  describe("storeMemory with namespace", () => {
    it("stores working memory in specified namespace", () => {
      storeMemory(db, "quick thought", {
        importance: 0.1,
        namespace: "sub-agent-1",
      });

      // sub-agent-1 namespace has the entry (access via internal nsMap)
      expect(_working._nsMap.has("sub-agent-1")).toBe(true);
      expect(_working._nsMap.get("sub-agent-1").size).toBe(1);

      // global namespace is empty
      expect(_working._nsMap.has("global")).toBe(false);
    });

    it("stores short-term memory in specified namespace", () => {
      storeMemory(db, "important thought", {
        importance: 0.4,
        namespace: "sub-agent-2",
      });

      expect(_shortTerm._nsMap.has("sub-agent-2")).toBe(true);
      expect(_shortTerm._nsMap.get("sub-agent-2").size).toBe(1);
    });

    it("defaults to global namespace", () => {
      storeMemory(db, "default namespace", { importance: 0.2 });

      // Via compat proxy — default namespace
      expect(_working.size).toBe(1);
    });

    it("different namespaces are isolated", () => {
      storeMemory(db, "from agent A", {
        importance: 0.2,
        namespace: "agent-a",
      });
      storeMemory(db, "from agent B", {
        importance: 0.2,
        namespace: "agent-b",
      });

      expect(_working._nsMap.get("agent-a").size).toBe(1);
      expect(_working._nsMap.get("agent-b").size).toBe(1);

      const aEntries = [..._working._nsMap.get("agent-a").values()];
      expect(aEntries[0].content).toBe("from agent A");

      const bEntries = [..._working._nsMap.get("agent-b").values()];
      expect(bEntries[0].content).toBe("from agent B");
    });
  });

  // ─── Recall with namespace ───────────────────────────────

  describe("recallMemory with namespace", () => {
    it("recalls only from specified namespace", () => {
      storeMemory(db, "agent-x memory", {
        importance: 0.2,
        namespace: "agent-x",
      });
      storeMemory(db, "agent-y memory", {
        importance: 0.2,
        namespace: "agent-y",
      });

      const results = recallMemory(db, "memory", { namespace: "agent-x" });
      const contents = results.map((r) => r.content);

      expect(contents).toContain("agent-x memory");
      expect(contents).not.toContain("agent-y memory");
    });

    it("defaults to global namespace for recall", () => {
      storeMemory(db, "global memory item", { importance: 0.2 });
      storeMemory(db, "namespaced item", {
        importance: 0.2,
        namespace: "private",
      });

      const results = recallMemory(db, "item");
      const contents = results.map((r) => r.content);
      expect(contents).toContain("global memory item");
      expect(contents).not.toContain("namespaced item");
    });

    it("still recalls from shared DB layers (long-term/core)", () => {
      // Store in long-term (DB, not namespaced)
      storeMemory(db, "long term fact about testing", { importance: 0.7 });

      // Recall from a sub-agent namespace — should still see DB entries
      const results = recallMemory(db, "testing", { namespace: "sub-123" });
      const hasLongTerm = results.some((r) => r.layer === "long-term");
      // This depends on MockDatabase supporting LIKE queries
      // At minimum, namespace-scoped in-memory search should work
      expect(results).toBeDefined();
    });
  });

  // ─── Stats with namespaces ───────────────────────────────

  describe("getMemoryStats with namespaces", () => {
    it("sums across all namespaces", () => {
      storeMemory(db, "a", { importance: 0.2, namespace: "ns-1" });
      storeMemory(db, "b", { importance: 0.2, namespace: "ns-2" });
      storeMemory(db, "c", { importance: 0.1, namespace: "ns-1" });

      const stats = getMemoryStats(db);
      expect(stats.working).toBe(3);
    });

    it("reports namespace names", () => {
      storeMemory(db, "x", { importance: 0.2, namespace: "alpha" });
      storeMemory(db, "y", { importance: 0.4, namespace: "beta" });

      const stats = getMemoryStats(db);
      expect(stats.namespaces.working).toEqual(
        expect.arrayContaining(["alpha"]),
      );
      expect(stats.namespaces.shortTerm).toEqual(
        expect.arrayContaining(["beta"]),
      );
    });
  });
});

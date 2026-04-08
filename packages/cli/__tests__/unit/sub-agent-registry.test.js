import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SubAgentRegistry } from "../../src/lib/sub-agent-registry.js";

// Minimal mock for SubAgentContext
function createMockSubCtx(overrides = {}) {
  return {
    id: overrides.id || `sub-mock-${Date.now()}`,
    parentId: overrides.parentId || null,
    role: overrides.role || "test",
    task: overrides.task || "test task",
    status: overrides.status || "active",
    createdAt: overrides.createdAt || new Date().toISOString(),
    completedAt: overrides.completedAt || null,
    result: overrides.result || null,
    _tokenCount: 0,
    _toolsUsed: [],
    _iterationCount: 0,
    toJSON() {
      return {
        id: this.id,
        parentId: this.parentId,
        role: this.role,
        task: this.task,
        status: this.status,
        messageCount: 0,
        toolsUsed: [],
        tokenCount: 0,
        iterationCount: 0,
        createdAt: this.createdAt,
        completedAt: this.completedAt,
      };
    },
    forceComplete(reason) {
      this.status = "completed";
      this.completedAt = new Date().toISOString();
      this.result = {
        summary: `(forced: ${reason})`,
        artifacts: [],
        tokenCount: 0,
        toolsUsed: [],
        iterationCount: 0,
      };
    },
  };
}

describe("sub-agent-registry", () => {
  let registry;

  beforeEach(() => {
    SubAgentRegistry.resetInstance();
    registry = SubAgentRegistry.getInstance();
  });

  afterEach(() => {
    SubAgentRegistry.resetInstance();
  });

  // ─── Singleton ─────────────────────────────────────────────

  describe("getInstance()", () => {
    it("returns the same instance", () => {
      const a = SubAgentRegistry.getInstance();
      const b = SubAgentRegistry.getInstance();
      expect(a).toBe(b);
    });

    it("resetInstance clears singleton", () => {
      const a = SubAgentRegistry.getInstance();
      SubAgentRegistry.resetInstance();
      const b = SubAgentRegistry.getInstance();
      expect(a).not.toBe(b);
    });
  });

  // ─── Register / Complete ─────────────────────────────────────

  describe("register + complete", () => {
    it("registers an active sub-agent", () => {
      const ctx = createMockSubCtx({ id: "sub-1" });
      registry.register(ctx);
      expect(registry.getActive()).toHaveLength(1);
      expect(registry.getActive()[0].id).toBe("sub-1");
    });

    it("completes a sub-agent and moves to history", () => {
      const ctx = createMockSubCtx({ id: "sub-2" });
      registry.register(ctx);
      registry.complete("sub-2", { summary: "done", tokenCount: 100 });
      expect(registry.getActive()).toHaveLength(0);
      expect(registry.getHistory()).toHaveLength(1);
      expect(registry.getHistory()[0].summary).toBe("done");
    });

    it("ignores completing unknown id", () => {
      registry.complete("nonexistent", {});
      expect(registry.getHistory()).toHaveLength(0);
    });
  });

  // ─── History Ring Buffer ──────────────────────────────────

  describe("history ring buffer", () => {
    it("maintains insertion order", () => {
      for (let i = 0; i < 5; i++) {
        const ctx = createMockSubCtx({ id: `sub-${i}` });
        registry.register(ctx);
        registry.complete(`sub-${i}`, { summary: `result-${i}` });
      }
      const history = registry.getHistory();
      expect(history).toHaveLength(5);
      expect(history[0].summary).toBe("result-0");
      expect(history[4].summary).toBe("result-4");
    });
  });

  // ─── Force Complete All ───────────────────────────────────

  describe("forceCompleteAll()", () => {
    it("force-completes all active sub-agents", () => {
      registry.register(createMockSubCtx({ id: "sub-a" }));
      registry.register(createMockSubCtx({ id: "sub-b" }));
      registry.forceCompleteAll();
      expect(registry.getActive()).toHaveLength(0);
      expect(registry.getHistory()).toHaveLength(2);
    });

    it("only force-completes agents matching sessionId", () => {
      registry.register(
        createMockSubCtx({ id: "sub-x", parentId: "session-1" }),
      );
      registry.register(
        createMockSubCtx({ id: "sub-y", parentId: "session-2" }),
      );
      registry.forceCompleteAll("session-1");
      expect(registry.getActive()).toHaveLength(1);
      expect(registry.getActive()[0].id).toBe("sub-y");
    });
  });

  // ─── Parent-scoped queries ───────────────────────────────

  describe("getByParent()", () => {
    it("returns only active + history entries matching parentId", () => {
      registry.register(
        createMockSubCtx({ id: "sub-p1-a", parentId: "session-p1" }),
      );
      registry.register(
        createMockSubCtx({ id: "sub-p1-b", parentId: "session-p1" }),
      );
      registry.register(
        createMockSubCtx({ id: "sub-p2", parentId: "session-p2" }),
      );

      // Complete one p1 child so it moves into history
      registry.complete("sub-p1-b", { summary: "first done", tokenCount: 10 });

      const scoped = registry.getByParent("session-p1");
      expect(scoped.active.map((a) => a.id)).toEqual(["sub-p1-a"]);
      expect(scoped.history).toHaveLength(1);
      expect(scoped.history[0].id).toBe("sub-p1-b");

      // Other session is not leaked into the scoped view
      const otherView = registry.getByParent("session-p2");
      expect(otherView.active.map((a) => a.id)).toEqual(["sub-p2"]);
      expect(otherView.history).toHaveLength(0);
    });

    it("returns empty arrays for missing parentId", () => {
      const result = registry.getByParent(null);
      expect(result.active).toEqual([]);
      expect(result.history).toEqual([]);
    });
  });

  describe("getById()", () => {
    it("finds an active sub-agent snapshot by id", () => {
      registry.register(createMockSubCtx({ id: "sub-find-1" }));
      const found = registry.getById("sub-find-1");
      expect(found).toBeTruthy();
      expect(found.id).toBe("sub-find-1");
      expect(found.status).toBe("active");
    });

    it("finds a completed sub-agent in history", () => {
      registry.register(createMockSubCtx({ id: "sub-find-2" }));
      registry.complete("sub-find-2", {
        summary: "archived",
        tokenCount: 5,
      });
      const found = registry.getById("sub-find-2");
      expect(found).toBeTruthy();
      expect(found.summary).toBe("archived");
    });

    it("returns null for unknown id", () => {
      expect(registry.getById("does-not-exist")).toBeNull();
      expect(registry.getById(null)).toBeNull();
    });
  });

  // ─── Cleanup ──────────────────────────────────────────────

  describe("cleanup()", () => {
    it("cleans up stale entries", () => {
      const old = createMockSubCtx({
        id: "sub-old",
        createdAt: new Date(Date.now() - 999999).toISOString(),
      });
      registry.register(old);
      registry.cleanup(1000); // 1 second max age
      expect(registry.getActive()).toHaveLength(0);
      expect(registry.getHistory()).toHaveLength(1);
    });

    it("keeps recent entries", () => {
      const recent = createMockSubCtx({ id: "sub-new" });
      registry.register(recent);
      registry.cleanup(600000);
      expect(registry.getActive()).toHaveLength(1);
    });
  });

  // ─── Stats ────────────────────────────────────────────────

  describe("getStats()", () => {
    it("returns initial stats", () => {
      const stats = registry.getStats();
      expect(stats.active).toBe(0);
      expect(stats.completed).toBe(0);
      expect(stats.totalTokens).toBe(0);
      expect(stats.avgDurationMs).toBe(0);
    });

    it("tracks completion stats", () => {
      const ctx = createMockSubCtx({ id: "sub-s" });
      registry.register(ctx);
      registry.complete("sub-s", {
        summary: "done",
        tokenCount: 200,
        iterationCount: 3,
      });
      const stats = registry.getStats();
      expect(stats.active).toBe(0);
      expect(stats.completed).toBe(1);
      expect(stats.totalTokens).toBe(200);
    });
  });
});

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

// ===== V2 Tests: Sub-Agent Registry governance overlay =====
import {
  SUBAGENT_PROFILE_MATURITY_V2,
  SUBAGENT_TASK_LIFECYCLE_V2,
  registerSubagentProfileV2,
  activateSubagentProfileV2,
  pauseSubagentProfileV2,
  retireSubagentProfileV2,
  touchSubagentProfileV2,
  getSubagentProfileV2,
  listSubagentProfilesV2,
  createSubagentTaskV2,
  startSubagentTaskV2,
  completeSubagentTaskV2,
  failSubagentTaskV2,
  cancelSubagentTaskV2,
  getSubagentTaskV2,
  listSubagentTasksV2,
  autoPauseIdleSubagentsV2,
  autoFailStuckSubagentTasksV2,
  getSubAgentRegistryStatsV2,
  _resetStateSubAgentRegistryV2,
  setMaxActiveSubagentsPerOwnerV2,
  getMaxActiveSubagentsPerOwnerV2,
  setMaxPendingTasksPerSubagentV2,
  getMaxPendingTasksPerSubagentV2,
  setSubagentIdleMsV2,
  getSubagentIdleMsV2,
  setSubagentTaskStuckMsV2,
  getSubagentTaskStuckMsV2,
} from "../../src/lib/sub-agent-registry.js";

describe("Sub-Agent Registry V2 governance overlay", () => {
  beforeEach(() => {
    _resetStateSubAgentRegistryV2();
  });
  describe("enums", () => {
    it("profile maturity 4 states", () => {
      expect(Object.keys(SUBAGENT_PROFILE_MATURITY_V2).sort()).toEqual([
        "ACTIVE",
        "PAUSED",
        "PENDING",
        "RETIRED",
      ]);
      expect(Object.isFrozen(SUBAGENT_PROFILE_MATURITY_V2)).toBe(true);
    });
    it("task lifecycle 5 states", () => {
      expect(Object.keys(SUBAGENT_TASK_LIFECYCLE_V2).sort()).toEqual([
        "CANCELLED",
        "COMPLETED",
        "FAILED",
        "QUEUED",
        "RUNNING",
      ]);
    });
  });
  describe("profile lifecycle", () => {
    it("pending register → activate stamps activatedAt", () => {
      registerSubagentProfileV2({ id: "a", owner: "u" });
      const p = activateSubagentProfileV2("a");
      expect(p.status).toBe("active");
      expect(p.activatedAt).not.toBeNull();
    });
    it("dup rejected", () => {
      registerSubagentProfileV2({ id: "a", owner: "u" });
      expect(() => registerSubagentProfileV2({ id: "a", owner: "u" })).toThrow(
        /already/,
      );
    });
    it("paused → active preserves activatedAt", () => {
      registerSubagentProfileV2({ id: "a", owner: "u" });
      activateSubagentProfileV2("a");
      const t1 = getSubagentProfileV2("a").activatedAt;
      pauseSubagentProfileV2("a");
      expect(activateSubagentProfileV2("a").activatedAt).toBe(t1);
    });
    it("retire stamps retiredAt", () => {
      registerSubagentProfileV2({ id: "a", owner: "u" });
      const p = retireSubagentProfileV2("a");
      expect(p.retiredAt).not.toBeNull();
      expect(() => activateSubagentProfileV2("a")).toThrow(/invalid/);
    });
    it("touch terminal throws", () => {
      registerSubagentProfileV2({ id: "a", owner: "u" });
      retireSubagentProfileV2("a");
      expect(() => touchSubagentProfileV2("a")).toThrow(/terminal/);
    });
  });
  describe("active cap", () => {
    it("recovery exempt", () => {
      setMaxActiveSubagentsPerOwnerV2(1);
      registerSubagentProfileV2({ id: "a", owner: "u" });
      activateSubagentProfileV2("a");
      pauseSubagentProfileV2("a");
      registerSubagentProfileV2({ id: "b", owner: "u" });
      activateSubagentProfileV2("b");
      expect(activateSubagentProfileV2("a").status).toBe("active");
    });
    it("initial enforces cap", () => {
      setMaxActiveSubagentsPerOwnerV2(1);
      registerSubagentProfileV2({ id: "a", owner: "u" });
      activateSubagentProfileV2("a");
      registerSubagentProfileV2({ id: "b", owner: "u" });
      expect(() => activateSubagentProfileV2("b")).toThrow(/max active/);
    });
  });
  describe("task lifecycle", () => {
    beforeEach(() => {
      registerSubagentProfileV2({ id: "p", owner: "u" });
    });
    it("create queued", () => {
      expect(createSubagentTaskV2({ id: "t", profileId: "p" }).status).toBe(
        "queued",
      );
    });
    it("missing profile throws", () => {
      expect(() =>
        createSubagentTaskV2({ id: "t", profileId: "nope" }),
      ).toThrow(/not found/);
    });
    it("start stamps", () => {
      createSubagentTaskV2({ id: "t", profileId: "p" });
      const x = startSubagentTaskV2("t");
      expect(x.status).toBe("running");
      expect(x.startedAt).not.toBeNull();
    });
    it("complete stamps settledAt", () => {
      createSubagentTaskV2({ id: "t", profileId: "p" });
      startSubagentTaskV2("t");
      expect(completeSubagentTaskV2("t").settledAt).not.toBeNull();
    });
    it("fail reason", () => {
      createSubagentTaskV2({ id: "t", profileId: "p" });
      startSubagentTaskV2("t");
      expect(failSubagentTaskV2("t", "x").metadata.failReason).toBe("x");
    });
    it("cancel from queued", () => {
      createSubagentTaskV2({ id: "t", profileId: "p" });
      expect(cancelSubagentTaskV2("t").status).toBe("cancelled");
    });
    it("invalid transition throws", () => {
      createSubagentTaskV2({ id: "t", profileId: "p" });
      expect(() => completeSubagentTaskV2("t")).toThrow(/invalid/);
    });
  });
  describe("pending cap", () => {
    it("enforced", () => {
      setMaxPendingTasksPerSubagentV2(2);
      registerSubagentProfileV2({ id: "p", owner: "u" });
      createSubagentTaskV2({ id: "a", profileId: "p" });
      createSubagentTaskV2({ id: "b", profileId: "p" });
      expect(() => createSubagentTaskV2({ id: "c", profileId: "p" })).toThrow(
        /max pending/,
      );
    });
  });
  describe("auto flip", () => {
    it("auto-pause idle", () => {
      setSubagentIdleMsV2(1000);
      registerSubagentProfileV2({ id: "p", owner: "u" });
      activateSubagentProfileV2("p");
      const base = getSubagentProfileV2("p").lastTouchedAt;
      expect(autoPauseIdleSubagentsV2({ now: base + 5000 }).count).toBe(1);
      expect(getSubagentProfileV2("p").status).toBe("paused");
    });
    it("auto-fail stuck", () => {
      setSubagentTaskStuckMsV2(500);
      registerSubagentProfileV2({ id: "p", owner: "u" });
      createSubagentTaskV2({ id: "t", profileId: "p" });
      startSubagentTaskV2("t");
      const base = getSubagentTaskV2("t").startedAt;
      expect(autoFailStuckSubagentTasksV2({ now: base + 5000 }).count).toBe(1);
      expect(getSubagentTaskV2("t").status).toBe("failed");
    });
  });
  describe("config & stats", () => {
    it("rejects invalid", () => {
      expect(() => setMaxActiveSubagentsPerOwnerV2(0)).toThrow();
      expect(() => setMaxActiveSubagentsPerOwnerV2(NaN)).toThrow();
    });
    it("floors", () => {
      setMaxPendingTasksPerSubagentV2(15.9);
      expect(getMaxPendingTasksPerSubagentV2()).toBe(15);
    });
    it("round-trip", () => {
      setSubagentIdleMsV2(10);
      setSubagentTaskStuckMsV2(20);
      expect(getSubagentIdleMsV2()).toBe(10);
      expect(getSubagentTaskStuckMsV2()).toBe(20);
    });
    it("stats zero-init", () => {
      const s = getSubAgentRegistryStatsV2();
      for (const v of Object.values(SUBAGENT_PROFILE_MATURITY_V2))
        expect(s.profilesByStatus[v]).toBe(0);
      for (const v of Object.values(SUBAGENT_TASK_LIFECYCLE_V2))
        expect(s.tasksByStatus[v]).toBe(0);
    });
    it("reset", () => {
      setMaxActiveSubagentsPerOwnerV2(99);
      registerSubagentProfileV2({ id: "p", owner: "u" });
      _resetStateSubAgentRegistryV2();
      expect(getSubAgentRegistryStatsV2().totalProfilesV2).toBe(0);
      expect(getMaxActiveSubagentsPerOwnerV2()).toBe(12);
    });
    it("defensive copy", () => {
      registerSubagentProfileV2({ id: "p", owner: "u", metadata: { k: "v" } });
      const x = getSubagentProfileV2("p");
      x.metadata.k = "bad";
      expect(getSubagentProfileV2("p").metadata.k).toBe("v");
    });
    it("lists", () => {
      registerSubagentProfileV2({ id: "a", owner: "u" });
      registerSubagentProfileV2({ id: "b", owner: "u" });
      expect(listSubagentProfilesV2().length).toBe(2);
      createSubagentTaskV2({ id: "t", profileId: "a" });
      expect(listSubagentTasksV2().length).toBe(1);
    });
  });
});

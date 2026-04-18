/**
 * Unit tests: AgentRouter
 * Tests backend resolution, routing strategies, task dispatch.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  _deps,
  detectClaudeCode,
  detectCodex,
} from "../../src/lib/claude-code-bridge.js";
import { AgentRouter, BACKEND_TYPE } from "../../src/lib/agent-router.js";

// ─── Helpers ─────────────────────────────────────────────────────

/** Create a mock ClaudeCodePool that returns success immediately. */
function mockPool(resultOverride = {}) {
  return {
    dispatch: vi.fn(async (tasks) =>
      tasks.map((t) => ({
        taskId: t.id,
        agentId: `mock-agent`,
        success: true,
        output: "done",
        exitCode: 0,
        duration: 100,
        ...resultOverride,
      })),
    ),
    on: vi.fn(),
  };
}

/**
 * Build an AgentRouter with pre-resolved mock backends (bypasses real CLI detection).
 */
function makeRouter(backends, strategy = "round-robin") {
  const router = new AgentRouter({ backends: [], strategy, maxParallel: 3 });
  // Override resolved backends directly for testing
  router._backends = backends;
  return router;
}

function makeCliBackend(type = BACKEND_TYPE.CLAUDE) {
  const pool = mockPool();
  return { type, isCLI: true, weight: 1, _pool: pool, timeout: 300_000 };
}

function makeApiBackend(type = BACKEND_TYPE.GEMINI) {
  return {
    type,
    isCLI: false,
    weight: 1,
    provider: type,
    model: null,
    apiKey: null,
    baseUrl: null,
    timeout: 60_000,
  };
}

// ─── AgentRouter.autoDetect ───────────────────────────────────────

describe("AgentRouter.autoDetect", () => {
  let originalDeps;

  beforeEach(() => {
    originalDeps = { ..._deps };
  });
  afterEach(() => {
    Object.assign(_deps, originalDeps);
    vi.clearAllMocks();
  });

  it("includes claude backend when claude CLI is found", () => {
    _deps.execSync = vi.fn((cmd) => {
      if (cmd.includes("claude")) return "2.0.0";
      throw new Error("not found");
    });
    const router = AgentRouter.autoDetect();
    const types = router._backends.map((b) => b.type);
    expect(types).toContain(BACKEND_TYPE.CLAUDE);
  });

  it("always includes ollama as local fallback", () => {
    _deps.execSync = vi.fn(() => {
      throw new Error("not found");
    });
    const router = AgentRouter.autoDetect();
    const types = router._backends.map((b) => b.type);
    expect(types).toContain(BACKEND_TYPE.OLLAMA);
  });

  it("includes openai when OPENAI_API_KEY is set", () => {
    _deps.execSync = vi.fn(() => {
      throw new Error("not found");
    });
    const origKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";
    const router = AgentRouter.autoDetect();
    process.env.OPENAI_API_KEY = origKey;
    const types = router._backends.map((b) => b.type);
    expect(types).toContain(BACKEND_TYPE.OPENAI);
  });
});

// ─── AgentRouter.summary ──────────────────────────────────────────

describe("AgentRouter.summary()", () => {
  it("returns array of backend summaries", () => {
    const router = makeRouter([
      makeCliBackend(BACKEND_TYPE.CLAUDE),
      makeApiBackend(BACKEND_TYPE.GEMINI),
    ]);
    const summary = router.summary();
    expect(summary).toHaveLength(2);
    expect(summary[0]).toMatchObject({
      type: BACKEND_TYPE.CLAUDE,
      kind: "cli",
      weight: 1,
    });
    expect(summary[1]).toMatchObject({
      type: BACKEND_TYPE.GEMINI,
      kind: "api",
      weight: 1,
    });
  });
});

// ─── Round-robin strategy ─────────────────────────────────────────

describe("AgentRouter round-robin strategy", () => {
  it("distributes tasks across backends", async () => {
    const b1 = makeCliBackend(BACKEND_TYPE.CLAUDE);
    const b2 = makeCliBackend(BACKEND_TYPE.CODEX);
    const router = makeRouter([b1, b2], "round-robin");

    const tasks = [
      { id: "t1", description: "task 1" },
      { id: "t2", description: "task 2" },
      { id: "t3", description: "task 3" },
    ];

    const results = await router.dispatch(tasks, { cwd: "/tmp" });
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.success)).toBe(true);
  });

  it("uses weighted round-robin based on backend weight", async () => {
    const heavy = makeCliBackend(BACKEND_TYPE.CLAUDE);
    heavy.weight = 3;
    const light = makeApiBackend(BACKEND_TYPE.GEMINI);
    light.weight = 1;
    // Patch api backend with a dispatch-like mock
    const dispatchCounts = { claude: 0, gemini: 0 };

    const router = makeRouter([heavy, light], "round-robin");
    // Manually check weighted distribution by calling _weightedNext multiple times
    for (let i = 0; i < 8; i++) {
      const b = router._weightedNext();
      dispatchCounts[b.type]++;
    }
    // claude weight=3, gemini weight=1 → expect more claude selections
    expect(dispatchCounts[BACKEND_TYPE.CLAUDE]).toBeGreaterThan(
      dispatchCounts[BACKEND_TYPE.GEMINI],
    );
  });
});

// ─── Primary strategy ─────────────────────────────────────────────

describe("AgentRouter primary strategy", () => {
  it("dispatches all tasks to first backend", async () => {
    const b1 = makeCliBackend(BACKEND_TYPE.CLAUDE);
    const b2 = makeCliBackend(BACKEND_TYPE.CODEX);
    const router = makeRouter([b1, b2], "primary");

    await router.dispatch([{ id: "t1", description: "task" }], { cwd: "/tmp" });

    expect(b1._pool.dispatch).toHaveBeenCalledTimes(1);
    expect(b2._pool.dispatch).not.toHaveBeenCalled();
  });

  it("falls back to second backend on failure", async () => {
    const b1 = makeCliBackend(BACKEND_TYPE.CLAUDE);
    b1._pool.dispatch = vi.fn(async (tasks) =>
      tasks.map((t) => ({
        taskId: t.id,
        success: false,
        output: "",
        exitCode: 1,
        duration: 100,
      })),
    );
    const b2 = makeCliBackend(BACKEND_TYPE.CODEX);
    const router = makeRouter([b1, b2], "primary");

    const results = await router.dispatch([{ id: "t1", description: "task" }], {
      cwd: "/tmp",
    });
    expect(b2._pool.dispatch).toHaveBeenCalledTimes(1);
    expect(results[0].success).toBe(true);
  });
});

// ─── by-type strategy ─────────────────────────────────────────────

describe("AgentRouter by-type strategy", () => {
  it("routes code-generation tasks to claude backend", async () => {
    const claudeBackend = makeCliBackend(BACKEND_TYPE.CLAUDE);
    const geminiBackend = makeApiBackend(BACKEND_TYPE.GEMINI);
    geminiBackend._pool = mockPool();
    const router = makeRouter([claudeBackend, geminiBackend], "by-type");
    // Patch _findBackend to return claude for code-generation
    const origFind = router._findBackend.bind(router);
    router._findBackend = (type) => {
      if (type === BACKEND_TYPE.CLAUDE) return claudeBackend;
      return origFind(type);
    };

    await router.dispatch(
      [
        {
          id: "t1",
          description: "implement new feature",
          type: "code-generation",
        },
      ],
      { cwd: "/tmp" },
    );
    expect(claudeBackend._pool.dispatch).toHaveBeenCalledTimes(1);
  });
});

// ─── parallel-all strategy ────────────────────────────────────────

describe("AgentRouter parallel-all strategy", () => {
  it("dispatches each task to ALL backends and picks best result", async () => {
    const b1 = makeCliBackend(BACKEND_TYPE.CLAUDE);
    const b2 = makeCliBackend(BACKEND_TYPE.CODEX);
    b2._pool.dispatch = vi.fn(async (tasks) =>
      tasks.map((t) => ({
        taskId: t.id,
        success: false,
        output: "failed",
        exitCode: 1,
        duration: 50,
      })),
    );
    const router = makeRouter([b1, b2], "parallel-all");

    const results = await router.dispatch([{ id: "t1", description: "task" }], {
      cwd: "/tmp",
    });
    expect(results).toHaveLength(1);
    // Should pick the successful result (b1)
    expect(results[0].success).toBe(true);
    // allResults should contain both
    expect(results[0].allResults).toHaveLength(2);
  });

  it("returns first result even if all fail", async () => {
    const b1 = makeCliBackend(BACKEND_TYPE.CLAUDE);
    b1._pool.dispatch = vi.fn(async (tasks) =>
      tasks.map((t) => ({
        taskId: t.id,
        success: false,
        exitCode: 1,
        output: "",
        duration: 50,
      })),
    );
    const router = makeRouter([b1], "parallel-all");
    const results = await router.dispatch([{ id: "t1", description: "task" }], {
      cwd: "/tmp",
    });
    expect(results[0].success).toBe(false);
  });
});

// ─── Error cases ──────────────────────────────────────────────────

describe("AgentRouter edge cases", () => {
  it("throws when no backends are available", async () => {
    const router = makeRouter([], "round-robin");
    await expect(
      router.dispatch([{ id: "t1", description: "x" }], { cwd: "/tmp" }),
    ).rejects.toThrow("No agent backends available");
  });

  it("emits agent:start and agent:complete events", async () => {
    const b1 = makeCliBackend(BACKEND_TYPE.CLAUDE);
    const router = makeRouter([b1], "round-robin");
    const startFn = vi.fn();
    const completeFn = vi.fn();
    router.on("agent:start", startFn);
    router.on("agent:complete", completeFn);

    await router.dispatch([{ id: "t1", description: "task" }], { cwd: "/tmp" });
    expect(startFn).toHaveBeenCalledTimes(1);
    expect(completeFn).toHaveBeenCalledTimes(1);
    expect(completeFn.mock.calls[0][0].backendType).toBe(BACKEND_TYPE.CLAUDE);
  });
});

// ===== V2 Tests: Agent Router governance overlay =====
import {
  ROUTER_PROFILE_MATURITY_V2,
  ROUTER_DISPATCH_LIFECYCLE_V2,
  registerRouterProfileV2,
  activateRouterProfileV2,
  degradeRouterProfileV2,
  retireRouterProfileV2,
  touchRouterProfileV2,
  getRouterProfileV2,
  listRouterProfilesV2,
  createDispatchV2,
  dispatchDispatchV2,
  completeDispatchV2,
  failDispatchV2,
  cancelDispatchV2,
  getDispatchV2,
  listDispatchesV2,
  autoDegradeIdleProfilesRouterV2,
  autoFailStuckDispatchesV2,
  getAgentRouterStatsV2,
  _resetStateAgentRouterV2,
  setMaxActiveProfilesPerOwnerRouterV2,
  getMaxActiveProfilesPerOwnerRouterV2,
  setMaxPendingDispatchesPerProfileV2,
  getMaxPendingDispatchesPerProfileV2,
  setProfileIdleMsRouterV2,
  getProfileIdleMsRouterV2,
  setDispatchStuckMsV2,
  getDispatchStuckMsV2,
} from "../../src/lib/agent-router.js";

describe("Agent Router V2 governance overlay", () => {
  beforeEach(() => {
    _resetStateAgentRouterV2();
  });

  describe("enums", () => {
    it("profile maturity has 4 states", () => {
      expect(Object.keys(ROUTER_PROFILE_MATURITY_V2).sort()).toEqual([
        "ACTIVE",
        "DEGRADED",
        "PENDING",
        "RETIRED",
      ]);
      expect(Object.isFrozen(ROUTER_PROFILE_MATURITY_V2)).toBe(true);
    });
    it("dispatch lifecycle has 5 states", () => {
      expect(Object.keys(ROUTER_DISPATCH_LIFECYCLE_V2).sort()).toEqual([
        "CANCELLED",
        "COMPLETED",
        "DISPATCHING",
        "FAILED",
        "QUEUED",
      ]);
      expect(Object.isFrozen(ROUTER_DISPATCH_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("profile lifecycle", () => {
    it("registers with pending status", () => {
      const p = registerRouterProfileV2({ id: "r1", owner: "u1" });
      expect(p.status).toBe("pending");
      expect(p.activatedAt).toBeNull();
    });
    it("rejects duplicate id", () => {
      registerRouterProfileV2({ id: "r1", owner: "u1" });
      expect(() => registerRouterProfileV2({ id: "r1", owner: "u1" })).toThrow(
        /already/,
      );
    });
    it("pending → active stamps activatedAt", () => {
      registerRouterProfileV2({ id: "r1", owner: "u1" });
      const p = activateRouterProfileV2("r1");
      expect(p.status).toBe("active");
      expect(p.activatedAt).not.toBeNull();
    });
    it("active → degraded → active preserves activatedAt (recovery)", () => {
      registerRouterProfileV2({ id: "r1", owner: "u1" });
      activateRouterProfileV2("r1");
      const t1 = getRouterProfileV2("r1").activatedAt;
      degradeRouterProfileV2("r1");
      const p = activateRouterProfileV2("r1");
      expect(p.status).toBe("active");
      expect(p.activatedAt).toBe(t1);
    });
    it("retire stamps retiredAt and blocks further transitions", () => {
      registerRouterProfileV2({ id: "r1", owner: "u1" });
      const p = retireRouterProfileV2("r1");
      expect(p.retiredAt).not.toBeNull();
      expect(() => activateRouterProfileV2("r1")).toThrow(/invalid/);
    });
    it("invalid transition throws", () => {
      registerRouterProfileV2({ id: "r1", owner: "u1" });
      expect(() => degradeRouterProfileV2("r1")).toThrow(/invalid/);
    });
    it("touch on terminal throws", () => {
      registerRouterProfileV2({ id: "r1", owner: "u1" });
      retireRouterProfileV2("r1");
      expect(() => touchRouterProfileV2("r1")).toThrow(/terminal/);
    });
  });

  describe("active profile cap", () => {
    it("recovery (degraded→active) exempt from cap", () => {
      setMaxActiveProfilesPerOwnerRouterV2(1);
      registerRouterProfileV2({ id: "a", owner: "u" });
      activateRouterProfileV2("a");
      degradeRouterProfileV2("a");
      registerRouterProfileV2({ id: "b", owner: "u" });
      activateRouterProfileV2("b");
      const p = activateRouterProfileV2("a");
      expect(p.status).toBe("active");
    });
    it("initial activation enforces cap", () => {
      setMaxActiveProfilesPerOwnerRouterV2(1);
      registerRouterProfileV2({ id: "a", owner: "u" });
      activateRouterProfileV2("a");
      registerRouterProfileV2({ id: "b", owner: "u" });
      expect(() => activateRouterProfileV2("b")).toThrow(/max active/);
    });
  });

  describe("dispatch lifecycle", () => {
    beforeEach(() => {
      registerRouterProfileV2({ id: "p1", owner: "u1" });
    });
    it("creates queued dispatch", () => {
      const d = createDispatchV2({ id: "d1", profileId: "p1", task: "t" });
      expect(d.status).toBe("queued");
    });
    it("missing profile throws", () => {
      expect(() => createDispatchV2({ id: "d1", profileId: "nope" })).toThrow(
        /not found/,
      );
    });
    it("dispatch stamps dispatchedAt", () => {
      createDispatchV2({ id: "d1", profileId: "p1" });
      const d = dispatchDispatchV2("d1");
      expect(d.status).toBe("dispatching");
      expect(d.dispatchedAt).not.toBeNull();
    });
    it("complete stamps settledAt", () => {
      createDispatchV2({ id: "d1", profileId: "p1" });
      dispatchDispatchV2("d1");
      const d = completeDispatchV2("d1");
      expect(d.status).toBe("completed");
      expect(d.settledAt).not.toBeNull();
    });
    it("fail records reason", () => {
      createDispatchV2({ id: "d1", profileId: "p1" });
      dispatchDispatchV2("d1");
      const d = failDispatchV2("d1", "boom");
      expect(d.status).toBe("failed");
      expect(d.metadata.failReason).toBe("boom");
    });
    it("cancel from queued works", () => {
      createDispatchV2({ id: "d1", profileId: "p1" });
      const d = cancelDispatchV2("d1", "stop");
      expect(d.status).toBe("cancelled");
      expect(d.metadata.cancelReason).toBe("stop");
    });
    it("invalid transition throws", () => {
      createDispatchV2({ id: "d1", profileId: "p1" });
      expect(() => completeDispatchV2("d1")).toThrow(/invalid/);
    });
  });

  describe("pending dispatch cap", () => {
    it("enforces cap at createDispatchV2", () => {
      setMaxPendingDispatchesPerProfileV2(2);
      registerRouterProfileV2({ id: "p1", owner: "u1" });
      createDispatchV2({ id: "d1", profileId: "p1" });
      createDispatchV2({ id: "d2", profileId: "p1" });
      expect(() => createDispatchV2({ id: "d3", profileId: "p1" })).toThrow(
        /max pending/,
      );
    });
    it("frees cap slot on settle", () => {
      setMaxPendingDispatchesPerProfileV2(1);
      registerRouterProfileV2({ id: "p1", owner: "u1" });
      createDispatchV2({ id: "d1", profileId: "p1" });
      dispatchDispatchV2("d1");
      completeDispatchV2("d1");
      const d = createDispatchV2({ id: "d2", profileId: "p1" });
      expect(d.status).toBe("queued");
    });
  });

  describe("auto flip", () => {
    it("auto-degrade idle active profiles", () => {
      setProfileIdleMsRouterV2(1000);
      registerRouterProfileV2({ id: "p1", owner: "u1" });
      activateRouterProfileV2("p1");
      const base = getRouterProfileV2("p1").lastTouchedAt;
      const r = autoDegradeIdleProfilesRouterV2({ now: base + 5000 });
      expect(r.count).toBe(1);
      expect(getRouterProfileV2("p1").status).toBe("degraded");
    });
    it("auto-fail stuck dispatches", () => {
      setDispatchStuckMsV2(500);
      registerRouterProfileV2({ id: "p1", owner: "u1" });
      createDispatchV2({ id: "d1", profileId: "p1" });
      dispatchDispatchV2("d1");
      const base = getDispatchV2("d1").dispatchedAt;
      const r = autoFailStuckDispatchesV2({ now: base + 5000 });
      expect(r.count).toBe(1);
      expect(getDispatchV2("d1").status).toBe("failed");
    });
  });

  describe("config setters", () => {
    it("rejects non-positive ints", () => {
      expect(() => setMaxActiveProfilesPerOwnerRouterV2(0)).toThrow();
      expect(() => setMaxActiveProfilesPerOwnerRouterV2(-1)).toThrow();
      expect(() => setDispatchStuckMsV2("abc")).toThrow();
    });
    it("floors non-integer", () => {
      setMaxActiveProfilesPerOwnerRouterV2(7.9);
      expect(getMaxActiveProfilesPerOwnerRouterV2()).toBe(7);
    });
    it("all getters round-trip", () => {
      setMaxPendingDispatchesPerProfileV2(42);
      setProfileIdleMsRouterV2(100);
      setDispatchStuckMsV2(200);
      expect(getMaxPendingDispatchesPerProfileV2()).toBe(42);
      expect(getProfileIdleMsRouterV2()).toBe(100);
      expect(getDispatchStuckMsV2()).toBe(200);
    });
  });

  describe("listing & defensive copy", () => {
    it("lists profiles", () => {
      registerRouterProfileV2({ id: "p1", owner: "u1" });
      registerRouterProfileV2({ id: "p2", owner: "u1" });
      expect(listRouterProfilesV2().length).toBe(2);
    });
    it("lists dispatches", () => {
      registerRouterProfileV2({ id: "p1", owner: "u1" });
      createDispatchV2({ id: "d1", profileId: "p1" });
      expect(listDispatchesV2().length).toBe(1);
    });
    it("defensive copy on profile get", () => {
      registerRouterProfileV2({ id: "p1", owner: "u1", metadata: { k: "v" } });
      const p = getRouterProfileV2("p1");
      p.metadata.k = "tampered";
      expect(getRouterProfileV2("p1").metadata.k).toBe("v");
    });
  });

  describe("stats & reset", () => {
    it("stats zero-initialized", () => {
      const s = getAgentRouterStatsV2();
      for (const v of Object.values(ROUTER_PROFILE_MATURITY_V2))
        expect(s.profilesByStatus[v]).toBe(0);
      for (const v of Object.values(ROUTER_DISPATCH_LIFECYCLE_V2))
        expect(s.dispatchesByStatus[v]).toBe(0);
    });
    it("reset clears maps and config", () => {
      setMaxActiveProfilesPerOwnerRouterV2(99);
      registerRouterProfileV2({ id: "p1", owner: "u1" });
      _resetStateAgentRouterV2();
      expect(getAgentRouterStatsV2().totalProfilesV2).toBe(0);
      expect(getMaxActiveProfilesPerOwnerRouterV2()).toBe(8);
    });
  });
});

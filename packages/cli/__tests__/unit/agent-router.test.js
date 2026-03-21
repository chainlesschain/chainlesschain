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

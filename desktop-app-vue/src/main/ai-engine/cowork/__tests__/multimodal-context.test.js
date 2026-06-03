/**
 * MultimodalContext 单元测试 — v3.2
 *
 * 覆盖：initialize、buildContext（验证/文本/事件）、
 *       getCachedContext、invalidateCache、
 *       getStats、getConfig/configure、常量
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mock logger ─────────────────────────────────────────────────────────────
vi.mock("../../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── Imports ─────────────────────────────────────────────────────────────────
const {
  MultimodalContext,
  CONTEXT_STATUS,
  MODALITY_WEIGHTS,
} = require("../multimodal-context");

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a fake ModalityFusion session object matching the structure
 * that MultimodalContext.buildContext() reads from getSession().
 */
function makeSession(overrides = {}) {
  return {
    id: "mm-test-session-001",
    modalities: ["text"],
    inputs: [
      {
        type: "text",
        label: "user input",
        text: "Hello from the test modality",
        metadata: {},
      },
    ],
    inputCount: 1,
    fusedContextPreview: "Hello from the test modality",
    status: "active",
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Create a minimal mock ModalityFusion dependency.
 */
function createMockModalityFusion(session = null) {
  return {
    getSession: vi.fn().mockReturnValue(session),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("MultimodalContext", () => {
  let mc;

  beforeEach(() => {
    mc = new MultimodalContext();
    vi.clearAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // initialize
  // ─────────────────────────────────────────────────────────────────────────
  describe("initialize()", () => {
    it("should set initialized=true after first call", async () => {
      expect(mc.initialized).toBe(false);
      await mc.initialize();
      expect(mc.initialized).toBe(true);
    });

    it("should be idempotent on double initialize", async () => {
      await mc.initialize();
      await mc.initialize(); // second call should no-op
      expect(mc.initialized).toBe(true);
    });

    it("should work without any deps (no modalityFusion)", async () => {
      await expect(mc.initialize()).resolves.not.toThrow();
      expect(mc.modalityFusion).toBeNull();
    });

    it("should accept optional modalityFusion dependency", async () => {
      const mockFusion = createMockModalityFusion();
      await mc.initialize({ modalityFusion: mockFusion });
      expect(mc.modalityFusion).toBe(mockFusion);
    });

    it("should NOT require a db parameter", async () => {
      // initialize() signature is (deps={}) — no db arg
      await expect(mc.initialize({})).resolves.not.toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // buildContext — validation
  // ─────────────────────────────────────────────────────────────────────────
  describe("buildContext() - validation", () => {
    it("should throw if not initialized", async () => {
      await expect(mc.buildContext({ sessionId: "any-id" })).rejects.toThrow(
        "MultimodalContext not initialized",
      );
    });

    it("should throw if sessionId is not provided", async () => {
      await mc.initialize();
      await expect(mc.buildContext({})).rejects.toThrow(
        "sessionId is required",
      );
    });

    it("should throw if session is not found via modalityFusion", async () => {
      const mockFusion = createMockModalityFusion(null); // returns null
      await mc.initialize({ modalityFusion: mockFusion });

      await expect(
        mc.buildContext({ sessionId: "missing-session" }),
      ).rejects.toThrow("Session not found");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // buildContext — text modality
  // ─────────────────────────────────────────────────────────────────────────
  describe("buildContext() - text modality", () => {
    let mockFusion;
    const SESSION_ID = "mm-test-session-001";

    beforeEach(async () => {
      const session = makeSession({ id: SESSION_ID });
      mockFusion = createMockModalityFusion(session);
      await mc.initialize({ modalityFusion: mockFusion });
    });

    it("should return object with status CONTEXT_STATUS.READY", async () => {
      const result = await mc.buildContext({ sessionId: SESSION_ID });
      expect(result.status).toBe(CONTEXT_STATUS.READY);
    });

    it("should return the same sessionId that was requested", async () => {
      const result = await mc.buildContext({ sessionId: SESSION_ID });
      expect(result.sessionId).toBe(SESSION_ID);
    });

    it("should return sessionId as a string", async () => {
      const result = await mc.buildContext({ sessionId: SESSION_ID });
      expect(typeof result.sessionId).toBe("string");
    });

    it("should return text as a string", async () => {
      const result = await mc.buildContext({ sessionId: SESSION_ID });
      expect(typeof result.text).toBe("string");
    });

    it("should return sections as an array", async () => {
      const result = await mc.buildContext({ sessionId: SESSION_ID });
      expect(Array.isArray(result.sections)).toBe(true);
    });

    it("should return utilization as a number between 0 and 1", async () => {
      const result = await mc.buildContext({ sessionId: SESSION_ID });
      expect(typeof result.utilization).toBe("number");
      expect(result.utilization).toBeGreaterThanOrEqual(0);
      expect(result.utilization).toBeLessThanOrEqual(1);
    });

    it("should include totalTokens and tokenBudget in result", async () => {
      const result = await mc.buildContext({ sessionId: SESSION_ID });
      expect(result).toHaveProperty("totalTokens");
      expect(result).toHaveProperty("tokenBudget");
    });

    it("should include sectionCount matching sections.length", async () => {
      const result = await mc.buildContext({ sessionId: SESSION_ID });
      expect(result.sectionCount).toBe(result.sections.length);
    });

    it("should include builtAt timestamp string", async () => {
      const result = await mc.buildContext({ sessionId: SESSION_ID });
      expect(typeof result.builtAt).toBe("string");
      expect(result.builtAt.length).toBeGreaterThan(0);
    });

    it("should include text content from the session input", async () => {
      const result = await mc.buildContext({ sessionId: SESSION_ID });
      expect(result.text).toContain("Hello from the test modality");
    });

    it("should include taskDescription section when provided", async () => {
      const result = await mc.buildContext({
        sessionId: SESSION_ID,
        taskDescription: "Summarize the document",
      });

      expect(result.sections.length).toBeGreaterThan(1);
    });

    it("should respect maxTokens override", async () => {
      const result = await mc.buildContext({
        sessionId: SESSION_ID,
        maxTokens: 100,
      });
      expect(result.tokenBudget).toBe(100);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // buildContext — event emission
  // ─────────────────────────────────────────────────────────────────────────
  describe("buildContext() - events", () => {
    const SESSION_ID = "mm-event-session-001";

    beforeEach(async () => {
      const session = makeSession({ id: SESSION_ID });
      const mockFusion = createMockModalityFusion(session);
      await mc.initialize({ modalityFusion: mockFusion });
    });

    it('should emit "context:built" event after successful build', async () => {
      const handler = vi.fn();
      mc.on("context:built", handler);

      await mc.buildContext({ sessionId: SESSION_ID });

      expect(handler).toHaveBeenCalledOnce();
    });

    it('should include sessionId and sections count in "context:built" payload', async () => {
      let payload;
      mc.on("context:built", (p) => {
        payload = p;
      });

      await mc.buildContext({ sessionId: SESSION_ID });

      expect(payload).toHaveProperty("sessionId", SESSION_ID);
      expect(payload).toHaveProperty("sections");
      expect(typeof payload.sections).toBe("number");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getCachedContext
  // ─────────────────────────────────────────────────────────────────────────
  describe("getCachedContext()", () => {
    const SESSION_ID = "mm-cache-session-001";

    beforeEach(async () => {
      const session = makeSession({ id: SESSION_ID });
      const mockFusion = createMockModalityFusion(session);
      await mc.initialize({ modalityFusion: mockFusion });
    });

    it("should return null for an unknown sessionId", () => {
      const result = mc.getCachedContext("not-a-real-session");
      expect(result).toBeNull();
    });

    it("should return the built context after buildContext() is called", async () => {
      await mc.buildContext({ sessionId: SESSION_ID });
      const cached = mc.getCachedContext(SESSION_ID);

      expect(cached).not.toBeNull();
      expect(cached.sessionId).toBe(SESSION_ID);
    });

    it("should return cache hit on second buildContext() call", async () => {
      await mc.buildContext({ sessionId: SESSION_ID });
      // Second call should use cache and bump cacheHits
      await mc.buildContext({ sessionId: SESSION_ID });

      const stats = mc.getStats();
      expect(stats.cacheHits).toBeGreaterThanOrEqual(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // invalidateCache
  // ─────────────────────────────────────────────────────────────────────────
  describe("invalidateCache()", () => {
    const SESSION_ID = "mm-invalidate-session-001";

    beforeEach(async () => {
      const session = makeSession({ id: SESSION_ID });
      const mockFusion = createMockModalityFusion(session);
      await mc.initialize({ modalityFusion: mockFusion });
    });

    it("should remove the cached context so getCachedContext returns null", async () => {
      await mc.buildContext({ sessionId: SESSION_ID });
      expect(mc.getCachedContext(SESSION_ID)).not.toBeNull();

      mc.invalidateCache(SESSION_ID);

      expect(mc.getCachedContext(SESSION_ID)).toBeNull();
    });

    it("should reduce cacheSize after invalidation", async () => {
      await mc.buildContext({ sessionId: SESSION_ID });
      const before = mc.getStats().cacheSize;

      mc.invalidateCache(SESSION_ID);

      const after = mc.getStats().cacheSize;
      expect(after).toBeLessThan(before);
    });

    it("should not throw when invalidating a non-existent sessionId", () => {
      expect(() => mc.invalidateCache("does-not-exist")).not.toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getStats
  // ─────────────────────────────────────────────────────────────────────────
  describe("getStats()", () => {
    const SESSION_ID = "mm-stats-session-001";

    beforeEach(async () => {
      const session = makeSession({ id: SESSION_ID });
      const mockFusion = createMockModalityFusion(session);
      await mc.initialize({ modalityFusion: mockFusion });
    });

    it("should return stats object with required fields", () => {
      const stats = mc.getStats();
      expect(stats).toHaveProperty("totalBuilds");
      expect(stats).toHaveProperty("cacheHits");
      expect(stats).toHaveProperty("cacheSize");
    });

    it("should start with zero totalBuilds", () => {
      expect(mc.getStats().totalBuilds).toBe(0);
    });

    it("should start with zero cacheSize", () => {
      expect(mc.getStats().cacheSize).toBe(0);
    });

    it("should increase cacheSize after buildContext()", async () => {
      await mc.buildContext({ sessionId: SESSION_ID });
      expect(mc.getStats().cacheSize).toBeGreaterThan(0);
    });

    it("should increment totalBuilds after each unique buildContext()", async () => {
      await mc.buildContext({ sessionId: SESSION_ID });
      expect(mc.getStats().totalBuilds).toBe(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getConfig / configure
  // ─────────────────────────────────────────────────────────────────────────
  describe("getConfig() / configure()", () => {
    beforeEach(async () => {
      await mc.initialize();
    });

    it("should return config object with known default keys", () => {
      const config = mc.getConfig();
      expect(config).toHaveProperty("maxContextTokens");
      expect(config).toHaveProperty("charsPerToken");
    });

    it("should apply updates via configure()", () => {
      mc.configure({ maxContextTokens: 8000 });
      expect(mc.getConfig().maxContextTokens).toBe(8000);
    });

    it("configure() should return the updated config object", () => {
      const returned = mc.configure({ charsPerToken: 4 });
      expect(returned.charsPerToken).toBe(4);
    });

    it("configure() should not overwrite unrelated fields", () => {
      const before = mc.getConfig();
      mc.configure({ maxContextTokens: 9999 });
      const after = mc.getConfig();
      expect(after.charsPerToken).toBe(before.charsPerToken);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Constants
  // ─────────────────────────────────────────────────────────────────────────
  describe("CONTEXT_STATUS constant", () => {
    it("should have BUILDING value of 'building'", () => {
      expect(CONTEXT_STATUS.BUILDING).toBe("building");
    });

    it("should have READY value of 'ready'", () => {
      expect(CONTEXT_STATUS.READY).toBe("ready");
    });

    it("should have STALE value of 'stale'", () => {
      expect(CONTEXT_STATUS.STALE).toBe("stale");
    });
  });

  describe("MODALITY_WEIGHTS constant", () => {
    it("should have text weight of 1.0", () => {
      expect(MODALITY_WEIGHTS.text).toBe(1.0);
    });

    it("should have image weight of 0.8", () => {
      expect(MODALITY_WEIGHTS.image).toBe(0.8);
    });

    it("should have document weight of 0.9", () => {
      expect(MODALITY_WEIGHTS.document).toBe(0.9);
    });

    it("should have audio weight of 0.7", () => {
      expect(MODALITY_WEIGHTS.audio).toBe(0.7);
    });

    it("should have screen weight of 0.6", () => {
      expect(MODALITY_WEIGHTS.screen).toBe(0.6);
    });
  });
});

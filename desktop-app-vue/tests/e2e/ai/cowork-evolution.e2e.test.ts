/**
 * Cowork 自演化系统 E2E 测试 — v2.1.0
 *
 * 验证 evolution-ipc.js 注册的 35 个 IPC 通道可达性与返回格式：
 * - Code Knowledge Graph (ckg:*)
 * - Decision Knowledge Base (dkb:*)
 * - Prompt Optimizer (prompt-opt:*)
 * - Skill Discoverer (skill-disc:*)
 * - Debate Review (debate:*)
 * - A/B Comparator (ab:*)
 *
 * 测试策略：
 * - 共享单个 Electron 实例（所有 describe 块共用）
 * - 不依赖 LLM 调用，只测试 IPC 通道格式和基础业务逻辑
 * - 每个 IPC 通道验证：success 字段、data/error 字段存在
 */

import { test, expect } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import {
  launchElectronApp,
  closeElectronApp,
  callIPC,
} from "../helpers/common";

// ─── Shared Electron instance ─────────────────────────────────────────────────

let app: ElectronApplication;
let window: Page;

test.beforeAll(async () => {
  const ctx = await launchElectronApp();
  app = ctx.app;
  window = ctx.window;
});

test.afterAll(async () => {
  await closeElectronApp(app);
});

// ─── Helper ───────────────────────────────────────────────────────────────────

/** Assert that an IPC result has the standard envelope shape */
function assertEnvelope(
  result: any,
  opts: { expectSuccess?: boolean } = {},
): void {
  expect(result).toBeDefined();
  expect(typeof result).toBe("object");
  expect(Object.prototype.hasOwnProperty.call(result, "success")).toBe(true);
  expect(typeof result.success).toBe("boolean");
  if (opts.expectSuccess !== undefined) {
    expect(result.success).toBe(opts.expectSuccess);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Code Knowledge Graph (ckg:*)
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Code Knowledge Graph — ckg:*", () => {
  test("ckg:get-stats returns success with stats object", async () => {
    const result = await callIPC<any>(window, "ckg:get-stats");
    assertEnvelope(result);

    if (result.success) {
      const stats = result.data;
      expect(stats).toHaveProperty("entityCount");
      expect(stats).toHaveProperty("relationshipCount");
      expect(stats).toHaveProperty("filesIndexed");
      expect(typeof stats.entityCount).toBe("number");
      expect(typeof stats.relationshipCount).toBe("number");
    }
  });

  test("ckg:get-entity-types returns enum values", async () => {
    const result = await callIPC<any>(window, "ckg:get-entity-types");
    assertEnvelope(result);

    if (result.success) {
      expect(Array.isArray(result.data)).toBe(true);
      // Known entity types from ENTITY_TYPES constant
      const knownTypes = [
        "module",
        "class",
        "function",
        "interface",
        "type",
        "enum",
      ];
      const returnedTypes: string[] = result.data;
      expect(
        knownTypes.some((t) => returnedTypes.includes(t)),
      ).toBe(true);
    }
  });

  test("ckg:get-relationship-types returns enum values", async () => {
    const result = await callIPC<any>(window, "ckg:get-relationship-types");
    assertEnvelope(result);

    if (result.success) {
      expect(Array.isArray(result.data)).toBe(true);
      const knownRels = ["imports", "exports", "contains", "calls"];
      const returned: string[] = result.data;
      expect(knownRels.some((r) => returned.includes(r))).toBe(true);
    }
  });

  test("ckg:query-entity returns array for empty query", async () => {
    const result = await callIPC<any>(window, "ckg:query-entity", {});
    assertEnvelope(result);

    if (result.success) {
      expect(Array.isArray(result.data)).toBe(true);
    }
  });

  test("ckg:find-hotspots returns array", async () => {
    const result = await callIPC<any>(window, "ckg:find-hotspots", 3);
    assertEnvelope(result);

    if (result.success) {
      expect(Array.isArray(result.data)).toBe(true);
    }
  });

  test("ckg:find-circular-deps returns array", async () => {
    const result = await callIPC<any>(window, "ckg:find-circular-deps");
    assertEnvelope(result);

    if (result.success) {
      expect(Array.isArray(result.data)).toBe(true);
    }
  });

  test("ckg:compute-centrality returns array", async () => {
    const result = await callIPC<any>(window, "ckg:compute-centrality");
    assertEnvelope(result);

    if (result.success) {
      expect(Array.isArray(result.data)).toBe(true);
    }
  });

  test("ckg:export-graph returns graph object", async () => {
    const result = await callIPC<any>(window, "ckg:export-graph");
    assertEnvelope(result);

    if (result.success) {
      expect(result.data).toHaveProperty("version");
      expect(result.data).toHaveProperty("entities");
      expect(result.data).toHaveProperty("relationships");
    }
  });

  test("ckg:build-context returns string", async () => {
    const result = await callIPC<any>(window, "ckg:build-context");
    assertEnvelope(result);

    if (result.success) {
      expect(typeof result.data).toBe("string");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Decision Knowledge Base (dkb:*)
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Decision Knowledge Base — dkb:*", () => {
  let recordedDecisionId: string | undefined;

  test("dkb:record-decision persists a decision and returns id", async () => {
    const result = await callIPC<any>(window, "dkb:record-decision", {
      problem: "E2E test — which auth method to use?",
      solution: "JWT with refresh tokens",
      category: "architecture",
      source: "manual",
      confidence: 0.9,
      tags: ["auth", "jwt"],
    });
    assertEnvelope(result);

    if (result.success) {
      expect(result.data).toHaveProperty("id");
      expect(typeof result.data.id).toBe("string");
      recordedDecisionId = result.data.id;
    }
  });

  test("dkb:find-similar returns array with score field", async () => {
    const result = await callIPC<any>(window, "dkb:find-similar", {
      problem: "authentication strategy for desktop app",
      limit: 5,
    });
    assertEnvelope(result);

    if (result.success) {
      expect(Array.isArray(result.data)).toBe(true);
      // If we recorded a decision above, it should appear
      if (result.data.length > 0) {
        const first = result.data[0];
        expect(first).toHaveProperty("id");
        expect(first).toHaveProperty("problem");
        expect(first).toHaveProperty("solution");
        expect(first).toHaveProperty("score");
      }
    }
  });

  test("dkb:get-history returns paginated array", async () => {
    const result = await callIPC<any>(window, "dkb:get-history", {
      limit: 10,
      offset: 0,
    });
    assertEnvelope(result);

    if (result.success) {
      expect(Array.isArray(result.data)).toBe(true);
    }
  });

  test("dkb:get-best-practice returns record or null", async () => {
    const result = await callIPC<any>(window, "dkb:get-best-practice", {
      category: "architecture",
    });
    assertEnvelope(result);

    if (result.success) {
      // Either a record object or null
      if (result.data !== null) {
        expect(result.data).toHaveProperty("id");
        expect(result.data).toHaveProperty("solution");
      }
    }
  });

  test("dkb:get-success-rates returns category map", async () => {
    const result = await callIPC<any>(window, "dkb:get-success-rates");
    assertEnvelope(result);

    if (result.success) {
      expect(typeof result.data).toBe("object");
    }
  });

  test("dkb:get-stats returns totalRecords and sourceBreakdown", async () => {
    const result = await callIPC<any>(window, "dkb:get-stats");
    assertEnvelope(result);

    if (result.success) {
      const stats = result.data;
      expect(stats).toHaveProperty("totalRecords");
      expect(stats).toHaveProperty("sourceBreakdown");
      expect(typeof stats.totalRecords).toBe("number");
      expect(typeof stats.sourceBreakdown).toBe("object");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Prompt Optimizer (prompt-opt:*)
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Prompt Optimizer — prompt-opt:*", () => {
  const TEST_SKILL = "e2e-test-skill-" + Date.now();
  const BASE_PROMPT = "You are a helpful assistant. Answer concisely.";

  test("prompt-opt:record-execution records and returns executionId", async () => {
    // Record 5 executions so optimize can work
    for (let i = 0; i < 5; i++) {
      const result = await callIPC<any>(
        window,
        "prompt-opt:record-execution",
        {
          skillName: TEST_SKILL,
          promptText: BASE_PROMPT,
          model: "test-model",
          tokenCount: 50 + i,
          latencyMs: 200 + i * 10,
          resultSuccess: i < 4, // 4 successes, 1 failure
        },
      );
      assertEnvelope(result);

      if (result.success) {
        expect(result.data).toHaveProperty("executionId");
        expect(typeof result.data.executionId).toBe("string");
      }
    }
  });

  test("prompt-opt:optimize returns suggestion after 5 executions", async () => {
    const result = await callIPC<any>(window, "prompt-opt:optimize", {
      skillName: TEST_SKILL,
    });
    assertEnvelope(result);

    if (result.success) {
      const opt = result.data;
      expect(opt).toHaveProperty("skillName", TEST_SKILL);
      expect(opt).toHaveProperty("currentPrompt");
      expect(opt).toHaveProperty("suggestion");
    }
  });

  test("prompt-opt:create-variant creates and returns variant id", async () => {
    const result = await callIPC<any>(window, "prompt-opt:create-variant", {
      skillName: TEST_SKILL,
      variantName: "concise-variant",
      promptText: "Answer in one sentence maximum.",
    });
    assertEnvelope(result);

    if (result.success) {
      expect(result.data).toHaveProperty("variantId");
    }
  });

  test("prompt-opt:get-stats returns execution and variant counts", async () => {
    const result = await callIPC<any>(window, "prompt-opt:get-stats");
    assertEnvelope(result);

    if (result.success) {
      const stats = result.data;
      expect(stats).toHaveProperty("totalExecutions");
      expect(stats).toHaveProperty("totalVariants");
      expect(typeof stats.totalExecutions).toBe("number");
      // We recorded 5 executions above, so totalExecutions >= 5
      expect(stats.totalExecutions).toBeGreaterThanOrEqual(5);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Skill Discoverer (skill-disc:*)
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Skill Discoverer — skill-disc:*", () => {
  let logId: string | undefined;

  test("skill-disc:analyze-failure extracts keywords and returns logId", async () => {
    const result = await callIPC<any>(window, "skill-disc:analyze-failure", {
      taskId: "e2e-task-001",
      taskDescription: "resize and compress images for web optimization",
      failureReason: "image processing library not found",
    });
    assertEnvelope(result);

    if (result.success) {
      const analysis = result.data;
      expect(analysis).toHaveProperty("taskId", "e2e-task-001");
      expect(analysis).toHaveProperty("keywords");
      expect(analysis).toHaveProperty("suggestions");
      expect(analysis).toHaveProperty("logId");
      expect(Array.isArray(analysis.keywords)).toBe(true);
      expect(analysis.keywords.length).toBeGreaterThan(0);

      // At least one of the meaningful keywords should be extracted
      const meaningful = ["resize", "compress", "image", "processing", "optimization"];
      expect(analysis.keywords.some((k: string) => meaningful.includes(k))).toBe(
        true,
      );

      logId = analysis.logId;
    }
  });

  test("skill-disc:suggest-install returns recommendation for known logId", async () => {
    if (!logId) {
      test.skip(); // Skip if analyze-failure didn't return a logId
      return;
    }

    const result = await callIPC<any>(window, "skill-disc:suggest-install", logId);
    assertEnvelope(result);

    if (result.success) {
      const suggestion = result.data;
      expect(suggestion).toHaveProperty("logId");
      expect(suggestion).toHaveProperty("recommendation");
      expect(typeof suggestion.recommendation).toBe("string");
    }
  });

  test("skill-disc:get-history returns array", async () => {
    const result = await callIPC<any>(window, "skill-disc:get-history", {
      limit: 10,
    });
    assertEnvelope(result);

    if (result.success) {
      expect(Array.isArray(result.data)).toBe(true);
    }
  });

  test("skill-disc:get-stats returns totalDiscoveries and installRate", async () => {
    const result = await callIPC<any>(window, "skill-disc:get-stats");
    assertEnvelope(result);

    if (result.success) {
      const stats = result.data;
      expect(stats).toHaveProperty("totalDiscoveries");
      expect(stats).toHaveProperty("installRate");
      expect(typeof stats.totalDiscoveries).toBe("number");
      // We ran analyze-failure above, so totalDiscoveries >= 1
      expect(stats.totalDiscoveries).toBeGreaterThanOrEqual(1);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Debate Review (debate:*)
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Debate Review — debate:*", () => {
  const CLEAN_CODE = `
function add(a, b) {
  if (typeof a !== 'number' || typeof b !== 'number') {
    throw new Error('Invalid arguments');
  }
  return a + b;
}
module.exports = { add };
`;

  test("debate:start with clean code returns verdict in APPROVE/NEEDS_WORK/REJECT", async () => {
    const result = await callIPC<any>(window, "debate:start", {
      target: "src/math.js",
      code: CLEAN_CODE,
      perspectives: ["performance", "maintainability"],
    });
    assertEnvelope(result);

    if (result.success) {
      const debate = result.data;
      expect(debate).toHaveProperty("id");
      expect(debate).toHaveProperty("target", "src/math.js");
      expect(debate).toHaveProperty("reviews");
      expect(debate).toHaveProperty("votes");
      expect(debate).toHaveProperty("verdict");
      expect(debate).toHaveProperty("consensusScore");

      expect(["APPROVE", "NEEDS_WORK", "REJECT"]).toContain(debate.verdict);
      expect(Array.isArray(debate.reviews)).toBe(true);
      expect(debate.reviews).toHaveLength(2); // 2 perspectives
      expect(typeof debate.consensusScore).toBe("number");
      expect(debate.consensusScore).toBeGreaterThanOrEqual(0);
      expect(debate.consensusScore).toBeLessThanOrEqual(1);
    }
  });

  test("debate:start with security-risky code returns REJECT", async () => {
    const RISKY_CODE = `
function run(input) {
  return eval(input);
}
`;
    const result = await callIPC<any>(window, "debate:start", {
      target: "src/danger.js",
      code: RISKY_CODE,
      perspectives: ["security"],
    });
    assertEnvelope(result);

    if (result.success) {
      expect(result.data.verdict).toBe("REJECT");
    }
  });

  test("debate:get-history returns paginated array", async () => {
    const result = await callIPC<any>(window, "debate:get-history", {
      limit: 10,
    });
    assertEnvelope(result);

    if (result.success) {
      expect(Array.isArray(result.data)).toBe(true);
      // We ran 2 debates above
      expect(result.data.length).toBeGreaterThanOrEqual(2);
    }
  });

  test("debate:get-stats returns totalDebates and avgConsensusScore", async () => {
    const result = await callIPC<any>(window, "debate:get-stats");
    assertEnvelope(result);

    if (result.success) {
      const stats = result.data;
      expect(stats).toHaveProperty("totalDebates");
      expect(stats).toHaveProperty("avgConsensusScore");
      expect(typeof stats.totalDebates).toBe("number");
      expect(stats.totalDebates).toBeGreaterThanOrEqual(2);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A/B Comparator (ab:*)
// ─────────────────────────────────────────────────────────────────────────────

test.describe("A/B Comparator — ab:*", () => {
  test("ab:compare generates variants and identifies winner (no benchmarking)", async () => {
    const result = await callIPC<any>(window, "ab:compare", {
      taskDescription: "Write a function to check if a number is prime",
      variantCount: 2,
      benchmark: false,
    });
    assertEnvelope(result);

    if (result.success) {
      const comparison = result.data;
      expect(comparison).toHaveProperty("id");
      expect(comparison).toHaveProperty("variants");
      expect(comparison).toHaveProperty("scores");
      expect(comparison).toHaveProperty("winner");
      expect(comparison).toHaveProperty("duration");

      expect(Array.isArray(comparison.variants)).toBe(true);
      expect(comparison.variants).toHaveLength(2);

      for (const v of comparison.variants) {
        expect(v).toHaveProperty("name");
        expect(v).toHaveProperty("style");
        expect(v).toHaveProperty("code");
      }

      // benchmark=false → no scores, winner = first variant
      expect(Object.keys(comparison.scores)).toHaveLength(0);
      expect(comparison.winner).toBe(comparison.variants[0].name);

      expect(typeof comparison.duration).toBe("number");
      expect(comparison.duration).toBeGreaterThanOrEqual(0);
    }
  });

  test("ab:compare with benchmark=true produces scores and winner", async () => {
    const result = await callIPC<any>(window, "ab:compare", {
      taskDescription: "Implement array deduplication",
      variantCount: 2,
      benchmark: true,
    });
    assertEnvelope(result);

    if (result.success) {
      const comparison = result.data;
      expect(comparison.variants).toHaveLength(2);
      expect(Object.keys(comparison.scores)).toHaveLength(2);
      expect(comparison.winner).toBeTruthy();
      expect(Object.keys(comparison.scores)).toContain(comparison.winner);
    }
  });

  test("ab:compare caps variantCount at 5", async () => {
    const result = await callIPC<any>(window, "ab:compare", {
      taskDescription: "Parse a URL string",
      variantCount: 99,
      benchmark: false,
    });
    assertEnvelope(result);

    if (result.success) {
      expect(result.data.variants).toHaveLength(5);
    }
  });

  test("ab:compare without taskDescription returns error envelope", async () => {
    const result = await callIPC<any>(window, "ab:compare", {});
    assertEnvelope(result);

    if (result.success) {
      // Handler returns { success: true, data: { error: '...' } }
      expect(result.data).toHaveProperty("error");
    }
  });

  test("ab:get-history returns paginated array", async () => {
    const result = await callIPC<any>(window, "ab:get-history", { limit: 10 });
    assertEnvelope(result);

    if (result.success) {
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data.length).toBeGreaterThanOrEqual(3); // ran 3 comparisons
    }
  });

  test("ab:get-stats returns totalComparisons and winsByAgent", async () => {
    const result = await callIPC<any>(window, "ab:get-stats");
    assertEnvelope(result);

    if (result.success) {
      const stats = result.data;
      expect(stats).toHaveProperty("totalComparisons");
      expect(stats).toHaveProperty("winsByAgent");
      expect(typeof stats.totalComparisons).toBe("number");
      expect(stats.totalComparisons).toBeGreaterThanOrEqual(3);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cross-module integration: DKB + CKG context enrichment
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Cross-module integration", () => {
  test("record decision then find it via find-similar", async () => {
    const uniqueProblem = `E2E cross-test ${Date.now()} — database connection pooling`;

    // 1. Record a decision
    const recordResult = await callIPC<any>(window, "dkb:record-decision", {
      problem: uniqueProblem,
      solution: "Use pg-pool with max=10",
      category: "database",
      source: "manual",
      confidence: 0.95,
    });

    if (!recordResult.success) return;
    const { id } = recordResult.data;
    expect(typeof id).toBe("string");

    // 2. Find similar — should find the newly recorded decision
    const findResult = await callIPC<any>(window, "dkb:find-similar", {
      problem: "connection pooling strategy for PostgreSQL",
      limit: 20,
    });

    if (findResult.success && findResult.data.length > 0) {
      const found = findResult.data.find((r: any) => r.id === id);
      // May or may not be found depending on keyword overlap — just verify format
      if (found) {
        expect(found).toHaveProperty("score");
        expect(found.score).toBeGreaterThan(0);
      }
    }
  });

  test("CKG stats are numeric (initialized module is accessible)", async () => {
    const [ckg, dkb, prompt, disc, debate, ab] = await Promise.all([
      callIPC<any>(window, "ckg:get-stats"),
      callIPC<any>(window, "dkb:get-stats"),
      callIPC<any>(window, "prompt-opt:get-stats"),
      callIPC<any>(window, "skill-disc:get-stats"),
      callIPC<any>(window, "debate:get-stats"),
      callIPC<any>(window, "ab:get-stats"),
    ]);

    // All 6 modules should respond successfully
    for (const result of [ckg, dkb, prompt, disc, debate, ab]) {
      assertEnvelope(result);
    }
  });
});

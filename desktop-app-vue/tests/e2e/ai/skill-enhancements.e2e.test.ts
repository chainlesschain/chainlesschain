/**
 * Skill Enhancements E2E Test — v2.2.0
 *
 * Validates enhanced built-in skills via IPC channels:
 * - Security Audit (Clawsec: drift, integrity, CVE)
 * - Multi Search Engine (17 engines, filters)
 * - Proactive Agent (plan mode, quality, backlog)
 * - Knowledge Graph (ontology, OWL/JSON-LD export, validate)
 * - Debugging Strategies (root-cause, red-flags, defense, session)
 *
 * Test strategy:
 * - Shared Electron instance across all describe blocks
 * - No LLM dependency — tests IPC channel format and handler logic
 * - Each IPC channel verifies: success field, result shape
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
// Multi Search Engine
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Multi Search Engine", () => {
  test("should generate search URLs for default engines", async () => {
    const result = await callIPC(app, "skill:execute", {
      skillName: "multi-search-engine",
      input: "Vue3 Composition API",
    });
    assertEnvelope(result, { expectSuccess: true });
    expect(result.result?.results?.length).toBe(5);
  });

  test("should filter Chinese engines", async () => {
    const result = await callIPC(app, "skill:execute", {
      skillName: "multi-search-engine",
      input: "--chinese AI agent",
    });
    assertEnvelope(result, { expectSuccess: true });
    for (const r of result.result?.results || []) {
      expect(r.region).toBe("cn");
    }
  });

  test("should search all 17 engines", async () => {
    const result = await callIPC(app, "skill:execute", {
      skillName: "multi-search-engine",
      input: "--all machine learning",
    });
    assertEnvelope(result, { expectSuccess: true });
    expect(result.result?.results?.length).toBe(17);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Security Audit (Clawsec)
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Security Audit — Clawsec Enhancements", () => {
  test("should run full audit scan", async () => {
    const result = await callIPC(app, "skill:execute", {
      skillName: "security-audit",
      input: "",
    });
    assertEnvelope(result);
    expect(result.result).toBeDefined();
  });

  test("should create drift baseline", async () => {
    const result = await callIPC(app, "skill:execute", {
      skillName: "security-audit",
      input: "--drift baseline",
    });
    assertEnvelope(result, { expectSuccess: true });
    expect(result.result?.trackedFiles).toBeGreaterThanOrEqual(0);
  });

  test("should analyze CVEs from package.json", async () => {
    const result = await callIPC(app, "skill:execute", {
      skillName: "security-audit",
      input: "--cve",
    });
    assertEnvelope(result);
    // May succeed or fail depending on workspace — just check shape
    if (result.success) {
      expect(result.result?.totalDeps).toBeGreaterThanOrEqual(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Proactive Agent (Plan + Quality + Backlog)
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Proactive Agent — Planning", () => {
  test("should create a plan spec", async () => {
    const result = await callIPC(app, "skill:execute", {
      skillName: "proactive-agent",
      input: "plan spec Build user authentication",
    });
    assertEnvelope(result, { expectSuccess: true });
    expect(result.result?.id).toMatch(/^P\d+/);
    expect(result.result?.phase).toBe(1);
  });

  test("should list plans", async () => {
    const result = await callIPC(app, "skill:execute", {
      skillName: "proactive-agent",
      input: "plan list",
    });
    assertEnvelope(result, { expectSuccess: true });
    expect(Array.isArray(result.result?.plans)).toBe(true);
  });

  test("should add backlog item", async () => {
    const result = await callIPC(app, "skill:execute", {
      skillName: "proactive-agent",
      input: "backlog add Implement dark mode",
    });
    assertEnvelope(result, { expectSuccess: true });
    expect(result.result?.id).toMatch(/^B\d+/);
  });

  test("should run quality all check", async () => {
    const result = await callIPC(app, "skill:execute", {
      skillName: "proactive-agent",
      input: "quality all",
    });
    assertEnvelope(result, { expectSuccess: true });
    expect(result.result?.check).toBe("all");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Knowledge Graph (Ontology)
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Knowledge Graph — Ontology", () => {
  test("should return stats (may be empty)", async () => {
    const result = await callIPC(app, "skill:execute", {
      skillName: "knowledge-graph",
      input: "--stats",
    });
    assertEnvelope(result);
  });

  test("should reject unknown export format", async () => {
    const result = await callIPC(app, "skill:execute", {
      skillName: "knowledge-graph",
      input: "--export --format xml",
    });
    assertEnvelope(result, { expectSuccess: false });
  });

  test("should validate empty graph", async () => {
    const result = await callIPC(app, "skill:execute", {
      skillName: "knowledge-graph",
      input: "--validate",
    });
    assertEnvelope(result);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Debugging Strategies (Systematic)
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Debugging Strategies — Systematic", () => {
  test("should diagnose TypeError", async () => {
    const result = await callIPC(app, "skill:execute", {
      skillName: "debugging-strategies",
      input: "TypeError: Cannot read property 'foo' of undefined",
    });
    assertEnvelope(result, { expectSuccess: true });
    expect(result.result?.classification).toBe("Type Error");
  });

  test("should perform root-cause analysis", async () => {
    const result = await callIPC(app, "skill:execute", {
      skillName: "debugging-strategies",
      input: "root-cause Database returns empty after migration",
    });
    assertEnvelope(result, { expectSuccess: true });
    expect(result.result?.method).toBe("root-cause");
    expect(result.result?.phases).toBe(4);
  });

  test("should detect red flags", async () => {
    const result = await callIPC(app, "skill:execute", {
      skillName: "debugging-strategies",
      input: "red-flags Let me apply a quick fix for now",
    });
    assertEnvelope(result, { expectSuccess: true });
    expect(result.result?.method).toBe("red-flags");
    expect(result.result?.rating).toBe("danger");
  });

  test("should generate defense layers", async () => {
    const result = await callIPC(app, "skill:execute", {
      skillName: "debugging-strategies",
      input: "defense TypeError in user input processing",
    });
    assertEnvelope(result, { expectSuccess: true });
    expect(result.result?.layers?.length).toBe(4);
  });

  test("should start and manage debug session", async () => {
    const start = await callIPC(app, "skill:execute", {
      skillName: "debugging-strategies",
      input: "session start Login fails intermittently",
    });
    assertEnvelope(start, { expectSuccess: true });
    expect(start.result?.subcommand).toBe("start");

    const summary = await callIPC(app, "skill:execute", {
      skillName: "debugging-strategies",
      input: "session summary",
    });
    assertEnvelope(summary, { expectSuccess: true });
    expect(summary.result?.subcommand).toBe("summary");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tavily Search (v2.0 — crawl, map, research, QNA)
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Tavily Search — v2.0 Enhancements", () => {
  test("should show usage when no input", async () => {
    const result = await callIPC(app, "skill:execute", {
      skillName: "tavily-search",
      input: "",
    });
    assertEnvelope(result, { expectSuccess: false });
    expect(result.error).toContain("Usage");
  });

  test("should fail without API key (if not set)", async () => {
    // This test validates error handling; API key may or may not be configured
    const result = await callIPC(app, "skill:execute", {
      skillName: "tavily-search",
      input: "test query",
    });
    assertEnvelope(result);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Self-Improving Agent (v2.0 — instincts, skill extraction)
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Self-Improving Agent — v2.0 Enhancements", () => {
  test("should record error with fix", async () => {
    const result = await callIPC(app, "skill:execute", {
      skillName: "self-improving-agent",
      input:
        "record-error TypeError in component fix: Added null check before accessing property",
    });
    assertEnvelope(result, { expectSuccess: true });
    expect(result.action || result.result?.action).toBeDefined();
  });

  test("should capture instinct", async () => {
    const result = await callIPC(app, "skill:execute", {
      skillName: "self-improving-agent",
      input:
        "capture-instinct Fix PrismaClient error trigger: Serverless deploy solution: Run prisma generate",
    });
    assertEnvelope(result, { expectSuccess: true });
  });

  test("should list instincts", async () => {
    const result = await callIPC(app, "skill:execute", {
      skillName: "self-improving-agent",
      input: "list-instincts",
    });
    assertEnvelope(result, { expectSuccess: true });
  });

  test("should extract skill", async () => {
    const result = await callIPC(app, "skill:execute", {
      skillName: "self-improving-agent",
      input: "extract-skill test-skill desc: A test skill for E2E",
    });
    assertEnvelope(result, { expectSuccess: true });
  });

  test("should export learnings", async () => {
    const result = await callIPC(app, "skill:execute", {
      skillName: "self-improving-agent",
      input: "export",
    });
    assertEnvelope(result, { expectSuccess: true });
    expect(result.result?.version).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Find Skills (v2.0 — marketplace, compare, rate)
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Find Skills — v2.0 Enhancements", () => {
  test("should list known marketplaces", async () => {
    const result = await callIPC(app, "skill:execute", {
      skillName: "find-skills",
      input: "marketplace",
    });
    assertEnvelope(result, { expectSuccess: true });
    expect(result.result?.count).toBe(6);
  });

  test("should rate a skill", async () => {
    const result = await callIPC(app, "skill:execute", {
      skillName: "find-skills",
      input: "rate code-review 5",
    });
    assertEnvelope(result, { expectSuccess: true });
    expect(result.result?.rating).toBe(5);
  });

  test("should list popular skills", async () => {
    const result = await callIPC(app, "skill:execute", {
      skillName: "find-skills",
      input: "popular",
    });
    assertEnvelope(result, { expectSuccess: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GitHub Manager (v2.0 — code search, releases, branches, PR review)
// ─────────────────────────────────────────────────────────────────────────────

test.describe("GitHub Manager — v2.0 Enhancements", () => {
  test("should fail without token", async () => {
    // Token may or may not be set; verify error handling
    const result = await callIPC(app, "skill:execute", {
      skillName: "github-manager",
      input: "list-issues owner/repo",
    });
    assertEnvelope(result);
  });

  test("should return error for unknown action", async () => {
    const result = await callIPC(app, "skill:execute", {
      skillName: "github-manager",
      input: "invalid-action owner/repo",
    });
    assertEnvelope(result, { expectSuccess: false });
  });
});

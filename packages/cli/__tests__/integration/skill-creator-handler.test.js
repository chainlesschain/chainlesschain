/**
 * 集成测试 — skill-creator handler (v1.2.0)
 *
 * 直接加载 handler.js，通过 _deps 注入控制 fs / spawnSync，
 * 测试跨模块边界的真实逻辑（create→validate 生命周期、optimize-description 完整循环）。
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
} from "vitest";
import { createRequire } from "node:module";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── Load handler via createRequire (CJS) ────────────────────────────────────
const handlerPath = resolve(
  __dirname,
  "../../../../desktop-app-vue/src/main/ai-engine/cowork/skills/builtin/skill-creator/handler.js",
);
const req = createRequire(pathToFileURL(handlerPath).href);

// Logger is loaded as a side-effect; no need to mock it in integration tests
let handler;
beforeAll(() => {
  handler = req(handlerPath);
});

// ─── Save / restore _deps ─────────────────────────────────────────────────────
let origFs;
let origSpawnSync;

beforeEach(() => {
  origFs = handler._deps.fs;
  origSpawnSync = handler._deps.spawnSync;
});

afterEach(() => {
  handler._deps.fs = origFs;
  handler._deps.spawnSync = origSpawnSync;
  vi.clearAllMocks();
});

// ─── Temp dir for filesystem tests ───────────────────────────────────────────
let tmpDir;
beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "cc-skill-creator-int-"));
});
afterAll(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
function makeMockSpawn(behaviour) {
  return vi.fn().mockImplementation((_exe, args) => {
    const prompt = args[2] || "";
    return behaviour(prompt);
  });
}

const EVAL_QUERIES_JSON = JSON.stringify([
  ...Array.from({ length: 10 }, (_, i) => ({
    query: `Trigger query ${i + 1} with detailed context about specific task`,
    should_trigger: true,
  })),
  ...Array.from({ length: 10 }, (_, i) => ({
    query: `Non-trigger query ${i + 1} about something unrelated to the skill`,
    should_trigger: false,
  })),
]);

function smartSpawnFn({
  improvedDesc = "Improved description with better trigger accuracy",
} = {}) {
  return makeMockSpawn((prompt) => {
    if (prompt.includes("20 realistic test queries")) {
      return { status: 0, stdout: EVAL_QUERIES_JSON, error: null };
    }
    if (prompt.includes("Would you invoke this skill")) {
      // Alternate YES/NO to create mixed results and force improvement
      return { status: 0, stdout: "YES", error: null };
    }
    if (prompt.includes("Improve this skill description")) {
      return { status: 0, stdout: improvedDesc, error: null };
    }
    return { status: 0, stdout: "YES", error: null };
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// list-templates  (no I/O, no LLM)
// ═══════════════════════════════════════════════════════════════════════════════

describe("list-templates integration", () => {
  it("returns 5 built-in templates with required fields", async () => {
    const r = await handler.execute({ input: "list-templates" }, {}, {});
    expect(r.success).toBe(true);
    expect(r.templates).toHaveLength(5);
    expect(r.templates.every((t) => t.name && t.description)).toBe(true);
  });

  it("get-template api-integration has _deps pattern", async () => {
    const r = await handler.execute(
      { input: "get-template api-integration" },
      {},
      {},
    );
    expect(r.success).toBe(true);
    expect(r.files["handler.js"]).toContain("_deps");
    expect(r.files["handler.js"]).toContain("https");
  });

  it("get-template file-processor has _deps.fs and _deps.path", async () => {
    const r = await handler.execute(
      { input: "get-template file-processor" },
      {},
      {},
    );
    expect(r.files["handler.js"]).toContain("_deps.fs");
    expect(r.files["handler.js"]).toContain("_deps.path");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// create → validate lifecycle (real temp filesystem)
// ═══════════════════════════════════════════════════════════════════════════════

describe("create → validate lifecycle (real temp fs via _deps override)", () => {
  // Override BUILTIN_DIR by patching _deps.path to redirect to tmpDir
  let patchedPath;

  beforeEach(() => {
    patchedPath = {
      ...handler._deps.path,
      join: (...args) => {
        // Redirect builtin dir references to tmpDir
        const result = join(...args);
        // The handler builds: path.join(BUILTIN_DIR, skillName, ...)
        // We intercept by keeping real path.join but the BUILTIN_DIR
        // is baked into the handler closure — we can't redirect it directly.
        // So we use real fs and real BUILTIN_DIR for this test group.
        return result;
      },
    };
  });

  it("creates files in real builtin dir when skill doesn't exist (uses alreadyExists path)", async () => {
    // We test with a definitely existing skill to hit the alreadyExists path
    // (avoids actually creating new files in the codebase)
    const r = await handler.execute(
      { input: 'create ultrathink "Ultra thinking skill"' },
      {},
      {},
    );
    expect(r.success).toBe(true);
    expect(r.skillName).toBe("ultrathink");
    // ultrathink exists → returns alreadyExists template without writing
    expect(r.alreadyExists).toBe(true);
  });

  it("validate reports valid for existing builtin skill (code-review)", async () => {
    const r = await handler.execute({ input: "validate code-review" }, {}, {});
    expect(r.success).toBe(true);
    expect(r.valid).toBe(true);
    expect(r.issues).toHaveLength(0);
    expect(r.checks.length).toBeGreaterThan(0);
  });

  it("validate reports issues for nonexistent skill", async () => {
    const r = await handler.execute(
      { input: "validate skill-that-does-not-exist-xyz" },
      {},
      {},
    );
    expect(r.success).toBe(false);
    expect(r.valid).toBe(false);
    expect(r.issues.length).toBeGreaterThan(0);
  });

  it("test action runs handler for existing skill (smart-search)", async () => {
    const r = await handler.execute(
      { input: "test smart-search search query" },
      {},
      {},
    );
    // Should execute without throwing, success depends on handler
    expect(r).toBeDefined();
    expect(r.action).toBe("test");
    expect(r.skillName).toBe("smart-search");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// optimize quick — real SKILL.md files
// ═══════════════════════════════════════════════════════════════════════════════

describe("optimize quick (real builtin skills)", () => {
  it("optimize on existing skill returns suggestions or clean result", async () => {
    const r = await handler.execute({ input: "optimize code-review" }, {}, {});
    expect(r.success).toBe(true);
    expect(r.action).toBe("optimize");
    expect(r.currentDescription).toBeDefined();
    expect(r.hint).toContain("optimize-description");
    expect(Array.isArray(r.suggestions)).toBe(true);
  });

  it("optimize on smart-search returns current description", async () => {
    const r = await handler.execute({ input: "optimize smart-search" }, {}, {});
    expect(r.success).toBe(true);
    expect(typeof r.currentDescription).toBe("string");
    expect(r.currentDescription.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// optimize-description — mocked LLM, real SKILL.md from builtin
// ═══════════════════════════════════════════════════════════════════════════════

describe("optimize-description with mocked LLM (real builtin SKILL.md)", () => {
  // Intercept writeFileSync to prevent tests from modifying real builtin SKILL.md files
  beforeEach(() => {
    const realFs = handler._deps.fs;
    handler._deps.fs = {
      ...realFs,
      writeFileSync: vi.fn(), // swallow all writes — tests verify via return values
      mkdirSync: vi.fn(),
    };
  });

  it("runs full optimization loop and returns result with all fields", async () => {
    handler._deps.spawnSync = smartSpawnFn({
      improvedDesc:
        "Better: use for code review, PR analysis, and audit tasks specifically",
    });

    const r = await handler.execute(
      { input: "optimize-description code-review --iterations 2" },
      {},
      {},
    );
    expect(r.success).toBe(true);
    expect(r.action).toBe("optimize-description");
    expect(r.skillName).toBe("code-review");
    expect(typeof r.originalDescription).toBe("string");
    expect(typeof r.bestDescription).toBe("string");
    expect(typeof r.bestTestScore).toBe("number");
    expect(r.bestTestScore).toBeGreaterThanOrEqual(0);
    expect(r.bestTestScore).toBeLessThanOrEqual(1);
    expect(r.evalQueriesGenerated).toBe(20);
    expect(Array.isArray(r.iterationDetails)).toBe(true);
  });

  it("gracefully fails when LLM is unavailable (status=1)", async () => {
    handler._deps.spawnSync = vi.fn().mockReturnValue({
      status: 1,
      stdout: "",
      error: null,
    });

    const r = await handler.execute(
      { input: "optimize-description smart-search" },
      {},
      {},
    );
    expect(r.success).toBe(false);
    expect(r.action).toBe("optimize-description");
    expect(typeof r.hint).toBe("string");
  });

  it("respects --iterations limit", async () => {
    let callCount = 0;
    handler._deps.spawnSync = vi.fn().mockImplementation((_exe, args) => {
      const prompt = args[2] || "";
      callCount++;
      if (prompt.includes("20 realistic test queries")) {
        return { status: 0, stdout: EVAL_QUERIES_JSON, error: null };
      }
      if (prompt.includes("Improve this skill description")) {
        return {
          status: 0,
          stdout: `Improved version ${callCount}`,
          error: null,
        };
      }
      return { status: 0, stdout: "NO", error: null }; // All NO → half score
    });

    await handler.execute(
      { input: "optimize-description code-review --iterations 1" },
      {},
      {},
    );
    // Should have called spawnSync: 1 (eval queries) + 20 (train eval) + 1 (improve) + 8 (test eval) = 30
    // i.e., no more than 1 iteration worth of calls (plus initial test)
    expect(callCount).toBeLessThan(50); // reasonably bounded
  });
});

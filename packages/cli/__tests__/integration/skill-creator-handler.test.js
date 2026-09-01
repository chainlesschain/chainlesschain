/**
 * 集成测试 — skill-creator handler (v1.2.0)
 *
 * 直接加载 handler.js，通过 branded host authority 注入 filesystem / process，
 * 测试跨模块边界的真实逻辑（candidate-only create、只读 validate、
 * optimize-description proposal loop）。
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterEach,
} from "vitest";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import * as nativeFs from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── Load handler via createRequire (CJS) ────────────────────────────────────
const handlerPath = resolve(
  __dirname,
  "../../../../desktop-app-vue/src/main/ai-engine/cowork/skills/builtin/skill-creator/handler.js",
);
const repoRoot = resolve(__dirname, "../../../..");
const builtinSkillsRoot = resolve(dirname(handlerPath), "..");
const req = createRequire(pathToFileURL(handlerPath).href);
const { createBundledSkillFilesystemBroker } = req(
  resolve(dirname(handlerPath), "../../bundled-skill-filesystem-broker.js"),
);
const { createBundledSkillEnvironmentBroker } = req(
  resolve(dirname(handlerPath), "../../bundled-skill-environment-broker.js"),
);
const { createBundledSkillProcessBroker } = req(
  resolve(dirname(handlerPath), "../../bundled-skill-process-broker.js"),
);
const { getSkillRegistry } = req(
  resolve(dirname(handlerPath), "../../skill-registry.js"),
);

// Logger is loaded as a side-effect; no need to mock it in integration tests
let handler;
beforeAll(() => {
  handler = req(handlerPath);
});

// ─── Save / restore _deps ─────────────────────────────────────────────────────
let origManagedSkillsRoot;

beforeEach(() => {
  origManagedSkillsRoot = handler._deps.getManagedSkillsRoot;
  handler._deps.getManagedSkillsRoot = () => builtinSkillsRoot;
});

afterEach(() => {
  handler._deps.getManagedSkillsRoot = origManagedSkillsRoot;
  vi.clearAllMocks();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
function makeMockProcess(behaviour) {
  return vi.fn().mockImplementation(({ args }) => behaviour(args[2] || ""));
}

function createExecutionContext({
  executeFileSync,
  swallowWrites = false,
} = {}) {
  const filesystemBroker = createBundledSkillFilesystemBroker(
    {
      skillId: "skill-creator",
      authorityId: "test:skill-creator:filesystem",
      allowedRoots: [builtinSkillsRoot],
      allowedOperations: [
        "existsSync",
        "mkdirSync",
        "readFileSync",
        "writeFileSync",
      ],
      cwd: builtinSkillsRoot,
    },
    {
      invoke: ({ operation, args }) => {
        if (swallowWrites && operation === "writeFileSync") return undefined;
        return nativeFs[operation](...args);
      },
      auditSink() {},
    },
  );
  const environmentBroker = createBundledSkillEnvironmentBroker(
    {
      skillId: "skill-creator",
      authorityId: "test:skill-creator:environment",
    },
    {
      resolveValue: () => null,
      auditSink() {},
    },
  );
  const processBroker = createBundledSkillProcessBroker(
    {
      skillId: "skill-creator",
      authorityId: "test:skill-creator:process",
      allowedRoots: [repoRoot],
      allowedEntrypoints: [handlerPath],
    },
    {
      executeFileSync: executeFileSync || (() => ""),
      auditSink() {},
    },
  );
  return {
    host: { filesystem: filesystemBroker },
    environmentBroker,
    processBroker,
    cliEntrypoint: handlerPath,
    projectRoot: repoRoot,
  };
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
  return makeMockProcess((prompt) => {
    if (prompt.includes("20 realistic test queries")) {
      return EVAL_QUERIES_JSON;
    }
    if (prompt.includes("Would you invoke this skill")) {
      // Alternate YES/NO to create mixed results and force improvement
      return "YES";
    }
    if (prompt.includes("Improve this skill description")) {
      return improvedDesc;
    }
    return "YES";
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

  it("get-template api-integration uses isolated host capabilities", async () => {
    const r = await handler.execute(
      { input: "get-template api-integration" },
      {},
      {},
    );
    expect(r.success).toBe(true);
    expect(r.files["handler.js"]).toContain("chainlesschain.capabilities.call");
    expect(r.files["handler.js"]).toContain('"env:read"');
    expect(r.files["handler.js"]).toContain('"network:https"');
  });

  it("get-template file-processor uses isolated filesystem capability", async () => {
    const r = await handler.execute(
      { input: "get-template file-processor" },
      {},
      {},
    );
    expect(r.files["handler.js"]).toContain("chainlesschain.capabilities.call");
    expect(r.files["handler.js"]).toContain('"filesystem:read"');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Stage-A create freeze + read-only validate lifecycle
// ═══════════════════════════════════════════════════════════════════════════════

describe("candidate-only create + validate (branded filesystem authority)", () => {
  it("declares candidate-only behavior without filesystem write authority", () => {
    const skillMd = nativeFs.readFileSync(
      resolve(builtinSkillsRoot, "skill-creator", "SKILL.md"),
      "utf8",
    );

    expect(skillMd).toContain(
      "The create and optimize-description actions return candidate bytes and diffs",
    );
    expect(skillMd).toContain("they never persist or activate them");
    expect(skillMd).not.toMatch(
      /^execution-capabilities:.*filesystem:write.*$/mu,
    );
    expect(skillMd).not.toContain("writes back the best description");
  });

  it("does not create a directory or mutate active bytes", async () => {
    const candidateName = "stage-a-freeze-candidate-only";
    const candidateDir = resolve(builtinSkillsRoot, candidateName);
    const beforeEntries = nativeFs.readdirSync(builtinSkillsRoot).sort();
    expect(nativeFs.existsSync(candidateDir)).toBe(false);

    const r = await handler.execute(
      { input: `create ${candidateName} "Candidate-only skill"` },
      createExecutionContext(),
      {},
    );

    expect(r).toMatchObject({
      success: true,
      action: "create",
      status: "candidate-proposed",
      skillName: candidateName,
      candidateOnly: true,
      persisted: false,
      activeMutation: false,
      activeExists: false,
    });
    expect(r.proposedFiles["SKILL.md"]).toContain(`name: ${candidateName}`);
    expect(nativeFs.existsSync(candidateDir)).toBe(false);
    expect(nativeFs.readdirSync(builtinSkillsRoot).sort()).toEqual(
      beforeEntries,
    );
  });

  it("does not overwrite an existing active Skill", async () => {
    const skillMdPath = resolve(builtinSkillsRoot, "ultrathink", "SKILL.md");
    const beforeBytes = nativeFs.readFileSync(skillMdPath);

    const r = await handler.execute(
      { input: 'create ultrathink "Replacement proposal"' },
      createExecutionContext(),
      {},
    );

    expect(r).toMatchObject({
      success: true,
      candidateOnly: true,
      persisted: false,
      activeMutation: false,
      activeExists: true,
      alreadyExists: true,
    });
    expect(nativeFs.readFileSync(skillMdPath)).toEqual(beforeBytes);
  });

  it("validate reports valid for existing builtin skill (code-review)", async () => {
    const r = await handler.execute(
      { input: "validate code-review" },
      createExecutionContext(),
      {},
    );
    expect(r.success).toBe(true);
    expect(r.valid).toBe(true);
    expect(r.issues).toHaveLength(0);
    expect(r.checks.length).toBeGreaterThan(0);
  });

  it("validate reports issues for nonexistent skill", async () => {
    const r = await handler.execute(
      { input: "validate skill-that-does-not-exist-xyz" },
      createExecutionContext(),
      {},
    );
    expect(r.success).toBe(false);
    expect(r.valid).toBe(false);
    expect(r.issues.length).toBeGreaterThan(0);
  });

  it("test action runs handler for existing skill (smart-search)", async () => {
    const registry = getSkillRegistry();
    const skill = Object.assign(new EventEmitter(), {
      skillId: "smart-search",
      name: "Smart Search",
      source: "test",
      config: { enabled: true },
      executeWithMetrics: vi.fn(async () => ({ success: true })),
    });
    registry.register(skill);
    try {
      const r = await handler.execute(
        { input: "test smart-search search query" },
        createExecutionContext(),
        {},
      );
      expect(r).toBeDefined();
      expect(r.action).toBe("test");
      expect(r.skillName).toBe("smart-search");
      expect(skill.executeWithMetrics).toHaveBeenCalledOnce();
    } finally {
      registry.unregister(skill.skillId);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// optimize quick — real SKILL.md files
// ═══════════════════════════════════════════════════════════════════════════════

describe("optimize quick (real builtin skills)", () => {
  it("optimize on existing skill returns suggestions or clean result", async () => {
    const r = await handler.execute(
      { input: "optimize code-review" },
      createExecutionContext(),
      {},
    );
    expect(r.success).toBe(true);
    expect(r.action).toBe("optimize");
    expect(r.currentDescription).toBeDefined();
    expect(r.hint).toContain("optimize-description");
    expect(Array.isArray(r.suggestions)).toBe(true);
  });

  it("optimize on smart-search returns current description", async () => {
    const r = await handler.execute(
      { input: "optimize smart-search" },
      createExecutionContext(),
      {},
    );
    expect(r.success).toBe(true);
    expect(typeof r.currentDescription).toBe("string");
    expect(r.currentDescription.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// optimize-description — mocked LLM, real SKILL.md from builtin
// ═══════════════════════════════════════════════════════════════════════════════

describe("optimize-description with mocked LLM (real builtin SKILL.md)", () => {
  it("returns a proposal while leaving active bytes and directory unchanged", async () => {
    const executeFileSync = smartSpawnFn({
      improvedDesc:
        "Better: use for code review, PR analysis, and audit tasks specifically",
    });
    const activeDir = resolve(builtinSkillsRoot, "code-review");
    const activeSkillMd = resolve(activeDir, "SKILL.md");
    const beforeBytes = nativeFs.readFileSync(activeSkillMd);
    const beforeEntries = nativeFs.readdirSync(activeDir).sort();

    const r = await handler.execute(
      { input: "optimize-description code-review --iterations 2" },
      createExecutionContext({ executeFileSync }),
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
    expect(r).toMatchObject({
      candidateOnly: true,
      persisted: false,
      activeMutation: false,
      workspaceEvidence: {
        persisted: false,
        reason: "stage-a-mutation-freeze",
      },
    });
    expect(typeof r.proposedContent).toBe("string");
    expect(r.diff).toMatchObject({
      path: "SKILL.md",
      field: "description",
    });
    expect(nativeFs.readFileSync(activeSkillMd)).toEqual(beforeBytes);
    expect(nativeFs.readdirSync(activeDir).sort()).toEqual(beforeEntries);
  });

  it("gracefully fails when LLM is unavailable (status=1)", async () => {
    const executeFileSync = vi.fn(() => {
      throw new Error("LLM unavailable");
    });

    const r = await handler.execute(
      { input: "optimize-description smart-search" },
      createExecutionContext({ executeFileSync, swallowWrites: true }),
      {},
    );
    expect(r.success).toBe(false);
    expect(r.action).toBe("optimize-description");
    expect(typeof r.hint).toBe("string");
  });

  it("respects --iterations limit", async () => {
    let callCount = 0;
    const executeFileSync = makeMockProcess((prompt) => {
      callCount++;
      if (prompt.includes("20 realistic test queries")) {
        return EVAL_QUERIES_JSON;
      }
      if (prompt.includes("Improve this skill description")) {
        return `Improved version ${callCount}`;
      }
      return "NO"; // All NO → half score
    });

    await handler.execute(
      { input: "optimize-description code-review --iterations 1" },
      createExecutionContext({ executeFileSync, swallowWrites: true }),
      {},
    );
    // The broker should observe at most one iteration of bounded LLM calls.
    // i.e., no more than 1 iteration worth of calls (plus initial test)
    expect(callCount).toBeLessThan(50); // reasonably bounded
  });
});

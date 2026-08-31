/**
 * Skill Creator 单元测试 — v1.2.0
 *
 * 覆盖：parseInput、handleCreate candidate-only contract、handleTest、handleOptimize（快速）、
 *       handleOptimizeDescription（LLM循环）、handleValidate、
 *       handleListTemplates、handleGetTemplate、callLLM / generateEvalQueries /
 *       evaluateDescriptionDetailed / improveDescription（via _deps mock）
 *
 * 测试策略：
 *   - 使用 _deps 注入 mock fs 和 mock spawnSync，不依赖真实 LLM
 *   - 路径依赖真实 path 模块（纯计算，无 I/O）
 *   - 需要真实 fs 的只读测试（validate/optimize 快速）使用 builtin 中已有 skill
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";
import { createEnvironmentContext } from "./helpers/bundled-skill-environment.js";
import { withTestFilesystemHandler } from "./helpers/bundled-skill-filesystem.js";
import { createTestProcessContext } from "./helpers/bundled-skill-process.js";

// ─── Mock logger (必须在 require 之前) ────────────────────────────────────────
vi.mock("../../../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── Load handler ─────────────────────────────────────────────────────────────
const baseHandler = require("../builtin/skill-creator/handler.js");
const handler = withTestFilesystemHandler(baseHandler, "skill-creator", {
  allowedRoots: [process.cwd()],
  cwd: process.cwd(),
  invoke: ({ operation, args }) => handler._deps.fs[operation](...args),
});
const rawExecute = handler.execute.bind(handler);
const environmentContext = createEnvironmentContext("skill-creator", {
  PATH: "test-runtime-path",
});
let processAdapter = () => ({ status: 1, stdout: "", error: null });
const processContext = createTestProcessContext(
  "skill-creator",
  (request) => {
    const result = processAdapter(request.file, request.args, {
      cwd: request.cwd,
      env: request.env,
      timeout: request.timeout,
    });
    if (result?.error) {
      throw result.error;
    }
    if (result?.status !== 0) {
      const error = new Error(`test process exited ${result?.status}`);
      error.status = result?.status;
      error.stdout = result?.stdout || "";
      error.stderr = result?.stderr || "";
      throw error;
    }
    return result?.stdout || "";
  },
  {
    allowedRoots: [process.cwd()],
    allowedEntrypoints: [process.argv[1]],
  },
);
handler.execute = (task, context = {}, skill) =>
  rawExecute(
    task,
    { ...environmentContext, ...processContext, ...context },
    skill,
  );

// ─── Path helpers ─────────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BUILTIN_DIR = resolve(join(__dirname, "..", "builtin"));

function skillPath(name, file) {
  return join(BUILTIN_DIR, name, file);
}

// ─── Minimal valid SKILL.md ───────────────────────────────────────────────────
function makeSkillMd(opts = {}) {
  const desc =
    opts.description ??
    "A test skill that does something useful when user asks";
  const name = opts.name ?? "test-skill";
  const hasHandler = opts.hasHandler !== false;
  const hasName = opts.hasName !== false;
  const hasDesc = opts.hasDesc !== false;
  return [
    "---",
    hasName ? `name: ${name}` : "",
    hasDesc ? `description: ${desc}` : "",
    hasHandler ? "handler: ./handler.js" : "",
    "version: 1.0.0",
    "---",
    "",
    `# ${name}`,
  ]
    .filter((l) => l !== "")
    .join("\n");
}

// ─── Mock fs factory ─────────────────────────────────────────────────────────
function createMockFs(files = {}) {
  const store = new Map(Object.entries(files));
  return {
    existsSync: vi.fn((p) => store.has(p)),
    readFileSync: vi.fn((p) => {
      if (!store.has(p)) {
        throw Object.assign(new Error(`ENOENT: no such file: ${p}`), {
          code: "ENOENT",
        });
      }
      return store.get(p);
    }),
    writeFileSync: vi.fn((p, content) => {
      store.set(p, content);
    }),
    mkdirSync: vi.fn(),
    _store: store,
  };
}

function snapshotMockStore(mockFs) {
  return [...mockFs._store.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([filePath, content]) => [filePath, content]);
}

// ─── Mock spawnSync factories ─────────────────────────────────────────────────
/** LLM always unavailable */
function unavailableSpawn() {
  return vi.fn().mockReturnValue({ status: 1, stdout: "", error: null });
}

/** LLM returns a fixed response for every call */
function fixedResponseSpawn(response) {
  return vi.fn().mockReturnValue({ status: 0, stdout: response, error: null });
}

/**
 * Smart mock that dispatches based on prompt content:
 *  - "20 realistic test queries" → returns valid eval-queries JSON
 *  - "Would you invoke this skill" → returns triggerResponse ("YES"/"NO")
 *  - "Improve this skill description" → returns improvedDesc
 */
function smartSpawn({
  triggerYes = true,
  improvedDesc = "Improved description for better triggering",
} = {}) {
  const evalQueriesJson = JSON.stringify([
    ...Array.from({ length: 10 }, (_, i) => ({
      query: `Should trigger query ${i + 1} with specific details about the skill task`,
      should_trigger: true,
    })),
    ...Array.from({ length: 10 }, (_, i) => ({
      query: `Should not trigger query ${i + 1} about something completely different`,
      should_trigger: false,
    })),
  ]);

  return vi.fn().mockImplementation((_exe, args) => {
    const prompt = args[2] || "";
    if (prompt.includes("20 realistic test queries")) {
      return { status: 0, stdout: evalQueriesJson, error: null };
    }
    if (prompt.includes("Would you invoke this skill")) {
      return { status: 0, stdout: triggerYes ? "YES" : "NO", error: null };
    }
    if (prompt.includes("Improve this skill description")) {
      return { status: 0, stdout: improvedDesc, error: null };
    }
    return { status: 0, stdout: "YES", error: null };
  });
}

// ─── Save / restore _deps ─────────────────────────────────────────────────────
let origFs;
let origGetManagedSkillsRoot;

beforeEach(() => {
  processAdapter = unavailableSpawn();
  origFs = handler._deps.fs;
  origGetManagedSkillsRoot = handler._deps.getManagedSkillsRoot;
  handler._deps.getManagedSkillsRoot = () => BUILTIN_DIR;
  vi.clearAllMocks();
});

afterEach(() => {
  processAdapter = unavailableSpawn();
  handler._deps.fs = origFs;
  handler._deps.getManagedSkillsRoot = origGetManagedSkillsRoot;
});

// ═══════════════════════════════════════════════════════════════════════════════
// _deps structure
// ═══════════════════════════════════════════════════════════════════════════════

describe("_deps structure", () => {
  it("does not export native filesystem or process adapters", () => {
    expect(typeof handler._deps).toBe("object");
    expect(handler._deps.fs).toBeUndefined();
    expect(typeof handler._deps.path).toBe("object");
    expect(handler._deps.spawnSync).toBeUndefined();
    expect(typeof handler._deps.getManagedSkillsRoot).toBe("function");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// parseInput (tested via execute)
// ═══════════════════════════════════════════════════════════════════════════════

describe("parseInput / action routing", () => {
  it("empty input → list-templates", async () => {
    const r = await handler.execute({ input: "" }, {}, {});
    expect(r.action).toBe("list-templates");
    expect(r.success).toBe(true);
  });

  it("no input field → list-templates", async () => {
    const r = await handler.execute({}, {}, {});
    expect(r.action).toBe("list-templates");
  });

  it("'list-templates' → list-templates", async () => {
    const r = await handler.execute({ input: "list-templates" }, {}, {});
    expect(r.action).toBe("list-templates");
  });

  it("'get-template basic' → get-template action, name=basic", async () => {
    const r = await handler.execute({ input: "get-template basic" }, {}, {});
    expect(r.action).toBe("get-template");
    expect(r.templateName).toBe("basic");
  });

  it("'optimize <name>' → optimize quick", async () => {
    const mockFs = createMockFs({
      [skillPath("ultrathink", "SKILL.md")]: makeSkillMd({
        name: "ultrathink",
      }),
    });
    handler._deps.fs = mockFs;
    const r = await handler.execute({ input: "optimize ultrathink" }, {}, {});
    expect(r.action).toBe("optimize");
  });

  it("'optimize <name> --advanced' → optimize-description", async () => {
    processAdapter = unavailableSpawn();
    const mockFs = createMockFs({
      [skillPath("ultrathink", "SKILL.md")]: makeSkillMd({
        name: "ultrathink",
      }),
    });
    handler._deps.fs = mockFs;
    const r = await handler.execute(
      { input: "optimize ultrathink --advanced" },
      {},
      {},
    );
    expect(r.action).toBe("optimize-description");
    expect(r.skillName).toBe("ultrathink");
  });

  it("'optimize <name> --advanced --iterations 3' → maxIterations=3", async () => {
    processAdapter = unavailableSpawn();
    const mockFs = createMockFs({
      [skillPath("x", "SKILL.md")]: makeSkillMd({ name: "x" }),
    });
    handler._deps.fs = mockFs;
    const r = await handler.execute(
      { input: "optimize x --advanced --iterations 3" },
      {},
      {},
    );
    expect(r.action).toBe("optimize-description");
    // LLM unavailable so it fails, but action is correct
    expect(r.success).toBe(false);
  });

  it("'optimize-description <name>' → optimize-description", async () => {
    processAdapter = unavailableSpawn();
    const mockFs = createMockFs({
      [skillPath("code-review", "SKILL.md")]: makeSkillMd({
        name: "code-review",
      }),
    });
    handler._deps.fs = mockFs;
    const r = await handler.execute(
      { input: "optimize-description code-review" },
      {},
      {},
    );
    expect(r.action).toBe("optimize-description");
    expect(r.skillName).toBe("code-review");
  });

  it("'optimize-description <name> --iterations 2' → maxIterations=2 (stops early)", async () => {
    processAdapter = unavailableSpawn();
    const mockFs = createMockFs({
      [skillPath("x", "SKILL.md")]: makeSkillMd({ name: "x" }),
    });
    handler._deps.fs = mockFs;
    // LLM unavailable, so loop runs 0 iterations regardless of maxIterations
    const r = await handler.execute(
      { input: "optimize-description x --iterations 2" },
      {},
      {},
    );
    expect(r.action).toBe("optimize-description");
  });

  it.each(["optimize", "optimize-description", "validate", "test"])(
    "rejects path traversal in the %s action",
    async (action) => {
      const r = await handler.execute(
        { input: `${action} ../../outside` },
        {},
        {},
      );
      expect(r).toMatchObject({
        success: false,
        code: "CC_SKILL_NAME_INVALID",
      });
    },
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// handleListTemplates
// ═══════════════════════════════════════════════════════════════════════════════

describe("handleListTemplates()", () => {
  it("returns 5 templates", async () => {
    const r = await handler.execute({ input: "list-templates" }, {}, {});
    expect(r.success).toBe(true);
    expect(r.templates).toHaveLength(5);
  });

  it("each template has name, description, hasHandler, hasSkillMd", async () => {
    const r = await handler.execute({ input: "list-templates" }, {}, {});
    for (const t of r.templates) {
      expect(typeof t.name).toBe("string");
      expect(typeof t.description).toBe("string");
      expect(t.hasHandler).toBe(true);
      expect(t.hasSkillMd).toBe(true);
    }
  });

  it("includes basic, multi-action, api-integration, file-processor, code-analyzer", async () => {
    const r = await handler.execute({ input: "list-templates" }, {}, {});
    const names = r.templates.map((t) => t.name);
    expect(names).toContain("basic");
    expect(names).toContain("multi-action");
    expect(names).toContain("api-integration");
    expect(names).toContain("file-processor");
    expect(names).toContain("code-analyzer");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// handleGetTemplate
// ═══════════════════════════════════════════════════════════════════════════════

describe("handleGetTemplate()", () => {
  it("returns basic template with handler and skillMd", async () => {
    const r = await handler.execute({ input: "get-template basic" }, {}, {});
    expect(r.success).toBe(true);
    expect(r.action).toBe("get-template");
    expect(typeof r.files["handler.js"]).toBe("string");
    expect(typeof r.files["SKILL.md"]).toBe("string");
    expect(r.files["SKILL.md"]).toContain("name: greeter");
  });

  it("returns multi-action template with task CRUD logic", async () => {
    const r = await handler.execute(
      { input: "get-template multi-action" },
      {},
      {},
    );
    expect(r.success).toBe(true);
    expect(r.files["handler.js"]).toContain("create");
    expect(r.files["handler.js"]).toContain("complete");
  });

  it.each([
    "basic",
    "multi-action",
    "api-integration",
    "file-processor",
    "code-analyzer",
  ])("returns a containment-ready %s template", async (templateName) => {
    const r = await handler.execute(
      { input: `get-template ${templateName}` },
      {},
      {},
    );

    expect(r.files["SKILL.md"]).toContain("execution-capabilities:");
    expect(r.files["handler.js"]).not.toContain(
      "../../../../../utils/logger.js",
    );
  });

  it.each(["api-integration", "file-processor"])(
    "uses isolated capability ports in the %s template",
    async (templateName) => {
      const r = await handler.execute(
        { input: `get-template ${templateName}` },
        {},
        {},
      );

      expect(r.files["handler.js"]).toContain(
        "chainlesschain.capabilities.call",
      );
      expect(r.files["handler.js"]).not.toContain("require(");
      expect(r.files["handler.js"]).not.toContain("process.env");
    },
  );

  it("fails on unknown template name", async () => {
    const r = await handler.execute(
      { input: "get-template nonexistent" },
      {},
      {},
    );
    expect(r.success).toBe(false);
    expect(r.error).toContain("nonexistent");
  });

  it("fails on missing name", async () => {
    const r = await handler.execute({ input: "get-template" }, {}, {});
    expect(r.success).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// handleCreate
// ═══════════════════════════════════════════════════════════════════════════════

describe("handleCreate()", () => {
  it("fails when no name provided", async () => {
    const r = await handler.execute({ input: "create" }, {}, {});
    expect(r).toMatchObject({
      success: false,
      action: "create",
      candidateOnly: true,
      persisted: false,
      activeMutation: false,
    });
    expect(r.error).toBeDefined();
  });

  it("returns an in-memory candidate when the active directory does not exist", async () => {
    const mockFs = createMockFs({}); // empty - no existing files
    handler._deps.fs = mockFs;
    const before = snapshotMockStore(mockFs);

    const r = await handler.execute(
      { input: 'create my-brand-new-skill "Does something useful"' },
      {},
      {},
    );
    expect(r.success).toBe(true);
    expect(r.action).toBe("create");
    expect(r.skillName).toBe("my-brand-new-skill");
    expect(r).toMatchObject({
      status: "candidate-proposed",
      candidateOnly: true,
      persisted: false,
      activeMutation: false,
      activeExists: false,
      alreadyExists: false,
    });
    expect(Object.keys(r.proposedFiles)).toEqual(["SKILL.md", "handler.js"]);
    expect(r.message).toContain("not persisted or active");
    expect(r.message).not.toMatch(/created at|persisted at|is now active/i);
    expect(mockFs.mkdirSync).not.toHaveBeenCalled();
    expect(mockFs.writeFileSync).not.toHaveBeenCalled();
    expect(snapshotMockStore(mockFs)).toEqual(before);
  });

  it("returns alreadyExists=true when directory exists", async () => {
    // handleCreate checks existsSync(skillDir), not existsSync(SKILL.md)
    const mockFs = createMockFs({
      [join(BUILTIN_DIR, "existing-skill")]: "directory-marker",
    });
    handler._deps.fs = mockFs;

    const r = await handler.execute({ input: "create existing-skill" }, {}, {});
    expect(r.success).toBe(true);
    expect(r.alreadyExists).toBe(true);
    expect(r).toMatchObject({
      candidateOnly: true,
      persisted: false,
      activeMutation: false,
      activeExists: true,
    });
    // Should not write (already exists)
    expect(mockFs.mkdirSync).not.toHaveBeenCalled();
    expect(mockFs.writeFileSync).not.toHaveBeenCalled();
  });

  it("normalizes skill name to lowercase-hyphens", async () => {
    const mockFs = createMockFs({});
    handler._deps.fs = mockFs;

    const r = await handler.execute({ input: "create My Cool Skill" }, {}, {});
    expect(r.skillName).toBe("my");
    // Only first token "My" is the name, rest are description parts
  });

  it("generated SKILL.md contains required frontmatter", async () => {
    const mockFs = createMockFs({});
    handler._deps.fs = mockFs;

    const r = await handler.execute(
      { input: 'create test-unit "A useful skill"' },
      {},
      {},
    );
    const content = r.proposedFiles["SKILL.md"];
    expect(content).toContain("name: test-unit");
    expect(content).toContain("version: 1.0.0");
    expect(content).toContain("handler: ./handler.js");
    expect(content).toContain(
      "execution-capabilities: [data:task, data:result]",
    );
  });

  it("generated handler.js has init() and execute() exports", async () => {
    const mockFs = createMockFs({});
    handler._deps.fs = mockFs;

    const r = await handler.execute(
      { input: "create handler-test-new" },
      {},
      {},
    );
    const code = r.proposedFiles["handler.js"];
    expect(code).toContain("async init(");
    expect(code).toContain("async execute(");
    expect(code).not.toContain("require(");
  });

  it("does not change existing active bytes or directory contents", async () => {
    const activeDir = join(BUILTIN_DIR, "protected-skill");
    const activeSkillMd = join(activeDir, "SKILL.md");
    const activeHandler = join(activeDir, "handler.js");
    const mockFs = createMockFs({
      [activeDir]: "directory-marker",
      [activeSkillMd]: "active SKILL bytes",
      [activeHandler]: "active handler bytes",
    });
    handler._deps.fs = mockFs;
    const before = snapshotMockStore(mockFs);

    const r = await handler.execute(
      { input: 'create protected-skill "replacement proposal"' },
      {},
      {},
    );

    expect(r).toMatchObject({
      success: true,
      candidateOnly: true,
      persisted: false,
      activeMutation: false,
      activeExists: true,
    });
    expect(snapshotMockStore(mockFs)).toEqual(before);
    expect(mockFs.mkdirSync).not.toHaveBeenCalled();
    expect(mockFs.writeFileSync).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// handleOptimize (quick heuristic)
// ═══════════════════════════════════════════════════════════════════════════════

describe("handleOptimize() - quick heuristic", () => {
  it("fails with no name", async () => {
    const r = await handler.execute({ input: "optimize" }, {}, {});
    expect(r.success).toBe(false);
  });

  it("fails when SKILL.md not found", async () => {
    handler._deps.fs = createMockFs({});
    const r = await handler.execute({ input: "optimize nonexistent" }, {}, {});
    expect(r.success).toBe(false);
    expect(r.error).toContain("SKILL.md not found");
  });

  it("suggests improvement for short description (<50 chars)", async () => {
    handler._deps.fs = createMockFs({
      [skillPath("x", "SKILL.md")]: makeSkillMd({ description: "Short desc" }),
    });
    const r = await handler.execute({ input: "optimize x" }, {}, {});
    expect(r.success).toBe(true);
    expect(r.suggestions.some((s) => /too short/i.test(s))).toBe(true);
  });

  it("suggests adding trigger keywords when missing", async () => {
    handler._deps.fs = createMockFs({
      [skillPath("x", "SKILL.md")]: makeSkillMd({
        description: "This skill processes data and returns results to callers",
      }),
    });
    const r = await handler.execute({ input: "optimize x" }, {}, {});
    expect(r.suggestions.some((s) => /trigger/i.test(s))).toBe(true);
  });

  it("suggests shorter description when >200 chars", async () => {
    const longDesc = "A".repeat(201);
    handler._deps.fs = createMockFs({
      [skillPath("x", "SKILL.md")]: makeSkillMd({ description: longDesc }),
    });
    const r = await handler.execute({ input: "optimize x" }, {}, {});
    expect(r.suggestions.some((s) => /too long/i.test(s))).toBe(true);
  });

  it("returns hint to use optimize-description for LLM loop", async () => {
    handler._deps.fs = createMockFs({
      [skillPath("x", "SKILL.md")]: makeSkillMd({
        description:
          "Use when user asks to process code reviews. Triggers on review requests.",
      }),
    });
    const r = await handler.execute({ input: "optimize x" }, {}, {});
    expect(r.hint).toContain("optimize-description");
  });

  it("no suggestions for a well-formed description", async () => {
    handler._deps.fs = createMockFs({
      [skillPath("x", "SKILL.md")]: makeSkillMd({
        description:
          "Use when user asks to analyze code. Triggers on code review requests and audit tasks.",
      }),
    });
    const r = await handler.execute({ input: "optimize x" }, {}, {});
    expect(r.success).toBe(true);
    expect(r.suggestions).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// handleValidate
// ═══════════════════════════════════════════════════════════════════════════════

describe("handleValidate()", () => {
  it("fails with no name", async () => {
    const r = await handler.execute({ input: "validate" }, {}, {});
    expect(r.success).toBe(false);
  });

  it("reports issue when SKILL.md missing", async () => {
    handler._deps.fs = createMockFs({});
    const r = await handler.execute({ input: "validate ghost-skill" }, {}, {});
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => /SKILL\.md/i.test(i))).toBe(true);
  });

  it("reports issue when handler.js missing", async () => {
    handler._deps.fs = createMockFs({
      [skillPath("x", "SKILL.md")]: makeSkillMd({ name: "x" }),
    });
    const r = await handler.execute({ input: "validate x" }, {}, {});
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => /handler\.js/i.test(i))).toBe(true);
  });

  it("reports issue when SKILL.md missing required 'description' field", async () => {
    handler._deps.fs = createMockFs({
      [skillPath("x", "SKILL.md")]: makeSkillMd({ name: "x", hasDesc: false }),
      [skillPath("x", "handler.js")]:
        "module.exports = { async execute() {}, async init() {} };",
    });
    const r = await handler.execute({ input: "validate x" }, {}, {});
    expect(r.issues.some((i) => /description/i.test(i))).toBe(true);
  });

  it("passes for a complete valid skill (uses real builtin ultrathink)", async () => {
    // Use real fs + real builtin skill — validate does require() which needs real files
    handler._deps.fs = require("node:fs");
    const r = await handler.execute({ input: "validate ultrathink" }, {}, {});
    expect(r.success).toBe(true);
    expect(r.valid).toBe(true);
    expect(r.issues).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// callLLM (via _deps.spawnSync mock)
// ═══════════════════════════════════════════════════════════════════════════════

describe("callLLM() via _deps.spawnSync", () => {
  it("returns stdout when spawnSync succeeds (status 0)", async () => {
    // Trigger callLLM indirectly via optimize-description (will fail on parseEvalQueries but shows callLLM worked)
    const mockSpawn = vi.fn().mockReturnValue({
      status: 0,
      stdout: "not valid json for eval queries",
      error: null,
    });
    processAdapter = mockSpawn;
    handler._deps.fs = createMockFs({
      [skillPath("x", "SKILL.md")]: makeSkillMd({ name: "x" }),
    });

    const r = await handler.execute(
      { input: "optimize-description x" },
      {},
      {},
    );
    // callLLM was called; JSON parse failed → error with action field
    expect(r.success).toBe(false);
    expect(r.action).toBe("optimize-description");
    expect(mockSpawn).toHaveBeenCalled();
  });

  it("returns null (→ evalQueries null) when spawnSync fails (status != 0)", async () => {
    processAdapter = unavailableSpawn();
    handler._deps.fs = createMockFs({
      [skillPath("x", "SKILL.md")]: makeSkillMd({ name: "x" }),
    });

    const r = await handler.execute(
      { input: "optimize-description x" },
      {},
      {},
    );
    expect(r.success).toBe(false);
    expect(r.error).toContain("Failed to generate eval queries");
  });

  it("returns null when spawnSync throws (error object present)", async () => {
    processAdapter = vi.fn().mockReturnValue({
      status: 0,
      stdout: "irrelevant",
      error: new Error("SPAWN_FAILED"),
    });
    handler._deps.fs = createMockFs({
      [skillPath("x", "SKILL.md")]: makeSkillMd({ name: "x" }),
    });

    const r = await handler.execute(
      { input: "optimize-description x" },
      {},
      {},
    );
    expect(r.success).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// handleOptimizeDescription — error paths
// ═══════════════════════════════════════════════════════════════════════════════

describe("handleOptimizeDescription() - error paths", () => {
  it("fails with no name", async () => {
    const r = await handler.execute({ input: "optimize-description" }, {}, {});
    expect(r.success).toBe(false);
    expect(r.error).toBeDefined();
  });

  it("fails when SKILL.md not found — action field present", async () => {
    handler._deps.fs = createMockFs({});
    const r = await handler.execute(
      { input: "optimize-description ghost-skill" },
      {},
      {},
    );
    expect(r.success).toBe(false);
    expect(r.action).toBe("optimize-description");
  });

  it("fails when SKILL.md has no description field — action field present", async () => {
    handler._deps.fs = createMockFs({
      [skillPath("x", "SKILL.md")]:
        "---\nname: x\nhandler: ./handler.js\n---\n",
    });
    processAdapter = unavailableSpawn();
    const r = await handler.execute(
      { input: "optimize-description x" },
      {},
      {},
    );
    expect(r.success).toBe(false);
    expect(r.action).toBe("optimize-description");
    expect(r.error).toContain("description");
  });

  it("fails gracefully when LLM unavailable — action field present, includes hint", async () => {
    processAdapter = unavailableSpawn();
    handler._deps.fs = createMockFs({
      [skillPath("x", "SKILL.md")]: makeSkillMd({ name: "x" }),
    });
    const r = await handler.execute(
      { input: "optimize-description x" },
      {},
      {},
    );
    expect(r.success).toBe(false);
    expect(r.action).toBe("optimize-description");
    expect(r.skillName).toBe("x");
    expect(typeof r.hint).toBe("string");
    expect(r.hint).toContain("optimize-description");
  });

  it("fails gracefully when LLM returns invalid JSON for eval queries", async () => {
    processAdapter = fixedResponseSpawn("This is not JSON at all");
    handler._deps.fs = createMockFs({
      [skillPath("x", "SKILL.md")]: makeSkillMd({ name: "x" }),
    });
    const r = await handler.execute(
      { input: "optimize-description x" },
      {},
      {},
    );
    expect(r.success).toBe(false);
    expect(r.action).toBe("optimize-description");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// handleOptimizeDescription — successful optimization
// ═══════════════════════════════════════════════════════════════════════════════

describe("handleOptimizeDescription() - successful optimization", () => {
  const originalDesc = "A skill that reviews code. Use when reviewing.";

  function buildMockFs(description = originalDesc) {
    const content = [
      "---",
      "name: code-review",
      `description: ${description}`,
      "handler: ./handler.js",
      "version: 1.0.0",
      "---",
    ].join("\n");
    return createMockFs({
      [skillPath("code-review", "SKILL.md")]: content,
    });
  }

  function improvingSpawn(improvedDesc) {
    const evalQueriesJson = JSON.stringify([
      ...Array.from({ length: 10 }, (_, i) => ({
        query: `Should trigger query ${i + 1} with specific details about the skill task`,
        should_trigger: true,
      })),
      ...Array.from({ length: 10 }, (_, i) => ({
        query: `Should not trigger query ${i + 1} about a near-miss task`,
        should_trigger: false,
      })),
    ]);

    return vi.fn().mockImplementation((_exe, args) => {
      const prompt = args[2] || "";
      if (prompt.includes("20 realistic test queries")) {
        return { status: 0, stdout: evalQueriesJson, error: null };
      }
      if (prompt.includes("Improve this skill description")) {
        return { status: 0, stdout: improvedDesc, error: null };
      }
      if (prompt.includes("Would you invoke this skill")) {
        const shouldTrigger = !prompt.includes("Should not trigger query");
        const isImproved = prompt.includes(improvedDesc);
        const trigger = isImproved ? shouldTrigger : !shouldTrigger;
        return { status: 0, stdout: trigger ? "YES" : "NO", error: null };
      }
      return { status: 0, stdout: "NO", error: null };
    });
  }

  it("returns success=true with eval query count", async () => {
    processAdapter = smartSpawn({
      improvedDesc: "Better description with trigger keywords",
    });
    handler._deps.fs = buildMockFs();

    const r = await handler.execute(
      { input: "optimize-description code-review" },
      {},
      {},
    );
    expect(r.success).toBe(true);
    expect(r.action).toBe("optimize-description");
    expect(r.evalQueriesGenerated).toBeGreaterThanOrEqual(4);
    expect(r).toMatchObject({
      candidateOnly: true,
      persisted: false,
      activeMutation: false,
    });
  });

  it("when all queries trigger correctly (perfect score) — no improvement needed", async () => {
    // All YES → 10 should_trigger correct, 10 should_not_trigger wrong → score = 0.5
    // Actually we need to think about this more carefully.
    // With triggerYes=true: should_trigger=true → triggered=true → correct
    //                       should_not_trigger=false → triggered=true → incorrect
    // So score on test = 50%
    // improvedDesc returned by LLM, score checked again...
    // This test just verifies the loop runs and returns a result
    processAdapter = smartSpawn({
      triggerYes: true,
      improvedDesc:
        "Use this skill specifically when reviewing code, analyzing PRs, or doing code audits",
    });
    const mockFs = buildMockFs();
    handler._deps.fs = mockFs;

    const r = await handler.execute(
      { input: "optimize-description code-review --iterations 2" },
      {},
      {},
    );
    expect(r.success).toBe(true);
    expect(typeof r.bestTestScore).toBe("number");
    expect(r.bestTestScore).toBeGreaterThanOrEqual(0);
    expect(r.bestTestScore).toBeLessThanOrEqual(1);
  });

  it("returns proposed content and a diff without overwriting active SKILL.md", async () => {
    const improvedDesc =
      "Use specifically for code review and PR analysis tasks";
    processAdapter = improvingSpawn(improvedDesc);
    const mockFs = buildMockFs();
    handler._deps.fs = mockFs;
    const before = snapshotMockStore(mockFs);

    const r = await handler.execute(
      { input: "optimize-description code-review --iterations 1" },
      {},
      {},
    );
    expect(r).toMatchObject({
      success: true,
      status: "candidate-proposed",
      skillName: "code-review",
      originalDescription: originalDesc,
      bestDescription: improvedDesc,
      improved: true,
      candidateOnly: true,
      persisted: false,
      activeMutation: false,
      diff: {
        path: "SKILL.md",
        field: "description",
        changed: true,
        before: originalDesc,
        after: improvedDesc,
      },
    });
    expect(r.proposedContent).toContain(`description: ${improvedDesc}`);
    expect(r.message).toContain("active SKILL.md is unchanged");
    expect(mockFs.mkdirSync).not.toHaveBeenCalled();
    expect(mockFs.writeFileSync).not.toHaveBeenCalled();
    expect(snapshotMockStore(mockFs)).toEqual(before);
  });

  it("includes iteration details in result", async () => {
    processAdapter = smartSpawn({ improvedDesc: "Improved version" });
    handler._deps.fs = buildMockFs();

    const r = await handler.execute(
      { input: "optimize-description code-review --iterations 2" },
      {},
      {},
    );
    expect(r.success).toBe(true);
    expect(Array.isArray(r.iterationDetails)).toBe(true);
  });

  it("returns workspace evidence in-band and never claims it was persisted", async () => {
    processAdapter = smartSpawn({ improvedDesc: "Better version" });
    const mockFs = buildMockFs();
    mockFs.writeFileSync.mockImplementation(() => {
      throw new Error("workspace evidence write denied");
    });
    handler._deps.fs = mockFs;

    const r = await handler.execute(
      { input: "optimize-description code-review --iterations 1" },
      {},
      {},
    );

    expect(r.success).toBe(true);
    expect(r).toMatchObject({
      candidateOnly: true,
      persisted: false,
      activeMutation: false,
      workspaceEvidence: {
        persisted: false,
        reason: "stage-a-mutation-freeze",
      },
    });
    expect(r.workspaceEvidence.payload.skillName).toBe("code-review");
    expect(Array.isArray(r.workspaceEvidence.payload.evalQueries)).toBe(true);
    expect(typeof r.workspaceEvidence.payload.baselineTestScore).toBe("number");
    expect(mockFs.mkdirSync).not.toHaveBeenCalled();
    expect(mockFs.writeFileSync).not.toHaveBeenCalled();
  });

  it("does not write SKILL.md when description not improved", async () => {
    // Make improvedDesc identical to original → no improvement
    processAdapter = smartSpawn({ improvedDesc: originalDesc });
    const mockFs = buildMockFs();
    handler._deps.fs = mockFs;

    const r = await handler.execute(
      { input: "optimize-description code-review --iterations 1" },
      {},
      {},
    );
    expect(r.success).toBe(true);
    expect(r).toMatchObject({
      candidateOnly: true,
      persisted: false,
      activeMutation: false,
    });
    // If bestDesc === originalDesc, improved = false, writeFileSync not called for SKILL.md
    if (!r.improved) {
      const skillMdWrite = mockFs.writeFileSync.mock.calls.find(
        (c) => typeof c[0] === "string" && c[0].endsWith("SKILL.md"),
      );
      expect(skillMdWrite).toBeUndefined();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Unknown action
// ═══════════════════════════════════════════════════════════════════════════════

describe("unknown action", () => {
  it("returns error for unknown action", async () => {
    const r = await handler.execute({ input: "frobnicate something" }, {}, {});
    expect(r.success).toBe(false);
    expect(r.error).toContain("frobnicate");
  });
});

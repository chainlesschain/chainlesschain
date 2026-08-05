import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HOST_SKILL_LIMITS,
  resolveSkillLimits,
} from "../../src/lib/skill-budget.js";
import { captureSkillExecutionSnapshot } from "../../src/lib/skill-execution-identity.js";
import { CLISkillLoader } from "../../src/lib/skill-loader.js";
import {
  buildSystemPrompt,
  executeTool,
} from "../../src/runtime/agent-core.js";

const roots = [];

function rootFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-skill-budget-"));
  roots.push(root);
  return root;
}

function skillDocument(name, body, extra = "") {
  return `---\nname: ${name}\ndescription: bounded\n${extra}---\n${body}`;
}

function writeSkill(root, name, body = "body", extra = "") {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "SKILL.md");
  fs.writeFileSync(file, skillDocument(name, body, extra), "utf8");
  return { dir, file };
}

function writeSkillAtExactBytes(root, name, bytes) {
  const prefix = skillDocument(name, "");
  const prefixBytes = Buffer.byteLength(prefix, "utf8");
  if (prefixBytes > bytes) throw new Error("fixture byte limit is too small");
  return writeSkill(root, name, "x".repeat(bytes - prefixBytes));
}

function discoverOne(root, limits = {}) {
  const loader = new CLISkillLoader({ contextLedger: null, limits });
  const skills = loader._loadFromDir(root, "workspace");
  expect(skills).toHaveLength(1);
  return { loader, skill: skills[0] };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("host-owned Skill file and recursive budgets", () => {
  it("accepts the exact file boundary and rejects one additional byte before materialization", () => {
    const exactRoot = rootFixture();
    const overRoot = rootFixture();
    writeSkillAtExactBytes(exactRoot, "exact", 256);
    writeSkillAtExactBytes(overRoot, "over", 257);

    const exact = new CLISkillLoader({
      contextLedger: null,
      limits: { maxSkillFileBytes: 256 },
    })._loadFromDir(exactRoot, "workspace");
    expect(exact).toHaveLength(1);
    expect(exact[0].skillFileBytes).toBe(256);

    expect(() =>
      new CLISkillLoader({
        contextLedger: null,
        limits: { maxSkillFileBytes: 256 },
      })._loadFromDir(overRoot, "workspace"),
    ).toThrowError(
      expect.objectContaining({
        code: "CC_SKILL_FILE_TOO_LARGE",
        limit: 256,
        actual: 257,
      }),
    );
  });

  it("caps the combined SKILL.md and handler.js identity snapshot", () => {
    const root = rootFixture();
    const { dir, file } = writeSkill(root, "combined", "x".repeat(40));
    fs.writeFileSync(path.join(dir, "handler.js"), "h".repeat(80), "utf8");
    const total = fs.statSync(file).size + 80;

    expect(() =>
      captureSkillExecutionSnapshot({
        skillDir: dir,
        limits: {
          maxSkillFileBytes: 256,
          maxSkillTotalBytes: total - 1,
        },
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "CC_SKILL_TOTAL_BYTES_EXCEEDED",
        limit: total - 1,
        actual: total,
      }),
    );
  });

  it("rejects an oversized component from metadata before reading its contents", () => {
    const root = rootFixture();
    const { dir } = writeSkillAtExactBytes(root, "preflight", 257);
    const readFile = vi.spyOn(fs, "readFileSync");

    expect(() =>
      captureSkillExecutionSnapshot({
        skillDir: dir,
        limits: { maxSkillFileBytes: 256 },
      }),
    ).toThrowError(
      expect.objectContaining({ code: "CC_SKILL_FILE_TOO_LARGE" }),
    );
    expect(readFile).not.toHaveBeenCalled();
  });

  it("enforces exact recursive file-count and aggregate-byte boundaries", () => {
    const root = rootFixture();
    const first = writeSkill(root, "one", "a");
    const second = writeSkill(root, "two", "b");
    const exactBytes =
      fs.statSync(first.file).size + fs.statSync(second.file).size;

    expect(
      new CLISkillLoader({
        contextLedger: null,
        limits: {
          maxSkillDiscoveryFiles: 2,
          maxSkillDiscoveryBytes: exactBytes,
        },
      })._loadFromDir(root, "workspace"),
    ).toHaveLength(2);

    writeSkill(root, "three", "c");
    expect(() =>
      new CLISkillLoader({
        contextLedger: null,
        limits: { maxSkillDiscoveryFiles: 2 },
      })._loadFromDir(root, "workspace"),
    ).toThrowError(
      expect.objectContaining({
        code: "CC_SKILL_DISCOVERY_FILES_EXCEEDED",
        limit: 2,
        actual: 3,
      }),
    );
    expect(() =>
      new CLISkillLoader({
        contextLedger: null,
        limits: { maxSkillDiscoveryBytes: exactBytes },
      })._loadFromDir(root, "workspace"),
    ).toThrowError(
      expect.objectContaining({
        code: "CC_SKILL_DISCOVERY_BYTES_EXCEEDED",
        limit: exactBytes,
      }),
    );
  });

  it("streams directory entries and stops recursive empty-directory floods", () => {
    const root = rootFixture();
    fs.mkdirSync(path.join(root, "empty-a"));
    fs.mkdirSync(path.join(root, "empty-b"));
    fs.mkdirSync(path.join(root, "empty-c"));

    expect(() =>
      new CLISkillLoader({
        contextLedger: null,
        limits: { maxSkillDiscoveryEntries: 2 },
      })._loadFromDir(root, "workspace"),
    ).toThrowError(
      expect.objectContaining({
        code: "CC_SKILL_DISCOVERY_ENTRIES_EXCEEDED",
        limit: 2,
        actual: 3,
      }),
    );
  });

  it("does not descend past the effective nested-directory depth", () => {
    const root = rootFixture();
    const acceptedGroup = path.join(root, "accepted-group");
    const ignoredGroup = path.join(root, "ignored-group", "deeper");
    writeSkill(acceptedGroup, "accepted", "ok");
    writeSkill(ignoredGroup, "ignored", "must-not-load");

    const skills = new CLISkillLoader({
      contextLedger: null,
      limits: { maxSkillNestDepth: 1 },
    })._loadFromDir(root, "workspace");
    expect(skills.map((skill) => skill.id)).toEqual(["accepted"]);
  });

  it.each([0, -1, "1", Infinity, Number.MAX_SAFE_INTEGER])(
    "does not let invalid or oversized configuration (%s) raise or disable hard limits",
    (value) => {
      const configured = Object.fromEntries(
        Object.keys(HOST_SKILL_LIMITS).map((key) => [key, value]),
      );
      expect(resolveSkillLimits(configured)).toEqual(HOST_SKILL_LIMITS);
      expect(new CLISkillLoader({ limits: configured }).getLimits()).toEqual(
        HOST_SKILL_LIMITS,
      );
    },
  );
});

describe("host-owned Skill model projection budgets", () => {
  it("accepts the exact prompt boundary without silently truncating it", () => {
    const root = rootFixture();
    writeSkill(root, "exact-prompt", "x".repeat(128));
    const { loader, skill } = discoverOne(root, {
      maxSkillPromptBytes: 128,
      maxSkillPromptTokens: 128,
    });

    loader.materializeSkill(skill, { bodyIncluded: true });
    expect(skill.body).toBe("x".repeat(128));
    expect(Buffer.byteLength(skill.body, "utf8")).toBe(128);
  });

  it("rejects oversized UTF-8 bodies before cache, ledger, or model exposure", () => {
    const root = rootFixture();
    const canary = "SKILL_SECRET_CANARY";
    writeSkill(root, "utf8-over", `${canary}${"界".repeat(40)}`);
    const recordRead = vi.fn();
    const loader = new CLISkillLoader({
      contextLedger: { recordRead },
      limits: {
        maxSkillPromptBytes: 128,
        maxSkillPromptTokens: 200,
      },
    });
    const [skill] = loader._loadFromDir(root, "workspace");

    let failure;
    try {
      loader.materializeSkill(skill, { bodyIncluded: true });
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      code: "CC_SKILL_PROMPT_BYTES_EXCEEDED",
      limit: 128,
    });
    expect(JSON.stringify(failure)).not.toContain(canary);
    expect(skill.body).toBeNull();
    expect(loader.getCacheLedger().bodies.resident).toBe(0);
    expect(recordRead).not.toHaveBeenCalled();
  });

  it("enforces a tighter token ceiling independently of the byte ceiling", () => {
    const root = rootFixture();
    writeSkill(root, "token-over", "x".repeat(65));
    const { loader, skill } = discoverOne(root, {
      maxSkillPromptBytes: 128,
      maxSkillPromptTokens: 64,
    });

    expect(() =>
      loader.materializeSkill(skill, { bodyIncluded: true }),
    ).toThrowError(
      expect.objectContaining({
        code: "CC_SKILL_PROMPT_TOKENS_EXCEEDED",
        limit: 64,
        actual: 65,
      }),
    );
  });

  it("rejects non-string injected bodies without invoking their coercion hooks", () => {
    const toString = vi.fn(() => "INJECTED_BODY_CANARY");
    const prompt = buildSystemPrompt(rootFixture(), {
      skillLoader: {
        getAutoActivatedPersonas: () => [
          { id: "object-body", displayName: "Object", body: { toString } },
        ],
        getCacheLedger: () => ({}),
      },
    });

    expect(toString).not.toHaveBeenCalled();
    expect(prompt).not.toContain("INJECTED_BODY_CANARY");
  });

  it("rejects the complete persona set when its aggregate prompt budget is exceeded", () => {
    const root = rootFixture();
    writeSkill(
      root,
      "persona-one",
      "a".repeat(80),
      "category: persona\nactivation: auto\n",
    );
    writeSkill(
      root,
      "persona-two",
      "b".repeat(80),
      "category: persona\nactivation: auto\n",
    );
    const loader = new CLISkillLoader({
      contextLedger: null,
      limits: {
        maxSkillPromptBytes: 100,
        maxSkillPromptTokens: 100,
        maxSkillPromptTotalBytes: 159,
        maxSkillPromptTotalTokens: 200,
      },
    });
    loader._cache = loader._loadFromDir(root, "workspace");

    expect(() => loader.getAutoActivatedPersonas()).toThrowError(
      expect.objectContaining({
        code: "CC_SKILL_PROMPT_TOTAL_BYTES_EXCEEDED",
        limit: 159,
        actual: 160,
      }),
    );
  });

  it("rechecks injected persona loader output before the main model prompt", () => {
    const root = rootFixture();
    const canary = `CUSTOM_PERSONA_CANARY_${"x".repeat(
      HOST_SKILL_LIMITS.maxSkillPromptBytes,
    )}`;
    const prompt = buildSystemPrompt(root, {
      skillLoader: {
        getAutoActivatedPersonas: () => [
          { id: "custom", displayName: "Custom", body: canary },
        ],
        getLimits: () => ({
          maxSkillPromptBytes: Number.MAX_SAFE_INTEGER,
        }),
        getCacheLedger: () => ({}),
      },
    });

    expect(prompt).not.toContain("CUSTOM_PERSONA_CANARY");
  });

  it("projects the admitted persona snapshot even if an observer mutates the loader object", () => {
    const root = rootFixture();
    const persona = {
      id: "snapshot",
      displayName: "Snapshot",
      body: "ADMITTED_PERSONA_BODY",
    };
    const prompt = buildSystemPrompt(root, {
      skillLoader: {
        getAutoActivatedPersonas: () => [persona],
        getCacheLedger: () => ({}),
      },
      onSkillsLoaded: () => {
        persona.body = "MUTATED_PERSONA_CANARY";
      },
    });

    expect(prompt).toContain("ADMITTED_PERSONA_BODY");
    expect(prompt).not.toContain("MUTATED_PERSONA_CANARY");
  });

  it("blocks injected run_skill content before a child agent is created", async () => {
    const root = rootFixture();
    const canary = `CUSTOM_SUBAGENT_CANARY_${"x".repeat(
      HOST_SKILL_LIMITS.maxSkillPromptBytes,
    )}`;
    const descriptor = {
      id: "custom-run",
      dirName: "custom-run",
      description: "custom",
      category: "testing",
      source: "custom",
      hasHandler: true,
      isolation: true,
      paths: null,
    };
    const result = await executeTool(
      "run_skill",
      { skill_name: "custom-run", input: "go" },
      {
        cwd: root,
        skillLoader: {
          getResolvedSkills: () => [descriptor],
          materializeSkillForExecution: async () => ({
            ...descriptor,
            body: canary,
          }),
          getLimits: () => ({
            maxSkillPromptBytes: Number.MAX_SAFE_INTEGER,
          }),
        },
      },
    );

    expect(result).toMatchObject({
      code: "CC_SKILL_PROMPT_BYTES_EXCEEDED",
      policy: {
        decision: "blocked",
        via: "skill-execution-boundary",
      },
    });
    expect(JSON.stringify(result)).not.toContain("CUSTOM_SUBAGENT_CANARY");
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CLISkillLoader } from "../../src/lib/skill-loader.js";
import {
  captureSkillExecutionSnapshot,
  describeSkillExecutionAuthority,
} from "../../src/lib/skill-execution-identity.js";

const roots = [];

function createSkill(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-skill-identity-"));
  roots.push(root);
  const name = options.name || "guarded-skill";
  const skillDir = path.join(root, name);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, "SKILL.md"),
    `---\nname: ${name}\ndescription: guarded\nisolation: ${options.isolation === true}\n---\n\n${options.body || "# Guarded skill"}`,
    "utf8",
  );
  if (options.handler !== false) {
    fs.writeFileSync(
      path.join(skillDir, "handler.js"),
      options.handlerBody ||
        'export default { async execute() { return { success: true, marker: "handler-secret-a" }; } };\n',
      "utf8",
    );
  }
  return { root, skillDir, name };
}

function discover(fixture, options = {}) {
  const loader = new CLISkillLoader({ contextLedger: null, ...options });
  const [skill] = loader._loadFromDir(fixture.root, "workspace");
  return { loader, skill };
}

afterEach(() => {
  delete globalThis.__skillHandlerImported;
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("Skill execution identity", () => {
  it("produces stable content-free identity and digest descriptors", () => {
    const fixture = createSkill();
    const first = discover(fixture).skill;
    const second = discover(fixture).skill;
    const before = fs.statSync(path.join(fixture.skillDir, "SKILL.md"));
    fs.utimesSync(
      path.join(fixture.skillDir, "SKILL.md"),
      new Date(before.atimeMs + 10_000),
      new Date(before.mtimeMs + 10_000),
    );
    const afterTouch = discover(fixture).skill;

    expect(first.executionIdentity).toMatchObject({
      schemaVersion: 1,
      handlerPresent: true,
      componentDigests: {
        "SKILL.md": expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        "handler.js": expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      },
    });
    expect(first.executionIdentity.identityDigest).toMatch(
      /^sha256:[a-f0-9]{64}$/,
    );
    expect(first.executionIdentity.contentDigest).toMatch(
      /^sha256:[a-f0-9]{64}$/,
    );
    expect(second.executionIdentity).toEqual(first.executionIdentity);
    expect(afterTouch.executionIdentity).toEqual(first.executionIdentity);
    expect(first.executionAuthority).toEqual({
      schemaVersion: 1,
      mode: "blocked-direct-handler",
      directHandlerAllowed: false,
      controlledToolEntryRequired: true,
    });
    expect(JSON.stringify(first)).not.toContain("handler-secret-a");
  });

  it("detects same-length handler drift even when mtime is restored", () => {
    const fixture = createSkill({
      isolation: true,
      handlerBody:
        'export default { marker: "digest-marker-a", execute() {} };\n',
    });
    const { loader, skill } = discover(fixture);
    const handlerPath = path.join(fixture.skillDir, "handler.js");
    const stat = fs.statSync(handlerPath);
    const changed = fs
      .readFileSync(handlerPath, "utf8")
      .replace("digest-marker-a", "digest-marker-b");
    fs.writeFileSync(handlerPath, changed, "utf8");
    fs.utimesSync(handlerPath, stat.atime, stat.mtime);

    expect(() =>
      loader.materializeSkill(skill, { loadedBecause: "run_skill" }),
    ).toThrow(
      expect.objectContaining({
        code: "CC_SKILL_DIGEST_DRIFT",
        previousDigest: skill.executionIdentity.contentDigest,
      }),
    );
  });

  it("fails closed when digest reauthorization rejects or throws", () => {
    for (const { reauthorizeSkill, expectedCode } of [
      {
        reauthorizeSkill: vi.fn(() => false),
        expectedCode: "CC_SKILL_DIGEST_DRIFT",
      },
      {
        reauthorizeSkill: vi.fn(() => {
          throw new Error("trust store unavailable");
        }),
        expectedCode: "CC_SKILL_REAUTHORIZE_FAILED",
      },
    ]) {
      const fixture = createSkill({ isolation: true });
      const { loader, skill } = discover(fixture, { reauthorizeSkill });
      fs.appendFileSync(
        path.join(fixture.skillDir, "handler.js"),
        "// drift\n",
      );

      expect(() =>
        loader.materializeSkill(skill, { loadedBecause: "run_skill" }),
      ).toThrow(
        expect.objectContaining({
          code: expectedCode,
        }),
      );
    }
  });

  it("accepts explicit synchronous reauthorization without exposing source bytes", () => {
    const fixture = createSkill({ isolation: true, body: "# Version one" });
    const reauthorizeSkill = vi.fn(() => ({ authorized: true }));
    const { loader, skill } = discover(fixture, { reauthorizeSkill });
    const previousDigest = skill.executionIdentity.contentDigest;
    fs.appendFileSync(path.join(fixture.skillDir, "handler.js"), "// v2\n");

    const materialized = loader.materializeSkill(skill, {
      loadedBecause: "run_skill",
      sessionId: "session-1",
      turnId: 2,
    });

    expect(materialized.body).toContain("Version one");
    expect(materialized.executionIdentity.contentDigest).not.toBe(
      previousDigest,
    );
    expect(materialized.executionAuthority).toMatchObject({
      mode: "controlled-agent-tools",
      directHandlerAllowed: false,
    });
    expect(reauthorizeSkill).toHaveBeenCalledWith(
      expect.objectContaining({
        previousDigest,
        currentDigest: materialized.executionIdentity.contentDigest,
        sessionId: "session-1",
        turnId: 2,
      }),
    );
    expect(JSON.stringify(reauthorizeSkill.mock.calls)).not.toContain(
      "handler-secret-a",
    );
  });

  it("awaits an async host reauthorization and rechecks the exact digest", async () => {
    const fixture = createSkill({ isolation: true, body: "# Async approval" });
    const reauthorizeSkill = vi.fn(async () => {
      await Promise.resolve();
      return { authorized: true };
    });
    const { loader, skill } = discover(fixture, { reauthorizeSkill });

    const materialized = await loader.materializeSkillForExecution(skill, {
      loadedBecause: "run_skill",
      sessionId: "ide-session",
      turnId: "turn-1",
    });

    expect(materialized.body).toContain("Async approval");
    expect(reauthorizeSkill).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "first-use",
        sessionId: "ide-session",
        turnId: "turn-1",
      }),
    );
    expect(materialized.executionAuthority.mode).toBe("controlled-agent-tools");
  });

  it("does not trust the user-writable managed/global layer by default", async () => {
    const fixture = createSkill({ isolation: true, body: "# Global custom" });
    const loader = new CLISkillLoader({ contextLedger: null });
    const [skill] = loader._loadFromDir(fixture.root, "managed");

    await expect(
      loader.materializeSkillForExecution(skill, {
        loadedBecause: "run_skill",
      }),
    ).rejects.toMatchObject({ code: "CC_SKILL_TRUST_REQUIRED" });
  });

  it("does not let the synchronous API accidentally accept an async decision", () => {
    const fixture = createSkill({ isolation: true });
    const { loader, skill } = discover(fixture, {
      reauthorizeSkill: async () => true,
    });

    expect(() =>
      loader.materializeSkill(skill, { loadedBecause: "run_skill" }),
    ).toThrow(expect.objectContaining({ code: "CC_SKILL_REAUTHORIZE_FAILED" }));
  });

  it("re-parses isolation after reauthorization and never reuses stale authority", () => {
    const fixture = createSkill({ isolation: true });
    const { loader, skill } = discover(fixture, {
      reauthorizeSkill: () => true,
    });
    const skillMd = path.join(fixture.skillDir, "SKILL.md");
    fs.writeFileSync(
      skillMd,
      fs
        .readFileSync(skillMd, "utf8")
        .replace("isolation: true", "isolation: false"),
      "utf8",
    );

    expect(() =>
      loader.materializeSkill(skill, { loadedBecause: "run_skill" }),
    ).toThrow(
      expect.objectContaining({ code: "CC_SKILL_DIRECT_HANDLER_BLOCKED" }),
    );
    expect(skill.isolation).toBe(false);
    expect(skill.executionAuthority.mode).toBe("blocked-direct-handler");
  });

  it("blocks a non-isolated handler before it can be imported", () => {
    const fixture = createSkill({
      handlerBody: `
globalThis.__skillHandlerImported = true;
export default { async execute() { return { success: true }; } };
`,
    });
    const { loader, skill } = discover(fixture);

    expect(() =>
      loader.materializeSkill(skill, { loadedBecause: "run_skill" }),
    ).toThrow(
      expect.objectContaining({ code: "CC_SKILL_DIRECT_HANDLER_BLOCKED" }),
    );
    expect(globalThis.__skillHandlerImported).toBeUndefined();
  });

  it("keeps agent-core's legacy direct-import branch unreachable with the production loader", async () => {
    const fixture = createSkill({
      handlerBody: `
globalThis.__skillHandlerImported = true;
export default { async execute() { return { success: true }; } };
`,
    });
    const { loader } = discover(fixture);
    loader._cache = loader._loadFromDir(fixture.root, "workspace");
    const { executeTool } = await import("../../src/runtime/agent-core.js");

    const result = await executeTool(
      "run_skill",
      { skill_name: fixture.name, input: "do not import" },
      { cwd: fixture.root, skillLoader: loader },
    );

    expect(result.error).toMatch(/cannot execute handler\.js directly/i);
    expect(globalThis.__skillHandlerImported).toBeUndefined();
  });

  it("blocks the direct CLI transport even for an isolated skill", () => {
    const fixture = createSkill({ isolation: true });
    const { loader, skill } = discover(fixture);

    expect(() =>
      loader.materializeSkill(skill, { loadedBecause: "cli_skill_run" }),
    ).toThrow(
      expect.objectContaining({ code: "CC_SKILL_DIRECT_HANDLER_BLOCKED" }),
    );
  });

  it("treats a changed frontmatter name as an identity change after reauthorization", () => {
    const fixture = createSkill({ isolation: true });
    const { loader, skill } = discover(fixture, {
      reauthorizeSkill: () => true,
    });
    const skillMd = path.join(fixture.skillDir, "SKILL.md");
    fs.writeFileSync(
      skillMd,
      fs
        .readFileSync(skillMd, "utf8")
        .replace(`name: ${fixture.name}`, "name: replacement-name"),
      "utf8",
    );

    expect(() =>
      loader.materializeSkill(skill, { loadedBecause: "run_skill" }),
    ).toThrow(expect.objectContaining({ code: "CC_SKILL_IDENTITY_CHANGED" }));
  });

  it("captures the same authority classification without loader state", () => {
    const fixture = createSkill({ isolation: true });
    const snapshot = captureSkillExecutionSnapshot({
      skillDir: fixture.skillDir,
      skillId: fixture.name,
      source: "workspace",
    });
    expect(snapshot.contentDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(
      describeSkillExecutionAuthority({
        hasHandler: snapshot.handlerPresent,
        isolation: true,
      }),
    ).toMatchObject({ mode: "controlled-agent-tools" });
  });
});

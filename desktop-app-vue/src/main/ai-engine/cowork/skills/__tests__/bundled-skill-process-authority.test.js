import nativeFs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  createBundledSkillProcessAuthorityFactory,
  createDesktopProcessExecutionAdapter,
  minimalEnvironment,
} = require("../bundled-skill-process-authority.js");
const { SkillRegistry } = require("../skill-registry.js");

const roots = [];

function temporaryRoot(label) {
  const root = nativeFs.mkdtempSync(path.join(os.tmpdir(), `${label}-`));
  roots.push(root);
  return root;
}

function createReviewedSkill(skillId, execute) {
  const skill = new EventEmitter();
  Object.assign(skill, {
    skillId,
    name: skillId,
    source: "bundled",
    config: { enabled: true },
    _executionSecurity: {
      packageOwned: true,
      bundledCapabilityMigrated: true,
    },
    executeWithMetrics: execute,
  });
  return skill;
}

afterEach(() => {
  while (roots.length > 0) {
    nativeFs.rmSync(roots.pop(), { recursive: true, force: true });
  }
});

describe("production bundled Skill process authority", () => {
  it("routes execution through DesktopProcessBroker with a minimal environment", () => {
    const desktopExecute = vi.fn(() => "main\n");
    const adapter = createDesktopProcessExecutionAdapter({
      execFileSyncWithDesktopBroker: desktopExecute,
      runtimeEnvironment: {
        PATH: "trusted-path",
        HOME: "trusted-home",
        OPENAI_API_KEY: "must-not-leak",
      },
    });
    const request = Object.freeze({
      skillId: "create-pr",
      authorityId: "approval:process",
      file: "git",
      args: Object.freeze(["rev-parse", "--abbrev-ref", "HEAD"]),
      cwd: process.cwd(),
      timeout: 10_000,
      encoding: "utf8",
      maxBuffer: 1024,
    });

    expect(adapter(request)).toBe("main\n");
    expect(desktopExecute).toHaveBeenCalledWith(
      "git",
      ["rev-parse", "--abbrev-ref", "HEAD"],
      expect.objectContaining({
        shell: false,
        windowsHide: true,
        env: { PATH: "trusted-path", HOME: "trusted-home" },
        origin: "skill:create-pr",
      }),
    );
    expect(JSON.stringify(desktopExecute.mock.calls)).not.toContain(
      "must-not-leak",
    );
    expect(minimalEnvironment({ SECRET: "no" })).toEqual({});
  });

  it("requires host approval and constrains cwd and argv", async () => {
    const workspace = temporaryRoot("cc-process-workspace");
    const outside = temporaryRoot("cc-process-outside");
    const executeFileSync = vi.fn(() => "main\n");
    const factory = createBundledSkillProcessAuthorityFactory({
      workspacePath: workspace,
      executeFileSync,
      auditSink: () => {},
    });

    await expect(
      factory({
        skillId: "create-pr",
        executionDecision: { approved: true, policyAuthorized: false },
      }),
    ).rejects.toMatchObject({
      code: "CC_BUNDLED_SKILL_PROCESS_APPROVAL_REQUIRED",
    });
    await expect(
      factory({
        skillId: "create-pr",
        context: { projectRoot: outside },
        executionDecision: {
          approved: true,
          policyAuthorized: true,
          authorityId: "approval:outside",
        },
      }),
    ).rejects.toMatchObject({
      code: "CC_BUNDLED_SKILL_PROCESS_CWD_DENIED",
    });

    const authority = await factory({
      skillId: "create-pr",
      context: { projectRoot: workspace },
      executionDecision: {
        approved: true,
        policyAuthorized: true,
        authorityId: "approval:process",
      },
    });
    expect(
      authority.processBroker.execFileSync(
        "git",
        ["rev-parse", "--abbrev-ref", "HEAD"],
        { cwd: workspace },
      ),
    ).toBe("main\n");
    expect(() =>
      authority.processBroker.execFileSync("git", ["reset", "--hard"], {
        cwd: workspace,
      }),
    ).toThrow(/not approved/i);
    expect(executeFileSync).toHaveBeenCalledOnce();
  });

  it("does not synthesize dynamic invocation grants", async () => {
    const workspace = temporaryRoot("cc-process-dynamic");
    const authority = await createBundledSkillProcessAuthorityFactory({
      workspacePath: workspace,
      executeFileSync: vi.fn(() => "ok"),
      auditSink: () => {},
    })({
      skillId: "performance-profiler",
      executionDecision: {
        approved: true,
        policyAuthorized: true,
        authorityId: "approval:dynamic",
      },
    });

    expect(() =>
      authority.processBroker.execFileSync("npm", ["run", "arbitrary"], {
        cwd: workspace,
      }),
    ).toThrow(/not approved/i);
  });

  it("overrides renderer process objects at the registry boundary", async () => {
    const workspace = temporaryRoot("cc-process-registry");
    const registry = new SkillRegistry({
      autoLoad: false,
      executionAuthorizer: async () => ({ approved: true }),
      bundledSkillProcessAuthorityFactory:
        createBundledSkillProcessAuthorityFactory({
          workspacePath: workspace,
          executeFileSync: () => "main\n",
          auditSink: () => {},
        }),
    });
    const rendererBroker = { execFileSync: vi.fn(() => "forged") };
    const execute = vi.fn(async (_task, context) =>
      context.processBroker.execFileSync(
        "git",
        ["rev-parse", "--abbrev-ref", "HEAD"],
        { cwd: context.projectRoot },
      ),
    );
    registry.register(createReviewedSkill("create-pr", execute));

    await expect(
      registry.executeSkill(
        "create-pr",
        {},
        { projectRoot: workspace, processBroker: rendererBroker },
      ),
    ).resolves.toBe("main\n");
    expect(rendererBroker.execFileSync).not.toHaveBeenCalled();
  });

  it("fails closed when production process wiring has no host policy", async () => {
    const workspace = temporaryRoot("cc-process-no-policy");
    const registry = new SkillRegistry({
      autoLoad: false,
      bundledSkillProcessAuthorityFactory:
        createBundledSkillProcessAuthorityFactory({
          workspacePath: workspace,
          executeFileSync: vi.fn(),
          auditSink: () => {},
        }),
    });
    const execute = vi.fn();
    registry.register(createReviewedSkill("create-pr", execute));

    await expect(registry.executeSkill("create-pr", {})).rejects.toMatchObject({
      code: "CC_BUNDLED_SKILL_PROCESS_APPROVAL_REQUIRED",
    });
    expect(execute).not.toHaveBeenCalled();
  });
});

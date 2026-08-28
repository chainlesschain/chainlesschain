import nativeFs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  createBundledSkillFilesystemAuthorityFactory,
} = require("../bundled-skill-filesystem-authority.js");
const {
  BUNDLED_SKILL_CAPABILITY_CATALOG,
} = require("../bundled-skill-capability-catalog.js");
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
    canHandle: () => 100,
  });
  return skill;
}

afterEach(() => {
  while (roots.length > 0) {
    nativeFs.rmSync(roots.pop(), { recursive: true, force: true });
  }
});

describe("production bundled Skill filesystem authority", () => {
  it("publishes exact audited operations and reviewed root classes", () => {
    expect(
      BUNDLED_SKILL_CAPABILITY_CATALOG["api-design"].filesystemOperations,
    ).toEqual(["readFileSync"]);
    expect(
      BUNDLED_SKILL_CAPABILITY_CATALOG["api-design"].filesystemRoots,
    ).toEqual(["workspace"]);
    expect(
      BUNDLED_SKILL_CAPABILITY_CATALOG["code-runner"].filesystemRoots,
    ).toEqual(["workspace", "skill-temporary"]);
    expect(
      BUNDLED_SKILL_CAPABILITY_CATALOG.brainstorming.filesystemOperations,
    ).toEqual([]);
  });

  it("requires a host approval and enforces catalog operations and workspace containment", async () => {
    const workspace = temporaryRoot("cc-production-fs-workspace");
    const outside = temporaryRoot("cc-production-fs-outside");
    const insideFile = path.join(workspace, "inside.txt");
    const outsideFile = path.join(outside, "outside.txt");
    nativeFs.writeFileSync(insideFile, "inside");
    nativeFs.writeFileSync(outsideFile, "outside");
    const factory = createBundledSkillFilesystemAuthorityFactory({
      workspacePath: workspace,
      auditSink: () => {},
    });

    await expect(
      factory({ skillId: "api-design", executionDecision: null }),
    ).rejects.toMatchObject({
      code: "CC_BUNDLED_SKILL_FILESYSTEM_APPROVAL_REQUIRED",
    });

    const authority = await factory({
      skillId: "api-design",
      context: { projectRoot: workspace },
      executionDecision: {
        approved: true,
        policyAuthorized: true,
        authorityId: "approval:test",
      },
    });
    expect(
      authority.filesystem.invoke("readFileSync", [insideFile, "utf8"]),
    ).toBe("inside");
    expect(() =>
      authority.filesystem.invoke("writeFileSync", [insideFile, "changed"]),
    ).toThrow(/not approved/i);
    expect(() =>
      authority.filesystem.invoke("readFileSync", [outsideFile, "utf8"]),
    ).toThrow(/outside approved roots/i);
  });

  it("gives code-runner only its host-owned Skill temp directory", async () => {
    const workspace = temporaryRoot("cc-production-fs-workspace");
    const temporary = temporaryRoot("cc-production-fs-temp");
    const factory = createBundledSkillFilesystemAuthorityFactory({
      workspacePath: workspace,
      temporaryRoot: temporary,
      auditSink: () => {},
    });
    const authority = await factory({
      skillId: "code-runner",
      context: { projectRoot: workspace },
      executionDecision: { approved: true, policyAuthorized: true },
    });

    expect(authority.filesystemTempRoot).toBe(
      nativeFs.realpathSync(
        path.join(temporary, "chainlesschain-bundled-skills", "code-runner"),
      ),
    );
    const runDirectory = authority.filesystem.invoke("mkdtempSync", [
      path.join(authority.filesystemTempRoot, "cc-code-runner-"),
    ]);
    const script = path.join(runDirectory, "snippet.js");
    authority.filesystem.invoke("writeFileSync", [script, "safe", "utf8"]);
    expect(nativeFs.readFileSync(script, "utf8")).toBe("safe");
  });

  it("injects and overrides authority at the registry boundary", async () => {
    const workspace = temporaryRoot("cc-production-fs-registry");
    const input = path.join(workspace, "input.txt");
    nativeFs.writeFileSync(input, "trusted");
    const authorizer = vi.fn().mockResolvedValue({ approved: true });
    const factory = createBundledSkillFilesystemAuthorityFactory({
      workspacePath: workspace,
      auditSink: () => {},
    });
    const registry = new SkillRegistry({
      autoLoad: false,
      executionAuthorizer: authorizer,
      bundledSkillFilesystemAuthorityFactory: factory,
    });
    const rendererBroker = { invoke: vi.fn(() => "forged") };
    const execute = vi.fn(async (_task, context) => ({
      content: context.host.filesystem.invoke("readFileSync", [input, "utf8"]),
      context,
    }));
    registry.register(createReviewedSkill("api-design", execute));

    const result = await registry.executeSkill(
      "api-design",
      { input: "read" },
      {
        projectRoot: workspace,
        host: { filesystem: rendererBroker },
      },
    );

    expect(result.content).toBe("trusted");
    expect(rendererBroker.invoke).not.toHaveBeenCalled();
    expect(result.context.projectRoot).toBe(nativeFs.realpathSync(workspace));
    expect(authorizer).toHaveBeenCalledOnce();
  });

  it("prevents execution when the centralized host policy denies it", async () => {
    const registry = new SkillRegistry({
      autoLoad: false,
      executionAuthorizer: async () => ({
        approved: false,
        reason: "policy denied",
      }),
    });
    const execute = vi.fn();
    registry.register(createReviewedSkill("api-design", execute));

    await expect(registry.executeSkill("api-design", {})).rejects.toMatchObject(
      {
        code: "CC_SKILL_EXECUTION_PREVENTED",
        prevented: true,
      },
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it("fails closed when production filesystem wiring has no host policy", async () => {
    const workspace = temporaryRoot("cc-production-fs-no-policy");
    const registry = new SkillRegistry({
      autoLoad: false,
      bundledSkillFilesystemAuthorityFactory:
        createBundledSkillFilesystemAuthorityFactory({
          workspacePath: workspace,
          auditSink: () => {},
        }),
    });
    const execute = vi.fn();
    registry.register(createReviewedSkill("api-design", execute));

    await expect(registry.executeSkill("api-design", {})).rejects.toMatchObject(
      {
        code: "CC_BUNDLED_SKILL_FILESYSTEM_APPROVAL_REQUIRED",
      },
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it("does not grant package authority to an overriding external Skill", async () => {
    const workspace = temporaryRoot("cc-production-fs-external");
    const registry = new SkillRegistry({
      autoLoad: false,
      bundledSkillFilesystemAuthorityFactory:
        createBundledSkillFilesystemAuthorityFactory({
          workspacePath: workspace,
          auditSink: () => {},
        }),
    });
    const external = createReviewedSkill("api-design", async (_task, context) =>
      context.host.filesystem.invoke(),
    );
    external.source = "workspace";
    const rendererBroker = { invoke: vi.fn(() => "renderer-only") };
    registry.register(external);

    await expect(
      registry.executeSkill(
        "api-design",
        {},
        { host: { filesystem: rendererBroker } },
      ),
    ).resolves.toBe("renderer-only");
    expect(rendererBroker.invoke).toHaveBeenCalledOnce();
  });
});

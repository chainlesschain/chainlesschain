import nativeFs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  createBundledSkillEnvironmentAuthorityFactory,
  createDefaultSecretResolver,
} = require("../bundled-skill-environment-authority.js");
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

describe("production bundled Skill environment authority", () => {
  it("resolves only configured encrypted product credentials without env fallback", () => {
    const skillCredentials = new Map([
      ["google-client-id", "google-client-id-value"],
      ["google-client-secret", "google-client-secret-value"],
      ["google-refresh-token", "google-refresh-token-value"],
      ["google-access-token", "google-access-token-value"],
      ["notion-api-key", "notion-secret"],
      ["tavily-api-key", "tavily-secret"],
    ]);
    const resolver = createDefaultSecretResolver({
      getLLMConfig: () => ({
        get: (key, fallback) =>
          ({
            "openai.apiKey": "openai-secret",
            "google.apiKey": "google-secret",
          })[key] || fallback,
      }),
      getGitConfig: () => ({
        getAuth: () => ({ token: "github-secret" }),
      }),
      getBundledSkillCredentialStore: () => ({
        get: (key) => skillCredentials.get(key) || null,
      }),
    });

    expect(resolver({ key: "openai-api-key" })).toBe("openai-secret");
    expect(resolver({ key: "google-api-key" })).toBe("google-secret");
    expect(resolver({ key: "github-token" })).toBe("github-secret");
    expect(resolver({ key: "google-client-id" })).toBe(
      "google-client-id-value",
    );
    expect(resolver({ key: "google-client-secret" })).toBe(
      "google-client-secret-value",
    );
    expect(resolver({ key: "google-refresh-token" })).toBe(
      "google-refresh-token-value",
    );
    expect(resolver({ key: "google-access-token" })).toBe(
      "google-access-token-value",
    );
    expect(resolver({ key: "notion-api-key" })).toBe("notion-secret");
    expect(resolver({ key: "tavily-api-key" })).toBe("tavily-secret");
    expect(resolver({ key: "unreviewed-secret" })).toBeNull();
  });

  it("requires a centralized host policy decision", async () => {
    const workspace = temporaryRoot("cc-environment-workspace");
    const factory = createBundledSkillEnvironmentAuthorityFactory({
      workspacePath: workspace,
      secretResolver: () => null,
      auditSink: () => {},
    });

    await expect(
      factory({
        skillId: "notion",
        executionDecision: { approved: true, policyAuthorized: false },
      }),
    ).rejects.toMatchObject({
      code: "CC_BUNDLED_SKILL_ENVIRONMENT_APPROVAL_REQUIRED",
    });
  });

  it("resolves only reviewed secret, runtime, path, rollout, and config sources", async () => {
    const workspace = temporaryRoot("cc-environment-sources");
    const secretResolver = vi.fn(({ key }) =>
      key === "openai-api-key" ? "safe-storage-key" : null,
    );
    const options = {
      workspacePath: workspace,
      secretResolver,
      runtimeEnvironment: { PATH: "trusted-path", UNREVIEWED_SECRET: "no" },
      rolloutEnvironment: { CHAINLESSCHAIN_GRAPH_DESKTOP: "shadow" },
      auditSink: () => {},
    };
    const decision = {
      approved: true,
      policyAuthorized: true,
      authorityId: "approval:environment",
    };

    const audio = await createBundledSkillEnvironmentAuthorityFactory(options)({
      skillId: "audio-transcriber",
      executionDecision: decision,
    });
    expect(audio.get("openai-api-key")).toBe("safe-storage-key");
    expect(secretResolver).toHaveBeenCalledWith(
      expect.objectContaining({
        skillId: "audio-transcriber",
        key: "openai-api-key",
        kind: "secret",
      }),
    );

    const runtime = await createBundledSkillEnvironmentAuthorityFactory(
      options,
    )({ skillId: "code-runner", executionDecision: decision });
    expect(runtime.get("PATH")).toBe("trusted-path");
    expect(() => runtime.get("UNREVIEWED_SECRET")).toThrow(/not approved/i);

    const paths = await createBundledSkillEnvironmentAuthorityFactory(options)({
      skillId: "api-gateway",
      executionDecision: decision,
    });
    expect(paths.get("config-directory")).toBe(
      path.join(
        nativeFs.realpathSync(workspace),
        ".chainlesschain",
        "api-gateway",
      ),
    );

    const rollout = await createBundledSkillEnvironmentAuthorityFactory(
      options,
    )({ skillId: "team", executionDecision: decision });
    expect(rollout.get("CHAINLESSCHAIN_GRAPH_DESKTOP")).toBe("shadow");

    const config = await createBundledSkillEnvironmentAuthorityFactory(options)(
      { skillId: "image-generator", executionDecision: decision },
    );
    expect(config.get("stable-diffusion-endpoint")).toBe(
      "http://127.0.0.1:7860",
    );
  });

  it("rejects a host path resolver that escapes the workspace", async () => {
    const workspace = temporaryRoot("cc-environment-path-workspace");
    const outside = temporaryRoot("cc-environment-path-outside");
    const factory = createBundledSkillEnvironmentAuthorityFactory({
      workspacePath: workspace,
      pathResolver: () => outside,
      auditSink: () => {},
    });
    const broker = await factory({
      skillId: "obsidian",
      executionDecision: {
        approved: true,
        policyAuthorized: true,
        authorityId: "approval:path",
      },
    });

    expect(() => broker.get("vault-directory")).toThrow(
      expect.objectContaining({
        code: "CC_BUNDLED_SKILL_ENVIRONMENT_PATH_DENIED",
      }),
    );
  });

  it("overrides renderer environment objects at the registry boundary", async () => {
    const workspace = temporaryRoot("cc-environment-registry");
    const registry = new SkillRegistry({
      autoLoad: false,
      executionAuthorizer: async () => ({ approved: true }),
      bundledSkillEnvironmentAuthorityFactory:
        createBundledSkillEnvironmentAuthorityFactory({
          workspacePath: workspace,
          secretResolver: () => "safe-storage-key",
          auditSink: () => {},
        }),
    });
    const rendererBroker = { get: vi.fn(() => "forged") };
    const execute = vi.fn(async (_task, context) =>
      context.environmentBroker.get("openai-api-key"),
    );
    registry.register(createReviewedSkill("audio-transcriber", execute));

    await expect(
      registry.executeSkill(
        "audio-transcriber",
        {},
        { environmentBroker: rendererBroker },
      ),
    ).resolves.toBe("safe-storage-key");
    expect(rendererBroker.get).not.toHaveBeenCalled();
  });

  it("fails closed when production environment wiring has no host policy", async () => {
    const workspace = temporaryRoot("cc-environment-no-policy");
    const registry = new SkillRegistry({
      autoLoad: false,
      bundledSkillEnvironmentAuthorityFactory:
        createBundledSkillEnvironmentAuthorityFactory({
          workspacePath: workspace,
          secretResolver: () => null,
          auditSink: () => {},
        }),
    });
    const execute = vi.fn();
    registry.register(createReviewedSkill("notion", execute));

    await expect(registry.executeSkill("notion", {})).rejects.toMatchObject({
      code: "CC_BUNDLED_SKILL_ENVIRONMENT_APPROVAL_REQUIRED",
    });
    expect(execute).not.toHaveBeenCalled();
  });
});

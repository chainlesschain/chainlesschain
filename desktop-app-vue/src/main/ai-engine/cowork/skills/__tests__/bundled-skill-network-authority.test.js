import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  createBundledSkillNetworkAuthorityFactory,
  deriveApprovedDomains,
  parseNetworkDiagnosticsPolicy,
} = require("../bundled-skill-network-authority.js");
const {
  requireBundledSkillRuntimeNetworkBroker,
} = require("../bundled-skill-egress-broker.js");
const {
  requireBundledSkillLocalServiceBroker,
} = require("../bundled-skill-local-service-broker.js");
const {
  requireBundledSkillNetworkDiagnosticsBroker,
} = require("../bundled-skill-network-diagnostics-broker.js");
const { SkillRegistry } = require("../skill-registry.js");

const APPROVAL = Object.freeze({
  approved: true,
  policyAuthorized: true,
  authorityId: "approval:network",
});

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

describe("production bundled Skill network authority", () => {
  it("derives only exact HTTPS domains from the approved task", () => {
    expect(
      deriveApprovedDomains({
        input:
          "GET https://api.example.com/v1 and http://ignored.example.net plus https://api.example.com/v2",
        nested: { url: "https://docs.example.org/page" },
      }),
    ).toEqual(["api.example.com", "docs.example.org"]);
  });

  it("derives exact diagnostics operations, targets, ports, and DNS types", () => {
    expect(
      parseNetworkDiagnosticsPolicy({ input: "--dns example.com --type mx" }),
    ).toEqual({
      allowedTargets: ["example.com"],
      allowedOperations: ["dns"],
      allowedDnsTypes: ["MX"],
      allowedPorts: [],
    });
    expect(
      parseNetworkDiagnosticsPolicy({
        input: "--ports example.com --range 443-445",
      }),
    ).toEqual({
      allowedTargets: ["example.com"],
      allowedOperations: ["port"],
      allowedDnsTypes: [],
      allowedPorts: [443, 444, 445],
    });
    expect(parseNetworkDiagnosticsPolicy({ input: "--ip" })).toBeNull();
  });

  it("requires host approval before creating fixed or dynamic egress", async () => {
    const factory = createBundledSkillNetworkAuthorityFactory();
    await expect(
      factory({
        skillId: "weather",
        task: {},
        executionDecision: { approved: true, policyAuthorized: false },
      }),
    ).rejects.toMatchObject({
      code: "CC_BUNDLED_SKILL_NETWORK_APPROVAL_REQUIRED",
    });

    const fixed = await factory({
      skillId: "weather",
      task: {},
      executionDecision: APPROVAL,
    });
    expect(
      requireBundledSkillRuntimeNetworkBroker(
        { networkBroker: fixed.networkBroker },
        "weather",
      ),
    ).toBe(fixed.networkBroker);

    const dynamic = await factory({
      skillId: "http-client",
      task: { input: "--get https://api.example.com/v1" },
      executionDecision: APPROVAL,
    });
    expect(
      requireBundledSkillRuntimeNetworkBroker(
        { networkBroker: dynamic.networkBroker },
        "http-client",
      ),
    ).toBe(dynamic.networkBroker);
    await expect(
      dynamic.networkBroker.request({ url: "https://other.example.com/" }),
    ).rejects.toMatchObject({
      code: "CC_BUNDLED_SKILL_EGRESS_DOMAIN_DENIED",
    });
  });

  it("leaves runtime egress unavailable when the approved task has no HTTPS target", async () => {
    const authority = await createBundledSkillNetworkAuthorityFactory()({
      skillId: "http-client",
      task: { input: "help" },
      executionDecision: APPROVAL,
    });
    expect(authority.networkBroker).toBeNull();
  });

  it("creates only reviewed loopback and diagnostics authorities", async () => {
    const factory = createBundledSkillNetworkAuthorityFactory({
      diagnosticsDependencies: {
        createResolver: () => ({ resolve: vi.fn().mockResolvedValue([]) }),
      },
    });
    const local = await factory({
      skillId: "image-generator",
      task: {},
      executionDecision: APPROVAL,
    });
    expect(
      requireBundledSkillLocalServiceBroker(
        { localServiceBroker: local.localServiceBroker },
        "image-generator",
        "stable-diffusion",
      ),
    ).toBe(local.localServiceBroker);

    const diagnostics = await factory({
      skillId: "network-diagnostics",
      task: { input: "--dns example.com --type A" },
      executionDecision: APPROVAL,
    });
    const broker = requireBundledSkillNetworkDiagnosticsBroker({
      networkDiagnosticsBroker: diagnostics.networkDiagnosticsBroker,
    });
    await expect(
      broker.resolveDns({ target: "other.example.com", type: "A" }),
    ).rejects.toMatchObject({
      code: "CC_BUNDLED_SKILL_DIAGNOSTICS_TARGET_DENIED",
    });
  });

  it("overrides renderer network objects at the registry boundary", async () => {
    const registry = new SkillRegistry({
      autoLoad: false,
      executionAuthorizer: async () => ({ approved: true }),
      bundledSkillNetworkAuthorityFactory:
        createBundledSkillNetworkAuthorityFactory(),
    });
    const rendererBroker = { request: vi.fn() };
    const execute = vi.fn(async (_task, context) => ({
      replaced: context.networkBroker !== rendererBroker,
      local: context.localServiceBroker,
      diagnostics: context.networkDiagnosticsBroker,
    }));
    registry.register(createReviewedSkill("weather", execute));

    await expect(
      registry.executeSkill("weather", {}, { networkBroker: rendererBroker }),
    ).resolves.toEqual({ replaced: true, local: null, diagnostics: null });
  });

  it("fails closed when production network wiring has no host policy", async () => {
    const registry = new SkillRegistry({
      autoLoad: false,
      bundledSkillNetworkAuthorityFactory:
        createBundledSkillNetworkAuthorityFactory(),
    });
    const execute = vi.fn();
    registry.register(createReviewedSkill("weather", execute));

    await expect(registry.executeSkill("weather", {})).rejects.toMatchObject({
      code: "CC_BUNDLED_SKILL_NETWORK_APPROVAL_REQUIRED",
    });
    expect(execute).not.toHaveBeenCalled();
  });
});

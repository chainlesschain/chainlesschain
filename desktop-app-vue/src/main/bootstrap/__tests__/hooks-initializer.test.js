import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const protocol = require("@chainlesschain/session-core/evolvable-artifact");
const { destroyHookSystem } = require("../../hooks");
const { registerHooksInitializer } = require("../hooks-initializer.js");

function registeredInitializer() {
  const factory = { register: vi.fn() };
  registerHooksInitializer(factory);
  return factory.register.mock.calls[0][0];
}

function activeReader() {
  const allow = () => ({ decision: "allow", policyRevision: "hook-policy-v1" });
  const authority = protocol.createEvolvableArtifactAuthority({
    tenantId: "tenant-a",
    policy: protocol.createEvolvableArtifactPolicy({
      type: protocol.ARTIFACT_TYPE.HOOK,
      revision: "hook-policy-v1",
      admission: allow,
      evaluator: allow,
      activation: allow,
      rollback: allow,
    }),
  });
  const releaseGate = protocol.createEvolvableArtifactReleaseGate({
    authority,
    transitionWriter: { async commitTransition() {} },
    transitionReader: { async readTransition() {} },
  });
  return protocol.createEvolvableArtifactActiveReleaseReader({
    releaseGate,
    provider: {
      async listActive() {
        return [];
      },
      async readActive() {
        return null;
      },
    },
  });
}

describe("Hook bootstrap governance", () => {
  beforeEach(() => {
    destroyHookSystem();
  });

  it("does not auto-load legacy config when no active release reader exists", async () => {
    const initializer = registeredInitializer();
    const hookSystem = await initializer.init({});

    expect(hookSystem.artifactActiveReleaseReader).toBeNull();
    expect(hookSystem.options.autoLoadConfig).toBe(false);
  });

  it("passes the governed Hook active release reader into startup", async () => {
    const reader = activeReader();
    const initializer = registeredInitializer();
    const hookSystem = await initializer.init({
      evolvableArtifactHookActiveReleaseReader: reader,
    });

    expect(hookSystem.artifactActiveReleaseReader).toBe(reader);
    expect(hookSystem.options.autoLoadConfig).toBe(true);
  });
});

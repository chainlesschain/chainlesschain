import { beforeEach, describe, expect, it, vi } from "vitest";

const handlers = new Map();
const testIpcMain = {
  handle: vi.fn((channel, handler) => handlers.set(channel, handler)),
};

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel, handler) => handlers.set(channel, handler)),
  },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  default: {
    ipcMain: {
      handle: vi.fn((channel, handler) => handlers.set(channel, handler)),
    },
    BrowserWindow: { getAllWindows: vi.fn(() => []) },
  },
}));

vi.mock("../index", () => ({
  HookType: {
    COMMAND: "command",
    SCRIPT: "script",
  },
  getHookSystem: vi.fn(),
}));

const { registerHooksIPC } = require("../hooks-ipc");
const {
  ARTIFACT_TYPE,
  EVOLVABLE_ARTIFACT_PERSISTENCE_RECEIPT_SCHEMA,
  createEvolvableArtifactPolicy,
  createEvolvableArtifactAuthority,
  createEvolvableArtifactCandidateGate,
  digestEvolvableArtifactValue: digest,
} = require("@chainlesschain/session-core/evolvable-artifact");

function manifest(body) {
  return { ...body, digest: digest(body) };
}

function hookArtifactCandidate() {
  const dependencies = [];
  return {
    artifactId: "hook:lint-after-write",
    candidateId: "hook-candidate-1",
    parent: null,
    lineage: [],
    dependencyLock: {
      dependencies,
      digest: digest({ dependencies }),
    },
    runtimeManifest: manifest({
      executable: true,
      codeSignatureDigest: digest("code-signature"),
      sbomDigest: digest("sbom"),
      sandboxDigest: digest("sandbox"),
      networkEgressPolicyDigest: digest("network-egress-policy"),
    }),
    permissionManifest: manifest({ capabilities: ["process.spawn:eslint"] }),
  };
}

function hookGate() {
  const revision = "hook-policy-v1";
  const allow = () => ({ decision: "allow", policyRevision: revision });
  const authority = createEvolvableArtifactAuthority({
    tenantId: "tenant-a",
    policy: createEvolvableArtifactPolicy({
      type: ARTIFACT_TYPE.HOOK,
      revision,
      admission: allow,
      evaluator: allow,
      activation: allow,
      rollback: allow,
    }),
  });
  return createEvolvableArtifactCandidateGate({
    authority,
    candidateWriter: {
      async persistCandidate(artifact) {
        return {
          schema: EVOLVABLE_ARTIFACT_PERSISTENCE_RECEIPT_SCHEMA,
          tenantId: artifact.tenantId,
          type: artifact.type,
          artifactId: artifact.artifactId,
          candidateId: artifact.candidate.candidateId,
          contentDigest: artifact.contentDigest,
          artifactDigest: artifact.artifactDigest,
          status: "candidate",
          persisted: true,
        };
      },
    },
  });
}

function hookSystem() {
  return {
    listHooks: vi.fn(() => []),
    getHook: vi.fn(),
    getStats: vi.fn(() => ({})),
    getEventTypes: vi.fn(() => []),
    setHookEnabled: vi.fn(),
    setEnabled: vi.fn(),
    isEnabled: vi.fn(() => false),
    register: vi.fn(() => "legacy-active-hook"),
    unregister: vi.fn(),
    trigger: vi.fn(),
    reload: vi.fn(),
    cancelHook: vi.fn(),
    cancelAll: vi.fn(),
    on: vi.fn(),
  };
}

describe("Hooks IPC EvolvableArtifact boundary", () => {
  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
  });

  it("fails closed instead of registering an active executable without a gate", async () => {
    const system = hookSystem();
    registerHooksIPC({ hookSystem: system, ipcMain: testIpcMain });

    await expect(
      handlers.get("hooks:register")(null, {
        event: "PostToolUse",
        type: "command",
        command: "eslint .",
      }),
    ).rejects.toMatchObject({
      code: "CC_HOOK_EVOLUTION_CANDIDATE_GATE_UNAVAILABLE",
    });
    expect(system.register).not.toHaveBeenCalled();
  });

  it("stages command content as a candidate and never calls HookSystem.register", async () => {
    const system = hookSystem();
    registerHooksIPC({
      hookSystem: system,
      artifactCandidateGate: hookGate(),
      ipcMain: testIpcMain,
    });

    const result = await handlers.get("hooks:register")(null, {
      event: "PostToolUse",
      type: "command",
      command: "eslint .",
      artifactCandidate: hookArtifactCandidate(),
    });

    expect(result).toMatchObject({
      candidateId: "hook-candidate-1",
      lifecycle: "candidate",
      activeMutation: false,
    });
    expect(result.persistenceReceipt.persisted).toBe(true);
    expect(system.register).not.toHaveBeenCalled();
  });

  it("denies renderer activation and config reload while allowing disable", async () => {
    const system = hookSystem();
    registerHooksIPC({
      hookSystem: system,
      artifactCandidateGate: hookGate(),
      ipcMain: testIpcMain,
    });

    await expect(
      handlers.get("hooks:set-enabled")(null, { hookId: "h1", enabled: true }),
    ).rejects.toMatchObject({ code: "CC_HOOK_DIRECT_ACTIVATION_DENIED" });
    await expect(handlers.get("hooks:reload")()).rejects.toMatchObject({
      code: "CC_HOOK_DIRECT_ACTIVATION_DENIED",
    });
    await handlers.get("hooks:set-enabled")(null, {
      hookId: "h1",
      enabled: false,
    });
    expect(system.setHookEnabled).toHaveBeenCalledWith("h1", false);
    expect(system.reload).not.toHaveBeenCalled();
  });
});

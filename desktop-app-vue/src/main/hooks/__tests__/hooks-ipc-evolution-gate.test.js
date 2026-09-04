import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createHash,
  generateKeyPairSync,
  sign as signBytes,
} from "node:crypto";

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
  HOOK_EXECUTABLE_FORMAT,
  HOOK_EXECUTION_MANIFEST_SCHEMA,
} = require("../governed-hook-execution");
const {
  canonicalJson,
} = require("../../ai-engine/cowork/skills/skill-execution-security");
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

function signedHookInput() {
  const hookId = "hook:lint-after-write";
  const event = "PostToolUse";
  const source =
    "module.exports.execute = async () => ({ result: 'continue' });";
  const capabilities = ["process:spawn-eslint"];
  const runtimeBody = {
    executable: true,
    codeSignatureDigest: null,
    sbomDigest: digest("sbom"),
    sandboxDigest: digest("sandbox"),
    networkEgressPolicyDigest: digest("network-egress-policy"),
  };
  const signedManifest = {
    schema: HOOK_EXECUTION_MANIFEST_SCHEMA,
    hookId,
    event,
    runtime: "node-isolated",
    fileName: "hook.js",
    sourceBytes: Buffer.byteLength(source, "utf8"),
    sourceSha256: createHash("sha256").update(source).digest("hex"),
    capabilities,
    sbomDigest: runtimeBody.sbomDigest,
    sandboxDigest: runtimeBody.sandboxDigest,
    networkEgressPolicyDigest: runtimeBody.networkEgressPolicyDigest,
  };
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const signatureLock = {
    lockVersion: 1,
    algorithm: "ed25519",
    manifest: signedManifest,
    signatureBase64: signBytes(
      null,
      Buffer.from(canonicalJson(signedManifest), "utf8"),
      privateKey,
    ).toString("base64"),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }),
  };
  runtimeBody.codeSignatureDigest = digest(signatureLock);
  const dependencies = [];
  return {
    event,
    type: "script",
    script: {
      format: HOOK_EXECUTABLE_FORMAT,
      fileName: "hook.js",
      source,
      signatureLock,
    },
    artifactCandidate: {
      artifactId: hookId,
      candidateId: "hook-candidate-1",
      parent: null,
      lineage: [],
      dependencyLock: {
        dependencies,
        digest: digest({ dependencies }),
      },
      runtimeManifest: manifest(runtimeBody),
      permissionManifest: manifest({ capabilities }),
    },
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
        ...signedHookInput(),
      }),
    ).rejects.toMatchObject({
      code: "CC_HOOK_EVOLUTION_CANDIDATE_GATE_UNAVAILABLE",
    });
    expect(system.register).not.toHaveBeenCalled();
  });

  it("stages signed inline bytes as a candidate and never activates them", async () => {
    const system = hookSystem();
    registerHooksIPC({
      hookSystem: system,
      artifactCandidateGate: hookGate(),
      ipcMain: testIpcMain,
    });

    const result = await handlers.get("hooks:register")(
      null,
      signedHookInput(),
    );

    expect(result).toMatchObject({
      candidateId: "hook-candidate-1",
      lifecycle: "candidate",
      activeMutation: false,
    });
    expect(result.persistenceReceipt.persisted).toBe(true);
    expect(system.register).not.toHaveBeenCalled();
  });

  it("does not admit mutable shell commands as Hook candidates", async () => {
    const system = hookSystem();
    registerHooksIPC({
      hookSystem: system,
      artifactCandidateGate: hookGate(),
      ipcMain: testIpcMain,
    });

    await expect(
      handlers.get("hooks:register")(null, {
        event: "PostToolUse",
        type: "command",
        command: "eslint .",
        artifactCandidate: signedHookInput().artifactCandidate,
      }),
    ).rejects.toThrow("Only signed inline script hooks");
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

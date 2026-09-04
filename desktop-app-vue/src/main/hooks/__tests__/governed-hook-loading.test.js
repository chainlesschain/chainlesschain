/* global describe, expect, it */

const protocol = require("@chainlesschain/session-core/evolvable-artifact");
const { HookSystem, HookType } = require("../index");

const {
  ARTIFACT_TYPE,
  EVOLVABLE_ARTIFACT_ACTIVE_RELEASE_SCHEMA,
  createEvolvableArtifactActiveReleaseReader,
  createEvolvableArtifactAuthority,
  createEvolvableArtifactPolicy,
  createEvolvableArtifactReceipt,
  createEvolvableArtifactReleaseGate,
  digestEvolvableArtifactValue: digest,
} = protocol;

function manifest(body) {
  return { ...body, digest: digest(body) };
}

function receipt(artifact, kind, claims = {}) {
  return createEvolvableArtifactReceipt({
    kind,
    tenantId: artifact.tenantId,
    artifactId: artifact.artifactId,
    candidateId: artifact.candidate.candidateId,
    contentDigest: artifact.contentDigest,
    dependencyLockDigest: artifact.dependencyLock.digest,
    issuerId: `${kind}-authority`,
    issuerRevision: `${kind}-v1`,
    issuedAt: "2026-09-04T00:00:00.000Z",
    decision: "allow",
    claims,
  });
}

function createActiveHookReader(content) {
  const allow = () => ({ decision: "allow", policyRevision: "hook-policy-v1" });
  const authority = createEvolvableArtifactAuthority({
    tenantId: "tenant-a",
    policy: createEvolvableArtifactPolicy({
      type: ARTIFACT_TYPE.HOOK,
      revision: "hook-policy-v1",
      admission: allow,
      evaluator: allow,
      activation: allow,
      rollback: allow,
    }),
  });
  const dependencyLock = { dependencies: [] };
  dependencyLock.digest = digest(dependencyLock);
  let artifact = authority.stageCandidate({
    tenantId: "tenant-a",
    artifactId: "governed-command-hook",
    candidateId: "governed-command-hook-candidate",
    type: ARTIFACT_TYPE.HOOK,
    contentDigest: digest(content),
    parent: null,
    lineage: [digest(content)],
    dependencyLock,
    runtimeManifest: manifest({
      executable: true,
      codeSignatureDigest: digest("hook-signature"),
      sbomDigest: digest("hook-sbom"),
      sandboxDigest: digest("hook-sandbox"),
      networkEgressPolicyDigest: digest("hook-network"),
    }),
    permissionManifest: manifest({ capabilities: [] }),
  });
  artifact = authority.recordEvaluation(artifact, receipt(artifact, "eval"));
  artifact = authority.activateCandidate(artifact, {
    reviewReceipt: receipt(artifact, "review", {
      riskTier: "high",
      approvers: [
        { identityId: "alice", signatureDigest: digest("alice-signature") },
        { identityId: "bob", signatureDigest: digest("bob-signature") },
      ],
    }),
    promotionReceipt: receipt(artifact, "promotion"),
    releaseId: "governed-command-hook-release",
  });
  const active = {
    schema: EVOLVABLE_ARTIFACT_ACTIVE_RELEASE_SCHEMA,
    authenticated: true,
    durable: true,
    tenantId: artifact.tenantId,
    type: artifact.type,
    artifactId: artifact.artifactId,
    releaseId: artifact.activeReleaseId,
    contentDigest: artifact.contentDigest,
    artifactDigest: artifact.artifactDigest,
    artifact,
    contentAvailable: true,
    content,
  };
  const releaseGate = createEvolvableArtifactReleaseGate({
    authority,
    transitionWriter: { async commitTransition() {} },
    transitionReader: { async readTransition() {} },
  });
  return createEvolvableArtifactActiveReleaseReader({
    releaseGate,
    provider: {
      async listActive() {
        return [active];
      },
      async readActive() {
        return active;
      },
    },
  });
}

describe("governed Hook loading", () => {
  it("keeps config auto-load disabled by default and installs builtins", async () => {
    const hookSystem = new HookSystem();
    const stringOptionHookSystem = new HookSystem({ autoLoadConfig: "true" });
    await hookSystem.initialize();

    expect(hookSystem.options.autoLoadConfig).toBe(false);
    expect(stringOptionHookSystem.options.autoLoadConfig).toBe(false);
    expect(
      hookSystem.listHooks().some((hook) => hook.name.startsWith("builtin:")),
    ).toBe(true);
    hookSystem.clear();
  });

  it("rejects unbranded readers and config auto-load without a reader", () => {
    expect(() => new HookSystem({ artifactActiveReleaseReader: {} })).toThrow(
      /branded Hook active release reader/,
    );
    expect(() => new HookSystem({ autoLoadConfig: true })).toThrowError(
      expect.objectContaining({
        code: "CC_HOOK_ACTIVE_RELEASE_READER_UNAVAILABLE",
      }),
    );
  });

  it("loads only exact active command content with governed release metadata", async () => {
    const content = {
      event: "PreToolUse",
      type: HookType.COMMAND,
      command: "echo governed",
      script: null,
      matcher: null,
      priority: 500,
      timeout: 1000,
      environmentAllowlist: [],
      envAllowlist: [],
    };
    const hookSystem = new HookSystem({
      artifactActiveReleaseReader: createActiveHookReader(content),
      autoLoadConfig: true,
    });
    await hookSystem.initialize();

    const hook = hookSystem
      .listHooks()
      .find((value) => value.id === "governed-command-hook");
    expect(hook).toMatchObject({
      command: "echo governed",
      enabled: true,
      metadata: {
        governed: true,
        releaseId: "governed-command-hook-release",
        contentDigest: digest(content),
      },
    });
    hookSystem.clear();
  });

  it("rejects script-path releases and direct executable registration", async () => {
    const script = {
      event: "PreToolUse",
      type: HookType.SCRIPT,
      command: null,
      script: "unbound-script.js",
      matcher: null,
      priority: 500,
      timeout: 1000,
      environmentAllowlist: [],
      envAllowlist: [],
    };
    const hookSystem = new HookSystem({
      artifactActiveReleaseReader: createActiveHookReader(script),
      autoLoadConfig: true,
    });

    await expect(hookSystem.initialize()).rejects.toThrow(
      "Active Hook release content is unsafe",
    );
    expect(() =>
      hookSystem.register({
        event: "PreToolUse",
        type: HookType.COMMAND,
        command: "echo bypass",
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "CC_HOOK_DIRECT_EXECUTABLE_REGISTRATION_DENIED",
      }),
    );
    await expect(
      hookSystem._loadScriptHooks("legacy-hooks"),
    ).rejects.toThrowError(
      expect.objectContaining({ code: "CC_HOOK_DIRECT_SCRIPT_LOAD_DENIED" }),
    );
    hookSystem.clear();
  });
});

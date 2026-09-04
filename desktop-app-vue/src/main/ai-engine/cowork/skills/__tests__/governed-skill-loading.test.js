import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  createHash,
  generateKeyPairSync,
  sign as signBytes,
} from "node:crypto";

vi.mock("../../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const protocol = require("@chainlesschain/session-core/evolvable-artifact");
const { SkillRegistry } = require("../skill-registry");
const {
  SKILL_PACKAGE_FORMAT,
  calculateSkillPackageChecksum,
} = require("../skill-sync-manager");
const {
  MANIFEST_SCHEMA,
  canonicalJson,
} = require("../skill-execution-security");
const {
  captureGovernedSkillHandlerSource,
} = require("../governed-skill-execution");

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

function receipt(artifact, kind) {
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
  });
}

function skillPackage({ executable = false } = {}) {
  const body = `---
name: governed-docs
description: Governed documentation skill
version: 1.0.0
category: governed
handler: ${executable ? "./handler.js" : ""}
executionCapabilities: ${executable ? "[host:process]" : "[]"}
---

# Governed Skill

Use exact active instructions.`;
  const pkg = {
    format: SKILL_PACKAGE_FORMAT,
    metadata: { skillId: "governed-docs", version: "1.0.0" },
    body,
    handler: executable ? "module.exports = async () => ({ ok: true });" : null,
    signatureLock: null,
    checksum: "",
    exportedAt: 1_788_451_200_000,
    exportedFrom: "device-a",
  };
  if (executable) {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const signedManifest = {
      schema: MANIFEST_SCHEMA,
      skillId: "governed-docs",
      version: "1.0.0",
      handler: "handler.js",
      executionCapabilities: ["host:process"],
      files: [
        {
          path: "SKILL.md",
          bytes: Buffer.byteLength(body, "utf8"),
          sha256: createHash("sha256").update(body).digest("hex"),
        },
        {
          path: "handler.js",
          bytes: Buffer.byteLength(pkg.handler, "utf8"),
          sha256: createHash("sha256").update(pkg.handler).digest("hex"),
        },
      ],
    };
    pkg.signatureLock = {
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
  }
  pkg.checksum = calculateSkillPackageChecksum(pkg);
  return pkg;
}

function activeReader(pkg, { state = null } = {}) {
  const revision = "skill-policy-v1";
  const allow = () => ({ decision: "allow", policyRevision: revision });
  const authority = createEvolvableArtifactAuthority({
    tenantId: "tenant-a",
    policy: createEvolvableArtifactPolicy({
      type: ARTIFACT_TYPE.SKILL,
      revision,
      admission: allow,
      evaluator: allow,
      activation: allow,
      rollback: allow,
    }),
  });
  const dependencies = [];
  const runtimeBody = {
    executable: pkg.handler !== null,
    handlerDigest: pkg.handler === null ? null : digest(pkg.handler),
    signatureLockDigest:
      pkg.signatureLock === null ? null : digest(pkg.signatureLock),
    requires: { bins: [], env: [] },
  };
  let artifact = authority.stageCandidate({
    tenantId: "tenant-a",
    artifactId: `skill:${pkg.metadata.skillId}`,
    candidateId: digest(pkg),
    type: ARTIFACT_TYPE.SKILL,
    contentDigest: digest(pkg),
    parent: null,
    lineage: [digest(pkg)],
    dependencyLock: {
      dependencies,
      digest: digest({ dependencies }),
    },
    runtimeManifest: manifest(runtimeBody),
    permissionManifest: manifest({
      capabilities: pkg.handler === null ? [] : ["host:process"],
    }),
  });
  artifact = authority.recordEvaluation(artifact, receipt(artifact, "eval"));
  artifact = authority.activateCandidate(artifact, {
    reviewReceipt: receipt(artifact, "review"),
    promotionReceipt: receipt(artifact, "promotion"),
    releaseId: "governed-docs-release-1",
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
    content: pkg,
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
        if (state?.error) throw new Error("active reader failed");
        if (state?.empty) return [];
        return [active];
      },
      async readActive({ artifactId }) {
        return artifactId === active.artifactId ? active : null;
      },
    },
  });
}

describe("governed Skill loading", () => {
  it("rejects unbranded active release readers", () => {
    expect(
      () =>
        new SkillRegistry({
          autoLoad: false,
          artifactActiveReleaseReader: { type: ARTIFACT_TYPE.SKILL },
        }),
    ).toThrow(/branded Skill active release reader/);
  });

  it("loads exact non-executable content from an active Skill release", async () => {
    const registry = new SkillRegistry({
      autoLoad: false,
      artifactActiveReleaseReader: activeReader(skillPackage()),
    });

    await expect(registry.loadGovernedActiveSkills()).resolves.toEqual({
      loaded: 1,
      registered: 1,
      authority: "governed-active-release-reader",
    });
    const skill = registry.getSkill("governed-docs");
    expect(skill).toMatchObject({
      skillId: "governed-docs",
      source: "governed",
      instructions: "",
    });
    expect(skill.definition.body).toContain("Use exact active instructions");
    expect(skill.definition._governedRelease).toMatchObject({
      releaseId: "governed-docs-release-1",
      contentDigest: digest(skillPackage()),
    });
  });

  it("executes signed active package bytes through the isolated runner", async () => {
    const executor = vi.fn(async () => ({ success: true, isolated: true }));
    const pkg = skillPackage({ executable: true });
    const registry = new SkillRegistry({
      autoLoad: false,
      artifactActiveReleaseReader: activeReader(pkg),
      governedSkillExecutor: executor,
    });

    await expect(registry.loadGovernedActiveSkills()).resolves.toMatchObject({
      loaded: 1,
      registered: 1,
    });
    await expect(
      registry.getSkill("governed-docs").execute({ operation: "test" }),
    ).resolves.toEqual({ success: true, isolated: true });
    expect(executor).toHaveBeenCalledWith(
      expect.objectContaining({
        skillId: "governed-docs",
        source: "governed",
        handlerFileName: "handler.js",
        handlerSource: pkg.handler,
        contentDigest: digest(pkg).slice(7),
        executionCapabilities: ["host:process"],
      }),
    );
    const authority =
      registry.getSkill("governed-docs")._governedExecutionAuthority;
    expect(captureGovernedSkillHandlerSource(authority)).toBe(pkg.handler);
    expect(() => captureGovernedSkillHandlerSource({ ...authority })).toThrow(
      "governed Skill execution authority",
    );
  });

  it("unloads the previous governed Skill when replacement content is unsafe", async () => {
    const registry = new SkillRegistry({
      autoLoad: false,
      artifactActiveReleaseReader: activeReader(skillPackage()),
    });
    await registry.loadGovernedActiveSkills();
    const unsafe = skillPackage({ executable: true });
    unsafe.signatureLock.signatureBase64 = Buffer.alloc(64).toString("base64");
    unsafe.checksum = calculateSkillPackageChecksum(unsafe);
    registry._governedSkillExecutor = vi.fn();
    registry.setArtifactActiveReleaseReader(activeReader(unsafe));

    await expect(registry.loadGovernedActiveSkills()).rejects.toThrow(
      "signature verification failed",
    );
    expect(registry.getSkill("governed-docs")).toBeUndefined();
  });

  it("unloads a governed Skill when it is no longer active", async () => {
    const state = { empty: false };
    const registry = new SkillRegistry({
      autoLoad: false,
      artifactActiveReleaseReader: activeReader(skillPackage(), { state }),
    });
    await registry.loadGovernedActiveSkills();
    state.empty = true;

    await registry.loadGovernedActiveSkills();
    expect(registry.getSkill("governed-docs")).toBeUndefined();
  });

  it("fails closed by unloading governed Skills when refresh fails", async () => {
    const state = { error: false };
    const registry = new SkillRegistry({
      autoLoad: false,
      artifactActiveReleaseReader: activeReader(skillPackage(), { state }),
    });
    await registry.loadGovernedActiveSkills();
    state.error = true;

    await expect(registry.loadGovernedActiveSkills()).rejects.toThrow(
      "active reader failed",
    );
    expect(registry.getSkill("governed-docs")).toBeUndefined();
  });

  it("uses only the bundled filesystem layer before governed releases", async () => {
    const registry = new SkillRegistry({ autoLoad: false });
    const loader = {
      on: vi.fn(),
      loadBundledOnly: vi.fn().mockResolvedValue({
        loaded: 0,
        skipped: 0,
        errors: [],
      }),
      loadAll: vi.fn(),
      createSkillInstances: vi.fn(() => []),
    };
    registry.setLoader(loader);

    await expect(registry.loadAllSkills()).resolves.toMatchObject({
      loaded: 0,
      registered: 0,
      activeAuthority: "unavailable",
    });
    expect(loader.loadBundledOnly).toHaveBeenCalledOnce();
    expect(loader.loadAll).not.toHaveBeenCalled();
  });

  it("does not hot-load marketplace SKILL.md bytes after installation", () => {
    const installerSource = readFileSync(
      require.resolve("../../../../marketplace/plugin-installer.js"),
      "utf8",
    );

    expect(installerSource).not.toContain(".hotLoadSkill(");
    expect(installerSource).toContain("governed promotion is required");
  });
});

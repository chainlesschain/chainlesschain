import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const secureFsMocks = vi.hoisted(() => ({
  ensurePrivateDirectory: vi.fn(),
  ensurePrivateFile: vi.fn(),
}));

vi.mock("../../src/lib/secure-fs.js", () => secureFsMocks);

import {
  SKILL_CANDIDATE_MAX_CONTENT_BYTES,
  SKILL_CANDIDATE_MIGRATION_REQUIRED_CODE,
  SKILL_CANDIDATE_SCHEMA,
  SKILL_CANDIDATE_STORE_LIMIT_CODE,
  SKILL_CANDIDATE_TARGET_MATRIX_ADMISSION_AUTHORITY_SCHEMA,
  SKILL_CANDIDATE_TARGET_MATRIX_ADMISSION_RESOLUTION_SCHEMA,
  SKILL_CANDIDATE_TENANT_SCAN_MAX_BYTES,
  SKILL_CANDIDATE_TENANT_SCAN_MAX_ENTRIES,
  SKILL_CANDIDATE_TENANT_SCAN_MAX_NODES,
  SKILL_CANDIDATE_TENANT_MARKER_SCHEMA,
  SkillCandidateRegistry,
  buildSkillCandidateDraft,
  deriveSkillCandidateTenantKey,
  verifySkillCandidateDraft,
} from "../../src/lib/evolution/skill-candidate-registry.js";
import {
  buildSkillDependencyLock,
  buildSkillRuntimeManifest,
  buildSkillTargetMatrix,
} from "../../src/lib/evolution/skill-execution-manifest.js";

const TENANT_ALPHA = "tenant:alpha";
const TENANT_BETA = "tenant:beta";
const EVIDENCE_DIGEST = `sha256:${"1".repeat(64)}`;
const CANDIDATE_FILE_PATTERN_FOR_TEST = /^[a-f0-9]{64}\.json$/u;

function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function executionFixture(
  tenantId = TENANT_ALPHA,
  { generation = 3, cliRuntime = "node-22.12.0" } = {},
) {
  const dependencyLock = buildSkillDependencyLock({
    tenantId,
    lock: {
      generation,
      packages: { vitest: "4.1.10", zod: "4.0.0" },
    },
  });
  const runtimeManifest = buildSkillRuntimeManifest({
    tenantId,
    runtimes: [
      {
        runtimeId: "desktop",
        descriptor: {
          platform: "win32-x64",
          runtime: "electron-39",
          sandboxPolicyDigest: sha256("sandbox:desktop"),
        },
      },
      {
        runtimeId: "cli",
        descriptor: {
          platform: "linux-x64",
          runtime: cliRuntime,
          sandboxPolicyDigest: sha256("sandbox:cli"),
        },
      },
    ],
  });
  const cells = [
    {
      cellId: "desktop-win32-x64",
      runtimeId: "desktop",
      targetEnvironmentRef: "environment:desktop-win32-x64",
      environmentDigest: sha256("environment:desktop-win32-x64"),
    },
    {
      cellId: "cli-linux-x64",
      runtimeId: "cli",
      targetEnvironmentRef: "environment:cli-linux-x64",
      environmentDigest: sha256("environment:cli-linux-x64"),
    },
    {
      cellId: "cli-linux-arm64",
      runtimeId: "cli",
      targetEnvironmentRef: "environment:cli-linux-arm64",
      environmentDigest: sha256("environment:cli-linux-arm64"),
    },
  ];
  const targetMatrix = buildSkillTargetMatrix({
    tenantId,
    dependencyLock,
    runtimeManifest,
    cells,
  });
  return {
    dependencyLock,
    runtimeManifest,
    targetMatrix,
    context: {
      expectedEnvironmentBindings: cells.map((cell) => ({ ...cell })),
      expectedTargetMatrixRoot: targetMatrix.targetMatrixRoot,
    },
  };
}

function createAdmissionHarness(executions = []) {
  const records = new Map();
  const descriptor = {
    schema: SKILL_CANDIDATE_TARGET_MATRIX_ADMISSION_AUTHORITY_SCHEMA,
    authorityId: "authority:target-matrix-admission",
    trust: "trusted",
    revision: 7,
    handlerArtifactDigest: sha256("handler:target-matrix-admission:v7"),
  };
  const keyFor = (request) =>
    [
      request.tenantId,
      request.skillName,
      request.dependencyLockDigest,
      request.runtimeManifestDigest,
      request.proposedTargetMatrixRoot,
    ].join("\0");
  const harness = {
    admit(execution, skillName = "repair-unit-tests") {
      records.set(
        keyFor({
          tenantId: execution.dependencyLock.tenantId,
          skillName,
          dependencyLockDigest: execution.dependencyLock.dependencyLockDigest,
          runtimeManifestDigest:
            execution.runtimeManifest.runtimeManifestDigest,
          proposedTargetMatrixRoot: execution.targetMatrix.targetMatrixRoot,
        }),
        {
          expectedEnvironmentBindings:
            execution.context.expectedEnvironmentBindings.map((cell) => ({
              ...cell,
            })),
          expectedTargetMatrixRoot: execution.context.expectedTargetMatrixRoot,
        },
      );
      return harness;
    },
  };
  harness.authority = {
    ...descriptor,
    resolve(request) {
      const context = records.get(keyFor(request));
      if (!context) return false;
      return {
        schema: SKILL_CANDIDATE_TARGET_MATRIX_ADMISSION_RESOLUTION_SCHEMA,
        admitted: true,
        authorityId: descriptor.authorityId,
        trust: descriptor.trust,
        revision: descriptor.revision,
        handlerArtifactDigest: descriptor.handlerArtifactDigest,
        tenantId: request.tenantId,
        skillName: request.skillName,
        dependencyLockDigest: request.dependencyLockDigest,
        runtimeManifestDigest: request.runtimeManifestDigest,
        expectedEnvironmentBindings: context.expectedEnvironmentBindings.map(
          (cell) => ({ ...cell }),
        ),
        expectedTargetMatrixRoot: context.expectedTargetMatrixRoot,
      };
    },
  };
  executions.forEach((execution) => harness.admit(execution));
  return harness;
}

function registryOptions(tenantId, executions = [], overrides = {}) {
  return {
    tenantId,
    targetMatrixAdmissionAuthority:
      createAdmissionHarness(executions).authority,
    ...overrides,
  };
}

function draftInput(execution, overrides = {}) {
  return {
    tenantId: execution.dependencyLock.tenantId,
    skillName: "repair-unit-tests",
    parentDigest: null,
    sourceEvidenceRefs: [
      {
        ref: "recording://runs/run-1",
        digest: EVIDENCE_DIGEST,
      },
    ],
    derivationMode: "record-replay",
    wikiRevision: null,
    proposerModel: null,
    requestedCapabilities: ["workspace.write", "workspace.read"],
    evalRunId: null,
    content: "---\nname: repair-unit-tests\n---\n\nRun the focused tests.\n",
    dependencyLock: execution.dependencyLock,
    runtimeManifest: execution.runtimeManifest,
    targetMatrix: execution.targetMatrix,
    ...overrides,
  };
}

function artifactPath(registry, candidateId) {
  return path.join(
    registry.rootDir,
    `${candidateId.slice("sha256:".length)}.json`,
  );
}

function markerPath(registry) {
  return path.join(registry.rootDir, "_tenant.json");
}

function capturedError(callback) {
  try {
    callback();
  } catch (error) {
    return error;
  }
  throw new Error("expected callback to throw");
}

function jsonNodeCount(root) {
  const stack = [root];
  let count = 0;
  while (stack.length > 0) {
    const value = stack.pop();
    count += 1;
    if (value !== null && typeof value === "object") {
      stack.push(...(Array.isArray(value) ? value : Object.values(value)));
    }
  }
  return count;
}

function repeatedTenantEntriesFs(rootDir, candidateName, repetitions) {
  const fsImpl = Object.create(fs);
  let tenantReadCount = 0;
  fsImpl.opendirSync = (target, options) => {
    if (path.resolve(target) === path.resolve(rootDir)) {
      let index = 0;
      return {
        readSync() {
          if (index > repetitions) return null;
          tenantReadCount += 1;
          const name = index === 0 ? "_tenant.json" : candidateName;
          index += 1;
          return { name };
        },
        closeSync() {},
      };
    }
    return fs.opendirSync(target, options);
  };
  return { fsImpl, tenantReadCount: () => tenantReadCount };
}

describe("SkillCandidateRegistry tenant-scoped v2", () => {
  let tempRoot;
  let registryBase;

  beforeEach(() => {
    secureFsMocks.ensurePrivateDirectory.mockClear();
    secureFsMocks.ensurePrivateFile.mockClear();
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cc-skill-candidates-"));
    registryBase = path.join(tempRoot, "registry", "candidates");
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("builds deterministic immutable v2 candidates with complete execution artifacts", () => {
    const execution = executionFixture();
    const evidence = [
      {
        ref: "wiki://patterns/z-last",
        digest: `sha256:${"2".repeat(64)}`,
      },
      {
        ref: "recording://runs/run-1",
        digest: EVIDENCE_DIGEST,
      },
    ];
    const first = buildSkillCandidateDraft(
      draftInput(execution, { sourceEvidenceRefs: evidence }),
      execution.context,
    );
    const second = buildSkillCandidateDraft(
      draftInput(execution, {
        sourceEvidenceRefs: [...evidence].reverse(),
        requestedCapabilities: ["workspace.read", "workspace.write"],
      }),
      {
        expectedEnvironmentBindings: [
          ...execution.context.expectedEnvironmentBindings,
        ].reverse(),
        expectedTargetMatrixRoot: execution.context.expectedTargetMatrixRoot,
      },
    );

    expect(first.schema).toBe(SKILL_CANDIDATE_SCHEMA);
    expect(first.tenantId).toBe(TENANT_ALPHA);
    expect(first.status).toBe("draft");
    expect(first.candidateId).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(first.contentDigest).toBe(sha256(first.content));
    expect(first.dependencyLock).toEqual(execution.dependencyLock);
    expect(first.runtimeManifest).toEqual(execution.runtimeManifest);
    expect(first.targetMatrix).toEqual(execution.targetMatrix);
    expect(first.dependencyLockDigest).toBe(
      execution.dependencyLock.dependencyLockDigest,
    );
    expect(first.runtimeManifestDigest).toBe(
      execution.runtimeManifest.runtimeManifestDigest,
    );
    expect(first.targetMatrixRoot).toBe(
      execution.targetMatrix.targetMatrixRoot,
    );
    expect(first.targetRuntimes).toEqual(["cli", "desktop"]);
    expect(first.requestedCapabilities).toEqual([
      "workspace.read",
      "workspace.write",
    ]);
    expect(second.candidateId).toBe(first.candidateId);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.dependencyLock.lock)).toBe(true);
    expect(Object.isFrozen(first.runtimeManifest.runtimes)).toBe(true);
    expect(Object.isFrozen(first.targetMatrix.cells)).toBe(true);
    expect(verifySkillCandidateDraft(first)).toEqual(first);

    expect(() =>
      buildSkillCandidateDraft(
        {
          ...draftInput(execution),
          targetRuntimes: ["attacker-selected"],
        },
        execution.context,
      ),
    ).toThrow(/required supported fields|unsupported/u);
  });

  it("rejects secret and PII plaintext before any candidate artifact is written", () => {
    const execution = executionFixture();
    const registry = new SkillCandidateRegistry(
      registryOptions(TENANT_ALPHA, [execution], {
        rootDir: registryBase,
        secure: false,
      }),
    );
    const unsafeContents = [
      "---\nname: repair-unit-tests\n---\npassword=superSecretValue123\n",
      "---\nname: repair-unit-tests\n---\nContact owner@example.com\n",
      "---\nname: repair-unit-tests\n---\nｐａｓｓｗｏｒｄ=confusableSecretValue123\n",
    ];

    for (const content of unsafeContents) {
      const error = capturedError(() =>
        registry.create(draftInput(execution, { content })),
      );
      expect(error).toMatchObject({ code: "SKILL_CANDIDATE_SECRET_LEAK" });
    }
    expect(registry.list()).toEqual([]);
  });

  it("requires explicit tenant construction and rejects tenant or context ambiguity", () => {
    const execution = executionFixture();
    expect(
      capturedError(
        () =>
          new SkillCandidateRegistry({ rootDir: registryBase, secure: false }),
      ).code,
    ).toBe("SKILL_CANDIDATE_INVALID");
    expect(() =>
      buildSkillCandidateDraft(
        draftInput(execution, { tenantId: TENANT_BETA }),
        execution.context,
      ),
    ).toThrow(/same tenant/u);
    expect(() => buildSkillCandidateDraft(draftInput(execution))).toThrow(
      /admission context/u,
    );
  });

  it("captures one immutable admission authority and rejects caller self-admission", () => {
    const trustedExecution = executionFixture();
    const substitutedExecution = executionFixture(TENANT_ALPHA, {
      generation: 88,
      cliRuntime: "node-24.1.0",
    });
    const harness = createAdmissionHarness([trustedExecution]);
    const registry = new SkillCandidateRegistry({
      tenantId: TENANT_ALPHA,
      rootDir: registryBase,
      secure: false,
      targetMatrixAdmissionAuthority: harness.authority,
    });

    expect(() =>
      registry.create(draftInput(trustedExecution), trustedExecution.context),
    ).toThrow(/registry-owned/u);
    expect(() => registry.create(draftInput(substitutedExecution))).toThrow(
      /did not synchronously admit/u,
    );
    expect(() => {
      harness.authority.resolve = () => ({ admitted: true });
    }).toThrow(TypeError);
    expect(registry.create(draftInput(trustedExecution)).created).toBe(true);

    const descriptorMismatchHarness = createAdmissionHarness([
      trustedExecution,
    ]);
    const resolveTrusted = descriptorMismatchHarness.authority.resolve;
    descriptorMismatchHarness.authority.resolve = (request) => ({
      ...resolveTrusted(request),
      revision: 8,
    });
    const descriptorMismatch = new SkillCandidateRegistry({
      tenantId: TENANT_ALPHA,
      rootDir: path.join(tempRoot, "descriptor-mismatch"),
      secure: false,
      targetMatrixAdmissionAuthority: descriptorMismatchHarness.authority,
    });
    expect(() =>
      descriptorMismatch.create(draftInput(trustedExecution)),
    ).toThrow(/not exactly bound/u);

    const aliasAuthority = {
      ...createAdmissionHarness().authority,
      resolve(request) {
        return {
          schema: SKILL_CANDIDATE_TARGET_MATRIX_ADMISSION_RESOLUTION_SCHEMA,
          admitted: true,
          authorityId: this.authorityId,
          trust: this.trust,
          revision: this.revision,
          handlerArtifactDigest: this.handlerArtifactDigest,
          tenantId: request.tenantId,
          skillName: request.skillName,
          dependencyLockDigest: request.dependencyLockDigest,
          runtimeManifestDigest: request.runtimeManifestDigest,
          expectedEnvironmentBindings: trustedExecution.targetMatrix.cells,
          expectedTargetMatrixRoot: request.proposedTargetMatrixRoot,
        };
      },
    };
    const aliasRegistry = new SkillCandidateRegistry({
      tenantId: TENANT_ALPHA,
      rootDir: path.join(tempRoot, "alias-admission"),
      secure: false,
      targetMatrixAdmissionAuthority: aliasAuthority,
    });
    expect(() => aliasRegistry.create(draftInput(trustedExecution))).toThrow(
      /not exactly bound/u,
    );

    const thenableAuthority = {
      ...createAdmissionHarness().authority,
      resolve() {
        return Promise.resolve(false);
      },
    };
    const thenableRegistry = new SkillCandidateRegistry({
      tenantId: TENANT_ALPHA,
      rootDir: path.join(tempRoot, "thenable-admission"),
      secure: false,
      targetMatrixAdmissionAuthority: thenableAuthority,
    });
    expect(() => thenableRegistry.create(draftInput(trustedExecution))).toThrow(
      /plain object/u,
    );
  });

  it("separates identical candidate content and storage across tenants", () => {
    const alphaExecution = executionFixture(TENANT_ALPHA);
    const betaExecution = executionFixture(TENANT_BETA);
    const alpha = buildSkillCandidateDraft(
      draftInput(alphaExecution),
      alphaExecution.context,
    );
    const beta = buildSkillCandidateDraft(
      draftInput(betaExecution),
      betaExecution.context,
    );
    const alphaRegistry = new SkillCandidateRegistry(
      registryOptions(TENANT_ALPHA, [alphaExecution], {
        rootDir: registryBase,
        secure: false,
      }),
    );
    const betaRegistry = new SkillCandidateRegistry(
      registryOptions(TENANT_BETA, [betaExecution], {
        rootDir: registryBase,
        secure: false,
      }),
    );

    expect(alpha.content).toBe(beta.content);
    expect(alpha.candidateId).not.toBe(beta.candidateId);
    expect(alphaRegistry.rootDir).toBe(
      path.join(
        fs.realpathSync.native(registryBase),
        "tenants",
        deriveSkillCandidateTenantKey(TENANT_ALPHA),
      ),
    );
    expect(betaRegistry.rootDir).not.toBe(alphaRegistry.rootDir);
    expect(alphaRegistry.create(draftInput(alphaExecution)).created).toBe(true);
    expect(betaRegistry.create(draftInput(betaExecution)).created).toBe(true);
    expect(alphaRegistry.list()).toEqual([alpha]);
    expect(betaRegistry.list()).toEqual([beta]);
    expect(() => alphaRegistry.create(draftInput(betaExecution))).toThrow(
      /registry tenant/u,
    );
  });

  it("rejects self-consistent manifest and matrix substitutions against trusted admission", () => {
    const trustedExecution = executionFixture();
    const substitutedExecution = executionFixture(TENANT_ALPHA, {
      generation: 99,
      cliRuntime: "node-24.0.0",
    });
    const trusted = buildSkillCandidateDraft(
      draftInput(trustedExecution),
      trustedExecution.context,
    );
    const substituted = buildSkillCandidateDraft(
      draftInput(substitutedExecution),
      substitutedExecution.context,
    );

    expect(() =>
      buildSkillCandidateDraft(
        draftInput(trustedExecution, {
          dependencyLock: substitutedExecution.dependencyLock,
          runtimeManifest: substitutedExecution.runtimeManifest,
          targetMatrix: substitutedExecution.targetMatrix,
        }),
        trustedExecution.context,
      ),
    ).toThrow(/execution artifacts/u);
    expect(substituted.candidateId).not.toBe(trusted.candidateId);

    const tampered = structuredClone(trusted);
    tampered.dependencyLock = structuredClone(substituted.dependencyLock);
    tampered.dependencyLockDigest = substituted.dependencyLockDigest;
    tampered.runtimeManifest = structuredClone(substituted.runtimeManifest);
    tampered.runtimeManifestDigest = substituted.runtimeManifestDigest;
    tampered.targetMatrix = structuredClone(substituted.targetMatrix);
    tampered.targetMatrixRoot = substituted.targetMatrixRoot;
    tampered.targetRuntimes = [...substituted.targetRuntimes];
    expect(() => verifySkillCandidateDraft(tampered)).toThrow(
      /digest verification/u,
    );
    expect(() =>
      verifySkillCandidateDraft(substituted, trustedExecution.context),
    ).toThrow(/execution artifacts/u);
  });

  it("enforces derivation provenance and evidence before artifact admission", () => {
    const execution = executionFixture();
    expect(() =>
      buildSkillCandidateDraft(
        draftInput(execution, { sourceEvidenceRefs: [] }),
        execution.context,
      ),
    ).toThrow(/at least one/u);
    expect(() =>
      buildSkillCandidateDraft(
        draftInput(execution, {
          sourceEvidenceRefs: [
            { ref: "../../secret", digest: EVIDENCE_DIGEST },
          ],
        }),
        execution.context,
      ),
    ).toThrow(/opaque URI/u);
    expect(() =>
      buildSkillCandidateDraft(
        draftInput(execution, { evalRunId: "eval-1" }),
        execution.context,
      ),
    ).toThrow(/cannot carry/u);
    expect(() =>
      buildSkillCandidateDraft(
        draftInput(execution, {
          derivationMode: "wiki",
          wikiRevision: null,
        }),
        execution.context,
      ),
    ).toThrow(/wiki-derived/u);

    const wikiDraft = buildSkillCandidateDraft(
      draftInput(execution, {
        derivationMode: "wiki",
        wikiRevision: "wiki://repository/revision-42",
        proposerModel: {
          provider: "google",
          model: "gemini-3.5-flash",
          version: "2026-08-27",
        },
      }),
      execution.context,
    );
    expect(wikiDraft.wikiRevision).toBe("wiki://repository/revision-42");
  });

  it("writes an exact tenant marker and reopens idempotently", () => {
    const execution = executionFixture();
    const firstRegistry = new SkillCandidateRegistry(
      registryOptions(TENANT_ALPHA, [execution], {
        rootDir: registryBase,
        secure: false,
      }),
    );
    const storedMarkerPath = markerPath(firstRegistry);
    const markerBefore = fs.statSync(storedMarkerPath);
    const markerBytes = fs.readFileSync(storedMarkerPath, "utf8");
    const marker = JSON.parse(markerBytes);
    const markerCore = {
      schema: marker.schema,
      component: marker.component,
      tenantId: marker.tenantId,
      tenantKey: marker.tenantKey,
    };
    const expectedMarkerDigest = `sha256:${crypto
      .createHash("sha256")
      .update("chainlesschain.skill-candidate-tenant-marker/v1\0", "utf8")
      .update(canonicalJson(markerCore), "utf8")
      .digest("hex")}`;

    expect(marker).toEqual({
      component: "skill-candidate-registry",
      markerDigest: expectedMarkerDigest,
      schema: SKILL_CANDIDATE_TENANT_MARKER_SCHEMA,
      tenantId: TENANT_ALPHA,
      tenantKey: deriveSkillCandidateTenantKey(TENANT_ALPHA),
    });
    expect(markerBytes).toBe(`${canonicalJson(marker)}\n`);
    const created = firstRegistry.create(draftInput(execution));
    const reopened = new SkillCandidateRegistry(
      registryOptions(TENANT_ALPHA, [execution], {
        rootDir: registryBase,
        secure: false,
      }),
    );
    const duplicate = reopened.create(draftInput(execution));

    expect(created.created).toBe(true);
    expect(duplicate.created).toBe(false);
    expect(reopened.rootDir).toBe(firstRegistry.rootDir);
    expect(fs.statSync(markerPath(reopened)).ino).toBe(markerBefore.ino);
    expect(reopened.read(created.candidate.candidateId)).toEqual(
      created.candidate,
    );
    expect(
      fs.readdirSync(reopened.rootDir).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);
  });

  it("fails closed when tenant roots or markers are swapped", () => {
    const alpha = new SkillCandidateRegistry(
      registryOptions(TENANT_ALPHA, [], {
        rootDir: registryBase,
        secure: false,
      }),
    );
    const beta = new SkillCandidateRegistry(
      registryOptions(TENANT_BETA, [], {
        rootDir: registryBase,
        secure: false,
      }),
    );
    const holding = path.join(path.dirname(alpha.rootDir), "holding-root");
    fs.renameSync(alpha.rootDir, holding);
    fs.renameSync(beta.rootDir, alpha.rootDir);
    fs.renameSync(holding, beta.rootDir);

    expect(capturedError(() => alpha.list()).code).toBe(
      "SKILL_CANDIDATE_STORE_UNSAFE",
    );
    expect(
      capturedError(
        () =>
          new SkillCandidateRegistry(
            registryOptions(TENANT_ALPHA, [], {
              rootDir: registryBase,
              secure: false,
            }),
          ),
      ).code,
    ).toBe("SKILL_CANDIDATE_STORE_UNSAFE");
  });

  it("rejects wrong, symlinked, and hard-linked tenant markers", () => {
    const alpha = new SkillCandidateRegistry(
      registryOptions(TENANT_ALPHA, [], {
        rootDir: registryBase,
        secure: false,
      }),
    );
    const beta = new SkillCandidateRegistry(
      registryOptions(TENANT_BETA, [], {
        rootDir: registryBase,
        secure: false,
      }),
    );
    fs.writeFileSync(markerPath(alpha), fs.readFileSync(markerPath(beta)));
    expect(capturedError(() => alpha.list()).code).toBe(
      "SKILL_CANDIDATE_STORE_UNSAFE",
    );

    const isolatedBase = path.join(tempRoot, "isolated-candidates");
    const isolated = new SkillCandidateRegistry(
      registryOptions(TENANT_ALPHA, [], {
        rootDir: isolatedBase,
        secure: false,
      }),
    );
    const outsideLink = path.join(tempRoot, "marker-hardlink.json");
    fs.linkSync(markerPath(isolated), outsideLink);
    expect(capturedError(() => isolated.list()).code).toBe(
      "SKILL_CANDIDATE_STORE_UNSAFE",
    );
    fs.unlinkSync(outsideLink);

    const outsideMarker = path.join(tempRoot, "outside-marker.json");
    fs.writeFileSync(outsideMarker, fs.readFileSync(markerPath(isolated)));
    fs.unlinkSync(markerPath(isolated));
    try {
      fs.symlinkSync(outsideMarker, markerPath(isolated), "file");
    } catch (error) {
      if (["EACCES", "EPERM"].includes(error?.code)) return;
      throw error;
    }
    expect(capturedError(() => isolated.list()).code).toBe(
      "SKILL_CANDIDATE_STORE_UNSAFE",
    );
  });

  it("rejects symlinked base and tenant directories before candidate writes", () => {
    const realBase = path.join(tempRoot, "real-base");
    const linkedBase = path.join(tempRoot, "linked-base");
    fs.mkdirSync(realBase);
    try {
      fs.symlinkSync(
        realBase,
        linkedBase,
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch (error) {
      if (["EACCES", "EPERM"].includes(error?.code)) return;
      throw error;
    }
    expect(
      capturedError(
        () =>
          new SkillCandidateRegistry(
            registryOptions(TENANT_ALPHA, [], {
              rootDir: linkedBase,
              secure: false,
            }),
          ),
      ).code,
    ).toBe("SKILL_CANDIDATE_STORE_UNSAFE");

    const scopedBase = path.join(tempRoot, "scoped-base");
    const tenants = path.join(scopedBase, "tenants");
    const outside = path.join(tempRoot, "outside-tenant-root");
    fs.mkdirSync(tenants, { recursive: true });
    fs.mkdirSync(outside);
    fs.symlinkSync(
      outside,
      path.join(tenants, deriveSkillCandidateTenantKey(TENANT_ALPHA)),
      process.platform === "win32" ? "junction" : "dir",
    );
    expect(
      capturedError(
        () =>
          new SkillCandidateRegistry(
            registryOptions(TENANT_ALPHA, [], {
              rootDir: scopedBase,
              secure: false,
            }),
          ),
      ).code,
    ).toBe("SKILL_CANDIDATE_STORE_UNSAFE");
  });

  it("fails closed when bounded streaming directory enumeration is unavailable", () => {
    const fsImpl = Object.create(fs);
    Object.defineProperty(fsImpl, "opendirSync", {
      configurable: true,
      value: undefined,
    });

    const error = capturedError(
      () =>
        new SkillCandidateRegistry(
          registryOptions(TENANT_ALPHA, [], {
            rootDir: registryBase,
            secure: false,
            fsImpl,
          }),
        ),
    );
    expect(error.code).toBe("SKILL_CANDIDATE_STORE_UNSAFE");
    expect(error.message).toMatch(/bounded synchronous directory/u);
  });

  it("requires explicit migration for legacy roots and mixed candidate schemas", () => {
    fs.mkdirSync(registryBase, { recursive: true });
    fs.writeFileSync(
      path.join(registryBase, `${"a".repeat(64)}.json`),
      '{"schema":"chainlesschain.skill-candidate/v1"}\n',
    );
    expect(
      capturedError(
        () =>
          new SkillCandidateRegistry(
            registryOptions(TENANT_ALPHA, [], {
              rootDir: registryBase,
              secure: false,
            }),
          ),
      ).code,
    ).toBe(SKILL_CANDIDATE_MIGRATION_REQUIRED_CODE);

    const unmarkedBase = path.join(tempRoot, "unmarked-base");
    const unmarkedRoot = path.join(
      unmarkedBase,
      "tenants",
      deriveSkillCandidateTenantKey(TENANT_ALPHA),
    );
    fs.mkdirSync(unmarkedRoot, { recursive: true });
    fs.writeFileSync(
      path.join(unmarkedRoot, `${"b".repeat(64)}.json`),
      '{"schema":"chainlesschain.skill-candidate/v1"}\n',
    );
    expect(
      capturedError(
        () =>
          new SkillCandidateRegistry(
            registryOptions(TENANT_ALPHA, [], {
              rootDir: unmarkedBase,
              secure: false,
            }),
          ),
      ).code,
    ).toBe(SKILL_CANDIDATE_MIGRATION_REQUIRED_CODE);

    const mixedBase = path.join(tempRoot, "mixed-base");
    const execution = executionFixture();
    const mixed = new SkillCandidateRegistry(
      registryOptions(TENANT_ALPHA, [execution], {
        rootDir: mixedBase,
        secure: false,
      }),
    );
    const legacyId = `sha256:${"c".repeat(64)}`;
    fs.writeFileSync(
      artifactPath(mixed, legacyId),
      '{"schema":"chainlesschain.skill-candidate/v1"}\n',
    );
    expect(capturedError(() => mixed.read(legacyId)).code).toBe(
      SKILL_CANDIDATE_MIGRATION_REQUIRED_CODE,
    );
    expect(capturedError(() => mixed.list()).code).toBe(
      SKILL_CANDIDATE_MIGRATION_REQUIRED_CODE,
    );
    const entriesBeforeReopen = fs.readdirSync(mixed.rootDir);
    expect(capturedError(() => mixed.create(draftInput(execution))).code).toBe(
      SKILL_CANDIDATE_MIGRATION_REQUIRED_CODE,
    );
    expect(fs.readdirSync(mixed.rootDir)).toEqual(entriesBeforeReopen);
    expect(
      capturedError(
        () =>
          new SkillCandidateRegistry(
            registryOptions(TENANT_ALPHA, [], {
              rootDir: mixedBase,
              secure: false,
            }),
          ),
      ).code,
    ).toBe(SKILL_CANDIDATE_MIGRATION_REQUIRED_CODE);
    expect(fs.readdirSync(mixed.rootDir)).toEqual(entriesBeforeReopen);
  });

  it.each([
    ["missing schema", "{}\n"],
    ["unknown schema", '{"schema":"chainlesschain.skill-candidate/v99"}\n'],
    ["invalid JSON", '{"schema":\n'],
    ["corrupt Candidate v2", `{"schema":"${SKILL_CANDIDATE_SCHEMA}"}\n`],
  ])(
    "classifies %s as unsafe rather than migration-required",
    (_label, bytes) => {
      const base = path.join(
        tempRoot,
        `unsafe-schema-${_label.replaceAll(" ", "-")}`,
      );
      const registry = new SkillCandidateRegistry(
        registryOptions(TENANT_ALPHA, [], {
          rootDir: base,
          secure: false,
        }),
      );
      fs.writeFileSync(
        path.join(registry.rootDir, `${"d".repeat(64)}.json`),
        bytes,
        "utf8",
      );

      const error = capturedError(
        () =>
          new SkillCandidateRegistry(
            registryOptions(TENANT_ALPHA, [], {
              rootDir: base,
              secure: false,
            }),
          ),
      );
      expect(error.code).toBe("SKILL_CANDIDATE_STORE_UNSAFE");
      expect(error.code).not.toBe(SKILL_CANDIDATE_MIGRATION_REQUIRED_CODE);
    },
  );

  it("rejects Proxies, getters, and oversized candidate encodings before storage", () => {
    const execution = executionFixture();
    const trap = vi.fn(() => {
      throw new Error("Proxy trap must not run");
    });
    const proxy = new Proxy(
      {},
      {
        get: trap,
        getOwnPropertyDescriptor: trap,
        getPrototypeOf: trap,
        ownKeys: trap,
      },
    );
    expect(() => buildSkillCandidateDraft(proxy, execution.context)).toThrow(
      /must not be a Proxy/u,
    );
    expect(trap).not.toHaveBeenCalled();

    const getter = vi.fn(() => draftInput(execution).content);
    const getterInput = { ...draftInput(execution) };
    Object.defineProperty(getterInput, "content", {
      get: getter,
      enumerable: true,
    });
    expect(() =>
      buildSkillCandidateDraft(getterInput, execution.context),
    ).toThrow(/own data property/u);
    expect(getter).not.toHaveBeenCalled();

    const contextGetter = vi.fn(() => execution.targetMatrix.targetMatrixRoot);
    const badContext = {
      expectedEnvironmentBindings:
        execution.context.expectedEnvironmentBindings,
    };
    Object.defineProperty(badContext, "expectedTargetMatrixRoot", {
      get: contextGetter,
      enumerable: true,
    });
    expect(() =>
      buildSkillCandidateDraft(draftInput(execution), badContext),
    ).toThrow(/own data property/u);
    expect(contextGetter).not.toHaveBeenCalled();

    expect(() =>
      buildSkillCandidateDraft(
        draftInput(execution, { dependencyLock: proxy }),
        execution.context,
      ),
    ).toThrow(/execution artifacts/u);
    expect(trap).not.toHaveBeenCalled();
    expect(() =>
      buildSkillCandidateDraft(
        draftInput(execution, {
          content: "x".repeat(SKILL_CANDIDATE_MAX_CONTENT_BYTES + 1),
        }),
        execution.context,
      ),
    ).toThrow(/content exceeds/u);
    expect(() =>
      buildSkillCandidateDraft(
        draftInput(execution, {
          content: "\\".repeat(SKILL_CANDIDATE_MAX_CONTENT_BYTES),
        }),
        execution.context,
      ),
    ).toThrow(/candidate artifact exceeds/u);
  });

  it("publishes once, reads by digest, lists drafts, and never overwrites", () => {
    const execution = executionFixture();
    const registry = new SkillCandidateRegistry(
      registryOptions(TENANT_ALPHA, [execution], {
        rootDir: registryBase,
        secure: false,
      }),
    );
    const first = registry.create(draftInput(execution));
    const filePath = artifactPath(registry, first.candidate.candidateId);
    const before = fs.statSync(filePath);
    const beforeBytes = fs.readFileSync(filePath);
    const duplicate = registry.create(draftInput(execution));
    const after = fs.statSync(filePath);

    expect(first.created).toBe(true);
    expect(duplicate.created).toBe(false);
    expect(duplicate.candidate).toEqual(first.candidate);
    expect(after.ino).toBe(before.ino);
    expect(after.nlink).toBe(1);
    expect(fs.readFileSync(filePath)).toEqual(beforeBytes);
    expect(registry.read(first.candidate.candidateId)).toEqual(first.candidate);
    expect(registry.list()).toEqual([first.candidate]);
    expect(
      fs
        .readdirSync(registry.rootDir)
        .filter((name) => CANDIDATE_FILE_PATTERN_FOR_TEST.test(name)),
    ).toHaveLength(1);
  });

  it("requires ACL enforcement for base, tenant root, marker, and artifact", () => {
    const execution = executionFixture();
    const registry = new SkillCandidateRegistry(
      registryOptions(TENANT_ALPHA, [execution], {
        rootDir: registryBase,
      }),
    );
    const result = registry.create(draftInput(execution));

    expect(secureFsMocks.ensurePrivateDirectory).toHaveBeenCalledWith(
      fs.realpathSync.native(registryBase),
      {
        applyWindowsAcl: true,
        failIfUnavailable: true,
      },
    );
    expect(secureFsMocks.ensurePrivateDirectory).toHaveBeenCalledWith(
      registry.rootDir,
      {
        applyWindowsAcl: true,
        failIfUnavailable: true,
      },
    );
    expect(secureFsMocks.ensurePrivateFile).toHaveBeenCalledWith(
      expect.stringMatching(/\.tenant-.*\.tmp$/u),
      {
        applyWindowsAcl: true,
        failIfUnavailable: true,
      },
    );
    expect(secureFsMocks.ensurePrivateFile).toHaveBeenCalledWith(
      expect.stringMatching(/\.candidate-.*\.tmp$/u),
      {
        applyWindowsAcl: true,
        failIfUnavailable: true,
      },
    );
    expect(registry.read(result.candidate.candidateId)).toEqual(
      result.candidate,
    );
  });

  it("handles a competing identical publisher through exclusive hard-link CAS", () => {
    const execution = executionFixture();
    const fsImpl = Object.create(fs);
    let intercepted = false;
    fsImpl.linkSync = (source, destination) => {
      if (
        !intercepted &&
        /^[a-f0-9]{64}\.json$/u.test(path.basename(destination))
      ) {
        intercepted = true;
        fs.linkSync(source, destination);
        fs.unlinkSync(source);
        const error = new Error("simulated concurrent winner");
        error.code = "EEXIST";
        throw error;
      }
      return fs.linkSync(source, destination);
    };
    const registry = new SkillCandidateRegistry(
      registryOptions(TENANT_ALPHA, [execution], {
        rootDir: registryBase,
        secure: false,
        fsImpl,
      }),
    );
    const result = registry.create(draftInput(execution));

    expect(intercepted).toBe(true);
    expect(result.created).toBe(false);
    expect(registry.read(result.candidate.candidateId)).toEqual(
      result.candidate,
    );
    expect(
      fs.readdirSync(registry.rootDir).some((name) => name.endsWith(".tmp")),
    ).toBe(false);
  });

  it("rejects an equal-length in-place mutation in the final publication window", () => {
    const execution = executionFixture();
    const fsImpl = Object.create(fs);
    let publishedPath = null;
    let mutated = false;
    fsImpl.linkSync = (source, destination) => {
      publishedPath = destination;
      return fs.linkSync(source, destination);
    };
    fsImpl.unlinkSync = (target) => {
      fs.unlinkSync(target);
      if (
        !mutated &&
        publishedPath !== null &&
        path.basename(target).startsWith(".candidate-")
      ) {
        const bytes = fs.readFileSync(publishedPath);
        const marker = Buffer.from("Run the focused tests.", "utf8");
        const offset = bytes.indexOf(marker);
        expect(offset).toBeGreaterThanOrEqual(0);
        bytes[offset] = "X".charCodeAt(0);
        fs.writeFileSync(publishedPath, bytes);
        mutated = true;
      }
    };
    const registry = new SkillCandidateRegistry(
      registryOptions(TENANT_ALPHA, [execution], {
        rootDir: registryBase,
        secure: false,
        fsImpl,
      }),
    );

    const error = capturedError(() => registry.create(draftInput(execution)));
    expect(mutated).toBe(true);
    expect(error.code).toBe("SKILL_CANDIDATE_COMMIT_UNKNOWN");
    expect(error.commitState).toBe("unknown");
    expect(() => registry.read(error.candidateId)).toThrow(/verification/u);
  });

  it.each(["entries", "bytes", "nodes"])(
    "bounds aggregate tenant scan %s before reopening",
    (budgetKind) => {
      const execution = executionFixture();
      const registry = new SkillCandidateRegistry(
        registryOptions(TENANT_ALPHA, [execution], {
          rootDir: registryBase,
          secure: false,
        }),
      );
      const content =
        budgetKind === "bytes"
          ? `---\nname: repair-unit-tests\n---\n\n${"x".repeat(64 * 1024)}`
          : draftInput(execution).content;
      const result = registry.create(draftInput(execution, { content }));
      const candidateName = path.basename(
        artifactPath(registry, result.candidate.candidateId),
      );
      const artifactBytes = fs.statSync(
        artifactPath(registry, result.candidate.candidateId),
      ).size;
      const nodes = jsonNodeCount(result.candidate);
      const repetitions =
        budgetKind === "entries"
          ? SKILL_CANDIDATE_TENANT_SCAN_MAX_ENTRIES * 100
          : budgetKind === "bytes"
            ? Math.floor(
                SKILL_CANDIDATE_TENANT_SCAN_MAX_BYTES / artifactBytes,
              ) + 1
            : Math.floor(SKILL_CANDIDATE_TENANT_SCAN_MAX_NODES / nodes) + 1;
      if (budgetKind !== "entries") {
        expect(repetitions).toBeLessThanOrEqual(
          SKILL_CANDIDATE_TENANT_SCAN_MAX_ENTRIES,
        );
      }
      if (budgetKind === "nodes") {
        expect(repetitions * artifactBytes).toBeLessThanOrEqual(
          SKILL_CANDIDATE_TENANT_SCAN_MAX_BYTES,
        );
      }
      const repeatedEntries = repeatedTenantEntriesFs(
        registry.rootDir,
        candidateName,
        repetitions,
      );

      const error = capturedError(
        () =>
          new SkillCandidateRegistry(
            registryOptions(TENANT_ALPHA, [execution], {
              rootDir: registryBase,
              secure: false,
              fsImpl: repeatedEntries.fsImpl,
            }),
          ),
      );
      expect(error.code).toBe(SKILL_CANDIDATE_STORE_LIMIT_CODE);
      if (budgetKind === "entries") {
        expect(repeatedEntries.tenantReadCount()).toBe(
          SKILL_CANDIDATE_TENANT_SCAN_MAX_ENTRIES + 1,
        );
        expect(repeatedEntries.tenantReadCount()).toBeLessThan(repetitions);
      }
      expect(error.message).toMatch(
        new RegExp(
          budgetKind === "entries"
            ? "entr"
            : budgetKind === "bytes"
              ? "byte"
              : "node",
          "u",
        ),
      );
    },
  );

  it("removes partial candidate writes without exposing marker or artifact debris", () => {
    const execution = executionFixture();
    const fsImpl = Object.create(fs);
    const registry = new SkillCandidateRegistry(
      registryOptions(TENANT_ALPHA, [execution], {
        rootDir: registryBase,
        secure: false,
        fsImpl,
      }),
    );
    fsImpl.writeFileSync = (descriptor, bytes) => {
      fs.writeSync(descriptor, bytes.subarray(0, 17));
      const error = new Error("simulated disk failure");
      error.code = "EIO";
      throw error;
    };

    const error = capturedError(() => registry.create(draftInput(execution)));
    expect(error).toMatchObject({
      code: "SKILL_CANDIDATE_WRITE_FAILED",
      commitState: "not-committed",
    });
    expect(
      fs.readdirSync(registry.rootDir).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);
    expect(fs.existsSync(markerPath(registry))).toBe(true);
    expect(registry.list()).toEqual([]);
  });

  it("fails closed on candidate tampering, symlinks, and hardlinks", () => {
    const execution = executionFixture();
    const registry = new SkillCandidateRegistry(
      registryOptions(TENANT_ALPHA, [execution], {
        rootDir: registryBase,
        secure: false,
      }),
    );
    const { candidate } = registry.create(draftInput(execution));
    const filePath = artifactPath(registry, candidate.candidateId);
    const bytes = fs.readFileSync(filePath, "utf8");
    fs.writeFileSync(filePath, bytes.replace("focused", "altered"), "utf8");
    expect(capturedError(() => registry.read(candidate.candidateId)).code).toBe(
      "SKILL_CANDIDATE_CORRUPT",
    );

    fs.writeFileSync(filePath, bytes, "utf8");
    const outsideHardlink = path.join(tempRoot, "candidate-hardlink.json");
    fs.linkSync(filePath, outsideHardlink);
    expect(capturedError(() => registry.read(candidate.candidateId)).code).toBe(
      "SKILL_CANDIDATE_CORRUPT",
    );
    fs.unlinkSync(outsideHardlink);

    fs.unlinkSync(filePath);
    const outsideCandidate = path.join(tempRoot, "outside-candidate.json");
    fs.writeFileSync(outsideCandidate, bytes);
    try {
      fs.symlinkSync(outsideCandidate, filePath, "file");
    } catch (error) {
      if (["EACCES", "EPERM"].includes(error?.code)) return;
      throw error;
    }
    expect(capturedError(() => registry.read(candidate.candidateId)).code).toBe(
      "SKILL_CANDIDATE_CORRUPT",
    );
    expect(capturedError(() => registry.read("../../active")).code).toBe(
      "SKILL_CANDIDATE_INVALID",
    );
  });
});

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  SKILL_CANDIDATE_TARGET_MATRIX_ADMISSION_AUTHORITY_SCHEMA,
  SKILL_CANDIDATE_TARGET_MATRIX_ADMISSION_RESOLUTION_SCHEMA,
  SkillCandidateRegistry,
} from "../../src/lib/evolution/skill-candidate-registry.js";
import {
  buildSkillDependencyLock,
  buildSkillRuntimeManifest,
  buildSkillTargetMatrix,
} from "../../src/lib/evolution/skill-execution-manifest.js";
import {
  SKILL_MUTATION_NONCE_ACK_SCHEMA,
  SKILL_MUTATION_OPERATIONS,
  SKILL_MUTATION_PRINCIPAL_SCHEMA,
  SKILL_MUTATION_RECEIPT_BINDING_SCHEMA,
  SKILL_MUTATION_RECEIPT_KINDS,
  SKILL_MUTATION_RECEIPT_VERIFICATION_SCHEMA,
  SKILL_MUTATION_ROLES,
  SKILL_MUTATION_TARGET_SCOPES,
  SkillMutationAuthority,
  buildSkillMutationRequest,
  digestSkillMutationReceiptEnvelope,
  digestSkillMutationTransitionSubject,
} from "../../src/lib/evolution/skill-mutation-authority.js";
import {
  EMPTY_SKILL_ACTIVE_DIGEST,
  SkillPromotionController,
} from "../../src/lib/evolution/skill-promotion-controller.js";
import {
  SKILL_RELEASE_LEDGER_PROJECTION_SCHEMA,
  SkillReleaseRegistry,
} from "../../src/lib/evolution/skill-release-registry.js";

const digest = (value) =>
  `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
const TENANT_ID = "tenant:test";
const OTHER_TENANT_ID = "tenant:other";
const candidateAdmissionRecords = new Map();

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

class StrictTransactionLedger {
  #records = new Map();

  #sequence = 0;

  #failure = null;

  setFailure(phase) {
    this.#failure = phase;
  }

  prepare(intent) {
    if (this.#failure === "prepare") throw new Error("prepare unavailable");
    if (!Object.isFrozen(intent)) throw new Error("intent must be frozen");
    const existing = this.#records.get(intent.transactionId);
    if (existing) {
      if (existing.intentDigest !== intent.intentDigest) {
        throw new Error("transaction id conflict");
      }
      return existing.prepare;
    }
    this.#sequence += 1;
    const projection = Object.freeze({
      schema: SKILL_RELEASE_LEDGER_PROJECTION_SCHEMA,
      status: "prepared",
      authenticated: true,
      durable: true,
      transactionId: intent.transactionId,
      intentDigest: intent.intentDigest,
      authorityReceiptDigest: intent.authorityReceiptDigest,
      ledgerId: "ledger:test",
      epoch: "epoch-test-ledger",
      sequence: this.#sequence,
      headDigest: digest(`prepare-head:${intent.intentDigest}`),
      receiptDigest: digest(`prepare-receipt:${intent.intentDigest}`),
    });
    this.#records.set(intent.transactionId, {
      intent: JSON.parse(JSON.stringify(intent)),
      intentDigest: intent.intentDigest,
      prepare: projection,
      committed: null,
    });
    return projection;
  }

  finalize(input) {
    if (this.#failure === "finalize") throw new Error("finalize unavailable");
    if (!Object.isFrozen(input))
      throw new Error("finalize input must be frozen");
    const record = this.#records.get(input.transactionId);
    if (!record || record.intentDigest !== input.intentDigest) {
      throw new Error("transaction was not prepared");
    }
    if (record.committed) return record.committed;
    if (record.prepare.receiptDigest !== input.expectedPrepareReceiptDigest) {
      throw new Error("prepare receipt mismatch");
    }
    this.#sequence += 1;
    record.committed = Object.freeze({
      schema: SKILL_RELEASE_LEDGER_PROJECTION_SCHEMA,
      status: "committed",
      authenticated: true,
      durable: true,
      transactionId: input.transactionId,
      intentDigest: input.intentDigest,
      authorityReceiptDigest: input.authorityReceiptDigest,
      ledgerId: "ledger:test",
      epoch: "epoch-test-ledger",
      sequence: this.#sequence,
      headDigest: digest(`commit-head:${input.intentDigest}`),
      receiptDigest: digest(`commit-receipt:${input.intentDigest}`),
      current: true,
      pointerDigest: input.pointerDigest,
      prepareReceiptDigest: input.expectedPrepareReceiptDigest,
      revision: input.revision,
      skillName: input.skillName,
      stateDigest: input.stateDigest,
    });
    return record.committed;
  }

  query(transactionId) {
    if (this.#failure === "query") throw new Error("query unavailable");
    const record = this.#records.get(transactionId);
    if (!record) {
      return Object.freeze({
        schema: SKILL_RELEASE_LEDGER_PROJECTION_SCHEMA,
        status: "absent",
        authenticated: true,
        durable: true,
        transactionId,
      });
    }
    if (!record.committed) return record.prepare;
    const latestRevision = Math.max(
      ...[...this.#records.values()]
        .filter(
          (entry) => entry.committed?.skillName === record.committed.skillName,
        )
        .map((entry) => entry.committed.revision),
    );
    return Object.freeze({
      ...record.committed,
      current: record.committed.revision === latestRevision,
    });
  }

  snapshot() {
    return [...this.#records.values()].map((record) => ({ ...record }));
  }
}

function receiptEnvelopes(suffix) {
  return Object.fromEntries(
    SKILL_MUTATION_RECEIPT_KINDS.map((kind) => [
      `${kind}Receipt`,
      `${kind}:signed:${suffix}`,
    ]),
  );
}

function createAuthority() {
  let auditSequence = 0;
  let nonceSequence = 0;
  const nonces = new Set();
  const auditEvents = [];
  const authority = new SkillMutationAuthority({
    principalResolver: {
      async resolve({ request }) {
        return {
          schema: SKILL_MUTATION_PRINCIPAL_SCHEMA,
          authenticated: true,
          principalId: "principal:promotion-controller",
          role: SKILL_MUTATION_ROLES.PROMOTION_CONTROLLER,
          tenantId: request.tenantId,
          audience: request.audience,
          operationId: request.operationId,
          operation: request.operation,
          transitionSubjectDigest: request.transitionSubjectDigest,
          requestDigest: request.requestDigest,
          expiresAt: request.expiresAt,
        };
      },
    },
    receiptVerifier: {
      async verify({ receipts, request, principal }) {
        return {
          schema: SKILL_MUTATION_RECEIPT_VERIFICATION_SCHEMA,
          verified: true,
          bindings: Object.fromEntries(
            SKILL_MUTATION_RECEIPT_KINDS.map((kind) => [
              kind,
              {
                schema: SKILL_MUTATION_RECEIPT_BINDING_SCHEMA,
                kind,
                receiptDigest: digestSkillMutationReceiptEnvelope(
                  receipts[`${kind}Receipt`],
                ),
                principalId: principal.principalId,
                role: principal.role,
                ...request,
              },
            ]),
          ),
        };
      },
    },
    auditSink: {
      async append(event) {
        auditEvents.push(event);
        auditSequence += 1;
        return {
          persisted: true,
          auditDigest: event.auditDigest,
          headDigest: digest(`authority-audit-head:${auditSequence}`),
          sequence: auditSequence,
        };
      },
    },
    nonceStore: {
      async claim(claim) {
        nonceSequence += 1;
        const key = `${claim.tenantId}:${claim.audience}:${claim.nonce}`;
        const claimed = !nonces.has(key);
        if (claimed) nonces.add(key);
        return {
          schema: SKILL_MUTATION_NONCE_ACK_SCHEMA,
          persisted: true,
          claimed,
          claimDigest: claim.claimDigest,
          expiresAt: claim.expiresAt,
          headDigest: digest(`nonce-head:${nonceSequence}`),
          sequence: nonceSequence,
        };
      },
    },
  });
  return { authority, auditEvents };
}

function executionFixture(tenantId = TENANT_ID, suffix = "one") {
  const dependencyLock = buildSkillDependencyLock({
    tenantId,
    lock: { generation: suffix, packages: { vitest: "4.1.10" } },
  });
  const runtimeManifest = buildSkillRuntimeManifest({
    tenantId,
    runtimes: [
      {
        runtimeId: "cli",
        descriptor: {
          platform: "linux-x64",
          runtime: "node-22.12.0",
          sandboxPolicyDigest: digest("sandbox:cli"),
        },
      },
      {
        runtimeId: "desktop",
        descriptor: {
          platform: "win32-x64",
          runtime: "electron-39",
          sandboxPolicyDigest: digest("sandbox:desktop"),
        },
      },
    ],
  });
  const cells = [
    {
      cellId: "cli-linux-x64",
      runtimeId: "cli",
      targetEnvironmentRef: "environment:cli-linux-x64",
      environmentDigest: digest("environment:cli-linux-x64"),
    },
    {
      cellId: "desktop-win32-x64",
      runtimeId: "desktop",
      targetEnvironmentRef: "environment:desktop-win32-x64",
      environmentDigest: digest("environment:desktop-win32-x64"),
    },
  ];
  const targetMatrix = buildSkillTargetMatrix({
    tenantId,
    dependencyLock,
    runtimeManifest,
    cells,
  });
  const fixture = {
    context: {
      expectedEnvironmentBindings: cells,
      expectedTargetMatrixRoot: targetMatrix.targetMatrixRoot,
    },
    dependencyLock,
    runtimeManifest,
    targetMatrix,
  };
  candidateAdmissionRecords.set(
    [
      tenantId,
      "repair-unit-tests",
      dependencyLock.dependencyLockDigest,
      runtimeManifest.runtimeManifestDigest,
      targetMatrix.targetMatrixRoot,
    ].join("\0"),
    fixture.context,
  );
  return fixture;
}

function candidateAdmissionAuthority() {
  const descriptor = {
    schema: SKILL_CANDIDATE_TARGET_MATRIX_ADMISSION_AUTHORITY_SCHEMA,
    authorityId: "authority:promotion-test-matrix-admission",
    trust: "trusted",
    revision: 1,
    handlerArtifactDigest: digest("promotion-test-matrix-admission:v1"),
  };
  return {
    ...descriptor,
    resolve(request) {
      const context = candidateAdmissionRecords.get(
        [
          request.tenantId,
          request.skillName,
          request.dependencyLockDigest,
          request.runtimeManifestDigest,
          request.proposedTargetMatrixRoot,
        ].join("\0"),
      );
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
}

function candidateInput(execution, parentDigest = null, suffix = "one") {
  return {
    tenantId: execution.dependencyLock.tenantId,
    skillName: "repair-unit-tests",
    parentDigest,
    sourceEvidenceRefs: [
      {
        ref: `recording://runs/${suffix}`,
        digest: digest(`evidence:${suffix}`),
      },
    ],
    derivationMode: "record-replay",
    wikiRevision: null,
    proposerModel: null,
    requestedCapabilities: ["workspace.read"],
    evalRunId: null,
    content: `---\nname: repair-unit-tests\n---\n\nCandidate ${suffix}.\n`,
    dependencyLock: execution.dependencyLock,
    runtimeManifest: execution.runtimeManifest,
    targetMatrix: execution.targetMatrix,
  };
}

function mutationRequest({
  targetDigest,
  revision,
  operationId,
  operation = SKILL_MUTATION_OPERATIONS.PROMOTE,
  candidateId = null,
  rollbackTargetReleaseDigest = null,
  dependencyLockDigest,
  suffix = operationId,
  tenantId = TENANT_ID,
}) {
  const transitionSubjectDigest = digestSkillMutationTransitionSubject({
    tenantId,
    skillName: "repair-unit-tests",
    operation,
    candidateId,
    rollbackTargetReleaseDigest,
    dependencyLockDigest,
    expectedActiveContentDigest: targetDigest,
    expectedActiveRevision: revision,
  });
  return buildSkillMutationRequest({
    tenantId,
    audience: "worker:promotion",
    operationId,
    operation,
    transitionSubjectDigest,
    skillName: "repair-unit-tests",
    targetScope: SKILL_MUTATION_TARGET_SCOPES.ACTIVE,
    expectedTargetDigest: targetDigest,
    expectedTargetRevision: revision,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    nonce: `nonce_${digest(operationId).slice(7, 39)}`,
    receipts: receiptEnvelopes(suffix),
  });
}

describe("SkillPromotionController with SkillMutationAuthority", () => {
  let tempRoot;
  let candidates;
  let ledger;
  let releases;
  let authorityHarness;
  let controller;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "cc-promotion-composition-"),
    );
    candidates = new SkillCandidateRegistry({
      tenantId: TENANT_ID,
      targetMatrixAdmissionAuthority: candidateAdmissionAuthority(),
      rootDir: path.join(tempRoot, "candidates"),
      secure: false,
    });
    ledger = new StrictTransactionLedger();
    releases = new SkillReleaseRegistry({
      tenantId: TENANT_ID,
      rootDir: path.join(tempRoot, "releases"),
      secure: false,
      transactionLedger: ledger,
    });
    authorityHarness = createAuthority();
    controller = new SkillPromotionController({
      candidateRegistry: candidates,
      releaseRegistry: releases,
      authority: authorityHarness.authority,
    });
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  async function authorize(request) {
    return {
      request,
      capability: await authorityHarness.authority.authorize(request),
    };
  }

  function createCandidate(parentDigest = null, suffix = "one") {
    const execution = executionFixture(TENANT_ID, suffix);
    return candidates.create(candidateInput(execution, parentDigest, suffix))
      .candidate;
  }

  it("composes external authorize -> exact consume -> registry prepare/finalize", async () => {
    const candidate = createCandidate();
    const request = mutationRequest({
      targetDigest: EMPTY_SKILL_ACTIVE_DIGEST,
      revision: 0,
      operationId: "promotion:initial",
      candidateId: candidate.candidateId,
      dependencyLockDigest: candidate.dependencyLockDigest,
    });

    const result = await controller.promote({
      candidateId: candidate.candidateId,
      authorization: await authorize(request),
    });

    expect(result.state).toMatchObject({ revision: 1, fence: 1 });
    expect(result.release.authorityReceiptDigest).toBe(
      result.receipt.authorityReceiptDigest,
    );
    expect(result.release.mutationRequestDigest).toBe(request.requestDigest);
    expect(result.release.receiptDigests).toEqual(
      Object.fromEntries(
        SKILL_MUTATION_RECEIPT_KINDS.map((kind) => [
          kind,
          digestSkillMutationReceiptEnvelope(
            request.receipts[`${kind}Receipt`],
          ),
        ]),
      ),
    );
    expect(ledger.snapshot()).toHaveLength(1);
    expect(ledger.snapshot()[0].committed).not.toBeNull();
    expect(authorityHarness.auditEvents.map((event) => event.phase)).toEqual([
      "authorize",
      "consume",
    ]);
  });

  it("fails closed before mutation when evaluated promotion lacks a typed matrix receipt", async () => {
    const candidate = createCandidate();
    const request = mutationRequest({
      targetDigest: EMPTY_SKILL_ACTIVE_DIGEST,
      revision: 0,
      operationId: "promotion:matrix-required",
      candidateId: candidate.candidateId,
      dependencyLockDigest: candidate.dependencyLockDigest,
    });

    await expect(
      controller.promoteEvaluated({
        candidateId: candidate.candidateId,
        authorization: await authorize(request),
        matrixContext: Object.freeze({}),
        matrixReceiptResolver: Object.freeze({}),
        matrixReceiptVerifier: Object.freeze({}),
      }),
    ).rejects.toMatchObject({
      code: "SKILL_EVALUATED_PROMOTION_INVALID",
    });
    expect(releases.readState(candidate.skillName)).toMatchObject({
      revision: 0,
      activeReleaseDigest: null,
    });
    expect(ledger.snapshot()).toHaveLength(0);
    expect(authorityHarness.auditEvents.map((event) => event.phase)).toEqual([
      "authorize",
    ]);
  });

  it("rejects fake authority objects and forged registry transition capabilities", async () => {
    expect(
      () =>
        new SkillPromotionController({
          candidateRegistry: candidates,
          releaseRegistry: releases,
          authority: { consume: async () => true },
        }),
    ).toThrow(/SkillMutationAuthority/u);

    await expect(
      releases.applyTransition(Object.freeze({})),
    ).rejects.toMatchObject({
      code: "SKILL_PROMOTION_TRANSITION_CAPABILITY_INVALID",
    });
    expect(releases.createRelease).toBeUndefined();
    expect(releases.acquireLease).toBeUndefined();
    expect(releases.commitTransition).toBeUndefined();
  });

  it("rejects cross-tenant registries and authorization before consumption", async () => {
    const otherCandidates = new SkillCandidateRegistry({
      tenantId: OTHER_TENANT_ID,
      targetMatrixAdmissionAuthority: candidateAdmissionAuthority(),
      rootDir: path.join(tempRoot, "candidates"),
      secure: false,
    });
    expect(
      () =>
        new SkillPromotionController({
          candidateRegistry: otherCandidates,
          releaseRegistry: releases,
          authority: authorityHarness.authority,
        }),
    ).toThrow(/same tenant/u);

    const candidate = createCandidate();
    const request = mutationRequest({
      candidateId: candidate.candidateId,
      dependencyLockDigest: candidate.dependencyLockDigest,
      operationId: "promotion:cross-tenant",
      revision: 0,
      targetDigest: EMPTY_SKILL_ACTIVE_DIGEST,
      tenantId: OTHER_TENANT_ID,
    });
    await expect(
      controller.promote({
        authorization: await authorize(request),
        candidateId: candidate.candidateId,
      }),
    ).rejects.toMatchObject({ code: "SKILL_PROMOTION_CANDIDATE_MISMATCH" });
    expect(authorityHarness.auditEvents.map((event) => event.phase)).toEqual([
      "authorize",
    ]);
  });

  it("fails before consumption when the external authorization CAS is stale", async () => {
    const candidate = createCandidate();
    const stale = mutationRequest({
      targetDigest: digest("not-active"),
      revision: 0,
      operationId: "promotion:stale",
      candidateId: candidate.candidateId,
      dependencyLockDigest: candidate.dependencyLockDigest,
    });
    const authorization = await authorize(stale);

    await expect(
      controller.promote({
        candidateId: candidate.candidateId,
        authorization,
      }),
    ).rejects.toMatchObject({ code: "SKILL_PROMOTION_CAS_MISMATCH" });

    expect(authorityHarness.auditEvents.map((event) => event.phase)).toEqual([
      "authorize",
    ]);
    expect(releases.readState(candidate.skillName).revision).toBe(0);
  });

  it("rejects a caller dependencyLock extra field without invoking nested accessors", async () => {
    const candidate = createCandidate();
    const request = mutationRequest({
      targetDigest: EMPTY_SKILL_ACTIVE_DIGEST,
      revision: 0,
      operationId: "promotion:accessor",
      candidateId: candidate.candidateId,
      dependencyLockDigest: candidate.dependencyLockDigest,
    });
    let accessed = false;
    const packages = {};
    Object.defineProperty(packages, "malicious", {
      enumerable: true,
      get() {
        accessed = true;
        return "executed";
      },
    });

    await expect(
      controller.promote({
        candidateId: candidate.candidateId,
        dependencyLock: { packages },
        authorization: await authorize(request),
      }),
    ).rejects.toMatchObject({ code: "SKILL_PROMOTION_INVALID" });

    expect(accessed).toBe(false);
    expect(authorityHarness.auditEvents.map((event) => event.phase)).toEqual([
      "authorize",
    ]);
    expect(releases.readState(candidate.skillName).revision).toBe(0);
  });

  it("passes the exact request context to consume and rejects a capability/request swap", async () => {
    const candidate = createCandidate();
    const authorizedRequest = mutationRequest({
      targetDigest: EMPTY_SKILL_ACTIVE_DIGEST,
      revision: 0,
      operationId: "promotion:authorized-context",
      candidateId: candidate.candidateId,
      dependencyLockDigest: candidate.dependencyLockDigest,
    });
    const swappedRequest = mutationRequest({
      targetDigest: EMPTY_SKILL_ACTIVE_DIGEST,
      revision: 0,
      operationId: "promotion:swapped-context",
      candidateId: candidate.candidateId,
      dependencyLockDigest: candidate.dependencyLockDigest,
    });
    const capability =
      await authorityHarness.authority.authorize(authorizedRequest);

    await expect(
      controller.promote({
        candidateId: candidate.candidateId,
        authorization: { capability, request: swappedRequest },
      }),
    ).rejects.toMatchObject({ code: "SKILL_PROMOTION_AUTHORITY_REJECTED" });

    expect(releases.readState(candidate.skillName).revision).toBe(0);
    expect(ledger.snapshot()).toEqual([]);
  });

  it("rejects substituting candidate B for candidate A before authority consumption", async () => {
    const candidateA = createCandidate(null, "subject-a");
    const candidateB = createCandidate(null, "subject-b");
    const request = mutationRequest({
      targetDigest: EMPTY_SKILL_ACTIVE_DIGEST,
      revision: 0,
      operationId: "promotion:subject-candidate-a",
      candidateId: candidateA.candidateId,
      dependencyLockDigest: candidateA.dependencyLockDigest,
    });

    await expect(
      controller.promote({
        candidateId: candidateB.candidateId,
        authorization: await authorize(request),
      }),
    ).rejects.toMatchObject({ code: "SKILL_PROMOTION_SUBJECT_MISMATCH" });

    expect(authorityHarness.auditEvents.map((event) => event.phase)).toEqual([
      "authorize",
    ]);
    expect(releases.readState(candidateA.skillName).revision).toBe(0);
    expect(ledger.snapshot()).toEqual([]);
  });

  it("rejects caller retransmission or substitution of a dependency lock", async () => {
    const candidate = createCandidate();
    const request = mutationRequest({
      targetDigest: EMPTY_SKILL_ACTIVE_DIGEST,
      revision: 0,
      operationId: "promotion:subject-lock-a",
      candidateId: candidate.candidateId,
      dependencyLockDigest: candidate.dependencyLockDigest,
    });

    await expect(
      controller.promote({
        candidateId: candidate.candidateId,
        dependencyLock: {
          generation: 2,
          packages: { vitest: "4.1.10" },
        },
        authorization: await authorize(request),
      }),
    ).rejects.toMatchObject({ code: "SKILL_PROMOTION_INVALID" });

    expect(authorityHarness.auditEvents.map((event) => event.phase)).toEqual([
      "authorize",
    ]);
    expect(releases.readState(candidate.skillName).revision).toBe(0);
    expect(ledger.snapshot()).toEqual([]);
  });

  it("rejects promote and rollback authorization confusion before authority consumption", async () => {
    const candidate = createCandidate();
    const promotionRequest = mutationRequest({
      targetDigest: EMPTY_SKILL_ACTIVE_DIGEST,
      revision: 0,
      operationId: "promotion:operation-confusion",
      candidateId: candidate.candidateId,
      dependencyLockDigest: candidate.dependencyLockDigest,
    });
    const rollbackRequest = mutationRequest({
      targetDigest: EMPTY_SKILL_ACTIVE_DIGEST,
      revision: 0,
      operationId: "rollback:operation-confusion",
      operation: SKILL_MUTATION_OPERATIONS.ROLLBACK,
      rollbackTargetReleaseDigest: digest("rollback-operation-target"),
      dependencyLockDigest: digest("rollback-operation-lock"),
    });
    const promotionAuthorization = await authorize(promotionRequest);
    const rollbackAuthorization = await authorize(rollbackRequest);

    await expect(
      controller.rollback({ authorization: promotionAuthorization }),
    ).rejects.toMatchObject({ code: "SKILL_PROMOTION_OPERATION_REJECTED" });
    await expect(
      controller.promote({
        candidateId: candidate.candidateId,
        authorization: rollbackAuthorization,
      }),
    ).rejects.toMatchObject({ code: "SKILL_PROMOTION_OPERATION_REJECTED" });

    expect(authorityHarness.auditEvents.map((event) => event.phase)).toEqual([
      "authorize",
      "authorize",
    ]);
    expect(releases.readState(candidate.skillName).revision).toBe(0);
    expect(ledger.snapshot()).toEqual([]);
  });

  it("serializes concurrent authorized promotions without double-active state", async () => {
    const first = createCandidate(null, "one");
    const second = createCandidate(null, "two");
    const firstRequest = mutationRequest({
      targetDigest: EMPTY_SKILL_ACTIVE_DIGEST,
      revision: 0,
      operationId: "promotion:race-one",
      candidateId: first.candidateId,
      dependencyLockDigest: first.dependencyLockDigest,
    });
    const secondRequest = mutationRequest({
      targetDigest: EMPTY_SKILL_ACTIVE_DIGEST,
      revision: 0,
      operationId: "promotion:race-two",
      candidateId: second.candidateId,
      dependencyLockDigest: second.dependencyLockDigest,
    });
    const [firstAuthorization, secondAuthorization] = await Promise.all([
      authorize(firstRequest),
      authorize(secondRequest),
    ]);

    const results = await Promise.allSettled([
      controller.promote({
        candidateId: first.candidateId,
        authorization: firstAuthorization,
      }),
      controller.promote({
        candidateId: second.candidateId,
        authorization: secondAuthorization,
      }),
    ]);

    expect(
      results.filter((entry) => entry.status === "fulfilled"),
    ).toHaveLength(1);
    expect(results.filter((entry) => entry.status === "rejected")).toHaveLength(
      1,
    );
    expect(releases.readState(first.skillName).revision).toBe(1);
    expect(ledger.snapshot()).toHaveLength(1);
  });

  it("updates and rolls back with a fresh six-receipt authorization", async () => {
    const first = createCandidate();
    const firstRequest = mutationRequest({
      targetDigest: EMPTY_SKILL_ACTIVE_DIGEST,
      revision: 0,
      operationId: "promotion:v1",
      candidateId: first.candidateId,
      dependencyLockDigest: first.dependencyLockDigest,
    });
    const firstResult = await controller.promote({
      candidateId: first.candidateId,
      authorization: await authorize(firstRequest),
    });
    const second = createCandidate(first.contentDigest, "two");
    const secondRequest = mutationRequest({
      targetDigest: first.contentDigest,
      revision: 1,
      operationId: "promotion:v2",
      candidateId: second.candidateId,
      dependencyLockDigest: second.dependencyLockDigest,
    });
    const secondResult = await controller.promote({
      candidateId: second.candidateId,
      authorization: await authorize(secondRequest),
    });
    const rollbackRequest = mutationRequest({
      targetDigest: second.contentDigest,
      revision: 2,
      operationId: "rollback:v1",
      operation: SKILL_MUTATION_OPERATIONS.ROLLBACK,
      rollbackTargetReleaseDigest: firstResult.release.releaseDigest,
      dependencyLockDigest: firstResult.release.dependencyLockDigest,
    });

    const rollback = await controller.rollback({
      authorization: await authorize(rollbackRequest),
    });

    expect(rollback.receipt.operation).toBe("rollback");
    expect(rollback.state).toMatchObject({
      revision: 3,
      activeReleaseDigest: firstResult.release.releaseDigest,
      lastKnownGoodReleaseDigest: firstResult.release.releaseDigest,
      dependencyLockDigest: firstResult.release.dependencyLockDigest,
    });
    expect(rollback.state.activeReleaseDigest).not.toBe(
      secondResult.release.releaseDigest,
    );
  });

  it("captures and freezes trusted ports against post-construction replacement", () => {
    expect(Object.isFrozen(controller)).toBe(true);
    expect(Object.isFrozen(authorityHarness.authority)).toBe(true);
    expect(Object.isFrozen(releases)).toBe(true);
    expect(Object.isFrozen(ledger)).toBe(true);
    expect(() => {
      ledger.prepare = () => ({ authenticated: true });
    }).toThrow(TypeError);
    expect(canonicalJson(ledger.query(digest("missing")))).toContain("absent");
  });
});

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SkillCandidateRegistry } from "../../src/lib/evolution/skill-candidate-registry.js";
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
  digestSkillMutationDependencyLock,
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

function candidateInput(parentDigest = null, suffix = "one") {
  return {
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
    targetRuntimes: ["cli", "desktop"],
    requestedCapabilities: ["workspace.read"],
    evalRunId: null,
    content: `---\nname: repair-unit-tests\n---\n\nCandidate ${suffix}.\n`,
  };
}

function mutationRequest({
  targetDigest,
  revision,
  operationId,
  operation = SKILL_MUTATION_OPERATIONS.PROMOTE,
  candidateId = null,
  rollbackTargetReleaseDigest = null,
  dependencyLock = null,
  suffix = operationId,
}) {
  const dependencyLockDigest =
    dependencyLock === null
      ? null
      : digestSkillMutationDependencyLock(dependencyLock);
  const transitionSubjectDigest = digestSkillMutationTransitionSubject({
    tenantId: "tenant:test",
    skillName: "repair-unit-tests",
    operation,
    candidateId,
    rollbackTargetReleaseDigest,
    dependencyLockDigest,
    expectedActiveContentDigest: targetDigest,
    expectedActiveRevision: revision,
  });
  return buildSkillMutationRequest({
    tenantId: "tenant:test",
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
      rootDir: path.join(tempRoot, "candidates"),
      secure: false,
    });
    ledger = new StrictTransactionLedger();
    releases = new SkillReleaseRegistry({
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

  it("composes external authorize -> exact consume -> registry prepare/finalize", async () => {
    const candidate = candidates.create(candidateInput()).candidate;
    const dependencyLock = { packages: { vitest: "4.1.10" } };
    const request = mutationRequest({
      targetDigest: EMPTY_SKILL_ACTIVE_DIGEST,
      revision: 0,
      operationId: "promotion:initial",
      candidateId: candidate.candidateId,
      dependencyLock,
    });

    const result = await controller.promote({
      candidateId: candidate.candidateId,
      dependencyLock,
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

  it("fails before consumption when the external authorization CAS is stale", async () => {
    const candidate = candidates.create(candidateInput()).candidate;
    const stale = mutationRequest({
      targetDigest: digest("not-active"),
      revision: 0,
      operationId: "promotion:stale",
      candidateId: candidate.candidateId,
      dependencyLock: {},
    });
    const authorization = await authorize(stale);

    await expect(
      controller.promote({
        candidateId: candidate.candidateId,
        dependencyLock: {},
        authorization,
      }),
    ).rejects.toMatchObject({ code: "SKILL_PROMOTION_CAS_MISMATCH" });

    expect(authorityHarness.auditEvents.map((event) => event.phase)).toEqual([
      "authorize",
    ]);
    expect(releases.readState(candidate.skillName).revision).toBe(0);
  });

  it("rejects nested dependency accessors before consuming authority", async () => {
    const candidate = candidates.create(candidateInput()).candidate;
    const request = mutationRequest({
      targetDigest: EMPTY_SKILL_ACTIVE_DIGEST,
      revision: 0,
      operationId: "promotion:accessor",
      candidateId: candidate.candidateId,
      dependencyLock: {},
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
    const candidate = candidates.create(candidateInput()).candidate;
    const authorizedRequest = mutationRequest({
      targetDigest: EMPTY_SKILL_ACTIVE_DIGEST,
      revision: 0,
      operationId: "promotion:authorized-context",
      candidateId: candidate.candidateId,
      dependencyLock: {},
    });
    const swappedRequest = mutationRequest({
      targetDigest: EMPTY_SKILL_ACTIVE_DIGEST,
      revision: 0,
      operationId: "promotion:swapped-context",
      candidateId: candidate.candidateId,
      dependencyLock: {},
    });
    const capability =
      await authorityHarness.authority.authorize(authorizedRequest);

    await expect(
      controller.promote({
        candidateId: candidate.candidateId,
        dependencyLock: {},
        authorization: { capability, request: swappedRequest },
      }),
    ).rejects.toMatchObject({ code: "SKILL_PROMOTION_AUTHORITY_REJECTED" });

    expect(releases.readState(candidate.skillName).revision).toBe(0);
    expect(ledger.snapshot()).toEqual([]);
  });

  it("rejects substituting candidate B for candidate A before authority consumption", async () => {
    const candidateA = candidates.create(candidateInput(null, "subject-a")).candidate;
    const candidateB = candidates.create(candidateInput(null, "subject-b")).candidate;
    const dependencyLock = { generation: 1 };
    const request = mutationRequest({
      targetDigest: EMPTY_SKILL_ACTIVE_DIGEST,
      revision: 0,
      operationId: "promotion:subject-candidate-a",
      candidateId: candidateA.candidateId,
      dependencyLock,
    });

    await expect(
      controller.promote({
        candidateId: candidateB.candidateId,
        dependencyLock,
        authorization: await authorize(request),
      }),
    ).rejects.toMatchObject({ code: "SKILL_PROMOTION_SUBJECT_MISMATCH" });

    expect(authorityHarness.auditEvents.map((event) => event.phase)).toEqual([
      "authorize",
    ]);
    expect(releases.readState(candidateA.skillName).revision).toBe(0);
    expect(ledger.snapshot()).toEqual([]);
  });

  it("rejects substituting a dependency lock before authority consumption", async () => {
    const candidate = candidates.create(candidateInput()).candidate;
    const request = mutationRequest({
      targetDigest: EMPTY_SKILL_ACTIVE_DIGEST,
      revision: 0,
      operationId: "promotion:subject-lock-a",
      candidateId: candidate.candidateId,
      dependencyLock: { generation: 1, packages: { vitest: "4.1.10" } },
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
    ).rejects.toMatchObject({ code: "SKILL_PROMOTION_SUBJECT_MISMATCH" });

    expect(authorityHarness.auditEvents.map((event) => event.phase)).toEqual([
      "authorize",
    ]);
    expect(releases.readState(candidate.skillName).revision).toBe(0);
    expect(ledger.snapshot()).toEqual([]);
  });

  it("rejects promote and rollback authorization confusion before authority consumption", async () => {
    const candidate = candidates.create(candidateInput()).candidate;
    const promotionRequest = mutationRequest({
      targetDigest: EMPTY_SKILL_ACTIVE_DIGEST,
      revision: 0,
      operationId: "promotion:operation-confusion",
      candidateId: candidate.candidateId,
      dependencyLock: {},
    });
    const rollbackRequest = mutationRequest({
      targetDigest: EMPTY_SKILL_ACTIVE_DIGEST,
      revision: 0,
      operationId: "rollback:operation-confusion",
      operation: SKILL_MUTATION_OPERATIONS.ROLLBACK,
      rollbackTargetReleaseDigest: digest("rollback-operation-target"),
      dependencyLock: { generation: 1 },
    });
    const promotionAuthorization = await authorize(promotionRequest);
    const rollbackAuthorization = await authorize(rollbackRequest);

    await expect(
      controller.rollback({ authorization: promotionAuthorization }),
    ).rejects.toMatchObject({ code: "SKILL_PROMOTION_OPERATION_REJECTED" });
    await expect(
      controller.promote({
        candidateId: candidate.candidateId,
        dependencyLock: { generation: 1 },
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
    const first = candidates.create(candidateInput(null, "one")).candidate;
    const second = candidates.create(candidateInput(null, "two")).candidate;
    const firstRequest = mutationRequest({
      targetDigest: EMPTY_SKILL_ACTIVE_DIGEST,
      revision: 0,
      operationId: "promotion:race-one",
      candidateId: first.candidateId,
      dependencyLock: { generation: 1 },
    });
    const secondRequest = mutationRequest({
      targetDigest: EMPTY_SKILL_ACTIVE_DIGEST,
      revision: 0,
      operationId: "promotion:race-two",
      candidateId: second.candidateId,
      dependencyLock: { generation: 2 },
    });
    const [firstAuthorization, secondAuthorization] = await Promise.all([
      authorize(firstRequest),
      authorize(secondRequest),
    ]);

    const results = await Promise.allSettled([
      controller.promote({
        candidateId: first.candidateId,
        dependencyLock: { generation: 1 },
        authorization: firstAuthorization,
      }),
      controller.promote({
        candidateId: second.candidateId,
        dependencyLock: { generation: 2 },
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
    const first = candidates.create(candidateInput()).candidate;
    const firstRequest = mutationRequest({
      targetDigest: EMPTY_SKILL_ACTIVE_DIGEST,
      revision: 0,
      operationId: "promotion:v1",
      candidateId: first.candidateId,
      dependencyLock: { generation: 1 },
    });
    const firstResult = await controller.promote({
      candidateId: first.candidateId,
      dependencyLock: { generation: 1 },
      authorization: await authorize(firstRequest),
    });
    const second = candidates.create(
      candidateInput(first.contentDigest, "two"),
    ).candidate;
    const secondRequest = mutationRequest({
      targetDigest: first.contentDigest,
      revision: 1,
      operationId: "promotion:v2",
      candidateId: second.candidateId,
      dependencyLock: { generation: 2 },
    });
    const secondResult = await controller.promote({
      candidateId: second.candidateId,
      dependencyLock: { generation: 2 },
      authorization: await authorize(secondRequest),
    });
    const rollbackRequest = mutationRequest({
      targetDigest: second.contentDigest,
      revision: 2,
      operationId: "rollback:v1",
      operation: SKILL_MUTATION_OPERATIONS.ROLLBACK,
      rollbackTargetReleaseDigest: firstResult.release.releaseDigest,
      dependencyLock: firstResult.release.dependencyLock,
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

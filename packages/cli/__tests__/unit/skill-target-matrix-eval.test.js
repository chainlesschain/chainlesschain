import { createHash, createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ArtifactStore } from "../../src/lib/artifact-store.js";
import {
  EVOLUTION_ARTIFACT_AUTHORITY_DECISION_SCHEMA,
  EvolutionArtifactPorts,
} from "../../src/lib/evolution/evolution-artifact-ports.js";
import { EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA } from "../../src/lib/evolution/evolution-ledger.js";
import {
  createEvolutionEvalStage,
  createEvolutionPromotionStage,
} from "../../src/lib/evolution/evolution-release-train-domain-stages.js";
import { createEvolutionPlan } from "../../src/lib/evolution/evolution-release-train.js";
import {
  EVOLUTION_EVAL_ARTIFACT_SCHEMA,
  EVOLUTION_EVAL_ATTESTATION_PURPOSES,
  EVOLUTION_EVAL_AUTHORITY_DESCRIPTOR_SCHEMA,
  EVOLUTION_EVAL_ENVIRONMENT_SCHEMA,
  EVOLUTION_EVAL_EXECUTION_SCHEMA,
  EVOLUTION_EVAL_GRADE_SCHEMA,
  EVOLUTION_EVAL_ISOLATED_TARGET_SCHEMA,
  EVOLUTION_EVAL_PROVENANCE_SCHEMA,
  EVOLUTION_EVAL_REPLAY_SCHEMA,
  EVOLUTION_EVAL_SAFETY_SCHEMA,
  EVOLUTION_EVAL_SUBJECT_SCHEMA,
  EVOLUTION_EVAL_SUPERVISION_SCHEMA,
  EVOLUTION_EVAL_SUITE_AUTHORITY_SCHEMA,
  EVOLUTION_EVAL_TARGET_INVOCATION_SCHEMA,
  EVOLUTION_EVAL_TARGET_REVOCATION_SCHEMA,
  EvolutionEvalGate,
  EvolutionEvalReceiptVerifier,
  buildEvolutionEvalAttestationDigest,
  buildEvolutionEvalPolicy,
  buildEvolutionEvalSuite,
  computeEvolutionEvalEnvironmentDigest,
  computeEvolutionEvalHandleReservationSetDigest,
  computeEvolutionEvalIsolatedTargetDigest,
  computeEvolutionEvalOutputArtifactDigest,
  computeEvolutionEvalTaskBindingRandomnessCommitment,
  computeEvolutionEvalTaskBindingsDigest,
  computeEvolutionEvalSupervisedResultDigest,
  computeEvolutionEvalTargetAuthorityDigest,
  runEvolutionEvalGate,
} from "../../src/lib/evolution/evolution-eval-gate.js";
import { createEvolutionEvalChildEvidenceStorePort } from "../../src/lib/evolution/evolution-eval-child-evidence-ledger-adapter.js";
import { buildSkillCandidateDraft } from "../../src/lib/evolution/skill-candidate-registry.js";
import {
  buildSkillDependencyLock,
  buildSkillRuntimeManifest,
  buildSkillTargetMatrix,
} from "../../src/lib/evolution/skill-execution-manifest.js";
import {
  SKILL_EVALUATED_PROMOTION_RECEIPT_RESOLUTION_SCHEMA,
  SKILL_EVALUATED_PROMOTION_RECEIPT_RESOLUTION_REQUEST_SCHEMA,
  SKILL_EVALUATED_PROMOTION_RECEIPT_RESOLVER_SCHEMA,
  buildSkillEvaluatedPromotionReceiptEnvelope,
  createSkillEvaluatedPromotionProvider,
  parseSkillEvaluatedPromotionReceiptEnvelope,
  verifySkillEvaluatedPromotionBinding,
} from "../../src/lib/evolution/skill-evaluated-promotion.js";
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
  createSkillEvaluatedPromotionControlPlane,
} from "../../src/lib/evolution/skill-promotion-controller.js";
import {
  SKILL_PROMOTION_REVIEW_DECISION_SCHEMA,
  SKILL_PROMOTION_REVIEW_RESOLUTION_SCHEMA,
  buildSkillPromotionReviewEnvelope,
  buildSkillPromotionReviewPacket,
  createSkillPromotionReviewProvider,
} from "../../src/lib/evolution/skill-promotion-review.js";
import {
  SKILL_RELEASE_LEDGER_PROJECTION_SCHEMA,
  SkillReleaseRegistry,
} from "../../src/lib/evolution/skill-release-registry.js";
import {
  SKILL_REGISTRY_TRANSITION_SETTLED_EVENT_TYPE,
  createSkillRegistryTransitionLedgerAdapter,
} from "../../src/lib/evolution/skill-registry-transition-ledger-adapter.js";
import { SKILL_WIKI_TRANSITION_SCHEMA } from "../../src/lib/evolution/skill-wiki-reconciliation.js";
import {
  SKILL_REGISTRY_CANDIDATE_CREATED_RESOLUTION_SCHEMA,
  SKILL_REGISTRY_EVAL_COMPLETED_RESOLUTION_SCHEMA,
  SKILL_REGISTRY_HUMAN_TASK_SETTLED_RESOLUTION_SCHEMA,
  createSkillRegistryTransitionSource,
} from "../../src/lib/evolution/skill-registry-transition-source.js";
import { AgentRuntime } from "../../src/runtime/agent-runtime.js";
import { createStructuredMemoryAgentControlPlaneFixture } from "../fixtures/structured-memory-agent-control-plane.js";
import {
  SKILL_TARGET_MATRIX_EVAL_FINALIZATION_SCHEMA,
  SKILL_TARGET_MATRIX_EVAL_PLAN_RESOLUTION_SCHEMA,
  SKILL_TARGET_MATRIX_EVAL_PLAN_SCHEMA,
  SKILL_TARGET_MATRIX_EVAL_RECEIPT_SCHEMA,
  SKILL_TARGET_MATRIX_EVAL_RESERVATION_SCHEMA,
  SkillTargetMatrixEvalAggregator,
  SkillTargetMatrixEvalReceiptVerifier,
  buildSkillTargetMatrixEvalPlan,
  computeSkillTargetMatrixEvalAuthorityRoot,
  evaluateSkillTargetMatrix,
  verifySkillTargetMatrixEvalPlan,
  verifySkillTargetMatrixEvalReceipt,
} from "../../src/lib/evolution/skill-target-matrix-eval.js";

const CANDIDATE_ID = `sha256:${"c".repeat(64)}`;
const BASELINE_ID = `sha256:${"b".repeat(64)}`;
const PLAN_DIGEST = `sha256:${"a".repeat(64)}`;
const TARGET_MATRIX_ROOT = `sha256:${"d".repeat(64)}`;
const FIXED_TIME = "2026-09-01T12:00:00.000Z";
const ENVIRONMENT = Object.freeze({
  model: "provider/model@2026-09-01",
  osImage: "windows-2025-ltsc",
  toolManifestDigest: `sha256:${"1".repeat(64)}`,
  permissionDigest: `sha256:${"2".repeat(64)}`,
  sandboxDigest: `sha256:${"3".repeat(64)}`,
});
const ENVIRONMENT_DIGEST = computeEvolutionEvalEnvironmentDigest(ENVIRONMENT);
const TENANT_ID = "tenant-primary";
const PROVENANCE_AUDIENCE = "skill-promotion";
const TRAINER_AUTHORITY = "trainer-authority-v1";
const TRAINER_REVISION = "trainer-revision-v7";
const promotionRoots = [];
const memoryRootFixtures = [];
afterEach(() => {
  for (const root of promotionRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  for (const fixture of memoryRootFixtures.splice(0)) fixture.cleanup();
});
const RUN_REQUEST = Object.freeze({
  suiteRef: "skill-pilot-suite-v1",
  candidateId: CANDIDATE_ID,
  baselineId: BASELINE_ID,
  targetEnvironmentRef: "production-windows-v1",
  evaluationContext: Object.freeze({
    planDigest: PLAN_DIGEST,
    targetMatrixRoot: TARGET_MATRIX_ROOT,
    cellId: "cell-primary",
    runtimeId: "node22-windows-x64",
  }),
});

function task(split, index, overrides = {}) {
  const prefix = `${split}-${index}`;
  const blindCaseId = createHmac("sha256", "test-suite-case-id-secret")
    .update(`${split}\0${index}`, "utf8")
    .digest("hex");
  return {
    id: `task-${prefix}`,
    split,
    groupKeys: [
      `time-${prefix}`,
      `project-${prefix}`,
      `user-${prefix}`,
      `near-duplicate-${prefix}`,
    ],
    taskType: "code",
    publicInput: { caseId: `case-${blindCaseId}`, operand: index },
    graderId: "objective-grader",
    privateExpected: { answer: index * 2 },
    ...overrides,
  };
}

function suiteWithCounts({ training = 30, validation = 20, test = 20 } = {}) {
  return buildEvolutionEvalSuite({
    suiteId: "skill-pilot-suite",
    datasetVersion: "dataset-v1",
    tasks: [
      ...Array.from({ length: training }, (_, index) =>
        task("training", index),
      ),
      ...Array.from({ length: validation }, (_, index) =>
        task("validation", index),
      ),
      ...Array.from({ length: test }, (_, index) => task("test", index)),
    ],
  });
}

function policy(overrides = {}) {
  return buildEvolutionEvalPolicy({
    policyId: "low-risk-pilot-v2",
    minTrainingTasks: 30,
    minValidationTasks: 20,
    minTestTasks: 20,
    seeds: [101, 202, 303],
    minimumAbsoluteImprovement: 0.05,
    minimumEfficiencyImprovement: 0.1,
    confidenceZ: 3,
    maxAverageTokens: 10_000,
    maxAverageLatencyMs: 60_000,
    maxAverageToolCalls: 100,
    maxTotalTokens: 1_000_000,
    maxTotalLatencyMs: 10_000_000,
    maxTotalToolCalls: 100_000,
    maxTotalCostMicrounits: 1_000_000,
    maxExecutions: 240,
    maxWallClockMs: 30_000,
    portReceiptTtlMs: 60_000,
    receiptTtlMs: 60_000,
    ...overrides,
  });
}

function makeAttestationAuthority({
  hangingReceiptSigner = false,
  hangingVerifierPurpose,
  onReceiptVerify,
  roleOverrides = {},
  trustOverrides = {},
  revisionOverrides = {},
} = {}) {
  const revisions = Object.freeze({
    suite: "dataset-authority-v1",
    environment: "environment-resolver-v1",
    artifact: "content-store-v1",
    provenance: "provenance-verifier-v3",
    subject: "artifact-broker-v2",
    execution: "sandbox-executor-v1",
    safety: "safety-gate-v1",
    replay: "handle-replay-authority-v1",
    supervisor: "deadline-supervisor-v1",
    invocationEvidence: "invocation-evidence-authority-v2",
    revocationEvidence: "revocation-evidence-authority-v3",
    grader: "objective-grader-v1",
    receipt: "receipt-signer-v1",
    verifier: "attestation-verifier-v1",
    clock: "trusted-clock-v1",
    ...revisionOverrides,
  });
  const roles = [
    "suite",
    "environment",
    "artifact",
    "provenance",
    "subject",
    "execution",
    "safety",
    "replay",
    "supervisor",
    "invocationEvidence",
    "revocationEvidence",
    "grader",
    "receipt",
    "verifier",
    "clock",
  ];
  const trusts = Object.freeze(
    Object.fromEntries(
      roles.map((role) => [
        role,
        Object.freeze({
          algorithm: "hmac-sha256-test-only",
          issuer: `chainlesschain-${role}-authority`,
          keyId: `test-${role}-key-v1`,
          trustPolicyDigest: `sha256:${createHmac(
            "sha256",
            "trust-policy-test-root",
          )
            .update(role, "utf8")
            .digest("hex")}`,
          ...trustOverrides[role],
        }),
      ]),
    ),
  );
  const receiptTrust = trusts.receipt;
  const secrets = new Map(
    roles.map((role) => [
      trusts[role].keyId,
      `private-${role}-secret-not-shared-with-other-principals`,
    ]),
  );
  const trustByKey = new Map(
    roles.map((role) => [trusts[role].keyId, trusts[role]]),
  );
  const purposeRoles = new Map([
    [EVOLUTION_EVAL_ATTESTATION_PURPOSES.suite, "suite"],
    [EVOLUTION_EVAL_ATTESTATION_PURPOSES.environment, "environment"],
    [EVOLUTION_EVAL_ATTESTATION_PURPOSES.artifact, "artifact"],
    [EVOLUTION_EVAL_ATTESTATION_PURPOSES.provenance, "provenance"],
    [EVOLUTION_EVAL_ATTESTATION_PURPOSES.subject, "subject"],
    [EVOLUTION_EVAL_ATTESTATION_PURPOSES.execution, "execution"],
    [EVOLUTION_EVAL_ATTESTATION_PURPOSES.grade, "grader"],
    [EVOLUTION_EVAL_ATTESTATION_PURPOSES.safety, "safety"],
    [EVOLUTION_EVAL_ATTESTATION_PURPOSES.replay, "replay"],
    [EVOLUTION_EVAL_ATTESTATION_PURPOSES.supervisor, "supervisor"],
    [
      EVOLUTION_EVAL_ATTESTATION_PURPOSES.targetInvocation,
      "invocationEvidence",
    ],
    [
      EVOLUTION_EVAL_ATTESTATION_PURPOSES.targetRevocation,
      "revocationEvidence",
    ],
    [EVOLUTION_EVAL_ATTESTATION_PURPOSES.receipt, "receipt"],
  ]);
  const signature = (secret, purpose, payloadDigest) =>
    createHmac("sha256", secret)
      .update(`${purpose}\0${payloadDigest}`, "utf8")
      .digest("base64url");
  const waitForAbort = ({ signal }) =>
    new Promise((resolve, reject) => {
      signal.addEventListener(
        "abort",
        () => reject(new Error("attestation operation aborted at deadline")),
        { once: true },
      );
    });
  const signerFor = (trust, { hang = false } = {}) => ({
    sign: vi.fn(async ({ purpose, payloadDigest }, context) => {
      if (hang) return waitForAbort(context);
      return {
        ...trust,
        value: signature(secrets.get(trust.keyId), purpose, payloadDigest),
      };
    }),
  });
  const signers = Object.fromEntries(
    roles.map((role) => [role, signerFor(trusts[role])]),
  );
  const receiptSigner = signerFor(receiptTrust, {
    hang: hangingReceiptSigner,
  });
  const verifier = {
    verify: vi.fn(async ({ purpose, payloadDigest, attestation }, context) => {
      if (purpose === hangingVerifierPurpose) return waitForAbort(context);
      const secret = secrets.get(attestation.keyId);
      if (!secret) return false;
      const trust = trustByKey.get(attestation.keyId);
      const accepted =
        Object.entries(trust).every(
          ([key, value]) => attestation[key] === value,
        ) && attestation.value === signature(secret, purpose, payloadDigest);
      if (accepted && purpose === EVOLUTION_EVAL_ATTESTATION_PURPOSES.receipt) {
        onReceiptVerify?.();
      }
      return accepted;
    }),
  };
  const verifyEnforcement = vi.fn(({ purpose, payloadDigest, attestation }) => {
    const secret = secrets.get(attestation.keyId);
    const trust = trustByKey.get(attestation.keyId);
    return Boolean(
      secret &&
      trust &&
      Object.entries(trust).every(
        ([key, value]) => attestation[key] === value,
      ) &&
      attestation.value === signature(secret, purpose, payloadDigest),
    );
  });
  const invocationEvidenceVerifier = Object.freeze({
    verify: vi.fn((verification) => {
      if (
        verification.purpose !==
        EVOLUTION_EVAL_ATTESTATION_PURPOSES.targetInvocation
      ) {
        return false;
      }
      return verifyEnforcement(verification);
    }),
    authorityDescriptor: authorityDescriptor({
      handlerId: "invocation-evidence-verifier",
      handlerRevision: revisions.invocationEvidence,
      operation: "target-invocation-evidence-verify",
      authority: trusts.invocationEvidence,
    }),
  });
  const revocationEvidenceVerifier = Object.freeze({
    verify: vi.fn((verification) => {
      if (
        verification.purpose !==
        EVOLUTION_EVAL_ATTESTATION_PURPOSES.targetRevocation
      ) {
        return false;
      }
      return verifyEnforcement(verification);
    }),
    authorityDescriptor: authorityDescriptor({
      handlerId: "revocation-evidence-verifier",
      handlerRevision: revisions.revocationEvidence,
      operation: "target-revocation-evidence-verify",
      authority: trusts.revocationEvidence,
    }),
  });
  const attestPort = async (core, purpose) => {
    const expectedRole = purposeRoles.get(purpose);
    const signerRole = roleOverrides[purpose] || expectedRole;
    return {
      ...core,
      attestation: await signers[signerRole].sign({
        purpose,
        payloadDigest: buildEvolutionEvalAttestationDigest(core, purpose),
      }),
    };
  };
  const authorityPolicies = Object.freeze(
    Object.fromEntries(
      [
        "suite",
        "environment",
        "artifact",
        "provenance",
        "subject",
        "execution",
        "safety",
        "replay",
        "supervisor",
        "invocationEvidence",
        "revocationEvidence",
        "clock",
      ].map((role) => [
        role,
        Object.freeze({ trust: trusts[role], revision: revisions[role] }),
      ]),
    ),
  );
  const graderAuthorityPolicies = new Map([
    [
      "objective-grader",
      Object.freeze({ trust: trusts.grader, revision: revisions.grader }),
    ],
  ]);
  return {
    receiptSigner,
    verifier,
    verifyEnforcement,
    invocationEvidenceVerifier,
    revocationEvidenceVerifier,
    receiptTrust,
    authorityPolicies,
    graderAuthorityPolicies,
    revisions,
    trusts,
    signers,
    attestPort,
  };
}

function authorityDescriptor({
  handlerId,
  handlerRevision,
  operation,
  authority,
  handlerArtifactDigest = `sha256:${createHmac(
    "sha256",
    "authority-handler-artifact-root",
  )
    .update(`${handlerId}\0${handlerRevision}\0${operation}`, "utf8")
    .digest("hex")}`,
}) {
  return Object.freeze({
    schema: EVOLUTION_EVAL_AUTHORITY_DESCRIPTOR_SCHEMA,
    handlerId,
    handlerRevision,
    operation,
    handlerArtifactDigest,
    authority,
  });
}

function makeTrustedClockPort({
  crypto,
  now,
  policy = crypto.authorityPolicies.clock,
  handlerId = "trusted-clock",
  handlerArtifactDigest,
}) {
  return Object.freeze({
    now,
    authorityDescriptor: authorityDescriptor({
      handlerId,
      handlerRevision: policy.revision,
      operation: "trusted-time-read",
      authority: policy.trust,
      ...(handlerArtifactDigest ? { handlerArtifactDigest } : {}),
    }),
  });
}

function isolatedTarget({
  handlerId,
  handlerRevision,
  operation,
  authority,
  isolation = "sandbox",
  handlerArtifactDigest = `sha256:${createHmac(
    "sha256",
    "isolated-handler-artifact-root",
  )
    .update(`${handlerId}\0${handlerRevision}\0${operation}`, "utf8")
    .digest("hex")}`,
}) {
  return Object.freeze({
    schema: EVOLUTION_EVAL_ISOLATED_TARGET_SCHEMA,
    handlerId,
    handlerRevision,
    operation,
    isolation,
    handlerArtifactDigest,
    authority,
  });
}

function targetPort(method, target) {
  return Object.freeze({ [method]: target });
}

function makeDeadlineSupervisor({
  crypto,
  clock,
  targetRegistry,
  supervisorPolicy = crypto.authorityPolicies.supervisor,
  supervisorHandlerArtifactDigest,
  attack = null,
  invocationEvidenceAttack = null,
  revocationEvidenceAttack = null,
  completedAtOffsetMs = 0,
  terminationResponseDelayMs = 0,
  completedResponseDelayMs = 0,
} = {}) {
  const registry = new Map(
    [...targetRegistry].map(([handlerId, entry]) => [
      handlerId,
      Object.freeze({ ...entry }),
    ]),
  );
  const active = new Map();
  const makeReceipt = async (
    request,
    status,
    {
      resultDigest,
      targetInvocationDigest,
      revocationDigest,
      revocationMode,
      wasActive,
      activeInvocationTerminated,
      terminatedAt,
    },
  ) => {
    const actualTarget = registry.get(request.targetHandlerId)?.target;
    const core = {
      schema: EVOLUTION_EVAL_SUPERVISION_SCHEMA,
      requestDigest: request.requestDigest,
      invocationNonce: request.invocationNonce,
      invocationId: request.invocationId,
      capabilityDigest: request.capabilityDigest,
      operation: request.operation,
      requestedAt: request.requestedAt,
      deadlineAt: request.deadlineAt,
      payloadDigest: request.payloadDigest,
      targetDigest: request.targetDigest,
      targetHandlerId: actualTarget?.handlerId ?? request.targetHandlerId,
      targetRevision: actualTarget?.handlerRevision ?? request.targetRevision,
      targetAuthorityDigest: actualTarget
        ? computeEvolutionEvalTargetAuthorityDigest(actualTarget)
        : request.targetAuthorityDigest,
      completedAt:
        status === "terminated"
          ? request.deadlineAt
          : new Date(clock().getTime() + completedAtOffsetMs).toISOString(),
      status,
      isolation: actualTarget?.isolation ?? "sandbox",
      hardDeadlineEnforced: true,
      lateSideEffectsPrevented: true,
      invocationCount: 1,
      capabilityRevoked: true,
      resultDigest,
      targetInvocationDigest,
      revocationDigest,
      revocationMode,
      wasActive,
      activeInvocationTerminated,
      terminatedAt,
      supervisorRevision: crypto.revisions.supervisor,
    };
    return crypto.attestPort(
      core,
      EVOLUTION_EVAL_ATTESTATION_PURPOSES.supervisor,
    );
  };
  const attestEvidence = async (core, purpose, attackKind) => {
    const evidenceCore =
      attackKind === "wrong-revision"
        ? { ...core, authorityRevision: "forged-evidence-revision-v0" }
        : core;
    if (attackKind === "self-signed") {
      return {
        ...evidenceCore,
        attestation: await crypto.signers.supervisor.sign({
          purpose,
          payloadDigest: buildEvolutionEvalAttestationDigest(
            evidenceCore,
            purpose,
          ),
        }),
      };
    }
    if (attackKind === "cross-purpose") {
      const role =
        purpose === EVOLUTION_EVAL_ATTESTATION_PURPOSES.targetInvocation
          ? "invocationEvidence"
          : "revocationEvidence";
      const wrongPurpose =
        purpose === EVOLUTION_EVAL_ATTESTATION_PURPOSES.targetInvocation
          ? EVOLUTION_EVAL_ATTESTATION_PURPOSES.targetRevocation
          : EVOLUTION_EVAL_ATTESTATION_PURPOSES.targetInvocation;
      return {
        ...evidenceCore,
        attestation: await crypto.signers[role].sign({
          purpose: wrongPurpose,
          payloadDigest: buildEvolutionEvalAttestationDigest(
            evidenceCore,
            wrongPurpose,
          ),
        }),
      };
    }
    return crypto.attestPort(evidenceCore, purpose);
  };
  const invokeTarget = vi.fn(async (request, context) => {
    const entry = registry.get(request.target.handlerId);
    if (!entry) throw new Error("isolated target is not registered");
    const actualTarget = entry.target;
    const invokedAt = clock().toISOString();
    let value;
    if (entry.kind === "worker") {
      const worker = new Worker(entry.source, {
        eval: true,
        workerData: entry.workerData,
      });
      active.set(request.capabilityDigest, { worker, terminate: null });
      value = await new Promise((resolve, reject) => {
        worker.once("message", resolve);
        worker.once("error", reject);
        worker.once("exit", (code) => {
          if (code !== 0) reject(new Error("isolated target was terminated"));
        });
      }).finally(() => active.delete(request.capabilityDigest));
    } else {
      active.set(request.capabilityDigest, {
        worker: null,
        terminate: context?.terminate,
      });
      try {
        if (attack === "terminate-without-active") {
          active.delete(request.capabilityDigest);
          return await new Promise(() => {});
        }
        if (attack === "pending-success" || attack === "early-release") {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        value = await entry.handler(request.payload, context);
      } finally {
        active.delete(request.capabilityDigest);
      }
    }
    const resultDigest = computeEvolutionEvalSupervisedResultDigest(value);
    const evidenceCore = {
      schema: EVOLUTION_EVAL_TARGET_INVOCATION_SCHEMA,
      requestDigest: request.requestDigest,
      capabilityDigest: request.capabilityDigest,
      targetDigest: computeEvolutionEvalIsolatedTargetDigest(actualTarget),
      handlerArtifactDigest:
        entry.handlerArtifactDigest ?? actualTarget.handlerArtifactDigest,
      targetHandlerId: actualTarget.handlerId,
      targetRevision: actualTarget.handlerRevision,
      targetAuthorityDigest:
        computeEvolutionEvalTargetAuthorityDigest(actualTarget),
      operation: actualTarget.operation,
      invocationId: request.invocationId,
      invokedAt,
      completedAt: clock().toISOString(),
      resultDigest,
      authorityRevision: crypto.revisions.invocationEvidence,
    };
    return {
      value,
      evidence: await attestEvidence(
        evidenceCore,
        EVOLUTION_EVAL_ATTESTATION_PURPOSES.targetInvocation,
        invocationEvidenceAttack,
      ),
    };
  });
  const revokeTarget = vi.fn(async (request) => {
    const running = active.get(request.capabilityDigest);
    const wasActive = Boolean(running);
    const revokedAt = clock().toISOString();
    if (attack === "claim-terminate-without-settlement") {
      // Malicious fixture: it signs a termination claim but deliberately
      // leaves the actual invocation promise pending.
    } else if (running?.worker) {
      await running.worker.terminate();
    } else {
      running?.terminate?.();
    }
    active.delete(request.capabilityDigest);
    const hardTerminate = request.mode === "hard-terminate";
    const core = {
      schema: EVOLUTION_EVAL_TARGET_REVOCATION_SCHEMA,
      requestDigest: request.requestDigest,
      capabilityDigest: request.capabilityDigest,
      targetDigest: request.targetDigest,
      invocationId: request.invocationId,
      mode: request.mode,
      requestedAt: request.requestedAt,
      revoked: true,
      wasActive,
      activeInvocationTerminated: hardTerminate && wasActive,
      revokedAt,
      terminatedAt: hardTerminate && wasActive ? clock().toISOString() : null,
      authorityRevision: crypto.revisions.revocationEvidence,
    };
    return attestEvidence(
      core,
      EVOLUTION_EVAL_ATTESTATION_PURPOSES.targetRevocation,
      revocationEvidenceAttack,
    );
  });
  const attackState = {
    lateError: null,
    lateSettled: null,
    terminatedInvocationRejected: null,
  };
  return {
    run: vi.fn(async (request, capability) => {
      if (attack === "run-never-settles") {
        return new Promise(() => {});
      }
      const remaining =
        new Date(request.deadlineAt).getTime() - clock().getTime();
      if (remaining <= 0) {
        throw new Error("supervision deadline was exhausted before invoke");
      }
      if (attack === "no-invoke") {
        const value = { forged: true };
        return {
          value,
          receipt: await makeReceipt(request, "completed", {
            resultDigest: computeEvolutionEvalSupervisedResultDigest(value),
            targetInvocationDigest: `sha256:${"e".repeat(64)}`,
            revocationDigest: `sha256:${"d".repeat(64)}`,
            revocationMode: "completed-release",
            wasActive: false,
            activeInvocationTerminated: false,
            terminatedAt: null,
          }),
        };
      }
      const controller = new AbortController();
      let timer;
      const timeout = new Promise((resolve) => {
        timer = setTimeout(() => {
          resolve({ terminated: true });
        }, remaining);
      });
      const invocation = Promise.resolve()
        .then(() =>
          capability.invoke({
            signal: controller.signal,
            terminate: () => controller.abort(),
          }),
        )
        .then(
          (outcome) => ({ terminated: false, outcome }),
          (error) => ({ terminated: false, error }),
        );
      if (attack === "early-release") {
        await new Promise((resolve) => setTimeout(resolve, 0));
        await capability.revoke({ mode: "completed-release" });
      }
      if (
        attack === "pending-success" ||
        attack === "terminate-without-active" ||
        attack === "claim-terminate-without-settlement"
      ) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        await capability.revoke({ mode: "hard-terminate" });
      }
      const result = await Promise.race([invocation, timeout]);
      if (timer) clearTimeout(timer);
      if (result.terminated) {
        const revocation = await capability.revoke({
          mode: "hard-terminate",
        });
        const settledInvocation = await invocation;
        attackState.terminatedInvocationRejected =
          Object.prototype.hasOwnProperty.call(settledInvocation, "error");
        if (terminationResponseDelayMs > 0) {
          await new Promise((resolve) =>
            setTimeout(resolve, terminationResponseDelayMs),
          );
        }
        return {
          value: null,
          receipt: await makeReceipt(request, "terminated", {
            resultDigest: null,
            targetInvocationDigest: null,
            ...revocation,
          }),
        };
      }
      if (result.error) {
        throw result.error;
      }
      if (attack === "double-invoke") {
        await capability.invoke({ signal: controller.signal }).catch(() => {});
      }
      if (attack === "no-revoke") {
        return {
          value: result.outcome.value,
          receipt: await makeReceipt(request, "completed", {
            resultDigest: result.outcome.resultDigest,
            targetInvocationDigest: result.outcome.targetInvocationDigest,
            revocationDigest: `sha256:${"d".repeat(64)}`,
            revocationMode: "completed-release",
            wasActive: false,
            activeInvocationTerminated: false,
            terminatedAt: null,
          }),
        };
      }
      const revocation = await capability.revoke({
        mode: "completed-release",
      });
      if (completedResponseDelayMs > 0) {
        await new Promise((resolve) =>
          setTimeout(resolve, completedResponseDelayMs),
        );
      }
      if (attack === "late-invoke") {
        attackState.lateSettled = Promise.resolve()
          .then(() => capability.invoke({ signal: controller.signal }))
          .catch((error) => {
            attackState.lateError = error;
          });
      }
      const returnedValue =
        attack === "value-swap" ? { swapped: true } : result.outcome.value;
      return {
        value: returnedValue,
        receipt: await makeReceipt(request, "completed", {
          resultDigest:
            attack === "value-swap"
              ? computeEvolutionEvalSupervisedResultDigest(returnedValue)
              : result.outcome.resultDigest,
          targetInvocationDigest: result.outcome.targetInvocationDigest,
          ...revocation,
        }),
      };
    }),
    invokeTarget,
    revokeTarget,
    verifyEnforcement: crypto.verifyEnforcement,
    authorityDescriptor: authorityDescriptor({
      handlerId: "deadline-supervisor",
      handlerRevision: supervisorPolicy.revision,
      operation: "deadline-supervision",
      authority: supervisorPolicy.trust,
      ...(supervisorHandlerArtifactDigest
        ? { handlerArtifactDigest: supervisorHandlerArtifactDigest }
        : {}),
    }),
    attackState,
  };
}

function makeAnonymousArtifactRuntime() {
  const artifactCapabilities = new Map();
  const subjects = new Map();
  return Object.freeze({
    bindArtifactCapability(opaqueArtifactCapability, payload) {
      artifactCapabilities.set(opaqueArtifactCapability, payload);
    },
    issueSubject(opaqueArtifactCapability, opaqueSubjectHandle) {
      const payload = artifactCapabilities.get(opaqueArtifactCapability);
      if (!payload) throw new Error("anonymous artifact capability is invalid");
      subjects.set(opaqueSubjectHandle, payload);
    },
    executeOpaque(request) {
      const payload = subjects.get(request.opaqueSubjectHandle);
      if (!payload) throw new Error("opaque runtime materialization failed");
      const executionContext = {
        request,
        projection: request.executionProjection,
      };
      return {
        artifact: {
          passed: payload.evaluate(executionContext),
          unsafe: payload.evaluateSafety(executionContext),
        },
        metrics: { ...payload.metrics },
      };
    },
  });
}

function makeOpaqueExecutorFixture({
  anonymousArtifactRuntime,
  attestExecution,
  executorRevision,
  hangUntilAborted,
  hangingPort,
  executorLimitsOverride,
  executionExpiresAtOverride,
}) {
  let sandboxCounter = 0;
  const calls = [];
  const executor = {
    execute: vi.fn(async (request, context) => {
      if (hangingPort === "execution") {
        return hangUntilAborted(request, context);
      }
      calls.push(request);
      const materialized = anonymousArtifactRuntime.executeOpaque(request);
      const artifact = materialized.artifact;
      const core = {
        schema: EVOLUTION_EVAL_EXECUTION_SCHEMA,
        requestDigest: request.requestDigest,
        requestNonce: request.requestNonce,
        runId: request.runId,
        taskHandle: request.taskHandle,
        opaqueSubjectHandle: request.opaqueSubjectHandle,
        executionProjection: request.executionProjection,
        policyDigest: request.policyDigest,
        environmentDigest: request.environmentDigest,
        status: "completed",
        artifact,
        outputArtifactDigest:
          computeEvolutionEvalOutputArtifactDigest(artifact),
        metrics: materialized.metrics,
        enforcedLimits: executorLimitsOverride
          ? executorLimitsOverride(request)
          : { ...request.remainingHardBudget },
        sandboxInstanceId: `sandbox-${++sandboxCounter}`,
        sandboxFresh: true,
        issuedAt: request.requestedAt,
        expiresAt: executionExpiresAtOverride
          ? executionExpiresAtOverride(request)
          : request.deadlineAt,
        executorRevision,
      };
      return attestExecution(core);
    }),
  };
  return { executor, calls };
}

function makeAnonymousSubjectBrokerFixture({
  anonymousArtifactRuntime,
  attestSubject,
  brokerRevision,
  hangUntilAborted,
  hangingPort,
  subjectOverrides,
}) {
  let subjectCounter = 0;
  return {
    issueSubjectHandle: vi.fn(async (request, context) => {
      if (hangingPort === "subject") {
        return hangUntilAborted(request, context);
      }
      subjectCounter += 1;
      const defaults = {
        opaqueSubjectHandle: `sha256:${createHmac(
          "sha256",
          "single-use-subject-secret",
        )
          .update(
            `${request.requestNonce}\0${request.opaqueArtifactCapability}\0${subjectCounter}`,
            "utf8",
          )
          .digest("hex")}`,
        singleUse: true,
        unlinkable: true,
      };
      const overrides =
        typeof subjectOverrides === "function"
          ? subjectOverrides({ request, subjectCounter })
          : subjectOverrides;
      const subject = { ...defaults, ...overrides };
      anonymousArtifactRuntime.issueSubject(
        request.opaqueArtifactCapability,
        subject.opaqueSubjectHandle,
      );
      const core = {
        schema: EVOLUTION_EVAL_SUBJECT_SCHEMA,
        requestDigest: request.requestDigest,
        requestNonce: request.requestNonce,
        requestedAt: request.requestedAt,
        expiresAt: request.deadlineAt,
        runId: request.runId,
        runNonce: request.runNonce,
        opaqueSubjectHandle: subject.opaqueSubjectHandle,
        opaqueArtifactCapability: request.opaqueArtifactCapability,
        singleUse: subject.singleUse,
        unlinkable: subject.unlinkable,
        environmentDigest: request.environmentDigest,
        policyDigest: request.policyDigest,
        brokerRevision,
      };
      return attestSubject(core);
    }),
  };
}

function makeHarness({
  tenantId = TENANT_ID,
  suite = suiteWithCounts(),
  evalPolicy = policy(),
  baselinePass = () => false,
  candidatePass = () => true,
  baselineMetrics = {
    tokens: 100,
    latencyMs: 100,
    toolCalls: 4,
    costMicrounits: 10,
    errors: 0,
  },
  candidateMetrics = {
    tokens: 100,
    latencyMs: 100,
    toolCalls: 4,
    costMicrounits: 10,
    errors: 0,
  },
  gradeOverride,
  baselineUnsafe = () => false,
  candidateUnsafe = () => false,
  graderCrashSplit,
  holdoutIsolated = true,
  artifactTrainingDigestOverride,
  artifactCapabilityOverride,
  executionExpiresAtOverride,
  provenanceOverrides = {},
  subjectOverrides = {},
  executorLimitsOverride,
  hangingPort,
  suiteHandleOverride,
  taskBindingOverride,
  suiteAuthorityRevisionOverride,
  hangingReceiptSigner = false,
  hangingAttestationVerifierPurpose,
  advanceClockOnReceiptVerifyMs = 0,
  maximumReceiptVerificationMs = 30_000,
  attestationRoleOverrides = {},
  authorityTrustOverrides = {},
  authorityRevisionOverrides = {},
  durableReplayState = { handles: new Set(), nonces: new Set() },
  uncooperativeOperation,
  lateSideEffectBuffer,
  supervisorAttack = null,
  invocationEvidenceAttack = null,
  revocationEvidenceAttack = null,
  registryTargetOverride = null,
  registryHandlerOverride = null,
  registryHandlerArtifactOverride = null,
  invocationEvidenceVerifierOverride = null,
  revocationEvidenceVerifierOverride = null,
  authorityPoliciesOverride = null,
  supervisorCompletedAtOffsetMs = 0,
  suitePortOverride = null,
  supervisorHandlerArtifactDigest,
  clockHandlerArtifactDigest,
  invocationEvidenceHandlerArtifactDigest,
  revocationEvidenceHandlerArtifactDigest,
  additionalGraderPolicies = [],
  supervisorCallableAlias = null,
  trustedClockPortOverride = null,
  terminationResponseDelayMs = 0,
  completedResponseDelayMs = 0,
} = {}) {
  let clockMilliseconds = new Date(FIXED_TIME).getTime();
  const crypto = makeAttestationAuthority({
    hangingReceiptSigner,
    hangingVerifierPurpose: hangingAttestationVerifierPurpose,
    onReceiptVerify: () => {
      clockMilliseconds += advanceClockOnReceiptVerifyMs;
    },
    roleOverrides: attestationRoleOverrides,
    trustOverrides: authorityTrustOverrides,
    revisionOverrides: authorityRevisionOverrides,
  });
  const clock = () => new Date(clockMilliseconds);
  const authorityPolicies = authorityPoliciesOverride
    ? typeof authorityPoliciesOverride === "function"
      ? authorityPoliciesOverride(crypto.authorityPolicies)
      : authorityPoliciesOverride
    : crypto.authorityPolicies;
  const targetRegistry = new Map();
  const registerTarget = (target, handler) => {
    if (targetRegistry.has(target.handlerId)) {
      throw new Error(`duplicate isolated target: ${target.handlerId}`);
    }
    const registeredTarget = registryTargetOverride
      ? registryTargetOverride(target)
      : target;
    const registeredHandlerArtifactDigest = registryHandlerArtifactOverride
      ? registryHandlerArtifactOverride(target)
      : registeredTarget.handlerArtifactDigest;
    const registeredHandler = registryHandlerOverride
      ? registryHandlerOverride(target, handler)
      : handler;
    const entry =
      target.operation === uncooperativeOperation
        ? {
            target: registeredTarget,
            kind: "worker",
            source: `
              const { workerData } = require("node:worker_threads");
              const view = new Int32Array(workerData);
              setTimeout(() => Atomics.store(view, 0, 1), 250);
              setInterval(() => {}, 1_000);
            `,
            workerData: lateSideEffectBuffer,
          }
        : {
            target: registeredTarget,
            kind: "handler",
            handler: registeredHandler,
            handlerArtifactDigest: registeredHandlerArtifactDigest,
          };
    entry.handlerArtifactDigest = registeredHandlerArtifactDigest;
    targetRegistry.set(target.handlerId, Object.freeze(entry));
  };
  const taskByDigest = new Map(
    suite.tasks.map((entry) => [entry.taskDigest, entry]),
  );
  const splitByCaseId = new Map(
    suite.tasks.map((entry) => [entry.publicInput.caseId, entry.split]),
  );
  const anonymousArtifactRuntime = makeAnonymousArtifactRuntime();
  const controls = {
    replaySuite: false,
    replayEnvironment: false,
    replayCandidateArtifact: false,
    replayBaselineArtifact: false,
    replayCandidateProvenance: false,
    replayBaselineProvenance: false,
  };
  const remembered = {};
  const hangUntilAborted = (_request, { signal }) =>
    new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new Error("trusted port aborted at deadline"));
        return;
      }
      signal.addEventListener(
        "abort",
        () => reject(new Error("trusted port aborted at deadline")),
        { once: true },
      );
    });

  const suiteVerifier = {
    resolveSuite: vi.fn(async (request, context) => {
      if (hangingPort === "suite") {
        return hangUntilAborted(request, context);
      }
      if (controls.replaySuite && remembered.suite) return remembered.suite;
      const taskBindings = suite.tasks.map((evalTask, index) => {
        const opaqueTaskHandle = suiteHandleOverride
          ? suiteHandleOverride({ request, evalTask, index })
          : `sha256:${createHmac("sha256", "opaque-task-handle-secret")
              .update(
                `${request.runNonce}\0${request.requestNonce}\0${evalTask.taskDigest}`,
                "utf8",
              )
              .digest("hex")}`;
        const bindingDefaults = {
          taskDigest: evalTask.taskDigest,
          opaqueTaskHandle,
          executionProjection: {
            taskType: evalTask.taskType,
            publicInput: evalTask.publicInput,
          },
          runId: request.runId,
          runNonce: request.runNonce,
          bindingNonce: `task-binding-${createHmac(
            "sha256",
            "opaque-task-binding-nonce-secret",
          )
            .update(
              `${request.runNonce}\0${request.requestNonce}\0${evalTask.taskDigest}`,
              "utf8",
            )
            .digest("hex")}`,
          singleRun: true,
          unlinkable: true,
          splitBlind: true,
        };
        const bindingOverrides = taskBindingOverride
          ? taskBindingOverride({
              request,
              evalTask,
              index,
              bindingCore: bindingDefaults,
            })
          : {};
        const bindingCore = { ...bindingDefaults, ...bindingOverrides };
        return {
          ...bindingCore,
          randomnessCommitment:
            computeEvolutionEvalTaskBindingRandomnessCommitment(bindingCore),
        };
      });
      const core = {
        schema: EVOLUTION_EVAL_SUITE_AUTHORITY_SCHEMA,
        requestNonce: request.requestNonce,
        requestedAt: request.requestedAt,
        expiresAt: request.deadlineAt,
        runId: request.runId,
        runNonce: request.runNonce,
        suiteRef: request.suiteRef,
        suiteDigest: suite.suiteDigest,
        taskBindingsDigest:
          computeEvolutionEvalTaskBindingsDigest(taskBindings),
        policyDigest: request.policyDigest,
        authorityRevision:
          suiteAuthorityRevisionOverride || crypto.revisions.suite,
      };
      remembered.suite = {
        suite,
        taskBindings,
        receipt: await crypto.attestPort(
          core,
          EVOLUTION_EVAL_ATTESTATION_PURPOSES.suite,
        ),
      };
      return remembered.suite;
    }),
  };
  const suiteTarget = isolatedTarget({
    handlerId: "suite-resolver",
    handlerRevision: crypto.revisions.suite,
    operation: "suite-resolve",
    authority: crypto.trusts.suite,
  });
  registerTarget(suiteTarget, suiteVerifier.resolveSuite);
  const suiteVerifierPort = targetPort("resolveSuite", suiteTarget);

  const artifactResolver = {
    resolveEnvironment: vi.fn(async (request, context) => {
      if (hangingPort === "environment") {
        return hangUntilAborted(request, context);
      }
      if (controls.replayEnvironment && remembered.environment) {
        return remembered.environment;
      }
      const core = {
        schema: EVOLUTION_EVAL_ENVIRONMENT_SCHEMA,
        requestNonce: request.requestNonce,
        requestedAt: request.requestedAt,
        expiresAt: request.deadlineAt,
        runId: request.runId,
        runNonce: request.runNonce,
        targetEnvironmentRef: request.targetEnvironmentRef,
        environmentDigest: ENVIRONMENT_DIGEST,
        policyDigest: request.policyDigest,
        resolverRevision: crypto.revisions.environment,
      };
      remembered.environment = {
        environment: ENVIRONMENT,
        receipt: await crypto.attestPort(
          core,
          EVOLUTION_EVAL_ATTESTATION_PURPOSES.environment,
        ),
      };
      return remembered.environment;
    }),
    resolveArtifact: vi.fn(async (request, context) => {
      if (hangingPort === "artifact") {
        return hangUntilAborted(request, context);
      }
      const key =
        request.role === "candidate" ? "candidateArtifact" : "baselineArtifact";
      const replay =
        request.role === "candidate"
          ? controls.replayCandidateArtifact
          : controls.replayBaselineArtifact;
      if (replay && remembered[key]) return remembered[key];
      const core = {
        schema: EVOLUTION_EVAL_ARTIFACT_SCHEMA,
        requestNonce: request.requestNonce,
        requestedAt: request.requestedAt,
        expiresAt: request.deadlineAt,
        runId: request.runId,
        runNonce: request.runNonce,
        role: request.role,
        artifactId: request.artifactId,
        artifactDigest: request.artifactId,
        immutable: true,
        suiteAuthorityDigest: request.suiteAuthorityDigest,
        trainingPartitionDigest: artifactTrainingDigestOverride
          ? artifactTrainingDigestOverride(request)
          : request.trainingPartitionDigest,
        holdoutIsolated,
        provenanceReceiptDigest:
          request.role === "candidate"
            ? `sha256:${"8".repeat(64)}`
            : `sha256:${"7".repeat(64)}`,
        opaqueArtifactCapability: artifactCapabilityOverride
          ? artifactCapabilityOverride(request)
          : `sha256:${createHmac(
              "sha256",
              "anonymous-artifact-capability-secret",
            )
              .update(
                `${request.runNonce}\0${request.requestNonce}\0${request.artifactId}`,
                "utf8",
              )
              .digest("hex")}`,
        capabilitySingleRun: true,
        capabilityUnlinkable: true,
        environmentDigest: request.environmentDigest,
        policyDigest: request.policyDigest,
        resolverRevision: crypto.revisions.artifact,
      };
      remembered[key] = {
        receipt: await crypto.attestPort(
          core,
          EVOLUTION_EVAL_ATTESTATION_PURPOSES.artifact,
        ),
      };
      anonymousArtifactRuntime.bindArtifactCapability(
        core.opaqueArtifactCapability,
        Object.freeze({
          evaluate: request.role === "candidate" ? candidatePass : baselinePass,
          evaluateSafety:
            request.role === "candidate" ? candidateUnsafe : baselineUnsafe,
          metrics:
            request.role === "candidate" ? candidateMetrics : baselineMetrics,
        }),
      );
      return remembered[key];
    }),
  };
  const environmentTarget = isolatedTarget({
    handlerId: "environment-resolver",
    handlerRevision: crypto.revisions.environment,
    operation: "environment-resolve",
    authority: crypto.trusts.environment,
  });
  const artifactTarget = isolatedTarget({
    handlerId: "artifact-resolver",
    handlerRevision: crypto.revisions.artifact,
    operation: "artifact-resolve",
    authority: crypto.trusts.artifact,
  });
  registerTarget(environmentTarget, artifactResolver.resolveEnvironment);
  registerTarget(artifactTarget, artifactResolver.resolveArtifact);
  const artifactResolverPort = Object.freeze({
    resolveEnvironment: environmentTarget,
    resolveArtifact: artifactTarget,
  });

  const provenanceVerifier = {
    verifyProvenance: vi.fn(async (request, context) => {
      if (hangingPort === "provenance") {
        return hangUntilAborted(request, context);
      }
      const overrides =
        typeof provenanceOverrides === "function"
          ? provenanceOverrides(request)
          : provenanceOverrides;
      const key =
        request.role === "candidate"
          ? "candidateProvenance"
          : "baselineProvenance";
      const replay =
        request.role === "candidate"
          ? controls.replayCandidateProvenance
          : controls.replayBaselineProvenance;
      if (replay && remembered[key]) return remembered[key];
      const core = {
        schema: EVOLUTION_EVAL_PROVENANCE_SCHEMA,
        requestDigest: request.requestDigest,
        requestNonce: request.requestNonce,
        requestedAt: request.requestedAt,
        expiresAt: request.deadlineAt,
        runId: request.runId,
        runNonce: request.runNonce,
        role: request.role,
        artifactDigest: request.artifactDigest,
        suiteAuthorityDigest: request.suiteAuthorityDigest,
        trainingPartitionDigest: request.trainingPartitionDigest,
        provenanceReceiptDigest: request.provenanceReceiptDigest,
        holdoutIsolated: true,
        trainerAuthority: TRAINER_AUTHORITY,
        trainerRevision: TRAINER_REVISION,
        revocationStatus: "current",
        tenantId: request.tenantId,
        audience: request.audience,
        policyDigest: request.policyDigest,
        verifierRevision: crypto.revisions.provenance,
        ...overrides,
      };
      remembered[key] = await crypto.attestPort(
        core,
        EVOLUTION_EVAL_ATTESTATION_PURPOSES.provenance,
      );
      return remembered[key];
    }),
  };
  const provenanceTarget = isolatedTarget({
    handlerId: "provenance-verifier",
    handlerRevision: crypto.revisions.provenance,
    operation: "provenance-verify",
    authority: crypto.trusts.provenance,
  });
  registerTarget(provenanceTarget, provenanceVerifier.verifyProvenance);
  const provenanceVerifierPort = targetPort(
    "verifyProvenance",
    provenanceTarget,
  );

  const artifactExecutionBroker = makeAnonymousSubjectBrokerFixture({
    anonymousArtifactRuntime,
    attestSubject: (core) =>
      crypto.attestPort(core, EVOLUTION_EVAL_ATTESTATION_PURPOSES.subject),
    brokerRevision: crypto.revisions.subject,
    hangUntilAborted,
    hangingPort,
    subjectOverrides,
  });
  const subjectTarget = isolatedTarget({
    handlerId: "subject-broker",
    handlerRevision: crypto.revisions.subject,
    operation: "subject-issue",
    authority: crypto.trusts.subject,
  });
  registerTarget(subjectTarget, artifactExecutionBroker.issueSubjectHandle);
  const artifactExecutionBrokerPort = targetPort(
    "issueSubjectHandle",
    subjectTarget,
  );

  const { executor, calls: executorCalls } = makeOpaqueExecutorFixture({
    anonymousArtifactRuntime,
    attestExecution: (core) =>
      crypto.attestPort(core, EVOLUTION_EVAL_ATTESTATION_PURPOSES.execution),
    executorRevision: crypto.revisions.execution,
    hangUntilAborted,
    hangingPort,
    executorLimitsOverride,
    executionExpiresAtOverride,
  });
  const executorTarget = isolatedTarget({
    handlerId: "sandbox-executor",
    handlerRevision: crypto.revisions.execution,
    operation: "sandbox-execute",
    authority: crypto.trusts.execution,
  });
  registerTarget(executorTarget, executor.execute);
  const executorPort = targetPort("execute", executorTarget);

  const graderCalls = [];
  const objectiveGrader = {
    grade: vi.fn(async (request, context) => {
      if (hangingPort === "grader") {
        return hangUntilAborted(request, context);
      }
      graderCalls.push(request);
      const evalTask = taskByDigest.get(request.taskDigest);
      if (evalTask?.split === graderCrashSplit)
        throw new Error("grader crashed");
      const pass = gradeOverride
        ? gradeOverride({ request, task: evalTask })
        : request.artifact.passed;
      const core = {
        schema: EVOLUTION_EVAL_GRADE_SCHEMA,
        requestDigest: request.requestDigest,
        requestNonce: request.requestNonce,
        runId: request.runId,
        taskDigest: request.taskDigest,
        executionDigest: request.executionDigest,
        pass,
        qualityScore: pass ? 1 : 0,
        detail: pass ? "objective match" : "objective mismatch",
        graderRevision: crypto.revisions.grader,
        issuedAt: request.requestedAt,
        expiresAt: request.deadlineAt,
      };
      return crypto.attestPort(core, EVOLUTION_EVAL_ATTESTATION_PURPOSES.grade);
    }),
  };
  const graderTarget = isolatedTarget({
    handlerId: "objective-grader",
    handlerRevision: crypto.revisions.grader,
    operation: "objective-grade",
    authority: crypto.trusts.grader,
  });
  registerTarget(graderTarget, objectiveGrader.grade);
  const objectiveGraderPort = targetPort("grade", graderTarget);
  const graderRegistry = new Map([["objective-grader", objectiveGraderPort]]);
  const graderPolicies = new Map(crypto.graderAuthorityPolicies);
  for (const [graderId, graderPolicy] of additionalGraderPolicies) {
    const extraTarget = isolatedTarget({
      handlerId: graderId,
      handlerRevision: graderPolicy.revision,
      operation: "objective-grade",
      authority: graderPolicy.trust,
    });
    registerTarget(extraTarget, objectiveGrader.grade);
    graderRegistry.set(graderId, targetPort("grade", extraTarget));
    graderPolicies.set(graderId, graderPolicy);
  }

  const safetyCalls = [];
  const safetyGate = {
    evaluate: vi.fn(async (request, context) => {
      if (hangingPort === "safety") {
        return hangUntilAborted(request, context);
      }
      safetyCalls.push(request);
      const unsafe = request.artifact.unsafe;
      const core = {
        schema: EVOLUTION_EVAL_SAFETY_SCHEMA,
        requestDigest: request.requestDigest,
        requestNonce: request.requestNonce,
        runId: request.runId,
        taskDigest: request.taskDigest,
        executionDigest: request.executionDigest,
        safe: !unsafe,
        securityViolations: unsafe ? ["unsafe-artifact"] : [],
        permissionViolations: [],
        capabilityDelta: [],
        permissionDelta: [],
        sandboxReceiptDigest: request.executionDigest,
        safetyRevision: crypto.revisions.safety,
        issuedAt: request.requestedAt,
        expiresAt: request.deadlineAt,
      };
      return crypto.attestPort(
        core,
        EVOLUTION_EVAL_ATTESTATION_PURPOSES.safety,
      );
    }),
  };
  const safetyTarget = isolatedTarget({
    handlerId: "safety-gate",
    handlerRevision: crypto.revisions.safety,
    operation: "safety-evaluate",
    authority: crypto.trusts.safety,
  });
  registerTarget(safetyTarget, safetyGate.evaluate);
  const safetyGatePort = targetPort("evaluate", safetyTarget);

  const handleReplayAuthority = {
    reserve: vi.fn(async (request, context) => {
      if (hangingPort === "replay") {
        return hangUntilAborted(request, context);
      }
      const reusedHandle = request.handles.some((handle) =>
        durableReplayState.handles.has(handle),
      );
      const reusedNonce = request.bindingNonces.some((nonce) =>
        durableReplayState.nonces.has(nonce),
      );
      if (reusedHandle || reusedNonce) {
        throw new Error("durable replay authority rejected reused material");
      }
      for (const handle of request.handles) {
        durableReplayState.handles.add(handle);
      }
      for (const nonce of request.bindingNonces) {
        durableReplayState.nonces.add(nonce);
      }
      durableReplayState.reservationCounter =
        (durableReplayState.reservationCounter || 0) + 1;
      const core = {
        schema: EVOLUTION_EVAL_REPLAY_SCHEMA,
        requestDigest: request.requestDigest,
        requestNonce: request.requestNonce,
        requestedAt: request.requestedAt,
        expiresAt: request.deadlineAt,
        runId: request.runId,
        runNonce: request.runNonce,
        kind: request.kind,
        handlesDigest: computeEvolutionEvalHandleReservationSetDigest({
          handles: request.handles,
          bindingNonces: request.bindingNonces,
        }),
        durable: true,
        globallyUnique: true,
        reservationId: `reservation-${request.kind}-${durableReplayState.reservationCounter}`,
        authorityRevision: crypto.revisions.replay,
      };
      return crypto.attestPort(
        core,
        EVOLUTION_EVAL_ATTESTATION_PURPOSES.replay,
      );
    }),
  };
  const replayTarget = isolatedTarget({
    handlerId: "handle-replay-authority",
    handlerRevision: crypto.revisions.replay,
    operation: "handle-reserve",
    authority: crypto.trusts.replay,
  });
  registerTarget(replayTarget, handleReplayAuthority.reserve);
  const handleReplayAuthorityPort = targetPort("reserve", replayTarget);

  const receiptSignerTarget = isolatedTarget({
    handlerId: "receipt-signer",
    handlerRevision: crypto.revisions.receipt,
    operation: "receipt-sign",
    authority: crypto.receiptTrust,
    isolation: "hsm-deadline-authority",
  });
  const attestationVerifierTarget = isolatedTarget({
    handlerId: "attestation-verifier",
    handlerRevision: crypto.revisions.verifier,
    operation: "attestation-verify",
    authority: crypto.trusts.verifier,
    isolation: "hsm-deadline-authority",
  });
  registerTarget(receiptSignerTarget, crypto.receiptSigner.sign);
  registerTarget(attestationVerifierTarget, crypto.verifier.verify);
  const attestationSignerPort = targetPort("sign", receiptSignerTarget);
  const attestationVerifierPort = targetPort(
    "verify",
    attestationVerifierTarget,
  );
  const deadlineSupervisor = makeDeadlineSupervisor({
    crypto,
    clock,
    targetRegistry,
    supervisorPolicy: authorityPolicies.supervisor,
    supervisorHandlerArtifactDigest,
    attack: supervisorAttack,
    invocationEvidenceAttack,
    revocationEvidenceAttack,
    completedAtOffsetMs: supervisorCompletedAtOffsetMs,
    terminationResponseDelayMs,
    completedResponseDelayMs,
  });
  if (supervisorCallableAlias) {
    deadlineSupervisor[supervisorCallableAlias.target] =
      deadlineSupervisor[supervisorCallableAlias.source];
  }
  const trustedClockPort = trustedClockPortOverride
    ? trustedClockPortOverride({
        crypto,
        clock,
        deadlineSupervisor,
        policy: authorityPolicies.clock,
      })
    : makeTrustedClockPort({
        crypto,
        now: clock,
        policy: authorityPolicies.clock,
        ...(clockHandlerArtifactDigest
          ? { handlerArtifactDigest: clockHandlerArtifactDigest }
          : {}),
      });
  const resolveEvidenceVerifier = (override, fallback) => {
    if (override === "deadline-supervisor") return deadlineSupervisor;
    if (override === "deadline-supervisor-callable") {
      return Object.freeze({
        verify: deadlineSupervisor.verifyEnforcement,
        authorityDescriptor: fallback.authorityDescriptor,
      });
    }
    const selected = override || fallback;
    if (Object.prototype.hasOwnProperty.call(selected, "authorityDescriptor")) {
      return selected;
    }
    return Object.freeze({
      verify: selected.verify,
      authorityDescriptor: fallback.authorityDescriptor,
    });
  };
  const invocationEvidenceVerifier = resolveEvidenceVerifier(
    invocationEvidenceVerifierOverride,
    Object.freeze({
      verify: crypto.invocationEvidenceVerifier.verify,
      authorityDescriptor: authorityDescriptor({
        handlerId: "invocation-evidence-verifier",
        handlerRevision: authorityPolicies.invocationEvidence.revision,
        operation: "target-invocation-evidence-verify",
        authority: authorityPolicies.invocationEvidence.trust,
        ...(invocationEvidenceHandlerArtifactDigest
          ? {
              handlerArtifactDigest: invocationEvidenceHandlerArtifactDigest,
            }
          : {}),
      }),
    }),
  );
  const revocationEvidenceVerifier = resolveEvidenceVerifier(
    revocationEvidenceVerifierOverride,
    Object.freeze({
      verify: crypto.revocationEvidenceVerifier.verify,
      authorityDescriptor: authorityDescriptor({
        handlerId: "revocation-evidence-verifier",
        handlerRevision: authorityPolicies.revocationEvidence.revision,
        operation: "target-revocation-evidence-verify",
        authority: authorityPolicies.revocationEvidence.trust,
        ...(revocationEvidenceHandlerArtifactDigest
          ? {
              handlerArtifactDigest: revocationEvidenceHandlerArtifactDigest,
            }
          : {}),
      }),
    }),
  );

  const gate = new EvolutionEvalGate({
    policy: evalPolicy,
    suiteVerifier: suitePortOverride || suiteVerifierPort,
    artifactResolver: artifactResolverPort,
    provenanceVerifier: provenanceVerifierPort,
    artifactExecutionBroker: artifactExecutionBrokerPort,
    handleReplayAuthority: handleReplayAuthorityPort,
    executor: executorPort,
    graders: graderRegistry,
    graderAuthorityPolicies: graderPolicies,
    safetyGate: safetyGatePort,
    attestationSigner: attestationSignerPort,
    attestationVerifier: attestationVerifierPort,
    receiptTrust: crypto.receiptTrust,
    tenantId,
    provenanceAudience: PROVENANCE_AUDIENCE,
    expectedTrainerAuthority: TRAINER_AUTHORITY,
    expectedTrainerRevision: TRAINER_REVISION,
    authorityPolicies,
    deadlineSupervisor,
    invocationEvidenceVerifier,
    revocationEvidenceVerifier,
    clock: trustedClockPort,
  });
  const receiptVerifier = new EvolutionEvalReceiptVerifier({
    attestationVerifier: attestationVerifierPort,
    receiptTrust: crypto.receiptTrust,
    clock: trustedClockPort,
    clockPolicy: authorityPolicies.clock,
    maximumVerificationMs: maximumReceiptVerificationMs,
    deadlineSupervisor,
    supervisorPolicy: authorityPolicies.supervisor,
    invocationEvidenceVerifier,
    invocationEvidencePolicy: authorityPolicies.invocationEvidence,
    revocationEvidenceVerifier,
    revocationEvidencePolicy: authorityPolicies.revocationEvidence,
  });
  return {
    gate,
    receiptVerifier,
    evalPolicy,
    suite,
    controls,
    crypto,
    clockControl: {
      advance(milliseconds) {
        clockMilliseconds += milliseconds;
      },
      read() {
        return new Date(clockMilliseconds);
      },
    },
    ports: {
      suiteVerifier,
      artifactResolver,
      provenanceVerifier,
      artifactExecutionBroker,
      handleReplayAuthority,
      executor,
      objectiveGrader,
      safetyGate,
      deadlineSupervisor,
      trustedClock: trustedClockPort,
      declarative: {
        suiteVerifier: suiteVerifierPort,
        artifactResolver: artifactResolverPort,
        provenanceVerifier: provenanceVerifierPort,
        artifactExecutionBroker: artifactExecutionBrokerPort,
        handleReplayAuthority: handleReplayAuthorityPort,
        executor: executorPort,
        objectiveGrader: objectiveGraderPort,
        safetyGate: safetyGatePort,
        attestationSigner: attestationSignerPort,
        attestationVerifier: attestationVerifierPort,
      },
      targets: {
        suite: suiteTarget,
        environment: environmentTarget,
        artifact: artifactTarget,
        provenance: provenanceTarget,
        subject: subjectTarget,
        replay: replayTarget,
        execution: executorTarget,
        grader: graderTarget,
        safety: safetyTarget,
        receiptSigner: receiptSignerTarget,
        attestationVerifier: attestationVerifierTarget,
      },
    },
    calls: {
      executorCalls,
      graderCalls,
      safetyCalls,
      splitByCaseId,
    },
  };
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function matrixDigest(domain, value) {
  return `sha256:${createHash("sha256")
    .update(domain, "utf8")
    .update("\0", "utf8")
    .update(canonicalJson(value), "utf8")
    .digest("hex")}`;
}

function transitionArtifactStorage(root, now) {
  const secret = "test-only-registry-transition-artifact-key";
  const algorithm = "hmac-sha256";
  const keyId = "test:key/registry-transition";
  const policyDigest = matrixDigest(
    "registry-transition-artifact-policy",
    "v1",
  );
  const sign = (message) =>
    createHmac("sha256", secret).update(message).digest("base64url");
  const ports = new EvolutionArtifactPorts({
    artifactStore: new ArtifactStore({
      dir: path.join(root, "transition-artifacts"),
      now,
    }),
    audience: "worker:promotion",
    tenantId: "artifact-tenant-primary",
    now,
    envelopeSigner: {
      sign: ({ message }) => ({ algorithm, keyId, value: sign(message) }),
    },
    envelopeVerifier: {
      verify: ({ message, signature }) =>
        signature.algorithm === algorithm &&
        signature.keyId === keyId &&
        signature.value === sign(message),
    },
    currentAuthorityResolver: {
      resolve(request) {
        const nowMs = now();
        const core = {
          action: request.action,
          algorithm,
          allowed: true,
          audience: request.audience,
          checkedAt: new Date(nowMs).toISOString(),
          decisionExpiresAt: new Date(nowMs + 30_000).toISOString(),
          digest: request.digest,
          issuedAt: request.issuedAt,
          issuedPolicyDigest: request.issuedPolicyDigest,
          issuedPolicyRevision: request.issuedPolicyRevision,
          issuedPolicyTrusted: true,
          keyId: request.keyId || keyId,
          policyDigest,
          policyRevision: 1,
          purpose: request.purpose,
          requestedAt: request.requestedAt,
          retention: request.retention,
          revocationRevision: 1,
          revoked: false,
          schema: EVOLUTION_ARTIFACT_AUTHORITY_DECISION_SCHEMA,
          tenantId: request.tenantId,
          type: request.type,
        };
        return {
          ...core,
          receiptDigest: matrixDigest(
            "chainlesschain.evolution-artifact-authority-decision/v1",
            core,
          ),
        };
      },
    },
  });
  const state = { events: [], failAfterTypes: new Set() };
  const ledger = {
    read: () => structuredClone(state.events),
    verify: () => ({
      epoch: "epoch-registry-transition",
      ledgerId: "ledger-registry-transition",
      sequence: state.events.length,
      headDigest: state.events.at(-1)?.eventDigest ?? null,
    }),
    appendDomainEvent(input, options) {
      const previous = state.events.at(-1);
      if (
        options.expectedSequence !== state.events.length ||
        options.expectedHeadDigest !== (previous?.eventDigest ?? null)
      ) {
        throw new Error("transition ledger head conflict");
      }
      const event = {
        ...structuredClone(input),
        schema: EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA,
        sequence: state.events.length + 1,
        eventDigest: matrixDigest("registry-transition-event", input),
      };
      state.events.push(event);
      if (state.failAfterTypes.delete(input.type)) {
        throw new Error(`simulated ${input.type} response loss`);
      }
      return {
        authenticated: true,
        committed: true,
        durable: true,
        eventId: input.eventId,
        receiptDigest: matrixDigest("registry-transition-append", event),
      };
    },
  };
  return {
    artifactPorts: ports,
    ledger,
    resolver: ports.createEvolutionLedgerArtifactResolver({
      purpose: "evolution-ledger",
    }),
    state,
  };
}

function promotionAuthority() {
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
          principalId: "principal:matrix-promotion-controller",
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
          headDigest: matrixDigest(
            "matrix-promotion-audit-head",
            auditSequence,
          ),
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
          headDigest: matrixDigest(
            "matrix-promotion-nonce-head",
            nonceSequence,
          ),
          sequence: nonceSequence,
        };
      },
    },
  });
  return { auditEvents, authority };
}

class PromotionTransactionLedger {
  #records = new Map();

  #sequence = 0;

  prepare(intent) {
    const existing = this.#records.get(intent.transactionId);
    if (existing) return existing.prepare;
    this.#sequence += 1;
    const prepare = Object.freeze({
      schema: SKILL_RELEASE_LEDGER_PROJECTION_SCHEMA,
      status: "prepared",
      authenticated: true,
      durable: true,
      transactionId: intent.transactionId,
      intentDigest: intent.intentDigest,
      authorityReceiptDigest: intent.authorityReceiptDigest,
      ledgerId: "ledger:matrix-promotion",
      epoch: "epoch-matrix-promotion",
      sequence: this.#sequence,
      headDigest: matrixDigest("matrix-promotion-prepare-head", intent),
      receiptDigest: matrixDigest("matrix-promotion-prepare-receipt", intent),
    });
    this.#records.set(intent.transactionId, {
      committed: null,
      intentDigest: intent.intentDigest,
      prepare,
    });
    return prepare;
  }

  finalize(input) {
    const record = this.#records.get(input.transactionId);
    if (
      !record ||
      record.intentDigest !== input.intentDigest ||
      record.prepare.receiptDigest !== input.expectedPrepareReceiptDigest
    ) {
      throw new Error("matrix promotion transaction was not prepared");
    }
    if (record.committed) return record.committed;
    this.#sequence += 1;
    record.committed = Object.freeze({
      schema: SKILL_RELEASE_LEDGER_PROJECTION_SCHEMA,
      status: "committed",
      authenticated: true,
      durable: true,
      transactionId: input.transactionId,
      intentDigest: input.intentDigest,
      authorityReceiptDigest: input.authorityReceiptDigest,
      ledgerId: "ledger:matrix-promotion",
      epoch: "epoch-matrix-promotion",
      sequence: this.#sequence,
      headDigest: matrixDigest("matrix-promotion-commit-head", input),
      receiptDigest: matrixDigest("matrix-promotion-commit-receipt", input),
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
    return record.committed ?? record.prepare;
  }
}

function makeMatrixComposition({
  calibration,
  firstHarness,
  secondHarness,
  expectedDecision = "accepted",
  expectedActiveContentDigest = `sha256:${"6".repeat(64)}`,
  expectedActiveRevision = 7,
  baselineReleaseDigest = null,
  fixtureId = "accepted",
  planTtlMs = 300_000,
  useCanonicalCandidate = false,
  candidateOverride = null,
  tenantId = TENANT_ID,
  skillName = "skill-pilot",
  childReceiptStoreAttack = null,
}) {
  const secrets = new Map();
  const makeTrust = (role) => {
    const trust = Object.freeze({
      algorithm: "hmac-sha256-test-only",
      issuer: `matrix-${role}-issuer`,
      keyId: `matrix-${role}-key`,
      trustPolicyDigest: `sha256:${createHash("sha256")
        .update(`matrix-${role}-policy`, "utf8")
        .digest("hex")}`,
    });
    secrets.set(trust.keyId, `matrix-${role}-secret`);
    return trust;
  };
  const roles = Object.freeze({
    plan: makeTrust("plan"),
    resolver: makeTrust("resolver"),
    evidence: makeTrust("evidence"),
    reservation: makeTrust("reservation"),
    supervisor: makeTrust("supervisor"),
    receipt: makeTrust("receipt"),
    clock: makeTrust("clock"),
    cellOneGate: makeTrust("cell-one-gate"),
    cellOneVerifier: makeTrust("cell-one-verifier"),
    cellTwoGate: makeTrust("cell-two-gate"),
    cellTwoVerifier: makeTrust("cell-two-verifier"),
  });
  const revisions = Object.freeze({
    resolver: "matrix-plan-resolver-v1",
    evidence: "matrix-evidence-verifier-v1",
    reservation: "matrix-reservation-v1",
    supervisor: "matrix-supervisor-v1",
    receipt: "matrix-receipt-v1",
    clock: "matrix-clock-v1",
  });
  const descriptor = (role, revision, operation, authority) =>
    authorityDescriptor({
      handlerId: role,
      handlerRevision: revision,
      operation,
      authority,
    });
  const descriptors = Object.freeze({
    planResolver: descriptor(
      "matrix-plan-resolver",
      revisions.resolver,
      "matrix-plan-resolve",
      roles.resolver,
    ),
    evidenceVerifier: descriptor(
      "matrix-evidence-verifier",
      revisions.evidence,
      "matrix-evidence-verify",
      roles.evidence,
    ),
    reservation: descriptor(
      "matrix-reservation",
      revisions.reservation,
      "matrix-plan-reserve",
      roles.reservation,
    ),
    finalization: descriptor(
      "matrix-finalization",
      revisions.reservation,
      "matrix-plan-finalize",
      roles.reservation,
    ),
    supervisor: descriptor(
      "matrix-supervisor",
      revisions.supervisor,
      "matrix-operation-supervise",
      roles.supervisor,
    ),
    receiptSigner: descriptor(
      "matrix-receipt-signer",
      revisions.receipt,
      "matrix-receipt-sign",
      roles.receipt,
    ),
    receiptVerifier: descriptor(
      "matrix-receipt-verifier",
      revisions.receipt,
      "matrix-receipt-verify",
      roles.receipt,
    ),
    clock: descriptor(
      "matrix-clock",
      revisions.clock,
      "trusted-time-read",
      roles.clock,
    ),
    cellOneGate: descriptor(
      "matrix-cell-one-gate",
      "cell-one-gate-v1",
      "cell-eval-run",
      roles.cellOneGate,
    ),
    cellOneVerifier: descriptor(
      "matrix-cell-one-verifier",
      "cell-one-verifier-v1",
      "cell-eval-receipt-verify",
      roles.cellOneVerifier,
    ),
    cellTwoGate: descriptor(
      "matrix-cell-two-gate",
      "cell-two-gate-v1",
      "cell-eval-run",
      roles.cellTwoGate,
    ),
    cellTwoVerifier: descriptor(
      "matrix-cell-two-verifier",
      "cell-two-verifier-v1",
      "cell-eval-receipt-verify",
      roles.cellTwoVerifier,
    ),
  });
  const sign = (trust, purpose, payloadDigest) => ({
    ...trust,
    value: createHmac("sha256", secrets.get(trust.keyId))
      .update(`${purpose}\0${payloadDigest}`, "utf8")
      .digest("base64url"),
  });
  const verify = ({ purpose, payloadDigest, attestation }) => {
    const secret = secrets.get(attestation.keyId);
    if (!secret) return false;
    const expected = createHmac("sha256", secret)
      .update(`${purpose}\0${payloadDigest}`, "utf8")
      .digest("base64url");
    return attestation.value === expected;
  };
  const dependencyLock = buildSkillDependencyLock({
    tenantId,
    lock: { packageManager: "npm", lockfileDigest: `sha256:${"4".repeat(64)}` },
  });
  const runtimeManifest = buildSkillRuntimeManifest({
    tenantId,
    runtimes: [
      {
        runtimeId: "node22-linux-x64",
        descriptor: { abi: "node22", os: "linux" },
      },
      {
        runtimeId: "node22-windows-x64",
        descriptor: { abi: "node22", os: "windows" },
      },
    ],
  });
  const targetMatrix = buildSkillTargetMatrix({
    tenantId,
    dependencyLock,
    runtimeManifest,
    cells: [
      {
        cellId: "cell-linux",
        runtimeId: "node22-linux-x64",
        targetEnvironmentRef: "shared-production-environment-v1",
        environmentDigest: calibration.environmentDigest,
      },
      {
        cellId: "cell-windows",
        runtimeId: "node22-windows-x64",
        targetEnvironmentRef: "shared-production-environment-v1",
        environmentDigest: calibration.environmentDigest,
      },
    ],
  });
  const candidate = candidateOverride
    ? structuredClone(candidateOverride)
    : useCanonicalCandidate
      ? buildSkillCandidateDraft(
          {
            tenantId,
            skillName,
            parentDigest: null,
            sourceEvidenceRefs: [
              {
                ref: "recording://matrix-promotion/source",
                digest: matrixDigest("matrix-promotion-source", fixtureId),
              },
            ],
            derivationMode: "record-replay",
            wikiRevision: null,
            proposerModel: null,
            requestedCapabilities: ["workspace.read"],
            evalRunId: null,
            content: `---\nname: skill-pilot\n---\n\nMatrix candidate ${fixtureId}.\n`,
            dependencyLock,
            runtimeManifest,
            targetMatrix,
          },
          {
            expectedEnvironmentBindings: targetMatrix.cells,
            expectedTargetMatrixRoot: targetMatrix.targetMatrixRoot,
          },
        )
      : null;
  const cellAuthorities = Object.freeze([
    Object.freeze({
      cellId: "cell-linux",
      gateDescriptor: descriptors.cellOneGate,
      receiptVerifierDescriptor: descriptors.cellOneVerifier,
      policyDigest: calibration.policyDigest,
      evaluationAuthorityRoot: calibration.evaluationAuthorityRoot,
      maximumCellSettlementMs: 35_000,
    }),
    Object.freeze({
      cellId: "cell-windows",
      gateDescriptor: descriptors.cellTwoGate,
      receiptVerifierDescriptor: descriptors.cellTwoVerifier,
      policyDigest: calibration.policyDigest,
      evaluationAuthorityRoot: calibration.evaluationAuthorityRoot,
      maximumCellSettlementMs: 35_000,
    }),
  ]);
  const childReceiptRecords = new Map();
  const childReceiptStoreDescriptor = Object.freeze({
    tenantId,
    streamId: `matrix-child-receipts:${fixtureId}`,
    authorityId: "authority:matrix-child-receipts",
    revision: 1,
    handlerArtifactDigest: matrixDigest(
      "matrix-child-receipt-store",
      fixtureId,
    ),
  });
  const childReceiptStore = createEvolutionEvalChildEvidenceStorePort({
    descriptor: childReceiptStoreDescriptor,
    retain: async (request) => {
      childReceiptRecords.set(request.receiptDigest, structuredClone(request));
      return {
        authenticated: true,
        durable: childReceiptStoreAttack !== "non-durable",
        kind: request.kind,
        receiptDigest: request.receiptDigest,
      };
    },
    resolve: async (request) => {
      const retained = childReceiptRecords.get(request.receiptDigest);
      const evidence = structuredClone(retained.evidence);
      if (childReceiptStoreAttack === "substitute")
        evidence.runId = "substituted-run";
      return {
        authenticated: true,
        durable: true,
        ...childReceiptStoreDescriptor,
        kind: request.kind,
        receiptDigest: request.receiptDigest,
        evidence,
      };
    },
  });
  const matrixAuthorityRoot = computeSkillTargetMatrixEvalAuthorityRoot({
    planResolverDescriptor: descriptors.planResolver,
    evidenceVerifierDescriptor: descriptors.evidenceVerifier,
    reservationDescriptor: descriptors.reservation,
    finalizationDescriptor: descriptors.finalization,
    supervisorDescriptor: descriptors.supervisor,
    matrixSignerDescriptor: descriptors.receiptSigner,
    matrixVerifierDescriptor: descriptors.receiptVerifier,
    clockDescriptor: descriptors.clock,
    planTrust: roles.plan,
    matrixReceiptTrust: roles.receipt,
    childReceiptStoreDescriptor,
    cellAuthorities,
  });
  const cellConfig = (
    gate,
    receiptVerifier,
    gateDescriptor,
    verifierDescriptor,
  ) =>
    Object.freeze({
      gate,
      receiptVerifier,
      suiteRef: RUN_REQUEST.suiteRef,
      suiteDigest: calibration.suiteDigest,
      policyDigest: calibration.policyDigest,
      evaluationAuthorityRoot: calibration.evaluationAuthorityRoot,
      provenanceAudience: calibration.provenanceAudience,
      trainerAuthority: calibration.trainerAuthority,
      trainerRevision: calibration.trainerRevision,
      maximumCellSettlementMs: 35_000,
      gateDescriptor,
      receiptVerifierDescriptor: verifierDescriptor,
    });
  const cellRuntimes = new Map([
    [
      "cell-linux",
      cellConfig(
        firstHarness.gate,
        firstHarness.receiptVerifier,
        descriptors.cellOneGate,
        descriptors.cellOneVerifier,
      ),
    ],
    [
      "cell-windows",
      cellConfig(
        secondHarness.gate,
        secondHarness.receiptVerifier,
        descriptors.cellTwoGate,
        descriptors.cellTwoVerifier,
      ),
    ],
  ]);
  const plan = buildSkillTargetMatrixEvalPlan({
    matrixEvalId: `matrix-eval-${fixtureId}-v1`,
    nonce: `matrix-eval-plan-${fixtureId}-nonce-v1`,
    tenantId,
    skillName,
    candidateId: candidate?.candidateId ?? CANDIDATE_ID,
    candidateContentDigest:
      candidate?.contentDigest ?? `sha256:${"5".repeat(64)}`,
    baselineId: BASELINE_ID,
    baselineReleaseDigest,
    expectedActiveContentDigest,
    expectedActiveRevision,
    dependencyLockDigest: dependencyLock.dependencyLockDigest,
    runtimeManifestDigest: runtimeManifest.runtimeManifestDigest,
    targetMatrixRoot: targetMatrix.targetMatrixRoot,
    matrixAuthorityRoot,
    maxTotalWallClockMs: 90_000,
    aggregateReceiptTtlMs: 60_000,
    familywiseErrorRate: 0.05,
    comparisonCorrection: "bonferroni-two-sided",
    issuedAt: FIXED_TIME,
    expiresAt: new Date(
      new Date(FIXED_TIME).getTime() + planTtlMs,
    ).toISOString(),
    cells: targetMatrix.cells.map((cell, index) => ({
      ...cell,
      invocationId: `matrix-invocation-${index + 1}`,
      invocationNonce: `matrix-invocation-nonce-${index + 1}`,
      suiteRef: RUN_REQUEST.suiteRef,
      suiteDigest: calibration.suiteDigest,
      policyDigest: calibration.policyDigest,
      evaluationAuthorityRoot: calibration.evaluationAuthorityRoot,
      provenanceAudience: calibration.provenanceAudience,
      trainerAuthority: calibration.trainerAuthority,
      trainerRevision: calibration.trainerRevision,
      maximumCellSettlementMs: 35_000,
    })),
  });
  const planRef = Object.freeze({
    ref: `cas:matrix-eval-plan-${fixtureId}-v1`,
    digest: plan.planDigest,
  });
  const planResolver = Object.freeze({
    resolve: async (request) => ({
      schema: SKILL_TARGET_MATRIX_EVAL_PLAN_RESOLUTION_SCHEMA,
      requestDigest: request.requestDigest,
      planRef,
      plan,
      planAttestation: sign(
        roles.plan,
        "skill-target-matrix-eval-plan",
        plan.planDigest,
      ),
      resolverRevision: revisions.resolver,
      resolvedAt: request.requestedAt,
    }),
    authorityDescriptor: descriptors.planResolver,
  });
  const evidenceVerifier = Object.freeze({
    verify: async (verification) => verify(verification),
    authorityDescriptor: descriptors.evidenceVerifier,
  });
  const reservedPlans = new Set();
  const reservationAuthority = Object.freeze({
    reserve: async (request) => {
      if (reservedPlans.has(request.planDigest)) {
        throw new Error("durable matrix plan reservation replay");
      }
      reservedPlans.add(request.planDigest);
      const core = {
        schema: SKILL_TARGET_MATRIX_EVAL_RESERVATION_SCHEMA,
        tenantId: request.tenantId,
        matrixEvalId: request.matrixEvalId,
        planDigest: request.planDigest,
        planNonce: request.planNonce,
        matrixAuthorityRoot: request.matrixAuthorityRoot,
        requestDigest: request.requestDigest,
        reservationId: `matrix-reservation-${fixtureId}-v1`,
        reservedAt: request.requestedAt,
        expiresAt: plan.expiresAt,
        authorityRevision: revisions.reservation,
      };
      const receiptDigest = matrixDigest(
        SKILL_TARGET_MATRIX_EVAL_RESERVATION_SCHEMA,
        core,
      );
      return {
        ...core,
        attestation: sign(
          roles.reservation,
          "skill-target-matrix-eval-reservation",
          receiptDigest,
        ),
        receiptDigest,
      };
    },
    finalize: async (request) => {
      const core = {
        schema: SKILL_TARGET_MATRIX_EVAL_FINALIZATION_SCHEMA,
        tenantId: request.tenantId,
        matrixEvalId: request.matrixEvalId,
        planDigest: request.planDigest,
        reservationId: request.reservationId,
        reservationReceiptDigest: request.reservationReceiptDigest,
        decisionCommitmentDigest: request.decisionCommitmentDigest,
        requestDigest: request.requestDigest,
        finalizedAt: request.requestedAt,
        authorityRevision: revisions.reservation,
      };
      const receiptDigest = matrixDigest(
        SKILL_TARGET_MATRIX_EVAL_FINALIZATION_SCHEMA,
        core,
      );
      return {
        ...core,
        attestation: sign(
          roles.reservation,
          "skill-target-matrix-eval-finalization",
          receiptDigest,
        ),
        receiptDigest,
      };
    },
    reservationDescriptor: descriptors.reservation,
    finalizationDescriptor: descriptors.finalization,
  });
  const matrixSupervisor = Object.freeze({
    run: async (request, capability) => {
      const value = await capability.invoke();
      return {
        operationId: request.operationId,
        completed: true,
        valueDigest: matrixDigest(
          "chainlesschain.skill-target-matrix-eval-supervised-result/v1",
          value,
        ),
        value,
      };
    },
    authorityDescriptor: descriptors.supervisor,
  });
  const matrixReceiptSigner = Object.freeze({
    sign: async ({ purpose, payloadDigest }) =>
      sign(roles.receipt, purpose, payloadDigest),
    authorityDescriptor: descriptors.receiptSigner,
  });
  const matrixReceiptVerifier = Object.freeze({
    verify: async (verification) => verify(verification),
    authorityDescriptor: descriptors.receiptVerifier,
  });
  const clock = Object.freeze({
    now: () => new Date(FIXED_TIME),
    authorityDescriptor: descriptors.clock,
  });
  const policies = Object.freeze({
    planResolver: Object.freeze({
      trust: roles.resolver,
      revision: revisions.resolver,
    }),
    evidenceVerifier: Object.freeze({
      trust: roles.evidence,
      revision: revisions.evidence,
    }),
    reservation: Object.freeze({
      trust: roles.reservation,
      revision: revisions.reservation,
    }),
    supervisor: Object.freeze({
      trust: roles.supervisor,
      revision: revisions.supervisor,
    }),
    clock: Object.freeze({ trust: roles.clock, revision: revisions.clock }),
  });
  const aggregatorOptions = {
    tenantId,
    dependencyLock,
    runtimeManifest,
    targetMatrix,
    expectedEnvironmentBindings: targetMatrix.cells,
    expectedTargetMatrixRoot: targetMatrix.targetMatrixRoot,
    cellRuntimes,
    planResolver,
    planResolverPolicy: policies.planResolver,
    planTrust: roles.plan,
    evidenceVerifier,
    evidenceVerifierPolicy: policies.evidenceVerifier,
    reservationAuthority,
    reservationPolicy: policies.reservation,
    matrixSupervisor,
    supervisorPolicy: policies.supervisor,
    matrixReceiptSigner,
    matrixReceiptVerifier,
    matrixReceiptTrust: roles.receipt,
    clock,
    clockPolicy: policies.clock,
    maximumMatrixWallClockMs: 90_000,
    childReceiptStore,
  };
  const expected = Object.freeze({
    matrixEvalId: plan.matrixEvalId,
    tenantId: plan.tenantId,
    skillName: plan.skillName,
    candidateId: plan.candidateId,
    candidateContentDigest: plan.candidateContentDigest,
    baselineId: plan.baselineId,
    baselineReleaseDigest: plan.baselineReleaseDigest,
    expectedActiveContentDigest: plan.expectedActiveContentDigest,
    expectedActiveRevision: plan.expectedActiveRevision,
    dependencyLockDigest: plan.dependencyLockDigest,
    runtimeManifestDigest: plan.runtimeManifestDigest,
    targetMatrixRoot: plan.targetMatrixRoot,
    matrixAuthorityRoot: plan.matrixAuthorityRoot,
    planDigest: plan.planDigest,
    decision: expectedDecision,
  });
  return {
    candidate,
    plan,
    planRef,
    expected,
    aggregatorOptions,
    childReceiptRecords,
    verifierOptions: {
      matrixReceiptVerifier,
      matrixReceiptSignerDescriptor: descriptors.receiptSigner,
      matrixReceiptTrust: roles.receipt,
      matrixSupervisor,
      supervisorPolicy: policies.supervisor,
      clock,
      clockPolicy: policies.clock,
      maximumReceiptTtlMs: 60_000,
      maximumVerificationMs: 30_000,
    },
  };
}

function withoutFields(value, excluded) {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !excluded.has(key)),
  );
}

async function resignMatrixReceipt(fixture, originalReceipt, mutate) {
  const receipt = structuredClone(originalReceipt);
  mutate(receipt);
  const planAuthenticationCore = withoutFields(
    receipt.planAuthentication,
    new Set(["evidenceDigest"]),
  );
  receipt.planAuthentication.evidenceDigest = matrixDigest(
    "chainlesschain.skill-target-matrix-eval-plan-authentication/v1",
    planAuthenticationCore,
  );
  const reservationCore = withoutFields(
    receipt.reservation,
    new Set(["attestation", "receiptDigest"]),
  );
  receipt.reservation.receiptDigest = matrixDigest(
    SKILL_TARGET_MATRIX_EVAL_RESERVATION_SCHEMA,
    reservationCore,
  );
  receipt.childReceiptRoot = matrixDigest(
    "chainlesschain.skill-target-matrix-eval-child-receipt-root/v1",
    receipt.cellResults.map((cell) => ({
      cellId: cell.cellId,
      childFullDigest: cell.childFullDigest,
    })),
  );
  const decisionCommitment = {
    matrixEvalId: receipt.matrixEvalId,
    nonce: receipt.nonce,
    tenantId: receipt.tenantId,
    skillName: receipt.skillName,
    candidateId: receipt.candidateId,
    candidateContentDigest: receipt.candidateContentDigest,
    baselineId: receipt.baselineId,
    baselineReleaseDigest: receipt.baselineReleaseDigest,
    expectedActiveContentDigest: receipt.expectedActiveContentDigest,
    expectedActiveRevision: receipt.expectedActiveRevision,
    dependencyLockDigest: receipt.dependencyLockDigest,
    runtimeManifestDigest: receipt.runtimeManifestDigest,
    targetMatrixRoot: receipt.targetMatrixRoot,
    matrixAuthorityRoot: receipt.matrixAuthorityRoot,
    planDigest: receipt.planDigest,
    familywiseErrorRate: receipt.familywiseErrorRate,
    comparisonCorrection: receipt.comparisonCorrection,
    planAuthenticationDigest: receipt.planAuthentication.evidenceDigest,
    reservationReceiptDigest: receipt.reservation.receiptDigest,
    cellCount: receipt.cellResults.length,
    cellResults: receipt.cellResults,
    childReceiptRoot: receipt.childReceiptRoot,
    decision: receipt.decision,
    reasonCodes: receipt.reasonCodes,
  };
  receipt.decisionCommitmentDigest = matrixDigest(
    "chainlesschain.skill-target-matrix-eval-decision-commitment/v2",
    decisionCommitment,
  );
  receipt.finalization.decisionCommitmentDigest =
    receipt.decisionCommitmentDigest;
  receipt.finalization.reservationReceiptDigest =
    receipt.reservation.receiptDigest;
  const finalizationCore = withoutFields(
    receipt.finalization,
    new Set(["attestation", "receiptDigest"]),
  );
  receipt.finalization.receiptDigest = matrixDigest(
    SKILL_TARGET_MATRIX_EVAL_FINALIZATION_SCHEMA,
    finalizationCore,
  );
  const receiptCore = withoutFields(
    receipt,
    new Set(["attestation", "receiptDigest"]),
  );
  receipt.receiptDigest = matrixDigest(
    SKILL_TARGET_MATRIX_EVAL_RECEIPT_SCHEMA,
    receiptCore,
  );
  receipt.attestation =
    await fixture.aggregatorOptions.matrixReceiptSigner.sign({
      purpose: "skill-target-matrix-eval-receipt",
      payloadDigest: receipt.receiptDigest,
    });
  return receipt;
}

describe("Skill target matrix evaluation foundation", () => {
  it("builds and rejects non-canonical v2 plans", () => {
    const plan = buildSkillTargetMatrixEvalPlan({
      matrixEvalId: "matrix-plan-smoke",
      nonce: "matrix-plan-smoke-nonce",
      tenantId: TENANT_ID,
      skillName: "skill-smoke",
      candidateId: CANDIDATE_ID,
      candidateContentDigest: `sha256:${"5".repeat(64)}`,
      baselineId: BASELINE_ID,
      baselineReleaseDigest: null,
      expectedActiveContentDigest: `sha256:${"6".repeat(64)}`,
      expectedActiveRevision: 1,
      dependencyLockDigest: `sha256:${"7".repeat(64)}`,
      runtimeManifestDigest: `sha256:${"8".repeat(64)}`,
      targetMatrixRoot: TARGET_MATRIX_ROOT,
      matrixAuthorityRoot: `sha256:${"9".repeat(64)}`,
      maxTotalWallClockMs: 1_000,
      aggregateReceiptTtlMs: 1_000,
      familywiseErrorRate: 0.05,
      comparisonCorrection: "bonferroni-two-sided",
      issuedAt: FIXED_TIME,
      expiresAt: new Date(
        new Date(FIXED_TIME).getTime() + 10_000,
      ).toISOString(),
      cells: [
        {
          cellId: "cell-smoke",
          invocationId: "invocation-smoke",
          invocationNonce: "invocation-smoke-nonce",
          runtimeId: "node22-smoke",
          targetEnvironmentRef: "environment-smoke",
          environmentDigest: ENVIRONMENT_DIGEST,
          suiteRef: RUN_REQUEST.suiteRef,
          suiteDigest: `sha256:${"a".repeat(64)}`,
          policyDigest: `sha256:${"b".repeat(64)}`,
          evaluationAuthorityRoot: `sha256:${"c".repeat(64)}`,
          provenanceAudience: PROVENANCE_AUDIENCE,
          trainerAuthority: TRAINER_AUTHORITY,
          trainerRevision: TRAINER_REVISION,
          maximumCellSettlementMs: 500,
        },
      ],
    });
    expect(verifySkillTargetMatrixEvalPlan(plan)).toEqual(plan);
    expect(() =>
      verifySkillTargetMatrixEvalPlan({
        ...plan,
        schema: `${SKILL_TARGET_MATRIX_EVAL_PLAN_SCHEMA}-future`,
      }),
    ).toThrow(/schema/i);
    const {
      schema: ignoredSchema,
      planDigest: ignoredDigest,
      ...planInput
    } = structuredClone(plan);
    void ignoredSchema;
    void ignoredDigest;
    expect(() =>
      buildSkillTargetMatrixEvalPlan({
        ...planInput,
        cells: Array.from({ length: 65 }, (_, index) => ({
          ...plan.cells[0],
          cellId: `cell-limit-${index}`,
          invocationId: `invocation-limit-${index}`,
          invocationNonce: `invocation-limit-nonce-${index}`,
        })),
      }),
    ).toThrow(/length/i);
    expect(() =>
      buildSkillTargetMatrixEvalPlan({
        ...planInput,
        cells: [
          plan.cells[0],
          {
            ...plan.cells[0],
            cellId: "cell-smoke-second",
            invocationId: "invocation-smoke-second",
          },
        ],
      }),
    ).toThrow(/invocationNonce.*unique/i);
    let proxyTrapCount = 0;
    const planProxy = new Proxy(plan, {
      get() {
        proxyTrapCount += 1;
        throw new Error("plan proxy trap must not execute");
      },
      ownKeys() {
        proxyTrapCount += 1;
        throw new Error("plan proxy trap must not execute");
      },
    });
    expect(() => verifySkillTargetMatrixEvalPlan(planProxy)).toThrow(/Proxy/);
    expect(proxyTrapCount).toBe(0);
    let getterReads = 0;
    const getterPlan = structuredClone(plan);
    Object.defineProperty(getterPlan, "planDigest", {
      enumerable: true,
      configurable: true,
      get() {
        getterReads += 1;
        return plan.planDigest;
      },
    });
    expect(() => verifySkillTargetMatrixEvalPlan(getterPlan)).toThrow(
      /own data property/i,
    );
    expect(getterReads).toBe(0);
  });

  it("executes the ReleaseTrain Eval adapter through two real Gate cells and the matrix verifier", async () => {
    const firstHarness = makeHarness();
    const secondHarness = makeHarness();
    const calibration = await runEvolutionEvalGate(
      firstHarness.gate,
      RUN_REQUEST,
    );
    const baselineReleaseDigest = matrixDigest(
      "release-train-real-eval-baseline",
      "v1",
    );
    const fixture = makeMatrixComposition({
      calibration,
      firstHarness,
      secondHarness,
      baselineReleaseDigest,
      useCanonicalCandidate: true,
      fixtureId: "release-train-adapter",
    });
    const plan = createEvolutionPlan({
      tenantId: fixture.plan.tenantId,
      skillId: fixture.plan.skillName,
      gitCommit: "a".repeat(40),
      baselineReleaseDigest,
      baselineId: fixture.plan.baselineId,
      baselineContentDigest: fixture.plan.expectedActiveContentDigest,
      baselineRevision: fixture.plan.expectedActiveRevision,
      candidateId: fixture.plan.candidateId,
      candidateDigest: fixture.plan.candidateContentDigest,
      wikiRevisionDigest: matrixDigest("release-train-wiki", "v1"),
      evalSuiteDigest: calibration.suiteDigest,
      matrixEvalPlanDigest: fixture.plan.planDigest,
      targetMatrixDigest: fixture.plan.targetMatrixRoot,
      riskTier: "low",
      rolloutPolicyDigest: matrixDigest("release-train-rollout", "v1"),
      metricPolicyDigest: matrixDigest("release-train-metrics", "v1"),
      permissionManifestDigest: matrixDigest("release-train-permissions", "v1"),
      policyDigest: calibration.policyDigest,
      requestedCapabilityDigests: [],
      baselineCapabilityDigests: [],
      rootBudget: { tokens: 10_000, cost: 100, timeMs: 90_000, turns: 16 },
      expiresAt: "2030-01-01T00:00:00.000Z",
      triggerDigest: matrixDigest("release-train-trigger", "v1"),
    });
    let stored = null;
    const outputLedger = {
      load: vi.fn(() => stored),
      commit: vi.fn((input) => {
        stored = {
          ...structuredClone(input),
          valueDigest: matrixDigest("release-train-stage-value", input.value),
        };
        return { committed: true };
      }),
    };
    const durability = {
      retain: vi.fn(async (receipt) => ({
        durable: true,
        receiptDigest: receipt.receiptDigest,
      })),
    };
    const stage = createEvolutionEvalStage({
      aggregator: new SkillTargetMatrixEvalAggregator(
        fixture.aggregatorOptions,
      ),
      receiptVerifier: new SkillTargetMatrixEvalReceiptVerifier(
        fixture.verifierOptions,
      ),
      planRef: fixture.planRef,
      expectedReceipt: fixture.expected,
      durability,
      outputLedger,
      usage: { tokens: 1, cost: 0, timeMs: 1, turns: 1 },
    });
    const context = Object.freeze({
      plan,
      stage: "eval",
      operationKey: matrixDigest("release-train-eval-operation", "v1"),
      inputDigest: plan.candidateDigest,
    });

    await expect(stage(context)).resolves.toMatchObject({
      stage: "eval",
      inputDigest: plan.candidateDigest,
      outputDigest: expect.stringMatching(/^sha256:/u),
      durable: true,
    });
    expect(stored.value).toMatchObject({
      decision: "accepted",
      cellCount: 2,
      targetMatrixRoot: plan.targetMatrixDigest,
    });
    expect(durability.retain).toHaveBeenCalledTimes(1);
    expect(outputLedger.commit).toHaveBeenCalledTimes(1);
  }, 30_000);

  it.runIf(Boolean(process.env.CC_RELEASE_TRAIN_MATRIX_ROOT))(
    "materializes a real matrix Eval stage for the cross-process ReleaseTrain",
    async () => {
      const root = path.resolve(process.env.CC_RELEASE_TRAIN_MATRIX_ROOT);
      const request = JSON.parse(
        fs.readFileSync(path.join(root, "matrix-request.json"), "utf8"),
      );
      const firstHarness = makeHarness({ tenantId: request.tenantId });
      const secondHarness = makeHarness({ tenantId: request.tenantId });
      const calibration = await runEvolutionEvalGate(
        firstHarness.gate,
        RUN_REQUEST,
      );
      const fixture = makeMatrixComposition({
        calibration,
        firstHarness,
        secondHarness,
        baselineReleaseDigest: request.baselineReleaseDigest,
        expectedActiveContentDigest: request.baselineContentDigest,
        expectedActiveRevision: request.baselineRevision,
        fixtureId: "release-train-process",
        candidateOverride: request.candidate,
        tenantId: request.tenantId,
        skillName: request.skillName,
      });
      const planResult = {
        matrixPlan: fixture.plan,
        matrixPlanRef: fixture.planRef,
        expectedReceipt: fixture.expected,
        evalSuiteDigest: calibration.suiteDigest,
        policyDigest: calibration.policyDigest,
      };
      fs.writeFileSync(
        path.join(root, "matrix-plan.json"),
        `${JSON.stringify(planResult)}\n`,
        "utf8",
      );
      if (request.mode === "plan") return;

      if (request.mode === "promotion") {
        const receipt = JSON.parse(
          fs.readFileSync(path.join(root, "matrix-stage-output.json"), "utf8"),
        ).value;
        const review = request.reviewRecord.value;
        const resolverDescriptor = {
          schema: SKILL_EVALUATED_PROMOTION_RECEIPT_RESOLVER_SCHEMA,
          authorityId: "authority:release-train-matrix-receipts",
          trust: "trusted",
          revision: 1,
          handlerArtifactDigest: matrixDigest(
            "release-train-matrix-receipt-resolver",
            "v1",
          ),
        };
        const evaluatedPromotionProvider =
          createSkillEvaluatedPromotionProvider({
            authorityId: "authority:release-train-evaluated-promotion",
            handlerArtifactDigest: matrixDigest(
              "release-train-evaluated-promotion",
              "v1",
            ),
            revision: 1,
            verifier: new SkillTargetMatrixEvalReceiptVerifier(
              fixture.verifierOptions,
            ),
            receiptResolver: {
              ...resolverDescriptor,
              resolve(resolutionRequest) {
                return {
                  ...resolverDescriptor,
                  schema: SKILL_EVALUATED_PROMOTION_RECEIPT_RESOLUTION_SCHEMA,
                  tenantId: resolutionRequest.tenantId,
                  receiptDigest: resolutionRequest.receiptDigest,
                  matrixReceipt: receipt,
                  resolvedAt: FIXED_TIME,
                };
              },
            },
          });
        const promotionReviewProvider = createSkillPromotionReviewProvider({
          tenantId: request.tenantId,
          authorityId: "authority:release-train-human-review",
          handlerArtifactDigest: matrixDigest(
            "release-train-human-review",
            "v1",
          ),
          revision: 1,
          decisionResolver: {
            resolve(resolutionRequest) {
              return {
                schema: SKILL_PROMOTION_REVIEW_RESOLUTION_SCHEMA,
                authorityId: "authority:release-train-human-review",
                handlerArtifactDigest: matrixDigest(
                  "release-train-human-review",
                  "v1",
                ),
                revision: 1,
                tenantId: resolutionRequest.tenantId,
                receiptDigest: resolutionRequest.receiptDigest,
                decision: review.decision,
                resolvedAt: FIXED_TIME,
              };
            },
          },
          decisionVerifier: { verify: () => true },
          now: () => Date.parse(FIXED_TIME),
        });
        const policyReceipt = buildSkillPromotionReviewEnvelope(
          review.decision.receiptDigest,
        );
        const promotionRequest = buildSkillMutationRequest({
          tenantId: request.tenantId,
          audience: "worker:release-train-promotion",
          operationId: "promotion:release-train-process",
          operation: SKILL_MUTATION_OPERATIONS.PROMOTE,
          transitionSubjectDigest: digestSkillMutationTransitionSubject({
            tenantId: request.tenantId,
            skillName: request.skillName,
            operation: SKILL_MUTATION_OPERATIONS.PROMOTE,
            candidateId: request.candidate.candidateId,
            rollbackTargetReleaseDigest: null,
            dependencyLockDigest: receipt.dependencyLockDigest,
            expectedActiveContentDigest: receipt.expectedActiveContentDigest,
            expectedActiveRevision: receipt.expectedActiveRevision,
          }),
          skillName: request.skillName,
          targetScope: SKILL_MUTATION_TARGET_SCOPES.ACTIVE,
          expectedTargetDigest: receipt.expectedActiveContentDigest,
          expectedTargetRevision: receipt.expectedActiveRevision,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          nonce: "release_train_process_promotion_nonce_0001",
          receipts: {
            candidateReceipt: "candidate:signed:release-train",
            evalReceipt: buildSkillEvaluatedPromotionReceiptEnvelope(receipt),
            policyReceipt,
            actorReceipt: "actor:signed:release-train",
            parentReceipt: "parent:signed:release-train",
            targetReceipt: "target:signed:release-train",
          },
        });
        const authorityHarness = promotionAuthority();
        const releaseRegistry = new SkillReleaseRegistry({
          tenantId: request.tenantId,
          rootDir: path.join(root, "release-train-registry"),
          secure: false,
          transactionLedger: new PromotionTransactionLedger(),
        });
        const controller = createSkillEvaluatedPromotionControlPlane({
          authority: authorityHarness.authority,
          candidateRegistry: {
            tenantId: request.tenantId,
            read(candidateId) {
              expect(candidateId).toBe(request.candidate.candidateId);
              return request.candidate;
            },
          },
          evaluatedPromotionProvider,
          promotionReviewProvider,
          releaseRegistry,
        });
        const entries = new Map([
          [
            "eval",
            JSON.parse(
              fs.readFileSync(
                path.join(root, "matrix-stage-output.json"),
                "utf8",
              ),
            ),
          ],
          ["review", request.reviewRecord],
          ["pilot", request.pilotRecord],
        ]);
        const promotionOutputPath = path.join(
          root,
          "promotion-stage-output.json",
        );
        const outputLedger = {
          load: ({ stage }) => entries.get(stage) ?? null,
          commit: (input) => {
            const stored = {
              ...structuredClone(input),
              valueDigest: matrixDigest(
                "release-train-process-promotion-stage-output",
                input.value,
              ),
            };
            entries.set(input.stage, stored);
            fs.writeFileSync(
              promotionOutputPath,
              `${JSON.stringify(stored)}\n`,
              "utf8",
            );
            return { committed: true };
          },
        };
        const stage = createEvolutionPromotionStage({
          controller,
          releaseRegistry,
          promotionInput: {
            authorization: {
              capability:
                await authorityHarness.authority.authorize(promotionRequest),
              request: promotionRequest,
            },
            candidateId: request.candidate.candidateId,
            matrixContext: {
              matrixEvalId: receipt.matrixEvalId,
              baselineId: receipt.baselineId,
              matrixAuthorityRoot: receipt.matrixAuthorityRoot,
              planDigest: receipt.planDigest,
            },
          },
          outputLedger,
          effectiveAt: FIXED_TIME,
          usage: { tokens: 1, cost: 0, timeMs: 2, turns: 1 },
        });
        const stageReceipt = await stage(request.context);
        fs.writeFileSync(
          path.join(root, "promotion-stage-receipt.json"),
          `${JSON.stringify(stageReceipt)}\n`,
          "utf8",
        );
        expect(entries.get("promotion")).toMatchObject({
          value: {
            state: { revision: 1 },
            release: {
              candidateId: request.candidate.candidateId,
              contentDigest: request.candidate.contentDigest,
            },
          },
        });
        return;
      }

      const stageOutputPath = path.join(root, "matrix-stage-output.json");
      let stored = fs.existsSync(stageOutputPath)
        ? JSON.parse(fs.readFileSync(stageOutputPath, "utf8"))
        : null;
      const outputLedger = {
        load: () => stored,
        commit: (input) => {
          stored = {
            ...structuredClone(input),
            valueDigest: matrixDigest(
              "release-train-process-matrix-stage-output",
              input.value,
            ),
          };
          fs.writeFileSync(
            stageOutputPath,
            `${JSON.stringify(stored)}\n`,
            "utf8",
          );
          return { committed: true };
        },
      };
      const durability = {
        retain: async (receipt) => {
          fs.writeFileSync(
            path.join(root, "matrix-receipt.json"),
            `${JSON.stringify(receipt)}\n`,
            "utf8",
          );
          return { durable: true, receiptDigest: receipt.receiptDigest };
        },
      };
      const stage = createEvolutionEvalStage({
        aggregator: new SkillTargetMatrixEvalAggregator(
          fixture.aggregatorOptions,
        ),
        receiptVerifier: new SkillTargetMatrixEvalReceiptVerifier(
          fixture.verifierOptions,
        ),
        planRef: fixture.planRef,
        expectedReceipt: fixture.expected,
        durability,
        outputLedger,
        usage: { tokens: 1, cost: 0, timeMs: 2, turns: 1 },
      });
      const stageReceipt = await stage(request.context);
      fs.writeFileSync(
        path.join(root, "matrix-stage-receipt.json"),
        `${JSON.stringify(stageReceipt)}\n`,
        "utf8",
      );
      expect(stored.value).toMatchObject({
        decision: "accepted",
        candidateId: request.candidate.candidateId,
        candidateContentDigest: request.candidate.contentDigest,
      });
    },
    120_000,
  );

  it.each([
    ["non-durable", /not durably retained/i],
    ["substitute", /readback was substituted/i],
  ])(
    "fails closed when the child receipt store attack is %s",
    async (childReceiptStoreAttack, expectedError) => {
      const firstHarness = makeHarness();
      const secondHarness = makeHarness();
      const calibration = await runEvolutionEvalGate(
        firstHarness.gate,
        RUN_REQUEST,
      );
      const fixture = makeMatrixComposition({
        calibration,
        firstHarness,
        secondHarness,
        fixtureId: `child-store-${childReceiptStoreAttack}`,
        childReceiptStoreAttack,
      });
      const aggregator = new SkillTargetMatrixEvalAggregator(
        fixture.aggregatorOptions,
      );
      await expect(
        evaluateSkillTargetMatrix(aggregator, fixture.planRef),
      ).rejects.toThrow(expectedError);
    },
    60_000,
  );

  it("runs two real accepted Gate cells sharing an environment and verifies the signed conjunction receipt", async () => {
    const firstHarness = makeHarness();
    const secondHarness = makeHarness();
    const calibration = await runEvolutionEvalGate(
      firstHarness.gate,
      RUN_REQUEST,
    );
    expect(calibration.decision).toBe("accepted");
    const fixture = makeMatrixComposition({
      calibration,
      firstHarness,
      secondHarness,
      expectedActiveContentDigest: EMPTY_SKILL_ACTIVE_DIGEST,
      expectedActiveRevision: 0,
      useCanonicalCandidate: true,
    });
    const aggregator = new SkillTargetMatrixEvalAggregator(
      fixture.aggregatorOptions,
    );
    const receipt = await evaluateSkillTargetMatrix(
      aggregator,
      fixture.planRef,
    );
    expect(receipt).toMatchObject({
      schema: SKILL_TARGET_MATRIX_EVAL_RECEIPT_SCHEMA,
      decision: "accepted",
      reasonCodes: ["MATRIX_ALL_CELLS_ACCEPTED"],
      cellCount: 2,
      targetMatrixRoot: fixture.plan.targetMatrixRoot,
    });
    expect(receipt.cellResults.map((cell) => cell.cellId)).toEqual([
      "cell-linux",
      "cell-windows",
    ]);
    expect(
      new Set(receipt.cellResults.map((cell) => cell.environmentDigest)).size,
    ).toBe(1);
    expect(
      new Set(receipt.cellResults.map((cell) => cell.evaluationContextDigest))
        .size,
    ).toBe(2);
    expect(fixture.childReceiptRecords.size).toBe(2);
    expect(
      [...fixture.childReceiptRecords.values()].map(({ kind }) => kind),
    ).toEqual(["gate-receipt", "gate-receipt"]);
    expect(
      [...fixture.childReceiptRecords.values()]
        .map(({ receiptDigest }) => receiptDigest)
        .sort(),
    ).toEqual(
      receipt.cellResults
        .map(({ childReceiptDigest }) => childReceiptDigest)
        .sort(),
    );
    const verifier = new SkillTargetMatrixEvalReceiptVerifier(
      fixture.verifierOptions,
    );
    await expect(
      verifySkillTargetMatrixEvalReceipt(verifier, receipt, fixture.expected),
    ).resolves.toEqual(receipt);

    const underpoweredReceipt = await resignMatrixReceipt(
      fixture,
      receipt,
      (mutable) => {
        mutable.cellResults[0].confidenceZ = 1.96;
      },
    );
    await expect(
      verifySkillTargetMatrixEvalReceipt(
        verifier,
        underpoweredReceipt,
        fixture.expected,
      ),
    ).rejects.toThrow(/decision|reasonCodes/i);

    const evalReceipt = buildSkillEvaluatedPromotionReceiptEnvelope(receipt);
    expect(parseSkillEvaluatedPromotionReceiptEnvelope(evalReceipt)).toEqual({
      schema: "chainlesschain.skill-evaluated-promotion-receipt-envelope/v1",
      receiptDigest: receipt.receiptDigest,
    });
    const candidate = fixture.candidate;
    const reviewMatrixBinding = {
      schema: "chainlesschain.skill-evaluated-promotion-binding/v1",
      tenantId: receipt.tenantId,
      skillName: receipt.skillName,
      candidateId: receipt.candidateId,
      candidateContentDigest: receipt.candidateContentDigest,
      expectedActiveContentDigest: receipt.expectedActiveContentDigest,
      expectedActiveRevision: receipt.expectedActiveRevision,
      matrixEvalId: receipt.matrixEvalId,
      matrixReceiptDigest: receipt.receiptDigest,
      decisionCommitmentDigest: receipt.decisionCommitmentDigest,
      expiresAt: receipt.expiresAt,
      receiptResolution: {
        authorityId: "authority:durable-matrix-receipts",
        resolverDescriptorDigest: matrixDigest("review-matrix-resolver", "v1"),
        resolverRevision: 1,
        resolvedAt: new Date().toISOString(),
      },
    };
    const reviewState = {
      tenantId: receipt.tenantId,
      skillName: receipt.skillName,
      revision: 0,
      activeReleaseDigest: null,
    };
    const reviewPacket = buildSkillPromotionReviewPacket({
      candidate,
      activeRelease: null,
      matrixBinding: reviewMatrixBinding,
      state: reviewState,
    });
    const reviewNow = Date.now();
    const reviewDecisionCore = {
      schema: SKILL_PROMOTION_REVIEW_DECISION_SCHEMA,
      tenantId: receipt.tenantId,
      skillName: receipt.skillName,
      candidateId: receipt.candidateId,
      packetDigest: reviewPacket.packetDigest,
      decision: "approved",
      automated: false,
      reviewerIds: ["human:matrix-reviewer", "human:security-reviewer"],
      quorum: 2,
      reason:
        "Reviewed evidence, candidate diff, permissions, Eval, and runtimes.",
      decidedAt: new Date(reviewNow).toISOString(),
      expiresAt: new Date(reviewNow + 10 * 60_000).toISOString(),
      acknowledgedContentRiskDigest: reviewPacket.contentRisk.detected
        ? reviewPacket.contentRisk.contentRiskDigest
        : null,
    };
    const reviewReceiptDigest = matrixDigest(
      "chainlesschain.skill-promotion-review-decision/v1",
      reviewDecisionCore,
    );
    const reviewSignature = createHmac("sha256", "matrix-review-test-key")
      .update(reviewReceiptDigest)
      .digest("base64url");
    const reviewDecision = {
      ...reviewDecisionCore,
      receiptDigest: reviewReceiptDigest,
      signature: reviewSignature,
    };
    const policyReceipt =
      buildSkillPromotionReviewEnvelope(reviewReceiptDigest);
    const promotionRequest = buildSkillMutationRequest({
      tenantId: receipt.tenantId,
      audience: "worker:promotion",
      operationId: "promotion:matrix-accepted",
      operation: SKILL_MUTATION_OPERATIONS.PROMOTE,
      transitionSubjectDigest: digestSkillMutationTransitionSubject({
        tenantId: receipt.tenantId,
        skillName: receipt.skillName,
        operation: SKILL_MUTATION_OPERATIONS.PROMOTE,
        candidateId: receipt.candidateId,
        rollbackTargetReleaseDigest: null,
        dependencyLockDigest: receipt.dependencyLockDigest,
        expectedActiveContentDigest: receipt.expectedActiveContentDigest,
        expectedActiveRevision: receipt.expectedActiveRevision,
      }),
      skillName: receipt.skillName,
      targetScope: SKILL_MUTATION_TARGET_SCOPES.ACTIVE,
      expectedTargetDigest: receipt.expectedActiveContentDigest,
      expectedTargetRevision: receipt.expectedActiveRevision,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      nonce: "matrix_promotion_nonce_0001",
      receipts: {
        candidateReceipt: "candidate:signed:matrix",
        evalReceipt,
        policyReceipt,
        actorReceipt: "actor:signed:matrix",
        parentReceipt: "parent:signed:matrix",
        targetReceipt: "target:signed:matrix",
      },
    });
    const resolverDescriptor = {
      schema: SKILL_EVALUATED_PROMOTION_RECEIPT_RESOLVER_SCHEMA,
      authorityId: "authority:durable-matrix-receipts",
      trust: "trusted",
      revision: 1,
      handlerArtifactDigest: matrixDigest(
        "test-durable-receipt-resolver",
        "v1",
      ),
    };
    const resolverRequests = [];
    const receiptResolver = {
      ...resolverDescriptor,
      resolve(request) {
        resolverRequests.push({ ...request });
        return {
          ...resolverDescriptor,
          schema: SKILL_EVALUATED_PROMOTION_RECEIPT_RESOLUTION_SCHEMA,
          tenantId: request.tenantId,
          receiptDigest: request.receiptDigest,
          matrixReceipt: receipt,
          resolvedAt: new Date().toISOString(),
        };
      },
    };
    await expect(
      verifySkillEvaluatedPromotionBinding({
        verifier,
        receiptResolver,
        matrixContext: {
          matrixEvalId: receipt.matrixEvalId,
          baselineId: receipt.baselineId,
          matrixAuthorityRoot: receipt.matrixAuthorityRoot,
          planDigest: receipt.planDigest,
        },
        authorization: {
          capability: Object.freeze({}),
          request: promotionRequest,
        },
        candidate: {
          candidateId: receipt.candidateId,
          contentDigest: receipt.candidateContentDigest,
          dependencyLockDigest: receipt.dependencyLockDigest,
          runtimeManifestDigest: receipt.runtimeManifestDigest,
          targetMatrixRoot: receipt.targetMatrixRoot,
        },
        state: {
          activeReleaseDigest: receipt.baselineReleaseDigest,
          revision: receipt.expectedActiveRevision,
        },
        activeContentDigest: receipt.expectedActiveContentDigest,
      }),
    ).resolves.toMatchObject({
      candidateId: receipt.candidateId,
      matrixReceiptDigest: receipt.receiptDigest,
      decisionCommitmentDigest: receipt.decisionCommitmentDigest,
      receiptResolution: {
        authorityId: resolverDescriptor.authorityId,
        resolverRevision: resolverDescriptor.revision,
      },
    });
    expect(resolverRequests).toEqual([
      {
        schema: SKILL_EVALUATED_PROMOTION_RECEIPT_RESOLUTION_REQUEST_SCHEMA,
        tenantId: receipt.tenantId,
        receiptDigest: receipt.receiptDigest,
      },
    ]);
    const provider = createSkillEvaluatedPromotionProvider({
      authorityId: "authority:evaluated-promotion-provider",
      handlerArtifactDigest: matrixDigest(
        "test-evaluated-promotion-provider",
        "v1",
      ),
      receiptResolver,
      revision: 1,
      verifier,
    });
    const promotionReviewProvider = createSkillPromotionReviewProvider({
      tenantId: receipt.tenantId,
      authorityId: "authority:human-matrix-review",
      handlerArtifactDigest: matrixDigest("human-matrix-review", "v1"),
      revision: 1,
      decisionResolver: {
        resolve(request) {
          return {
            schema: SKILL_PROMOTION_REVIEW_RESOLUTION_SCHEMA,
            authorityId: "authority:human-matrix-review",
            handlerArtifactDigest: matrixDigest("human-matrix-review", "v1"),
            revision: 1,
            tenantId: request.tenantId,
            receiptDigest: request.receiptDigest,
            decision: reviewDecision,
            resolvedAt: new Date().toISOString(),
          };
        },
      },
      decisionVerifier: {
        verify({ decision }) {
          return (
            decision.signature ===
            createHmac("sha256", "matrix-review-test-key")
              .update(decision.receiptDigest)
              .digest("base64url")
          );
        },
      },
      now: Date.now,
    });
    await expect(
      provider.verify({
        matrixContext: {
          matrixEvalId: receipt.matrixEvalId,
          baselineId: receipt.baselineId,
          matrixAuthorityRoot: receipt.matrixAuthorityRoot,
          planDigest: receipt.planDigest,
        },
        authorization: {
          capability: Object.freeze({}),
          request: promotionRequest,
        },
        candidate: {
          candidateId: receipt.candidateId,
          contentDigest: receipt.candidateContentDigest,
          dependencyLockDigest: receipt.dependencyLockDigest,
          runtimeManifestDigest: receipt.runtimeManifestDigest,
          targetMatrixRoot: receipt.targetMatrixRoot,
        },
        state: {
          activeReleaseDigest: receipt.baselineReleaseDigest,
          revision: receipt.expectedActiveRevision,
        },
        activeContentDigest: receipt.expectedActiveContentDigest,
      }),
    ).resolves.toMatchObject({
      matrixReceiptDigest: receipt.receiptDigest,
      candidateId: receipt.candidateId,
    });
    expect(resolverRequests).toHaveLength(2);

    const authorityHarness = promotionAuthority();
    const candidateRegistry = {
      tenantId: receipt.tenantId,
      read: (candidateId) => {
        expect(candidateId).toBe(candidate.candidateId);
        return candidate;
      },
    };
    const processCrashRoot =
      process.env.CC_TEST_PROMOTION_CRASH_ROOT?.trim() || null;
    const promotionRoot = processCrashRoot
      ? path.join(processCrashRoot, "promotion")
      : fs.mkdtempSync(
          path.join(fs.realpathSync(os.tmpdir()), "cc-matrix-promotion-"),
        );
    if (processCrashRoot) {
      fs.mkdirSync(promotionRoot, { recursive: true, mode: 0o700 });
    } else {
      promotionRoots.push(promotionRoot);
    }
    const transactionLedger = new PromotionTransactionLedger();
    const registryOptions = {
      tenantId: receipt.tenantId,
      rootDir: path.join(promotionRoot, "releases"),
      secure: false,
      transactionLedger,
    };
    const releaseRegistry = new SkillReleaseRegistry(registryOptions);
    const memoryRoot = createStructuredMemoryAgentControlPlaneFixture({
      tenantId: receipt.tenantId,
      ...(processCrashRoot
        ? { rootDir: processCrashRoot, durableLedger: true }
        : {}),
    });
    if (!processCrashRoot) memoryRootFixtures.push(memoryRoot);
    const runtime = new AgentRuntime({
      kind: "agent",
      policy: {
        model: "matrix-promotion-model",
        provider: "matrix-promotion-provider",
        sessionId: "matrix-promotion-session",
      },
      deps: { structuredMemoryControlPlane: memoryRoot.controlPlane },
    });
    const evaluatedOnly = runtime.createEvolutionPromotionControlPlane({
      authority: authorityHarness.authority,
      candidateRegistry,
      evaluatedPromotionProvider: provider,
      promotionReviewProvider,
      releaseRegistry,
    });

    const transitionAuthorityHarness = promotionAuthority();
    const transitionReleaseRegistry = new SkillReleaseRegistry({
      tenantId: receipt.tenantId,
      rootDir: path.join(promotionRoot, "transition-releases"),
      secure: false,
      transactionLedger: new PromotionTransactionLedger(),
    });
    const transitionControlPlane = createSkillEvaluatedPromotionControlPlane({
      authority: transitionAuthorityHarness.authority,
      candidateRegistry,
      evaluatedPromotionProvider: provider,
      promotionReviewProvider,
      releaseRegistry: transitionReleaseRegistry,
    });
    let transitionNow = Date.now();
    const transitionStorage = transitionArtifactStorage(
      promotionRoot,
      () => transitionNow,
    );
    const transitionSource = {
      candidateCreatedRef: "candidate-event://matrix-accepted",
      evalCompletedRef: "eval-event://matrix-accepted",
      humanTaskSettledRef: "human-task://matrix-accepted",
    };
    const transitionEffectiveAt = new Date(transitionNow).toISOString();
    const transitionMatrixContext = {
      matrixEvalId: receipt.matrixEvalId,
      baselineId: receipt.baselineId,
      matrixAuthorityRoot: receipt.matrixAuthorityRoot,
      planDigest: receipt.planDigest,
    };
    let transitionSourceAvailable = true;
    const transitionSourceVerifier = createSkillRegistryTransitionSource({
      tenantId: receipt.tenantId,
      candidateCreatedResolver: {
        resolve({ ref }) {
          if (!transitionSourceAvailable) {
            throw new Error("transition source authority revoked");
          }
          return {
            schema: SKILL_REGISTRY_CANDIDATE_CREATED_RESOLUTION_SCHEMA,
            authenticated: true,
            durable: true,
            tenantId: receipt.tenantId,
            ref,
            candidateId: candidate.candidateId,
            skillName: candidate.skillName,
            candidateReceipt: promotionRequest.receipts.candidateReceipt,
            actorReceipt: promotionRequest.receipts.actorReceipt,
            parentReceipt: promotionRequest.receipts.parentReceipt,
            targetReceipt: promotionRequest.receipts.targetReceipt,
            effectiveAt: transitionEffectiveAt,
            receiptDigest: matrixDigest("candidate-created", ref),
          };
        },
      },
      evalCompletedResolver: {
        resolve({ ref }) {
          return {
            schema: SKILL_REGISTRY_EVAL_COMPLETED_RESOLUTION_SCHEMA,
            authenticated: true,
            durable: true,
            tenantId: receipt.tenantId,
            ref,
            candidateId: candidate.candidateId,
            skillName: candidate.skillName,
            matrixContext: transitionMatrixContext,
            evalReceipt: promotionRequest.receipts.evalReceipt,
            effectiveAt: transitionEffectiveAt,
            receiptDigest: matrixDigest("eval-completed", ref),
          };
        },
      },
      humanTaskSettledResolver: {
        resolve({ ref }) {
          return {
            schema: SKILL_REGISTRY_HUMAN_TASK_SETTLED_RESOLUTION_SCHEMA,
            authenticated: true,
            durable: true,
            tenantId: receipt.tenantId,
            ref,
            candidateId: candidate.candidateId,
            skillName: candidate.skillName,
            policyReceipt: promotionRequest.receipts.policyReceipt,
            effectiveAt: transitionEffectiveAt,
            receiptDigest: matrixDigest("human-task-settled", ref),
          };
        },
      },
    });
    const transitionDescriptor = {
      tenantId: receipt.tenantId,
      artifactTenantId: "artifact-tenant-primary",
      streamId: "registry-transition-stream",
      audience: "worker:promotion",
      purpose: "evolution-ledger",
    };
    let crashAfterRegistryCommit = true;
    const transitionAdapter = createSkillRegistryTransitionLedgerAdapter({
      descriptor: transitionDescriptor,
      artifactPorts: transitionStorage.artifactPorts,
      ledger: transitionStorage.ledger,
      ledgerArtifactResolver: transitionStorage.resolver,
      sourceVerifier: transitionSourceVerifier,
      candidateRegistry,
      releaseRegistry: transitionReleaseRegistry,
      authority: transitionAuthorityHarness.authority,
      controlPlane: transitionControlPlane,
      now: () => transitionNow,
      crashHook(phase) {
        if (phase === "after-registry-commit" && crashAfterRegistryCommit) {
          crashAfterRegistryCommit = false;
          throw new Error("simulated registry commit response loss");
        }
      },
    });
    await expect(
      transitionAdapter.enqueue(transitionSource),
    ).resolves.toMatchObject({ queued: true, recovered: false });
    transitionSourceAvailable = false;
    await expect(transitionAdapter.processNext()).rejects.toThrow(
      /CandidateCreated resolver failed closed/u,
    );
    expect(
      transitionReleaseRegistry.readState(candidate.skillName),
    ).toMatchObject({ revision: 0, activeReleaseDigest: null });
    expect(transitionStorage.state.events).toHaveLength(1);
    transitionSourceAvailable = true;
    await expect(transitionAdapter.processNext()).rejects.toThrow(
      /simulated registry commit response loss/u,
    );
    expect(
      transitionReleaseRegistry.readState(candidate.skillName),
    ).toMatchObject({ revision: 1 });
    transitionStorage.state.failAfterTypes.add(
      SKILL_REGISTRY_TRANSITION_SETTLED_EVENT_TYPE,
    );
    transitionNow += 1_000;
    const reopenedTransitionAdapter =
      createSkillRegistryTransitionLedgerAdapter({
        descriptor: transitionDescriptor,
        artifactPorts: transitionStorage.artifactPorts,
        ledger: transitionStorage.ledger,
        ledgerArtifactResolver: transitionStorage.resolver,
        sourceVerifier: transitionSourceVerifier,
        candidateRegistry,
        releaseRegistry: transitionReleaseRegistry,
        authority: transitionAuthorityHarness.authority,
        controlPlane: transitionControlPlane,
        now: () => transitionNow,
      });
    await expect(
      reopenedTransitionAdapter.processNext(),
    ).resolves.toMatchObject({
      processed: true,
      recovered: true,
      revision: 1,
    });
    expect(reopenedTransitionAdapter.list()).toMatchObject([
      { status: "committed", settlement: { revision: 1 } },
    ]);
    expect(
      reopenedTransitionAdapter.createWikiReconciliationSource().list(),
    ).toMatchObject([
      {
        schema: SKILL_WIKI_TRANSITION_SCHEMA,
        authenticated: true,
        durable: true,
        tenantId: receipt.tenantId,
        candidateId: candidate.candidateId,
        skillName: candidate.skillName,
        activeReleaseDigest: expect.stringMatching(/^sha256:/u),
        transitionDigest: expect.stringMatching(/^sha256:/u),
      },
    ]);
    expect(transitionStorage.state.events.map((event) => event.type)).toEqual([
      "skill.registry-transition.requested",
      "skill.registry-transition.attempted",
      "skill.registry-transition.settled",
    ]);
    await expect(reopenedTransitionAdapter.processNext()).resolves.toEqual({
      processed: false,
    });
    expect(
      transitionAuthorityHarness.auditEvents.map((event) => event.phase),
    ).toEqual(["authorize", "consume"]);

    const releaseTrainPlan = Object.freeze({
      tenantId: receipt.tenantId,
      skillId: candidate.skillName,
      planDigest: matrixDigest("release-train-promotion-plan", "v1"),
      candidateId: candidate.candidateId,
      candidateDigest: candidate.contentDigest,
      baselineRevision: receipt.expectedActiveRevision,
    });
    const pilotOutputDigest = matrixDigest(
      "release-train-pilot-output",
      "stable-active",
    );
    const releaseTrainEntries = new Map([
      [
        "eval",
        {
          outputDigest: receipt.receiptDigest,
          value: receipt,
          valueDigest: matrixDigest("release-train-eval-value", receipt),
        },
      ],
      [
        "review",
        {
          outputDigest: reviewReceiptDigest,
          value: { packet: reviewPacket, decision: reviewDecision },
          valueDigest: matrixDigest(
            "release-train-review-value",
            reviewDecision,
          ),
        },
      ],
      [
        "pilot",
        {
          outputDigest: pilotOutputDigest,
          value: {
            stage: "active",
            progressiveCanary: { stepId: null },
          },
          valueDigest: matrixDigest(
            "release-train-pilot-value",
            pilotOutputDigest,
          ),
        },
      ],
    ]);
    const releaseTrainOutputLedger = {
      load: vi.fn(({ stage }) => releaseTrainEntries.get(stage) ?? null),
      commit: vi.fn((input) => {
        releaseTrainEntries.set(input.stage, {
          ...structuredClone(input),
          valueDigest: matrixDigest(
            `release-train-${input.stage}-value`,
            input.value,
          ),
        });
        return { committed: true };
      }),
    };
    const promotionInput = {
      authorization: {
        capability:
          await authorityHarness.authority.authorize(promotionRequest),
        request: promotionRequest,
      },
      candidateId: candidate.candidateId,
      matrixContext: {
        matrixEvalId: receipt.matrixEvalId,
        baselineId: receipt.baselineId,
        matrixAuthorityRoot: receipt.matrixAuthorityRoot,
        planDigest: receipt.planDigest,
      },
    };
    const promotionStage = createEvolutionPromotionStage({
      controller: evaluatedOnly,
      releaseRegistry,
      promotionInput,
      outputLedger: releaseTrainOutputLedger,
      effectiveAt: new Date().toISOString(),
      usage: { tokens: 0, cost: 0, timeMs: 1, turns: 1 },
    });
    const promotionStageContext = Object.freeze({
      plan: releaseTrainPlan,
      stage: "promotion",
      operationKey: matrixDigest("release-train-promotion-operation", "v1"),
      inputDigest: pilotOutputDigest,
    });

    memoryRoot.ledgerState.failBeforeType = "memory.event.persisted";
    let pendingError;
    try {
      await promotionStage(promotionStageContext);
    } catch (error) {
      pendingError = error;
    }
    expect(pendingError).toMatchObject({
      code: "CC_PROMOTION_MEMORY_COMMIT_PENDING",
      commitState: "release-committed-memory-pending",
      promotionResult: {
        release: { candidateId: candidate.candidateId },
        state: { revision: 1 },
        reviewBinding: {
          packetDigest: reviewPacket.packetDigest,
          reviewReceiptDigest,
          contentRiskDigest: reviewPacket.contentRisk.contentRiskDigest,
          reviewerIds: ["human:matrix-reviewer", "human:security-reviewer"],
          quorum: 2,
        },
      },
    });
    const committedPromotion = pendingError.promotionResult;
    if (processCrashRoot) {
      fs.writeFileSync(
        path.join(processCrashRoot, "producer-ready.json"),
        `${JSON.stringify({
          pid: process.pid,
          receiptDigest:
            committedPromotion.memoryAuthorityReceipt.receiptDigest,
          memoryId: committedPromotion.memoryAuthorityReceipt.memoryId,
          releaseDigest: committedPromotion.release.releaseDigest,
          stateRevision: committedPromotion.state.revision,
        })}\n`,
        "utf8",
      );
      await new Promise(() => {
        setInterval(() => {}, 1_000);
      });
    }
    expect(memoryRoot.controlPlane.memory.projection().sequence).toBe(0);
    const reopenedMemoryRoot = memoryRoot.open();
    const reconciliation =
      await reopenedMemoryRoot.reconcilePromotionMemories();
    expect(reconciliation).toMatchObject({
      status: "converged",
      receiptCount: 1,
      reconciled: [
        {
          receiptDigest:
            committedPromotion.memoryAuthorityReceipt.receiptDigest,
          status: "persisted",
        },
      ],
      projection: { sequence: 1 },
    });
    const memoryTransition =
      await evaluatedOnly.recordPromotionMemory(committedPromotion);
    const promoted = { ...committedPromotion, memoryTransition };
    await expect(promotionStage(promotionStageContext)).resolves.toMatchObject({
      stage: "promotion",
      inputDigest: pilotOutputDigest,
      outputDigest: committedPromotion.release.releaseDigest,
      durable: true,
    });
    expect(releaseTrainEntries.get("promotion")).toMatchObject({
      value: {
        state: { revision: 1 },
        release: { releaseDigest: committedPromotion.release.releaseDigest },
      },
    });
    expect(releaseTrainOutputLedger.commit).toHaveBeenCalledTimes(1);
    expect(promoted).toMatchObject({
      matrixBinding: {
        candidateId: candidate.candidateId,
        matrixReceiptDigest: receipt.receiptDigest,
      },
      release: {
        candidateId: candidate.candidateId,
        contentDigest: candidate.contentDigest,
      },
      state: {
        activeReleaseDigest: expect.stringMatching(/^sha256:/u),
        revision: 1,
      },
      memoryAuthorityReceipt: {
        action: "accept",
        artifactRef: expect.stringMatching(/^sha256:/u),
        decision: "accepted",
        kind: "promotion",
        layer: "procedural",
      },
      memoryTransition: {
        event: {
          action: "accept",
          layer: "procedural",
        },
        projection: { sequence: 1 },
      },
    });
    expect(promoted.state.activeReleaseDigest).toBe(
      promoted.release.releaseDigest,
    );
    expect(promoted.memoryAuthorityReceipt.evidenceRefs).toEqual(
      [
        promoted.receipt.receiptDigest,
        receipt.receiptDigest,
        reviewReceiptDigest,
      ].sort(),
    );
    expect(
      memoryRoot.controlPlane.memory.projection().memories[
        promoted.memoryAuthorityReceipt.memoryId
      ],
    ).toMatchObject({
      artifactRef: promoted.release.releaseDigest,
      contentDigest: promoted.release.contentDigest,
      receipts: { promotion: promoted.memoryAuthorityReceipt.receiptDigest },
      status: "active",
    });
    expect(
      reopenedMemoryRoot.memory.projection().memories[
        promoted.memoryAuthorityReceipt.memoryId
      ],
    ).toEqual(
      memoryRoot.controlPlane.memory.projection().memories[
        promoted.memoryAuthorityReceipt.memoryId
      ],
    );
    await expect(
      evaluatedOnly.recordPromotionMemory(promoted),
    ).resolves.toMatchObject({
      status: "recovered",
      memory: {
        receipts: {
          promotion: promoted.memoryAuthorityReceipt.receiptDigest,
        },
      },
    });
    const reopenedReleaseRegistry = new SkillReleaseRegistry(registryOptions);
    expect(reopenedReleaseRegistry.readState(candidate.skillName)).toEqual(
      promoted.state,
    );
    expect(
      reopenedReleaseRegistry.readRelease(promoted.release.releaseDigest),
    ).toEqual(promoted.release);
    expect(authorityHarness.auditEvents.map((event) => event.phase)).toEqual([
      "authorize",
      "consume",
    ]);
    expect(evaluatedOnly.promote).toBeUndefined();
    let verifierCalls = 0;
    await expect(
      verifySkillEvaluatedPromotionBinding({
        verifier: {
          verify() {
            verifierCalls += 1;
            throw new Error("misbound resolution reached verifier");
          },
        },
        receiptResolver: {
          ...resolverDescriptor,
          resolve(request) {
            return {
              ...resolverDescriptor,
              schema: SKILL_EVALUATED_PROMOTION_RECEIPT_RESOLUTION_SCHEMA,
              tenantId: `${request.tenantId}-substituted`,
              receiptDigest: request.receiptDigest,
              matrixReceipt: receipt,
              resolvedAt: new Date().toISOString(),
            };
          },
        },
        matrixContext: {
          matrixEvalId: receipt.matrixEvalId,
          baselineId: receipt.baselineId,
          matrixAuthorityRoot: receipt.matrixAuthorityRoot,
          planDigest: receipt.planDigest,
        },
        authorization: {
          capability: Object.freeze({}),
          request: promotionRequest,
        },
        candidate: {
          candidateId: receipt.candidateId,
          contentDigest: receipt.candidateContentDigest,
          dependencyLockDigest: receipt.dependencyLockDigest,
          runtimeManifestDigest: receipt.runtimeManifestDigest,
          targetMatrixRoot: receipt.targetMatrixRoot,
        },
        state: {
          activeReleaseDigest: receipt.baselineReleaseDigest,
          revision: receipt.expectedActiveRevision,
        },
        activeContentDigest: receipt.expectedActiveContentDigest,
      }),
    ).rejects.toMatchObject({
      code: "SKILL_EVALUATED_PROMOTION_RESOLUTION_REJECTED",
    });
    expect(verifierCalls).toBe(0);
    const nonCanonicalEnvelope = JSON.stringify({
      receiptDigest: receipt.receiptDigest,
      schema: "chainlesschain.skill-evaluated-promotion-receipt-envelope/v1",
    });
    expect(() =>
      parseSkillEvaluatedPromotionReceiptEnvelope(nonCanonicalEnvelope),
    ).toThrow(/canonical encoding/i);
    let envelopeGetterReads = 0;
    const getterEnvelopeReceipt = structuredClone(receipt);
    Object.defineProperty(getterEnvelopeReceipt, "receiptDigest", {
      enumerable: true,
      configurable: true,
      get() {
        envelopeGetterReads += 1;
        return receipt.receiptDigest;
      },
    });
    expect(() =>
      buildSkillEvaluatedPromotionReceiptEnvelope(getterEnvelopeReceipt),
    ).toThrow(/own data field/i);
    expect(envelopeGetterReads).toBe(0);
    let envelopeProxyTraps = 0;
    const proxyEnvelopeReceipt = new Proxy(structuredClone(receipt), {
      ownKeys() {
        envelopeProxyTraps += 1;
        throw new Error("proxy trap must not execute");
      },
    });
    expect(() =>
      buildSkillEvaluatedPromotionReceiptEnvelope(proxyEnvelopeReceipt),
    ).toThrow(/plain object/i);
    expect(envelopeProxyTraps).toBe(0);
    await expect(
      verifySkillEvaluatedPromotionBinding({
        verifier,
        receiptResolver: {
          ...resolverDescriptor,
          resolve() {
            return {
              ...resolverDescriptor,
              schema: SKILL_EVALUATED_PROMOTION_RECEIPT_RESOLUTION_SCHEMA,
              tenantId: receipt.tenantId,
              receiptDigest: receipt.receiptDigest,
              matrixReceipt: receipt,
              resolvedAt: new Date().toISOString(),
            };
          },
        },
        matrixContext: {
          matrixEvalId: receipt.matrixEvalId,
          baselineId: receipt.baselineId,
          matrixAuthorityRoot: receipt.matrixAuthorityRoot,
          planDigest: receipt.planDigest,
        },
        authorization: {
          capability: Object.freeze({}),
          request: promotionRequest,
        },
        candidate: {
          candidateId: receipt.candidateId,
          contentDigest: receipt.candidateContentDigest,
          dependencyLockDigest: receipt.dependencyLockDigest,
          runtimeManifestDigest: receipt.runtimeManifestDigest,
          targetMatrixRoot: receipt.targetMatrixRoot,
        },
        state: {
          activeReleaseDigest: receipt.baselineReleaseDigest,
          revision: receipt.expectedActiveRevision + 1,
        },
        activeContentDigest: receipt.expectedActiveContentDigest,
      }),
    ).rejects.toMatchObject({ code: "SKILL_EVALUATED_PROMOTION_REJECTED" });
    await expect(
      evaluateSkillTargetMatrix(aggregator, fixture.planRef),
    ).rejects.toMatchObject({
      code: "CC_SKILL_TARGET_MATRIX_EVAL_REPLAYED",
    });

    const replayAggregator = new SkillTargetMatrixEvalAggregator(
      fixture.aggregatorOptions,
    );
    await expect(
      evaluateSkillTargetMatrix(replayAggregator, fixture.planRef),
    ).rejects.toThrow(/reservation replay/i);

    await expect(
      verifySkillTargetMatrixEvalReceipt(verifier, receipt, {
        ...fixture.expected,
        decision: "rejected",
      }),
    ).rejects.toThrow(/expected decision/i);
    await expect(
      verifySkillTargetMatrixEvalReceipt(
        verifier,
        { ...structuredClone(receipt), schema: `${receipt.schema}-future` },
        fixture.expected,
      ),
    ).rejects.toThrow(/schema/i);
    const tamperedSignature = structuredClone(receipt);
    tamperedSignature.attestation.value = `${receipt.attestation.value}x`;
    await expect(
      verifySkillTargetMatrixEvalReceipt(
        verifier,
        tamperedSignature,
        fixture.expected,
      ),
    ).rejects.toThrow(/signature/i);

    const invalidPlanTimeline = await resignMatrixReceipt(
      fixture,
      receipt,
      (value) => {
        value.planExpiresAt = value.planIssuedAt;
        value.reservation.expiresAt = value.planExpiresAt;
        value.expiresAt = value.issuedAt;
      },
    );
    await expect(
      verifySkillTargetMatrixEvalReceipt(
        verifier,
        invalidPlanTimeline,
        fixture.expected,
      ),
    ).rejects.toThrow(/binding|expiry/i);
    const invalidChildTimeline = await resignMatrixReceipt(
      fixture,
      receipt,
      (value) => {
        value.cellResults[0].issuedAt = new Date(
          new Date(FIXED_TIME).getTime() + 70_000,
        ).toISOString();
      },
    );
    await expect(
      verifySkillTargetMatrixEvalReceipt(
        verifier,
        invalidChildTimeline,
        fixture.expected,
      ),
    ).rejects.toThrow(/binding|expiry/i);
    const invalidAuthenticationTimeline = await resignMatrixReceipt(
      fixture,
      receipt,
      (value) => {
        value.planAuthentication.verifiedAt = new Date(
          new Date(FIXED_TIME).getTime() + 70_000,
        ).toISOString();
      },
    );
    await expect(
      verifySkillTargetMatrixEvalReceipt(
        verifier,
        invalidAuthenticationTimeline,
        fixture.expected,
      ),
    ).rejects.toThrow(/binding|expiry/i);
    const invalidFinalizationTimeline = await resignMatrixReceipt(
      fixture,
      receipt,
      (value) => {
        value.finalization.finalizedAt = new Date(
          new Date(FIXED_TIME).getTime() + 70_000,
        ).toISOString();
      },
    );
    await expect(
      verifySkillTargetMatrixEvalReceipt(
        verifier,
        invalidFinalizationTimeline,
        fixture.expected,
      ),
    ).rejects.toThrow(/binding|expiry/i);
    const reserveBeforeAuthentication = await resignMatrixReceipt(
      fixture,
      receipt,
      (value) => {
        value.issuedAt = new Date(
          new Date(FIXED_TIME).getTime() + 20_000,
        ).toISOString();
        value.planAuthentication.verifiedAt = value.issuedAt;
        value.reservation.reservedAt = new Date(
          new Date(FIXED_TIME).getTime() + 10_000,
        ).toISOString();
        value.finalization.finalizedAt = value.reservation.reservedAt;
        for (const cell of value.cellResults) {
          cell.issuedAt = value.reservation.reservedAt;
        }
      },
    );
    await expect(
      verifySkillTargetMatrixEvalReceipt(
        verifier,
        reserveBeforeAuthentication,
        fixture.expected,
      ),
    ).rejects.toThrow(/binding|expiry/i);
    const finalizationBeforeChildren = await resignMatrixReceipt(
      fixture,
      receipt,
      (value) => {
        value.issuedAt = new Date(
          new Date(FIXED_TIME).getTime() + 20_000,
        ).toISOString();
        for (const cell of value.cellResults) {
          cell.issuedAt = new Date(
            new Date(FIXED_TIME).getTime() + 10_000,
          ).toISOString();
        }
      },
    );
    await expect(
      verifySkillTargetMatrixEvalReceipt(
        verifier,
        finalizationBeforeChildren,
        fixture.expected,
      ),
    ).rejects.toThrow(/binding|expiry/i);

    let proxyTrapCount = 0;
    const receiptProxy = new Proxy(structuredClone(receipt), {
      get() {
        proxyTrapCount += 1;
        throw new Error("proxy trap must not execute");
      },
      getOwnPropertyDescriptor() {
        proxyTrapCount += 1;
        throw new Error("proxy trap must not execute");
      },
      ownKeys() {
        proxyTrapCount += 1;
        throw new Error("proxy trap must not execute");
      },
    });
    await expect(
      verifySkillTargetMatrixEvalReceipt(
        verifier,
        receiptProxy,
        fixture.expected,
      ),
    ).rejects.toThrow(/Proxy/);
    expect(proxyTrapCount).toBe(0);

    let getterReads = 0;
    const getterReceipt = structuredClone(receipt);
    Object.defineProperty(getterReceipt, "decision", {
      enumerable: true,
      configurable: true,
      get() {
        getterReads += 1;
        return "accepted";
      },
    });
    await expect(
      verifySkillTargetMatrixEvalReceipt(
        verifier,
        getterReceipt,
        fixture.expected,
      ),
    ).rejects.toThrow(/own data property/i);
    expect(getterReads).toBe(0);

    let releaseDeferredVerification;
    let markDeferredVerificationStarted;
    const deferredVerificationStarted = new Promise((resolve) => {
      markDeferredVerificationStarted = resolve;
    });
    const deferredMatrixVerifier = Object.freeze({
      verify: () => {
        markDeferredVerificationStarted();
        return new Promise((resolve) => {
          releaseDeferredVerification = resolve;
        });
      },
      authorityDescriptor:
        fixture.verifierOptions.matrixReceiptVerifier.authorityDescriptor,
    });
    const snapshotVerifier = new SkillTargetMatrixEvalReceiptVerifier({
      ...fixture.verifierOptions,
      matrixReceiptVerifier: deferredMatrixVerifier,
    });
    const mutableReceipt = structuredClone(receipt);
    const mutableExpected = structuredClone(fixture.expected);
    const pendingSnapshotVerification = verifySkillTargetMatrixEvalReceipt(
      snapshotVerifier,
      mutableReceipt,
      mutableExpected,
    );
    await deferredVerificationStarted;
    mutableReceipt.decision = "rejected";
    mutableReceipt.reasonCodes = ["MATRIX_CELL_REJECTED"];
    mutableExpected.candidateId = BASELINE_ID;
    releaseDeferredVerification(true);
    const verifiedSnapshot = await pendingSnapshotVerification;
    expect(verifiedSnapshot.decision).toBe("accepted");
    expect(verifiedSnapshot.candidateId).toBe(receipt.candidateId);

    const thenableMatrixVerifier = Object.freeze({
      verify: () => ({ then: () => undefined }),
      authorityDescriptor:
        fixture.verifierOptions.matrixReceiptVerifier.authorityDescriptor,
    });
    const thenableVerifier = new SkillTargetMatrixEvalReceiptVerifier({
      ...fixture.verifierOptions,
      matrixReceiptVerifier: thenableMatrixVerifier,
    });
    await expect(
      verifySkillTargetMatrixEvalReceipt(
        thenableVerifier,
        receipt,
        fixture.expected,
      ),
    ).rejects.toThrow(/thenable/i);
    const nativePromiseWithOwnThen = Promise.resolve(true);
    Object.defineProperty(nativePromiseWithOwnThen, "then", {
      value: () => new Promise(() => {}),
      enumerable: true,
    });
    const ownThenMatrixVerifier = Object.freeze({
      verify: () => nativePromiseWithOwnThen,
      authorityDescriptor:
        fixture.verifierOptions.matrixReceiptVerifier.authorityDescriptor,
    });
    const ownThenVerifier = new SkillTargetMatrixEvalReceiptVerifier({
      ...fixture.verifierOptions,
      matrixReceiptVerifier: ownThenMatrixVerifier,
    });
    await expect(
      verifySkillTargetMatrixEvalReceipt(
        ownThenVerifier,
        receipt,
        fixture.expected,
      ),
    ).rejects.toThrow(/thenable/i);

    const staleClock = Object.freeze({
      now: () => new Date(new Date(FIXED_TIME).getTime() + 120_000),
      authorityDescriptor: fixture.verifierOptions.clock.authorityDescriptor,
    });
    const staleVerifier = new SkillTargetMatrixEvalReceiptVerifier({
      ...fixture.verifierOptions,
      clock: staleClock,
    });
    await expect(
      verifySkillTargetMatrixEvalReceipt(
        staleVerifier,
        receipt,
        fixture.expected,
      ),
    ).rejects.toThrow(/stale|future-dated/i);

    const hangingMatrixVerifier = Object.freeze({
      verify: () => new Promise(() => {}),
      authorityDescriptor:
        fixture.verifierOptions.matrixReceiptVerifier.authorityDescriptor,
    });
    const boundedVerifier = new SkillTargetMatrixEvalReceiptVerifier({
      ...fixture.verifierOptions,
      matrixReceiptVerifier: hangingMatrixVerifier,
      maximumVerificationMs: 100,
    });
    const watchdogStartedAt = Date.now();
    await expect(
      verifySkillTargetMatrixEvalReceipt(
        boundedVerifier,
        receipt,
        fixture.expected,
      ),
    ).rejects.toMatchObject({
      code: "CC_SKILL_TARGET_MATRIX_EVAL_DEADLINE",
    });
    expect(Date.now() - watchdogStartedAt).toBeLessThan(1_500);

    const shortLivedReceipt = await resignMatrixReceipt(
      fixture,
      receipt,
      (value) => {
        value.aggregateReceiptTtlMs = 1_000;
        value.expiresAt = new Date(
          new Date(value.issuedAt).getTime() + 1_000,
        ).toISOString();
      },
    );
    const expiryBoundedVerifier = new SkillTargetMatrixEvalReceiptVerifier({
      ...fixture.verifierOptions,
      matrixReceiptVerifier: hangingMatrixVerifier,
      maximumVerificationMs: 30_000,
    });
    const expiryWatchdogStartedAt = Date.now();
    await expect(
      verifySkillTargetMatrixEvalReceipt(
        expiryBoundedVerifier,
        shortLivedReceipt,
        fixture.expected,
      ),
    ).rejects.toMatchObject({
      code: "CC_SKILL_TARGET_MATRIX_EVAL_DEADLINE",
    });
    expect(Date.now() - expiryWatchdogStartedAt).toBeLessThan(2_500);

    const incompleteCellRuntimes = new Map(
      fixture.aggregatorOptions.cellRuntimes,
    );
    incompleteCellRuntimes.delete("cell-windows");
    expect(
      () =>
        new SkillTargetMatrixEvalAggregator({
          ...fixture.aggregatorOptions,
          cellRuntimes: incompleteCellRuntimes,
        }),
    ).toThrow(/exactly cover/i);

    const supervisorTrust =
      fixture.aggregatorOptions.matrixSupervisor.authorityDescriptor.authority;
    const originalClockDescriptor =
      fixture.aggregatorOptions.clock.authorityDescriptor;
    const aliasedClockTrust = Object.freeze({
      ...originalClockDescriptor.authority,
      algorithm: supervisorTrust.algorithm,
      issuer: supervisorTrust.issuer,
      keyId: supervisorTrust.keyId,
    });
    const aliasedClock = Object.freeze({
      now: () => new Date(FIXED_TIME),
      authorityDescriptor: Object.freeze({
        ...originalClockDescriptor,
        authority: aliasedClockTrust,
      }),
    });
    expect(
      () =>
        new SkillTargetMatrixEvalAggregator({
          ...fixture.aggregatorOptions,
          clock: aliasedClock,
          clockPolicy: Object.freeze({
            trust: aliasedClockTrust,
            revision: originalClockDescriptor.handlerRevision,
          }),
        }),
    ).toThrow(/share a principal\/key identity/i);

    const sharedVerifierCallable =
      fixture.aggregatorOptions.matrixReceiptVerifier.verify;
    expect(
      () =>
        new SkillTargetMatrixEvalAggregator({
          ...fixture.aggregatorOptions,
          evidenceVerifier: Object.freeze({
            verify: sharedVerifierCallable,
            authorityDescriptor:
              fixture.aggregatorOptions.evidenceVerifier.authorityDescriptor,
          }),
        }),
    ).toThrow(/share a raw callable/i);

    expect(
      () =>
        new SkillTargetMatrixEvalAggregator({
          ...fixture.aggregatorOptions,
          childReceiptStore: {
            ...fixture.aggregatorOptions.childReceiptStore,
          },
        }),
    ).toThrow(/branded durable evidence store/i);

    const authorityRootInput = {
      planResolverDescriptor:
        fixture.aggregatorOptions.planResolver.authorityDescriptor,
      evidenceVerifierDescriptor:
        fixture.aggregatorOptions.evidenceVerifier.authorityDescriptor,
      reservationDescriptor:
        fixture.aggregatorOptions.reservationAuthority.reservationDescriptor,
      finalizationDescriptor:
        fixture.aggregatorOptions.reservationAuthority.finalizationDescriptor,
      supervisorDescriptor:
        fixture.aggregatorOptions.matrixSupervisor.authorityDescriptor,
      matrixSignerDescriptor:
        fixture.aggregatorOptions.matrixReceiptSigner.authorityDescriptor,
      matrixVerifierDescriptor:
        fixture.aggregatorOptions.matrixReceiptVerifier.authorityDescriptor,
      clockDescriptor: originalClockDescriptor,
      planTrust: fixture.aggregatorOptions.planTrust,
      matrixReceiptTrust: fixture.aggregatorOptions.matrixReceiptTrust,
      childReceiptStoreDescriptor:
        fixture.aggregatorOptions.childReceiptStore.descriptor,
      cellAuthorities: [...fixture.aggregatorOptions.cellRuntimes].map(
        ([cellId, config]) => ({
          cellId,
          gateDescriptor: config.gateDescriptor,
          receiptVerifierDescriptor: config.receiptVerifierDescriptor,
          policyDigest: config.policyDigest,
          evaluationAuthorityRoot: config.evaluationAuthorityRoot,
          maximumCellSettlementMs: config.maximumCellSettlementMs,
        }),
      ),
    };
    expect(computeSkillTargetMatrixEvalAuthorityRoot(authorityRootInput)).toBe(
      fixture.plan.matrixAuthorityRoot,
    );
    expect(
      computeSkillTargetMatrixEvalAuthorityRoot({
        ...authorityRootInput,
        clockDescriptor: {
          ...originalClockDescriptor,
          handlerArtifactDigest: `sha256:${"f".repeat(64)}`,
        },
      }),
    ).not.toBe(fixture.plan.matrixAuthorityRoot);
    expect(
      computeSkillTargetMatrixEvalAuthorityRoot({
        ...authorityRootInput,
        childReceiptStoreDescriptor: {
          ...authorityRootInput.childReceiptStoreDescriptor,
          handlerArtifactDigest: `sha256:${"e".repeat(64)}`,
        },
      }),
    ).not.toBe(fixture.plan.matrixAuthorityRoot);

    const directPlanAggregator = new SkillTargetMatrixEvalAggregator(
      fixture.aggregatorOptions,
    );
    await expect(
      evaluateSkillTargetMatrix(directPlanAggregator, fixture.plan),
    ).rejects.toThrow(/planRef/i);

    const originalResolve = fixture.aggregatorOptions.planResolver.resolve;
    const invalidPlanSignatureResolver = Object.freeze({
      resolve: async (...args) => {
        const resolution = await originalResolve(...args);
        return {
          ...resolution,
          planAttestation: {
            ...resolution.planAttestation,
            value: `${resolution.planAttestation.value}x`,
          },
        };
      },
      authorityDescriptor:
        fixture.aggregatorOptions.planResolver.authorityDescriptor,
    });
    const invalidPlanAggregator = new SkillTargetMatrixEvalAggregator({
      ...fixture.aggregatorOptions,
      planResolver: invalidPlanSignatureResolver,
    });
    await expect(
      evaluateSkillTargetMatrix(invalidPlanAggregator, fixture.planRef),
    ).rejects.toThrow(/signature/i);

    const expiringPlanFixture = makeMatrixComposition({
      calibration,
      firstHarness,
      secondHarness,
      fixtureId: "expiry-watchdog",
      planTtlMs: 1_000,
    });
    let expiringReservationStarted = false;
    const hangingReservationAuthority = Object.freeze({
      reserve: () => {
        expiringReservationStarted = true;
        return new Promise(() => {});
      },
      finalize:
        expiringPlanFixture.aggregatorOptions.reservationAuthority.finalize,
      reservationDescriptor:
        expiringPlanFixture.aggregatorOptions.reservationAuthority
          .reservationDescriptor,
      finalizationDescriptor:
        expiringPlanFixture.aggregatorOptions.reservationAuthority
          .finalizationDescriptor,
    });
    const expiringPlanAggregator = new SkillTargetMatrixEvalAggregator({
      ...expiringPlanFixture.aggregatorOptions,
      reservationAuthority: hangingReservationAuthority,
    });
    const planExpiryWatchdogStartedAt = Date.now();
    await expect(
      evaluateSkillTargetMatrix(
        expiringPlanAggregator,
        expiringPlanFixture.planRef,
      ),
    ).rejects.toMatchObject({
      code: "CC_SKILL_TARGET_MATRIX_EVAL_DEADLINE",
    });
    expect(expiringReservationStarted).toBe(true);
    expect(Date.now() - planExpiryWatchdogStartedAt).toBeLessThan(2_500);

    const oldChildReplayFixture = makeMatrixComposition({
      calibration,
      firstHarness,
      secondHarness,
      fixtureId: "old-child-cross-plan",
    });
    expect(oldChildReplayFixture.plan.planDigest).not.toBe(PLAN_DIGEST);
    const oldChildReplaySupervisor = Object.freeze({
      run: async (request, capability) => {
        const actualValue = await capability.invoke();
        const value =
          request.label === "cell-gate-cell-linux" ? calibration : actualValue;
        return {
          operationId: request.operationId,
          completed: true,
          valueDigest: matrixDigest(
            "chainlesschain.skill-target-matrix-eval-supervised-result/v1",
            value,
          ),
          value,
        };
      },
      authorityDescriptor:
        oldChildReplayFixture.aggregatorOptions.matrixSupervisor
          .authorityDescriptor,
    });
    const oldChildReplayAggregator = new SkillTargetMatrixEvalAggregator({
      ...oldChildReplayFixture.aggregatorOptions,
      matrixSupervisor: oldChildReplaySupervisor,
    });
    await expect(
      evaluateSkillTargetMatrix(
        oldChildReplayAggregator,
        oldChildReplayFixture.planRef,
      ),
    ).rejects.toThrow(/swapped the operation result/i);
  }, 120_000);

  it("derives needs-more-evidence when real branded child Gates lack a preregistered split", async () => {
    const sparseSuite = suiteWithCounts({
      training: 30,
      validation: 19,
      test: 20,
    });
    const firstHarness = makeHarness({ suite: sparseSuite });
    const secondHarness = makeHarness({ suite: sparseSuite });
    const calibration = await runEvolutionEvalGate(
      firstHarness.gate,
      RUN_REQUEST,
    );
    expect(calibration.decision).toBe("needs-more-evidence");
    const fixture = makeMatrixComposition({
      calibration,
      firstHarness,
      secondHarness,
      expectedDecision: "needs-more-evidence",
      fixtureId: "needs-more",
    });
    const receipt = await evaluateSkillTargetMatrix(
      new SkillTargetMatrixEvalAggregator(fixture.aggregatorOptions),
      fixture.planRef,
    );
    expect(receipt).toMatchObject({
      decision: "needs-more-evidence",
      reasonCodes: ["MATRIX_CELL_NEEDS_MORE_EVIDENCE"],
      cellCount: 2,
    });
    expect(receipt.cellResults).toHaveLength(2);
    expect(
      receipt.cellResults.every(
        (cell) => cell.decision === "needs-more-evidence",
      ),
    ).toBe(true);
  }, 120_000);
});

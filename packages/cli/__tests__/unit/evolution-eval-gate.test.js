import { createHash, createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";

import { describe, expect, it, vi } from "vitest";

import {
  EVOLUTION_EVAL_ARTIFACT_SCHEMA,
  EVOLUTION_EVAL_ATTESTATION_PURPOSES,
  EVOLUTION_EVAL_AUTHORITY_DESCRIPTOR_SCHEMA,
  EVOLUTION_EVAL_AUTHORITY_FAILED_CODE,
  EVOLUTION_EVAL_ENVIRONMENT_SCHEMA,
  EVOLUTION_EVAL_EXECUTION_FAILED_CODE,
  EVOLUTION_EVAL_EXECUTION_SCHEMA,
  EVOLUTION_EVAL_GRADE_SCHEMA,
  EVOLUTION_EVAL_GRADER_FAILED_CODE,
  EVOLUTION_EVAL_INVALID_CODE,
  EVOLUTION_EVAL_ISOLATED_TARGET_SCHEMA,
  EVOLUTION_EVAL_LEAKAGE_CODE,
  EVOLUTION_EVAL_PROVENANCE_SCHEMA,
  EVOLUTION_EVAL_REPLAY_SCHEMA,
  EVOLUTION_EVAL_SAFETY_FAILED_CODE,
  EVOLUTION_EVAL_SAFETY_SCHEMA,
  EVOLUTION_EVAL_SUBJECT_SCHEMA,
  EVOLUTION_EVAL_SUPERVISOR_UNRESPONSIVE_CODE,
  EVOLUTION_EVAL_SUPERVISION_SCHEMA,
  EVOLUTION_EVAL_SUITE_AUTHORITY_SCHEMA,
  EVOLUTION_EVAL_TARGET_INVOCATION_SCHEMA,
  EVOLUTION_EVAL_TARGET_REVOCATION_SCHEMA,
  EVOLUTION_EVAL_TARGET_SETTLEMENT_UNCONFIRMED_CODE,
  EvolutionEvalGate,
  EvolutionEvalReceiptVerifier,
  buildEvolutionEvalAttestationDigest,
  buildEvolutionEvalPolicy,
  buildEvolutionEvalSuite,
  buildEvolutionEvalTask,
  computeEvolutionEvalEnvironmentDigest,
  computeEvolutionEvalHandleReservationSetDigest,
  computeEvolutionEvalIsolatedTargetDigest,
  computeEvolutionEvalContextDigest,
  computeEvolutionEvalOutputArtifactDigest,
  computeEvolutionEvalReceiptDigest,
  computeEvolutionEvalTaskBindingRandomnessCommitment,
  computeEvolutionEvalTaskBindingsDigest,
  computeEvolutionEvalSupervisedResultDigest,
  computeEvolutionEvalTargetAuthorityDigest,
  runEvolutionEvalGate,
  verifyEvolutionEvalPolicy,
  verifyEvolutionEvalReceipt,
  verifyEvolutionEvalSuite,
  verifyEvolutionEvalTask,
} from "../../src/lib/evolution/evolution-eval-gate.js";
import { createEvolutionEvalProcessSupervisor } from "../../src/lib/evolution/evolution-eval-process-supervisor.js";

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
    confidenceZ: 1.96,
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

function targetedHangingOptions() {
  return {
    suite: suiteWithCounts(),
    evalPolicy: policy({
      maxWallClockMs: 1_000,
      portReceiptTtlMs: 4_000,
    }),
  };
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

function aliasEvidencePrincipal(authorityPolicies, sourceRole, targetRole) {
  const source = authorityPolicies[sourceRole];
  const target = authorityPolicies[targetRole];
  return Object.freeze({
    ...authorityPolicies,
    [targetRole]: Object.freeze({
      trust: Object.freeze({
        ...target.trust,
        algorithm: source.trust.algorithm,
        issuer: source.trust.issuer,
        keyId: source.trust.keyId,
      }),
      revision: target.revision,
    }),
  });
}

function principalKeyAlias(trust) {
  return {
    algorithm: trust.algorithm,
    issuer: trust.issuer,
    keyId: trust.keyId,
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

let isolatedVerifierCounter = 0;

function makeIsolatedVerifierRuntime({ crypto, clock, handler }) {
  isolatedVerifierCounter += 1;
  const target = isolatedTarget({
    handlerId: `external-attestation-verifier-${isolatedVerifierCounter}`,
    handlerRevision: crypto.revisions.verifier,
    operation: "attestation-verify",
    authority: crypto.trusts.verifier,
    isolation: "hsm-deadline-authority",
  });
  const targetRegistry = new Map([
    [target.handlerId, Object.freeze({ target, kind: "handler", handler })],
  ]);
  return {
    port: targetPort("verify", target),
    supervisor: makeDeadlineSupervisor({ crypto, clock, targetRegistry }),
    invocationEvidenceVerifier: crypto.invocationEvidenceVerifier,
    invocationEvidencePolicy: crypto.authorityPolicies.invocationEvidence,
    revocationEvidenceVerifier: crypto.revocationEvidenceVerifier,
    revocationEvidencePolicy: crypto.authorityPolicies.revocationEvidence,
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
  executorTargetTransform = null,
  deadlineSupervisorFactory = null,
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
  let executorTarget = isolatedTarget({
    handlerId: "sandbox-executor",
    handlerRevision: crypto.revisions.execution,
    operation: "sandbox-execute",
    authority: crypto.trusts.execution,
  });
  if (executorTargetTransform)
    executorTarget = Object.freeze(executorTargetTransform(executorTarget));
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
  const fallbackDeadlineSupervisor = makeDeadlineSupervisor({
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
  const deadlineSupervisor = deadlineSupervisorFactory
    ? deadlineSupervisorFactory({
        fallbackSupervisor: fallbackDeadlineSupervisor,
        executorTarget,
        crypto,
        clock,
        authorityPolicies,
      })
    : fallbackDeadlineSupervisor;
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
    tenantId: TENANT_ID,
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

function expectedReceiptContext(receipt) {
  return {
    runId: receipt.runId,
    runNonce: receipt.runNonce,
    suiteDigest: receipt.suiteDigest,
    policyDigest: receipt.policyDigest,
    evaluationAuthorityRoot: receipt.evaluationAuthorityRoot,
    targetEnvironmentRef: receipt.targetEnvironmentRef,
    evaluationContextDigest: receipt.evaluationContextDigest,
    candidateId: receipt.candidateId,
    baselineId: receipt.baselineId,
    environmentDigest: receipt.environmentDigest,
    tenantId: receipt.tenantId,
    provenanceAudience: receipt.provenanceAudience,
    trainerAuthority: receipt.trainerAuthority,
    trainerRevision: receipt.trainerRevision,
  };
}

function evaluationContextForReceipt(receipt, overrides = {}) {
  return {
    planDigest: PLAN_DIGEST,
    tenantId: TENANT_ID,
    targetMatrixRoot: TARGET_MATRIX_ROOT,
    cellId: RUN_REQUEST.evaluationContext.cellId,
    runtimeId: RUN_REQUEST.evaluationContext.runtimeId,
    targetEnvironmentRef: receipt.targetEnvironmentRef,
    environmentDigest: receipt.environmentDigest,
    candidateId: receipt.candidateId,
    baselineId: receipt.baselineId,
    suiteDigest: receipt.suiteDigest,
    policyDigest: receipt.policyDigest,
    evaluationAuthorityRoot: receipt.evaluationAuthorityRoot,
    ...overrides,
  };
}

// These integration-like cases traverse the full preregistered plan: exactly
// 240 executions, each with supervised subject, executor, grader, and safety
// evidence plus synchronous test-only HMAC attestations. The production Gate
// remains bounded by maxExecutions and its signed wall-clock deadline.
const FULL_EVALUATION_TEST_TIMEOUT_MS = 30_000;
function fullEvaluationTest(name, run) {
  return it(name, run, FULL_EVALUATION_TEST_TIMEOUT_MS);
}

async function rejectionWithin(operation, maximumMs) {
  let timer;
  const settled = Promise.resolve(operation).then(
    (value) => ({ status: "fulfilled", value }),
    (reason) => ({ status: "rejected", reason }),
  );
  const guard = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("operation exceeded its independent test bound")),
      maximumMs,
    );
  });
  try {
    const result = await Promise.race([settled, guard]);
    if (result.status !== "rejected") {
      throw new Error("operation unexpectedly fulfilled");
    }
    return result.reason;
  } finally {
    clearTimeout(timer);
  }
}

describe("Evolution Eval Gate P0 foundation", () => {
  fullEvaluationTest(
    "accepts only after paired validation and hidden-test quality gates and emits an independently signed receipt",
    async () => {
      const harness = makeHarness();
      const receipt = await runEvolutionEvalGate(harness.gate, RUN_REQUEST);

      expect(receipt).toMatchObject({
        decision: "accepted",
        reasonCodes: [
          "validation-quality-improvement",
          "test-quality-improvement",
        ],
        splitCounts: { training: 30, validation: 20, test: 20 },
        candidateId: CANDIDATE_ID,
        baselineId: BASELINE_ID,
        environmentDigest: ENVIRONMENT_DIGEST,
      });
      expect(receipt.validation.pairedPassDelta).toMatchObject({
        taskCount: 20,
        mean: 1,
      });
      expect(receipt.validation.candidate).toMatchObject({
        taskCount: 20,
        seedCount: 3,
        sampleCount: 60,
      });
      expect(receipt.test).not.toBeNull();
      expect(receipt.usage.executionCount).toBe(240);
      expect(receipt.attestation.issuer).toBe(
        "chainlesschain-receipt-authority",
      );
      await expect(
        verifyEvolutionEvalReceipt(
          harness.receiptVerifier,
          receipt,
          expectedReceiptContext(receipt),
        ),
      ).resolves.toEqual(receipt);
      expect(Object.isFrozen(receipt)).toBe(true);
    },
  );

  it("binds an exact caller-supplied matrix cell context even when cells share an environment digest", async () => {
    const harness = makeHarness({
      suite: suiteWithCounts({ training: 29, validation: 20, test: 20 }),
    });
    const receipt = await runEvolutionEvalGate(harness.gate, RUN_REQUEST);
    const expectedDigest = computeEvolutionEvalContextDigest(
      evaluationContextForReceipt(receipt),
    );
    const otherCellDigest = computeEvolutionEvalContextDigest(
      evaluationContextForReceipt(receipt, { cellId: "cell-secondary" }),
    );

    expect(receipt.targetEnvironmentRef).toBe(RUN_REQUEST.targetEnvironmentRef);
    expect(receipt.evaluationContextDigest).toBe(expectedDigest);
    expect(otherCellDigest).not.toBe(expectedDigest);
    await expect(
      verifyEvolutionEvalReceipt(harness.receiptVerifier, receipt, {
        ...expectedReceiptContext(receipt),
        evaluationContextDigest: otherCellDigest,
      }),
    ).rejects.toMatchObject({ code: EVOLUTION_EVAL_AUTHORITY_FAILED_CODE });
  });

  it("binds identical outcomes under different grader authorities to different authority roots", async () => {
    const sharedSuite = suiteWithCounts({
      training: 29,
      validation: 20,
      test: 20,
    });
    const original = makeHarness({ suite: sharedSuite });
    const rotated = makeHarness({
      suite: sharedSuite,
      authorityTrustOverrides: {
        grader: {
          issuer: "chainlesschain-grader-authority-rotated",
          keyId: "test-grader-key-v2",
          trustPolicyDigest: `sha256:${createHmac(
            "sha256",
            "trust-policy-test-root",
          )
            .update("grader-rotated", "utf8")
            .digest("hex")}`,
        },
      },
      authorityRevisionOverrides: { grader: "objective-grader-v2" },
    });
    const originalReceipt = await runEvolutionEvalGate(
      original.gate,
      RUN_REQUEST,
    );
    const rotatedReceipt = await runEvolutionEvalGate(
      rotated.gate,
      RUN_REQUEST,
    );

    expect({
      decision: rotatedReceipt.decision,
      reasonCodes: rotatedReceipt.reasonCodes,
      splitCounts: rotatedReceipt.splitCounts,
      validation: rotatedReceipt.validation,
      test: rotatedReceipt.test,
      usage: rotatedReceipt.usage,
    }).toEqual({
      decision: originalReceipt.decision,
      reasonCodes: originalReceipt.reasonCodes,
      splitCounts: originalReceipt.splitCounts,
      validation: originalReceipt.validation,
      test: originalReceipt.test,
      usage: originalReceipt.usage,
    });
    expect(rotatedReceipt.evaluationAuthorityRoot).not.toBe(
      originalReceipt.evaluationAuthorityRoot,
    );
    await expect(
      verifyEvolutionEvalReceipt(
        original.receiptVerifier,
        rotatedReceipt,
        expectedReceiptContext(rotatedReceipt),
      ),
    ).resolves.toEqual(rotatedReceipt);
    await expect(
      verifyEvolutionEvalReceipt(original.receiptVerifier, rotatedReceipt, {
        ...expectedReceiptContext(rotatedReceipt),
        evaluationAuthorityRoot: originalReceipt.evaluationAuthorityRoot,
      }),
    ).rejects.toMatchObject({ code: EVOLUTION_EVAL_AUTHORITY_FAILED_CODE });
  });

  it.each([
    [
      "deadline supervisor",
      { supervisorHandlerArtifactDigest: `sha256:${"7".repeat(64)}` },
    ],
    [
      "invocation evidence verifier",
      { invocationEvidenceHandlerArtifactDigest: `sha256:${"6".repeat(64)}` },
    ],
    [
      "revocation evidence verifier",
      { revocationEvidenceHandlerArtifactDigest: `sha256:${"5".repeat(64)}` },
    ],
    [
      "trusted clock",
      { clockHandlerArtifactDigest: `sha256:${"8".repeat(64)}` },
    ],
  ])(
    "commits the trusted composition's %s descriptor digest into the authority root and expected context",
    async (_label, replacement) => {
      const sharedSuite = suiteWithCounts({
        training: 29,
        validation: 20,
        test: 20,
      });
      const original = makeHarness({ suite: sharedSuite });
      const replaced = makeHarness({ suite: sharedSuite, ...replacement });
      const originalReceipt = await runEvolutionEvalGate(
        original.gate,
        RUN_REQUEST,
      );
      const replacedReceipt = await runEvolutionEvalGate(
        replaced.gate,
        RUN_REQUEST,
      );

      expect(replacedReceipt.evaluationAuthorityRoot).not.toBe(
        originalReceipt.evaluationAuthorityRoot,
      );
      await expect(
        verifyEvolutionEvalReceipt(original.receiptVerifier, replacedReceipt, {
          ...expectedReceiptContext(replacedReceipt),
          evaluationAuthorityRoot: originalReceipt.evaluationAuthorityRoot,
        }),
      ).rejects.toMatchObject({ code: EVOLUTION_EVAL_AUTHORITY_FAILED_CODE });
    },
  );

  it("rejects omitted caller context and legacy v2 receipts without downgrade", async () => {
    const harness = makeHarness({
      suite: suiteWithCounts({ training: 29, validation: 20, test: 20 }),
    });
    const legacyRequest = {
      suiteRef: RUN_REQUEST.suiteRef,
      candidateId: RUN_REQUEST.candidateId,
      baselineId: RUN_REQUEST.baselineId,
      targetEnvironmentRef: RUN_REQUEST.targetEnvironmentRef,
    };
    await expect(
      runEvolutionEvalGate(harness.gate, legacyRequest),
    ).rejects.toMatchObject({ code: EVOLUTION_EVAL_INVALID_CODE });
    expect(harness.ports.suiteVerifier.resolveSuite).not.toHaveBeenCalled();

    const receipt = await runEvolutionEvalGate(harness.gate, RUN_REQUEST);
    await expect(
      verifyEvolutionEvalReceipt(
        harness.receiptVerifier,
        { ...receipt, schema: "chainlesschain.evolution-eval-receipt/v2" },
        expectedReceiptContext(receipt),
      ),
    ).rejects.toMatchObject({ code: EVOLUTION_EVAL_INVALID_CODE });
  });

  fullEvaluationTest(
    "gives the executor only fresh opaque task/subject handles and a mixed work plan with no artifact role or split metadata",
    async () => {
      const harness = makeHarness();
      await runEvolutionEvalGate(harness.gate, RUN_REQUEST);

      for (const request of harness.calls.executorCalls) {
        expect(request.taskHandle).toMatch(/^sha256:[a-f0-9]{64}$/u);
        expect(request.opaqueSubjectHandle).toMatch(/^sha256:[a-f0-9]{64}$/u);
        expect(request.opaqueSubjectHandle).not.toBe(CANDIDATE_ID);
        expect(request.opaqueSubjectHandle).not.toBe(BASELINE_ID);
        expect(request).not.toHaveProperty("task");
        expect(request).not.toHaveProperty("taskId");
        expect(request).not.toHaveProperty("publicInput");
        expect(request).not.toHaveProperty("split");
        expect(request).not.toHaveProperty("graderId");
        expect(request).not.toHaveProperty("groupKeys");
        expect(request).not.toHaveProperty("variant");
        expect(request).not.toHaveProperty("role");
        expect(request).not.toHaveProperty("subjectArtifactDigest");
        expect(request).not.toHaveProperty("subjectBindingDigest");
        expect(Object.keys(request).sort()).toEqual(
          [
            "schema",
            "runId",
            "runNonce",
            "requestNonce",
            "requestedAt",
            "deadlineAt",
            "taskHandle",
            "opaqueSubjectHandle",
            "executionProjection",
            "remainingHardBudget",
            "seed",
            "policyDigest",
            "environmentDigest",
            "requestDigest",
          ].sort(),
        );
        expect(Object.keys(request.executionProjection).sort()).toEqual([
          "publicInput",
          "taskType",
        ]);
        expect(JSON.stringify(request)).not.toMatch(
          /training|validation|test-|privateExpected|candidate|baseline|artifactDigest|taskDigest/u,
        );
        expect(Object.isFrozen(request)).toBe(true);
      }
      for (const [request] of harness.ports.artifactExecutionBroker
        .issueSubjectHandle.mock.calls) {
        expect(Object.keys(request).sort()).toEqual(
          [
            "schema",
            "requestNonce",
            "requestedAt",
            "deadlineAt",
            "runId",
            "runNonce",
            "opaqueArtifactCapability",
            "environmentDigest",
            "policyDigest",
            "requestDigest",
          ].sort(),
        );
        expect(request).not.toHaveProperty("artifactDigest");
        expect(request).not.toHaveProperty("artifactId");
        expect(request).not.toHaveProperty("role");
        expect(request).not.toHaveProperty("artifactResolutionDigest");
        expect(request).not.toHaveProperty("provenanceBindingDigest");
      }
      expect(
        new Set(harness.calls.executorCalls.map((call) => call.taskHandle))
          .size,
      ).toBe(40);
      expect(
        new Set(
          harness.calls.executorCalls.map((call) => call.opaqueSubjectHandle),
        ).size,
      ).toBe(240);
      const observedSplitOrder = harness.calls.executorCalls.map((request) =>
        harness.calls.splitByCaseId.get(
          request.executionProjection.publicInput.caseId,
        ),
      );
      expect(observedSplitOrder.indexOf("test")).toBeLessThan(
        observedSplitOrder.lastIndexOf("validation"),
      );
      expect(observedSplitOrder.indexOf("validation")).toBeLessThan(
        observedSplitOrder.lastIndexOf("test"),
      );
    },
  );

  fullEvaluationTest(
    "does not let a malicious candidate recover split, hidden answers, artifact identity, or comparison role",
    async () => {
      const observations = [];
      const harness = makeHarness({
        candidatePass: ({ request, projection, ...unexpected }) => {
          observations.push({
            projectionKeys: Object.keys(projection).sort(),
            unexpectedKeys: Object.keys(unexpected),
            split: request.split ?? projection.split,
            privateExpected:
              request.privateExpected ?? projection.privateExpected,
            graderId: request.graderId ?? projection.graderId,
            taskDigest: request.taskDigest ?? projection.taskDigest,
            artifactDigest: request.artifactDigest ?? projection.artifactDigest,
            role: request.role ?? projection.role,
            candidateId: request.candidateId,
            baselineId: request.baselineId,
            serialized: JSON.stringify({ request, projection }),
          });
          return true;
        },
      });

      await expect(
        runEvolutionEvalGate(harness.gate, RUN_REQUEST),
      ).resolves.toMatchObject({ decision: "accepted" });
      expect(observations).toHaveLength(120);
      for (const observation of observations) {
        expect(observation.projectionKeys).toEqual(["publicInput", "taskType"]);
        expect(observation.unexpectedKeys).toEqual([]);
        expect(observation).toMatchObject({
          split: undefined,
          privateExpected: undefined,
          graderId: undefined,
          taskDigest: undefined,
          artifactDigest: undefined,
          role: undefined,
          candidateId: undefined,
          baselineId: undefined,
        });
        expect(observation.serialized).not.toMatch(
          /training|validation|test-|privateExpected|candidate|baseline|artifactDigest|taskDigest/u,
        );
      }
    },
  );

  it("rejects stable cross-run task handles and task bindings that do not attest split blindness", async () => {
    const stableHandles = makeHarness({
      suite: suiteWithCounts({ training: 29, validation: 20, test: 20 }),
      suiteHandleOverride: ({ evalTask }) =>
        `sha256:${createHmac("sha256", "stable-task-handle-secret")
          .update(evalTask.taskDigest, "utf8")
          .digest("hex")}`,
    });
    await expect(
      runEvolutionEvalGate(stableHandles.gate, RUN_REQUEST),
    ).resolves.toMatchObject({ decision: "needs-more-evidence" });
    await expect(
      runEvolutionEvalGate(stableHandles.gate, RUN_REQUEST),
    ).rejects.toMatchObject({ code: EVOLUTION_EVAL_AUTHORITY_FAILED_CODE });

    const encodedSplitContract = makeHarness({
      taskBindingOverride: () => ({ splitBlind: false }),
    });
    await expect(
      runEvolutionEvalGate(encodedSplitContract.gate, RUN_REQUEST),
    ).rejects.toMatchObject({ code: EVOLUTION_EVAL_AUTHORITY_FAILED_CODE });
    expect(encodedSplitContract.ports.executor.execute).not.toHaveBeenCalled();
  });

  it("uses the durable replay authority to reject stable handles and nonces across Gate restarts", async () => {
    const durableReplayState = { handles: new Set(), nonces: new Set() };
    const restartSuite = suiteWithCounts({
      training: 29,
      validation: 20,
      test: 20,
    });
    const stableTaskHandle = ({ evalTask }) =>
      `sha256:${createHmac("sha256", "restart-stable-handle")
        .update(evalTask.taskDigest, "utf8")
        .digest("hex")}`;
    const stableTaskNonce = ({ evalTask }) => ({
      bindingNonce: `task-binding-${createHmac("sha256", "restart-stable-nonce")
        .update(evalTask.taskDigest, "utf8")
        .digest("hex")}`,
    });
    const firstProcess = makeHarness({
      suite: restartSuite,
      durableReplayState,
      suiteHandleOverride: stableTaskHandle,
      taskBindingOverride: stableTaskNonce,
    });
    await expect(
      runEvolutionEvalGate(firstProcess.gate, RUN_REQUEST),
    ).resolves.toMatchObject({ decision: "needs-more-evidence" });

    const restartedProcess = makeHarness({
      suite: restartSuite,
      durableReplayState,
      suiteHandleOverride: stableTaskHandle,
      taskBindingOverride: stableTaskNonce,
    });
    await expect(
      runEvolutionEvalGate(restartedProcess.gate, RUN_REQUEST),
    ).rejects.toMatchObject({ code: EVOLUTION_EVAL_AUTHORITY_FAILED_CODE });
    expect(restartedProcess.ports.executor.execute).not.toHaveBeenCalled();
  });

  it("rejects a stable task-binding nonce across restarts even when every opaque handle changes", async () => {
    const durableReplayState = { handles: new Set(), nonces: new Set() };
    const restartSuite = suiteWithCounts({
      training: 29,
      validation: 20,
      test: 20,
    });
    const stableTaskNonce = ({ evalTask }) => ({
      bindingNonce: `task-binding-${createHmac("sha256", "nonce-only-replay")
        .update(evalTask.taskDigest, "utf8")
        .digest("hex")}`,
    });
    const firstProcess = makeHarness({
      suite: restartSuite,
      durableReplayState,
      taskBindingOverride: stableTaskNonce,
    });
    await runEvolutionEvalGate(firstProcess.gate, RUN_REQUEST);

    const restartedProcess = makeHarness({
      suite: restartSuite,
      durableReplayState,
      taskBindingOverride: stableTaskNonce,
    });
    await expect(
      runEvolutionEvalGate(restartedProcess.gate, RUN_REQUEST),
    ).rejects.toMatchObject({ code: EVOLUTION_EVAL_AUTHORITY_FAILED_CODE });
    expect(restartedProcess.ports.executor.execute).not.toHaveBeenCalled();
  });

  it("rejects stable anonymous artifact capabilities across Gate restarts", async () => {
    const durableReplayState = { handles: new Set(), nonces: new Set() };
    const restartSuite = suiteWithCounts({
      training: 29,
      validation: 20,
      test: 20,
    });
    const stableCapability = (request) =>
      `sha256:${createHmac("sha256", "restart-stable-capability")
        .update(request.artifactId, "utf8")
        .digest("hex")}`;
    const firstProcess = makeHarness({
      suite: restartSuite,
      durableReplayState,
      artifactCapabilityOverride: stableCapability,
    });
    await expect(
      runEvolutionEvalGate(firstProcess.gate, RUN_REQUEST),
    ).resolves.toMatchObject({ decision: "needs-more-evidence" });

    const restartedProcess = makeHarness({
      suite: restartSuite,
      durableReplayState,
      artifactCapabilityOverride: stableCapability,
    });
    await expect(
      runEvolutionEvalGate(restartedProcess.gate, RUN_REQUEST),
    ).rejects.toMatchObject({ code: EVOLUTION_EVAL_AUTHORITY_FAILED_CODE });
    expect(restartedProcess.ports.executor.execute).not.toHaveBeenCalled();
  });

  fullEvaluationTest(
    "rejects call-time always-pass port injection and keeps constructor-captured methods after property replacement",
    async () => {
      const harness = makeHarness();
      const capturedExecute = harness.ports.executor.execute;
      const capturedProvenance =
        harness.ports.provenanceVerifier.verifyProvenance;
      const capturedSubject =
        harness.ports.artifactExecutionBroker.issueSubjectHandle;
      const capturedReplay = harness.ports.handleReplayAuthority.reserve;
      const capturedSupervisorRun = harness.ports.deadlineSupervisor.run;
      harness.ports.executor.execute = vi.fn(async () => ({ pass: true }));
      harness.ports.provenanceVerifier.verifyProvenance = vi.fn(async () => ({
        revocationStatus: "current",
      }));
      harness.ports.artifactExecutionBroker.issueSubjectHandle = vi.fn(
        async () => ({ opaqueSubjectHandle: CANDIDATE_ID }),
      );
      harness.ports.handleReplayAuthority.reserve = vi.fn(async () => ({
        durable: false,
      }));
      harness.ports.deadlineSupervisor.run = vi.fn(async () => ({
        value: true,
      }));

      await expect(
        runEvolutionEvalGate(harness.gate, {
          ...RUN_REQUEST,
          executor: { execute: async () => ({ pass: true }) },
        }),
      ).rejects.toMatchObject({ code: EVOLUTION_EVAL_INVALID_CODE });

      const receipt = await runEvolutionEvalGate(harness.gate, RUN_REQUEST);
      expect(receipt.decision).toBe("accepted");
      expect(capturedExecute).toHaveBeenCalledTimes(240);
      expect(capturedProvenance).toHaveBeenCalledTimes(2);
      expect(capturedSubject).toHaveBeenCalledTimes(240);
      expect(capturedReplay).toHaveBeenCalledTimes(242);
      expect(capturedSupervisorRun.mock.calls.length).toBeGreaterThan(1_000);
      expect(harness.ports.executor.execute).not.toHaveBeenCalled();
      expect(
        harness.ports.provenanceVerifier.verifyProvenance,
      ).not.toHaveBeenCalled();
      expect(
        harness.ports.artifactExecutionBroker.issueSubjectHandle,
      ).not.toHaveBeenCalled();
      expect(
        harness.ports.handleReplayAuthority.reserve,
      ).not.toHaveBeenCalled();
      expect(harness.ports.deadlineSupervisor.run).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["suite", EVOLUTION_EVAL_ATTESTATION_PURPOSES.suite],
    ["environment", EVOLUTION_EVAL_ATTESTATION_PURPOSES.environment],
    ["artifact", EVOLUTION_EVAL_ATTESTATION_PURPOSES.artifact],
    ["provenance", EVOLUTION_EVAL_ATTESTATION_PURPOSES.provenance],
    ["subject", EVOLUTION_EVAL_ATTESTATION_PURPOSES.subject],
    ["execution", EVOLUTION_EVAL_ATTESTATION_PURPOSES.execution],
    ["grader", EVOLUTION_EVAL_ATTESTATION_PURPOSES.grade],
    ["safety", EVOLUTION_EVAL_ATTESTATION_PURPOSES.safety],
    ["replay", EVOLUTION_EVAL_ATTESTATION_PURPOSES.replay],
    ["supervisor", EVOLUTION_EVAL_ATTESTATION_PURPOSES.supervisor],
  ])(
    "rejects a cryptographically valid %s receipt signed by the wrong purpose authority",
    async (_label, purpose) => {
      const harness = makeHarness({
        attestationRoleOverrides: { [purpose]: "receipt" },
      });
      await expect(
        runEvolutionEvalGate(harness.gate, RUN_REQUEST),
      ).rejects.toMatchObject({ code: EVOLUTION_EVAL_AUTHORITY_FAILED_CODE });
    },
  );

  it("captures mutually distinct trust principals and revisions for every authority role", () => {
    const harness = makeHarness();
    const policies = [
      ...Object.values(harness.crypto.authorityPolicies),
      ...harness.crypto.graderAuthorityPolicies.values(),
    ];
    expect(new Set(policies.map(({ trust }) => trust.keyId)).size).toBe(
      policies.length,
    );
    expect(
      new Set(policies.map(({ trust }) => trust.trustPolicyDigest)).size,
    ).toBe(policies.length);
    expect(new Set(policies.map(({ revision }) => revision)).size).toBe(
      policies.length,
    );
  });

  it("rejects a correctly signed authority receipt with an unexpected authority revision", async () => {
    const harness = makeHarness({
      suiteAuthorityRevisionOverride: "dataset-authority-v0-revoked",
    });
    await expect(
      runEvolutionEvalGate(harness.gate, RUN_REQUEST),
    ).rejects.toMatchObject({ code: EVOLUTION_EVAL_AUTHORITY_FAILED_CODE });
    expect(harness.ports.handleReplayAuthority.reserve).not.toHaveBeenCalled();
  });

  it("returns signed needs-more-evidence without executing when the authenticated suite is below any floor", async () => {
    const harness = makeHarness({
      suite: suiteWithCounts({ training: 29, validation: 19, test: 19 }),
    });
    const receipt = await runEvolutionEvalGate(harness.gate, RUN_REQUEST);

    expect(receipt).toMatchObject({
      decision: "needs-more-evidence",
      reasonCodes: [
        "insufficient-training",
        "insufficient-validation",
        "insufficient-test",
      ],
      validation: null,
      test: null,
      usage: { executionCount: 0 },
    });
    expect(harness.ports.executor.execute).not.toHaveBeenCalled();
    await expect(
      verifyEvolutionEvalReceipt(
        harness.receiptVerifier,
        receipt,
        expectedReceiptContext(receipt),
      ),
    ).resolves.toEqual(receipt);
  });

  fullEvaluationTest(
    "uses an independent safety receipt as an absolute validation hard gate",
    async () => {
      const harness = makeHarness({
        candidateUnsafe: () => true,
      });
      const receipt = await runEvolutionEvalGate(harness.gate, RUN_REQUEST);

      expect(receipt.decision).toBe("rejected");
      expect(receipt.reasonCodes).toEqual(["validation-safety-hard-gate"]);
      expect(receipt.validation.candidate.securityViolations).toBe(60);
      expect(receipt.test.candidate.securityViolations).toBe(60);
      expect(receipt.usage.executionCount).toBe(240);
    },
  );

  fullEvaluationTest(
    "gates hidden test quality rather than treating it as report-only",
    async () => {
      const blindedSuite = suiteWithCounts();
      const validationCaseIds = new Set(
        blindedSuite.tasks
          .filter((evalTask) => evalTask.split === "validation")
          .map((evalTask) => evalTask.publicInput.caseId),
      );
      const harness = makeHarness({
        suite: blindedSuite,
        candidatePass: ({ projection }) =>
          validationCaseIds.has(projection.publicInput.caseId),
      });
      const receipt = await runEvolutionEvalGate(harness.gate, RUN_REQUEST);

      expect(receipt.validation.pairedPassDelta.mean).toBe(1);
      expect(receipt.test.pairedPassDelta.mean).toBe(0);
      expect(receipt.decision).toBe("rejected");
      expect(receipt.reasonCodes).toEqual([
        "test-improvement-threshold-not-met",
      ]);
    },
  );

  it("fails closed without an accepted receipt when the hidden-test grader crashes", async () => {
    const harness = makeHarness({ graderCrashSplit: "test" });

    await expect(
      runEvolutionEvalGate(harness.gate, RUN_REQUEST),
    ).rejects.toMatchObject({ code: EVOLUTION_EVAL_GRADER_FAILED_CODE });
    expect(harness.ports.executor.execute.mock.calls.length).toBeGreaterThan(0);
    expect(harness.ports.executor.execute.mock.calls.length).toBeLessThan(240);
  });

  it("stops before another execution when trusted metering exhausts a total token budget", async () => {
    const harness = makeHarness({
      evalPolicy: policy({ maxTotalTokens: 50 }),
      baselineMetrics: {
        tokens: 50,
        latencyMs: 100,
        toolCalls: 4,
        costMicrounits: 10,
        errors: 0,
      },
      candidateMetrics: {
        tokens: 50,
        latencyMs: 100,
        toolCalls: 4,
        costMicrounits: 10,
        errors: 0,
      },
    });
    const receipt = await runEvolutionEvalGate(harness.gate, RUN_REQUEST);

    expect(receipt).toMatchObject({
      decision: "rejected",
      reasonCodes: ["total-budget-exceeded"],
      validation: null,
      test: null,
      usage: { executionCount: 1, totalTokens: 50 },
    });
    expect(harness.ports.executor.execute).toHaveBeenCalledTimes(1);
    expect(harness.calls.executorCalls[0].remainingHardBudget.tokens).toBe(50);
  });

  it("rejects a signed execution receipt whose expiry exceeds the preregistered port TTL", async () => {
    const harness = makeHarness({
      executionExpiresAtOverride: () => "2026-09-01T12:02:00.000Z",
    });

    await expect(
      runEvolutionEvalGate(harness.gate, RUN_REQUEST),
    ).rejects.toMatchObject({ code: EVOLUTION_EVAL_AUTHORITY_FAILED_CODE });
    expect(harness.ports.executor.execute).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["suite", "replaySuite"],
    ["environment", "replayEnvironment"],
    ["candidate artifact", "replayCandidateArtifact"],
    ["baseline artifact", "replayBaselineArtifact"],
    ["candidate provenance", "replayCandidateProvenance"],
    ["baseline provenance", "replayBaselineProvenance"],
  ])(
    "rejects a previously valid signed %s receipt replayed under a fresh nonce",
    async (_label, control) => {
      const harness = makeHarness({
        suite: suiteWithCounts({ training: 29, validation: 20, test: 20 }),
      });
      await runEvolutionEvalGate(harness.gate, RUN_REQUEST);
      harness.controls[control] = true;

      await expect(
        runEvolutionEvalGate(harness.gate, RUN_REQUEST),
      ).rejects.toMatchObject({ code: EVOLUTION_EVAL_AUTHORITY_FAILED_CODE });
    },
  );

  it("rejects signed artifact provenance that does not prove holdout isolation or the authenticated training partition", async () => {
    const exposedHoldout = makeHarness({ holdoutIsolated: false });
    await expect(
      runEvolutionEvalGate(exposedHoldout.gate, RUN_REQUEST),
    ).rejects.toMatchObject({ code: EVOLUTION_EVAL_AUTHORITY_FAILED_CODE });

    const wrongTrainingPartition = makeHarness({
      artifactTrainingDigestOverride: () => `sha256:${"9".repeat(64)}`,
    });
    await expect(
      runEvolutionEvalGate(wrongTrainingPartition.gate, RUN_REQUEST),
    ).rejects.toMatchObject({ code: EVOLUTION_EVAL_AUTHORITY_FAILED_CODE });
  });

  it.each([
    ["revoked trainer", { revocationStatus: "revoked" }],
    ["wrong tenant", { tenantId: "tenant-attacker" }],
    ["wrong audience", { audience: "untrusted-promotion" }],
    ["wrong trainer authority", { trainerAuthority: "trainer-attacker" }],
    ["wrong trainer revision", { trainerRevision: "trainer-revision-v6" }],
    ["wrong artifact", { artifactDigest: `sha256:${"6".repeat(64)}` }],
    [
      "wrong training partition",
      { trainingPartitionDigest: `sha256:${"5".repeat(64)}` },
    ],
    [
      "wrong suite authority",
      { suiteAuthorityDigest: `sha256:${"4".repeat(64)}` },
    ],
  ])(
    "rejects a signed provenance binding with %s",
    async (_label, overrides) => {
      const harness = makeHarness({ provenanceOverrides: overrides });
      await expect(
        runEvolutionEvalGate(harness.gate, RUN_REQUEST),
      ).rejects.toMatchObject({ code: EVOLUTION_EVAL_AUTHORITY_FAILED_CODE });
      expect(harness.ports.executor.execute).not.toHaveBeenCalled();
    },
  );

  it("rejects linkable, reused, or task-equal authority handles before executor exposure", async () => {
    const artifactIdentityHandle = makeHarness({
      subjectOverrides: ({ request }) => ({
        opaqueSubjectHandle: request.opaqueArtifactCapability,
      }),
    });
    await expect(
      runEvolutionEvalGate(artifactIdentityHandle.gate, RUN_REQUEST),
    ).rejects.toMatchObject({ code: EVOLUTION_EVAL_AUTHORITY_FAILED_CODE });
    expect(
      artifactIdentityHandle.ports.executor.execute,
    ).not.toHaveBeenCalled();

    const reusedSubjectHandle = `sha256:${"3".repeat(64)}`;
    const reusedHandle = makeHarness({
      subjectOverrides: { opaqueSubjectHandle: reusedSubjectHandle },
    });
    await expect(
      runEvolutionEvalGate(reusedHandle.gate, RUN_REQUEST),
    ).rejects.toMatchObject({ code: EVOLUTION_EVAL_AUTHORITY_FAILED_CODE });
    expect(reusedHandle.ports.executor.execute).toHaveBeenCalledTimes(1);

    const taskIdentityHandle = makeHarness({
      suiteHandleOverride: ({ evalTask }) => evalTask.taskDigest,
    });
    await expect(
      runEvolutionEvalGate(taskIdentityHandle.gate, RUN_REQUEST),
    ).rejects.toMatchObject({ code: EVOLUTION_EVAL_AUTHORITY_FAILED_CODE });
    expect(taskIdentityHandle.ports.executor.execute).not.toHaveBeenCalled();

    const artifactIdentityTaskHandle = makeHarness({
      suiteHandleOverride: ({ request, evalTask, index }) =>
        index === 0
          ? CANDIDATE_ID
          : `sha256:${createHmac("sha256", "identity-attack-fallback")
              .update(`${request.runNonce}\0${evalTask.taskDigest}`, "utf8")
              .digest("hex")}`,
    });
    await expect(
      runEvolutionEvalGate(artifactIdentityTaskHandle.gate, RUN_REQUEST),
    ).rejects.toMatchObject({ code: EVOLUTION_EVAL_AUTHORITY_FAILED_CODE });
    expect(
      artifactIdentityTaskHandle.ports.executor.execute,
    ).not.toHaveBeenCalled();

    const artifactCapabilityEqualsOtherArtifact = makeHarness({
      artifactCapabilityOverride: (request) =>
        request.role === "candidate" ? BASELINE_ID : `sha256:${"4".repeat(64)}`,
    });
    await expect(
      runEvolutionEvalGate(
        artifactCapabilityEqualsOtherArtifact.gate,
        RUN_REQUEST,
      ),
    ).rejects.toMatchObject({ code: EVOLUTION_EVAL_AUTHORITY_FAILED_CODE });
    expect(
      artifactCapabilityEqualsOtherArtifact.ports.executor.execute,
    ).not.toHaveBeenCalled();
  });

  const namespaceCollisionSuite = suiteWithCounts();
  const namespaceCollisionPolicy = policy();
  const namespaceCollisionCrypto = makeAttestationAuthority();
  it.each([
    ["another task identity", namespaceCollisionSuite.tasks[1].taskDigest],
    ["suite identity", namespaceCollisionSuite.suiteDigest],
    ["environment identity", ENVIRONMENT_DIGEST],
    ["policy identity", namespaceCollisionPolicy.policyDigest],
    [
      "authority trust policy",
      namespaceCollisionCrypto.trusts.suite.trustPolicyDigest,
    ],
    ["a later provenance receipt", `sha256:${"8".repeat(64)}`],
  ])(
    "rejects a task handle that collides with %s in the run-wide typed namespace",
    async (_label, collisionDigest) => {
      const harness = makeHarness({
        suite: namespaceCollisionSuite,
        evalPolicy: namespaceCollisionPolicy,
        suiteHandleOverride: ({ request, evalTask, index }) =>
          index === 0
            ? collisionDigest
            : `sha256:${createHmac("sha256", "namespace-fallback")
                .update(`${request.runNonce}\0${evalTask.taskDigest}`, "utf8")
                .digest("hex")}`,
      });
      await expect(
        runEvolutionEvalGate(harness.gate, RUN_REQUEST),
      ).rejects.toMatchObject({ code: EVOLUTION_EVAL_AUTHORITY_FAILED_CODE });
      expect(harness.ports.executor.execute).not.toHaveBeenCalled();
    },
  );

  it.each(["no-invoke", "value-swap", "double-invoke", "no-revoke"])(
    "rejects a self-consistent supervisor %s attack using local capability state",
    async (supervisorAttack) => {
      const harness = makeHarness({ supervisorAttack });
      await expect(
        runEvolutionEvalGate(harness.gate, RUN_REQUEST),
      ).rejects.toMatchObject({ code: EVOLUTION_EVAL_AUTHORITY_FAILED_CODE });
      expect(harness.ports.executor.execute).not.toHaveBeenCalled();
    },
  );

  it("rejects a supervisor completedAt beyond the explicit trusted-clock skew", async () => {
    const harness = makeHarness({
      suite: suiteWithCounts({ training: 29, validation: 20, test: 20 }),
      supervisorCompletedAtOffsetMs: 1_001,
    });
    await expect(
      runEvolutionEvalGate(harness.gate, RUN_REQUEST),
    ).rejects.toMatchObject({ code: EVOLUTION_EVAL_AUTHORITY_FAILED_CODE });
    expect(harness.ports.handleReplayAuthority.reserve).not.toHaveBeenCalled();
  });

  it("accepts a supervisor completedAt exactly at the trusted-clock skew boundary", async () => {
    const harness = makeHarness({
      suite: suiteWithCounts({ training: 29, validation: 20, test: 20 }),
      supervisorCompletedAtOffsetMs: 1_000,
    });
    const receipt = await runEvolutionEvalGate(harness.gate, RUN_REQUEST);

    expect(receipt.decision).toBe("needs-more-evidence");
    expect(harness.ports.executor.execute).not.toHaveBeenCalled();
  });

  it.each([
    ["invocation", { invocationEvidenceAttack: "self-signed" }],
    ["revocation", { revocationEvidenceAttack: "self-signed" }],
    ["invocation cross-purpose", { invocationEvidenceAttack: "cross-purpose" }],
    ["revocation cross-purpose", { revocationEvidenceAttack: "cross-purpose" }],
    [
      "invocation wrong-revision",
      { invocationEvidenceAttack: "wrong-revision" },
    ],
    [
      "revocation wrong-revision",
      { revocationEvidenceAttack: "wrong-revision" },
    ],
  ])(
    "rejects %s evidence forged outside its independent purpose authority",
    async (_label, options) => {
      const harness = makeHarness(options);
      await expect(
        runEvolutionEvalGate(harness.gate, RUN_REQUEST),
      ).rejects.toMatchObject({ code: EVOLUTION_EVAL_AUTHORITY_FAILED_CODE });
      expect(
        harness.ports.handleReplayAuthority.reserve,
      ).not.toHaveBeenCalled();
    },
  );

  it("rejects evidence verifier ports that belong to the deadline supervisor", () => {
    expect(() =>
      makeHarness({
        invocationEvidenceVerifierOverride: "deadline-supervisor",
      }),
    ).toThrow(/must be independent/u);
    expect(() =>
      makeHarness({
        revocationEvidenceVerifierOverride: "deadline-supervisor",
      }),
    ).toThrow(/must be independent/u);
  });

  it.each([
    ["supervisor and invocation", "supervisor", "invocationEvidence"],
    ["supervisor and revocation", "supervisor", "revocationEvidence"],
    ["invocation and revocation", "invocationEvidence", "revocationEvidence"],
  ])(
    "rejects %s evidence authorities sharing a principal/key under different policies and revisions",
    (_label, sourceRole, targetRole) => {
      const basePolicies = makeAttestationAuthority().authorityPolicies;
      const aliasedPolicies = aliasEvidencePrincipal(
        basePolicies,
        sourceRole,
        targetRole,
      );
      expect(aliasedPolicies[targetRole].trust.trustPolicyDigest).not.toBe(
        aliasedPolicies[sourceRole].trust.trustPolicyDigest,
      );
      expect(aliasedPolicies[targetRole].revision).not.toBe(
        aliasedPolicies[sourceRole].revision,
      );
      expect(() =>
        makeHarness({ authorityPoliciesOverride: aliasedPolicies }),
      ).toThrow(/principal\/key identity/u);
    },
  );

  it.each([
    ["executor and grader", "execution", ["grader"]],
    ["grader and safety", "grader", ["safety"]],
    ["suite resolver and executor", "execution", ["suite"]],
    ["trusted clock and supervisor", "supervisor", ["clock"]],
    ["receipt signer pair and executor", "execution", ["receipt", "verifier"]],
    ["receipt signer pair and grader", "grader", ["receipt", "verifier"]],
    ["receipt signer pair and safety", "safety", ["receipt", "verifier"]],
    [
      "receipt signer pair and supervisor",
      "supervisor",
      ["receipt", "verifier"],
    ],
  ])(
    "rejects %s sharing one principal/key across global authority roles",
    (_label, sourceRole, aliasedRoles) => {
      const base = makeAttestationAuthority();
      const authorityTrustOverrides = Object.fromEntries(
        aliasedRoles.map((role) => [
          role,
          principalKeyAlias(base.trusts[sourceRole]),
        ]),
      );
      expect(() => makeHarness({ authorityTrustOverrides })).toThrow(
        /authority matrix aliases/u,
      );
    },
  );

  it("rejects two grader decisions sharing a principal/key under different policy and revision", () => {
    const base = makeAttestationAuthority();
    const secondGraderPolicy = Object.freeze({
      trust: Object.freeze({
        ...base.trusts.grader,
        trustPolicyDigest: `sha256:${"9".repeat(64)}`,
      }),
      revision: "second-grader-revision-v9",
    });
    expect(() =>
      makeHarness({
        additionalGraderPolicies: [
          ["second-objective-grader", secondGraderPolicy],
        ],
      }),
    ).toThrow(/authority matrix aliases/u);
  });

  it("allows the receipt signer and verifier to use one exact trust pair", () => {
    const base = makeAttestationAuthority();
    expect(() =>
      makeHarness({
        authorityTrustOverrides: {
          verifier: { ...base.trusts.receipt },
        },
        authorityRevisionOverrides: {
          verifier: base.revisions.receipt,
        },
      }),
    ).not.toThrow();
  });

  it("enforces principal/key independence in the external receipt verifier constructor", () => {
    const harness = makeHarness();
    const aliasedPolicies = aliasEvidencePrincipal(
      harness.crypto.authorityPolicies,
      "supervisor",
      "invocationEvidence",
    );
    const aliasedInvocationEvidenceVerifier = Object.freeze({
      verify: harness.crypto.invocationEvidenceVerifier.verify,
      authorityDescriptor: authorityDescriptor({
        handlerId: "invocation-evidence-verifier",
        handlerRevision: aliasedPolicies.invocationEvidence.revision,
        operation: "target-invocation-evidence-verify",
        authority: aliasedPolicies.invocationEvidence.trust,
      }),
    });
    expect(
      () =>
        new EvolutionEvalReceiptVerifier({
          attestationVerifier: harness.ports.declarative.attestationVerifier,
          receiptTrust: harness.crypto.receiptTrust,
          clock: makeTrustedClockPort({
            crypto: harness.crypto,
            now: () => harness.clockControl.read(),
          }),
          clockPolicy: harness.crypto.authorityPolicies.clock,
          deadlineSupervisor: harness.ports.deadlineSupervisor,
          supervisorPolicy: aliasedPolicies.supervisor,
          invocationEvidenceVerifier: aliasedInvocationEvidenceVerifier,
          invocationEvidencePolicy: aliasedPolicies.invocationEvidence,
          revocationEvidenceVerifier: harness.crypto.revocationEvidenceVerifier,
          revocationEvidencePolicy: aliasedPolicies.revocationEvidence,
        }),
    ).toThrow(/principal\/key identity/u);
  });

  it("rejects distinct evidence verifier wrappers that share one raw callable", () => {
    const sharedVerify = vi.fn(() => true);
    expect(() =>
      makeHarness({
        invocationEvidenceVerifierOverride: Object.freeze({
          verify: sharedVerify,
        }),
        revocationEvidenceVerifierOverride: Object.freeze({
          verify: sharedVerify,
        }),
      }),
    ).toThrow(/verifier callable/u);
  });

  it.each([
    "invocationEvidenceVerifierOverride",
    "revocationEvidenceVerifierOverride",
  ])(
    "rejects %s when its wrapper reuses deadlineSupervisor.verifyEnforcement",
    (overrideKey) => {
      expect(() =>
        makeHarness({ [overrideKey]: "deadline-supervisor-callable" }),
      ).toThrow(/verifier callable/u);
    },
  );

  it("rejects aliasing two deadline supervisor lifecycle callables", () => {
    expect(() =>
      makeHarness({
        supervisorCallableAlias: {
          source: "run",
          target: "invokeTarget",
        },
      }),
    ).toThrow(/raw callables/u);
  });

  it("rejects a trusted-clock wrapper that reuses a supervisor callable", () => {
    expect(() =>
      makeHarness({
        trustedClockPortOverride: ({ crypto, deadlineSupervisor, policy }) =>
          makeTrustedClockPort({
            crypto,
            now: deadlineSupervisor.run,
            policy,
          }),
      }),
    ).toThrow(/raw callables/u);
  });

  it("rejects Proxy and accessor clock ports without triggering their traps", () => {
    let proxyTrapCalls = 0;
    expect(() =>
      makeHarness({
        trustedClockPortOverride: ({ crypto, clock, policy }) =>
          new Proxy(makeTrustedClockPort({ crypto, now: clock, policy }), {
            getPrototypeOf() {
              proxyTrapCalls += 1;
              return Object.prototype;
            },
            ownKeys() {
              proxyTrapCalls += 1;
              return [];
            },
          }),
      }),
    ).toThrow(/must be an object/u);
    expect(proxyTrapCalls).toBe(0);

    let getterCalls = 0;
    expect(() =>
      makeHarness({
        trustedClockPortOverride: ({ policy }) => {
          const port = {
            authorityDescriptor: authorityDescriptor({
              handlerId: "accessor-clock",
              handlerRevision: policy.revision,
              operation: "trusted-time-read",
              authority: policy.trust,
            }),
          };
          Object.defineProperty(port, "now", {
            enumerable: true,
            get() {
              getterCalls += 1;
              return () => new Date(FIXED_TIME);
            },
          });
          return port;
        },
      }),
    ).toThrow(/enumerable own data property/u);
    expect(getterCalls).toBe(0);
  });

  it("rejects a same-descriptor handler replacement through its independently attested artifact identity", async () => {
    const replacementArtifactDigest = `sha256:${"6".repeat(64)}`;
    const harness = makeHarness({
      registryHandlerOverride: (target, handler) =>
        target.handlerId === "suite-resolver"
          ? vi.fn(async (...args) => handler(...args))
          : handler,
      registryHandlerArtifactOverride: (target) =>
        target.handlerId === "suite-resolver"
          ? replacementArtifactDigest
          : target.handlerArtifactDigest,
    });
    await expect(
      runEvolutionEvalGate(harness.gate, RUN_REQUEST),
    ).rejects.toMatchObject({ code: EVOLUTION_EVAL_AUTHORITY_FAILED_CODE });
    expect(harness.ports.handleReplayAuthority.reserve).not.toHaveBeenCalled();
  });

  it("rejects an always-true dispatcher hidden behind the verifier descriptor", async () => {
    const harness = makeHarness({
      registryHandlerOverride: (target, handler) =>
        target.handlerId === "attestation-verifier"
          ? vi.fn(async () => true)
          : handler,
      registryHandlerArtifactOverride: (target) =>
        target.handlerId === "attestation-verifier"
          ? `sha256:${"5".repeat(64)}`
          : target.handlerArtifactDigest,
    });
    await expect(
      runEvolutionEvalGate(harness.gate, RUN_REQUEST),
    ).rejects.toMatchObject({ code: EVOLUTION_EVAL_AUTHORITY_FAILED_CODE });
    expect(harness.ports.executor.execute).not.toHaveBeenCalled();
  });

  it.each([
    ["early completed-release", "early-release", "suite"],
    ["pending success after hard revoke", "pending-success", null],
    ["termination without an active target", "terminate-without-active", null],
  ])(
    "rejects %s against the Gate-local invocation promise state",
    async (_label, supervisorAttack, hangingPort) => {
      const harness = makeHarness({
        supervisorAttack,
        hangingPort,
        evalPolicy: policy({
          maxWallClockMs: 1_000,
          portReceiptTtlMs: 2_000,
        }),
      });
      await expect(
        runEvolutionEvalGate(harness.gate, RUN_REQUEST),
      ).rejects.toMatchObject({ code: EVOLUTION_EVAL_AUTHORITY_FAILED_CODE });
      expect(harness.ports.executor.execute).not.toHaveBeenCalled();
    },
  );

  it("revokes a retained invocation capability so a late call cannot reach the target", async () => {
    const harness = makeHarness({ supervisorAttack: "late-invoke" });
    await expect(
      runEvolutionEvalGate(harness.gate, RUN_REQUEST),
    ).rejects.toMatchObject({ code: EVOLUTION_EVAL_AUTHORITY_FAILED_CODE });
    await harness.ports.deadlineSupervisor.attackState.lateSettled;
    expect(
      harness.ports.deadlineSupervisor.attackState.lateError,
    ).toMatchObject({ code: EVOLUTION_EVAL_AUTHORITY_FAILED_CODE });
    expect(harness.ports.suiteVerifier.resolveSuite).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["handler id", { handlerId: "swapped-suite-handler" }],
    ["handler revision", { handlerRevision: "dataset-authority-v0" }],
    [
      "handler authority",
      {
        authority: {
          ...namespaceCollisionCrypto.trusts.suite,
          issuer: "chainlesschain-swapped-authority",
        },
      },
    ],
  ])("rejects a deadline target registry %s swap", async (_label, override) => {
    const harness = makeHarness({
      registryTargetOverride: (target) =>
        target.handlerId === "suite-resolver"
          ? Object.freeze({ ...target, ...override })
          : target,
    });
    await expect(
      runEvolutionEvalGate(harness.gate, RUN_REQUEST),
    ).rejects.toMatchObject({ code: EVOLUTION_EVAL_AUTHORITY_FAILED_CODE });
    expect(harness.ports.handleReplayAuthority.reserve).not.toHaveBeenCalled();
  });

  it("rejects executable closure ports instead of claiming they are hard-isolated", () => {
    expect(() =>
      makeHarness({
        suitePortOverride: { resolveSuite: vi.fn(async () => null) },
      }),
    ).toThrow(/declarative isolated target/u);
  });

  it("fails closed within the local bound when deadlineSupervisor.run never settles", async () => {
    const harness = makeHarness({
      supervisorAttack: "run-never-settles",
      evalPolicy: policy({
        maxWallClockMs: 100,
        portReceiptTtlMs: 1_000,
      }),
    });
    const error = await rejectionWithin(
      runEvolutionEvalGate(harness.gate, RUN_REQUEST),
      4_000,
    );
    expect(error).toMatchObject({
      code: EVOLUTION_EVAL_SUPERVISOR_UNRESPONSIVE_CODE,
    });
    expect(harness.ports.suiteVerifier.resolveSuite).not.toHaveBeenCalled();
  });

  it("rejects a signed termination claim when the actual target promise never settles", async () => {
    const harness = makeHarness({
      supervisorAttack: "claim-terminate-without-settlement",
      hangingPort: "suite",
      evalPolicy: policy({
        maxWallClockMs: 100,
        portReceiptTtlMs: 1_000,
      }),
    });
    const error = await rejectionWithin(
      runEvolutionEvalGate(harness.gate, RUN_REQUEST),
      4_000,
    );
    expect(error).toMatchObject({
      code: EVOLUTION_EVAL_TARGET_SETTLEMENT_UNCONFIRMED_CODE,
    });
    expect(harness.ports.suiteVerifier.resolveSuite).toHaveBeenCalledTimes(1);
  });

  it("allows a signed termination proof to converge inside grace but preserves the domain failure", async () => {
    const harness = makeHarness({
      hangingPort: "suite",
      terminationResponseDelayMs: 250,
      evalPolicy: policy({
        maxWallClockMs: 100,
        portReceiptTtlMs: 1_000,
      }),
    });
    const error = await rejectionWithin(
      runEvolutionEvalGate(harness.gate, RUN_REQUEST),
      1_000,
    );
    expect(error).toMatchObject({ code: EVOLUTION_EVAL_AUTHORITY_FAILED_CODE });
  });

  it("uses the liveness code only when a supervisor response exceeds settlement grace", async () => {
    const harness = makeHarness({
      hangingPort: "suite",
      terminationResponseDelayMs: 2_800,
      evalPolicy: policy({
        maxWallClockMs: 100,
        portReceiptTtlMs: 1_000,
      }),
    });
    const error = await rejectionWithin(
      runEvolutionEvalGate(harness.gate, RUN_REQUEST),
      4_000,
    );
    expect(error).toMatchObject({
      code: EVOLUTION_EVAL_SUPERVISOR_UNRESPONSIVE_CODE,
    });
  });

  it("never accepts a completed result returned after the original monotonic deadline inside grace", async () => {
    const harness = makeHarness({
      suite: suiteWithCounts({ training: 29, validation: 20, test: 20 }),
      completedResponseDelayMs: 150,
      evalPolicy: policy({
        maxWallClockMs: 100,
        portReceiptTtlMs: 1_000,
      }),
    });
    const error = await rejectionWithin(
      runEvolutionEvalGate(harness.gate, RUN_REQUEST),
      1_000,
    );
    expect(error).toMatchObject({ code: EVOLUTION_EVAL_AUTHORITY_FAILED_CODE });
    expect(harness.ports.handleReplayAuthority.reserve).not.toHaveBeenCalled();
  });

  it("enforces one run-wide monotonic budget across serial targets with a fixed trusted clock", async () => {
    const harness = makeHarness({
      suite: suiteWithCounts({ training: 29, validation: 20, test: 20 }),
      completedResponseDelayMs: 60,
      evalPolicy: policy({
        maxWallClockMs: 100,
        portReceiptTtlMs: 1_000,
      }),
    });
    const error = await rejectionWithin(
      runEvolutionEvalGate(harness.gate, RUN_REQUEST),
      1_000,
    );
    expect(error).toMatchObject({ code: EVOLUTION_EVAL_AUTHORITY_FAILED_CODE });
    expect(harness.ports.suiteVerifier.resolveSuite).toHaveBeenCalledTimes(1);
    expect(
      harness.ports.artifactResolver.resolveEnvironment,
    ).not.toHaveBeenCalled();
  });

  it.each([
    "suite",
    "environment",
    "artifact",
    "provenance",
    "subject",
    "replay",
  ])(
    "aborts a hanging %s resolution at the preregistered wall-clock deadline",
    async (hangingPort) => {
      const harness = makeHarness({
        ...targetedHangingOptions(),
        hangingPort,
      });
      await expect(
        runEvolutionEvalGate(harness.gate, RUN_REQUEST),
      ).rejects.toMatchObject({ code: EVOLUTION_EVAL_AUTHORITY_FAILED_CODE });
      const targetPort = {
        suite: harness.ports.suiteVerifier.resolveSuite,
        environment: harness.ports.artifactResolver.resolveEnvironment,
        artifact: harness.ports.artifactResolver.resolveArtifact,
        provenance: harness.ports.provenanceVerifier.verifyProvenance,
        subject: harness.ports.artifactExecutionBroker.issueSubjectHandle,
        replay: harness.ports.handleReplayAuthority.reserve,
      }[hangingPort];
      expect(targetPort).toHaveBeenCalledTimes(1);
      expect(
        harness.ports.deadlineSupervisor.revokeTarget,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ mode: "hard-terminate" }),
      );
      expect(
        harness.ports.deadlineSupervisor.attackState
          .terminatedInvocationRejected,
      ).toBe(true);
      expect(harness.ports.executor.execute).not.toHaveBeenCalled();
    },
    15_000,
  );

  it.each([
    ["execution", EVOLUTION_EVAL_EXECUTION_FAILED_CODE],
    ["grader", EVOLUTION_EVAL_GRADER_FAILED_CODE],
    ["safety", EVOLUTION_EVAL_SAFETY_FAILED_CODE],
  ])(
    "hard-terminates a hanging %s port before another execution is scheduled",
    async (hangingPort, failureCode) => {
      const harness = makeHarness({
        ...targetedHangingOptions(),
        hangingPort,
      });
      await expect(
        runEvolutionEvalGate(harness.gate, RUN_REQUEST),
      ).rejects.toMatchObject({ code: failureCode });
      expect(harness.ports.executor.execute).toHaveBeenCalledTimes(1);
    },
    15_000,
  );

  it("uses a real worker supervisor to kill an operation that ignores AbortSignal without late side effects", async () => {
    const lateSideEffectBuffer = new SharedArrayBuffer(
      Int32Array.BYTES_PER_ELEMENT,
    );
    const lateSideEffect = new Int32Array(lateSideEffectBuffer);
    const harness = makeHarness({
      uncooperativeOperation: "suite-resolve",
      lateSideEffectBuffer,
      evalPolicy: policy({
        maxWallClockMs: 100,
        portReceiptTtlMs: 1_000,
      }),
    });

    await expect(
      runEvolutionEvalGate(harness.gate, RUN_REQUEST),
    ).rejects.toMatchObject({ code: EVOLUTION_EVAL_AUTHORITY_FAILED_CODE });
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(Atomics.load(lateSideEffect, 0)).toBe(0);
    expect(harness.ports.deadlineSupervisor.invokeTarget).toHaveBeenCalledTimes(
      1,
    );
    expect(harness.ports.suiteVerifier.resolveSuite).not.toHaveBeenCalled();
  });

  it("routes a hanging executor through the production process supervisor and confirms hard-kill settlement", async () => {
    const root = mkdtempSync(join(tmpdir(), "cc-gate-process-supervisor-"));
    const pidFile = join(root, "executor.pid");
    const lateFile = join(root, "late.txt");
    const source = [
      'import { writeFile } from "node:fs/promises";',
      "export async function execute(request) {",
      `  await writeFile(${JSON.stringify(pidFile)}, String(process.pid));`,
      "  await new Promise((resolve) => setTimeout(resolve, 3000));",
      `  await writeFile(${JSON.stringify(lateFile)}, "late");`,
      "  return request;",
      "}",
    ].join("\n");
    const modulePath = join(root, "executor.mjs");
    writeFileSync(modulePath, source);
    const handlerArtifactDigest = `sha256:${createHash("sha256")
      .update(source)
      .digest("hex")}`;
    const harness = makeHarness({
      ...targetedHangingOptions(),
      executorTargetTransform: (target) => ({
        ...target,
        isolation: "process",
        handlerArtifactDigest,
      }),
      deadlineSupervisorFactory: ({
        fallbackSupervisor,
        executorTarget,
        crypto,
        clock,
      }) =>
        createEvolutionEvalProcessSupervisor({
          targets: new Map([
            [
              executorTarget.handlerId,
              {
                target: executorTarget,
                modulePath,
                exportName: "execute",
                sandboxPolicy: { fsWrite: [root], memoryLimitMb: 128 },
              },
            ],
          ]),
          authorityDescriptor: fallbackSupervisor.authorityDescriptor,
          supervisorRevision: crypto.revisions.supervisor,
          invocationRevision: crypto.revisions.invocationEvidence,
          revocationRevision: crypto.revisions.revocationEvidence,
          attestSupervisor: (request) =>
            crypto.signers.supervisor.sign(request),
          attestInvocation: (request) =>
            crypto.signers.invocationEvidence.sign(request),
          attestRevocation: (request) =>
            crypto.signers.revocationEvidence.sign(request),
          verifyEnforcement: crypto.verifyEnforcement,
          clock,
          spawnProcess: spawn,
          fallbackSupervisor,
        }),
    });

    await expect(
      runEvolutionEvalGate(harness.gate, RUN_REQUEST),
    ).rejects.toMatchObject({ code: EVOLUTION_EVAL_EXECUTION_FAILED_CODE });
    const childPid = Number(readFileSync(pidFile, "utf8"));
    expect(() => process.kill(childPid, 0)).toThrow();
    await new Promise((resolve) => setTimeout(resolve, 2_100));
    expect(() => readFileSync(lateFile, "utf8")).toThrow();
    expect(harness.ports.executor.execute).not.toHaveBeenCalled();
  }, 15_000);

  it.each([
    ["suite attestation verifier", EVOLUTION_EVAL_ATTESTATION_PURPOSES.suite],
    [
      "final receipt attestation verifier",
      EVOLUTION_EVAL_ATTESTATION_PURPOSES.receipt,
    ],
  ])(
    "aborts a hanging %s at the evaluation deadline",
    async (_label, hangingAttestationVerifierPurpose) => {
      const harness = makeHarness({
        suite: suiteWithCounts({ training: 29, validation: 20, test: 20 }),
        evalPolicy: policy({
          maxWallClockMs: 100,
          portReceiptTtlMs: 1_000,
        }),
        hangingAttestationVerifierPurpose,
      });
      await expect(
        runEvolutionEvalGate(harness.gate, RUN_REQUEST),
      ).rejects.toMatchObject({ code: EVOLUTION_EVAL_AUTHORITY_FAILED_CODE });
    },
  );

  it("aborts a hanging final receipt signer and rechecks trusted time after final receipt verification", async () => {
    const hangingSigner = makeHarness({
      suite: suiteWithCounts({ training: 29, validation: 20, test: 20 }),
      evalPolicy: policy({
        maxWallClockMs: 100,
        portReceiptTtlMs: 1_000,
      }),
      hangingReceiptSigner: true,
    });
    await expect(
      runEvolutionEvalGate(hangingSigner.gate, RUN_REQUEST),
    ).rejects.toMatchObject({ code: EVOLUTION_EVAL_AUTHORITY_FAILED_CODE });

    const crossedDeadline = makeHarness({
      suite: suiteWithCounts({ training: 29, validation: 20, test: 20 }),
      evalPolicy: policy({
        maxWallClockMs: 100,
        portReceiptTtlMs: 1_000,
      }),
      advanceClockOnReceiptVerifyMs: 100,
    });
    await expect(
      runEvolutionEvalGate(crossedDeadline.gate, RUN_REQUEST),
    ).rejects.toMatchObject({ code: EVOLUTION_EVAL_AUTHORITY_FAILED_CODE });
  });

  it("aborts an external receipt verifier and rejects a receipt that expires during asynchronous verification", async () => {
    const harness = makeHarness({
      suite: suiteWithCounts({ training: 29, validation: 20, test: 20 }),
    });
    const receipt = await runEvolutionEvalGate(harness.gate, RUN_REQUEST);
    const hangingRuntime = makeIsolatedVerifierRuntime({
      crypto: harness.crypto,
      clock: () => new Date(FIXED_TIME),
      handler: (_payload, { signal }) =>
        new Promise((resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new Error("receipt verification aborted")),
            { once: true },
          );
        }),
    });
    const hangingVerifier = new EvolutionEvalReceiptVerifier({
      attestationVerifier: hangingRuntime.port,
      receiptTrust: harness.crypto.receiptTrust,
      clock: makeTrustedClockPort({
        crypto: harness.crypto,
        now: () => new Date(FIXED_TIME),
      }),
      clockPolicy: harness.crypto.authorityPolicies.clock,
      maximumVerificationMs: 100,
      deadlineSupervisor: hangingRuntime.supervisor,
      supervisorPolicy: harness.crypto.authorityPolicies.supervisor,
      invocationEvidenceVerifier: hangingRuntime.invocationEvidenceVerifier,
      invocationEvidencePolicy: hangingRuntime.invocationEvidencePolicy,
      revocationEvidenceVerifier: hangingRuntime.revocationEvidenceVerifier,
      revocationEvidencePolicy: hangingRuntime.revocationEvidencePolicy,
    });
    await expect(
      verifyEvolutionEvalReceipt(
        hangingVerifier,
        receipt,
        expectedReceiptContext(receipt),
      ),
    ).rejects.toMatchObject({ code: EVOLUTION_EVAL_AUTHORITY_FAILED_CODE });

    let verifierClock = new Date(FIXED_TIME).getTime();
    const expiringRuntime = makeIsolatedVerifierRuntime({
      crypto: harness.crypto,
      clock: () => new Date(FIXED_TIME),
      handler: async (payload, context) => {
        const accepted = await harness.crypto.verifier.verify(payload, context);
        verifierClock = new Date(receipt.expiresAt).getTime();
        return accepted;
      },
    });
    const expiringVerifier = new EvolutionEvalReceiptVerifier({
      attestationVerifier: expiringRuntime.port,
      receiptTrust: harness.crypto.receiptTrust,
      clock: makeTrustedClockPort({
        crypto: harness.crypto,
        now: () => new Date(verifierClock),
      }),
      clockPolicy: harness.crypto.authorityPolicies.clock,
      maximumVerificationMs: 30_000,
      deadlineSupervisor: expiringRuntime.supervisor,
      supervisorPolicy: harness.crypto.authorityPolicies.supervisor,
      invocationEvidenceVerifier: expiringRuntime.invocationEvidenceVerifier,
      invocationEvidencePolicy: expiringRuntime.invocationEvidencePolicy,
      revocationEvidenceVerifier: expiringRuntime.revocationEvidenceVerifier,
      revocationEvidencePolicy: expiringRuntime.revocationEvidencePolicy,
    });
    await expect(
      verifyEvolutionEvalReceipt(
        expiringVerifier,
        receipt,
        expectedReceiptContext(receipt),
      ),
    ).rejects.toMatchObject({ code: EVOLUTION_EVAL_AUTHORITY_FAILED_CODE });
  });

  it("holds a signed rejected receipt snapshot against rejected-to-accepted mutation during verification", async () => {
    const harness = makeHarness({
      evalPolicy: policy({ maxExecutions: 239 }),
    });
    const signedReceipt = await runEvolutionEvalGate(harness.gate, RUN_REQUEST);
    expect(signedReceipt.decision).toBe("rejected");
    const mutableReceipt = structuredClone(signedReceipt);
    let releaseVerification;
    let markEntered;
    const entered = new Promise((resolve) => {
      markEntered = resolve;
    });
    const release = new Promise((resolve) => {
      releaseVerification = resolve;
    });
    const runtime = makeIsolatedVerifierRuntime({
      crypto: harness.crypto,
      clock: () => new Date(FIXED_TIME),
      handler: async (payload, context) => {
        const accepted = await harness.crypto.verifier.verify(payload, context);
        markEntered();
        await release;
        return accepted;
      },
    });
    const verifier = new EvolutionEvalReceiptVerifier({
      attestationVerifier: runtime.port,
      receiptTrust: harness.crypto.receiptTrust,
      clock: makeTrustedClockPort({
        crypto: harness.crypto,
        now: () => new Date(FIXED_TIME),
      }),
      clockPolicy: harness.crypto.authorityPolicies.clock,
      deadlineSupervisor: runtime.supervisor,
      supervisorPolicy: harness.crypto.authorityPolicies.supervisor,
      invocationEvidenceVerifier: runtime.invocationEvidenceVerifier,
      invocationEvidencePolicy: runtime.invocationEvidencePolicy,
      revocationEvidenceVerifier: runtime.revocationEvidenceVerifier,
      revocationEvidencePolicy: runtime.revocationEvidencePolicy,
    });
    const pending = verifyEvolutionEvalReceipt(
      verifier,
      mutableReceipt,
      expectedReceiptContext(mutableReceipt),
    );
    await entered;
    mutableReceipt.decision = "accepted";
    releaseVerification();

    const verified = await pending;
    expect(verified.decision).toBe("rejected");
    expect(Object.isFrozen(verified)).toBe(true);
  });

  it("holds receipt and expected-context snapshots against a matching mid-await binding swap", async () => {
    const harness = makeHarness({
      suite: suiteWithCounts({ training: 29, validation: 20, test: 20 }),
    });
    const signedReceipt = await runEvolutionEvalGate(harness.gate, RUN_REQUEST);
    const mutableReceipt = structuredClone(signedReceipt);
    const mutableExpected = expectedReceiptContext(mutableReceipt);
    let releaseVerification;
    let markEntered;
    const entered = new Promise((resolve) => {
      markEntered = resolve;
    });
    const release = new Promise((resolve) => {
      releaseVerification = resolve;
    });
    const runtime = makeIsolatedVerifierRuntime({
      crypto: harness.crypto,
      clock: () => new Date(FIXED_TIME),
      handler: async (payload, context) => {
        const accepted = await harness.crypto.verifier.verify(payload, context);
        markEntered();
        await release;
        return accepted;
      },
    });
    const verifier = new EvolutionEvalReceiptVerifier({
      attestationVerifier: runtime.port,
      receiptTrust: harness.crypto.receiptTrust,
      clock: makeTrustedClockPort({
        crypto: harness.crypto,
        now: () => new Date(FIXED_TIME),
      }),
      clockPolicy: harness.crypto.authorityPolicies.clock,
      deadlineSupervisor: runtime.supervisor,
      supervisorPolicy: harness.crypto.authorityPolicies.supervisor,
      invocationEvidenceVerifier: runtime.invocationEvidenceVerifier,
      invocationEvidencePolicy: runtime.invocationEvidencePolicy,
      revocationEvidenceVerifier: runtime.revocationEvidenceVerifier,
      revocationEvidencePolicy: runtime.revocationEvidencePolicy,
    });
    const pending = verifyEvolutionEvalReceipt(
      verifier,
      mutableReceipt,
      mutableExpected,
    );
    await entered;
    const swappedCandidateId = `sha256:${"4".repeat(64)}`;
    mutableReceipt.candidateId = swappedCandidateId;
    mutableExpected.candidateId = swappedCandidateId;
    releaseVerification();

    const verified = await pending;
    expect(verified.candidateId).toBe(CANDIDATE_ID);
  });

  it("rechecks receipt expiry before returning the frozen entry snapshot", async () => {
    const harness = makeHarness({
      suite: suiteWithCounts({ training: 29, validation: 20, test: 20 }),
    });
    const receipt = await runEvolutionEvalGate(harness.gate, RUN_REQUEST);
    let signatureVerified = false;
    let postVerificationClockReads = 0;
    const fixedMilliseconds = new Date(FIXED_TIME).getTime();
    const verifierClock = () => {
      if (!signatureVerified) return new Date(fixedMilliseconds);
      postVerificationClockReads += 1;
      return postVerificationClockReads >= 3
        ? new Date(receipt.expiresAt)
        : new Date(fixedMilliseconds);
    };
    const cloningRuntime = makeIsolatedVerifierRuntime({
      crypto: harness.crypto,
      clock: () => new Date(FIXED_TIME),
      handler: async (payload, context) => {
        const accepted = await harness.crypto.verifier.verify(payload, context);
        signatureVerified = accepted;
        return accepted;
      },
    });
    const verifier = new EvolutionEvalReceiptVerifier({
      attestationVerifier: cloningRuntime.port,
      receiptTrust: harness.crypto.receiptTrust,
      clock: makeTrustedClockPort({
        crypto: harness.crypto,
        now: verifierClock,
      }),
      clockPolicy: harness.crypto.authorityPolicies.clock,
      maximumVerificationMs: 30_000,
      deadlineSupervisor: cloningRuntime.supervisor,
      supervisorPolicy: harness.crypto.authorityPolicies.supervisor,
      invocationEvidenceVerifier: cloningRuntime.invocationEvidenceVerifier,
      invocationEvidencePolicy: cloningRuntime.invocationEvidencePolicy,
      revocationEvidenceVerifier: cloningRuntime.revocationEvidenceVerifier,
      revocationEvidencePolicy: cloningRuntime.revocationEvidencePolicy,
    });

    await expect(
      verifyEvolutionEvalReceipt(
        verifier,
        receipt,
        expectedReceiptContext(receipt),
      ),
    ).rejects.toMatchObject({ code: EVOLUTION_EVAL_AUTHORITY_FAILED_CODE });
    // Invocation and revocation evidence consume trusted timeline phases;
    // after the supervisor signature, a fourth read bounds its completedAt
    // against trusted-now plus skew. The fifth read is the pre-existing final
    // post-signature snapshot-return deadline/expiry check, so neither phase can mask the
    // other by advancing the clock between verification and return.
    expect(postVerificationClockReads).toBe(5);
  });

  it("rejects a signed executor receipt that weakens or exceeds the exact remaining hard budget", async () => {
    const weakened = makeHarness({
      executorLimitsOverride: (request) => ({
        ...request.remainingHardBudget,
        tokens: request.remainingHardBudget.tokens + 1,
      }),
    });
    await expect(
      runEvolutionEvalGate(weakened.gate, RUN_REQUEST),
    ).rejects.toMatchObject({ code: EVOLUTION_EVAL_EXECUTION_FAILED_CODE });

    const exceeded = makeHarness({
      evalPolicy: policy({ maxTotalTokens: 50 }),
      baselineMetrics: {
        tokens: 51,
        latencyMs: 1,
        toolCalls: 0,
        costMicrounits: 0,
        errors: 0,
      },
      candidateMetrics: {
        tokens: 51,
        latencyMs: 1,
        toolCalls: 0,
        costMicrounits: 0,
        errors: 0,
      },
    });
    await expect(
      runEvolutionEvalGate(exceeded.gate, RUN_REQUEST),
    ).rejects.toMatchObject({ code: EVOLUTION_EVAL_EXECUTION_FAILED_CODE });
    expect(exceeded.ports.executor.execute).toHaveBeenCalledTimes(1);
  });

  it("rejects a public rehash forgery because receipt authenticity is independent of its SHA digest", async () => {
    const harness = makeHarness({
      suite: suiteWithCounts({ training: 29, validation: 20, test: 20 }),
    });
    const receipt = await runEvolutionEvalGate(harness.gate, RUN_REQUEST);
    const forged = {
      ...receipt,
      decision: "rejected",
      reasonCodes: ["forged-decision"],
    };
    forged.receiptDigest = computeEvolutionEvalReceiptDigest(forged);

    await expect(
      verifyEvolutionEvalReceipt(
        harness.receiptVerifier,
        forged,
        expectedReceiptContext(receipt),
      ),
    ).rejects.toMatchObject({ code: EVOLUTION_EVAL_AUTHORITY_FAILED_CODE });
  });

  it("rejects an authentic receipt in a different artifact or run context", async () => {
    const harness = makeHarness({
      suite: suiteWithCounts({ training: 29, validation: 20, test: 20 }),
    });
    const receipt = await runEvolutionEvalGate(harness.gate, RUN_REQUEST);

    await expect(
      verifyEvolutionEvalReceipt(harness.receiptVerifier, receipt, {
        ...expectedReceiptContext(receipt),
        candidateId: `sha256:${"e".repeat(64)}`,
      }),
    ).rejects.toMatchObject({ code: EVOLUTION_EVAL_AUTHORITY_FAILED_CODE });
    await expect(
      verifyEvolutionEvalReceipt(harness.receiptVerifier, receipt, {
        ...expectedReceiptContext(receipt),
        runNonce: "nonce-attacker-selected-replay",
      }),
    ).rejects.toMatchObject({ code: EVOLUTION_EVAL_AUTHORITY_FAILED_CODE });
  });

  it("keeps public suite/policy helpers canonical while making their hashes non-authoritative", () => {
    const evalTask = buildEvolutionEvalTask(task("training", 0));
    const evalSuite = suiteWithCounts();
    const evalPolicy = policy();

    expect(verifyEvolutionEvalTask(evalTask)).toEqual(evalTask);
    expect(verifyEvolutionEvalSuite(evalSuite)).toEqual(evalSuite);
    expect(verifyEvolutionEvalPolicy(evalPolicy)).toEqual(evalPolicy);
    expect(Object.isFrozen(evalTask.privateExpected)).toBe(true);
    expect(Object.isFrozen(evalSuite.tasks)).toBe(true);
    expect(Object.isFrozen(evalPolicy.seeds)).toBe(true);
    expect(() =>
      verifyEvolutionEvalTask({ ...evalTask, extra: true }),
    ).toThrow();
    expect(() =>
      verifyEvolutionEvalSuite({
        ...evalSuite,
        suiteDigest: `sha256:${"f".repeat(64)}`,
      }),
    ).toThrow();
  });

  it("rejects oversized, over-wide, accessor, and Proxy values before canonical sorting or getter execution", () => {
    expect(() =>
      buildEvolutionEvalTask(
        task("training", 0, {
          publicInput: "x".repeat(1024 * 1024 + 1),
        }),
      ),
    ).toThrowError(
      expect.objectContaining({ code: EVOLUTION_EVAL_INVALID_CODE }),
    );

    const wideInput = Object.fromEntries(
      Array.from({ length: 10_001 }, (_, index) => [`field-${index}`, true]),
    );
    expect(() =>
      buildEvolutionEvalTask(task("training", 0, { publicInput: wideInput })),
    ).toThrowError(
      expect.objectContaining({ code: EVOLUTION_EVAL_INVALID_CODE }),
    );

    let getterCalls = 0;
    const accessorInput = {};
    Object.defineProperty(accessorInput, "danger", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "executed";
      },
    });
    expect(() =>
      buildEvolutionEvalTask(
        task("training", 0, { publicInput: accessorInput }),
      ),
    ).toThrowError(
      expect.objectContaining({ code: EVOLUTION_EVAL_INVALID_CODE }),
    );
    expect(getterCalls).toBe(0);

    let proxyTrapCalls = 0;
    const proxyInput = new Proxy(
      { harmless: true },
      {
        ownKeys(target) {
          proxyTrapCalls += 1;
          return Reflect.ownKeys(target);
        },
      },
    );
    expect(() =>
      buildEvolutionEvalTask(task("training", 0, { publicInput: proxyInput })),
    ).toThrowError(
      expect.objectContaining({ code: EVOLUTION_EVAL_INVALID_CODE }),
    );
    expect(proxyTrapCalls).toBe(0);

    let tasksProxyTrapCalls = 0;
    const tasksProxy = new Proxy([task("training", 0)], {
      get(target, property, receiver) {
        tasksProxyTrapCalls += 1;
        return Reflect.get(target, property, receiver);
      },
    });
    expect(() =>
      buildEvolutionEvalSuite({
        suiteId: "proxy-suite",
        datasetVersion: "dataset-v1",
        tasks: tasksProxy,
      }),
    ).toThrowError(
      expect.objectContaining({ code: EVOLUTION_EVAL_INVALID_CODE }),
    );
    expect(tasksProxyTrapCalls).toBe(0);

    let prototypeTrapCalls = 0;
    const prototypeTrapInput = new Proxy(
      { harmless: true },
      {
        getPrototypeOf() {
          prototypeTrapCalls += 1;
          return Object.prototype;
        },
      },
    );
    expect(() =>
      buildEvolutionEvalTask(
        task("training", 0, { publicInput: prototypeTrapInput }),
      ),
    ).toThrowError(
      expect.objectContaining({ code: EVOLUTION_EVAL_INVALID_CODE }),
    );
    expect(prototypeTrapCalls).toBe(0);

    const customPrototypeTasks = [task("training", 0)];
    Object.setPrototypeOf(customPrototypeTasks, Object.create(Array.prototype));
    expect(() =>
      buildEvolutionEvalSuite({
        suiteId: "custom-array-prototype-suite",
        datasetVersion: "dataset-v1",
        tasks: customPrototypeTasks,
      }),
    ).toThrowError(
      expect.objectContaining({ code: EVOLUTION_EVAL_INVALID_CODE }),
    );

    let schemaGetterCalls = 0;
    const schemaGetterTask = task("training", 0);
    Object.defineProperty(schemaGetterTask, "schema", {
      enumerable: true,
      get() {
        schemaGetterCalls += 1;
        return new Promise(() => {});
      },
    });
    expect(() =>
      buildEvolutionEvalSuite({
        suiteId: "getter-suite",
        datasetVersion: "dataset-v1",
        tasks: [schemaGetterTask],
      }),
    ).toThrowError(
      expect.objectContaining({ code: EVOLUTION_EVAL_INVALID_CODE }),
    );
    expect(schemaGetterCalls).toBe(0);
  });

  it("rejects group and exact-input leakage across train/validation/test", () => {
    expect(() =>
      buildEvolutionEvalSuite({
        suiteId: "leaking-suite",
        datasetVersion: "dataset-v1",
        tasks: [
          task("training", 1),
          task("validation", 2, {
            groupKeys: [
              "time-training-1",
              "project-validation-2",
              "user-validation-2",
              "near-duplicate-validation-2",
            ],
          }),
        ],
      }),
    ).toThrowError(
      expect.objectContaining({ code: EVOLUTION_EVAL_LEAKAGE_CODE }),
    );

    const sameInput = task("training", 1).publicInput;
    expect(() =>
      buildEvolutionEvalSuite({
        suiteId: "duplicate-input-suite",
        datasetVersion: "dataset-v1",
        tasks: [
          task("training", 1),
          task("test", 9, { publicInput: sameInput }),
        ],
      }),
    ).toThrowError(
      expect.objectContaining({ code: EVOLUTION_EVAL_LEAKAGE_CODE }),
    );
  });

  it("does not allow policy authors to weaken evidence, paired seeds, deadlines, or total limits", () => {
    expect(() => policy({ minTrainingTasks: 29 })).toThrow();
    expect(() => policy({ minValidationTasks: 19 })).toThrow();
    expect(() => policy({ minTestTasks: 19 })).toThrow();
    expect(() => policy({ seeds: [1, 2] })).toThrow();
    expect(() => policy({ minimumAbsoluteImprovement: 0.049 })).toThrow();
    expect(() => policy({ minimumEfficiencyImprovement: 0.099 })).toThrow();
    expect(() =>
      policy({ maxWallClockMs: 60_001, portReceiptTtlMs: 60_000 }),
    ).toThrow();
    expect(() => policy({ maxExecutions: 0 })).toThrow();
  });
});

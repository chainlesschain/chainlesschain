import { createHash, randomUUID } from "node:crypto";
import { types } from "node:util";

import {
  BROWSER_FILESYSTEM_QUARANTINE_EXPIRY_PLAN_SCHEMA,
  captureBrowserFilesystemQuarantineCustody,
} from "./browser-filesystem-quarantine-custody.js";

export const BROWSER_QUARANTINE_RETENTION_SWEEP_REQUEST_SCHEMA =
  "chainlesschain.browser-quarantine-retention-sweep-request/v1";
export const BROWSER_QUARANTINE_RETENTION_SWEEP_RECEIPT_SCHEMA =
  "chainlesschain.browser-quarantine-retention-sweep-receipt/v1";
export const BROWSER_QUARANTINE_RETENTION_SWEEP_RESULT_SCHEMA =
  "chainlesschain.browser-quarantine-retention-sweep-result/v1";
export const BROWSER_QUARANTINE_RETENTION_OUTCOME_REQUEST_SCHEMA =
  "chainlesschain.browser-quarantine-retention-outcome-request/v1";
export const BROWSER_QUARANTINE_RETENTION_OUTCOME_ACK_SCHEMA =
  "chainlesschain.browser-quarantine-retention-outcome-ack/v1";

const DELETION_ACK_SCHEMA =
  "chainlesschain.browser-download-artifact-deletion-ack/v1";
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9._:-]{1,128}$/u;
const ARTIFACT_REF = /^quarantine:[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/u;
const authorities = new WeakMap();

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function digest(domain, value) {
  return `sha256:${createHash("sha256")
    .update(`${domain}\0`)
    .update(canonical(value))
    .digest("hex")}`;
}

function exact(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    types.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).length !== keys.length ||
    keys.some((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return !descriptor?.enumerable || !("value" in descriptor);
    })
  )
    throw new TypeError(`${label} has unexpected or accessor fields`);
}

function normalizeDecision(value, nowMs, maxGrantTtlMs) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    types.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new TypeError("retention sweep decision is invalid");
  const decision = Object.getOwnPropertyDescriptor(value, "decision");
  if (!decision?.enumerable || !("value" in decision))
    throw new TypeError("retention sweep decision is invalid");
  if (decision.value === "deny") {
    exact(value, ["decision", "reason"], "retention sweep denial");
    if (
      typeof value.reason !== "string" ||
      value.reason.length < 1 ||
      value.reason.length > 512
    )
      throw new TypeError("retention sweep denial is invalid");
    return Object.freeze({ ...value });
  }
  exact(
    value,
    ["decision", "policyEvidenceRef", "validUntil"],
    "retention sweep approval",
  );
  const validUntilMs = Date.parse(value.validUntil);
  if (
    value.decision !== "allow" ||
    typeof value.policyEvidenceRef !== "string" ||
    value.policyEvidenceRef.length < 1 ||
    value.policyEvidenceRef.length > 512 ||
    !Number.isFinite(validUntilMs) ||
    validUntilMs <= nowMs ||
    validUntilMs > nowMs + maxGrantTtlMs
  )
    throw new TypeError("retention sweep approval is invalid");
  return Object.freeze({ ...value, validUntilMs });
}

function normalizePlanArtifact(value, cutoffAt, nowMs) {
  exact(
    value,
    [
      "artifactRef",
      "artifactRefDigest",
      "artifactDigest",
      "sourceActionReceiptDigest",
      "expiresAt",
    ],
    "retention expiry plan artifact",
  );
  const expiresAtMs = Date.parse(value.expiresAt);
  if (
    !ARTIFACT_REF.test(value.artifactRef) ||
    value.artifactRefDigest !==
      digest(
        "chainlesschain.browser-download-artifact-ref/v1",
        value.artifactRef,
      ) ||
    !DIGEST.test(value.artifactDigest) ||
    !DIGEST.test(value.sourceActionReceiptDigest) ||
    !Number.isFinite(expiresAtMs) ||
    new Date(expiresAtMs).toISOString() !== value.expiresAt ||
    expiresAtMs > Date.parse(cutoffAt) ||
    expiresAtMs > nowMs
  )
    throw new Error("retention expiry plan artifact is invalid");
  return Object.freeze({ ...value });
}

function validatePlan(plan, descriptor, sweepId, cutoffAt, nowMs) {
  exact(
    plan,
    [
      "schema",
      "custodyId",
      "authorityId",
      "tenantId",
      "handlerArtifactDigest",
      "policyRevision",
      "sweepId",
      "cutoffAt",
      "plannedAt",
      "artifacts",
      "planDigest",
    ],
    "retention expiry plan",
  );
  if (!Array.isArray(plan.artifacts))
    throw new Error("retention expiry plan is invalid");
  const artifacts = Object.freeze(
    plan.artifacts.map((artifact) =>
      normalizePlanArtifact(artifact, cutoffAt, nowMs),
    ),
  );
  if (
    new Set(artifacts.map((artifact) => artifact.artifactRef)).size !==
      artifacts.length ||
    artifacts.some(
      (artifact, index) =>
        index > 0 &&
        artifacts[index - 1].artifactRef.localeCompare(artifact.artifactRef) >=
          0,
    )
  )
    throw new Error("retention expiry plan artifacts are not canonical");
  const core = Object.freeze({
    schema: plan.schema,
    custodyId: plan.custodyId,
    authorityId: plan.authorityId,
    tenantId: plan.tenantId,
    handlerArtifactDigest: plan.handlerArtifactDigest,
    policyRevision: plan.policyRevision,
    sweepId: plan.sweepId,
    cutoffAt: plan.cutoffAt,
    plannedAt: plan.plannedAt,
    artifacts,
  });
  if (
    plan.schema !== BROWSER_FILESYSTEM_QUARANTINE_EXPIRY_PLAN_SCHEMA ||
    !ID.test(plan.custodyId) ||
    plan.authorityId !== descriptor.authorityId ||
    plan.tenantId !== descriptor.tenantId ||
    plan.handlerArtifactDigest !== descriptor.handlerArtifactDigest ||
    plan.policyRevision !== descriptor.policyRevision ||
    plan.sweepId !== sweepId ||
    plan.cutoffAt !== cutoffAt ||
    Date.parse(plan.plannedAt) !== nowMs ||
    artifacts.length > descriptor.maxBatchSize ||
    plan.planDigest !==
      digest(BROWSER_FILESYSTEM_QUARANTINE_EXPIRY_PLAN_SCHEMA, core)
  )
    throw new Error("retention expiry plan is invalid");
  return Object.freeze({ ...plan, artifacts });
}

function validateDeletionAck(value, descriptor, artifact, receiptDigest) {
  exact(
    value,
    [
      "schema",
      "authorityId",
      "tenantId",
      "handlerArtifactDigest",
      "actionReceiptDigest",
      "requestDigest",
      "artifactRef",
      "artifactDigest",
      "sourceActionReceiptDigest",
      "discardedAt",
      "deletionReceiptDigest",
      "authenticated",
      "durable",
      "readbackVerified",
      "bytesUnavailable",
      "qualifiesForPromotion",
    ],
    "retention deletion acknowledgement",
  );
  if (
    value.schema !== DELETION_ACK_SCHEMA ||
    value.authorityId !== descriptor.authorityId ||
    value.tenantId !== descriptor.tenantId ||
    value.handlerArtifactDigest !== descriptor.handlerArtifactDigest ||
    value.actionReceiptDigest !== receiptDigest ||
    !DIGEST.test(value.requestDigest) ||
    value.artifactRef !== artifact.artifactRef ||
    value.artifactDigest !== artifact.artifactDigest ||
    value.sourceActionReceiptDigest !== artifact.sourceActionReceiptDigest ||
    !Number.isFinite(Date.parse(value.discardedAt)) ||
    !DIGEST.test(value.deletionReceiptDigest) ||
    value.authenticated !== true ||
    value.durable !== true ||
    value.readbackVerified !== true ||
    value.bytesUnavailable !== true ||
    value.qualifiesForPromotion !== false
  )
    throw new Error("retention deletion acknowledgement is invalid");
  return value;
}

function normalizeOutcomeAck(value, descriptor, request) {
  exact(
    value,
    [
      "schema",
      "authorityId",
      "tenantId",
      "handlerArtifactDigest",
      "sweepReceiptDigest",
      "outcomeRequestDigest",
      "auditEventDigest",
      "durabilityReceiptDigest",
      "authenticated",
      "durable",
      "readbackVerified",
      "qualifiesForPromotion",
    ],
    "retention sweep outcome acknowledgement",
  );
  if (
    value.schema !== BROWSER_QUARANTINE_RETENTION_OUTCOME_ACK_SCHEMA ||
    value.authorityId !== descriptor.authorityId ||
    value.tenantId !== descriptor.tenantId ||
    value.handlerArtifactDigest !== descriptor.handlerArtifactDigest ||
    value.sweepReceiptDigest !== request.sweepReceiptDigest ||
    value.outcomeRequestDigest !== request.outcomeRequestDigest ||
    !DIGEST.test(value.auditEventDigest) ||
    !DIGEST.test(value.durabilityReceiptDigest) ||
    value.authenticated !== true ||
    value.durable !== true ||
    value.readbackVerified !== true ||
    value.qualifiesForPromotion !== false
  )
    throw new Error("retention sweep outcome acknowledgement is invalid");
  return Object.freeze({ ...value });
}

export function createBrowserQuarantineRetentionAuthority(options) {
  exact(
    options,
    ["descriptor", "custody", "authorizeSweep", "recordOutcome", "now"],
    "browser quarantine retention authority",
  );
  const custody = captureBrowserFilesystemQuarantineCustody(options.custody);
  const retention = custody.bindRetentionAuthority(options.descriptor);
  if (
    typeof options.authorizeSweep !== "function" ||
    types.isProxy(options.authorizeSweep) ||
    typeof options.recordOutcome !== "function" ||
    types.isProxy(options.recordOutcome) ||
    typeof options.now !== "function" ||
    types.isProxy(options.now)
  )
    throw new TypeError("browser quarantine retention ports are invalid");
  const authority = Object.freeze({});
  authorities.set(authority, {
    descriptor: Object.freeze({ ...options.descriptor }),
    authorizeSweep: options.authorizeSweep,
    recordOutcome: options.recordOutcome,
    now: options.now,
    retention,
    running: false,
  });
  return authority;
}

export function captureBrowserQuarantineRetentionAuthority(value) {
  const state = authorities.get(value);
  if (!state)
    throw new TypeError(
      "A branded browser quarantine retention authority is required",
    );
  return Object.freeze({
    descriptor: state.descriptor,
    runExpirySweep: async () => {
      if (state.running)
        throw new Error("browser quarantine retention sweep is already active");
      state.running = true;
      try {
        const nowMs = state.now();
        if (!Number.isFinite(nowMs))
          throw new Error("browser quarantine retention clock is invalid");
        const cutoffAt = new Date(nowMs).toISOString();
        const sweepId = randomUUID();
        const plan = validatePlan(
          await state.retention.planExpiredArtifacts({
            sweepId,
            cutoffAt,
            maxArtifacts: state.descriptor.maxBatchSize,
          }),
          state.descriptor,
          sweepId,
          cutoffAt,
          nowMs,
        );
        const request = Object.freeze({
          schema: BROWSER_QUARANTINE_RETENTION_SWEEP_REQUEST_SCHEMA,
          authorityId: state.descriptor.authorityId,
          tenantId: state.descriptor.tenantId,
          handlerArtifactDigest: state.descriptor.handlerArtifactDigest,
          policyRevision: state.descriptor.policyRevision,
          sweepId,
          cutoffAt,
          planDigest: plan.planDigest,
          artifactCount: plan.artifacts.length,
          artifacts: Object.freeze(
            plan.artifacts.map((artifact) =>
              Object.freeze({
                artifactRefDigest: artifact.artifactRefDigest,
                artifactDigest: artifact.artifactDigest,
                expiresAt: artifact.expiresAt,
              }),
            ),
          ),
          requestedAt: cutoffAt,
        });
        const decision = normalizeDecision(
          await state.authorizeSweep(request),
          nowMs,
          state.descriptor.maxGrantTtlMs,
        );
        if (decision.decision === "deny") {
          const error = new Error(decision.reason);
          error.code = "BROWSER_QUARANTINE_RETENTION_DENIED";
          throw error;
        }
        const receiptCore = Object.freeze({
          schema: BROWSER_QUARANTINE_RETENTION_SWEEP_RECEIPT_SCHEMA,
          authorityId: state.descriptor.authorityId,
          tenantId: state.descriptor.tenantId,
          handlerArtifactDigest: state.descriptor.handlerArtifactDigest,
          policyRevision: state.descriptor.policyRevision,
          sweepId,
          cutoffAt,
          planDigest: plan.planDigest,
          artifactCount: plan.artifacts.length,
          policyEvidenceRef: decision.policyEvidenceRef,
          authorizedAt: cutoffAt,
          validUntil: decision.validUntil,
        });
        const receiptDigest = digest(
          BROWSER_QUARANTINE_RETENTION_SWEEP_RECEIPT_SCHEMA,
          receiptCore,
        );
        const deletions = [];
        let executionError = null;
        for (const artifact of plan.artifacts) {
          try {
            const executionMs = state.now();
            if (
              !Number.isFinite(executionMs) ||
              executionMs >= decision.validUntilMs
            )
              throw new Error("retention sweep grant expired during execution");
            const acknowledgement = validateDeletionAck(
              await state.retention.disposeExpiredArtifact({
                sweepReceiptDigest: receiptDigest,
                planDigest: plan.planDigest,
                sweepId,
                cutoffAt,
                ...artifact,
              }),
              state.descriptor,
              artifact,
              receiptDigest,
            );
            deletions.push(
              Object.freeze({
                artifactRefDigest: artifact.artifactRefDigest,
                artifactDigest: artifact.artifactDigest,
                discardedAt: acknowledgement.discardedAt,
                deletionReceiptDigest: acknowledgement.deletionReceiptDigest,
              }),
            );
          } catch (error) {
            executionError = error;
            break;
          }
        }
        const completedMs = state.now();
        if (!Number.isFinite(completedMs))
          throw new Error("browser quarantine retention clock is invalid");
        const status = executionError === null ? "succeeded" : "failed";
        const failureDigest =
          executionError === null
            ? null
            : digest("chainlesschain.browser-quarantine-retention-failure/v1", {
                name: executionError?.name ?? "Error",
                code: executionError?.code ?? null,
              });
        const outcomeCore = Object.freeze({
          schema: BROWSER_QUARANTINE_RETENTION_OUTCOME_REQUEST_SCHEMA,
          authorityId: state.descriptor.authorityId,
          tenantId: state.descriptor.tenantId,
          handlerArtifactDigest: state.descriptor.handlerArtifactDigest,
          policyRevision: state.descriptor.policyRevision,
          sweepId,
          sweepReceiptDigest: receiptDigest,
          planDigest: plan.planDigest,
          status,
          plannedCount: plan.artifacts.length,
          deletedCount: deletions.length,
          deletionReceiptDigests: Object.freeze(
            deletions.map((entry) => entry.deletionReceiptDigest),
          ),
          failureDigest,
          recordedAt: new Date(completedMs).toISOString(),
        });
        const outcomeRequest = Object.freeze({
          ...outcomeCore,
          outcomeRequestDigest: digest(
            BROWSER_QUARANTINE_RETENTION_OUTCOME_REQUEST_SCHEMA,
            outcomeCore,
          ),
        });
        const outcomeAck = normalizeOutcomeAck(
          await state.recordOutcome(outcomeRequest),
          state.descriptor,
          outcomeRequest,
        );
        if (executionError !== null) {
          const uncertain = new Error("retention sweep execution failed", {
            cause: executionError,
          });
          uncertain.code = "BROWSER_QUARANTINE_RETENTION_SWEEP_FAILED";
          throw uncertain;
        }
        const resultCore = Object.freeze({
          schema: BROWSER_QUARANTINE_RETENTION_SWEEP_RESULT_SCHEMA,
          authorityId: state.descriptor.authorityId,
          tenantId: state.descriptor.tenantId,
          handlerArtifactDigest: state.descriptor.handlerArtifactDigest,
          policyRevision: state.descriptor.policyRevision,
          sweepId,
          cutoffAt,
          planDigest: plan.planDigest,
          sweepReceiptDigest: receiptDigest,
          plannedCount: plan.artifacts.length,
          deletedCount: deletions.length,
          deletions: Object.freeze(deletions),
          outcomeRequestDigest: outcomeRequest.outcomeRequestDigest,
          auditEventDigest: outcomeAck.auditEventDigest,
          durabilityReceiptDigest: outcomeAck.durabilityReceiptDigest,
          completedAt: new Date(completedMs).toISOString(),
        });
        return Object.freeze({
          ...resultCore,
          resultDigest: digest(
            BROWSER_QUARANTINE_RETENTION_SWEEP_RESULT_SCHEMA,
            resultCore,
          ),
          authenticated: true,
          durable: true,
          readbackVerified: true,
          qualifiesForPromotion: false,
        });
      } finally {
        state.running = false;
      }
    },
  });
}

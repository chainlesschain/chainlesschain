import { createHash } from "node:crypto";
import { types } from "node:util";

import { captureBrowserFilesystemQuarantineCustody } from "./browser-filesystem-quarantine-custody.js";
export { BROWSER_FILESYSTEM_QUARANTINE_OPERATOR_REVOCATION_DESCRIPTOR_SCHEMA } from "./browser-filesystem-quarantine-custody.js";

export const BROWSER_QUARANTINE_OPERATOR_REVOCATION_REQUEST_SCHEMA =
  "chainlesschain.browser-quarantine-operator-revocation-request/v1";
export const BROWSER_QUARANTINE_OPERATOR_REVOCATION_RECEIPT_SCHEMA =
  "chainlesschain.browser-quarantine-operator-revocation-receipt/v1";
export const BROWSER_QUARANTINE_OPERATOR_REVOCATION_OUTCOME_REQUEST_SCHEMA =
  "chainlesschain.browser-quarantine-operator-revocation-outcome-request/v1";
export const BROWSER_QUARANTINE_OPERATOR_REVOCATION_OUTCOME_ACK_SCHEMA =
  "chainlesschain.browser-quarantine-operator-revocation-outcome-ack/v1";
export const BROWSER_QUARANTINE_OPERATOR_REVOCATION_RESULT_SCHEMA =
  "chainlesschain.browser-quarantine-operator-revocation-result/v1";

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

function snapshotJson(value, label) {
  const visit = (entry, depth) => {
    if (depth > 8) throw new TypeError(`${label} exceeds its depth budget`);
    if (
      entry === null ||
      typeof entry === "string" ||
      typeof entry === "boolean" ||
      (typeof entry === "number" && Number.isFinite(entry))
    )
      return entry;
    if (
      !entry ||
      typeof entry !== "object" ||
      types.isProxy(entry) ||
      ![Object.prototype, null, Array.prototype].includes(
        Object.getPrototypeOf(entry),
      )
    )
      throw new TypeError(`${label} must be finite plain JSON data`);
    if (Array.isArray(entry))
      return Object.freeze(entry.map((item) => visit(item, depth + 1)));
    const result = {};
    for (const key of Object.keys(entry)) {
      const descriptor = Object.getOwnPropertyDescriptor(entry, key);
      if (!descriptor?.enumerable || !("value" in descriptor))
        throw new TypeError(`${label} must contain plain data`);
      result[key] = visit(descriptor.value, depth + 1);
    }
    return Object.freeze(result);
  };
  const result = visit(value, 0);
  if (Buffer.byteLength(canonical(result), "utf8") > 16 * 1024)
    throw new TypeError(`${label} exceeds its byte budget`);
  return result;
}

function normalizeRequest(value) {
  exact(
    value,
    [
      "schema",
      "requestId",
      "artifactRef",
      "artifactDigest",
      "sourceActionReceiptDigest",
      "operatorIdDigest",
      "authorization",
      "requestedAt",
    ],
    "operator revocation request",
  );
  if (
    value.schema !== BROWSER_QUARANTINE_OPERATOR_REVOCATION_REQUEST_SCHEMA ||
    !ID.test(value.requestId) ||
    !ARTIFACT_REF.test(value.artifactRef) ||
    !DIGEST.test(value.artifactDigest) ||
    !DIGEST.test(value.sourceActionReceiptDigest) ||
    !DIGEST.test(value.operatorIdDigest) ||
    !Number.isFinite(Date.parse(value.requestedAt))
  )
    throw new TypeError("operator revocation request is invalid");
  return Object.freeze({
    ...value,
    authorization: snapshotJson(value.authorization, "operator authorization"),
  });
}

function normalizeDecision(value, nowMs, maxGrantTtlMs) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    types.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new TypeError("operator revocation decision is invalid");
  const decision = Object.getOwnPropertyDescriptor(value, "decision");
  if (!decision?.enumerable || !("value" in decision))
    throw new TypeError("operator revocation decision is invalid");
  if (decision.value === "deny") {
    exact(value, ["decision", "reason"], "operator revocation denial");
    if (
      typeof value.reason !== "string" ||
      value.reason.length < 1 ||
      value.reason.length > 512
    )
      throw new TypeError("operator revocation denial is invalid");
    return Object.freeze({ ...value });
  }
  exact(
    value,
    ["decision", "operatorEvidenceRef", "validUntil"],
    "operator revocation decision",
  );
  const validUntilMs = Date.parse(value.validUntil);
  if (
    value.decision !== "allow" ||
    typeof value.operatorEvidenceRef !== "string" ||
    value.operatorEvidenceRef.length < 1 ||
    value.operatorEvidenceRef.length > 512 ||
    !Number.isFinite(validUntilMs) ||
    validUntilMs <= nowMs ||
    validUntilMs > nowMs + maxGrantTtlMs
  )
    throw new Error("operator revocation decision is invalid");
  return Object.freeze({ ...value, validUntilMs });
}

function normalizeDeletionAck(value, descriptor, request, receiptDigest) {
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
    "operator revocation deletion acknowledgement",
  );
  if (
    value.schema !== DELETION_ACK_SCHEMA ||
    value.authorityId !== descriptor.authorityId ||
    value.tenantId !== descriptor.tenantId ||
    value.handlerArtifactDigest !== descriptor.handlerArtifactDigest ||
    value.actionReceiptDigest !== receiptDigest ||
    !DIGEST.test(value.requestDigest) ||
    value.artifactRef !== request.artifactRef ||
    value.artifactDigest !== request.artifactDigest ||
    value.sourceActionReceiptDigest !== request.sourceActionReceiptDigest ||
    !Number.isFinite(Date.parse(value.discardedAt)) ||
    !DIGEST.test(value.deletionReceiptDigest) ||
    value.authenticated !== true ||
    value.durable !== true ||
    value.readbackVerified !== true ||
    value.bytesUnavailable !== true ||
    value.qualifiesForPromotion !== false
  )
    throw new Error("operator revocation deletion acknowledgement is invalid");
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
      "revocationReceiptDigest",
      "outcomeRequestDigest",
      "auditEventDigest",
      "durabilityReceiptDigest",
      "authenticated",
      "durable",
      "readbackVerified",
      "qualifiesForPromotion",
    ],
    "operator revocation outcome acknowledgement",
  );
  if (
    value.schema !==
      BROWSER_QUARANTINE_OPERATOR_REVOCATION_OUTCOME_ACK_SCHEMA ||
    value.authorityId !== descriptor.authorityId ||
    value.tenantId !== descriptor.tenantId ||
    value.handlerArtifactDigest !== descriptor.handlerArtifactDigest ||
    value.revocationReceiptDigest !== request.revocationReceiptDigest ||
    value.outcomeRequestDigest !== request.outcomeRequestDigest ||
    !DIGEST.test(value.auditEventDigest) ||
    !DIGEST.test(value.durabilityReceiptDigest) ||
    value.authenticated !== true ||
    value.durable !== true ||
    value.readbackVerified !== true ||
    value.qualifiesForPromotion !== false
  )
    throw new Error("operator revocation outcome acknowledgement is invalid");
  return value;
}

export function createBrowserQuarantineOperatorRevocationAuthority(options) {
  exact(
    options,
    ["descriptor", "custody", "authorizeRevocation", "recordOutcome", "now"],
    "browser quarantine operator revocation authority",
  );
  const custody = captureBrowserFilesystemQuarantineCustody(options.custody);
  const revokeArtifact = custody.bindOperatorRevocationAuthority(
    options.descriptor,
  );
  for (const [name, port] of Object.entries({
    authorizeRevocation: options.authorizeRevocation,
    recordOutcome: options.recordOutcome,
    now: options.now,
  })) {
    if (typeof port !== "function" || types.isProxy(port))
      throw new TypeError(`operator revocation ${name} port is invalid`);
  }
  const authority = Object.freeze({});
  authorities.set(authority, {
    descriptor: Object.freeze({ ...options.descriptor }),
    revokeArtifact,
    authorizeRevocation: options.authorizeRevocation,
    recordOutcome: options.recordOutcome,
    now: options.now,
  });
  return authority;
}

export function captureBrowserQuarantineOperatorRevocationAuthority(value) {
  const state = authorities.get(value);
  if (!state)
    throw new TypeError(
      "A branded browser quarantine operator revocation authority is required",
    );
  return Object.freeze({
    descriptor: state.descriptor,
    revokeArtifact: async (input) => {
      const request = normalizeRequest(input);
      const nowMs = state.now();
      if (!Number.isFinite(nowMs))
        throw new Error("operator revocation clock is invalid");
      const artifactRefDigest = digest(
        "chainlesschain.browser-download-artifact-ref/v1",
        request.artifactRef,
      );
      const authorizationDigest = digest(
        "chainlesschain.browser-quarantine-operator-authorization/v1",
        request.authorization,
      );
      const requestCore = Object.freeze({
        schema: BROWSER_QUARANTINE_OPERATOR_REVOCATION_REQUEST_SCHEMA,
        requestId: request.requestId,
        artifactRefDigest,
        artifactDigest: request.artifactDigest,
        sourceActionReceiptDigest: request.sourceActionReceiptDigest,
        operatorIdDigest: request.operatorIdDigest,
        authorizationDigest,
        requestedAt: request.requestedAt,
      });
      const requestDigest = digest(
        BROWSER_QUARANTINE_OPERATOR_REVOCATION_REQUEST_SCHEMA,
        requestCore,
      );
      const decision = normalizeDecision(
        await state.authorizeRevocation(
          Object.freeze({
            ...requestCore,
            requestDigest,
            authorization: request.authorization,
          }),
        ),
        nowMs,
        state.descriptor.maxGrantTtlMs,
      );
      if (decision.decision === "deny") {
        const error = new Error(decision.reason);
        error.code = "BROWSER_QUARANTINE_OPERATOR_REVOCATION_DENIED";
        throw error;
      }
      const receiptCore = Object.freeze({
        schema: BROWSER_QUARANTINE_OPERATOR_REVOCATION_RECEIPT_SCHEMA,
        authorityId: state.descriptor.authorityId,
        tenantId: state.descriptor.tenantId,
        handlerArtifactDigest: state.descriptor.handlerArtifactDigest,
        policyRevision: state.descriptor.policyRevision,
        requestId: request.requestId,
        artifactRefDigest,
        artifactDigest: request.artifactDigest,
        sourceActionReceiptDigest: request.sourceActionReceiptDigest,
        operatorIdDigest: request.operatorIdDigest,
        requestDigest,
        operatorEvidenceRef: decision.operatorEvidenceRef,
        authorizedAt: new Date(nowMs).toISOString(),
        validUntil: decision.validUntil,
      });
      const receiptDigest = digest(
        BROWSER_QUARANTINE_OPERATOR_REVOCATION_RECEIPT_SCHEMA,
        receiptCore,
      );
      let deletion = null;
      let executionError = null;
      try {
        const executionMs = state.now();
        if (
          !Number.isFinite(executionMs) ||
          executionMs >= decision.validUntilMs
        )
          throw new Error("operator revocation grant expired before execution");
        deletion = normalizeDeletionAck(
          await state.revokeArtifact({
            actionReceiptDigest: receiptDigest,
            requestDigest,
            artifactRef: request.artifactRef,
            artifactDigest: request.artifactDigest,
            sourceActionReceiptDigest: request.sourceActionReceiptDigest,
            reason: "revoked",
          }),
          state.descriptor,
          request,
          receiptDigest,
        );
      } catch (error) {
        executionError = error;
      }
      const recordedAtMs = state.now();
      if (!Number.isFinite(recordedAtMs))
        throw new Error("operator revocation clock is invalid");
      const outcomeCore = Object.freeze({
        schema: BROWSER_QUARANTINE_OPERATOR_REVOCATION_OUTCOME_REQUEST_SCHEMA,
        authorityId: state.descriptor.authorityId,
        tenantId: state.descriptor.tenantId,
        handlerArtifactDigest: state.descriptor.handlerArtifactDigest,
        policyRevision: state.descriptor.policyRevision,
        revocationReceiptDigest: receiptDigest,
        requestDigest,
        artifactRefDigest,
        artifactDigest: request.artifactDigest,
        operatorIdDigest: request.operatorIdDigest,
        status: executionError === null ? "succeeded" : "failed",
        deletionReceiptDigest: deletion?.deletionReceiptDigest ?? null,
        failureDigest:
          executionError === null
            ? null
            : digest(
                "chainlesschain.browser-quarantine-operator-revocation-failure/v1",
                {
                  name: executionError?.name ?? "Error",
                  code: executionError?.code ?? null,
                },
              ),
        recordedAt: new Date(recordedAtMs).toISOString(),
      });
      const outcomeRequest = Object.freeze({
        ...outcomeCore,
        outcomeRequestDigest: digest(
          BROWSER_QUARANTINE_OPERATOR_REVOCATION_OUTCOME_REQUEST_SCHEMA,
          outcomeCore,
        ),
      });
      const outcomeAck = normalizeOutcomeAck(
        await state.recordOutcome(outcomeRequest),
        state.descriptor,
        outcomeRequest,
      );
      if (executionError !== null) {
        const uncertain = new Error("operator revocation execution failed", {
          cause: executionError,
        });
        uncertain.code = "BROWSER_QUARANTINE_OPERATOR_REVOCATION_FAILED";
        throw uncertain;
      }
      const resultCore = Object.freeze({
        schema: BROWSER_QUARANTINE_OPERATOR_REVOCATION_RESULT_SCHEMA,
        status: "revoked",
        artifactRefDigest,
        artifactDigest: request.artifactDigest,
        sourceActionReceiptDigest: request.sourceActionReceiptDigest,
        operatorIdDigest: request.operatorIdDigest,
        discardedAt: deletion.discardedAt,
        deletionReceiptDigest: deletion.deletionReceiptDigest,
        outcomeRequestDigest: outcomeRequest.outcomeRequestDigest,
        auditEventDigest: outcomeAck.auditEventDigest,
        durabilityReceiptDigest: outcomeAck.durabilityReceiptDigest,
      });
      return Object.freeze({
        ...resultCore,
        resultDigest: digest(
          BROWSER_QUARANTINE_OPERATOR_REVOCATION_RESULT_SCHEMA,
          resultCore,
        ),
      });
    },
  });
}

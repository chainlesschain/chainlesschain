import { createHash } from "node:crypto";
import { types } from "node:util";

import {
  BROWSER_FILESYSTEM_QUARANTINE_LOCK_DIAGNOSTIC_SCHEMA,
  BROWSER_FILESYSTEM_QUARANTINE_LOCK_RELEASE_ACK_SCHEMA,
  captureBrowserFilesystemQuarantineCustody,
} from "./browser-filesystem-quarantine-custody.js";
export { BROWSER_FILESYSTEM_QUARANTINE_LOCK_MAINTENANCE_DESCRIPTOR_SCHEMA } from "./browser-filesystem-quarantine-custody.js";

export const BROWSER_QUARANTINE_LOCK_MAINTENANCE_REQUEST_SCHEMA =
  "chainlesschain.browser-quarantine-lock-maintenance-request/v1";
export const BROWSER_QUARANTINE_LOCK_MAINTENANCE_RECEIPT_SCHEMA =
  "chainlesschain.browser-quarantine-lock-maintenance-receipt/v1";
export const BROWSER_QUARANTINE_LOCK_MAINTENANCE_OUTCOME_REQUEST_SCHEMA =
  "chainlesschain.browser-quarantine-lock-maintenance-outcome-request/v1";
export const BROWSER_QUARANTINE_LOCK_MAINTENANCE_OUTCOME_ACK_SCHEMA =
  "chainlesschain.browser-quarantine-lock-maintenance-outcome-ack/v1";
export const BROWSER_QUARANTINE_LOCK_MAINTENANCE_RESULT_SCHEMA =
  "chainlesschain.browser-quarantine-lock-maintenance-result/v1";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9._:-]{1,128}$/u;
const ARTIFACT_REF = /^quarantine:[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/u;
const LOCK_STATUSES = new Set([
  "absent",
  "owned-live",
  "owned-dead",
  "owned-invalid",
  "owner-initializing",
  "owner-orphaned",
]);
const LOCK_OPERATIONS = new Set([
  "write",
  "scan",
  "complete",
  "dispose",
  "recover",
]);
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
      "operation",
      "artifactRef",
      "expectedLockStateDigest",
      "operatorIdDigest",
      "authorization",
      "requestedAt",
    ],
    "operator lock maintenance request",
  );
  if (
    value.schema !== BROWSER_QUARANTINE_LOCK_MAINTENANCE_REQUEST_SCHEMA ||
    !ID.test(value.requestId) ||
    !["inspect", "release"].includes(value.operation) ||
    !ARTIFACT_REF.test(value.artifactRef) ||
    (value.operation === "inspect"
      ? value.expectedLockStateDigest !== null
      : !DIGEST.test(value.expectedLockStateDigest)) ||
    !DIGEST.test(value.operatorIdDigest) ||
    !Number.isFinite(Date.parse(value.requestedAt))
  )
    throw new TypeError("operator lock maintenance request is invalid");
  return Object.freeze({
    ...value,
    authorization: snapshotJson(
      value.authorization,
      "operator lock maintenance authorization",
    ),
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
    throw new TypeError("operator lock maintenance decision is invalid");
  if (value.decision === "deny") {
    exact(value, ["decision", "reason"], "operator lock maintenance denial");
    if (
      typeof value.reason !== "string" ||
      value.reason.length < 1 ||
      value.reason.length > 512
    )
      throw new TypeError("operator lock maintenance denial is invalid");
    return Object.freeze({ ...value });
  }
  exact(
    value,
    ["decision", "operatorEvidenceRef", "validUntil"],
    "operator lock maintenance decision",
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
    throw new Error("operator lock maintenance decision is invalid");
  return Object.freeze({ ...value, validUntilMs });
}

function normalizeDiagnostic(value, descriptor, artifactRef) {
  exact(
    value,
    [
      "schema",
      "custodyId",
      "tenantId",
      "handlerArtifactDigest",
      "artifactRefDigest",
      "status",
      "ownerOperation",
      "ownerPid",
      "ownerAcquiredAt",
      "ownerEvidenceDigest",
      "lockDirectoryIdentityDigest",
      "observedAt",
      "lockStateDigest",
    ],
    "operator lock diagnostic",
  );
  const artifactRefDigest = digest(
    "chainlesschain.browser-download-artifact-ref/v1",
    artifactRef,
  );
  const hasOwner = ["owned-live", "owned-dead"].includes(value.status);
  const absent = value.status === "absent";
  const stateCore = Object.freeze({
    custodyId: value.custodyId,
    tenantId: value.tenantId,
    handlerArtifactDigest: value.handlerArtifactDigest,
    artifactRefDigest: value.artifactRefDigest,
    lockDirectoryIdentityDigest: value.lockDirectoryIdentityDigest,
    ownerEvidenceDigest: value.ownerEvidenceDigest,
  });
  if (
    value.schema !== BROWSER_FILESYSTEM_QUARANTINE_LOCK_DIAGNOSTIC_SCHEMA ||
    !ID.test(value.custodyId) ||
    value.tenantId !== descriptor.tenantId ||
    value.handlerArtifactDigest !== descriptor.handlerArtifactDigest ||
    value.artifactRefDigest !== artifactRefDigest ||
    !LOCK_STATUSES.has(value.status) ||
    (hasOwner
      ? !LOCK_OPERATIONS.has(value.ownerOperation) ||
        !Number.isSafeInteger(value.ownerPid) ||
        value.ownerPid < 1 ||
        !Number.isFinite(Date.parse(value.ownerAcquiredAt))
      : value.ownerOperation !== null ||
        value.ownerPid !== null ||
        value.ownerAcquiredAt !== null) ||
    (absent
      ? value.ownerEvidenceDigest !== null ||
        value.lockDirectoryIdentityDigest !== null
      : !DIGEST.test(value.ownerEvidenceDigest) ||
        !DIGEST.test(value.lockDirectoryIdentityDigest)) ||
    !Number.isFinite(Date.parse(value.observedAt)) ||
    value.lockStateDigest !==
      digest(BROWSER_FILESYSTEM_QUARANTINE_LOCK_DIAGNOSTIC_SCHEMA, stateCore)
  )
    throw new Error("operator lock diagnostic is invalid");
  return Object.freeze({ ...value });
}

function normalizeReleaseAck(
  value,
  descriptor,
  request,
  receiptDigest,
  requestDigest,
) {
  exact(
    value,
    [
      "schema",
      "custodyId",
      "authorityId",
      "tenantId",
      "handlerArtifactDigest",
      "policyRevision",
      "actionReceiptDigest",
      "requestDigest",
      "artifactRefDigest",
      "releasedLockStateDigest",
      "releasedAt",
      "releaseReceiptDigest",
      "authenticated",
      "durable",
      "readbackVerified",
      "artifactBytesChanged",
      "qualifiesForPromotion",
    ],
    "operator lock release acknowledgement",
  );
  const core = Object.freeze({
    schema: value.schema,
    custodyId: value.custodyId,
    authorityId: value.authorityId,
    tenantId: value.tenantId,
    handlerArtifactDigest: value.handlerArtifactDigest,
    policyRevision: value.policyRevision,
    actionReceiptDigest: value.actionReceiptDigest,
    requestDigest: value.requestDigest,
    artifactRefDigest: value.artifactRefDigest,
    releasedLockStateDigest: value.releasedLockStateDigest,
    releasedAt: value.releasedAt,
  });
  if (
    value.schema !== BROWSER_FILESYSTEM_QUARANTINE_LOCK_RELEASE_ACK_SCHEMA ||
    !ID.test(value.custodyId) ||
    value.authorityId !== descriptor.authorityId ||
    value.tenantId !== descriptor.tenantId ||
    value.handlerArtifactDigest !== descriptor.handlerArtifactDigest ||
    value.policyRevision !== descriptor.policyRevision ||
    value.actionReceiptDigest !== receiptDigest ||
    value.requestDigest !== requestDigest ||
    value.artifactRefDigest !==
      digest(
        "chainlesschain.browser-download-artifact-ref/v1",
        request.artifactRef,
      ) ||
    value.releasedLockStateDigest !== request.expectedLockStateDigest ||
    !Number.isFinite(Date.parse(value.releasedAt)) ||
    value.releaseReceiptDigest !==
      digest(BROWSER_FILESYSTEM_QUARANTINE_LOCK_RELEASE_ACK_SCHEMA, core) ||
    value.authenticated !== true ||
    value.durable !== true ||
    value.readbackVerified !== true ||
    value.artifactBytesChanged !== false ||
    value.qualifiesForPromotion !== false
  )
    throw new Error("operator lock release acknowledgement is invalid");
  return Object.freeze({ ...value });
}

function normalizeOutcomeAck(value, descriptor, request) {
  exact(
    value,
    [
      "schema",
      "authorityId",
      "tenantId",
      "handlerArtifactDigest",
      "maintenanceReceiptDigest",
      "outcomeRequestDigest",
      "auditEventDigest",
      "durabilityReceiptDigest",
      "authenticated",
      "durable",
      "readbackVerified",
      "qualifiesForPromotion",
    ],
    "operator lock maintenance outcome acknowledgement",
  );
  if (
    value.schema !== BROWSER_QUARANTINE_LOCK_MAINTENANCE_OUTCOME_ACK_SCHEMA ||
    value.authorityId !== descriptor.authorityId ||
    value.tenantId !== descriptor.tenantId ||
    value.handlerArtifactDigest !== descriptor.handlerArtifactDigest ||
    value.maintenanceReceiptDigest !== request.maintenanceReceiptDigest ||
    value.outcomeRequestDigest !== request.outcomeRequestDigest ||
    !DIGEST.test(value.auditEventDigest) ||
    !DIGEST.test(value.durabilityReceiptDigest) ||
    value.authenticated !== true ||
    value.durable !== true ||
    value.readbackVerified !== true ||
    value.qualifiesForPromotion !== false
  )
    throw new Error(
      "operator lock maintenance outcome acknowledgement is invalid",
    );
  return Object.freeze({ ...value });
}

export function createBrowserQuarantineLockMaintenanceAuthority(options) {
  exact(
    options,
    ["descriptor", "custody", "authorizeMaintenance", "recordOutcome", "now"],
    "browser quarantine lock maintenance authority",
  );
  const custody = captureBrowserFilesystemQuarantineCustody(options.custody);
  const maintenance = custody.bindLockMaintenanceAuthority(options.descriptor);
  for (const [name, port] of Object.entries({
    authorizeMaintenance: options.authorizeMaintenance,
    recordOutcome: options.recordOutcome,
    now: options.now,
  })) {
    if (typeof port !== "function" || types.isProxy(port))
      throw new TypeError(`operator lock maintenance ${name} port is invalid`);
  }
  const authority = Object.freeze({});
  authorities.set(authority, {
    descriptor: Object.freeze({ ...options.descriptor }),
    inspectLock: maintenance.inspectLock,
    releaseLock: maintenance.releaseLock,
    authorizeMaintenance: options.authorizeMaintenance,
    recordOutcome: options.recordOutcome,
    now: options.now,
  });
  return authority;
}

export function captureBrowserQuarantineLockMaintenanceAuthority(value) {
  const state = authorities.get(value);
  if (!state)
    throw new TypeError(
      "A branded browser quarantine lock maintenance authority is required",
    );
  return Object.freeze({
    descriptor: state.descriptor,
    maintainLock: async (input) => {
      const request = normalizeRequest(input);
      const nowMs = state.now();
      if (!Number.isFinite(nowMs))
        throw new Error("operator lock maintenance clock is invalid");
      const artifactRefDigest = digest(
        "chainlesschain.browser-download-artifact-ref/v1",
        request.artifactRef,
      );
      const authorizationDigest = digest(
        "chainlesschain.browser-quarantine-lock-maintenance-authorization/v1",
        request.authorization,
      );
      const requestCore = Object.freeze({
        schema: BROWSER_QUARANTINE_LOCK_MAINTENANCE_REQUEST_SCHEMA,
        requestId: request.requestId,
        operation: request.operation,
        artifactRefDigest,
        expectedLockStateDigest: request.expectedLockStateDigest,
        operatorIdDigest: request.operatorIdDigest,
        authorizationDigest,
        requestedAt: request.requestedAt,
      });
      const requestDigest = digest(
        BROWSER_QUARANTINE_LOCK_MAINTENANCE_REQUEST_SCHEMA,
        requestCore,
      );
      const decision = normalizeDecision(
        await state.authorizeMaintenance(
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
        error.code = "BROWSER_QUARANTINE_LOCK_MAINTENANCE_DENIED";
        throw error;
      }
      const receiptCore = Object.freeze({
        schema: BROWSER_QUARANTINE_LOCK_MAINTENANCE_RECEIPT_SCHEMA,
        authorityId: state.descriptor.authorityId,
        tenantId: state.descriptor.tenantId,
        handlerArtifactDigest: state.descriptor.handlerArtifactDigest,
        policyRevision: state.descriptor.policyRevision,
        requestId: request.requestId,
        operation: request.operation,
        artifactRefDigest,
        expectedLockStateDigest: request.expectedLockStateDigest,
        operatorIdDigest: request.operatorIdDigest,
        requestDigest,
        operatorEvidenceRef: decision.operatorEvidenceRef,
        authorizedAt: new Date(nowMs).toISOString(),
        validUntil: decision.validUntil,
      });
      const receiptDigest = digest(
        BROWSER_QUARANTINE_LOCK_MAINTENANCE_RECEIPT_SCHEMA,
        receiptCore,
      );
      let diagnostic = null;
      let release = null;
      let executionError = null;
      try {
        const executionMs = state.now();
        if (
          !Number.isFinite(executionMs) ||
          executionMs >= decision.validUntilMs
        )
          throw new Error(
            "operator lock maintenance grant expired before execution",
          );
        diagnostic = normalizeDiagnostic(
          await state.inspectLock(request.artifactRef),
          state.descriptor,
          request.artifactRef,
        );
        if (request.operation === "release") {
          if (diagnostic.lockStateDigest !== request.expectedLockStateDigest)
            throw new Error("operator lock maintenance target changed");
          release = normalizeReleaseAck(
            await state.releaseLock({
              actionReceiptDigest: receiptDigest,
              requestDigest,
              artifactRef: request.artifactRef,
              expectedLockStateDigest: request.expectedLockStateDigest,
            }),
            state.descriptor,
            request,
            receiptDigest,
            requestDigest,
          );
        }
      } catch (error) {
        executionError = error;
      }
      const recordedAtMs = state.now();
      if (!Number.isFinite(recordedAtMs))
        throw new Error("operator lock maintenance clock is invalid");
      const outcomeCore = Object.freeze({
        schema: BROWSER_QUARANTINE_LOCK_MAINTENANCE_OUTCOME_REQUEST_SCHEMA,
        authorityId: state.descriptor.authorityId,
        tenantId: state.descriptor.tenantId,
        handlerArtifactDigest: state.descriptor.handlerArtifactDigest,
        policyRevision: state.descriptor.policyRevision,
        maintenanceReceiptDigest: receiptDigest,
        requestDigest,
        operation: request.operation,
        artifactRefDigest,
        operatorIdDigest: request.operatorIdDigest,
        status: executionError === null ? "succeeded" : "failed",
        lockStatus: diagnostic?.status ?? null,
        lockStateDigest: diagnostic?.lockStateDigest ?? null,
        releaseReceiptDigest: release?.releaseReceiptDigest ?? null,
        failureDigest:
          executionError === null
            ? null
            : digest(
                "chainlesschain.browser-quarantine-lock-maintenance-failure/v1",
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
          BROWSER_QUARANTINE_LOCK_MAINTENANCE_OUTCOME_REQUEST_SCHEMA,
          outcomeCore,
        ),
      });
      const outcomeAck = normalizeOutcomeAck(
        await state.recordOutcome(outcomeRequest),
        state.descriptor,
        outcomeRequest,
      );
      if (executionError !== null) {
        const uncertain = new Error(
          "operator lock maintenance execution failed",
          { cause: executionError },
        );
        uncertain.code = "BROWSER_QUARANTINE_LOCK_MAINTENANCE_FAILED";
        throw uncertain;
      }
      const ownerProcessDigest =
        diagnostic.ownerPid === null
          ? null
          : digest("chainlesschain.browser-quarantine-lock-owner-process/v1", {
              pid: diagnostic.ownerPid,
              acquiredAt: diagnostic.ownerAcquiredAt,
            });
      const resultCore = Object.freeze({
        schema: BROWSER_QUARANTINE_LOCK_MAINTENANCE_RESULT_SCHEMA,
        status: request.operation === "release" ? "released" : "inspected",
        operation: request.operation,
        artifactRefDigest,
        lockStatus: diagnostic.status,
        ownerOperation: diagnostic.ownerOperation,
        ownerProcessDigest,
        ownerAcquiredAt: diagnostic.ownerAcquiredAt,
        lockStateDigest: diagnostic.lockStateDigest,
        releaseReceiptDigest: release?.releaseReceiptDigest ?? null,
        operatorIdDigest: request.operatorIdDigest,
        outcomeRequestDigest: outcomeRequest.outcomeRequestDigest,
        auditEventDigest: outcomeAck.auditEventDigest,
        durabilityReceiptDigest: outcomeAck.durabilityReceiptDigest,
      });
      return Object.freeze({
        ...resultCore,
        resultDigest: digest(
          BROWSER_QUARANTINE_LOCK_MAINTENANCE_RESULT_SCHEMA,
          resultCore,
        ),
      });
    },
  });
}

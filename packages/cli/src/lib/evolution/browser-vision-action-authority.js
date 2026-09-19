import { createHash } from "node:crypto";
import { types } from "node:util";

export const BROWSER_VISION_ACTION_AUTHORITY_DESCRIPTOR_SCHEMA =
  "chainlesschain.browser-vision-action-authority-descriptor/v2";
export const BROWSER_VISION_ACTION_REQUEST_SCHEMA =
  "chainlesschain.browser-vision-action-request/v1";
export const BROWSER_VISION_ACTION_RECEIPT_SCHEMA =
  "chainlesschain.browser-vision-action-receipt/v1";
export const BROWSER_VISION_ACTION_OUTCOME_REQUEST_SCHEMA =
  "chainlesschain.browser-vision-action-outcome-request/v1";
export const BROWSER_VISION_ACTION_OUTCOME_ACK_SCHEMA =
  "chainlesschain.browser-vision-action-outcome-ack/v1";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9._:-]{1,128}$/u;
const OPERATIONS = new Set(["visual-click", "visual-type"]);
const authorities = new WeakMap();

function canonical(value) {
  if (value === null || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value))
    return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
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

function exactObject(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    types.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")
  ) {
    throw new TypeError(`${label} has an invalid shape`);
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor))
      throw new TypeError(`${label} must contain plain data`);
  }
}

function snapshotJson(value, label) {
  let nodes = 0;
  const visit = (entry, depth) => {
    if (++nodes > 2048 || depth > 12)
      throw new TypeError(`${label} exceeds its structure budget`);
    if (
      entry === null ||
      typeof entry === "boolean" ||
      (typeof entry === "number" && Number.isFinite(entry)) ||
      typeof entry === "string"
    ) {
      return entry;
    }
    if (
      !entry ||
      typeof entry !== "object" ||
      types.isProxy(entry) ||
      ![Object.prototype, null, Array.prototype].includes(
        Object.getPrototypeOf(entry),
      )
    ) {
      throw new TypeError(`${label} must be finite plain JSON data`);
    }
    if (Array.isArray(entry))
      return Object.freeze(entry.map((item) => visit(item, depth + 1)));
    const output = {};
    for (const key of Object.keys(entry)) {
      const descriptor = Object.getOwnPropertyDescriptor(entry, key);
      if (!descriptor?.enumerable || !("value" in descriptor))
        throw new TypeError(`${label} must contain plain data`);
      output[key] = visit(descriptor.value, depth + 1);
    }
    return Object.freeze(output);
  };
  const snapshot = visit(value, 0);
  if (Buffer.byteLength(canonical(snapshot), "utf8") > 16 * 1024)
    throw new TypeError(`${label} exceeds its byte budget`);
  return snapshot;
}

function normalizeDescriptor(value) {
  exactObject(
    value,
    [
      "schema",
      "authorityId",
      "tenantId",
      "handlerArtifactDigest",
      "policyRevision",
      "maxGrantTtlMs",
      "approvalMode",
      "auditMode",
    ],
    "browser vision action authority descriptor",
  );
  if (
    value.schema !== BROWSER_VISION_ACTION_AUTHORITY_DESCRIPTOR_SCHEMA ||
    !ID.test(value.authorityId) ||
    !ID.test(value.tenantId) ||
    !DIGEST.test(value.handlerArtifactDigest) ||
    !ID.test(value.policyRevision) ||
    !Number.isSafeInteger(value.maxGrantTtlMs) ||
    value.maxGrantTtlMs < 1 ||
    value.maxGrantTtlMs > 30_000 ||
    value.approvalMode !== "interactive" ||
    value.auditMode !== "authenticated-durable-readback"
  ) {
    throw new TypeError(
      "browser vision action authority descriptor is invalid",
    );
  }
  return Object.freeze({ ...value });
}

function normalizeOutcomeRequest(value) {
  exactObject(
    value,
    [
      "schema",
      "actionReceiptDigest",
      "requestDigest",
      "targetId",
      "operation",
      "inputDigest",
      "observationReceiptDigest",
      "status",
      "resultDigest",
      "recordedAt",
    ],
    "browser vision action outcome request",
  );
  if (
    value.schema !== BROWSER_VISION_ACTION_OUTCOME_REQUEST_SCHEMA ||
    !DIGEST.test(value.actionReceiptDigest) ||
    !DIGEST.test(value.requestDigest) ||
    typeof value.targetId !== "string" ||
    value.targetId.length < 1 ||
    value.targetId.length > 512 ||
    !OPERATIONS.has(value.operation) ||
    !DIGEST.test(value.inputDigest) ||
    !DIGEST.test(value.observationReceiptDigest) ||
    !["succeeded", "failed"].includes(value.status) ||
    !DIGEST.test(value.resultDigest) ||
    !Number.isFinite(Date.parse(value.recordedAt))
  ) {
    throw new TypeError("browser vision action outcome request is invalid");
  }
  const core = Object.freeze({ ...value });
  return Object.freeze({
    ...core,
    outcomeRequestDigest: digest(
      "chainlesschain.browser-vision-action-outcome-request/v1",
      core,
    ),
  });
}

function normalizeOutcomeAck(value, descriptor, request) {
  exactObject(
    value,
    [
      "schema",
      "authorityId",
      "tenantId",
      "handlerArtifactDigest",
      "actionReceiptDigest",
      "outcomeRequestDigest",
      "auditEventDigest",
      "durabilityReceiptDigest",
      "authenticated",
      "durable",
      "readbackVerified",
      "qualifiesForPromotion",
    ],
    "browser vision action outcome acknowledgement",
  );
  if (
    value.schema !== BROWSER_VISION_ACTION_OUTCOME_ACK_SCHEMA ||
    value.authorityId !== descriptor.authorityId ||
    value.tenantId !== descriptor.tenantId ||
    value.handlerArtifactDigest !== descriptor.handlerArtifactDigest ||
    value.actionReceiptDigest !== request.actionReceiptDigest ||
    value.outcomeRequestDigest !== request.outcomeRequestDigest ||
    !DIGEST.test(value.auditEventDigest) ||
    !DIGEST.test(value.durabilityReceiptDigest) ||
    value.authenticated !== true ||
    value.durable !== true ||
    value.readbackVerified !== true ||
    value.qualifiesForPromotion !== false
  ) {
    throw new Error("browser vision action outcome acknowledgement is invalid");
  }
  return Object.freeze({ ...value });
}

function normalizeRequest(value) {
  exactObject(
    value,
    [
      "schema",
      "requestId",
      "targetId",
      "operation",
      "senderId",
      "frameUrlDigest",
      "inputDigest",
      "observationReceiptDigest",
      "authorization",
      "requestedAt",
    ],
    "browser vision action request",
  );
  const requestedAtMs = Date.parse(value.requestedAt);
  if (
    value.schema !== BROWSER_VISION_ACTION_REQUEST_SCHEMA ||
    !ID.test(value.requestId) ||
    typeof value.targetId !== "string" ||
    value.targetId.length < 1 ||
    value.targetId.length > 512 ||
    !OPERATIONS.has(value.operation) ||
    !Number.isSafeInteger(value.senderId) ||
    value.senderId < 1 ||
    !DIGEST.test(value.frameUrlDigest) ||
    !DIGEST.test(value.inputDigest) ||
    !DIGEST.test(value.observationReceiptDigest) ||
    !Number.isFinite(requestedAtMs)
  ) {
    throw new TypeError("browser vision action request is invalid");
  }
  return Object.freeze({
    ...value,
    authorization: snapshotJson(
      value.authorization,
      "browser vision action authorization",
    ),
    requestedAtMs,
  });
}

function requestEvidence(request) {
  const authorizationDigest = digest(
    "chainlesschain.browser-vision-action-authorization/v1",
    request.authorization,
  );
  const core = {
    schema: request.schema,
    requestId: request.requestId,
    targetId: request.targetId,
    operation: request.operation,
    senderId: request.senderId,
    frameUrlDigest: request.frameUrlDigest,
    inputDigest: request.inputDigest,
    observationReceiptDigest: request.observationReceiptDigest,
    authorizationDigest,
    requestedAt: request.requestedAt,
  };
  return Object.freeze({
    ...core,
    requestDigest: digest(
      "chainlesschain.browser-vision-action-request/v1",
      core,
    ),
  });
}

function normalizeDecision(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    types.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new TypeError("browser vision action decision is invalid");
  }
  const direct = Object.getOwnPropertyDescriptor(value, "decision");
  if (!direct?.enumerable || !("value" in direct))
    throw new TypeError("browser vision action decision must be plain data");
  if (direct.value === "deny") {
    const keys = Object.hasOwn(value, "reason")
      ? ["decision", "reason"]
      : ["decision"];
    exactObject(value, keys, "browser vision action decision");
    const reason = Object.hasOwn(value, "reason") ? value.reason : null;
    if (reason !== null && (typeof reason !== "string" || reason.length > 512))
      throw new TypeError("browser vision action denial reason is invalid");
    return Object.freeze({ decision: "deny", reason });
  }
  exactObject(
    value,
    ["decision", "approvalEvidenceRef", "validUntil"],
    "browser vision action decision",
  );
  if (direct.value !== "allow")
    throw new TypeError("browser vision action decision is invalid");
  return Object.freeze({
    decision: "allow",
    approvalEvidenceRef: value.approvalEvidenceRef,
    validUntil: value.validUntil,
  });
}

export function createBrowserVisionActionAuthority({
  descriptor,
  authorize,
  recordOutcome,
  now = () => Date.now(),
} = {}) {
  const normalizedDescriptor = normalizeDescriptor(descriptor);
  if (typeof authorize !== "function" || types.isProxy(authorize))
    throw new TypeError("browser vision action authorize port is invalid");
  if (typeof recordOutcome !== "function" || types.isProxy(recordOutcome))
    throw new TypeError("browser vision action outcome port is invalid");
  if (typeof now !== "function" || types.isProxy(now))
    throw new TypeError("browser vision action clock is invalid");
  const authority = Object.freeze({});
  authorities.set(authority, {
    descriptor: normalizedDescriptor,
    authorize,
    recordOutcome,
    now,
    issued: new Map(),
  });
  return authority;
}

export function captureBrowserVisionActionAuthority(value) {
  const captured = authorities.get(value);
  if (!captured)
    throw new TypeError(
      "A branded browser vision action authority is required",
    );
  return Object.freeze({
    descriptor: captured.descriptor,
    authorizeAction: async (value) => {
      const request = normalizeRequest(value);
      const evidence = requestEvidence(request);
      const decision = normalizeDecision(
        await captured.authorize(
          Object.freeze({ ...request, requestDigest: evidence.requestDigest }),
        ),
      );
      if (decision.decision !== "allow") {
        const error = new Error(
          decision.reason ?? "Browser vision action was denied",
        );
        error.code = "BROWSER_VISION_ACTION_DENIED";
        throw error;
      }
      const nowMs = captured.now();
      const validUntilMs = Date.parse(decision.validUntil);
      if (
        typeof decision.approvalEvidenceRef !== "string" ||
        decision.approvalEvidenceRef.length < 1 ||
        decision.approvalEvidenceRef.length > 512 ||
        !Number.isFinite(nowMs) ||
        !Number.isFinite(validUntilMs) ||
        validUntilMs <= nowMs ||
        validUntilMs > nowMs + captured.descriptor.maxGrantTtlMs
      ) {
        throw new Error("Browser vision action decision is invalid");
      }
      const core = {
        schema: BROWSER_VISION_ACTION_RECEIPT_SCHEMA,
        authorityId: captured.descriptor.authorityId,
        tenantId: captured.descriptor.tenantId,
        policyRevision: captured.descriptor.policyRevision,
        handlerArtifactDigest: captured.descriptor.handlerArtifactDigest,
        approvalMode: captured.descriptor.approvalMode,
        requestId: request.requestId,
        targetId: request.targetId,
        operation: request.operation,
        senderId: request.senderId,
        frameUrlDigest: request.frameUrlDigest,
        inputDigest: request.inputDigest,
        observationReceiptDigest: request.observationReceiptDigest,
        authorizationDigest: evidence.authorizationDigest,
        requestDigest: evidence.requestDigest,
        approvalEvidenceRef: decision.approvalEvidenceRef,
        authorizedAt: new Date(nowMs).toISOString(),
        validUntil: new Date(validUntilMs).toISOString(),
      };
      const receipt = Object.freeze({
        ...core,
        receiptDigest: digest(
          "chainlesschain.browser-vision-action-receipt/v1",
          core,
        ),
      });
      captured.issued.set(receipt.receiptDigest, {
        requestDigest: receipt.requestDigest,
        targetId: receipt.targetId,
        operation: receipt.operation,
        inputDigest: receipt.inputDigest,
        observationReceiptDigest: receipt.observationReceiptDigest,
        outcomeRequestDigest: null,
      });
      return receipt;
    },
    recordActionOutcome: async (value) => {
      const request = normalizeOutcomeRequest(value);
      const issued = captured.issued.get(request.actionReceiptDigest);
      if (
        !issued ||
        issued.requestDigest !== request.requestDigest ||
        issued.targetId !== request.targetId ||
        issued.operation !== request.operation ||
        issued.inputDigest !== request.inputDigest ||
        issued.observationReceiptDigest !== request.observationReceiptDigest ||
        (issued.outcomeRequestDigest !== null &&
          issued.outcomeRequestDigest !== request.outcomeRequestDigest)
      ) {
        throw new Error(
          "browser vision action outcome differs from its authorization",
        );
      }
      issued.outcomeRequestDigest = request.outcomeRequestDigest;
      const acknowledgement = normalizeOutcomeAck(
        await captured.recordOutcome(request),
        captured.descriptor,
        request,
      );
      captured.issued.delete(request.actionReceiptDigest);
      return acknowledgement;
    },
  });
}

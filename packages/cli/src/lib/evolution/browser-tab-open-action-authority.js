import { createHash } from "node:crypto";
import { types } from "node:util";

export const BROWSER_TAB_OPEN_ACTION_AUTHORITY_DESCRIPTOR_SCHEMA =
  "chainlesschain.browser-tab-open-action-authority-descriptor/v1";
export const BROWSER_TAB_OPEN_ACTION_REQUEST_SCHEMA =
  "chainlesschain.browser-tab-open-action-request/v1";
export const BROWSER_TAB_OPEN_ACTION_RECEIPT_SCHEMA =
  "chainlesschain.browser-tab-open-action-receipt/v1";
export const BROWSER_TAB_OPEN_ACTION_OUTCOME_REQUEST_SCHEMA =
  "chainlesschain.browser-tab-open-action-outcome-request/v1";
export const BROWSER_TAB_OPEN_ACTION_OUTCOME_ACK_SCHEMA =
  "chainlesschain.browser-tab-open-action-outcome-ack/v1";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9._:-]{1,128}$/u;
const PROFILE = /^[A-Za-z0-9._-]{1,128}$/u;
const WAIT_UNTIL = new Set(["load", "domcontentloaded", "networkidle"]);
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
    throw new TypeError(`${label} has an invalid shape`);
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
    const output = {};
    for (const key of Object.keys(entry)) {
      const descriptor = Object.getOwnPropertyDescriptor(entry, key);
      if (!descriptor?.enumerable || !("value" in descriptor))
        throw new TypeError(`${label} must contain plain data`);
      output[key] = visit(descriptor.value, depth + 1);
    }
    return Object.freeze(output);
  };
  const result = visit(value, 0);
  if (Buffer.byteLength(canonical(result), "utf8") > 16 * 1024)
    throw new TypeError(`${label} exceeds its byte budget`);
  return result;
}

function normalizeUrl(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 16 * 1024)
    throw new TypeError("browser tab open destination is invalid");
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError("browser tab open destination is invalid");
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.href.length > 16 * 1024
  )
    throw new TypeError("browser tab open destination is invalid");
  return parsed.href;
}

function normalizeRedirectOrigins(value, destinationUrl) {
  if (
    !Array.isArray(value) ||
    types.isProxy(value) ||
    value.length < 1 ||
    value.length > 16
  )
    throw new TypeError("browser tab open redirect origins are invalid");
  const origins = value.map((entry) => {
    if (typeof entry !== "string" || entry.length > 2048)
      throw new TypeError("browser tab open redirect origins are invalid");
    let parsed;
    try {
      parsed = new URL(entry);
    } catch {
      throw new TypeError("browser tab open redirect origins are invalid");
    }
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      entry !== parsed.origin
    )
      throw new TypeError("browser tab open redirect origins are invalid");
    return parsed.origin;
  });
  const normalized = [...new Set(origins)].sort();
  if (
    normalized.length !== origins.length ||
    !normalized.includes(new URL(destinationUrl).origin)
  )
    throw new TypeError("browser tab open redirect origins are invalid");
  return Object.freeze(normalized);
}

function normalizeDescriptor(value) {
  exact(
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
    "browser tab open authority descriptor",
  );
  if (
    value.schema !== BROWSER_TAB_OPEN_ACTION_AUTHORITY_DESCRIPTOR_SCHEMA ||
    !ID.test(value.authorityId) ||
    !ID.test(value.tenantId) ||
    !DIGEST.test(value.handlerArtifactDigest) ||
    !ID.test(value.policyRevision) ||
    !Number.isSafeInteger(value.maxGrantTtlMs) ||
    value.maxGrantTtlMs < 1 ||
    value.maxGrantTtlMs > 30_000 ||
    value.approvalMode !== "interactive" ||
    value.auditMode !== "authenticated-durable-readback"
  )
    throw new TypeError("browser tab open authority descriptor is invalid");
  return Object.freeze({ ...value });
}

function normalizeRequest(value) {
  exact(
    value,
    [
      "schema",
      "requestId",
      "profileName",
      "operation",
      "senderId",
      "frameUrlDigest",
      "destinationUrl",
      "allowedRedirectOrigins",
      "waitUntil",
      "timeout",
      "inputDigest",
      "authorization",
      "requestedAt",
    ],
    "browser tab open request",
  );
  const destinationUrl = normalizeUrl(value.destinationUrl);
  const allowedRedirectOrigins = normalizeRedirectOrigins(
    value.allowedRedirectOrigins,
    destinationUrl,
  );
  const inputCore = Object.freeze({
    profileName: value.profileName,
    operation: value.operation,
    destinationUrl,
    allowedRedirectOrigins,
    waitUntil: value.waitUntil,
    timeout: value.timeout,
  });
  if (
    value.schema !== BROWSER_TAB_OPEN_ACTION_REQUEST_SCHEMA ||
    !ID.test(value.requestId) ||
    typeof value.profileName !== "string" ||
    !PROFILE.test(value.profileName) ||
    value.operation !== "open-tab" ||
    !Number.isSafeInteger(value.senderId) ||
    value.senderId < 1 ||
    !DIGEST.test(value.frameUrlDigest) ||
    !WAIT_UNTIL.has(value.waitUntil) ||
    !Number.isSafeInteger(value.timeout) ||
    value.timeout < 1 ||
    value.timeout > 120_000 ||
    value.inputDigest !==
      digest("chainlesschain.browser-tab-open-action-input/v1", inputCore) ||
    !Number.isFinite(Date.parse(value.requestedAt))
  )
    throw new TypeError("browser tab open request is invalid");
  return Object.freeze({
    ...value,
    destinationUrl,
    allowedRedirectOrigins,
    authorization: snapshotJson(
      value.authorization,
      "browser tab open authorization",
    ),
    inputCore,
  });
}

function requestEvidence(request) {
  const core = {
    schema: request.schema,
    requestId: request.requestId,
    profileName: request.profileName,
    operation: request.operation,
    senderId: request.senderId,
    frameUrlDigest: request.frameUrlDigest,
    destinationDigest: digest(
      "chainlesschain.browser-tab-open-action-destination/v1",
      request.destinationUrl,
    ),
    redirectOriginsDigest: digest(
      "chainlesschain.browser-tab-open-action-redirect-origins/v1",
      request.allowedRedirectOrigins,
    ),
    waitUntil: request.waitUntil,
    timeout: request.timeout,
    inputDigest: request.inputDigest,
    authorizationDigest: digest(
      "chainlesschain.browser-tab-open-action-authorization/v1",
      request.authorization,
    ),
    requestedAt: request.requestedAt,
  };
  return Object.freeze({
    ...core,
    requestDigest: digest(BROWSER_TAB_OPEN_ACTION_REQUEST_SCHEMA, core),
  });
}

function normalizeDecision(value) {
  if (!value || typeof value !== "object" || types.isProxy(value))
    throw new TypeError("browser tab open decision is invalid");
  if (value.decision === "deny") {
    exact(
      value,
      Object.hasOwn(value, "reason") ? ["decision", "reason"] : ["decision"],
      "browser tab open decision",
    );
    if (
      value.reason !== undefined &&
      (typeof value.reason !== "string" || value.reason.length > 512)
    )
      throw new TypeError("browser tab open denial reason is invalid");
    return Object.freeze({ decision: "deny", reason: value.reason ?? null });
  }
  exact(
    value,
    ["decision", "approvalEvidenceRef", "validUntil"],
    "browser tab open decision",
  );
  if (value.decision !== "allow")
    throw new TypeError("browser tab open decision is invalid");
  return Object.freeze({ ...value });
}

function normalizeOutcome(value) {
  exact(
    value,
    [
      "schema",
      "actionReceiptDigest",
      "requestDigest",
      "profileName",
      "operation",
      "inputDigest",
      "status",
      "resultDigest",
      "recordedAt",
    ],
    "browser tab open outcome request",
  );
  if (
    value.schema !== BROWSER_TAB_OPEN_ACTION_OUTCOME_REQUEST_SCHEMA ||
    !DIGEST.test(value.actionReceiptDigest) ||
    !DIGEST.test(value.requestDigest) ||
    typeof value.profileName !== "string" ||
    !PROFILE.test(value.profileName) ||
    value.operation !== "open-tab" ||
    !DIGEST.test(value.inputDigest) ||
    !["succeeded", "failed"].includes(value.status) ||
    !DIGEST.test(value.resultDigest) ||
    !Number.isFinite(Date.parse(value.recordedAt))
  )
    throw new TypeError("browser tab open outcome request is invalid");
  const core = Object.freeze({ ...value });
  return Object.freeze({
    ...core,
    outcomeRequestDigest: digest(
      BROWSER_TAB_OPEN_ACTION_OUTCOME_REQUEST_SCHEMA,
      core,
    ),
  });
}

function normalizeAck(value, descriptor, request) {
  exact(
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
    "browser tab open outcome acknowledgement",
  );
  if (
    value.schema !== BROWSER_TAB_OPEN_ACTION_OUTCOME_ACK_SCHEMA ||
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
  )
    throw new Error("browser tab open acknowledgement is invalid");
  return Object.freeze({ ...value });
}

export function createBrowserTabOpenActionAuthority({
  descriptor,
  authorize,
  recordOutcome,
  now = Date.now,
} = {}) {
  const normalizedDescriptor = normalizeDescriptor(descriptor);
  if (
    typeof authorize !== "function" ||
    types.isProxy(authorize) ||
    typeof recordOutcome !== "function" ||
    types.isProxy(recordOutcome) ||
    typeof now !== "function" ||
    types.isProxy(now)
  )
    throw new TypeError("browser tab open authority ports are invalid");
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

export function captureBrowserTabOpenActionAuthority(value) {
  const captured = authorities.get(value);
  if (!captured)
    throw new TypeError("A branded browser tab open authority is required");
  return Object.freeze({
    descriptor: captured.descriptor,
    authorizeAction: async (input) => {
      const request = normalizeRequest(input);
      const evidence = requestEvidence(request);
      const decision = normalizeDecision(
        await captured.authorize(
          Object.freeze({ ...request, requestDigest: evidence.requestDigest }),
        ),
      );
      if (decision.decision !== "allow") {
        const error = new Error(
          decision.reason ?? "Browser tab open was denied",
        );
        error.code = "BROWSER_TAB_OPEN_ACTION_DENIED";
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
      )
        throw new Error("Browser tab open decision is invalid");
      const core = {
        schema: BROWSER_TAB_OPEN_ACTION_RECEIPT_SCHEMA,
        authorityId: captured.descriptor.authorityId,
        tenantId: captured.descriptor.tenantId,
        policyRevision: captured.descriptor.policyRevision,
        handlerArtifactDigest: captured.descriptor.handlerArtifactDigest,
        approvalMode: captured.descriptor.approvalMode,
        requestId: request.requestId,
        profileName: request.profileName,
        operation: request.operation,
        senderId: request.senderId,
        frameUrlDigest: request.frameUrlDigest,
        destinationDigest: evidence.destinationDigest,
        redirectOriginsDigest: evidence.redirectOriginsDigest,
        waitUntil: request.waitUntil,
        timeout: request.timeout,
        inputDigest: request.inputDigest,
        authorizationDigest: evidence.authorizationDigest,
        requestDigest: evidence.requestDigest,
        approvalEvidenceRef: decision.approvalEvidenceRef,
        authorizedAt: new Date(nowMs).toISOString(),
        validUntil: new Date(validUntilMs).toISOString(),
      };
      const receipt = Object.freeze({
        ...core,
        receiptDigest: digest(BROWSER_TAB_OPEN_ACTION_RECEIPT_SCHEMA, core),
      });
      captured.issued.set(receipt.receiptDigest, {
        requestDigest: receipt.requestDigest,
        profileName: receipt.profileName,
        operation: receipt.operation,
        inputDigest: receipt.inputDigest,
        outcomeRequestDigest: null,
      });
      return receipt;
    },
    recordActionOutcome: async (input) => {
      const request = normalizeOutcome(input);
      const issued = captured.issued.get(request.actionReceiptDigest);
      if (
        !issued ||
        issued.requestDigest !== request.requestDigest ||
        issued.profileName !== request.profileName ||
        issued.operation !== request.operation ||
        issued.inputDigest !== request.inputDigest ||
        (issued.outcomeRequestDigest !== null &&
          issued.outcomeRequestDigest !== request.outcomeRequestDigest)
      )
        throw new Error("browser tab open outcome differs from authorization");
      issued.outcomeRequestDigest = request.outcomeRequestDigest;
      const acknowledgement = normalizeAck(
        await captured.recordOutcome(request),
        captured.descriptor,
        request,
      );
      captured.issued.delete(request.actionReceiptDigest);
      return acknowledgement;
    },
  });
}

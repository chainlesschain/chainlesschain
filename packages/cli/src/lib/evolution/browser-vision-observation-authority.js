import { createHash } from "node:crypto";
import { types } from "node:util";

export const BROWSER_VISION_OBSERVATION_AUTHORITY_DESCRIPTOR_SCHEMA =
  "chainlesschain.browser-vision-observation-authority-descriptor/v1";
export const BROWSER_VISION_OBSERVATION_REQUEST_SCHEMA =
  "chainlesschain.browser-vision-observation-request/v1";
export const BROWSER_VISION_OBSERVATION_RECEIPT_SCHEMA =
  "chainlesschain.browser-vision-observation-receipt/v1";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9._:-]{1,128}$/u;
const OPERATIONS = new Set(["analyze", "locate", "compare", "describe", "ocr"]);
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
      return Object.freeze(entry.map((v) => visit(v, depth + 1)));
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
  const keys = [
    "schema",
    "authorityId",
    "tenantId",
    "handlerArtifactDigest",
    "policyRevision",
    "maxGrantTtlMs",
  ];
  exactObject(value, keys, "browser vision authority descriptor");
  if (
    value.schema !== BROWSER_VISION_OBSERVATION_AUTHORITY_DESCRIPTOR_SCHEMA ||
    !ID.test(value.authorityId) ||
    !ID.test(value.tenantId) ||
    !DIGEST.test(value.handlerArtifactDigest) ||
    !ID.test(value.policyRevision) ||
    !Number.isSafeInteger(value.maxGrantTtlMs) ||
    value.maxGrantTtlMs < 1 ||
    value.maxGrantTtlMs > 60_000
  ) {
    throw new TypeError("browser vision authority descriptor is invalid");
  }
  return Object.freeze({ ...value });
}

function normalizeRequest(value) {
  const keys = [
    "schema",
    "requestId",
    "targetId",
    "operation",
    "senderId",
    "frameUrlDigest",
    "inputDigest",
    "authorization",
    "requestedAt",
  ];
  exactObject(value, keys, "browser vision observation request");
  const requestedAtMs = Date.parse(value.requestedAt);
  if (
    value.schema !== BROWSER_VISION_OBSERVATION_REQUEST_SCHEMA ||
    !ID.test(value.requestId) ||
    typeof value.targetId !== "string" ||
    value.targetId.length < 1 ||
    value.targetId.length > 512 ||
    !OPERATIONS.has(value.operation) ||
    !Number.isSafeInteger(value.senderId) ||
    value.senderId < 1 ||
    !DIGEST.test(value.frameUrlDigest) ||
    !DIGEST.test(value.inputDigest) ||
    !Number.isFinite(requestedAtMs)
  ) {
    throw new TypeError("browser vision observation request is invalid");
  }
  const authorization = snapshotJson(
    value.authorization,
    "browser vision observation authorization",
  );
  return Object.freeze({ ...value, authorization, requestedAtMs });
}

function requestEvidence(request) {
  const authorizationDigest = digest(
    "chainlesschain.browser-vision-observation-authorization/v1",
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
    authorizationDigest,
    requestedAt: request.requestedAt,
  };
  return Object.freeze({
    ...core,
    requestDigest: digest(
      "chainlesschain.browser-vision-observation-request/v1",
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
    throw new TypeError("browser vision observation decision is invalid");
  }
  const decisionDescriptor = Object.getOwnPropertyDescriptor(value, "decision");
  if (!decisionDescriptor?.enumerable || !("value" in decisionDescriptor))
    throw new TypeError(
      "browser vision observation decision must be plain data",
    );
  if (decisionDescriptor.value === "deny") {
    const keys = Object.hasOwn(value, "reason")
      ? ["decision", "reason"]
      : ["decision"];
    exactObject(value, keys, "browser vision observation decision");
    const reason = Object.hasOwn(value, "reason") ? value.reason : null;
    if (reason !== null && (typeof reason !== "string" || reason.length > 512))
      throw new TypeError(
        "browser vision observation denial reason is invalid",
      );
    return Object.freeze({ decision: "deny", reason });
  }
  exactObject(
    value,
    ["decision", "authorizationEvidenceRef", "validUntil"],
    "browser vision observation decision",
  );
  if (decisionDescriptor.value !== "allow")
    throw new TypeError("browser vision observation decision is invalid");
  return Object.freeze({
    decision: "allow",
    authorizationEvidenceRef: value.authorizationEvidenceRef,
    validUntil: value.validUntil,
  });
}

export function createBrowserVisionObservationAuthority({
  descriptor,
  authorize,
  now = () => Date.now(),
} = {}) {
  const normalizedDescriptor = normalizeDescriptor(descriptor);
  if (typeof authorize !== "function" || types.isProxy(authorize))
    throw new TypeError("browser vision observation authorize port is invalid");
  if (typeof now !== "function" || types.isProxy(now))
    throw new TypeError("browser vision observation clock is invalid");
  const authority = Object.freeze({});
  authorities.set(authority, {
    descriptor: normalizedDescriptor,
    authorize,
    now,
  });
  return authority;
}

export function captureBrowserVisionObservationAuthority(value) {
  const captured = authorities.get(value);
  if (!captured)
    throw new TypeError(
      "A branded browser vision observation authority is required",
    );
  return Object.freeze({
    descriptor: captured.descriptor,
    authorizeObservation: async (value) => {
      const request = normalizeRequest(value);
      const evidence = requestEvidence(request);
      const decision = normalizeDecision(
        await captured.authorize(
          Object.freeze({ ...request, requestDigest: evidence.requestDigest }),
        ),
      );
      if (decision.decision !== "allow") {
        const error = new Error(
          decision.reason ?? "Browser vision observation was denied",
        );
        error.code = "BROWSER_VISION_OBSERVATION_DENIED";
        throw error;
      }
      const nowMs = captured.now();
      const validUntilMs = Date.parse(decision.validUntil);
      if (
        typeof decision.authorizationEvidenceRef !== "string" ||
        decision.authorizationEvidenceRef.length < 1 ||
        decision.authorizationEvidenceRef.length > 512 ||
        !Number.isFinite(nowMs) ||
        !Number.isFinite(validUntilMs) ||
        validUntilMs <= nowMs ||
        validUntilMs > nowMs + captured.descriptor.maxGrantTtlMs
      ) {
        throw new Error("Browser vision observation decision is invalid");
      }
      const authorizedAt = new Date(nowMs).toISOString();
      const core = {
        schema: BROWSER_VISION_OBSERVATION_RECEIPT_SCHEMA,
        authorityId: captured.descriptor.authorityId,
        tenantId: captured.descriptor.tenantId,
        policyRevision: captured.descriptor.policyRevision,
        handlerArtifactDigest: captured.descriptor.handlerArtifactDigest,
        requestId: request.requestId,
        targetId: request.targetId,
        operation: request.operation,
        senderId: request.senderId,
        frameUrlDigest: request.frameUrlDigest,
        inputDigest: request.inputDigest,
        authorizationDigest: evidence.authorizationDigest,
        requestDigest: evidence.requestDigest,
        authorizationEvidenceRef: decision.authorizationEvidenceRef,
        authorizedAt,
        validUntil: new Date(validUntilMs).toISOString(),
      };
      return Object.freeze({
        ...core,
        receiptDigest: digest(
          "chainlesschain.browser-vision-observation-receipt/v1",
          core,
        ),
      });
    },
  });
}

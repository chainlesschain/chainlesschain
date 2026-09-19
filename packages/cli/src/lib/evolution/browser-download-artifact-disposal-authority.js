import { createHash } from "node:crypto";
import { types } from "node:util";

export const BROWSER_DOWNLOAD_ARTIFACT_DISPOSAL_DESCRIPTOR_SCHEMA =
  "chainlesschain.browser-download-artifact-disposal-descriptor/v1";
export const BROWSER_DOWNLOAD_ARTIFACT_DISPOSAL_REQUEST_SCHEMA =
  "chainlesschain.browser-download-artifact-disposal-request/v1";
export const BROWSER_DOWNLOAD_ARTIFACT_DISPOSAL_RECEIPT_SCHEMA =
  "chainlesschain.browser-download-artifact-disposal-receipt/v1";
export const BROWSER_DOWNLOAD_ARTIFACT_DELETION_ACK_SCHEMA =
  "chainlesschain.browser-download-artifact-deletion-ack/v1";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9._:-]{1,128}$/u;
const ARTIFACT_REF = /^quarantine:[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/u;
const REASONS = new Set([
  "user-discard",
  "expired",
  "revoked",
  "delivery-failed",
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
      "effectMode",
    ],
    "download artifact disposal descriptor",
  );
  if (
    value.schema !== BROWSER_DOWNLOAD_ARTIFACT_DISPOSAL_DESCRIPTOR_SCHEMA ||
    !ID.test(value.authorityId) ||
    !ID.test(value.tenantId) ||
    !DIGEST.test(value.handlerArtifactDigest) ||
    !ID.test(value.policyRevision) ||
    !Number.isSafeInteger(value.maxGrantTtlMs) ||
    value.maxGrantTtlMs < 1 ||
    value.maxGrantTtlMs > 30_000 ||
    value.approvalMode !== "interactive" ||
    value.auditMode !== "authenticated-durable-readback" ||
    value.effectMode !== "irreversible-byte-disposal"
  )
    throw new TypeError("download artifact disposal descriptor is invalid");
  return Object.freeze({ ...value });
}

function normalizeRequest(value) {
  exact(
    value,
    [
      "schema",
      "requestId",
      "senderId",
      "frameUrlDigest",
      "operation",
      "artifactRef",
      "artifactDigest",
      "sourceActionReceiptDigest",
      "reason",
      "inputDigest",
      "authorization",
      "requestedAt",
    ],
    "download artifact disposal request",
  );
  const inputCore = Object.freeze({
    operation: value.operation,
    artifactRef: value.artifactRef,
    artifactDigest: value.artifactDigest,
    sourceActionReceiptDigest: value.sourceActionReceiptDigest,
    reason: value.reason,
  });
  if (
    value.schema !== BROWSER_DOWNLOAD_ARTIFACT_DISPOSAL_REQUEST_SCHEMA ||
    !ID.test(value.requestId) ||
    !Number.isSafeInteger(value.senderId) ||
    value.senderId < 1 ||
    !DIGEST.test(value.frameUrlDigest) ||
    value.operation !== "discard-download-artifact" ||
    !ARTIFACT_REF.test(value.artifactRef) ||
    !DIGEST.test(value.artifactDigest) ||
    !DIGEST.test(value.sourceActionReceiptDigest) ||
    !REASONS.has(value.reason) ||
    value.inputDigest !==
      digest(
        "chainlesschain.browser-download-artifact-disposal-input/v1",
        inputCore,
      ) ||
    !Number.isFinite(Date.parse(value.requestedAt))
  )
    throw new TypeError("download artifact disposal request is invalid");
  return Object.freeze({
    ...value,
    authorization: snapshotJson(
      value.authorization,
      "download artifact disposal authorization",
    ),
  });
}

function requestEvidence(request) {
  const core = Object.freeze({
    schema: request.schema,
    requestId: request.requestId,
    senderId: request.senderId,
    frameUrlDigest: request.frameUrlDigest,
    operation: request.operation,
    artifactRefDigest: digest(
      "chainlesschain.browser-download-artifact-ref/v1",
      request.artifactRef,
    ),
    artifactDigest: request.artifactDigest,
    sourceActionReceiptDigest: request.sourceActionReceiptDigest,
    reason: request.reason,
    inputDigest: request.inputDigest,
    authorizationDigest: digest(
      "chainlesschain.browser-download-artifact-disposal-authorization/v1",
      request.authorization,
    ),
    requestedAt: request.requestedAt,
  });
  return Object.freeze({
    ...core,
    requestDigest: digest(
      BROWSER_DOWNLOAD_ARTIFACT_DISPOSAL_REQUEST_SCHEMA,
      core,
    ),
  });
}

function normalizeDecision(value) {
  if (!value || typeof value !== "object" || types.isProxy(value))
    throw new TypeError("download artifact disposal decision is invalid");
  if (value.decision === "deny") {
    exact(
      value,
      Object.hasOwn(value, "reason") ? ["decision", "reason"] : ["decision"],
      "download artifact disposal decision",
    );
    if (
      value.reason !== undefined &&
      (typeof value.reason !== "string" || value.reason.length > 512)
    )
      throw new TypeError(
        "download artifact disposal denial reason is invalid",
      );
    return Object.freeze({ decision: "deny", reason: value.reason ?? null });
  }
  exact(
    value,
    ["decision", "approvalEvidenceRef", "validUntil"],
    "download artifact disposal decision",
  );
  if (value.decision !== "allow")
    throw new TypeError("download artifact disposal decision is invalid");
  return Object.freeze({ ...value });
}

function normalizeDeletionAck(value, descriptor, issued) {
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
    "download artifact deletion acknowledgement",
  );
  if (
    value.schema !== BROWSER_DOWNLOAD_ARTIFACT_DELETION_ACK_SCHEMA ||
    value.authorityId !== descriptor.authorityId ||
    value.tenantId !== descriptor.tenantId ||
    value.handlerArtifactDigest !== descriptor.handlerArtifactDigest ||
    value.actionReceiptDigest !== issued.receipt.receiptDigest ||
    value.requestDigest !== issued.receipt.requestDigest ||
    value.artifactRef !== issued.request.artifactRef ||
    value.artifactDigest !== issued.request.artifactDigest ||
    value.sourceActionReceiptDigest !==
      issued.request.sourceActionReceiptDigest ||
    !Number.isFinite(Date.parse(value.discardedAt)) ||
    !DIGEST.test(value.deletionReceiptDigest) ||
    value.authenticated !== true ||
    value.durable !== true ||
    value.readbackVerified !== true ||
    value.bytesUnavailable !== true ||
    value.qualifiesForPromotion !== false
  )
    throw new Error("download artifact deletion acknowledgement is invalid");
  return Object.freeze({ ...value });
}

export function createBrowserDownloadArtifactDisposalAuthority({
  descriptor,
  authorize,
  disposeArtifact,
  now = Date.now,
} = {}) {
  const normalizedDescriptor = normalizeDescriptor(descriptor);
  for (const [name, port] of Object.entries({
    authorize,
    disposeArtifact,
    now,
  })) {
    if (typeof port !== "function" || types.isProxy(port))
      throw new TypeError(`download artifact disposal ${name} port is invalid`);
  }
  const authority = Object.freeze({});
  authorities.set(authority, {
    descriptor: normalizedDescriptor,
    authorize,
    disposeArtifact,
    now,
    issued: new Map(),
  });
  return authority;
}

export function captureBrowserDownloadArtifactDisposalAuthority(value) {
  const captured = authorities.get(value);
  if (!captured)
    throw new TypeError(
      "A branded browser download artifact disposal authority is required",
    );
  return Object.freeze({
    descriptor: captured.descriptor,
    authorizeDisposal: async (input) => {
      const request = normalizeRequest(input);
      const evidence = requestEvidence(request);
      const decision = normalizeDecision(
        await captured.authorize(
          Object.freeze({ ...request, requestDigest: evidence.requestDigest }),
        ),
      );
      if (decision.decision !== "allow") {
        const error = new Error(
          decision.reason ?? "Download artifact disposal was denied",
        );
        error.code = "BROWSER_DOWNLOAD_ARTIFACT_DISPOSAL_DENIED";
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
        throw new Error("Download artifact disposal decision is invalid");
      const core = Object.freeze({
        schema: BROWSER_DOWNLOAD_ARTIFACT_DISPOSAL_RECEIPT_SCHEMA,
        authorityId: captured.descriptor.authorityId,
        tenantId: captured.descriptor.tenantId,
        handlerArtifactDigest: captured.descriptor.handlerArtifactDigest,
        policyRevision: captured.descriptor.policyRevision,
        approvalMode: captured.descriptor.approvalMode,
        auditMode: captured.descriptor.auditMode,
        effectMode: captured.descriptor.effectMode,
        requestId: request.requestId,
        senderId: request.senderId,
        frameUrlDigest: request.frameUrlDigest,
        operation: request.operation,
        artifactRefDigest: evidence.artifactRefDigest,
        artifactDigest: request.artifactDigest,
        sourceActionReceiptDigest: request.sourceActionReceiptDigest,
        reason: request.reason,
        inputDigest: request.inputDigest,
        authorizationDigest: evidence.authorizationDigest,
        requestDigest: evidence.requestDigest,
        approvalEvidenceRef: decision.approvalEvidenceRef,
        authorizedAt: new Date(nowMs).toISOString(),
        validUntil: new Date(validUntilMs).toISOString(),
      });
      const receipt = Object.freeze({
        ...core,
        receiptDigest: digest(
          BROWSER_DOWNLOAD_ARTIFACT_DISPOSAL_RECEIPT_SCHEMA,
          core,
        ),
      });
      captured.issued.set(receipt.receiptDigest, {
        request,
        receipt,
        consumed: false,
      });
      return receipt;
    },
    disposeAuthorizedArtifact: async (input) => {
      exact(
        input,
        ["receiptDigest", "requestDigest"],
        "download artifact disposal execution request",
      );
      const issued = captured.issued.get(input.receiptDigest);
      const nowMs = captured.now();
      if (
        !DIGEST.test(input.receiptDigest) ||
        !DIGEST.test(input.requestDigest) ||
        !issued ||
        issued.receipt.requestDigest !== input.requestDigest ||
        issued.consumed ||
        !Number.isFinite(nowMs) ||
        nowMs >= Date.parse(issued.receipt.validUntil)
      )
        throw new Error("download artifact disposal grant is invalid or spent");
      issued.consumed = true;
      const acknowledgement = normalizeDeletionAck(
        await captured.disposeArtifact(
          Object.freeze({
            actionReceiptDigest: issued.receipt.receiptDigest,
            requestDigest: issued.receipt.requestDigest,
            artifactRef: issued.request.artifactRef,
            artifactDigest: issued.request.artifactDigest,
            sourceActionReceiptDigest: issued.request.sourceActionReceiptDigest,
            reason: issued.request.reason,
          }),
        ),
        captured.descriptor,
        issued,
      );
      captured.issued.delete(input.receiptDigest);
      const core = Object.freeze({
        status: "discarded",
        artifactRefDigest: issued.receipt.artifactRefDigest,
        artifactDigest: issued.request.artifactDigest,
        sourceActionReceiptDigest: issued.request.sourceActionReceiptDigest,
        reason: issued.request.reason,
        discardedAt: acknowledgement.discardedAt,
        deletionReceiptDigest: acknowledgement.deletionReceiptDigest,
      });
      return Object.freeze({
        ...core,
        resultDigest: digest(
          "chainlesschain.browser-download-artifact-disposal-result/v1",
          core,
        ),
      });
    },
  });
}

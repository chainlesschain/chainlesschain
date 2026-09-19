import { createHash } from "node:crypto";
import { types } from "node:util";

export const BROWSER_DOWNLOAD_ACTION_AUTHORITY_DESCRIPTOR_SCHEMA =
  "chainlesschain.browser-download-action-authority-descriptor/v1";
export const BROWSER_DOWNLOAD_ACTION_REQUEST_SCHEMA =
  "chainlesschain.browser-download-action-request/v1";
export const BROWSER_DOWNLOAD_ACTION_RECEIPT_SCHEMA =
  "chainlesschain.browser-download-action-receipt/v1";
export const BROWSER_DOWNLOAD_ACTION_EXECUTION_SCHEMA =
  "chainlesschain.browser-download-action-execution/v1";
export const BROWSER_DOWNLOAD_ARTIFACT_SCHEMA =
  "chainlesschain.browser-download-artifact/v1";
export const BROWSER_DOWNLOAD_ACTION_OUTCOME_REQUEST_SCHEMA =
  "chainlesschain.browser-download-action-outcome-request/v1";
export const BROWSER_DOWNLOAD_ACTION_OUTCOME_ACK_SCHEMA =
  "chainlesschain.browser-download-action-outcome-ack/v1";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9._:-]{1,128}$/u;
const ARTIFACT_REF = /^quarantine:[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/u;
const CONTENT_TYPE =
  /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/u;
const MAX_BYTES = 100 * 1024 * 1024;
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

function normalizeUrl(value, label = "browser download destination") {
  if (typeof value !== "string" || value.length < 1 || value.length > 16 * 1024)
    throw new TypeError(`${label} is invalid`);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError(`${label} is invalid`);
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.href.length > 16 * 1024
  )
    throw new TypeError(`${label} is invalid`);
  return parsed.href;
}

function normalizeOrigins(value, destinationUrl) {
  if (
    !Array.isArray(value) ||
    types.isProxy(value) ||
    value.length < 1 ||
    value.length > 16
  )
    throw new TypeError("browser download redirect origins are invalid");
  const origins = value.map((entry) => {
    if (typeof entry !== "string" || entry.length > 2048)
      throw new TypeError("browser download redirect origins are invalid");
    let parsed;
    try {
      parsed = new URL(entry);
    } catch {
      throw new TypeError("browser download redirect origins are invalid");
    }
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      entry !== parsed.origin
    )
      throw new TypeError("browser download redirect origins are invalid");
    return parsed.origin;
  });
  const normalized = [...new Set(origins)].sort();
  if (
    normalized.length !== origins.length ||
    !normalized.includes(new URL(destinationUrl).origin)
  )
    throw new TypeError("browser download redirect origins are invalid");
  return Object.freeze(normalized);
}

function normalizeContentTypes(value) {
  if (
    !Array.isArray(value) ||
    types.isProxy(value) ||
    value.length < 1 ||
    value.length > 16 ||
    value.some(
      (entry) => typeof entry !== "string" || !CONTENT_TYPE.test(entry),
    )
  )
    throw new TypeError("browser download content types are invalid");
  const normalized = [...new Set(value)].sort();
  if (normalized.length !== value.length)
    throw new TypeError("browser download content types are invalid");
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
      "artifactMode",
    ],
    "browser download authority descriptor",
  );
  if (
    value.schema !== BROWSER_DOWNLOAD_ACTION_AUTHORITY_DESCRIPTOR_SCHEMA ||
    !ID.test(value.authorityId) ||
    !ID.test(value.tenantId) ||
    !DIGEST.test(value.handlerArtifactDigest) ||
    !ID.test(value.policyRevision) ||
    !Number.isSafeInteger(value.maxGrantTtlMs) ||
    value.maxGrantTtlMs < 1 ||
    value.maxGrantTtlMs > 30_000 ||
    value.approvalMode !== "interactive" ||
    value.auditMode !== "authenticated-durable-readback" ||
    value.artifactMode !== "opaque-quarantine-clean-scan"
  )
    throw new TypeError("browser download authority descriptor is invalid");
  return Object.freeze({ ...value });
}

function normalizeRequest(value) {
  exact(
    value,
    [
      "schema",
      "requestId",
      "targetId",
      "operation",
      "senderId",
      "frameUrlDigest",
      "destinationUrl",
      "allowedRedirectOrigins",
      "allowedContentTypes",
      "maxBytes",
      "timeout",
      "inputDigest",
      "authorization",
      "requestedAt",
    ],
    "browser download request",
  );
  const destinationUrl = normalizeUrl(value.destinationUrl);
  const allowedRedirectOrigins = normalizeOrigins(
    value.allowedRedirectOrigins,
    destinationUrl,
  );
  const allowedContentTypes = normalizeContentTypes(value.allowedContentTypes);
  const inputCore = Object.freeze({
    targetId: value.targetId,
    operation: value.operation,
    destinationUrl,
    allowedRedirectOrigins,
    allowedContentTypes,
    maxBytes: value.maxBytes,
    timeout: value.timeout,
  });
  if (
    value.schema !== BROWSER_DOWNLOAD_ACTION_REQUEST_SCHEMA ||
    !ID.test(value.requestId) ||
    typeof value.targetId !== "string" ||
    value.targetId.length < 1 ||
    value.targetId.length > 512 ||
    value.operation !== "download-url" ||
    !Number.isSafeInteger(value.senderId) ||
    value.senderId < 1 ||
    !DIGEST.test(value.frameUrlDigest) ||
    !Number.isSafeInteger(value.maxBytes) ||
    value.maxBytes < 1 ||
    value.maxBytes > MAX_BYTES ||
    !Number.isSafeInteger(value.timeout) ||
    value.timeout < 1 ||
    value.timeout > 120_000 ||
    value.inputDigest !==
      digest("chainlesschain.browser-download-action-input/v1", inputCore) ||
    !Number.isFinite(Date.parse(value.requestedAt))
  )
    throw new TypeError("browser download request is invalid");
  return Object.freeze({
    ...value,
    destinationUrl,
    allowedRedirectOrigins,
    allowedContentTypes,
    authorization: snapshotJson(
      value.authorization,
      "browser download authorization",
    ),
    inputCore,
  });
}

function requestEvidence(request) {
  const core = {
    schema: request.schema,
    requestId: request.requestId,
    targetId: request.targetId,
    operation: request.operation,
    senderId: request.senderId,
    frameUrlDigest: request.frameUrlDigest,
    destinationDigest: digest(
      "chainlesschain.browser-download-action-destination/v1",
      request.destinationUrl,
    ),
    redirectOriginsDigest: digest(
      "chainlesschain.browser-download-action-redirect-origins/v1",
      request.allowedRedirectOrigins,
    ),
    contentTypesDigest: digest(
      "chainlesschain.browser-download-action-content-types/v1",
      request.allowedContentTypes,
    ),
    maxBytes: request.maxBytes,
    timeout: request.timeout,
    inputDigest: request.inputDigest,
    authorizationDigest: digest(
      "chainlesschain.browser-download-action-authorization/v1",
      request.authorization,
    ),
    requestedAt: request.requestedAt,
  };
  return Object.freeze({
    ...core,
    requestDigest: digest(BROWSER_DOWNLOAD_ACTION_REQUEST_SCHEMA, core),
  });
}

function normalizeDecision(value) {
  if (!value || typeof value !== "object" || types.isProxy(value))
    throw new TypeError("browser download decision is invalid");
  if (value.decision === "deny") {
    exact(
      value,
      Object.hasOwn(value, "reason") ? ["decision", "reason"] : ["decision"],
      "browser download decision",
    );
    if (
      value.reason !== undefined &&
      (typeof value.reason !== "string" || value.reason.length > 512)
    )
      throw new TypeError("browser download denial reason is invalid");
    return Object.freeze({ decision: "deny", reason: value.reason ?? null });
  }
  exact(
    value,
    ["decision", "approvalEvidenceRef", "validUntil"],
    "browser download decision",
  );
  if (value.decision !== "allow")
    throw new TypeError("browser download decision is invalid");
  return Object.freeze({ ...value });
}

function normalizeArtifact(value, request, deadlineAtMs, finishedAtMs) {
  exact(
    value,
    [
      "schema",
      "artifactRef",
      "artifactDigest",
      "sizeBytes",
      "contentType",
      "finalUrl",
      "redirectOrigins",
      "quarantined",
      "scanVerdict",
      "scanEvidenceDigest",
      "quarantineReceiptDigest",
      "completionReceiptDigest",
      "completedAt",
    ],
    "browser download artifact",
  );
  const finalUrl = normalizeUrl(value.finalUrl, "browser download final URL");
  const redirectOrigins = normalizeOrigins(
    value.redirectOrigins,
    request.destinationUrl,
  );
  const finalOrigin = new URL(finalUrl).origin;
  if (
    value.schema !== BROWSER_DOWNLOAD_ARTIFACT_SCHEMA ||
    !ARTIFACT_REF.test(value.artifactRef) ||
    !DIGEST.test(value.artifactDigest) ||
    !Number.isSafeInteger(value.sizeBytes) ||
    value.sizeBytes < 1 ||
    value.sizeBytes > request.maxBytes ||
    typeof value.contentType !== "string" ||
    !request.allowedContentTypes.includes(value.contentType) ||
    redirectOrigins.some(
      (origin) => !request.allowedRedirectOrigins.includes(origin),
    ) ||
    !redirectOrigins.includes(finalOrigin) ||
    value.quarantined !== true ||
    value.scanVerdict !== "clean" ||
    !DIGEST.test(value.scanEvidenceDigest) ||
    !DIGEST.test(value.quarantineReceiptDigest) ||
    !DIGEST.test(value.completionReceiptDigest) ||
    !Number.isFinite(Date.parse(value.completedAt)) ||
    Date.parse(value.completedAt) > deadlineAtMs ||
    finishedAtMs > deadlineAtMs
  )
    throw new TypeError("browser download artifact evidence is invalid");
  return Object.freeze({ ...value, finalUrl, redirectOrigins });
}

function executionEvidence(artifact) {
  const core = Object.freeze({
    status: "succeeded",
    failureClass: null,
    artifactRef: artifact.artifactRef,
    artifactDigest: artifact.artifactDigest,
    sizeBytes: artifact.sizeBytes,
    contentType: artifact.contentType,
    finalUrlDigest: digest(
      "chainlesschain.browser-download-action-final-url/v1",
      artifact.finalUrl,
    ),
    redirectOriginsDigest: digest(
      "chainlesschain.browser-download-action-observed-origins/v1",
      artifact.redirectOrigins,
    ),
    scanEvidenceDigest: artifact.scanEvidenceDigest,
    quarantineReceiptDigest: artifact.quarantineReceiptDigest,
    completionReceiptDigest: artifact.completionReceiptDigest,
    completedAt: artifact.completedAt,
  });
  return Object.freeze({
    ...core,
    resultDigest: digest(
      "chainlesschain.browser-download-action-result/v1",
      core,
    ),
  });
}

function failedExecutionEvidence(failureClass) {
  const core = Object.freeze({
    status: "failed",
    failureClass,
    artifactRef: null,
    artifactDigest: null,
    sizeBytes: null,
    contentType: null,
    finalUrlDigest: null,
    redirectOriginsDigest: null,
    scanEvidenceDigest: null,
    quarantineReceiptDigest: null,
    completionReceiptDigest: null,
    completedAt: null,
  });
  return Object.freeze({
    ...core,
    resultDigest: digest(
      "chainlesschain.browser-download-action-result/v1",
      core,
    ),
  });
}

function normalizeOutcome(value) {
  exact(
    value,
    [
      "schema",
      "actionReceiptDigest",
      "requestDigest",
      "targetId",
      "operation",
      "inputDigest",
      "status",
      "resultDigest",
      "recordedAt",
    ],
    "browser download outcome request",
  );
  if (
    value.schema !== BROWSER_DOWNLOAD_ACTION_OUTCOME_REQUEST_SCHEMA ||
    !DIGEST.test(value.actionReceiptDigest) ||
    !DIGEST.test(value.requestDigest) ||
    typeof value.targetId !== "string" ||
    value.targetId.length < 1 ||
    value.targetId.length > 512 ||
    value.operation !== "download-url" ||
    !DIGEST.test(value.inputDigest) ||
    !["succeeded", "failed"].includes(value.status) ||
    !DIGEST.test(value.resultDigest) ||
    !Number.isFinite(Date.parse(value.recordedAt))
  )
    throw new TypeError("browser download outcome request is invalid");
  const core = Object.freeze({ ...value });
  return Object.freeze({
    ...core,
    outcomeRequestDigest: digest(
      BROWSER_DOWNLOAD_ACTION_OUTCOME_REQUEST_SCHEMA,
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
    "browser download outcome acknowledgement",
  );
  if (
    value.schema !== BROWSER_DOWNLOAD_ACTION_OUTCOME_ACK_SCHEMA ||
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
    throw new Error("browser download acknowledgement is invalid");
  return Object.freeze({ ...value });
}

export function createBrowserDownloadActionAuthority({
  descriptor,
  authorize,
  executeDownload,
  recordOutcome,
  now = Date.now,
} = {}) {
  const normalizedDescriptor = normalizeDescriptor(descriptor);
  for (const [name, port] of Object.entries({
    authorize,
    executeDownload,
    recordOutcome,
    now,
  })) {
    if (typeof port !== "function" || types.isProxy(port))
      throw new TypeError(`browser download ${name} port is invalid`);
  }
  const authority = Object.freeze({});
  authorities.set(authority, {
    descriptor: normalizedDescriptor,
    authorize,
    executeDownload,
    recordOutcome,
    now,
    issued: new Map(),
  });
  return authority;
}

export function captureBrowserDownloadActionAuthority(value) {
  const captured = authorities.get(value);
  if (!captured)
    throw new TypeError("A branded browser download authority is required");
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
          decision.reason ?? "Browser download was denied",
        );
        error.code = "BROWSER_DOWNLOAD_ACTION_DENIED";
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
        throw new Error("Browser download decision is invalid");
      const core = {
        schema: BROWSER_DOWNLOAD_ACTION_RECEIPT_SCHEMA,
        authorityId: captured.descriptor.authorityId,
        tenantId: captured.descriptor.tenantId,
        policyRevision: captured.descriptor.policyRevision,
        handlerArtifactDigest: captured.descriptor.handlerArtifactDigest,
        approvalMode: captured.descriptor.approvalMode,
        artifactMode: captured.descriptor.artifactMode,
        requestId: request.requestId,
        targetId: request.targetId,
        operation: request.operation,
        senderId: request.senderId,
        frameUrlDigest: request.frameUrlDigest,
        destinationDigest: evidence.destinationDigest,
        redirectOriginsDigest: evidence.redirectOriginsDigest,
        contentTypesDigest: evidence.contentTypesDigest,
        maxBytes: request.maxBytes,
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
        receiptDigest: digest(BROWSER_DOWNLOAD_ACTION_RECEIPT_SCHEMA, core),
      });
      captured.issued.set(receipt.receiptDigest, {
        request,
        receipt,
        execution: null,
        abortController: null,
        cancelRequested: false,
        outcomeRequestDigest: null,
      });
      return receipt;
    },
    cancelAuthorizedDownload: async (input) => {
      exact(
        input,
        ["receiptDigest", "requestDigest", "reason"],
        "browser download cancellation request",
      );
      const issued = captured.issued.get(input.receiptDigest);
      if (
        !DIGEST.test(input.receiptDigest) ||
        !DIGEST.test(input.requestDigest) ||
        !["user-request", "renderer-destroyed", "operator-request"].includes(
          input.reason,
        ) ||
        !issued ||
        issued.receipt.requestDigest !== input.requestDigest ||
        issued.execution?.status !== "executing" ||
        !(issued.abortController instanceof AbortController) ||
        issued.cancelRequested
      )
        throw new Error("browser download cancellation target is not active");
      issued.cancelRequested = true;
      issued.abortController.abort(
        new Error("browser download execution cancellation requested"),
      );
      return Object.freeze({ accepted: true });
    },
    executeAuthorizedDownload: async (input) => {
      exact(
        input,
        ["receiptDigest", "requestDigest"],
        "browser download execution request",
      );
      const issued = captured.issued.get(input.receiptDigest);
      const startMs = captured.now();
      if (
        !DIGEST.test(input.receiptDigest) ||
        !DIGEST.test(input.requestDigest) ||
        !issued ||
        issued.receipt.requestDigest !== input.requestDigest ||
        issued.execution !== null ||
        !Number.isFinite(startMs) ||
        startMs >= Date.parse(issued.receipt.validUntil)
      )
        throw new Error("browser download execution grant is invalid or spent");
      issued.execution = Object.freeze({ status: "executing" });
      const deadlineAtMs = startMs + issued.request.timeout;
      const controller = new AbortController();
      issued.abortController = controller;
      let timer = null;
      let timedOut = false;
      let result;
      try {
        const execution = Object.freeze({
          schema: BROWSER_DOWNLOAD_ACTION_EXECUTION_SCHEMA,
          actionReceiptDigest: issued.receipt.receiptDigest,
          requestDigest: issued.receipt.requestDigest,
          targetId: issued.request.targetId,
          operation: issued.request.operation,
          destinationUrl: issued.request.destinationUrl,
          allowedRedirectOrigins: issued.request.allowedRedirectOrigins,
          allowedContentTypes: issued.request.allowedContentTypes,
          maxBytes: issued.request.maxBytes,
          deadlineAt: new Date(deadlineAtMs).toISOString(),
        });
        const artifactValue = await Promise.race([
          Reflect.apply(captured.executeDownload, undefined, [
            execution,
            Object.freeze({ signal: controller.signal }),
          ]),
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              timedOut = true;
              controller.abort();
              reject(new Error("browser download execution timed out"));
            }, issued.request.timeout);
          }),
        ]);
        if (timedOut)
          throw new Error("browser download execution completed after timeout");
        if (issued.cancelRequested || controller.signal.aborted)
          throw new Error("browser download execution was cancelled");
        const finishedAtMs = captured.now();
        const artifact = normalizeArtifact(
          artifactValue,
          issued.request,
          deadlineAtMs,
          finishedAtMs,
        );
        result = executionEvidence(artifact);
      } catch {
        result = failedExecutionEvidence(
          timedOut
            ? "download-timeout"
            : issued.cancelRequested
              ? "download-cancelled"
              : "download-provider-failed",
        );
      } finally {
        if (timer !== null) clearTimeout(timer);
        issued.abortController = null;
      }
      issued.execution = result;
      return result;
    },
    recordActionOutcome: async (input) => {
      const request = normalizeOutcome(input);
      const issued = captured.issued.get(request.actionReceiptDigest);
      if (
        !issued ||
        issued.receipt.requestDigest !== request.requestDigest ||
        issued.request.targetId !== request.targetId ||
        issued.request.operation !== request.operation ||
        issued.request.inputDigest !== request.inputDigest ||
        !issued.execution ||
        issued.execution.status === "executing" ||
        issued.execution.status !== request.status ||
        issued.execution.resultDigest !== request.resultDigest ||
        (issued.outcomeRequestDigest !== null &&
          issued.outcomeRequestDigest !== request.outcomeRequestDigest)
      )
        throw new Error("browser download outcome differs from authorization");
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

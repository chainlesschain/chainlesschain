"use strict";

const { createHash, randomUUID } = require("node:crypto");
const { types } = require("node:util");

const REQUEST_SCHEMA = "chainlesschain.browser-download-action-request/v1";
const RECEIPT_SCHEMA = "chainlesschain.browser-download-action-receipt/v1";
const OUTCOME_REQUEST_SCHEMA =
  "chainlesschain.browser-download-action-outcome-request/v1";
const OUTCOME_ACK_SCHEMA =
  "chainlesschain.browser-download-action-outcome-ack/v1";
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ARTIFACT_REF = /^quarantine:[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/u;
const CONTENT_TYPE =
  /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/u;
const MAX_BYTES = 100 * 1024 * 1024;
const OPTION_KEYS = new Set([
  "allowedRedirectOrigins",
  "allowedContentTypes",
  "maxBytes",
  "timeout",
  "actionAuthorization",
]);
const EXECUTION_KEYS = [
  "status",
  "failureClass",
  "artifactRef",
  "artifactDigest",
  "sizeBytes",
  "contentType",
  "finalUrlDigest",
  "redirectOriginsDigest",
  "scanEvidenceDigest",
  "quarantineReceiptDigest",
  "completionReceiptDigest",
  "completedAt",
  "resultDigest",
];
const hosts = new WeakMap();
const grants = new WeakMap();

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

function ownData(owner, name, label) {
  const descriptor = Object.getOwnPropertyDescriptor(owner, name);
  if (!descriptor || !descriptor.enumerable || !("value" in descriptor))
    throw new TypeError(`${label} must be plain enumerable data`);
  return descriptor.value;
}

function ownFunction(owner, name, label) {
  const value = ownData(owner, name, label);
  if (typeof value !== "function" || types.isProxy(value))
    throw new TypeError(`${label} must be a direct function`);
  return value;
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

function normalizeUrl(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 16 * 1024)
    throw new TypeError("Desktop browser download destination is invalid");
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError("Desktop browser download destination is invalid");
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.href.length > 16 * 1024
  )
    throw new TypeError("Desktop browser download destination is invalid");
  return parsed.href;
}

function normalizeOrigins(value, destinationUrl) {
  const destinationOrigin = new URL(destinationUrl).origin;
  if (value === undefined) return Object.freeze([destinationOrigin]);
  if (
    !Array.isArray(value) ||
    types.isProxy(value) ||
    value.length < 1 ||
    value.length > 16
  )
    throw new TypeError("Desktop browser download origins are invalid");
  const origins = value.map((entry) => {
    if (typeof entry !== "string" || entry.length > 2048)
      throw new TypeError("Desktop browser download origins are invalid");
    let parsed;
    try {
      parsed = new URL(entry);
    } catch {
      throw new TypeError("Desktop browser download origins are invalid");
    }
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      entry !== parsed.origin
    )
      throw new TypeError("Desktop browser download origins are invalid");
    return parsed.origin;
  });
  const normalized = [...new Set(origins)].sort();
  if (
    normalized.length !== origins.length ||
    !normalized.includes(destinationOrigin)
  )
    throw new TypeError("Desktop browser download origins are invalid");
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
    throw new TypeError("Desktop browser download content types are invalid");
  const normalized = [...new Set(value)].sort();
  if (normalized.length !== value.length)
    throw new TypeError("Desktop browser download content types are invalid");
  return Object.freeze(normalized);
}

function normalizeInput(targetId, destinationUrl, options) {
  if (
    typeof targetId !== "string" ||
    targetId.length < 1 ||
    targetId.length > 512 ||
    !options ||
    typeof options !== "object" ||
    Array.isArray(options) ||
    types.isProxy(options) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(options))
  )
    throw new TypeError("Desktop browser download input is invalid");
  const ownKeys = Reflect.ownKeys(options);
  if (
    ownKeys.some(
      (name) => typeof name !== "string" || !OPTION_KEYS.has(name),
    ) ||
    ownKeys.some((name) => {
      const descriptor = Object.getOwnPropertyDescriptor(options, name);
      return !descriptor?.enumerable || !("value" in descriptor);
    })
  )
    throw new TypeError("Desktop browser download input is invalid");
  const normalizedUrl = normalizeUrl(destinationUrl);
  const maxBytes = options.maxBytes ?? 25 * 1024 * 1024;
  const timeout = options.timeout ?? 30_000;
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > MAX_BYTES ||
    !Number.isSafeInteger(timeout) ||
    timeout < 1 ||
    timeout > 120_000
  )
    throw new TypeError("Desktop browser download options are invalid");
  return Object.freeze({
    targetId,
    operation: "download-url",
    destinationUrl: normalizedUrl,
    allowedRedirectOrigins: normalizeOrigins(
      options.allowedRedirectOrigins,
      normalizedUrl,
    ),
    allowedContentTypes: normalizeContentTypes(options.allowedContentTypes),
    maxBytes,
    timeout,
  });
}

function inputDigest(core) {
  return digest("chainlesschain.browser-download-action-input/v1", core);
}

function createDesktopBrowserDownloadActionHost(authority, captureAuthority) {
  if (typeof captureAuthority !== "function" || types.isProxy(captureAuthority))
    throw new TypeError("Browser download authority capture is invalid");
  const captured = Reflect.apply(captureAuthority, undefined, [authority]);
  if (!captured || typeof captured !== "object" || types.isProxy(captured))
    throw new TypeError("Browser download authority port is invalid");
  const descriptor = ownData(
    captured,
    "descriptor",
    "browser download authority descriptor",
  );
  if (
    !descriptor ||
    typeof descriptor !== "object" ||
    types.isProxy(descriptor) ||
    ownData(descriptor, "approvalMode", "download approval mode") !==
      "interactive" ||
    ownData(descriptor, "auditMode", "download audit mode") !==
      "authenticated-durable-readback" ||
    ownData(descriptor, "artifactMode", "download artifact mode") !==
      "opaque-quarantine-clean-scan"
  )
    throw new TypeError("Browser download authority descriptor is invalid");
  const host = Object.freeze({});
  hosts.set(host, {
    descriptor,
    authorizeAction: ownFunction(
      captured,
      "authorizeAction",
      "browser download authorize port",
    ),
    executeAuthorizedDownload: ownFunction(
      captured,
      "executeAuthorizedDownload",
      "browser download execution port",
    ),
    cancelAuthorizedDownload: ownFunction(
      captured,
      "cancelAuthorizedDownload",
      "browser download cancellation port",
    ),
    recordActionOutcome: ownFunction(
      captured,
      "recordActionOutcome",
      "browser download outcome port",
    ),
  });
  return host;
}

async function authorizeDesktopBrowserDownloadAction(
  host,
  {
    targetId,
    destinationUrl,
    options = {},
    senderId,
    frameUrl,
    authorization = null,
  } = {},
) {
  const captured = hosts.get(host);
  if (!captured)
    throw new TypeError("A branded Desktop browser download host is required");
  if (!Number.isSafeInteger(senderId) || senderId < 1)
    throw new TypeError("Browser download sender is invalid");
  if (typeof frameUrl !== "string" || frameUrl.length > 16 * 1024)
    throw new TypeError("Browser download frame URL is invalid");
  const core = normalizeInput(targetId, destinationUrl, options);
  const optionAuthorization = Object.hasOwn(options, "actionAuthorization")
    ? ownData(
        options,
        "actionAuthorization",
        "browser download action authorization",
      )
    : undefined;
  if (
    optionAuthorization !== undefined &&
    authorization !== null &&
    optionAuthorization !== authorization
  )
    throw new TypeError("Browser download action authorization differs");
  const request = Object.freeze({
    schema: REQUEST_SCHEMA,
    requestId: randomUUID(),
    ...core,
    senderId,
    frameUrlDigest: digest(
      "chainlesschain.browser-download-action-frame-url/v1",
      frameUrl,
    ),
    inputDigest: inputDigest(core),
    authorization: optionAuthorization ?? authorization,
    requestedAt: new Date().toISOString(),
  });
  const receipt = await Reflect.apply(captured.authorizeAction, undefined, [
    request,
  ]);
  const expected = {
    schema: RECEIPT_SCHEMA,
    authorityId: captured.descriptor.authorityId,
    tenantId: captured.descriptor.tenantId,
    handlerArtifactDigest: captured.descriptor.handlerArtifactDigest,
    approvalMode: "interactive",
    artifactMode: "opaque-quarantine-clean-scan",
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
  };
  for (const [name, value] of Object.entries(expected)) {
    if (ownData(receipt, name, `browser download receipt ${name}`) !== value)
      throw new Error(`Browser download receipt ${name} mismatch`);
  }
  const validUntil = ownData(
    receipt,
    "validUntil",
    "browser download receipt validUntil",
  );
  const receiptDigest = ownData(
    receipt,
    "receiptDigest",
    "browser download receipt digest",
  );
  const requestDigest = ownData(
    receipt,
    "requestDigest",
    "browser download request digest",
  );
  if (
    !Number.isFinite(Date.parse(validUntil)) ||
    !DIGEST.test(receiptDigest) ||
    !DIGEST.test(requestDigest)
  )
    throw new TypeError("Browser download receipt is incomplete");
  const grant = Object.freeze({});
  grants.set(grant, {
    targetId,
    inputDigest: request.inputDigest,
    validUntil,
    receiptDigest,
    requestDigest,
    executeAuthorizedDownload: captured.executeAuthorizedDownload,
    cancelAuthorizedDownload: captured.cancelAuthorizedDownload,
    recordActionOutcome: captured.recordActionOutcome,
    descriptor: captured.descriptor,
    consumed: false,
    execution: null,
    executionStatus: "pending",
    auditStatus: "pending",
  });
  return grant;
}

function normalizeExecution(value) {
  exact(value, EXECUTION_KEYS, "Desktop browser download execution");
  if (
    !["succeeded", "failed"].includes(value.status) ||
    !DIGEST.test(value.resultDigest)
  )
    throw new TypeError("Desktop browser download execution is invalid");
  if (value.status === "succeeded") {
    if (
      value.failureClass !== null ||
      !ARTIFACT_REF.test(value.artifactRef) ||
      !DIGEST.test(value.artifactDigest) ||
      !Number.isSafeInteger(value.sizeBytes) ||
      value.sizeBytes < 1 ||
      typeof value.contentType !== "string" ||
      !CONTENT_TYPE.test(value.contentType) ||
      !DIGEST.test(value.finalUrlDigest) ||
      !DIGEST.test(value.redirectOriginsDigest) ||
      !DIGEST.test(value.scanEvidenceDigest) ||
      !DIGEST.test(value.quarantineReceiptDigest) ||
      !DIGEST.test(value.completionReceiptDigest) ||
      !Number.isFinite(Date.parse(value.completedAt))
    )
      throw new TypeError("Desktop browser download execution is invalid");
  } else if (
    typeof value.failureClass !== "string" ||
    !/^[a-z][a-z0-9-]{0,127}$/u.test(value.failureClass) ||
    EXECUTION_KEYS.slice(2, -1).some((name) => value[name] !== null)
  ) {
    throw new TypeError("Desktop browser download execution is invalid");
  }
  return Object.freeze({ ...value });
}

async function executeDesktopBrowserDownloadActionGrant(
  grant,
  targetId,
  destinationUrl,
  options = {},
) {
  const captured = grants.get(grant);
  const core = normalizeInput(targetId, destinationUrl, options);
  if (
    !captured ||
    captured.consumed ||
    captured.targetId !== targetId ||
    captured.inputDigest !== inputDigest(core) ||
    Date.parse(captured.validUntil) <= Date.now()
  ) {
    const error = new Error(
      "Browser download requires a fresh bound interactive grant",
    );
    error.code = "CC_AGENT_EVOLUTION_INGRESS_FAILED";
    throw error;
  }
  captured.consumed = true;
  captured.executionStatus = "executing";
  try {
    const execution = normalizeExecution(
      await Reflect.apply(captured.executeAuthorizedDownload, undefined, [
        Object.freeze({
          receiptDigest: captured.receiptDigest,
          requestDigest: captured.requestDigest,
        }),
      ]),
    );
    captured.execution = execution;
    captured.executionStatus = "completed";
    return execution;
  } catch (error) {
    captured.executionStatus = "uncertain";
    throw error;
  }
}

async function cancelDesktopBrowserDownloadActionGrant(
  grant,
  reason = "user-request",
) {
  const captured = grants.get(grant);
  if (
    !captured ||
    captured.consumed !== true ||
    captured.executionStatus !== "executing" ||
    captured.execution !== null ||
    !["user-request", "renderer-destroyed", "operator-request"].includes(reason)
  ) {
    const error = new Error(
      "Browser download cancellation target is not active",
    );
    error.code = "CC_AGENT_EVOLUTION_INGRESS_FAILED";
    throw error;
  }
  const acknowledgement = await Reflect.apply(
    captured.cancelAuthorizedDownload,
    undefined,
    [
      Object.freeze({
        receiptDigest: captured.receiptDigest,
        requestDigest: captured.requestDigest,
        reason,
      }),
    ],
  );
  exact(
    acknowledgement,
    ["accepted"],
    "Desktop browser download cancellation acknowledgement",
  );
  if (acknowledgement.accepted !== true)
    throw new Error("Browser download cancellation was not accepted");
  return Object.freeze({ accepted: true });
}

async function recordDesktopBrowserDownloadActionOutcome(grant) {
  const captured = grants.get(grant);
  if (
    !captured ||
    captured.consumed !== true ||
    captured.execution === null ||
    captured.auditStatus !== "pending"
  ) {
    const error = new Error(
      "Browser download outcome requires one executed unaudited grant",
    );
    error.code = "CC_AGENT_ACTION_AUDIT_UNCERTAIN";
    throw error;
  }
  const core = Object.freeze({
    schema: OUTCOME_REQUEST_SCHEMA,
    actionReceiptDigest: captured.receiptDigest,
    requestDigest: captured.requestDigest,
    targetId: captured.targetId,
    operation: "download-url",
    inputDigest: captured.inputDigest,
    status: captured.execution.status,
    resultDigest: captured.execution.resultDigest,
    recordedAt: new Date().toISOString(),
  });
  const outcomeRequestDigest = digest(OUTCOME_REQUEST_SCHEMA, core);
  captured.auditStatus = "uncertain";
  try {
    const acknowledgement = await Reflect.apply(
      captured.recordActionOutcome,
      undefined,
      [core],
    );
    exact(
      acknowledgement,
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
      "Desktop browser download outcome acknowledgement",
    );
    if (
      acknowledgement.schema !== OUTCOME_ACK_SCHEMA ||
      acknowledgement.authorityId !== captured.descriptor.authorityId ||
      acknowledgement.tenantId !== captured.descriptor.tenantId ||
      acknowledgement.handlerArtifactDigest !==
        captured.descriptor.handlerArtifactDigest ||
      acknowledgement.actionReceiptDigest !== captured.receiptDigest ||
      acknowledgement.outcomeRequestDigest !== outcomeRequestDigest ||
      !DIGEST.test(acknowledgement.auditEventDigest) ||
      !DIGEST.test(acknowledgement.durabilityReceiptDigest) ||
      acknowledgement.authenticated !== true ||
      acknowledgement.durable !== true ||
      acknowledgement.readbackVerified !== true ||
      acknowledgement.qualifiesForPromotion !== false
    )
      throw new Error("Browser download acknowledgement is invalid");
    captured.auditStatus = "recorded";
    return Object.freeze({
      actionReceiptDigest: captured.receiptDigest,
      requestDigest: captured.requestDigest,
      resultDigest: captured.execution.resultDigest,
      auditEventDigest: acknowledgement.auditEventDigest,
      durabilityReceiptDigest: acknowledgement.durabilityReceiptDigest,
    });
  } catch (error) {
    const uncertain = new Error(
      "Browser download occurred but durable audit is uncertain",
      { cause: error },
    );
    uncertain.code = "CC_AGENT_ACTION_AUDIT_UNCERTAIN";
    throw uncertain;
  }
}

module.exports = {
  authorizeDesktopBrowserDownloadAction,
  cancelDesktopBrowserDownloadActionGrant,
  createDesktopBrowserDownloadActionHost,
  executeDesktopBrowserDownloadActionGrant,
  recordDesktopBrowserDownloadActionOutcome,
};

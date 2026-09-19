"use strict";

const { createHash, randomUUID } = require("node:crypto");
const { types } = require("node:util");

const REQUEST_SCHEMA =
  "chainlesschain.browser-download-artifact-disposal-request/v1";
const RECEIPT_SCHEMA =
  "chainlesschain.browser-download-artifact-disposal-receipt/v1";
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ARTIFACT_REF = /^quarantine:[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/u;
const REASONS = new Set([
  "user-discard",
  "expired",
  "revoked",
  "delivery-failed",
]);
const OPTION_KEYS = new Set(["reason", "actionAuthorization"]);
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
  if (!descriptor?.enumerable || !("value" in descriptor))
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

function normalizeInput(
  artifactRef,
  artifactDigest,
  sourceActionReceiptDigest,
  options,
) {
  if (
    !ARTIFACT_REF.test(artifactRef) ||
    !DIGEST.test(artifactDigest) ||
    !DIGEST.test(sourceActionReceiptDigest) ||
    !options ||
    typeof options !== "object" ||
    Array.isArray(options) ||
    types.isProxy(options) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(options))
  )
    throw new TypeError("Desktop download artifact disposal input is invalid");
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
    throw new TypeError("Desktop download artifact disposal input is invalid");
  const reason = options.reason ?? "user-discard";
  if (!REASONS.has(reason))
    throw new TypeError("Desktop download artifact disposal reason is invalid");
  return Object.freeze({
    operation: "discard-download-artifact",
    artifactRef,
    artifactDigest,
    sourceActionReceiptDigest,
    reason,
  });
}

function inputDigest(core) {
  return digest(
    "chainlesschain.browser-download-artifact-disposal-input/v1",
    core,
  );
}

function createDesktopBrowserDownloadArtifactDisposalHost(
  authority,
  captureAuthority,
) {
  if (typeof captureAuthority !== "function" || types.isProxy(captureAuthority))
    throw new TypeError(
      "Download artifact disposal authority capture is invalid",
    );
  const captured = Reflect.apply(captureAuthority, undefined, [authority]);
  if (!captured || typeof captured !== "object" || types.isProxy(captured))
    throw new TypeError("Download artifact disposal authority port is invalid");
  const descriptor = ownData(
    captured,
    "descriptor",
    "download artifact disposal descriptor",
  );
  if (
    !descriptor ||
    typeof descriptor !== "object" ||
    types.isProxy(descriptor) ||
    ownData(descriptor, "approvalMode", "disposal approval mode") !==
      "interactive" ||
    ownData(descriptor, "auditMode", "disposal audit mode") !==
      "authenticated-durable-readback" ||
    ownData(descriptor, "effectMode", "disposal effect mode") !==
      "irreversible-byte-disposal"
  )
    throw new TypeError("Download artifact disposal descriptor is invalid");
  const host = Object.freeze({});
  hosts.set(host, {
    descriptor,
    authorizeDisposal: ownFunction(
      captured,
      "authorizeDisposal",
      "download artifact disposal authorization port",
    ),
    disposeAuthorizedArtifact: ownFunction(
      captured,
      "disposeAuthorizedArtifact",
      "download artifact disposal execution port",
    ),
  });
  return host;
}

async function authorizeDesktopBrowserDownloadArtifactDisposal(
  host,
  {
    artifactRef,
    artifactDigest,
    sourceActionReceiptDigest,
    options = {},
    senderId,
    frameUrl,
    authorization = null,
  } = {},
) {
  const captured = hosts.get(host);
  if (!captured)
    throw new TypeError(
      "A branded Desktop download artifact disposal host is required",
    );
  if (!Number.isSafeInteger(senderId) || senderId < 1)
    throw new TypeError("Download artifact disposal sender is invalid");
  if (typeof frameUrl !== "string" || frameUrl.length > 16 * 1024)
    throw new TypeError("Download artifact disposal frame URL is invalid");
  const core = normalizeInput(
    artifactRef,
    artifactDigest,
    sourceActionReceiptDigest,
    options,
  );
  const optionAuthorization = Object.hasOwn(options, "actionAuthorization")
    ? ownData(
        options,
        "actionAuthorization",
        "download artifact disposal authorization",
      )
    : undefined;
  if (
    optionAuthorization !== undefined &&
    authorization !== null &&
    optionAuthorization !== authorization
  )
    throw new TypeError("Download artifact disposal authorization differs");
  const request = Object.freeze({
    schema: REQUEST_SCHEMA,
    requestId: randomUUID(),
    senderId,
    frameUrlDigest: digest(
      "chainlesschain.browser-download-artifact-disposal-frame-url/v1",
      frameUrl,
    ),
    ...core,
    inputDigest: inputDigest(core),
    authorization: optionAuthorization ?? authorization,
    requestedAt: new Date().toISOString(),
  });
  const receipt = await Reflect.apply(captured.authorizeDisposal, undefined, [
    request,
  ]);
  const expected = {
    schema: RECEIPT_SCHEMA,
    authorityId: captured.descriptor.authorityId,
    tenantId: captured.descriptor.tenantId,
    handlerArtifactDigest: captured.descriptor.handlerArtifactDigest,
    approvalMode: "interactive",
    auditMode: "authenticated-durable-readback",
    effectMode: "irreversible-byte-disposal",
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
  };
  for (const [name, value] of Object.entries(expected)) {
    if (ownData(receipt, name, `artifact disposal receipt ${name}`) !== value)
      throw new Error(`Download artifact disposal receipt ${name} mismatch`);
  }
  const validUntil = ownData(
    receipt,
    "validUntil",
    "download artifact disposal receipt validUntil",
  );
  const receiptDigest = ownData(
    receipt,
    "receiptDigest",
    "download artifact disposal receipt digest",
  );
  const requestDigest = ownData(
    receipt,
    "requestDigest",
    "download artifact disposal request digest",
  );
  if (
    !Number.isFinite(Date.parse(validUntil)) ||
    !DIGEST.test(receiptDigest) ||
    !DIGEST.test(requestDigest)
  )
    throw new TypeError("Download artifact disposal receipt is incomplete");
  const grant = Object.freeze({});
  grants.set(grant, {
    core,
    inputDigest: request.inputDigest,
    validUntil,
    receiptDigest,
    requestDigest,
    artifactRefDigest: expected.artifactRefDigest,
    disposeAuthorizedArtifact: captured.disposeAuthorizedArtifact,
    consumed: false,
  });
  return grant;
}

async function executeDesktopBrowserDownloadArtifactDisposal(
  grant,
  artifactRef,
  artifactDigest,
  sourceActionReceiptDigest,
  options = {},
) {
  const captured = grants.get(grant);
  const core = normalizeInput(
    artifactRef,
    artifactDigest,
    sourceActionReceiptDigest,
    options,
  );
  if (
    !captured ||
    captured.consumed ||
    captured.inputDigest !== inputDigest(core) ||
    Date.parse(captured.validUntil) <= Date.now()
  ) {
    const error = new Error(
      "Download artifact disposal requires a fresh bound interactive grant",
    );
    error.code = "CC_AGENT_EVOLUTION_INGRESS_FAILED";
    throw error;
  }
  captured.consumed = true;
  let result;
  try {
    result = await Reflect.apply(
      captured.disposeAuthorizedArtifact,
      undefined,
      [
        Object.freeze({
          receiptDigest: captured.receiptDigest,
          requestDigest: captured.requestDigest,
        }),
      ],
    );
  } catch (error) {
    const uncertain = new Error(
      "Download artifact disposal outcome is uncertain",
      { cause: error },
    );
    uncertain.code = "CC_AGENT_ACTION_AUDIT_UNCERTAIN";
    throw uncertain;
  }
  try {
    exact(
      result,
      [
        "status",
        "artifactRefDigest",
        "artifactDigest",
        "sourceActionReceiptDigest",
        "reason",
        "discardedAt",
        "deletionReceiptDigest",
        "resultDigest",
      ],
      "Desktop download artifact disposal result",
    );
    const resultCore = Object.freeze({
      status: result.status,
      artifactRefDigest: result.artifactRefDigest,
      artifactDigest: result.artifactDigest,
      sourceActionReceiptDigest: result.sourceActionReceiptDigest,
      reason: result.reason,
      discardedAt: result.discardedAt,
      deletionReceiptDigest: result.deletionReceiptDigest,
    });
    if (
      result.status !== "discarded" ||
      result.artifactRefDigest !== captured.artifactRefDigest ||
      result.artifactDigest !== core.artifactDigest ||
      result.sourceActionReceiptDigest !== core.sourceActionReceiptDigest ||
      result.reason !== core.reason ||
      !Number.isFinite(Date.parse(result.discardedAt)) ||
      !DIGEST.test(result.deletionReceiptDigest) ||
      result.resultDigest !==
        digest(
          "chainlesschain.browser-download-artifact-disposal-result/v1",
          resultCore,
        )
    )
      throw new Error("Download artifact disposal result is invalid");
    return Object.freeze({ ...result });
  } catch (error) {
    const uncertain = new Error(
      "Download artifact disposal outcome is uncertain",
      { cause: error },
    );
    uncertain.code = "CC_AGENT_ACTION_AUDIT_UNCERTAIN";
    throw uncertain;
  }
}

module.exports = {
  authorizeDesktopBrowserDownloadArtifactDisposal,
  createDesktopBrowserDownloadArtifactDisposalHost,
  executeDesktopBrowserDownloadArtifactDisposal,
};

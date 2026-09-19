"use strict";

const { createHash, randomUUID } = require("node:crypto");
const { types } = require("node:util");

const REQUEST_SCHEMA = "chainlesschain.browser-navigation-action-request/v1";
const RECEIPT_SCHEMA = "chainlesschain.browser-navigation-action-receipt/v1";
const OUTCOME_REQUEST_SCHEMA =
  "chainlesschain.browser-navigation-action-outcome-request/v1";
const OUTCOME_ACK_SCHEMA =
  "chainlesschain.browser-navigation-action-outcome-ack/v1";
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const WAIT_UNTIL = new Set(["load", "domcontentloaded", "networkidle"]);
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
  if (!descriptor || !("value" in descriptor))
    throw new TypeError(`${label} must be plain data`);
  return descriptor.value;
}

function ownFunction(owner, name, label) {
  const value = ownData(owner, name, label);
  if (typeof value !== "function" || types.isProxy(value))
    throw new TypeError(`${label} must be a direct function`);
  return value;
}

function exactData(value, keys, label) {
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
  ) {
    throw new TypeError(`${label} has unexpected or accessor fields`);
  }
}

function optionData(options, name) {
  const descriptor = Object.getOwnPropertyDescriptor(options, name);
  if (!descriptor) return undefined;
  if (!("value" in descriptor))
    throw new TypeError(
      `Desktop browser navigation action ${name} must be plain data`,
    );
  return descriptor.value;
}

function normalizeUrl(value, label) {
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
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return parsed.href;
}

function inputCore(targetId, destinationUrl, options = {}) {
  if (
    typeof targetId !== "string" ||
    targetId.length < 1 ||
    targetId.length > 512 ||
    !options ||
    typeof options !== "object" ||
    Array.isArray(options) ||
    types.isProxy(options) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(options))
  ) {
    throw new TypeError("Desktop browser navigation action input is invalid");
  }
  const waitUntil = optionData(options, "waitUntil") ?? "domcontentloaded";
  const timeout = optionData(options, "timeout") ?? 30_000;
  if (
    !WAIT_UNTIL.has(waitUntil) ||
    !Number.isSafeInteger(timeout) ||
    timeout < 1 ||
    timeout > 120_000
  ) {
    throw new TypeError("Desktop browser navigation options are invalid");
  }
  return Object.freeze({
    targetId,
    operation: "navigate",
    destinationUrl: normalizeUrl(
      destinationUrl,
      "Desktop browser navigation destination",
    ),
    waitUntil,
    timeout,
  });
}

function inputDigest(core) {
  return digest("chainlesschain.browser-navigation-action-input/v1", core);
}

function validateReceipt(receipt, request, authorityDescriptor) {
  if (!receipt || typeof receipt !== "object" || types.isProxy(receipt))
    throw new TypeError("Browser navigation action receipt is invalid");
  for (const [name, expected] of Object.entries({
    schema: RECEIPT_SCHEMA,
    authorityId: authorityDescriptor.authorityId,
    tenantId: authorityDescriptor.tenantId,
    handlerArtifactDigest: authorityDescriptor.handlerArtifactDigest,
    approvalMode: "interactive",
    requestId: request.requestId,
    targetId: request.targetId,
    operation: request.operation,
    senderId: request.senderId,
    frameUrlDigest: request.frameUrlDigest,
    destinationDigest: digest(
      "chainlesschain.browser-navigation-action-destination/v1",
      request.destinationUrl,
    ),
    waitUntil: request.waitUntil,
    timeout: request.timeout,
    inputDigest: request.inputDigest,
  })) {
    if (
      ownData(receipt, name, `browser navigation action receipt ${name}`) !==
      expected
    ) {
      throw new Error(`Browser navigation action receipt ${name} mismatch`);
    }
  }
  const validUntil = ownData(
    receipt,
    "validUntil",
    "navigation receipt validUntil",
  );
  const receiptDigest = ownData(
    receipt,
    "receiptDigest",
    "navigation receipt digest",
  );
  const requestDigest = ownData(
    receipt,
    "requestDigest",
    "navigation receipt requestDigest",
  );
  if (
    !Number.isFinite(Date.parse(validUntil)) ||
    !DIGEST.test(receiptDigest) ||
    !DIGEST.test(requestDigest)
  ) {
    throw new TypeError("Browser navigation action receipt is incomplete");
  }
  return Object.freeze({ validUntil, receiptDigest, requestDigest });
}

function createDesktopBrowserNavigationActionHost(authority, captureAuthority) {
  if (typeof captureAuthority !== "function" || types.isProxy(captureAuthority))
    throw new TypeError(
      "Browser navigation action authority capture is invalid",
    );
  const captured = Reflect.apply(captureAuthority, undefined, [authority]);
  if (!captured || typeof captured !== "object" || types.isProxy(captured))
    throw new TypeError("Browser navigation action authority port is invalid");
  const descriptor = ownData(
    captured,
    "descriptor",
    "browser navigation action authority descriptor",
  );
  if (
    !descriptor ||
    typeof descriptor !== "object" ||
    types.isProxy(descriptor) ||
    ownData(descriptor, "approvalMode", "navigation approval mode") !==
      "interactive" ||
    ownData(descriptor, "auditMode", "navigation audit mode") !==
      "authenticated-durable-readback"
  ) {
    throw new TypeError(
      "Browser navigation action authority descriptor is invalid",
    );
  }
  const authorizeAction = ownFunction(
    captured,
    "authorizeAction",
    "browser navigation action authorize port",
  );
  const recordActionOutcome = ownFunction(
    captured,
    "recordActionOutcome",
    "browser navigation action outcome port",
  );
  const host = Object.freeze({});
  hosts.set(host, { descriptor, authorizeAction, recordActionOutcome });
  return host;
}

async function authorizeDesktopBrowserNavigationAction(
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
    throw new TypeError(
      "A branded Desktop browser navigation action host is required",
    );
  if (!Number.isSafeInteger(senderId) || senderId < 1)
    throw new TypeError("Browser navigation action sender is invalid");
  if (typeof frameUrl !== "string" || frameUrl.length > 16 * 1024)
    throw new TypeError("Browser navigation action frame URL is invalid");
  const core = inputCore(targetId, destinationUrl, options);
  const request = Object.freeze({
    schema: REQUEST_SCHEMA,
    requestId: randomUUID(),
    targetId,
    operation: "navigate",
    senderId,
    frameUrlDigest: digest(
      "chainlesschain.browser-navigation-action-frame-url/v1",
      frameUrl,
    ),
    destinationUrl: core.destinationUrl,
    waitUntil: core.waitUntil,
    timeout: core.timeout,
    inputDigest: inputDigest(core),
    authorization,
    requestedAt: new Date().toISOString(),
  });
  const receipt = await Reflect.apply(captured.authorizeAction, undefined, [
    request,
  ]);
  const validated = validateReceipt(receipt, request, captured.descriptor);
  const grant = Object.freeze({});
  grants.set(grant, {
    targetId,
    inputCore: core,
    inputDigest: request.inputDigest,
    validUntil: validated.validUntil,
    receiptDigest: validated.receiptDigest,
    requestDigest: validated.requestDigest,
    recordActionOutcome: captured.recordActionOutcome,
    descriptor: captured.descriptor,
    consumed: false,
    auditStatus: "pending",
  });
  return grant;
}

function validateGrant(grant, targetId, destinationUrl, options) {
  const captured = grants.get(grant);
  const core = inputCore(targetId, destinationUrl, options);
  if (
    !captured ||
    captured.consumed ||
    captured.targetId !== targetId ||
    captured.inputDigest !== inputDigest(core) ||
    Date.parse(captured.validUntil) <= Date.now()
  ) {
    const error = new Error(
      "Browser navigation requires a fresh bound interactive action grant",
    );
    error.code = "CC_AGENT_EVOLUTION_INGRESS_FAILED";
    throw error;
  }
  return captured;
}

function assertDesktopBrowserNavigationActionGrant(
  grant,
  targetId,
  destinationUrl,
  options = {},
) {
  validateGrant(grant, targetId, destinationUrl, options);
}

function consumeDesktopBrowserNavigationActionGrant(
  grant,
  targetId,
  destinationUrl,
  options = {},
) {
  const captured = validateGrant(grant, targetId, destinationUrl, options);
  captured.consumed = true;
  return Object.freeze({ receiptDigest: captured.receiptDigest });
}

function normalizeOutcome(value) {
  exactData(
    value,
    ["status", "finalUrl", "failureClass"],
    "Desktop browser navigation outcome",
  );
  if (
    !["succeeded", "failed"].includes(value.status) ||
    (value.status === "succeeded" &&
      (value.failureClass !== null || value.finalUrl === null)) ||
    (value.status === "failed" &&
      (typeof value.failureClass !== "string" ||
        !/^[a-z][a-z0-9-]{0,127}$/u.test(value.failureClass))) ||
    (value.finalUrl !== null && typeof value.finalUrl !== "string")
  ) {
    throw new TypeError("Desktop browser navigation outcome is invalid");
  }
  const finalUrl =
    value.finalUrl === null
      ? null
      : normalizeUrl(value.finalUrl, "Desktop browser navigation final URL");
  return Object.freeze({
    status: value.status,
    finalUrlDigest:
      finalUrl === null
        ? null
        : digest(
            "chainlesschain.browser-navigation-action-final-url/v1",
            finalUrl,
          ),
    failureClass: value.failureClass,
  });
}

function validateOutcomeAck(value, captured, outcomeRequestDigest) {
  exactData(
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
    "Desktop browser navigation outcome acknowledgement",
  );
  if (
    value.schema !== OUTCOME_ACK_SCHEMA ||
    value.authorityId !== captured.descriptor.authorityId ||
    value.tenantId !== captured.descriptor.tenantId ||
    value.handlerArtifactDigest !== captured.descriptor.handlerArtifactDigest ||
    value.actionReceiptDigest !== captured.receiptDigest ||
    value.outcomeRequestDigest !== outcomeRequestDigest ||
    !DIGEST.test(value.auditEventDigest) ||
    !DIGEST.test(value.durabilityReceiptDigest) ||
    value.authenticated !== true ||
    value.durable !== true ||
    value.readbackVerified !== true ||
    value.qualifiesForPromotion !== false
  ) {
    throw new Error(
      "Desktop browser navigation outcome acknowledgement is invalid",
    );
  }
  return Object.freeze({
    auditEventDigest: value.auditEventDigest,
    durabilityReceiptDigest: value.durabilityReceiptDigest,
  });
}

async function recordDesktopBrowserNavigationActionOutcome(grant, value) {
  const captured = grants.get(grant);
  if (
    !captured ||
    captured.consumed !== true ||
    captured.auditStatus !== "pending"
  ) {
    const error = new Error(
      "Browser navigation outcome requires one consumed unaudited grant",
    );
    error.code = "CC_AGENT_ACTION_AUDIT_UNCERTAIN";
    throw error;
  }
  const outcome = normalizeOutcome(value);
  const resultDigest = digest(
    "chainlesschain.browser-navigation-action-result/v1",
    outcome,
  );
  const core = Object.freeze({
    schema: OUTCOME_REQUEST_SCHEMA,
    actionReceiptDigest: captured.receiptDigest,
    requestDigest: captured.requestDigest,
    targetId: captured.targetId,
    operation: "navigate",
    inputDigest: captured.inputDigest,
    status: outcome.status,
    resultDigest,
    recordedAt: new Date().toISOString(),
  });
  const outcomeRequestDigest = digest(OUTCOME_REQUEST_SCHEMA, core);
  captured.auditStatus = "uncertain";
  try {
    const acknowledgement = validateOutcomeAck(
      await Reflect.apply(captured.recordActionOutcome, undefined, [core]),
      captured,
      outcomeRequestDigest,
    );
    captured.auditStatus = "recorded";
    return acknowledgement;
  } catch (error) {
    const uncertain = new Error(
      "Browser navigation occurred but durable audit confirmation is uncertain",
      { cause: error },
    );
    uncertain.code = "CC_AGENT_ACTION_AUDIT_UNCERTAIN";
    throw uncertain;
  }
}

module.exports = {
  assertDesktopBrowserNavigationActionGrant,
  authorizeDesktopBrowserNavigationAction,
  consumeDesktopBrowserNavigationActionGrant,
  createDesktopBrowserNavigationActionHost,
  recordDesktopBrowserNavigationActionOutcome,
};

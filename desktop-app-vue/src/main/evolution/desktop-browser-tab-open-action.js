"use strict";

const { createHash, randomUUID } = require("node:crypto");
const { types } = require("node:util");

const REQUEST_SCHEMA = "chainlesschain.browser-tab-open-action-request/v1";
const RECEIPT_SCHEMA = "chainlesschain.browser-tab-open-action-receipt/v1";
const OUTCOME_REQUEST_SCHEMA =
  "chainlesschain.browser-tab-open-action-outcome-request/v1";
const OUTCOME_ACK_SCHEMA =
  "chainlesschain.browser-tab-open-action-outcome-ack/v1";
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const PROFILE = /^[A-Za-z0-9._-]{1,128}$/u;
const WAIT_UNTIL = new Set(["load", "domcontentloaded", "networkidle"]);
const OPTION_KEYS = new Set([
  "waitUntil",
  "timeout",
  "allowedRedirectOrigins",
  "actionAuthorization",
]);
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
  )
    throw new TypeError(`${label} is invalid`);
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
    throw new TypeError("Desktop browser tab open origins are invalid");
  const origins = value.map((entry) => {
    if (typeof entry !== "string" || entry.length > 2048)
      throw new TypeError("Desktop browser tab open origins are invalid");
    let parsed;
    try {
      parsed = new URL(entry);
    } catch {
      throw new TypeError("Desktop browser tab open origins are invalid");
    }
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      entry !== parsed.origin
    )
      throw new TypeError("Desktop browser tab open origins are invalid");
    return parsed.origin;
  });
  const normalized = [...new Set(origins)].sort();
  if (
    normalized.length !== origins.length ||
    !normalized.includes(destinationOrigin)
  )
    throw new TypeError("Desktop browser tab open origins are invalid");
  return Object.freeze(normalized);
}

function normalizeInput(profileName, destinationUrl, options) {
  if (
    typeof profileName !== "string" ||
    !PROFILE.test(profileName) ||
    !options ||
    typeof options !== "object" ||
    Array.isArray(options) ||
    types.isProxy(options) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(options))
  )
    throw new TypeError("Desktop browser tab open input is invalid");
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
    throw new TypeError("Desktop browser tab open input is invalid");
  const normalizedUrl = normalizeUrl(
    destinationUrl,
    "Desktop browser tab open destination",
  );
  const waitUntil = options.waitUntil ?? "domcontentloaded";
  const timeout = options.timeout ?? 30_000;
  if (
    !WAIT_UNTIL.has(waitUntil) ||
    !Number.isSafeInteger(timeout) ||
    timeout < 1 ||
    timeout > 120_000
  )
    throw new TypeError("Desktop browser tab open options are invalid");
  return Object.freeze({
    profileName,
    operation: "open-tab",
    destinationUrl: normalizedUrl,
    allowedRedirectOrigins: normalizeOrigins(
      options.allowedRedirectOrigins,
      normalizedUrl,
    ),
    waitUntil,
    timeout,
  });
}

function inputDigest(core) {
  return digest("chainlesschain.browser-tab-open-action-input/v1", core);
}

function createDesktopBrowserTabOpenActionHost(authority, captureAuthority) {
  if (typeof captureAuthority !== "function" || types.isProxy(captureAuthority))
    throw new TypeError("Browser tab open authority capture is invalid");
  const captured = Reflect.apply(captureAuthority, undefined, [authority]);
  if (!captured || typeof captured !== "object" || types.isProxy(captured))
    throw new TypeError("Browser tab open authority port is invalid");
  const descriptor = ownData(
    captured,
    "descriptor",
    "browser tab open authority descriptor",
  );
  if (
    !descriptor ||
    typeof descriptor !== "object" ||
    types.isProxy(descriptor) ||
    ownData(descriptor, "approvalMode", "tab open approval mode") !==
      "interactive" ||
    ownData(descriptor, "auditMode", "tab open audit mode") !==
      "authenticated-durable-readback"
  )
    throw new TypeError("Browser tab open authority descriptor is invalid");
  const host = Object.freeze({});
  hosts.set(host, {
    descriptor,
    authorizeAction: ownFunction(
      captured,
      "authorizeAction",
      "browser tab open authorize port",
    ),
    recordActionOutcome: ownFunction(
      captured,
      "recordActionOutcome",
      "browser tab open outcome port",
    ),
  });
  return host;
}

async function authorizeDesktopBrowserTabOpenAction(
  host,
  {
    profileName,
    destinationUrl,
    options = {},
    senderId,
    frameUrl,
    authorization = null,
  } = {},
) {
  const captured = hosts.get(host);
  if (!captured)
    throw new TypeError("A branded Desktop browser tab open host is required");
  if (!Number.isSafeInteger(senderId) || senderId < 1)
    throw new TypeError("Browser tab open sender is invalid");
  if (typeof frameUrl !== "string" || frameUrl.length > 16 * 1024)
    throw new TypeError("Browser tab open frame URL is invalid");
  const core = normalizeInput(profileName, destinationUrl, options);
  const optionAuthorization = Object.hasOwn(options, "actionAuthorization")
    ? ownData(
        options,
        "actionAuthorization",
        "browser tab open action authorization",
      )
    : undefined;
  if (
    optionAuthorization !== undefined &&
    authorization !== null &&
    optionAuthorization !== authorization
  )
    throw new TypeError("Browser tab open action authorization differs");
  const request = Object.freeze({
    schema: REQUEST_SCHEMA,
    requestId: randomUUID(),
    profileName: core.profileName,
    operation: core.operation,
    senderId,
    frameUrlDigest: digest(
      "chainlesschain.browser-tab-open-action-frame-url/v1",
      frameUrl,
    ),
    destinationUrl: core.destinationUrl,
    allowedRedirectOrigins: core.allowedRedirectOrigins,
    waitUntil: core.waitUntil,
    timeout: core.timeout,
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
  };
  for (const [name, value] of Object.entries(expected)) {
    if (ownData(receipt, name, `browser tab open receipt ${name}`) !== value)
      throw new Error(`Browser tab open receipt ${name} mismatch`);
  }
  const validUntil = ownData(
    receipt,
    "validUntil",
    "browser tab open receipt validUntil",
  );
  const receiptDigest = ownData(
    receipt,
    "receiptDigest",
    "browser tab open receipt digest",
  );
  const requestDigest = ownData(
    receipt,
    "requestDigest",
    "browser tab open request digest",
  );
  if (
    !Number.isFinite(Date.parse(validUntil)) ||
    !DIGEST.test(receiptDigest) ||
    !DIGEST.test(requestDigest)
  )
    throw new TypeError("Browser tab open receipt is incomplete");
  const grant = Object.freeze({});
  grants.set(grant, {
    profileName: core.profileName,
    inputCore: core,
    inputDigest: request.inputDigest,
    validUntil,
    receiptDigest,
    requestDigest,
    recordActionOutcome: captured.recordActionOutcome,
    descriptor: captured.descriptor,
    consumed: false,
    auditStatus: "pending",
  });
  return grant;
}

function consumeDesktopBrowserTabOpenActionGrant(
  grant,
  profileName,
  destinationUrl,
  options = {},
) {
  const captured = grants.get(grant);
  const core = normalizeInput(profileName, destinationUrl, options);
  if (
    !captured ||
    captured.consumed ||
    captured.profileName !== profileName ||
    captured.inputDigest !== inputDigest(core) ||
    Date.parse(captured.validUntil) <= Date.now()
  ) {
    const error = new Error(
      "Browser tab open requires a fresh bound interactive grant",
    );
    error.code = "CC_AGENT_EVOLUTION_INGRESS_FAILED";
    throw error;
  }
  captured.consumed = true;
  return Object.freeze({
    receiptDigest: captured.receiptDigest,
    profileName: core.profileName,
    destinationUrl: core.destinationUrl,
    allowedRedirectOrigins: core.allowedRedirectOrigins,
    waitUntil: core.waitUntil,
    timeout: core.timeout,
  });
}

function normalizeOutcome(value) {
  exact(
    value,
    ["status", "targetId", "finalUrl", "failureClass"],
    "Desktop browser tab open outcome",
  );
  if (
    !["succeeded", "failed"].includes(value.status) ||
    (value.status === "succeeded" &&
      (typeof value.targetId !== "string" ||
        value.targetId.length < 1 ||
        value.targetId.length > 512 ||
        value.finalUrl === null ||
        value.failureClass !== null)) ||
    (value.status === "failed" &&
      (value.targetId !== null ||
        value.finalUrl !== null ||
        typeof value.failureClass !== "string" ||
        !/^[a-z][a-z0-9-]{0,127}$/u.test(value.failureClass)))
  )
    throw new TypeError("Desktop browser tab open outcome is invalid");
  const finalUrl =
    value.finalUrl === null
      ? null
      : normalizeUrl(value.finalUrl, "Desktop browser tab open final URL");
  return Object.freeze({
    status: value.status,
    targetIdDigest:
      value.targetId === null
        ? null
        : digest(
            "chainlesschain.browser-tab-open-action-target/v1",
            value.targetId,
          ),
    finalUrlDigest:
      finalUrl === null
        ? null
        : digest(
            "chainlesschain.browser-tab-open-action-final-url/v1",
            finalUrl,
          ),
    failureClass: value.failureClass,
  });
}

async function recordDesktopBrowserTabOpenActionOutcome(grant, value) {
  const captured = grants.get(grant);
  if (
    !captured ||
    captured.consumed !== true ||
    captured.auditStatus !== "pending"
  ) {
    const error = new Error(
      "Browser tab open outcome requires one consumed unaudited grant",
    );
    error.code = "CC_AGENT_ACTION_AUDIT_UNCERTAIN";
    throw error;
  }
  const outcome = normalizeOutcome(value);
  const resultDigest = digest(
    "chainlesschain.browser-tab-open-action-result/v1",
    outcome,
  );
  const core = Object.freeze({
    schema: OUTCOME_REQUEST_SCHEMA,
    actionReceiptDigest: captured.receiptDigest,
    requestDigest: captured.requestDigest,
    profileName: captured.profileName,
    operation: "open-tab",
    inputDigest: captured.inputDigest,
    status: outcome.status,
    resultDigest,
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
      "Desktop browser tab open outcome acknowledgement",
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
      throw new Error("Browser tab open acknowledgement is invalid");
    captured.auditStatus = "recorded";
    return Object.freeze({
      auditEventDigest: acknowledgement.auditEventDigest,
      durabilityReceiptDigest: acknowledgement.durabilityReceiptDigest,
    });
  } catch (error) {
    const uncertain = new Error(
      "Browser tab opened but durable audit is uncertain",
      { cause: error },
    );
    uncertain.code = "CC_AGENT_ACTION_AUDIT_UNCERTAIN";
    throw uncertain;
  }
}

module.exports = {
  authorizeDesktopBrowserTabOpenAction,
  consumeDesktopBrowserTabOpenActionGrant,
  createDesktopBrowserTabOpenActionHost,
  recordDesktopBrowserTabOpenActionOutcome,
};

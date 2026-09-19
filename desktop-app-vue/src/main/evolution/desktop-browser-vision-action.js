"use strict";

const { createHash, randomUUID } = require("node:crypto");
const { types } = require("node:util");
const {
  captureDesktopBrowserVisionObservationGrant,
} = require("./desktop-browser-vision-observation");

const REQUEST_SCHEMA = "chainlesschain.browser-vision-action-request/v1";
const RECEIPT_SCHEMA = "chainlesschain.browser-vision-action-receipt/v1";
const OUTCOME_REQUEST_SCHEMA =
  "chainlesschain.browser-vision-action-outcome-request/v1";
const OUTCOME_ACK_SCHEMA =
  "chainlesschain.browser-vision-action-outcome-ack/v1";
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
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
    .update(typeof value === "string" ? value : canonical(value))
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
      `Desktop browser vision action ${name} must be plain data`,
    );
  return descriptor.value;
}

function inputCore(targetId, operation, options = {}) {
  if (
    typeof targetId !== "string" ||
    targetId.length < 1 ||
    targetId.length > 512 ||
    !["visual-click", "visual-type"].includes(operation) ||
    !options ||
    typeof options !== "object" ||
    Array.isArray(options) ||
    types.isProxy(options) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(options))
  ) {
    throw new TypeError("Desktop browser vision action input is invalid");
  }
  const description = optionData(options, "description");
  if (
    typeof description !== "string" ||
    !description.trim() ||
    description.length > 4096
  ) {
    throw new TypeError("Desktop browser vision action options are invalid");
  }
  if (operation === "visual-type") {
    const text = optionData(options, "text");
    const delay = optionData(options, "delay") ?? 0;
    const clearExisting = optionData(options, "clearExisting") ?? false;
    if (
      typeof text !== "string" ||
      text.length < 1 ||
      Buffer.byteLength(text, "utf8") > 64 * 1024 ||
      !Number.isSafeInteger(delay) ||
      delay < 0 ||
      delay > 1000 ||
      typeof clearExisting !== "boolean"
    ) {
      throw new TypeError("Desktop browser visual type options are invalid");
    }
    return Object.freeze({
      targetId,
      operation,
      description,
      textDigest: digest("chainlesschain.browser-vision-action-text/v1", text),
      requestedCharacterCount: [...text].length,
      delay,
      clearExisting,
    });
  }
  const button = optionData(options, "button") ?? "left";
  const clickCount = optionData(options, "clickCount") ?? 1;
  const delay = optionData(options, "delay") ?? 0;
  const waitAfterClick = optionData(options, "waitAfterClick") ?? null;
  if (
    !["left", "right", "middle"].includes(button) ||
    !Number.isSafeInteger(clickCount) ||
    clickCount < 1 ||
    clickCount > 3 ||
    !Number.isSafeInteger(delay) ||
    delay < 0 ||
    delay > 5000 ||
    (waitAfterClick !== null &&
      (!Number.isSafeInteger(waitAfterClick) ||
        waitAfterClick < 1 ||
        waitAfterClick > 60_000))
  ) {
    throw new TypeError("Desktop browser vision action options are invalid");
  }
  return Object.freeze({
    targetId,
    operation,
    description,
    button,
    clickCount,
    delay,
    waitAfterClick,
  });
}

function inputDigest(core) {
  return digest("chainlesschain.browser-vision-action-input/v1", core);
}

function observationOptions(options) {
  return { ...options, description: optionData(options, "description") };
}

function captureObservation(grant, targetId, options, expectedConsumed) {
  return captureDesktopBrowserVisionObservationGrant(
    grant,
    targetId,
    "locate",
    observationOptions(options),
    expectedConsumed,
  );
}

function validateReceipt(receipt, request, authorityDescriptor) {
  if (!receipt || typeof receipt !== "object" || types.isProxy(receipt))
    throw new TypeError("Browser vision action receipt is invalid");
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
    inputDigest: request.inputDigest,
    observationReceiptDigest: request.observationReceiptDigest,
  })) {
    if (
      ownData(receipt, name, `browser vision action receipt ${name}`) !==
      expected
    )
      throw new Error(`Browser vision action receipt ${name} mismatch`);
  }
  const validUntil = ownData(
    receipt,
    "validUntil",
    "action receipt validUntil",
  );
  const receiptDigest = ownData(
    receipt,
    "receiptDigest",
    "action receipt digest",
  );
  const requestDigest = ownData(
    receipt,
    "requestDigest",
    "action receipt requestDigest",
  );
  if (
    !Number.isFinite(Date.parse(validUntil)) ||
    !DIGEST.test(receiptDigest) ||
    !DIGEST.test(requestDigest)
  )
    throw new TypeError("Browser vision action receipt is incomplete");
  return Object.freeze({ validUntil, receiptDigest, requestDigest });
}

function createDesktopBrowserVisionActionHost(authority, captureAuthority) {
  if (typeof captureAuthority !== "function" || types.isProxy(captureAuthority))
    throw new TypeError("Browser vision action authority capture is invalid");
  const captured = Reflect.apply(captureAuthority, undefined, [authority]);
  if (!captured || typeof captured !== "object" || types.isProxy(captured))
    throw new TypeError("Browser vision action authority port is invalid");
  const descriptor = ownData(
    captured,
    "descriptor",
    "browser vision action authority descriptor",
  );
  if (
    !descriptor ||
    typeof descriptor !== "object" ||
    types.isProxy(descriptor) ||
    ownData(descriptor, "approvalMode", "action approval mode") !==
      "interactive" ||
    ownData(descriptor, "auditMode", "action audit mode") !==
      "authenticated-durable-readback"
  ) {
    throw new TypeError(
      "Browser vision action authority descriptor is invalid",
    );
  }
  const authorizeAction = ownFunction(
    captured,
    "authorizeAction",
    "browser vision action authorize port",
  );
  const recordActionOutcome = ownFunction(
    captured,
    "recordActionOutcome",
    "browser vision action outcome port",
  );
  const host = Object.freeze({});
  hosts.set(host, { descriptor, authorizeAction, recordActionOutcome });
  return host;
}

async function authorizeDesktopBrowserVisionAction(
  host,
  {
    targetId,
    operation,
    options = {},
    observationGrant,
    senderId,
    frameUrl,
    authorization = null,
  } = {},
) {
  const captured = hosts.get(host);
  if (!captured)
    throw new TypeError(
      "A branded Desktop browser vision action host is required",
    );
  if (!Number.isSafeInteger(senderId) || senderId < 1)
    throw new TypeError("Browser vision action sender is invalid");
  if (typeof frameUrl !== "string" || frameUrl.length > 16 * 1024)
    throw new TypeError("Browser vision action frame URL is invalid");
  const core = inputCore(targetId, operation, options);
  const observation = captureObservation(
    observationGrant,
    targetId,
    options,
    false,
  );
  const request = Object.freeze({
    schema: REQUEST_SCHEMA,
    requestId: randomUUID(),
    targetId,
    operation,
    senderId,
    frameUrlDigest: digest(
      "chainlesschain.browser-vision-action-frame-url/v1",
      frameUrl,
    ),
    inputDigest: inputDigest(core),
    observationReceiptDigest: observation.receiptDigest,
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
    operation,
    inputDigest: request.inputDigest,
    inputCore: core,
    observationReceiptDigest: request.observationReceiptDigest,
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

function validateGrant(
  grant,
  observationGrant,
  targetId,
  operation,
  options,
  observationConsumed,
) {
  const captured = grants.get(grant);
  const core = inputCore(targetId, operation, options);
  const observation = captureObservation(
    observationGrant,
    targetId,
    options,
    observationConsumed,
  );
  if (
    !captured ||
    captured.consumed ||
    captured.targetId !== targetId ||
    captured.operation !== operation ||
    captured.inputDigest !== inputDigest(core) ||
    captured.observationReceiptDigest !== observation.receiptDigest ||
    Date.parse(captured.validUntil) <= Date.now()
  ) {
    const error = new Error(
      "Browser mutation requires a fresh bound interactive action grant",
    );
    error.code = "CC_AGENT_EVOLUTION_INGRESS_FAILED";
    throw error;
  }
  return captured;
}

function assertDesktopBrowserVisionActionGrant(
  grant,
  observationGrant,
  targetId,
  operation,
  options = {},
) {
  validateGrant(grant, observationGrant, targetId, operation, options, false);
}

function consumeDesktopBrowserVisionActionGrant(
  grant,
  observationGrant,
  targetId,
  operation,
  options = {},
) {
  const captured = validateGrant(
    grant,
    observationGrant,
    targetId,
    operation,
    options,
    true,
  );
  captured.consumed = true;
  return Object.freeze({ receiptDigest: captured.receiptDigest });
}

function normalizeActionOutcome(value, captured) {
  if (captured.operation === "visual-type") {
    exactData(
      value,
      ["status", "text", "failureClass"],
      "Desktop browser visual type outcome",
    );
    if (
      !["succeeded", "failed"].includes(value.status) ||
      typeof value.text !== "string" ||
      (value.status === "succeeded" && value.failureClass !== null) ||
      (value.status === "failed" &&
        (typeof value.failureClass !== "string" ||
          !/^[a-z][a-z0-9-]{0,127}$/u.test(value.failureClass)))
    ) {
      throw new TypeError("Desktop browser visual type outcome is invalid");
    }
    const textDigest = digest(
      "chainlesschain.browser-vision-action-text/v1",
      value.text,
    );
    if (textDigest !== captured.inputCore.textDigest)
      throw new TypeError("Desktop browser visual type outcome is invalid");
    return Object.freeze({
      status: value.status,
      textDigest,
      requestedCharacterCount: captured.inputCore.requestedCharacterCount,
      failureClass: value.failureClass,
    });
  }
  exactData(
    value,
    ["status", "clickedAt", "button", "clickCount", "failureClass"],
    "Desktop browser vision action outcome",
  );
  exactData(value.clickedAt, ["x", "y"], "visual click coordinates");
  if (
    !["succeeded", "failed"].includes(value.status) ||
    !Number.isFinite(value.clickedAt.x) ||
    !Number.isFinite(value.clickedAt.y) ||
    Math.abs(value.clickedAt.x) > 10_000_000 ||
    Math.abs(value.clickedAt.y) > 10_000_000 ||
    !["left", "right", "middle"].includes(value.button) ||
    !Number.isSafeInteger(value.clickCount) ||
    value.clickCount < 1 ||
    value.clickCount > 3 ||
    (value.status === "succeeded" && value.failureClass !== null) ||
    (value.status === "failed" &&
      (typeof value.failureClass !== "string" ||
        !/^[a-z][a-z0-9-]{0,127}$/u.test(value.failureClass)))
  ) {
    throw new TypeError("Desktop browser vision action outcome is invalid");
  }
  return Object.freeze({
    status: value.status,
    clickedAt: Object.freeze({ x: value.clickedAt.x, y: value.clickedAt.y }),
    button: value.button,
    clickCount: value.clickCount,
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
    "Desktop browser vision action outcome acknowledgement",
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
      "Desktop browser vision action outcome acknowledgement is invalid",
    );
  }
  return Object.freeze({
    auditEventDigest: value.auditEventDigest,
    durabilityReceiptDigest: value.durabilityReceiptDigest,
  });
}

async function recordDesktopBrowserVisionActionOutcome(grant, value) {
  const captured = grants.get(grant);
  if (
    !captured ||
    captured.consumed !== true ||
    captured.auditStatus !== "pending"
  ) {
    const error = new Error(
      "Browser vision action outcome requires one consumed unaudited grant",
    );
    error.code = "CC_AGENT_ACTION_AUDIT_UNCERTAIN";
    throw error;
  }
  const outcome = normalizeActionOutcome(value, captured);
  const resultDigest = digest(
    "chainlesschain.browser-vision-action-result/v1",
    outcome,
  );
  const core = Object.freeze({
    schema: OUTCOME_REQUEST_SCHEMA,
    actionReceiptDigest: captured.receiptDigest,
    requestDigest: captured.requestDigest,
    targetId: captured.targetId,
    operation: captured.operation,
    inputDigest: captured.inputDigest,
    observationReceiptDigest: captured.observationReceiptDigest,
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
  } catch (cause) {
    const error = new Error(
      "Browser mutation completed but its durable action audit is uncertain",
      { cause },
    );
    error.code = "CC_AGENT_ACTION_AUDIT_UNCERTAIN";
    throw error;
  }
}

module.exports = {
  createDesktopBrowserVisionActionHost,
  authorizeDesktopBrowserVisionAction,
  assertDesktopBrowserVisionActionGrant,
  consumeDesktopBrowserVisionActionGrant,
  recordDesktopBrowserVisionActionOutcome,
};

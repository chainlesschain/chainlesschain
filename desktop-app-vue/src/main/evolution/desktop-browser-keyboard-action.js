"use strict";

const { createHash, randomUUID } = require("node:crypto");
const { types } = require("node:util");

const REQUEST_SCHEMA = "chainlesschain.browser-keyboard-action-request/v1";
const RECEIPT_SCHEMA = "chainlesschain.browser-keyboard-action-receipt/v1";
const OUTCOME_REQUEST_SCHEMA =
  "chainlesschain.browser-keyboard-action-outcome-request/v1";
const OUTCOME_ACK_SCHEMA =
  "chainlesschain.browser-keyboard-action-outcome-ack/v1";
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const NAMED_KEYS = new Set([
  "Backspace",
  "Delete",
  "End",
  "Enter",
  "Escape",
  "Home",
  "Insert",
  "PageDown",
  "PageUp",
  "Space",
  "Tab",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
]);
const MODIFIER_ORDER = ["Control", "Alt", "Shift", "Meta"];
const RESERVED_BROWSER_SHORTCUTS = new Set([
  "f5",
  "alt+arrowleft",
  "alt+arrowright",
  "alt+d",
  "alt+e",
  "alt+f",
  "alt+home",
  "alt+f4",
  "shift+escape",
  ...Array.from({ length: 9 }, (_, index) => `control+${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `meta+${index + 1}`),
  "control+f5",
  "control+d",
  "control+e",
  "control+f",
  "control+g",
  "control+h",
  "control+j",
  "control+k",
  "control+l",
  "control+n",
  "control+o",
  "control+p",
  "control+r",
  "control+s",
  "control+t",
  "control+u",
  "control+w",
  "control+tab",
  "control+pagedown",
  "control+pageup",
  "control+shift+a",
  "control+shift+b",
  "control+shift+delete",
  "control+shift+escape",
  "control+shift+g",
  "control+shift+i",
  "control+shift+j",
  "control+shift+n",
  "control+shift+o",
  "control+shift+p",
  "control+shift+q",
  "control+shift+r",
  "control+shift+t",
  "control+shift+tab",
  "control+shift+c",
  "control+shift+w",
  "control+shift+pagedown",
  "control+shift+pageup",
  "meta+d",
  "meta+e",
  "meta+f",
  "meta+g",
  "meta+h",
  "meta+l",
  "meta+n",
  "meta+o",
  "meta+p",
  "meta+q",
  "meta+r",
  "meta+s",
  "meta+t",
  "meta+u",
  "meta+w",
  "meta+y",
  "meta+tab",
  "meta+pagedown",
  "meta+pageup",
  "alt+meta+i",
  "alt+shift+meta+i",
  "shift+meta+a",
  "shift+meta+b",
  "shift+meta+g",
  "shift+meta+h",
  "shift+meta+j",
  "shift+meta+t",
  "shift+meta+n",
  "shift+meta+o",
  "shift+meta+p",
  "shift+meta+q",
  "shift+meta+w",
]);
const OPTION_KEYS = new Set([
  "key",
  "modifiers",
  "delay",
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

function normalizeOptions(options) {
  if (
    !options ||
    typeof options !== "object" ||
    Array.isArray(options) ||
    types.isProxy(options) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(options))
  )
    throw new TypeError("Desktop browser keyboard action input is invalid");
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
    throw new TypeError("Desktop browser keyboard action input is invalid");
  const key = options.key;
  if (
    typeof key !== "string" ||
    !(/^[A-Za-z0-9]$/u.test(key) || NAMED_KEYS.has(key))
  )
    throw new TypeError("Desktop browser keyboard action key is invalid");
  const inputModifiers = options.modifiers ?? [];
  if (
    !Array.isArray(inputModifiers) ||
    types.isProxy(inputModifiers) ||
    inputModifiers.length > 4
  )
    throw new TypeError("Desktop browser keyboard modifiers are invalid");
  const unique = new Set(inputModifiers);
  if (
    unique.size !== inputModifiers.length ||
    inputModifiers.some((entry) => !MODIFIER_ORDER.includes(entry))
  )
    throw new TypeError("Desktop browser keyboard modifiers are invalid");
  const delay = options.delay ?? 0;
  if (!Number.isSafeInteger(delay) || delay < 0 || delay > 5000)
    throw new TypeError("Desktop browser keyboard delay is invalid");
  const normalizedModifiers = MODIFIER_ORDER.filter((modifier) =>
    unique.has(modifier),
  );
  const shortcut = [...normalizedModifiers, key].join("+").toLowerCase();
  if (RESERVED_BROWSER_SHORTCUTS.has(shortcut))
    throw new TypeError(
      "Desktop browser keyboard action must use its dedicated contract",
    );
  return Object.freeze({
    key,
    modifiers: Object.freeze(normalizedModifiers),
    delay,
  });
}

function inputCore(targetId, options) {
  if (
    typeof targetId !== "string" ||
    targetId.length < 1 ||
    targetId.length > 512
  )
    throw new TypeError("Desktop browser keyboard target is invalid");
  return Object.freeze({
    targetId,
    operation: "key-press",
    ...normalizeOptions(options),
  });
}

function inputDigest(core) {
  return digest("chainlesschain.browser-keyboard-action-input/v1", core);
}

function createDesktopBrowserKeyboardActionHost(authority, captureAuthority) {
  if (typeof captureAuthority !== "function" || types.isProxy(captureAuthority))
    throw new TypeError("Browser keyboard authority capture is invalid");
  const captured = Reflect.apply(captureAuthority, undefined, [authority]);
  if (!captured || typeof captured !== "object" || types.isProxy(captured))
    throw new TypeError("Browser keyboard authority port is invalid");
  const descriptor = ownData(
    captured,
    "descriptor",
    "browser keyboard authority descriptor",
  );
  if (
    !descriptor ||
    typeof descriptor !== "object" ||
    types.isProxy(descriptor) ||
    ownData(descriptor, "approvalMode", "keyboard approval mode") !==
      "interactive" ||
    ownData(descriptor, "auditMode", "keyboard audit mode") !==
      "authenticated-durable-readback"
  )
    throw new TypeError("Browser keyboard authority descriptor is invalid");
  const host = Object.freeze({});
  hosts.set(host, {
    descriptor,
    authorizeAction: ownFunction(
      captured,
      "authorizeAction",
      "browser keyboard authorize port",
    ),
    recordActionOutcome: ownFunction(
      captured,
      "recordActionOutcome",
      "browser keyboard outcome port",
    ),
  });
  return host;
}

async function authorizeDesktopBrowserKeyboardAction(
  host,
  { targetId, options = {}, senderId, frameUrl, authorization = null } = {},
) {
  const captured = hosts.get(host);
  if (!captured)
    throw new TypeError("A branded Desktop browser keyboard host is required");
  if (!Number.isSafeInteger(senderId) || senderId < 1)
    throw new TypeError("Browser keyboard sender is invalid");
  if (typeof frameUrl !== "string" || frameUrl.length > 16 * 1024)
    throw new TypeError("Browser keyboard frame URL is invalid");
  const core = inputCore(targetId, options);
  const optionAuthorization = Object.hasOwn(options, "actionAuthorization")
    ? ownData(
        options,
        "actionAuthorization",
        "browser keyboard action authorization",
      )
    : undefined;
  if (
    optionAuthorization !== undefined &&
    authorization !== null &&
    optionAuthorization !== authorization
  )
    throw new TypeError("Browser keyboard action authorization differs");
  const request = Object.freeze({
    schema: REQUEST_SCHEMA,
    requestId: randomUUID(),
    targetId,
    operation: core.operation,
    senderId,
    frameUrlDigest: digest(
      "chainlesschain.browser-keyboard-action-frame-url/v1",
      frameUrl,
    ),
    key: core.key,
    modifiers: core.modifiers,
    delay: core.delay,
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
    targetId: request.targetId,
    operation: request.operation,
    senderId: request.senderId,
    frameUrlDigest: request.frameUrlDigest,
    keyDigest: digest("chainlesschain.browser-keyboard-action-key/v1", {
      key: request.key,
      modifiers: request.modifiers,
    }),
    delay: request.delay,
    inputDigest: request.inputDigest,
  };
  for (const [name, value] of Object.entries(expected)) {
    if (ownData(receipt, name, `browser keyboard receipt ${name}`) !== value)
      throw new Error(`Browser keyboard receipt ${name} mismatch`);
  }
  const validUntil = ownData(
    receipt,
    "validUntil",
    "browser keyboard receipt validUntil",
  );
  const receiptDigest = ownData(
    receipt,
    "receiptDigest",
    "browser keyboard receipt digest",
  );
  const requestDigest = ownData(
    receipt,
    "requestDigest",
    "browser keyboard receipt request digest",
  );
  if (
    !Number.isFinite(Date.parse(validUntil)) ||
    !DIGEST.test(receiptDigest) ||
    !DIGEST.test(requestDigest)
  )
    throw new TypeError("Browser keyboard receipt is incomplete");
  const grant = Object.freeze({});
  grants.set(grant, {
    targetId,
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

function consumeDesktopBrowserKeyboardActionGrant(
  grant,
  targetId,
  options = {},
) {
  const captured = grants.get(grant);
  const core = inputCore(targetId, options);
  if (
    !captured ||
    captured.consumed ||
    captured.targetId !== targetId ||
    captured.inputDigest !== inputDigest(core) ||
    Date.parse(captured.validUntil) <= Date.now()
  ) {
    const error = new Error(
      "Browser keyboard action requires a fresh bound interactive grant",
    );
    error.code = "CC_AGENT_EVOLUTION_INGRESS_FAILED";
    throw error;
  }
  captured.consumed = true;
  return Object.freeze({
    receiptDigest: captured.receiptDigest,
    key: core.key,
    modifiers: core.modifiers,
    delay: core.delay,
  });
}

async function recordDesktopBrowserKeyboardActionOutcome(grant, value) {
  const captured = grants.get(grant);
  if (
    !captured ||
    captured.consumed !== true ||
    captured.auditStatus !== "pending"
  ) {
    const error = new Error(
      "Browser keyboard outcome requires one consumed unaudited grant",
    );
    error.code = "CC_AGENT_ACTION_AUDIT_UNCERTAIN";
    throw error;
  }
  exact(value, ["status", "failureClass"], "Desktop browser keyboard outcome");
  if (
    !["succeeded", "failed"].includes(value.status) ||
    (value.status === "succeeded" && value.failureClass !== null) ||
    (value.status === "failed" &&
      (typeof value.failureClass !== "string" ||
        !/^[a-z][a-z0-9-]{0,127}$/u.test(value.failureClass)))
  )
    throw new TypeError("Desktop browser keyboard outcome is invalid");
  const resultDigest = digest(
    "chainlesschain.browser-keyboard-action-result/v1",
    value,
  );
  const core = Object.freeze({
    schema: OUTCOME_REQUEST_SCHEMA,
    actionReceiptDigest: captured.receiptDigest,
    requestDigest: captured.requestDigest,
    targetId: captured.targetId,
    operation: "key-press",
    inputDigest: captured.inputDigest,
    status: value.status,
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
      "Desktop browser keyboard outcome acknowledgement",
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
      throw new Error("Browser keyboard outcome acknowledgement is invalid");
    captured.auditStatus = "recorded";
    return Object.freeze({
      auditEventDigest: acknowledgement.auditEventDigest,
      durabilityReceiptDigest: acknowledgement.durabilityReceiptDigest,
    });
  } catch (error) {
    const uncertain = new Error(
      "Browser keyboard action occurred but durable audit is uncertain",
      { cause: error },
    );
    uncertain.code = "CC_AGENT_ACTION_AUDIT_UNCERTAIN";
    throw uncertain;
  }
}

module.exports = {
  authorizeDesktopBrowserKeyboardAction,
  consumeDesktopBrowserKeyboardActionGrant,
  createDesktopBrowserKeyboardActionHost,
  recordDesktopBrowserKeyboardActionOutcome,
};

import { createHash } from "node:crypto";
import { types } from "node:util";

export const BROWSER_KEYBOARD_ACTION_AUTHORITY_DESCRIPTOR_SCHEMA =
  "chainlesschain.browser-keyboard-action-authority-descriptor/v1";
export const BROWSER_KEYBOARD_ACTION_REQUEST_SCHEMA =
  "chainlesschain.browser-keyboard-action-request/v1";
export const BROWSER_KEYBOARD_ACTION_RECEIPT_SCHEMA =
  "chainlesschain.browser-keyboard-action-receipt/v1";
export const BROWSER_KEYBOARD_ACTION_OUTCOME_REQUEST_SCHEMA =
  "chainlesschain.browser-keyboard-action-outcome-request/v1";
export const BROWSER_KEYBOARD_ACTION_OUTCOME_ACK_SCHEMA =
  "chainlesschain.browser-keyboard-action-outcome-ack/v1";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9._:-]{1,128}$/u;
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
  ) {
    throw new TypeError(`${label} has an invalid shape`);
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

function key(value) {
  if (
    typeof value !== "string" ||
    !(/^[A-Za-z0-9]$/u.test(value) || NAMED_KEYS.has(value))
  )
    throw new TypeError("browser keyboard action key is invalid");
  return value;
}

function modifiers(value) {
  if (!Array.isArray(value) || types.isProxy(value) || value.length > 4)
    throw new TypeError("browser keyboard action modifiers are invalid");
  const unique = new Set(value);
  if (
    unique.size !== value.length ||
    value.some((entry) => !MODIFIER_ORDER.includes(entry))
  )
    throw new TypeError("browser keyboard action modifiers are invalid");
  return Object.freeze(
    MODIFIER_ORDER.filter((modifier) => unique.has(modifier)),
  );
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
    "browser keyboard action authority descriptor",
  );
  if (
    value.schema !== BROWSER_KEYBOARD_ACTION_AUTHORITY_DESCRIPTOR_SCHEMA ||
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
    throw new TypeError("browser keyboard action descriptor is invalid");
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
      "key",
      "modifiers",
      "delay",
      "inputDigest",
      "authorization",
      "requestedAt",
    ],
    "browser keyboard action request",
  );
  const normalizedKey = key(value.key);
  const normalizedModifiers = modifiers(value.modifiers);
  const shortcut = [...normalizedModifiers, normalizedKey]
    .join("+")
    .toLowerCase();
  if (RESERVED_BROWSER_SHORTCUTS.has(shortcut))
    throw new TypeError(
      "browser keyboard action must not bypass a dedicated browser contract",
    );
  const inputCore = Object.freeze({
    targetId: value.targetId,
    operation: value.operation,
    key: normalizedKey,
    modifiers: normalizedModifiers,
    delay: value.delay,
  });
  if (
    value.schema !== BROWSER_KEYBOARD_ACTION_REQUEST_SCHEMA ||
    !ID.test(value.requestId) ||
    typeof value.targetId !== "string" ||
    value.targetId.length < 1 ||
    value.targetId.length > 512 ||
    value.operation !== "key-press" ||
    !Number.isSafeInteger(value.senderId) ||
    value.senderId < 1 ||
    !DIGEST.test(value.frameUrlDigest) ||
    !Number.isSafeInteger(value.delay) ||
    value.delay < 0 ||
    value.delay > 5000 ||
    value.inputDigest !==
      digest("chainlesschain.browser-keyboard-action-input/v1", inputCore) ||
    !Number.isFinite(Date.parse(value.requestedAt))
  )
    throw new TypeError("browser keyboard action request is invalid");
  return Object.freeze({
    ...value,
    key: normalizedKey,
    modifiers: normalizedModifiers,
    authorization: snapshotJson(
      value.authorization,
      "browser keyboard action authorization",
    ),
    inputCore,
  });
}

function normalizeDecision(value) {
  if (!value || typeof value !== "object" || types.isProxy(value))
    throw new TypeError("browser keyboard action decision is invalid");
  if (value.decision === "deny") {
    exact(
      value,
      Object.hasOwn(value, "reason") ? ["decision", "reason"] : ["decision"],
      "browser keyboard action decision",
    );
    if (
      value.reason !== undefined &&
      (typeof value.reason !== "string" || value.reason.length > 512)
    )
      throw new TypeError("browser keyboard action denial reason is invalid");
    return Object.freeze({ decision: "deny", reason: value.reason ?? null });
  }
  exact(
    value,
    ["decision", "approvalEvidenceRef", "validUntil"],
    "browser keyboard action decision",
  );
  if (value.decision !== "allow")
    throw new TypeError("browser keyboard action decision is invalid");
  return Object.freeze({ ...value });
}

function requestEvidence(request) {
  const core = {
    schema: request.schema,
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
    authorizationDigest: digest(
      "chainlesschain.browser-keyboard-action-authorization/v1",
      request.authorization,
    ),
    requestedAt: request.requestedAt,
  };
  return Object.freeze({
    ...core,
    requestDigest: digest(BROWSER_KEYBOARD_ACTION_REQUEST_SCHEMA, core),
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
    "browser keyboard action outcome request",
  );
  if (
    value.schema !== BROWSER_KEYBOARD_ACTION_OUTCOME_REQUEST_SCHEMA ||
    !DIGEST.test(value.actionReceiptDigest) ||
    !DIGEST.test(value.requestDigest) ||
    typeof value.targetId !== "string" ||
    value.targetId.length < 1 ||
    value.targetId.length > 512 ||
    value.operation !== "key-press" ||
    !DIGEST.test(value.inputDigest) ||
    !["succeeded", "failed"].includes(value.status) ||
    !DIGEST.test(value.resultDigest) ||
    !Number.isFinite(Date.parse(value.recordedAt))
  )
    throw new TypeError("browser keyboard action outcome is invalid");
  const core = Object.freeze({ ...value });
  return Object.freeze({
    ...core,
    outcomeRequestDigest: digest(
      BROWSER_KEYBOARD_ACTION_OUTCOME_REQUEST_SCHEMA,
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
    "browser keyboard action outcome acknowledgement",
  );
  if (
    value.schema !== BROWSER_KEYBOARD_ACTION_OUTCOME_ACK_SCHEMA ||
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
    throw new Error("browser keyboard action acknowledgement is invalid");
  return Object.freeze({ ...value });
}

export function createBrowserKeyboardActionAuthority({
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
    throw new TypeError("browser keyboard action authority ports are invalid");
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

export function captureBrowserKeyboardActionAuthority(value) {
  const captured = authorities.get(value);
  if (!captured)
    throw new TypeError(
      "A branded browser keyboard action authority is required",
    );
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
          decision.reason ?? "Browser keyboard action was denied",
        );
        error.code = "BROWSER_KEYBOARD_ACTION_DENIED";
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
        throw new Error("Browser keyboard action decision is invalid");
      const core = {
        schema: BROWSER_KEYBOARD_ACTION_RECEIPT_SCHEMA,
        authorityId: captured.descriptor.authorityId,
        tenantId: captured.descriptor.tenantId,
        policyRevision: captured.descriptor.policyRevision,
        handlerArtifactDigest: captured.descriptor.handlerArtifactDigest,
        approvalMode: captured.descriptor.approvalMode,
        requestId: request.requestId,
        targetId: request.targetId,
        operation: request.operation,
        senderId: request.senderId,
        frameUrlDigest: request.frameUrlDigest,
        keyDigest: evidence.keyDigest,
        delay: request.delay,
        inputDigest: request.inputDigest,
        authorizationDigest: evidence.authorizationDigest,
        requestDigest: evidence.requestDigest,
        approvalEvidenceRef: decision.approvalEvidenceRef,
        authorizedAt: new Date(nowMs).toISOString(),
        validUntil: new Date(validUntilMs).toISOString(),
      };
      const receipt = Object.freeze({
        ...core,
        receiptDigest: digest(BROWSER_KEYBOARD_ACTION_RECEIPT_SCHEMA, core),
      });
      captured.issued.set(receipt.receiptDigest, {
        requestDigest: receipt.requestDigest,
        targetId: receipt.targetId,
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
        issued.targetId !== request.targetId ||
        issued.operation !== request.operation ||
        issued.inputDigest !== request.inputDigest ||
        (issued.outcomeRequestDigest !== null &&
          issued.outcomeRequestDigest !== request.outcomeRequestDigest)
      )
        throw new Error(
          "browser keyboard action outcome differs from authorization",
        );
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

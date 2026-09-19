"use strict";

const { createHash, randomUUID } = require("node:crypto");
const { types } = require("node:util");

const REQUEST_SCHEMA = "chainlesschain.browser-vision-observation-request/v1";
const RECEIPT_SCHEMA = "chainlesschain.browser-vision-observation-receipt/v1";
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const READ_OPERATIONS = new Set([
  "analyze",
  "locate",
  "compare",
  "describe",
  "ocr",
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

function normalizeNullableText(value, maxLength, label) {
  if (value == null) return null;
  if (typeof value !== "string" || value.length > maxLength)
    throw new TypeError(`${label} is invalid`);
  return value;
}

function optionData(options, name) {
  const descriptor = Object.getOwnPropertyDescriptor(options, name);
  if (!descriptor) return undefined;
  if (!("value" in descriptor))
    throw new TypeError(`Desktop browser vision ${name} must be plain data`);
  return descriptor.value;
}

function normalizeOptionalNumber(value, label, { integer = false } = {}) {
  if (value == null) return null;
  if (!Number.isFinite(value) || (integer && !Number.isSafeInteger(value)))
    throw new TypeError(`${label} is invalid`);
  return value;
}

function normalizeClip(value) {
  if (value == null) return null;
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    types.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).sort().join("\0") !==
      ["height", "width", "x", "y"].sort().join("\0")
  ) {
    throw new TypeError("Desktop browser vision clip is invalid");
  }
  const normalized = {};
  for (const name of ["x", "y", "width", "height"]) {
    const field = Object.getOwnPropertyDescriptor(value, name);
    if (
      !field?.enumerable ||
      !("value" in field) ||
      !Number.isFinite(field.value)
    )
      throw new TypeError("Desktop browser vision clip is invalid");
    normalized[name] = field.value;
  }
  if (
    normalized.x < 0 ||
    normalized.y < 0 ||
    normalized.width <= 0 ||
    normalized.height <= 0 ||
    Object.values(normalized).some((entry) => entry > 1_000_000)
  ) {
    throw new TypeError("Desktop browser vision clip is invalid");
  }
  return Object.freeze(normalized);
}

function inputCore(targetId, operation, options = {}) {
  if (
    typeof targetId !== "string" ||
    targetId.length < 1 ||
    targetId.length > 512 ||
    !READ_OPERATIONS.has(operation) ||
    !options ||
    typeof options !== "object" ||
    Array.isArray(options) ||
    types.isProxy(options) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(options))
  ) {
    throw new TypeError("Desktop browser vision observation input is invalid");
  }
  const model = optionData(options, "model");
  if (model !== undefined)
    throw new TypeError("Desktop browser vision cannot override its model");
  const baseline =
    optionData(options, "baseline") ??
    optionData(options, "baselineBase64") ??
    null;
  if (baseline !== null && typeof baseline !== "string")
    throw new TypeError("Desktop browser vision baseline is invalid");
  const clip = normalizeClip(optionData(options, "clip"));
  const maxTokens = normalizeOptionalNumber(
    optionData(options, "maxTokens"),
    "maxTokens",
    { integer: true },
  );
  const temperature = normalizeOptionalNumber(
    optionData(options, "temperature"),
    "temperature",
  );
  const quality = normalizeOptionalNumber(
    optionData(options, "quality"),
    "quality",
    { integer: true },
  );
  const fullPage = optionData(options, "fullPage");
  const detail = normalizeNullableText(
    optionData(options, "detail"),
    16,
    "detail",
  );
  if (
    (maxTokens !== null && (maxTokens < 1 || maxTokens > 4096)) ||
    (temperature !== null && (temperature < 0 || temperature > 1)) ||
    (quality !== null && (quality < 1 || quality > 100)) ||
    (fullPage !== undefined && typeof fullPage !== "boolean") ||
    (detail !== null && !["auto", "low", "high"].includes(detail))
  ) {
    throw new TypeError(
      "Desktop browser vision observation options are invalid",
    );
  }
  const core = {
    targetId,
    operation,
    prompt: normalizeNullableText(
      optionData(options, "prompt"),
      16 * 1024,
      "prompt",
    ),
    description: normalizeNullableText(
      optionData(options, "description"),
      4096,
      "description",
    ),
    baselineDigest:
      baseline === null
        ? null
        : digest(
            "chainlesschain.browser-vision-observation-baseline/v1",
            baseline,
          ),
    maxTokens,
    temperature,
    quality,
    fullPage: fullPage == null ? null : fullPage,
    detail,
    clipDigest:
      clip === null
        ? null
        : digest("chainlesschain.browser-vision-observation-clip/v1", clip),
  };
  if (Buffer.byteLength(canonical(core), "utf8") > 32 * 1024)
    throw new TypeError(
      "Desktop browser vision observation input is too large",
    );
  return Object.freeze(core);
}

function inputDigest(core) {
  return digest("chainlesschain.browser-vision-observation-input/v1", core);
}

function validateReceipt(receipt, request, authorityDescriptor) {
  if (!receipt || typeof receipt !== "object" || types.isProxy(receipt))
    throw new TypeError("Browser vision observation receipt is invalid");
  for (const [name, expected] of Object.entries({
    schema: RECEIPT_SCHEMA,
    authorityId: authorityDescriptor.authorityId,
    tenantId: authorityDescriptor.tenantId,
    handlerArtifactDigest: authorityDescriptor.handlerArtifactDigest,
    requestId: request.requestId,
    targetId: request.targetId,
    operation: request.operation,
    senderId: request.senderId,
    frameUrlDigest: request.frameUrlDigest,
    inputDigest: request.inputDigest,
  })) {
    if (ownData(receipt, name, `browser vision receipt ${name}`) !== expected)
      throw new Error(`Browser vision observation receipt ${name} mismatch`);
  }
  const validUntil = ownData(
    receipt,
    "validUntil",
    "browser vision receipt validUntil",
  );
  const receiptDigest = ownData(
    receipt,
    "receiptDigest",
    "browser vision receipt digest",
  );
  if (!Number.isFinite(Date.parse(validUntil)) || !DIGEST.test(receiptDigest))
    throw new TypeError("Browser vision observation receipt is incomplete");
  return Object.freeze({ validUntil, receiptDigest });
}

function createDesktopBrowserVisionObservationHost(
  authority,
  captureAuthority,
) {
  if (typeof captureAuthority !== "function" || types.isProxy(captureAuthority))
    throw new TypeError(
      "Browser vision observation authority capture is invalid",
    );
  const captured = Reflect.apply(captureAuthority, undefined, [authority]);
  if (!captured || typeof captured !== "object" || types.isProxy(captured))
    throw new TypeError("Browser vision observation authority port is invalid");
  const descriptor = ownData(
    captured,
    "descriptor",
    "browser vision observation authority descriptor",
  );
  if (
    !descriptor ||
    typeof descriptor !== "object" ||
    types.isProxy(descriptor)
  )
    throw new TypeError(
      "Browser vision observation authority descriptor is invalid",
    );
  const authorizeObservation = ownFunction(
    captured,
    "authorizeObservation",
    "browser vision observation authorize port",
  );
  const host = Object.freeze({});
  hosts.set(host, { descriptor, authorizeObservation });
  return host;
}

async function authorizeDesktopBrowserVisionObservation(
  host,
  {
    targetId,
    operation,
    options = {},
    senderId,
    frameUrl,
    authorization = null,
  } = {},
) {
  const captured = hosts.get(host);
  if (!captured)
    throw new TypeError(
      "A branded Desktop browser vision observation host is required",
    );
  if (!Number.isSafeInteger(senderId) || senderId < 1)
    throw new TypeError("Browser vision observation sender is invalid");
  if (typeof frameUrl !== "string" || frameUrl.length > 16 * 1024)
    throw new TypeError("Browser vision observation frame URL is invalid");
  const core = inputCore(targetId, operation, options);
  const request = Object.freeze({
    schema: REQUEST_SCHEMA,
    requestId: randomUUID(),
    targetId,
    operation,
    senderId,
    frameUrlDigest: digest(
      "chainlesschain.browser-vision-observation-frame-url/v1",
      frameUrl,
    ),
    inputDigest: inputDigest(core),
    authorization,
    requestedAt: new Date().toISOString(),
  });
  const receipt = await Reflect.apply(
    captured.authorizeObservation,
    undefined,
    [request],
  );
  const validated = validateReceipt(receipt, request, captured.descriptor);
  const grant = Object.freeze({});
  grants.set(grant, {
    targetId,
    operation,
    inputDigest: request.inputDigest,
    validUntil: validated.validUntil,
    receiptDigest: validated.receiptDigest,
    consumed: false,
  });
  return grant;
}

function consumeDesktopBrowserVisionObservationGrant(
  grant,
  targetId,
  operation,
  options = {},
) {
  const captured = grants.get(grant);
  const core = inputCore(targetId, operation, options);
  if (
    !captured ||
    captured.consumed ||
    captured.targetId !== targetId ||
    captured.operation !== operation ||
    captured.inputDigest !== inputDigest(core) ||
    Date.parse(captured.validUntil) <= Date.now()
  ) {
    const error = new Error(
      "Browser screenshot requires a fresh bound observation grant",
    );
    error.code = "CC_AGENT_EVOLUTION_INGRESS_FAILED";
    throw error;
  }
  captured.consumed = true;
  return Object.freeze({ receiptDigest: captured.receiptDigest });
}

function captureDesktopBrowserVisionObservationGrant(
  grant,
  targetId,
  operation,
  options = {},
  expectedConsumed = false,
) {
  const captured = grants.get(grant);
  const core = inputCore(targetId, operation, options);
  if (
    !captured ||
    captured.consumed !== expectedConsumed ||
    captured.targetId !== targetId ||
    captured.operation !== operation ||
    captured.inputDigest !== inputDigest(core) ||
    Date.parse(captured.validUntil) <= Date.now()
  ) {
    const error = new Error(
      "A fresh bound browser vision observation grant is required",
    );
    error.code = "CC_AGENT_EVOLUTION_INGRESS_FAILED";
    throw error;
  }
  return Object.freeze({ receiptDigest: captured.receiptDigest });
}

module.exports = {
  createDesktopBrowserVisionObservationHost,
  authorizeDesktopBrowserVisionObservation,
  consumeDesktopBrowserVisionObservationGrant,
  captureDesktopBrowserVisionObservationGrant,
};

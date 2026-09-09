import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";

import {
  EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_RECEIPT_SCHEMA,
  EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_RESOLUTION_SCHEMA,
  captureImmutableLedgerSegmentStorePort,
} from "./evolution-immutable-ledger-segment-store.js";

export const EVOLUTION_LEDGER_MANIFEST_CHAIN_SCHEMA =
  "chainlesschain.evolution-ledger-manifest-chain/v2";
export const EVOLUTION_LEDGER_SEGMENT_PAYLOAD_SCHEMA =
  "chainlesschain.evolution-ledger-segment-payload/v2";
export const EVOLUTION_LEDGER_SEGMENT_MANIFEST_SCHEMA =
  "chainlesschain.evolution-ledger-segment-manifest/v2";
export const EVOLUTION_LEDGER_MANIFEST_HEAD_SCHEMA =
  "chainlesschain.evolution-ledger-manifest-head/v2";

export const EVOLUTION_LEDGER_MANIFEST_INVALID_CODE =
  "CC_EVOLUTION_LEDGER_MANIFEST_INVALID";
export const EVOLUTION_LEDGER_MANIFEST_CORRUPT_CODE =
  "CC_EVOLUTION_LEDGER_MANIFEST_CORRUPT";
export const EVOLUTION_LEDGER_MANIFEST_UNAVAILABLE_CODE =
  "CC_EVOLUTION_LEDGER_MANIFEST_UNAVAILABLE";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const MAX_EVENTS_PER_SEGMENT = 1024;
const MAX_SIGNATURE_CHARS = 4096;
const AUTHORITIES = new WeakSet();

const CHAIN_DESCRIPTOR_KEYS = new Set([
  "epoch",
  "ledgerId",
  "maximumEventsPerSegment",
  "tenantId",
]);
const AUTHORITY_DESCRIPTOR_KEYS = new Set([
  "algorithm",
  "authorityId",
  "revision",
]);
const AUTHORITY_CONFIG_KEYS = new Set(["descriptor", "sign", "verify"]);
const SEAL_CONFIG_KEYS = new Set([
  "authority",
  "descriptor",
  "eventDigests",
  "minimumRetainedUntil",
  "now",
  "previousHead",
  "segmentStore",
]);
const VERIFY_CONFIG_KEYS = new Set([
  "authority",
  "descriptor",
  "head",
  "manifests",
  "segmentStore",
]);
const PAYLOAD_KEYS = new Set([
  "eventDigests",
  "schema",
  "sequenceEnd",
  "sequenceStart",
]);
const MANIFEST_KEYS = new Set([
  "authorityAlgorithm",
  "authorityId",
  "authorityRevision",
  "contentDigest",
  "epoch",
  "eventDigestRoot",
  "eventDigests",
  "issuedAt",
  "ledgerId",
  "manifestDigest",
  "manifestSequence",
  "previousManifestDigest",
  "retainedUntil",
  "schema",
  "segmentRef",
  "sequenceEnd",
  "sequenceStart",
  "signature",
  "storageVersion",
  "tenantId",
]);
const HEAD_KEYS = new Set([
  "authorityAlgorithm",
  "authorityId",
  "authorityRevision",
  "epoch",
  "eventDigest",
  "headDigest",
  "issuedAt",
  "ledgerId",
  "manifestDigest",
  "manifestSequence",
  "previousHeadDigest",
  "schema",
  "sequence",
  "signature",
  "tenantId",
]);

export class EvolutionLedgerManifestError extends Error {
  constructor(code, message, options = undefined) {
    super(message, options);
    this.name = "EvolutionLedgerManifestError";
    this.code = code;
  }
}

function failure(code, message, options = undefined) {
  return new EvolutionLedgerManifestError(code, message, options);
}

function rejectProxy(
  value,
  label,
  code = EVOLUTION_LEDGER_MANIFEST_INVALID_CODE,
) {
  if (
    (typeof value === "object" && value !== null) ||
    typeof value === "function"
  ) {
    if (utilTypes.isProxy(value))
      throw failure(code, `${label} must not be a Proxy`);
  }
}

function exactRecord(
  value,
  keys,
  label,
  code = EVOLUTION_LEDGER_MANIFEST_INVALID_CODE,
) {
  rejectProxy(value, label, code);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw failure(code, `${label} must be a record`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw failure(code, `${label} must use a plain prototype`);
  }
  const fields = Object.getOwnPropertyDescriptors(value);
  const names = Object.keys(fields);
  if (names.length !== keys.size || names.some((name) => !keys.has(name))) {
    throw failure(code, `${label} fields are invalid`);
  }
  for (const name of names) {
    if (!("value" in fields[name])) {
      throw failure(code, `${label}.${name} must be an own data property`);
    }
  }
  return fields;
}

function data(fields, name) {
  return fields[name].value;
}

function identifier(
  value,
  label,
  code = EVOLUTION_LEDGER_MANIFEST_INVALID_CODE,
) {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length < 1 ||
    value.length > 512 ||
    value.includes("\0")
  ) {
    throw failure(code, `${label} is invalid`);
  }
  return value;
}

function signatureValue(
  value,
  label,
  code = EVOLUTION_LEDGER_MANIFEST_INVALID_CODE,
) {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length < 1 ||
    value.length > MAX_SIGNATURE_CHARS ||
    value.includes("\0")
  ) {
    throw failure(code, `${label} is invalid`);
  }
  return value;
}

function digest(value, label, code = EVOLUTION_LEDGER_MANIFEST_INVALID_CODE) {
  if (!DIGEST.test(value || ""))
    throw failure(code, `${label} must be sha256-bound`);
  return value;
}

function nullableDigest(
  value,
  label,
  code = EVOLUTION_LEDGER_MANIFEST_INVALID_CODE,
) {
  return value === null ? null : digest(value, label, code);
}

function positive(value, label, code = EVOLUTION_LEDGER_MANIFEST_INVALID_CODE) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw failure(code, `${label} must be a positive safe integer`);
  }
  return value;
}

function timestamp(
  value,
  label,
  code = EVOLUTION_LEDGER_MANIFEST_INVALID_CODE,
) {
  if (typeof value !== "string")
    throw failure(code, `${label} must be an ISO instant`);
  const milliseconds = Date.parse(value);
  if (
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString() !== value
  ) {
    throw failure(code, `${label} must be a canonical ISO instant`);
  }
  return Object.freeze({ milliseconds, value });
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function synchronously(
  value,
  label,
  code = EVOLUTION_LEDGER_MANIFEST_UNAVAILABLE_CODE,
) {
  rejectProxy(value, label, code);
  if (utilTypes.isPromise(value))
    throw failure(code, `${label} must be synchronous`);
  return value;
}

function descriptor(value) {
  const fields = exactRecord(
    value,
    CHAIN_DESCRIPTOR_KEYS,
    "manifest chain descriptor",
  );
  const maximumEventsPerSegment = positive(
    data(fields, "maximumEventsPerSegment"),
    "descriptor.maximumEventsPerSegment",
  );
  if (maximumEventsPerSegment > MAX_EVENTS_PER_SEGMENT) {
    throw failure(
      EVOLUTION_LEDGER_MANIFEST_INVALID_CODE,
      `descriptor.maximumEventsPerSegment exceeds ${MAX_EVENTS_PER_SEGMENT}`,
    );
  }
  return Object.freeze({
    epoch: identifier(data(fields, "epoch"), "descriptor.epoch"),
    ledgerId: identifier(data(fields, "ledgerId"), "descriptor.ledgerId"),
    maximumEventsPerSegment,
    tenantId: identifier(data(fields, "tenantId"), "descriptor.tenantId"),
  });
}

function authorityDescriptor(value) {
  const fields = exactRecord(
    value,
    AUTHORITY_DESCRIPTOR_KEYS,
    "manifest authority descriptor",
  );
  return Object.freeze({
    algorithm: identifier(data(fields, "algorithm"), "authority.algorithm"),
    authorityId: identifier(
      data(fields, "authorityId"),
      "authority.authorityId",
    ),
    revision: positive(data(fields, "revision"), "authority.revision"),
  });
}

function normalizeDigests(
  value,
  label,
  maximum,
  code = EVOLUTION_LEDGER_MANIFEST_INVALID_CODE,
) {
  rejectProxy(value, label, code);
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum) {
    throw failure(code, `${label} length is invalid`);
  }
  if (Object.keys(value).length !== value.length) {
    throw failure(code, `${label} must not be sparse or have extra properties`);
  }
  const output = value.map((entry, index) =>
    digest(entry, `${label}[${index}]`, code),
  );
  return Object.freeze(output);
}

function payload(sequenceStart, eventDigests) {
  const sequenceEnd = sequenceStart + eventDigests.length - 1;
  return Object.freeze({
    eventDigests,
    schema: EVOLUTION_LEDGER_SEGMENT_PAYLOAD_SCHEMA,
    sequenceEnd,
    sequenceStart,
  });
}

function payloadBytes(value) {
  return Buffer.from(canonical(value), "utf8");
}

function parsePayload(bytes, expected) {
  if (!Buffer.isBuffer(bytes)) {
    throw failure(
      EVOLUTION_LEDGER_MANIFEST_CORRUPT_CODE,
      "manifest segment bytes are invalid",
    );
  }
  let raw;
  try {
    raw = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw failure(
      EVOLUTION_LEDGER_MANIFEST_CORRUPT_CODE,
      "manifest segment payload is not JSON",
    );
  }
  const fields = exactRecord(
    raw,
    PAYLOAD_KEYS,
    "manifest segment payload",
    EVOLUTION_LEDGER_MANIFEST_CORRUPT_CODE,
  );
  if (data(fields, "schema") !== EVOLUTION_LEDGER_SEGMENT_PAYLOAD_SCHEMA) {
    throw failure(
      EVOLUTION_LEDGER_MANIFEST_CORRUPT_CODE,
      "manifest segment payload schema is invalid",
    );
  }
  const eventDigests = normalizeDigests(
    data(fields, "eventDigests"),
    "manifest segment payload.eventDigests",
    MAX_EVENTS_PER_SEGMENT,
    EVOLUTION_LEDGER_MANIFEST_CORRUPT_CODE,
  );
  const sequenceStart = positive(
    data(fields, "sequenceStart"),
    "manifest segment payload.sequenceStart",
    EVOLUTION_LEDGER_MANIFEST_CORRUPT_CODE,
  );
  const sequenceEnd = positive(
    data(fields, "sequenceEnd"),
    "manifest segment payload.sequenceEnd",
    EVOLUTION_LEDGER_MANIFEST_CORRUPT_CODE,
  );
  if (sequenceEnd !== sequenceStart + eventDigests.length - 1) {
    throw failure(
      EVOLUTION_LEDGER_MANIFEST_CORRUPT_CODE,
      "manifest segment payload range is invalid",
    );
  }
  if (
    sequenceStart !== expected.sequenceStart ||
    sequenceEnd !== expected.sequenceEnd ||
    canonical(raw) !== canonical(payload(sequenceStart, eventDigests))
  ) {
    throw failure(
      EVOLUTION_LEDGER_MANIFEST_CORRUPT_CODE,
      "manifest segment payload binding differs",
    );
  }
  return Object.freeze({ eventDigests, sequenceEnd, sequenceStart });
}

function manifestCore(manifest) {
  return Object.fromEntries(
    Object.entries(manifest).filter(
      ([field]) => field !== "manifestDigest" && field !== "signature",
    ),
  );
}

function headCore(head) {
  return Object.fromEntries(
    Object.entries(head).filter(
      ([field]) => field !== "headDigest" && field !== "signature",
    ),
  );
}

function signedMessage(purpose, core) {
  return Buffer.concat([
    Buffer.from(`${purpose}\0`, "utf8"),
    Buffer.from(canonical(core), "utf8"),
  ]);
}

function captureAuthority(value) {
  if (!AUTHORITIES.has(value)) {
    throw new TypeError(
      "a branded Evolution Ledger manifest authority is required",
    );
  }
  return value;
}

function sign(authority, purpose, core, digestField) {
  const message = signedMessage(purpose, core);
  const recordDigest = sha256(message);
  let signature;
  try {
    signature = synchronously(
      authority.sign({
        authority: authority.descriptor,
        digest: recordDigest,
        message: Buffer.from(message),
        purpose,
      }),
      `${purpose} signing result`,
    );
  } catch (cause) {
    if (cause instanceof EvolutionLedgerManifestError) throw cause;
    throw failure(
      EVOLUTION_LEDGER_MANIFEST_UNAVAILABLE_CODE,
      `${purpose} signer failed`,
      { cause },
    );
  }
  signature = signatureValue(
    signature,
    `${purpose} signature`,
    EVOLUTION_LEDGER_MANIFEST_UNAVAILABLE_CODE,
  );
  const record = Object.freeze({
    ...core,
    [digestField]: recordDigest,
    signature,
  });
  verify(authority, purpose, record, digestField);
  return record;
}

function verify(authority, purpose, record, digestField) {
  const core =
    digestField === "manifestDigest" ? manifestCore(record) : headCore(record);
  const message = signedMessage(purpose, core);
  const recordDigest = sha256(message);
  if (record[digestField] !== recordDigest) {
    throw failure(
      EVOLUTION_LEDGER_MANIFEST_CORRUPT_CODE,
      `${purpose} digest is invalid`,
    );
  }
  let valid;
  try {
    valid = synchronously(
      authority.verify({
        authority: authority.descriptor,
        digest: recordDigest,
        message: Buffer.from(message),
        purpose,
        signature: record.signature,
      }),
      `${purpose} verification result`,
    );
  } catch (cause) {
    if (cause instanceof EvolutionLedgerManifestError) throw cause;
    throw failure(
      EVOLUTION_LEDGER_MANIFEST_UNAVAILABLE_CODE,
      `${purpose} verifier failed`,
      { cause },
    );
  }
  if (valid !== true) {
    throw failure(
      EVOLUTION_LEDGER_MANIFEST_CORRUPT_CODE,
      `${purpose} signature was rejected`,
    );
  }
}

function normalizeManifest(
  value,
  descriptorValue,
  authority,
  code = EVOLUTION_LEDGER_MANIFEST_CORRUPT_CODE,
) {
  const fields = exactRecord(value, MANIFEST_KEYS, "segment manifest", code);
  if (data(fields, "schema") !== EVOLUTION_LEDGER_SEGMENT_MANIFEST_SCHEMA) {
    throw failure(code, "segment manifest schema is invalid");
  }
  const eventDigests = normalizeDigests(
    data(fields, "eventDigests"),
    "manifest.eventDigests",
    descriptorValue.maximumEventsPerSegment,
    code,
  );
  const sequenceStart = positive(
    data(fields, "sequenceStart"),
    "manifest.sequenceStart",
    code,
  );
  const sequenceEnd = positive(
    data(fields, "sequenceEnd"),
    "manifest.sequenceEnd",
    code,
  );
  const issuedAt = timestamp(
    data(fields, "issuedAt"),
    "manifest.issuedAt",
    code,
  );
  const retainedUntil = timestamp(
    data(fields, "retainedUntil"),
    "manifest.retainedUntil",
    code,
  );
  const normalized = Object.freeze({
    authorityAlgorithm: identifier(
      data(fields, "authorityAlgorithm"),
      "manifest.authorityAlgorithm",
      code,
    ),
    authorityId: identifier(
      data(fields, "authorityId"),
      "manifest.authorityId",
      code,
    ),
    authorityRevision: positive(
      data(fields, "authorityRevision"),
      "manifest.authorityRevision",
      code,
    ),
    contentDigest: digest(
      data(fields, "contentDigest"),
      "manifest.contentDigest",
      code,
    ),
    epoch: identifier(data(fields, "epoch"), "manifest.epoch", code),
    eventDigestRoot: digest(
      data(fields, "eventDigestRoot"),
      "manifest.eventDigestRoot",
      code,
    ),
    eventDigests,
    issuedAt: issuedAt.value,
    ledgerId: identifier(data(fields, "ledgerId"), "manifest.ledgerId", code),
    manifestDigest: digest(
      data(fields, "manifestDigest"),
      "manifest.manifestDigest",
      code,
    ),
    manifestSequence: positive(
      data(fields, "manifestSequence"),
      "manifest.manifestSequence",
      code,
    ),
    previousManifestDigest: nullableDigest(
      data(fields, "previousManifestDigest"),
      "manifest.previousManifestDigest",
      code,
    ),
    retainedUntil: retainedUntil.value,
    schema: EVOLUTION_LEDGER_SEGMENT_MANIFEST_SCHEMA,
    segmentRef: digest(data(fields, "segmentRef"), "manifest.segmentRef", code),
    sequenceEnd,
    sequenceStart,
    signature: signatureValue(
      data(fields, "signature"),
      "manifest.signature",
      code,
    ),
    storageVersion: identifier(
      data(fields, "storageVersion"),
      "manifest.storageVersion",
      code,
    ),
    tenantId: identifier(data(fields, "tenantId"), "manifest.tenantId", code),
  });
  if (
    normalized.sequenceEnd !==
    normalized.sequenceStart + eventDigests.length - 1
  ) {
    throw failure(code, "segment manifest range does not cover its events");
  }
  if (normalized.segmentRef !== normalized.contentDigest) {
    throw failure(code, "segment manifest reference is not content-addressed");
  }
  if (
    normalized.eventDigestRoot !==
    sha256(Buffer.from(canonical(eventDigests), "utf8"))
  ) {
    throw failure(code, "segment manifest event digest root is invalid");
  }
  if (retainedUntil.milliseconds <= issuedAt.milliseconds) {
    throw failure(code, "segment manifest retention is invalid");
  }
  for (const [field, expected] of Object.entries({
    authorityAlgorithm: authority.descriptor.algorithm,
    authorityId: authority.descriptor.authorityId,
    authorityRevision: authority.descriptor.revision,
    epoch: descriptorValue.epoch,
    ledgerId: descriptorValue.ledgerId,
    tenantId: descriptorValue.tenantId,
  })) {
    if (normalized[field] !== expected)
      throw failure(code, `segment manifest ${field} binding differs`);
  }
  verify(authority, "ledger-segment-manifest", normalized, "manifestDigest");
  return normalized;
}

function normalizeHead(
  value,
  descriptorValue,
  authority,
  code = EVOLUTION_LEDGER_MANIFEST_CORRUPT_CODE,
) {
  const fields = exactRecord(value, HEAD_KEYS, "manifest head", code);
  if (data(fields, "schema") !== EVOLUTION_LEDGER_MANIFEST_HEAD_SCHEMA) {
    throw failure(code, "manifest head schema is invalid");
  }
  const normalized = Object.freeze({
    authorityAlgorithm: identifier(
      data(fields, "authorityAlgorithm"),
      "head.authorityAlgorithm",
      code,
    ),
    authorityId: identifier(
      data(fields, "authorityId"),
      "head.authorityId",
      code,
    ),
    authorityRevision: positive(
      data(fields, "authorityRevision"),
      "head.authorityRevision",
      code,
    ),
    epoch: identifier(data(fields, "epoch"), "head.epoch", code),
    eventDigest: digest(data(fields, "eventDigest"), "head.eventDigest", code),
    headDigest: digest(data(fields, "headDigest"), "head.headDigest", code),
    issuedAt: timestamp(data(fields, "issuedAt"), "head.issuedAt", code).value,
    ledgerId: identifier(data(fields, "ledgerId"), "head.ledgerId", code),
    manifestDigest: digest(
      data(fields, "manifestDigest"),
      "head.manifestDigest",
      code,
    ),
    manifestSequence: positive(
      data(fields, "manifestSequence"),
      "head.manifestSequence",
      code,
    ),
    previousHeadDigest: nullableDigest(
      data(fields, "previousHeadDigest"),
      "head.previousHeadDigest",
      code,
    ),
    schema: EVOLUTION_LEDGER_MANIFEST_HEAD_SCHEMA,
    sequence: positive(data(fields, "sequence"), "head.sequence", code),
    signature: signatureValue(
      data(fields, "signature"),
      "head.signature",
      code,
    ),
    tenantId: identifier(data(fields, "tenantId"), "head.tenantId", code),
  });
  for (const [field, expected] of Object.entries({
    authorityAlgorithm: authority.descriptor.algorithm,
    authorityId: authority.descriptor.authorityId,
    authorityRevision: authority.descriptor.revision,
    epoch: descriptorValue.epoch,
    ledgerId: descriptorValue.ledgerId,
    tenantId: descriptorValue.tenantId,
  })) {
    if (normalized[field] !== expected)
      throw failure(code, `manifest head ${field} binding differs`);
  }
  verify(authority, "ledger-manifest-head", normalized, "headDigest");
  return normalized;
}

function previousHead(value, descriptorValue, authority) {
  return value === null
    ? null
    : normalizeHead(value, descriptorValue, authority);
}

function storeFailure(cause, action) {
  if (cause instanceof EvolutionLedgerManifestError) throw cause;
  const code =
    cause?.code === "CC_EVOLUTION_LEDGER_IMMUTABLE_STORE_UNAVAILABLE"
      ? EVOLUTION_LEDGER_MANIFEST_UNAVAILABLE_CODE
      : EVOLUTION_LEDGER_MANIFEST_CORRUPT_CODE;
  throw failure(code, `immutable segment store ${action} failed`, { cause });
}

export function createEvolutionLedgerManifestAuthority(options = undefined) {
  const fields = exactRecord(
    options,
    AUTHORITY_CONFIG_KEYS,
    "manifest authority configuration",
  );
  const signFn = data(fields, "sign");
  const verifyFn = data(fields, "verify");
  rejectProxy(signFn, "manifest authority.sign");
  rejectProxy(verifyFn, "manifest authority.verify");
  if (typeof signFn !== "function" || typeof verifyFn !== "function") {
    throw failure(
      EVOLUTION_LEDGER_MANIFEST_INVALID_CODE,
      "manifest authority sign and verify functions are required",
    );
  }
  const authority = Object.freeze({
    descriptor: authorityDescriptor(data(fields, "descriptor")),
    sign: Object.freeze((request) =>
      Reflect.apply(signFn, undefined, [request]),
    ),
    verify: Object.freeze((request) =>
      Reflect.apply(verifyFn, undefined, [request]),
    ),
  });
  AUTHORITIES.add(authority);
  return authority;
}

export function captureEvolutionLedgerManifestAuthority(value) {
  return captureAuthority(value);
}

export function sealEvolutionLedgerManifestSegment(options = undefined) {
  const fields = exactRecord(
    options,
    SEAL_CONFIG_KEYS,
    "manifest segment seal configuration",
  );
  const descriptorValue = descriptor(data(fields, "descriptor"));
  const authority = captureAuthority(data(fields, "authority"));
  const store = captureImmutableLedgerSegmentStorePort(
    data(fields, "segmentStore"),
    {
      epoch: descriptorValue.epoch,
      ledgerId: descriptorValue.ledgerId,
      tenantId: descriptorValue.tenantId,
    },
  );
  const previous = previousHead(
    data(fields, "previousHead"),
    descriptorValue,
    authority,
  );
  const eventDigests = normalizeDigests(
    data(fields, "eventDigests"),
    "eventDigests",
    descriptorValue.maximumEventsPerSegment,
  );
  const now = data(fields, "now");
  rejectProxy(now, "manifest clock");
  if (typeof now !== "function")
    throw failure(
      EVOLUTION_LEDGER_MANIFEST_INVALID_CODE,
      "manifest clock is required",
    );
  const nowMs = Number(now());
  if (!Number.isFinite(nowMs)) {
    throw failure(
      EVOLUTION_LEDGER_MANIFEST_INVALID_CODE,
      "manifest clock returned an invalid time",
    );
  }
  const issuedAt = timestamp(
    new Date(nowMs).toISOString(),
    "manifest issuedAt",
  ).value;
  const sequenceStart = (previous?.sequence || 0) + 1;
  const segmentPayload = payload(sequenceStart, eventDigests);
  let receipt;
  try {
    receipt = store.retain({
      bytes: payloadBytes(segmentPayload),
      minimumRetainedUntil: timestamp(
        data(fields, "minimumRetainedUntil"),
        "minimumRetainedUntil",
      ).value,
      sequenceEnd: segmentPayload.sequenceEnd,
      sequenceStart,
    });
  } catch (cause) {
    storeFailure(cause, "retain");
  }
  if (
    receipt?.schema !== EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_RECEIPT_SCHEMA ||
    receipt.authenticated !== true ||
    receipt.immutable !== true ||
    receipt.readbackVerified !== true
  ) {
    throw failure(
      EVOLUTION_LEDGER_MANIFEST_CORRUPT_CODE,
      "immutable segment store did not return a verified receipt",
    );
  }
  const manifest = sign(
    authority,
    "ledger-segment-manifest",
    Object.freeze({
      authorityAlgorithm: authority.descriptor.algorithm,
      authorityId: authority.descriptor.authorityId,
      authorityRevision: authority.descriptor.revision,
      contentDigest: receipt.contentDigest,
      epoch: descriptorValue.epoch,
      eventDigestRoot: sha256(Buffer.from(canonical(eventDigests), "utf8")),
      eventDigests,
      issuedAt,
      ledgerId: descriptorValue.ledgerId,
      manifestSequence: (previous?.manifestSequence || 0) + 1,
      previousManifestDigest: previous?.manifestDigest || null,
      retainedUntil: receipt.retainedUntil,
      schema: EVOLUTION_LEDGER_SEGMENT_MANIFEST_SCHEMA,
      segmentRef: receipt.segmentRef,
      sequenceEnd: segmentPayload.sequenceEnd,
      sequenceStart,
      storageVersion: receipt.storageVersion,
      tenantId: descriptorValue.tenantId,
    }),
    "manifestDigest",
  );
  const head = sign(
    authority,
    "ledger-manifest-head",
    Object.freeze({
      authorityAlgorithm: authority.descriptor.algorithm,
      authorityId: authority.descriptor.authorityId,
      authorityRevision: authority.descriptor.revision,
      epoch: descriptorValue.epoch,
      eventDigest: eventDigests.at(-1),
      issuedAt,
      ledgerId: descriptorValue.ledgerId,
      manifestDigest: manifest.manifestDigest,
      manifestSequence: manifest.manifestSequence,
      previousHeadDigest: previous?.headDigest || null,
      schema: EVOLUTION_LEDGER_MANIFEST_HEAD_SCHEMA,
      sequence: segmentPayload.sequenceEnd,
      tenantId: descriptorValue.tenantId,
    }),
    "headDigest",
  );
  return Object.freeze({
    head,
    manifest,
    segmentReceipt: receipt,
  });
}

export function verifyEvolutionLedgerManifestChain(options = undefined) {
  const fields = exactRecord(
    options,
    VERIFY_CONFIG_KEYS,
    "manifest chain verification configuration",
  );
  const descriptorValue = descriptor(data(fields, "descriptor"));
  const authority = captureAuthority(data(fields, "authority"));
  const store = captureImmutableLedgerSegmentStorePort(
    data(fields, "segmentStore"),
    {
      epoch: descriptorValue.epoch,
      ledgerId: descriptorValue.ledgerId,
      tenantId: descriptorValue.tenantId,
    },
  );
  const manifests = data(fields, "manifests");
  rejectProxy(manifests, "manifests", EVOLUTION_LEDGER_MANIFEST_CORRUPT_CODE);
  if (
    !Array.isArray(manifests) ||
    manifests.length < 1 ||
    Object.keys(manifests).length !== manifests.length
  ) {
    throw failure(
      EVOLUTION_LEDGER_MANIFEST_CORRUPT_CODE,
      "manifests must be a non-empty dense array",
    );
  }
  let previous = null;
  for (const rawManifest of manifests) {
    const manifest = normalizeManifest(rawManifest, descriptorValue, authority);
    if (
      manifest.manifestSequence !== (previous?.manifestSequence || 0) + 1 ||
      manifest.previousManifestDigest !== (previous?.manifestDigest || null) ||
      manifest.sequenceStart !== (previous?.sequenceEnd || 0) + 1
    ) {
      throw failure(
        EVOLUTION_LEDGER_MANIFEST_CORRUPT_CODE,
        "manifest chain linkage is invalid",
      );
    }
    let resolution;
    try {
      resolution = store.resolve({
        contentDigest: manifest.contentDigest,
        minimumRetainedUntil: manifest.retainedUntil,
        segmentRef: manifest.segmentRef,
        sequenceEnd: manifest.sequenceEnd,
        sequenceStart: manifest.sequenceStart,
        storageVersion: manifest.storageVersion,
      });
    } catch (cause) {
      storeFailure(cause, "resolve");
    }
    if (
      resolution?.schema !==
        EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_RESOLUTION_SCHEMA ||
      resolution.authenticated !== true ||
      resolution.immutable !== true
    ) {
      throw failure(
        EVOLUTION_LEDGER_MANIFEST_CORRUPT_CODE,
        "manifest segment resolution is not authenticated immutable storage",
      );
    }
    const parsed = parsePayload(resolution.bytes, manifest);
    if (canonical(parsed.eventDigests) !== canonical(manifest.eventDigests)) {
      throw failure(
        EVOLUTION_LEDGER_MANIFEST_CORRUPT_CODE,
        "manifest event digests differ from immutable bytes",
      );
    }
    previous = manifest;
  }
  const head = normalizeHead(data(fields, "head"), descriptorValue, authority);
  if (
    head.manifestSequence !== previous.manifestSequence ||
    head.manifestDigest !== previous.manifestDigest ||
    head.sequence !== previous.sequenceEnd ||
    head.eventDigest !== previous.eventDigests.at(-1)
  ) {
    throw failure(
      EVOLUTION_LEDGER_MANIFEST_CORRUPT_CODE,
      "manifest head does not bind the final manifest",
    );
  }
  return Object.freeze({
    authenticated: true,
    head,
    manifestCount: manifests.length,
    sequence: head.sequence,
  });
}

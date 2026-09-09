import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";

export const EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_STORE_SCHEMA =
  "chainlesschain.evolution-immutable-ledger-segment-store/v1";
export const EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_PROOF_VERIFIER_SCHEMA =
  "chainlesschain.evolution-immutable-ledger-segment-proof-verifier/v1";
export const EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_RETAIN_REQUEST_SCHEMA =
  "chainlesschain.evolution-immutable-ledger-segment-retain-request/v1";
export const EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_RESOLVE_REQUEST_SCHEMA =
  "chainlesschain.evolution-immutable-ledger-segment-resolve-request/v1";
export const EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_RESOLUTION_SCHEMA =
  "chainlesschain.evolution-immutable-ledger-segment-resolution/v1";
export const EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_RETENTION_PROOF_SCHEMA =
  "chainlesschain.evolution-immutable-ledger-segment-retention-proof/v1";
export const EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_RECEIPT_SCHEMA =
  "chainlesschain.evolution-immutable-ledger-segment-receipt/v1";

export const EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_INVALID_CODE =
  "CC_EVOLUTION_LEDGER_IMMUTABLE_STORE_INVALID";
export const EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_UNAVAILABLE_CODE =
  "CC_EVOLUTION_LEDGER_IMMUTABLE_STORE_UNAVAILABLE";
export const EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_CORRUPT_CODE =
  "CC_EVOLUTION_LEDGER_IMMUTABLE_STORE_CORRUPT";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const MAX_SEGMENT_BYTES = 64 * 1024 * 1024;
const RETENTION_MODES = new Set(["compliance", "legal-hold"]);
const STORES = new WeakSet();
const VERIFIERS = new WeakSet();

const DESCRIPTOR_KEYS = new Set([
  "authorityId",
  "authorityRevision",
  "epoch",
  "handlerArtifactDigest",
  "immutabilityMode",
  "ledgerId",
  "proofAlgorithm",
  "tenantId",
]);
const VERIFIER_DESCRIPTOR_KEYS = new Set([
  "authorityId",
  "authorityRevision",
  "proofAlgorithm",
  "verifierArtifactDigest",
]);
const STORE_CONFIG_KEYS = new Set(["backend", "descriptor", "proofVerifier"]);
const VERIFIER_CONFIG_KEYS = new Set(["descriptor", "verify"]);
const RETAIN_INPUT_KEYS = new Set([
  "bytes",
  "minimumRetainedUntil",
  "sequenceEnd",
  "sequenceStart",
]);
const RESOLVE_INPUT_KEYS = new Set([
  "contentDigest",
  "minimumRetainedUntil",
  "segmentRef",
  "sequenceEnd",
  "sequenceStart",
  "storageVersion",
]);
const PROOF_KEYS = new Set([
  "authorityId",
  "authorityRevision",
  "contentDigest",
  "epoch",
  "issuedAt",
  "ledgerId",
  "proofAlgorithm",
  "proofDigest",
  "retainedUntil",
  "retentionMode",
  "schema",
  "segmentRef",
  "sequenceEnd",
  "sequenceStart",
  "signature",
  "storageVersion",
  "tenantId",
]);
const RESOLUTION_KEYS = new Set(["bytes", "found", "proof", "schema"]);

export class EvolutionImmutableLedgerSegmentStoreError extends Error {
  constructor(code, message, options = undefined) {
    super(message, options);
    this.name = "EvolutionImmutableLedgerSegmentStoreError";
    this.code = code;
  }
}

function failure(code, message, options = undefined) {
  return new EvolutionImmutableLedgerSegmentStoreError(code, message, options);
}

function rejectProxy(
  value,
  label,
  code = EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_INVALID_CODE,
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
  code = EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_INVALID_CODE,
) {
  rejectProxy(value, label, code);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw failure(code, `${label} must be a record`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw failure(code, `${label} must use a plain prototype`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const names = Object.keys(descriptors);
  if (names.length !== keys.size || names.some((name) => !keys.has(name))) {
    throw failure(code, `${label} fields are invalid`);
  }
  for (const name of names) {
    if (!("value" in descriptors[name])) {
      throw failure(code, `${label}.${name} must be an own data property`);
    }
  }
  return descriptors;
}

function data(descriptors, key) {
  return descriptors[key].value;
}

function identifier(
  value,
  label,
  code = EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_INVALID_CODE,
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

function digest(
  value,
  label,
  code = EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_INVALID_CODE,
) {
  if (!DIGEST.test(value || ""))
    throw failure(code, `${label} must be sha256-bound`);
  return value;
}

function positiveInteger(
  value,
  label,
  code = EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_INVALID_CODE,
) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw failure(code, `${label} must be a positive safe integer`);
  }
  return value;
}

function instant(
  value,
  label,
  code = EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_INVALID_CODE,
) {
  if (typeof value !== "string")
    throw failure(code, `${label} must be an ISO instant`);
  const timestamp = Date.parse(value);
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString() !== value
  ) {
    throw failure(code, `${label} must be a canonical ISO instant`);
  }
  return Object.freeze({ timestamp, value });
}

function copyBytes(value, label, code) {
  rejectProxy(value, label, code);
  if (
    !Buffer.isBuffer(value) ||
    Object.getPrototypeOf(value) !== Buffer.prototype
  ) {
    throw failure(code, `${label} must be a safe Buffer`);
  }
  if (value.byteLength < 1 || value.byteLength > MAX_SEGMENT_BYTES) {
    throw failure(code, `${label} size is outside the segment bound`);
  }
  return Buffer.from(value);
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function proofPayload(proof) {
  return {
    authorityId: proof.authorityId,
    authorityRevision: proof.authorityRevision,
    contentDigest: proof.contentDigest,
    epoch: proof.epoch,
    issuedAt: proof.issuedAt,
    ledgerId: proof.ledgerId,
    proofAlgorithm: proof.proofAlgorithm,
    retainedUntil: proof.retainedUntil,
    retentionMode: proof.retentionMode,
    schema: proof.schema,
    segmentRef: proof.segmentRef,
    sequenceEnd: proof.sequenceEnd,
    sequenceStart: proof.sequenceStart,
    storageVersion: proof.storageVersion,
    tenantId: proof.tenantId,
  };
}

export function computeImmutableLedgerSegmentProofDigest(proof) {
  const normalized = normalizeProof(proof, { verifyDigest: false });
  return sha256(Buffer.from(canonical(proofPayload(normalized)), "utf8"));
}

function storeDescriptor(value) {
  const fields = exactRecord(
    value,
    DESCRIPTOR_KEYS,
    "immutable segment store descriptor",
  );
  if (data(fields, "immutabilityMode") !== "external-retention-authority") {
    throw failure(
      EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_INVALID_CODE,
      "immutable segment store must use an external retention authority",
    );
  }
  return Object.freeze({
    authorityId: identifier(
      data(fields, "authorityId"),
      "descriptor.authorityId",
    ),
    authorityRevision: positiveInteger(
      data(fields, "authorityRevision"),
      "descriptor.authorityRevision",
    ),
    epoch: identifier(data(fields, "epoch"), "descriptor.epoch"),
    handlerArtifactDigest: digest(
      data(fields, "handlerArtifactDigest"),
      "descriptor.handlerArtifactDigest",
    ),
    immutabilityMode: "external-retention-authority",
    ledgerId: identifier(data(fields, "ledgerId"), "descriptor.ledgerId"),
    proofAlgorithm: identifier(
      data(fields, "proofAlgorithm"),
      "descriptor.proofAlgorithm",
    ),
    tenantId: identifier(data(fields, "tenantId"), "descriptor.tenantId"),
  });
}

function verifierDescriptor(value) {
  const fields = exactRecord(
    value,
    VERIFIER_DESCRIPTOR_KEYS,
    "immutable segment proof verifier descriptor",
  );
  return Object.freeze({
    authorityId: identifier(
      data(fields, "authorityId"),
      "verifier.authorityId",
    ),
    authorityRevision: positiveInteger(
      data(fields, "authorityRevision"),
      "verifier.authorityRevision",
    ),
    proofAlgorithm: identifier(
      data(fields, "proofAlgorithm"),
      "verifier.proofAlgorithm",
    ),
    verifierArtifactDigest: digest(
      data(fields, "verifierArtifactDigest"),
      "verifier.verifierArtifactDigest",
    ),
  });
}

function ownCallable(owner, name, label) {
  rejectProxy(owner, label);
  if (!owner || typeof owner !== "object") {
    throw failure(
      EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_INVALID_CODE,
      `${label} must be a record`,
    );
  }
  const descriptor = Object.getOwnPropertyDescriptor(owner, name);
  if (!descriptor || !("value" in descriptor)) {
    throw failure(
      EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_INVALID_CODE,
      `${label}.${name} must be an own data method`,
    );
  }
  rejectProxy(descriptor.value, `${label}.${name}`);
  if (typeof descriptor.value !== "function") {
    throw failure(
      EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_INVALID_CODE,
      `${label}.${name} must be a function`,
    );
  }
  return Object.freeze((request) =>
    Reflect.apply(descriptor.value, owner, [request]),
  );
}

function synchronous(
  value,
  label,
  code = EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_UNAVAILABLE_CODE,
) {
  rejectProxy(value, label, code);
  if (utilTypes.isPromise(value)) {
    throw failure(code, `${label} must be synchronous`);
  }
  return value;
}

function normalizeProof(value, { verifyDigest = true } = {}) {
  const code = EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_CORRUPT_CODE;
  const fields = exactRecord(
    value,
    PROOF_KEYS,
    "immutable segment retention proof",
    code,
  );
  if (
    data(fields, "schema") !==
    EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_RETENTION_PROOF_SCHEMA
  ) {
    throw failure(code, "immutable segment retention proof schema is invalid");
  }
  const issuedAt = instant(data(fields, "issuedAt"), "proof.issuedAt", code);
  const retainedUntil = instant(
    data(fields, "retainedUntil"),
    "proof.retainedUntil",
    code,
  );
  if (retainedUntil.timestamp <= issuedAt.timestamp) {
    throw failure(
      code,
      "immutable segment retention proof has expired retention",
    );
  }
  const retentionMode = data(fields, "retentionMode");
  if (!RETENTION_MODES.has(retentionMode)) {
    throw failure(code, "immutable segment retention mode is invalid");
  }
  const normalized = Object.freeze({
    authorityId: identifier(
      data(fields, "authorityId"),
      "proof.authorityId",
      code,
    ),
    authorityRevision: positiveInteger(
      data(fields, "authorityRevision"),
      "proof.authorityRevision",
      code,
    ),
    contentDigest: digest(
      data(fields, "contentDigest"),
      "proof.contentDigest",
      code,
    ),
    epoch: identifier(data(fields, "epoch"), "proof.epoch", code),
    issuedAt: issuedAt.value,
    ledgerId: identifier(data(fields, "ledgerId"), "proof.ledgerId", code),
    proofAlgorithm: identifier(
      data(fields, "proofAlgorithm"),
      "proof.proofAlgorithm",
      code,
    ),
    proofDigest: digest(data(fields, "proofDigest"), "proof.proofDigest", code),
    retainedUntil: retainedUntil.value,
    retentionMode,
    schema: EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_RETENTION_PROOF_SCHEMA,
    segmentRef: digest(data(fields, "segmentRef"), "proof.segmentRef", code),
    sequenceEnd: positiveInteger(
      data(fields, "sequenceEnd"),
      "proof.sequenceEnd",
      code,
    ),
    sequenceStart: positiveInteger(
      data(fields, "sequenceStart"),
      "proof.sequenceStart",
      code,
    ),
    signature: identifier(data(fields, "signature"), "proof.signature", code),
    storageVersion: identifier(
      data(fields, "storageVersion"),
      "proof.storageVersion",
      code,
    ),
    tenantId: identifier(data(fields, "tenantId"), "proof.tenantId", code),
  });
  if (normalized.sequenceEnd < normalized.sequenceStart) {
    throw failure(code, "immutable segment proof sequence range is invalid");
  }
  if (normalized.segmentRef !== normalized.contentDigest) {
    throw failure(code, "immutable segment reference is not content-addressed");
  }
  if (
    verifyDigest &&
    computeImmutableLedgerSegmentProofDigest(normalized) !==
      normalized.proofDigest
  ) {
    throw failure(code, "immutable segment proof digest is invalid");
  }
  return normalized;
}

function assertProofBinding(proof, expected, descriptor) {
  const code = EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_CORRUPT_CODE;
  for (const [field, value] of Object.entries({
    authorityId: descriptor.authorityId,
    authorityRevision: descriptor.authorityRevision,
    contentDigest: expected.contentDigest,
    epoch: descriptor.epoch,
    ledgerId: descriptor.ledgerId,
    proofAlgorithm: descriptor.proofAlgorithm,
    segmentRef: expected.segmentRef,
    sequenceEnd: expected.sequenceEnd,
    sequenceStart: expected.sequenceStart,
    tenantId: descriptor.tenantId,
  })) {
    if (proof[field] !== value)
      throw failure(code, `immutable segment proof ${field} binding differs`);
  }
  if (
    expected.storageVersion !== undefined &&
    proof.storageVersion !== expected.storageVersion
  ) {
    throw failure(
      code,
      "immutable segment proof storageVersion binding differs",
    );
  }
  if (
    Date.parse(proof.retainedUntil) < Date.parse(expected.minimumRetainedUntil)
  ) {
    throw failure(
      code,
      "immutable segment retention is shorter than requested",
    );
  }
}

function verifyProof(verifier, proof) {
  let verified;
  try {
    verified = synchronous(
      verifier.verify(proof),
      "immutable segment proof verification",
    );
  } catch (cause) {
    if (cause instanceof EvolutionImmutableLedgerSegmentStoreError) throw cause;
    throw failure(
      EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_UNAVAILABLE_CODE,
      "immutable segment proof verifier failed",
      { cause },
    );
  }
  if (verified !== true) {
    throw failure(
      EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_CORRUPT_CODE,
      "immutable segment proof signature was rejected",
    );
  }
}

function retainRequest(input, descriptor) {
  const fields = exactRecord(
    input,
    RETAIN_INPUT_KEYS,
    "immutable segment retain request",
  );
  const bytes = copyBytes(
    data(fields, "bytes"),
    "immutable segment retain bytes",
    EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_INVALID_CODE,
  );
  const sequenceStart = positiveInteger(
    data(fields, "sequenceStart"),
    "request.sequenceStart",
  );
  const sequenceEnd = positiveInteger(
    data(fields, "sequenceEnd"),
    "request.sequenceEnd",
  );
  if (sequenceEnd < sequenceStart) {
    throw failure(
      EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_INVALID_CODE,
      "segment sequence range is invalid",
    );
  }
  const minimumRetainedUntil = instant(
    data(fields, "minimumRetainedUntil"),
    "request.minimumRetainedUntil",
  ).value;
  const contentDigest = sha256(bytes);
  return Object.freeze({
    bytes,
    contentDigest,
    epoch: descriptor.epoch,
    ledgerId: descriptor.ledgerId,
    minimumRetainedUntil,
    schema: EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_RETAIN_REQUEST_SCHEMA,
    segmentRef: contentDigest,
    sequenceEnd,
    sequenceStart,
    tenantId: descriptor.tenantId,
  });
}

function resolveRequest(input, descriptor) {
  const fields = exactRecord(
    input,
    RESOLVE_INPUT_KEYS,
    "immutable segment resolve request",
  );
  const contentDigest = digest(
    data(fields, "contentDigest"),
    "request.contentDigest",
  );
  const segmentRef = digest(data(fields, "segmentRef"), "request.segmentRef");
  if (segmentRef !== contentDigest) {
    throw failure(
      EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_INVALID_CODE,
      "segment resolve reference is not content-addressed",
    );
  }
  const sequenceStart = positiveInteger(
    data(fields, "sequenceStart"),
    "request.sequenceStart",
  );
  const sequenceEnd = positiveInteger(
    data(fields, "sequenceEnd"),
    "request.sequenceEnd",
  );
  if (sequenceEnd < sequenceStart) {
    throw failure(
      EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_INVALID_CODE,
      "segment sequence range is invalid",
    );
  }
  return Object.freeze({
    contentDigest,
    epoch: descriptor.epoch,
    ledgerId: descriptor.ledgerId,
    minimumRetainedUntil: instant(
      data(fields, "minimumRetainedUntil"),
      "request.minimumRetainedUntil",
    ).value,
    schema: EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_RESOLVE_REQUEST_SCHEMA,
    segmentRef,
    sequenceEnd,
    sequenceStart,
    storageVersion: identifier(
      data(fields, "storageVersion"),
      "request.storageVersion",
    ),
    tenantId: descriptor.tenantId,
  });
}

function normalizeResolution(value, expected, descriptor, verifier) {
  const code = EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_CORRUPT_CODE;
  const fields = exactRecord(
    value,
    RESOLUTION_KEYS,
    "immutable segment resolution",
    code,
  );
  if (
    data(fields, "schema") !==
    EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_RESOLUTION_SCHEMA
  ) {
    throw failure(code, "immutable segment resolution schema is invalid");
  }
  if (data(fields, "found") !== true) {
    throw failure(code, "immutable segment is missing");
  }
  const bytes = copyBytes(
    data(fields, "bytes"),
    "immutable segment resolution bytes",
    code,
  );
  if (sha256(bytes) !== expected.contentDigest) {
    throw failure(code, "immutable segment resolved substituted bytes");
  }
  const proof = normalizeProof(data(fields, "proof"));
  assertProofBinding(proof, expected, descriptor);
  verifyProof(verifier, proof);
  return Object.freeze({
    authenticated: true,
    bytes,
    immutable: true,
    proof,
    schema: EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_RESOLUTION_SCHEMA,
  });
}

export function createImmutableLedgerSegmentProofVerifier(options = undefined) {
  const fields = exactRecord(
    options,
    VERIFIER_CONFIG_KEYS,
    "immutable segment proof verifier configuration",
  );
  const normalizedDescriptor = verifierDescriptor(data(fields, "descriptor"));
  const verify = data(fields, "verify");
  rejectProxy(verify, "immutable segment proof verifier");
  if (typeof verify !== "function") {
    throw failure(
      EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_INVALID_CODE,
      "immutable segment proof verifier function is required",
    );
  }
  const verifier = Object.freeze({
    descriptor: normalizedDescriptor,
    verify: Object.freeze((proof) => Reflect.apply(verify, undefined, [proof])),
  });
  VERIFIERS.add(verifier);
  return verifier;
}

export function captureImmutableLedgerSegmentProofVerifier(value) {
  if (!VERIFIERS.has(value)) {
    throw new TypeError(
      "a branded immutable ledger segment proof verifier is required",
    );
  }
  return value;
}

export function createImmutableLedgerSegmentStorePort(options = undefined) {
  const fields = exactRecord(
    options,
    STORE_CONFIG_KEYS,
    "immutable segment store configuration",
  );
  const backend = data(fields, "backend");
  const normalizedDescriptor = storeDescriptor(data(fields, "descriptor"));
  const verifier = captureImmutableLedgerSegmentProofVerifier(
    data(fields, "proofVerifier"),
  );
  for (const field of ["authorityId", "authorityRevision", "proofAlgorithm"]) {
    if (verifier.descriptor[field] !== normalizedDescriptor[field]) {
      throw failure(
        EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_INVALID_CODE,
        `immutable segment verifier ${field} binding differs`,
      );
    }
  }
  const retainBackend = ownCallable(
    backend,
    "retain",
    "immutable segment backend",
  );
  const resolveBackend = ownCallable(
    backend,
    "resolve",
    "immutable segment backend",
  );

  const resolveNormalized = (request) => {
    let result;
    try {
      result = synchronous(
        resolveBackend(request),
        "immutable segment backend resolve result",
        EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_CORRUPT_CODE,
      );
    } catch (cause) {
      if (cause instanceof EvolutionImmutableLedgerSegmentStoreError)
        throw cause;
      throw failure(
        EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_UNAVAILABLE_CODE,
        "immutable segment backend resolve failed",
        { cause },
      );
    }
    return normalizeResolution(result, request, normalizedDescriptor, verifier);
  };

  const port = Object.freeze({
    descriptor: Object.freeze({
      ...normalizedDescriptor,
      schema: EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_STORE_SCHEMA,
      verifierArtifactDigest: verifier.descriptor.verifierArtifactDigest,
    }),
    resolve(input) {
      return resolveNormalized(resolveRequest(input, normalizedDescriptor));
    },
    retain(input) {
      const request = retainRequest(input, normalizedDescriptor);
      let rawProof;
      try {
        rawProof = synchronous(
          retainBackend(request),
          "immutable segment backend retain result",
          EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_CORRUPT_CODE,
        );
      } catch (cause) {
        if (cause instanceof EvolutionImmutableLedgerSegmentStoreError)
          throw cause;
        throw failure(
          EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_UNAVAILABLE_CODE,
          "immutable segment backend retain failed",
          { cause },
        );
      }
      const proof = normalizeProof(rawProof);
      assertProofBinding(proof, request, normalizedDescriptor);
      verifyProof(verifier, proof);
      const resolution = resolveNormalized(
        Object.freeze({
          contentDigest: request.contentDigest,
          epoch: request.epoch,
          ledgerId: request.ledgerId,
          minimumRetainedUntil: request.minimumRetainedUntil,
          schema: EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_RESOLVE_REQUEST_SCHEMA,
          segmentRef: request.segmentRef,
          sequenceEnd: request.sequenceEnd,
          sequenceStart: request.sequenceStart,
          storageVersion: proof.storageVersion,
          tenantId: request.tenantId,
        }),
      );
      if (resolution.proof.proofDigest !== proof.proofDigest) {
        throw failure(
          EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_CORRUPT_CODE,
          "immutable segment readback proof differs from retained proof",
        );
      }
      return Object.freeze({
        authenticated: true,
        contentDigest: request.contentDigest,
        immutable: true,
        proof,
        readbackVerified: true,
        retainedUntil: proof.retainedUntil,
        schema: EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_RECEIPT_SCHEMA,
        segmentRef: request.segmentRef,
        sequenceEnd: request.sequenceEnd,
        sequenceStart: request.sequenceStart,
        storageVersion: proof.storageVersion,
      });
    },
  });
  STORES.add(port);
  return port;
}

export function captureImmutableLedgerSegmentStorePort(
  value,
  expected = undefined,
) {
  if (!STORES.has(value)) {
    throw new TypeError("a branded immutable ledger segment store is required");
  }
  if (expected !== undefined) {
    const fields = exactRecord(
      expected,
      new Set(["epoch", "ledgerId", "tenantId"]),
      "expected immutable segment scope",
    );
    for (const field of ["epoch", "ledgerId", "tenantId"]) {
      if (value.descriptor[field] !== data(fields, field)) {
        throw failure(
          EVOLUTION_IMMUTABLE_LEDGER_SEGMENT_INVALID_CODE,
          `immutable segment store ${field} scope differs`,
        );
      }
    }
  }
  return value;
}

export function isImmutableLedgerSegmentStorePort(value) {
  return STORES.has(value);
}

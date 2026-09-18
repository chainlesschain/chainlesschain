import { createHash } from "node:crypto";
import { isPromise, isProxy, isUint8Array } from "node:util/types";

import {
  EVOLUTION_ARTIFACT_DURABILITY_BINDING_SCHEMA,
  EVOLUTION_ARTIFACT_DURABILITY_RECEIPT_SCHEMA,
  EVOLUTION_ARTIFACT_DURABILITY_RESOLUTION_SCHEMA,
  EVOLUTION_ARTIFACT_DURABILITY_RESOLVE_REQUEST_SCHEMA,
  EVOLUTION_ARTIFACT_DURABILITY_RETAIN_REQUEST_SCHEMA,
} from "./evolution-ledger-ports.js";

export const PM_EXPLORATION_RECOVERY_SNAPSHOT_REQUEST_SCHEMA =
  "chainlesschain.pm-exploration-recovery-snapshot-request/v1";
export const PM_EXPLORATION_RECOVERY_SNAPSHOT_ACK_SCHEMA =
  "chainlesschain.pm-exploration-recovery-snapshot-ack/v1";
export const PM_EXPLORATION_RECOVERY_SNAPSHOT_CORRUPT_CODE =
  "CC_PM_RECOVERY_SNAPSHOT_CORRUPT";

const DATABASE_SEAL_SCHEMA =
  "chainlesschain.desktop-pm-database-pre-run-seal/v1";
const DATABASE_SNAPSHOT_DOMAIN =
  "chainlesschain.desktop-pm-database-snapshot/v1";
const SNAPSHOT_TYPE = "pm-exploration-database-recovery-snapshot";
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024 * 1024;
const STORES = new WeakMap();

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function hash(domain, value) {
  return `sha256:${createHash("sha256")
    .update(domain)
    .update("\0")
    .update(canonical(value))
    .digest("hex")}`;
}

function hashBytes(value, domain = null) {
  const hasher = createHash("sha256");
  if (domain !== null) hasher.update(domain).update("\0");
  return `sha256:${hasher.update(value).digest("hex")}`;
}

function exact(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length ||
    actual.some((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return (
        typeof key !== "string" ||
        !keys.includes(key) ||
        !descriptor ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      );
    })
  ) {
    throw new TypeError(`${label} has unexpected or accessor fields`);
  }
}

function digest(value, label) {
  if (typeof value !== "string" || !DIGEST.test(value))
    throw new TypeError(`${label} must be a sha256 digest`);
  return value;
}

function identifier(value, label) {
  if (typeof value !== "string" || !ID.test(value))
    throw new TypeError(`${label} is invalid`);
  return value;
}

function corrupt(message, options) {
  const error = new Error(message, options);
  error.code = PM_EXPLORATION_RECOVERY_SNAPSHOT_CORRUPT_CODE;
  throw error;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && "value" in descriptor) deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

function databaseSeal(value) {
  exact(
    value,
    [
      "schema",
      "databasePathDigest",
      "databaseSnapshotDigest",
      "databaseSnapshotBytes",
      "snapshotMethod",
      "sealDigest",
    ],
    "PM recovery database seal",
  );
  if (
    value.schema !== DATABASE_SEAL_SCHEMA ||
    value.snapshotMethod !== "database-manager-backup" ||
    !Number.isSafeInteger(value.databaseSnapshotBytes) ||
    value.databaseSnapshotBytes < 1 ||
    value.databaseSnapshotBytes > MAX_SNAPSHOT_BYTES
  ) {
    throw new TypeError("PM recovery database seal is invalid");
  }
  const core = {
    schema: value.schema,
    databasePathDigest: digest(value.databasePathDigest, "databasePathDigest"),
    databaseSnapshotDigest: digest(
      value.databaseSnapshotDigest,
      "databaseSnapshotDigest",
    ),
    databaseSnapshotBytes: value.databaseSnapshotBytes,
    snapshotMethod: value.snapshotMethod,
  };
  const seal = deepFreeze({
    ...core,
    sealDigest: digest(value.sealDigest, "sealDigest"),
  });
  if (seal.sealDigest !== hash(DATABASE_SEAL_SCHEMA, core))
    throw new Error("PM recovery database seal digest mismatch");
  return seal;
}

function snapshotBytes(value) {
  if (
    !value ||
    typeof value !== "object" ||
    isProxy(value) ||
    !(
      (Buffer.isBuffer(value) &&
        Object.getPrototypeOf(value) === Buffer.prototype) ||
      (isUint8Array(value) &&
        Object.getPrototypeOf(value) === Uint8Array.prototype)
    )
  ) {
    throw new TypeError("PM recovery snapshot bytes are invalid");
  }
  if (value.byteLength < 1 || value.byteLength > MAX_SNAPSHOT_BYTES)
    throw new TypeError("PM recovery snapshot bytes exceed the allowed range");
  return Buffer.from(value);
}

function captureAuthority(value) {
  exact(
    value,
    ["id", "retain", "resolve"],
    "PM recovery snapshot durability authority",
  );
  if (
    typeof value.retain !== "function" ||
    typeof value.resolve !== "function" ||
    isProxy(value.retain) ||
    isProxy(value.resolve)
  ) {
    throw new TypeError(
      "PM recovery snapshot durability authority requires direct methods",
    );
  }
  return Object.freeze({
    id: identifier(value.id, "durability authority id"),
    retain: (request) => Reflect.apply(value.retain, value, [request]),
    resolve: (request) => Reflect.apply(value.resolve, value, [request]),
  });
}

function validateAuthorityReceipt(value, binding, authorityId, schema, label) {
  exact(
    value,
    [
      "schema",
      "authenticated",
      "durable",
      "authorityId",
      "artifactTenantId",
      "digest",
      "purpose",
      "ref",
      "retention",
      "type",
      "receiptDigest",
    ],
    label,
  );
  if (
    value.schema !== schema ||
    value.authenticated !== true ||
    value.durable !== true ||
    value.authorityId !== authorityId ||
    value.artifactTenantId !== binding.artifactTenantId ||
    value.digest !== binding.digest ||
    value.purpose !== binding.purpose ||
    value.ref !== binding.ref ||
    value.retention !== binding.retention ||
    value.type !== binding.type
  ) {
    corrupt(`${label} is not authenticated durable evidence`);
  }
  digest(value.receiptDigest, `${label} receiptDigest`);
  return value;
}

function normalizeRequest(value, expectedManifestDigest) {
  exact(
    value,
    [
      "schema",
      "manifestDigest",
      "transitionKind",
      "snapshotRole",
      "evidenceDigest",
      "seal",
      "bytes",
    ],
    "PM recovery snapshot request",
  );
  const expectedRole =
    value.transitionKind === "success" ? "post-run" : "pre-run";
  if (
    value.schema !== PM_EXPLORATION_RECOVERY_SNAPSHOT_REQUEST_SCHEMA ||
    value.manifestDigest !== expectedManifestDigest ||
    !["success", "failure"].includes(value.transitionKind) ||
    value.snapshotRole !== expectedRole
  ) {
    throw new Error("PM recovery snapshot request binding is invalid");
  }
  const seal = databaseSeal(value.seal);
  const bytes = snapshotBytes(value.bytes);
  if (
    seal.databaseSnapshotBytes !== bytes.byteLength ||
    seal.databaseSnapshotDigest !== hashBytes(bytes, DATABASE_SNAPSHOT_DOMAIN)
  ) {
    corrupt("PM recovery snapshot bytes differ from the database seal");
  }
  return {
    manifestDigest: expectedManifestDigest,
    transitionKind: value.transitionKind,
    snapshotRole: value.snapshotRole,
    evidenceDigest: digest(value.evidenceDigest, "evidenceDigest"),
    seal,
    bytes,
  };
}

function ackCore(binding, request, authorityId, durabilityReceiptDigest) {
  return {
    schema: PM_EXPLORATION_RECOVERY_SNAPSHOT_ACK_SCHEMA,
    authenticated: true,
    durable: true,
    readbackVerified: true,
    manifestDigest: request.manifestDigest,
    transitionKind: request.transitionKind,
    snapshotRole: request.snapshotRole,
    evidenceDigest: request.evidenceDigest,
    sealDigest: request.seal.sealDigest,
    databaseSnapshotDigest: request.seal.databaseSnapshotDigest,
    databaseSnapshotBytes: request.seal.databaseSnapshotBytes,
    artifactDigest: binding.digest,
    artifactRef: binding.ref,
    durabilityAuthorityId: authorityId,
    durabilityReceiptDigest,
    qualifiesForPromotion: false,
  };
}

export function verifyPmExplorationRecoverySnapshotAck(value, expected = {}) {
  if (
    !expected ||
    typeof expected !== "object" ||
    Array.isArray(expected) ||
    isProxy(expected) ||
    Object.getPrototypeOf(expected) !== Object.prototype
  ) {
    throw new TypeError("PM recovery snapshot expected binding is invalid");
  }
  const expectedKeys = new Set([
    "manifestDigest",
    "transitionKind",
    "evidenceDigest",
    "sealDigest",
  ]);
  for (const key of Reflect.ownKeys(expected)) {
    const descriptor = Object.getOwnPropertyDescriptor(expected, key);
    if (
      typeof key !== "string" ||
      !expectedKeys.has(key) ||
      !descriptor ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    ) {
      throw new TypeError(
        "PM recovery snapshot expected binding has invalid fields",
      );
    }
  }
  exact(
    value,
    [
      "schema",
      "authenticated",
      "durable",
      "readbackVerified",
      "manifestDigest",
      "transitionKind",
      "snapshotRole",
      "evidenceDigest",
      "sealDigest",
      "databaseSnapshotDigest",
      "databaseSnapshotBytes",
      "artifactDigest",
      "artifactRef",
      "durabilityAuthorityId",
      "durabilityReceiptDigest",
      "qualifiesForPromotion",
      "snapshotAckDigest",
    ],
    "PM recovery snapshot acknowledgement",
  );
  const core = {
    schema: value.schema,
    authenticated: value.authenticated,
    durable: value.durable,
    readbackVerified: value.readbackVerified,
    manifestDigest: digest(value.manifestDigest, "manifestDigest"),
    transitionKind: value.transitionKind,
    snapshotRole: value.snapshotRole,
    evidenceDigest: digest(value.evidenceDigest, "evidenceDigest"),
    sealDigest: digest(value.sealDigest, "sealDigest"),
    databaseSnapshotDigest: digest(
      value.databaseSnapshotDigest,
      "databaseSnapshotDigest",
    ),
    databaseSnapshotBytes: value.databaseSnapshotBytes,
    artifactDigest: digest(value.artifactDigest, "artifactDigest"),
    artifactRef: identifier(value.artifactRef, "artifactRef"),
    durabilityAuthorityId: identifier(
      value.durabilityAuthorityId,
      "durabilityAuthorityId",
    ),
    durabilityReceiptDigest: digest(
      value.durabilityReceiptDigest,
      "durabilityReceiptDigest",
    ),
    qualifiesForPromotion: value.qualifiesForPromotion,
  };
  if (
    core.schema !== PM_EXPLORATION_RECOVERY_SNAPSHOT_ACK_SCHEMA ||
    core.authenticated !== true ||
    core.durable !== true ||
    core.readbackVerified !== true ||
    !["success", "failure"].includes(core.transitionKind) ||
    core.snapshotRole !==
      (core.transitionKind === "success" ? "post-run" : "pre-run") ||
    !Number.isSafeInteger(core.databaseSnapshotBytes) ||
    core.databaseSnapshotBytes < 1 ||
    core.databaseSnapshotBytes > MAX_SNAPSHOT_BYTES ||
    core.qualifiesForPromotion !== false
  ) {
    throw new Error("PM recovery snapshot acknowledgement is invalid");
  }
  for (const key of [
    "manifestDigest",
    "transitionKind",
    "evidenceDigest",
    "sealDigest",
  ]) {
    if (expected[key] !== undefined && core[key] !== expected[key])
      throw new Error(`PM recovery snapshot acknowledgement ${key} mismatch`);
  }
  const snapshotAckDigest = digest(
    value.snapshotAckDigest,
    "snapshotAckDigest",
  );
  if (
    snapshotAckDigest !==
    hash(PM_EXPLORATION_RECOVERY_SNAPSHOT_ACK_SCHEMA, core)
  ) {
    throw new Error("PM recovery snapshot acknowledgement digest mismatch");
  }
  return deepFreeze({ ...core, snapshotAckDigest });
}

export function createPmExplorationRecoverySnapshotStore(input = {}) {
  exact(
    input,
    ["manifestDigest", "artifactTenantId", "purpose", "durabilityAuthority"],
    "PM recovery snapshot store input",
  );
  const manifestDigest = digest(input.manifestDigest, "manifestDigest");
  const artifactTenantId = identifier(
    input.artifactTenantId,
    "artifactTenantId",
  );
  const purpose = identifier(input.purpose, "purpose");
  const authority = captureAuthority(input.durabilityAuthority);
  const store = Object.freeze({});
  STORES.set(
    store,
    Object.freeze({ manifestDigest, artifactTenantId, purpose, authority }),
  );
  return store;
}

export function capturePmExplorationRecoverySnapshotStore(value) {
  const captured = STORES.get(value);
  if (!captured)
    throw new TypeError("a branded PM recovery snapshot store is required");
  return Object.freeze({
    manifestDigest: captured.manifestDigest,
    retainTransitionSnapshot: (input) => {
      const request = normalizeRequest(input, captured.manifestDigest);
      const artifactDigest = hashBytes(request.bytes);
      const binding = deepFreeze({
        artifactTenantId: captured.artifactTenantId,
        digest: artifactDigest,
        purpose: captured.purpose,
        ref: `cc-pm-recovery-snapshot:${request.manifestDigest.slice(7)}:${request.evidenceDigest.slice(7)}:${request.snapshotRole}`,
        retention: "ledger",
        schema: EVOLUTION_ARTIFACT_DURABILITY_BINDING_SCHEMA,
        type: SNAPSHOT_TYPE,
      });
      const retained = captured.authority.retain(
        Object.freeze({
          binding,
          bytes: Buffer.from(request.bytes),
          schema: EVOLUTION_ARTIFACT_DURABILITY_RETAIN_REQUEST_SCHEMA,
        }),
      );
      if (isPromise(retained))
        corrupt("PM recovery snapshot retain must be synchronous");
      validateAuthorityReceipt(
        retained,
        binding,
        captured.authority.id,
        EVOLUTION_ARTIFACT_DURABILITY_RECEIPT_SCHEMA,
        "PM recovery snapshot durability receipt",
      );
      const resolved = captured.authority.resolve(
        Object.freeze({
          artifactTenantId: binding.artifactTenantId,
          digest: binding.digest,
          purpose: binding.purpose,
          ref: binding.ref,
          retention: binding.retention,
          schema: EVOLUTION_ARTIFACT_DURABILITY_RESOLVE_REQUEST_SCHEMA,
        }),
      );
      if (isPromise(resolved))
        corrupt("PM recovery snapshot resolve must be synchronous");
      exact(
        resolved,
        [
          "schema",
          "authenticated",
          "durable",
          "authorityId",
          "artifactTenantId",
          "digest",
          "purpose",
          "ref",
          "retention",
          "type",
          "receiptDigest",
          "bytes",
        ],
        "PM recovery snapshot durability resolution",
      );
      validateAuthorityReceipt(
        Object.fromEntries(
          Reflect.ownKeys(resolved)
            .filter((key) => key !== "bytes")
            .map((key) => [key, resolved[key]]),
        ),
        binding,
        captured.authority.id,
        EVOLUTION_ARTIFACT_DURABILITY_RESOLUTION_SCHEMA,
        "PM recovery snapshot durability resolution",
      );
      const readback = snapshotBytes(resolved.bytes);
      if (!readback.equals(request.bytes))
        corrupt("PM recovery snapshot durability readback differs");
      const core = ackCore(
        binding,
        request,
        captured.authority.id,
        resolved.receiptDigest,
      );
      return deepFreeze({
        ...core,
        snapshotAckDigest: hash(
          PM_EXPLORATION_RECOVERY_SNAPSHOT_ACK_SCHEMA,
          core,
        ),
      });
    },
  });
}

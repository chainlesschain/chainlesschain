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
export const PM_EXPLORATION_RECOVERY_SET_REQUEST_SCHEMA =
  "chainlesschain.pm-exploration-recovery-snapshot-request/v2";
export const PM_EXPLORATION_RECOVERY_SET_ACK_SCHEMA =
  "chainlesschain.pm-exploration-recovery-snapshot-ack/v2";
export const PM_EXPLORATION_RECOVERY_SNAPSHOT_RESOLUTION_SCHEMA =
  "chainlesschain.pm-exploration-recovery-snapshot-resolution/v1";
export const PM_EXPLORATION_RECOVERY_SNAPSHOT_CORRUPT_CODE =
  "CC_PM_RECOVERY_SNAPSHOT_CORRUPT";

const DATABASE_SEAL_SCHEMA =
  "chainlesschain.desktop-pm-database-pre-run-seal/v1";
const DATABASE_SNAPSHOT_DOMAIN =
  "chainlesschain.desktop-pm-database-snapshot/v1";
const WORKSPACE_SEAL_SCHEMA = "chainlesschain.desktop-pm-workspace-seal/v1";
const WORKSPACE_SNAPSHOT_DOMAIN =
  "chainlesschain.desktop-pm-workspace-snapshot/v1";
const RECOVERY_SET_SCHEMA = "chainlesschain.pm-exploration-recovery-set/v1";
const RECOVERY_SET_MAGIC = Buffer.from("CCPMRECOVERYSET1\0", "ascii");
const SNAPSHOT_TYPE = "pm-exploration-database-recovery-snapshot";
const RECOVERY_SET_TYPE = "pm-exploration-recovery-set";
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024 * 1024;
const MAX_WORKSPACE_SNAPSHOT_BYTES = 2 * 1024 * 1024 * 1024;
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

function workspaceSeal(value, expectedManifestDigest) {
  exact(
    value,
    [
      "schema",
      "manifestDigest",
      "workspaceRootDigest",
      "capturePolicyDigest",
      "workspaceSnapshotDigest",
      "workspaceSnapshotBytes",
      "workspaceFileCount",
      "snapshotMethod",
      "sealDigest",
    ],
    "PM recovery workspace seal",
  );
  if (
    value.schema !== WORKSPACE_SEAL_SCHEMA ||
    value.manifestDigest !== expectedManifestDigest ||
    value.snapshotMethod !== "bounded-canonical-workspace-archive" ||
    !Number.isSafeInteger(value.workspaceSnapshotBytes) ||
    value.workspaceSnapshotBytes < 1 ||
    value.workspaceSnapshotBytes > MAX_WORKSPACE_SNAPSHOT_BYTES ||
    !Number.isSafeInteger(value.workspaceFileCount) ||
    value.workspaceFileCount < 0 ||
    value.workspaceFileCount > 100_000
  ) {
    throw new TypeError("PM recovery workspace seal is invalid");
  }
  const core = {
    schema: value.schema,
    manifestDigest: digest(value.manifestDigest, "manifestDigest"),
    workspaceRootDigest: digest(
      value.workspaceRootDigest,
      "workspaceRootDigest",
    ),
    capturePolicyDigest: digest(
      value.capturePolicyDigest,
      "capturePolicyDigest",
    ),
    workspaceSnapshotDigest: digest(
      value.workspaceSnapshotDigest,
      "workspaceSnapshotDigest",
    ),
    workspaceSnapshotBytes: value.workspaceSnapshotBytes,
    workspaceFileCount: value.workspaceFileCount,
    snapshotMethod: value.snapshotMethod,
  };
  const seal = deepFreeze({
    ...core,
    sealDigest: digest(value.sealDigest, "workspace sealDigest"),
  });
  if (seal.sealDigest !== hash(WORKSPACE_SEAL_SCHEMA, core)) {
    throw new Error("PM recovery workspace seal digest mismatch");
  }
  return seal;
}

function snapshotBytes(value, maximum = MAX_SNAPSHOT_BYTES) {
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
  if (value.byteLength < 1 || value.byteLength > maximum)
    throw new TypeError("PM recovery snapshot bytes exceed the allowed range");
  return Buffer.from(value);
}

function boundedSnapshotBytes(value, maximum, label) {
  try {
    return snapshotBytes(value, maximum);
  } catch (cause) {
    throw new TypeError(`${label} bytes exceed the allowed range`, { cause });
  }
}

function encodeRecoverySet(request) {
  const header = Buffer.from(
    canonical({
      schema: RECOVERY_SET_SCHEMA,
      databaseSeal: request.seal,
      workspaceSeal: request.workspaceSeal,
    }),
    "utf8",
  );
  if (header.byteLength > 1024 * 1024) {
    throw new TypeError("PM recovery set header exceeds the allowed range");
  }
  const prefix = Buffer.allocUnsafe(20);
  prefix.writeUInt32BE(header.byteLength, 0);
  prefix.writeBigUInt64BE(BigInt(request.bytes.byteLength), 4);
  prefix.writeBigUInt64BE(BigInt(request.workspaceBytes.byteLength), 12);
  return Buffer.concat([
    RECOVERY_SET_MAGIC,
    prefix,
    header,
    request.bytes,
    request.workspaceBytes,
  ]);
}

function decodeRecoverySet(value, acknowledgement, manifestDigest) {
  const bytes = snapshotBytes(
    value,
    MAX_SNAPSHOT_BYTES + MAX_WORKSPACE_SNAPSHOT_BYTES + 1024 * 1024,
  );
  const prefixOffset = RECOVERY_SET_MAGIC.byteLength;
  const headerOffset = prefixOffset + 20;
  if (
    bytes.byteLength < headerOffset ||
    !bytes.subarray(0, prefixOffset).equals(RECOVERY_SET_MAGIC)
  ) {
    corrupt("PM recovery set magic is invalid");
  }
  const headerLength = bytes.readUInt32BE(prefixOffset);
  const databaseLength = bytes.readBigUInt64BE(prefixOffset + 4);
  const workspaceLength = bytes.readBigUInt64BE(prefixOffset + 12);
  if (
    headerLength < 1 ||
    headerLength > 1024 * 1024 ||
    databaseLength < 1n ||
    databaseLength > BigInt(MAX_SNAPSHOT_BYTES) ||
    workspaceLength < 1n ||
    workspaceLength > BigInt(MAX_WORKSPACE_SNAPSHOT_BYTES) ||
    databaseLength > BigInt(Number.MAX_SAFE_INTEGER) ||
    workspaceLength > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    corrupt("PM recovery set lengths are invalid");
  }
  const databaseBytesLength = Number(databaseLength);
  const workspaceBytesLength = Number(workspaceLength);
  const databaseOffset = headerOffset + headerLength;
  const workspaceOffset = databaseOffset + databaseBytesLength;
  if (workspaceOffset + workspaceBytesLength !== bytes.byteLength) {
    corrupt("PM recovery set length binding is invalid");
  }
  const headerText = bytes
    .subarray(headerOffset, databaseOffset)
    .toString("utf8");
  let header;
  try {
    header = JSON.parse(headerText);
  } catch (cause) {
    corrupt("PM recovery set header is invalid JSON", { cause });
  }
  if (canonical(header) !== headerText) {
    corrupt("PM recovery set header is not canonical");
  }
  exact(
    header,
    ["schema", "databaseSeal", "workspaceSeal"],
    "PM recovery set header",
  );
  if (header.schema !== RECOVERY_SET_SCHEMA) {
    corrupt("PM recovery set schema is invalid");
  }
  const normalizedDatabaseSeal = databaseSeal(header.databaseSeal);
  const normalizedWorkspaceSeal = workspaceSeal(
    header.workspaceSeal,
    manifestDigest,
  );
  const databaseBytes = Buffer.from(
    bytes.subarray(databaseOffset, workspaceOffset),
  );
  const workspaceBytes = Buffer.from(bytes.subarray(workspaceOffset));
  if (
    normalizedDatabaseSeal.sealDigest !== acknowledgement.sealDigest ||
    normalizedDatabaseSeal.databaseSnapshotDigest !==
      acknowledgement.databaseSnapshotDigest ||
    normalizedDatabaseSeal.databaseSnapshotBytes !== databaseBytesLength ||
    normalizedWorkspaceSeal.sealDigest !==
      acknowledgement.workspaceSealDigest ||
    normalizedWorkspaceSeal.workspaceRootDigest !==
      acknowledgement.workspaceRootDigest ||
    normalizedWorkspaceSeal.capturePolicyDigest !==
      acknowledgement.capturePolicyDigest ||
    normalizedWorkspaceSeal.workspaceSnapshotDigest !==
      acknowledgement.workspaceSnapshotDigest ||
    normalizedWorkspaceSeal.workspaceSnapshotBytes !== workspaceBytesLength ||
    normalizedWorkspaceSeal.workspaceFileCount !==
      acknowledgement.workspaceFileCount ||
    hashBytes(databaseBytes, DATABASE_SNAPSHOT_DOMAIN) !==
      normalizedDatabaseSeal.databaseSnapshotDigest ||
    hashBytes(workspaceBytes, WORKSPACE_SNAPSHOT_DOMAIN) !==
      normalizedWorkspaceSeal.workspaceSnapshotDigest
  ) {
    corrupt("PM recovery set contents differ from its acknowledgement");
  }
  return {
    databaseSeal: normalizedDatabaseSeal,
    databaseBytes,
    workspaceSeal: normalizedWorkspaceSeal,
    workspaceBytes,
  };
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
  const composite =
    value?.schema === PM_EXPLORATION_RECOVERY_SET_REQUEST_SCHEMA;
  exact(
    value,
    composite
      ? [
          "schema",
          "manifestDigest",
          "transitionKind",
          "snapshotRole",
          "evidenceDigest",
          "seal",
          "bytes",
          "workspaceSeal",
          "workspaceBytes",
        ]
      : [
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
    ![
      PM_EXPLORATION_RECOVERY_SNAPSHOT_REQUEST_SCHEMA,
      PM_EXPLORATION_RECOVERY_SET_REQUEST_SCHEMA,
    ].includes(value.schema) ||
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
  const normalizedWorkspaceSeal = composite
    ? workspaceSeal(value.workspaceSeal, expectedManifestDigest)
    : null;
  const workspaceBytes = composite
    ? boundedSnapshotBytes(
        value.workspaceBytes,
        MAX_WORKSPACE_SNAPSHOT_BYTES,
        "PM recovery workspace snapshot",
      )
    : null;
  if (
    composite &&
    (normalizedWorkspaceSeal.workspaceSnapshotBytes !==
      workspaceBytes.byteLength ||
      normalizedWorkspaceSeal.workspaceSnapshotDigest !==
        hashBytes(workspaceBytes, WORKSPACE_SNAPSHOT_DOMAIN))
  ) {
    corrupt("PM recovery workspace bytes differ from the workspace seal");
  }
  return {
    schema: value.schema,
    manifestDigest: expectedManifestDigest,
    transitionKind: value.transitionKind,
    snapshotRole: value.snapshotRole,
    evidenceDigest: digest(value.evidenceDigest, "evidenceDigest"),
    seal,
    bytes,
    workspaceSeal: normalizedWorkspaceSeal,
    workspaceBytes,
  };
}

function ackCore(binding, request, authorityId, durabilityReceiptDigest) {
  const core = {
    schema:
      request.workspaceSeal === null
        ? PM_EXPLORATION_RECOVERY_SNAPSHOT_ACK_SCHEMA
        : PM_EXPLORATION_RECOVERY_SET_ACK_SCHEMA,
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
  if (request.workspaceSeal !== null) {
    core.workspaceSealDigest = request.workspaceSeal.sealDigest;
    core.workspaceRootDigest = request.workspaceSeal.workspaceRootDigest;
    core.capturePolicyDigest = request.workspaceSeal.capturePolicyDigest;
    core.workspaceSnapshotDigest =
      request.workspaceSeal.workspaceSnapshotDigest;
    core.workspaceSnapshotBytes = request.workspaceSeal.workspaceSnapshotBytes;
    core.workspaceFileCount = request.workspaceSeal.workspaceFileCount;
  }
  return core;
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
    "workspaceSealDigest",
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
  const composite = value?.schema === PM_EXPLORATION_RECOVERY_SET_ACK_SCHEMA;
  exact(
    value,
    composite
      ? [
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
          "workspaceSealDigest",
          "workspaceRootDigest",
          "capturePolicyDigest",
          "workspaceSnapshotDigest",
          "workspaceSnapshotBytes",
          "workspaceFileCount",
          "artifactDigest",
          "artifactRef",
          "durabilityAuthorityId",
          "durabilityReceiptDigest",
          "qualifiesForPromotion",
          "snapshotAckDigest",
        ]
      : [
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
  if (composite) {
    core.workspaceSealDigest = digest(
      value.workspaceSealDigest,
      "workspaceSealDigest",
    );
    core.workspaceRootDigest = digest(
      value.workspaceRootDigest,
      "workspaceRootDigest",
    );
    core.capturePolicyDigest = digest(
      value.capturePolicyDigest,
      "capturePolicyDigest",
    );
    core.workspaceSnapshotDigest = digest(
      value.workspaceSnapshotDigest,
      "workspaceSnapshotDigest",
    );
    core.workspaceSnapshotBytes = value.workspaceSnapshotBytes;
    core.workspaceFileCount = value.workspaceFileCount;
  }
  if (
    ![
      PM_EXPLORATION_RECOVERY_SNAPSHOT_ACK_SCHEMA,
      PM_EXPLORATION_RECOVERY_SET_ACK_SCHEMA,
    ].includes(core.schema) ||
    core.authenticated !== true ||
    core.durable !== true ||
    core.readbackVerified !== true ||
    !["success", "failure"].includes(core.transitionKind) ||
    core.snapshotRole !==
      (core.transitionKind === "success" ? "post-run" : "pre-run") ||
    !Number.isSafeInteger(core.databaseSnapshotBytes) ||
    core.databaseSnapshotBytes < 1 ||
    core.databaseSnapshotBytes > MAX_SNAPSHOT_BYTES ||
    (composite &&
      (!Number.isSafeInteger(core.workspaceSnapshotBytes) ||
        core.workspaceSnapshotBytes < 1 ||
        core.workspaceSnapshotBytes > MAX_WORKSPACE_SNAPSHOT_BYTES ||
        !Number.isSafeInteger(core.workspaceFileCount) ||
        core.workspaceFileCount < 0 ||
        core.workspaceFileCount > 100_000)) ||
    core.qualifiesForPromotion !== false
  ) {
    throw new Error("PM recovery snapshot acknowledgement is invalid");
  }
  if (expected.workspaceSealDigest !== undefined && !composite) {
    throw new Error(
      "PM recovery snapshot acknowledgement workspaceSealDigest mismatch",
    );
  }
  for (const key of [
    "manifestDigest",
    "transitionKind",
    "evidenceDigest",
    "sealDigest",
    ...(composite ? ["workspaceSealDigest"] : []),
  ]) {
    if (expected[key] !== undefined && core[key] !== expected[key])
      throw new Error(`PM recovery snapshot acknowledgement ${key} mismatch`);
  }
  const snapshotAckDigest = digest(
    value.snapshotAckDigest,
    "snapshotAckDigest",
  );
  if (snapshotAckDigest !== hash(core.schema, core)) {
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
      const artifactBytes =
        request.workspaceBytes === null
          ? request.bytes
          : encodeRecoverySet(request);
      const artifactDigest = hashBytes(artifactBytes);
      const binding = deepFreeze({
        artifactTenantId: captured.artifactTenantId,
        digest: artifactDigest,
        purpose: captured.purpose,
        ref: `cc-pm-recovery-snapshot:${request.manifestDigest.slice(7)}:${request.evidenceDigest.slice(7)}:${request.snapshotRole}`,
        retention: "ledger",
        schema: EVOLUTION_ARTIFACT_DURABILITY_BINDING_SCHEMA,
        type:
          request.workspaceBytes === null ? SNAPSHOT_TYPE : RECOVERY_SET_TYPE,
      });
      const retained = captured.authority.retain(
        Object.freeze({
          binding,
          bytes: Buffer.from(artifactBytes),
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
      const readback = snapshotBytes(
        resolved.bytes,
        MAX_SNAPSHOT_BYTES + MAX_WORKSPACE_SNAPSHOT_BYTES + 1024 * 1024,
      );
      if (!readback.equals(artifactBytes))
        corrupt("PM recovery snapshot durability readback differs");
      const core = ackCore(
        binding,
        request,
        captured.authority.id,
        resolved.receiptDigest,
      );
      return deepFreeze({
        ...core,
        snapshotAckDigest: hash(core.schema, core),
      });
    },
    resolveTransitionSnapshot: (input) => {
      const acknowledgement = verifyPmExplorationRecoverySnapshotAck(input, {
        manifestDigest: captured.manifestDigest,
      });
      const composite =
        acknowledgement.schema === PM_EXPLORATION_RECOVERY_SET_ACK_SCHEMA;
      const binding = deepFreeze({
        artifactTenantId: captured.artifactTenantId,
        digest: acknowledgement.artifactDigest,
        purpose: captured.purpose,
        ref: acknowledgement.artifactRef,
        retention: "ledger",
        schema: EVOLUTION_ARTIFACT_DURABILITY_BINDING_SCHEMA,
        type: composite ? RECOVERY_SET_TYPE : SNAPSHOT_TYPE,
      });
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
      if (isPromise(resolved)) {
        corrupt("PM recovery snapshot resolve must be synchronous");
      }
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
      const artifactBytes = snapshotBytes(
        resolved.bytes,
        MAX_SNAPSHOT_BYTES + MAX_WORKSPACE_SNAPSHOT_BYTES + 1024 * 1024,
      );
      if (hashBytes(artifactBytes) !== acknowledgement.artifactDigest) {
        corrupt("PM recovery snapshot resolution digest mismatch");
      }
      const decoded = composite
        ? decodeRecoverySet(
            artifactBytes,
            acknowledgement,
            captured.manifestDigest,
          )
        : {
            databaseSeal: null,
            databaseBytes: artifactBytes,
            workspaceSeal: null,
            workspaceBytes: null,
          };
      if (
        decoded.databaseBytes.byteLength !==
          acknowledgement.databaseSnapshotBytes ||
        hashBytes(decoded.databaseBytes, DATABASE_SNAPSHOT_DOMAIN) !==
          acknowledgement.databaseSnapshotDigest
      ) {
        corrupt("PM recovery database snapshot resolution is invalid");
      }
      return Object.freeze({
        schema: PM_EXPLORATION_RECOVERY_SNAPSHOT_RESOLUTION_SCHEMA,
        authenticated: true,
        durable: true,
        readbackVerified: true,
        manifestDigest: captured.manifestDigest,
        acknowledgement,
        databaseSeal: decoded.databaseSeal,
        databaseBytes: Buffer.from(decoded.databaseBytes),
        workspaceSeal: decoded.workspaceSeal,
        workspaceBytes:
          decoded.workspaceBytes === null
            ? null
            : Buffer.from(decoded.workspaceBytes),
        durabilityReceiptDigest: resolved.receiptDigest,
        qualifiesForPromotion: false,
      });
    },
  });
}

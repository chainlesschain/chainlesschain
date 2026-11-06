"use strict";

// Offline handoff contracts. A target descriptor is a user-selected destination,
// not an authorization grant. Only its native host holds the cancellation key.
const crypto = require("node:crypto");
const { isProxy } = require("node:util").types;
const {
  goalError,
  upgradeLegacyGoal,
  MAX_GOAL_RECORD_BYTES,
} = require("./goal-contract.js");
const {
  digestBusinessObjectContent,
  validateBusinessObjectRef,
} = require("./business-object-contract.js");

const TARGET_SCHEMA = "chainlesschain.goal-import-target/v1";
const TRANSFER_SCHEMA = "chainlesschain.goal-transfer/v1";
const CANCELLATION_SCHEMA = "chainlesschain.goal-transfer-cancellation/v1";
const MAX_TRANSFER_BYTES = 196608;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,255}$/u;
const HASH = /^sha256:[a-f0-9]{64}$/u;

function fail() {
  throw goalError("GOAL_TRANSFER_INVALID");
}
function exact(value, keys) {
  if (
    !value ||
    Array.isArray(value) ||
    typeof value !== "object" ||
    isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).length !== keys.length ||
    keys.some((k) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, k);
      return !descriptor || !descriptor.enumerable || !("value" in descriptor);
    })
  )
    fail();
}
function identifier(value) {
  if (typeof value !== "string" || !ID.test(value)) fail();
}
function timestamp(value) {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    fail();
}
function checkedCopy(input) {
  try {
    digestBusinessObjectContent(input);
    return JSON.parse(JSON.stringify(input));
  } catch {
    fail();
  }
}
function rawDigest(raw) {
  return `sha256:${crypto.createHash("sha256").update(raw, "utf8").digest("hex")}`;
}

function validateGoalImportTarget(input) {
  const target = checkedCopy(input);
  exact(target, [
    "schema",
    "id",
    "storeId",
    "ownerRef",
    "projectRef",
    "publicKey",
    "createdAt",
    "expiresAt",
  ]);
  if (target.schema !== TARGET_SCHEMA) fail();
  for (const key of ["id", "storeId", "ownerRef"]) identifier(target[key]);
  if (
    !target.ownerRef.startsWith("did:") ||
    !target.storeId.startsWith("project-goals-")
  )
    fail();
  const ref = validateBusinessObjectRef(target.projectRef);
  if (
    ref.type !== "Project" ||
    ref.sourceKind !== "desktop.project-goals" ||
    ref.scope.kind !== "personal" ||
    ref.scope.id !== target.ownerRef
  )
    fail();
  timestamp(target.createdAt);
  timestamp(target.expiresAt);
  if (
    target.expiresAt <= target.createdAt ||
    Date.parse(target.expiresAt) - Date.parse(target.createdAt) > 86400000
  )
    fail();
  if (typeof target.publicKey !== "string" || target.publicKey.length > 256)
    fail();
  try {
    const key = crypto.createPublicKey({
      key: Buffer.from(target.publicKey, "base64"),
      type: "spki",
      format: "der",
    });
    if (
      key.asymmetricKeyType !== "ed25519" ||
      key.export({ type: "spki", format: "der" }).toString("base64") !==
        target.publicKey
    )
      fail();
  } catch {
    fail();
  }
  return target;
}

function transferMetadata(value) {
  return {
    schema: value.schema,
    target: value.target,
    source: value.source,
    backupDigest: value.backupDigest,
  };
}
function validateGoalTransfer(input) {
  // Validate the raw backup separately: generic JSON contracts cap all strings
  // together at 64 KiB, whereas this envelope carries that complete backup.
  exact(input, [
    "schema",
    "target",
    "source",
    "backup",
    "backupDigest",
    "digest",
  ]);
  if (
    input.schema !== TRANSFER_SCHEMA ||
    typeof input.backup !== "string" ||
    Buffer.byteLength(input.backup, "utf8") > MAX_GOAL_RECORD_BYTES ||
    Buffer.byteLength(JSON.stringify(input), "utf8") > MAX_TRANSFER_BYTES
  )
    fail();
  const target = validateGoalImportTarget(input.target),
    source = checkedCopy(input.source);
  exact(source, ["storeId", "id", "revision", "digest"]);
  identifier(source.id);
  identifier(source.storeId);
  if (
    !/^cli-goals-[a-f0-9]{64}$/u.test(source.storeId) ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/u.test(source.id) ||
    source.id.includes("..") ||
    !Number.isSafeInteger(source.revision) ||
    source.revision < 1 ||
    !HASH.test(source.digest)
  )
    fail();
  let record;
  try {
    const original = JSON.parse(input.backup);
    if (original.ownerRef != null || original.projectRef != null) fail();
    record = upgradeLegacyGoal(original, source.storeId);
  } catch {
    fail();
  }
  if (
    record.id !== source.id ||
    record.storeId !== source.storeId ||
    record.revision !== source.revision ||
    record.ownerRef !== null ||
    record.projectRef !== null ||
    digestBusinessObjectContent(record) !== source.digest ||
    record.executionState !== "idle" ||
    record.triggerRefs.length ||
    record.nextCheckAt !== null
  )
    fail();
  const result = {
    schema: TRANSFER_SCHEMA,
    target,
    source,
    backup: input.backup,
    backupDigest: input.backupDigest,
    digest: input.digest,
  };
  if (
    result.backupDigest !== rawDigest(result.backup) ||
    result.digest !== digestBusinessObjectContent(transferMetadata(result))
  )
    fail();
  return result;
}
function createGoalTransfer({ target, backup, storeId }) {
  const record = upgradeLegacyGoal(JSON.parse(backup), storeId);
  const value = {
    schema: TRANSFER_SCHEMA,
    target: validateGoalImportTarget(target),
    source: {
      storeId,
      id: record.id,
      revision: record.revision,
      digest: digestBusinessObjectContent(record),
    },
    backup,
    backupDigest: rawDigest(backup),
  };
  return validateGoalTransfer({
    ...value,
    digest: digestBusinessObjectContent(transferMetadata(value)),
  });
}

function cancellationPayload(value) {
  return {
    schema: value.schema,
    targetId: value.targetId,
    targetDigest: value.targetDigest,
    state: value.state,
    at: value.at,
  };
}
function signGoalTransferCancellation(target, privateKey, at) {
  const value = {
    schema: CANCELLATION_SCHEMA,
    targetId: target.id,
    targetDigest: digestBusinessObjectContent(validateGoalImportTarget(target)),
    state: "cancelled",
    at,
  };
  timestamp(at);
  const signature = crypto
    .sign(null, Buffer.from(digestBusinessObjectContent(value)), privateKey)
    .toString("base64");
  return { ...value, signature };
}
function verifyGoalTransferCancellation(input, descriptor) {
  const value = checkedCopy(input),
    target = validateGoalImportTarget(descriptor);
  exact(value, [
    "schema",
    "targetId",
    "targetDigest",
    "state",
    "at",
    "signature",
  ]);
  timestamp(value.at);
  if (
    value.schema !== CANCELLATION_SCHEMA ||
    value.targetId !== target.id ||
    value.targetDigest !== digestBusinessObjectContent(target) ||
    value.state !== "cancelled" ||
    typeof value.signature !== "string" ||
    !/^[A-Za-z0-9+/]{86}==$/u.test(value.signature)
  )
    fail();
  const key = crypto.createPublicKey({
    key: Buffer.from(target.publicKey, "base64"),
    format: "der",
    type: "spki",
  });
  if (
    !crypto.verify(
      null,
      Buffer.from(digestBusinessObjectContent(cancellationPayload(value))),
      key,
      Buffer.from(value.signature, "base64"),
    )
  )
    throw goalError("GOAL_TRANSFER_CANCELLATION_INVALID");
  return value;
}

module.exports = {
  TARGET_SCHEMA,
  TRANSFER_SCHEMA,
  MAX_TRANSFER_BYTES,
  rawDigest,
  validateGoalImportTarget,
  validateGoalTransfer,
  createGoalTransfer,
  signGoalTransferCancellation,
  verifyGoalTransferCancellation,
};

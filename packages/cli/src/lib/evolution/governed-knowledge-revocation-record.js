import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";
import { verifyGovernedKnowledgeRecord } from "./governed-knowledge-record.js";

// Immutable prepared-record protocol only; no executor, writer, or authority brand.
export const GOVERNED_KNOWLEDGE_DEPENDENCY_PREPARED_SCHEMA =
  "chainlesschain.governed-knowledge-dependencies-prepared/v1";
export const GOVERNED_KNOWLEDGE_DEPENDENCY_PREPARED_EVENT_TYPE =
  "knowledge.revocation-dependencies.prepared";
export const GOVERNED_KNOWLEDGE_DEPENDENCY_LEDGER_CORRUPT_CODE =
  "CC_GOVERNED_KNOWLEDGE_DEPENDENCY_LEDGER_CORRUPT";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const PREPARED_KEYS = new Set([
  "deviceId",
  "knowledge",
  "operationDigest",
  "preparedAt",
  "recordDigest",
  "schema",
  "tenantId",
]);
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

function clone(value) {
  return structuredClone(value);
}

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function corrupt(message) {
  const error = new Error(message);
  error.code = GOVERNED_KNOWLEDGE_DEPENDENCY_LEDGER_CORRUPT_CODE;
  throw error;
}

function exact(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    corrupt(`${label} is not a plain object`);
  }
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.size ||
    actual.some((key) => typeof key !== "string" || !keys.has(key))
  ) {
    corrupt(`${label} has an invalid shape`);
  }
  return value;
}

function identifier(value, label) {
  if (typeof value !== "string" || !ID.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

export function digestGovernedKnowledgeDependencyOperation({
  tenantId,
  deviceId,
  knowledge,
}) {
  return hash(GOVERNED_KNOWLEDGE_DEPENDENCY_PREPARED_SCHEMA, {
    tenantId,
    deviceId,
    knowledge,
  });
}

function preparedCore(value) {
  return {
    schema: value.schema,
    tenantId: value.tenantId,
    deviceId: value.deviceId,
    operationDigest: value.operationDigest,
    knowledge: value.knowledge,
    preparedAt: value.preparedAt,
  };
}

export function verifyGovernedKnowledgeDependencyPrepared(
  value,
  descriptorValue,
) {
  exact(value, PREPARED_KEYS, "dependency prepared record");
  identifier(value.deviceId, "dependency prepared deviceId");
  const knowledge = verifyGovernedKnowledgeRecord(value.knowledge, {
    tenantId: descriptorValue.tenantId,
  });
  const operationDigest = digestGovernedKnowledgeDependencyOperation({
    tenantId: descriptorValue.tenantId,
    deviceId: descriptorValue.deviceId,
    knowledge,
  });
  if (
    value.schema !== GOVERNED_KNOWLEDGE_DEPENDENCY_PREPARED_SCHEMA ||
    value.tenantId !== descriptorValue.tenantId ||
    value.deviceId !== descriptorValue.deviceId ||
    !["tombstone", "revoke"].includes(knowledge.action) ||
    value.operationDigest !== operationDigest ||
    !Number.isFinite(Date.parse(value.preparedAt)) ||
    value.recordDigest !==
      hash(GOVERNED_KNOWLEDGE_DEPENDENCY_PREPARED_SCHEMA, preparedCore(value))
  ) {
    corrupt("dependency prepared record is invalid");
  }
  return freeze(clone(value));
}

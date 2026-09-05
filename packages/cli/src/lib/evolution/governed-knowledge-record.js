import { types as utilTypes } from "node:util";

// Pure wire-record validation shared by synchronization and mandatory Ledger
// admission. This module cannot mint execution brands or access persistence.
export const GOVERNED_KNOWLEDGE_SYNC_SCHEMA =
  "chainlesschain.governed-evolution-knowledge-sync/v1";
export const GOVERNED_KNOWLEDGE_SCOPE = Object.freeze({
  PERSONAL: "personal",
  PROJECT: "project",
  TEAM: "team",
  ORG: "org",
});

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const SCOPES = new Set(Object.values(GOVERNED_KNOWLEDGE_SCOPE));
const ACTIONS = new Set(["upsert", "tombstone", "revoke"]);
// A durable receipt for a different kind of effect is not a revocation.
// In particular, tombstoning metadata must never count as stopping an active Skill.
const REVOCATION_DISPOSITIONS = new Map([
  ["wiki", new Set(["tombstone", "quarantine"])],
  ["candidate", new Set(["reject-candidate", "quarantine"])],
  ["active-skill", new Set(["rollback-active", "quarantine"])],
]);
function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function record(value, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new TypeError(`${label} must be a plain object`);
  for (const key of Reflect.ownKeys(value)) {
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== "string" || !Object.hasOwn(property, "value"))
      throw new TypeError(`${label} must contain only data properties`);
  }
  return value;
}

function id(value, label) {
  if (typeof value !== "string" || !ID.test(value))
    throw new TypeError(`${label} is invalid`);
  return value;
}

function digest(value, label) {
  if (typeof value !== "string" || !DIGEST.test(value))
    throw new TypeError(`${label} must be sha256-bound`);
  return value;
}

function vectorClock(value) {
  record(value, "vectorClock");
  const entries = Object.entries(value);
  if (entries.length < 1 || entries.length > 64)
    throw new TypeError("vectorClock is empty or unbounded");
  const result = {};
  for (const [deviceId, revision] of entries.sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    id(deviceId, "vectorClock device");
    if (!Number.isSafeInteger(revision) || revision < 0)
      throw new TypeError("vectorClock revision is invalid");
    result[deviceId] = revision;
  }
  return result;
}

function normalizeDependencies(value, action) {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || value.length > 256)
    throw new TypeError("dependency dispositions are unbounded");
  const seen = new Set();
  const result = [];
  for (let index = 0; index < value.length; index += 1) {
    const property = Object.getOwnPropertyDescriptor(value, String(index));
    if (!property || !Object.hasOwn(property, "value"))
      throw new TypeError("dependency dispositions must be dense data");
    const entry = property.value;
    record(entry, "dependency disposition");
    const normalized = {
      kind: id(entry.kind, "dependency kind"),
      digest: digest(entry.digest, "dependency digest"),
      disposition: id(entry.disposition, "dependency disposition"),
    };
    const key = `${normalized.kind}:${normalized.digest}`;
    if (seen.has(key)) throw new TypeError("duplicate dependency disposition");
    seen.add(key);
    if (
      ["tombstone", "revoke"].includes(action) &&
      !REVOCATION_DISPOSITIONS.get(normalized.kind)?.has(normalized.disposition)
    )
      throw new TypeError("revocation dependency disposition is unsafe");
    result.push(normalized);
  }
  return result;
}

function normalizeRecord(input, descriptor) {
  record(input, "knowledge record");
  const action = ACTIONS.has(input.action) ? input.action : null;
  const scope = SCOPES.has(input.scope) ? input.scope : null;
  if (!action || !scope || input.tenantId !== descriptor.tenantId)
    throw new TypeError("knowledge record boundary is invalid");
  const dependencies = normalizeDependencies(input.dependencies || [], action);
  if (
    ["team", "org"].includes(scope) &&
    !DIGEST.test(input.approvalReceiptDigest || "")
  )
    throw new TypeError("shared knowledge requires approval");
  if (
    ["tombstone", "revoke"].includes(action) &&
    (!DIGEST.test(input.revocationReceiptDigest || "") ||
      dependencies.length < 1)
  )
    throw new TypeError(
      "revocation must bind its receipt and dependency graph",
    );
  const normalized = freeze({
    schema: GOVERNED_KNOWLEDGE_SYNC_SCHEMA,
    tenantId: descriptor.tenantId,
    knowledgeId: id(input.knowledgeId, "knowledgeId"),
    scope,
    scopeId: id(input.scopeId, "scopeId"),
    action,
    contentDigest: digest(input.contentDigest, "contentDigest"),
    vectorClock: vectorClock(input.vectorClock),
    approvalReceiptDigest: input.approvalReceiptDigest || null,
    revocationReceiptDigest: input.revocationReceiptDigest || null,
    dependencies,
  });
  return normalized;
}

export function verifyGovernedKnowledgeRecord(input, { tenantId } = {}) {
  return normalizeRecord(input, { tenantId: id(tenantId, "tenantId") });
}

export { vectorClock as normalizeGovernedKnowledgeVectorClock };

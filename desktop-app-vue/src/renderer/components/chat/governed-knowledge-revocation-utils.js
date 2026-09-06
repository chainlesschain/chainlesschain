const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const SCHEMA = "chainlesschain.governed-evolution-knowledge-sync/v1";
const DRAFT_KEYS = new Set([
  "schema",
  "tenantId",
  "knowledgeId",
  "scope",
  "scopeId",
  "action",
  "contentDigest",
  "vectorClock",
  "approvalReceiptDigest",
  "revocationReceiptDigest",
]);
const KNOWLEDGE_KEYS = new Set([...DRAFT_KEYS, "dependencies"]);
const PREPARE_KEYS = new Set([
  "authenticated",
  "durable",
  "operationDigest",
  "inventoryDigest",
  "knowledge",
]);
const PUBLISH_KEYS = new Set([
  "authenticated",
  "durable",
  "recoveredPlan",
  "operationDigest",
  "envelopeDigest",
  "knowledgeId",
  "contentDigest",
  "dependencyCount",
]);
const DISPOSITIONS = new Map([
  ["active-skill", new Set(["rollback-active", "quarantine"])],
  ["candidate", new Set(["reject-candidate", "quarantine"])],
  ["wiki", new Set(["tombstone", "quarantine"])],
]);
const PREPARED = new WeakSet();

function plain(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value))
  );
}

function exact(value, keys) {
  return plain(value) && Object.keys(value).every((key) => keys.has(key));
}

function validVectorClock(value) {
  if (!plain(value)) {
    return false;
  }
  const entries = Object.entries(value);
  return (
    entries.length > 0 &&
    entries.length <= 64 &&
    entries.every(
      ([deviceId, revision]) =>
        ID.test(deviceId) && Number.isSafeInteger(revision) && revision >= 0,
    )
  );
}

function validKnowledge(value, { dependencies }) {
  if (
    !exact(value, dependencies ? KNOWLEDGE_KEYS : DRAFT_KEYS) ||
    (dependencies
      ? value.schema !== SCHEMA
      : value.schema !== undefined && value.schema !== SCHEMA) ||
    !ID.test(value.tenantId || "") ||
    !ID.test(value.knowledgeId || "") ||
    !["personal", "project", "team", "org"].includes(value.scope) ||
    !ID.test(value.scopeId || "") ||
    !["revoke", "tombstone"].includes(value.action) ||
    !DIGEST.test(value.contentDigest || "") ||
    !validVectorClock(value.vectorClock) ||
    !DIGEST.test(value.revocationReceiptDigest || "") ||
    !(
      value.approvalReceiptDigest === null ||
      DIGEST.test(value.approvalReceiptDigest || "")
    ) ||
    (["team", "org"].includes(value.scope) &&
      !DIGEST.test(value.approvalReceiptDigest || ""))
  ) {
    return false;
  }
  if (!dependencies) {
    return !Object.hasOwn(value, "dependencies");
  }
  if (
    !Array.isArray(value.dependencies) ||
    value.dependencies.length < 1 ||
    value.dependencies.length > 256
  ) {
    return false;
  }
  const seen = new Set();
  return value.dependencies.every((entry) => {
    if (
      !plain(entry) ||
      Object.keys(entry).length !== 3 ||
      !Object.hasOwn(entry, "kind") ||
      !Object.hasOwn(entry, "digest") ||
      !Object.hasOwn(entry, "disposition") ||
      !DIGEST.test(entry.digest || "") ||
      !DISPOSITIONS.get(entry.kind)?.has(entry.disposition)
    ) {
      return false;
    }
    const key = `${entry.kind}:${entry.digest}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function parseGovernedKnowledgeRevocationDraft(recordJson) {
  let record;
  try {
    record = JSON.parse(recordJson);
  } catch {
    throw new Error("撤销记录必须是有效 JSON");
  }
  if (!validKnowledge(record, { dependencies: false })) {
    throw new Error("撤销记录字段、作用域、摘要或时钟无效");
  }
  return structuredClone(record);
}

export function validateGovernedKnowledgeRevocationPrepareResponse(response) {
  const value = response?.result;
  if (
    response?.success !== true ||
    !exact(value, PREPARE_KEYS) ||
    value.authenticated !== true ||
    value.durable !== true ||
    !DIGEST.test(value.operationDigest || "") ||
    !DIGEST.test(value.inventoryDigest || "") ||
    !validKnowledge(value.knowledge, { dependencies: true })
  ) {
    throw new Error(response?.error || "撤销计划响应未通过安全校验");
  }
  const summary = Object.freeze({
    operationDigest: value.operationDigest,
    inventoryDigest: value.inventoryDigest,
    knowledgeId: value.knowledge.knowledgeId,
    scope: value.knowledge.scope,
    scopeId: value.knowledge.scopeId,
    action: value.knowledge.action,
    contentDigest: value.knowledge.contentDigest,
    dependencies: Object.freeze(
      value.knowledge.dependencies.map((entry) => Object.freeze({ ...entry })),
    ),
  });
  PREPARED.add(summary);
  return summary;
}

export function governedKnowledgeRevocationConfirmation(summary) {
  if (!PREPARED.has(summary)) {
    throw new Error("必须先验证持久撤销计划");
  }
  return `REVOKE ${summary.knowledgeId}`;
}

export function buildGovernedKnowledgeRevocationPublishRequest(
  summary,
  confirmation,
  acknowledged,
) {
  if (
    !PREPARED.has(summary) ||
    acknowledged !== true ||
    confirmation !== governedKnowledgeRevocationConfirmation(summary)
  ) {
    throw new Error("必须核对影响并输入完整撤销确认短语");
  }
  return { operationDigest: summary.operationDigest };
}

export function validateGovernedKnowledgeRevocationPublishResponse(
  response,
  summary,
) {
  const value = response?.result;
  if (
    !PREPARED.has(summary) ||
    response?.success !== true ||
    !exact(value, PUBLISH_KEYS) ||
    value.authenticated !== true ||
    value.durable !== true ||
    value.recoveredPlan !== true ||
    value.operationDigest !== summary.operationDigest ||
    value.knowledgeId !== summary.knowledgeId ||
    value.contentDigest !== summary.contentDigest ||
    value.dependencyCount !== summary.dependencies.length ||
    !DIGEST.test(value.envelopeDigest || "")
  ) {
    throw new Error(response?.error || "撤销发布结果未通过安全校验");
  }
  return Object.freeze({
    durable: true,
    knowledgeId: value.knowledgeId,
    operationDigest: value.operationDigest,
    envelopeDigest: value.envelopeDigest,
    dependencyCount: value.dependencyCount,
  });
}

export function shortRevocationDigest(value) {
  return DIGEST.test(value || "")
    ? `${value.slice(0, 15)}…${value.slice(-8)}`
    : "—";
}

"use strict";

const { randomUUID } = require("node:crypto");
const { MEMORY_RECEIPT_SCHEMA, CONTEXT_ERROR_CODES } = require("./constants.js");
const { canonicalDigest } = require("./canonical.js");
const {
  normalizeMemoryRecord,
  normalizeSourceRef,
  normalizeProvenance,
  normalizeRetentionPolicy,
  assertScope,
  boundedString,
  boundedNumber,
  boundedInteger,
  booleanValue,
  identifier,
  stringSet,
  objectValue,
  assertKnownFields,
  timestamp,
} = require("./contracts.js");
const { invalidArgument, kernelError } = require("./errors.js");

const TRANSITIONS = Object.freeze({
  candidate: new Set(["active", "deleted"]),
  active: new Set(["reinforced", "superseded", "archived", "expired", "deleted"]),
  reinforced: new Set(["reinforced", "superseded", "archived", "expired", "deleted"]),
  superseded: new Set(["archived", "expired", "deleted"]),
  archived: new Set(["active", "expired", "deleted"]),
  expired: new Set(["archived", "active", "deleted"]),
  deleted: new Set(["purged"]),
  purged: new Set(),
});

const PROPOSAL_FIELDS = new Set([
  "memoryId",
  "scope",
  "scopeId",
  "category",
  "content",
  "contentRef",
  "summary",
  "provenance",
  "evidenceRefs",
  "confidence",
  "importance",
  "tags",
  "sensitivity",
  "allowedSinks",
  "retentionPolicy",
  "activate",
  "createdAt",
  "supersedes",
]);

function isoNow(clock) {
  const epoch = typeof clock === "function" ? Number(clock()) : Date.now();
  if (!Number.isFinite(epoch)) throw invalidArgument("clock returned an invalid timestamp");
  return new Date(epoch).toISOString();
}

function createMemoryCandidate(input, options = {}) {
  const value = objectValue(input, "MemoryProposal");
  assertKnownFields(value, PROPOSAL_FIELDS, "MemoryProposal");
  const now = value.createdAt === undefined ? isoNow(options.clock) : timestamp(value.createdAt, "createdAt");
  const memoryId = value.memoryId || `mem-${(options.randomUUID || randomUUID)()}`;
  return normalizeMemoryRecord({
    schemaVersion: 1,
    memoryId,
    ...assertScope(value.scope, value.scopeId),
    category: identifier(value.category, "category"),
    content: boundedString(value.content, "content", { min: 1, max: 4 * 1024 * 1024 }),
    ...(value.contentRef === undefined ? {} : { contentRef: value.contentRef }),
    ...(value.summary === undefined
      ? {}
      : { summary: boundedString(value.summary, "summary", { min: 1, max: 16 * 1024 }) }),
    provenance: normalizeProvenance(value.provenance),
    evidenceRefs: (() => {
      if (!Array.isArray(value.evidenceRefs) || value.evidenceRefs.length === 0 || value.evidenceRefs.length > 128) {
        throw invalidArgument("evidenceRefs must contain 1-128 entries", { field: "evidenceRefs" });
      }
      return value.evidenceRefs.map((entry, index) => normalizeSourceRef(entry, `evidenceRefs[${index}]`));
    })(),
    confidence: boundedNumber(value.confidence, "confidence"),
    importance: boundedNumber(value.importance, "importance"),
    tags: stringSet(value.tags || [], "tags", { maxItems: 128, itemMax: 128 }),
    sensitivity: value.sensitivity,
    allowedSinks: stringSet(value.allowedSinks || [], "allowedSinks", { minItems: 1, maxItems: 128, itemMax: 128 }),
    state:
      value.activate === undefined
        ? "candidate"
        : booleanValue(value.activate, "activate")
          ? "active"
          : "candidate",
    retentionPolicy: normalizeRetentionPolicy(value.retentionPolicy),
    createdAt: now,
    updatedAt: now,
    accessCount: 0,
    ...(value.supersedes === undefined ? {} : { supersedes: value.supersedes }),
    revision: 1,
  });
}

function assertTransition(from, to) {
  if (!TRANSITIONS[from]?.has(to)) {
    throw kernelError(
      CONTEXT_ERROR_CODES.ILLEGAL_MEMORY_TRANSITION,
      `memory cannot transition from ${from} to ${to}`,
      { from, to },
    );
  }
}

const COMMAND_FIELDS = new Set([
  "type",
  "expectedRevision",
  "confidenceDelta",
  "importance",
  "evidenceRefs",
  "tags",
  "summary",
  "successorMemoryId",
  "deletionFence",
  "reason",
  "authority",
  "at",
]);

function applyMemoryCommand(recordInput, commandInput, options = {}) {
  const current = normalizeMemoryRecord(recordInput);
  const command = objectValue(commandInput, "MemoryCommand");
  assertKnownFields(command, COMMAND_FIELDS, "MemoryCommand");
  const expectedRevision = boundedInteger(command.expectedRevision, "expectedRevision", { min: 1 });
  if (expectedRevision !== current.revision) {
    throw kernelError(CONTEXT_ERROR_CODES.REVISION_CONFLICT, "memory revision does not match", {
      memoryId: current.memoryId,
      expectedRevision,
      actualRevision: current.revision,
    });
  }
  const type = boundedString(command.type, "type", { min: 1, max: 64 });
  const target = {
    activate: "active",
    reinforce: "reinforced",
    supersede: "superseded",
    archive: "archived",
    expire: "expired",
    delete: "deleted",
    purge: "purged",
  }[type];
  if (!target) throw invalidArgument("unsupported MemoryCommand type", { type });
  assertTransition(current.state, target);
  const at = command.at === undefined ? isoNow(options.clock) : timestamp(command.at, "at");
  const next = { ...current, state: target, updatedAt: at, revision: current.revision + 1 };

  if (type === "reinforce") {
    const delta = boundedNumber(command.confidenceDelta ?? 0.05, "confidenceDelta", { min: 0, max: 1 });
    next.confidence = Math.min(1, current.confidence + delta);
    if (command.importance !== undefined) next.importance = boundedNumber(command.importance, "importance");
    if (command.summary !== undefined) {
      next.summary = boundedString(command.summary, "summary", { min: 1, max: 16 * 1024 });
    }
    if (command.tags !== undefined) {
      const additional = stringSet(command.tags, "tags", { maxItems: 128, itemMax: 128 });
      next.tags = stringSet([...new Set([...current.tags, ...additional])], "tags", {
        maxItems: 128,
        itemMax: 128,
      });
    }
    if (command.evidenceRefs !== undefined) {
      if (!Array.isArray(command.evidenceRefs) || command.evidenceRefs.length > 128) {
        throw invalidArgument("evidenceRefs must be a bounded array", { field: "evidenceRefs" });
      }
      const combined = [
        ...current.evidenceRefs,
        ...command.evidenceRefs.map((entry, index) => normalizeSourceRef(entry, `evidenceRefs[${index}]`)),
      ];
      const unique = new Map(
        combined.map((entry) => [canonicalDigest(entry, "chainlesschain.source-ref/v1"), entry]),
      );
      if (unique.size > 128) throw invalidArgument("combined evidenceRefs exceeds 128 entries");
      next.evidenceRefs = [...unique.values()];
    }
  }
  if (type === "supersede") identifier(command.successorMemoryId, "successorMemoryId");
  if (type === "delete") {
    next.deletionFence = identifier(command.deletionFence, "deletionFence");
    next.content = "";
    delete next.summary;
    delete next.contentRef;
  }
  if (type === "purge") {
    if (identifier(command.deletionFence, "deletionFence") !== current.deletionFence) {
      throw kernelError(CONTEXT_ERROR_CODES.REVISION_CONFLICT, "purge fence does not match deletion tombstone", {
        memoryId: current.memoryId,
      });
    }
    next.content = "";
    delete next.summary;
    delete next.contentRef;
  }

  delete next.digest;
  const record = normalizeMemoryRecord(next);
  const event = {
    schema: "chainlesschain.memory-event/v1",
    eventId: `memory-event-${(options.randomUUID || randomUUID)()}`,
    type: `memory.${target}`,
    memoryId: record.memoryId,
    fromState: current.state,
    toState: target,
    previousRevision: current.revision,
    revision: record.revision,
    recordDigest: record.digest,
    at,
    ...(command.reason === undefined
      ? {}
      : { reason: boundedString(command.reason, "reason", { min: 1, max: 2048 }) }),
    ...(command.authority === undefined ? {} : { authority: identifier(command.authority, "authority") }),
    ...(command.successorMemoryId === undefined
      ? {}
      : { successorMemoryId: identifier(command.successorMemoryId, "successorMemoryId") }),
  };
  event.digest = canonicalDigest(event, "chainlesschain.memory-event/v1");
  const receipt = {
    schema: MEMORY_RECEIPT_SCHEMA,
    operation: type,
    status: "committed",
    memoryId: record.memoryId,
    previousRevision: current.revision,
    revision: record.revision,
    recordDigest: record.digest,
    eventDigest: event.digest,
    at,
  };
  receipt.digest = canonicalDigest(receipt, "chainlesschain.memory-receipt/v1");
  return { record, event, receipt };
}

function mergeReplicaRecord(localInput, incomingInput) {
  const local = normalizeMemoryRecord(localInput);
  const incoming = normalizeMemoryRecord(incomingInput);
  if (local.memoryId !== incoming.memoryId) throw invalidArgument("replica records must have the same memoryId");
  if (local.scope !== incoming.scope || local.scopeId !== incoming.scopeId) {
    throw kernelError(CONTEXT_ERROR_CODES.SCOPE_DENIED, "replica merge cannot change memory scope", {
      memoryId: local.memoryId,
    });
  }
  if (local.state === "purged") {
    if (incoming.state === "purged" && incoming.deletionFence === local.deletionFence) return local;
    throw kernelError(CONTEXT_ERROR_CODES.REPLICA_TOMBSTONE_FENCED, "purged memory cannot be restored by a replica", {
      memoryId: local.memoryId,
      deletionFence: local.deletionFence,
    });
  }
  if (local.state === "deleted" && !["deleted", "purged"].includes(incoming.state)) {
    throw kernelError(CONTEXT_ERROR_CODES.REPLICA_TOMBSTONE_FENCED, "deleted memory cannot be restored by a replica", {
      memoryId: local.memoryId,
      deletionFence: local.deletionFence,
    });
  }
  if (["deleted", "purged"].includes(local.state) && incoming.deletionFence !== local.deletionFence) {
    throw kernelError(CONTEXT_ERROR_CODES.REPLICA_TOMBSTONE_FENCED, "replica deletion fence does not match authority", {
      memoryId: local.memoryId,
    });
  }
  if (incoming.revision < local.revision) return local;
  if (incoming.revision === local.revision) {
    if (incoming.digest !== local.digest) {
      throw kernelError(CONTEXT_ERROR_CODES.REVISION_CONFLICT, "equal replica revisions have different digests", {
        memoryId: local.memoryId,
        revision: local.revision,
      });
    }
    return local;
  }
  if (
    incoming.sensitivity !== local.sensitivity ||
    JSON.stringify(incoming.allowedSinks) !== JSON.stringify(local.allowedSinks)
  ) {
    throw kernelError(CONTEXT_ERROR_CODES.SCOPE_DENIED, "replica merge cannot weaken data policy", {
      memoryId: local.memoryId,
    });
  }
  return incoming;
}

function tokenize(value) {
  return new Set(
    String(value || "")
      .toLowerCase()
      .split(/[^\p{L}\p{N}_-]+/u)
      .filter(Boolean)
      .slice(0, 2048),
  );
}

function lexicalRelevance(query, record) {
  if (query === "*") return 1;
  const queryTokens = tokenize(query);
  if (queryTokens.size === 0) return 0;
  const memoryTokens = tokenize(
    `${record.category} ${record.tags.join(" ")} ${record.summary || ""} ${record.content}`,
  );
  let matches = 0;
  for (const token of queryTokens) if (memoryTokens.has(token)) matches += 1;
  return matches / queryTokens.size;
}

const RECALL_FIELDS = new Set([
  "query",
  "sink",
  "scopeAdmissions",
  "limit",
  "tokenBudget",
  "now",
]);
function rankMemoryRecords(records, requestInput = {}) {
  const request = objectValue(requestInput, "MemoryRecallRequest");
  assertKnownFields(request, RECALL_FIELDS, "MemoryRecallRequest");
  const query = boundedString(request.query, "query", { min: 1, max: 32 * 1024 });
  const sink = boundedString(request.sink, "sink", { min: 1, max: 128 });
  const limit = boundedInteger(request.limit ?? 10, "limit", { min: 1, max: 1000 });
  const tokenBudget = boundedInteger(request.tokenBudget ?? 4096, "tokenBudget", {
    min: 1,
    max: 1_048_576,
  });
  const now = request.now === undefined ? new Date().toISOString() : timestamp(request.now, "now");
  if (!Array.isArray(request.scopeAdmissions) || request.scopeAdmissions.length === 0 || request.scopeAdmissions.length > 128) {
    throw invalidArgument("scopeAdmissions must contain 1-128 entries");
  }
  const admissions = request.scopeAdmissions.map((entry, index) =>
    assertScope(entry.scope, entry.scopeId, `scopeAdmissions[${index}].scope`),
  );
  const scored = records
    .map(normalizeMemoryRecord)
    .filter((record) => ["active", "reinforced"].includes(record.state))
    .filter(
      (record) =>
        !record.retentionPolicy.expiresAt ||
        Date.parse(record.retentionPolicy.expiresAt) > Date.parse(now),
    )
    .filter((record) =>
      admissions.some((entry) => entry.scope === record.scope && entry.scopeId === record.scopeId),
    )
    .filter((record) => record.allowedSinks.includes("*") || record.allowedSinks.includes(sink))
    .map((record) => {
      const lexical = lexicalRelevance(query, record);
      const relevance = Math.min(
        1,
        lexical * 0.65 + record.confidence * 0.2 + record.importance * 0.15,
      );
      return { record, relevance, lexical };
    })
    .filter((entry) => entry.lexical > 0)
    .sort(
      (left, right) =>
        right.relevance - left.relevance ||
        right.record.importance - left.record.importance ||
        left.record.memoryId.localeCompare(right.record.memoryId, "en"),
    );

  const results = [];
  let usedTokens = 0;
  const categories = new Map();
  for (const entry of scored) {
    if (results.length >= limit) break;
    const estimatedTokens = Math.max(1, Math.ceil(Buffer.byteLength(entry.record.content, "utf8") / 4));
    if (usedTokens + estimatedTokens > tokenBudget) continue;
    const categoryCount = categories.get(entry.record.category) || 0;
    if (
      categoryCount >= Math.max(2, Math.ceil(limit / 2)) &&
      scored.some((candidate) => !categories.has(candidate.record.category))
    ) {
      continue;
    }
    results.push({
      memoryId: entry.record.memoryId,
      scope: entry.record.scope,
      ...(entry.record.scopeId ? { scopeId: entry.record.scopeId } : {}),
      provenance: entry.record.provenance,
      confidence: entry.record.confidence,
      importance: entry.record.importance,
      relevance: Number(entry.relevance.toFixed(6)),
      estimatedTokens,
      truncated: false,
      record: entry.record,
    });
    usedTokens += estimatedTokens;
    categories.set(entry.record.category, categoryCount + 1);
  }
  const output = {
    query,
    sink,
    tokenBudget,
    usedTokens,
    totalCandidates: scored.length,
    results,
  };
  output.digest = canonicalDigest(output, "chainlesschain.memory-recall/v1");
  return output;
}

module.exports = {
  TRANSITIONS,
  createMemoryCandidate,
  assertTransition,
  applyMemoryCommand,
  mergeReplicaRecord,
  lexicalRelevance,
  rankMemoryRecords,
};

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  applyMemoryCommand,
  canonicalDigest,
  createMemoryCandidate,
} from "@chainlesschain/context-memory-kernel";
import {
  STORE_SCHEMA,
  stateDigest,
} from "../src/lib/context-memory-kernel/durable-memory-port.js";

const AT = "2026-11-08T00:00:00.000Z";
export const COMPOUND_FIXTURE_SEED = "memory-compound-query/v1";
export const sha256 = (bytes) =>
  "sha256:" + createHash("sha256").update(bytes).digest("hex");
const idFor = (index) => "compound-memory-" + String(index).padStart(6, "0");
const admissions = [
  { scope: "project", scopeId: "shared" },
  { scope: "user", scopeId: "shared" },
  { scope: "global" },
];

export function compoundScenarios() {
  const common = {
    scopeAdmissions: structuredClone(admissions),
    sink: "provider.local",
    states: ["active", "reinforced"],
    limit: 20,
  };
  const category = {
    ...structuredClone(common),
    category: "rare",
    tags: ["common", "focus"],
  };
  return [
    { name: "category-narrow", query: category, offset: 0 },
    {
      name: "tag-narrow",
      query: {
        ...structuredClone(common),
        category: "common",
        tags: ["rare-a", "rare-b"],
      },
      offset: 0,
    },
    {
      name: "cold-continuation",
      query: structuredClone(category),
      offset: 20,
    },
  ];
}

// This oracle intentionally imports no production query, comparison, cursor,
// or public-entry helpers. It scans full authority records and slices by offset;
// it never decodes the production cursor to decide the expected next page.
export function oracleMatches(record, options = {}) {
  if (
    options.includeTombstones !== true &&
    (record.state === "deleted" || record.state === "purged")
  )
    return false;
  if (options.category && record.category !== String(options.category))
    return false;
  if (
    options.scopeAdmissions !== undefined &&
    !options.scopeAdmissions.some(
      (scope) =>
        record.scope === scope.scope &&
        (record.scopeId ?? null) === (scope.scopeId ?? null),
    )
  )
    return false;
  if (
    options.sink &&
    !record.allowedSinks.some(
      (sink) => sink === "*" || sink === String(options.sink),
    )
  )
    return false;
  if (
    options.states !== undefined &&
    !options.states.map(String).includes(record.state)
  )
    return false;
  if (
    options.tags?.length &&
    !record.tags.some((tag) => options.tags.map(String).includes(tag))
  )
    return false;
  return true;
}

export function oracleCompare(left, right) {
  if (left.importance !== right.importance)
    return right.importance - left.importance;
  const timeOrder = right.updatedAt.localeCompare(left.updatedAt, "en");
  return timeOrder || left.memoryId.localeCompare(right.memoryId, "en");
}

export function oraclePublicEntry(record) {
  return {
    id: record.memoryId,
    content: record.content,
    category: record.category,
    importance: Math.max(1, Math.min(5, Math.round(record.importance * 5))),
    source: record.provenance.source,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    scope: record.scope,
    ...(record.scopeId ? { scope_id: record.scopeId } : {}),
    state: record.state,
    revision: record.revision,
    digest: record.digest,
  };
}

export function oraclePage(records, query, offset = 0) {
  const matches = records.filter((record) => oracleMatches(record, query));
  matches.sort(oracleCompare);
  const limit = query.limit ?? 20;
  return {
    entries: matches.slice(offset, offset + limit).map(oraclePublicEntry),
    matchingCount: matches.length,
    hasNext: offset + limit < matches.length,
  };
}

export function recordSetDigest(records) {
  return sha256(
    JSON.stringify(
      records
        .map((record) => [record.memoryId, record.digest])
        .sort((left, right) => left[0].localeCompare(right[0], "en")),
    ),
  );
}

function creationEvent(record, index) {
  const event = {
    schema: "chainlesschain.memory-event/v1",
    eventId: "compound-created-" + index,
    type: "memory." + record.state,
    memoryId: record.memoryId,
    fromState: null,
    toState: record.state,
    previousRevision: 0,
    revision: record.revision,
    recordDigest: record.digest,
    at: record.createdAt,
  };
  event.digest = canonicalDigest(event, "chainlesschain.memory-event/v1");
  return event;
}

export function createCompoundFixture(count) {
  assert.ok(Number.isSafeInteger(count) && count >= 1000 && count <= 100000);
  const state = {
    schema: STORE_SCHEMA,
    schemaVersion: 1,
    storeRevision: 0,
    records: {},
    events: [],
    reconciliations: {},
  };
  const rejected = { "category-narrow": [], "tag-narrow": [] };
  const scopes = [
    ...admissions,
    ...admissions,
    { scope: "project", scopeId: "other" },
    { scope: "agent", scopeId: "shared" },
  ];
  const sinks = [
    ["provider.local"],
    ["*"],
    ["*", "provider.local"],
    ["private"],
  ];
  for (let index = 0; index < count; index++) {
    const random = createHash("sha256")
      .update(COMPOUND_FIXTURE_SEED + ":" + index)
      .digest();
    let category =
      random[0] < 8 ? "rare" : random[0] < 232 ? "common" : "other";
    let scope = scopes[random[1] % scopes.length];
    let allowedSinks = sinks[random[2] % sinks.length];
    let tags = [];
    if (random[3] < 224) tags.push("common");
    if (random[4] < 8) tags.push("rare-a");
    if (random[5] < 8) tags.push("rare-b");
    let desiredState =
      random[6] < 128
        ? "active"
        : random[6] < 200
          ? "reinforced"
          : random[6] < 212
            ? "candidate"
            : random[6] < 224
              ? "archived"
              : random[6] < 240
                ? "deleted"
                : random[6] < 248
                  ? "purged"
                  : "expired";
    let importance = (random[8] % 5) / 10;
    let createdAt = "2026-11-0" + (6 + (random[7] % 3)) + "T00:00:00.000Z";

    // 64 guaranteed, tied admissible rows for each scenario. Their IDs hash to
    // multiple real authority shards. All background rows rank below them.
    if (index < 128) {
      category = index < 64 ? "rare" : "common";
      tags =
        index < 64
          ? ["common", "focus"]
          : index % 3 === 0
            ? ["rare-a"]
            : index % 3 === 1
              ? ["rare-b"]
              : ["rare-a", "rare-b"];
      scope = admissions[index % admissions.length];
      allowedSinks = sinks[index % 3];
      desiredState = index % 2 ? "reinforced" : "active";
      importance = 0.6;
      createdAt = AT;
    }
    // Each group has five higher-ranked records, each failing exactly one
    // predicate. Filtering after a top-k selection would return the wrong page.
    if (index >= 128 && index < 138) {
      const group = index < 133 ? "category-narrow" : "tag-narrow";
      const reason = (index - 128) % 5;
      category = group === "category-narrow" ? "rare" : "common";
      tags =
        group === "category-narrow"
          ? ["common", "focus"]
          : ["rare-a", "rare-b"];
      scope = admissions[0];
      allowedSinks = ["provider.local"];
      desiredState = "active";
      importance = 1;
      createdAt = AT;
      if (reason === 0) category = "other";
      if (reason === 1) scope = { scope: "agent", scopeId: "shared" };
      if (reason === 2) allowedSinks = ["private"];
      if (reason === 3) tags = ["unrelated"];
      if (reason === 4) desiredState = "archived";
      rejected[group].push(idFor(index));
    }
    if (index >= 138 && index < 144) {
      desiredState = [
        "deleted",
        "purged",
        "candidate",
        "archived",
        "expired",
        "superseded",
      ][index - 138];
      category = "common";
      tags = ["common"];
      scope = admissions[0];
      allowedSinks = ["provider.local"];
    }
    let record = createMemoryCandidate({
      memoryId: idFor(index),
      ...scope,
      category,
      content: "Synthetic compound query fixture record " + index,
      provenance: { source: "compound-query-fixture", observedAt: createdAt },
      evidenceRefs: [
        { store: "compound-query-fixture", id: "source-" + index },
      ],
      confidence: 0.5,
      importance,
      tags,
      sensitivity: "internal",
      allowedSinks,
      retentionPolicy: { mode: "durable" },
      activate: desiredState !== "candidate",
      createdAt,
    });
    state.events.push(creationEvent(record, index));
    const commands =
      desiredState === "purged"
        ? ["delete", "purge"]
        : ["active", "candidate"].includes(desiredState)
          ? []
          : [
              {
                reinforced: "reinforce",
                archived: "archive",
                expired: "expire",
                deleted: "delete",
                superseded: "supersede",
              }[desiredState],
            ];
    for (const [step, type] of commands.entries()) {
      const transition = applyMemoryCommand(
        record,
        {
          type,
          expectedRevision: record.revision,
          authority: "compound-query-fixture",
          at: createdAt,
          ...(type === "reinforce" ? { confidenceDelta: 0.01 } : {}),
          ...(["delete", "purge"].includes(type)
            ? { deletionFence: "compound-fence-" + index }
            : {}),
          ...(type === "supersede" ? { successorMemoryId: idFor(0) } : {}),
        },
        { randomUUID: () => "compound-" + index + "-" + step },
      );
      record = transition.record;
      state.events.push(transition.event);
    }
    state.records[record.memoryId] = record;
  }
  state.storeRevision = state.events.length;
  state.digest = stateDigest(state);
  const records = Object.values(state.records);
  for (const scenario of compoundScenarios()) {
    const page = oraclePage(records, scenario.query, scenario.offset);
    assert.ok(page.matchingCount >= 64, "fixture must exercise continuation");
    assert.equal(page.entries.length, 20);
    const denied = rejected[scenario.name] || rejected["category-narrow"];
    assert.ok(page.entries.every((entry) => !denied.includes(entry.id)));
  }
  return {
    state,
    metadata: {
      seed: COMPOUND_FIXTURE_SEED,
      count,
      eventCount: state.events.length,
      storeRevision: state.storeRevision,
      stateDigest: state.digest,
      recordsDigest: recordSetDigest(records),
      rejected,
      planted: { categoryCount: 64, tagCount: 64 },
      lifecycleIds: Object.fromEntries(
        [
          "deleted",
          "purged",
          "candidate",
          "archived",
          "expired",
          "superseded",
        ].map((name, offset) => [name, idFor(138 + offset)]),
      ),
    },
  };
}

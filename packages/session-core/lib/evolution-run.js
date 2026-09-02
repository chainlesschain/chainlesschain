"use strict";

const crypto = require("node:crypto");

const EVOLUTION_RUN_EVENT_SCHEMA = "chainlesschain.evolution-run-event/v1";
const EVOLUTION_RUN_PROJECTION_SCHEMA =
  "chainlesschain.evolution-run-projection/v1";
const EVOLUTION_RUN_SNAPSHOT_SCHEMA = "chainlesschain.evolution-run-snapshot/v1";

const EVENT_TYPES = Object.freeze({
  RUN_STARTED: "run-started",
  RAW_EVENT_REFERENCED: "raw-event-referenced",
  RAW_ARTIFACT_REFERENCED: "raw-artifact-referenced",
  RAW_ANNOTATED: "raw-annotated",
  RAW_TOMBSTONED: "raw-tombstoned",
  WIKI_REVISION_RECORDED: "wiki-revision-recorded",
  SKILL_CANDIDATE_RECORDED: "skill-candidate-recorded",
  EVAL_RECORDED: "eval-recorded",
  RELEASE_ACTIVATED: "release-activated",
  RELEASE_ROLLED_BACK: "release-rolled-back",
  RUN_COMPLETED: "run-completed",
});
const TYPE_SET = new Set(Object.values(EVENT_TYPES));
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const FORBIDDEN_DATA_KEYS = new Set([
  "content",
  "output",
  "payload",
  "prompt",
  "secret",
]);

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(canonical(value)).digest("hex")}`;
}

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function requiredString(value, name) {
  if (typeof value !== "string" || value.length === 0)
    throw new TypeError(`${name} is required`);
  return value;
}

function assertMetadataOnly(value, path = "data") {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_DATA_KEYS.has(key.toLowerCase())) {
      throw new Error(`${path}.${key} must be an artifact reference, not raw content`);
    }
    assertMetadataOnly(child, `${path}.${key}`);
  }
}

function normalizeEvent(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new TypeError("EvolutionRun event must be an object");
  if (input.schema !== EVOLUTION_RUN_EVENT_SCHEMA)
    throw new TypeError("EvolutionRun event schema is invalid");
  if (!TYPE_SET.has(input.type)) throw new TypeError("event type is invalid");
  if (!Number.isSafeInteger(input.sequence) || input.sequence <= 0)
    throw new TypeError("event sequence must be a positive safe integer");
  if (!DIGEST.test(input.payloadDigest ?? ""))
    throw new TypeError("payloadDigest must be sha256-bound");
  assertMetadataOnly(input.data);
  return freeze({
    schema: EVOLUTION_RUN_EVENT_SCHEMA,
    tenantId: requiredString(input.tenantId, "tenantId"),
    runId: requiredString(input.runId, "runId"),
    eventId: requiredString(input.eventId, "eventId"),
    sequence: input.sequence,
    type: input.type,
    subjectId: input.subjectId == null ? null : requiredString(input.subjectId, "subjectId"),
    payloadDigest: input.payloadDigest,
    artifactRef: input.artifactRef == null ? null : requiredString(input.artifactRef, "artifactRef"),
    keyRef: input.keyRef == null ? null : requiredString(input.keyRef, "keyRef"),
    data: clone(input.data ?? {}),
  });
}

function initialState(tenantId, runId) {
  return {
    schema: EVOLUTION_RUN_PROJECTION_SCHEMA,
    tenantId,
    runId,
    status: "pending",
    raw: { events: {}, artifacts: {}, annotations: {}, tombstones: {} },
    wiki: { revision: null, revisionDigest: null },
    registry: { candidates: {}, activeReleaseId: null, lastKnownGoodReleaseId: null },
    eval: { runs: {} },
    seenEvents: {},
    eventCount: 0,
    lastSequence: 0,
    eventRoot: digest({ tenantId, runId, genesis: true }),
  };
}

function apply(state, event) {
  const id = event.subjectId;
  switch (event.type) {
    case EVENT_TYPES.RUN_STARTED:
      state.status = "running";
      break;
    case EVENT_TYPES.RAW_EVENT_REFERENCED:
      state.raw.events[id] = {
        digest: event.payloadDigest,
        artifactRef: event.artifactRef,
        keyRef: event.keyRef,
      };
      break;
    case EVENT_TYPES.RAW_ARTIFACT_REFERENCED:
      state.raw.artifacts[id] = {
        digest: event.payloadDigest,
        artifactRef: event.artifactRef,
        keyRef: event.keyRef,
      };
      break;
    case EVENT_TYPES.RAW_ANNOTATED:
      state.raw.annotations[id] = {
        digest: event.payloadDigest,
        ...event.data,
      };
      break;
    case EVENT_TYPES.RAW_TOMBSTONED:
      state.raw.tombstones[id] = {
        digest: event.payloadDigest,
        keyRef: event.keyRef,
        reason: event.data.reason ?? null,
      };
      break;
    case EVENT_TYPES.WIKI_REVISION_RECORDED:
      state.wiki = { revision: id, revisionDigest: event.payloadDigest };
      break;
    case EVENT_TYPES.SKILL_CANDIDATE_RECORDED:
      state.registry.candidates[id] = {
        digest: event.payloadDigest,
        artifactRef: event.artifactRef,
      };
      break;
    case EVENT_TYPES.EVAL_RECORDED:
      state.eval.runs[id] = { digest: event.payloadDigest, ...event.data };
      break;
    case EVENT_TYPES.RELEASE_ACTIVATED:
      state.registry.lastKnownGoodReleaseId =
        state.registry.activeReleaseId ?? state.registry.lastKnownGoodReleaseId;
      state.registry.activeReleaseId = id;
      break;
    case EVENT_TYPES.RELEASE_ROLLED_BACK:
      state.registry.lastKnownGoodReleaseId = state.registry.activeReleaseId;
      state.registry.activeReleaseId = id;
      break;
    case EVENT_TYPES.RUN_COMPLETED:
      state.status = "completed";
      break;
  }
  state.eventRoot = digest({ previous: state.eventRoot, eventDigest: digest(event) });
  state.seenEvents[event.eventId] = digest(event);
  state.eventCount += 1;
  state.lastSequence = event.sequence;
}

function verifySnapshot(snapshot, tenantId, runId) {
  if (
    snapshot?.schema !== EVOLUTION_RUN_SNAPSHOT_SCHEMA ||
    snapshot.tenantId !== tenantId ||
    snapshot.runId !== runId ||
    snapshot.projectionDigest !== digest(snapshot.state)
  ) {
    throw new Error("EvolutionRun snapshot is invalid or belongs to another run");
  }
  return clone(snapshot.state);
}

function projectEvolutionRun(inputs, options = {}) {
  if (!Array.isArray(inputs)) throw new TypeError("events must be an array");
  const normalized = inputs.map(normalizeEvent);
  const first = normalized[0];
  const tenantId = options.tenantId ?? first?.tenantId ?? options.snapshot?.tenantId;
  const runId = options.runId ?? first?.runId ?? options.snapshot?.runId;
  requiredString(tenantId, "tenantId");
  requiredString(runId, "runId");
  const unique = new Map();
  for (const event of normalized) {
    if (event.tenantId !== tenantId || event.runId !== runId)
      throw new Error("cross-tenant or cross-run event rejected");
    const prior = unique.get(event.eventId);
    if (prior && canonical(prior) !== canonical(event))
      throw new Error("conflicting duplicate EvolutionRun eventId");
    unique.set(event.eventId, event);
  }
  const ordered = [...unique.values()].sort(
    (a, b) => a.sequence - b.sequence || a.eventId.localeCompare(b.eventId),
  );
  const seenSequences = new Set();
  for (const event of ordered) {
    if (seenSequences.has(event.sequence))
      throw new Error("EvolutionRun sequence must be unique");
    seenSequences.add(event.sequence);
  }
  const state = options.snapshot
    ? verifySnapshot(options.snapshot, tenantId, runId)
    : initialState(tenantId, runId);
  for (const event of ordered) {
    if (event.sequence <= state.lastSequence) {
      if (state.seenEvents[event.eventId] === digest(event)) continue;
      throw new Error("event is older than the compacted EvolutionRun boundary");
    }
    apply(state, event);
  }
  const stateWithoutDigest = clone(state);
  const projectionDigest = digest(stateWithoutDigest);
  return freeze({ ...stateWithoutDigest, projectionDigest });
}

function compactEvolutionRun(projection) {
  if (
    projection?.schema !== EVOLUTION_RUN_PROJECTION_SCHEMA ||
    projection.projectionDigest !==
      digest(Object.fromEntries(Object.entries(projection).filter(([k]) => k !== "projectionDigest")))
  ) {
    throw new Error("only a verified EvolutionRun projection can be compacted");
  }
  const state = Object.fromEntries(
    Object.entries(projection).filter(([key]) => key !== "projectionDigest"),
  );
  return freeze({
    schema: EVOLUTION_RUN_SNAPSHOT_SCHEMA,
    tenantId: projection.tenantId,
    runId: projection.runId,
    throughSequence: projection.lastSequence,
    state: clone(state),
    projectionDigest: digest(state),
  });
}

module.exports = {
  EVOLUTION_RUN_EVENT_SCHEMA,
  EVOLUTION_RUN_PROJECTION_SCHEMA,
  EVOLUTION_RUN_SNAPSHOT_SCHEMA,
  EVENT_TYPES,
  projectEvolutionRun,
  compactEvolutionRun,
};

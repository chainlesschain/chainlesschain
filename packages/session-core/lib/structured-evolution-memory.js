"use strict";

const crypto = require("node:crypto");

const STRUCTURED_MEMORY_EVENT_SCHEMA = "chainlesschain.structured-memory-event/v1";
const STRUCTURED_MEMORY_PROJECTION_SCHEMA = "chainlesschain.structured-memory-projection/v1";
const STRUCTURED_MEMORY_SNAPSHOT_SCHEMA = "chainlesschain.structured-memory-snapshot/v1";

const MEMORY_LAYER = Object.freeze({
  EPISODIC: "episodic",
  SEMANTIC: "semantic",
  PROCEDURAL: "procedural",
  POLICY: "policy",
});
const MEMORY_ACTION = Object.freeze({
  APPEND: "append",
  PROPOSE: "propose",
  ACCEPT: "accept",
  TOMBSTONE: "tombstone",
});
const LAYERS = new Set(Object.values(MEMORY_LAYER));
const ACTIONS = new Set(Object.values(MEMORY_ACTION));
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const FORBIDDEN_KEYS = new Set(["content", "payload", "prompt", "output", "secret"]);
const COMPACTION_FIELDS = [
  "requirements",
  "decisions",
  "openRisks",
  "failedAttempts",
  "tests",
  "goalState",
  "delegatedTasks",
  "memoryLineage",
];
const MEMORY_AUTHORITIES = new WeakSet();

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

function hash(value) {
  return `sha256:${crypto.createHash("sha256").update(canonical(value)).digest("hex")}`;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} is required`);
  return value;
}

function digest(value, name, nullable = false) {
  if (nullable && value == null) return null;
  if (!DIGEST.test(value || "")) throw new TypeError(`${name} must be sha256-bound`);
  return value;
}

function strings(value, name, { allowEmpty = true } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.length > 256 ||
      value.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw new TypeError(`${name} must be a bounded string list`);
  }
  return [...new Set(value)].sort();
}

function assertMetadataOnly(value, path = "metadata") {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) throw new Error(`${path}.${key} contains forbidden raw material`);
    assertMetadataOnly(child, `${path}.${key}`);
  }
}

function normalizeActor(input) {
  const actor = {
    actorId: requiredString(input?.actorId, "actor.actorId"),
    actorType: requiredString(input?.actorType, "actor.actorType"),
    role: requiredString(input?.role, "actor.role"),
  };
  if (!["agent", "human", "service"].includes(actor.actorType)) throw new TypeError("actor.actorType is invalid");
  return actor;
}

function createStructuredMemoryAuthority(input) {
  const authority = freeze({
    tenantId: requiredString(input?.tenantId, "authority.tenantId"),
    actor: normalizeActor(input),
    authorityDigest: digest(input?.authorityDigest, "authority.authorityDigest"),
  });
  MEMORY_AUTHORITIES.add(authority);
  return authority;
}

function consumeAuthority(value, tenantId) {
  if (!MEMORY_AUTHORITIES.has(value) || value.tenantId !== tenantId) {
    throw new Error("a branded tenant-scoped memory authority is required");
  }
  return value.actor;
}

function normalizeReceipts(input = {}) {
  return {
    critic: digest(input.critic, "receipts.critic", true),
    evaluator: digest(input.evaluator, "receipts.evaluator", true),
    promotion: digest(input.promotion, "receipts.promotion", true),
    policy: digest(input.policy, "receipts.policy", true),
  };
}

function normalizeEvent(input) {
  if (input?.schema !== STRUCTURED_MEMORY_EVENT_SCHEMA) throw new TypeError("structured memory event schema is invalid");
  if (!LAYERS.has(input.layer) || !ACTIONS.has(input.action)) throw new TypeError("memory layer or action is invalid");
  if (!Number.isSafeInteger(input.sequence) || input.sequence <= 0) throw new TypeError("event sequence is invalid");
  if (typeof input.automatic !== "boolean") throw new TypeError("automatic must be explicit");
  const event = {
    schema: STRUCTURED_MEMORY_EVENT_SCHEMA,
    tenantId: requiredString(input.tenantId, "tenantId"),
    eventId: requiredString(input.eventId, "eventId"),
    sequence: input.sequence,
    memoryId: requiredString(input.memoryId, "memoryId"),
    layer: input.layer,
    action: input.action,
    actor: normalizeActor(input.actor),
    automatic: input.automatic,
    contentDigest: digest(input.contentDigest, "contentDigest"),
    artifactRef: requiredString(input.artifactRef, "artifactRef"),
    evidenceRefs: strings(input.evidenceRefs || [], "evidenceRefs"),
    supersedes: strings(input.supersedes || [], "supersedes"),
    receipts: normalizeReceipts(input.receipts),
    timestamp: requiredString(input.timestamp, "timestamp"),
    metadata: clone(input.metadata || {}),
  };
  if (!Number.isFinite(Date.parse(event.timestamp))) throw new TypeError("timestamp must be an ISO timestamp");
  assertMetadataOnly(event.metadata);
  return freeze(event);
}

function authorize(event, current) {
  const { layer, action, actor, automatic, receipts } = event;
  if (current && current.layer !== layer) throw new Error("memoryId cannot cross memory layers");
  if (action === MEMORY_ACTION.TOMBSTONE && current && event.contentDigest !== current.contentDigest) {
    throw new Error("memory tombstone must bind the current content digest");
  }
  if (layer === MEMORY_LAYER.EPISODIC) {
    if (![MEMORY_ACTION.APPEND, MEMORY_ACTION.TOMBSTONE].includes(action)) throw new Error("episodic memory is append-only");
    if (action === MEMORY_ACTION.APPEND && current) throw new Error("episodic memory cannot silently overwrite an existing record");
    if (action === MEMORY_ACTION.TOMBSTONE && actor.role !== "governor") throw new Error("episodic deletion requires governor authority");
    return;
  }
  if (layer === MEMORY_LAYER.SEMANTIC) {
    if (action === MEMORY_ACTION.PROPOSE) {
      if (!["proposer", "child-agent"].includes(actor.role) || event.evidenceRefs.length === 0) {
        throw new Error("semantic proposals require scoped evidence and proposer authority");
      }
      if (current) throw new Error("semantic proposal cannot replace an existing memoryId");
      return;
    }
    if (action === MEMORY_ACTION.ACCEPT) {
      if (!current || current.status !== "proposed" || actor.role !== "governor" ||
          receipts.critic == null || receipts.evaluator == null || event.contentDigest !== current.contentDigest ||
          event.artifactRef !== current.artifactRef || canonical(event.evidenceRefs) !== canonical(current.evidenceRefs)) {
        throw new Error("semantic acceptance requires proposed state, critic, evaluator, and governor");
      }
      return;
    }
    if (action === MEMORY_ACTION.TOMBSTONE && actor.role === "governor") return;
    throw new Error("semantic memory transition is unauthorized");
  }
  if (layer === MEMORY_LAYER.PROCEDURAL) {
    if (action !== MEMORY_ACTION.ACCEPT || actor.role !== "promotion-controller" || receipts.promotion == null) {
      throw new Error("procedural memory can only change through the promotion controller");
    }
    return;
  }
  if (action === MEMORY_ACTION.ACCEPT) {
    if (automatic || actor.actorType !== "human" || actor.role !== "governor" || receipts.policy == null) {
      throw new Error("policy memory requires explicit human governor authority");
    }
    return;
  }
  if (action === MEMORY_ACTION.TOMBSTONE && !automatic && actor.actorType === "human" && actor.role === "governor") return;
  throw new Error("automatic experience cannot modify policy memory");
}

function initialProjection(tenantId) {
  return { schema: STRUCTURED_MEMORY_PROJECTION_SCHEMA, tenantId, sequence: 0,
    eventRoot: hash({ tenantId, genesis: true }), memories: {}, queue: [], tombstones: {}, seenEvents: {} };
}

function applyEvent(state, event) {
  const current = state.memories[event.memoryId];
  authorize(event, current);
  if (event.action === MEMORY_ACTION.TOMBSTONE) {
    state.tombstones[event.memoryId] = { eventId: event.eventId, contentDigest: event.contentDigest,
      timestamp: event.timestamp, layer: event.layer };
    delete state.memories[event.memoryId];
    state.queue = state.queue.filter((id) => id !== event.memoryId);
  } else {
    const status = event.action === MEMORY_ACTION.PROPOSE ? "proposed" : "active";
    state.memories[event.memoryId] = { memoryId: event.memoryId, layer: event.layer, status,
      contentDigest: event.contentDigest, artifactRef: event.artifactRef, evidenceRefs: event.evidenceRefs,
      supersedes: event.supersedes, receipts: event.receipts, actor: event.actor, automatic: event.automatic,
      updatedAt: event.timestamp };
    if (status === "proposed" && !state.queue.includes(event.memoryId)) state.queue.push(event.memoryId);
    if (status === "active") state.queue = state.queue.filter((id) => id !== event.memoryId);
  }
  const eventDigest = hash(event);
  state.eventRoot = hash({ previous: state.eventRoot, eventDigest });
  state.seenEvents[event.eventId] = eventDigest;
  state.sequence = event.sequence;
}

function projectStructuredMemory(inputs, options = {}) {
  if (!Array.isArray(inputs)) throw new TypeError("events must be an array");
  const normalized = inputs.map(normalizeEvent);
  const tenantId = options.tenantId || normalized[0]?.tenantId;
  requiredString(tenantId, "tenantId");
  const unique = new Map();
  for (const event of normalized) {
    if (event.tenantId !== tenantId) throw new Error("cross-tenant memory event rejected");
    const prior = unique.get(event.eventId);
    if (prior && canonical(prior) !== canonical(event)) throw new Error("conflicting memory eventId rejected");
    unique.set(event.eventId, event);
  }
  const events = [...unique.values()].sort((a, b) => a.sequence - b.sequence || a.eventId.localeCompare(b.eventId));
  if (options.state && (options.state.schema !== STRUCTURED_MEMORY_PROJECTION_SCHEMA ||
      options.state.tenantId !== tenantId || options.stateDigest !== hash(options.state))) {
    throw new Error("continued memory projection state is not digest-bound");
  }
  const state = options.state ? clone(options.state) : initialProjection(tenantId);
  const sequenceSet = new Set();
  for (const event of events) {
    if (sequenceSet.has(event.sequence)) throw new Error("memory event sequence must be unique");
    sequenceSet.add(event.sequence);
    const eventDigest = hash(event);
    if (state.seenEvents[event.eventId]) {
      if (state.seenEvents[event.eventId] !== eventDigest) throw new Error("conflicting memory eventId rejected");
      continue;
    }
    if (event.sequence !== state.sequence + 1) throw new Error("memory event sequence must be contiguous");
    applyEvent(state, event);
  }
  const projectionDigest = hash(state);
  return freeze({ ...state, projectionDigest });
}

function normalizeCompaction(input, projection) {
  const body = {};
  for (const field of COMPACTION_FIELDS) {
    if (field === "goalState") {
      if (!input?.goalState || typeof input.goalState !== "object" || Array.isArray(input.goalState)) {
        throw new TypeError("compaction.goalState is required");
      }
      body.goalState = clone(input.goalState);
      assertMetadataOnly(body.goalState, "goalState");
    } else body[field] = strings(input?.[field], `compaction.${field}`);
  }
  if (body.memoryLineage.length === 0) throw new TypeError("compaction.memoryLineage cannot be empty");
  return { schema: STRUCTURED_MEMORY_SNAPSHOT_SCHEMA, tenantId: projection.tenantId,
    throughSequence: projection.sequence, eventRoot: projection.eventRoot,
    projectionDigest: projection.projectionDigest, ...body };
}

function verifyPersistedSnapshot(snapshot, events, tenantId) {
  if (snapshot == null) return null;
  const core = Object.fromEntries(Object.entries(snapshot).filter(([key]) => key !== "snapshotDigest"));
  if (snapshot.schema !== STRUCTURED_MEMORY_SNAPSHOT_SCHEMA || snapshot.tenantId !== tenantId ||
      !DIGEST.test(snapshot.snapshotDigest || "") || snapshot.snapshotDigest !== hash(core) ||
      !Number.isSafeInteger(snapshot.throughSequence) || snapshot.throughSequence < 0) {
    throw new Error("persisted structured memory snapshot is invalid");
  }
  const boundaryEvents = events.filter((event) => event.sequence <= snapshot.throughSequence);
  const boundary = projectStructuredMemory(boundaryEvents, { tenantId });
  if (boundary.sequence !== snapshot.throughSequence || boundary.eventRoot !== snapshot.eventRoot ||
      boundary.projectionDigest !== snapshot.projectionDigest) {
    throw new Error("persisted structured memory snapshot does not match event lineage");
  }
  for (const field of COMPACTION_FIELDS) {
    if (field === "goalState") {
      if (!snapshot.goalState || typeof snapshot.goalState !== "object" || Array.isArray(snapshot.goalState)) {
        throw new Error("persisted structured memory snapshot omitted goal state");
      }
      assertMetadataOnly(snapshot.goalState, "goalState");
    } else strings(snapshot[field], `snapshot.${field}`);
  }
  if (snapshot.memoryLineage.length === 0) throw new Error("persisted snapshot omitted memory lineage");
  return freeze(clone(snapshot));
}

class StructuredEvolutionMemory {
  constructor({ tenantId, persistEvent, persistSnapshot, postCompactVerifier,
    initialEvents = [], initialSnapshot = null } = {}) {
    this.tenantId = requiredString(tenantId, "tenantId");
    if (typeof persistEvent !== "function" || typeof persistSnapshot !== "function" || typeof postCompactVerifier !== "function") {
      throw new TypeError("persistent event/snapshot ports and PostCompact verifier are required");
    }
    this._persistEvent = persistEvent;
    this._persistSnapshot = persistSnapshot;
    this._postCompactVerifier = postCompactVerifier;
    if (!Array.isArray(initialEvents)) throw new TypeError("initialEvents must be an array");
    this._events = initialEvents.map(normalizeEvent);
    this._projection = projectStructuredMemory(this._events, { tenantId: this.tenantId });
    this._snapshot = verifyPersistedSnapshot(initialSnapshot, this._events, this.tenantId);
  }

  async append(input) {
    const actor = consumeAuthority(input?.authority, this.tenantId);
    const eventInput = { ...input };
    delete eventInput.authority;
    const event = normalizeEvent({ ...eventInput, actor, schema: STRUCTURED_MEMORY_EVENT_SCHEMA, tenantId: this.tenantId,
      sequence: this._projection.sequence + 1 });
    const next = projectStructuredMemory([event], { tenantId: this.tenantId,
      state: Object.fromEntries(Object.entries(this._projection).filter(([key]) => key !== "projectionDigest")),
      stateDigest: this._projection.projectionDigest });
    const acknowledgement = await this._persistEvent(event);
    if (acknowledgement?.persisted !== true || acknowledgement.eventId !== event.eventId || acknowledgement.eventDigest !== hash(event)) {
      throw new Error("structured memory event persistence was not confirmed");
    }
    this._events.push(event);
    this._projection = next;
    return freeze({ event, projection: next });
  }

  projection() {
    return this._projection;
  }

  snapshot() {
    return this._snapshot;
  }

  async compact(input) {
    const previous = this._snapshot;
    const candidate = normalizeCompaction(input, this._projection);
    const snapshotDigest = hash(candidate);
    let verified = false;
    try {
      verified = await this._postCompactVerifier(freeze({ previous, candidate: freeze(clone(candidate)),
        snapshotDigest, projection: this._projection }));
    } catch {
      verified = false;
    }
    if (verified !== true) return freeze({ status: "restored", snapshot: previous, reason: "post-compact verification failed" });
    let acknowledgement;
    try {
      acknowledgement = await this._persistSnapshot(freeze({ ...candidate, snapshotDigest }));
    } catch {
      acknowledgement = null;
    }
    if (acknowledgement?.persisted !== true || acknowledgement.snapshotDigest !== snapshotDigest) {
      return freeze({ status: "restored", snapshot: previous, reason: "snapshot persistence was not confirmed" });
    }
    this._snapshot = freeze({ ...candidate, snapshotDigest });
    return freeze({ status: "compacted", snapshot: this._snapshot });
  }
}

module.exports = {
  STRUCTURED_MEMORY_EVENT_SCHEMA,
  STRUCTURED_MEMORY_PROJECTION_SCHEMA,
  STRUCTURED_MEMORY_SNAPSHOT_SCHEMA,
  MEMORY_LAYER,
  MEMORY_ACTION,
  StructuredEvolutionMemory,
  projectStructuredMemory,
  createStructuredMemoryAuthority,
};

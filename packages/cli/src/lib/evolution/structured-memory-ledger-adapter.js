import { createHash } from "node:crypto";
import structuredMemory from "@chainlesschain/session-core/structured-evolution-memory";
import {
  EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA,
  isEvolutionLedgerArtifactResolver,
} from "./evolution-artifact-ports.js";
import {
  EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA,
  EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA,
} from "./evolution-ledger.js";

const {
  STRUCTURED_MEMORY_EVENT_SCHEMA,
  STRUCTURED_MEMORY_SNAPSHOT_SCHEMA,
  StructuredEvolutionMemory,
  projectStructuredMemory,
} = structuredMemory;

export const STRUCTURED_MEMORY_LEDGER_EVENT_TYPE = "memory.event.persisted";
export const STRUCTURED_MEMORY_LEDGER_SNAPSHOT_TYPE = "memory.snapshot.persisted";
export const STRUCTURED_MEMORY_LEDGER_CORRUPT_CODE = "CC_STRUCTURED_MEMORY_LEDGER_CORRUPT";
export const STRUCTURED_MEMORY_LEDGER_CONFLICT_CODE = "CC_STRUCTURED_MEMORY_LEDGER_CONFLICT";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

function hash(value) {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} is required`);
  return value;
}

function fail(message) {
  const error = new Error(message);
  error.code = STRUCTURED_MEMORY_LEDGER_CORRUPT_CODE;
  throw error;
}

function conflict(message) {
  const error = new Error(message);
  error.code = STRUCTURED_MEMORY_LEDGER_CONFLICT_CODE;
  throw error;
}

function capture(owner, name) {
  if (typeof owner?.[name] !== "function") throw new TypeError(`${name} port is required`);
  return (...args) => Reflect.apply(owner[name], owner, args);
}

function descriptor(input) {
  return Object.freeze({
    tenantId: requiredString(input?.tenantId, "tenantId"),
    artifactTenantId: requiredString(input?.artifactTenantId, "artifactTenantId"),
    streamId: requiredString(input?.streamId, "streamId"),
    audience: requiredString(input?.audience, "audience"),
    purpose: requiredString(input?.purpose, "purpose"),
  });
}

function parseResolution(resolution, expectedType, options) {
  if (resolution?.schema !== EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA || resolution.authenticated !== true ||
      resolution.found !== true || !DIGEST.test(resolution.digest || "") ||
      !DIGEST.test(resolution.receiptDigest || "") || !Buffer.isBuffer(resolution.bytes)) {
    fail("structured memory artifact resolution is unauthenticated or incomplete");
  }
  let record;
  try { record = JSON.parse(resolution.bytes.toString("utf8")); } catch { fail("structured memory artifact is not JSON"); }
  if (record?.schema !== EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA || record.tenantId !== options.artifactTenantId ||
      record.audience !== options.audience || record.purpose !== options.purpose || record.retention !== "ledger" ||
      record.type !== expectedType) {
    fail("structured memory durable record binding is invalid");
  }
  return record.value;
}

export class StructuredMemoryLedgerAdapter {
  constructor({ descriptor: input, artifactPorts, ledger, ledgerArtifactResolver, clock = Date.now } = {}) {
    this.descriptor = descriptor(input);
    this._put = capture(artifactPorts, "putCanonical");
    this._read = capture(ledger, "read");
    this._verify = capture(ledger, "verify");
    this._append = capture(ledger, "appendDomainEvent");
    if (typeof clock !== "function") throw new TypeError("clock must be a function");
    this._clock = clock;
    if (!isEvolutionLedgerArtifactResolver(ledgerArtifactResolver)) {
      throw new TypeError("a branded EvolutionArtifactPorts ledger resolver is required");
    }
    this._resolve = ledgerArtifactResolver;
    Object.freeze(this);
  }

  _events(type) {
    const events = this._read();
    if (!Array.isArray(events)) fail("EvolutionLedger did not return an event array");
    return events.filter((event) => event.schema === EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA && event.type === type &&
      event.tenantId === this.descriptor.tenantId && event.correlationId === this.descriptor.streamId);
  }

  _resolveEvent(event, artifactType) {
    const identity = this._verify();
    const resolution = this._resolve({ epoch: identity.epoch, ledgerId: identity.ledgerId,
      ref: event.subjectRef, tenantId: this.descriptor.artifactTenantId });
    if (resolution.ref !== event.subjectRef.ref || resolution.digest !== event.subjectRef.digest) {
      fail("structured memory ledger subject was substituted");
    }
    return parseResolution(resolution, artifactType, this.descriptor);
  }

  load() {
    const events = this._events(STRUCTURED_MEMORY_LEDGER_EVENT_TYPE).map((entry) => this._resolveEvent(entry, "structured-memory-event"));
    const projection = projectStructuredMemory(events, { tenantId: this.descriptor.tenantId });
    const snapshots = this._events(STRUCTURED_MEMORY_LEDGER_SNAPSHOT_TYPE)
      .map((entry) => this._resolveEvent(entry, "structured-memory-snapshot"))
      .sort((left, right) => left.throughSequence - right.throughSequence);
    const snapshot = snapshots.at(-1) ?? null;
    if (snapshot && snapshot.throughSequence > projection.sequence) fail("structured memory snapshot is ahead of its event stream");
    return Object.freeze({ events: Object.freeze(events), snapshot });
  }

  _persist(type, artifactType, value, logicalDigest, logicalId, timestamp, sourceRefs) {
    const head = this._verify();
    const published = this._put(artifactType, value, { audience: this.descriptor.audience,
      purpose: this.descriptor.purpose, retention: "ledger" });
    if (published?.receipt?.persisted !== true || published.receipt.readbackVerified !== true ||
        published.receipt.integrityVerified !== true || published.receipt.retention !== "ledger") {
      fail("structured memory artifact persistence was not durably confirmed");
    }
    const eventId = `${type}.${logicalDigest.slice("sha256:".length)}`;
    const receipt = this._append({ artifactTenantId: this.descriptor.artifactTenantId,
      correlationId: this.descriptor.streamId, decision: "committed", eventId,
      reason: `${type} committed`, skillName: null, sourceRefs, subjectRef: published.ref,
      tenantId: this.descriptor.tenantId, timestamp, type },
    { expectedHeadDigest: head.headDigest, expectedSequence: head.sequence });
    if (receipt?.authenticated !== true || receipt.committed !== true || receipt.durable !== true ||
        receipt.eventId !== eventId || !DIGEST.test(receipt.receiptDigest || "")) {
      fail("structured memory ledger append was not durably confirmed");
    }
    return Object.freeze({ persisted: true, [logicalId]: logicalDigest, ledgerReceiptDigest: receipt.receiptDigest });
  }

  persistEvent = async (event) => {
    if (event?.schema !== STRUCTURED_MEMORY_EVENT_SCHEMA || event.tenantId !== this.descriptor.tenantId) {
      throw new TypeError("structured memory event persistence input is invalid");
    }
    const eventDigest = hash(event);
    const existing = this._events(STRUCTURED_MEMORY_LEDGER_EVENT_TYPE);
    const identical = existing.find((entry) => entry.eventId === `${STRUCTURED_MEMORY_LEDGER_EVENT_TYPE}.${eventDigest.slice(7)}`);
    if (identical) {
      if (canonical(this._resolveEvent(identical, "structured-memory-event")) !== canonical(event)) {
        fail("structured memory event id resolved substituted content");
      }
      return Object.freeze({ persisted: true, eventId: event.eventId, eventDigest, recovered: true });
    }
    if (existing.length !== event.sequence - 1) conflict("structured memory stream changed before event commit");
    if (existing.length > 0) {
      const priorValue = this._resolveEvent(existing.at(-1), "structured-memory-event");
      if (priorValue.sequence !== event.sequence - 1) fail("structured memory stream sequence is corrupt");
    }
    const prior = existing.at(-1);
    const result = this._persist(STRUCTURED_MEMORY_LEDGER_EVENT_TYPE, "structured-memory-event", event,
      eventDigest, "eventDigest", event.timestamp, prior ? [prior.subjectRef] : []);
    return Object.freeze({ ...result, eventId: event.eventId });
  };

  persistSnapshot = async (snapshot) => {
    if (snapshot?.schema !== STRUCTURED_MEMORY_SNAPSHOT_SCHEMA || snapshot.tenantId !== this.descriptor.tenantId ||
        !DIGEST.test(snapshot.snapshotDigest || "")) throw new TypeError("structured memory snapshot input is invalid");
    const existing = this._events(STRUCTURED_MEMORY_LEDGER_SNAPSHOT_TYPE);
    const identical = existing.find((entry) => entry.eventId === `${STRUCTURED_MEMORY_LEDGER_SNAPSHOT_TYPE}.${snapshot.snapshotDigest.slice(7)}`);
    if (identical) {
      if (canonical(this._resolveEvent(identical, "structured-memory-snapshot")) !== canonical(snapshot)) {
        fail("structured memory snapshot id resolved substituted content");
      }
      return Object.freeze({ persisted: true, snapshotDigest: snapshot.snapshotDigest, recovered: true });
    }
    const memoryEvents = this._events(STRUCTURED_MEMORY_LEDGER_EVENT_TYPE);
    const projection = projectStructuredMemory(memoryEvents.map((entry) => this._resolveEvent(entry, "structured-memory-event")),
      { tenantId: this.descriptor.tenantId });
    if (projection.sequence !== snapshot.throughSequence || projection.eventRoot !== snapshot.eventRoot ||
        projection.projectionDigest !== snapshot.projectionDigest) {
      conflict("structured memory changed before snapshot commit");
    }
    const sources = [memoryEvents.at(-1)?.subjectRef, existing.at(-1)?.subjectRef].filter(Boolean);
    return this._persist(STRUCTURED_MEMORY_LEDGER_SNAPSHOT_TYPE, "structured-memory-snapshot", snapshot,
      snapshot.snapshotDigest, "snapshotDigest", new Date(this._clock()).toISOString(), sources);
  };

  createMemory({ postCompactVerifier }) {
    if (typeof postCompactVerifier !== "function") throw new TypeError("postCompactVerifier is required");
    const restored = this.load();
    return new StructuredEvolutionMemory({ tenantId: this.descriptor.tenantId,
      persistEvent: this.persistEvent, persistSnapshot: this.persistSnapshot, postCompactVerifier,
      initialEvents: restored.events, initialSnapshot: restored.snapshot });
  }
}

export function createStructuredMemoryLedgerAdapter(options) {
  return new StructuredMemoryLedgerAdapter(options);
}

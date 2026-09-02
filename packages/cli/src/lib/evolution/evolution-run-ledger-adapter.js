import evolutionRun from "@chainlesschain/session-core/evolution-run";

import {
  EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA,
  isEvolutionLedgerArtifactResolver,
} from "./evolution-artifact-ports.js";
import {
  EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA,
  EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA,
} from "./evolution-ledger.js";

const { EVENT_TYPES, projectEvolutionRun } = evolutionRun;

export const EVOLUTION_RUN_LEDGER_EVENT_TYPE = "evolution.run.event.committed";
export const EVOLUTION_RUN_LEDGER_CONFLICT_CODE =
  "CC_EVOLUTION_RUN_LEDGER_CONFLICT";
export const EVOLUTION_RUN_LEDGER_CORRUPT_CODE =
  "CC_EVOLUTION_RUN_LEDGER_CORRUPT";

const ARTIFACT_TYPE = "evolution-run-event";
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const EVENT_KEYS = new Set([
  "schema",
  "tenantId",
  "runId",
  "eventId",
  "sequence",
  "type",
  "subjectId",
  "payloadDigest",
  "artifactRef",
  "keyRef",
  "data",
]);

function requiredString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} is required`);
  }
  return value;
}

function fail(code, message, options) {
  const error = new Error(message, options);
  error.code = code;
  throw error;
}

function capture(owner, method, label = method) {
  if (typeof owner?.[method] !== "function") {
    throw new TypeError(`${label} port is required`);
  }
  const fn = owner[method];
  return (...args) => Reflect.apply(fn, owner, args);
}

function canonical(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function clone(value) {
  return JSON.parse(canonical(value));
}

function same(left, right) {
  return canonical(left) === canonical(right);
}

function normalizeDescriptor(input) {
  return Object.freeze({
    tenantId: requiredString(input?.tenantId, "tenantId"),
    artifactTenantId: requiredString(
      input?.artifactTenantId,
      "artifactTenantId",
    ),
    runId: requiredString(input?.runId, "runId"),
    audience: requiredString(input?.audience, "audience"),
    purpose: requiredString(input?.purpose, "purpose"),
  });
}

function normalizeEvent(input, descriptor) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Reflect.ownKeys(input).length !== EVENT_KEYS.size ||
    Reflect.ownKeys(input).some(
      (key) => typeof key !== "string" || !EVENT_KEYS.has(key),
    )
  ) {
    throw new TypeError("EvolutionRun event contains unsupported fields");
  }
  const event = clone(input);
  projectEvolutionRun([event], {
    tenantId: descriptor.tenantId,
    runId: descriptor.runId,
  });
  return Object.freeze(event);
}

function parseRecord(resolution, descriptor) {
  if (
    resolution?.schema !== EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA ||
    resolution.authenticated !== true ||
    resolution.found !== true ||
    !DIGEST.test(resolution.digest ?? "") ||
    !DIGEST.test(resolution.receiptDigest ?? "") ||
    !Buffer.isBuffer(resolution.bytes)
  ) {
    fail(
      EVOLUTION_RUN_LEDGER_CORRUPT_CODE,
      "EvolutionRun artifact resolution is unauthenticated or incomplete",
    );
  }
  let record;
  try {
    record = JSON.parse(resolution.bytes.toString("utf8"));
  } catch {
    fail(
      EVOLUTION_RUN_LEDGER_CORRUPT_CODE,
      "EvolutionRun artifact is not canonical JSON",
    );
  }
  if (
    record?.schema !== EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA ||
    record.tenantId !== descriptor.artifactTenantId ||
    record.audience !== descriptor.audience ||
    record.purpose !== descriptor.purpose ||
    record.retention !== "ledger" ||
    record.type !== ARTIFACT_TYPE
  ) {
    fail(
      EVOLUTION_RUN_LEDGER_CORRUPT_CODE,
      "EvolutionRun artifact durable binding is invalid",
    );
  }
  return normalizeEvent(record.value, descriptor);
}

export class EvolutionRunLedgerAdapter {
  constructor({
    descriptor: input,
    artifactPorts,
    ledger,
    ledgerArtifactResolver,
    now = Date.now,
  } = {}) {
    this.descriptor = normalizeDescriptor(input);
    this._put = capture(artifactPorts, "putCanonical", "artifactPorts");
    this._read = capture(ledger, "read", "ledger");
    this._verify = capture(ledger, "verify", "ledger");
    this._append = capture(ledger, "appendDomainEvent", "ledger");
    if (!isEvolutionLedgerArtifactResolver(ledgerArtifactResolver)) {
      throw new TypeError(
        "a branded EvolutionArtifactPorts ledger resolver is required",
      );
    }
    if (typeof now !== "function")
      throw new TypeError("now must be a function");
    this._resolve = ledgerArtifactResolver;
    this._now = now;
    Object.freeze(this);
  }

  _domainEvents() {
    const events = this._read();
    if (!Array.isArray(events)) {
      fail(
        EVOLUTION_RUN_LEDGER_CORRUPT_CODE,
        "EvolutionLedger did not return events",
      );
    }
    return events.filter(
      (event) =>
        event.schema === EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA &&
        event.type === EVOLUTION_RUN_LEDGER_EVENT_TYPE &&
        event.tenantId === this.descriptor.tenantId &&
        event.correlationId === this.descriptor.runId,
    );
  }

  _resolveEvent(domainEvent) {
    if (
      !domainEvent?.subjectRef ||
      typeof domainEvent.subjectRef.ref !== "string" ||
      !DIGEST.test(domainEvent.subjectRef.digest ?? "")
    ) {
      fail(
        EVOLUTION_RUN_LEDGER_CORRUPT_CODE,
        "EvolutionRun ledger subject reference is invalid",
      );
    }
    const identity = this._verify();
    const resolution = this._resolve({
      epoch: identity.epoch,
      ledgerId: identity.ledgerId,
      ref: domainEvent.subjectRef,
      tenantId: this.descriptor.artifactTenantId,
    });
    if (
      resolution?.ref !== domainEvent.subjectRef.ref ||
      resolution.digest !== domainEvent.subjectRef.digest
    ) {
      fail(
        EVOLUTION_RUN_LEDGER_CORRUPT_CODE,
        "EvolutionRun ledger subject was substituted",
      );
    }
    return parseRecord(resolution, this.descriptor);
  }

  _entries() {
    const entries = this._domainEvents().map((domainEvent) => ({
      domainEvent,
      event: this._resolveEvent(domainEvent),
    }));
    entries.sort((left, right) => left.event.sequence - right.event.sequence);
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      const previous = entries[index - 1] ?? null;
      const expectedDomainEventId = `${EVOLUTION_RUN_LEDGER_EVENT_TYPE}.${entry.domainEvent.subjectRef.digest.slice("sha256:".length)}`;
      if (
        entry.domainEvent.eventId !== expectedDomainEventId ||
        entry.domainEvent.decision !== "committed" ||
        entry.domainEvent.artifactTenantId !==
          this.descriptor.artifactTenantId ||
        entry.domainEvent.skillName !== null
      ) {
        fail(
          EVOLUTION_RUN_LEDGER_CORRUPT_CODE,
          "EvolutionRun domain event binding is invalid",
        );
      }
      if (entry.event.sequence !== index + 1) {
        fail(
          EVOLUTION_RUN_LEDGER_CORRUPT_CODE,
          "EvolutionRun event sequence has a gap or duplicate",
        );
      }
      const expectedSources = previous ? [previous.domainEvent.subjectRef] : [];
      if (!same(entry.domainEvent.sourceRefs, expectedSources)) {
        fail(
          EVOLUTION_RUN_LEDGER_CORRUPT_CODE,
          "EvolutionRun artifact lineage is discontinuous",
        );
      }
    }
    const events = entries.map(({ event }) => event);
    if (events.length > 0) {
      if (events[0].type !== EVENT_TYPES.RUN_STARTED) {
        fail(
          EVOLUTION_RUN_LEDGER_CORRUPT_CODE,
          "EvolutionRun does not begin with run-started",
        );
      }
      projectEvolutionRun(events, {
        tenantId: this.descriptor.tenantId,
        runId: this.descriptor.runId,
      });
    }
    return entries;
  }

  load() {
    const entries = this._entries();
    const events = entries.map(({ event }) => event);
    return Object.freeze({
      events: Object.freeze(events),
      projection:
        events.length === 0
          ? null
          : projectEvolutionRun(events, {
              tenantId: this.descriptor.tenantId,
              runId: this.descriptor.runId,
            }),
    });
  }

  appendEvent(input) {
    const event = normalizeEvent(input, this.descriptor);
    const before = this._entries();
    const duplicate = before.find(
      ({ event: stored }) => stored.eventId === event.eventId,
    );
    if (duplicate) {
      if (!same(duplicate.event, event)) {
        fail(
          EVOLUTION_RUN_LEDGER_CONFLICT_CODE,
          "EvolutionRun eventId already binds different content",
        );
      }
      return Object.freeze({
        committed: true,
        recovered: true,
        eventId: event.eventId,
        projection: this.load().projection,
      });
    }
    const expectedSequence = before.length + 1;
    if (
      event.sequence !== expectedSequence ||
      (expectedSequence === 1 && event.type !== EVENT_TYPES.RUN_STARTED) ||
      before.at(-1)?.event.type === EVENT_TYPES.RUN_COMPLETED
    ) {
      fail(
        EVOLUTION_RUN_LEDGER_CONFLICT_CODE,
        "EvolutionRun event does not extend the current stream",
      );
    }
    const published = this._put(ARTIFACT_TYPE, event, {
      audience: this.descriptor.audience,
      purpose: this.descriptor.purpose,
      retention: "ledger",
    });
    if (
      !published?.ref ||
      published.receipt?.persisted !== true ||
      published.receipt.readbackVerified !== true ||
      published.receipt.integrityVerified !== true ||
      published.receipt.retention !== "ledger"
    ) {
      fail(
        EVOLUTION_RUN_LEDGER_CORRUPT_CODE,
        "EvolutionRun event persistence was not durably confirmed",
      );
    }
    const head = this._verify();
    const currentBeforeAppend = this._entries();
    if (
      currentBeforeAppend.length !== before.length ||
      currentBeforeAppend.some(
        ({ domainEvent }, index) =>
          domainEvent.eventDigest !== before[index].domainEvent.eventDigest,
      )
    ) {
      fail(
        EVOLUTION_RUN_LEDGER_CONFLICT_CODE,
        "EvolutionRun changed before ledger append",
      );
    }
    const timestamp = new Date(Number(this._now())).toISOString();
    const domainEventId = `${EVOLUTION_RUN_LEDGER_EVENT_TYPE}.${published.digest.slice("sha256:".length)}`;
    let recoveredAfterAppend = false;
    try {
      const receipt = this._append(
        {
          artifactTenantId: this.descriptor.artifactTenantId,
          correlationId: this.descriptor.runId,
          decision: "committed",
          eventId: domainEventId,
          reason: `EvolutionRun sequence ${event.sequence} committed`,
          skillName: null,
          sourceRefs:
            before.length === 0 ? [] : [before.at(-1).domainEvent.subjectRef],
          subjectRef: published.ref,
          tenantId: this.descriptor.tenantId,
          timestamp,
          type: EVOLUTION_RUN_LEDGER_EVENT_TYPE,
        },
        {
          expectedHeadDigest: head.headDigest,
          expectedSequence: head.sequence,
        },
      );
      if (
        receipt?.authenticated !== true ||
        receipt.committed !== true ||
        receipt.durable !== true ||
        receipt.eventId !== domainEventId ||
        !DIGEST.test(receipt.receiptDigest ?? "")
      ) {
        fail(
          EVOLUTION_RUN_LEDGER_CORRUPT_CODE,
          "EvolutionRun ledger append was not durably authenticated",
        );
      }
    } catch (cause) {
      const recovered = this._entries().find(
        ({ event: stored }) => stored.eventId === event.eventId,
      );
      if (!recovered || !same(recovered.event, event)) throw cause;
      recoveredAfterAppend = true;
    }
    const after = this.load();
    const stored = after.events.at(-1);
    if (!stored || !same(stored, event)) {
      fail(
        EVOLUTION_RUN_LEDGER_CORRUPT_CODE,
        "EvolutionRun readback differs after append",
      );
    }
    return Object.freeze({
      committed: true,
      recovered: recoveredAfterAppend,
      eventId: event.eventId,
      projection: after.projection,
    });
  }
}

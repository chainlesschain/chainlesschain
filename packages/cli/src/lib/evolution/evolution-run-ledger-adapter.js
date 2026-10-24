import evolutionRun from "@chainlesschain/session-core/evolution-run";
import { types } from "node:util";

import {
  EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA,
  EvolutionArtifactPorts,
  captureEvolutionLedgerArtifactResolverBinding,
  captureEvolutionLedgerBatchReadWindow,
  captureEvolutionLedgerWholeHistoryReader,
  hasEvolutionLedgerDefaultPublication,
  isEvolutionLedgerArtifactResolver,
} from "./evolution-artifact-ports.js";
import {
  EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA,
  EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA,
  hasEvolutionLedgerDefaultAppendPorts,
  getEvolutionLedgerVerifiedHistoryReader,
} from "./evolution-ledger.js";

const { EVENT_TYPES, projectEvolutionRun } = evolutionRun;

export const EVOLUTION_RUN_LEDGER_EVENT_TYPE = "evolution.run.event.committed";
export const EVOLUTION_RUN_LEDGER_CONFLICT_CODE =
  "CC_EVOLUTION_RUN_LEDGER_CONFLICT";
export const EVOLUTION_RUN_LEDGER_CORRUPT_CODE =
  "CC_EVOLUTION_RUN_LEDGER_CORRUPT";

const ARTIFACT_TYPE = "evolution-run-event";
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const EVIDENCE_READERS = new WeakMap();
const APPEND_NEXT = new WeakMap();
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

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
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

// The new composition port accepts data only, never a sequence or a callback.
// Capture all nested values before any current-authority port can run.
function captureNextEventData(value, seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (
    !value ||
    typeof value !== "object" ||
    types.isProxy(value) ||
    seen.has(value)
  )
    throw new TypeError("append-next event must contain acyclic plain data");
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (!array && prototype !== Object.prototype && prototype !== null)
    throw new TypeError("append-next event must contain plain objects");
  const keys = Reflect.ownKeys(value).filter(
    (key) => !(array && key === "length"),
  );
  if (
    array &&
    (keys.length !== value.length ||
      keys.some((key, index) => key !== String(index)))
  )
    throw new TypeError("append-next event arrays must contain dense data");
  const captured = array ? [] : Object.create(null);
  seen.add(value);
  try {
    for (const key of keys) {
      const property = Object.getOwnPropertyDescriptor(value, key);
      if (
        typeof key !== "string" ||
        !property?.enumerable ||
        !("value" in property)
      )
        throw new TypeError(
          "append-next event cannot contain accessors or symbols",
        );
      captured[key] = captureNextEventData(property.value, seen);
    }
  } finally {
    seen.delete(value);
  }
  return captured;
}

function normalizeNextEvent(input, descriptor) {
  const captured = captureNextEventData(input);
  if (
    !captured ||
    Array.isArray(captured) ||
    Reflect.ownKeys(captured).length !== EVENT_KEYS.size - 1 ||
    Reflect.ownKeys(captured).some(
      (key) => key === "sequence" || !EVENT_KEYS.has(key),
    )
  )
    throw new TypeError(
      "append-next event requires event fields without sequence",
    );
  const { sequence: _temporary, ...event } = normalizeEvent(
    { ...captured, sequence: 1 },
    descriptor,
  );
  return freeze(event);
}

function hasOriginalMethods(prototype, methods) {
  return Object.entries(methods).every(
    ([name, method]) =>
      Object.getOwnPropertyDescriptor(prototype, name)?.value === method,
  );
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
  #readBatches;
  #verifiedHistory;
  #originalRead;
  #originalVerify;
  #appendNextEligible;

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
    this.#originalRead = this._read;
    this.#originalVerify = this._verify;
    this.#verifiedHistory =
      new.target === EvolutionRunLedgerAdapter
        ? getEvolutionLedgerVerifiedHistoryReader(ledger)
        : null;
    if (!isEvolutionLedgerArtifactResolver(ledgerArtifactResolver)) {
      throw new TypeError(
        "a branded EvolutionArtifactPorts ledger resolver is required",
      );
    }
    if (typeof now !== "function")
      throw new TypeError("now must be a function");
    this._resolve = ledgerArtifactResolver;
    this.#readBatches = captureEvolutionLedgerBatchReadWindow(
      ledgerArtifactResolver,
    );
    this._now = now;
    const binding = captureEvolutionLedgerArtifactResolverBinding(
      ledgerArtifactResolver,
    );
    this.#appendNextEligible = () =>
      this.#verifiedHistory !== null &&
      hasEvolutionLedgerDefaultAppendPorts(ledger) &&
      Object.getPrototypeOf(this) === EvolutionRunLedgerAdapter.prototype &&
      binding.matchesArtifactPorts(artifactPorts) &&
      hasEvolutionLedgerDefaultPublication(this._resolve) &&
      Object.getPrototypeOf(artifactPorts) ===
        EvolutionArtifactPorts.prototype &&
      hasOriginalMethods(
        EvolutionRunLedgerAdapter.prototype,
        ORIGINAL_RUN_METHODS,
      ) &&
      captureEvolutionLedgerWholeHistoryReader(this._resolve) !== null;
    if (
      new.target === EvolutionRunLedgerAdapter &&
      this.#appendNextEligible()
    ) {
      APPEND_NEXT.set(
        this,
        Object.freeze({
          eligible: this.#appendNextEligible,
          append: Object.freeze((input) => this.#appendNext(input)),
        }),
      );
    }
    const load = this.load.bind(this);
    const verify = this._verify;
    const checkpoints = new WeakSet();
    const frontier = () => {
      // verifiedAt describes this observation, not a ledger mutation.
      const { verifiedAt: _observedAt, ...identity } = clone(verify());
      return identity;
    };
    const snapshot = () => {
      const before = frontier();
      const loaded = load();
      const after = frontier();
      if (!same(before, after)) {
        fail(
          EVOLUTION_RUN_LEDGER_CONFLICT_CODE,
          "Run changed during evidence lookup",
        );
      }
      if (loaded.projection?.status !== "completed") {
        fail(
          EVOLUTION_RUN_LEDGER_CORRUPT_CODE,
          "Wiki evidence requires a completed Run",
        );
      }
      return { loaded, ledgerHead: after };
    };
    // Preserve the legacy subclass API, but only the exact implementation may
    // mint the new evidence membership capability. A subclass can override
    // load/_entries and must never turn those overrides into signed membership.
    if (Object.getPrototypeOf(this) === EvolutionRunLedgerAdapter.prototype)
      EVIDENCE_READERS.set(
        this,
        Object.freeze({
          descriptor: this.descriptor,
          readEvidence(evidenceId) {
            requiredString(evidenceId, "evidenceId");
            const { loaded, ledgerHead } = snapshot();
            const matches = loaded.events.filter(
              (event) =>
                event.type === EVENT_TYPES.RAW_EVENT_REFERENCED &&
                event.subjectId === evidenceId,
            );
            if (matches.length !== 1) {
              fail(
                EVOLUTION_RUN_LEDGER_CORRUPT_CODE,
                "Run evidence is missing or ambiguous",
              );
            }
            const checkpoint = freeze({
              event: clone(matches[0]),
              ledgerHead,
              projectionDigest: loaded.projection.projectionDigest,
            });
            checkpoints.add(checkpoint);
            return checkpoint;
          },
          assertCurrent(expected) {
            if (!checkpoints.has(expected)) {
              fail(
                EVOLUTION_RUN_LEDGER_CORRUPT_CODE,
                "Run evidence checkpoint is not authentic",
              );
            }
            const { loaded, ledgerHead } = snapshot();
            if (
              !same(ledgerHead, expected.ledgerHead) ||
              loaded.projection.projectionDigest !== expected.projectionDigest
            ) {
              fail(
                EVOLUTION_RUN_LEDGER_CONFLICT_CODE,
                "Run evidence frontier changed before release",
              );
            }
          },
        }),
      );
    Object.freeze(this);
  }

  _domainEvents() {
    return this.#filterDomainEvents(this._read());
  }

  #filterDomainEvents(events) {
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
    return this.#resolveEventWithIdentity(domainEvent, this._verify());
  }

  #resolveEventWithIdentity(domainEvent, identity) {
    return this.#parseResolvedEvent(
      domainEvent,
      this._resolve(this.#eventRequest(domainEvent, identity)),
    );
  }

  #eventRequest(domainEvent, identity) {
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
    return {
      epoch: identity.epoch,
      ledgerId: identity.ledgerId,
      ref: domainEvent.subjectRef,
      tenantId: this.descriptor.artifactTenantId,
    };
  }

  #parseResolvedEvent(domainEvent, resolution) {
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
    return this.#readEntriesWithAuthority().entries;
  }

  #readEntriesWithAuthority() {
    // Authenticate one frontier around the complete synchronous read. Verifying
    // the full ledger once for every Run event made each load quadratic in its
    // history. Artifact bytes and current authority are still checked for each
    // item; the identity is scoped to this read and is never caller supplied.
    // Original ledgers can supply authority and events from one locked load.
    // Custom/subclass ports keep their established calls and override behavior.
    const history =
      this.#verifiedHistory &&
      this._read === this.#originalRead &&
      this._verify === this.#originalVerify &&
      this._domainEvents === ORIGINAL_DOMAIN_EVENTS
        ? this.#verifiedHistory()
        : null;
    const { verifiedAt: _beforeObservation, ...before } = clone(
      history === null ? this._verify() : history.authority,
    );
    const domainEvents =
      history === null
        ? this._domainEvents()
        : this.#filterDomainEvents(history.events);
    const entries = [];
    try {
      // Original ports can seal the complete history between two index reads.
      // Custom ports retain their established chunk callback window. Both
      // paths freshly authenticate each payload and its current authority.
      const readWholeHistory =
        history !== null
          ? captureEvolutionLedgerWholeHistoryReader(this._resolve)
          : null;
      if (domainEvents.length > 0 && readWholeHistory !== null) {
        const resolutions = readWholeHistory(
          domainEvents.map((event) => this.#eventRequest(event, before)),
        );
        if (
          !Array.isArray(resolutions) ||
          resolutions.length !== domainEvents.length
        ) {
          fail(
            EVOLUTION_RUN_LEDGER_CORRUPT_CODE,
            "EvolutionRun artifact history is incomplete",
          );
        }
        for (let index = 0; index < domainEvents.length; index += 1) {
          const domainEvent = domainEvents[index];
          entries.push({
            domainEvent,
            event: this.#parseResolvedEvent(domainEvent, resolutions[index]),
          });
        }
      } else if (domainEvents.length > 0)
        this.#readBatches((resolveBatch) => {
          for (let offset = 0; offset < domainEvents.length; offset += 128) {
            const batch = domainEvents.slice(offset, offset + 128);
            const resolutions = resolveBatch(
              batch.map((event) => this.#eventRequest(event, before)),
            );
            if (
              !Array.isArray(resolutions) ||
              resolutions.length !== batch.length
            ) {
              fail(
                EVOLUTION_RUN_LEDGER_CORRUPT_CODE,
                "EvolutionRun artifact batch is incomplete",
              );
            }
            entries.push(
              ...batch.map((domainEvent, index) => ({
                domainEvent,
                event: this.#parseResolvedEvent(
                  domainEvent,
                  resolutions[index],
                ),
              })),
            );
          }
        });
    } catch (cause) {
      // A concurrent append can invalidate the batch index before the normal
      // final frontier check. Preserve the established conflict classification
      // only when a fresh successful verification proves that frontier changed.
      let afterFailure = null;
      try {
        const { verifiedAt: _observation, ...identity } = clone(this._verify());
        afterFailure = identity;
      } catch {
        /* Unverified state must not reclassify an artifact failure. */
      }
      if (afterFailure !== null && !same(before, afterFailure)) {
        fail(
          EVOLUTION_RUN_LEDGER_CONFLICT_CODE,
          "EvolutionRun ledger frontier changed during recovery",
          { cause },
        );
      }
      throw cause;
    }
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
    const { verifiedAt: _afterObservation, ...after } = clone(this._verify());
    if (!same(before, after)) {
      fail(
        EVOLUTION_RUN_LEDGER_CONFLICT_CODE,
        "EvolutionRun ledger frontier changed during recovery",
      );
    }
    return { entries, authority: after };
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
    return this.#appendPrepared(event, before, false);
  }

  #appendNext(input) {
    const captured = normalizeNextEvent(input, this.descriptor);
    if (!this.#appendNextEligible()) {
      const current = this.load();
      return this.appendEvent({
        ...captured,
        sequence: current.events.length + 1,
      });
    }
    const before = this._entries();
    const event = Object.freeze({ ...captured, sequence: before.length + 1 });
    return this.#appendPrepared(event, before, true);
  }

  #appendPrepared(event, before, allowPrivateHeadProof) {
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
    let head, currentBeforeAppend;
    if (allowPrivateHeadProof && this.#appendNextEligible()) {
      // This authority comes from the same complete post-publication read,
      // including its final frontier comparison. It never survives this call.
      const current = this.#readEntriesWithAuthority();
      head = current.authority;
      currentBeforeAppend = current.entries;
    } else {
      head = this._verify();
      currentBeforeAppend = this._entries();
    }
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

const ORIGINAL_DOMAIN_EVENTS =
  EvolutionRunLedgerAdapter.prototype._domainEvents;
const ORIGINAL_RUN_METHODS = Object.freeze({
  load: EvolutionRunLedgerAdapter.prototype.load,
  appendEvent: EvolutionRunLedgerAdapter.prototype.appendEvent,
  _entries: EvolutionRunLedgerAdapter.prototype._entries,
  _domainEvents: ORIGINAL_DOMAIN_EVENTS,
});

/** Optional original-port composition; no caller sequence or authority input. */
export function captureEvolutionRunAppendNext(adapter) {
  const capability = APPEND_NEXT.get(adapter);
  return capability?.eligible() ? capability.append : null;
}

/** Read-only capability registered only by the real Run adapter constructor. */
export function captureEvolutionRunEvidenceReader(adapter) {
  const reader = EVIDENCE_READERS.get(adapter);
  if (!reader)
    throw new TypeError("a real EvolutionRunLedgerAdapter is required");
  return reader;
}

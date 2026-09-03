import {
  EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA,
  isEvolutionLedgerArtifactResolver,
} from "./evolution-artifact-ports.js";
import {
  EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA,
  EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA,
} from "./evolution-ledger.js";
import {
  createEmptyEvolutionWorkbenchMetricsSnapshot,
  digestEvolutionWorkbenchMetricsRetentionBatch,
  digestEvolutionWorkbenchMetricsRetentionQuery,
  verifyEvolutionWorkbenchMetricsSnapshot,
} from "./evolution-workbench-metrics.js";

export const EVOLUTION_WORKBENCH_METRICS_LEDGER_EVENT =
  "evolution.workbench.metrics.snapshot.committed";
export const EVOLUTION_WORKBENCH_METRICS_RETENTION_LEDGER_EVENT =
  "evolution.workbench.metrics.receipts.retained";
export const EVOLUTION_WORKBENCH_METRICS_RETENTION_SCHEMA =
  "chainlesschain.evolution-workbench-metrics-receipt-retention/v1";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const METRICS_LEDGER_ADAPTERS = new WeakSet();
const METRICS_OUTCOME_READERS = new WeakSet();

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

function string(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} is required`);
  }
  return value;
}

function capture(owner, method, label) {
  if (typeof owner?.[method] !== "function") {
    throw new TypeError(`${label}.${method}() is required`);
  }
  return (...args) => Reflect.apply(owner[method], owner, args);
}

function descriptor(input) {
  return Object.freeze({
    tenantId: string(input?.tenantId, "tenantId"),
    artifactTenantId: string(input?.artifactTenantId, "artifactTenantId"),
    evolutionRunId: string(input?.evolutionRunId, "evolutionRunId"),
    skillName: string(input?.skillName, "skillName"),
    audience: string(input?.audience, "audience"),
    purpose: string(input?.purpose, "purpose"),
  });
}

function fail(message) {
  throw new Error(message);
}

function verifyRetentionSegment(value, expected) {
  if (
    value?.schema !== EVOLUTION_WORKBENCH_METRICS_RETENTION_SCHEMA ||
    value.tenantId !== expected.tenantId ||
    value.evolutionRunId !== expected.evolutionRunId ||
    value.skillName !== expected.skillName ||
    !Number.isSafeInteger(value.priorRetainedReceiptCount) ||
    value.priorRetainedReceiptCount < 0 ||
    !Number.isSafeInteger(value.retainedReceiptCount) ||
    !Array.isArray(value.receiptDigests) ||
    value.receiptDigests.length < 1 ||
    value.receiptDigests.length > 10_000 ||
    new Set(value.receiptDigests).size !== value.receiptDigests.length ||
    value.receiptDigests.some((item) => !DIGEST.test(item)) ||
    value.receiptDigests.join("\n") !==
      [...value.receiptDigests].sort().join("\n") ||
    value.retainedReceiptCount !==
      value.priorRetainedReceiptCount + value.receiptDigests.length ||
    (value.priorRetentionRootDigest !== null &&
      !DIGEST.test(value.priorRetentionRootDigest ?? "")) ||
    typeof value.throughAt !== "string" ||
    !Number.isFinite(Date.parse(value.throughAt)) ||
    !DIGEST.test(value.batchDigest ?? "") ||
    !DIGEST.test(value.retentionRootDigest ?? "")
  ) {
    fail("Workbench metrics retention segment is invalid");
  }
  if (
    value.batchDigest !==
    digestEvolutionWorkbenchMetricsRetentionBatch({
      tenantId: value.tenantId,
      evolutionRunId: value.evolutionRunId,
      skillName: value.skillName,
      priorRetentionRootDigest: value.priorRetentionRootDigest,
      priorRetainedReceiptCount: value.priorRetainedReceiptCount,
      throughAt: value.throughAt,
      receiptDigests: value.receiptDigests,
    })
  ) {
    fail("Workbench metrics retention batch digest is invalid");
  }
  const core = structuredClone(value);
  delete core.retentionRootDigest;
  if (
    value.retentionRootDigest !==
    hash(EVOLUTION_WORKBENCH_METRICS_RETENTION_SCHEMA, core)
  ) {
    fail("Workbench metrics retention root digest is invalid");
  }
  return Object.freeze(structuredClone(value));
}

export class EvolutionWorkbenchMetricsLedgerAdapter {
  constructor({
    descriptor: input,
    artifactPorts,
    ledger,
    ledgerArtifactResolver,
  } = {}) {
    this.descriptor = descriptor(input);
    this._putCanonical = capture(
      artifactPorts,
      "putCanonical",
      "artifactPorts",
    );
    this._readLedger = capture(ledger, "read", "ledger");
    this._verifyLedger = capture(ledger, "verify", "ledger");
    this._appendDomainEvent = capture(ledger, "appendDomainEvent", "ledger");
    if (!isEvolutionLedgerArtifactResolver(ledgerArtifactResolver)) {
      throw new TypeError(
        "a branded EvolutionArtifactPorts ledger resolver is required",
      );
    }
    this._resolveArtifact = ledgerArtifactResolver;
    METRICS_LEDGER_ADAPTERS.add(this);
    Object.freeze(this);
  }

  _eventsOf(type) {
    const events = this._readLedger();
    if (!Array.isArray(events))
      fail("Workbench metrics ledger read is invalid");
    return events.filter(
      (event) =>
        event.schema === EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA &&
        event.type === type &&
        event.tenantId === this.descriptor.tenantId &&
        event.correlationId === this.descriptor.evolutionRunId &&
        event.skillName === this.descriptor.skillName,
    );
  }

  _events() {
    return this._eventsOf(EVOLUTION_WORKBENCH_METRICS_LEDGER_EVENT);
  }

  _retentionEvents() {
    return this._eventsOf(EVOLUTION_WORKBENCH_METRICS_RETENTION_LEDGER_EVENT);
  }

  _resolveRecord(event, expectedType) {
    const authority = this._verifyLedger();
    const resolution = this._resolveArtifact({
      epoch: authority.epoch,
      ledgerId: authority.ledgerId,
      ref: event.subjectRef,
      tenantId: this.descriptor.artifactTenantId,
    });
    if (
      resolution?.schema !== EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA ||
      resolution.authenticated !== true ||
      resolution.found !== true ||
      resolution.ref !== event.subjectRef.ref ||
      resolution.digest !== event.subjectRef.digest ||
      !Buffer.isBuffer(resolution.bytes)
    ) {
      fail("Workbench metrics artifact resolution is invalid");
    }
    let record;
    try {
      record = JSON.parse(resolution.bytes.toString("utf8"));
    } catch {
      fail("Workbench metrics artifact is not canonical JSON");
    }
    if (
      record?.schema !== EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA ||
      record.tenantId !== this.descriptor.artifactTenantId ||
      record.audience !== this.descriptor.audience ||
      record.purpose !== this.descriptor.purpose ||
      record.retention !== "ledger" ||
      record.type !== expectedType
    ) {
      fail("Workbench metrics durable artifact binding is invalid");
    }
    return record.value;
  }

  _resolve(event) {
    return verifyEvolutionWorkbenchMetricsSnapshot(
      this._resolveRecord(event, "evolution-workbench-metrics-snapshot"),
      this.descriptor,
    );
  }

  _latest() {
    const events = this._events();
    if (events.length === 0) return null;
    for (let index = 1; index < events.length; index += 1) {
      if (events[index].sequence <= events[index - 1].sequence) {
        fail("Workbench metrics ledger order is invalid");
      }
    }
    const event = events.at(-1);
    const snapshot = this._resolve(event);
    if (snapshot.revision !== events.length) {
      fail("Workbench metrics revision has a gap or duplicate");
    }
    const retention = snapshot.retentionRootDigest
      ? this._retentionChain(snapshot.retentionRootDigest).at(-1)
      : null;
    if (
      (retention?.segment.retainedReceiptCount ?? 0) !==
      (snapshot.retainedReceiptCount ?? 0)
    ) {
      fail("Workbench metrics snapshot retention binding is invalid");
    }
    return { event, snapshot };
  }

  _retentionChain(rootDigest = null) {
    if (rootDigest === null) return [];
    if (!DIGEST.test(rootDigest))
      fail("Workbench metrics retention root is invalid");
    const events = this._retentionEvents();
    const chain = [];
    let priorRoot = null;
    let priorCount = 0;
    let priorSequence = 0;
    const retainedDigests = new Set();
    for (const event of events) {
      if (event.sequence <= priorSequence) {
        fail("Workbench metrics retention ledger order is invalid");
      }
      priorSequence = event.sequence;
      const segment = verifyRetentionSegment(
        this._resolveRecord(
          event,
          "evolution-workbench-metrics-receipt-retention",
        ),
        this.descriptor,
      );
      if (
        segment.priorRetentionRootDigest !== priorRoot ||
        segment.priorRetainedReceiptCount !== priorCount
      ) {
        fail("Workbench metrics retention lineage is discontinuous");
      }
      for (const value of segment.receiptDigests) {
        if (retainedDigests.has(value)) {
          fail("Workbench metrics retention replayed a receipt digest");
        }
        retainedDigests.add(value);
      }
      chain.push({ event, segment });
      priorRoot = segment.retentionRootDigest;
      priorCount = segment.retainedReceiptCount;
      if (priorRoot === rootDigest) return chain;
    }
    fail("Workbench metrics retention root was not found");
  }

  loadSnapshot = () => {
    const latest = this._latest();
    return latest
      ? Object.freeze({
          found: true,
          authenticated: true,
          durable: true,
          snapshot: latest.snapshot,
        })
      : Object.freeze({ found: false, authenticated: true, durable: true });
  };

  loadOutcomeSnapshot = () => {
    const loaded = this.loadSnapshot();
    const authority = this._verifyLedger();
    return Object.freeze({
      ...loaded,
      descriptor: this.descriptor,
      ledgerAuthority: Object.freeze({
        schema: authority.schema,
        status: authority.status,
        authenticated: authority.authenticated,
        durable: authority.durable,
        ledgerId: authority.ledgerId,
        identityDigest: authority.identityDigest,
        headDigest: authority.headDigest,
        sequence: authority.sequence,
        eventCount: authority.eventCount,
        witnessId: authority.witnessId,
        witnessGeneration: authority.witnessGeneration,
        witnessDigest: authority.witnessDigest,
      }),
    });
  };

  createOutcomeReader = () => {
    const reader = Object.freeze({
      loadOutcomeSnapshot: this.loadOutcomeSnapshot,
    });
    METRICS_OUTCOME_READERS.add(reader);
    return reader;
  };

  retainReceiptDigests = (request = {}) => {
    const receiptDigests = Array.isArray(request.receiptDigests)
      ? [...request.receiptDigests].sort()
      : [];
    if (
      request.tenantId !== this.descriptor.tenantId ||
      request.evolutionRunId !== this.descriptor.evolutionRunId ||
      request.skillName !== this.descriptor.skillName ||
      !Number.isSafeInteger(request.priorRetainedReceiptCount) ||
      request.priorRetainedReceiptCount < 0 ||
      (request.priorRetentionRootDigest !== null &&
        !DIGEST.test(request.priorRetentionRootDigest ?? "")) ||
      typeof request.throughAt !== "string" ||
      !Number.isFinite(Date.parse(request.throughAt)) ||
      receiptDigests.length < 1 ||
      receiptDigests.length > 10_000 ||
      new Set(receiptDigests).size !== receiptDigests.length ||
      receiptDigests.some((item) => !DIGEST.test(item)) ||
      !Number.isSafeInteger(
        request.priorRetainedReceiptCount + receiptDigests.length,
      )
    ) {
      throw new TypeError("Workbench metrics retention request is invalid");
    }
    const batch = {
      tenantId: this.descriptor.tenantId,
      evolutionRunId: this.descriptor.evolutionRunId,
      skillName: this.descriptor.skillName,
      priorRetentionRootDigest: request.priorRetentionRootDigest,
      priorRetainedReceiptCount: request.priorRetainedReceiptCount,
      throughAt: request.throughAt,
      receiptDigests,
    };
    const batchDigest = digestEvolutionWorkbenchMetricsRetentionBatch(batch);
    const retentionEvents = this._retentionEvents();
    const latest = retentionEvents.length
      ? this._retentionChain(
          verifyRetentionSegment(
            this._resolveRecord(
              retentionEvents.at(-1),
              "evolution-workbench-metrics-receipt-retention",
            ),
            this.descriptor,
          ).retentionRootDigest,
        ).at(-1)
      : null;
    if (
      (latest?.segment.retentionRootDigest ?? null) !==
        request.priorRetentionRootDigest ||
      (latest?.segment.retainedReceiptCount ?? 0) !==
        request.priorRetainedReceiptCount
    ) {
      if (
        latest?.segment.priorRetentionRootDigest ===
          request.priorRetentionRootDigest &&
        latest.segment.priorRetainedReceiptCount ===
          request.priorRetainedReceiptCount &&
        latest.segment.batchDigest === batchDigest
      ) {
        return Object.freeze({
          authenticated: true,
          durable: true,
          recovered: true,
          priorRetentionRootDigest: request.priorRetentionRootDigest,
          retainedReceiptCount: latest.segment.retainedReceiptCount,
          retentionRootDigest: latest.segment.retentionRootDigest,
          batchDigest,
        });
      }
      fail("Workbench metrics retention CAS conflict");
    }
    if (latest) {
      const retained = new Set(
        this._retentionChain(latest.segment.retentionRootDigest).flatMap(
          ({ segment }) => segment.receiptDigests,
        ),
      );
      if (receiptDigests.some((value) => retained.has(value))) {
        fail("Workbench metrics retention source replayed a receipt");
      }
    }
    const segmentCore = {
      schema: EVOLUTION_WORKBENCH_METRICS_RETENTION_SCHEMA,
      ...batch,
      batchDigest,
      retainedReceiptCount:
        request.priorRetainedReceiptCount + receiptDigests.length,
    };
    const segment = Object.freeze({
      ...segmentCore,
      retentionRootDigest: hash(
        EVOLUTION_WORKBENCH_METRICS_RETENTION_SCHEMA,
        segmentCore,
      ),
    });
    const head = this._verifyLedger();
    const published = this._putCanonical(
      "evolution-workbench-metrics-receipt-retention",
      segment,
      {
        audience: this.descriptor.audience,
        purpose: this.descriptor.purpose,
        retention: "ledger",
      },
    );
    if (
      !published?.ref ||
      published.receipt?.persisted !== true ||
      published.receipt?.readbackVerified !== true ||
      published.receipt?.integrityVerified !== true ||
      published.receipt?.retention !== "ledger"
    ) {
      fail("Workbench metrics retention artifact was not durably read back");
    }
    const eventId = `workbench.metrics.retention.${segment.retentionRootDigest.slice("sha256:".length)}`;
    const receipt = this._appendDomainEvent(
      {
        artifactTenantId: this.descriptor.artifactTenantId,
        correlationId: this.descriptor.evolutionRunId,
        decision: "committed",
        eventId,
        reason: `${receiptDigests.length} Workbench receipt digests retained`,
        skillName: this.descriptor.skillName,
        sourceRefs: latest ? [latest.event.subjectRef] : [],
        subjectRef: published.ref,
        tenantId: this.descriptor.tenantId,
        timestamp: request.throughAt,
        type: EVOLUTION_WORKBENCH_METRICS_RETENTION_LEDGER_EVENT,
      },
      { expectedHeadDigest: head.headDigest, expectedSequence: head.sequence },
    );
    if (
      receipt?.authenticated !== true ||
      receipt.committed !== true ||
      receipt.durable !== true ||
      receipt.eventId !== eventId ||
      !DIGEST.test(receipt.receiptDigest ?? "")
    ) {
      fail("Workbench metrics retention ledger append was not durable");
    }
    const stored = this._retentionChain(segment.retentionRootDigest).at(-1);
    if (stored?.segment.retentionRootDigest !== segment.retentionRootDigest) {
      fail("Workbench metrics retention readback differs after commit");
    }
    return Object.freeze({
      authenticated: true,
      durable: true,
      recovered: false,
      priorRetentionRootDigest: request.priorRetentionRootDigest,
      retainedReceiptCount: segment.retainedReceiptCount,
      retentionRootDigest: segment.retentionRootDigest,
      batchDigest,
      ledgerReceiptDigest: receipt.receiptDigest,
    });
  };

  queryRetainedReceiptDigests = (request = {}) => {
    if (
      request.tenantId !== this.descriptor.tenantId ||
      request.evolutionRunId !== this.descriptor.evolutionRunId ||
      request.skillName !== this.descriptor.skillName ||
      !DIGEST.test(request.retentionRootDigest ?? "") ||
      !Array.isArray(request.receiptDigests) ||
      request.receiptDigests.length > 10_000 ||
      request.receiptDigests.some((item) => !DIGEST.test(item))
    ) {
      throw new TypeError("Workbench metrics retention query is invalid");
    }
    const retained = new Set();
    for (const { segment } of this._retentionChain(
      request.retentionRootDigest,
    )) {
      for (const value of segment.receiptDigests) retained.add(value);
    }
    return Object.freeze({
      authenticated: true,
      durable: true,
      retentionRootDigest: request.retentionRootDigest,
      queryDigest: digestEvolutionWorkbenchMetricsRetentionQuery(request),
      matches: Object.freeze(
        request.receiptDigests.map((value) => retained.has(value)),
      ),
    });
  };

  commitSnapshot = ({ expectedSnapshotDigest, snapshot } = {}) => {
    if (!DIGEST.test(expectedSnapshotDigest ?? "")) {
      throw new TypeError("expectedSnapshotDigest is invalid");
    }
    const verified = verifyEvolutionWorkbenchMetricsSnapshot(
      snapshot,
      this.descriptor,
    );
    const latest = this._latest();
    const current =
      latest?.snapshot ??
      createEmptyEvolutionWorkbenchMetricsSnapshot(
        this.descriptor.tenantId,
        this.descriptor.evolutionRunId,
        this.descriptor.skillName,
      );
    if (current.snapshotDigest !== expectedSnapshotDigest) {
      if (latest?.snapshot.snapshotDigest === verified.snapshotDigest) {
        return Object.freeze({
          authenticated: true,
          durable: true,
          recovered: true,
          snapshotDigest: verified.snapshotDigest,
        });
      }
      fail("Workbench metrics snapshot CAS conflict");
    }
    if (
      verified.revision !== current.revision + 1 ||
      verified.priorSnapshotDigest !== current.snapshotDigest
    ) {
      fail("Workbench metrics snapshot does not extend current state");
    }
    const retention = verified.retentionRootDigest
      ? this._retentionChain(verified.retentionRootDigest).at(-1)
      : null;
    if (
      (retention?.segment.retainedReceiptCount ?? 0) !==
      (verified.retainedReceiptCount ?? 0)
    ) {
      fail("Workbench metrics snapshot retention binding is invalid");
    }
    const head = this._verifyLedger();
    const published = this._putCanonical(
      "evolution-workbench-metrics-snapshot",
      verified,
      {
        audience: this.descriptor.audience,
        purpose: this.descriptor.purpose,
        retention: "ledger",
      },
    );
    if (
      !published?.ref ||
      published.receipt?.persisted !== true ||
      published.receipt?.readbackVerified !== true ||
      published.receipt?.integrityVerified !== true ||
      published.receipt?.retention !== "ledger"
    ) {
      fail("Workbench metrics artifact was not durably read back");
    }
    const eventId = `workbench.metrics.${verified.snapshotDigest.slice("sha256:".length)}`;
    const receipt = this._appendDomainEvent(
      {
        artifactTenantId: this.descriptor.artifactTenantId,
        correlationId: this.descriptor.evolutionRunId,
        decision: "committed",
        eventId,
        reason: `Workbench metrics revision ${verified.revision} committed`,
        skillName: this.descriptor.skillName,
        sourceRefs: [
          ...(latest ? [latest.event.subjectRef] : []),
          ...(retention ? [retention.event.subjectRef] : []),
        ],
        subjectRef: published.ref,
        tenantId: this.descriptor.tenantId,
        timestamp: verified.throughAt,
        type: EVOLUTION_WORKBENCH_METRICS_LEDGER_EVENT,
      },
      { expectedHeadDigest: head.headDigest, expectedSequence: head.sequence },
    );
    if (
      receipt?.authenticated !== true ||
      receipt.committed !== true ||
      receipt.durable !== true ||
      receipt.eventId !== eventId ||
      !DIGEST.test(receipt.receiptDigest ?? "")
    ) {
      fail("Workbench metrics ledger append was not durable");
    }
    const stored = this._latest();
    if (stored?.snapshot.snapshotDigest !== verified.snapshotDigest) {
      fail("Workbench metrics ledger readback differs after commit");
    }
    return Object.freeze({
      authenticated: true,
      durable: true,
      recovered: false,
      snapshotDigest: verified.snapshotDigest,
      ledgerReceiptDigest: receipt.receiptDigest,
    });
  };

  aggregatorPorts({ readReceiptDelta } = {}) {
    if (typeof readReceiptDelta !== "function") {
      throw new TypeError("readReceiptDelta is required");
    }
    return Object.freeze({
      loadSnapshot: this.loadSnapshot,
      readReceiptDelta,
      commitSnapshot: this.commitSnapshot,
      retainReceiptDigests: this.retainReceiptDigests,
      queryRetainedReceiptDigests: this.queryRetainedReceiptDigests,
    });
  }

  backfillPorts({ readReceiptHistory } = {}) {
    if (typeof readReceiptHistory !== "function") {
      throw new TypeError("readReceiptHistory is required");
    }
    return Object.freeze({
      loadSnapshot: this.loadSnapshot,
      readReceiptHistory,
      commitSnapshot: this.commitSnapshot,
      queryRetainedReceiptDigests: this.queryRetainedReceiptDigests,
    });
  }
}

export function isEvolutionWorkbenchMetricsLedgerAdapter(value) {
  return METRICS_LEDGER_ADAPTERS.has(value);
}

export function isEvolutionWorkbenchMetricsOutcomeReader(value) {
  return METRICS_OUTCOME_READERS.has(value);
}
import { createHash } from "node:crypto";

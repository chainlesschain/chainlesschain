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
  verifyEvolutionWorkbenchMetricsSnapshot,
} from "./evolution-workbench-metrics.js";

export const EVOLUTION_WORKBENCH_METRICS_LEDGER_EVENT =
  "evolution.workbench.metrics.snapshot.committed";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;

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
    Object.freeze(this);
  }

  _events() {
    const events = this._readLedger();
    if (!Array.isArray(events))
      fail("Workbench metrics ledger read is invalid");
    return events.filter(
      (event) =>
        event.schema === EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA &&
        event.type === EVOLUTION_WORKBENCH_METRICS_LEDGER_EVENT &&
        event.tenantId === this.descriptor.tenantId &&
        event.correlationId === this.descriptor.evolutionRunId &&
        event.skillName === this.descriptor.skillName,
    );
  }

  _resolve(event) {
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
      record.type !== "evolution-workbench-metrics-snapshot"
    ) {
      fail("Workbench metrics durable artifact binding is invalid");
    }
    return verifyEvolutionWorkbenchMetricsSnapshot(
      record.value,
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
    return { event, snapshot };
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
        sourceRefs: latest ? [latest.event.subjectRef] : [],
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
    });
  }
}

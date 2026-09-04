import {
  EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA,
  isEvolutionLedgerArtifactResolver,
} from "./evolution-artifact-ports.js";
import {
  EVOLUTION_EVAL_ATTESTATION_PURPOSES,
  EVOLUTION_EVAL_RECEIPT_SCHEMA,
  EVOLUTION_EVAL_TARGET_INVOCATION_SCHEMA,
  EVOLUTION_EVAL_TARGET_REVOCATION_SCHEMA,
  computeEvolutionEvalReceiptDigest,
  computeEvolutionEvalSignedEvidenceDigest,
} from "./evolution-eval-gate.js";
import {
  EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA,
  EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA,
} from "./evolution-ledger.js";

export const EVOLUTION_EVAL_CHILD_EVIDENCE_RECORD_SCHEMA =
  "chainlesschain.evolution-eval-child-evidence-record/v1";
export const EVOLUTION_EVAL_CHILD_EVIDENCE_RESOLUTION_SCHEMA =
  "chainlesschain.evolution-eval-child-evidence-resolution/v1";
export const EVOLUTION_EVAL_CHILD_EVIDENCE_EVENT_TYPE =
  "evolution.eval-child-evidence.retained";
export const EVOLUTION_EVAL_CHILD_EVIDENCE_CORRUPT_CODE =
  "CC_EVOLUTION_EVAL_CHILD_EVIDENCE_CORRUPT";

const ARTIFACT_TYPE = "evolution-eval-child-evidence";
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const CHILD_EVIDENCE_STORES = new WeakSet();
const KINDS = Object.freeze({
  "gate-receipt": Object.freeze({
    purpose: null,
    schema: EVOLUTION_EVAL_RECEIPT_SCHEMA,
  }),
  invocation: Object.freeze({
    purpose: EVOLUTION_EVAL_ATTESTATION_PURPOSES.targetInvocation,
    schema: EVOLUTION_EVAL_TARGET_INVOCATION_SCHEMA,
  }),
  revocation: Object.freeze({
    purpose: EVOLUTION_EVAL_ATTESTATION_PURPOSES.targetRevocation,
    schema: EVOLUTION_EVAL_TARGET_REVOCATION_SCHEMA,
  }),
});

function requiredString(value, label) {
  if (typeof value !== "string" || value.trim() === "")
    throw new TypeError(`${label} is required`);
  return value;
}

function capture(owner, method, label = method) {
  if (typeof owner?.[method] !== "function")
    throw new TypeError(`${label} port is required`);
  return (...args) => Reflect.apply(owner[method], owner, args);
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function corrupt(message) {
  const error = new Error(message);
  error.code = EVOLUTION_EVAL_CHILD_EVIDENCE_CORRUPT_CODE;
  throw error;
}

function descriptor(input) {
  if (!Number.isSafeInteger(input?.revision) || input.revision < 1)
    throw new TypeError("revision must be a positive integer");
  if (!DIGEST.test(input?.handlerArtifactDigest || ""))
    throw new TypeError("handlerArtifactDigest must be sha256-bound");
  return Object.freeze({
    tenantId: requiredString(input.tenantId, "tenantId"),
    artifactTenantId: requiredString(
      input.artifactTenantId,
      "artifactTenantId",
    ),
    streamId: requiredString(input.streamId, "streamId"),
    audience: requiredString(input.audience, "audience"),
    purpose: requiredString(input.purpose, "purpose"),
    authorityId: requiredString(input.authorityId, "authorityId"),
    revision: input.revision,
    handlerArtifactDigest: input.handlerArtifactDigest,
  });
}

function storeDescriptor(input) {
  if (!Number.isSafeInteger(input?.revision) || input.revision < 1)
    throw new TypeError("child evidence store revision must be positive");
  if (!DIGEST.test(input?.handlerArtifactDigest || ""))
    throw new TypeError("child evidence store handler digest is invalid");
  return Object.freeze({
    tenantId: requiredString(input.tenantId, "child evidence store tenantId"),
    streamId: requiredString(input.streamId, "child evidence store streamId"),
    authorityId: requiredString(
      input.authorityId,
      "child evidence store authorityId",
    ),
    revision: input.revision,
    handlerArtifactDigest: input.handlerArtifactDigest,
  });
}

function captureEvidence(kind, evidence, expectedDigest) {
  const policy = KINDS[kind];
  if (!policy) throw new TypeError("child evidence kind is invalid");
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence))
    throw new TypeError("child evidence must be a record");
  const captured = Object.freeze(structuredClone(evidence));
  if (captured.schema !== policy.schema)
    throw new TypeError("child evidence schema does not match its kind");
  const receiptDigest =
    kind === "gate-receipt"
      ? computeEvolutionEvalReceiptDigest(captured)
      : computeEvolutionEvalSignedEvidenceDigest(captured, policy.purpose);
  if (kind === "gate-receipt" && captured.receiptDigest !== receiptDigest)
    throw new TypeError("Gate child receipt digest is invalid");
  if (expectedDigest !== undefined && receiptDigest !== expectedDigest)
    throw new TypeError("child evidence digest does not match its bytes");
  return Object.freeze({ captured, receiptDigest });
}

export class EvolutionEvalChildEvidenceLedgerAdapter {
  constructor({
    descriptor: input,
    artifactPorts,
    ledger,
    ledgerArtifactResolver,
    now = Date.now,
  } = {}) {
    this.descriptor = descriptor(input);
    this._put = capture(artifactPorts, "putCanonical");
    this._read = capture(ledger, "read");
    this._verifyLedger = capture(ledger, "verify");
    this._append = capture(ledger, "appendDomainEvent");
    if (!isEvolutionLedgerArtifactResolver(ledgerArtifactResolver))
      throw new TypeError(
        "a branded EvolutionArtifactPorts ledger resolver is required",
      );
    if (typeof now !== "function")
      throw new TypeError("now must be a function");
    this._resolveArtifact = ledgerArtifactResolver;
    this._now = now;
    CHILD_EVIDENCE_STORES.add(this);
    Object.freeze(this);
  }

  _events() {
    const events = this._read();
    if (!Array.isArray(events))
      corrupt("EvolutionLedger did not return events");
    return events.filter(
      (event) =>
        event.schema === EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA &&
        event.type === EVOLUTION_EVAL_CHILD_EVIDENCE_EVENT_TYPE &&
        event.tenantId === this.descriptor.tenantId &&
        event.correlationId === this.descriptor.streamId,
    );
  }

  _resolveEvent(event) {
    if (
      event.artifactTenantId !== this.descriptor.artifactTenantId ||
      event.decision !== "accepted" ||
      event.skillName !== "evolution-eval" ||
      !Array.isArray(event.sourceRefs) ||
      event.sourceRefs.length !== 0
    ) {
      corrupt("child evidence ledger event binding is invalid");
    }
    const identity = this._verifyLedger();
    const resolution = this._resolveArtifact({
      epoch: identity.epoch,
      ledgerId: identity.ledgerId,
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
      corrupt("child evidence artifact resolution is invalid");
    }
    let durableRecord;
    try {
      durableRecord = JSON.parse(resolution.bytes.toString("utf8"));
    } catch {
      corrupt("child evidence artifact is not JSON");
    }
    if (
      durableRecord?.schema !== EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA ||
      durableRecord.tenantId !== this.descriptor.artifactTenantId ||
      durableRecord.audience !== this.descriptor.audience ||
      durableRecord.purpose !== this.descriptor.purpose ||
      durableRecord.retention !== "ledger" ||
      durableRecord.type !== ARTIFACT_TYPE
    ) {
      corrupt("child evidence durable record binding is invalid");
    }
    const value = durableRecord.value;
    if (
      value?.schema !== EVOLUTION_EVAL_CHILD_EVIDENCE_RECORD_SCHEMA ||
      value.tenantId !== this.descriptor.tenantId ||
      value.streamId !== this.descriptor.streamId
    ) {
      corrupt("child evidence record scope is invalid");
    }
    const verified = captureEvidence(
      value.kind,
      value.evidence,
      value.receiptDigest,
    );
    if (
      event.eventId !==
      `${EVOLUTION_EVAL_CHILD_EVIDENCE_EVENT_TYPE}.${verified.receiptDigest.slice(7)}`
    ) {
      corrupt("child evidence event identity is invalid");
    }
    return Object.freeze({
      kind: value.kind,
      evidence: verified.captured,
      receiptDigest: verified.receiptDigest,
      event,
    });
  }

  async retain({ kind, evidence, receiptDigest } = {}) {
    const verified = captureEvidence(kind, evidence, receiptDigest);
    const eventId = `${EVOLUTION_EVAL_CHILD_EVIDENCE_EVENT_TYPE}.${verified.receiptDigest.slice(7)}`;
    const existing = this._events().filter(
      (event) => event.eventId === eventId,
    );
    if (existing.length > 1) corrupt("child evidence event is ambiguous");
    if (existing.length === 1) {
      const recovered = this._resolveEvent(existing[0]);
      if (
        recovered.kind !== kind ||
        canonical(recovered.evidence) !== canonical(verified.captured)
      ) {
        corrupt("child evidence event resolved substituted bytes");
      }
      return Object.freeze({
        authenticated: true,
        durable: true,
        recovered: true,
        kind,
        receiptDigest: verified.receiptDigest,
      });
    }
    const head = this._verifyLedger();
    const nowMs = Number(this._now());
    if (!Number.isFinite(nowMs))
      throw new TypeError("child evidence clock is invalid");
    const record = Object.freeze({
      schema: EVOLUTION_EVAL_CHILD_EVIDENCE_RECORD_SCHEMA,
      tenantId: this.descriptor.tenantId,
      streamId: this.descriptor.streamId,
      kind,
      receiptDigest: verified.receiptDigest,
      evidence: verified.captured,
    });
    const published = this._put(ARTIFACT_TYPE, record, {
      audience: this.descriptor.audience,
      purpose: this.descriptor.purpose,
      retention: "ledger",
    });
    if (
      published?.receipt?.persisted !== true ||
      published.receipt.readbackVerified !== true ||
      published.receipt.integrityVerified !== true ||
      published.receipt.retention !== "ledger"
    ) {
      corrupt("child evidence persistence was not durably confirmed");
    }
    const receipt = this._append(
      {
        artifactTenantId: this.descriptor.artifactTenantId,
        correlationId: this.descriptor.streamId,
        decision: "accepted",
        eventId,
        reason: `durable ${kind} child evidence`,
        skillName: "evolution-eval",
        sourceRefs: [],
        subjectRef: published.ref,
        tenantId: this.descriptor.tenantId,
        timestamp: new Date(nowMs).toISOString(),
        type: EVOLUTION_EVAL_CHILD_EVIDENCE_EVENT_TYPE,
      },
      { expectedHeadDigest: head.headDigest, expectedSequence: head.sequence },
    );
    if (receipt?.authenticated !== true || receipt.durable !== true)
      corrupt("child evidence ledger append was not durable");
    return Object.freeze({
      authenticated: true,
      durable: true,
      recovered: false,
      kind,
      receiptDigest: verified.receiptDigest,
      ledgerReceiptDigest: receipt.receiptDigest,
    });
  }

  async resolve({ tenantId, kind, receiptDigest } = {}) {
    if (
      tenantId !== this.descriptor.tenantId ||
      !KINDS[kind] ||
      !DIGEST.test(receiptDigest || "")
    ) {
      throw new TypeError("child evidence resolution request is invalid");
    }
    const matches = this._events()
      .filter(
        (event) =>
          event.eventId ===
          `${EVOLUTION_EVAL_CHILD_EVIDENCE_EVENT_TYPE}.${receiptDigest.slice(7)}`,
      )
      .map((event) => this._resolveEvent(event))
      .filter(
        (entry) => entry.kind === kind && entry.receiptDigest === receiptDigest,
      );
    if (matches.length !== 1) corrupt("child evidence is missing or ambiguous");
    const resolvedAtMs = Number(this._now());
    if (!Number.isFinite(resolvedAtMs))
      throw new TypeError("child evidence clock is invalid");
    return Object.freeze({
      schema: EVOLUTION_EVAL_CHILD_EVIDENCE_RESOLUTION_SCHEMA,
      authenticated: true,
      durable: true,
      authorityId: this.descriptor.authorityId,
      revision: this.descriptor.revision,
      handlerArtifactDigest: this.descriptor.handlerArtifactDigest,
      tenantId,
      streamId: this.descriptor.streamId,
      kind,
      receiptDigest,
      evidence: matches[0].evidence,
      resolvedAt: new Date(resolvedAtMs).toISOString(),
    });
  }
}

export function createEvolutionEvalChildEvidenceLedgerAdapter(options) {
  return new EvolutionEvalChildEvidenceLedgerAdapter(options);
}

export function createEvolutionEvalChildEvidenceStorePort({
  descriptor: input,
  retain,
  resolve,
} = {}) {
  if (typeof retain !== "function" || typeof resolve !== "function")
    throw new TypeError("child evidence store ports are required");
  const port = Object.freeze({
    descriptor: storeDescriptor(input),
    retain: (...args) => Reflect.apply(retain, undefined, args),
    resolve: (...args) => Reflect.apply(resolve, undefined, args),
  });
  CHILD_EVIDENCE_STORES.add(port);
  return port;
}

export function isEvolutionEvalChildEvidenceStore(value) {
  return CHILD_EVIDENCE_STORES.has(value);
}

import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";

import {
  EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA,
  isEvolutionLedgerArtifactResolver,
} from "./evolution-artifact-ports.js";
import {
  EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA,
  EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA,
} from "./evolution-ledger.js";
import { EVOLUTION_RAW_DELETION_TOMBSTONE_SCHEMA } from "./evolution-raw-crypto-shred.js";

export const EVOLUTION_RAW_DELETION_RECEIPT_SCHEMA =
  "chainlesschain.evolution-raw-deletion-receipt/v1";
export const EVOLUTION_RAW_DELETION_LEDGER_RECORD_SCHEMA =
  "chainlesschain.evolution-raw-deletion-ledger-record/v1";
export const EVOLUTION_RAW_DELETION_RESOLUTION_SCHEMA =
  "chainlesschain.evolution-raw-deletion-resolution/v1";
export const EVOLUTION_RAW_TOMBSTONE_RESOLUTION_SCHEMA =
  "chainlesschain.evolution-raw-tombstone-resolution/v1";
export const EVOLUTION_RAW_DELETION_RECEIPT_EVENT_TYPE =
  "evolution.raw-deletion.receipt-retained";
export const EVOLUTION_RAW_DELETION_TOMBSTONE_EVENT_TYPE =
  "evolution.raw-deletion.tombstone-retained";
export const EVOLUTION_RAW_DELETION_LEDGER_CORRUPT_CODE =
  "CC_EVOLUTION_RAW_DELETION_LEDGER_CORRUPT";

const RECEIPT_ARTIFACT_TYPE = "evolution-raw-deletion-receipt";
const TOMBSTONE_ARTIFACT_TYPE = "evolution-raw-deletion-tombstone";
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const RECEIPT_KEYS = new Set([
  "schema",
  "tenantId",
  "decision",
  "evidenceRef",
  "sourceDigest",
  "artifactRef",
  "rawArtifactRef",
  "rawCipherDigest",
  "keyRef",
  "issuedAt",
  "attestation",
  "receiptDigest",
]);
const ATTESTATION_KEYS = new Set([
  "algorithm",
  "issuer",
  "keyId",
  "trustPolicyDigest",
  "value",
]);
const TOMBSTONE_KEYS = new Set([
  "schema",
  "tenantId",
  "pruningRequestDigest",
  "destructionRequestDigest",
  "destructionReceiptDigest",
  "confirmationReceiptDigest",
  "evidenceRef",
  "rawArtifactRef",
  "rawCipherDigest",
  "deletionReceiptDigest",
  "tombstoneDigest",
]);
const RECORD_KEYS = new Set([
  "schema",
  "tenantId",
  "streamId",
  "kind",
  "logicalDigest",
  "value",
]);

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

function freeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) freeze(child, seen);
  return Object.freeze(value);
}

function corrupt(message, options) {
  const error = new Error(message, options);
  error.code = EVOLUTION_RAW_DELETION_LEDGER_CORRUPT_CODE;
  throw error;
}

function exact(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new TypeError(`${label} must be a plain record`);
  }
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.size ||
    ownKeys.some((key) => typeof key !== "string" || !keys.has(key))
  ) {
    throw new TypeError(`${label} must contain exactly the supported fields`);
  }
  for (const key of ownKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError(`${label}.${String(key)} is unsafe`);
    }
  }
}

function string(value, label, maximum = 1024) {
  if (
    typeof value !== "string" ||
    value === "" ||
    value.trim() !== value ||
    Buffer.byteLength(value, "utf8") > maximum
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function digest(value, label) {
  if (!DIGEST.test(value ?? "")) throw new TypeError(`${label} is invalid`);
  return value;
}

function timestamp(value, label) {
  if (typeof value !== "string" || new Date(value).toISOString() !== value) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function capture(owner, method, label = method) {
  if (typeof owner?.[method] !== "function") {
    throw new TypeError(`${label} port is required`);
  }
  return (...args) => Reflect.apply(owner[method], owner, args);
}

function normalizeDescriptor(input) {
  if (!Number.isSafeInteger(input?.revision) || input.revision < 1) {
    throw new TypeError("revision must be a positive integer");
  }
  return Object.freeze({
    tenantId: string(input.tenantId, "tenantId"),
    artifactTenantId: string(input.artifactTenantId, "artifactTenantId"),
    streamId: string(input.streamId, "streamId"),
    audience: string(input.audience, "audience"),
    purpose: string(input.purpose, "purpose"),
    authorityId: string(input.authorityId, "authorityId"),
    revision: input.revision,
    handlerArtifactDigest: digest(
      input.handlerArtifactDigest,
      "handlerArtifactDigest",
    ),
  });
}

function normalizeAttestation(value) {
  exact(value, ATTESTATION_KEYS, "raw deletion attestation");
  return Object.freeze({
    algorithm: string(value.algorithm, "attestation.algorithm", 64),
    issuer: string(value.issuer, "attestation.issuer", 256),
    keyId: string(value.keyId, "attestation.keyId", 512),
    trustPolicyDigest: digest(
      value.trustPolicyDigest,
      "attestation.trustPolicyDigest",
    ),
    value: string(value.value, "attestation.value", 4096),
  });
}

export function digestEvolutionRawDeletionReceipt(input) {
  const core = structuredClone(input);
  delete core.receiptDigest;
  return hash(EVOLUTION_RAW_DELETION_RECEIPT_SCHEMA, core);
}

function normalizeDeletionReceipt(input, tenantId) {
  exact(input, RECEIPT_KEYS, "raw deletion receipt");
  const receipt = {
    schema: input.schema,
    tenantId: string(input.tenantId, "deletion receipt tenantId"),
    decision: input.decision,
    evidenceRef: string(input.evidenceRef, "deletion receipt evidenceRef"),
    sourceDigest: digest(input.sourceDigest, "deletion receipt sourceDigest"),
    artifactRef: string(input.artifactRef, "deletion receipt artifactRef"),
    rawArtifactRef: string(
      input.rawArtifactRef,
      "deletion receipt rawArtifactRef",
    ),
    rawCipherDigest: digest(
      input.rawCipherDigest,
      "deletion receipt rawCipherDigest",
    ),
    keyRef: string(input.keyRef, "deletion receipt keyRef"),
    issuedAt: timestamp(input.issuedAt, "deletion receipt issuedAt"),
    attestation: normalizeAttestation(input.attestation),
    receiptDigest: digest(
      input.receiptDigest,
      "deletion receipt receiptDigest",
    ),
  };
  if (
    receipt.schema !== EVOLUTION_RAW_DELETION_RECEIPT_SCHEMA ||
    receipt.tenantId !== tenantId ||
    receipt.decision !== "delete" ||
    !receipt.rawArtifactRef.startsWith(`artifact://${tenantId}/raw/`) ||
    !receipt.keyRef.startsWith(`kms://${tenantId}/`) ||
    receipt.receiptDigest !== digestEvolutionRawDeletionReceipt(receipt)
  ) {
    throw new TypeError("raw deletion receipt binding is invalid");
  }
  return freeze(receipt);
}

function normalizeTombstone(input, tenantId) {
  exact(input, TOMBSTONE_KEYS, "raw deletion tombstone");
  const tombstone = {
    schema: input.schema,
    tenantId: string(input.tenantId, "tombstone tenantId"),
    pruningRequestDigest: digest(
      input.pruningRequestDigest,
      "tombstone pruningRequestDigest",
    ),
    destructionRequestDigest: digest(
      input.destructionRequestDigest,
      "tombstone destructionRequestDigest",
    ),
    destructionReceiptDigest: digest(
      input.destructionReceiptDigest,
      "tombstone destructionReceiptDigest",
    ),
    confirmationReceiptDigest: digest(
      input.confirmationReceiptDigest,
      "tombstone confirmationReceiptDigest",
    ),
    evidenceRef: string(input.evidenceRef, "tombstone evidenceRef"),
    rawArtifactRef: string(input.rawArtifactRef, "tombstone rawArtifactRef"),
    rawCipherDigest: digest(input.rawCipherDigest, "tombstone rawCipherDigest"),
    deletionReceiptDigest: digest(
      input.deletionReceiptDigest,
      "tombstone deletionReceiptDigest",
    ),
    tombstoneDigest: digest(input.tombstoneDigest, "tombstone tombstoneDigest"),
  };
  const core = { ...tombstone };
  delete core.tombstoneDigest;
  if (
    tombstone.schema !== EVOLUTION_RAW_DELETION_TOMBSTONE_SCHEMA ||
    tombstone.tenantId !== tenantId ||
    !tombstone.rawArtifactRef.startsWith(`artifact://${tenantId}/raw/`) ||
    tombstone.tombstoneDigest !==
      hash(EVOLUTION_RAW_DELETION_TOMBSTONE_SCHEMA, core)
  ) {
    throw new TypeError("raw deletion tombstone binding is invalid");
  }
  return freeze(tombstone);
}

function parseRecord(resolution, descriptor, expected) {
  if (
    resolution?.schema !== EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA ||
    resolution.authenticated !== true ||
    resolution.found !== true ||
    !DIGEST.test(resolution.digest ?? "") ||
    !DIGEST.test(resolution.receiptDigest ?? "") ||
    !Buffer.isBuffer(resolution.bytes)
  ) {
    corrupt("raw deletion artifact resolution is incomplete");
  }
  let record;
  try {
    record = JSON.parse(resolution.bytes.toString("utf8"));
  } catch {
    corrupt("raw deletion artifact is not JSON");
  }
  if (
    record?.schema !== EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA ||
    record.tenantId !== descriptor.artifactTenantId ||
    record.audience !== descriptor.audience ||
    record.purpose !== descriptor.purpose ||
    record.retention !== "ledger" ||
    record.type !== expected.artifactType
  ) {
    corrupt("raw deletion durable artifact binding is invalid");
  }
  const value = record.value;
  try {
    exact(value, RECORD_KEYS, "raw deletion ledger record");
  } catch (cause) {
    corrupt("raw deletion ledger record is invalid", { cause });
  }
  if (
    value.schema !== EVOLUTION_RAW_DELETION_LEDGER_RECORD_SCHEMA ||
    value.tenantId !== descriptor.tenantId ||
    value.streamId !== descriptor.streamId ||
    value.kind !== expected.kind ||
    !DIGEST.test(value.logicalDigest ?? "")
  ) {
    corrupt("raw deletion ledger record scope is invalid");
  }
  return value;
}

export class EvolutionRawDeletionLedgerAdapter {
  constructor({
    descriptor: input,
    artifactPorts,
    ledger,
    ledgerArtifactResolver,
    deletionReceiptVerifier,
    now = Date.now,
  } = {}) {
    this.descriptor = normalizeDescriptor(input);
    this._put = capture(artifactPorts, "putCanonical");
    this._read = capture(ledger, "read");
    this._verifyLedger = capture(ledger, "verify");
    this._append = capture(ledger, "appendDomainEvent");
    this._verifyDeletionReceipt = capture(
      deletionReceiptVerifier,
      "verify",
      "deletionReceiptVerifier.verify",
    );
    if (!isEvolutionLedgerArtifactResolver(ledgerArtifactResolver)) {
      throw new TypeError(
        "a branded EvolutionArtifactPorts ledger resolver is required",
      );
    }
    if (typeof now !== "function")
      throw new TypeError("now must be a function");
    this._resolveArtifact = ledgerArtifactResolver;
    this._now = now;
    Object.freeze(this);
  }

  _events(type) {
    const events = this._read();
    if (!Array.isArray(events)) {
      corrupt("EvolutionLedger did not return an event array");
    }
    return events.filter(
      (event) =>
        event.schema === EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA &&
        event.type === type &&
        event.tenantId === this.descriptor.tenantId &&
        event.correlationId === this.descriptor.streamId,
    );
  }

  _event(type, logicalDigest) {
    const eventId = `${type}.${logicalDigest.slice("sha256:".length)}`;
    const matches = this._events(type).filter(
      (event) => event.eventId === eventId,
    );
    if (matches.length > 1) corrupt("raw deletion ledger event is ambiguous");
    return matches[0] ?? null;
  }

  _resolveEvent(event, expected) {
    if (
      event.artifactTenantId !== this.descriptor.artifactTenantId ||
      event.decision !== expected.decision ||
      event.skillName !== null ||
      !Array.isArray(event.sourceRefs) ||
      event.sourceRefs.length !== expected.sourceCount
    ) {
      corrupt("raw deletion ledger event binding is invalid");
    }
    const identity = this._verifyLedger();
    const resolution = this._resolveArtifact({
      epoch: identity.epoch,
      ledgerId: identity.ledgerId,
      ref: event.subjectRef,
      tenantId: this.descriptor.artifactTenantId,
    });
    if (
      resolution.ref !== event.subjectRef.ref ||
      resolution.digest !== event.subjectRef.digest
    ) {
      corrupt("raw deletion ledger subject was substituted");
    }
    return parseRecord(resolution, this.descriptor, expected);
  }

  async _verifiedReceipt(event, source) {
    const record = this._resolveEvent(event, {
      artifactType: RECEIPT_ARTIFACT_TYPE,
      decision: "accepted",
      kind: "deletion-receipt",
      sourceCount: 0,
    });
    const receipt = normalizeDeletionReceipt(
      record.value,
      this.descriptor.tenantId,
    );
    if (
      record.logicalDigest !== receipt.receiptDigest ||
      (await this._verifyDeletionReceipt({
        receipt,
        tenantId: this.descriptor.tenantId,
        streamId: this.descriptor.streamId,
        source,
      })) !== true
    ) {
      corrupt("raw deletion receipt authentication failed");
    }
    return Object.freeze({ event, receipt });
  }

  _resolvedTombstone(event) {
    const record = this._resolveEvent(event, {
      artifactType: TOMBSTONE_ARTIFACT_TYPE,
      decision: "committed",
      kind: "tombstone",
      sourceCount: 1,
    });
    const tombstone = normalizeTombstone(
      record.value,
      this.descriptor.tenantId,
    );
    if (record.logicalDigest !== tombstone.tombstoneDigest) {
      corrupt("raw deletion tombstone digest was substituted");
    }
    return Object.freeze({ event, tombstone });
  }

  _persist({
    artifactType,
    decision,
    eventType,
    kind,
    logicalDigest,
    reason,
    sourceRefs,
    timestamp: occurredAt,
    value,
  }) {
    const head = this._verifyLedger();
    const record = Object.freeze({
      schema: EVOLUTION_RAW_DELETION_LEDGER_RECORD_SCHEMA,
      tenantId: this.descriptor.tenantId,
      streamId: this.descriptor.streamId,
      kind,
      logicalDigest,
      value,
    });
    const published = this._put(artifactType, record, {
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
      corrupt("raw deletion artifact persistence was not confirmed");
    }
    const eventId = `${eventType}.${logicalDigest.slice("sha256:".length)}`;
    const ledgerReceipt = this._append(
      {
        artifactTenantId: this.descriptor.artifactTenantId,
        correlationId: this.descriptor.streamId,
        decision,
        eventId,
        reason,
        skillName: null,
        sourceRefs,
        subjectRef: published.ref,
        tenantId: this.descriptor.tenantId,
        timestamp: occurredAt,
        type: eventType,
      },
      { expectedHeadDigest: head.headDigest, expectedSequence: head.sequence },
    );
    if (
      ledgerReceipt?.authenticated !== true ||
      ledgerReceipt.committed !== true ||
      ledgerReceipt.durable !== true ||
      ledgerReceipt.eventId !== eventId ||
      !DIGEST.test(ledgerReceipt.eventDigest ?? "") ||
      !DIGEST.test(ledgerReceipt.receiptDigest ?? "")
    ) {
      corrupt("raw deletion ledger append was not durably confirmed");
    }
    return ledgerReceipt;
  }

  async retainDeletionReceipt({ receipt: input } = {}) {
    const receipt = normalizeDeletionReceipt(input, this.descriptor.tenantId);
    if (
      (await this._verifyDeletionReceipt({
        receipt,
        tenantId: this.descriptor.tenantId,
        streamId: this.descriptor.streamId,
        source: "retain",
      })) !== true
    ) {
      corrupt("raw deletion receipt signature verification failed");
    }
    const existing = this._event(
      EVOLUTION_RAW_DELETION_RECEIPT_EVENT_TYPE,
      receipt.receiptDigest,
    );
    if (existing) {
      const recovered = await this._verifiedReceipt(existing, "recover");
      if (canonical(recovered.receipt) !== canonical(receipt)) {
        corrupt("raw deletion receipt id resolved substituted bytes");
      }
      return Object.freeze({
        authenticated: true,
        durable: true,
        recovered: true,
        receiptDigest: receipt.receiptDigest,
        ledgerEventDigest: existing.eventDigest,
      });
    }
    const persisted = this._persist({
      artifactType: RECEIPT_ARTIFACT_TYPE,
      decision: "accepted",
      eventType: EVOLUTION_RAW_DELETION_RECEIPT_EVENT_TYPE,
      kind: "deletion-receipt",
      logicalDigest: receipt.receiptDigest,
      reason: "authenticated privacy deletion receipt retained",
      sourceRefs: [],
      timestamp: receipt.issuedAt,
      value: receipt,
    });
    return Object.freeze({
      authenticated: true,
      durable: true,
      recovered: false,
      receiptDigest: receipt.receiptDigest,
      ledgerEventDigest: persisted.eventDigest,
      ledgerReceiptDigest: persisted.receiptDigest,
    });
  }

  async resolveDeletionReceipt({ tenantId, receiptDigest } = {}) {
    if (tenantId !== this.descriptor.tenantId || !DIGEST.test(receiptDigest)) {
      throw new TypeError("raw deletion receipt resolution request is invalid");
    }
    const event = this._event(
      EVOLUTION_RAW_DELETION_RECEIPT_EVENT_TYPE,
      receiptDigest,
    );
    if (!event) corrupt("raw deletion receipt is missing");
    const resolved = await this._verifiedReceipt(event, "resolve");
    if (resolved.receipt.receiptDigest !== receiptDigest) {
      corrupt("raw deletion receipt digest was substituted");
    }
    const resolvedAtMs = Number(this._now());
    if (!Number.isFinite(resolvedAtMs)) {
      throw new TypeError("raw deletion ledger clock is invalid");
    }
    return freeze({
      ...resolved.receipt,
      schema: EVOLUTION_RAW_DELETION_RESOLUTION_SCHEMA,
      authenticated: true,
      durable: true,
      authorityId: this.descriptor.authorityId,
      revision: this.descriptor.revision,
      handlerArtifactDigest: this.descriptor.handlerArtifactDigest,
      resolvedAt: new Date(resolvedAtMs).toISOString(),
    });
  }

  async retainTombstone({ tombstone: input } = {}) {
    const tombstone = normalizeTombstone(input, this.descriptor.tenantId);
    const receiptEvent = this._event(
      EVOLUTION_RAW_DELETION_RECEIPT_EVENT_TYPE,
      tombstone.deletionReceiptDigest,
    );
    if (!receiptEvent) corrupt("raw deletion tombstone has no receipt event");
    const { receipt } = await this._verifiedReceipt(receiptEvent, "tombstone");
    if (
      receipt.evidenceRef !== tombstone.evidenceRef ||
      receipt.rawArtifactRef !== tombstone.rawArtifactRef ||
      receipt.rawCipherDigest !== tombstone.rawCipherDigest
    ) {
      corrupt("raw deletion tombstone is not bound to its deletion receipt");
    }
    const existing = this._event(
      EVOLUTION_RAW_DELETION_TOMBSTONE_EVENT_TYPE,
      tombstone.tombstoneDigest,
    );
    if (existing) {
      const recovered = this._resolvedTombstone(existing);
      if (
        canonical(recovered.tombstone) !== canonical(tombstone) ||
        canonical(existing.sourceRefs[0]) !== canonical(receiptEvent.subjectRef)
      ) {
        corrupt("raw deletion tombstone id resolved substituted lineage");
      }
      return Object.freeze({
        authenticated: true,
        durable: true,
        recovered: true,
        tombstoneDigest: tombstone.tombstoneDigest,
        receiptDigest: existing.eventDigest,
      });
    }
    const persisted = this._persist({
      artifactType: TOMBSTONE_ARTIFACT_TYPE,
      decision: "committed",
      eventType: EVOLUTION_RAW_DELETION_TOMBSTONE_EVENT_TYPE,
      kind: "tombstone",
      logicalDigest: tombstone.tombstoneDigest,
      reason: "confirmed raw evidence crypto-shred tombstone retained",
      sourceRefs: [receiptEvent.subjectRef],
      timestamp: receipt.issuedAt,
      value: tombstone,
    });
    return Object.freeze({
      authenticated: true,
      durable: true,
      recovered: false,
      tombstoneDigest: tombstone.tombstoneDigest,
      receiptDigest: persisted.eventDigest,
      ledgerReceiptDigest: persisted.receiptDigest,
    });
  }

  async resolveTombstone({ tenantId, tombstoneDigest } = {}) {
    if (
      tenantId !== this.descriptor.tenantId ||
      !DIGEST.test(tombstoneDigest)
    ) {
      throw new TypeError(
        "raw deletion tombstone resolution request is invalid",
      );
    }
    const event = this._event(
      EVOLUTION_RAW_DELETION_TOMBSTONE_EVENT_TYPE,
      tombstoneDigest,
    );
    if (!event) corrupt("raw deletion tombstone is missing");
    const resolved = this._resolvedTombstone(event);
    if (resolved.tombstone.tombstoneDigest !== tombstoneDigest) {
      corrupt("raw deletion tombstone digest was substituted");
    }
    const receiptEvent = this._event(
      EVOLUTION_RAW_DELETION_RECEIPT_EVENT_TYPE,
      resolved.tombstone.deletionReceiptDigest,
    );
    if (
      !receiptEvent ||
      canonical(event.sourceRefs[0]) !== canonical(receiptEvent.subjectRef)
    ) {
      corrupt("raw deletion tombstone receipt lineage is invalid");
    }
    await this._verifiedReceipt(receiptEvent, "resolve-tombstone");
    return freeze({
      schema: EVOLUTION_RAW_TOMBSTONE_RESOLUTION_SCHEMA,
      authenticated: true,
      durable: true,
      authorityId: this.descriptor.authorityId,
      revision: this.descriptor.revision,
      handlerArtifactDigest: this.descriptor.handlerArtifactDigest,
      tenantId,
      streamId: this.descriptor.streamId,
      tombstoneDigest,
      tombstone: resolved.tombstone,
      ledgerEventDigest: event.eventDigest,
    });
  }

  cryptoShredPorts({ destroyKey, confirmKeyDestroyed } = {}) {
    if (
      typeof destroyKey !== "function" ||
      typeof confirmKeyDestroyed !== "function"
    ) {
      throw new TypeError("KMS destroy and confirmation ports are required");
    }
    return Object.freeze({
      verifyDeletionReceipt: (request) => this.resolveDeletionReceipt(request),
      destroyKey: (...args) => Reflect.apply(destroyKey, undefined, args),
      confirmKeyDestroyed: (...args) =>
        Reflect.apply(confirmKeyDestroyed, undefined, args),
      retainTombstone: (request) => this.retainTombstone(request),
    });
  }
}

export function createEvolutionRawDeletionLedgerAdapter(options) {
  return new EvolutionRawDeletionLedgerAdapter(options);
}

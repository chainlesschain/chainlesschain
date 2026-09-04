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
import {
  GOVERNED_KNOWLEDGE_ENVELOPE_SCHEMA,
  verifyGovernedKnowledgeArtifactBinding,
  verifyGovernedKnowledgeEnvelopeIntegrity,
  verifyGovernedKnowledgeRecord,
} from "./governed-knowledge-sync.js";

export const GOVERNED_KNOWLEDGE_SYNC_LEDGER_RECORD_SCHEMA =
  "chainlesschain.governed-evolution-knowledge-ledger-record/v3";
export const GOVERNED_KNOWLEDGE_SYNC_LEDGER_RECORD_V2_SCHEMA =
  "chainlesschain.governed-evolution-knowledge-ledger-record/v2";
export const GOVERNED_KNOWLEDGE_SYNC_LEDGER_RECORD_LEGACY_SCHEMA =
  "chainlesschain.governed-evolution-knowledge-ledger-record/v1";
export const GOVERNED_KNOWLEDGE_SYNC_COMMIT_EVENT_TYPE =
  "knowledge.sync.committed";
export const GOVERNED_KNOWLEDGE_SYNC_LEDGER_CORRUPT_CODE =
  "CC_GOVERNED_KNOWLEDGE_SYNC_LEDGER_CORRUPT";

const ARTIFACT_TYPE = "governed-knowledge-sync-record";
const CONFLICT_READERS = new WeakSet();
const PUBLICATION_READERS = new WeakSet();
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const DISPOSITIONS = new Set(["conflict", "local", "remote"]);
const MAX_CONFLICT_PAGE = 256;
const RECORD_KEYS = new Set([
  "artifactBinding",
  "committedAt",
  "authorizationReceiptDigest",
  "conflictWithDigest",
  "deviceId",
  "disposition",
  "envelope",
  "envelopeDigest",
  "knowledge",
  "operationId",
  "recordDigest",
  "schema",
  "tenantId",
]);
const V2_RECORD_KEYS = new Set(
  [...RECORD_KEYS].filter((key) => key !== "artifactBinding"),
);
const LEGACY_RECORD_KEYS = new Set(
  [...V2_RECORD_KEYS].filter((key) => key !== "operationId"),
);

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

function corrupt(message) {
  const error = new Error(message);
  error.code = GOVERNED_KNOWLEDGE_SYNC_LEDGER_CORRUPT_CODE;
  throw error;
}

function exact(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value) ||
    Reflect.ownKeys(value).length !== keys.size ||
    Reflect.ownKeys(value).some(
      (key) => typeof key !== "string" || !keys.has(key),
    )
  ) {
    corrupt(`${label} is invalid`);
  }
  return value;
}

function identifier(value, label) {
  if (typeof value !== "string" || !SAFE_ID.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function capture(owner, method, label = method) {
  if (
    !owner ||
    typeof owner !== "object" ||
    utilTypes.isProxy(owner) ||
    typeof owner[method] !== "function"
  ) {
    throw new TypeError(`${label}.${method}() is required`);
  }
  return (...args) => Reflect.apply(owner[method], owner, args);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function recordCore(value) {
  const core = {
    schema: value.schema,
    tenantId: value.tenantId,
    deviceId: value.deviceId,
    disposition: value.disposition,
    knowledge: value.knowledge,
    envelope: value.envelope,
    envelopeDigest: value.envelopeDigest,
    conflictWithDigest: value.conflictWithDigest,
    authorizationReceiptDigest: value.authorizationReceiptDigest,
    committedAt: value.committedAt,
  };
  if (
    [
      GOVERNED_KNOWLEDGE_SYNC_LEDGER_RECORD_SCHEMA,
      GOVERNED_KNOWLEDGE_SYNC_LEDGER_RECORD_V2_SCHEMA,
    ].includes(value.schema)
  ) {
    core.operationId = value.operationId;
  }
  if (value.schema === GOVERNED_KNOWLEDGE_SYNC_LEDGER_RECORD_SCHEMA) {
    core.artifactBinding = value.artifactBinding;
  }
  return core;
}

export function digestGovernedKnowledgeSyncLedgerRecord(value) {
  return hash(value.schema, recordCore(value));
}

function normalizeDescriptor(input) {
  return Object.freeze({
    tenantId: identifier(input?.tenantId, "tenantId"),
    artifactTenantId: identifier(input?.artifactTenantId, "artifactTenantId"),
    deviceId: identifier(input?.deviceId, "deviceId"),
    streamId: identifier(input?.streamId, "streamId"),
    audience: identifier(input?.audience, "audience"),
    purpose: identifier(input?.purpose, "purpose"),
  });
}

function validateKnowledge(value, descriptor, disposition) {
  let normalized;
  try {
    normalized = verifyGovernedKnowledgeRecord(value, {
      tenantId: descriptor.tenantId,
    });
  } catch {
    corrupt("knowledge sync record is invalid");
  }
  const comparable = { ...value };
  delete comparable.conflictWithDigest;
  if (canonical(comparable) !== canonical(normalized)) {
    corrupt("knowledge sync record is not canonical");
  }
  const conflictWithDigest = value.conflictWithDigest ?? null;
  if (
    (disposition === "conflict" && !DIGEST.test(conflictWithDigest ?? "")) ||
    (disposition !== "conflict" && conflictWithDigest !== null)
  ) {
    corrupt("knowledge sync conflict binding is invalid");
  }
  return conflictWithDigest;
}

function validateEnvelope(value, knowledge, descriptor, disposition) {
  try {
    verifyGovernedKnowledgeEnvelopeIntegrity(value, {
      tenantId: descriptor.tenantId,
    });
  } catch {
    corrupt("knowledge sync envelope integrity is invalid");
  }
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value) ||
    value.schema !== GOVERNED_KNOWLEDGE_ENVELOPE_SCHEMA ||
    value.tenantId !== descriptor.tenantId ||
    !SAFE_ID.test(value.senderDeviceId ?? "") ||
    value.knowledgeId !== knowledge.knowledgeId ||
    value.scope !== knowledge.scope ||
    value.scopeId !== knowledge.scopeId ||
    value.action !== knowledge.action ||
    value.contentDigest !== knowledge.contentDigest ||
    canonical(value.vectorClock) !== canonical(knowledge.vectorClock) ||
    (disposition === "local") !== (value.senderDeviceId === descriptor.deviceId)
  ) {
    corrupt("knowledge sync envelope binding is invalid");
  }
}

function validateLedgerRecord(value, descriptor) {
  const current =
    value?.schema === GOVERNED_KNOWLEDGE_SYNC_LEDGER_RECORD_SCHEMA;
  const version2 =
    value?.schema === GOVERNED_KNOWLEDGE_SYNC_LEDGER_RECORD_V2_SCHEMA;
  exact(
    value,
    current ? RECORD_KEYS : version2 ? V2_RECORD_KEYS : LEGACY_RECORD_KEYS,
    "knowledge sync ledger record",
  );
  if (
    ![
      GOVERNED_KNOWLEDGE_SYNC_LEDGER_RECORD_SCHEMA,
      GOVERNED_KNOWLEDGE_SYNC_LEDGER_RECORD_V2_SCHEMA,
      GOVERNED_KNOWLEDGE_SYNC_LEDGER_RECORD_LEGACY_SCHEMA,
    ].includes(value.schema) ||
    value.tenantId !== descriptor.tenantId ||
    value.deviceId !== descriptor.deviceId ||
    !DISPOSITIONS.has(value.disposition) ||
    !DIGEST.test(value.authorizationReceiptDigest ?? "") ||
    !DIGEST.test(value.envelopeDigest ?? "") ||
    value.envelopeDigest !== value.envelope?.envelopeDigest ||
    typeof value.committedAt !== "string" ||
    !Number.isFinite(Date.parse(value.committedAt)) ||
    value.recordDigest !== digestGovernedKnowledgeSyncLedgerRecord(value)
  ) {
    corrupt("knowledge sync ledger record binding is invalid");
  }
  if (
    ((current || version2) &&
      value.operationId !== null &&
      !SAFE_ID.test(value.operationId ?? "")) ||
    (!current && !version2 && Object.hasOwn(value, "operationId"))
  ) {
    corrupt("knowledge sync operation binding is invalid");
  }
  const conflictWithDigest = validateKnowledge(
    value.knowledge,
    descriptor,
    value.disposition,
  );
  if (value.conflictWithDigest !== conflictWithDigest) {
    corrupt("knowledge sync conflict digest was substituted");
  }
  if (current) {
    if (value.disposition === "local") {
      try {
        verifyGovernedKnowledgeArtifactBinding(value.artifactBinding, {
          tenantId: descriptor.tenantId,
          knowledge: value.knowledge,
          authorizationReceiptDigest: value.authorizationReceiptDigest,
        });
      } catch {
        corrupt("knowledge sync artifact binding is invalid");
      }
    } else if (value.artifactBinding !== null) {
      corrupt("remote knowledge sync cannot claim an artifact binding");
    }
  }
  validateEnvelope(
    value.envelope,
    value.knowledge,
    descriptor,
    value.disposition,
  );
  return freeze(clone(value));
}

function parseArtifact(resolution, descriptor) {
  if (
    resolution?.schema !== EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA ||
    resolution.authenticated !== true ||
    resolution.found !== true ||
    !DIGEST.test(resolution.digest ?? "") ||
    !DIGEST.test(resolution.receiptDigest ?? "") ||
    !Buffer.isBuffer(resolution.bytes)
  ) {
    corrupt("knowledge sync artifact resolution is incomplete");
  }
  let artifact;
  try {
    artifact = JSON.parse(resolution.bytes.toString("utf8"));
  } catch {
    corrupt("knowledge sync artifact is not JSON");
  }
  if (
    artifact?.schema !== EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA ||
    artifact.tenantId !== descriptor.artifactTenantId ||
    artifact.audience !== descriptor.audience ||
    artifact.purpose !== descriptor.purpose ||
    artifact.retention !== "ledger" ||
    artifact.type !== ARTIFACT_TYPE
  ) {
    corrupt("knowledge sync durable artifact binding is invalid");
  }
  return validateLedgerRecord(artifact.value, descriptor);
}

export class GovernedKnowledgeSyncLedgerAdapter {
  constructor({
    descriptor: input,
    artifactPorts,
    ledger,
    ledgerArtifactResolver,
    envelopeVerifier,
    now = Date.now,
  } = {}) {
    this.descriptor = normalizeDescriptor(input);
    this._put = capture(artifactPorts, "putCanonical", "artifactPorts");
    this._read = capture(ledger, "read", "ledger");
    this._verifyLedger = capture(ledger, "verify", "ledger");
    this._append = capture(ledger, "appendDomainEvent", "ledger");
    this._verifyEnvelope = capture(
      envelopeVerifier,
      "verify",
      "envelopeVerifier",
    );
    if (!isEvolutionLedgerArtifactResolver(ledgerArtifactResolver)) {
      throw new TypeError(
        "a branded EvolutionArtifactPorts ledger resolver is required",
      );
    }
    if (typeof now !== "function" || utilTypes.isProxy(now)) {
      throw new TypeError("now must be a non-proxy function");
    }
    this._resolveArtifact = ledgerArtifactResolver;
    this._now = now;
    Object.freeze(this);
  }

  _events() {
    const events = this._read();
    if (!Array.isArray(events)) corrupt("EvolutionLedger returned no events");
    return events.filter(
      (event) =>
        event.schema === EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA &&
        event.type === GOVERNED_KNOWLEDGE_SYNC_COMMIT_EVENT_TYPE &&
        event.tenantId === this.descriptor.tenantId &&
        event.correlationId === this.descriptor.streamId,
    );
  }

  async _resolveEvent(event) {
    const identity = this._verifyLedger();
    const resolution = this._resolveArtifact({
      epoch: identity.epoch,
      ledgerId: identity.ledgerId,
      ref: event.subjectRef,
      tenantId: this.descriptor.artifactTenantId,
    });
    if (
      resolution?.ref !== event.subjectRef.ref ||
      resolution?.digest !== event.subjectRef.digest
    ) {
      corrupt("knowledge sync ledger resolved a substituted artifact");
    }
    const record = parseArtifact(resolution, this.descriptor);
    const core = { ...record.envelope };
    delete core.envelopeDigest;
    delete core.signature;
    if (
      (await this._verifyEnvelope({
        core,
        envelopeDigest: record.envelopeDigest,
        signature: record.envelope.signature,
      })) !== true
    ) {
      corrupt("knowledge sync stored envelope signature is invalid");
    }
    if (
      event.eventId !==
        `${GOVERNED_KNOWLEDGE_SYNC_COMMIT_EVENT_TYPE}.${record.disposition}.${record.envelopeDigest.slice(7)}` ||
      event.decision !== "committed"
    ) {
      corrupt("knowledge sync event binding is invalid");
    }
    return record;
  }

  async _entryByEventId(eventId) {
    const matches = this._events().filter((event) => event.eventId === eventId);
    if (matches.length > 1) corrupt("knowledge sync event is ambiguous");
    return matches.length === 0
      ? null
      : { event: matches[0], record: await this._resolveEvent(matches[0]) };
  }

  load = async ({ knowledgeId } = {}) => {
    const normalizedId = identifier(knowledgeId, "knowledgeId");
    const entries = (
      await Promise.all(
        this._events().map(async (event) => ({
          event,
          record: await this._resolveEvent(event),
        })),
      )
    ).filter(
      ({ record }) =>
        record.disposition !== "conflict" &&
        record.knowledge.knowledgeId === normalizedId,
    );
    return entries.length === 0 ? null : entries.at(-1).record.knowledge;
  };

  commit = async ({
    knowledge,
    envelope,
    envelopeDigest,
    disposition,
    authorizationReceiptDigest,
    operationId = null,
    artifactBinding = null,
  } = {}) => {
    if (!DISPOSITIONS.has(disposition)) {
      throw new TypeError("knowledge sync disposition is invalid");
    }
    const conflictWithDigest = validateKnowledge(
      knowledge,
      this.descriptor,
      disposition,
    );
    validateEnvelope(envelope, knowledge, this.descriptor, disposition);
    if (envelopeDigest !== envelope.envelopeDigest) {
      corrupt("knowledge sync envelope digest was substituted");
    }
    if (!DIGEST.test(authorizationReceiptDigest ?? "")) {
      corrupt("knowledge sync authorization receipt is invalid");
    }
    if (operationId !== null && !SAFE_ID.test(operationId ?? "")) {
      throw new TypeError("knowledge sync operationId is invalid");
    }
    if (operationId !== null) {
      const prior = await this.getPublication({ operationId });
      if (prior && prior.envelopeDigest !== envelopeDigest) {
        corrupt("knowledge sync operationId resolved another envelope");
      }
    }
    const envelopeCore = { ...envelope };
    delete envelopeCore.envelopeDigest;
    delete envelopeCore.signature;
    if (
      (await this._verifyEnvelope({
        core: envelopeCore,
        envelopeDigest,
        signature: envelope.signature,
      })) !== true
    ) {
      corrupt("knowledge sync envelope signature is invalid");
    }
    const eventId = `${GOVERNED_KNOWLEDGE_SYNC_COMMIT_EVENT_TYPE}.${disposition}.${envelopeDigest.slice(7)}`;
    const existing = await this._entryByEventId(eventId);
    if (existing) {
      const stableExisting = recordCore(existing.record);
      delete stableExisting.committedAt;
      const stableRequest = {
        schema: GOVERNED_KNOWLEDGE_SYNC_LEDGER_RECORD_SCHEMA,
        tenantId: this.descriptor.tenantId,
        deviceId: this.descriptor.deviceId,
        disposition,
        knowledge,
        envelope,
        envelopeDigest,
        conflictWithDigest,
        authorizationReceiptDigest,
        operationId,
        artifactBinding,
      };
      if (canonical(stableExisting) !== canonical(stableRequest)) {
        corrupt("knowledge sync event identity resolved different content");
      }
      return Object.freeze({
        authenticated: true,
        durable: true,
        recovered: true,
        envelopeDigest,
        knowledgeId: knowledge.knowledgeId,
      });
    }
    const milliseconds = Number(this._now());
    if (!Number.isFinite(milliseconds)) {
      throw new TypeError("knowledge sync clock is invalid");
    }
    const committedAt = new Date(milliseconds).toISOString();
    const core = {
      schema: GOVERNED_KNOWLEDGE_SYNC_LEDGER_RECORD_SCHEMA,
      tenantId: this.descriptor.tenantId,
      deviceId: this.descriptor.deviceId,
      disposition,
      knowledge: clone(knowledge),
      envelope: clone(envelope),
      envelopeDigest,
      conflictWithDigest,
      authorizationReceiptDigest,
      operationId,
      artifactBinding: clone(artifactBinding),
      committedAt,
    };
    const record = Object.freeze({
      ...core,
      recordDigest: digestGovernedKnowledgeSyncLedgerRecord(core),
    });
    validateLedgerRecord(record, this.descriptor);
    const head = this._verifyLedger();
    const published = this._put(ARTIFACT_TYPE, record, {
      audience: this.descriptor.audience,
      purpose: this.descriptor.purpose,
      retention: "ledger",
    });
    if (
      !published?.ref ||
      published.receipt?.persisted !== true ||
      published.receipt?.readbackVerified !== true ||
      published.receipt?.integrityVerified !== true ||
      published.receipt?.retention !== "ledger"
    ) {
      corrupt("knowledge sync artifact was not durably read back");
    }
    let receipt;
    try {
      receipt = this._append(
        {
          artifactTenantId: this.descriptor.artifactTenantId,
          correlationId: this.descriptor.streamId,
          decision: "committed",
          eventId,
          reason: `governed knowledge ${disposition} commit`,
          skillName: null,
          sourceRefs: [],
          subjectRef: published.ref,
          tenantId: this.descriptor.tenantId,
          timestamp: committedAt,
          type: GOVERNED_KNOWLEDGE_SYNC_COMMIT_EVENT_TYPE,
        },
        {
          expectedHeadDigest: head.headDigest,
          expectedSequence: head.sequence,
        },
      );
    } catch (error) {
      const recovered = await this._entryByEventId(eventId);
      if (!recovered || canonical(recovered.record) !== canonical(record)) {
        throw error;
      }
      receipt = { authenticated: true, durable: true, recovered: true };
    }
    if (receipt?.authenticated !== true || receipt.durable !== true) {
      corrupt("knowledge sync ledger append was not durably confirmed");
    }
    const stored = await this._entryByEventId(eventId);
    if (!stored || canonical(stored.record) !== canonical(record)) {
      corrupt("knowledge sync ledger readback differs after commit");
    }
    return Object.freeze({
      authenticated: true,
      durable: true,
      recovered: receipt.recovered === true,
      envelopeDigest,
      knowledgeId: knowledge.knowledgeId,
      ...(DIGEST.test(receipt.receiptDigest ?? "")
        ? { ledgerReceiptDigest: receipt.receiptDigest }
        : {}),
    });
  };

  getPublication = async ({ operationId } = {}) => {
    const normalizedId = identifier(operationId, "publication operationId");
    const matches = (
      await Promise.all(
        this._events().map((event) => this._resolveEvent(event)),
      )
    ).filter(
      (record) =>
        record.schema === GOVERNED_KNOWLEDGE_SYNC_LEDGER_RECORD_SCHEMA &&
        record.disposition === "local" &&
        record.operationId === normalizedId,
    );
    if (matches.length > 1) {
      corrupt("knowledge publication operation is ambiguous");
    }
    return matches[0] ?? null;
  };

  listConflicts = async ({ cursor = 0, limit = 50 } = {}) => {
    if (
      !Number.isSafeInteger(cursor) ||
      cursor < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > MAX_CONFLICT_PAGE
    ) {
      throw new TypeError("knowledge sync conflict page is invalid");
    }
    const conflicts = (
      await Promise.all(
        this._events().map((event) => this._resolveEvent(event)),
      )
    ).filter((record) => record.disposition === "conflict");
    return Object.freeze({
      items: Object.freeze(conflicts.slice(cursor, cursor + limit)),
      nextCursor: cursor + limit < conflicts.length ? cursor + limit : null,
      total: conflicts.length,
    });
  };

  getConflict = async ({ envelopeDigest } = {}) => {
    if (!DIGEST.test(envelopeDigest ?? "")) {
      throw new TypeError("knowledge sync conflict envelope digest is invalid");
    }
    const eventId = `${GOVERNED_KNOWLEDGE_SYNC_COMMIT_EVENT_TYPE}.conflict.${envelopeDigest.slice(7)}`;
    const entry = await this._entryByEventId(eventId);
    return entry?.record ?? null;
  };

  conflictReader() {
    const reader = Object.freeze({
      tenantId: this.descriptor.tenantId,
      deviceId: this.descriptor.deviceId,
      load: this.load,
      getConflict: this.getConflict,
      listConflicts: this.listConflicts,
    });
    CONFLICT_READERS.add(reader);
    return reader;
  }

  publicationReader() {
    const reader = Object.freeze({
      tenantId: this.descriptor.tenantId,
      deviceId: this.descriptor.deviceId,
      getPublication: this.getPublication,
    });
    PUBLICATION_READERS.add(reader);
    return reader;
  }

  syncPorts({ authorize, encrypt, decrypt, sign, send } = {}) {
    return Object.freeze({
      authorize: capture(authorize, "authorize", "authorize"),
      encrypt: capture(encrypt, "encrypt", "encrypt"),
      decrypt: capture(decrypt, "decrypt", "decrypt"),
      sign: capture(sign, "sign", "sign"),
      verify: this._verifyEnvelope,
      send: capture(send, "send", "send"),
      load: this.load,
      loadPublication: this.getPublication,
      commit: this.commit,
    });
  }
}

export function isGovernedKnowledgeConflictReader(value) {
  return CONFLICT_READERS.has(value);
}

export function isGovernedKnowledgePublicationReader(value) {
  return PUBLICATION_READERS.has(value);
}

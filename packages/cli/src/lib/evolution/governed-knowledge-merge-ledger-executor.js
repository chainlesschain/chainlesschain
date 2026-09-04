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
  isGovernedKnowledgeMergePlan,
  verifyGovernedKnowledgeMergePlan,
} from "./governed-knowledge-conflict-merge.js";
import {
  GOVERNED_KNOWLEDGE_MERGE_PUBLISH_REQUEST_SCHEMA,
  GOVERNED_KNOWLEDGE_MERGE_PUBLISH_RESULT_LEGACY_SCHEMA,
  GOVERNED_KNOWLEDGE_MERGE_PUBLISH_RESULT_SCHEMA,
  digestGovernedKnowledgeMergePublishResult,
  isGovernedKnowledgeMergePublisherAuthority,
} from "./governed-knowledge-merge-publisher-authority.js";
import { GOVERNED_KNOWLEDGE_SYNC_COMMIT_EVENT_TYPE } from "./governed-knowledge-sync-ledger-adapter.js";

export const GOVERNED_KNOWLEDGE_MERGE_PREPARED_SCHEMA =
  "chainlesschain.governed-knowledge-merge-prepared/v1";
export const GOVERNED_KNOWLEDGE_MERGE_SETTLED_SCHEMA =
  "chainlesschain.governed-knowledge-merge-settled/v1";
export const GOVERNED_KNOWLEDGE_MERGE_PREPARED_EVENT_TYPE =
  "knowledge.merge.prepared";
export const GOVERNED_KNOWLEDGE_MERGE_SETTLED_EVENT_TYPE =
  "knowledge.merge.settled";
export const GOVERNED_KNOWLEDGE_MERGE_LEDGER_CORRUPT_CODE =
  "CC_GOVERNED_KNOWLEDGE_MERGE_LEDGER_CORRUPT";

const ARTIFACT_TYPE = "governed-knowledge-merge-operation";
const EXECUTORS = new WeakSet();
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const PREPARED_KEYS = new Set([
  "deviceId",
  "plan",
  "preparedAt",
  "recordDigest",
  "schema",
  "tenantId",
]);
const SETTLED_KEYS = new Set([
  "deviceId",
  "planDigest",
  "publishResult",
  "recordDigest",
  "schema",
  "settledAt",
  "tenantId",
]);
const PUBLISH_EVIDENCE_KEYS = new Set([
  "attestation",
  "artifactCandidateDigest",
  "artifactDigest",
  "artifactReleaseId",
  "artifactTransitionOperationId",
  "artifactTransitionReceiptDigest",
  "deviceId",
  "durable",
  "envelopeDigest",
  "idempotent",
  "knowledgeId",
  "mergedContentDigest",
  "operationId",
  "planDigest",
  "providerAuthorityId",
  "providerHandlerArtifactDigest",
  "providerRevision",
  "publishedAt",
  "requestDigest",
  "resultDigest",
  "schema",
  "tenantId",
  "verificationReceiptDigest",
]);
const LEGACY_PUBLISH_EVIDENCE_KEYS = new Set(
  [...PUBLISH_EVIDENCE_KEYS].filter((key) => !key.startsWith("artifact")),
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

function clone(value) {
  return structuredClone(value);
}

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function corrupt(message) {
  const error = new Error(message);
  error.code = GOVERNED_KNOWLEDGE_MERGE_LEDGER_CORRUPT_CODE;
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
    corrupt(`${label} is not a plain object`);
  }
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.size ||
    actual.some((key) => typeof key !== "string" || !keys.has(key))
  ) {
    corrupt(`${label} has an invalid shape`);
  }
  return value;
}

function identifier(value, label) {
  if (typeof value !== "string" || !ID.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function capture(owner, method, label) {
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

function descriptor(input) {
  return freeze({
    tenantId: identifier(input?.tenantId, "tenantId"),
    artifactTenantId: identifier(input?.artifactTenantId, "artifactTenantId"),
    deviceId: identifier(input?.deviceId, "deviceId"),
    streamId: identifier(input?.streamId, "streamId"),
    audience: identifier(input?.audience, "audience"),
    purpose: identifier(input?.purpose, "purpose"),
  });
}

function preparedCore(value) {
  return {
    schema: value.schema,
    tenantId: value.tenantId,
    deviceId: value.deviceId,
    plan: value.plan,
    preparedAt: value.preparedAt,
  };
}

function settledCore(value) {
  return {
    schema: value.schema,
    tenantId: value.tenantId,
    deviceId: value.deviceId,
    planDigest: value.planDigest,
    publishResult: value.publishResult,
    settledAt: value.settledAt,
  };
}

function validatePublishEvidence(value, plan, descriptorValue) {
  const legacy =
    value?.schema === GOVERNED_KNOWLEDGE_MERGE_PUBLISH_RESULT_LEGACY_SCHEMA;
  exact(
    value,
    legacy ? LEGACY_PUBLISH_EVIDENCE_KEYS : PUBLISH_EVIDENCE_KEYS,
    "merge publish evidence",
  );
  const requestCore = {
    schema: GOVERNED_KNOWLEDGE_MERGE_PUBLISH_REQUEST_SCHEMA,
    tenantId: plan.tenantId,
    deviceId: plan.deviceId,
    operationId: `knowledge-merge:${plan.planDigest.slice(7)}`,
    planDigest: plan.planDigest,
    knowledgeId: plan.knowledgeId,
    mergedContentDigest: plan.mergedKnowledge.contentDigest,
    mergedKnowledge: plan.mergedKnowledge,
  };
  if (
    ![
      GOVERNED_KNOWLEDGE_MERGE_PUBLISH_RESULT_SCHEMA,
      GOVERNED_KNOWLEDGE_MERGE_PUBLISH_RESULT_LEGACY_SCHEMA,
    ].includes(value.schema) ||
    value.tenantId !== descriptorValue.tenantId ||
    value.deviceId !== descriptorValue.deviceId ||
    value.operationId !== `knowledge-merge:${plan.planDigest.slice(7)}` ||
    value.planDigest !== plan.planDigest ||
    value.knowledgeId !== plan.knowledgeId ||
    value.mergedContentDigest !== plan.mergedKnowledge.contentDigest ||
    value.durable !== true ||
    value.idempotent !== true ||
    value.requestDigest !==
      hash(GOVERNED_KNOWLEDGE_MERGE_PUBLISH_REQUEST_SCHEMA, requestCore) ||
    !DIGEST.test(value.envelopeDigest ?? "") ||
    !DIGEST.test(value.resultDigest ?? "") ||
    !DIGEST.test(value.verificationReceiptDigest ?? "") ||
    (!legacy &&
      (!DIGEST.test(value.artifactCandidateDigest ?? "") ||
        !DIGEST.test(value.artifactDigest ?? "") ||
        !ID.test(value.artifactReleaseId ?? "") ||
        !ID.test(value.artifactTransitionOperationId ?? "") ||
        !value.artifactTransitionOperationId.startsWith(
          "artifact-transition:",
        ) ||
        !DIGEST.test(value.artifactTransitionReceiptDigest ?? ""))) ||
    value.resultDigest !== digestGovernedKnowledgeMergePublishResult(value)
  ) {
    corrupt("merge publish evidence is not exactly bound");
  }
  return freeze(clone(value));
}

function validatePrepared(value, descriptorValue) {
  exact(value, PREPARED_KEYS, "prepared merge record");
  const plan = verifyGovernedKnowledgeMergePlan(value.plan);
  if (
    value.schema !== GOVERNED_KNOWLEDGE_MERGE_PREPARED_SCHEMA ||
    value.tenantId !== descriptorValue.tenantId ||
    value.deviceId !== descriptorValue.deviceId ||
    plan.tenantId !== descriptorValue.tenantId ||
    plan.deviceId !== descriptorValue.deviceId ||
    !Number.isFinite(Date.parse(value.preparedAt)) ||
    value.recordDigest !==
      hash(GOVERNED_KNOWLEDGE_MERGE_PREPARED_SCHEMA, preparedCore(value))
  ) {
    corrupt("prepared merge record is invalid");
  }
  return freeze(clone(value));
}

function validateSettled(value, plan, descriptorValue) {
  exact(value, SETTLED_KEYS, "settled merge record");
  if (
    value.schema !== GOVERNED_KNOWLEDGE_MERGE_SETTLED_SCHEMA ||
    value.tenantId !== descriptorValue.tenantId ||
    value.deviceId !== descriptorValue.deviceId ||
    value.planDigest !== plan.planDigest ||
    !Number.isFinite(Date.parse(value.settledAt)) ||
    value.recordDigest !==
      hash(GOVERNED_KNOWLEDGE_MERGE_SETTLED_SCHEMA, settledCore(value))
  ) {
    corrupt("settled merge record is invalid");
  }
  validatePublishEvidence(value.publishResult, plan, descriptorValue);
  return freeze(clone(value));
}

export class GovernedKnowledgeMergeLedgerExecutor {
  constructor({
    descriptor: descriptorInput,
    artifactPorts,
    ledger,
    ledgerArtifactResolver,
    publisherAuthority,
    now = Date.now,
  } = {}) {
    this.descriptor = descriptor(descriptorInput);
    this._put = capture(artifactPorts, "putCanonical", "artifactPorts");
    this._read = capture(ledger, "read", "ledger");
    this._verifyLedger = capture(ledger, "verify", "ledger");
    this._append = capture(ledger, "appendDomainEvent", "ledger");
    if (!isEvolutionLedgerArtifactResolver(ledgerArtifactResolver)) {
      throw new TypeError(
        "a branded EvolutionArtifactPorts ledger resolver is required",
      );
    }
    if (!isGovernedKnowledgeMergePublisherAuthority(publisherAuthority)) {
      throw new TypeError("a branded knowledge merge publisher is required");
    }
    if (
      publisherAuthority.tenantId !== this.descriptor.tenantId ||
      publisherAuthority.deviceId !== this.descriptor.deviceId
    ) {
      throw new TypeError("merge publisher authority boundary is invalid");
    }
    if (typeof now !== "function" || utilTypes.isProxy(now)) {
      throw new TypeError("now must be a non-proxy function");
    }
    this._resolveArtifact = ledgerArtifactResolver;
    this._publish = capture(
      publisherAuthority,
      "publish",
      "publisherAuthority",
    );
    this._now = now;
    Object.freeze(this);
    EXECUTORS.add(this);
  }

  _events(type) {
    const events = this._read();
    if (!Array.isArray(events)) corrupt("EvolutionLedger returned no events");
    return events.filter(
      (event) =>
        event.schema === EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA &&
        event.type === type &&
        event.tenantId === this.descriptor.tenantId &&
        event.correlationId === this.descriptor.streamId,
    );
  }

  _event(eventId, type) {
    const matches = this._events(type).filter(
      (event) => event.eventId === eventId,
    );
    if (matches.length > 1) corrupt("merge ledger event is ambiguous");
    return matches[0] ?? null;
  }

  _resolve(event) {
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
      corrupt("merge artifact resolution is unauthenticated or substituted");
    }
    let artifact;
    try {
      artifact = JSON.parse(resolution.bytes.toString("utf8"));
    } catch {
      corrupt("merge artifact is not JSON");
    }
    if (
      artifact?.schema !== EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA ||
      artifact.tenantId !== this.descriptor.artifactTenantId ||
      artifact.audience !== this.descriptor.audience ||
      artifact.purpose !== this.descriptor.purpose ||
      artifact.retention !== "ledger" ||
      artifact.type !== ARTIFACT_TYPE
    ) {
      corrupt("merge durable artifact binding is invalid");
    }
    return artifact.value;
  }

  _prepared(planDigest) {
    const event = this._event(
      `${GOVERNED_KNOWLEDGE_MERGE_PREPARED_EVENT_TYPE}.${planDigest.slice(7)}`,
      GOVERNED_KNOWLEDGE_MERGE_PREPARED_EVENT_TYPE,
    );
    if (!event) return null;
    const record = validatePrepared(this._resolve(event), this.descriptor);
    if (
      record.plan.planDigest !== planDigest ||
      event.decision !== "prepared" ||
      !Array.isArray(event.sourceRefs) ||
      event.sourceRefs.length !== 1 ||
      canonical(event.sourceRefs[0]) !==
        canonical(this._conflictEvent(record.plan).subjectRef)
    ) {
      corrupt("prepared merge event is invalid");
    }
    return { event, record };
  }

  _settled(plan) {
    const event = this._event(
      `${GOVERNED_KNOWLEDGE_MERGE_SETTLED_EVENT_TYPE}.${plan.planDigest.slice(7)}`,
      GOVERNED_KNOWLEDGE_MERGE_SETTLED_EVENT_TYPE,
    );
    if (!event) return null;
    const record = validateSettled(this._resolve(event), plan, this.descriptor);
    const prepared = this._prepared(plan.planDigest);
    if (
      !prepared ||
      event.decision !== "committed" ||
      !Array.isArray(event.sourceRefs) ||
      event.sourceRefs.length !== 1 ||
      canonical(event.sourceRefs[0]) !== canonical(prepared.event.subjectRef)
    ) {
      corrupt("settled merge event lineage is invalid");
    }
    return { event, record };
  }

  _preparedForConflict(envelopeDigest) {
    const matches = [];
    for (const event of this._events(
      GOVERNED_KNOWLEDGE_MERGE_PREPARED_EVENT_TYPE,
    )) {
      const suffix = event.eventId?.slice(
        `${GOVERNED_KNOWLEDGE_MERGE_PREPARED_EVENT_TYPE}.`.length,
      );
      const planDigest = `sha256:${suffix}`;
      if (!DIGEST.test(planDigest))
        corrupt("prepared merge event id is invalid");
      const prepared = this._prepared(planDigest);
      if (prepared.record.plan.conflictEnvelopeDigest === envelopeDigest) {
        matches.push(prepared);
      }
    }
    if (matches.length > 1) {
      corrupt("a conflict has multiple prepared merge operations");
    }
    return matches[0] ?? null;
  }

  _conflictEvent(plan) {
    const eventId = `${GOVERNED_KNOWLEDGE_SYNC_COMMIT_EVENT_TYPE}.conflict.${plan.conflictEnvelopeDigest.slice(7)}`;
    const matches = this._events(
      GOVERNED_KNOWLEDGE_SYNC_COMMIT_EVENT_TYPE,
    ).filter((event) => event.eventId === eventId);
    if (matches.length !== 1) {
      corrupt("merge plan conflict event is missing or ambiguous");
    }
    return matches[0];
  }

  _timestamp() {
    const milliseconds = Number(this._now());
    if (!Number.isFinite(milliseconds)) {
      throw new TypeError("merge ledger clock is invalid");
    }
    return new Date(milliseconds).toISOString();
  }

  _publishArtifact(record) {
    const published = this._put(ARTIFACT_TYPE, record, {
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
      corrupt("merge artifact was not durably read back");
    }
    return published.ref;
  }

  async _prepare(plan) {
    const conflictPreparation = this._preparedForConflict(
      plan.conflictEnvelopeDigest,
    );
    if (
      conflictPreparation &&
      conflictPreparation.record.plan.planDigest !== plan.planDigest
    ) {
      throw new Error("governed knowledge conflict already has a merge plan");
    }
    const existing = this._prepared(plan.planDigest);
    if (existing) {
      if (canonical(existing.record.plan) !== canonical(plan)) {
        corrupt("prepared merge identity resolved different content");
      }
      return existing;
    }
    if (!isGovernedKnowledgeMergePlan(plan)) {
      throw new TypeError("first merge execution requires a branded plan");
    }
    const conflictEvent = this._conflictEvent(plan);
    const preparedAt = this._timestamp();
    const core = {
      schema: GOVERNED_KNOWLEDGE_MERGE_PREPARED_SCHEMA,
      tenantId: this.descriptor.tenantId,
      deviceId: this.descriptor.deviceId,
      plan: clone(plan),
      preparedAt,
    };
    const record = freeze({
      ...core,
      recordDigest: hash(GOVERNED_KNOWLEDGE_MERGE_PREPARED_SCHEMA, core),
    });
    const head = this._verifyLedger();
    const ref = this._publishArtifact(record);
    const eventId = `${GOVERNED_KNOWLEDGE_MERGE_PREPARED_EVENT_TYPE}.${plan.planDigest.slice(7)}`;
    try {
      const receipt = this._append(
        {
          artifactTenantId: this.descriptor.artifactTenantId,
          correlationId: this.descriptor.streamId,
          decision: "prepared",
          eventId,
          reason: "governed knowledge human merge prepared",
          skillName: null,
          sourceRefs: [conflictEvent.subjectRef],
          subjectRef: ref,
          tenantId: this.descriptor.tenantId,
          timestamp: preparedAt,
          type: GOVERNED_KNOWLEDGE_MERGE_PREPARED_EVENT_TYPE,
        },
        {
          expectedHeadDigest: head.headDigest,
          expectedSequence: head.sequence,
        },
      );
      if (receipt?.authenticated !== true || receipt.durable !== true) {
        corrupt("prepared merge ledger append was not durable");
      }
    } catch (error) {
      const recovered = this._prepared(plan.planDigest);
      if (!recovered || canonical(recovered.record.plan) !== canonical(plan)) {
        throw error;
      }
    }
    return this._prepared(plan.planDigest);
  }

  async _settle(plan, publishResult) {
    const existing = this._settled(plan);
    if (existing) return existing;
    const prepared = this._prepared(plan.planDigest);
    if (!prepared) corrupt("cannot settle an unprepared merge");
    const settledAt = this._timestamp();
    const core = {
      schema: GOVERNED_KNOWLEDGE_MERGE_SETTLED_SCHEMA,
      tenantId: this.descriptor.tenantId,
      deviceId: this.descriptor.deviceId,
      planDigest: plan.planDigest,
      publishResult: clone(publishResult),
      settledAt,
    };
    const record = freeze({
      ...core,
      recordDigest: hash(GOVERNED_KNOWLEDGE_MERGE_SETTLED_SCHEMA, core),
    });
    const head = this._verifyLedger();
    const ref = this._publishArtifact(record);
    const eventId = `${GOVERNED_KNOWLEDGE_MERGE_SETTLED_EVENT_TYPE}.${plan.planDigest.slice(7)}`;
    try {
      const receipt = this._append(
        {
          artifactTenantId: this.descriptor.artifactTenantId,
          correlationId: this.descriptor.streamId,
          decision: "committed",
          eventId,
          reason: "governed knowledge human merge published",
          skillName: null,
          sourceRefs: [prepared.event.subjectRef],
          subjectRef: ref,
          tenantId: this.descriptor.tenantId,
          timestamp: settledAt,
          type: GOVERNED_KNOWLEDGE_MERGE_SETTLED_EVENT_TYPE,
        },
        {
          expectedHeadDigest: head.headDigest,
          expectedSequence: head.sequence,
        },
      );
      if (receipt?.authenticated !== true || receipt.durable !== true) {
        corrupt("settled merge ledger append was not durable");
      }
    } catch (error) {
      const recovered = this._settled(plan);
      if (
        !recovered ||
        canonical(recovered.record.publishResult) !== canonical(publishResult)
      ) {
        throw error;
      }
    }
    return this._settled(plan);
  }

  async execute(planInput) {
    const plan = verifyGovernedKnowledgeMergePlan(planInput);
    if (
      plan.tenantId !== this.descriptor.tenantId ||
      plan.deviceId !== this.descriptor.deviceId
    ) {
      throw new Error("merge plan crossed its ledger boundary");
    }
    const completed = this._settled(plan);
    if (completed) return this._result(completed.record, true);
    const preparedBefore = this._prepared(plan.planDigest);
    await this._prepare(planInput);
    const publishResult = await this._publish(plan);
    const settled = await this._settle(plan, publishResult);
    return this._result(settled.record, preparedBefore !== null);
  }

  async isConflictSettled({ envelopeDigest } = {}) {
    if (!DIGEST.test(envelopeDigest ?? "")) {
      throw new TypeError("conflict envelope digest is invalid");
    }
    return (await this.settledConflictDigests()).includes(envelopeDigest);
  }

  async settledConflictDigests() {
    const digests = [];
    for (const event of this._events(
      GOVERNED_KNOWLEDGE_MERGE_SETTLED_EVENT_TYPE,
    )) {
      const suffix = event.eventId?.slice(
        `${GOVERNED_KNOWLEDGE_MERGE_SETTLED_EVENT_TYPE}.`.length,
      );
      const planDigest = `sha256:${suffix}`;
      if (!DIGEST.test(planDigest))
        corrupt("settled merge event id is invalid");
      const prepared = this._prepared(planDigest);
      if (!prepared) corrupt("settled merge has no prepared operation");
      this._settled(prepared.record.plan);
      digests.push(prepared.record.plan.conflictEnvelopeDigest);
    }
    if (new Set(digests).size !== digests.length) {
      corrupt("a conflict has multiple settled merge operations");
    }
    return freeze(digests);
  }

  async resume({ planDigest } = {}) {
    if (!DIGEST.test(planDigest ?? "")) {
      throw new TypeError("planDigest is invalid");
    }
    const prepared = this._prepared(planDigest);
    if (!prepared) throw new Error("prepared merge operation was not found");
    return this.execute(prepared.record.plan);
  }

  _result(record, recovered) {
    return freeze({
      authenticated: true,
      durable: true,
      recovered,
      planDigest: record.planDigest,
      envelopeDigest: record.publishResult.envelopeDigest,
      resultDigest: record.publishResult.resultDigest,
      verificationReceiptDigest: record.publishResult.verificationReceiptDigest,
    });
  }
}

export function isGovernedKnowledgeMergeExecutor(value) {
  return EXECUTORS.has(value);
}

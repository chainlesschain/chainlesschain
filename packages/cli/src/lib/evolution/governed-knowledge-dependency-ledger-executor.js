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
  GOVERNED_KNOWLEDGE_DEPENDENCY_REQUEST_SCHEMA,
  GOVERNED_KNOWLEDGE_DEPENDENCY_RESULT_SCHEMA,
  digestGovernedKnowledgeDependencyResult,
  isGovernedKnowledgeDependencyAuthority,
} from "./governed-knowledge-dependency-authority.js";
import {
  isGovernedKnowledgeExecutionRecord,
  verifyGovernedKnowledgeRecord,
} from "./governed-knowledge-sync.js";

export const GOVERNED_KNOWLEDGE_DEPENDENCY_PREPARED_SCHEMA =
  "chainlesschain.governed-knowledge-dependencies-prepared/v1";
export const GOVERNED_KNOWLEDGE_DEPENDENCY_SETTLED_SCHEMA =
  "chainlesschain.governed-knowledge-dependencies-settled/v1";
export const GOVERNED_KNOWLEDGE_DEPENDENCY_PREPARED_EVENT_TYPE =
  "knowledge.revocation-dependencies.prepared";
export const GOVERNED_KNOWLEDGE_DEPENDENCY_SETTLED_EVENT_TYPE =
  "knowledge.revocation-dependencies.settled";
export const GOVERNED_KNOWLEDGE_DEPENDENCY_LEDGER_CORRUPT_CODE =
  "CC_GOVERNED_KNOWLEDGE_DEPENDENCY_LEDGER_CORRUPT";

const EXECUTORS = new WeakSet();
const ARTIFACT_TYPE = "governed-knowledge-dependency-operation";
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const PREPARED_KEYS = new Set([
  "deviceId",
  "knowledge",
  "operationDigest",
  "preparedAt",
  "recordDigest",
  "schema",
  "tenantId",
]);
const SETTLED_KEYS = new Set([
  "deviceId",
  "operationDigest",
  "recordDigest",
  "results",
  "schema",
  "settledAt",
  "tenantId",
]);
const RESULT_KEYS = new Set([
  "applied",
  "appliedAt",
  "attestation",
  "authorityId",
  "authorityRevision",
  "dependencyDigest",
  "dependencyDisposition",
  "dependencyKind",
  "deviceId",
  "durable",
  "handlerArtifactDigest",
  "idempotent",
  "knowledgeId",
  "operationId",
  "requestDigest",
  "resultDigest",
  "revocationReceiptDigest",
  "schema",
  "tenantId",
  "verificationReceiptDigest",
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
  error.code = GOVERNED_KNOWLEDGE_DEPENDENCY_LEDGER_CORRUPT_CODE;
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

export function digestGovernedKnowledgeDependencyOperation({
  tenantId,
  deviceId,
  knowledge,
}) {
  return hash(GOVERNED_KNOWLEDGE_DEPENDENCY_PREPARED_SCHEMA, {
    tenantId,
    deviceId,
    knowledge,
  });
}

function preparedCore(value) {
  return {
    schema: value.schema,
    tenantId: value.tenantId,
    deviceId: value.deviceId,
    operationDigest: value.operationDigest,
    knowledge: value.knowledge,
    preparedAt: value.preparedAt,
  };
}

function settledCore(value) {
  return {
    schema: value.schema,
    tenantId: value.tenantId,
    deviceId: value.deviceId,
    operationDigest: value.operationDigest,
    results: value.results,
    settledAt: value.settledAt,
  };
}

function validateResult(
  value,
  dependency,
  knowledge,
  descriptorValue,
  operationDigest,
) {
  exact(value, RESULT_KEYS, "dependency execution result");
  const requestCore = {
    schema: GOVERNED_KNOWLEDGE_DEPENDENCY_REQUEST_SCHEMA,
    tenantId: descriptorValue.tenantId,
    deviceId: descriptorValue.deviceId,
    operationId: `knowledge-dependency:${operationDigest.slice(7)}:${dependency.digest.slice(7)}`,
    operationDigest,
    knowledgeId: knowledge.knowledgeId,
    action: knowledge.action,
    contentDigest: knowledge.contentDigest,
    revocationReceiptDigest: knowledge.revocationReceiptDigest,
    dependency,
  };
  const expectedRequestDigest = hash(
    GOVERNED_KNOWLEDGE_DEPENDENCY_REQUEST_SCHEMA,
    requestCore,
  );
  if (
    value.schema !== GOVERNED_KNOWLEDGE_DEPENDENCY_RESULT_SCHEMA ||
    value.tenantId !== descriptorValue.tenantId ||
    value.deviceId !== descriptorValue.deviceId ||
    value.operationId !==
      `knowledge-dependency:${operationDigest.slice(7)}:${dependency.digest.slice(7)}` ||
    value.knowledgeId !== knowledge.knowledgeId ||
    value.revocationReceiptDigest !== knowledge.revocationReceiptDigest ||
    value.dependencyKind !== dependency.kind ||
    value.dependencyDigest !== dependency.digest ||
    value.dependencyDisposition !== dependency.disposition ||
    value.applied !== true ||
    value.durable !== true ||
    value.idempotent !== true ||
    value.requestDigest !== expectedRequestDigest ||
    !DIGEST.test(value.resultDigest ?? "") ||
    !DIGEST.test(value.verificationReceiptDigest ?? "") ||
    value.resultDigest !== digestGovernedKnowledgeDependencyResult(value)
  ) {
    corrupt("dependency execution result is not exactly bound");
  }
  return freeze(clone(value));
}

function validatePrepared(value, descriptorValue) {
  exact(value, PREPARED_KEYS, "dependency prepared record");
  const knowledge = verifyGovernedKnowledgeRecord(value.knowledge, {
    tenantId: descriptorValue.tenantId,
  });
  const operationDigest = digestGovernedKnowledgeDependencyOperation({
    tenantId: descriptorValue.tenantId,
    deviceId: descriptorValue.deviceId,
    knowledge,
  });
  if (
    value.schema !== GOVERNED_KNOWLEDGE_DEPENDENCY_PREPARED_SCHEMA ||
    value.tenantId !== descriptorValue.tenantId ||
    value.deviceId !== descriptorValue.deviceId ||
    !["tombstone", "revoke"].includes(knowledge.action) ||
    value.operationDigest !== operationDigest ||
    !Number.isFinite(Date.parse(value.preparedAt)) ||
    value.recordDigest !==
      hash(GOVERNED_KNOWLEDGE_DEPENDENCY_PREPARED_SCHEMA, preparedCore(value))
  ) {
    corrupt("dependency prepared record is invalid");
  }
  return freeze(clone(value));
}

function validateSettled(value, prepared, descriptorValue) {
  exact(value, SETTLED_KEYS, "dependency settled record");
  const { knowledge, operationDigest } = prepared;
  if (
    value.schema !== GOVERNED_KNOWLEDGE_DEPENDENCY_SETTLED_SCHEMA ||
    value.tenantId !== descriptorValue.tenantId ||
    value.deviceId !== descriptorValue.deviceId ||
    value.operationDigest !== operationDigest ||
    !Array.isArray(value.results) ||
    value.results.length !== knowledge.dependencies.length ||
    !Number.isFinite(Date.parse(value.settledAt)) ||
    value.recordDigest !==
      hash(GOVERNED_KNOWLEDGE_DEPENDENCY_SETTLED_SCHEMA, settledCore(value))
  ) {
    corrupt("dependency settled record is invalid");
  }
  value.results.forEach((result, index) =>
    validateResult(
      result,
      knowledge.dependencies[index],
      knowledge,
      descriptorValue,
      operationDigest,
    ),
  );
  return freeze(clone(value));
}

export class GovernedKnowledgeDependencyLedgerExecutor {
  constructor({
    descriptor: descriptorInput,
    artifactPorts,
    ledger,
    ledgerArtifactResolver,
    dependencyAuthority,
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
    if (!isGovernedKnowledgeDependencyAuthority(dependencyAuthority)) {
      throw new TypeError(
        "a branded knowledge dependency authority is required",
      );
    }
    if (
      dependencyAuthority.tenantId !== this.descriptor.tenantId ||
      dependencyAuthority.deviceId !== this.descriptor.deviceId
    ) {
      throw new TypeError("dependency authority boundary is invalid");
    }
    if (typeof now !== "function" || utilTypes.isProxy(now)) {
      throw new TypeError("now must be a non-proxy function");
    }
    this._resolveArtifact = ledgerArtifactResolver;
    this._apply = capture(dependencyAuthority, "apply", "dependencyAuthority");
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
    if (matches.length > 1) corrupt("dependency event is ambiguous");
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
      corrupt(
        "dependency artifact resolution is unauthenticated or substituted",
      );
    }
    let artifact;
    try {
      artifact = JSON.parse(resolution.bytes.toString("utf8"));
    } catch {
      corrupt("dependency artifact is not JSON");
    }
    if (
      artifact?.schema !== EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA ||
      artifact.tenantId !== this.descriptor.artifactTenantId ||
      artifact.audience !== this.descriptor.audience ||
      artifact.purpose !== this.descriptor.purpose ||
      artifact.retention !== "ledger" ||
      artifact.type !== ARTIFACT_TYPE
    ) {
      corrupt("dependency durable artifact binding is invalid");
    }
    return artifact.value;
  }

  _prepared(operationDigest) {
    const event = this._event(
      `${GOVERNED_KNOWLEDGE_DEPENDENCY_PREPARED_EVENT_TYPE}.${operationDigest.slice(7)}`,
      GOVERNED_KNOWLEDGE_DEPENDENCY_PREPARED_EVENT_TYPE,
    );
    if (!event) return null;
    const record = validatePrepared(this._resolve(event), this.descriptor);
    if (
      record.operationDigest !== operationDigest ||
      event.decision !== "prepared" ||
      !Array.isArray(event.sourceRefs) ||
      event.sourceRefs.length !== 0
    ) {
      corrupt("dependency prepared event is invalid");
    }
    return { event, record };
  }

  _settled(prepared) {
    const event = this._event(
      `${GOVERNED_KNOWLEDGE_DEPENDENCY_SETTLED_EVENT_TYPE}.${prepared.operationDigest.slice(7)}`,
      GOVERNED_KNOWLEDGE_DEPENDENCY_SETTLED_EVENT_TYPE,
    );
    if (!event) return null;
    const record = validateSettled(
      this._resolve(event),
      prepared,
      this.descriptor,
    );
    const preparedEntry = this._prepared(prepared.operationDigest);
    if (
      !preparedEntry ||
      event.decision !== "committed" ||
      !Array.isArray(event.sourceRefs) ||
      event.sourceRefs.length !== 1 ||
      canonical(event.sourceRefs[0]) !==
        canonical(preparedEntry.event.subjectRef)
    ) {
      corrupt("dependency settled event lineage is invalid");
    }
    return { event, record };
  }

  _timestamp() {
    const milliseconds = Number(this._now());
    if (!Number.isFinite(milliseconds)) {
      throw new TypeError("dependency ledger clock is invalid");
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
      corrupt("dependency artifact was not durably read back");
    }
    return published.ref;
  }

  async _prepare(knowledgeInput, knowledge, operationDigest) {
    const existing = this._prepared(operationDigest);
    if (existing) {
      if (canonical(existing.record.knowledge) !== canonical(knowledge)) {
        corrupt("dependency operation identity resolved different knowledge");
      }
      return existing;
    }
    if (!isGovernedKnowledgeExecutionRecord(knowledgeInput)) {
      throw new TypeError(
        "first dependency execution requires a governed record",
      );
    }
    const preparedAt = this._timestamp();
    const core = {
      schema: GOVERNED_KNOWLEDGE_DEPENDENCY_PREPARED_SCHEMA,
      tenantId: this.descriptor.tenantId,
      deviceId: this.descriptor.deviceId,
      operationDigest,
      knowledge: clone(knowledge),
      preparedAt,
    };
    const record = freeze({
      ...core,
      recordDigest: hash(GOVERNED_KNOWLEDGE_DEPENDENCY_PREPARED_SCHEMA, core),
    });
    const head = this._verifyLedger();
    const ref = this._publishArtifact(record);
    const eventId = `${GOVERNED_KNOWLEDGE_DEPENDENCY_PREPARED_EVENT_TYPE}.${operationDigest.slice(7)}`;
    try {
      const receipt = this._append(
        {
          artifactTenantId: this.descriptor.artifactTenantId,
          correlationId: this.descriptor.streamId,
          decision: "prepared",
          eventId,
          reason: "governed knowledge revocation dependencies prepared",
          skillName: null,
          sourceRefs: [],
          subjectRef: ref,
          tenantId: this.descriptor.tenantId,
          timestamp: preparedAt,
          type: GOVERNED_KNOWLEDGE_DEPENDENCY_PREPARED_EVENT_TYPE,
        },
        {
          expectedHeadDigest: head.headDigest,
          expectedSequence: head.sequence,
        },
      );
      if (receipt?.authenticated !== true || receipt.durable !== true) {
        corrupt("dependency prepare append was not durable");
      }
    } catch (error) {
      const recovered = this._prepared(operationDigest);
      if (
        !recovered ||
        canonical(recovered.record.knowledge) !== canonical(knowledge)
      ) {
        throw error;
      }
    }
    return this._prepared(operationDigest);
  }

  async _settle(prepared, results) {
    const existing = this._settled(prepared);
    if (existing) return existing;
    const settledAt = this._timestamp();
    const core = {
      schema: GOVERNED_KNOWLEDGE_DEPENDENCY_SETTLED_SCHEMA,
      tenantId: this.descriptor.tenantId,
      deviceId: this.descriptor.deviceId,
      operationDigest: prepared.operationDigest,
      results: clone(results),
      settledAt,
    };
    const record = freeze({
      ...core,
      recordDigest: hash(GOVERNED_KNOWLEDGE_DEPENDENCY_SETTLED_SCHEMA, core),
    });
    const preparedEntry = this._prepared(prepared.operationDigest);
    if (!preparedEntry) corrupt("cannot settle unprepared dependencies");
    const head = this._verifyLedger();
    const ref = this._publishArtifact(record);
    const eventId = `${GOVERNED_KNOWLEDGE_DEPENDENCY_SETTLED_EVENT_TYPE}.${prepared.operationDigest.slice(7)}`;
    try {
      const receipt = this._append(
        {
          artifactTenantId: this.descriptor.artifactTenantId,
          correlationId: this.descriptor.streamId,
          decision: "committed",
          eventId,
          reason: "governed knowledge revocation dependencies applied",
          skillName: null,
          sourceRefs: [preparedEntry.event.subjectRef],
          subjectRef: ref,
          tenantId: this.descriptor.tenantId,
          timestamp: settledAt,
          type: GOVERNED_KNOWLEDGE_DEPENDENCY_SETTLED_EVENT_TYPE,
        },
        {
          expectedHeadDigest: head.headDigest,
          expectedSequence: head.sequence,
        },
      );
      if (receipt?.authenticated !== true || receipt.durable !== true) {
        corrupt("dependency settlement append was not durable");
      }
    } catch (error) {
      const recovered = this._settled(prepared);
      if (
        !recovered ||
        canonical(recovered.record.results) !== canonical(results)
      ) {
        throw error;
      }
    }
    return this._settled(prepared);
  }

  async execute(knowledgeInput) {
    const knowledge = verifyGovernedKnowledgeRecord(knowledgeInput, {
      tenantId: this.descriptor.tenantId,
    });
    if (!["tombstone", "revoke"].includes(knowledge.action)) {
      throw new TypeError("dependency execution requires a revocation record");
    }
    const operationDigest = digestGovernedKnowledgeDependencyOperation({
      tenantId: this.descriptor.tenantId,
      deviceId: this.descriptor.deviceId,
      knowledge,
    });
    const prepared = this._prepared(operationDigest);
    const completed = prepared ? this._settled(prepared.record) : null;
    if (completed) return this._result(completed.record, knowledge, true);
    await this._prepare(knowledgeInput, knowledge, operationDigest);
    const results = [];
    for (const dependency of knowledge.dependencies) {
      results.push(
        await this._apply({
          tenantId: this.descriptor.tenantId,
          deviceId: this.descriptor.deviceId,
          operationDigest,
          knowledge,
          dependency,
        }),
      );
    }
    const settled = await this._settle({ operationDigest, knowledge }, results);
    return this._result(settled.record, knowledge, prepared !== null);
  }

  async resume({ operationDigest } = {}) {
    if (!DIGEST.test(operationDigest ?? "")) {
      throw new TypeError("operationDigest is invalid");
    }
    const prepared = this._prepared(operationDigest);
    if (!prepared)
      throw new Error("prepared dependency operation was not found");
    return this.execute(prepared.record.knowledge);
  }

  _result(record, knowledge, recovered) {
    return freeze({
      authenticated: true,
      durable: true,
      recovered,
      tenantId: this.descriptor.tenantId,
      deviceId: this.descriptor.deviceId,
      knowledgeId: knowledge.knowledgeId,
      revocationReceiptDigest: knowledge.revocationReceiptDigest,
      operationDigest: record.operationDigest,
      resultDigests: record.results.map(({ resultDigest }) => resultDigest),
    });
  }
}

export function isGovernedKnowledgeDependencyExecutor(value) {
  return EXECUTORS.has(value);
}

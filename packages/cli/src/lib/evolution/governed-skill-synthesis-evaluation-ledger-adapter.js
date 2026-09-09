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

export const GOVERNED_SKILL_SYNTHESIS_EVALUATION_RECEIPT_SCHEMA =
  "chainlesschain.governed-skill-synthesis-evaluation-receipt/v3";
const LEGACY_PROCESS_STDIN_RECEIPT_SCHEMA =
  "chainlesschain.governed-skill-synthesis-evaluation-receipt/v2";
export const GOVERNED_SKILL_SYNTHESIS_EVALUATION_PERSISTENCE_SCHEMA =
  "chainlesschain.governed-skill-synthesis-evaluation-persistence/v1";
export const GOVERNED_SKILL_SYNTHESIS_EVALUATION_LEDGER_EVENT =
  "learning.skill-synthesis-evaluation.persisted";
export const GOVERNED_SKILL_SYNTHESIS_EVALUATION_CORRUPT_CODE =
  "CC_LEARNING_SYNTHESIS_EVALUATION_CORRUPT";

const ARTIFACT_TYPE = "governed-skill-synthesis-evaluation";
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const SKILL_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const ALLOWED_REASONS = new Set([
  "ambiguous-procedure",
  "clear-procedure",
  "grounded-tools",
  "insufficient-verification",
  "safe-instructions",
  "unsafe-instruction",
  "unsupported-capability",
  "ungrounded-tool",
  "verifiable-outcome",
]);
const DENY_REASONS = new Set([
  "ambiguous-procedure",
  "insufficient-verification",
  "unsafe-instruction",
  "unsupported-capability",
  "ungrounded-tool",
]);
const RECEIPT_KEYS = new Set([
  "accepted",
  "attempts",
  "attestation",
  "authenticated",
  "authorityId",
  "candidateDigest",
  "deterministicPrecheck",
  "durable",
  "handlerArtifactDigest",
  "graderCredentialDelivery",
  "graderCredentialMaxUses",
  "graderCredentialResolverArtifactDigest",
  "graderCredentialTargetHost",
  "graderCredentialTtlMs",
  "graderHardDeadlineEnforced",
  "graderInheritedEnvironment",
  "graderIsolation",
  "graderModel",
  "graderPersistentProcessAuditRequired",
  "graderProvider",
  "graderRequiredSandboxBoundaries",
  "graderSandboxProfile",
  "graderWorkerArtifactDigest",
  "minScore",
  "modelScore",
  "reasons",
  "receiptDigest",
  "revision",
  "schema",
  "skillName",
  "trajectoryId",
]);
const LEGACY_PROCESS_STDIN_RECEIPT_KEYS = new Set(
  [...RECEIPT_KEYS].filter(
    (key) =>
      ![
        "graderCredentialMaxUses",
        "graderCredentialResolverArtifactDigest",
        "graderCredentialTargetHost",
        "graderCredentialTtlMs",
      ].includes(key),
  ),
);
const PERSISTENCE_PORTS = new WeakSet();
const PERSISTENCE_RECEIPTS = new WeakSet();

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

function boundedString(value, label, maximum = 256) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    value.trim() !== value ||
    value.includes("\0")
  ) {
    throw new TypeError(`${label} must be a non-empty bounded string`);
  }
  return value;
}

function digest(value, label) {
  if (!DIGEST.test(value ?? "")) throw new TypeError(`${label} is invalid`);
  return value;
}

function exactRecord(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    throw new TypeError(`${label} must be an object`);
  }
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.size ||
    ownKeys.some((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return (
        typeof key !== "string" ||
        !keys.has(key) ||
        !descriptor ||
        !("value" in descriptor) ||
        !descriptor.enumerable
      );
    })
  ) {
    throw new TypeError(`${label} has unexpected or missing fields`);
  }
  return value;
}

function fail(message) {
  const error = new Error(message);
  error.code = GOVERNED_SKILL_SYNTHESIS_EVALUATION_CORRUPT_CODE;
  throw error;
}

function safeJson(value, depth = 0, counter = { nodes: 0 }) {
  counter.nodes += 1;
  if (counter.nodes > 10_000 || depth > 32) {
    fail("learning synthesis evaluation attestation is too complex");
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return;
  }
  if (!value || typeof value !== "object" || utilTypes.isProxy(value)) {
    fail("learning synthesis evaluation attestation is not canonical JSON");
  }
  if (Array.isArray(value)) {
    if (Reflect.ownKeys(value).length !== value.length + 1) {
      fail("learning synthesis evaluation attestation is not canonical JSON");
    }
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        fail("learning synthesis evaluation attestation is not canonical JSON");
      }
      safeJson(descriptor.value, depth + 1, counter);
    }
    return;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail("learning synthesis evaluation attestation is not canonical JSON");
  }
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== "string" ||
      !descriptor ||
      !("value" in descriptor) ||
      !descriptor.enumerable
    ) {
      fail("learning synthesis evaluation attestation is not canonical JSON");
    }
    safeJson(descriptor.value, depth + 1, counter);
  }
}

function capture(owner, method, label) {
  if (typeof owner?.[method] !== "function") {
    throw new TypeError(`${label}.${method}() is required`);
  }
  return (...args) => Reflect.apply(owner[method], owner, args);
}

function normalizeDescriptor(value) {
  exactRecord(
    value,
    new Set([
      "artifactTenantId",
      "audience",
      "authorityId",
      "handlerArtifactDigest",
      "purpose",
      "revision",
      "streamId",
      "tenantId",
    ]),
    "learning synthesis evaluation ledger descriptor",
  );
  if (!Number.isSafeInteger(value.revision) || value.revision < 1) {
    throw new TypeError("learning synthesis evaluator revision is invalid");
  }
  if (value.purpose !== "evolution-ledger") {
    throw new TypeError(
      "learning synthesis evaluation purpose must be evolution-ledger",
    );
  }
  return Object.freeze({
    tenantId: boundedString(value.tenantId, "tenantId"),
    artifactTenantId: boundedString(value.artifactTenantId, "artifactTenantId"),
    streamId: boundedString(value.streamId, "streamId"),
    audience: boundedString(value.audience, "audience"),
    purpose: value.purpose,
    authorityId: boundedString(value.authorityId, "authorityId"),
    revision: value.revision,
    handlerArtifactDigest: digest(
      value.handlerArtifactDigest,
      "handlerArtifactDigest",
    ),
  });
}

function receiptCore(receipt) {
  return {
    schema: receipt.schema,
    authorityId: receipt.authorityId,
    revision: receipt.revision,
    handlerArtifactDigest: receipt.handlerArtifactDigest,
    graderIsolation: receipt.graderIsolation,
    graderProvider: receipt.graderProvider,
    graderModel: receipt.graderModel,
    graderWorkerArtifactDigest: receipt.graderWorkerArtifactDigest,
    ...(receipt.schema === GOVERNED_SKILL_SYNTHESIS_EVALUATION_RECEIPT_SCHEMA
      ? {
          graderCredentialResolverArtifactDigest:
            receipt.graderCredentialResolverArtifactDigest,
          graderCredentialTargetHost: receipt.graderCredentialTargetHost,
          graderCredentialMaxUses: receipt.graderCredentialMaxUses,
          graderCredentialTtlMs: receipt.graderCredentialTtlMs,
        }
      : {}),
    graderInheritedEnvironment: receipt.graderInheritedEnvironment,
    graderCredentialDelivery: receipt.graderCredentialDelivery,
    graderHardDeadlineEnforced: receipt.graderHardDeadlineEnforced,
    graderSandboxProfile: receipt.graderSandboxProfile,
    graderRequiredSandboxBoundaries: receipt.graderRequiredSandboxBoundaries,
    graderPersistentProcessAuditRequired:
      receipt.graderPersistentProcessAuditRequired,
    candidateDigest: receipt.candidateDigest,
    skillName: receipt.skillName,
    trajectoryId: receipt.trajectoryId,
    deterministicPrecheck: receipt.deterministicPrecheck,
    modelScore: receipt.modelScore,
    minScore: receipt.minScore,
    attempts: receipt.attempts,
    reasons: receipt.reasons,
    accepted: receipt.accepted,
  };
}

function validateReceipt(receipt, descriptor) {
  const schemaDescriptor =
    receipt &&
    typeof receipt === "object" &&
    !Array.isArray(receipt) &&
    !utilTypes.isProxy(receipt)
      ? Object.getOwnPropertyDescriptor(receipt, "schema")
      : null;
  const legacyProcessStdin =
    schemaDescriptor?.enumerable === true &&
    Object.prototype.hasOwnProperty.call(schemaDescriptor, "value") &&
    schemaDescriptor.value === LEGACY_PROCESS_STDIN_RECEIPT_SCHEMA;
  exactRecord(
    receipt,
    legacyProcessStdin ? LEGACY_PROCESS_STDIN_RECEIPT_KEYS : RECEIPT_KEYS,
    "learning synthesis evaluation receipt",
  );
  if (
    (!legacyProcessStdin &&
      receipt.schema !== GOVERNED_SKILL_SYNTHESIS_EVALUATION_RECEIPT_SCHEMA) ||
    receipt.authorityId !== descriptor.authorityId ||
    receipt.revision !== descriptor.revision ||
    receipt.handlerArtifactDigest !== descriptor.handlerArtifactDigest ||
    !["process", "same-process"].includes(receipt.graderIsolation) ||
    (receipt.graderIsolation === "process" &&
      (!DIGEST.test(receipt.graderWorkerArtifactDigest ?? "") ||
        (!legacyProcessStdin &&
          !DIGEST.test(receipt.graderCredentialResolverArtifactDigest ?? "")) ||
        (!legacyProcessStdin &&
          receipt.graderCredentialTargetHost !== "ark.cn-beijing.volces.com") ||
        (!legacyProcessStdin && receipt.graderCredentialMaxUses !== 1) ||
        (!legacyProcessStdin &&
          (!Number.isSafeInteger(receipt.graderCredentialTtlMs) ||
            receipt.graderCredentialTtlMs < 6_000 ||
            receipt.graderCredentialTtlMs > 125_000)) ||
        typeof receipt.graderProvider !== "string" ||
        receipt.graderProvider.length === 0 ||
        typeof receipt.graderModel !== "string" ||
        receipt.graderModel.length === 0 ||
        receipt.graderInheritedEnvironment !== false ||
        receipt.graderCredentialDelivery !==
          (legacyProcessStdin
            ? "bounded-stdin"
            : "single-use-broker-reference") ||
        receipt.graderHardDeadlineEnforced !== true ||
        receipt.graderSandboxProfile !== "network-only" ||
        !Array.isArray(receipt.graderRequiredSandboxBoundaries) ||
        utilTypes.isProxy(receipt.graderRequiredSandboxBoundaries) ||
        canonical(receipt.graderRequiredSandboxBoundaries) !==
          canonical([
            "privilege-reduction",
            "process-tree",
            "resource-limits",
          ]) ||
        receipt.graderPersistentProcessAuditRequired !== true)) ||
    (receipt.graderIsolation === "same-process" &&
      (receipt.graderWorkerArtifactDigest !== null ||
        (!legacyProcessStdin &&
          receipt.graderCredentialResolverArtifactDigest !== null) ||
        (!legacyProcessStdin && receipt.graderCredentialTargetHost !== null) ||
        (!legacyProcessStdin && receipt.graderCredentialMaxUses !== null) ||
        (!legacyProcessStdin && receipt.graderCredentialTtlMs !== null) ||
        receipt.graderProvider !== null ||
        receipt.graderModel !== null ||
        receipt.graderInheritedEnvironment !== null ||
        receipt.graderCredentialDelivery !== "closure" ||
        receipt.graderHardDeadlineEnforced !== false ||
        receipt.graderSandboxProfile !== null ||
        !Array.isArray(receipt.graderRequiredSandboxBoundaries) ||
        receipt.graderRequiredSandboxBoundaries.length !== 0 ||
        receipt.graderPersistentProcessAuditRequired !== false)) ||
    receipt.authenticated !== true ||
    receipt.durable !== false ||
    receipt.deterministicPrecheck !== "passed" ||
    typeof receipt.accepted !== "boolean" ||
    !DIGEST.test(receipt.candidateDigest ?? "") ||
    !SKILL_NAME.test(receipt.skillName ?? "") ||
    typeof receipt.trajectoryId !== "string" ||
    receipt.trajectoryId.length === 0 ||
    receipt.trajectoryId.length > 256 ||
    !Number.isFinite(receipt.modelScore) ||
    receipt.modelScore < 0 ||
    receipt.modelScore > 1 ||
    !Number.isFinite(receipt.minScore) ||
    receipt.minScore < 0 ||
    receipt.minScore > 1 ||
    !Number.isSafeInteger(receipt.attempts) ||
    receipt.attempts < 1 ||
    receipt.attempts > 3 ||
    !Array.isArray(receipt.reasons) ||
    utilTypes.isProxy(receipt.reasons) ||
    receipt.reasons.length === 0 ||
    receipt.reasons.length > 8 ||
    receipt.reasons.some((reason) => !ALLOWED_REASONS.has(reason)) ||
    new Set(receipt.reasons).size !== receipt.reasons.length ||
    canonical([...receipt.reasons].sort()) !== canonical(receipt.reasons) ||
    receipt.accepted !==
      (receipt.modelScore >= receipt.minScore &&
        receipt.reasons.every((reason) => !DENY_REASONS.has(reason))) ||
    !DIGEST.test(receipt.receiptDigest ?? "") ||
    receipt.receiptDigest !== hash(receipt.schema, receiptCore(receipt))
  ) {
    fail("learning synthesis evaluation receipt binding is invalid");
  }
  let encoded;
  try {
    safeJson(receipt.attestation);
    encoded = JSON.stringify(receipt.attestation);
  } catch {
    fail("learning synthesis evaluation receipt attestation is invalid");
  }
  if (!encoded || Buffer.byteLength(encoded, "utf8") > 16 * 1024) {
    fail("learning synthesis evaluation receipt attestation is invalid");
  }
  return receipt;
}

function parseResolution(resolution, event, descriptor) {
  if (
    resolution?.schema !== EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA ||
    resolution.authenticated !== true ||
    resolution.found !== true ||
    resolution.ref !== event.subjectRef.ref ||
    resolution.digest !== event.subjectRef.digest ||
    !Buffer.isBuffer(resolution.bytes)
  ) {
    fail("learning synthesis evaluation artifact resolution is invalid");
  }
  let durable;
  try {
    durable = JSON.parse(resolution.bytes.toString("utf8"));
  } catch {
    fail("learning synthesis evaluation artifact is not canonical JSON");
  }
  if (
    durable?.schema !== EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA ||
    durable.tenantId !== descriptor.artifactTenantId ||
    durable.audience !== descriptor.audience ||
    durable.purpose !== descriptor.purpose ||
    durable.retention !== "ledger" ||
    durable.type !== ARTIFACT_TYPE
  ) {
    fail("learning synthesis evaluation durable artifact binding is invalid");
  }
  return validateReceipt(durable.value, descriptor);
}

function persistenceReceipt(receipt, event, recovered) {
  const core = {
    schema: GOVERNED_SKILL_SYNTHESIS_EVALUATION_PERSISTENCE_SCHEMA,
    authenticated: true,
    durable: true,
    persisted: true,
    recovered,
    receiptDigest: receipt.receiptDigest,
    candidateDigest: receipt.candidateDigest,
    ledgerEventDigest: event.eventDigest,
    subjectRef: Object.freeze(structuredClone(event.subjectRef)),
  };
  const result = Object.freeze({
    ...core,
    persistenceDigest: hash(
      GOVERNED_SKILL_SYNTHESIS_EVALUATION_PERSISTENCE_SCHEMA,
      core,
    ),
  });
  PERSISTENCE_RECEIPTS.add(result);
  return result;
}

export class GovernedSkillSynthesisEvaluationLedgerAdapter {
  constructor({
    descriptor: input,
    artifactPorts,
    ledger,
    ledgerArtifactResolver,
    verifyAttestation,
  } = {}) {
    this.descriptor = normalizeDescriptor(input);
    this._put = capture(artifactPorts, "putCanonical", "artifactPorts");
    this._read = capture(ledger, "read", "ledger");
    this._verifyLedger = capture(ledger, "verify", "ledger");
    this._append = capture(ledger, "appendDomainEvent", "ledger");
    this._verifyAttestation =
      typeof verifyAttestation === "function"
        ? verifyAttestation
        : (() => {
            throw new TypeError("verifyAttestation() is required");
          })();
    if (!isEvolutionLedgerArtifactResolver(ledgerArtifactResolver)) {
      throw new TypeError(
        "a branded EvolutionArtifactPorts ledger resolver is required",
      );
    }
    this._resolve = ledgerArtifactResolver;
    Object.freeze(this);
  }

  _events(receiptDigest) {
    digest(receiptDigest, "receiptDigest");
    const events = this._read();
    if (!Array.isArray(events)) {
      fail("learning synthesis evaluation ledger read is invalid");
    }
    return events.filter(
      (event) =>
        event.schema === EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA &&
        event.type === GOVERNED_SKILL_SYNTHESIS_EVALUATION_LEDGER_EVENT &&
        event.tenantId === this.descriptor.tenantId &&
        event.correlationId === this.descriptor.streamId &&
        event.eventId ===
          `${GOVERNED_SKILL_SYNTHESIS_EVALUATION_LEDGER_EVENT}.${receiptDigest.slice(7)}`,
    );
  }

  _resolveEvent(event) {
    const authority = this._verifyLedger();
    let resolution;
    try {
      resolution = this._resolve({
        epoch: authority.epoch,
        ledgerId: authority.ledgerId,
        ref: event.subjectRef,
        tenantId: this.descriptor.artifactTenantId,
      });
    } catch (cause) {
      const error = new Error(
        "learning synthesis evaluation artifact resolution failed",
        { cause },
      );
      error.code = GOVERNED_SKILL_SYNTHESIS_EVALUATION_CORRUPT_CODE;
      throw error;
    }
    const receipt = parseResolution(resolution, event, this.descriptor);
    if (
      event.artifactTenantId !== this.descriptor.artifactTenantId ||
      event.skillName !== receipt.skillName ||
      event.decision !== (receipt.accepted ? "accepted" : "rejected") ||
      !Array.isArray(event.sourceRefs) ||
      event.sourceRefs.length !== 0
    ) {
      fail("learning synthesis evaluation ledger event binding is invalid");
    }
    return receipt;
  }

  async load(receiptDigest) {
    const events = this._events(receiptDigest);
    if (events.length > 1) {
      fail("learning synthesis evaluation has duplicate ledger events");
    }
    if (events.length === 0) return null;
    const receipt = this._resolveEvent(events[0]);
    if (receipt.receiptDigest !== receiptDigest) {
      fail("learning synthesis evaluation ledger subject was substituted");
    }
    if (
      (await this._verifyAttestation({
        receiptDigest: receipt.receiptDigest,
        candidateDigest: receipt.candidateDigest,
        descriptor: Object.freeze({
          authorityId: this.descriptor.authorityId,
          revision: this.descriptor.revision,
          handlerArtifactDigest: this.descriptor.handlerArtifactDigest,
        }),
        attestation: receipt.attestation,
      })) !== true
    ) {
      fail("learning synthesis evaluation attestation was rejected on read");
    }
    return Object.freeze({
      receipt: Object.freeze(structuredClone(receipt)),
      persistence: persistenceReceipt(receipt, events[0], true),
    });
  }

  async commit(receipt) {
    validateReceipt(receipt, this.descriptor);
    if (
      (await this._verifyAttestation({
        receiptDigest: receipt.receiptDigest,
        candidateDigest: receipt.candidateDigest,
        descriptor: Object.freeze({
          authorityId: this.descriptor.authorityId,
          revision: this.descriptor.revision,
          handlerArtifactDigest: this.descriptor.handlerArtifactDigest,
        }),
        attestation: receipt.attestation,
      })) !== true
    ) {
      fail(
        "learning synthesis evaluation attestation was rejected before write",
      );
    }
    const existing = await this.load(receipt.receiptDigest);
    if (existing) return existing.persistence;

    const head = this._verifyLedger();
    const published = this._put(ARTIFACT_TYPE, receipt, {
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
      fail("learning synthesis evaluation artifact was not durably read back");
    }
    const eventId = `${GOVERNED_SKILL_SYNTHESIS_EVALUATION_LEDGER_EVENT}.${receipt.receiptDigest.slice(7)}`;
    const ledgerReceipt = this._append(
      {
        artifactTenantId: this.descriptor.artifactTenantId,
        correlationId: this.descriptor.streamId,
        decision: receipt.accepted ? "accepted" : "rejected",
        eventId,
        reason: receipt.accepted
          ? "governed Skill synthesis evaluation accepted"
          : "governed Skill synthesis evaluation rejected",
        skillName: receipt.skillName,
        sourceRefs: [],
        subjectRef: published.ref,
        tenantId: this.descriptor.tenantId,
        timestamp: new Date().toISOString(),
        type: GOVERNED_SKILL_SYNTHESIS_EVALUATION_LEDGER_EVENT,
      },
      { expectedHeadDigest: head.headDigest, expectedSequence: head.sequence },
    );
    if (
      ledgerReceipt?.authenticated !== true ||
      ledgerReceipt.committed !== true ||
      ledgerReceipt.durable !== true ||
      ledgerReceipt.eventId !== eventId ||
      !DIGEST.test(ledgerReceipt.receiptDigest ?? "")
    ) {
      fail("learning synthesis evaluation ledger append was not durable");
    }
    const events = this._events(receipt.receiptDigest);
    if (events.length !== 1) {
      fail("learning synthesis evaluation ledger readback is missing");
    }
    const stored = this._resolveEvent(events[0]);
    if (canonical(stored) !== canonical(receipt)) {
      fail("learning synthesis evaluation ledger readback was substituted");
    }
    return persistenceReceipt(receipt, events[0], false);
  }

  createReceiptPersistencePort() {
    const persist = Object.freeze(async (receipt) => this.commit(receipt));
    PERSISTENCE_PORTS.add(persist);
    return persist;
  }
}

export function createGovernedSkillSynthesisEvaluationLedgerAdapter(options) {
  return new GovernedSkillSynthesisEvaluationLedgerAdapter(options);
}

export function isGovernedSkillSynthesisEvaluationPersistencePort(value) {
  return PERSISTENCE_PORTS.has(value);
}

export function isGovernedSkillSynthesisEvaluationPersistenceReceipt(value) {
  return PERSISTENCE_RECEIPTS.has(value);
}

import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";

import {
  EvidenceBackedWikiMaintainer,
  WIKI_EVIDENCE_SCHEMA,
  WIKI_MAINTENANCE_REQUEST_SCHEMA,
} from "./evidence-backed-wiki-maintainer.js";

export const SKILL_WIKI_TRANSITION_SCHEMA =
  "chainlesschain.skill-wiki-transition/v1";
export const SKILL_WIKI_REVIEW_DECISION_SCHEMA =
  "chainlesschain.skill-wiki-review-decision/v1";
export const SKILL_WIKI_PILOT_OUTCOME_SCHEMA =
  "chainlesschain.skill-wiki-pilot-outcome/v1";
export const SKILL_WIKI_REVOCATION_OUTCOME_SCHEMA =
  "chainlesschain.skill-wiki-revocation-outcome/v1";
export const SKILL_WIKI_IMPACT_RESOLUTION_SCHEMA =
  "chainlesschain.skill-wiki-impact-resolution/v1";
export const SKILL_WIKI_EVIDENCE_RETENTION_SCHEMA =
  "chainlesschain.skill-wiki-evidence-retention/v1";
export const SKILL_WIKI_RECONCILIATION_CHECKPOINT_SCHEMA =
  "chainlesschain.skill-wiki-reconciliation-checkpoint/v1";
export const SKILL_WIKI_RECONCILIATION_ERROR_CODE =
  "CC_SKILL_WIKI_RECONCILIATION_INVALID";

const SOURCES = new WeakSet();
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const WIKI_REVISION_ID = /^wiki:[a-f0-9]{64}$/u;
const SKILL_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const TRANSITION_KEYS = new Set([
  "schema",
  "authenticated",
  "durable",
  "tenantId",
  "streamId",
  "sequence",
  "candidateId",
  "skillName",
  "activeReleaseDigest",
  "stateDigest",
  "settlementDigest",
  "occurredAt",
  "wikiRevision",
  "sourceEvidenceRefs",
  "sourceReceiptDigest",
]);
const REVIEW_KEYS = new Set([
  "schema",
  "authenticated",
  "durable",
  "tenantId",
  "streamId",
  "sequence",
  "candidateId",
  "skillName",
  "decision",
  "reason",
  "occurredAt",
  "packetDigest",
  "decisionReceiptDigest",
  "sourceEvidenceRefs",
  "sourceReceiptDigest",
]);
const PILOT_KEYS = new Set([
  "schema",
  "authenticated",
  "durable",
  "tenantId",
  "streamId",
  "sequence",
  "pilotId",
  "descriptorDigest",
  "candidateId",
  "skillName",
  "outcome",
  "reason",
  "occurredAt",
  "activeStateDigest",
  "evidenceReceiptDigests",
  "sourceReceiptDigest",
]);
const REVOCATION_KEYS = new Set([
  "schema",
  "authenticated",
  "durable",
  "tenantId",
  "streamId",
  "sequence",
  "revocationId",
  "candidateId",
  "skillName",
  "outcome",
  "reason",
  "occurredAt",
  "activeStateDigest",
  "evidenceReceiptDigests",
  "sourceReceiptDigest",
]);
const IMPACT_KEYS = new Set([
  "schema",
  "authenticated",
  "durable",
  "tenantId",
  "transitionDigest",
  "candidateId",
  "skillName",
  "wikiRevision",
  "patternRefs",
  "reason",
  "receiptDigest",
]);
const CHECKPOINT_KEYS = new Set([
  "schema",
  "authenticated",
  "durable",
  "tenantId",
  "streamId",
  "cursor",
  "lastTransitionDigest",
  "lastWikiRevisionId",
  "checkpointDigest",
]);
const RETENTION_KEYS = new Set([
  "schema",
  "authenticated",
  "durable",
  "tenantId",
  "ref",
  "envelopeDigest",
  "receiptDigest",
]);
const CHECKPOINT_RECEIPT_KEYS = new Set([
  "authenticated",
  "durable",
  "committed",
  "checkpointDigest",
]);

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function hash(value) {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}

function freeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child, seen);
  return value;
}

function fail(message, options) {
  const error = new Error(message, options);
  error.code = SKILL_WIKI_RECONCILIATION_ERROR_CODE;
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
    fail(`${label} must be a plain record`);
  }
  const own = Reflect.ownKeys(value);
  if (
    own.length !== keys.size ||
    own.some((key) => typeof key !== "string" || !keys.has(key))
  ) {
    fail(`${label} must contain exactly the supported fields`);
  }
  for (const key of own) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      fail(`${label}.${String(key)} must be an enumerable data field`);
    }
  }
}

function string(value, label, maximum = 512) {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value === "" ||
    Buffer.byteLength(value, "utf8") > maximum
  ) {
    fail(`${label} is invalid`);
  }
  return value;
}

function digest(value, label) {
  if (!DIGEST.test(value ?? "")) fail(`${label} must be sha256-bound`);
  return value;
}

function timestamp(value, label) {
  string(value, label, 64);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    fail(`${label} must be a canonical timestamp`);
  }
  return value;
}

function sequence(value, label, { allowZero = false } = {}) {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
    fail(`${label} must be a safe sequence`);
  }
  return value;
}

function references(value, label, { allowEmpty = true } = {}) {
  if (
    !Array.isArray(value) ||
    utilTypes.isProxy(value) ||
    value.length > 128 ||
    (!allowEmpty && value.length === 0)
  ) {
    fail(`${label} must be a bounded reference list`);
  }
  const normalized = value.map((entry, index) => {
    exact(entry, new Set(["ref", "digest"]), `${label}[${index}]`);
    return {
      ref: string(entry.ref, `${label}[${index}].ref`),
      digest: digest(entry.digest, `${label}[${index}].digest`),
    };
  });
  if (
    new Set(normalized.map((entry) => entry.ref)).size !== normalized.length
  ) {
    fail(`${label} contains duplicate refs`);
  }
  return normalized.sort((left, right) => left.ref.localeCompare(right.ref));
}

function normalizeTransition(input, tenantId, streamId) {
  exact(input, TRANSITION_KEYS, "skill Wiki transition");
  const wikiRevision =
    input.wikiRevision === null
      ? null
      : string(input.wikiRevision, "transition.wikiRevision");
  const core = {
    schema: SKILL_WIKI_TRANSITION_SCHEMA,
    tenantId,
    streamId,
    sequence: sequence(input.sequence, "transition.sequence"),
    candidateId: digest(input.candidateId, "transition.candidateId"),
    skillName: string(input.skillName, "transition.skillName", 128),
    activeReleaseDigest: digest(
      input.activeReleaseDigest,
      "transition.activeReleaseDigest",
    ),
    stateDigest: digest(input.stateDigest, "transition.stateDigest"),
    settlementDigest: digest(
      input.settlementDigest,
      "transition.settlementDigest",
    ),
    occurredAt: timestamp(input.occurredAt, "transition.occurredAt"),
    wikiRevision,
    sourceEvidenceRefs: references(
      input.sourceEvidenceRefs,
      "transition.sourceEvidenceRefs",
      { allowEmpty: false },
    ),
    sourceReceiptDigest: digest(
      input.sourceReceiptDigest,
      "transition.sourceReceiptDigest",
    ),
  };
  if (
    input.schema !== SKILL_WIKI_TRANSITION_SCHEMA ||
    input.authenticated !== true ||
    input.durable !== true ||
    input.tenantId !== tenantId ||
    input.streamId !== streamId ||
    !SKILL_NAME.test(core.skillName)
  ) {
    fail("skill Wiki transition is not durably tenant-bound");
  }
  return freeze({
    ...core,
    authenticated: true,
    durable: true,
    transitionDigest: hash(core),
  });
}

function capture(owner, method, label) {
  if (
    !owner ||
    typeof owner !== "object" ||
    utilTypes.isProxy(owner) ||
    typeof owner[method] !== "function" ||
    utilTypes.isProxy(owner[method])
  ) {
    throw new TypeError(`${label}.${method} is required`);
  }
  return owner[method].bind(owner);
}

export function createSkillWikiReconciliationSource({
  tenantId: tenantInput,
  streamId: streamInput,
  readTransitions,
} = {}) {
  const tenantId = string(tenantInput, "tenantId", 256);
  const streamId = string(streamInput, "streamId", 256);
  if (
    typeof readTransitions !== "function" ||
    utilTypes.isProxy(readTransitions)
  ) {
    throw new TypeError("readTransitions is required");
  }
  const read = readTransitions;
  const source = {
    tenantId,
    streamId,
    list({ afterSequence = 0, limit = 64 } = {}) {
      const cursor = sequence(afterSequence, "afterSequence", {
        allowZero: true,
      });
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 256) {
        fail("limit must be between 1 and 256");
      }
      const raw = read();
      if (!Array.isArray(raw) || raw.length > 100_000) {
        fail("transition source did not return a bounded list");
      }
      const all = raw
        .map((entry) => normalizeTransition(entry, tenantId, streamId))
        .sort((left, right) => left.sequence - right.sequence);
      for (let index = 1; index < all.length; index += 1) {
        if (all[index - 1].sequence >= all[index].sequence) {
          fail("transition source sequences must be unique and increasing");
        }
      }
      return freeze(
        all.filter((entry) => entry.sequence > cursor).slice(0, limit),
      );
    },
  };
  SOURCES.add(source);
  return freeze(source);
}

function normalizeReviewDecision(input, tenantId, streamId) {
  exact(input, REVIEW_KEYS, "skill Wiki review decision");
  const core = {
    schema: SKILL_WIKI_REVIEW_DECISION_SCHEMA,
    tenantId,
    streamId,
    sequence: sequence(input.sequence, "review.sequence"),
    candidateId: digest(input.candidateId, "review.candidateId"),
    skillName: string(input.skillName, "review.skillName", 128),
    decision: input.decision,
    reason: string(input.reason, "review.reason", 1024),
    occurredAt: timestamp(input.occurredAt, "review.occurredAt"),
    packetDigest: digest(input.packetDigest, "review.packetDigest"),
    decisionReceiptDigest: digest(
      input.decisionReceiptDigest,
      "review.decisionReceiptDigest",
    ),
    sourceEvidenceRefs: references(
      input.sourceEvidenceRefs,
      "review.sourceEvidenceRefs",
      { allowEmpty: false },
    ),
    sourceReceiptDigest: digest(
      input.sourceReceiptDigest,
      "review.sourceReceiptDigest",
    ),
  };
  if (
    input.schema !== SKILL_WIKI_REVIEW_DECISION_SCHEMA ||
    input.authenticated !== true ||
    input.durable !== true ||
    input.tenantId !== tenantId ||
    input.streamId !== streamId ||
    input.decision !== "rejected" ||
    !SKILL_NAME.test(core.skillName)
  ) {
    fail("skill Wiki review decision is not durably tenant-bound");
  }
  return freeze({
    ...core,
    authenticated: true,
    durable: true,
    wikiRevision: null,
    transitionDigest: hash(core),
  });
}

export function createSkillWikiReviewReconciliationSource({
  tenantId: tenantInput,
  streamId: streamInput,
  readReviewDecisions,
} = {}) {
  const tenantId = string(tenantInput, "tenantId", 256);
  const streamId = string(streamInput, "streamId", 256);
  if (
    typeof readReviewDecisions !== "function" ||
    utilTypes.isProxy(readReviewDecisions)
  ) {
    throw new TypeError("readReviewDecisions is required");
  }
  const source = {
    tenantId,
    streamId,
    async list({ afterSequence = 0, limit = 64 } = {}) {
      const cursor = sequence(afterSequence, "afterSequence", {
        allowZero: true,
      });
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 256) {
        fail("limit must be between 1 and 256");
      }
      const raw = await readReviewDecisions();
      if (
        !Array.isArray(raw) ||
        utilTypes.isProxy(raw) ||
        raw.length > 100_000
      ) {
        fail("review source did not return a bounded list");
      }
      const all = raw
        .map((entry) => normalizeReviewDecision(entry, tenantId, streamId))
        .sort((left, right) => left.sequence - right.sequence);
      for (let index = 1; index < all.length; index += 1) {
        if (all[index - 1].sequence >= all[index].sequence) {
          fail("review source sequences must be unique and increasing");
        }
      }
      return freeze(
        all.filter((entry) => entry.sequence > cursor).slice(0, limit),
      );
    },
  };
  SOURCES.add(source);
  return freeze(source);
}

function normalizePilotOutcome(input, tenantId, streamId) {
  exact(input, PILOT_KEYS, "skill Wiki Pilot outcome");
  if (
    !Array.isArray(input.evidenceReceiptDigests) ||
    utilTypes.isProxy(input.evidenceReceiptDigests) ||
    input.evidenceReceiptDigests.length > 128
  ) {
    fail("Pilot evidence receipts must be bounded");
  }
  const evidenceReceiptDigests = [
    ...new Set(
      input.evidenceReceiptDigests.map((value) =>
        digest(value, "Pilot evidence receipt"),
      ),
    ),
  ].sort();
  if (evidenceReceiptDigests.length !== input.evidenceReceiptDigests.length) {
    fail("Pilot evidence receipts must be unique");
  }
  const core = {
    schema: SKILL_WIKI_PILOT_OUTCOME_SCHEMA,
    tenantId,
    streamId,
    sequence: sequence(input.sequence, "Pilot outcome sequence"),
    pilotId: string(input.pilotId, "Pilot outcome pilotId", 256),
    descriptorDigest: digest(
      input.descriptorDigest,
      "Pilot outcome descriptorDigest",
    ),
    candidateId: digest(input.candidateId, "Pilot outcome candidateId"),
    skillName: string(input.skillName, "Pilot outcome skillName", 128),
    outcome: input.outcome,
    reason: string(input.reason, "Pilot outcome reason", 1024),
    occurredAt: timestamp(input.occurredAt, "Pilot outcome occurredAt"),
    activeStateDigest: digest(
      input.activeStateDigest,
      "Pilot outcome activeStateDigest",
    ),
    evidenceReceiptDigests,
    sourceReceiptDigest: digest(
      input.sourceReceiptDigest,
      "Pilot outcome sourceReceiptDigest",
    ),
  };
  if (
    input.schema !== SKILL_WIKI_PILOT_OUTCOME_SCHEMA ||
    input.authenticated !== true ||
    input.durable !== true ||
    input.tenantId !== tenantId ||
    input.streamId !== streamId ||
    !["stable", "rollback"].includes(input.outcome) ||
    !SKILL_NAME.test(core.skillName)
  ) {
    fail("skill Wiki Pilot outcome is not durably tenant-bound");
  }
  return freeze({
    ...core,
    authenticated: true,
    durable: true,
    wikiRevision: null,
    transitionDigest: hash(core),
  });
}

export function createSkillWikiPilotReconciliationSource({
  tenantId: tenantInput,
  streamId: streamInput,
  readPilotOutcomes,
} = {}) {
  const tenantId = string(tenantInput, "tenantId", 256);
  const streamId = string(streamInput, "streamId", 256);
  if (
    typeof readPilotOutcomes !== "function" ||
    utilTypes.isProxy(readPilotOutcomes)
  ) {
    throw new TypeError("readPilotOutcomes is required");
  }
  const source = {
    tenantId,
    streamId,
    async list({ afterSequence = 0, limit = 64 } = {}) {
      const cursor = sequence(afterSequence, "afterSequence", {
        allowZero: true,
      });
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 256) {
        fail("limit must be between 1 and 256");
      }
      const raw = await readPilotOutcomes();
      if (
        !Array.isArray(raw) ||
        utilTypes.isProxy(raw) ||
        raw.length > 10_000
      ) {
        fail("Pilot outcome source did not return a bounded list");
      }
      const all = raw
        .map((entry) => normalizePilotOutcome(entry, tenantId, streamId))
        .sort((left, right) => left.sequence - right.sequence);
      for (let index = 1; index < all.length; index += 1) {
        if (all[index - 1].sequence >= all[index].sequence) {
          fail("Pilot outcome sequences must be unique and increasing");
        }
      }
      return freeze(
        all.filter((entry) => entry.sequence > cursor).slice(0, limit),
      );
    },
  };
  SOURCES.add(source);
  return freeze(source);
}

function normalizeRevocationOutcome(input, tenantId, streamId) {
  exact(input, REVOCATION_KEYS, "skill Wiki revocation outcome");
  if (
    !Array.isArray(input.evidenceReceiptDigests) ||
    utilTypes.isProxy(input.evidenceReceiptDigests) ||
    input.evidenceReceiptDigests.length < 1 ||
    input.evidenceReceiptDigests.length > 128
  ) {
    fail("revocation evidence receipts must be a bounded non-empty list");
  }
  const evidenceReceiptDigests = [
    ...new Set(
      input.evidenceReceiptDigests.map((value) =>
        digest(value, "revocation evidence receipt"),
      ),
    ),
  ].sort();
  if (evidenceReceiptDigests.length !== input.evidenceReceiptDigests.length) {
    fail("revocation evidence receipts must be unique");
  }
  const core = {
    schema: SKILL_WIKI_REVOCATION_OUTCOME_SCHEMA,
    tenantId,
    streamId,
    sequence: sequence(input.sequence, "revocation outcome sequence"),
    revocationId: string(
      input.revocationId,
      "revocation outcome revocationId",
      256,
    ),
    candidateId: digest(input.candidateId, "revocation outcome candidateId"),
    skillName: string(input.skillName, "revocation outcome skillName", 128),
    outcome: input.outcome,
    reason: string(input.reason, "revocation outcome reason", 1024),
    occurredAt: timestamp(input.occurredAt, "revocation outcome occurredAt"),
    activeStateDigest: digest(
      input.activeStateDigest,
      "revocation outcome activeStateDigest",
    ),
    evidenceReceiptDigests,
    sourceReceiptDigest: digest(
      input.sourceReceiptDigest,
      "revocation outcome sourceReceiptDigest",
    ),
  };
  if (
    input.schema !== SKILL_WIKI_REVOCATION_OUTCOME_SCHEMA ||
    input.authenticated !== true ||
    input.durable !== true ||
    input.tenantId !== tenantId ||
    input.streamId !== streamId ||
    input.outcome !== "revoke" ||
    !SKILL_NAME.test(core.skillName)
  ) {
    fail("skill Wiki revocation outcome is not durably tenant-bound");
  }
  return freeze({
    ...core,
    authenticated: true,
    durable: true,
    wikiRevision: null,
    transitionDigest: hash(core),
  });
}

export function createSkillWikiRevocationReconciliationSource({
  tenantId: tenantInput,
  streamId: streamInput,
  readRevocations,
} = {}) {
  const tenantId = string(tenantInput, "tenantId", 256);
  const streamId = string(streamInput, "streamId", 256);
  if (
    typeof readRevocations !== "function" ||
    utilTypes.isProxy(readRevocations)
  ) {
    throw new TypeError("readRevocations is required");
  }
  const source = {
    tenantId,
    streamId,
    async list({ afterSequence = 0, limit = 64 } = {}) {
      const cursor = sequence(afterSequence, "afterSequence", {
        allowZero: true,
      });
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 256) {
        fail("limit must be between 1 and 256");
      }
      const raw = await readRevocations();
      if (
        !Array.isArray(raw) ||
        utilTypes.isProxy(raw) ||
        raw.length > 10_000
      ) {
        fail("revocation source did not return a bounded list");
      }
      const all = raw
        .map((entry) => normalizeRevocationOutcome(entry, tenantId, streamId))
        .sort((left, right) => left.sequence - right.sequence);
      for (let index = 1; index < all.length; index += 1) {
        if (all[index - 1].sequence >= all[index].sequence) {
          fail("revocation outcome sequences must be unique and increasing");
        }
      }
      return freeze(
        all.filter((entry) => entry.sequence > cursor).slice(0, limit),
      );
    },
  };
  SOURCES.add(source);
  return freeze(source);
}

export function captureSkillWikiReconciliationSource(source) {
  if (!SOURCES.has(source)) {
    throw new TypeError(
      "a branded skill Wiki reconciliation source is required",
    );
  }
  return freeze({
    tenantId: source.tenantId,
    streamId: source.streamId,
    list: source.list.bind(source),
  });
}

function normalizeImpact(value, transition, tenantId) {
  exact(value, IMPACT_KEYS, "skill Wiki impact resolution");
  if (
    value.schema !== SKILL_WIKI_IMPACT_RESOLUTION_SCHEMA ||
    value.authenticated !== true ||
    value.durable !== true ||
    value.tenantId !== tenantId ||
    value.transitionDigest !== transition.transitionDigest ||
    value.candidateId !== transition.candidateId ||
    value.skillName !== transition.skillName ||
    value.wikiRevision !== transition.wikiRevision
  ) {
    fail("skill Wiki impact resolution is not bound to the transition");
  }
  if (
    !Array.isArray(value.patternRefs) ||
    utilTypes.isProxy(value.patternRefs) ||
    value.patternRefs.length > 128
  ) {
    fail("impact patternRefs must be bounded");
  }
  const patternRefs = [
    ...new Set(value.patternRefs.map((ref) => string(ref, "patternRef", 128))),
  ].sort();
  if (patternRefs.length !== value.patternRefs.length) {
    fail("impact patternRefs must be unique");
  }
  if (transition.wikiRevision !== null && patternRefs.length === 0) {
    fail("a Wiki-derived transition must resolve at least one pattern");
  }
  return freeze({
    patternRefs,
    reason: string(value.reason, "impact.reason", 1024),
    receiptDigest: digest(value.receiptDigest, "impact.receiptDigest"),
  });
}

function checkpointCore(
  tenantId,
  streamId,
  cursor,
  transitionDigest,
  revisionId,
) {
  return {
    schema: SKILL_WIKI_RECONCILIATION_CHECKPOINT_SCHEMA,
    tenantId,
    streamId,
    cursor,
    lastTransitionDigest: transitionDigest,
    lastWikiRevisionId: revisionId,
  };
}

function normalizeCheckpoint(value, tenantId, streamId) {
  if (value == null) return null;
  exact(value, CHECKPOINT_KEYS, "skill Wiki reconciliation checkpoint");
  const core = checkpointCore(
    tenantId,
    streamId,
    sequence(value.cursor, "checkpoint.cursor"),
    digest(value.lastTransitionDigest, "checkpoint.lastTransitionDigest"),
    string(value.lastWikiRevisionId, "checkpoint.lastWikiRevisionId"),
  );
  if (
    value.schema !== core.schema ||
    value.authenticated !== true ||
    value.durable !== true ||
    value.tenantId !== tenantId ||
    value.streamId !== streamId ||
    value.checkpointDigest !== hash(core)
  ) {
    fail("checkpoint is not durably tenant-bound");
  }
  return freeze({ ...core, checkpointDigest: value.checkpointDigest });
}

export class SkillWikiReconciler {
  constructor({ source, maintainer, ports, crashHook = null } = {}) {
    this.source = captureSkillWikiReconciliationSource(source);
    if (!(maintainer instanceof EvidenceBackedWikiMaintainer)) {
      throw new TypeError("EvidenceBackedWikiMaintainer is required");
    }
    if (maintainer.descriptor.tenantId !== this.source.tenantId) {
      throw new TypeError("Wiki maintainer belongs to another tenant");
    }
    this._maintain = maintainer.maintain.bind(maintainer);
    this._resolveImpact = capture(ports, "resolveImpact", "ports");
    this._retainEvidence = capture(ports, "retainEvidence", "ports");
    this._loadCheckpoint = capture(ports, "loadCheckpoint", "ports");
    this._commitCheckpoint = capture(ports, "commitCheckpoint", "ports");
    if (crashHook !== null && typeof crashHook !== "function") {
      throw new TypeError("crashHook must be a function or null");
    }
    this._crashHook = crashHook;
    Object.freeze(this);
  }

  async _checkpoint() {
    return normalizeCheckpoint(
      await this._loadCheckpoint({
        tenantId: this.source.tenantId,
        streamId: this.source.streamId,
      }),
      this.source.tenantId,
      this.source.streamId,
    );
  }

  async _commit(next, previous) {
    try {
      const receipt = await this._commitCheckpoint({
        checkpoint: next,
        expectedCheckpointDigest: previous?.checkpointDigest ?? null,
      });
      exact(receipt, CHECKPOINT_RECEIPT_KEYS, "checkpoint commit receipt");
      if (
        receipt?.authenticated !== true ||
        receipt?.durable !== true ||
        receipt?.committed !== true ||
        receipt?.checkpointDigest !== next.checkpointDigest
      ) {
        fail("checkpoint commit was not durably acknowledged");
      }
    } catch (cause) {
      const recovered = await this._checkpoint();
      if (recovered?.checkpointDigest !== next.checkpointDigest) {
        fail("checkpoint commit could not be recovered", { cause });
      }
    }
  }

  async reconcile({ limit = 64 } = {}) {
    let checkpoint = await this._checkpoint();
    const transitions = await this.source.list({
      afterSequence: checkpoint?.cursor ?? 0,
      limit,
    });
    const results = [];
    for (const transition of transitions) {
      const impact = normalizeImpact(
        await this._resolveImpact(transition),
        transition,
        this.source.tenantId,
      );
      const pilot = transition.schema === SKILL_WIKI_PILOT_OUTCOME_SCHEMA;
      const revocation =
        transition.schema === SKILL_WIKI_REVOCATION_OUTCOME_SCHEMA;
      const rejected =
        transition.schema === SKILL_WIKI_REVIEW_DECISION_SCHEMA ||
        (pilot && transition.outcome === "rollback") ||
        revocation;
      const decision = {
        candidateId: transition.candidateId,
        skillName: transition.skillName,
        outcome: rejected ? "rejected" : "accepted",
        patternRefs: impact.patternRefs,
        reason:
          pilot || revocation || rejected ? transition.reason : impact.reason,
      };
      const sourceDigest =
        pilot || revocation
          ? transition.sourceReceiptDigest
          : rejected
            ? transition.decisionReceiptDigest
            : transition.settlementDigest;
      const evidenceCore = {
        schema: WIKI_EVIDENCE_SCHEMA,
        tenantId: this.source.tenantId,
        ref: `wiki-evidence://skill-decision/${sourceDigest.slice(7)}`,
        sourceDigest,
        projectionDigest: hash({ transition, impact }),
        artifactRef: pilot
          ? `skill-pilot://${this.source.tenantId}/${transition.pilotId}/${transition.sequence}`
          : revocation
            ? `skill-revocation://${this.source.tenantId}/${transition.revocationId}/${transition.sequence}`
            : rejected
              ? `skill-review://${this.source.tenantId}/${transition.decisionReceiptDigest.slice(7)}`
              : `skill-release://${this.source.tenantId}/${transition.activeReleaseDigest.slice(7)}`,
        trustedProjection: true,
        trustDomain: `skill-registry:${this.source.streamId}`,
        kind: "proposal-decision",
        status: "active",
        observedAt: transition.occurredAt,
        expiresAt: null,
        data: {
          decisionDigest: hash(decision),
          decision,
          transitionDigest: transition.transitionDigest,
          sourceDecisionDigest: sourceDigest,
          impactReceiptDigest: impact.receiptDigest,
          wikiRevision: transition.wikiRevision,
          ...(pilot
            ? {
                pilotId: transition.pilotId,
                pilotOutcome: transition.outcome,
                descriptorDigest: transition.descriptorDigest,
                activeStateDigest: transition.activeStateDigest,
                evidenceReceiptDigests: transition.evidenceReceiptDigests,
              }
            : revocation
              ? {
                  revocationId: transition.revocationId,
                  revocationOutcome: transition.outcome,
                  activeStateDigest: transition.activeStateDigest,
                  evidenceReceiptDigests: transition.evidenceReceiptDigests,
                }
              : rejected
                ? { packetDigest: transition.packetDigest }
                : {
                    settlementDigest: transition.settlementDigest,
                    activeReleaseDigest: transition.activeReleaseDigest,
                    stateDigest: transition.stateDigest,
                  }),
        },
      };
      const evidence = freeze({
        ...evidenceCore,
        envelopeDigest: hash(evidenceCore),
      });
      const retained = await this._retainEvidence(evidence);
      exact(retained, RETENTION_KEYS, "evidence retention receipt");
      if (
        retained?.schema !== SKILL_WIKI_EVIDENCE_RETENTION_SCHEMA ||
        retained.authenticated !== true ||
        retained.durable !== true ||
        retained.tenantId !== this.source.tenantId ||
        retained.ref !== evidence.ref ||
        retained.envelopeDigest !== evidence.envelopeDigest ||
        !DIGEST.test(retained.receiptDigest ?? "")
      ) {
        fail("proposal-decision evidence was not durably retained");
      }
      const requestDigest = hash({
        transitionDigest: transition.transitionDigest,
        evidenceRef: evidence.ref,
        decision,
      });
      const maintenanceRequest = freeze({
        schema: WIKI_MAINTENANCE_REQUEST_SCHEMA,
        tenantId: this.source.tenantId,
        requestId: `wiki-maintenance:${requestDigest.slice(7)}`,
        requestDigest,
      });
      const maintained = await this._maintain({
        evidenceRefs: [evidence.ref],
        effectiveAt: transition.occurredAt,
        maintenanceRequest,
      });
      if (
        !WIKI_REVISION_ID.test(maintained?.revisionId ?? "") ||
        !DIGEST.test(maintained.stateDigest ?? "")
      ) {
        fail("Wiki maintenance did not return a committed revision");
      }
      if (this._crashHook) {
        await this._crashHook(
          "after-wiki-commit",
          freeze({ transition, maintained }),
        );
      }
      const core = checkpointCore(
        this.source.tenantId,
        this.source.streamId,
        transition.sequence,
        transition.transitionDigest,
        maintained.revisionId,
      );
      const next = freeze({
        ...core,
        authenticated: true,
        durable: true,
        checkpointDigest: hash(core),
      });
      await this._commit(next, checkpoint);
      checkpoint = next;
      results.push({
        sequence: transition.sequence,
        transitionDigest: transition.transitionDigest,
        revisionId: maintained.revisionId,
        recovered: maintained.recovered === true,
      });
    }
    return freeze({
      processed: results.length,
      cursor: checkpoint?.cursor ?? 0,
      results,
    });
  }
}

export function createSkillWikiReconciler(options) {
  return new SkillWikiReconciler(options);
}

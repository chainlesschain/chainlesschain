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
  EMPTY_SKILL_ACTIVE_DIGEST,
  captureSkillEvaluatedPromotionControlPlane,
} from "./skill-promotion-controller.js";
import {
  SKILL_MUTATION_OPERATIONS,
  SKILL_MUTATION_RECEIPT_KINDS,
  SKILL_MUTATION_TARGET_SCOPES,
  SkillMutationAuthority,
  buildSkillMutationRequest,
  digestSkillMutationTransitionSubject,
  verifySkillMutationRequest,
} from "./skill-mutation-authority.js";
import {
  SKILL_WIKI_TRANSITION_SCHEMA,
  createSkillWikiReconciliationSource,
} from "./skill-wiki-reconciliation.js";

export const SKILL_REGISTRY_TRANSITION_REQUEST_SCHEMA =
  "chainlesschain.skill-registry-transition-request/v1";
export const SKILL_REGISTRY_TRANSITION_ATTEMPT_SCHEMA =
  "chainlesschain.skill-registry-transition-attempt/v1";
export const SKILL_REGISTRY_TRANSITION_SETTLEMENT_SCHEMA =
  "chainlesschain.skill-registry-transition-settlement/v1";
export const SKILL_REGISTRY_TRANSITION_REQUEST_EVENT_TYPE =
  "skill.registry-transition.requested";
export const SKILL_REGISTRY_TRANSITION_ATTEMPT_EVENT_TYPE =
  "skill.registry-transition.attempted";
export const SKILL_REGISTRY_TRANSITION_SETTLED_EVENT_TYPE =
  "skill.registry-transition.settled";
export const SKILL_REGISTRY_TRANSITION_CORRUPT_CODE =
  "CC_SKILL_REGISTRY_TRANSITION_CORRUPT";
export const SKILL_REGISTRY_TRANSITION_CONFLICT_CODE =
  "CC_SKILL_REGISTRY_TRANSITION_CONFLICT";

const REQUEST_TYPE = "skill-registry-transition-request";
const ATTEMPT_TYPE = "skill-registry-transition-attempt";
const SETTLEMENT_TYPE = "skill-registry-transition-settlement";
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const SKILL_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const REQUEST_ID = /^skill-transition:[a-f0-9]{64}$/u;
const ATTEMPT_ID = /^skill-transition-attempt:[a-f0-9]{64}$/u;
const SOURCE_INPUT_KEYS = new Set([
  "candidateCreatedRef",
  "evalCompletedRef",
  "humanTaskSettledRef",
]);
const SOURCE_RESULT_KEYS = new Set([
  "authenticated",
  "durable",
  "tenantId",
  "candidateId",
  "skillName",
  "candidateCreatedRef",
  "evalCompletedRef",
  "humanTaskSettledRef",
  "matrixContext",
  "receipts",
  "effectiveAt",
  "sourceReceiptDigest",
]);
const MATRIX_CONTEXT_KEYS = new Set([
  "baselineId",
  "matrixAuthorityRoot",
  "matrixEvalId",
  "planDigest",
]);
const RECEIPT_KEYS = new Set(
  SKILL_MUTATION_RECEIPT_KINDS.map((kind) => `${kind}Receipt`),
);
const REQUEST_KEYS = new Set([
  "schema",
  "tenantId",
  "streamId",
  "candidateId",
  "skillName",
  ...SOURCE_INPUT_KEYS,
  "matrixContext",
  "receipts",
  "effectiveAt",
  "sourceReceiptDigest",
  "requestId",
  "requestDigest",
]);
const ATTEMPT_KEYS = new Set([
  "schema",
  "tenantId",
  "streamId",
  "requestId",
  "requestDigest",
  "attemptId",
  "attemptDigest",
  "ordinal",
  "candidateId",
  "skillName",
  "matrixContext",
  "mutationRequest",
  "createdAt",
]);
const SETTLEMENT_KEYS = new Set([
  "schema",
  "tenantId",
  "streamId",
  "requestId",
  "requestDigest",
  "attemptId",
  "attemptDigest",
  "candidateId",
  "skillName",
  "activeReleaseDigest",
  "authorityReceiptDigest",
  "mutationRequestDigest",
  "transitionSubjectDigest",
  "transactionId",
  "revision",
  "stateDigest",
  "settledAt",
  "settlementDigest",
]);
const AUTHORIZATION_TTL_MS = 4 * 60_000;

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

function same(left, right) {
  return canonical(left) === canonical(right);
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return value;
}

function fail(code, message, options) {
  const error = new Error(message, options);
  error.code = code;
  throw error;
}

function assertExactRecord(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new TypeError(`${label} must be a plain object`);
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
      throw new TypeError(`${label}.${String(key)} must be a data field`);
    }
  }
}

function requiredString(value, label, maximum = 256) {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value.trim() !== value ||
    Buffer.byteLength(value, "utf8") > maximum
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function requiredDigest(value, label) {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    throw new TypeError(`${label} must be sha256-bound`);
  }
  return value;
}

function timestamp(value, label) {
  requiredString(value, label);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new TypeError(`${label} must be a canonical timestamp`);
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
    throw new TypeError(`${label} port is required`);
  }
  return (...args) => Reflect.apply(owner[method], owner, args);
}

function normalizeDescriptor(input) {
  return Object.freeze({
    tenantId: requiredString(input?.tenantId, "tenantId"),
    artifactTenantId: requiredString(
      input?.artifactTenantId,
      "artifactTenantId",
    ),
    streamId: requiredString(input?.streamId, "streamId"),
    audience: requiredString(input?.audience, "audience"),
    purpose: requiredString(input?.purpose, "purpose"),
  });
}

function normalizeSourceInput(input) {
  assertExactRecord(input, SOURCE_INPUT_KEYS, "transition source input");
  return deepFreeze({
    candidateCreatedRef: requiredString(
      input.candidateCreatedRef,
      "candidateCreatedRef",
      512,
    ),
    evalCompletedRef: requiredString(
      input.evalCompletedRef,
      "evalCompletedRef",
      512,
    ),
    humanTaskSettledRef: requiredString(
      input.humanTaskSettledRef,
      "humanTaskSettledRef",
      512,
    ),
  });
}

function normalizeMatrixContext(value) {
  assertExactRecord(value, MATRIX_CONTEXT_KEYS, "matrixContext");
  return deepFreeze({
    baselineId: requiredString(value.baselineId, "matrixContext.baselineId"),
    matrixAuthorityRoot: requiredDigest(
      value.matrixAuthorityRoot,
      "matrixContext.matrixAuthorityRoot",
    ),
    matrixEvalId: requiredString(
      value.matrixEvalId,
      "matrixContext.matrixEvalId",
    ),
    planDigest: requiredDigest(value.planDigest, "matrixContext.planDigest"),
  });
}

function normalizeReceipts(value) {
  assertExactRecord(value, RECEIPT_KEYS, "transition receipt envelopes");
  return deepFreeze(
    Object.fromEntries(
      SKILL_MUTATION_RECEIPT_KINDS.map((kind) => {
        const key = `${kind}Receipt`;
        return [key, requiredString(value[key], key, 4096)];
      }),
    ),
  );
}

function normalizeVerifiedSource(value, descriptor, expectedInput) {
  assertExactRecord(value, SOURCE_RESULT_KEYS, "transition source resolution");
  if (
    value.authenticated !== true ||
    value.durable !== true ||
    value.tenantId !== descriptor.tenantId ||
    value.candidateCreatedRef !== expectedInput.candidateCreatedRef ||
    value.evalCompletedRef !== expectedInput.evalCompletedRef ||
    value.humanTaskSettledRef !== expectedInput.humanTaskSettledRef ||
    !DIGEST.test(value.candidateId ?? "") ||
    !SKILL_NAME.test(value.skillName ?? "") ||
    !DIGEST.test(value.sourceReceiptDigest ?? "")
  ) {
    fail(
      SKILL_REGISTRY_TRANSITION_CORRUPT_CODE,
      "transition source did not authenticate the exact event chain",
    );
  }
  const core = {
    schema: SKILL_REGISTRY_TRANSITION_REQUEST_SCHEMA,
    tenantId: descriptor.tenantId,
    streamId: descriptor.streamId,
    candidateId: value.candidateId,
    skillName: value.skillName,
    candidateCreatedRef: value.candidateCreatedRef,
    evalCompletedRef: value.evalCompletedRef,
    humanTaskSettledRef: value.humanTaskSettledRef,
    matrixContext: normalizeMatrixContext(value.matrixContext),
    receipts: normalizeReceipts(value.receipts),
    effectiveAt: timestamp(value.effectiveAt, "source effectiveAt"),
    sourceReceiptDigest: value.sourceReceiptDigest,
  };
  if (Buffer.byteLength(canonical(core), "utf8") > 64 * 1024) {
    throw new TypeError("transition request exceeds its durable size limit");
  }
  const requestDigest = hash(core);
  return deepFreeze({
    ...core,
    requestId: `skill-transition:${requestDigest.slice(7)}`,
    requestDigest,
  });
}

function verifyRequest(value, descriptor) {
  assertExactRecord(value, REQUEST_KEYS, "stored transition request");
  if (
    value.schema !== SKILL_REGISTRY_TRANSITION_REQUEST_SCHEMA ||
    value.tenantId !== descriptor.tenantId ||
    value.streamId !== descriptor.streamId ||
    !REQUEST_ID.test(value.requestId ?? "") ||
    !DIGEST.test(value.requestDigest ?? "")
  ) {
    fail(
      SKILL_REGISTRY_TRANSITION_CORRUPT_CODE,
      "stored transition request identity is invalid",
    );
  }
  requiredDigest(value.candidateId, "request candidateId");
  if (!SKILL_NAME.test(value.skillName ?? "")) {
    fail(
      SKILL_REGISTRY_TRANSITION_CORRUPT_CODE,
      "stored transition request skillName is invalid",
    );
  }
  normalizeSourceInput({
    candidateCreatedRef: value.candidateCreatedRef,
    evalCompletedRef: value.evalCompletedRef,
    humanTaskSettledRef: value.humanTaskSettledRef,
  });
  normalizeMatrixContext(value.matrixContext);
  normalizeReceipts(value.receipts);
  timestamp(value.effectiveAt, "request effectiveAt");
  requiredDigest(value.sourceReceiptDigest, "request sourceReceiptDigest");
  const core = { ...value };
  delete core.requestId;
  delete core.requestDigest;
  if (
    value.requestDigest !== hash(core) ||
    value.requestId !== `skill-transition:${value.requestDigest.slice(7)}`
  ) {
    fail(
      SKILL_REGISTRY_TRANSITION_CORRUPT_CODE,
      "stored transition request digest is invalid",
    );
  }
  return deepFreeze(value);
}

function verifyAttempt(value, descriptor) {
  assertExactRecord(value, ATTEMPT_KEYS, "stored transition attempt");
  if (
    value.schema !== SKILL_REGISTRY_TRANSITION_ATTEMPT_SCHEMA ||
    value.tenantId !== descriptor.tenantId ||
    value.streamId !== descriptor.streamId ||
    !REQUEST_ID.test(value.requestId ?? "") ||
    !DIGEST.test(value.requestDigest ?? "") ||
    !ATTEMPT_ID.test(value.attemptId ?? "") ||
    !DIGEST.test(value.attemptDigest ?? "") ||
    !DIGEST.test(value.candidateId ?? "") ||
    !SKILL_NAME.test(value.skillName ?? "") ||
    !Number.isSafeInteger(value.ordinal) ||
    value.ordinal < 1
  ) {
    fail(
      SKILL_REGISTRY_TRANSITION_CORRUPT_CODE,
      "stored transition attempt identity is invalid",
    );
  }
  normalizeMatrixContext(value.matrixContext);
  const mutationRequest = verifySkillMutationRequest(value.mutationRequest);
  timestamp(value.createdAt, "attempt createdAt");
  const core = { ...value };
  delete core.attemptId;
  delete core.attemptDigest;
  if (
    value.attemptDigest !== hash(core) ||
    value.attemptId !==
      `skill-transition-attempt:${value.attemptDigest.slice(7)}` ||
    mutationRequest.tenantId !== descriptor.tenantId ||
    mutationRequest.skillName !== value.skillName ||
    mutationRequest.operation !== SKILL_MUTATION_OPERATIONS.PROMOTE ||
    mutationRequest.targetScope !== SKILL_MUTATION_TARGET_SCOPES.ACTIVE
  ) {
    fail(
      SKILL_REGISTRY_TRANSITION_CORRUPT_CODE,
      "stored transition attempt binding is invalid",
    );
  }
  return deepFreeze(value);
}

function verifySettlement(value, descriptor) {
  assertExactRecord(value, SETTLEMENT_KEYS, "stored transition settlement");
  if (
    value.schema !== SKILL_REGISTRY_TRANSITION_SETTLEMENT_SCHEMA ||
    value.tenantId !== descriptor.tenantId ||
    value.streamId !== descriptor.streamId ||
    !REQUEST_ID.test(value.requestId ?? "") ||
    !DIGEST.test(value.requestDigest ?? "") ||
    !ATTEMPT_ID.test(value.attemptId ?? "") ||
    !DIGEST.test(value.attemptDigest ?? "") ||
    !DIGEST.test(value.candidateId ?? "") ||
    !SKILL_NAME.test(value.skillName ?? "") ||
    !DIGEST.test(value.activeReleaseDigest ?? "") ||
    !DIGEST.test(value.authorityReceiptDigest ?? "") ||
    !DIGEST.test(value.mutationRequestDigest ?? "") ||
    !DIGEST.test(value.transitionSubjectDigest ?? "") ||
    !DIGEST.test(value.transactionId ?? "") ||
    !DIGEST.test(value.stateDigest ?? "") ||
    !DIGEST.test(value.settlementDigest ?? "") ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1
  ) {
    fail(
      SKILL_REGISTRY_TRANSITION_CORRUPT_CODE,
      "stored transition settlement identity is invalid",
    );
  }
  timestamp(value.settledAt, "settlement settledAt");
  const core = { ...value };
  delete core.settlementDigest;
  if (value.settlementDigest !== hash(core)) {
    fail(
      SKILL_REGISTRY_TRANSITION_CORRUPT_CODE,
      "stored transition settlement digest is invalid",
    );
  }
  return deepFreeze(value);
}

function parseRecord(resolution, descriptor, expectedType) {
  if (
    resolution?.schema !== EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA ||
    resolution.authenticated !== true ||
    resolution.found !== true ||
    !Buffer.isBuffer(resolution.bytes)
  ) {
    fail(
      SKILL_REGISTRY_TRANSITION_CORRUPT_CODE,
      "transition artifact resolution is unauthenticated or incomplete",
    );
  }
  let record;
  try {
    record = JSON.parse(resolution.bytes.toString("utf8"));
  } catch {
    fail(
      SKILL_REGISTRY_TRANSITION_CORRUPT_CODE,
      "transition artifact is not canonical JSON",
    );
  }
  if (
    record?.schema !== EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA ||
    record.tenantId !== descriptor.artifactTenantId ||
    record.audience !== descriptor.audience ||
    record.purpose !== descriptor.purpose ||
    record.retention !== "ledger" ||
    record.type !== expectedType
  ) {
    fail(
      SKILL_REGISTRY_TRANSITION_CORRUPT_CODE,
      "transition durable artifact binding is invalid",
    );
  }
  return record.value;
}

function confirmPublished(published, label) {
  if (
    published?.receipt?.persisted !== true ||
    published.receipt.readbackVerified !== true ||
    published.receipt.integrityVerified !== true ||
    published.receipt.retention !== "ledger"
  ) {
    fail(
      SKILL_REGISTRY_TRANSITION_CORRUPT_CODE,
      `${label} was not durably read back`,
    );
  }
  return published;
}

export class SkillRegistryTransitionLedgerAdapter {
  constructor({
    descriptor: input,
    artifactPorts,
    ledger,
    ledgerArtifactResolver,
    sourceVerifier,
    candidateRegistry,
    releaseRegistry,
    authority,
    controlPlane,
    now = Date.now,
    crashHook = null,
  } = {}) {
    this.descriptor = normalizeDescriptor(input);
    this._put = capture(artifactPorts, "putCanonical", "artifactPorts");
    this._readLedger = capture(ledger, "read", "ledger");
    this._verifyLedger = capture(ledger, "verify", "ledger");
    this._appendLedger = capture(ledger, "appendDomainEvent", "ledger");
    this._verifySource = capture(
      sourceVerifier,
      "verify",
      "transition source verifier",
    );
    this._readCandidate = capture(
      candidateRegistry,
      "read",
      "candidate registry",
    );
    this._readState = capture(releaseRegistry, "readState", "release registry");
    this._readRelease = capture(
      releaseRegistry,
      "readRelease",
      "release registry",
    );
    if (
      candidateRegistry?.tenantId !== this.descriptor.tenantId ||
      releaseRegistry?.tenantId !== this.descriptor.tenantId
    ) {
      throw new TypeError("transition registries must match descriptor tenant");
    }
    if (!(authority instanceof SkillMutationAuthority)) {
      throw new TypeError("SkillMutationAuthority is required");
    }
    this._authorize = authority.authorize.bind(authority);
    const capturedControlPlane =
      captureSkillEvaluatedPromotionControlPlane(controlPlane);
    if (capturedControlPlane.tenantId !== this.descriptor.tenantId) {
      throw new TypeError("transition control plane belongs to another tenant");
    }
    this._promoteEvaluated = capturedControlPlane.promoteEvaluated;
    if (!isEvolutionLedgerArtifactResolver(ledgerArtifactResolver)) {
      throw new TypeError(
        "a branded EvolutionArtifactPorts ledger resolver is required",
      );
    }
    if (typeof now !== "function")
      throw new TypeError("now must be a function");
    if (crashHook !== null && typeof crashHook !== "function") {
      throw new TypeError("crashHook must be a function or null");
    }
    this._resolveArtifact = ledgerArtifactResolver;
    this._now = now;
    this._crashHook = crashHook;
    Object.freeze(this);
  }

  _clock() {
    const nowMs = Number(this._now());
    if (!Number.isFinite(nowMs))
      throw new TypeError("transition clock is invalid");
    return { nowMs, iso: new Date(nowMs).toISOString() };
  }

  async _crash(phase, value) {
    if (this._crashHook) await this._crashHook(phase, deepFreeze(value));
  }

  _events(type) {
    const events = this._readLedger();
    if (!Array.isArray(events)) {
      fail(
        SKILL_REGISTRY_TRANSITION_CORRUPT_CODE,
        "EvolutionLedger did not return transition events",
      );
    }
    return events.filter(
      (event) =>
        event.schema === EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA &&
        event.type === type &&
        event.tenantId === this.descriptor.tenantId &&
        event.correlationId === this.descriptor.streamId,
    );
  }

  _resolveEvent(event, expectedType) {
    const identity = this._verifyLedger();
    const resolution = this._resolveArtifact({
      epoch: identity.epoch,
      ledgerId: identity.ledgerId,
      ref: event.subjectRef,
      tenantId: this.descriptor.artifactTenantId,
    });
    if (
      resolution?.ref !== event.subjectRef.ref ||
      resolution.digest !== event.subjectRef.digest
    ) {
      fail(
        SKILL_REGISTRY_TRANSITION_CORRUPT_CODE,
        "transition ledger subject was substituted",
      );
    }
    return parseRecord(resolution, this.descriptor, expectedType);
  }

  _requests() {
    return this._events(SKILL_REGISTRY_TRANSITION_REQUEST_EVENT_TYPE).map(
      (event) => {
        const request = verifyRequest(
          this._resolveEvent(event, REQUEST_TYPE),
          this.descriptor,
        );
        if (
          event.eventId !==
            `${SKILL_REGISTRY_TRANSITION_REQUEST_EVENT_TYPE}.${request.requestDigest.slice(7)}` ||
          event.decision !== "proposed" ||
          event.skillName !== request.skillName ||
          !Array.isArray(event.sourceRefs) ||
          event.sourceRefs.length !== 0
        ) {
          fail(
            SKILL_REGISTRY_TRANSITION_CORRUPT_CODE,
            "transition request event binding is invalid",
          );
        }
        return { event, request };
      },
    );
  }

  _attempts() {
    const requests = this._requests();
    return this._events(SKILL_REGISTRY_TRANSITION_ATTEMPT_EVENT_TYPE).map(
      (event) => {
        const attempt = verifyAttempt(
          this._resolveEvent(event, ATTEMPT_TYPE),
          this.descriptor,
        );
        const request = requests.find(
          (entry) => entry.request.requestId === attempt.requestId,
        );
        if (
          !request ||
          attempt.requestDigest !== request.request.requestDigest ||
          attempt.candidateId !== request.request.candidateId ||
          attempt.skillName !== request.request.skillName ||
          !same(attempt.matrixContext, request.request.matrixContext) ||
          event.eventId !==
            `${SKILL_REGISTRY_TRANSITION_ATTEMPT_EVENT_TYPE}.${attempt.attemptDigest.slice(7)}` ||
          event.decision !== "prepared" ||
          event.skillName !== attempt.skillName ||
          !Array.isArray(event.sourceRefs) ||
          event.sourceRefs.length !== 1 ||
          !same(event.sourceRefs[0], request.event.subjectRef)
        ) {
          fail(
            SKILL_REGISTRY_TRANSITION_CORRUPT_CODE,
            "transition attempt lineage is invalid",
          );
        }
        return { event, attempt, request };
      },
    );
  }

  _settlements() {
    const attempts = this._attempts();
    return this._events(SKILL_REGISTRY_TRANSITION_SETTLED_EVENT_TYPE).map(
      (event) => {
        const settlement = verifySettlement(
          this._resolveEvent(event, SETTLEMENT_TYPE),
          this.descriptor,
        );
        const attempt = attempts.find(
          (entry) => entry.attempt.attemptId === settlement.attemptId,
        );
        if (
          !attempt ||
          settlement.requestId !== attempt.request.request.requestId ||
          settlement.requestDigest !== attempt.request.request.requestDigest ||
          settlement.attemptDigest !== attempt.attempt.attemptDigest ||
          event.eventId !==
            `${SKILL_REGISTRY_TRANSITION_SETTLED_EVENT_TYPE}.${settlement.settlementDigest.slice(7)}` ||
          event.decision !== "committed" ||
          event.skillName !== settlement.skillName ||
          !Array.isArray(event.sourceRefs) ||
          event.sourceRefs.length !== 2 ||
          !same(event.sourceRefs[0], attempt.request.event.subjectRef) ||
          !same(event.sourceRefs[1], attempt.event.subjectRef)
        ) {
          fail(
            SKILL_REGISTRY_TRANSITION_CORRUPT_CODE,
            "transition settlement lineage is invalid",
          );
        }
        this._verifyCommittedSettlement(settlement, attempt.attempt);
        return { event, settlement, attempt };
      },
    );
  }

  _publish(type, value) {
    return confirmPublished(
      this._put(type, value, {
        audience: this.descriptor.audience,
        purpose: this.descriptor.purpose,
        retention: "ledger",
      }),
      type,
    );
  }

  _append(event, head) {
    const receipt = this._appendLedger(event, {
      expectedHeadDigest: head.headDigest,
      expectedSequence: head.sequence,
    });
    if (
      receipt?.authenticated !== true ||
      receipt.committed !== true ||
      receipt.durable !== true ||
      receipt.eventId !== event.eventId ||
      !DIGEST.test(receipt.receiptDigest ?? "")
    ) {
      fail(
        SKILL_REGISTRY_TRANSITION_CORRUPT_CODE,
        "transition ledger append was not durably authenticated",
      );
    }
    return receipt;
  }

  async _resolveSource(input) {
    const normalized = normalizeSourceInput(input);
    const verified = await this._verifySource(normalized);
    return normalizeVerifiedSource(verified, this.descriptor, normalized);
  }

  async _assertSource(request) {
    const current = await this._resolveSource({
      candidateCreatedRef: request.candidateCreatedRef,
      evalCompletedRef: request.evalCompletedRef,
      humanTaskSettledRef: request.humanTaskSettledRef,
    });
    if (!same(current, request)) {
      fail(
        SKILL_REGISTRY_TRANSITION_CONFLICT_CODE,
        "transition source no longer matches its durable request",
      );
    }
  }

  _assertCandidate(request) {
    const candidate = this._readCandidate(request.candidateId);
    if (
      candidate?.candidateId !== request.candidateId ||
      candidate.tenantId !== this.descriptor.tenantId ||
      candidate.skillName !== request.skillName ||
      !DIGEST.test(candidate.contentDigest ?? "") ||
      !DIGEST.test(candidate.dependencyLockDigest ?? "")
    ) {
      fail(
        SKILL_REGISTRY_TRANSITION_CORRUPT_CODE,
        "transition candidate is missing or substituted",
      );
    }
    return candidate;
  }

  async enqueue(input) {
    const request = await this._resolveSource(input);
    this._assertCandidate(request);
    const eventId = `${SKILL_REGISTRY_TRANSITION_REQUEST_EVENT_TYPE}.${request.requestDigest.slice(7)}`;
    const existing = this._requests().filter(
      (entry) => entry.event.eventId === eventId,
    );
    if (existing.length > 1) {
      fail(
        SKILL_REGISTRY_TRANSITION_CORRUPT_CODE,
        "transition request is duplicated in the ledger",
      );
    }
    if (existing.length === 1) {
      if (!same(existing[0].request, request)) {
        fail(
          SKILL_REGISTRY_TRANSITION_CONFLICT_CODE,
          "transition request id binds different content",
        );
      }
      return deepFreeze({
        queued: true,
        recovered: true,
        requestId: request.requestId,
        requestDigest: request.requestDigest,
      });
    }
    const head = this._verifyLedger();
    const published = this._publish(REQUEST_TYPE, request);
    try {
      this._append(
        {
          artifactTenantId: this.descriptor.artifactTenantId,
          correlationId: this.descriptor.streamId,
          decision: "proposed",
          eventId,
          reason:
            "CandidateCreated/EvalCompleted/HumanTaskSettled requested promotion",
          skillName: request.skillName,
          sourceRefs: [],
          subjectRef: published.ref,
          tenantId: this.descriptor.tenantId,
          timestamp: request.effectiveAt,
          type: SKILL_REGISTRY_TRANSITION_REQUEST_EVENT_TYPE,
        },
        head,
      );
    } catch (cause) {
      const recovered = this._requests().find(
        (entry) => entry.event.eventId === eventId,
      );
      if (!recovered || !same(recovered.request, request)) throw cause;
      return deepFreeze({
        queued: true,
        recovered: true,
        requestId: request.requestId,
        requestDigest: request.requestDigest,
      });
    }
    return deepFreeze({
      queued: true,
      recovered: false,
      requestId: request.requestId,
      requestDigest: request.requestDigest,
    });
  }

  _buildAttempt(request, ordinal) {
    const candidate = this._assertCandidate(request);
    const state = this._readState(request.skillName);
    if (
      state?.tenantId !== this.descriptor.tenantId ||
      state.skillName !== request.skillName ||
      !Number.isSafeInteger(state.revision) ||
      state.revision < 0
    ) {
      fail(
        SKILL_REGISTRY_TRANSITION_CORRUPT_CODE,
        "active Skill state is invalid",
      );
    }
    let activeContentDigest = EMPTY_SKILL_ACTIVE_DIGEST;
    if (state.activeReleaseDigest !== null) {
      const active = this._readRelease(state.activeReleaseDigest);
      if (
        active?.tenantId !== this.descriptor.tenantId ||
        active.skillName !== request.skillName ||
        !DIGEST.test(active.contentDigest ?? "")
      ) {
        fail(
          SKILL_REGISTRY_TRANSITION_CORRUPT_CODE,
          "active Skill release is invalid",
        );
      }
      activeContentDigest = active.contentDigest;
    }
    const expectedParent =
      state.activeReleaseDigest === null ? null : activeContentDigest;
    if (candidate.parentDigest !== expectedParent) {
      fail(
        SKILL_REGISTRY_TRANSITION_CONFLICT_CODE,
        "transition candidate is stale for the active Skill parent",
      );
    }
    const { nowMs, iso } = this._clock();
    const operationId = `transition:${request.requestDigest.slice(7, 39)}:${ordinal}`;
    const nonce = `transition_${hash({ requestDigest: request.requestDigest, ordinal }).slice(7, 47)}`;
    const transitionSubjectDigest = digestSkillMutationTransitionSubject({
      tenantId: this.descriptor.tenantId,
      skillName: request.skillName,
      operation: SKILL_MUTATION_OPERATIONS.PROMOTE,
      candidateId: request.candidateId,
      rollbackTargetReleaseDigest: null,
      dependencyLockDigest: candidate.dependencyLockDigest,
      expectedActiveContentDigest: activeContentDigest,
      expectedActiveRevision: state.revision,
    });
    const mutationRequest = buildSkillMutationRequest({
      tenantId: this.descriptor.tenantId,
      audience: this.descriptor.audience,
      operationId,
      operation: SKILL_MUTATION_OPERATIONS.PROMOTE,
      transitionSubjectDigest,
      skillName: request.skillName,
      targetScope: SKILL_MUTATION_TARGET_SCOPES.ACTIVE,
      expectedTargetDigest: activeContentDigest,
      expectedTargetRevision: state.revision,
      expiresAt: new Date(nowMs + AUTHORIZATION_TTL_MS).toISOString(),
      nonce,
      receipts: request.receipts,
    });
    const core = {
      schema: SKILL_REGISTRY_TRANSITION_ATTEMPT_SCHEMA,
      tenantId: this.descriptor.tenantId,
      streamId: this.descriptor.streamId,
      requestId: request.requestId,
      requestDigest: request.requestDigest,
      ordinal,
      candidateId: request.candidateId,
      skillName: request.skillName,
      matrixContext: request.matrixContext,
      mutationRequest,
      createdAt: iso,
    };
    const attemptDigest = hash(core);
    return deepFreeze({
      ...core,
      attemptId: `skill-transition-attempt:${attemptDigest.slice(7)}`,
      attemptDigest,
    });
  }

  _persistAttempt(requestEntry, attempt) {
    const eventId = `${SKILL_REGISTRY_TRANSITION_ATTEMPT_EVENT_TYPE}.${attempt.attemptDigest.slice(7)}`;
    const existing = this._attempts().filter(
      (entry) => entry.event.eventId === eventId,
    );
    if (existing.length > 1) {
      fail(
        SKILL_REGISTRY_TRANSITION_CORRUPT_CODE,
        "transition attempt is duplicated in the ledger",
      );
    }
    if (existing.length === 1) {
      if (!same(existing[0].attempt, attempt)) {
        fail(
          SKILL_REGISTRY_TRANSITION_CONFLICT_CODE,
          "transition attempt id binds different content",
        );
      }
      return { event: existing[0].event, recovered: true };
    }
    const head = this._verifyLedger();
    const published = this._publish(ATTEMPT_TYPE, attempt);
    try {
      this._append(
        {
          artifactTenantId: this.descriptor.artifactTenantId,
          correlationId: this.descriptor.streamId,
          decision: "prepared",
          eventId,
          reason: `durable promotion attempt ${attempt.ordinal} prepared before authorization`,
          skillName: attempt.skillName,
          sourceRefs: [requestEntry.event.subjectRef],
          subjectRef: published.ref,
          tenantId: this.descriptor.tenantId,
          timestamp: attempt.createdAt,
          type: SKILL_REGISTRY_TRANSITION_ATTEMPT_EVENT_TYPE,
        },
        head,
      );
    } catch (cause) {
      const recovered = this._attempts().find(
        (entry) => entry.event.eventId === eventId,
      );
      if (!recovered || !same(recovered.attempt, attempt)) throw cause;
      return { event: recovered.event, recovered: true };
    }
    const entry = this._attempts().find(
      (candidateEntry) => candidateEntry.event.eventId === eventId,
    );
    if (!entry) {
      fail(
        SKILL_REGISTRY_TRANSITION_CORRUPT_CODE,
        "persisted transition attempt could not be recovered",
      );
    }
    return { event: entry.event, recovered: false };
  }

  _committedForAttempt(attempt) {
    const request = attempt.mutationRequest;
    const state = this._readState(attempt.skillName);
    if (
      state?.tenantId !== this.descriptor.tenantId ||
      state.skillName !== attempt.skillName ||
      state.revision !== request.expectedTargetRevision + 1 ||
      !DIGEST.test(state.activeReleaseDigest ?? "") ||
      !DIGEST.test(state.stateDigest ?? "") ||
      !DIGEST.test(state.transactionId ?? "")
    ) {
      return null;
    }
    const release = this._readRelease(state.activeReleaseDigest);
    if (
      release?.tenantId !== this.descriptor.tenantId ||
      release.skillName !== attempt.skillName ||
      release.candidateId !== attempt.candidateId ||
      release.mutationRequestDigest !== request.requestDigest ||
      release.transitionSubjectDigest !== request.transitionSubjectDigest ||
      release.authorityReceiptDigest !== state.authorityReceiptDigest
    ) {
      return null;
    }
    return deepFreeze({ release, state });
  }

  _verifyCommittedSettlement(settlement, attempt) {
    const request = attempt.mutationRequest;
    const release = this._readRelease(settlement.activeReleaseDigest);
    if (
      release?.tenantId !== this.descriptor.tenantId ||
      release.skillName !== settlement.skillName ||
      release.candidateId !== settlement.candidateId ||
      release.authorityReceiptDigest !== settlement.authorityReceiptDigest ||
      release.mutationRequestDigest !== settlement.mutationRequestDigest ||
      release.mutationRequestDigest !== request.requestDigest ||
      release.transitionSubjectDigest !== settlement.transitionSubjectDigest ||
      release.transitionSubjectDigest !== request.transitionSubjectDigest
    ) {
      fail(
        SKILL_REGISTRY_TRANSITION_CORRUPT_CODE,
        "transition settlement release binding is invalid",
      );
    }
    const state = this._readState(settlement.skillName);
    const exactCurrent =
      state.transactionId === settlement.transactionId &&
      state.revision === settlement.revision &&
      state.stateDigest === settlement.stateDigest &&
      state.activeReleaseDigest === settlement.activeReleaseDigest &&
      state.authorityReceiptDigest === settlement.authorityReceiptDigest;
    if (!exactCurrent && state.revision <= settlement.revision) {
      fail(
        SKILL_REGISTRY_TRANSITION_CORRUPT_CODE,
        "transition settlement has no matching or later authenticated state",
      );
    }
    return { release, state };
  }

  _settle(requestEntry, attemptEntry, committed) {
    const existing = this._settlements().filter(
      (entry) => entry.settlement.requestId === requestEntry.request.requestId,
    );
    if (existing.length > 1) {
      fail(
        SKILL_REGISTRY_TRANSITION_CORRUPT_CODE,
        "transition request has conflicting settlements",
      );
    }
    if (existing.length === 1) {
      if (existing[0].settlement.attemptId !== attemptEntry.attempt.attemptId) {
        fail(
          SKILL_REGISTRY_TRANSITION_CONFLICT_CODE,
          "transition request was settled by another attempt",
        );
      }
      return deepFreeze({
        settlement: existing[0].settlement,
        recovered: true,
      });
    }
    const { iso } = this._clock();
    const { release, state } = committed;
    const core = {
      schema: SKILL_REGISTRY_TRANSITION_SETTLEMENT_SCHEMA,
      tenantId: this.descriptor.tenantId,
      streamId: this.descriptor.streamId,
      requestId: requestEntry.request.requestId,
      requestDigest: requestEntry.request.requestDigest,
      attemptId: attemptEntry.attempt.attemptId,
      attemptDigest: attemptEntry.attempt.attemptDigest,
      candidateId: attemptEntry.attempt.candidateId,
      skillName: attemptEntry.attempt.skillName,
      activeReleaseDigest: release.releaseDigest,
      authorityReceiptDigest: release.authorityReceiptDigest,
      mutationRequestDigest: release.mutationRequestDigest,
      transitionSubjectDigest: release.transitionSubjectDigest,
      transactionId: state.transactionId,
      revision: state.revision,
      stateDigest: state.stateDigest,
      settledAt: iso,
    };
    const settlement = deepFreeze({ ...core, settlementDigest: hash(core) });
    this._verifyCommittedSettlement(settlement, attemptEntry.attempt);
    const eventId = `${SKILL_REGISTRY_TRANSITION_SETTLED_EVENT_TYPE}.${settlement.settlementDigest.slice(7)}`;
    const head = this._verifyLedger();
    const published = this._publish(SETTLEMENT_TYPE, settlement);
    try {
      this._append(
        {
          artifactTenantId: this.descriptor.artifactTenantId,
          correlationId: this.descriptor.streamId,
          decision: "committed",
          eventId,
          reason: `Skill release ${release.releaseDigest} committed from durable transition`,
          skillName: settlement.skillName,
          sourceRefs: [
            requestEntry.event.subjectRef,
            attemptEntry.event.subjectRef,
          ],
          subjectRef: published.ref,
          tenantId: this.descriptor.tenantId,
          timestamp: settlement.settledAt,
          type: SKILL_REGISTRY_TRANSITION_SETTLED_EVENT_TYPE,
        },
        head,
      );
    } catch (cause) {
      const recovered = this._settlements().find(
        (entry) =>
          entry.settlement.settlementDigest === settlement.settlementDigest,
      );
      if (!recovered || !same(recovered.settlement, settlement)) throw cause;
      return deepFreeze({ settlement, recovered: true });
    }
    return deepFreeze({ settlement, recovered: false });
  }

  list() {
    const settlements = this._settlements();
    const attempts = this._attempts();
    return deepFreeze(
      this._requests()
        .map((requestEntry) => {
          const requestAttempts = attempts
            .filter(
              (entry) =>
                entry.attempt.requestId === requestEntry.request.requestId,
            )
            .sort(
              (left, right) => left.attempt.ordinal - right.attempt.ordinal,
            );
          const requestSettlements = settlements.filter(
            (entry) =>
              entry.settlement.requestId === requestEntry.request.requestId,
          );
          if (requestSettlements.length > 1) {
            fail(
              SKILL_REGISTRY_TRANSITION_CORRUPT_CODE,
              "transition request has multiple settlements",
            );
          }
          return {
            request: requestEntry.request,
            requestEventSequence: requestEntry.event.sequence,
            attempts: requestAttempts.map((entry) => entry.attempt),
            status: requestSettlements.length === 1 ? "committed" : "pending",
            settlement: requestSettlements[0]?.settlement ?? null,
          };
        })
        .sort(
          (left, right) =>
            left.requestEventSequence - right.requestEventSequence,
        ),
    );
  }

  createWikiReconciliationSource() {
    return createSkillWikiReconciliationSource({
      tenantId: this.descriptor.tenantId,
      streamId: this.descriptor.streamId,
      readTransitions: () =>
        this._settlements().map(({ event, settlement }) => {
          const candidate = this._readCandidate(settlement.candidateId);
          if (
            candidate?.tenantId !== this.descriptor.tenantId ||
            candidate.candidateId !== settlement.candidateId ||
            candidate.skillName !== settlement.skillName
          ) {
            fail(
              SKILL_REGISTRY_TRANSITION_CORRUPT_CODE,
              "transition candidate lineage is invalid for Wiki reconciliation",
            );
          }
          return {
            schema: SKILL_WIKI_TRANSITION_SCHEMA,
            authenticated: true,
            durable: true,
            tenantId: this.descriptor.tenantId,
            streamId: this.descriptor.streamId,
            sequence: event.sequence,
            candidateId: settlement.candidateId,
            skillName: settlement.skillName,
            activeReleaseDigest: settlement.activeReleaseDigest,
            stateDigest: settlement.stateDigest,
            settlementDigest: settlement.settlementDigest,
            occurredAt: settlement.settledAt,
            wikiRevision: candidate.wikiRevision,
            sourceEvidenceRefs: candidate.sourceEvidenceRefs,
            sourceReceiptDigest: event.eventDigest,
          };
        }),
    });
  }

  async processNext() {
    const pending = this.list().find((entry) => entry.status === "pending");
    if (!pending) return deepFreeze({ processed: false });
    const requestEntry = this._requests().find(
      (entry) => entry.request.requestId === pending.request.requestId,
    );
    await this._assertSource(requestEntry.request);
    this._assertCandidate(requestEntry.request);

    const attemptEntries = this._attempts()
      .filter(
        (entry) => entry.attempt.requestId === requestEntry.request.requestId,
      )
      .sort((left, right) => right.attempt.ordinal - left.attempt.ordinal);
    for (const attemptEntry of attemptEntries) {
      const committed = this._committedForAttempt(attemptEntry.attempt);
      if (committed) {
        const settled = this._settle(requestEntry, attemptEntry, committed);
        return deepFreeze({
          processed: true,
          recovered: true,
          requestId: requestEntry.request.requestId,
          attemptId: attemptEntry.attempt.attemptId,
          releaseDigest: settled.settlement.activeReleaseDigest,
          revision: settled.settlement.revision,
        });
      }
    }

    const { nowMs } = this._clock();
    const latest = attemptEntries[0] ?? null;
    if (
      latest &&
      Date.parse(latest.attempt.mutationRequest.expiresAt) > nowMs
    ) {
      return deepFreeze({
        processed: false,
        inFlight: true,
        requestId: requestEntry.request.requestId,
        attemptId: latest.attempt.attemptId,
        retryAt: latest.attempt.mutationRequest.expiresAt,
      });
    }

    const attempt = this._buildAttempt(
      requestEntry.request,
      (latest?.attempt.ordinal ?? 0) + 1,
    );
    const persisted = this._persistAttempt(requestEntry, attempt);
    const attemptEntry = { event: persisted.event, attempt };
    await this._crash("after-attempt", {
      requestId: requestEntry.request.requestId,
      attemptId: attempt.attemptId,
    });
    const capability = await this._authorize(attempt.mutationRequest);
    await this._crash("after-authorization", {
      requestId: requestEntry.request.requestId,
      attemptId: attempt.attemptId,
    });

    let result;
    try {
      result = await this._promoteEvaluated({
        authorization: { capability, request: attempt.mutationRequest },
        candidateId: attempt.candidateId,
        matrixContext: attempt.matrixContext,
      });
    } catch (cause) {
      const recovered = this._committedForAttempt(attempt);
      if (!recovered) throw cause;
      result = recovered;
    }
    const committed = this._committedForAttempt(attempt);
    if (
      !committed ||
      result.release?.releaseDigest !== committed.release.releaseDigest ||
      result.state?.stateDigest !== committed.state.stateDigest
    ) {
      fail(
        SKILL_REGISTRY_TRANSITION_CORRUPT_CODE,
        "promotion control plane did not commit the exact durable attempt",
      );
    }
    await this._crash("after-registry-commit", {
      requestId: requestEntry.request.requestId,
      attemptId: attempt.attemptId,
      releaseDigest: committed.release.releaseDigest,
      stateDigest: committed.state.stateDigest,
    });
    const settled = this._settle(requestEntry, attemptEntry, committed);
    return deepFreeze({
      processed: true,
      recovered: persisted.recovered || settled.recovered,
      requestId: requestEntry.request.requestId,
      attemptId: attempt.attemptId,
      releaseDigest: settled.settlement.activeReleaseDigest,
      revision: settled.settlement.revision,
    });
  }
}

export function createSkillRegistryTransitionLedgerAdapter(options) {
  return new SkillRegistryTransitionLedgerAdapter(options);
}

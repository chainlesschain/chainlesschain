/** Human-review protocol for evaluated Skill promotion. */

import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";

import { verifySkillCandidateDraft } from "./skill-candidate-registry.js";
import { inspectEvolutionContentInjectionRisks } from "./evolution-evidence-projector.js";
import { verifySkillRelease } from "./skill-release-registry.js";
import { SKILL_EVALUATED_PROMOTION_BINDING_SCHEMA } from "./skill-evaluated-promotion.js";

export const SKILL_PROMOTION_CAPABILITY_DIFF_SCHEMA =
  "chainlesschain.skill-promotion-capability-diff/v1";
export const SKILL_PROMOTION_REVIEW_PACKET_SCHEMA =
  "chainlesschain.skill-promotion-review-packet/v1";
export const SKILL_PROMOTION_REVIEW_DECISION_SCHEMA =
  "chainlesschain.skill-promotion-review-decision/v1";
export const SKILL_PROMOTION_REVIEW_ENVELOPE_SCHEMA =
  "chainlesschain.skill-promotion-review-envelope/v1";
export const SKILL_PROMOTION_REVIEW_RESOLUTION_SCHEMA =
  "chainlesschain.skill-promotion-review-resolution/v1";
export const SKILL_PROMOTION_REVIEW_PROVIDER_SCHEMA =
  "chainlesschain.skill-promotion-review-provider/v1";
export const SKILL_PROMOTION_REVIEW_BINDING_SCHEMA =
  "chainlesschain.skill-promotion-review-binding/v1";
export const SKILL_PROMOTION_CONTENT_RISK_SCHEMA =
  "chainlesschain.skill-promotion-content-risk/v1";

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;
const REVIEWERS_MAX = 16;
const DECISION_MAX_TTL_MS = 15 * 60 * 1000;
const EMPTY_SKILL_ACTIVE_DIGEST = `sha256:${createHash("sha256")
  .update("chainlesschain.skill-active/empty/v1\0", "utf8")
  .digest("hex")}`;
const PROVIDERS = new WeakSet();
const REVIEW_PACKETS = new WeakSet();
const PROVIDER_KEYS = new Set([
  "schema",
  "authorityId",
  "handlerArtifactDigest",
  "revision",
  "verify",
]);
const PROVIDER_OPTION_KEYS = new Set([
  "authorityId",
  "decisionResolver",
  "decisionVerifier",
  "handlerArtifactDigest",
  "now",
  "revision",
  "tenantId",
]);
const PROVIDER_INPUT_KEYS = new Set([
  "activeRelease",
  "authorization",
  "candidate",
  "matrixBinding",
  "state",
]);
const RESOLUTION_KEYS = new Set([
  "schema",
  "authorityId",
  "handlerArtifactDigest",
  "revision",
  "tenantId",
  "receiptDigest",
  "decision",
  "resolvedAt",
]);
const DECISION_KEYS = new Set([
  "schema",
  "tenantId",
  "skillName",
  "candidateId",
  "packetDigest",
  "decision",
  "automated",
  "reviewerIds",
  "quorum",
  "reason",
  "decidedAt",
  "expiresAt",
  "receiptDigest",
  "signature",
  "acknowledgedContentRiskDigest",
]);
const PACKET_KEYS = new Set([
  "schema",
  "tenantId",
  "skillName",
  "candidateId",
  "candidateContentDigest",
  "parentContentDigest",
  "baselineReleaseDigest",
  "evidenceSummary",
  "candidateDiff",
  "candidateDiffDigest",
  "capabilityDiff",
  "contentRisk",
  "evaluation",
  "targetRuntimes",
  "expectedActiveRevision",
  "requiredHumanQuorum",
  "packetDigest",
]);

export class SkillPromotionReviewError extends Error {
  constructor(code, message, details = {}) {
    super(message, details.cause ? { cause: details.cause } : undefined);
    this.name = "SkillPromotionReviewError";
    this.code = code;
    for (const [key, value] of Object.entries(details)) {
      if (key !== "cause") this[key] = value;
    }
  }
}

function failure(code, message, details = {}) {
  return new SkillPromotionReviewError(code, message, details);
}

function assertRecord(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw failure(
      "SKILL_PROMOTION_REVIEW_INVALID",
      `${label} must be a plain object`,
    );
  }
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.size ||
    ownKeys.some((key) => typeof key !== "string" || !keys.has(key))
  ) {
    throw failure(
      "SKILL_PROMOTION_REVIEW_INVALID",
      `${label} must contain exactly the supported fields`,
    );
  }
  for (const key of ownKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw failure(
        "SKILL_PROMOTION_REVIEW_INVALID",
        `${label}.${String(key)} must be an enumerable data field`,
      );
    }
  }
}

function canonicalJson(value, seen = new Set()) {
  if (value === null || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw failure(
        "SKILL_PROMOTION_REVIEW_INVALID",
        "review value contains a non-finite number",
      );
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (!value || typeof value !== "object" || seen.has(value)) {
    throw failure(
      "SKILL_PROMOTION_REVIEW_INVALID",
      "review value must be acyclic JSON",
    );
  }
  if (utilTypes.isProxy(value))
    throw failure(
      "SKILL_PROMOTION_REVIEW_INVALID",
      "review value must not be a Proxy",
    );
  seen.add(value);
  let output;
  if (Array.isArray(value)) {
    output = `[${value.map((entry) => canonicalJson(entry, seen)).join(",")}]`;
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw failure(
        "SKILL_PROMOTION_REVIEW_INVALID",
        "review value must use plain objects",
      );
    }
    output = `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key], seen)}`)
      .join(",")}}`;
  }
  seen.delete(value);
  return output;
}

function digest(domain, value) {
  return `sha256:${createHash("sha256")
    .update(`${domain}\0${canonicalJson(value)}`, "utf8")
    .digest("hex")}`;
}

function clone(value) {
  return JSON.parse(canonicalJson(value));
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function normalizeDigest(value, label) {
  if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) {
    throw failure(
      "SKILL_PROMOTION_REVIEW_INVALID",
      `${label} must be a lowercase SHA-256 digest`,
    );
  }
  return value;
}

function normalizeId(value, label) {
  if (typeof value !== "string" || !SAFE_ID_PATTERN.test(value)) {
    throw failure("SKILL_PROMOTION_REVIEW_INVALID", `${label} is invalid`);
  }
  return value;
}

function normalizeTimestamp(value, label) {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw failure("SKILL_PROMOTION_REVIEW_INVALID", `${label} is invalid`);
  }
  return value;
}

function highRiskCapability(capability) {
  return /(?:^|[.:_-])(?:admin|active|exec|network|process|promote|secret|shell|write)(?:$|[.:_-])/u.test(
    capability,
  );
}

function ownData(value, key, label) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
    throw failure(
      "SKILL_PROMOTION_REVIEW_INVALID",
      `${label}.${key} must be an enumerable data field`,
    );
  }
  return descriptor.value;
}

function normalizeReviewers(value) {
  if (
    !Array.isArray(value) ||
    utilTypes.isProxy(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length > REVIEWERS_MAX
  ) {
    throw failure(
      "SKILL_PROMOTION_REVIEW_REJECTED",
      "reviewerIds must be a bounded standard array",
    );
  }
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== value.length + 1 ||
    keys.some(
      (key) =>
        typeof key !== "string" ||
        (key !== "length" && !/^(?:0|[1-9]\d*)$/u.test(key)),
    )
  ) {
    throw failure(
      "SKILL_PROMOTION_REVIEW_REJECTED",
      "reviewerIds must be a dense data array",
    );
  }
  return Array.from({ length: value.length }, (_, index) =>
    normalizeId(ownData(value, String(index), "reviewerIds"), "reviewerId"),
  );
}

export function buildSkillPromotionCapabilityDiff(
  candidate,
  activeRelease = null,
) {
  const verifiedCandidate = verifySkillCandidateDraft(candidate);
  const release =
    activeRelease === null ? null : verifySkillRelease(activeRelease);
  if (
    (release === null && verifiedCandidate.parentDigest !== null) ||
    (release !== null &&
      (release.tenantId !== verifiedCandidate.tenantId ||
        release.skillName !== verifiedCandidate.skillName ||
        release.contentDigest !== verifiedCandidate.parentDigest))
  ) {
    throw failure(
      "SKILL_PROMOTION_REVIEW_PARENT_MISMATCH",
      "review baseline is not the candidate parent",
    );
  }
  const baseline = release?.candidate.requestedCapabilities || [];
  const requested = verifiedCandidate.requestedCapabilities;
  const added = requested.filter((item) => !baseline.includes(item));
  const removed = baseline.filter((item) => !requested.includes(item));
  const retained = requested.filter((item) => baseline.includes(item));
  const highRiskAdded = added.filter(highRiskCapability);
  const core = {
    schema: SKILL_PROMOTION_CAPABILITY_DIFF_SCHEMA,
    tenantId: verifiedCandidate.tenantId,
    skillName: verifiedCandidate.skillName,
    candidateId: verifiedCandidate.candidateId,
    baselineReleaseDigest: release?.releaseDigest || null,
    baseline,
    requested,
    added,
    removed,
    retained,
    highRiskAdded,
    changed: added.length > 0 || removed.length > 0,
    requiredHumanQuorum: added.length > 0 ? 2 : 1,
  };
  return deepFreeze({
    ...core,
    capabilityDiffDigest: digest(
      "chainlesschain.skill-promotion-capability-diff/v1",
      core,
    ),
  });
}

function unifiedReplacementDiff(candidate, release) {
  const before = release?.candidate.content || "";
  const after = candidate.content;
  const beforeLines =
    before === "" ? [] : before.replace(/\n$/u, "").split("\n");
  const afterLines = after.replace(/\n$/u, "").split("\n");
  const lines = [
    `--- active/${release?.contentDigest || "empty"}`,
    `+++ candidate/${candidate.contentDigest}`,
    `@@ -1,${beforeLines.length} +1,${afterLines.length} @@`,
    ...beforeLines.map((line) => `-${line}`),
    ...afterLines.map((line) => `+${line}`),
  ];
  return `${lines.join("\n")}\n`;
}

function normalizeMatrixBinding(value, candidate) {
  const keys = new Set([
    "schema",
    "tenantId",
    "skillName",
    "candidateId",
    "candidateContentDigest",
    "expectedActiveContentDigest",
    "expectedActiveRevision",
    "matrixEvalId",
    "matrixReceiptDigest",
    "decisionCommitmentDigest",
    "expiresAt",
    "receiptResolution",
  ]);
  assertRecord(value, keys, "matrix binding");
  if (
    value.schema !== SKILL_EVALUATED_PROMOTION_BINDING_SCHEMA ||
    value.tenantId !== candidate.tenantId ||
    value.skillName !== candidate.skillName ||
    value.candidateId !== candidate.candidateId ||
    value.candidateContentDigest !== candidate.contentDigest
  ) {
    throw failure(
      "SKILL_PROMOTION_REVIEW_EVAL_MISMATCH",
      "matrix binding is not bound to the candidate",
    );
  }
  normalizeDigest(value.matrixReceiptDigest, "matrix receipt digest");
  normalizeDigest(value.decisionCommitmentDigest, "matrix decision commitment");
  normalizeTimestamp(value.expiresAt, "matrix binding expiresAt");
  return {
    schema: value.schema,
    tenantId: value.tenantId,
    skillName: value.skillName,
    candidateId: value.candidateId,
    candidateContentDigest: value.candidateContentDigest,
    expectedActiveContentDigest: value.expectedActiveContentDigest,
    expectedActiveRevision: value.expectedActiveRevision,
    matrixEvalId: value.matrixEvalId,
    matrixReceiptDigest: value.matrixReceiptDigest,
    decisionCommitmentDigest: value.decisionCommitmentDigest,
    expiresAt: value.expiresAt,
  };
}

export function buildSkillPromotionReviewPacket({
  candidate,
  activeRelease = null,
  matrixBinding,
  state,
} = {}) {
  const verifiedCandidate = verifySkillCandidateDraft(candidate);
  const release =
    activeRelease === null ? null : verifySkillRelease(activeRelease);
  const capabilityDiff = buildSkillPromotionCapabilityDiff(
    verifiedCandidate,
    release,
  );
  const evaluation = normalizeMatrixBinding(matrixBinding, verifiedCandidate);
  if (
    !state ||
    typeof state !== "object" ||
    Array.isArray(state) ||
    utilTypes.isProxy(state) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(state))
  ) {
    throw failure(
      "SKILL_PROMOTION_REVIEW_PARENT_MISMATCH",
      "review state must be a non-proxy plain object",
    );
  }
  const stateTenantId = ownData(state, "tenantId", "review state");
  const stateSkillName = ownData(state, "skillName", "review state");
  const stateRevision = ownData(state, "revision", "review state");
  const stateActiveReleaseDigest = ownData(
    state,
    "activeReleaseDigest",
    "review state",
  );
  if (
    stateTenantId !== verifiedCandidate.tenantId ||
    stateSkillName !== verifiedCandidate.skillName ||
    !Number.isSafeInteger(stateRevision) ||
    stateRevision < 0 ||
    stateRevision !== evaluation.expectedActiveRevision ||
    stateActiveReleaseDigest !== (release?.releaseDigest || null) ||
    evaluation.expectedActiveContentDigest !==
      (release?.contentDigest || EMPTY_SKILL_ACTIVE_DIGEST)
  ) {
    throw failure(
      "SKILL_PROMOTION_REVIEW_PARENT_MISMATCH",
      "review state, active release, and evaluation baseline do not match",
    );
  }
  const candidateDiff = unifiedReplacementDiff(verifiedCandidate, release);
  const candidateDiffDigest = digest(
    "chainlesschain.skill-promotion-review-unified-diff/v1",
    candidateDiff,
  );
  const evidenceSummary = verifiedCandidate.sourceEvidenceRefs.map(
    ({ digest: evidenceDigest, ref }) => ({ digest: evidenceDigest, ref }),
  );
  const findingIds = [
    ...inspectEvolutionContentInjectionRisks(verifiedCandidate.content),
  ];
  const contentRiskCore = {
    schema: SKILL_PROMOTION_CONTENT_RISK_SCHEMA,
    findingIds,
    detected: findingIds.length > 0,
  };
  const contentRisk = deepFreeze({
    ...contentRiskCore,
    contentRiskDigest: digest(
      "chainlesschain.skill-promotion-content-risk/v1",
      contentRiskCore,
    ),
  });
  const requiredHumanQuorum = Math.max(
    capabilityDiff.requiredHumanQuorum,
    contentRisk.detected ? 2 : 1,
  );
  const core = {
    schema: SKILL_PROMOTION_REVIEW_PACKET_SCHEMA,
    tenantId: verifiedCandidate.tenantId,
    skillName: verifiedCandidate.skillName,
    candidateId: verifiedCandidate.candidateId,
    candidateContentDigest: verifiedCandidate.contentDigest,
    parentContentDigest: verifiedCandidate.parentDigest,
    baselineReleaseDigest: release?.releaseDigest || null,
    evidenceSummary,
    candidateDiff,
    candidateDiffDigest,
    capabilityDiff,
    contentRisk,
    evaluation,
    targetRuntimes: [...verifiedCandidate.targetRuntimes],
    expectedActiveRevision: stateRevision,
    requiredHumanQuorum,
  };
  const packet = deepFreeze({
    ...core,
    packetDigest: digest(
      "chainlesschain.skill-promotion-review-packet/v1",
      core,
    ),
  });
  REVIEW_PACKETS.add(packet);
  return packet;
}

export function captureSkillPromotionReviewPacket(value) {
  if (!value || !REVIEW_PACKETS.has(value)) {
    throw failure(
      "SKILL_PROMOTION_REVIEW_INVALID",
      "a packet produced by the trusted review builder is required",
    );
  }
  return deepFreeze(clone(value));
}

export function verifySkillPromotionReviewPacketArtifact(value) {
  assertRecord(value, PACKET_KEYS, "review packet artifact");
  const core = { ...value };
  delete core.packetDigest;
  if (
    value.schema !== SKILL_PROMOTION_REVIEW_PACKET_SCHEMA ||
    !SAFE_ID_PATTERN.test(value.tenantId || "") ||
    !SAFE_ID_PATTERN.test(value.skillName || "") ||
    !DIGEST_PATTERN.test(value.candidateId || "") ||
    !DIGEST_PATTERN.test(value.candidateContentDigest || "") ||
    !DIGEST_PATTERN.test(value.candidateDiffDigest || "") ||
    !DIGEST_PATTERN.test(value.capabilityDiff?.capabilityDiffDigest || "") ||
    !DIGEST_PATTERN.test(value.contentRisk?.contentRiskDigest || "") ||
    !DIGEST_PATTERN.test(value.evaluation?.matrixReceiptDigest || "") ||
    !Number.isSafeInteger(value.expectedActiveRevision) ||
    value.expectedActiveRevision < 0 ||
    !Number.isSafeInteger(value.requiredHumanQuorum) ||
    value.requiredHumanQuorum < 1 ||
    value.requiredHumanQuorum > REVIEWERS_MAX ||
    value.packetDigest !==
      digest("chainlesschain.skill-promotion-review-packet/v1", core)
  ) {
    throw failure(
      "SKILL_PROMOTION_REVIEW_INVALID",
      "review packet artifact binding is invalid",
    );
  }
  return deepFreeze(clone(value));
}

export function buildSkillPromotionReviewEnvelope(receiptDigest) {
  return canonicalJson({
    schema: SKILL_PROMOTION_REVIEW_ENVELOPE_SCHEMA,
    receiptDigest: normalizeDigest(receiptDigest, "review receipt digest"),
  });
}

function parseReviewEnvelope(value) {
  if (typeof value !== "string" || value.length > 4096) {
    throw failure(
      "SKILL_PROMOTION_REVIEW_INVALID",
      "policyReceipt must be a review envelope",
    );
  }
  let envelope;
  try {
    envelope = JSON.parse(value);
  } catch (cause) {
    throw failure(
      "SKILL_PROMOTION_REVIEW_INVALID",
      "policyReceipt is not JSON",
      { cause },
    );
  }
  assertRecord(
    envelope,
    new Set(["schema", "receiptDigest"]),
    "review envelope",
  );
  if (
    envelope.schema !== SKILL_PROMOTION_REVIEW_ENVELOPE_SCHEMA ||
    canonicalJson(envelope) !== value
  ) {
    throw failure(
      "SKILL_PROMOTION_REVIEW_INVALID",
      "policyReceipt is not a canonical review envelope",
    );
  }
  normalizeDigest(envelope.receiptDigest, "review receipt digest");
  return envelope;
}

function verifyDecision(decision, packet, nowMs, requireApproval = true) {
  assertRecord(decision, DECISION_KEYS, "review decision");
  const core = { ...decision };
  delete core.receiptDigest;
  delete core.signature;
  const reviewers = normalizeReviewers(decision.reviewerIds);
  const decidedAt = normalizeTimestamp(decision.decidedAt, "review decidedAt");
  const expiresAt = normalizeTimestamp(decision.expiresAt, "review expiresAt");
  if (
    decision.schema !== SKILL_PROMOTION_REVIEW_DECISION_SCHEMA ||
    decision.tenantId !== packet.tenantId ||
    decision.skillName !== packet.skillName ||
    decision.candidateId !== packet.candidateId ||
    decision.packetDigest !== packet.packetDigest ||
    !["approved", "rejected"].includes(decision.decision) ||
    (requireApproval && decision.decision !== "approved") ||
    decision.automated !== false ||
    reviewers.length <
      (decision.decision === "approved" ? packet.requiredHumanQuorum : 1) ||
    new Set(reviewers).size !== reviewers.length ||
    decision.quorum !== reviewers.length ||
    decision.acknowledgedContentRiskDigest !==
      (decision.decision === "approved" && packet.contentRisk.detected
        ? packet.contentRisk.contentRiskDigest
        : null) ||
    typeof decision.reason !== "string" ||
    decision.reason.length < 1 ||
    decision.reason.length > 2048 ||
    typeof decision.signature !== "string" ||
    decision.signature.length < 32 ||
    Date.parse(decidedAt) > nowMs ||
    Date.parse(expiresAt) <= nowMs ||
    Date.parse(expiresAt) - Date.parse(decidedAt) > DECISION_MAX_TTL_MS ||
    decision.receiptDigest !==
      digest("chainlesschain.skill-promotion-review-decision/v1", core)
  ) {
    throw failure(
      "SKILL_PROMOTION_REVIEW_REJECTED",
      "human review decision is invalid, stale, automated, rejected, or below quorum",
    );
  }
  return deepFreeze(clone(decision));
}

export function verifySkillPromotionReviewDecision(
  decision,
  packet,
  nowMs = Date.now(),
) {
  const verifiedPacket = verifySkillPromotionReviewPacketArtifact(packet);
  if (!Number.isFinite(nowMs)) {
    throw failure(
      "SKILL_PROMOTION_REVIEW_INVALID",
      "review decision verification clock is invalid",
    );
  }
  return verifyDecision(decision, verifiedPacket, nowMs, false);
}

function capturePort(owner, method, label) {
  if (
    !owner ||
    typeof owner !== "object" ||
    utilTypes.isProxy(owner) ||
    typeof owner[method] !== "function"
  ) {
    throw failure(
      "SKILL_PROMOTION_REVIEW_INVALID",
      `${label} must provide ${method}()`,
    );
  }
  const fn = owner[method];
  return (...args) => Reflect.apply(fn, owner, args);
}

export function createSkillPromotionReviewProvider(options = {}) {
  assertRecord(options, PROVIDER_OPTION_KEYS, "review provider options");
  const tenantId = normalizeId(options.tenantId, "review provider tenantId");
  const authorityId = normalizeId(
    options.authorityId,
    "review provider authorityId",
  );
  const handlerArtifactDigest = normalizeDigest(
    options.handlerArtifactDigest,
    "review provider handler digest",
  );
  const revision = options.revision;
  const clock = options.now;
  if (
    !Number.isSafeInteger(revision) ||
    revision < 1 ||
    typeof clock !== "function"
  ) {
    throw failure(
      "SKILL_PROMOTION_REVIEW_INVALID",
      "review provider revision or clock is invalid",
    );
  }
  const resolve = capturePort(
    options.decisionResolver,
    "resolve",
    "review decision resolver",
  );
  const verify = capturePort(
    options.decisionVerifier,
    "verify",
    "review decision verifier",
  );
  const provider = {
    schema: SKILL_PROMOTION_REVIEW_PROVIDER_SCHEMA,
    authorityId,
    handlerArtifactDigest,
    revision,
    async verify(input = {}) {
      assertRecord(input, PROVIDER_INPUT_KEYS, "review provider input");
      const packet = buildSkillPromotionReviewPacket(input);
      if (packet.tenantId !== tenantId) {
        throw failure(
          "SKILL_PROMOTION_REVIEW_REJECTED",
          "review candidate belongs to another tenant",
        );
      }
      const policyReceipt =
        input.authorization?.request?.receipts?.policyReceipt;
      const envelope = parseReviewEnvelope(policyReceipt);
      const resolution = await resolve(
        deepFreeze({ tenantId, receiptDigest: envelope.receiptDigest }),
      );
      assertRecord(resolution, RESOLUTION_KEYS, "review decision resolution");
      if (
        resolution.schema !== SKILL_PROMOTION_REVIEW_RESOLUTION_SCHEMA ||
        resolution.authorityId !== authorityId ||
        resolution.handlerArtifactDigest !== handlerArtifactDigest ||
        resolution.revision !== revision ||
        resolution.tenantId !== tenantId ||
        resolution.receiptDigest !== envelope.receiptDigest
      ) {
        throw failure(
          "SKILL_PROMOTION_REVIEW_REJECTED",
          "review decision resolution is not authority-bound",
        );
      }
      normalizeTimestamp(resolution.resolvedAt, "review resolvedAt");
      const nowMs = Number(clock());
      if (!Number.isFinite(nowMs)) {
        throw failure(
          "SKILL_PROMOTION_REVIEW_INVALID",
          "review provider clock is invalid",
        );
      }
      const decision = verifyDecision(resolution.decision, packet, nowMs);
      if (decision.receiptDigest !== envelope.receiptDigest) {
        throw failure(
          "SKILL_PROMOTION_REVIEW_REJECTED",
          "policyReceipt does not identify the resolved review decision",
        );
      }
      const authenticated = await verify(deepFreeze({ decision, packet }));
      if (authenticated !== true) {
        throw failure(
          "SKILL_PROMOTION_REVIEW_REJECTED",
          "review decision signature verification failed",
        );
      }
      return deepFreeze({
        schema: SKILL_PROMOTION_REVIEW_BINDING_SCHEMA,
        tenantId,
        skillName: packet.skillName,
        candidateId: packet.candidateId,
        packetDigest: packet.packetDigest,
        capabilityDiffDigest: packet.capabilityDiff.capabilityDiffDigest,
        candidateDiffDigest: packet.candidateDiffDigest,
        contentRiskDigest: packet.contentRisk.contentRiskDigest,
        matrixReceiptDigest: packet.evaluation.matrixReceiptDigest,
        reviewReceiptDigest: decision.receiptDigest,
        reviewerIds: [...decision.reviewerIds],
        quorum: decision.quorum,
        expiresAt: decision.expiresAt,
      });
    },
  };
  PROVIDERS.add(provider);
  return Object.freeze(provider);
}

export function captureSkillPromotionReviewProvider(value) {
  if (!value || !PROVIDERS.has(value)) {
    throw failure(
      "SKILL_PROMOTION_REVIEW_PROVIDER_REQUIRED",
      "a branded human review provider is required",
    );
  }
  assertRecord(value, PROVIDER_KEYS, "review provider");
  return Object.freeze({
    schema: value.schema,
    authorityId: value.authorityId,
    handlerArtifactDigest: value.handlerArtifactDigest,
    revision: value.revision,
    verify: value.verify.bind(value),
  });
}

Object.freeze(SkillPromotionReviewError.prototype);

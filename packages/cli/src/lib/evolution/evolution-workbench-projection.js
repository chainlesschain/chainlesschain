import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";

import evolutionRun from "@chainlesschain/session-core/evolution-run";
import skillInvocationReceipt from "@chainlesschain/session-core/skill-invocation-receipt";

import {
  verifySkillPromotionReviewDecision,
  verifySkillPromotionReviewPacketArtifact,
} from "./skill-promotion-review.js";

const { projectEvolutionRun } = evolutionRun;
const { verifySkillInvocationReceipt } = skillInvocationReceipt;

export const EVOLUTION_WORKBENCH_PROJECTION_SCHEMA =
  "chainlesschain.evolution-workbench-projection/v1";
export const EVOLUTION_WORKBENCH_BATCH_PLAN_SCHEMA =
  "chainlesschain.evolution-workbench-batch-plan/v1";
export const EVOLUTION_WORKBENCH_MAX_ITEMS = 10_000;
export const EVOLUTION_WORKBENCH_MAX_BATCH = 50;

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const DATA_SOURCES = new WeakSet();

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
    .update(`${domain}\0${canonical(value)}`)
    .digest("hex")}`;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return value;
}

function record(value, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new TypeError(`${label} must be a plain object`);
  }
  return value;
}

function identifier(value, label) {
  if (typeof value !== "string" || !SAFE_ID.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function digest(value, label) {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    throw new TypeError(`${label} must be sha256-bound`);
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

function boundedArray(value, label) {
  if (!Array.isArray(value) || value.length > EVOLUTION_WORKBENCH_MAX_ITEMS) {
    throw new TypeError(`${label} must be a bounded array`);
  }
  return value;
}

function same(left, right) {
  return canonical(left) === canonical(right);
}

function normalizeTime(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function normalizeRun(value, descriptor) {
  record(value, "EvolutionRun source result");
  const events = boundedArray(value.events, "EvolutionRun events");
  const projection = projectEvolutionRun(events, {
    tenantId: descriptor.tenantId,
    runId: descriptor.runId,
  });
  if (!same(projection, value.projection)) {
    throw new Error("EvolutionRun source projection differs from its events");
  }
  return { events: clone(events), projection: clone(projection) };
}

function normalizeReviews(value, descriptor) {
  return boundedArray(value, "review source result").map((entry, index) => {
    record(entry, `reviews[${index}]`);
    const packet = verifySkillPromotionReviewPacketArtifact(entry.packet);
    if (
      packet.tenantId !== descriptor.tenantId ||
      packet.skillName !== descriptor.skillName
    ) {
      throw new Error("review source crossed its tenant or Skill boundary");
    }
    let decision = null;
    if (entry.decision !== null) {
      decision = verifySkillPromotionReviewDecision(
        entry.decision,
        packet,
        Date.parse(entry.decision.decidedAt),
      );
    }
    const expectedStatus = decision?.decision || "pending";
    if (
      !["pending", "approved", "rejected", "expired"].includes(entry.status) ||
      (entry.status === "expired" && decision === null) ||
      (entry.status !== "expired" && entry.status !== expectedStatus)
    ) {
      throw new Error("review source status differs from its decision");
    }
    return {
      packet: clone(packet),
      decision: clone(decision),
      status: entry.status,
    };
  });
}

function normalizeTransitions(value, descriptor) {
  return boundedArray(value, "transition source result").map((entry, index) => {
    record(entry, `transitions[${index}]`);
    record(entry.request, `transitions[${index}].request`);
    digest(entry.request.requestDigest, "transition request digest");
    if (
      entry.request.tenantId !== descriptor.tenantId ||
      entry.request.skillName !== descriptor.skillName ||
      !["pending", "committed"].includes(entry.status) ||
      !Array.isArray(entry.attempts) ||
      entry.attempts.length > 64 ||
      (entry.status === "committed") !== (entry.settlement !== null)
    ) {
      throw new Error("transition source crossed or contradicted its boundary");
    }
    for (const attempt of entry.attempts) {
      digest(attempt.attemptDigest, "transition attempt digest");
      if (
        attempt.tenantId !== descriptor.tenantId ||
        attempt.skillName !== descriptor.skillName ||
        attempt.requestDigest !== entry.request.requestDigest
      ) {
        throw new Error("transition attempt is not bound to its request");
      }
    }
    if (entry.settlement) {
      digest(entry.settlement.settlementDigest, "transition settlement digest");
      if (
        entry.settlement.tenantId !== descriptor.tenantId ||
        entry.settlement.skillName !== descriptor.skillName ||
        entry.settlement.requestDigest !== entry.request.requestDigest
      ) {
        throw new Error("transition settlement is not bound to its request");
      }
    }
    return clone(entry);
  });
}

function normalizeInvocations(value, descriptor) {
  return boundedArray(value, "invocation receipt source result")
    .map((receipt) => verifySkillInvocationReceipt(receipt))
    .filter((receipt) => receipt.evolutionRunId === descriptor.runId)
    .map(clone);
}

function normalizePilot(value, descriptor) {
  if (value === null) return null;
  record(value, "pilot source result");
  digest(value.descriptorDigest, "pilot descriptor digest");
  digest(value.candidateDigest, "pilot candidate digest");
  if (
    !["candidate", "shadow", "canary", "active", "rolled-back"].includes(
      value.stage,
    ) ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    typeof value.killSwitch !== "boolean" ||
    typeof value.reconciliationRequired !== "boolean" ||
    typeof value.cohort?.id !== "string" ||
    value.cohort.id.length < 1 ||
    value.cohort.id.length > 256
  ) {
    throw new Error("pilot source result is invalid");
  }
  const review = descriptor.reviewPacketDigests;
  if (review.size > 0 && !review.has(value.reviewPacketDigest)) {
    throw new Error("pilot is not bound to a Workbench review packet");
  }
  return clone(value);
}

export function createEvolutionWorkbenchDataSource({
  tenantId: tenantIdInput,
  runId: runIdInput,
  skillName: skillNameInput,
  runAdapter,
  reviewAdapter,
  transitionAdapter,
  invocationReceiptSource = null,
  pilotSource = null,
} = {}) {
  const tenantId = identifier(tenantIdInput, "tenantId");
  const runId = identifier(runIdInput, "runId");
  const skillName = identifier(skillNameInput, "skillName");
  const loadRun = capture(runAdapter, "load", "runAdapter");
  const listReviews = capture(reviewAdapter, "listReviews", "reviewAdapter");
  const listTransitions = capture(
    transitionAdapter,
    "list",
    "transitionAdapter",
  );
  const listInvocations =
    invocationReceiptSource === null
      ? () => []
      : capture(invocationReceiptSource, "list", "invocationReceiptSource");
  const readPilot =
    pilotSource === null
      ? () => null
      : capture(pilotSource, "view", "pilotSource");
  const source = Object.freeze({
    tenantId,
    runId,
    skillName,
    async load() {
      const run = normalizeRun(await loadRun(), { tenantId, runId });
      const reviews = normalizeReviews(await listReviews(), {
        tenantId,
        skillName,
      });
      for (const { packet } of reviews) {
        const recorded = run.projection.registry.candidates[packet.candidateId];
        if (
          recorded?.digest !== packet.candidateContentDigest ||
          typeof recorded.artifactRef !== "string"
        ) {
          throw new Error(
            "review packet candidate is absent from the authenticated EvolutionRun",
          );
        }
      }
      const reviewPacketDigests = new Set(
        reviews.map(({ packet }) => packet.packetDigest),
      );
      const transitions = normalizeTransitions(await listTransitions(), {
        tenantId,
        skillName,
      });
      for (const { request } of transitions) {
        if (!run.projection.registry.candidates[request.candidateId]) {
          throw new Error(
            "registry transition candidate is absent from the authenticated EvolutionRun",
          );
        }
      }
      return deepFreeze({
        run,
        reviews,
        transitions,
        invocations: normalizeInvocations(await listInvocations(), { runId }),
        pilot: normalizePilot(await readPilot(), { reviewPacketDigests }),
      });
    },
  });
  DATA_SOURCES.add(source);
  return source;
}

export function isEvolutionWorkbenchDataSource(value) {
  return DATA_SOURCES.has(value);
}

function runTimeline(events) {
  return events.map((event) => ({
    id: `run:${event.eventId}`,
    sequence: event.sequence,
    phase: event.type,
    status: "committed",
    subjectId: event.subjectId,
    digest: event.payloadDigest,
    artifactRef: event.artifactRef,
    occurredAt: null,
    source: "evolution-run",
    detail: clone(event.data),
  }));
}

function reviewTimeline(reviews) {
  const rows = [];
  for (const { packet, decision, status } of reviews) {
    rows.push({
      id: `review:${packet.packetDigest}`,
      sequence: null,
      phase: "approval-requested",
      status,
      subjectId: packet.candidateId,
      digest: packet.packetDigest,
      artifactRef: null,
      occurredAt: null,
      source: "promotion-review",
      detail: {
        requiredHumanQuorum: packet.requiredHumanQuorum,
        contentRiskDigest: packet.contentRisk.contentRiskDigest,
      },
    });
    if (decision) {
      rows.push({
        id: `decision:${decision.receiptDigest}`,
        sequence: null,
        phase: decision.decision,
        status: decision.decision,
        subjectId: packet.candidateId,
        digest: decision.receiptDigest,
        artifactRef: null,
        occurredAt: decision.decidedAt,
        source: "promotion-review",
        detail: {
          packetDigest: packet.packetDigest,
          reason: decision.reason,
          reviewerIds: [...decision.reviewerIds],
        },
      });
    }
  }
  return rows;
}

function transitionTimeline(transitions) {
  const rows = [];
  for (const entry of transitions) {
    rows.push({
      id: `transition:${entry.request.requestDigest}`,
      sequence: entry.requestEventSequence,
      phase: "promotion-requested",
      status: entry.status,
      subjectId: entry.request.candidateId,
      digest: entry.request.requestDigest,
      artifactRef: null,
      occurredAt: entry.request.effectiveAt,
      source: "registry-transition",
      detail: { requestId: entry.request.requestId },
    });
    for (const attempt of entry.attempts) {
      rows.push({
        id: `attempt:${attempt.attemptDigest}`,
        sequence: entry.requestEventSequence,
        phase: "promotion-attempted",
        status: entry.status,
        subjectId: attempt.candidateId,
        digest: attempt.attemptDigest,
        artifactRef: null,
        occurredAt: attempt.createdAt,
        source: "registry-transition",
        detail: {
          ordinal: attempt.ordinal,
          requestDigest: attempt.requestDigest,
        },
      });
    }
    if (entry.settlement) {
      rows.push({
        id: `settlement:${entry.settlement.settlementDigest}`,
        sequence: entry.requestEventSequence,
        phase: entry.settlement.outcome || "promotion-settled",
        status: "committed",
        subjectId: entry.settlement.candidateId,
        digest: entry.settlement.settlementDigest,
        artifactRef: null,
        occurredAt: entry.settlement.settledAt,
        source: "registry-transition",
        detail: {
          requestDigest: entry.settlement.requestDigest,
          activeReleaseDigest: entry.settlement.activeReleaseDigest,
        },
      });
    }
  }
  return rows;
}

function timelineOrder(left, right) {
  const leftTime = left.occurredAt ? Date.parse(left.occurredAt) : NaN;
  const rightTime = right.occurredAt ? Date.parse(right.occurredAt) : NaN;
  if (
    Number.isFinite(leftTime) &&
    Number.isFinite(rightTime) &&
    leftTime !== rightTime
  ) {
    return leftTime - rightTime;
  }
  if (
    left.sequence !== null &&
    right.sequence !== null &&
    left.sequence !== right.sequence
  ) {
    return left.sequence - right.sequence;
  }
  if (Number.isFinite(leftTime) !== Number.isFinite(rightTime)) {
    return Number.isFinite(leftTime) ? 1 : -1;
  }
  return left.id.localeCompare(right.id);
}

function candidateView(review, invocations, activeCandidateIds) {
  const { packet, decision, status } = review;
  const receipts = invocations.filter((receipt) =>
    receipt.selectedSkillDigests.includes(packet.candidateContentDigest),
  );
  const completed = receipts.filter(
    ({ executionStatus }) => executionStatus === "completed",
  ).length;
  const totalCostUsd = receipts.reduce(
    (sum, receipt) => sum + receipt.tokenCostLatency.costUsd,
    0,
  );
  return {
    candidateId: packet.candidateId,
    candidateContentDigest: packet.candidateContentDigest,
    packetDigest: packet.packetDigest,
    status,
    decision: decision
      ? {
          receiptDigest: decision.receiptDigest,
          decision: decision.decision,
          reason: decision.reason,
          reviewerIds: [...decision.reviewerIds],
          decidedAt: decision.decidedAt,
        }
      : null,
    why: {
      evidence: clone(packet.evidenceSummary),
      parentContentDigest: packet.parentContentDigest,
      baselineReleaseDigest: packet.baselineReleaseDigest,
    },
    changes: {
      unifiedDiff: packet.candidateDiff,
      candidateDiffDigest: packet.candidateDiffDigest,
      capabilities: clone(packet.capabilityDiff),
      contentRisk: clone(packet.contentRisk),
    },
    validation: {
      matrixEvalId: packet.evaluation.matrixEvalId,
      matrixReceiptDigest: packet.evaluation.matrixReceiptDigest,
      decisionCommitmentDigest: packet.evaluation.decisionCommitmentDigest,
      targetRuntimes: [...packet.targetRuntimes],
    },
    actualUsage: {
      active: activeCandidateIds.has(packet.candidateId),
      receiptCount: receipts.length,
      completed,
      failedOrBlocked: receipts.length - completed,
      totalCostUsd,
      sessionPins: receipts.map((receipt) => ({
        receiptId: receipt.receiptId,
        receiptDigest: receipt.receiptDigest,
        traceId: receipt.traceId,
        trajectorySegmentId: receipt.trajectorySegmentId,
        selectedSkillDigests: [...receipt.selectedSkillDigests],
        providerModelVersion: receipt.providerModelVersion,
        toolSetDigest: receipt.toolSetDigest,
        osSandboxPermissionPolicyDigest:
          receipt.osSandboxPermissionPolicyDigest,
        executionStatus: receipt.executionStatus,
      })),
    },
  };
}

function conflictsFor(candidates, transitions, pilot) {
  const conflicts = [];
  for (const candidate of candidates) {
    for (const findingId of candidate.changes.contentRisk.findingIds) {
      conflicts.push({
        type: "content-risk",
        candidateId: candidate.candidateId,
        packetDigest: candidate.packetDigest,
        reason: findingId,
      });
    }
    for (const capability of candidate.changes.capabilities.highRiskAdded) {
      conflicts.push({
        type: "high-risk-capability",
        candidateId: candidate.candidateId,
        packetDigest: candidate.packetDigest,
        reason: capability,
      });
    }
    if (candidate.status === "expired") {
      conflicts.push({
        type: "expired-review",
        candidateId: candidate.candidateId,
        packetDigest: candidate.packetDigest,
        reason: "human review expired before consumption",
      });
    }
  }
  for (const transition of transitions.filter(
    ({ status }) => status === "pending",
  )) {
    conflicts.push({
      type: "pending-transition",
      candidateId: transition.request.candidateId,
      packetDigest: transition.request.receipts?.reviewReceiptDigest || null,
      reason: "registry transition has not reached a durable settlement",
    });
  }
  if (pilot?.reconciliationRequired) {
    conflicts.push({
      type: "pilot-reconciliation",
      candidateId: pilot.candidateDigest,
      packetDigest: pilot.reviewPacketDigest,
      reason: "pilot rollout authority reconciliation is required",
    });
  }
  return conflicts;
}

export async function buildEvolutionWorkbenchProjection(
  source,
  { observedAt = new Date().toISOString() } = {},
) {
  if (!DATA_SOURCES.has(source)) {
    throw new TypeError(
      "a branded Evolution Workbench data source is required",
    );
  }
  normalizeTime(observedAt, "observedAt");
  const data = await source.load();
  const activeReleaseId = data.run.projection.registry.activeReleaseId;
  const activeCandidateIds = new Set(
    data.transitions
      .filter(
        ({ status, settlement }) =>
          status === "committed" &&
          settlement?.activeReleaseDigest === activeReleaseId,
      )
      .map(({ settlement }) => settlement.candidateId),
  );
  const candidates = data.reviews.map((review) =>
    candidateView(review, data.invocations, activeCandidateIds),
  );
  const timeline = [
    ...runTimeline(data.run.events),
    ...reviewTimeline(data.reviews),
    ...transitionTimeline(data.transitions),
  ].sort(timelineOrder);
  const conflicts = conflictsFor(candidates, data.transitions, data.pilot);
  const core = {
    schema: EVOLUTION_WORKBENCH_PROJECTION_SCHEMA,
    tenantId: source.tenantId,
    runId: source.runId,
    skillName: source.skillName,
    observedAt,
    run: {
      status: data.run.projection.status,
      projectionDigest: data.run.projection.projectionDigest,
      eventRoot: data.run.projection.eventRoot,
      eventCount: data.run.projection.eventCount,
      wikiRevision: data.run.projection.wiki.revision,
      wikiRevisionDigest: data.run.projection.wiki.revisionDigest,
      activeReleaseId,
      lastKnownGoodReleaseId:
        data.run.projection.registry.lastKnownGoodReleaseId,
    },
    summary: {
      candidateCount: candidates.length,
      pendingReviewCount: candidates.filter(
        ({ status }) => status === "pending",
      ).length,
      approvedCount: candidates.filter(({ status }) => status === "approved")
        .length,
      rejectedCount: candidates.filter(({ status }) => status === "rejected")
        .length,
      transitionCount: data.transitions.length,
      invocationCount: data.invocations.length,
      conflictCount: conflicts.length,
    },
    candidates,
    timeline,
    conflicts,
    pilot: data.pilot,
  };
  return deepFreeze({
    ...core,
    projectionDigest: hash(EVOLUTION_WORKBENCH_PROJECTION_SCHEMA, core),
  });
}

export function filterEvolutionWorkbenchProjection(
  projection,
  { query = "", status = null, offset = 0, limit = 100 } = {},
) {
  if (
    projection?.schema !== EVOLUTION_WORKBENCH_PROJECTION_SCHEMA ||
    projection.projectionDigest !==
      hash(
        EVOLUTION_WORKBENCH_PROJECTION_SCHEMA,
        Object.fromEntries(
          Object.entries(projection).filter(
            ([key]) => key !== "projectionDigest",
          ),
        ),
      )
  ) {
    throw new TypeError(
      "a verified Evolution Workbench projection is required",
    );
  }
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 500
  ) {
    throw new TypeError("Workbench pagination is out of range");
  }
  const needle = String(query).trim().toLowerCase();
  const allowedStatus = new Set(["pending", "approved", "rejected", "expired"]);
  if (status !== null && !allowedStatus.has(status)) {
    throw new TypeError("Workbench status filter is invalid");
  }
  const matches = projection.candidates.filter((candidate) => {
    if (status !== null && candidate.status !== status) return false;
    if (!needle) return true;
    const searchable = [
      candidate.candidateId,
      candidate.candidateContentDigest,
      candidate.packetDigest,
      candidate.decision?.reason,
      ...candidate.validation.targetRuntimes,
      ...candidate.changes.capabilities.added,
      ...candidate.changes.capabilities.removed,
      ...candidate.why.evidence.flatMap(({ ref, digest: value }) => [
        ref,
        value,
      ]),
    ]
      .filter(Boolean)
      .join("\n")
      .toLowerCase();
    return searchable.includes(needle);
  });
  const governance = {
    runStatus: projection.run.status,
    activeReleaseId: projection.run.activeReleaseId,
    lastKnownGoodReleaseId: projection.run.lastKnownGoodReleaseId,
    conflictCount: projection.summary.conflictCount,
    pilot:
      projection.pilot === null
        ? null
        : {
            stage: projection.pilot.stage,
            revision: projection.pilot.revision,
            killSwitch: projection.pilot.killSwitch,
            reconciliationRequired: projection.pilot.reconciliationRequired,
          },
  };
  return deepFreeze({
    projectionDigest: projection.projectionDigest,
    governance: clone(governance),
    total: matches.length,
    offset,
    limit,
    hasMore: offset + limit < matches.length,
    candidates: clone(matches.slice(offset, offset + limit)),
  });
}

export function buildEvolutionWorkbenchBatchPlan(
  projection,
  { packetDigests, decision, reason, requestedBy } = {},
) {
  filterEvolutionWorkbenchProjection(projection, { limit: 1 });
  if (
    !Array.isArray(packetDigests) ||
    packetDigests.length < 1 ||
    packetDigests.length > EVOLUTION_WORKBENCH_MAX_BATCH ||
    new Set(packetDigests).size !== packetDigests.length ||
    !["approve", "reject"].includes(decision) ||
    typeof reason !== "string" ||
    reason.trim() !== reason ||
    reason.length < 1 ||
    reason.length > 2048
  ) {
    throw new TypeError("Workbench batch governance request is invalid");
  }
  identifier(requestedBy, "requestedBy");
  const pending = new Map(
    projection.candidates
      .filter(({ status }) => status === "pending")
      .map((candidate) => [candidate.packetDigest, candidate]),
  );
  for (const value of packetDigests) {
    digest(value, "packet digest");
    if (!pending.has(value)) {
      throw new Error(
        "batch governance can target only pending review packets",
      );
    }
  }
  const core = {
    schema: EVOLUTION_WORKBENCH_BATCH_PLAN_SCHEMA,
    tenantId: projection.tenantId,
    runId: projection.runId,
    skillName: projection.skillName,
    sourceProjectionDigest: projection.projectionDigest,
    packetDigests: [...packetDigests].sort(),
    decision,
    reason,
    requestedBy,
  };
  return deepFreeze({
    ...core,
    planDigest: hash(EVOLUTION_WORKBENCH_BATCH_PLAN_SCHEMA, core),
  });
}

import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";

import {
  isProgressiveCanaryGateAuthority,
  nextProgressiveCanaryStage,
  verifyProgressiveCanaryPlan,
} from "./statistical-progressive-canary.js";

export const CONTROLLED_SKILL_PILOT_SCHEMA =
  "chainlesschain.controlled-skill-production-pilot/v1";
export const CONTROLLED_SKILL_PILOT_STATE_SCHEMA =
  "chainlesschain.controlled-skill-production-pilot-state/v1";
export const CONTROLLED_SKILL_PILOT_PROGRESSIVE_STATE_SCHEMA =
  "chainlesschain.controlled-skill-production-pilot-state/v2";
export const CONTROLLED_SKILL_PILOT_EVENT_SCHEMA =
  "chainlesschain.controlled-skill-production-pilot-event/v1";

export const CONTROLLED_SKILL_PILOT_STAGE = Object.freeze({
  CANDIDATE: "candidate",
  SHADOW: "shadow",
  CANARY: "canary",
  ACTIVE_PROBATION: "active-probation",
  ACTIVE: "active",
  ROLLED_BACK: "rolled-back",
});

export const CONTROLLED_SKILL_PILOT_ERROR = Object.freeze({
  INVALID: "CC_CONTROLLED_SKILL_PILOT_INVALID",
  NOT_OPTED_IN: "CC_CONTROLLED_SKILL_PILOT_NOT_OPTED_IN",
  REVIEW_REQUIRED: "CC_CONTROLLED_SKILL_PILOT_REVIEW_REQUIRED",
  GATE_FAILED: "CC_CONTROLLED_SKILL_PILOT_GATE_FAILED",
  KILL_SWITCH: "CC_CONTROLLED_SKILL_PILOT_KILL_SWITCH",
  ACTIVE_DRIFT: "CC_CONTROLLED_SKILL_PILOT_ACTIVE_DRIFT",
  PERSISTENCE_FAILED: "CC_CONTROLLED_SKILL_PILOT_PERSISTENCE_FAILED",
  AUTHORITY_FAILED: "CC_CONTROLLED_SKILL_PILOT_AUTHORITY_FAILED",
});

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;
const STAGES = new Set(Object.values(CONTROLLED_SKILL_PILOT_STAGE));
const FORWARD = new Map([
  [CONTROLLED_SKILL_PILOT_STAGE.CANDIDATE, CONTROLLED_SKILL_PILOT_STAGE.SHADOW],
  [CONTROLLED_SKILL_PILOT_STAGE.SHADOW, CONTROLLED_SKILL_PILOT_STAGE.CANARY],
  [CONTROLLED_SKILL_PILOT_STAGE.CANARY, CONTROLLED_SKILL_PILOT_STAGE.ACTIVE],
]);
const CONTROLLED_PILOT_ROLLBACK = CONTROLLED_SKILL_PILOT_STAGE.ROLLED_BACK;

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

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function plain(value, label) {
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

function text(value, label) {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    !SAFE_ID.test(value)
  ) {
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

function integer(
  value,
  label,
  { min = 0, max = Number.MAX_SAFE_INTEGER } = {},
) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new TypeError(`${label} is out of range`);
  }
  return value;
}

function finite(value, label, { min = -Infinity, max = Infinity } = {}) {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new TypeError(`${label} is out of range`);
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
  plain(input, "descriptor");
  const cohort = plain(input.cohort, "descriptor.cohort");
  const observation = plain(input.observation, "descriptor.observation");
  const thresholds = plain(input.thresholds, "descriptor.thresholds");
  if (cohort.optInRequired !== true) {
    throw new TypeError("production pilot cohort must require explicit opt-in");
  }
  const normalized = {
    schema: CONTROLLED_SKILL_PILOT_SCHEMA,
    tenantId: text(input.tenantId, "descriptor.tenantId"),
    pilotId: text(input.pilotId, "descriptor.pilotId"),
    skillName: text(input.skillName, "descriptor.skillName"),
    candidateDigest: digest(
      input.candidateDigest,
      "descriptor.candidateDigest",
    ),
    baselineDigest: digest(input.baselineDigest, "descriptor.baselineDigest"),
    evalReceiptDigest: digest(
      input.evalReceiptDigest,
      "descriptor.evalReceiptDigest",
    ),
    whyEvidenceDigest: digest(
      input.whyEvidenceDigest,
      "descriptor.whyEvidenceDigest",
    ),
    candidateDiffDigest: digest(
      input.candidateDiffDigest,
      "descriptor.candidateDiffDigest",
    ),
    permissionDiffDigest: digest(
      input.permissionDiffDigest,
      "descriptor.permissionDiffDigest",
    ),
    beforeEvaluationDigest: digest(
      input.beforeEvaluationDigest,
      "descriptor.beforeEvaluationDigest",
    ),
    afterEvaluationDigest: digest(
      input.afterEvaluationDigest,
      "descriptor.afterEvaluationDigest",
    ),
    reviewPacketDigest: digest(
      input.reviewPacketDigest,
      "descriptor.reviewPacketDigest",
    ),
    cohort: {
      id: text(cohort.id, "descriptor.cohort.id"),
      optInRequired: true,
      maxSubjects: integer(
        cohort.maxSubjects,
        "descriptor.cohort.maxSubjects",
        {
          min: 1,
          max: 10_000,
        },
      ),
      canaryPercent: finite(
        cohort.canaryPercent,
        "descriptor.cohort.canaryPercent",
        { min: 0.01, max: 100 },
      ),
    },
    observation: {
      minSamples: integer(
        observation.minSamples,
        "descriptor.observation.minSamples",
        { min: 1, max: 10_000 },
      ),
      minWindowMs: integer(
        observation.minWindowMs,
        "descriptor.observation.minWindowMs",
        { min: 1 },
      ),
      maxWindowMs: integer(
        observation.maxWindowMs,
        "descriptor.observation.maxWindowMs",
        { min: 1 },
      ),
    },
    thresholds: {
      minAdoptionRate: finite(
        thresholds.minAdoptionRate,
        "descriptor.thresholds.minAdoptionRate",
        { min: 0, max: 1 },
      ),
      minSuccessDelta: finite(
        thresholds.minSuccessDelta,
        "descriptor.thresholds.minSuccessDelta",
        { min: -1, max: 1 },
      ),
      maxCostDelta: finite(
        thresholds.maxCostDelta,
        "descriptor.thresholds.maxCostDelta",
      ),
      maxUserRevisionRate: finite(
        thresholds.maxUserRevisionRate,
        "descriptor.thresholds.maxUserRevisionRate",
        { min: 0, max: 1 },
      ),
      maxMisPromotionRate: finite(
        thresholds.maxMisPromotionRate,
        "descriptor.thresholds.maxMisPromotionRate",
        { min: 0, max: 1 },
      ),
      maxRollbackRate: finite(
        thresholds.maxRollbackRate,
        "descriptor.thresholds.maxRollbackRate",
        { min: 0, max: 1 },
      ),
      maxSecurityEvents: integer(
        thresholds.maxSecurityEvents,
        "descriptor.thresholds.maxSecurityEvents",
        { max: 10_000 },
      ),
    },
  };
  if (normalized.observation.minSamples > normalized.cohort.maxSubjects) {
    throw new TypeError("minimum samples exceed the bounded cohort");
  }
  const canarySubjectLimit = Math.max(
    1,
    Math.ceil(
      (normalized.cohort.maxSubjects * normalized.cohort.canaryPercent) / 100,
    ),
  );
  if (normalized.observation.minSamples > canarySubjectLimit) {
    throw new TypeError("minimum samples exceed the bounded canary cohort");
  }
  if (normalized.observation.maxWindowMs < normalized.observation.minWindowMs) {
    throw new TypeError("maximum observation window is shorter than minimum");
  }
  return deepFreeze(normalized);
}

function emptyState(descriptorDigest, progressive = null) {
  const state = {
    schema: progressive
      ? CONTROLLED_SKILL_PILOT_PROGRESSIVE_STATE_SCHEMA
      : CONTROLLED_SKILL_PILOT_STATE_SCHEMA,
    descriptorDigest,
    revision: 0,
    stage: CONTROLLED_SKILL_PILOT_STAGE.CANDIDATE,
    stageStartedAt: null,
    activeStateDigest: null,
    reviewReceiptDigest: null,
    killSwitch: false,
    observations: [],
    pendingTransition: null,
    lastTransitionReceiptDigest: null,
  };
  if (progressive) {
    state.progressivePlanDigest = progressive.plan.planDigest;
    state.progressiveStepId = null;
    state.progressiveGateReceiptDigests = [];
  }
  return state;
}

function progressiveStateIsCoherent(state, progressive) {
  if (!progressive) return true;
  const digests = state.progressiveGateReceiptDigests;
  if (
    !Array.isArray(digests) ||
    digests.length > progressive.plan.steps.length ||
    new Set(digests).size !== digests.length
  ) {
    return false;
  }
  const effectiveStage = state.pendingTransition?.request?.to ?? state.stage;
  if (effectiveStage === CONTROLLED_SKILL_PILOT_STAGE.ROLLED_BACK) {
    return (
      state.progressiveStepId === null ||
      progressive.plan.steps.some(
        ({ id: stepId }) => stepId === state.progressiveStepId,
      )
    );
  }
  if (effectiveStage === CONTROLLED_SKILL_PILOT_STAGE.CANDIDATE) {
    return state.progressiveStepId === null && digests.length === 0;
  }
  if (effectiveStage === CONTROLLED_SKILL_PILOT_STAGE.ACTIVE) {
    return (
      state.progressiveStepId === null &&
      digests.length === progressive.plan.steps.length
    );
  }
  const index = progressive.plan.steps.findIndex(
    ({ id: stepId, stage }) =>
      stepId === state.progressiveStepId && stage === effectiveStage,
  );
  return index >= 0 && digests.length === index;
}

function normalizeRestore(input, descriptorDigest, progressive) {
  plain(input, "pilot restore");
  const state = plain(input.state, "pilot restore.state");
  if (
    input.authenticated !== true ||
    input.durable !== true ||
    input.descriptorDigest !== descriptorDigest ||
    input.stateDigest !== hash(state) ||
    state.schema !==
      (progressive
        ? CONTROLLED_SKILL_PILOT_PROGRESSIVE_STATE_SCHEMA
        : CONTROLLED_SKILL_PILOT_STATE_SCHEMA) ||
    state.descriptorDigest !== descriptorDigest ||
    !STAGES.has(state.stage) ||
    !Number.isSafeInteger(state.revision) ||
    state.revision < 0 ||
    !Array.isArray(state.observations) ||
    (progressive === null
      ? state.progressivePlanDigest !== undefined ||
        state.progressiveStepId !== undefined ||
        state.progressiveGateReceiptDigests !== undefined
      : state.progressivePlanDigest !== progressive.plan.planDigest ||
        (state.progressiveStepId !== null &&
          !progressive.plan.steps.some(
            ({ id: stepId }) => stepId === state.progressiveStepId,
          )) ||
        !Array.isArray(state.progressiveGateReceiptDigests) ||
        state.progressiveGateReceiptDigests.some(
          (value) => !DIGEST.test(value),
        )) ||
    (state.pendingTransition !== null &&
      (!state.pendingTransition ||
        typeof state.pendingTransition !== "object" ||
        state.pendingTransition.requestDigest !==
          hash(state.pendingTransition.request) ||
        state.pendingTransition.request?.from !== state.stage)) ||
    !progressiveStateIsCoherent(state, progressive)
  ) {
    fail(
      CONTROLLED_SKILL_PILOT_ERROR.PERSISTENCE_FAILED,
      "pilot restore is unauthenticated or corrupt",
    );
  }
  return clone(state);
}

function normalizeProgressiveCanary(input, descriptor) {
  if (input == null) return null;
  plain(input, "progressive Canary configuration");
  if (
    Reflect.ownKeys(input).length !== 2 ||
    !Object.hasOwn(input, "plan") ||
    !Object.hasOwn(input, "gateAuthority")
  ) {
    throw new TypeError("progressive Canary configuration is not exact");
  }
  const plan = verifyProgressiveCanaryPlan(input.plan);
  if (!isProgressiveCanaryGateAuthority(input.gateAuthority)) {
    throw new TypeError(
      "a branded progressive Canary gate authority is required",
    );
  }
  if (
    plan.tenantId !== descriptor.tenantId ||
    plan.pilotId !== descriptor.pilotId ||
    plan.skillName !== descriptor.skillName ||
    plan.candidateDigest !== descriptor.candidateDigest ||
    plan.baselineDigest !== descriptor.baselineDigest ||
    input.gateAuthority.planDigest !== plan.planDigest ||
    input.gateAuthority.tenantId !== plan.tenantId ||
    input.gateAuthority.pilotId !== plan.pilotId
  ) {
    throw new TypeError("progressive Canary plan is not bound to this pilot");
  }
  return Object.freeze({ plan, gateAuthority: input.gateAuthority });
}

function normalizeApproval(value, descriptor, descriptorDigest) {
  plain(value, "review approval");
  if (
    value.authenticated !== true ||
    value.durable !== true ||
    value.automated !== false ||
    value.tenantId !== descriptor.tenantId ||
    value.pilotId !== descriptor.pilotId ||
    value.packetDigest !== descriptor.reviewPacketDigest ||
    value.descriptorDigest !== descriptorDigest ||
    value.decision !== "approved" ||
    !DIGEST.test(value.receiptDigest ?? "")
  ) {
    fail(
      CONTROLLED_SKILL_PILOT_ERROR.REVIEW_REQUIRED,
      "a durable non-automated exact-pilot approval is required",
    );
  }
  return value.receiptDigest;
}

function normalizeObservation(value, descriptor, stage) {
  plain(value, "observation receipt");
  if (
    value.authenticated !== true ||
    value.durable !== true ||
    value.tenantId !== descriptor.tenantId ||
    value.pilotId !== descriptor.pilotId ||
    value.cohortId !== descriptor.cohort.id ||
    value.stage !== stage ||
    !DIGEST.test(value.subjectDigest ?? "") ||
    !DIGEST.test(value.assignmentReceiptDigest ?? "") ||
    !DIGEST.test(value.receiptDigest ?? "") ||
    typeof value.optedIn !== "boolean" ||
    typeof value.adopted !== "boolean" ||
    typeof value.baselineSuccess !== "boolean" ||
    typeof value.candidateSuccess !== "boolean" ||
    typeof value.userRevised !== "boolean" ||
    typeof value.misPromotion !== "boolean" ||
    typeof value.rolledBack !== "boolean" ||
    !Number.isFinite(value.baselineCostUsd) ||
    value.baselineCostUsd < 0 ||
    !Number.isFinite(value.candidateCostUsd) ||
    value.candidateCostUsd < 0 ||
    !Number.isSafeInteger(value.securityEvents) ||
    value.securityEvents < 0 ||
    !Number.isSafeInteger(value.observedAt)
  ) {
    fail(
      CONTROLLED_SKILL_PILOT_ERROR.INVALID,
      "observation receipt is incomplete or outside the fixed pilot",
    );
  }
  if (!value.optedIn) {
    fail(
      CONTROLLED_SKILL_PILOT_ERROR.NOT_OPTED_IN,
      "non-opted-in traffic cannot enter a production pilot",
    );
  }
  return deepFreeze({
    stage,
    subjectDigest: value.subjectDigest,
    assignmentReceiptDigest: value.assignmentReceiptDigest,
    receiptDigest: value.receiptDigest,
    adopted: value.adopted,
    baselineSuccess: value.baselineSuccess,
    candidateSuccess: value.candidateSuccess,
    baselineCostUsd: value.baselineCostUsd,
    candidateCostUsd: value.candidateCostUsd,
    userRevised: value.userRevised,
    misPromotion: value.misPromotion,
    rolledBack: value.rolledBack,
    securityEvents: value.securityEvents,
    observedAt: value.observedAt,
  });
}

function metricsFor(observations) {
  const samples = observations.length;
  if (samples === 0) {
    return deepFreeze({
      samples: 0,
      adoptionRate: 0,
      successDelta: 0,
      costDelta: 0,
      userRevisionRate: 0,
      misPromotionRate: 0,
      rollbackRate: 0,
      securityEvents: 0,
    });
  }
  const sum = (selector) =>
    observations.reduce((n, row) => n + selector(row), 0);
  return deepFreeze({
    samples,
    adoptionRate: sum((row) => Number(row.adopted)) / samples,
    successDelta:
      (sum((row) => Number(row.candidateSuccess)) -
        sum((row) => Number(row.baselineSuccess))) /
      samples,
    costDelta:
      (sum((row) => row.candidateCostUsd) - sum((row) => row.baselineCostUsd)) /
      samples,
    userRevisionRate: sum((row) => Number(row.userRevised)) / samples,
    misPromotionRate: sum((row) => Number(row.misPromotion)) / samples,
    rollbackRate: sum((row) => Number(row.rolledBack)) / samples,
    securityEvents: sum((row) => row.securityEvents),
  });
}

function gateFailures(descriptor, metrics, elapsedMs) {
  const failures = [];
  if (metrics.samples < descriptor.observation.minSamples)
    failures.push("min_samples");
  if (elapsedMs < descriptor.observation.minWindowMs)
    failures.push("min_window");
  if (elapsedMs > descriptor.observation.maxWindowMs)
    failures.push("max_window");
  const t = descriptor.thresholds;
  if (metrics.adoptionRate < t.minAdoptionRate) failures.push("adoption_rate");
  if (metrics.successDelta < t.minSuccessDelta) failures.push("success_delta");
  if (metrics.costDelta > t.maxCostDelta) failures.push("cost_delta");
  if (metrics.userRevisionRate > t.maxUserRevisionRate)
    failures.push("user_revision_rate");
  if (metrics.misPromotionRate > t.maxMisPromotionRate)
    failures.push("mis_promotion_rate");
  if (metrics.rollbackRate > t.maxRollbackRate) failures.push("rollback_rate");
  if (metrics.securityEvents > t.maxSecurityEvents)
    failures.push("security_events");
  return failures;
}

export class ControlledSkillProductionPilot {
  constructor({
    descriptor: input,
    ports,
    now = Date.now,
    restore = null,
    progressiveCanary = null,
  } = {}) {
    this.descriptor = normalizeDescriptor(input);
    this.descriptorDigest = hash(this.descriptor);
    this._progressiveCanary = normalizeProgressiveCanary(
      progressiveCanary,
      this.descriptor,
    );
    this._now = typeof now === "function" ? now : Date.now;
    this._readActiveState = capture(ports, "readActiveState");
    this._verifyApproval = capture(ports, "verifyApproval");
    this._verifyObservation = capture(ports, "verifyObservation");
    this._verifyRestore = capture(ports, "verifyRestore");
    this._transitionStage = capture(ports, "transitionStage");
    this._commitState = capture(ports, "commitState");
    this._state = restore
      ? normalizeRestore(
          this._verifyRestore({
            restore: clone(restore),
            descriptor: this.descriptor,
            descriptorDigest: this.descriptorDigest,
          }),
          this.descriptorDigest,
          this._progressiveCanary,
        )
      : emptyState(this.descriptorDigest, this._progressiveCanary);
  }

  async start({ optedIn, tenantId, cohortId } = {}) {
    if (
      optedIn !== true ||
      tenantId !== this.descriptor.tenantId ||
      cohortId !== this.descriptor.cohort.id
    ) {
      fail(
        CONTROLLED_SKILL_PILOT_ERROR.NOT_OPTED_IN,
        "pilot start requires exact tenant/cohort opt-in",
      );
    }
    if (this._state.activeStateDigest !== null) return this.view();
    const now = this._timestamp();
    const next = clone(this._state);
    next.activeStateDigest = hash(await this._readActiveState());
    next.stageStartedAt = now;
    await this._commit(next, "pilot.started", { optedIn: true });
    return this.view();
  }

  async approveShadow(input) {
    this._started();
    this._noPending();
    if (this._state.stage !== CONTROLLED_SKILL_PILOT_STAGE.CANDIDATE) {
      fail(
        CONTROLLED_SKILL_PILOT_ERROR.INVALID,
        "pilot is not awaiting review",
      );
    }
    const reviewReceiptDigest = normalizeApproval(
      await this._verifyApproval({
        ...clone(input),
        descriptor: this.descriptor,
        descriptorDigest: this.descriptorDigest,
      }),
      this.descriptor,
      this.descriptorDigest,
    );
    await this._assertActiveUnchanged();
    const next = clone(this._state);
    next.reviewReceiptDigest = reviewReceiptDigest;
    if (this._progressiveCanary) {
      next.progressiveStepId = this._progressiveCanary.plan.steps[0].id;
    }
    await this._advance(
      next,
      CONTROLLED_SKILL_PILOT_STAGE.SHADOW,
      {
        reviewReceiptDigest,
        ...(this._progressiveCanary
          ? {
              progressivePlanDigest: this._progressiveCanary.plan.planDigest,
              progressiveStepId: next.progressiveStepId,
            }
          : {}),
      },
      { progressive: this._progressiveCanary !== null },
    );
    return this.view();
  }

  async recordObservation(input) {
    this._started();
    this._noPending();
    if (this._progressiveCanary) {
      fail(
        CONTROLLED_SKILL_PILOT_ERROR.INVALID,
        "progressive Canary observations must enter the gate authority",
      );
    }
    if (
      ![
        CONTROLLED_SKILL_PILOT_STAGE.SHADOW,
        CONTROLLED_SKILL_PILOT_STAGE.CANARY,
      ].includes(this._state.stage)
    ) {
      fail(
        CONTROLLED_SKILL_PILOT_ERROR.INVALID,
        "observations are accepted only during shadow or canary",
      );
    }
    if (this._state.killSwitch) {
      fail(
        CONTROLLED_SKILL_PILOT_ERROR.KILL_SWITCH,
        "pilot kill switch is set",
      );
    }
    const observation = normalizeObservation(
      await this._verifyObservation({
        ...clone(input),
        descriptor: this.descriptor,
        descriptorDigest: this.descriptorDigest,
        stage: this._state.stage,
      }),
      this.descriptor,
      this._state.stage,
    );
    const now = this._timestamp();
    if (
      observation.observedAt < this._state.stageStartedAt ||
      observation.observedAt > now
    ) {
      fail(
        CONTROLLED_SKILL_PILOT_ERROR.INVALID,
        "observation timestamp is outside the current pilot window",
      );
    }
    if (this._state.stage === CONTROLLED_SKILL_PILOT_STAGE.CANARY) {
      const shadowAssignment = this._state.observations.find(
        (row) =>
          row.stage === CONTROLLED_SKILL_PILOT_STAGE.SHADOW &&
          row.subjectDigest === observation.subjectDigest,
      );
      if (
        !shadowAssignment ||
        shadowAssignment.assignmentReceiptDigest !==
          observation.assignmentReceiptDigest
      ) {
        fail(
          CONTROLLED_SKILL_PILOT_ERROR.NOT_OPTED_IN,
          "canary traffic must retain its authenticated shadow cohort assignment",
        );
      }
    }
    const sameSubject = this._state.observations.find(
      (row) =>
        row.stage === observation.stage &&
        row.subjectDigest === observation.subjectDigest,
    );
    if (sameSubject) {
      if (sameSubject.receiptDigest !== observation.receiptDigest) {
        fail(
          CONTROLLED_SKILL_PILOT_ERROR.INVALID,
          "a pilot subject cannot replace its observation receipt",
        );
      }
      return this.view();
    }
    if (this._state.stage === CONTROLLED_SKILL_PILOT_STAGE.CANARY) {
      const canarySubjects = new Set(
        this._state.observations
          .filter((row) => row.stage === CONTROLLED_SKILL_PILOT_STAGE.CANARY)
          .map((row) => row.subjectDigest),
      );
      const canarySubjectLimit = Math.max(
        1,
        Math.ceil(
          (this.descriptor.cohort.maxSubjects *
            this.descriptor.cohort.canaryPercent) /
            100,
        ),
      );
      if (canarySubjects.size >= canarySubjectLimit) {
        fail(
          CONTROLLED_SKILL_PILOT_ERROR.GATE_FAILED,
          "pilot canary traffic allocation is full",
        );
      }
    }
    const uniqueSubjects = new Set(
      this._state.observations.map((row) => row.subjectDigest),
    );
    if (
      !uniqueSubjects.has(observation.subjectDigest) &&
      uniqueSubjects.size >= this.descriptor.cohort.maxSubjects
    ) {
      fail(CONTROLLED_SKILL_PILOT_ERROR.GATE_FAILED, "pilot cohort is full");
    }
    const next = clone(this._state);
    next.observations.push(observation);
    await this._commit(next, "pilot.observation-recorded", {
      stage: observation.stage,
      subjectDigest: observation.subjectDigest,
      receiptDigest: observation.receiptDigest,
    });
    return this.view();
  }

  async advance(input = {}) {
    this._started();
    this._noPending();
    if (this._progressiveCanary) {
      return this._advanceProgressive(input);
    }
    const target = FORWARD.get(this._state.stage);
    if (!target) {
      fail(
        CONTROLLED_SKILL_PILOT_ERROR.INVALID,
        "pilot cannot advance further",
      );
    }
    if (this._state.stage === CONTROLLED_SKILL_PILOT_STAGE.CANDIDATE) {
      fail(
        CONTROLLED_SKILL_PILOT_ERROR.REVIEW_REQUIRED,
        "shadow requires explicit durable human approval",
      );
    }
    if (this._state.killSwitch) {
      fail(
        CONTROLLED_SKILL_PILOT_ERROR.KILL_SWITCH,
        "pilot kill switch is set",
      );
    }
    const observations = this._stageObservations();
    const metrics = metricsFor(observations);
    const elapsedMs = this._timestamp() - this._state.stageStartedAt;
    const failures = gateFailures(this.descriptor, metrics, elapsedMs);
    if (failures.length > 0) {
      const error = new Error(`pilot gate failed: ${failures.join(", ")}`);
      error.code = CONTROLLED_SKILL_PILOT_ERROR.GATE_FAILED;
      error.failures = failures;
      error.metrics = metrics;
      throw error;
    }
    await this._assertActiveUnchanged();
    const next = clone(this._state);
    await this._advance(next, target, { metrics, elapsedMs });
    return this.view();
  }

  async engageKillSwitch({ reasonDigest } = {}) {
    this._started();
    this._noPending();
    digest(reasonDigest, "reasonDigest");
    if (this._state.stage === CONTROLLED_SKILL_PILOT_STAGE.ROLLED_BACK) {
      return this.view();
    }
    await this._assertActiveUnchanged();
    const next = clone(this._state);
    next.killSwitch = true;
    await this._advance(next, CONTROLLED_SKILL_PILOT_STAGE.ROLLED_BACK, {
      reasonDigest,
      emergency: true,
    });
    return this.view();
  }

  async reconcilePendingTransition() {
    this._started();
    if (this._state.pendingTransition === null) return this.view();
    await this._settlePreparedTransition(this._state.pendingTransition);
    return this.view();
  }

  snapshot() {
    return deepFreeze({
      descriptorDigest: this.descriptorDigest,
      stateDigest: hash(this._state),
      state: clone(this._state),
    });
  }

  view() {
    const observations = this._stageObservations();
    const shadowObservations = this._state.observations.filter(
      (row) => row.stage === CONTROLLED_SKILL_PILOT_STAGE.SHADOW,
    );
    const canaryObservations = this._state.observations.filter(
      (row) => row.stage === CONTROLLED_SKILL_PILOT_STAGE.CANARY,
    );
    return deepFreeze({
      descriptorDigest: this.descriptorDigest,
      stage: this._state.stage,
      revision: this._state.revision,
      killSwitch: this._state.killSwitch,
      reviewReceiptDigest: this._state.reviewReceiptDigest,
      metrics: {
        current: metricsFor(observations),
        shadow: metricsFor(shadowObservations),
        canary: metricsFor(canaryObservations),
      },
      observationWindow: {
        startedAt: this._state.stageStartedAt,
        elapsedMs:
          this._state.stageStartedAt === null
            ? 0
            : Math.max(0, this._timestamp() - this._state.stageStartedAt),
      },
      candidateDigest: this.descriptor.candidateDigest,
      baselineDigest: this.descriptor.baselineDigest,
      evalReceiptDigest: this.descriptor.evalReceiptDigest,
      whyEvidenceDigest: this.descriptor.whyEvidenceDigest,
      candidateDiffDigest: this.descriptor.candidateDiffDigest,
      permissionDiffDigest: this.descriptor.permissionDiffDigest,
      beforeEvaluationDigest: this.descriptor.beforeEvaluationDigest,
      afterEvaluationDigest: this.descriptor.afterEvaluationDigest,
      reviewPacketDigest: this.descriptor.reviewPacketDigest,
      cohort: clone(this.descriptor.cohort),
      lastTransitionReceiptDigest: this._state.lastTransitionReceiptDigest,
      reconciliationRequired: this._state.pendingTransition !== null,
      progressiveCanary:
        this._progressiveCanary === null
          ? null
          : {
              planDigest: this._state.progressivePlanDigest,
              stepId: this._state.progressiveStepId,
              gateReceiptDigests: clone(
                this._state.progressiveGateReceiptDigests,
              ),
            },
    });
  }

  async _advanceProgressive({ gateReceipt } = {}) {
    if (this._state.stage === CONTROLLED_SKILL_PILOT_STAGE.CANDIDATE) {
      fail(
        CONTROLLED_SKILL_PILOT_ERROR.REVIEW_REQUIRED,
        "shadow requires explicit durable human approval",
      );
    }
    if (this._state.killSwitch) {
      fail(
        CONTROLLED_SKILL_PILOT_ERROR.KILL_SWITCH,
        "pilot kill switch is set",
      );
    }
    const currentStepId = this._state.progressiveStepId;
    if (typeof currentStepId !== "string") {
      fail(
        CONTROLLED_SKILL_PILOT_ERROR.INVALID,
        "progressive Canary step is unavailable",
      );
    }
    let receipt;
    let nextStep;
    try {
      receipt = await this._progressiveCanary.gateAuthority.verify(
        gateReceipt,
        {
          stepId: currentStepId,
        },
      );
      nextStep = nextProgressiveCanaryStage({
        plan: this._progressiveCanary.plan,
        currentStepId,
        gateReport: receipt.report,
      });
    } catch (error) {
      const failure = new Error(
        `pilot progressive gate failed: ${error.message}`,
      );
      failure.code = CONTROLLED_SKILL_PILOT_ERROR.GATE_FAILED;
      throw failure;
    }
    const target =
      nextStep.stage === "stable"
        ? CONTROLLED_SKILL_PILOT_STAGE.ACTIVE
        : nextStep.stage;
    await this._assertActiveUnchanged();
    const next = clone(this._state);
    next.progressiveStepId = nextStep.stepId;
    next.progressiveGateReceiptDigests.push(receipt.receiptDigest);
    await this._advance(
      next,
      target,
      {
        progressivePlanDigest: this._progressiveCanary.plan.planDigest,
        gateReportDigest: receipt.reportDigest,
        gateReceiptDigest: receipt.receiptDigest,
        fromStepId: currentStepId,
        toStepId: nextStep.stepId,
      },
      { progressive: true },
    );
    return this.view();
  }

  _started() {
    if (this._state.activeStateDigest === null) {
      fail(CONTROLLED_SKILL_PILOT_ERROR.INVALID, "pilot has not started");
    }
  }

  _noPending() {
    if (this._state.pendingTransition !== null) {
      fail(
        CONTROLLED_SKILL_PILOT_ERROR.PERSISTENCE_FAILED,
        "pilot transition reconciliation is required",
      );
    }
  }

  _timestamp() {
    const value = Number(this._now());
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError("pilot clock is invalid");
    }
    return value;
  }

  _stageObservations() {
    return this._state.observations.filter(
      (row) => row.stage === this._state.stage,
    );
  }

  async _assertActiveUnchanged() {
    if (hash(await this._readActiveState()) !== this._state.activeStateDigest) {
      fail(
        CONTROLLED_SKILL_PILOT_ERROR.ACTIVE_DRIFT,
        "active Skill changed outside the pilot authority",
      );
    }
  }

  async _advance(next, target, evidence, { progressive = false } = {}) {
    const from = this._state.stage;
    const progressiveTransition =
      progressive &&
      ((from === CONTROLLED_SKILL_PILOT_STAGE.CANDIDATE &&
        target === CONTROLLED_SKILL_PILOT_STAGE.SHADOW) ||
        (from === CONTROLLED_SKILL_PILOT_STAGE.SHADOW &&
          target === CONTROLLED_SKILL_PILOT_STAGE.CANARY) ||
        (from === CONTROLLED_SKILL_PILOT_STAGE.CANARY &&
          [
            CONTROLLED_SKILL_PILOT_STAGE.CANARY,
            CONTROLLED_SKILL_PILOT_STAGE.ACTIVE_PROBATION,
          ].includes(target)) ||
        (from === CONTROLLED_SKILL_PILOT_STAGE.ACTIVE_PROBATION &&
          target === CONTROLLED_SKILL_PILOT_STAGE.ACTIVE));
    if (
      target !== CONTROLLED_PILOT_ROLLBACK &&
      !progressiveTransition &&
      FORWARD.get(from) !== target
    ) {
      fail(
        CONTROLLED_SKILL_PILOT_ERROR.INVALID,
        "non-canonical pilot transition",
      );
    }
    const request = deepFreeze({
      schema: CONTROLLED_SKILL_PILOT_EVENT_SCHEMA,
      descriptorDigest: this.descriptorDigest,
      tenantId: this.descriptor.tenantId,
      pilotId: this.descriptor.pilotId,
      candidateDigest: this.descriptor.candidateDigest,
      from,
      to: target,
      evidence: clone(evidence),
      requestedAt: this._timestamp(),
    });
    const requestDigest = hash(request);
    next.pendingTransition = deepFreeze({ request, requestDigest });
    await this._commit(next, "pilot.stage-transition-prepared", {
      requestDigest,
      from,
      to: target,
    });
    await this._settlePreparedTransition(this._state.pendingTransition);
  }

  async _settlePreparedTransition(pending) {
    const { request, requestDigest } = pending;
    const from = request.from;
    const target = request.to;
    const result = await this._transitionStage({ request, requestDigest });
    if (
      result?.authenticated !== true ||
      result?.durable !== true ||
      result.descriptorDigest !== this.descriptorDigest ||
      result.requestDigest !== requestDigest ||
      result.from !== from ||
      result.to !== target ||
      !DIGEST.test(result.receiptDigest ?? "") ||
      ([
        CONTROLLED_SKILL_PILOT_STAGE.ACTIVE,
        CONTROLLED_SKILL_PILOT_STAGE.ROLLED_BACK,
      ].includes(target) &&
        !DIGEST.test(result.activeStateDigest ?? ""))
    ) {
      fail(
        CONTROLLED_SKILL_PILOT_ERROR.AUTHORITY_FAILED,
        "rollout authority did not confirm the exact transition",
      );
    }
    if (
      [
        CONTROLLED_SKILL_PILOT_STAGE.ACTIVE,
        CONTROLLED_SKILL_PILOT_STAGE.ROLLED_BACK,
      ].includes(target)
    ) {
      if (hash(await this._readActiveState()) !== result.activeStateDigest) {
        fail(
          CONTROLLED_SKILL_PILOT_ERROR.AUTHORITY_FAILED,
          "rollout authority active-state acknowledgement does not match readback",
        );
      }
    } else {
      await this._assertActiveUnchanged();
    }
    const next = clone(this._state);
    next.pendingTransition = null;
    next.stage = target;
    next.stageStartedAt = request.requestedAt;
    next.lastTransitionReceiptDigest = result.receiptDigest;
    if (
      [
        CONTROLLED_SKILL_PILOT_STAGE.ACTIVE,
        CONTROLLED_SKILL_PILOT_STAGE.ROLLED_BACK,
      ].includes(target)
    ) {
      next.activeStateDigest = result.activeStateDigest;
    }
    await this._commit(next, "pilot.stage-transitioned", {
      requestDigest,
      transitionReceiptDigest: result.receiptDigest,
      from,
      to: target,
    });
  }

  async _commit(next, type, evidence) {
    const expectedRevision = this._state.revision;
    next.revision = expectedRevision + 1;
    const stateDigest = hash(next);
    const event = deepFreeze({
      schema: CONTROLLED_SKILL_PILOT_EVENT_SCHEMA,
      descriptorDigest: this.descriptorDigest,
      tenantId: this.descriptor.tenantId,
      pilotId: this.descriptor.pilotId,
      type,
      expectedRevision,
      revision: next.revision,
      stateDigest,
      evidence: clone(evidence),
      committedAt: this._timestamp(),
    });
    const eventDigest = hash(event);
    const acknowledgement = await this._commitState({
      expectedRevision,
      state: deepFreeze(clone(next)),
      stateDigest,
      event,
      eventDigest,
    });
    if (
      acknowledgement?.authenticated !== true ||
      acknowledgement?.durable !== true ||
      acknowledgement.descriptorDigest !== this.descriptorDigest ||
      acknowledgement.revision !== next.revision ||
      acknowledgement.stateDigest !== stateDigest ||
      acknowledgement.eventDigest !== eventDigest
    ) {
      fail(
        CONTROLLED_SKILL_PILOT_ERROR.PERSISTENCE_FAILED,
        "pilot state was not durably authenticated",
      );
    }
    this._state = next;
  }
}

export function createControlledSkillProductionPilot(options) {
  return new ControlledSkillProductionPilot(options);
}

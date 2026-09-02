import { createHash } from "node:crypto";
import {
  GOAL_DECISION,
  GoalConditionEngine,
} from "../goal-condition-engine.js";

export const EVOLUTION_PILOT_SCHEMA =
  "chainlesschain.bounded-skill-improvement-pilot/v1";

export const EVOLUTION_FAILURE_CATEGORY = Object.freeze({
  PROCEDURE: "procedure",
  MODEL: "model",
  DATA: "data",
  INFRASTRUCTURE: "infrastructure",
  PERMISSION_POLICY: "permission/policy",
  SECURITY: "security",
});

const TRANSIENT_CODES = new Set([
  "PROVIDER_TRANSIENT",
  "MCP_DISCOVERY_TIMEOUT",
  "MCP_TRANSIENT",
  "SANDBOX_UNAVAILABLE",
  "EVALUATOR_CRASH",
]);
const PERMISSION_CODES = new Set([
  "PERMISSION_DENIED",
  "POLICY_DENIED",
  "APPROVAL_REQUIRED",
]);
const SECURITY_CODES = new Set([
  "ACTIVE_STATE_CHANGED",
  "DIGEST_MISMATCH",
  "UNTRUSTED_EVIDENCE",
]);

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function digest(value) {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function frozen(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) frozen(child);
  }
  return value;
}

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${name} is required`);
  }
  return value;
}

function requiredPort(ports, name) {
  if (typeof ports?.[name] !== "function") {
    throw new TypeError(`${name} port is required`);
  }
  return ports[name];
}

function usageOf(result) {
  const usage = result?.usage ?? {};
  return {
    tokens: Math.max(0, Number(usage.tokens) || 0),
    costUsd: Math.max(0, Number(usage.costUsd) || 0),
    turns: Math.max(0, Number(usage.turns) || 0),
    timeMs: Math.max(0, Number(usage.timeMs) || 0),
  };
}

function addUsage(total, next) {
  for (const key of Object.keys(total)) total[key] += next[key];
}

function classifyFailure(error, fallback = EVOLUTION_FAILURE_CATEGORY.PROCEDURE) {
  const code = String(error?.code ?? "");
  if (SECURITY_CODES.has(code)) return EVOLUTION_FAILURE_CATEGORY.SECURITY;
  if (PERMISSION_CODES.has(code))
    return EVOLUTION_FAILURE_CATEGORY.PERMISSION_POLICY;
  if (TRANSIENT_CODES.has(code))
    return EVOLUTION_FAILURE_CATEGORY.INFRASTRUCTURE;
  if (code.startsWith("MODEL_")) return EVOLUTION_FAILURE_CATEGORY.MODEL;
  if (code.startsWith("DATA_")) return EVOLUTION_FAILURE_CATEGORY.DATA;
  return fallback;
}

function normalizeScore(value, name) {
  const score = Number(value);
  if (!Number.isFinite(score)) throw new Error(`${name} score is unknown`);
  return score;
}

function normalizeDescriptor(input) {
  const descriptor = {
    schema: EVOLUTION_PILOT_SCHEMA,
    tenantId: requiredString(input?.tenantId, "tenantId"),
    evolutionRunId: requiredString(input?.evolutionRunId, "evolutionRunId"),
    skillName: requiredString(input?.skillName, "skillName"),
    baselineCandidateId: requiredString(
      input?.baselineCandidateId,
      "baselineCandidateId",
    ),
    baselineDigest: requiredString(input?.baselineDigest, "baselineDigest"),
    trainSplitDigest: requiredString(
      input?.trainSplitDigest,
      "trainSplitDigest",
    ),
    validationSplitDigest: requiredString(
      input?.validationSplitDigest,
      "validationSplitDigest",
    ),
    deterministicGraderDigest: requiredString(
      input?.deterministicGraderDigest,
      "deterministicGraderDigest",
    ),
    evaluatorDigest: requiredString(input?.evaluatorDigest, "evaluatorDigest"),
    runtimeFingerprintDigest: requiredString(
      input?.runtimeFingerprintDigest,
      "runtimeFingerprintDigest",
    ),
    failureRecoveryIsTarget: input?.failureRecoveryIsTarget === true,
    gate: {
      minDeterministicScore: normalizeScore(
        input?.gate?.minDeterministicScore,
        "gate.minDeterministicScore",
      ),
      minEvaluatorScore: normalizeScore(
        input?.gate?.minEvaluatorScore,
        "gate.minEvaluatorScore",
      ),
      minImprovement: normalizeScore(
        input?.gate?.minImprovement,
        "gate.minImprovement",
      ),
    },
    baselineScore: normalizeScore(input?.baselineScore, "baselineScore"),
    budget: clone(input?.budget ?? {}),
  };
  if (descriptor.trainSplitDigest === descriptor.validationSplitDigest) {
    throw new Error("train and validation split digests must differ");
  }
  return frozen(descriptor);
}

function verifyEvidence(result, expectedDigest, label) {
  if (
    !result ||
    typeof result !== "object" ||
    result.evidenceTrusted !== true ||
    result.authorityDigest !== expectedDigest ||
    typeof result.receiptDigest !== "string" ||
    result.receiptDigest === ""
  ) {
    const error = new Error(`${label} evidence is unknown or untrusted`);
    error.code = "UNTRUSTED_EVIDENCE";
    throw error;
  }
  return normalizeScore(result.score, label);
}

function gateDecision(descriptor, deterministicScore, evaluatorScore, bestScore) {
  const combinedScore = Math.min(deterministicScore, evaluatorScore);
  const gate = descriptor.gate;
  const accepted =
    deterministicScore >= gate.minDeterministicScore &&
    evaluatorScore >= gate.minEvaluatorScore &&
    combinedScore - bestScore >= gate.minImprovement;
  return { accepted, combinedScore };
}

function budgetLimit(descriptor, prior, current, elapsedMs) {
  const total = Object.fromEntries(
    Object.keys(prior).map((key) => [key, prior[key] + current[key]]),
  );
  const budget = descriptor.budget;
  if (Number(budget.maxTokens) > 0 && total.tokens >= Number(budget.maxTokens))
    return "max_tokens";
  if (
    Number(budget.maxCostUsd) > 0 &&
    total.costUsd >= Number(budget.maxCostUsd)
  )
    return "max_cost";
  if (
    Number(budget.maxRootTurns) > 0 &&
    total.turns >= Number(budget.maxRootTurns)
  )
    return "max_root_turns";
  if (
    Number(budget.maxWorkTimeMs) > 0 &&
    total.timeMs >= Number(budget.maxWorkTimeMs)
  )
    return "max_work_time";
  if (Number(budget.maxTimeMs) > 0 && elapsedMs >= Number(budget.maxTimeMs))
    return "max_time";
  return null;
}

export class BoundedSkillImprovementPilot {
  constructor({ descriptor, ports, now = () => 0, snapshot = null } = {}) {
    this.descriptor = normalizeDescriptor(descriptor);
    this.runDigest = digest(this.descriptor);
    this._now = now;
    this._propose = requiredPort(ports, "propose");
    this._persistCandidate = requiredPort(ports, "persistCandidate");
    this._gradeDeterministic = requiredPort(ports, "gradeDeterministic");
    this._evaluateIsolated = requiredPort(ports, "evaluateIsolated");
    this._appendReceipt = requiredPort(ports, "appendReceipt");
    this._readActiveState = requiredPort(ports, "readActiveState");
    this._engine = new GoalConditionEngine({
      condition: { kind: "model", text: `pilot gate ${this.runDigest}` },
      budget: this.descriptor.budget,
      now,
    });
    this._state = {
      round: 0,
      status: "ready",
      bestCandidateId: this.descriptor.baselineCandidateId,
      bestScore: this.descriptor.baselineScore,
      activeStateDigest: null,
      receipts: [],
      failures: [],
      usage: { tokens: 0, costUsd: 0, turns: 0, timeMs: 0 },
    };
    if (snapshot) this._restore(snapshot);
  }

  async start() {
    if (this._state.activeStateDigest === null) {
      this._state.activeStateDigest = digest(await this._readActiveState());
    }
    if (this._state.status === "ready") this._state.status = "running";
    return this.view();
  }

  async runRound() {
    if (this._state.activeStateDigest === null) await this.start();
    if (this._engine.done || this._state.status !== "running") return this.view();

    const round = this._state.round + 1;
    const roundKey = digest({ runDigest: this.runDigest, round });
    const roundUsage = { tokens: 0, costUsd: 0, turns: 0, timeMs: 0 };
    try {
      const proposed = await this._propose({
        descriptor: this.descriptor,
        round,
        roundKey,
        bestCandidateId: this._state.bestCandidateId,
      });
      addUsage(roundUsage, usageOf(proposed));
      if (!proposed?.candidate || proposed.candidates !== undefined) {
        const error = new Error("proposer must return exactly one candidate");
        error.code = "PROCEDURE_MULTIPLE_CANDIDATES";
        throw error;
      }
      const persisted = await this._persistCandidate({
        descriptor: this.descriptor,
        round,
        roundKey,
        candidate: proposed.candidate,
      });
      if (
        typeof persisted?.candidateId !== "string" ||
        typeof persisted?.contentDigest !== "string"
      ) {
        throw new Error("candidate persistence acknowledgement is incomplete");
      }
      const gradingInput = {
        descriptor: this.descriptor,
        round,
        roundKey,
        candidateId: persisted.candidateId,
        contentDigest: persisted.contentDigest,
      };
      const deterministic = await this._gradeDeterministic(gradingInput);
      addUsage(roundUsage, usageOf(deterministic));
      const deterministicScore = verifyEvidence(
        deterministic,
        this.descriptor.deterministicGraderDigest,
        "deterministic grader",
      );
      const evaluated = await this._evaluateIsolated({
        ...gradingInput,
        deterministicReceiptDigest: deterministic.receiptDigest,
      });
      addUsage(roundUsage, usageOf(evaluated));
      const evaluatorScore = verifyEvidence(
        evaluated,
        this.descriptor.evaluatorDigest,
        "isolated evaluator",
      );
      const limit = budgetLimit(
        this.descriptor,
        this._state.usage,
        roundUsage,
        Math.max(0, this._now() - this._engine.state.startedAtMs),
      );
      if (limit) {
        const error = new Error(`root budget exhausted (${limit})`);
        error.code = "BUDGET_EXHAUSTED";
        error.limit = limit;
        throw error;
      }
      const decision = gateDecision(
        this.descriptor,
        deterministicScore,
        evaluatorScore,
        this._state.bestScore,
      );
      const receipt = frozen({
        schema: EVOLUTION_PILOT_SCHEMA,
        type: "round",
        runDigest: this.runDigest,
        round,
        roundKey,
        candidateId: persisted.candidateId,
        contentDigest: persisted.contentDigest,
        deterministicReceiptDigest: deterministic.receiptDigest,
        evaluatorReceiptDigest: evaluated.receiptDigest,
        deterministicScore,
        evaluatorScore,
        combinedScore: decision.combinedScore,
        accepted: decision.accepted,
        usage: roundUsage,
      });
      await this._assertActiveUnchanged();
      await this._persistReceipt(receipt);
      await this._assertActiveUnchanged();
      this._recordUsage(roundUsage);
      this._state.round = round;
      this._state.receipts.push(digest(receipt));
      if (decision.accepted) {
        this._state.bestCandidateId = persisted.candidateId;
        this._state.bestScore = decision.combinedScore;
      }
      const goal = this._engine.evaluate({
        met: decision.accepted,
        reason: decision.accepted ? "pre-registered gate passed" : "gate not met",
        evidence: { roundKey, receiptDigest: digest(receipt) },
      });
      this._state.status =
        goal.decision === GOAL_DECISION.COMPLETE
          ? "completed"
          : goal.decision === GOAL_DECISION.EXHAUSTED
            ? "exhausted"
            : "running";
      return this.view();
    } catch (error) {
      this._recordUsage(roundUsage);
      await this._stopForFailure(error, { round, roundKey, usage: roundUsage });
      return this.view();
    }
  }

  async run() {
    await this.start();
    while (this._state.status === "running") await this.runRound();
    return this.view();
  }

  snapshot() {
    return frozen({
      schema: EVOLUTION_PILOT_SCHEMA,
      runDigest: this.runDigest,
      descriptor: clone(this.descriptor),
      engine: this._engine.snapshot(),
      state: clone(this._state),
    });
  }

  view() {
    return frozen({
      runDigest: this.runDigest,
      ...clone(this._state),
      goal: clone(this._engine.state),
    });
  }

  _restore(snapshot) {
    if (
      snapshot?.schema !== EVOLUTION_PILOT_SCHEMA ||
      snapshot.runDigest !== this.runDigest ||
      digest(snapshot.descriptor) !== this.runDigest
    ) {
      throw new Error("pilot snapshot does not match the fixed run descriptor");
    }
    this._engine = GoalConditionEngine.fromSnapshot(snapshot.engine, {
      now: this._now,
    });
    this._state = clone(snapshot.state);
  }

  _recordUsage(usage) {
    addUsage(this._state.usage, usage);
    this._engine.recordTurnUsage({
      tokens: usage.tokens,
      costUsd: usage.costUsd,
    });
  }

  async _persistReceipt(receipt) {
    const receiptDigest = digest(receipt);
    const acknowledgement = await this._appendReceipt({
      receipt,
      receiptDigest,
      idempotencyKey: receipt.type === "round" ? receipt.roundKey : receiptDigest,
    });
    if (
      acknowledgement?.durable !== true ||
      acknowledgement?.receiptDigest !== receiptDigest
    ) {
      const error = new Error("receipt was not durably acknowledged");
      error.code = "RECEIPT_WRITE_FAILED";
      throw error;
    }
  }

  async _assertActiveUnchanged() {
    if (digest(await this._readActiveState()) !== this._state.activeStateDigest) {
      const error = new Error("active Skill state changed during candidate-only pilot");
      error.code = "ACTIVE_STATE_CHANGED";
      throw error;
    }
  }

  async _stopForFailure(error, context) {
    const category = classifyFailure(error);
    const skillNegative =
      error?.code === "BUDGET_EXHAUSTED"
        ? false
        : this.descriptor.failureRecoveryIsTarget ||
          ![
            EVOLUTION_FAILURE_CATEGORY.INFRASTRUCTURE,
            EVOLUTION_FAILURE_CATEGORY.PERMISSION_POLICY,
          ].includes(category);
    const failure = frozen({
      schema: EVOLUTION_PILOT_SCHEMA,
      type: "failure",
      runDigest: this.runDigest,
      round: context.round,
      roundKey: context.roundKey,
      category,
      code: String(error?.code ?? "PILOT_FAILURE"),
      limit: error?.limit ?? null,
      skillNegative,
      usage: context.usage,
    });
    this._state.round = Math.max(this._state.round, context.round);
    this._state.failures.push(failure);
    this._state.status =
      error?.code === "BUDGET_EXHAUSTED" ? "exhausted" : "failed";
    try {
      await this._persistReceipt(failure);
      this._state.receipts.push(digest(failure));
    } catch (receiptError) {
      this._state.status = "evidence-failed";
      this._state.failures.push(
        frozen({
          ...failure,
          code: String(receiptError?.code ?? "RECEIPT_WRITE_FAILED"),
          category: EVOLUTION_FAILURE_CATEGORY.SECURITY,
          skillNegative: false,
        }),
      );
    }
    try {
      await this._assertActiveUnchanged();
    } catch (activeError) {
      this._state.status = "security-failed";
      this._state.failures.push(
        frozen({
          ...failure,
          code: activeError.code,
          category: EVOLUTION_FAILURE_CATEGORY.SECURITY,
          skillNegative: true,
        }),
      );
    }
  }
}

export function createBoundedSkillImprovementPilot(options) {
  return new BoundedSkillImprovementPilot(options);
}

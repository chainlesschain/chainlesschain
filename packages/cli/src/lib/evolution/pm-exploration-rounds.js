import { createHash } from "node:crypto";
import { isProxy } from "node:util/types";

export const PM_EXPLORATION_PLAN_SCHEMA =
  "chainlesschain.pm-exploration-plan/v1";
export const PM_EXPLORATION_CHECKPOINT_SCHEMA =
  "chainlesschain.pm-exploration-checkpoint/v1";
export const PM_EXPLORATION_MERGE_SCHEMA =
  "chainlesschain.pm-exploration-merge/v1";
export const PM_EXPLORATION_FROZEN_MEMORY_SCHEMA =
  "chainlesschain.pm-exploration-frozen-memory/v1";
export const PM_EXPLORATION_RECOVERY_SNAPSHOT_SCHEMA =
  "chainlesschain.pm-exploration-recovery-snapshot/v1";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/u;
const JOURNALS = new WeakMap();
const ROUND_TOKENS = new WeakMap();

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

function exact(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length ||
    actual.some((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return (
        typeof key !== "string" ||
        !keys.includes(key) ||
        !descriptor ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      );
    })
  ) {
    throw new TypeError(`${label} has unexpected or accessor fields`);
  }
}

function identifier(value, label) {
  if (typeof value !== "string" || value.length > 256 || !ID.test(value))
    throw new TypeError(`${label} is invalid`);
  return value;
}

function identifierList(value, label, minimum, maximum) {
  if (
    !Array.isArray(value) ||
    isProxy(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length < minimum ||
    value.length > maximum
  ) {
    throw new TypeError(
      `${label} must contain from ${minimum} to ${maximum} identifiers`,
    );
  }
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== value.length + 1 ||
    ownKeys.some((key) => {
      if (key === "length") {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return !descriptor || !("value" in descriptor);
      }
      if (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key))
        return true;
      const index = Number(key);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return (
        index >= value.length ||
        !descriptor ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      );
    })
  ) {
    throw new TypeError(`${label} cannot contain holes or accessor fields`);
  }
  const result = Array.from({ length: value.length }, (_, index) =>
    identifier(
      Object.getOwnPropertyDescriptor(value, String(index)).value,
      `${label} entry`,
    ),
  );
  if (new Set(result).size !== result.length)
    throw new TypeError(`${label} must be unique`);
  return result;
}

function digest(value, label) {
  if (typeof value !== "string" || !DIGEST.test(value))
    throw new TypeError(`${label} must be a sha256 digest`);
  return value;
}

function integer(value, label, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new TypeError(`${label} is outside its allowed range`);
  return value;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && "value" in descriptor) deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

function copyPlainData(
  value,
  label,
  context = { seen: new WeakSet(), nodes: 0 },
) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (
    !value ||
    typeof value !== "object" ||
    isProxy(value) ||
    context.seen.has(value) ||
    context.nodes >= 20_000
  ) {
    throw new TypeError(`${label} must be bounded acyclic plain data`);
  }
  context.seen.add(value);
  context.nodes += 1;
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype)
      throw new TypeError(`${label} must use the default array prototype`);
    const keys = Reflect.ownKeys(value);
    if (keys.length !== value.length + 1)
      throw new TypeError(`${label} cannot contain holes or extra fields`);
    const result = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor))
        throw new TypeError(`${label} cannot contain holes or accessor fields`);
      result.push(copyPlainData(descriptor.value, label, context));
    }
    context.seen.delete(value);
    return result;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype)
    throw new TypeError(`${label} must use the default object prototype`);
  const result = {};
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== "string" ||
      !descriptor ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    ) {
      throw new TypeError(`${label} cannot contain symbol or accessor fields`);
    }
    Object.defineProperty(result, key, {
      value: copyPlainData(descriptor.value, label, context),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  context.seen.delete(value);
  return result;
}

function stateFor(journal) {
  const state = JOURNALS.get(journal);
  if (!state)
    throw new TypeError("a branded PM exploration journal is required");
  return state;
}

export function createPmExplorationPlan(input) {
  exact(
    input,
    [
      "planId",
      "suiteDigest",
      "trainingPartitionDigest",
      "trainingTaskIds",
      "environmentDigest",
      "initialMemoryDigest",
      "broadBranchIds",
      "maxRounds",
      "maxTokens",
      "maxToolCalls",
      "maxWallClockMs",
      "maxConsecutiveNoGain",
    ],
    "PM exploration plan",
  );
  const trainingTaskIds = identifierList(
    input.trainingTaskIds,
    "trainingTaskIds",
    1,
    10_000,
  );
  const broadBranchIds = identifierList(
    input.broadBranchIds,
    "broadBranchIds",
    1,
    8,
  );
  const maxRounds = integer(input.maxRounds, "maxRounds", 1, 64);
  const maxConsecutiveNoGain = integer(
    input.maxConsecutiveNoGain,
    "maxConsecutiveNoGain",
    1,
    maxRounds,
  );
  const core = {
    schema: PM_EXPLORATION_PLAN_SCHEMA,
    planId: identifier(input.planId, "planId"),
    suiteDigest: digest(input.suiteDigest, "suiteDigest"),
    trainingPartitionDigest: digest(
      input.trainingPartitionDigest,
      "trainingPartitionDigest",
    ),
    trainingTaskIds,
    environmentDigest: digest(input.environmentDigest, "environmentDigest"),
    initialMemoryDigest: digest(
      input.initialMemoryDigest,
      "initialMemoryDigest",
    ),
    broadBranchIds,
    maxRounds,
    maxTokens: integer(input.maxTokens, "maxTokens", 1),
    maxToolCalls: integer(input.maxToolCalls, "maxToolCalls", 1),
    maxWallClockMs: integer(input.maxWallClockMs, "maxWallClockMs", 1),
    maxConsecutiveNoGain,
  };
  return deepFreeze({
    ...core,
    planDigest: hash(PM_EXPLORATION_PLAN_SCHEMA, core),
  });
}

function validatedPmExplorationPlan(plan) {
  exact(
    plan,
    [
      "schema",
      "planId",
      "suiteDigest",
      "trainingPartitionDigest",
      "trainingTaskIds",
      "environmentDigest",
      "initialMemoryDigest",
      "broadBranchIds",
      "maxRounds",
      "maxTokens",
      "maxToolCalls",
      "maxWallClockMs",
      "maxConsecutiveNoGain",
      "planDigest",
    ],
    "PM exploration plan envelope",
  );
  if (plan.schema !== PM_EXPLORATION_PLAN_SCHEMA)
    throw new TypeError("PM exploration plan schema is unsupported");
  const verified = createPmExplorationPlan({
    planId: plan.planId,
    suiteDigest: plan.suiteDigest,
    trainingPartitionDigest: plan.trainingPartitionDigest,
    trainingTaskIds: plan.trainingTaskIds,
    environmentDigest: plan.environmentDigest,
    initialMemoryDigest: plan.initialMemoryDigest,
    broadBranchIds: plan.broadBranchIds,
    maxRounds: plan.maxRounds,
    maxTokens: plan.maxTokens,
    maxToolCalls: plan.maxToolCalls,
    maxWallClockMs: plan.maxWallClockMs,
    maxConsecutiveNoGain: plan.maxConsecutiveNoGain,
  });
  if (verified.planDigest !== plan.planDigest)
    throw new TypeError("PM exploration plan digest mismatch");
  return verified;
}

export function verifyPmExplorationPlan(plan) {
  validatedPmExplorationPlan(plan);
  return true;
}

export function createPmExplorationJournal(plan) {
  const verifiedPlan = validatedPmExplorationPlan(plan);
  const journal = Object.freeze({});
  JOURNALS.set(journal, {
    plan: verifiedPlan,
    stage: "broad",
    branchHeads: new Map(
      verifiedPlan.broadBranchIds.map((branchId) => [
        branchId,
        verifiedPlan.initialMemoryDigest,
      ]),
    ),
    branchCheckpointDigests: new Map(
      verifiedPlan.broadBranchIds.map((branchId) => [branchId, []]),
    ),
    activeBranches: new Set(),
    activeRoundIds: new Set(),
    usedRoundIds: new Set(),
    checkpoints: [],
    merge: null,
    deepHead: null,
    totals: { tokens: 0, toolCalls: 0, wallClockMs: 0 },
    consecutiveNoGain: 0,
    stopReason: null,
    frozen: null,
  });
  return journal;
}

export function startPmExplorationRound(journal, input) {
  const state = stateFor(journal);
  exact(
    input,
    ["roundId", "stage", "branchId", "taskId", "inputMemoryDigest"],
    "PM exploration round",
  );
  if (state.frozen) throw new Error("PM exploration memory is already frozen");
  if (state.stopReason)
    throw new Error(`PM exploration stopped: ${state.stopReason}`);
  if (state.checkpoints.length >= state.plan.maxRounds)
    throw new Error("PM exploration round budget is exhausted");
  const roundId = identifier(input.roundId, "roundId");
  if (state.usedRoundIds.has(roundId) || state.activeRoundIds.has(roundId))
    throw new Error("PM exploration round ID has already been used");
  const taskId = identifier(input.taskId, "taskId");
  if (!state.plan.trainingTaskIds.includes(taskId))
    throw new Error("round task is outside the bound training partition");
  const inputMemoryDigest = digest(
    input.inputMemoryDigest,
    "inputMemoryDigest",
  );
  let branchId = null;
  let expectedHead;
  if (input.stage === "broad") {
    if (state.stage !== "broad") throw new Error("Broad exploration is closed");
    branchId = identifier(input.branchId, "branchId");
    if (!state.branchHeads.has(branchId))
      throw new Error("Unknown broad branch");
    if (state.activeBranches.has(branchId))
      throw new Error("Broad branch already has an active round");
    expectedHead = state.branchHeads.get(branchId);
    state.activeBranches.add(branchId);
  } else if (input.stage === "deep") {
    if (input.branchId !== null)
      throw new TypeError("Deep rounds cannot name a branch");
    if (state.stage !== "deep")
      throw new Error("Deep exploration is not active");
    if (state.activeRoundIds.size > 0)
      throw new Error("Deep exploration must be sequential");
    expectedHead = state.deepHead;
  } else {
    throw new TypeError("round stage must be broad or deep");
  }
  if (inputMemoryDigest !== expectedHead) {
    if (branchId !== null) state.activeBranches.delete(branchId);
    throw new Error("round input memory does not match its current checkpoint");
  }
  const round = Object.freeze({});
  state.activeRoundIds.add(roundId);
  ROUND_TOKENS.set(round, {
    journal,
    roundId,
    stage: input.stage,
    branchId,
    taskId,
    inputMemoryDigest,
    consumed: false,
  });
  return round;
}

function metrics(value) {
  exact(value, ["tokens", "toolCalls", "wallClockMs"], "round metrics");
  return {
    tokens: integer(value.tokens, "tokens"),
    toolCalls: integer(value.toolCalls, "toolCalls"),
    wallClockMs: integer(value.wallClockMs, "wallClockMs"),
  };
}

function updateStopReason(state, budgetExceeded) {
  if (
    budgetExceeded ||
    state.totals.tokens >= state.plan.maxTokens ||
    state.totals.toolCalls >= state.plan.maxToolCalls ||
    state.totals.wallClockMs >= state.plan.maxWallClockMs
  ) {
    state.stopReason = "budget-exhausted";
  } else if (state.checkpoints.length >= state.plan.maxRounds)
    state.stopReason = "max-rounds";
  else if (state.consecutiveNoGain >= state.plan.maxConsecutiveNoGain)
    state.stopReason = "consecutive-no-gain";
}

export function completePmExplorationRound(journal, round, input) {
  const state = stateFor(journal);
  const binding = ROUND_TOKENS.get(round);
  if (!binding || binding.journal !== journal)
    throw new TypeError("round capability does not belong to this journal");
  if (binding.consumed) throw new Error("round capability has already settled");
  exact(
    input,
    [
      "executionReceiptDigest",
      "graderReceiptDigest",
      "outputMemoryDigest",
      "decision",
      "metrics",
    ],
    "PM round completion",
  );
  if (!["accept", "reject", "unsafe"].includes(input.decision))
    throw new TypeError("round decision is invalid");
  const executionReceiptDigest = digest(
    input.executionReceiptDigest,
    "executionReceiptDigest",
  );
  const graderReceiptDigest = digest(
    input.graderReceiptDigest,
    "graderReceiptDigest",
  );
  const outputMemoryDigest = digest(
    input.outputMemoryDigest,
    "outputMemoryDigest",
  );
  const consumed = metrics(input.metrics);
  const nextTotals = {
    tokens: state.totals.tokens + consumed.tokens,
    toolCalls: state.totals.toolCalls + consumed.toolCalls,
    wallClockMs: state.totals.wallClockMs + consumed.wallClockMs,
  };
  let budgetExceeded = false;
  for (const [key, maximum] of [
    ["tokens", state.plan.maxTokens],
    ["toolCalls", state.plan.maxToolCalls],
    ["wallClockMs", state.plan.maxWallClockMs],
  ]) {
    if (!Number.isSafeInteger(nextTotals[key]))
      throw new TypeError(`aggregate ${key} exceeds the safe integer range`);
    if (nextTotals[key] > maximum) budgetExceeded = true;
  }
  if (
    input.decision === "accept" &&
    outputMemoryDigest === binding.inputMemoryDigest
  ) {
    throw new Error("an accepted round must produce a new memory digest");
  }
  const accepted = input.decision === "accept" && !budgetExceeded;
  const effectiveMemoryDigest = accepted
    ? outputMemoryDigest
    : binding.inputMemoryDigest;
  const core = {
    schema: PM_EXPLORATION_CHECKPOINT_SCHEMA,
    planDigest: state.plan.planDigest,
    suiteDigest: state.plan.suiteDigest,
    trainingPartitionDigest: state.plan.trainingPartitionDigest,
    environmentDigest: state.plan.environmentDigest,
    sequence: state.checkpoints.length + 1,
    roundId: binding.roundId,
    stage: binding.stage,
    branchId: binding.branchId,
    taskId: binding.taskId,
    inputMemoryDigest: binding.inputMemoryDigest,
    outputMemoryDigest,
    effectiveMemoryDigest,
    executionReceiptDigest,
    graderReceiptDigest,
    decision: input.decision,
    accepted,
    disposition: budgetExceeded ? "rejected-budget" : input.decision,
    metrics: consumed,
    aggregateMetrics: nextTotals,
  };
  const checkpoint = deepFreeze({
    ...core,
    checkpointDigest: hash(PM_EXPLORATION_CHECKPOINT_SCHEMA, core),
    authenticated: false,
    qualifiesForPromotion: false,
  });
  binding.consumed = true;
  state.activeRoundIds.delete(binding.roundId);
  state.usedRoundIds.add(binding.roundId);
  if (binding.branchId !== null) {
    state.activeBranches.delete(binding.branchId);
    state.branchHeads.set(binding.branchId, effectiveMemoryDigest);
    state.branchCheckpointDigests
      .get(binding.branchId)
      .push(checkpoint.checkpointDigest);
  } else {
    state.deepHead = effectiveMemoryDigest;
  }
  state.checkpoints.push(checkpoint);
  state.totals = nextTotals;
  state.consecutiveNoGain = accepted ? 0 : state.consecutiveNoGain + 1;
  updateStopReason(state, budgetExceeded);
  return checkpoint;
}

export function mergePmExplorationBroadBranches(journal, input) {
  const state = stateFor(journal);
  exact(
    input,
    ["mergeId", "outputMemoryDigest", "conflictResolutionReceiptDigest"],
    "PM broad merge",
  );
  if (state.stage !== "broad" || state.merge)
    throw new Error("Broad exploration cannot be merged in this state");
  if (state.activeRoundIds.size > 0)
    throw new Error("Active rounds must settle before the broad merge");
  const branchCheckpointDigests = state.plan.broadBranchIds.map((branchId) => {
    const checkpoints = state.branchCheckpointDigests.get(branchId);
    if (checkpoints.length === 0)
      throw new Error(`Broad branch ${branchId} has no completed checkpoint`);
    return Object.freeze({
      branchId,
      checkpointDigest: checkpoints.at(-1),
      memoryDigest: state.branchHeads.get(branchId),
    });
  });
  const core = {
    schema: PM_EXPLORATION_MERGE_SCHEMA,
    planDigest: state.plan.planDigest,
    mergeId: identifier(input.mergeId, "mergeId"),
    baseMemoryDigest: state.plan.initialMemoryDigest,
    branchCheckpoints: branchCheckpointDigests,
    outputMemoryDigest: digest(input.outputMemoryDigest, "outputMemoryDigest"),
    conflictResolutionReceiptDigest: digest(
      input.conflictResolutionReceiptDigest,
      "conflictResolutionReceiptDigest",
    ),
  };
  const merge = deepFreeze({
    ...core,
    mergeDigest: hash(PM_EXPLORATION_MERGE_SCHEMA, core),
    authenticated: false,
    qualifiesForPromotion: false,
  });
  state.merge = merge;
  state.deepHead = core.outputMemoryDigest;
  state.stage = "broad-complete";
  return merge;
}

export function enterPmExplorationDeepStage(journal, mergeDigest) {
  const state = stateFor(journal);
  if (state.stage !== "broad-complete" || !state.merge)
    throw new Error("Broad exploration must be merged before Deep exploration");
  if (digest(mergeDigest, "mergeDigest") !== state.merge.mergeDigest)
    throw new Error("Deep exploration merge binding mismatch");
  if (state.stopReason)
    throw new Error(`PM exploration stopped: ${state.stopReason}`);
  state.stage = "deep";
  state.consecutiveNoGain = 0;
  return Object.freeze({
    stage: state.stage,
    inputMemoryDigest: state.deepHead,
    mergeDigest: state.merge.mergeDigest,
  });
}

export function freezePmExplorationMemory(journal, input) {
  const state = stateFor(journal);
  exact(
    input,
    ["finalMemoryDigest", "evaluatorReceiptDigest"],
    "PM memory freeze",
  );
  if (state.frozen) throw new Error("PM exploration memory is already frozen");
  if (state.stage !== "deep")
    throw new Error("Deep exploration must run before memory freeze");
  if (state.activeRoundIds.size > 0)
    throw new Error("Active rounds must settle before memory freeze");
  if (!state.checkpoints.some((checkpoint) => checkpoint.stage === "deep"))
    throw new Error("At least one Deep checkpoint is required before freeze");
  const finalMemoryDigest = digest(
    input.finalMemoryDigest,
    "finalMemoryDigest",
  );
  if (finalMemoryDigest !== state.deepHead)
    throw new Error("final memory does not match the current Deep checkpoint");
  const core = {
    schema: PM_EXPLORATION_FROZEN_MEMORY_SCHEMA,
    planDigest: state.plan.planDigest,
    suiteDigest: state.plan.suiteDigest,
    trainingPartitionDigest: state.plan.trainingPartitionDigest,
    environmentDigest: state.plan.environmentDigest,
    mergeDigest: state.merge.mergeDigest,
    finalCheckpointDigest: state.checkpoints.at(-1).checkpointDigest,
    finalMemoryDigest,
    evaluatorReceiptDigest: digest(
      input.evaluatorReceiptDigest,
      "evaluatorReceiptDigest",
    ),
    totalRounds: state.checkpoints.length,
    aggregateMetrics: state.totals,
    stopReason: state.stopReason,
  };
  state.frozen = deepFreeze({
    ...core,
    frozenMemoryDigest: hash(PM_EXPLORATION_FROZEN_MEMORY_SCHEMA, core),
    authenticated: false,
    qualifiesForPromotion: false,
  });
  state.stage = "frozen";
  return state.frozen;
}

export function exportPmExplorationRecoverySnapshot(journal) {
  const state = stateFor(journal);
  if (state.activeRoundIds.size > 0)
    throw new Error(
      "Active rounds must settle before recovery snapshot export",
    );
  const core = {
    schema: PM_EXPLORATION_RECOVERY_SNAPSHOT_SCHEMA,
    planDigest: state.plan.planDigest,
    stage: state.stage,
    checkpoints: [...state.checkpoints],
    merge: state.merge,
    frozen: state.frozen,
  };
  return deepFreeze({
    ...core,
    snapshotDigest: hash(PM_EXPLORATION_RECOVERY_SNAPSHOT_SCHEMA, core),
    authenticated: false,
    qualifiesForPromotion: false,
  });
}

function validatedRecoverySnapshot(value, plan) {
  exact(
    value,
    [
      "schema",
      "planDigest",
      "stage",
      "checkpoints",
      "merge",
      "frozen",
      "snapshotDigest",
      "authenticated",
      "qualifiesForPromotion",
    ],
    "PM exploration recovery snapshot",
  );
  if (
    value.schema !== PM_EXPLORATION_RECOVERY_SNAPSHOT_SCHEMA ||
    value.authenticated !== false ||
    value.qualifiesForPromotion !== false
  ) {
    throw new TypeError("PM exploration recovery snapshot flags are invalid");
  }
  if (value.planDigest !== plan.planDigest)
    throw new Error("PM recovery snapshot plan binding mismatch");
  const core = copyPlainData(
    {
      schema: value.schema,
      planDigest: value.planDigest,
      stage: value.stage,
      checkpoints: value.checkpoints,
      merge: value.merge,
      frozen: value.frozen,
    },
    "PM exploration recovery snapshot payload",
  );
  if (
    !Array.isArray(core.checkpoints) ||
    core.checkpoints.length > plan.maxRounds
  ) {
    throw new TypeError("PM recovery checkpoint count is invalid");
  }
  const snapshotDigest = digest(value.snapshotDigest, "snapshotDigest");
  if (snapshotDigest !== hash(PM_EXPLORATION_RECOVERY_SNAPSHOT_SCHEMA, core)) {
    throw new Error("PM recovery snapshot digest mismatch");
  }
  return { core, snapshotDigest };
}

function replayCheckpoint(journal, expected) {
  const round = startPmExplorationRound(journal, {
    roundId: expected.roundId,
    stage: expected.stage,
    branchId: expected.branchId,
    taskId: expected.taskId,
    inputMemoryDigest: expected.inputMemoryDigest,
  });
  const actual = completePmExplorationRound(journal, round, {
    executionReceiptDigest: expected.executionReceiptDigest,
    graderReceiptDigest: expected.graderReceiptDigest,
    outputMemoryDigest: expected.outputMemoryDigest,
    decision: expected.decision,
    metrics: expected.metrics,
  });
  if (canonical(actual) !== canonical(expected))
    throw new Error("PM recovery checkpoint replay mismatch");
}

/**
 * Restores only internally consistent, quiescent state. The snapshot remains
 * unauthenticated and cannot authorize execution or promotion.
 */
export function restorePmExplorationJournal(plan, snapshot) {
  const verifiedPlan = validatedPmExplorationPlan(plan);
  const { core, snapshotDigest } = validatedRecoverySnapshot(
    snapshot,
    verifiedPlan,
  );
  if (!["broad", "broad-complete", "deep", "frozen"].includes(core.stage)) {
    throw new TypeError("PM recovery snapshot stage is invalid");
  }
  let deepReached = false;
  for (const checkpoint of core.checkpoints) {
    if (checkpoint.stage === "deep") deepReached = true;
    else if (checkpoint.stage !== "broad" || deepReached)
      throw new Error("PM recovery checkpoint stage order is invalid");
  }
  if (
    (core.stage === "broad" &&
      (core.merge !== null || core.frozen !== null || deepReached)) ||
    (core.stage === "broad-complete" &&
      (core.merge === null || core.frozen !== null || deepReached)) ||
    (core.stage === "deep" && (core.merge === null || core.frozen !== null)) ||
    (core.stage === "frozen" &&
      (core.merge === null || core.frozen === null || !deepReached))
  ) {
    throw new Error("PM recovery snapshot stage payload is inconsistent");
  }

  const journal = createPmExplorationJournal(verifiedPlan);
  for (const checkpoint of core.checkpoints.filter(
    (entry) => entry.stage === "broad",
  )) {
    replayCheckpoint(journal, checkpoint);
  }

  if (core.merge !== null) {
    const actualMerge = mergePmExplorationBroadBranches(journal, {
      mergeId: core.merge.mergeId,
      outputMemoryDigest: core.merge.outputMemoryDigest,
      conflictResolutionReceiptDigest:
        core.merge.conflictResolutionReceiptDigest,
    });
    if (canonical(actualMerge) !== canonical(core.merge))
      throw new Error("PM recovery merge replay mismatch");
  }

  if (core.stage === "deep" || core.stage === "frozen") {
    enterPmExplorationDeepStage(journal, core.merge.mergeDigest);
    for (const checkpoint of core.checkpoints.filter(
      (entry) => entry.stage === "deep",
    )) {
      replayCheckpoint(journal, checkpoint);
    }
  }

  if (core.stage === "frozen") {
    const actualFrozen = freezePmExplorationMemory(journal, {
      finalMemoryDigest: core.frozen.finalMemoryDigest,
      evaluatorReceiptDigest: core.frozen.evaluatorReceiptDigest,
    });
    if (canonical(actualFrozen) !== canonical(core.frozen))
      throw new Error("PM recovery frozen memory replay mismatch");
  }

  if (
    exportPmExplorationRecoverySnapshot(journal).snapshotDigest !==
    snapshotDigest
  ) {
    throw new Error("PM recovery snapshot replay did not reproduce its digest");
  }
  return journal;
}

export function inspectPmExplorationJournal(journal) {
  const state = stateFor(journal);
  return deepFreeze({
    schema: "chainlesschain.pm-exploration-journal-projection/v1",
    planDigest: state.plan.planDigest,
    stage: state.stage,
    branchHeads: state.plan.broadBranchIds.map((branchId) => ({
      branchId,
      memoryDigest: state.branchHeads.get(branchId),
      checkpointCount: state.branchCheckpointDigests.get(branchId).length,
      checkpointDigest:
        state.branchCheckpointDigests.get(branchId).at(-1) ?? null,
    })),
    deepHead: state.deepHead,
    checkpointDigests: state.checkpoints.map(
      (checkpoint) => checkpoint.checkpointDigest,
    ),
    mergeDigest: state.merge?.mergeDigest ?? null,
    mergeReceiptDigest: state.merge?.conflictResolutionReceiptDigest ?? null,
    finalCheckpointDigest: state.checkpoints.at(-1)?.checkpointDigest ?? null,
    frozenMemoryDigest: state.frozen?.frozenMemoryDigest ?? null,
    aggregateMetrics: state.totals,
    consecutiveNoGain: state.consecutiveNoGain,
    stopReason: state.stopReason,
    activeRoundCount: state.activeRoundIds.size,
    authenticated: false,
    qualifiesForPromotion: false,
  });
}

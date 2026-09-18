import { createHash } from "node:crypto";
import { isProxy } from "node:util/types";

import {
  completePmExplorationRound,
  freezePmExplorationMemory,
  inspectPmExplorationJournal,
  mergePmExplorationBroadBranches,
  startPmExplorationRound,
  verifyPmExplorationPlan,
} from "./pm-exploration-rounds.js";
import { executePmExplorationBudgetedOperation } from "./pm-exploration-budget-executor.js";
import {
  getPmExplorationReceiptSignerAuthority,
  inspectPmExplorationReceiptAuthority,
  issuePmExplorationReceipt,
  verifyPmExplorationReceipt,
} from "./pm-exploration-receipts.js";
import { verifyPmExplorationVolcengineSettlementRecord } from "./pm-exploration-volcengine-provider.js";

export const PM_EXPLORATION_EXECUTION_MANIFEST_SCHEMA =
  "chainlesschain.pm-exploration-execution-manifest/v1";
export const PM_EXPLORATION_RUN_REQUEST_SCHEMA =
  "chainlesschain.pm-exploration-run-request/v1";
export const PM_EXPLORATION_GRADE_REQUEST_SCHEMA =
  "chainlesschain.pm-exploration-grade-request/v1";
export const PM_EXPLORATION_EXECUTION_RESULT_SCHEMA =
  "chainlesschain.pm-exploration-execution-result/v1";
export const PM_EXPLORATION_MERGE_RESULT_SCHEMA =
  "chainlesschain.pm-exploration-merge-result/v1";
export const PM_EXPLORATION_EVALUATION_RESULT_SCHEMA =
  "chainlesschain.pm-exploration-evaluation-result/v1";
export const PM_EXPLORATION_MERGE_REQUEST_SCHEMA =
  "chainlesschain.pm-exploration-merge-request/v1";
export const PM_EXPLORATION_EVALUATION_REQUEST_SCHEMA =
  "chainlesschain.pm-exploration-evaluation-request/v1";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/u;
const RUNNERS = new WeakMap();
const GRADERS = new WeakMap();
const MERGERS = new WeakMap();
const EVALUATORS = new WeakMap();
const HOSTS = new WeakMap();

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

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && "value" in descriptor) deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
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

function authorityDescriptor(value, expectedRole, label) {
  exact(
    value,
    [
      "role",
      "authorityId",
      "revision",
      "handlerArtifactDigest",
      "publicKeyDigest",
    ],
    label,
  );
  if (value.role !== expectedRole)
    throw new TypeError(`${label} has the wrong receipt role`);
  return deepFreeze({
    role: value.role,
    authorityId: identifier(value.authorityId, `${label}.authorityId`),
    revision: integer(value.revision, `${label}.revision`, 1),
    handlerArtifactDigest: digest(
      value.handlerArtifactDigest,
      `${label}.handlerArtifactDigest`,
    ),
    publicKeyDigest: digest(value.publicKeyDigest, `${label}.publicKeyDigest`),
  });
}

function toolIds(value) {
  if (
    !Array.isArray(value) ||
    isProxy(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length > 128 ||
    Reflect.ownKeys(value).length !== value.length + 1
  ) {
    throw new TypeError("manifest toolIds must be a dense array");
  }
  const result = value.map((entry, index) => {
    if (!Object.hasOwn(value, index))
      throw new TypeError("manifest toolIds cannot contain holes");
    return identifier(entry, "toolId");
  });
  if (new Set(result).size !== result.length)
    throw new TypeError("manifest toolIds must be unique");
  return Object.freeze(result);
}

export function createPmExplorationExecutionManifest(input = {}) {
  exact(
    input,
    [
      "planDigest",
      "environmentDigest",
      "runner",
      "grader",
      "merger",
      "evaluator",
      "toolIds",
      "toolPolicyDigest",
    ],
    "PM exploration execution manifest",
  );
  const core = deepFreeze({
    schema: PM_EXPLORATION_EXECUTION_MANIFEST_SCHEMA,
    planDigest: digest(input.planDigest, "planDigest"),
    environmentDigest: digest(input.environmentDigest, "environmentDigest"),
    runner: authorityDescriptor(input.runner, "execution", "runner"),
    grader: authorityDescriptor(input.grader, "grader", "grader"),
    merger: authorityDescriptor(input.merger, "merge", "merger"),
    evaluator: authorityDescriptor(input.evaluator, "evaluator", "evaluator"),
    toolIds: toolIds(input.toolIds),
    toolPolicyDigest: digest(input.toolPolicyDigest, "toolPolicyDigest"),
  });
  const authorities = [core.runner, core.grader, core.merger, core.evaluator];
  if (
    new Set(authorities.map((entry) => entry.authorityId)).size !==
      authorities.length ||
    new Set(authorities.map((entry) => entry.publicKeyDigest)).size !==
      authorities.length
  )
    throw new TypeError("PM receipt roles must use independent authorities");
  return deepFreeze({
    ...core,
    manifestDigest: hash(PM_EXPLORATION_EXECUTION_MANIFEST_SCHEMA, core),
  });
}

export function verifyPmExplorationExecutionManifest(value) {
  exact(
    value,
    [
      "schema",
      "planDigest",
      "environmentDigest",
      "runner",
      "grader",
      "merger",
      "evaluator",
      "toolIds",
      "toolPolicyDigest",
      "manifestDigest",
    ],
    "PM exploration execution manifest envelope",
  );
  if (value.schema !== PM_EXPLORATION_EXECUTION_MANIFEST_SCHEMA)
    throw new TypeError("PM exploration execution manifest schema is invalid");
  const normalized = createPmExplorationExecutionManifest({
    planDigest: value.planDigest,
    environmentDigest: value.environmentDigest,
    runner: value.runner,
    grader: value.grader,
    merger: value.merger,
    evaluator: value.evaluator,
    toolIds: value.toolIds,
    toolPolicyDigest: value.toolPolicyDigest,
  });
  if (canonical(normalized) !== canonical(value))
    throw new Error("PM exploration execution manifest digest mismatch");
  return normalized;
}

function createProvider({ signer, handler, expectedRole, bindings, label }) {
  if (typeof handler !== "function" || isProxy(handler))
    throw new TypeError(`${label} handler must be a direct function`);
  const descriptor = inspectPmExplorationReceiptAuthority(signer);
  if (descriptor.role !== expectedRole)
    throw new TypeError(`${label} signer has the wrong receipt role`);
  const provider = Object.freeze({});
  bindings.set(provider, {
    authority: getPmExplorationReceiptSignerAuthority(signer),
    descriptor,
    handler,
    issue: (payload) => issuePmExplorationReceipt(signer, payload),
  });
  return provider;
}

export function createPmExplorationRunner(options = {}) {
  exact(options, ["signer", "run"], "PM exploration runner options");
  return createProvider({
    signer: options.signer,
    handler: options.run,
    expectedRole: "execution",
    bindings: RUNNERS,
    label: "PM exploration runner",
  });
}

export function createPmExplorationGrader(options = {}) {
  exact(options, ["signer", "grade"], "PM exploration grader options");
  return createProvider({
    signer: options.signer,
    handler: options.grade,
    expectedRole: "grader",
    bindings: GRADERS,
    label: "PM exploration grader",
  });
}

export function createPmExplorationMerger(options = {}) {
  exact(options, ["signer", "merge"], "PM exploration merger options");
  return createProvider({
    signer: options.signer,
    handler: options.merge,
    expectedRole: "merge",
    bindings: MERGERS,
    label: "PM exploration merger",
  });
}

export function createPmExplorationEvaluator(options = {}) {
  exact(options, ["signer", "evaluate"], "PM exploration evaluator options");
  return createProvider({
    signer: options.signer,
    handler: options.evaluate,
    expectedRole: "evaluator",
    bindings: EVALUATORS,
    label: "PM exploration evaluator",
  });
}

function snapshotPlan(value) {
  verifyPmExplorationPlan(value);
  return deepFreeze(structuredClone(value));
}

export function createPmExplorationExecutionHost(options = {}) {
  exact(
    options,
    [
      "plan",
      "manifest",
      "runner",
      "grader",
      "merger",
      "evaluator",
      "invokeTool",
      "now",
    ],
    "PM exploration execution host options",
  );
  const plan = snapshotPlan(options.plan);
  const manifest = verifyPmExplorationExecutionManifest(options.manifest);
  const runner = RUNNERS.get(options.runner);
  const grader = GRADERS.get(options.grader);
  const merger = MERGERS.get(options.merger);
  const evaluator = EVALUATORS.get(options.evaluator);
  if (!runner || !grader || !merger || !evaluator)
    throw new TypeError("branded PM exploration providers are required");
  if (
    manifest.planDigest !== plan.planDigest ||
    manifest.environmentDigest !== plan.environmentDigest
  ) {
    throw new Error("PM exploration manifest differs from its plan");
  }
  if (
    canonical(manifest.runner) !== canonical(runner.descriptor) ||
    canonical(manifest.grader) !== canonical(grader.descriptor) ||
    canonical(manifest.merger) !== canonical(merger.descriptor) ||
    canonical(manifest.evaluator) !== canonical(evaluator.descriptor)
  ) {
    throw new Error("PM exploration providers differ from the manifest");
  }
  if (typeof options.invokeTool !== "function" || isProxy(options.invokeTool))
    throw new TypeError("PM exploration host requires a direct tool broker");
  if (typeof options.now !== "function" || isProxy(options.now))
    throw new TypeError("PM exploration host requires a direct clock");
  const host = Object.freeze({});
  HOSTS.set(host, {
    grader,
    evaluator,
    invokeTool: options.invokeTool,
    manifest,
    merger,
    now: options.now,
    plan,
    runner,
    overhead: new WeakMap(),
  });
  return host;
}

export function isPmExplorationExecutionHost(value) {
  return HOSTS.has(value);
}

function isoTime(now) {
  const value = Number(now());
  if (!Number.isSafeInteger(value) || value < 0)
    throw new TypeError("PM exploration execution host clock is invalid");
  return new Date(value).toISOString();
}

function remaining(plan, aggregate) {
  return {
    maxTokens: Math.max(0, plan.maxTokens - aggregate.tokens),
    maxToolCalls: Math.max(0, plan.maxToolCalls - aggregate.toolCalls),
    maxWallClockMs: Math.max(0, plan.maxWallClockMs - aggregate.wallClockMs),
  };
}

function addMetrics(left, right) {
  const result = {};
  for (const key of ["tokens", "toolCalls", "wallClockMs"]) {
    const value = left[key] + right[key];
    if (!Number.isSafeInteger(value))
      throw new TypeError(`combined ${key} exceeds the safe integer range`);
    result[key] = value;
  }
  return result;
}

function overheadFor(host, journal) {
  return (
    host.overhead.get(journal) ??
    Object.freeze({ tokens: 0, toolCalls: 0, wallClockMs: 0 })
  );
}

function totalUsage(host, journal, projection) {
  return addMetrics(projection.aggregateMetrics, overheadFor(host, journal));
}

function recordOverhead(host, journal, metrics) {
  const next = Object.freeze(addMetrics(overheadFor(host, journal), metrics));
  host.overhead.set(journal, next);
  return next;
}

function normalizedRunnerValue(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError("PM exploration runner result must be a plain object");
  }
  const keys = Reflect.ownKeys(value);
  const hasSettlement = Object.hasOwn(value, "providerSettlement");
  const expected = hasSettlement
    ? ["outputMemoryDigest", "traceDigest", "providerSettlement"]
    : ["outputMemoryDigest", "traceDigest"];
  if (
    keys.length !== expected.length ||
    keys.some((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return (
        typeof key !== "string" ||
        !expected.includes(key) ||
        !descriptor ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      );
    })
  ) {
    throw new TypeError(
      "PM exploration runner result has unexpected or accessor fields",
    );
  }
  const traceDigest = digest(value.traceDigest, "traceDigest");
  const providerSettlement = hasSettlement
    ? verifyPmExplorationVolcengineSettlementRecord(value.providerSettlement)
    : null;
  if (
    providerSettlement !== null &&
    providerSettlement.settlement.settlementDigest !== traceDigest
  ) {
    throw new Error(
      "PM exploration provider settlement must match the signed trace digest",
    );
  }
  return Object.freeze({
    outputMemoryDigest: digest(value.outputMemoryDigest, "outputMemoryDigest"),
    traceDigest,
    providerSettlement,
  });
}

function normalizedGraderValue(value) {
  exact(
    value,
    ["decision", "scoreBasisPoints", "resultDigest"],
    "PM exploration grader result",
  );
  if (!["accept", "reject", "unsafe"].includes(value.decision))
    throw new TypeError("PM exploration grader decision is invalid");
  return Object.freeze({
    decision: value.decision,
    scoreBasisPoints: integer(
      value.scoreBasisPoints,
      "scoreBasisPoints",
      0,
      10_000,
    ),
    resultDigest: digest(value.resultDigest, "resultDigest"),
  });
}

async function runActor(binding, request, limits, host) {
  const outcome = await executePmExplorationBudgetedOperation({
    limits,
    allowedToolIds: host.manifest.toolIds,
    invokeTool: host.invokeTool,
    operation: async (runtime) =>
      normalizedRunnerValue(await binding.handler(request, runtime)),
  });
  const succeeded = outcome.status === "succeeded";
  const payload = {
    planDigest: host.plan.planDigest,
    environmentDigest: host.plan.environmentDigest,
    requestDigest: request.requestDigest,
    roundId: request.roundId,
    stage: request.stage,
    branchId: request.branchId,
    taskId: request.taskId,
    inputMemoryDigest: request.inputMemoryDigest,
    outputMemoryDigest: succeeded
      ? outcome.value.outputMemoryDigest
      : request.inputMemoryDigest,
    traceDigest: succeeded ? outcome.value.traceDigest : outcome.traceDigest,
    status: outcome.status,
    failureClass: outcome.failureClass,
    metrics: outcome.metrics,
    issuedAt: isoTime(host.now),
  };
  return Object.freeze({
    receipt: binding.issue(payload),
    providerSettlement: succeeded ? outcome.value.providerSettlement : null,
  });
}

async function runGrader(binding, request, limits, host) {
  const outcome = await executePmExplorationBudgetedOperation({
    limits,
    operation: async (runtime) => {
      const result = normalizedGraderValue(
        await binding.handler(request, runtime),
      );
      if (
        request.executionStatus !== "succeeded" &&
        result.decision === "accept"
      )
        throw new Error("a failed execution cannot be accepted");
      if (
        result.decision === "accept" &&
        request.outputMemoryDigest === request.inputMemoryDigest
      ) {
        throw new Error("an accepted execution must change the memory digest");
      }
      return result;
    },
  });
  const result =
    outcome.status === "succeeded"
      ? outcome.value
      : Object.freeze({
          decision: "unsafe",
          scoreBasisPoints: 0,
          resultDigest: outcome.traceDigest,
        });
  return binding.issue({
    planDigest: host.plan.planDigest,
    environmentDigest: host.plan.environmentDigest,
    requestDigest: request.requestDigest,
    roundId: request.roundId,
    executionReceiptDigest: request.executionReceiptDigest,
    outputMemoryDigest: request.outputMemoryDigest,
    decision: result.decision,
    scoreBasisPoints: result.scoreBasisPoints,
    resultDigest: result.resultDigest,
    metrics: outcome.metrics,
    issuedAt: isoTime(host.now),
  });
}

export async function executePmExplorationRound(hostValue, journal, input) {
  const host = HOSTS.get(hostValue);
  if (!host)
    throw new TypeError("a branded PM exploration execution host is required");
  exact(
    input,
    ["roundId", "stage", "branchId", "taskId", "inputMemoryDigest"],
    "PM exploration hosted round",
  );
  const roundInput = Object.freeze({
    roundId: identifier(input.roundId, "roundId"),
    stage: input.stage,
    branchId: input.branchId,
    taskId: identifier(input.taskId, "taskId"),
    inputMemoryDigest: digest(input.inputMemoryDigest, "inputMemoryDigest"),
  });
  const before = inspectPmExplorationJournal(journal);
  if (before.planDigest !== host.plan.planDigest)
    throw new Error("PM exploration journal differs from the execution host");
  const round = startPmExplorationRound(journal, roundInput);
  const runCore = {
    schema: PM_EXPLORATION_RUN_REQUEST_SCHEMA,
    planDigest: host.plan.planDigest,
    suiteDigest: host.plan.suiteDigest,
    trainingPartitionDigest: host.plan.trainingPartitionDigest,
    environmentDigest: host.plan.environmentDigest,
    executionManifestDigest: host.manifest.manifestDigest,
    toolPolicyDigest: host.manifest.toolPolicyDigest,
    ...roundInput,
  };
  const runRequest = deepFreeze({
    ...runCore,
    requestDigest: hash(PM_EXPLORATION_RUN_REQUEST_SCHEMA, runCore),
  });
  const executionOutcome = await runActor(
    host.runner,
    runRequest,
    remaining(host.plan, totalUsage(host, journal, before)),
    host,
  );
  const executionReceipt = executionOutcome.receipt;
  const execution = verifyPmExplorationReceipt(
    host.runner.authority,
    executionReceipt,
    {
      planDigest: host.plan.planDigest,
      environmentDigest: host.plan.environmentDigest,
      requestDigest: runRequest.requestDigest,
      roundId: roundInput.roundId,
      stage: roundInput.stage,
      branchId: roundInput.branchId,
      taskId: roundInput.taskId,
      inputMemoryDigest: roundInput.inputMemoryDigest,
    },
  );
  const afterExecution = addMetrics(
    totalUsage(host, journal, before),
    execution.payload.metrics,
  );
  const gradeCore = {
    schema: PM_EXPLORATION_GRADE_REQUEST_SCHEMA,
    planDigest: host.plan.planDigest,
    environmentDigest: host.plan.environmentDigest,
    executionManifestDigest: host.manifest.manifestDigest,
    roundId: roundInput.roundId,
    inputMemoryDigest: roundInput.inputMemoryDigest,
    outputMemoryDigest: execution.payload.outputMemoryDigest,
    executionStatus: execution.payload.status,
    executionReceiptDigest: execution.receiptDigest,
    traceDigest: execution.payload.traceDigest,
  };
  const gradeRequest = deepFreeze({
    ...gradeCore,
    requestDigest: hash(PM_EXPLORATION_GRADE_REQUEST_SCHEMA, gradeCore),
  });
  const graderReceipt = await runGrader(
    host.grader,
    gradeRequest,
    remaining(host.plan, afterExecution),
    host,
  );
  const grade = verifyPmExplorationReceipt(
    host.grader.authority,
    graderReceipt,
    {
      planDigest: host.plan.planDigest,
      environmentDigest: host.plan.environmentDigest,
      requestDigest: gradeRequest.requestDigest,
      roundId: roundInput.roundId,
      executionReceiptDigest: execution.receiptDigest,
      outputMemoryDigest: execution.payload.outputMemoryDigest,
    },
  );
  const consumed = addMetrics(execution.payload.metrics, grade.payload.metrics);
  const checkpoint = completePmExplorationRound(journal, round, {
    executionReceiptDigest: execution.receiptDigest,
    graderReceiptDigest: grade.receiptDigest,
    outputMemoryDigest: execution.payload.outputMemoryDigest,
    decision: grade.payload.decision,
    metrics: consumed,
  });
  return deepFreeze({
    schema: PM_EXPLORATION_EXECUTION_RESULT_SCHEMA,
    checkpoint,
    executionReceipt: execution,
    graderReceipt: grade,
    providerSettlement: executionOutcome.providerSettlement,
    budgetEnforced: true,
    receiptsAuthenticated: true,
    snapshotAuthenticated: false,
    qualifiesForPromotion: false,
  });
}

function normalizedMergerValue(value) {
  exact(
    value,
    ["outputMemoryDigest", "conflictResolutionDigest"],
    "PM exploration merger result",
  );
  return Object.freeze({
    outputMemoryDigest: digest(value.outputMemoryDigest, "outputMemoryDigest"),
    conflictResolutionDigest: digest(
      value.conflictResolutionDigest,
      "conflictResolutionDigest",
    ),
  });
}

function normalizedEvaluatorValue(value) {
  exact(
    value,
    ["decision", "scoreBasisPoints", "evaluationDigest"],
    "PM exploration evaluator result",
  );
  if (!["accept", "reject", "unsafe"].includes(value.decision))
    throw new TypeError("PM exploration evaluator decision is invalid");
  return Object.freeze({
    decision: value.decision,
    scoreBasisPoints: integer(
      value.scoreBasisPoints,
      "scoreBasisPoints",
      0,
      10_000,
    ),
    evaluationDigest: digest(value.evaluationDigest, "evaluationDigest"),
  });
}

export async function mergePmExplorationBranches(hostValue, journal, input) {
  const host = HOSTS.get(hostValue);
  if (!host)
    throw new TypeError("a branded PM exploration execution host is required");
  exact(input, ["mergeId"], "PM exploration hosted merge");
  const mergeId = identifier(input.mergeId, "mergeId");
  const projection = inspectPmExplorationJournal(journal);
  if (projection.planDigest !== host.plan.planDigest)
    throw new Error("PM exploration journal differs from the execution host");
  if (
    projection.stage !== "broad" ||
    projection.activeRoundCount !== 0 ||
    projection.branchHeads.some((entry) => entry.checkpointDigest === null)
  ) {
    throw new Error("PM exploration branches are not ready to merge");
  }
  const branchCheckpoints = projection.branchHeads.map((entry) =>
    Object.freeze({
      branchId: entry.branchId,
      checkpointDigest: entry.checkpointDigest,
      memoryDigest: entry.memoryDigest,
    }),
  );
  const core = {
    schema: PM_EXPLORATION_MERGE_REQUEST_SCHEMA,
    planDigest: host.plan.planDigest,
    environmentDigest: host.plan.environmentDigest,
    executionManifestDigest: host.manifest.manifestDigest,
    mergeId,
    baseMemoryDigest: host.plan.initialMemoryDigest,
    branchCheckpoints,
  };
  const request = deepFreeze({
    ...core,
    requestDigest: hash(PM_EXPLORATION_MERGE_REQUEST_SCHEMA, core),
  });
  const outcome = await executePmExplorationBudgetedOperation({
    limits: remaining(host.plan, totalUsage(host, journal, projection)),
    operation: async (runtime) =>
      normalizedMergerValue(await host.merger.handler(request, runtime)),
  });
  const succeeded = outcome.status === "succeeded";
  const receipt = host.merger.issue({
    planDigest: host.plan.planDigest,
    environmentDigest: host.plan.environmentDigest,
    requestDigest: request.requestDigest,
    mergeId,
    branchCheckpoints,
    outputMemoryDigest: succeeded
      ? outcome.value.outputMemoryDigest
      : host.plan.initialMemoryDigest,
    conflictResolutionDigest: succeeded
      ? outcome.value.conflictResolutionDigest
      : outcome.traceDigest,
    status: outcome.status,
    failureClass: outcome.failureClass,
    metrics: outcome.metrics,
    issuedAt: isoTime(host.now),
  });
  const verified = verifyPmExplorationReceipt(host.merger.authority, receipt, {
    planDigest: host.plan.planDigest,
    environmentDigest: host.plan.environmentDigest,
    requestDigest: request.requestDigest,
    mergeId,
    branchCheckpoints,
  });
  recordOverhead(host, journal, verified.payload.metrics);
  const merge = succeeded
    ? mergePmExplorationBroadBranches(journal, {
        mergeId,
        outputMemoryDigest: verified.payload.outputMemoryDigest,
        conflictResolutionReceiptDigest: verified.receiptDigest,
      })
    : null;
  return deepFreeze({
    schema: PM_EXPLORATION_MERGE_RESULT_SCHEMA,
    merge,
    mergeReceipt: verified,
    budgetEnforced: true,
    receiptsAuthenticated: true,
    snapshotAuthenticated: false,
    qualifiesForPromotion: false,
  });
}

export async function evaluatePmExplorationMemory(hostValue, journal, input) {
  const host = HOSTS.get(hostValue);
  if (!host)
    throw new TypeError("a branded PM exploration execution host is required");
  exact(
    input,
    ["finalMemoryDigest", "mergeReceipt"],
    "PM exploration hosted evaluation",
  );
  const finalMemoryDigest = digest(
    input.finalMemoryDigest,
    "finalMemoryDigest",
  );
  const projection = inspectPmExplorationJournal(journal);
  if (
    projection.planDigest !== host.plan.planDigest ||
    projection.stage !== "deep" ||
    projection.activeRoundCount !== 0 ||
    projection.deepHead !== finalMemoryDigest ||
    projection.finalCheckpointDigest === null
  ) {
    throw new Error("PM exploration memory is not ready for evaluation");
  }
  const mergeReceipt = verifyPmExplorationReceipt(
    host.merger.authority,
    input.mergeReceipt,
    {
      planDigest: host.plan.planDigest,
      environmentDigest: host.plan.environmentDigest,
      status: "succeeded",
    },
  );
  if (projection.mergeReceiptDigest !== mergeReceipt.receiptDigest)
    throw new Error("PM exploration merge receipt differs from the journal");
  const core = {
    schema: PM_EXPLORATION_EVALUATION_REQUEST_SCHEMA,
    planDigest: host.plan.planDigest,
    environmentDigest: host.plan.environmentDigest,
    executionManifestDigest: host.manifest.manifestDigest,
    mergeDigest: projection.mergeDigest,
    mergeReceiptDigest: mergeReceipt.receiptDigest,
    finalCheckpointDigest: projection.finalCheckpointDigest,
    finalMemoryDigest,
  };
  const request = deepFreeze({
    ...core,
    requestDigest: hash(PM_EXPLORATION_EVALUATION_REQUEST_SCHEMA, core),
  });
  const outcome = await executePmExplorationBudgetedOperation({
    limits: remaining(host.plan, totalUsage(host, journal, projection)),
    operation: async (runtime) =>
      normalizedEvaluatorValue(await host.evaluator.handler(request, runtime)),
  });
  const evaluation =
    outcome.status === "succeeded"
      ? outcome.value
      : Object.freeze({
          decision: "unsafe",
          scoreBasisPoints: 0,
          evaluationDigest: outcome.traceDigest,
        });
  const receipt = host.evaluator.issue({
    planDigest: host.plan.planDigest,
    environmentDigest: host.plan.environmentDigest,
    requestDigest: request.requestDigest,
    mergeReceiptDigest: mergeReceipt.receiptDigest,
    finalCheckpointDigest: projection.finalCheckpointDigest,
    finalMemoryDigest,
    decision: evaluation.decision,
    scoreBasisPoints: evaluation.scoreBasisPoints,
    evaluationDigest: evaluation.evaluationDigest,
    metrics: outcome.metrics,
    issuedAt: isoTime(host.now),
  });
  const verified = verifyPmExplorationReceipt(
    host.evaluator.authority,
    receipt,
    {
      planDigest: host.plan.planDigest,
      environmentDigest: host.plan.environmentDigest,
      requestDigest: request.requestDigest,
      mergeReceiptDigest: mergeReceipt.receiptDigest,
      finalCheckpointDigest: projection.finalCheckpointDigest,
      finalMemoryDigest,
    },
  );
  recordOverhead(host, journal, verified.payload.metrics);
  const frozen =
    verified.payload.decision === "accept"
      ? freezePmExplorationMemory(journal, {
          finalMemoryDigest,
          evaluatorReceiptDigest: verified.receiptDigest,
        })
      : null;
  return deepFreeze({
    schema: PM_EXPLORATION_EVALUATION_RESULT_SCHEMA,
    frozen,
    evaluatorReceipt: verified,
    budgetEnforced: true,
    receiptsAuthenticated: true,
    snapshotAuthenticated: false,
    qualifiesForPromotion: false,
  });
}

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
  inspectPmExplorationEgressAuthority,
  invokePmExplorationModelEgress,
  PM_EXPLORATION_EGRESS_AUTHORITY_SCHEMA,
  retrievePmExplorationMemory,
} from "./pm-exploration-egress-authority.js";
import {
  getPmExplorationReceiptSignerAuthority,
  inspectPmExplorationReceiptAuthority,
  issuePmExplorationReceipt,
  verifyPmExplorationReceipt,
} from "./pm-exploration-receipts.js";
import { verifyPmExplorationVolcengineSettlementRecord } from "./pm-exploration-volcengine-provider.js";
import {
  createPmExplorationProcessGraderExecutor,
  inspectPmExplorationProcessGraderExecutor,
  invokePmExplorationProcessGrader,
  PM_EXPLORATION_GRADER_ISOLATION_SCHEMA,
} from "./pm-exploration-process-grader.js";
import {
  createPmExplorationProcessRunnerExecutor,
  inspectPmExplorationProcessRunnerExecutor,
  invokePmExplorationProcessRunner,
  PM_EXPLORATION_RUNNER_ISOLATION_SCHEMA,
  PM_EXPLORATION_RUNNER_ISOLATION_SCHEMA_V2,
} from "./pm-exploration-process-runner.js";
import {
  createPmExplorationProcessReviewerExecutor,
  inspectPmExplorationProcessReviewerExecutor,
  invokePmExplorationProcessReviewer,
  PM_EXPLORATION_CURRICULUM_ISOLATION_SCHEMA,
  PM_EXPLORATION_EVALUATOR_ISOLATION_SCHEMA,
  PM_EXPLORATION_MERGER_ISOLATION_SCHEMA,
} from "./pm-exploration-process-reviewer.js";

export const PM_EXPLORATION_EXECUTION_MANIFEST_SCHEMA_V2 =
  "chainlesschain.pm-exploration-execution-manifest/v2";
export const PM_EXPLORATION_EXECUTION_MANIFEST_SCHEMA_V3 =
  "chainlesschain.pm-exploration-execution-manifest/v3";
export const PM_EXPLORATION_EXECUTION_MANIFEST_SCHEMA_V4 =
  "chainlesschain.pm-exploration-execution-manifest/v4";
export const PM_EXPLORATION_EXECUTION_MANIFEST_SCHEMA_V5 =
  "chainlesschain.pm-exploration-execution-manifest/v5";
export const PM_EXPLORATION_EXECUTION_MANIFEST_SCHEMA_V6 =
  "chainlesschain.pm-exploration-execution-manifest/v6";
export const PM_EXPLORATION_EXECUTION_MANIFEST_SCHEMA =
  "chainlesschain.pm-exploration-execution-manifest/v7";
export const PM_EXPLORATION_RUN_REQUEST_SCHEMA =
  "chainlesschain.pm-exploration-run-request/v1";
export const PM_EXPLORATION_GRADE_REQUEST_SCHEMA_V1 =
  "chainlesschain.pm-exploration-grade-request/v1";
export const PM_EXPLORATION_GRADE_REQUEST_SCHEMA =
  "chainlesschain.pm-exploration-grade-request/v2";
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
export const PM_EXPLORATION_TASK_SELECTION_REQUEST_SCHEMA =
  "chainlesschain.pm-exploration-task-selection-request/v1";
export const PM_EXPLORATION_TASK_SELECTION_RESULT_SCHEMA =
  "chainlesschain.pm-exploration-task-selection-result/v1";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/u;
const RUNNERS = new WeakMap();
const GRADERS = new WeakMap();
const MERGERS = new WeakMap();
const EVALUATORS = new WeakMap();
const CURRICULA = new WeakMap();
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

function graderIsolationDescriptor(value) {
  exact(
    value,
    [
      "schema",
      "mode",
      "targetDigest",
      "targetAuthorityDigest",
      "handlerId",
      "handlerRevision",
      "operation",
      "handlerArtifactDigest",
      "supervisorAuthorityDigest",
      "maxWallClockMs",
    ],
    "graderIsolation",
  );
  if (
    value.schema !== PM_EXPLORATION_GRADER_ISOLATION_SCHEMA ||
    value.mode !== "process" ||
    value.operation !== "pm-exploration-grade"
  ) {
    throw new TypeError("graderIsolation descriptor is invalid");
  }
  return deepFreeze({
    schema: value.schema,
    mode: value.mode,
    targetDigest: digest(value.targetDigest, "graderIsolation.targetDigest"),
    targetAuthorityDigest: digest(
      value.targetAuthorityDigest,
      "graderIsolation.targetAuthorityDigest",
    ),
    handlerId: identifier(value.handlerId, "graderIsolation.handlerId"),
    handlerRevision: identifier(
      value.handlerRevision,
      "graderIsolation.handlerRevision",
    ),
    operation: value.operation,
    handlerArtifactDigest: digest(
      value.handlerArtifactDigest,
      "graderIsolation.handlerArtifactDigest",
    ),
    supervisorAuthorityDigest: digest(
      value.supervisorAuthorityDigest,
      "graderIsolation.supervisorAuthorityDigest",
    ),
    maxWallClockMs: integer(
      value.maxWallClockMs,
      "graderIsolation.maxWallClockMs",
      1,
      600_000,
    ),
  });
}

function runnerIsolationDescriptor(value) {
  exact(
    value,
    [
      "schema",
      "mode",
      "brokerMode",
      "targetDigest",
      "targetAuthorityDigest",
      "handlerId",
      "handlerRevision",
      "operation",
      "handlerArtifactDigest",
      "supervisorAuthorityDigest",
      "maxWallClockMs",
    ],
    "runnerIsolation",
  );
  if (
    ![
      PM_EXPLORATION_RUNNER_ISOLATION_SCHEMA,
      PM_EXPLORATION_RUNNER_ISOLATION_SCHEMA_V2,
    ].includes(value.schema) ||
    value.mode !== "process" ||
    (value.schema === PM_EXPLORATION_RUNNER_ISOLATION_SCHEMA
      ? value.brokerMode !== "parent-budgeted-tools"
      : value.brokerMode !== "parent-budgeted-tools-memory-model") ||
    value.operation !== "pm-exploration-run"
  ) {
    throw new TypeError("runnerIsolation descriptor is invalid");
  }
  return deepFreeze({
    schema: value.schema,
    mode: value.mode,
    brokerMode: value.brokerMode,
    targetDigest: digest(value.targetDigest, "runnerIsolation.targetDigest"),
    targetAuthorityDigest: digest(
      value.targetAuthorityDigest,
      "runnerIsolation.targetAuthorityDigest",
    ),
    handlerId: identifier(value.handlerId, "runnerIsolation.handlerId"),
    handlerRevision: identifier(
      value.handlerRevision,
      "runnerIsolation.handlerRevision",
    ),
    operation: value.operation,
    handlerArtifactDigest: digest(
      value.handlerArtifactDigest,
      "runnerIsolation.handlerArtifactDigest",
    ),
    supervisorAuthorityDigest: digest(
      value.supervisorAuthorityDigest,
      "runnerIsolation.supervisorAuthorityDigest",
    ),
    maxWallClockMs: integer(
      value.maxWallClockMs,
      "runnerIsolation.maxWallClockMs",
      1,
      600_000,
    ),
  });
}

function egressAuthorityDescriptor(value, kind, label) {
  exact(
    value,
    [
      "schema",
      "kind",
      "authorityId",
      "revision",
      "handlerArtifactDigest",
      "policyDigest",
      "authorityDigest",
    ],
    label,
  );
  if (
    value.schema !== PM_EXPLORATION_EGRESS_AUTHORITY_SCHEMA ||
    value.kind !== kind
  ) {
    throw new TypeError(`${label} descriptor is invalid`);
  }
  const core = deepFreeze({
    schema: value.schema,
    kind: value.kind,
    authorityId: identifier(value.authorityId, `${label}.authorityId`),
    revision: integer(value.revision, `${label}.revision`, 1),
    handlerArtifactDigest: digest(
      value.handlerArtifactDigest,
      `${label}.handlerArtifactDigest`,
    ),
    policyDigest: digest(value.policyDigest, `${label}.policyDigest`),
  });
  const normalized = deepFreeze({
    ...core,
    authorityDigest: hash(PM_EXPLORATION_EGRESS_AUTHORITY_SCHEMA, core),
  });
  if (normalized.authorityDigest !== value.authorityDigest)
    throw new Error(`${label} authority digest mismatch`);
  return normalized;
}

function reviewerIsolationDescriptor(value, kind) {
  const label = `${kind}Isolation`;
  const expected =
    kind === "merger"
      ? {
          operation: "pm-exploration-merge",
          schema: PM_EXPLORATION_MERGER_ISOLATION_SCHEMA,
        }
      : kind === "evaluator"
        ? {
            operation: "pm-exploration-evaluate",
            schema: PM_EXPLORATION_EVALUATOR_ISOLATION_SCHEMA,
          }
        : {
            operation: "pm-exploration-select-task",
            schema: PM_EXPLORATION_CURRICULUM_ISOLATION_SCHEMA,
          };
  exact(
    value,
    [
      "schema",
      "mode",
      "targetDigest",
      "targetAuthorityDigest",
      "handlerId",
      "handlerRevision",
      "operation",
      "handlerArtifactDigest",
      "supervisorAuthorityDigest",
      "maxWallClockMs",
    ],
    label,
  );
  if (
    value.schema !== expected.schema ||
    value.mode !== "process" ||
    value.operation !== expected.operation
  ) {
    throw new TypeError(`${label} descriptor is invalid`);
  }
  return deepFreeze({
    schema: value.schema,
    mode: value.mode,
    targetDigest: digest(value.targetDigest, `${label}.targetDigest`),
    targetAuthorityDigest: digest(
      value.targetAuthorityDigest,
      `${label}.targetAuthorityDigest`,
    ),
    handlerId: identifier(value.handlerId, `${label}.handlerId`),
    handlerRevision: identifier(
      value.handlerRevision,
      `${label}.handlerRevision`,
    ),
    operation: value.operation,
    handlerArtifactDigest: digest(
      value.handlerArtifactDigest,
      `${label}.handlerArtifactDigest`,
    ),
    supervisorAuthorityDigest: digest(
      value.supervisorAuthorityDigest,
      `${label}.supervisorAuthorityDigest`,
    ),
    maxWallClockMs: integer(
      value.maxWallClockMs,
      `${label}.maxWallClockMs`,
      1,
      600_000,
    ),
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
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    isProxy(input) ||
    Object.getPrototypeOf(input) !== Object.prototype
  ) {
    throw new TypeError(
      "PM exploration execution manifest must be a plain object",
    );
  }
  const hasRunnerIsolation = Reflect.ownKeys(input).includes("runnerIsolation");
  const hasGraderIsolation = Reflect.ownKeys(input).includes("graderIsolation");
  const hasMergerIsolation = Reflect.ownKeys(input).includes("mergerIsolation");
  const hasEvaluatorIsolation =
    Reflect.ownKeys(input).includes("evaluatorIsolation");
  const hasCurriculum = Reflect.ownKeys(input).includes("curriculum");
  const hasCurriculumIsolation = Reflect.ownKeys(input).includes(
    "curriculumIsolation",
  );
  const hasMemoryRetrieval = Reflect.ownKeys(input).includes("memoryRetrieval");
  const hasModelEgress = Reflect.ownKeys(input).includes("modelEgress");
  if (hasCurriculum !== hasCurriculumIsolation)
    throw new TypeError(
      "curriculum authority and isolation must be declared together",
    );
  if (hasMemoryRetrieval !== hasModelEgress)
    throw new TypeError(
      "memory retrieval and model egress authorities must be declared together",
    );
  const isolationFields = [
    ...(hasRunnerIsolation ? ["runnerIsolation"] : []),
    ...(hasGraderIsolation ? ["graderIsolation"] : []),
    ...(hasMergerIsolation ? ["mergerIsolation"] : []),
    ...(hasEvaluatorIsolation ? ["evaluatorIsolation"] : []),
  ];
  exact(
    input,
    [
      "planDigest",
      "environmentDigest",
      ...(hasCurriculum ? ["curriculum", "curriculumIsolation"] : []),
      ...(hasMemoryRetrieval ? ["memoryRetrieval", "modelEgress"] : []),
      "runner",
      ...isolationFields,
      "grader",
      "merger",
      "evaluator",
      "toolIds",
      "toolPolicyDigest",
      "preRunSealDigest",
    ],
    "PM exploration execution manifest",
  );
  const schema = hasMemoryRetrieval
    ? PM_EXPLORATION_EXECUTION_MANIFEST_SCHEMA
    : hasCurriculum
      ? PM_EXPLORATION_EXECUTION_MANIFEST_SCHEMA_V6
      : hasMergerIsolation || hasEvaluatorIsolation
        ? PM_EXPLORATION_EXECUTION_MANIFEST_SCHEMA_V5
        : hasRunnerIsolation
          ? PM_EXPLORATION_EXECUTION_MANIFEST_SCHEMA_V4
          : hasGraderIsolation
            ? PM_EXPLORATION_EXECUTION_MANIFEST_SCHEMA_V3
            : PM_EXPLORATION_EXECUTION_MANIFEST_SCHEMA_V2;
  const core = deepFreeze({
    schema,
    planDigest: digest(input.planDigest, "planDigest"),
    environmentDigest: digest(input.environmentDigest, "environmentDigest"),
    ...(hasCurriculum
      ? {
          curriculum: authorityDescriptor(
            input.curriculum,
            "curriculum",
            "curriculum",
          ),
          curriculumIsolation: reviewerIsolationDescriptor(
            input.curriculumIsolation,
            "curriculum",
          ),
        }
      : {}),
    ...(hasMemoryRetrieval
      ? {
          memoryRetrieval: egressAuthorityDescriptor(
            input.memoryRetrieval,
            "memory-retrieval",
            "memoryRetrieval",
          ),
          modelEgress: egressAuthorityDescriptor(
            input.modelEgress,
            "model-egress",
            "modelEgress",
          ),
        }
      : {}),
    runner: authorityDescriptor(input.runner, "execution", "runner"),
    ...(hasRunnerIsolation
      ? { runnerIsolation: runnerIsolationDescriptor(input.runnerIsolation) }
      : {}),
    grader: authorityDescriptor(input.grader, "grader", "grader"),
    ...(hasGraderIsolation
      ? { graderIsolation: graderIsolationDescriptor(input.graderIsolation) }
      : {}),
    merger: authorityDescriptor(input.merger, "merge", "merger"),
    ...(hasMergerIsolation
      ? {
          mergerIsolation: reviewerIsolationDescriptor(
            input.mergerIsolation,
            "merger",
          ),
        }
      : {}),
    evaluator: authorityDescriptor(input.evaluator, "evaluator", "evaluator"),
    ...(hasEvaluatorIsolation
      ? {
          evaluatorIsolation: reviewerIsolationDescriptor(
            input.evaluatorIsolation,
            "evaluator",
          ),
        }
      : {}),
    toolIds: toolIds(input.toolIds),
    toolPolicyDigest: digest(input.toolPolicyDigest, "toolPolicyDigest"),
    preRunSealDigest: digest(input.preRunSealDigest, "preRunSealDigest"),
  });
  const authorities = [
    ...(hasCurriculum ? [core.curriculum] : []),
    core.runner,
    core.grader,
    core.merger,
    core.evaluator,
  ];
  if (
    new Set(authorities.map((entry) => entry.authorityId)).size !==
      authorities.length ||
    new Set(authorities.map((entry) => entry.publicKeyDigest)).size !==
      authorities.length
  )
    throw new TypeError("PM receipt roles must use independent authorities");
  if (
    hasMemoryRetrieval &&
    (core.memoryRetrieval.authorityId === core.modelEgress.authorityId ||
      core.memoryRetrieval.handlerArtifactDigest ===
        core.modelEgress.handlerArtifactDigest ||
      authorities.some(
        (entry) =>
          entry.authorityId === core.memoryRetrieval.authorityId ||
          entry.authorityId === core.modelEgress.authorityId,
      ))
  ) {
    throw new TypeError(
      "PM egress and receipt roles must use independent authorities",
    );
  }
  if (
    hasMemoryRetrieval !==
    (core.runnerIsolation?.schema === PM_EXPLORATION_RUNNER_ISOLATION_SCHEMA_V2)
  ) {
    throw new TypeError(
      "governed PM egress and its brokered process runner must be paired",
    );
  }
  return deepFreeze({
    ...core,
    manifestDigest: hash(schema, core),
  });
}

export function verifyPmExplorationExecutionManifest(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(
      "PM exploration execution manifest envelope must be a plain object",
    );
  }
  const hasRunnerIsolation = Reflect.ownKeys(value).includes("runnerIsolation");
  const hasGraderIsolation = Reflect.ownKeys(value).includes("graderIsolation");
  const hasMergerIsolation = Reflect.ownKeys(value).includes("mergerIsolation");
  const hasEvaluatorIsolation =
    Reflect.ownKeys(value).includes("evaluatorIsolation");
  const hasCurriculum = Reflect.ownKeys(value).includes("curriculum");
  const hasCurriculumIsolation = Reflect.ownKeys(value).includes(
    "curriculumIsolation",
  );
  const hasMemoryRetrieval = Reflect.ownKeys(value).includes("memoryRetrieval");
  const hasModelEgress = Reflect.ownKeys(value).includes("modelEgress");
  if (
    hasCurriculum !== hasCurriculumIsolation ||
    hasMemoryRetrieval !== hasModelEgress
  ) {
    throw new TypeError("PM exploration manifest authority pairing is invalid");
  }
  if (
    (value.schema === PM_EXPLORATION_EXECUTION_MANIFEST_SCHEMA_V2 &&
      (hasRunnerIsolation ||
        hasGraderIsolation ||
        hasMergerIsolation ||
        hasEvaluatorIsolation ||
        hasCurriculum ||
        hasCurriculumIsolation ||
        hasMemoryRetrieval ||
        hasModelEgress)) ||
    (value.schema === PM_EXPLORATION_EXECUTION_MANIFEST_SCHEMA_V3 &&
      (hasRunnerIsolation ||
        !hasGraderIsolation ||
        hasMergerIsolation ||
        hasEvaluatorIsolation ||
        hasCurriculum ||
        hasCurriculumIsolation ||
        hasMemoryRetrieval ||
        hasModelEgress)) ||
    (value.schema === PM_EXPLORATION_EXECUTION_MANIFEST_SCHEMA_V4 &&
      (!hasRunnerIsolation ||
        hasMergerIsolation ||
        hasEvaluatorIsolation ||
        hasCurriculum ||
        hasCurriculumIsolation ||
        hasMemoryRetrieval ||
        hasModelEgress)) ||
    (value.schema === PM_EXPLORATION_EXECUTION_MANIFEST_SCHEMA_V5 &&
      (hasCurriculum ||
        hasCurriculumIsolation ||
        hasMemoryRetrieval ||
        hasModelEgress ||
        (!hasMergerIsolation && !hasEvaluatorIsolation))) ||
    (value.schema === PM_EXPLORATION_EXECUTION_MANIFEST_SCHEMA_V6 &&
      (!hasCurriculum ||
        !hasCurriculumIsolation ||
        hasMemoryRetrieval ||
        hasModelEgress)) ||
    (value.schema === PM_EXPLORATION_EXECUTION_MANIFEST_SCHEMA &&
      (!hasMemoryRetrieval || !hasModelEgress))
  ) {
    throw new TypeError("PM exploration manifest isolation schema is invalid");
  }
  const isolationFields = [
    ...(hasRunnerIsolation ? ["runnerIsolation"] : []),
    ...(hasGraderIsolation ? ["graderIsolation"] : []),
    ...(hasMergerIsolation ? ["mergerIsolation"] : []),
    ...(hasEvaluatorIsolation ? ["evaluatorIsolation"] : []),
  ];
  exact(
    value,
    [
      "schema",
      "planDigest",
      "environmentDigest",
      ...(hasCurriculum ? ["curriculum", "curriculumIsolation"] : []),
      ...(hasMemoryRetrieval ? ["memoryRetrieval", "modelEgress"] : []),
      "runner",
      ...isolationFields,
      "grader",
      "merger",
      "evaluator",
      "toolIds",
      "toolPolicyDigest",
      "preRunSealDigest",
      "manifestDigest",
    ],
    "PM exploration execution manifest envelope",
  );
  if (
    value.schema !== PM_EXPLORATION_EXECUTION_MANIFEST_SCHEMA &&
    value.schema !== PM_EXPLORATION_EXECUTION_MANIFEST_SCHEMA_V6 &&
    value.schema !== PM_EXPLORATION_EXECUTION_MANIFEST_SCHEMA_V5 &&
    value.schema !== PM_EXPLORATION_EXECUTION_MANIFEST_SCHEMA_V4 &&
    value.schema !== PM_EXPLORATION_EXECUTION_MANIFEST_SCHEMA_V3 &&
    value.schema !== PM_EXPLORATION_EXECUTION_MANIFEST_SCHEMA_V2
  )
    throw new TypeError("PM exploration execution manifest schema is invalid");
  const normalized = createPmExplorationExecutionManifest({
    planDigest: value.planDigest,
    environmentDigest: value.environmentDigest,
    ...(hasCurriculum
      ? {
          curriculum: value.curriculum,
          curriculumIsolation: value.curriculumIsolation,
        }
      : {}),
    ...(hasMemoryRetrieval
      ? {
          memoryRetrieval: value.memoryRetrieval,
          modelEgress: value.modelEgress,
        }
      : {}),
    runner: value.runner,
    ...(hasRunnerIsolation ? { runnerIsolation: value.runnerIsolation } : {}),
    grader: value.grader,
    ...(hasGraderIsolation ? { graderIsolation: value.graderIsolation } : {}),
    merger: value.merger,
    ...(hasMergerIsolation ? { mergerIsolation: value.mergerIsolation } : {}),
    evaluator: value.evaluator,
    ...(hasEvaluatorIsolation
      ? { evaluatorIsolation: value.evaluatorIsolation }
      : {}),
    toolIds: value.toolIds,
    toolPolicyDigest: value.toolPolicyDigest,
    preRunSealDigest: value.preRunSealDigest,
  });
  if (canonical(normalized) !== canonical(value))
    throw new Error("PM exploration execution manifest digest mismatch");
  return normalized;
}

function createProvider({
  signer,
  handler,
  prepare = null,
  isolation = null,
  consumeIsolationEvidence = null,
  consumeEgressEvidence = null,
  expectedRole,
  bindings,
  label,
}) {
  if (typeof handler !== "function" || isProxy(handler))
    throw new TypeError(`${label} handler must be a direct function`);
  if (prepare !== null && (typeof prepare !== "function" || isProxy(prepare)))
    throw new TypeError(`${label} prepare hook must be a direct function`);
  if (
    consumeIsolationEvidence !== null &&
    (typeof consumeIsolationEvidence !== "function" ||
      isProxy(consumeIsolationEvidence))
  ) {
    throw new TypeError(`${label} isolation evidence port must be direct`);
  }
  if (
    consumeEgressEvidence !== null &&
    (typeof consumeEgressEvidence !== "function" ||
      isProxy(consumeEgressEvidence))
  ) {
    throw new TypeError(`${label} egress evidence port must be direct`);
  }
  const descriptor = inspectPmExplorationReceiptAuthority(signer);
  if (descriptor.role !== expectedRole)
    throw new TypeError(`${label} signer has the wrong receipt role`);
  const provider = Object.freeze({});
  bindings.set(provider, {
    authority: getPmExplorationReceiptSignerAuthority(signer),
    consumeEgressEvidence,
    consumeIsolationEvidence,
    descriptor,
    handler,
    isolation,
    prepare,
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

export function createPmExplorationProcessRunner(options = {}) {
  if (
    !options ||
    typeof options !== "object" ||
    Array.isArray(options) ||
    isProxy(options) ||
    Object.getPrototypeOf(options) !== Object.prototype
  ) {
    throw new TypeError(
      "PM exploration process runner options must be a plain object",
    );
  }
  const hasNow = Reflect.ownKeys(options).includes("now");
  const hasEgressBrokered = Reflect.ownKeys(options).includes("egressBrokered");
  exact(
    options,
    [
      "signer",
      "supervisor",
      "target",
      "maxWallClockMs",
      ...(hasNow ? ["now"] : []),
      ...(hasEgressBrokered ? ["egressBrokered"] : []),
    ],
    "PM exploration process runner options",
  );
  const executor = createPmExplorationProcessRunnerExecutor({
    supervisor: options.supervisor,
    target: options.target,
    maxWallClockMs: options.maxWallClockMs,
    ...(hasNow ? { now: options.now } : {}),
    ...(hasEgressBrokered ? { egressBrokered: options.egressBrokered } : {}),
  });
  const evidence = new Map();
  return createProvider({
    signer: options.signer,
    handler: async (request, runtime) => {
      const result = await invokePmExplorationProcessRunner(
        executor,
        request,
        runtime,
      );
      if (evidence.has(request.requestDigest))
        throw new Error("process runner isolation evidence was replayed");
      evidence.set(
        request.requestDigest,
        Object.freeze({
          supervisionReceiptDigest: result.supervisionReceiptDigest,
          egressEvidenceDigest: result.egressEvidenceDigest ?? null,
        }),
      );
      return result.value;
    },
    isolation: inspectPmExplorationProcessRunnerExecutor(executor),
    consumeIsolationEvidence: (requestDigest) => {
      const value = evidence.get(requestDigest) ?? null;
      if (value?.egressEvidenceDigest === null) evidence.delete(requestDigest);
      return value?.supervisionReceiptDigest ?? null;
    },
    consumeEgressEvidence: (requestDigest) => {
      const value = evidence.get(requestDigest)?.egressEvidenceDigest ?? null;
      evidence.delete(requestDigest);
      return value;
    },
    expectedRole: "execution",
    bindings: RUNNERS,
    label: "PM exploration process runner",
  });
}

export function inspectPmExplorationRunnerIsolation(value) {
  const runner = RUNNERS.get(value);
  if (!runner)
    throw new TypeError("a branded PM exploration runner is required");
  return runner.isolation;
}

export function createPmExplorationGrader(options = {}) {
  if (
    !options ||
    typeof options !== "object" ||
    Array.isArray(options) ||
    isProxy(options) ||
    Object.getPrototypeOf(options) !== Object.prototype
  ) {
    throw new TypeError("PM exploration grader options must be a plain object");
  }
  const hasPrepare = Reflect.ownKeys(options).includes("prepare");
  exact(
    options,
    hasPrepare ? ["signer", "prepare", "grade"] : ["signer", "grade"],
    "PM exploration grader options",
  );
  return createProvider({
    signer: options.signer,
    handler: options.grade,
    prepare: hasPrepare ? options.prepare : null,
    expectedRole: "grader",
    bindings: GRADERS,
    label: "PM exploration grader",
  });
}

export function createPmExplorationProcessGrader(options = {}) {
  if (
    !options ||
    typeof options !== "object" ||
    Array.isArray(options) ||
    isProxy(options) ||
    Object.getPrototypeOf(options) !== Object.prototype
  ) {
    throw new TypeError(
      "PM exploration process grader options must be a plain object",
    );
  }
  const hasNow = Reflect.ownKeys(options).includes("now");
  exact(
    options,
    hasNow
      ? ["signer", "supervisor", "target", "maxWallClockMs", "now"]
      : ["signer", "supervisor", "target", "maxWallClockMs"],
    "PM exploration process grader options",
  );
  const executor = createPmExplorationProcessGraderExecutor({
    supervisor: options.supervisor,
    target: options.target,
    maxWallClockMs: options.maxWallClockMs,
    ...(hasNow ? { now: options.now } : {}),
  });
  return createProvider({
    signer: options.signer,
    handler: (request, runtime) =>
      invokePmExplorationProcessGrader(executor, request, runtime),
    isolation: inspectPmExplorationProcessGraderExecutor(executor),
    expectedRole: "grader",
    bindings: GRADERS,
    label: "PM exploration process grader",
  });
}

export function inspectPmExplorationGraderIsolation(value) {
  const grader = GRADERS.get(value);
  if (!grader)
    throw new TypeError("a branded PM exploration grader is required");
  return grader.isolation;
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

export function createPmExplorationProcessMerger(options = {}) {
  if (
    !options ||
    typeof options !== "object" ||
    Array.isArray(options) ||
    isProxy(options) ||
    Object.getPrototypeOf(options) !== Object.prototype
  ) {
    throw new TypeError(
      "PM exploration process merger options must be a plain object",
    );
  }
  const hasNow = Reflect.ownKeys(options).includes("now");
  exact(
    options,
    hasNow
      ? ["signer", "supervisor", "target", "maxWallClockMs", "now"]
      : ["signer", "supervisor", "target", "maxWallClockMs"],
    "PM exploration process merger options",
  );
  const executor = createPmExplorationProcessReviewerExecutor({
    kind: "merge",
    supervisor: options.supervisor,
    target: options.target,
    maxWallClockMs: options.maxWallClockMs,
    ...(hasNow ? { now: options.now } : {}),
  });
  const evidence = new Map();
  return createProvider({
    signer: options.signer,
    handler: async (request, runtime) => {
      const result = await invokePmExplorationProcessReviewer(
        executor,
        request,
        runtime,
      );
      if (evidence.has(request.requestDigest))
        throw new Error("process merger isolation evidence was replayed");
      evidence.set(request.requestDigest, result.supervisionReceiptDigest);
      return result.value;
    },
    isolation: inspectPmExplorationProcessReviewerExecutor(executor),
    consumeIsolationEvidence: (requestDigest) => {
      const value = evidence.get(requestDigest) ?? null;
      evidence.delete(requestDigest);
      return value;
    },
    expectedRole: "merge",
    bindings: MERGERS,
    label: "PM exploration process merger",
  });
}

export function inspectPmExplorationMergerIsolation(value) {
  const merger = MERGERS.get(value);
  if (!merger)
    throw new TypeError("a branded PM exploration merger is required");
  return merger.isolation;
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

export function createPmExplorationProcessEvaluator(options = {}) {
  if (
    !options ||
    typeof options !== "object" ||
    Array.isArray(options) ||
    isProxy(options) ||
    Object.getPrototypeOf(options) !== Object.prototype
  ) {
    throw new TypeError(
      "PM exploration process evaluator options must be a plain object",
    );
  }
  const hasNow = Reflect.ownKeys(options).includes("now");
  exact(
    options,
    hasNow
      ? ["signer", "supervisor", "target", "maxWallClockMs", "now"]
      : ["signer", "supervisor", "target", "maxWallClockMs"],
    "PM exploration process evaluator options",
  );
  const executor = createPmExplorationProcessReviewerExecutor({
    kind: "evaluate",
    supervisor: options.supervisor,
    target: options.target,
    maxWallClockMs: options.maxWallClockMs,
    ...(hasNow ? { now: options.now } : {}),
  });
  const evidence = new Map();
  return createProvider({
    signer: options.signer,
    handler: async (request, runtime) => {
      const result = await invokePmExplorationProcessReviewer(
        executor,
        request,
        runtime,
      );
      if (evidence.has(request.requestDigest))
        throw new Error("process evaluator isolation evidence was replayed");
      evidence.set(request.requestDigest, result.supervisionReceiptDigest);
      return result.value;
    },
    isolation: inspectPmExplorationProcessReviewerExecutor(executor),
    consumeIsolationEvidence: (requestDigest) => {
      const value = evidence.get(requestDigest) ?? null;
      evidence.delete(requestDigest);
      return value;
    },
    expectedRole: "evaluator",
    bindings: EVALUATORS,
    label: "PM exploration process evaluator",
  });
}

export function inspectPmExplorationEvaluatorIsolation(value) {
  const evaluator = EVALUATORS.get(value);
  if (!evaluator)
    throw new TypeError("a branded PM exploration evaluator is required");
  return evaluator.isolation;
}

export function createPmExplorationProcessCurriculum(options = {}) {
  if (
    !options ||
    typeof options !== "object" ||
    Array.isArray(options) ||
    isProxy(options) ||
    Object.getPrototypeOf(options) !== Object.prototype
  ) {
    throw new TypeError(
      "PM exploration process curriculum options must be a plain object",
    );
  }
  const hasNow = Reflect.ownKeys(options).includes("now");
  exact(
    options,
    hasNow
      ? ["signer", "supervisor", "target", "maxWallClockMs", "now"]
      : ["signer", "supervisor", "target", "maxWallClockMs"],
    "PM exploration process curriculum options",
  );
  const executor = createPmExplorationProcessReviewerExecutor({
    kind: "curriculum",
    supervisor: options.supervisor,
    target: options.target,
    maxWallClockMs: options.maxWallClockMs,
    ...(hasNow ? { now: options.now } : {}),
  });
  const evidence = new Map();
  return createProvider({
    signer: options.signer,
    handler: async (request, runtime) => {
      const result = await invokePmExplorationProcessReviewer(
        executor,
        request,
        runtime,
      );
      if (evidence.has(request.requestDigest))
        throw new Error("process curriculum isolation evidence was replayed");
      evidence.set(request.requestDigest, result.supervisionReceiptDigest);
      return result.value;
    },
    isolation: inspectPmExplorationProcessReviewerExecutor(executor),
    consumeIsolationEvidence: (requestDigest) => {
      const value = evidence.get(requestDigest) ?? null;
      evidence.delete(requestDigest);
      return value;
    },
    expectedRole: "curriculum",
    bindings: CURRICULA,
    label: "PM exploration process curriculum",
  });
}

export function inspectPmExplorationCurriculumIsolation(value) {
  const curriculum = CURRICULA.get(value);
  if (!curriculum)
    throw new TypeError("a branded PM exploration curriculum is required");
  return curriculum.isolation;
}

function snapshotPlan(value) {
  verifyPmExplorationPlan(value);
  return deepFreeze(structuredClone(value));
}

export function createPmExplorationExecutionHost(options = {}) {
  const hasCurriculum =
    options &&
    typeof options === "object" &&
    Reflect.ownKeys(options).includes("curriculum");
  const hasMemoryRetrieval =
    options &&
    typeof options === "object" &&
    Reflect.ownKeys(options).includes("memoryRetrieval");
  const hasModelEgress =
    options &&
    typeof options === "object" &&
    Reflect.ownKeys(options).includes("modelEgress");
  if (hasMemoryRetrieval !== hasModelEgress)
    throw new TypeError(
      "PM exploration host memory and model egress ports must be paired",
    );
  exact(
    options,
    [
      "plan",
      "manifest",
      ...(hasCurriculum ? ["curriculum"] : []),
      ...(hasMemoryRetrieval ? ["memoryRetrieval", "modelEgress"] : []),
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
  const curriculum = hasCurriculum ? CURRICULA.get(options.curriculum) : null;
  const memoryRetrieval = hasMemoryRetrieval
    ? inspectPmExplorationEgressAuthority(options.memoryRetrieval)
    : null;
  const modelEgress = hasModelEgress
    ? inspectPmExplorationEgressAuthority(options.modelEgress)
    : null;
  const runner = RUNNERS.get(options.runner);
  const grader = GRADERS.get(options.grader);
  const merger = MERGERS.get(options.merger);
  const evaluator = EVALUATORS.get(options.evaluator);
  if (
    !runner ||
    !grader ||
    !merger ||
    !evaluator ||
    (hasCurriculum && !curriculum)
  )
    throw new TypeError("branded PM exploration providers are required");
  if (hasCurriculum !== Object.hasOwn(manifest, "curriculum"))
    throw new Error("PM exploration curriculum differs from the manifest");
  if (hasMemoryRetrieval !== Object.hasOwn(manifest, "memoryRetrieval"))
    throw new Error("PM exploration egress differs from the manifest");
  if (
    manifest.planDigest !== plan.planDigest ||
    manifest.environmentDigest !== plan.environmentDigest
  ) {
    throw new Error("PM exploration manifest differs from its plan");
  }
  if (
    hasMemoryRetrieval &&
    (canonical(manifest.memoryRetrieval) !== canonical(memoryRetrieval) ||
      canonical(manifest.modelEgress) !== canonical(modelEgress))
  ) {
    throw new Error(
      "PM exploration egress authorities differ from the manifest",
    );
  }
  if (
    canonical(manifest.runner) !== canonical(runner.descriptor) ||
    canonical(manifest.grader) !== canonical(grader.descriptor) ||
    canonical(manifest.merger) !== canonical(merger.descriptor) ||
    canonical(manifest.evaluator) !== canonical(evaluator.descriptor)
  ) {
    throw new Error("PM exploration providers differ from the manifest");
  }
  if (
    hasCurriculum &&
    (canonical(manifest.curriculum) !== canonical(curriculum.descriptor) ||
      canonical(manifest.curriculumIsolation) !==
        canonical(curriculum.isolation))
  ) {
    throw new Error("PM exploration curriculum differs from the manifest");
  }
  const manifestIsolation = manifest.graderIsolation ?? null;
  if (canonical(manifestIsolation) !== canonical(grader.isolation))
    throw new Error(
      "PM exploration grader isolation differs from the manifest",
    );
  const manifestRunnerIsolation = manifest.runnerIsolation ?? null;
  if (canonical(manifestRunnerIsolation) !== canonical(runner.isolation))
    throw new Error(
      "PM exploration runner isolation differs from the manifest",
    );
  if (
    hasMemoryRetrieval &&
    runner.isolation?.schema !== PM_EXPLORATION_RUNNER_ISOLATION_SCHEMA_V2
  ) {
    throw new Error(
      "PM exploration egress requires the brokered process runner",
    );
  }
  const manifestMergerIsolation = manifest.mergerIsolation ?? null;
  if (canonical(manifestMergerIsolation) !== canonical(merger.isolation))
    throw new Error(
      "PM exploration merger isolation differs from the manifest",
    );
  const manifestEvaluatorIsolation = manifest.evaluatorIsolation ?? null;
  if (canonical(manifestEvaluatorIsolation) !== canonical(evaluator.isolation))
    throw new Error(
      "PM exploration evaluator isolation differs from the manifest",
    );
  if (typeof options.invokeTool !== "function" || isProxy(options.invokeTool))
    throw new TypeError("PM exploration host requires a direct tool broker");
  if (typeof options.now !== "function" || isProxy(options.now))
    throw new TypeError("PM exploration host requires a direct clock");
  const host = Object.freeze({});
  HOSTS.set(host, {
    curriculum,
    grader,
    evaluator,
    invokeTool: options.invokeTool,
    manifest,
    merger,
    memoryRetrievalAuthority: hasMemoryRetrieval
      ? options.memoryRetrieval
      : null,
    modelEgressAuthority: hasModelEgress ? options.modelEgress : null,
    now: options.now,
    plan,
    runner,
    overhead: new WeakMap(),
    selections: new WeakMap(),
  });
  return host;
}

export function isPmExplorationExecutionHost(value) {
  return HOSTS.has(value);
}

export function inspectPmExplorationExecutionHost(value) {
  const host = HOSTS.get(value);
  if (!host)
    throw new TypeError("a branded PM exploration execution host is required");
  return Object.freeze({
    planDigest: host.plan.planDigest,
    environmentDigest: host.plan.environmentDigest,
    manifestDigest: host.manifest.manifestDigest,
    preRunSealDigest: host.manifest.preRunSealDigest,
    ...(host.curriculum === null
      ? {}
      : { curriculumIsolation: host.curriculum.isolation }),
    ...(host.runner.isolation === null
      ? {}
      : { runnerIsolation: host.runner.isolation }),
    ...(host.grader.isolation === null
      ? {}
      : { graderIsolation: host.grader.isolation }),
    ...(host.merger.isolation === null
      ? {}
      : { mergerIsolation: host.merger.isolation }),
    ...(host.evaluator.isolation === null
      ? {}
      : { evaluatorIsolation: host.evaluator.isolation }),
  });
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

function settleOverhead(host, journal, metrics) {
  const current = overheadFor(host, journal);
  const next = {};
  for (const key of ["tokens", "toolCalls", "wallClockMs"]) {
    if (metrics[key] > current[key])
      throw new Error(`PM exploration ${key} overhead settlement underflow`);
    next[key] = current[key] - metrics[key];
  }
  const settled = Object.freeze(next);
  host.overhead.set(journal, settled);
  return settled;
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

async function runActor(binding, request, limits, host, prepare) {
  const egressContext = Object.freeze({
    planDigest: host.plan.planDigest,
    environmentDigest: host.plan.environmentDigest,
    executionManifestDigest: host.manifest.manifestDigest,
    roundId: request.roundId,
    stage: request.stage,
    branchId: request.branchId,
    taskId: request.taskId,
    inputMemoryDigest: request.inputMemoryDigest,
  });
  const outcome = await executePmExplorationBudgetedOperation({
    limits,
    allowedToolIds: host.manifest.toolIds,
    invokeTool: host.invokeTool,
    retrieveMemory:
      host.memoryRetrievalAuthority === null
        ? null
        : ({ request: retrievalRequest, signal, remainingTokens }) =>
            retrievePmExplorationMemory(
              host.memoryRetrievalAuthority,
              egressContext,
              retrievalRequest,
              { signal, remainingTokens },
            ),
    invokeModel:
      host.modelEgressAuthority === null
        ? null
        : ({ request: modelRequest, signal, remainingTokens }) =>
            invokePmExplorationModelEgress(
              host.modelEgressAuthority,
              egressContext,
              modelRequest,
              { signal, remainingTokens },
            ),
    operation: async (runtime) => {
      if (prepare !== null) {
        await prepare(request, runtime.signal);
        if (runtime.signal.aborted)
          throw (
            runtime.signal.reason ?? new Error("grader prepare was aborted")
          );
      }
      return normalizedRunnerValue(await binding.handler(request, runtime));
    },
  });
  const succeeded = outcome.status === "succeeded";
  const runnerIsolationEvidenceDigest =
    binding.consumeIsolationEvidence === null
      ? null
      : binding.consumeIsolationEvidence(request.requestDigest);
  const egressEvidenceDigest =
    host.memoryRetrievalAuthority === null
      ? null
      : (binding.consumeEgressEvidence?.(request.requestDigest) ?? null);
  if (succeeded && binding.isolation !== null) {
    digest(runnerIsolationEvidenceDigest, "runnerIsolationEvidenceDigest");
  }
  if (succeeded && host.memoryRetrievalAuthority !== null)
    digest(egressEvidenceDigest, "egressEvidenceDigest");
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
    ...(binding.isolation === null
      ? {}
      : {
          runnerIsolationEvidenceDigest: succeeded
            ? runnerIsolationEvidenceDigest
            : null,
        }),
    ...(host.memoryRetrievalAuthority === null
      ? {}
      : {
          egressEvidenceDigest: succeeded ? egressEvidenceDigest : null,
        }),
    metrics: outcome.metrics,
    issuedAt: isoTime(host.now),
  };
  return Object.freeze({
    receipt: binding.issue(payload),
    providerSettlement: succeeded ? outcome.value.providerSettlement : null,
    runnerIsolationEvidenceDigest:
      succeeded && binding.isolation !== null
        ? runnerIsolationEvidenceDigest
        : null,
    egressEvidenceDigest:
      succeeded && host.memoryRetrievalAuthority !== null
        ? egressEvidenceDigest
        : null,
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

function normalizedCurriculumValue(value) {
  exact(
    value,
    ["taskId", "rationaleDigest"],
    "PM exploration curriculum result",
  );
  return Object.freeze({
    taskId: identifier(value.taskId, "taskId"),
    rationaleDigest: digest(value.rationaleDigest, "rationaleDigest"),
  });
}

function validateTaskSelectionPosition(host, projection, input) {
  if (
    projection.planDigest !== host.plan.planDigest ||
    projection.activeRoundCount !== 0 ||
    projection.stopReason !== null
  ) {
    throw new Error("PM exploration journal is not ready for task selection");
  }
  if (input.stage === "broad") {
    if (projection.stage !== "broad")
      throw new Error("PM exploration broad selection stage is invalid");
    const branch = projection.branchHeads.find(
      (entry) => entry.branchId === input.branchId,
    );
    if (!branch || branch.memoryDigest !== input.inputMemoryDigest)
      throw new Error("PM exploration broad selection memory is invalid");
    return;
  }
  if (
    input.stage !== "deep" ||
    input.branchId !== null ||
    projection.stage !== "deep" ||
    projection.deepHead !== input.inputMemoryDigest
  ) {
    throw new Error("PM exploration deep selection position is invalid");
  }
}

export async function selectPmExplorationTask(hostValue, journal, input) {
  const host = HOSTS.get(hostValue);
  if (!host)
    throw new TypeError("a branded PM exploration execution host is required");
  if (host.curriculum === null)
    throw new Error("PM exploration host has no curriculum provider");
  exact(
    input,
    ["selectionId", "roundId", "stage", "branchId", "inputMemoryDigest"],
    "PM exploration task selection",
  );
  const selectionInput = Object.freeze({
    selectionId: identifier(input.selectionId, "selectionId"),
    roundId: identifier(input.roundId, "roundId"),
    stage: input.stage,
    branchId: input.branchId,
    inputMemoryDigest: digest(input.inputMemoryDigest, "inputMemoryDigest"),
  });
  const projection = inspectPmExplorationJournal(journal);
  validateTaskSelectionPosition(host, projection, selectionInput);
  const selections = host.selections.get(journal) ?? new Map();
  if (selections.size !== 0)
    throw new Error("PM exploration journal has a pending task selection");
  const core = {
    schema: PM_EXPLORATION_TASK_SELECTION_REQUEST_SCHEMA,
    planDigest: host.plan.planDigest,
    suiteDigest: host.plan.suiteDigest,
    trainingPartitionDigest: host.plan.trainingPartitionDigest,
    environmentDigest: host.plan.environmentDigest,
    executionManifestDigest: host.manifest.manifestDigest,
    ...selectionInput,
    candidateTaskIds: host.plan.trainingTaskIds,
    completedRoundCount: projection.checkpointDigests.length,
    consecutiveNoGain: projection.consecutiveNoGain,
  };
  const request = deepFreeze({
    ...core,
    requestDigest: hash(PM_EXPLORATION_TASK_SELECTION_REQUEST_SCHEMA, core),
  });
  const outcome = await executePmExplorationBudgetedOperation({
    limits: remaining(host.plan, totalUsage(host, journal, projection)),
    operation: async (runtime) =>
      normalizedCurriculumValue(
        await host.curriculum.handler(request, runtime),
      ),
  });
  const consumedIsolationEvidence =
    host.curriculum.consumeIsolationEvidence?.(request.requestDigest) ?? null;
  const succeeded =
    outcome.status === "succeeded" &&
    host.plan.trainingTaskIds.includes(outcome.value.taskId);
  const curriculumIsolationEvidenceDigest = succeeded
    ? consumedIsolationEvidence
    : null;
  if (succeeded)
    digest(
      curriculumIsolationEvidenceDigest,
      "curriculumIsolationEvidenceDigest",
    );
  const status =
    outcome.status === "succeeded" && !succeeded ? "failed" : outcome.status;
  const failureClass =
    outcome.status === "succeeded" && !succeeded
      ? "infrastructure"
      : outcome.failureClass;
  const receipt = host.curriculum.issue({
    planDigest: host.plan.planDigest,
    environmentDigest: host.plan.environmentDigest,
    executionManifestDigest: host.manifest.manifestDigest,
    requestDigest: request.requestDigest,
    ...selectionInput,
    taskId: succeeded ? outcome.value.taskId : null,
    rationaleDigest: succeeded
      ? outcome.value.rationaleDigest
      : outcome.traceDigest,
    status,
    failureClass,
    curriculumIsolationEvidenceDigest,
    metrics: outcome.metrics,
    issuedAt: isoTime(host.now),
  });
  const verified = verifyPmExplorationReceipt(
    host.curriculum.authority,
    receipt,
    {
      planDigest: host.plan.planDigest,
      environmentDigest: host.plan.environmentDigest,
      executionManifestDigest: host.manifest.manifestDigest,
      requestDigest: request.requestDigest,
      selectionId: selectionInput.selectionId,
      roundId: selectionInput.roundId,
      stage: selectionInput.stage,
      branchId: selectionInput.branchId,
      inputMemoryDigest: selectionInput.inputMemoryDigest,
    },
  );
  recordOverhead(host, journal, verified.payload.metrics);
  if (succeeded) {
    selections.set(
      selectionInput.roundId,
      Object.freeze({
        receiptDigest: verified.receiptDigest,
        metrics: verified.payload.metrics,
      }),
    );
    host.selections.set(journal, selections);
  }
  return deepFreeze({
    schema: PM_EXPLORATION_TASK_SELECTION_RESULT_SCHEMA,
    selection: succeeded
      ? Object.freeze({
          taskId: verified.payload.taskId,
          selectionReceiptDigest: verified.receiptDigest,
        })
      : null,
    curriculumReceipt: verified,
    curriculumIsolationEvidenceDigest,
    budgetEnforced: true,
    receiptsAuthenticated: true,
    snapshotAuthenticated: false,
    qualifiesForPromotion: false,
  });
}

export async function executePmExplorationRound(hostValue, journal, input) {
  const host = HOSTS.get(hostValue);
  if (!host)
    throw new TypeError("a branded PM exploration execution host is required");
  exact(
    input,
    [
      "roundId",
      "stage",
      "branchId",
      "taskId",
      "inputMemoryDigest",
      ...(host.curriculum === null ? [] : ["taskSelectionReceipt"]),
    ],
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
  let curriculumMetrics = Object.freeze({
    tokens: 0,
    toolCalls: 0,
    wallClockMs: 0,
  });
  if (host.curriculum !== null) {
    const selectionReceipt = verifyPmExplorationReceipt(
      host.curriculum.authority,
      input.taskSelectionReceipt,
      {
        planDigest: host.plan.planDigest,
        environmentDigest: host.plan.environmentDigest,
        executionManifestDigest: host.manifest.manifestDigest,
        roundId: roundInput.roundId,
        stage: roundInput.stage,
        branchId: roundInput.branchId,
        inputMemoryDigest: roundInput.inputMemoryDigest,
        taskId: roundInput.taskId,
        status: "succeeded",
      },
    );
    const selections = host.selections.get(journal);
    const selected = selections?.get(roundInput.roundId);
    if (selected?.receiptDigest !== selectionReceipt.receiptDigest) {
      throw new Error("PM exploration task selection is missing or replayed");
    }
    curriculumMetrics = selected.metrics;
    selections.delete(roundInput.roundId);
  }
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
    host.grader.prepare,
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
    taskId: roundInput.taskId,
    executionRequestDigest: runRequest.requestDigest,
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
  const consumed = addMetrics(
    curriculumMetrics,
    addMetrics(execution.payload.metrics, grade.payload.metrics),
  );
  const checkpoint = completePmExplorationRound(journal, round, {
    executionReceiptDigest: execution.receiptDigest,
    graderReceiptDigest: grade.receiptDigest,
    outputMemoryDigest: execution.payload.outputMemoryDigest,
    decision: grade.payload.decision,
    metrics: consumed,
  });
  if (host.curriculum !== null)
    settleOverhead(host, journal, curriculumMetrics);
  return deepFreeze({
    schema: PM_EXPLORATION_EXECUTION_RESULT_SCHEMA,
    checkpoint,
    executionReceipt: execution,
    graderReceipt: grade,
    providerSettlement: executionOutcome.providerSettlement,
    ...(executionOutcome.runnerIsolationEvidenceDigest === null
      ? {}
      : {
          runnerIsolationEvidenceDigest:
            executionOutcome.runnerIsolationEvidenceDigest,
        }),
    ...(executionOutcome.egressEvidenceDigest === null
      ? {}
      : { egressEvidenceDigest: executionOutcome.egressEvidenceDigest }),
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
  const consumedIsolationEvidence =
    host.merger.consumeIsolationEvidence?.(request.requestDigest) ?? null;
  const mergerIsolationEvidenceDigest = succeeded
    ? consumedIsolationEvidence
    : null;
  if (succeeded && host.merger.isolation !== null) {
    digest(mergerIsolationEvidenceDigest, "mergerIsolationEvidenceDigest");
  }
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
    ...(host.merger.isolation === null
      ? {}
      : { mergerIsolationEvidenceDigest }),
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
    ...(host.merger.isolation === null
      ? {}
      : { mergerIsolationEvidenceDigest }),
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
  const consumedIsolationEvidence =
    host.evaluator.consumeIsolationEvidence?.(request.requestDigest) ?? null;
  const evaluatorIsolationEvidenceDigest =
    outcome.status === "succeeded" ? consumedIsolationEvidence : null;
  if (outcome.status === "succeeded" && host.evaluator.isolation !== null) {
    digest(
      evaluatorIsolationEvidenceDigest,
      "evaluatorIsolationEvidenceDigest",
    );
  }
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
    ...(host.evaluator.isolation === null
      ? {}
      : { evaluatorIsolationEvidenceDigest }),
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
    ...(host.evaluator.isolation === null
      ? {}
      : { evaluatorIsolationEvidenceDigest }),
    budgetEnforced: true,
    receiptsAuthenticated: true,
    snapshotAuthenticated: false,
    qualifiesForPromotion: false,
  });
}

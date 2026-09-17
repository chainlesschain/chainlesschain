/** PM dataset tooling and launch preflight. No runtime or promotion authority. */
import { createHash } from "node:crypto";
import { isProxy } from "node:util/types";
import {
  buildEvolutionEvalSuite,
  computeEvolutionEvalTrainingPartitionDigest,
  verifyEvolutionEvalSuite,
} from "./evolution-eval-gate.js";
import { createPmExplorationPlan } from "./pm-exploration-rounds.js";
import grader from "./pm-result-grader.cjs";

const GROUPS = ["template", "project", "principal", "timeWindow"];
const PREFIXES = ["template", "project", "principal", "time-window"];
const GROUP_DIGEST = /^[a-f0-9]{64}$/u;
const REQUIRED_ENV = Object.freeze({
  NODE_ENV: "production",
  MOCK_LLM: "false",
  MOCK_HARDWARE: "false",
  SKIP_SLOW_INIT: "false",
  CHAINLESSCHAIN_DISABLE_NATIVE_DB: "0",
  CHAINLESSCHAIN_DISABLE_DB_PERSISTENCE: "0",
  CC_IPC_ACTOR_GUARD: "enforce",
  CC_IPC_RBAC_GUARD: "enforce",
});
const PM_GRADER = "pm-objective-outcome-v1";

function exact(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    throw new TypeError(`${label} must be plain data`);
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length ||
    actual.some((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return (
        !keys.includes(key) ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      );
    })
  )
    throw new TypeError(`${label} has unexpected or missing fields`);
}

function groupKey(kind, value) {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    !value ||
    value.length > 256
  )
    throw new TypeError(`invalid ${kind} group`);
  return `${kind}-${createHash("sha256").update(value).digest("hex")}`;
}

/** Trusted dataset-author input; store the result outside the Actor workspace. */
export function buildPmExplorationSuite(input) {
  exact(input, ["suiteId", "datasetVersion", "tasks"], "PM suite input");
  if (
    !Array.isArray(input.tasks) ||
    input.tasks.length < 3 ||
    input.tasks.length > 10_000
  )
    throw new TypeError(
      "PM suite requires bounded training, validation and test tasks",
    );
  const tasks = input.tasks.map((task) => {
    exact(task, ["id", "split", "groups", "prompt", "expected"], "PM task");
    exact(task.groups, GROUPS, "PM task groups");
    if (
      typeof task.prompt !== "string" ||
      !task.prompt.trim() ||
      task.prompt.length > 16_384
    )
      throw new TypeError("PM task prompt is required and bounded");
    const expected = grader.normalizePmExpectation(task.expected);
    return {
      id: task.id,
      split: task.split,
      groupKeys: GROUPS.map((key, i) =>
        groupKey(PREFIXES[i], task.groups[key]),
      ),
      taskType: expected.kind === "file-export" ? "file" : "retrieval",
      publicInput: { prompt: task.prompt },
      graderId: PM_GRADER,
      privateExpected: expected,
    };
  });
  return verifyPmSuite(
    buildEvolutionEvalSuite({
      suiteId: input.suiteId,
      datasetVersion: input.datasetVersion,
      tasks,
    }),
  );
}

function verifyPmSuite(value) {
  const suite = verifyEvolutionEvalSuite(value);
  if (
    !["training", "validation", "test"].every((split) =>
      suite.tasks.some((task) => task.split === split),
    )
  )
    throw new TypeError("PM suite must include all three partitions");
  for (const task of suite.tasks) {
    exact(task.publicInput, ["prompt"], "PM public input");
    if (
      typeof task.publicInput.prompt !== "string" ||
      !task.publicInput.prompt.trim() ||
      task.publicInput.prompt.length > 16_384
    )
      throw new TypeError("invalid PM public prompt");
    const expected = grader.normalizePmExpectation(task.privateExpected);
    if (
      task.graderId !== PM_GRADER ||
      task.taskType !==
        (expected.kind === "file-export" ? "file" : "retrieval") ||
      !task.groupKeys.every(
        (key, index) =>
          key.startsWith(`${PREFIXES[index]}-`) &&
          GROUP_DIGEST.test(key.slice(PREFIXES[index].length + 1)),
      )
    )
      throw new TypeError("suite is not a PM exploration dataset");
  }
  return suite;
}

/** Explicit projection: no validation/test tasks, expected answers or grader IDs. */
export function projectPmExplorationTrainingView(value) {
  const suite = verifyPmSuite(value);
  return Object.freeze({
    suiteDigest: suite.suiteDigest,
    trainingPartitionDigest: computeEvolutionEvalTrainingPartitionDigest(suite),
    tasks: Object.freeze(
      suite.tasks
        .filter((task) => task.split === "training")
        .map((task) =>
          Object.freeze({ id: task.id, publicInput: task.publicInput }),
        ),
    ),
  });
}

/** Structural check only; signed provenance is still verified by EvolutionEvalGate. */
export function assertPmExplorationTrainingSources(value, input) {
  exact(
    input,
    ["trainingPartitionDigest", "sourceTaskIds"],
    "PM memory sources",
  );
  const view = projectPmExplorationTrainingView(value);
  if (input.trainingPartitionDigest !== view.trainingPartitionDigest)
    throw new Error("PM training partition binding mismatch");
  const ids = input.sourceTaskIds;
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.length > view.tasks.length ||
    new Set(ids).size !== ids.length
  )
    throw new TypeError("PM source task IDs must be nonempty and unique");
  const allowed = new Set(view.tasks.map((task) => task.id));
  if (ids.some((id) => !allowed.has(id)))
    throw new Error("PM memory source is outside the training partition");
  return Object.freeze({
    trainingPartitionDigest: view.trainingPartitionDigest,
    sourceTaskIds: Object.freeze([...ids]),
  });
}

/** Builds the round protocol from the verified training-only projection. */
export function buildPmExplorationRoundPlan(value, input) {
  exact(
    input,
    [
      "planId",
      "environmentDigest",
      "initialMemoryDigest",
      "broadBranchIds",
      "maxRounds",
      "maxTokens",
      "maxToolCalls",
      "maxWallClockMs",
      "maxConsecutiveNoGain",
    ],
    "PM round plan input",
  );
  const training = projectPmExplorationTrainingView(value);
  return createPmExplorationPlan({
    ...input,
    suiteDigest: training.suiteDigest,
    trainingPartitionDigest: training.trainingPartitionDigest,
    trainingTaskIds: training.tasks.map((task) => task.id),
  });
}

export function buildPmExplorationLaunchProfile(budget) {
  exact(budget, ["maxTokens", "maxToolCalls", "maxWallClockMs"], "PM budget");
  for (const key of Object.keys(budget)) {
    if (!Number.isSafeInteger(budget[key]) || budget[key] <= 0)
      throw new TypeError(`${key} must be a positive safe integer`);
  }
  return Object.freeze({
    schema: "chainlesschain.pm-exploration-launch-profile/v1",
    environment: REQUIRED_ENV,
    budget: Object.freeze({ ...budget }),
    budgetEnforced: false,
    runtimeVerified: false,
    productionQualified: false,
  });
}

/** No secrets or raw environment values are copied to diagnostics. */
export function inspectPmExplorationEnvironment(environment = process.env) {
  if (!environment || typeof environment !== "object" || isProxy(environment))
    throw new TypeError("environment must be a data object");
  const issues = Object.entries(REQUIRED_ENV).flatMap(([key, required]) => {
    const prop = Object.getOwnPropertyDescriptor(environment, key);
    return prop && "value" in prop && prop.value === required
      ? []
      : [
          Object.freeze({
            code: "PM_RUNTIME_CONFIGURATION_MISMATCH",
            variable: key,
            required,
          }),
        ];
  });
  return Object.freeze({
    schema: "chainlesschain.pm-exploration-preflight/v1",
    status: issues.length ? "blocked" : "requires-host-verification",
    configurationCompatible: issues.length === 0,
    issues: Object.freeze(issues),
    missingEvidence: Object.freeze([
      "authenticated-model-ingress",
      "unlocked-real-identity",
      "enforced-tool-and-workspace-isolation",
      "host-enforced-budget",
      "independent-read-only-grader",
      "reset-and-restart-persistence",
    ]),
    launchAllowed: false,
    runtimeVerified: false,
    productionQualified: false,
  });
}

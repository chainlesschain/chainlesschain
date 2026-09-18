import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { isProxy } from "node:util/types";

import grader from "./pm-result-grader.cjs";
import {
  createPmExplorationGrader,
  PM_EXPLORATION_GRADE_REQUEST_SCHEMA,
  PM_EXPLORATION_RUN_REQUEST_SCHEMA,
} from "./pm-exploration-execution-host.js";
import { inspectPmExplorationReceiptAuthority } from "./pm-exploration-receipts.js";

export const PM_EXPLORATION_OUTCOME_SOURCE_SCHEMA =
  "chainlesschain.pm-exploration-read-only-outcome-source/v2";
export const PM_EXPLORATION_OUTCOME_QUERY_SCHEMA =
  "chainlesschain.pm-exploration-read-only-outcome-query/v1";
export const PM_EXPLORATION_BUSINESS_RESULT_SCHEMA =
  "chainlesschain.pm-exploration-business-grader-result/v1";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[a-z][a-z0-9]*(?:[._:@/-][a-z0-9]+)*$/u;
const SOURCES = new WeakMap();

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

function integer(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum)
    throw new TypeError(`${label} is outside its allowed range`);
  return value;
}

function directFunction(value, label, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== "function" || isProxy(value))
    throw new TypeError(`${label} must be a direct function`);
  return value;
}

function normalizeSourceDescriptor(value) {
  exact(
    value,
    [
      "sourceId",
      "revision",
      "handlerArtifactDigest",
      "environmentDigest",
      "outcomeBindingDigest",
    ],
    "PM exploration outcome source descriptor",
  );
  const core = deepFreeze({
    schema: PM_EXPLORATION_OUTCOME_SOURCE_SCHEMA,
    sourceId: identifier(value.sourceId, "sourceId"),
    revision: integer(value.revision, "revision", 1),
    handlerArtifactDigest: digest(
      value.handlerArtifactDigest,
      "handlerArtifactDigest",
    ),
    environmentDigest: digest(value.environmentDigest, "environmentDigest"),
    outcomeBindingDigest: digest(
      value.outcomeBindingDigest,
      "outcomeBindingDigest",
    ),
  });
  return deepFreeze({
    ...core,
    sourceDigest: hash(PM_EXPLORATION_OUTCOME_SOURCE_SCHEMA, core),
  });
}

export function createPmExplorationReadOnlyOutcomeSource(options = {}) {
  exact(
    options,
    ["descriptor", "readProjectState", "readBoardExport"],
    "PM exploration read-only outcome source options",
  );
  const source = Object.freeze({});
  SOURCES.set(source, {
    descriptor: normalizeSourceDescriptor(options.descriptor),
    readProjectState: directFunction(
      options.readProjectState,
      "readProjectState",
      true,
    ),
    readBoardExport: directFunction(
      options.readBoardExport,
      "readBoardExport",
      true,
    ),
  });
  return source;
}

export function inspectPmExplorationReadOnlyOutcomeSource(value) {
  const source = SOURCES.get(value);
  if (!source)
    throw new TypeError(
      "a branded PM exploration read-only outcome source is required",
    );
  return source.descriptor;
}

function entityId(value, label) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 512 ||
    value.trim() !== value ||
    [...value].some((character) => character.charCodeAt(0) < 32)
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function denseEntityIds(value, label) {
  if (
    !Array.isArray(value) ||
    isProxy(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length < 1 ||
    value.length > 10_000 ||
    Reflect.ownKeys(value).length !== value.length + 1
  ) {
    throw new TypeError(`${label} must be a dense nonempty array`);
  }
  const normalized = [];
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    if (
      !descriptor ||
      descriptor.enumerable !== true ||
      !("value" in descriptor)
    ) {
      throw new TypeError(`${label} cannot contain holes or accessors`);
    }
    normalized.push(entityId(descriptor.value, label));
  }
  if (new Set(normalized).size !== normalized.length)
    throw new TypeError(`${label} must contain unique identifiers`);
  return Object.freeze(normalized);
}

function normalizeExpectation(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError("PM expectation must be plain data");
  }
  const kindDescriptor = Object.getOwnPropertyDescriptor(value, "kind");
  if (
    !kindDescriptor ||
    !kindDescriptor.enumerable ||
    !("value" in kindDescriptor)
  ) {
    throw new TypeError("PM expectation kind must be plain data");
  }
  if (
    kindDescriptor.value === "file-export" ||
    kindDescriptor.value === "project-state"
  ) {
    return grader.normalizePmExpectation(value);
  }
  exact(
    value,
    ["kind", "boardId", "taskIds", "sprintIds"],
    "PM board expectation",
  );
  if (value.kind !== "board-export")
    throw new TypeError("PM expectation kind is invalid");
  return deepFreeze({
    kind: value.kind,
    boardId: entityId(value.boardId, "boardId"),
    taskIds: denseEntityIds(value.taskIds, "taskIds"),
    sprintIds: denseEntityIds(value.sprintIds, "sprintIds"),
  });
}

function normalizeExpectationEntry(value, index) {
  const label = `PM business expectation ${index}`;
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const expectedDescriptor = Object.getOwnPropertyDescriptor(value, "expected");
  if (
    !expectedDescriptor ||
    !expectedDescriptor.enumerable ||
    !("value" in expectedDescriptor)
  ) {
    throw new TypeError(`${label}.expected must be plain data`);
  }
  const expected = normalizeExpectation(expectedDescriptor.value);
  exact(
    value,
    expected.kind === "file-export"
      ? ["taskId", "expected", "artifactRoot"]
      : ["taskId", "expected"],
    label,
  );
  let artifactRoot = null;
  if (expected.kind === "file-export") {
    if (
      typeof value.artifactRoot !== "string" ||
      value.artifactRoot.length === 0 ||
      !path.isAbsolute(value.artifactRoot)
    ) {
      throw new TypeError(`${label}.artifactRoot must be absolute`);
    }
    artifactRoot = value.artifactRoot;
  }
  return deepFreeze({
    taskId: identifier(value.taskId, `${label}.taskId`),
    expected,
    artifactRoot,
  });
}

function normalizeExpectations(value) {
  if (
    !Array.isArray(value) ||
    isProxy(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length < 1 ||
    value.length > 1024 ||
    Reflect.ownKeys(value).length !== value.length + 1
  ) {
    throw new TypeError("PM business expectations must be a dense array");
  }
  const result = [];
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    if (
      !descriptor ||
      descriptor.enumerable !== true ||
      !("value" in descriptor)
    ) {
      throw new TypeError(
        "PM business expectations cannot contain holes or accessors",
      );
    }
    result.push(normalizeExpectationEntry(descriptor.value, index));
  }
  if (new Set(result.map((entry) => entry.taskId)).size !== result.length)
    throw new TypeError("PM business expectation taskIds must be unique");
  return Object.freeze(result);
}

function assertRunRequest(value, planDigest, environmentDigest) {
  exact(
    value,
    [
      "schema",
      "planDigest",
      "suiteDigest",
      "trainingPartitionDigest",
      "environmentDigest",
      "executionManifestDigest",
      "toolPolicyDigest",
      "roundId",
      "stage",
      "branchId",
      "taskId",
      "inputMemoryDigest",
      "requestDigest",
    ],
    "PM business grader run request",
  );
  if (
    value.schema !== PM_EXPLORATION_RUN_REQUEST_SCHEMA ||
    value.planDigest !== planDigest ||
    value.environmentDigest !== environmentDigest
  ) {
    throw new Error("PM business grader run request differs from its binding");
  }
  digest(value.requestDigest, "run requestDigest");
  identifier(value.roundId, "roundId");
  identifier(value.taskId, "taskId");
}

function assertGradeRequest(value, planDigest, environmentDigest) {
  exact(
    value,
    [
      "schema",
      "planDigest",
      "environmentDigest",
      "executionManifestDigest",
      "roundId",
      "taskId",
      "executionRequestDigest",
      "inputMemoryDigest",
      "outputMemoryDigest",
      "executionStatus",
      "executionReceiptDigest",
      "traceDigest",
      "requestDigest",
    ],
    "PM business grader request",
  );
  if (
    value.schema !== PM_EXPLORATION_GRADE_REQUEST_SCHEMA ||
    value.planDigest !== planDigest ||
    value.environmentDigest !== environmentDigest
  ) {
    throw new Error("PM business grader request differs from its binding");
  }
  for (const key of [
    "executionRequestDigest",
    "executionReceiptDigest",
    "inputMemoryDigest",
    "outputMemoryDigest",
    "traceDigest",
    "requestDigest",
  ]) {
    digest(value[key], key);
  }
  identifier(value.roundId, "roundId");
  identifier(value.taskId, "taskId");
}

function sanitizedOutcome(executionSucceeded, reason) {
  return Object.freeze({
    schema: "chainlesschain.pm-local-outcome/v1",
    executionSucceeded,
    artifactCheckPassed: false,
    pass: false,
    reason,
    artifactDigest: null,
    authenticated: false,
    qualifiesForPromotion: false,
  });
}

function queryFor(request, sourceDigest) {
  return deepFreeze({
    schema: PM_EXPLORATION_OUTCOME_QUERY_SCHEMA,
    planDigest: request.planDigest,
    environmentDigest: request.environmentDigest,
    sourceDigest,
    roundId: request.roundId,
    taskId: request.taskId,
    executionRequestDigest: request.executionRequestDigest,
    executionReceiptDigest: request.executionReceiptDigest,
    outputMemoryDigest: request.outputMemoryDigest,
    traceDigest: request.traceDigest,
  });
}

function gradeResult(request, source, privateExpectationBinding, localOutcome) {
  const resultDigest = hash(PM_EXPLORATION_BUSINESS_RESULT_SCHEMA, {
    schema: PM_EXPLORATION_BUSINESS_RESULT_SCHEMA,
    planDigest: request.planDigest,
    environmentDigest: request.environmentDigest,
    requestDigest: request.requestDigest,
    taskId: request.taskId,
    executionRequestDigest: request.executionRequestDigest,
    executionReceiptDigest: request.executionReceiptDigest,
    outputMemoryDigest: request.outputMemoryDigest,
    sourceDigest: source.descriptor.sourceDigest,
    privateExpectationBinding,
    outcome: localOutcome,
  });
  return Object.freeze({
    decision:
      request.executionStatus !== "succeeded"
        ? "unsafe"
        : localOutcome.pass
          ? "accept"
          : "reject",
    scoreBasisPoints: localOutcome.pass ? 10_000 : 0,
    resultDigest,
  });
}

export function createPmExplorationBusinessGrader(options = {}) {
  exact(
    options,
    ["signer", "source", "planDigest", "expectations"],
    "PM exploration business grader options",
  );
  const source = SOURCES.get(options.source);
  if (!source)
    throw new TypeError(
      "a branded PM exploration read-only outcome source is required",
    );
  const planDigest = digest(options.planDigest, "planDigest");
  const signerDescriptor = inspectPmExplorationReceiptAuthority(options.signer);
  if (signerDescriptor.role !== "grader")
    throw new TypeError("PM business grader requires a grader signer");
  if (
    signerDescriptor.handlerArtifactDigest !==
    source.descriptor.handlerArtifactDigest
  ) {
    throw new Error(
      "PM business grader signer and outcome source use different handler artifacts",
    );
  }
  const expectations = normalizeExpectations(options.expectations);
  const byTaskId = new Map(expectations.map((entry) => [entry.taskId, entry]));
  const privateExpectationBinding = hash(
    PM_EXPLORATION_BUSINESS_RESULT_SCHEMA,
    {
      nonce: randomBytes(32).toString("hex"),
      expectations,
    },
  );
  const prepared = new Map();

  return createPmExplorationGrader({
    signer: options.signer,
    prepare: async (request) => {
      assertRunRequest(
        request,
        planDigest,
        source.descriptor.environmentDigest,
      );
      const expectation = byTaskId.get(request.taskId);
      if (!expectation)
        throw new Error("PM business grader has no expectation for the task");
      if (prepared.has(request.requestDigest))
        throw new Error("PM business grader request was already prepared");
      let baseline = null;
      let preparationFailed = false;
      if (expectation.expected.kind === "file-export") {
        try {
          baseline = grader.capturePmExportBaseline(
            expectation.artifactRoot,
            expectation.expected.relativePath,
          );
        } catch {
          preparationFailed = true;
        }
      }
      prepared.set(request.requestDigest, {
        baseline,
        expectation,
        preparationFailed,
      });
      if (preparationFailed)
        throw new Error("PM file-export baseline is unavailable or unsafe");
    },
    grade: async (request, runtime) => {
      assertGradeRequest(
        request,
        planDigest,
        source.descriptor.environmentDigest,
      );
      const preparation = prepared.get(request.executionRequestDigest);
      prepared.delete(request.executionRequestDigest);
      if (!preparation || preparation.expectation.taskId !== request.taskId) {
        throw new Error("PM business grader request was not prepared");
      }
      const executionSucceeded = request.executionStatus === "succeeded";
      let localOutcome;
      if (!executionSucceeded) {
        localOutcome = sanitizedOutcome(false, "execution-failed");
      } else if (preparation.preparationFailed) {
        localOutcome = sanitizedOutcome(
          true,
          "artifact-precondition-unavailable-or-unsafe",
        );
      } else if (preparation.expectation.expected.kind === "file-export") {
        localOutcome = grader.gradePmExportFile({
          baseline: preparation.baseline,
          expected: preparation.expectation.expected,
          executionSucceeded: true,
        });
      } else if (preparation.expectation.expected.kind === "project-state") {
        if (source.readProjectState === null)
          throw new Error("PM project-state outcome source is unavailable");
        const actual = await source.readProjectState(
          queryFor(request, source.descriptor.sourceDigest),
          runtime.signal,
        );
        localOutcome = grader.gradePmProjectState({
          actual,
          expected: preparation.expectation.expected,
          executionSucceeded: true,
        });
      } else {
        if (source.readBoardExport === null)
          throw new Error("PM board-export outcome source is unavailable");
        const actual = await source.readBoardExport(
          queryFor(request, source.descriptor.sourceDigest),
          runtime.signal,
        );
        const expected = {
          boardId: preparation.expectation.expected.boardId,
          taskIds: preparation.expectation.expected.taskIds,
          sprintIds: preparation.expectation.expected.sprintIds,
        };
        localOutcome = grader.gradePmBoardExport({
          actual,
          expected,
          executionSucceeded: true,
        });
      }
      return gradeResult(
        request,
        source,
        privateExpectationBinding,
        localOutcome,
      );
    },
  });
}

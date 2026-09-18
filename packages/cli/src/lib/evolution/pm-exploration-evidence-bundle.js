import { createHash } from "node:crypto";
import { isProxy } from "node:util/types";

import {
  PM_EXPLORATION_EVALUATION_REQUEST_SCHEMA,
  PM_EXPLORATION_GRADE_REQUEST_SCHEMA,
  PM_EXPLORATION_MERGE_REQUEST_SCHEMA,
  PM_EXPLORATION_RUN_REQUEST_SCHEMA,
  verifyPmExplorationExecutionManifest,
} from "./pm-exploration-execution-host.js";
import {
  inspectPmExplorationReceiptAuthority,
  verifyPmExplorationReceipt,
} from "./pm-exploration-receipts.js";
import {
  exportPmExplorationRecoverySnapshot,
  restorePmExplorationJournal,
  verifyPmExplorationPlan,
} from "./pm-exploration-rounds.js";

export const PM_EXPLORATION_EVIDENCE_BUNDLE_SCHEMA =
  "chainlesschain.pm-exploration-evidence-bundle/v1";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;

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

function digest(value, label) {
  if (typeof value !== "string" || !DIGEST.test(value))
    throw new TypeError(`${label} must be a sha256 digest`);
  return value;
}

function array(value, label, maximum) {
  if (
    !Array.isArray(value) ||
    isProxy(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length > maximum ||
    Reflect.ownKeys(value).length !== value.length + 1
  ) {
    throw new TypeError(`${label} must be a bounded dense array`);
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor))
      throw new TypeError(`${label} cannot contain holes or accessors`);
  }
  return value;
}

function metricsEqual(checkpoint, execution, grader) {
  return ["tokens", "toolCalls", "wallClockMs"].every(
    (key) =>
      checkpoint.metrics[key] ===
      execution.payload.metrics[key] + grader.payload.metrics[key],
  );
}

function authoritySet(value, manifest) {
  exact(
    value,
    ["execution", "grader", "merge", "evaluator"],
    "PM exploration evidence authorities",
  );
  const result = {};
  for (const [key, expected] of [
    ["execution", manifest.runner],
    ["grader", manifest.grader],
    ["merge", manifest.merger],
    ["evaluator", manifest.evaluator],
  ]) {
    const descriptor = inspectPmExplorationReceiptAuthority(value[key]);
    if (canonical(descriptor) !== canonical(expected))
      throw new Error(`PM exploration ${key} authority differs from manifest`);
    result[key] = value[key];
  }
  return Object.freeze(result);
}

function receiptMap(values, maximum, label) {
  const entries = array(values, label, maximum);
  const result = new Map();
  for (const value of entries) {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      isProxy(value) ||
      Object.getPrototypeOf(value) !== Object.prototype
    ) {
      throw new TypeError(`${label} must contain plain receipt objects`);
    }
    const receiptDigestField = Object.getOwnPropertyDescriptor(
      value,
      "receiptDigest",
    );
    if (
      !receiptDigestField ||
      !receiptDigestField.enumerable ||
      !("value" in receiptDigestField)
    ) {
      throw new TypeError(`${label} receiptDigest must be an own data field`);
    }
    const receiptDigest = digest(
      receiptDigestField.value,
      `${label} receiptDigest`,
    );
    if (result.has(receiptDigest))
      throw new Error(`${label} contains duplicate receipts`);
    result.set(receiptDigest, value);
  }
  return result;
}

function normalizeSnapshot(plan, snapshot) {
  const journal = restorePmExplorationJournal(plan, snapshot);
  return exportPmExplorationRecoverySnapshot(journal);
}

function validateCheckpointReceipts({
  checkpoint,
  authorities,
  executionReceipts,
  graderReceipts,
  manifest,
  plan,
}) {
  const executionInput = executionReceipts.get(
    checkpoint.executionReceiptDigest,
  );
  const graderInput = graderReceipts.get(checkpoint.graderReceiptDigest);
  if (!executionInput || !graderInput)
    throw new Error("PM checkpoint is missing its signed receipts");
  const runCore = {
    schema: PM_EXPLORATION_RUN_REQUEST_SCHEMA,
    planDigest: plan.planDigest,
    suiteDigest: plan.suiteDigest,
    trainingPartitionDigest: plan.trainingPartitionDigest,
    environmentDigest: plan.environmentDigest,
    executionManifestDigest: manifest.manifestDigest,
    toolPolicyDigest: manifest.toolPolicyDigest,
    roundId: checkpoint.roundId,
    stage: checkpoint.stage,
    branchId: checkpoint.branchId,
    taskId: checkpoint.taskId,
    inputMemoryDigest: checkpoint.inputMemoryDigest,
  };
  const runRequestDigest = hash(PM_EXPLORATION_RUN_REQUEST_SCHEMA, runCore);
  const execution = verifyPmExplorationReceipt(
    authorities.execution,
    executionInput,
    {
      planDigest: plan.planDigest,
      environmentDigest: plan.environmentDigest,
      requestDigest: runRequestDigest,
      roundId: checkpoint.roundId,
      stage: checkpoint.stage,
      branchId: checkpoint.branchId,
      taskId: checkpoint.taskId,
      inputMemoryDigest: checkpoint.inputMemoryDigest,
      outputMemoryDigest: checkpoint.outputMemoryDigest,
    },
  );
  const gradeCore = {
    schema: PM_EXPLORATION_GRADE_REQUEST_SCHEMA,
    planDigest: plan.planDigest,
    environmentDigest: plan.environmentDigest,
    executionManifestDigest: manifest.manifestDigest,
    roundId: checkpoint.roundId,
    inputMemoryDigest: checkpoint.inputMemoryDigest,
    outputMemoryDigest: execution.payload.outputMemoryDigest,
    executionStatus: execution.payload.status,
    executionReceiptDigest: execution.receiptDigest,
    traceDigest: execution.payload.traceDigest,
  };
  const gradeRequestDigest = hash(
    PM_EXPLORATION_GRADE_REQUEST_SCHEMA,
    gradeCore,
  );
  const grader = verifyPmExplorationReceipt(authorities.grader, graderInput, {
    planDigest: plan.planDigest,
    environmentDigest: plan.environmentDigest,
    requestDigest: gradeRequestDigest,
    roundId: checkpoint.roundId,
    executionReceiptDigest: execution.receiptDigest,
    outputMemoryDigest: checkpoint.outputMemoryDigest,
    decision: checkpoint.decision,
  });
  if (!metricsEqual(checkpoint, execution, grader))
    throw new Error("PM checkpoint metrics differ from its signed receipts");
  if (
    execution.payload.status !== "succeeded" &&
    checkpoint.decision === "accept"
  ) {
    throw new Error("PM checkpoint accepted a failed signed execution");
  }
  return Object.freeze({ execution, grader });
}

function validateMergeReceipt({ snapshot, authority, input, manifest, plan }) {
  if (snapshot.merge === null) {
    if (input !== null)
      throw new Error("PM evidence has a merge receipt before a merge");
    return null;
  }
  if (input === null)
    throw new Error("PM evidence is missing its signed merge receipt");
  const requestCore = {
    schema: PM_EXPLORATION_MERGE_REQUEST_SCHEMA,
    planDigest: plan.planDigest,
    environmentDigest: plan.environmentDigest,
    executionManifestDigest: manifest.manifestDigest,
    mergeId: snapshot.merge.mergeId,
    baseMemoryDigest: plan.initialMemoryDigest,
    branchCheckpoints: snapshot.merge.branchCheckpoints,
  };
  const receipt = verifyPmExplorationReceipt(authority, input, {
    planDigest: plan.planDigest,
    environmentDigest: plan.environmentDigest,
    requestDigest: hash(PM_EXPLORATION_MERGE_REQUEST_SCHEMA, requestCore),
    mergeId: snapshot.merge.mergeId,
    branchCheckpoints: snapshot.merge.branchCheckpoints,
    outputMemoryDigest: snapshot.merge.outputMemoryDigest,
    status: "succeeded",
  });
  if (receipt.receiptDigest !== snapshot.merge.conflictResolutionReceiptDigest)
    throw new Error("PM merge receipt digest differs from the snapshot");
  return receipt;
}

function validateEvaluatorReceipt({
  snapshot,
  authority,
  input,
  manifest,
  mergeReceipt,
  plan,
}) {
  if (snapshot.frozen === null) {
    if (input !== null)
      throw new Error("PM evidence has an evaluator receipt before freeze");
    return null;
  }
  if (input === null || mergeReceipt === null)
    throw new Error("PM evidence is missing its signed evaluator receipt");
  const requestCore = {
    schema: PM_EXPLORATION_EVALUATION_REQUEST_SCHEMA,
    planDigest: plan.planDigest,
    environmentDigest: plan.environmentDigest,
    executionManifestDigest: manifest.manifestDigest,
    mergeDigest: snapshot.merge.mergeDigest,
    mergeReceiptDigest: mergeReceipt.receiptDigest,
    finalCheckpointDigest: snapshot.frozen.finalCheckpointDigest,
    finalMemoryDigest: snapshot.frozen.finalMemoryDigest,
  };
  const receipt = verifyPmExplorationReceipt(authority, input, {
    planDigest: plan.planDigest,
    environmentDigest: plan.environmentDigest,
    requestDigest: hash(PM_EXPLORATION_EVALUATION_REQUEST_SCHEMA, requestCore),
    mergeReceiptDigest: mergeReceipt.receiptDigest,
    finalCheckpointDigest: snapshot.frozen.finalCheckpointDigest,
    finalMemoryDigest: snapshot.frozen.finalMemoryDigest,
    decision: "accept",
  });
  if (receipt.receiptDigest !== snapshot.frozen.evaluatorReceiptDigest)
    throw new Error("PM evaluator receipt digest differs from the snapshot");
  return receipt;
}

function buildBundle({ plan, manifest, snapshot, authorities, receipts }) {
  verifyPmExplorationPlan(plan);
  const executionManifest = verifyPmExplorationExecutionManifest(manifest);
  if (
    executionManifest.planDigest !== plan.planDigest ||
    executionManifest.environmentDigest !== plan.environmentDigest
  ) {
    throw new Error("PM evidence manifest differs from its plan");
  }
  const trustedAuthorities = authoritySet(authorities, executionManifest);
  exact(
    receipts,
    ["execution", "grader", "merge", "evaluator"],
    "PM exploration evidence receipts",
  );
  const normalizedSnapshot = normalizeSnapshot(plan, snapshot);
  const executionInputs = receiptMap(
    receipts.execution,
    plan.maxRounds,
    "execution receipts",
  );
  const graderInputs = receiptMap(
    receipts.grader,
    plan.maxRounds,
    "grader receipts",
  );
  const orderedExecution = [];
  const orderedGraders = [];
  for (const checkpoint of normalizedSnapshot.checkpoints) {
    const verified = validateCheckpointReceipts({
      checkpoint,
      authorities: trustedAuthorities,
      executionReceipts: executionInputs,
      graderReceipts: graderInputs,
      manifest: executionManifest,
      plan,
    });
    orderedExecution.push(verified.execution);
    orderedGraders.push(verified.grader);
    executionInputs.delete(verified.execution.receiptDigest);
    graderInputs.delete(verified.grader.receiptDigest);
  }
  if (executionInputs.size !== 0 || graderInputs.size !== 0)
    throw new Error(
      "PM evidence contains receipts outside its checkpoint history",
    );
  const mergeReceipt = validateMergeReceipt({
    snapshot: normalizedSnapshot,
    authority: trustedAuthorities.merge,
    input: receipts.merge,
    manifest: executionManifest,
    plan,
  });
  const evaluatorReceipt = validateEvaluatorReceipt({
    snapshot: normalizedSnapshot,
    authority: trustedAuthorities.evaluator,
    input: receipts.evaluator,
    manifest: executionManifest,
    mergeReceipt,
    plan,
  });
  const core = deepFreeze({
    schema: PM_EXPLORATION_EVIDENCE_BUNDLE_SCHEMA,
    planDigest: plan.planDigest,
    environmentDigest: plan.environmentDigest,
    executionManifestDigest: executionManifest.manifestDigest,
    snapshotDigest: normalizedSnapshot.snapshotDigest,
    executionReceipts: orderedExecution,
    graderReceipts: orderedGraders,
    mergeReceipt,
    evaluatorReceipt,
  });
  return deepFreeze({
    ...core,
    evidenceDigest: hash(PM_EXPLORATION_EVIDENCE_BUNDLE_SCHEMA, core),
    authenticated: true,
    snapshotAuthenticated: true,
    qualifiesForPromotion: false,
  });
}

export function createPmExplorationEvidenceBundle(input = {}) {
  exact(
    input,
    ["plan", "manifest", "snapshot", "authorities", "receipts"],
    "PM exploration evidence bundle input",
  );
  return buildBundle(input);
}

export function verifyPmExplorationEvidenceBundle({
  plan,
  manifest,
  authorities,
  snapshot,
  bundle,
} = {}) {
  exact(
    bundle,
    [
      "schema",
      "planDigest",
      "environmentDigest",
      "executionManifestDigest",
      "snapshotDigest",
      "executionReceipts",
      "graderReceipts",
      "mergeReceipt",
      "evaluatorReceipt",
      "evidenceDigest",
      "authenticated",
      "snapshotAuthenticated",
      "qualifiesForPromotion",
    ],
    "PM exploration evidence bundle",
  );
  if (
    bundle.schema !== PM_EXPLORATION_EVIDENCE_BUNDLE_SCHEMA ||
    bundle.authenticated !== true ||
    bundle.snapshotAuthenticated !== true ||
    bundle.qualifiesForPromotion !== false
  ) {
    throw new Error("PM exploration evidence bundle flags are invalid");
  }
  const normalized = buildBundle({
    plan,
    manifest,
    snapshot,
    authorities,
    receipts: {
      execution: bundle.executionReceipts,
      grader: bundle.graderReceipts,
      merge: bundle.mergeReceipt,
      evaluator: bundle.evaluatorReceipt,
    },
  });
  if (canonical(normalized) !== canonical(bundle))
    throw new Error("PM exploration evidence bundle digest mismatch");
  return normalized;
}

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  COWORK_WORKFLOW_CONTROL_SIGNAL_CODE,
  executeWorkflow as executeCoworkWorkflow,
} from "./cowork-workflow.js";
import { writeSecurityStore } from "./durable-security-store.js";
import { containsSecret } from "./secret-scan.js";
import {
  sameFileStatIdentity,
  samePathHandleFileIdentity,
  withTrustedFileParentSync,
} from "./secure-file-identity.js";
import { canonicalJson } from "./scheduler-kernel/contract.js";
import { withFileLock } from "./with-file-lock.js";

export const DYNAMIC_WORKFLOW_RUNTIME_SCHEMA = "cc-dynamic-workflow-runtime/v1";
export const DYNAMIC_WORKFLOW_RUNTIME_VERSION = 1;
export const DYNAMIC_WORKFLOW_EFFECT_SCHEMA = "cc-dynamic-workflow-effect/v1";
export const DYNAMIC_WORKFLOW_OBSERVABILITY_SCHEMA =
  "cc-dynamic-workflow-observability/v1";
export const DYNAMIC_WORKFLOW_RUNTIME_CONTROL_CODE =
  COWORK_WORKFLOW_CONTROL_SIGNAL_CODE;

const STATE_STATUSES = new Set([
  "ready",
  "running",
  "pause_requested",
  "paused",
  "blocked",
  "failed",
  "stopped",
  "completed",
]);
const TERMINAL_STATUSES = new Set(["stopped", "completed"]);
const SHA256_RE = /^sha256:[a-f0-9]{64}$/u;
const MAX_STATE_BYTES = 4 * 1024 * 1024;
const MAX_EFFECTS = 64;
const MAX_EFFECT_BATCH_SIZE = 64;
const MAX_LINEAGE_EVENTS = 512;
const MAX_PROJECTED_ARTIFACTS_PER_EFFECT = 256;
const SETTLEMENT_AUTHORITIES = new Set([
  "provider-return",
  "operator-reconciled",
  "runtime-not-dispatched",
]);

function digest(domain, value) {
  return `sha256:${createHash("sha256")
    .update(domain, "utf8")
    .update(canonicalJson(value, "dynamicWorkflowRuntime"), "utf8")
    .digest("hex")}`;
}

function isoNow(now) {
  const raw = typeof now === "function" ? now() : now;
  const date = raw == null ? new Date() : new Date(raw);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError("dynamic workflow runtime time is invalid");
  }
  return date.toISOString();
}

function safeId(value, field, max = 256) {
  if (
    typeof value !== "string" ||
    !new RegExp(`^[A-Za-z0-9][A-Za-z0-9._-]{0,${max - 1}}$`, "u").test(value) ||
    value.includes("..")
  ) {
    throw new TypeError(`${field} is invalid`);
  }
  return value;
}

function snapshotJson(value, field, maxBytes = MAX_STATE_BYTES) {
  let encoded;
  try {
    encoded = canonicalJson(value, field);
  } catch {
    throw new TypeError(`${field} must contain canonical JSON`);
  }
  if (Buffer.byteLength(encoded, "utf8") > maxBytes) {
    throw new TypeError(`${field} exceeds its byte limit`);
  }
  return JSON.parse(encoded);
}

function nonNegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function effectResultDigest(result) {
  return digest("chainlesschain.dynamic-workflow.effect-result.v1\0", result);
}

function effectBatchId(runId, effects) {
  return digest("chainlesschain.dynamic-workflow.effect-batch.v1\0", {
    runId,
    effects: effects.map((effect) => ({
      key: effect.key,
      payloadDigest: effect.payloadDigest,
    })),
  });
}

function hasProviderDispatchMetadata(effect) {
  return [
    effect?.providerDispatchedAt,
    effect?.timeoutMs,
    effect?.timeoutObservedAt,
  ].some((field) => field !== undefined);
}

function isKnownUndispatched(effect) {
  return (
    hasProviderDispatchMetadata(effect) && effect?.providerDispatchedAt === null
  );
}

function stateMaterial(state) {
  const material = { ...state };
  delete material.stateDigest;
  return material;
}

function finalizeState(state) {
  const material = snapshotJson(stateMaterial(state), "workflow runtime state");
  return Object.freeze({
    ...material,
    stateDigest: digest(
      "chainlesschain.dynamic-workflow.runtime-state.v1\0",
      material,
    ),
  });
}

function appendLineage(state, type, details, now) {
  if (state.lineage.length >= MAX_LINEAGE_EVENTS) {
    throw new Error("dynamic workflow runtime lineage limit exceeded");
  }
  const at = isoNow(now);
  const previousDigest = state.lineage.at(-1)?.eventDigest || null;
  state.revision += 1;
  state.updatedAt = at;
  const material = {
    sequence: state.lineage.length + 1,
    revision: state.revision,
    at,
    type,
    details: snapshotJson(details || {}, "workflow runtime event", 64 * 1024),
    previousDigest,
  };
  state.lineage.push({
    ...material,
    eventDigest: digest(
      "chainlesschain.dynamic-workflow.runtime-event.v1\0",
      material,
    ),
  });
}

function transition(snapshot, type, details, mutate, now) {
  const state = snapshotJson(
    stateMaterial(snapshot),
    "workflow runtime transition",
  );
  mutate(state);
  appendLineage(state, type, details, now);
  return finalizeState(state);
}

function verifyLineage(state, issues) {
  if (
    !Array.isArray(state.lineage) ||
    state.lineage.length > MAX_LINEAGE_EVENTS
  ) {
    issues.push("lineage-invalid");
    return;
  }
  let previousDigest = null;
  for (const [index, event] of state.lineage.entries()) {
    const material = {
      sequence: event?.sequence,
      revision: event?.revision,
      at: event?.at,
      type: event?.type,
      details: event?.details,
      previousDigest: event?.previousDigest,
    };
    const expected = digest(
      "chainlesschain.dynamic-workflow.runtime-event.v1\0",
      material,
    );
    if (
      event?.sequence !== index + 1 ||
      event?.revision !== index + 1 ||
      event?.previousDigest !== previousDigest ||
      event?.eventDigest !== expected ||
      isoNow(event?.at) !== event.at
    ) {
      issues.push(`lineage-${index}-invalid`);
    }
    previousDigest = event?.eventDigest || null;
  }
}

export function verifyDynamicWorkflowRuntimeState(value) {
  const state = snapshotJson(value, "workflow runtime state");
  const issues = [];
  if (
    state.schema !== DYNAMIC_WORKFLOW_RUNTIME_SCHEMA ||
    state.version !== DYNAMIC_WORKFLOW_RUNTIME_VERSION ||
    !STATE_STATUSES.has(state.status)
  ) {
    issues.push("identity-invalid");
  }
  try {
    safeId(state.runId, "runId");
    safeId(state.workflowId, "workflowId", 128);
  } catch {
    issues.push("run-binding-invalid");
  }
  if (
    !SHA256_RE.test(state.definitionDigest || "") ||
    !SHA256_RE.test(state.admissionDigest || "") ||
    typeof state.executionAuthoritySessionId !== "string" ||
    state.executionAuthoritySessionId.length === 0 ||
    state.executionAuthoritySessionId.length > 256
  ) {
    issues.push("authority-binding-invalid");
  }
  if (
    !Number.isSafeInteger(state.revision) ||
    state.revision < 1 ||
    state.revision !== state.lineage?.length
  ) {
    issues.push("revision-invalid");
  }
  verifyLineage(state, issues);
  if (!Array.isArray(state.effects) || state.effects.length > MAX_EFFECTS) {
    issues.push("effects-invalid");
  } else {
    const ids = new Set();
    const keys = new Set();
    const batches = new Map();
    for (const [index, effect] of state.effects.entries()) {
      let expectedKey = null;
      let expectedId = null;
      try {
        expectedKey = effectKey(effect);
        expectedId = digest("chainlesschain.dynamic-workflow.effect-id.v1\0", {
          runId: state.runId,
          key: expectedKey,
          payloadDigest: effect?.payloadDigest,
        });
      } catch {
        // The common invalid-effect branch below records the stable issue.
      }
      const resultDigest =
        effect?.result == null ? null : effectResultDigest(effect.result);
      const batchFields = [
        effect?.batchId,
        effect?.batchIndex,
        effect?.batchSize,
      ];
      const hasBatchMetadata = batchFields.some((field) => field !== undefined);
      const batchMetadataValid =
        !hasBatchMetadata ||
        (batchFields.every((field) => field !== undefined) &&
          SHA256_RE.test(effect.batchId || "") &&
          Number.isSafeInteger(effect.batchIndex) &&
          effect.batchIndex >= 0 &&
          Number.isSafeInteger(effect.batchSize) &&
          effect.batchSize >= 1 &&
          effect.batchSize <= MAX_EFFECT_BATCH_SIZE &&
          effect.batchIndex < effect.batchSize);
      const hasDispatchMetadata = hasProviderDispatchMetadata(effect);
      const dispatchFields = [
        effect?.providerDispatchedAt,
        effect?.timeoutMs,
        effect?.timeoutObservedAt,
      ];
      const providerDispatchedAtValid =
        effect?.providerDispatchedAt === null ||
        (typeof effect?.providerDispatchedAt === "string" &&
          isoNow(effect.providerDispatchedAt) === effect.providerDispatchedAt &&
          Date.parse(effect.providerDispatchedAt) >=
            Date.parse(effect.requestedAt));
      const timeoutObservedAtValid =
        effect?.timeoutObservedAt === null ||
        (typeof effect?.timeoutObservedAt === "string" &&
          Number(effect?.timeoutMs) > 0 &&
          isoNow(effect.timeoutObservedAt) === effect.timeoutObservedAt &&
          Date.parse(effect.timeoutObservedAt) >=
            Date.parse(effect.requestedAt) &&
          (effect.providerDispatchedAt === null ||
            Date.parse(effect.timeoutObservedAt) >=
              Date.parse(effect.providerDispatchedAt)));
      const dispatchMetadataValid =
        !hasDispatchMetadata ||
        (dispatchFields.every((field) => field !== undefined) &&
          Number.isFinite(effect.timeoutMs) &&
          effect.timeoutMs >= 0 &&
          providerDispatchedAtValid &&
          timeoutObservedAtValid);
      if (
        effect?.schema !== DYNAMIC_WORKFLOW_EFFECT_SCHEMA ||
        !SHA256_RE.test(effect.id || "") ||
        !SHA256_RE.test(effect.payloadDigest || "") ||
        !["pending", "settled"].includes(effect.status) ||
        typeof effect.key !== "string" ||
        effect.key.length === 0 ||
        effect.key.length > 1024 ||
        effect.key !== expectedKey ||
        effect.id !== expectedId ||
        isoNow(effect.requestedAt) !== effect.requestedAt ||
        ids.has(effect.id) ||
        keys.has(effect.key) ||
        !batchMetadataValid ||
        !dispatchMetadataValid ||
        (effect.status === "pending" &&
          (effect.result !== null ||
            effect.resultDigest !== null ||
            effect.settlementAuthority !== null ||
            effect.settledAt !== null)) ||
        (effect.status === "settled" &&
          (effect.result == null ||
            effect.resultDigest !== resultDigest ||
            !SETTLEMENT_AUTHORITIES.has(effect.settlementAuthority) ||
            (hasDispatchMetadata &&
              effect.settlementAuthority === "runtime-not-dispatched" &&
              (effect.providerDispatchedAt !== null ||
                effect.result?.status !== "failed" ||
                effect.result?.result?.providerDispatched !== false ||
                ![
                  "timeout-before-dispatch",
                  "stopped-before-dispatch",
                ].includes(effect.result?.result?.reason) ||
                (effect.result?.result?.reason ===
                  "timeout-before-dispatch") !==
                  (typeof effect.timeoutObservedAt === "string"))) ||
            (hasDispatchMetadata &&
              effect.settlementAuthority !== "runtime-not-dispatched" &&
              typeof effect.providerDispatchedAt !== "string") ||
            (hasDispatchMetadata &&
              typeof effect.providerDispatchedAt === "string" &&
              Date.parse(effect.providerDispatchedAt) >
                Date.parse(effect.settledAt)) ||
            (hasDispatchMetadata &&
              typeof effect.timeoutObservedAt === "string" &&
              Date.parse(effect.timeoutObservedAt) >
                Date.parse(effect.settledAt)) ||
            Date.parse(effect.settledAt) < Date.parse(effect.requestedAt) ||
            isoNow(effect.settledAt) !== effect.settledAt))
      ) {
        issues.push(`effect-${index}-invalid`);
      }
      ids.add(effect?.id);
      keys.add(effect?.key);
      if (batchMetadataValid && hasBatchMetadata) {
        if (!batches.has(effect.batchId)) batches.set(effect.batchId, []);
        batches.get(effect.batchId).push(effect);
      }
    }
    let batchIndex = 0;
    for (const [batchId, entries] of batches) {
      entries.sort((left, right) => left.batchIndex - right.batchIndex);
      const expectedSize = entries[0]?.batchSize;
      const complete =
        entries.length === expectedSize &&
        entries.every(
          (entry, index) =>
            entry.batchSize === expectedSize &&
            entry.batchIndex === index &&
            entry.requestedAt === entries[0].requestedAt,
        );
      const expectedBatchId = complete
        ? effectBatchId(state.runId, entries)
        : null;
      if (!complete || batchId !== expectedBatchId) {
        issues.push(`effect-batch-${batchIndex}-invalid`);
      }
      batchIndex += 1;
    }
  }
  if (
    (state.status === "completed") !== (state.finalRecord != null) ||
    (state.status === "stopped" && state.finalRecord != null)
  ) {
    issues.push("terminal-record-invalid");
  }
  if (
    isoNow(state.createdAt) !== state.createdAt ||
    isoNow(state.updatedAt) !== state.updatedAt
  ) {
    issues.push("timestamp-invalid");
  }
  const expectedStateDigest = digest(
    "chainlesschain.dynamic-workflow.runtime-state.v1\0",
    stateMaterial(state),
  );
  if (state.stateDigest !== expectedStateDigest)
    issues.push("state-digest-invalid");
  if (issues.length > 0) {
    const error = new Error(
      `dynamic workflow runtime state is invalid: ${issues.join(", ")}`,
    );
    error.code = "CC_DYNAMIC_WORKFLOW_RUNTIME_STATE_INVALID";
    error.issues = issues;
    throw error;
  }
  return Object.freeze(state);
}

function parseStateBytes(raw) {
  const text =
    typeof raw === "string" ? raw : Buffer.from(raw).toString("utf8");
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes <= 0 || bytes > MAX_STATE_BYTES) {
    throw new Error("dynamic workflow runtime state exceeds its byte limit");
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("dynamic workflow runtime state is corrupt");
  }
  return verifyDynamicWorkflowRuntimeState(value);
}

function readStateFile(statePath) {
  try {
    fs.lstatSync(statePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  return withTrustedFileParentSync(
    fs,
    statePath,
    ({ canonicalPath, parentDevice }) => {
      const before = fs.lstatSync(canonicalPath, { bigint: true });
      if (
        !before.isFile() ||
        before.isSymbolicLink() ||
        Number(before.nlink) !== 1 ||
        Number(before.size) <= 0 ||
        Number(before.size) > MAX_STATE_BYTES
      ) {
        throw new Error(
          "dynamic workflow runtime state must be a bounded, regular, single-link file",
        );
      }
      let descriptor;
      try {
        let flags = Number(fs.constants.O_RDONLY || 0);
        if (typeof fs.constants.O_NOFOLLOW === "number") {
          flags |= fs.constants.O_NOFOLLOW;
        }
        descriptor = fs.openSync(canonicalPath, flags);
        const opened = fs.fstatSync(descriptor, { bigint: true });
        if (
          !opened.isFile() ||
          Number(opened.nlink) !== 1 ||
          !samePathHandleFileIdentity(before, opened, parentDevice)
        ) {
          throw new Error(
            "dynamic workflow runtime state identity changed while opening",
          );
        }
        const state = parseStateBytes(fs.readFileSync(descriptor, "utf8"));
        const after = fs.fstatSync(descriptor, { bigint: true });
        if (!sameFileStatIdentity(opened, after)) {
          throw new Error(
            "dynamic workflow runtime state changed while reading",
          );
        }
        return state;
      } finally {
        if (descriptor !== undefined) fs.closeSync(descriptor);
      }
    },
  );
}

function replaceObject(target, value) {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, value);
}

function withStateMutation(statePath, mutator) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true, mode: 0o700 });
  return withFileLock(
    statePath,
    () => {
      const current = readStateFile(statePath);
      const result = mutator(current);
      if (result?.state) {
        const verified = verifyDynamicWorkflowRuntimeState(result.state);
        writeSecurityStore(statePath, "dynamic workflow runtime", verified);
      }
      return result?.value;
    },
    { failIfUnavailable: true, timeoutMs: 5000, staleMs: 30000 },
  );
}

export function dynamicWorkflowRunStatePath(cwd, runId) {
  const safeRunId = safeId(runId, "runId");
  return path.join(
    path.resolve(cwd),
    ".chainlesschain",
    "cowork",
    "workflow-runs",
    `${safeRunId}.json`,
  );
}

export function readDynamicWorkflowRuntimeState(statePath) {
  const state = readStateFile(path.resolve(statePath));
  if (!state) {
    const error = new Error("dynamic workflow runtime state was not found");
    error.code = "CC_DYNAMIC_WORKFLOW_RUNTIME_NOT_FOUND";
    throw error;
  }
  return state;
}

export function readDynamicWorkflowEffectResultFile(filePath) {
  const resolved = path.resolve(filePath);
  return withTrustedFileParentSync(
    fs,
    resolved,
    ({ canonicalPath, parentDevice }) => {
      const before = fs.lstatSync(canonicalPath, { bigint: true });
      if (
        !before.isFile() ||
        before.isSymbolicLink() ||
        Number(before.nlink) !== 1 ||
        Number(before.size) <= 0 ||
        Number(before.size) > 1024 * 1024
      ) {
        throw new Error(
          "workflow effect result must be a bounded, regular, single-link file",
        );
      }
      let descriptor;
      try {
        let flags = Number(fs.constants.O_RDONLY || 0);
        if (typeof fs.constants.O_NOFOLLOW === "number") {
          flags |= fs.constants.O_NOFOLLOW;
        }
        descriptor = fs.openSync(canonicalPath, flags);
        const opened = fs.fstatSync(descriptor, { bigint: true });
        if (
          !opened.isFile() ||
          Number(opened.nlink) !== 1 ||
          !samePathHandleFileIdentity(before, opened, parentDevice)
        ) {
          throw new Error(
            "workflow effect result identity changed while opening",
          );
        }
        let parsed;
        try {
          parsed = JSON.parse(fs.readFileSync(descriptor, "utf8"));
        } catch {
          throw new Error("workflow effect result is not valid JSON");
        }
        const result = snapshotJson(
          parsed,
          "workflow reconciled effect result",
          1024 * 1024,
        );
        if (containsSecret(JSON.stringify(result))) {
          throw new Error("workflow effect result contains secret-shaped data");
        }
        const after = fs.fstatSync(descriptor, { bigint: true });
        if (!sameFileStatIdentity(opened, after)) {
          throw new Error("workflow effect result changed while being read");
        }
        return result;
      } finally {
        if (descriptor !== undefined) fs.closeSync(descriptor);
      }
    },
  );
}

function stateBindings(execution, runId) {
  const admission = execution.runAdmission;
  if (!admission || typeof admission !== "object") {
    throw new TypeError("durable workflow execution requires run admission");
  }
  if (
    !Number.isSafeInteger(admission.maxParallel) ||
    admission.maxParallel < 1 ||
    admission.maxParallel > MAX_EFFECT_BATCH_SIZE
  ) {
    throw new TypeError("durable workflow maxParallel admission is invalid");
  }
  const generation = execution.workflow?.facade?.generation;
  const review = execution.workflow?.facade?.review;
  if (generation != null || review != null) {
    if (
      generation?.schema !== "cc-dynamic-workflow-generation/v1" ||
      review?.schema !== "cc-dynamic-workflow-review/v1" ||
      review?.decision !== "accepted" ||
      !SHA256_RE.test(review?.draftDigest || "") ||
      !SHA256_RE.test(review?.sourceDefinitionDigest || "") ||
      typeof review?.reviewer !== "string" ||
      review.reviewer.length === 0
    ) {
      const error = new Error(
        "model-generated durable workflow requires accepted review authority",
      );
      error.code = "CC_DYNAMIC_WORKFLOW_REVIEW_AUTHORITY_REQUIRED";
      throw error;
    }
  }
  return {
    runId: safeId(runId, "runId"),
    workflowId: safeId(execution.workflow?.id, "workflowId", 128),
    definitionDigest: execution.definitionDigest,
    admissionDigest: admission.admissionDigest,
    executionAuthoritySessionId:
      admission.executionLocation?.session?.sessionId,
    executionPolicy: snapshotJson(
      admission.executionPolicy,
      "workflow execution policy",
      64 * 1024,
    ),
  };
}

function bindingsMatch(state, bindings) {
  return (
    [
      "runId",
      "workflowId",
      "definitionDigest",
      "admissionDigest",
      "executionAuthoritySessionId",
    ].every((field) => state[field] === bindings[field]) &&
    canonicalJson(state.executionPolicy) ===
      canonicalJson(bindings.executionPolicy)
  );
}

function createState(bindings, now) {
  const at = isoNow(now);
  const state = {
    schema: DYNAMIC_WORKFLOW_RUNTIME_SCHEMA,
    version: DYNAMIC_WORKFLOW_RUNTIME_VERSION,
    ...bindings,
    revision: 0,
    status: "ready",
    effects: [],
    finalRecord: null,
    createdAt: at,
    updatedAt: at,
    lineage: [],
  };
  appendLineage(
    state,
    "run-created",
    { definitionDigest: bindings.definitionDigest },
    at,
  );
  return finalizeState(state);
}

function controlError(message, reason, state, effect = null, cause = null) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = DYNAMIC_WORKFLOW_RUNTIME_CONTROL_CODE;
  error.reason = reason;
  error.runtimeState = state;
  if (effect) error.pendingEffect = effect;
  return error;
}

function startRun(statePath, bindings, now) {
  return withStateMutation(statePath, (current) => {
    let state = current || createState(bindings, now);
    if (!bindingsMatch(state, bindings)) {
      throw new Error(
        "durable workflow run authority does not match stored state",
      );
    }
    if (state.status === "completed") return { value: state };
    if (state.status !== "ready") {
      throw new Error(
        `durable workflow run is ${state.status}; use explicit control or reconciliation`,
      );
    }
    state = transition(
      state,
      "run-started",
      {},
      (draft) => {
        draft.status = "running";
      },
      now,
    );
    return { state, value: state };
  });
}

function effectKey(effect) {
  const stepId = String(effect?.stepId || "");
  const iteration = Number(effect?.iteration);
  const attempt = Number(effect?.attempt);
  if (
    !stepId ||
    stepId.length > 512 ||
    !Number.isSafeInteger(iteration) ||
    iteration < 1 ||
    !Number.isSafeInteger(attempt) ||
    attempt < 1
  ) {
    throw new TypeError("workflow effect context is invalid");
  }
  return `${stepId}\u0000${iteration}\u0000${attempt}`;
}

function effectPayload(args) {
  const { signal: _signal, workflowEffect: _workflowEffect, ...payload } = args;
  return snapshotJson(payload, "workflow effect payload", 1024 * 1024);
}

function prepareEffectRequest(args) {
  const key = effectKey(args.workflowEffect);
  const stepId = String(args.workflowEffect.stepId);
  const iteration = Number(args.workflowEffect.iteration);
  const attempt = Number(args.workflowEffect.attempt);
  const timeoutMs = Number(args.workflowEffect.timeoutMs || 0);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new TypeError("workflow effect timeout context is invalid");
  }
  const payload = effectPayload(args);
  const payloadDigest = digest(
    "chainlesschain.dynamic-workflow.effect-payload.v1\0",
    payload,
  );
  return { key, stepId, iteration, attempt, timeoutMs, payloadDigest };
}

function requestEffectBatch(statePath, runId, argsList, now) {
  if (!Array.isArray(argsList) || argsList.length === 0) {
    throw new TypeError("workflow effect request batch is empty");
  }
  if (argsList.length > MAX_EFFECT_BATCH_SIZE) {
    throw new Error("workflow effect request batch exceeds its hard limit");
  }
  const requests = argsList.map((args) => ({
    ...prepareEffectRequest(args),
  }));
  const batchKeys = new Set(requests.map((request) => request.key));
  if (batchKeys.size !== requests.length) {
    throw new Error("workflow effect request batch contains duplicate keys");
  }
  return withStateMutation(statePath, (current) => {
    if (!current || current.runId !== runId) {
      throw new Error(
        "durable workflow run disappeared before effect batch request",
      );
    }
    if (current.status === "pause_requested") {
      return {
        value: { control: "paused", state: current, results: null },
      };
    }
    if (current.status === "stopped") {
      return {
        value: { control: "stopped", state: current, results: null },
      };
    }
    if (current.status !== "running") {
      throw new Error(
        `durable workflow run cannot request an effect batch while ${current.status}`,
      );
    }
    const existingByKey = new Map(
      current.effects.map((effect) => [effect.key, effect]),
    );
    for (const request of requests) {
      const existing = existingByKey.get(request.key);
      if (existing && existing.payloadDigest !== request.payloadDigest) {
        throw new Error("workflow effect payload drifted during replay");
      }
    }
    const existingPending = requests
      .map((request) => existingByKey.get(request.key))
      .find(
        (effect) =>
          effect?.status === "pending" && !isKnownUndispatched(effect),
      );
    if (existingPending) {
      const state = transition(
        current,
        "effect-batch-reconciliation-required",
        { effectId: existingPending.id },
        (draft) => {
          draft.status = "blocked";
        },
        now,
      );
      return {
        state,
        value: {
          state,
          results: requests.map(() => ({
            pending: true,
            effect: existingPending,
            state,
          })),
        },
      };
    }
    const newRequests = [];
    const resultsByKey = new Map();
    for (const request of requests) {
      const existing = existingByKey.get(request.key);
      if (!existing) {
        newRequests.push(request);
        continue;
      }
      if (existing.status === "pending" && isKnownUndispatched(existing)) {
        resultsByKey.set(request.key, {
          cached: false,
          effect: existing,
        });
        continue;
      }
      resultsByKey.set(request.key, {
        cached: true,
        effect: existing,
        result: existing.result,
      });
    }
    if (current.effects.length + newRequests.length > MAX_EFFECTS) {
      throw new Error("durable workflow effect limit exceeded");
    }
    if (newRequests.length === 0) {
      return {
        value: {
          state: current,
          results: requests.map((request) => resultsByKey.get(request.key)),
        },
      };
    }
    const ordered = [...newRequests].sort((left, right) =>
      left.key.localeCompare(right.key),
    );
    const batchId = effectBatchId(runId, ordered);
    const requestedAt = isoNow(now);
    const effects = ordered.map((request, batchIndex) => {
      const id = digest("chainlesschain.dynamic-workflow.effect-id.v1\0", {
        runId,
        key: request.key,
        payloadDigest: request.payloadDigest,
      });
      return {
        schema: DYNAMIC_WORKFLOW_EFFECT_SCHEMA,
        id,
        key: request.key,
        stepId: request.stepId,
        iteration: request.iteration,
        attempt: request.attempt,
        payloadDigest: request.payloadDigest,
        batchId,
        batchIndex,
        batchSize: ordered.length,
        timeoutMs: request.timeoutMs,
        timeoutObservedAt: null,
        providerDispatchedAt: null,
        status: "pending",
        requestedAt,
        settledAt: null,
        settlementAuthority: null,
        resultDigest: null,
        result: null,
      };
    });
    for (const effect of effects) {
      resultsByKey.set(effect.key, { cached: false, effect });
    }
    const state = transition(
      current,
      "effect-batch-requested",
      {
        batchId,
        effectIds: effects.map((effect) => effect.id),
        effectCount: effects.length,
      },
      (draft) => {
        draft.effects.push(...effects);
      },
      now,
    );
    return {
      state,
      value: {
        state,
        results: requests.map((request) => resultsByKey.get(request.key)),
      },
    };
  });
}

function createEffectRequestBatcher(statePath, runId, now) {
  let queue = [];
  let scheduled = false;
  const flush = () => {
    scheduled = false;
    const batch = queue;
    queue = [];
    try {
      const requested = requestEffectBatch(
        statePath,
        runId,
        batch.map((entry) => entry.args),
        now,
      );
      for (let index = 0; index < batch.length; index += 1) {
        if (requested.control) batch[index].resolve(requested);
        else batch[index].resolve(requested.results[index]);
      }
    } catch (error) {
      for (const entry of batch) entry.reject(error);
    }
  };
  return (args) =>
    new Promise((resolve, reject) => {
      queue.push({ args, resolve, reject });
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(flush);
    });
}

function markEffectProviderDispatched(statePath, runId, effectId, now) {
  return withStateMutation(statePath, (current) => {
    if (!current || current.runId !== runId) {
      throw new Error("durable workflow run disappeared before dispatch");
    }
    const index = current.effects.findIndex((effect) => effect.id === effectId);
    const effect = current.effects[index];
    if (!effect || effect.status !== "pending") {
      throw new Error("workflow effect is not pending before dispatch");
    }
    if (!isKnownUndispatched(effect)) {
      throw new Error("workflow effect dispatch authority is unavailable");
    }
    if (current.status === "stopped") {
      return { value: { control: "stopped", state: current, effect } };
    }
    if (!["running", "pause_requested", "blocked"].includes(current.status)) {
      throw new Error(
        `workflow effect cannot be dispatched while ${current.status}`,
      );
    }
    const providerDispatchedAt = isoNow(now);
    const state = transition(
      current,
      "effect-provider-dispatched",
      { effectId, providerDispatchedAt },
      (draft) => {
        draft.effects[index] = {
          ...draft.effects[index],
          providerDispatchedAt,
        };
      },
      now,
    );
    return {
      state,
      value: {
        effect: state.effects[index],
        state,
      },
    };
  });
}

function observeEffectTimeout(statePath, runId, effectId, now) {
  return withStateMutation(statePath, (current) => {
    if (!current || current.runId !== runId) return { value: current };
    const index = current.effects.findIndex((effect) => effect.id === effectId);
    const effect = current.effects[index];
    if (
      !effect ||
      effect.status !== "pending" ||
      !hasProviderDispatchMetadata(effect) ||
      typeof effect.providerDispatchedAt !== "string" ||
      !(effect.timeoutMs > 0) ||
      effect.timeoutObservedAt !== null
    ) {
      return { value: current };
    }
    const timeoutObservedAt = isoNow(now);
    const state = transition(
      current,
      "effect-timeout-observed",
      { effectId, timeoutMs: effect.timeoutMs, timeoutObservedAt },
      (draft) => {
        draft.effects[index] = {
          ...draft.effects[index],
          timeoutObservedAt,
        };
      },
      now,
    );
    return { state, value: state };
  });
}

function runtimeNotDispatchedResult(effect, reason) {
  if (reason !== "timeout" && reason !== "stopped") {
    throw new TypeError("undispatched workflow effect reason is invalid");
  }
  const timeout = reason === "timeout";
  return {
    taskId: `runtime-${effect.id.slice("sha256:".length, 39)}`,
    status: "failed",
    result: {
      summary: timeout
        ? `step timed out after ${effect.timeoutMs}ms before provider dispatch`
        : "workflow stopped before provider dispatch",
      providerDispatched: false,
      reason: timeout ? "timeout-before-dispatch" : "stopped-before-dispatch",
    },
  };
}

function settleUndispatchedEffect(statePath, runId, effectId, reason, now) {
  return withStateMutation(statePath, (current) => {
    if (!current || current.runId !== runId) {
      throw new Error(
        "durable workflow run disappeared before undispatched settlement",
      );
    }
    const index = current.effects.findIndex((effect) => effect.id === effectId);
    const effect = current.effects[index];
    if (
      !effect ||
      effect.status !== "pending" ||
      !isKnownUndispatched(effect) ||
      (reason === "timeout" && !(effect.timeoutMs > 0)) ||
      (reason === "stopped" && current.status !== "stopped")
    ) {
      throw new Error("workflow effect is not safely undispatched");
    }
    const result = runtimeNotDispatchedResult(effect, reason);
    const resultDigest = effectResultDigest(result);
    const timeoutObservedAt =
      reason === "timeout" && effect.timeoutObservedAt === null
        ? isoNow(now)
        : effect.timeoutObservedAt;
    const settledAt = isoNow(now);
    const state = transition(
      current,
      "effect-not-dispatched",
      {
        effectId,
        reason,
        resultDigest,
        settlementAuthority: "runtime-not-dispatched",
      },
      (draft) => {
        draft.effects[index] = {
          ...draft.effects[index],
          status: "settled",
          timeoutObservedAt,
          settledAt,
          settlementAuthority: "runtime-not-dispatched",
          resultDigest,
          result,
        };
      },
      now,
    );
    return { state, value: result };
  });
}

function settleEffect(statePath, runId, effectId, rawResult, now) {
  const result = snapshotJson(rawResult, "workflow effect result", 1024 * 1024);
  const resultDigest = effectResultDigest(result);
  if (containsSecret(JSON.stringify(result))) {
    throw new Error("workflow effect result contains secret-shaped data");
  }
  return withStateMutation(statePath, (current) => {
    if (!current || current.runId !== runId) {
      throw new Error("durable workflow run disappeared before settlement");
    }
    const index = current.effects.findIndex((effect) => effect.id === effectId);
    const effect = current.effects[index];
    if (!effect || effect.status !== "pending") {
      throw new Error("workflow effect is not pending at settlement");
    }
    if (
      hasProviderDispatchMetadata(effect) &&
      typeof effect.providerDispatchedAt !== "string"
    ) {
      throw new Error("workflow effect provider dispatch was not persisted");
    }
    const settledAt = isoNow(now);
    const state = transition(
      current,
      "effect-settled",
      { effectId, resultDigest, settlementAuthority: "provider-return" },
      (draft) => {
        draft.effects[index] = {
          ...draft.effects[index],
          status: "settled",
          settledAt,
          settlementAuthority: "provider-return",
          resultDigest,
          result,
        };
      },
      now,
    );
    return { state, value: result };
  });
}

function blockPendingEffect(statePath, runId, effectId, now) {
  return withStateMutation(statePath, (current) => {
    if (!current || current.runId !== runId) return { value: current };
    const effect = current.effects.find((entry) => entry.id === effectId);
    if (
      !effect ||
      effect.status !== "pending" ||
      current.status === "stopped"
    ) {
      return { value: current };
    }
    if (current.status === "blocked") return { value: current };
    const state = transition(
      current,
      "effect-reconciliation-required",
      { effectId },
      (draft) => {
        draft.status = "blocked";
      },
      now,
    );
    return { state, value: state };
  });
}

function finalizePauseAfterSettlementBarrier(statePath, runId, now) {
  return withStateMutation(statePath, (current) => {
    if (!current || current.runId !== runId) return { value: current };
    if (current.status !== "pause_requested") return { value: current };
    if (current.effects.some((effect) => effect.status === "pending")) {
      return { value: current };
    }
    const state = transition(
      current,
      "run-paused",
      { barrier: "all-requested-effects-settled" },
      (draft) => {
        draft.status = "paused";
      },
      now,
    );
    return { state, value: state };
  });
}

function completeRun(statePath, runId, record, now) {
  const finalRecord = snapshotJson(
    record,
    "workflow final record",
    2 * 1024 * 1024,
  );
  return withStateMutation(statePath, (current) => {
    if (!current || current.runId !== runId) {
      throw new Error("durable workflow run disappeared before completion");
    }
    if (current.status === "pause_requested") {
      const state = transition(
        current,
        "run-paused",
        {},
        (draft) => {
          draft.status = "paused";
        },
        now,
      );
      return { state, value: { control: "paused", state } };
    }
    if (current.status === "stopped") {
      return { value: { control: "stopped", state: current } };
    }
    if (current.status !== "running") {
      throw new Error(
        `durable workflow run cannot complete while ${current.status}`,
      );
    }
    const state = transition(
      current,
      "run-completed",
      { recordStatus: finalRecord.status },
      (draft) => {
        draft.status = "completed";
        draft.finalRecord = finalRecord;
      },
      now,
    );
    return { state, value: { record: finalRecord, state } };
  });
}

function markFailed(statePath, runId, error, now) {
  return withStateMutation(statePath, (current) => {
    if (
      !current ||
      current.runId !== runId ||
      TERMINAL_STATUSES.has(current.status) ||
      ["paused", "blocked", "pause_requested"].includes(current.status)
    ) {
      return { value: current };
    }
    const state = transition(
      current,
      "run-failed",
      { code: String(error?.code || "WORKFLOW_RUN_FAILED").slice(0, 256) },
      (draft) => {
        draft.status = "failed";
      },
      now,
    );
    return { state, value: state };
  });
}

export async function executeDurableDynamicWorkflow(options = {}, deps = {}) {
  const statePath = path.resolve(options.statePath);
  const runId = safeId(options.runId, "runId");
  const execution = options.execution;
  const bindings = stateBindings(execution, runId);
  if (typeof deps.runTask !== "function") {
    throw new TypeError("durable workflow task provider is required");
  }
  const initial = startRun(statePath, bindings, deps.now);
  if (initial.status === "completed") return initial.finalRecord;
  const requestEffectForDispatch = createEffectRequestBatcher(
    statePath,
    runId,
    deps.now,
  );
  const durableRunTask = async (args) => {
    const requested = await requestEffectForDispatch(args);
    if (requested.control) {
      throw controlError(
        `dynamic workflow run ${requested.control}`,
        requested.control,
        requested.state,
      );
    }
    if (requested.pending) {
      throw controlError(
        `workflow effect ${requested.effect.id} requires reconciliation`,
        "reconciliation-required",
        requested.state,
        requested.effect,
      );
    }
    if (requested.cached) return requested.result;
    if (typeof deps.beforeProviderDispatch === "function") {
      try {
        await deps.beforeProviderDispatch(requested.effect, args);
      } catch (cause) {
        const state = readDynamicWorkflowRuntimeState(statePath);
        throw controlError(
          `workflow effect ${requested.effect.id} was persisted but not dispatched`,
          "undispatched-recovery-required",
          state,
          requested.effect,
          cause,
        );
      }
    }
    if (
      isKnownUndispatched(requested.effect) &&
      (requested.effect.timeoutObservedAt !== null || args.signal?.aborted)
    ) {
      return settleUndispatchedEffect(
        statePath,
        runId,
        requested.effect.id,
        "timeout",
        deps.now,
      );
    }
    const dispatched = markEffectProviderDispatched(
      statePath,
      runId,
      requested.effect.id,
      deps.now,
    );
    if (dispatched.control === "stopped") {
      settleUndispatchedEffect(
        statePath,
        runId,
        requested.effect.id,
        "stopped",
        deps.now,
      );
      const state = readDynamicWorkflowRuntimeState(statePath);
      throw controlError("dynamic workflow run stopped", "stopped", state);
    }
    const effect = dispatched.effect;
    let timeoutObservationError = null;
    const observeTimeout = () => {
      try {
        observeEffectTimeout(statePath, runId, effect.id, deps.now);
      } catch (error) {
        timeoutObservationError ||= error;
      }
    };
    if (args.signal) {
      args.signal.addEventListener("abort", observeTimeout, { once: true });
      if (args.signal.aborted) observeTimeout();
    }
    let result;
    try {
      result = await deps.runTask({
        ...args,
        workflowEffectId: effect.id,
      });
      if (typeof deps.afterProvider === "function") {
        await deps.afterProvider(effect, result);
      }
      if (timeoutObservationError) throw timeoutObservationError;
    } catch (cause) {
      const state = blockPendingEffect(statePath, runId, effect.id, deps.now);
      throw controlError(
        `workflow effect ${effect.id} has an unknown outcome and requires reconciliation`,
        "reconciliation-required",
        state,
        effect,
        cause,
      );
    } finally {
      args.signal?.removeEventListener("abort", observeTimeout);
    }
    try {
      return settleEffect(statePath, runId, effect.id, result, deps.now);
    } catch (cause) {
      const state = blockPendingEffect(statePath, runId, effect.id, deps.now);
      throw controlError(
        `workflow effect ${effect.id} settlement is unknown and requires reconciliation`,
        "reconciliation-required",
        state,
        effect,
        cause,
      );
    }
  };
  try {
    const record = await (deps.executeWorkflow || executeCoworkWorkflow)({
      ...execution,
      maxParallel: execution.runAdmission.maxParallel,
      runTask: durableRunTask,
    });
    const completed = completeRun(statePath, runId, record, deps.now);
    if (completed.control) {
      throw controlError(
        `dynamic workflow run ${completed.control}`,
        completed.control,
        completed.state,
      );
    }
    return completed.record;
  } catch (error) {
    if (
      error?.code === DYNAMIC_WORKFLOW_RUNTIME_CONTROL_CODE &&
      error.reason === "paused"
    ) {
      const state = finalizePauseAfterSettlementBarrier(
        statePath,
        runId,
        deps.now,
      );
      const pending = state?.effects?.find(
        (effect) => effect.status === "pending",
      );
      if (pending) {
        throw controlError(
          `workflow effect ${pending.id} requires reconciliation before pause can settle`,
          "reconciliation-required",
          state,
          pending,
          error,
        );
      }
      if (state?.status === "stopped") {
        throw controlError(
          "dynamic workflow run stopped while its pause barrier was settling",
          "stopped",
          state,
          null,
          error,
        );
      }
      throw controlError(
        "dynamic workflow run paused after its settlement barrier",
        "paused",
        state,
        null,
        error,
      );
    }
    if (error?.code !== DYNAMIC_WORKFLOW_RUNTIME_CONTROL_CODE) {
      markFailed(statePath, runId, error, deps.now);
    }
    throw error;
  }
}

function requireRevision(state, expectedRevision) {
  const expected = Number(expectedRevision);
  if (!Number.isSafeInteger(expected) || expected < 1) {
    throw new TypeError("expected runtime revision is required");
  }
  if (state.revision !== expected) {
    throw new Error(
      `stale dynamic workflow runtime revision: expected ${expected}, found ${state.revision}`,
    );
  }
}

export function requestDurableWorkflowPause(
  statePath,
  expectedRevision,
  deps = {},
) {
  return withStateMutation(path.resolve(statePath), (current) => {
    if (!current)
      throw new Error("dynamic workflow runtime state was not found");
    requireRevision(current, expectedRevision);
    if (TERMINAL_STATUSES.has(current.status)) {
      throw new Error(`cannot pause a ${current.status} workflow run`);
    }
    const immediate = ["ready", "paused", "failed"].includes(current.status);
    const state = transition(
      current,
      immediate ? "run-paused" : "pause-requested",
      {},
      (draft) => {
        draft.status = immediate ? "paused" : "pause_requested";
      },
      deps.now,
    );
    return { state, value: state };
  });
}

export function requestDurableWorkflowStop(
  statePath,
  expectedRevision,
  deps = {},
) {
  return withStateMutation(path.resolve(statePath), (current) => {
    if (!current)
      throw new Error("dynamic workflow runtime state was not found");
    requireRevision(current, expectedRevision);
    if (current.status === "completed") {
      throw new Error("cannot stop a completed workflow run");
    }
    if (current.status === "stopped") return { value: current };
    const state = transition(
      current,
      "run-stopped",
      {},
      (draft) => {
        draft.status = "stopped";
        draft.finalRecord = null;
      },
      deps.now,
    );
    return { state, value: state };
  });
}

export function prepareDurableWorkflowResume(
  statePath,
  expectedRevision,
  deps = {},
) {
  return withStateMutation(path.resolve(statePath), (current) => {
    if (!current)
      throw new Error("dynamic workflow runtime state was not found");
    requireRevision(current, expectedRevision);
    if (TERMINAL_STATUSES.has(current.status)) {
      throw new Error(`cannot resume a ${current.status} workflow run`);
    }
    const pending = current.effects.find(
      (effect) => effect.status === "pending" && !isKnownUndispatched(effect),
    );
    if (pending) {
      const error = new Error(
        `workflow effect ${pending.id} must be reconciled before resume`,
      );
      error.code = "CC_DYNAMIC_WORKFLOW_EFFECT_RECONCILIATION_REQUIRED";
      error.pendingEffect = pending;
      throw error;
    }
    const state = transition(
      current,
      "run-resume-authorized",
      {},
      (draft) => {
        draft.status = "ready";
      },
      deps.now,
    );
    return { state, value: state };
  });
}

export function reconcileDurableWorkflowEffect(
  statePath,
  input = {},
  deps = {},
) {
  const effectId = String(input.effectId || "")
    .trim()
    .toLowerCase();
  if (!SHA256_RE.test(effectId)) throw new TypeError("effectId is invalid");
  const result = snapshotJson(
    input.result,
    "workflow reconciled effect result",
    1024 * 1024,
  );
  if (containsSecret(JSON.stringify(result))) {
    throw new Error("workflow reconciled result contains secret-shaped data");
  }
  const resultDigest = effectResultDigest(result);
  return withStateMutation(path.resolve(statePath), (current) => {
    if (!current)
      throw new Error("dynamic workflow runtime state was not found");
    requireRevision(current, input.expectedRevision);
    const index = current.effects.findIndex((effect) => effect.id === effectId);
    const effect = current.effects[index];
    if (!effect || effect.status !== "pending") {
      throw new Error("workflow effect is not pending reconciliation");
    }
    if (isKnownUndispatched(effect)) {
      throw new Error(
        "workflow effect was not dispatched and must be resumed instead of reconciled",
      );
    }
    const firstPending = current.effects.find(
      (candidate) =>
        candidate.status === "pending" && !isKnownUndispatched(candidate),
    );
    if (firstPending?.id !== effectId) {
      const error = new Error(
        `workflow effect ${firstPending.id} must be reconciled before ${effectId}`,
      );
      error.code = "CC_DYNAMIC_WORKFLOW_EFFECT_RECONCILIATION_OUT_OF_ORDER";
      error.pendingEffect = firstPending;
      throw error;
    }
    const settledAt = isoNow(deps.now);
    const state = transition(
      current,
      "effect-reconciled",
      { effectId, resultDigest, settlementAuthority: "operator-reconciled" },
      (draft) => {
        draft.effects[index] = {
          ...draft.effects[index],
          status: "settled",
          settledAt,
          settlementAuthority: "operator-reconciled",
          resultDigest,
          result,
        };
        const unknownPendingRemain = draft.effects.some(
          (candidate) =>
            candidate.status === "pending" && !isKnownUndispatched(candidate),
        );
        if (draft.status === "blocked" && !unknownPendingRemain) {
          draft.status = "ready";
        }
      },
      deps.now,
    );
    return { state, value: state };
  });
}

function reportedContentDigest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  for (const candidate of [value.sha256, value.digest, value.recordDigest]) {
    if (typeof candidate !== "string") continue;
    const normalized = candidate.startsWith("sha256:")
      ? candidate.toLowerCase()
      : `sha256:${candidate.toLowerCase()}`;
    if (SHA256_RE.test(normalized)) return normalized;
  }
  return null;
}

function projectResultValues(effect, field, domain) {
  const values = effect.result?.result?.[field];
  if (!Array.isArray(values)) {
    return { count: 0, truncated: false, lineage: [] };
  }
  const visible = values.slice(0, MAX_PROJECTED_ARTIFACTS_PER_EFFECT);
  return {
    count: values.length,
    truncated: values.length > visible.length,
    lineage: visible.map((value, ordinal) => ({
      effectId: effect.id,
      ordinal,
      valueDigest: digest(domain, value),
      reportedContentDigest: reportedContentDigest(value),
    })),
  };
}

function projectDynamicWorkflowObservability(state) {
  const settled = state.effects.filter((effect) => effect.status === "settled");
  const effectLineage = [];
  const artifactLineage = [];
  const checkpointLineage = [];
  let requestToSettlementMs = 0;
  let maxRequestToSettlementMs = 0;
  let estimatedTokens = 0;
  let tokenEstimateEffects = 0;
  let completedTaskEffects = 0;
  let failedTaskEffects = 0;
  let invalidTaskResultEffects = 0;
  let artifactCount = 0;
  let checkpointCount = 0;
  let artifactTruncatedEffects = 0;
  let checkpointTruncatedEffects = 0;

  for (const effect of settled) {
    const elapsed = Math.max(
      0,
      Date.parse(effect.settledAt) - Date.parse(effect.requestedAt),
    );
    requestToSettlementMs += elapsed;
    maxRequestToSettlementMs = Math.max(maxRequestToSettlementMs, elapsed);

    const taskStatus = effect.result?.status;
    if (taskStatus === "completed") completedTaskEffects += 1;
    else if (taskStatus === "failed") failedTaskEffects += 1;
    else invalidTaskResultEffects += 1;

    const tokenCount = nonNegativeSafeInteger(
      effect.result?.result?.tokenCount,
    );
    if (tokenCount !== null) {
      estimatedTokens += tokenCount;
      tokenEstimateEffects += 1;
    }

    const artifacts = projectResultValues(
      effect,
      "artifacts",
      "chainlesschain.dynamic-workflow.artifact-observation.v1\0",
    );
    artifactCount += artifacts.count;
    artifactLineage.push(...artifacts.lineage);
    if (artifacts.truncated) artifactTruncatedEffects += 1;

    const checkpoints = projectResultValues(
      effect,
      "checkpoints",
      "chainlesschain.dynamic-workflow.checkpoint-observation.v1\0",
    );
    checkpointCount += checkpoints.count;
    checkpointLineage.push(...checkpoints.lineage);
    if (checkpoints.truncated) checkpointTruncatedEffects += 1;

    effectLineage.push({
      effectId: effect.id,
      stepId: effect.stepId,
      iteration: effect.iteration,
      attempt: effect.attempt,
      status: effect.status,
      batchId: effect.batchId || null,
      batchIndex: effect.batchIndex ?? null,
      batchSize: effect.batchSize ?? null,
      timeoutMs: effect.timeoutMs ?? null,
      timeoutObservedAt: effect.timeoutObservedAt ?? null,
      providerDispatchedAt: effect.providerDispatchedAt ?? null,
      taskStatus:
        taskStatus === "completed" || taskStatus === "failed"
          ? taskStatus
          : "invalid",
      payloadDigest: effect.payloadDigest,
      resultDigest: effect.resultDigest,
      settlementAuthority: effect.settlementAuthority,
      requestedAt: effect.requestedAt,
      settledAt: effect.settledAt,
      requestToSettlementMs: elapsed,
    });
  }

  const gaps = [
    "provider-token-usage-unavailable",
    "provider-cost-usd-unavailable",
    "checkpoint-provider-readback-unavailable",
    "artifact-store-readback-unavailable",
    "nested-tool-side-effect-ledger-unavailable",
  ];
  if (tokenEstimateEffects !== settled.length) {
    gaps.push("cowork-token-estimate-incomplete");
  }
  if (artifactTruncatedEffects > 0) {
    gaps.push("artifact-lineage-projection-truncated");
  }
  if (checkpointTruncatedEffects > 0) {
    gaps.push("checkpoint-lineage-projection-truncated");
  }

  return snapshotJson(
    {
      schema: DYNAMIC_WORKFLOW_OBSERVABILITY_SCHEMA,
      complete: false,
      effects: {
        requested: state.effects.length,
        settled: settled.length,
        pending: state.effects.length - settled.length,
        providerReturned: settled.filter(
          (effect) => effect.settlementAuthority === "provider-return",
        ).length,
        operatorReconciled: settled.filter(
          (effect) => effect.settlementAuthority === "operator-reconciled",
        ).length,
        runtimeNotDispatched: settled.filter(
          (effect) => effect.settlementAuthority === "runtime-not-dispatched",
        ).length,
        providerDispatched: state.effects.filter(
          (effect) => typeof effect.providerDispatchedAt === "string",
        ).length,
        timeoutObserved: state.effects.filter(
          (effect) => typeof effect.timeoutObservedAt === "string",
        ).length,
        completedTasks: completedTaskEffects,
        failedTasks: failedTaskEffects,
        invalidTaskResults: invalidTaskResultEffects,
        lineageDigest: digest(
          "chainlesschain.dynamic-workflow.effect-observability.v1\0",
          effectLineage,
        ),
        lineage: effectLineage,
      },
      duration: {
        authority: "request-to-settlement-wall-clock",
        observedEffects: settled.length,
        totalMs: requestToSettlementMs,
        maxMs: maxRequestToSettlementMs,
      },
      tokens: {
        authority: "cowork-result-heuristic",
        estimated: estimatedTokens,
        observedEffects: tokenEstimateEffects,
        missingEffects: settled.length - tokenEstimateEffects,
        providerReported: null,
      },
      cost: {
        authority: "unavailable",
        reportedUsd: null,
        observedEffects: 0,
      },
      artifacts: {
        authority: "task-result-digest-only",
        count: artifactCount,
        projectedRecords: artifactLineage.length,
        truncatedEffects: artifactTruncatedEffects,
        lineageDigest: digest(
          "chainlesschain.dynamic-workflow.artifact-lineage.v1\0",
          artifactLineage,
        ),
        lineage: artifactLineage,
      },
      checkpoints: {
        authority: "task-result-digest-only",
        count: checkpointCount,
        projectedRecords: checkpointLineage.length,
        truncatedEffects: checkpointTruncatedEffects,
        lineageDigest: digest(
          "chainlesschain.dynamic-workflow.checkpoint-lineage.v1\0",
          checkpointLineage,
        ),
        lineage: checkpointLineage,
      },
      gaps,
    },
    "dynamic workflow observability projection",
    2 * 1024 * 1024,
  );
}

export function projectDynamicWorkflowRuntime(stateOrPath) {
  const state =
    typeof stateOrPath === "string"
      ? readDynamicWorkflowRuntimeState(stateOrPath)
      : verifyDynamicWorkflowRuntimeState(stateOrPath);
  return Object.freeze({
    schema: DYNAMIC_WORKFLOW_RUNTIME_SCHEMA,
    runId: state.runId,
    workflowId: state.workflowId,
    revision: state.revision,
    status: state.status,
    definitionDigest: state.definitionDigest,
    admissionDigest: state.admissionDigest,
    executionAuthoritySessionId: state.executionAuthoritySessionId,
    effectCount: state.effects.length,
    settledEffectCount: state.effects.filter(
      (effect) => effect.status === "settled",
    ).length,
    pendingEffects: Object.freeze(
      state.effects
        .filter((effect) => effect.status === "pending")
        .map((effect) =>
          Object.freeze({
            id: effect.id,
            key: effect.key,
            payloadDigest: effect.payloadDigest,
            batchId: effect.batchId || null,
            batchIndex: effect.batchIndex ?? null,
            batchSize: effect.batchSize ?? null,
            timeoutMs: effect.timeoutMs ?? null,
            timeoutObservedAt: effect.timeoutObservedAt ?? null,
            providerDispatchedAt: effect.providerDispatchedAt ?? null,
            requestedAt: effect.requestedAt,
          }),
        ),
    ),
    finalRecordStatus: state.finalRecord?.status || null,
    observability: projectDynamicWorkflowObservability(state),
    updatedAt: state.updatedAt,
    stateDigest: state.stateDigest,
  });
}

/**
 * Cowork Workflow — chain multiple Cowork tasks into a DAG.
 *
 * A workflow is a declarative set of steps with optional dependencies. Each
 * step invokes a Cowork template (or free mode) with a user message that can
 * reference earlier steps' results via `${step.<id>.summary}` placeholders.
 *
 * The executor:
 *   1. topologically sorts steps by `dependsOn`
 *   2. runs independent steps in parallel (bounded by `maxParallel`)
 *   3. substitutes placeholders in `message` from completed step outputs
 *   4. halts on first failure unless `continueOnError` is set
 *
 * Persistence keeps a versioned current envelope under
 * `.chainlesschain/cowork/workflows/<id>.json`, immutable content-addressed
 * definitions under `workflow-versions/<id>/<digest>.json`, plus a
 * `run-history.jsonl` capturing each execution.
 *
 * The runner itself is injected via `_deps.runTask` to avoid a circular import
 * with `cowork-task-runner.js`.
 *
 * @module cowork-workflow
 */

import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";
import fs, {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  unlinkSync,
  appendFileSync,
  renameSync,
  lstatSync,
  openSync,
  fstatSync,
  closeSync,
  realpathSync,
  constants as fsConstants,
} from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import {
  sameFileStatIdentity,
  samePathHandleFileIdentity,
  withTrustedFileParentSync,
} from "./secure-file-identity.js";
import { evaluate as evalExpr, resolveReference } from "./workflow-expr.js";
import {
  MAX_WORKFLOW_DEFINITION_BYTES,
  createCoworkWorkflowRecord,
  createWorkflowDefinitionAuthority,
  normalizeWorkflowDefinitionDigest,
  verifyCoworkWorkflowRecord,
} from "./workflow-definition-contract.js";
import { canonicalJson } from "./scheduler-kernel/contract.js";

/** Maximum number of items a single forEach step can expand into. */
export const MAX_FAN_OUT = 500;

/** Absolute ceiling on a single loop step's iterations (infinite-loop guard). */
export const MAX_LOOP_ITERATIONS = 100;
export const COWORK_WORKFLOW_RUN_RECORD_SCHEMA = "cc-cowork-workflow-run/v1";
export const COWORK_WORKFLOW_RUN_ADMISSION_INVALID_CODE =
  "COWORK_WORKFLOW_RUN_ADMISSION_INVALID";
export const COWORK_WORKFLOW_RUN_RESULT_INVALID_CODE =
  "COWORK_WORKFLOW_RUN_RESULT_INVALID";
export const COWORK_WORKFLOW_CONTROL_SIGNAL_CODE =
  "COWORK_WORKFLOW_CONTROL_SIGNAL";

const DYNAMIC_WORKFLOW_RUN_ADMISSION_SCHEMA =
  "cc-dynamic-workflow-run-admission/v1";
const EXECUTION_LOCATION_AUTHORITY_SCHEMA =
  "cc-session-execution-location-authority/v1";
const EXECUTION_LOCATION_BINDING_SCHEMA = "cc-execution-location-binding/v1";
const COWORK_WORKFLOW_RECORD_SCHEMA = "cc-cowork-workflow-record/v1";
const RUN_ADMISSION_FIELDS = new Set([
  "schema",
  "definition",
  "executionLocation",
  "executionPolicy",
  "definitionDigest",
  "executionLocationDigest",
  "preflightDigest",
  "maxParallel",
  "credentialValuesTransferred",
  "admissionDigest",
]);
const RUN_ADMISSION_DEFINITION_FIELDS = new Set([
  "schema",
  "definitionDigest",
  "authority",
]);
const RUN_ADMISSION_DEFINITION_AUTHORITY_FIELDS = new Set([
  "status",
  "recordSchema",
  "definitionSchema",
  "definitionDigest",
]);
const RUN_ADMISSION_EXECUTION_LOCATION_FIELDS = new Set([
  "authoritySchema",
  "authority",
  "session",
  "bindingSchema",
  "location",
]);
const RUN_ADMISSION_SESSION_FIELDS = new Set([
  "sessionId",
  "headHash",
  "eventCount",
]);
const RUN_ADMISSION_EXECUTION_POLICY_FIELDS = new Set([
  "cwd",
  "continueOnError",
  "pipeline",
  "provider",
  "model",
]);
const RUN_ADMISSION_LLM_OPTION_FIELDS = new Set(["provider", "model"]);
const ADMITTED_TASK_ENTRY_REQUIRED_FIELDS = new Set([
  "taskId",
  "status",
  "result",
]);
const ADMITTED_STEP_STATUSES = new Set([
  "completed",
  "failed",
  "partial",
  "skipped",
]);
const MAX_ADMITTED_RUN_STEPS = 64;
const MAX_ADMITTED_SNAPSHOT_NODES = 25_000;
const MAX_ADMITTED_SNAPSHOT_BYTES = 1024 * 1024;
const STEP_TIMEOUT_CODE = "COWORK_WORKFLOW_STEP_TIMEOUT";

function runAdmissionError(message) {
  const error = new Error(message);
  error.code = COWORK_WORKFLOW_RUN_ADMISSION_INVALID_CODE;
  return error;
}

function runResultError(message) {
  const error = new Error(message);
  error.code = COWORK_WORKFLOW_RUN_RESULT_INVALID_CODE;
  return error;
}

/**
 * Snapshot an admitted runner value without invoking accessors or accepting
 * proxies/non-JSON values. The returned graph is detached and deeply frozen,
 * so callbacks and a hostile runner cannot mutate executor control state.
 */
function snapshotAdmittedCanonicalValue(
  value,
  name,
  {
    maxNodes = MAX_ADMITTED_SNAPSHOT_NODES,
    maxBytes = MAX_ADMITTED_SNAPSHOT_BYTES,
  } = {},
) {
  const seen = new WeakSet();
  let nodes = 0;
  let roughCharacters = 0;
  const invalid = (reason) => {
    throw runResultError(`${name} ${reason}`);
  };
  const account = (characters = 1) => {
    nodes += 1;
    roughCharacters += characters;
    if (nodes > maxNodes || roughCharacters > maxBytes) {
      invalid("exceeds snapshot limits");
    }
  };
  const visit = (current, depth) => {
    if (depth > 64) invalid("exceeds snapshot depth");
    if (current === null || typeof current === "boolean") {
      account();
      return current;
    }
    if (typeof current === "string") {
      account(current.length);
      return current;
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current)) invalid("contains a non-finite number");
      account();
      return current;
    }
    if (!current || typeof current !== "object" || utilTypes.isProxy(current)) {
      invalid("must contain only non-proxy canonical JSON values");
    }
    if (seen.has(current)) invalid("contains a cycle or repeated reference");
    seen.add(current);
    account();

    if (Array.isArray(current)) {
      if (Object.getPrototypeOf(current) !== Array.prototype) {
        invalid("contains a non-plain array");
      }
      if (current.length > maxNodes) invalid("contains an oversized array");
      const keys = Reflect.ownKeys(current);
      if (keys.length !== current.length + 1) {
        invalid("contains a sparse or extended array");
      }
      const output = [];
      for (let index = 0; index < current.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(
          current,
          String(index),
        );
        if (
          !descriptor ||
          descriptor.enumerable !== true ||
          !Object.hasOwn(descriptor, "value")
        ) {
          invalid("contains an accessor or sparse array entry");
        }
        output.push(visit(descriptor.value, depth + 1));
      }
      return Object.freeze(output);
    }

    const prototype = Object.getPrototypeOf(current);
    if (prototype !== Object.prototype && prototype !== null) {
      invalid("contains a non-plain object");
    }
    const output = {};
    for (const key of Reflect.ownKeys(current)) {
      if (typeof key !== "string") invalid("contains a symbol key");
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (
        !descriptor ||
        descriptor.enumerable !== true ||
        !Object.hasOwn(descriptor, "value")
      ) {
        invalid("contains an accessor or non-enumerable property");
      }
      roughCharacters += key.length;
      if (roughCharacters > maxBytes) invalid("exceeds snapshot limits");
      output[key] = visit(descriptor.value, depth + 1);
    }
    return Object.freeze(output);
  };

  const snapshot = visit(value, 0);
  let serialized;
  try {
    serialized = JSON.stringify(snapshot);
  } catch {
    invalid("cannot be serialized");
  }
  if (Buffer.byteLength(serialized, "utf8") > maxBytes) {
    invalid("exceeds snapshot limits");
  }
  return snapshot;
}

function safeRunErrorMessage(error) {
  if (!error || typeof error !== "object" || utilTypes.isProxy(error)) {
    return "task failed";
  }
  const descriptor = Object.getOwnPropertyDescriptor(error, "message");
  if (
    descriptor &&
    Object.hasOwn(descriptor, "value") &&
    typeof descriptor.value === "string"
  ) {
    return descriptor.value.slice(0, 4096);
  }
  return "task failed";
}

function normalizeAdmittedTaskEntry(value) {
  const entry = snapshotAdmittedCanonicalValue(value, "task result");
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw runResultError("task result must be a plain object");
  }
  if (
    [...ADMITTED_TASK_ENTRY_REQUIRED_FIELDS].some(
      (field) => !Object.hasOwn(entry, field),
    ) ||
    (entry.status !== "completed" && entry.status !== "failed") ||
    typeof entry.taskId !== "string" ||
    entry.taskId.length === 0 ||
    entry.taskId.length > 512 ||
    !entry.result ||
    typeof entry.result !== "object" ||
    Array.isArray(entry.result)
  ) {
    throw runResultError("task result has an invalid schema");
  }
  return Object.freeze({
    taskId: entry.taskId,
    status: entry.status,
    result: entry.result,
  });
}

function normalizeAdmittedOutcome(value, name = "workflow step outcome") {
  const outcome = snapshotAdmittedCanonicalValue(value, name);
  if (
    !outcome ||
    typeof outcome !== "object" ||
    Array.isArray(outcome) ||
    Reflect.ownKeys(outcome).length !== 4 ||
    !["id", "status", "taskId", "result"].every((field) =>
      Object.hasOwn(outcome, field),
    ) ||
    typeof outcome.id !== "string" ||
    outcome.id.length === 0 ||
    outcome.id.length > 512 ||
    !ADMITTED_STEP_STATUSES.has(outcome.status) ||
    (outcome.taskId !== null &&
      (typeof outcome.taskId !== "string" ||
        outcome.taskId.length === 0 ||
        outcome.taskId.length > 512)) ||
    !outcome.result ||
    typeof outcome.result !== "object" ||
    Array.isArray(outcome.result)
  ) {
    throw runResultError(`${name} has an invalid schema`);
  }
  return outcome;
}

function notifyWorkflowCallback(callback, value, admitted, name) {
  if (typeof callback !== "function") return;
  const view = admitted
    ? snapshotAdmittedCanonicalValue(value, `${name} callback view`)
    : value;
  try {
    callback(view);
  } catch {
    // Observation callbacks must not mutate or steer workflow control flow.
  }
}

function assertAdmissionObject(value, fields, name) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Object.keys(value).length !== fields.size ||
    Object.keys(value).some((key) => !fields.has(key))
  ) {
    throw runAdmissionError(`${name} is invalid`);
  }
}

function normalizeAdmittedLlmOptions(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw runAdmissionError("admitted workflow llmOptions is invalid");
  }
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== RUN_ADMISSION_LLM_OPTION_FIELDS.size ||
    keys.some(
      (key) =>
        typeof key !== "string" || !RUN_ADMISSION_LLM_OPTION_FIELDS.has(key),
    )
  ) {
    throw runAdmissionError("admitted workflow llmOptions is not exact");
  }
  const snapshot = {};
  for (const key of RUN_ADMISSION_LLM_OPTION_FIELDS) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      !descriptor ||
      !Object.hasOwn(descriptor, "value") ||
      descriptor.enumerable !== true
    ) {
      throw runAdmissionError(
        "admitted workflow llmOptions must use enumerable data properties",
      );
    }
    snapshot[key] = descriptor.value;
  }
  return Object.freeze(snapshot);
}

function normalizeAdmissionDigest(value, name) {
  const digest = normalizeWorkflowDefinitionDigest(value);
  if (!digest || digest !== value) {
    throw runAdmissionError(`${name} is invalid`);
  }
  return digest;
}

function admissionDigest(material) {
  return `sha256:${createHash("sha256")
    .update("chainlesschain.dynamic-workflow.admission.v1\0", "utf8")
    .update(canonicalJson(material, "dynamicWorkflowAdmission"), "utf8")
    .digest("hex")}`;
}

function normalizeWorkflowRunAdmission(
  value,
  definitionAuthority,
  maxParallel,
  execution,
) {
  try {
    value = structuredClone(value);
  } catch {
    throw runAdmissionError("run admission could not be safely snapshotted");
  }
  assertAdmissionObject(value, RUN_ADMISSION_FIELDS, "run admission");
  assertAdmissionObject(
    value.definition,
    RUN_ADMISSION_DEFINITION_FIELDS,
    "run admission definition",
  );
  assertAdmissionObject(
    value.definition.authority,
    RUN_ADMISSION_DEFINITION_AUTHORITY_FIELDS,
    "run admission definition authority",
  );
  assertAdmissionObject(
    value.executionLocation,
    RUN_ADMISSION_EXECUTION_LOCATION_FIELDS,
    "run admission execution location",
  );
  assertAdmissionObject(
    value.executionLocation.session,
    RUN_ADMISSION_SESSION_FIELDS,
    "run admission session proof",
  );
  assertAdmissionObject(
    value.executionPolicy,
    RUN_ADMISSION_EXECUTION_POLICY_FIELDS,
    "run admission execution policy",
  );
  assertAdmissionObject(
    execution.llmOptions,
    RUN_ADMISSION_LLM_OPTION_FIELDS,
    "admitted workflow llmOptions",
  );

  const definitionDigest = normalizeAdmissionDigest(
    value.definitionDigest,
    "run admission definition digest",
  );
  const executionLocationDigest = normalizeAdmissionDigest(
    value.executionLocationDigest,
    "run admission execution-location digest",
  );
  const preflightDigest = normalizeAdmissionDigest(
    value.preflightDigest,
    "run admission preflight digest",
  );
  const declaredAdmissionDigest = normalizeAdmissionDigest(
    value.admissionDigest,
    "run admission digest",
  );
  const authority = value.definition.authority;
  const session = value.executionLocation.session;
  const executionPolicy = value.executionPolicy;
  const hasControlCharacters = (input) =>
    [...input].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint <= 0x1f || codePoint === 0x7f;
    });
  const validOptionalString = (input) =>
    input === null ||
    (typeof input === "string" &&
      input.length > 0 &&
      input.trim() === input &&
      !hasControlCharacters(input));

  if (
    value.schema !== DYNAMIC_WORKFLOW_RUN_ADMISSION_SCHEMA ||
    value.definition.schema !== definitionAuthority.schema ||
    value.definition.definitionDigest !== definitionDigest ||
    definitionDigest !== definitionAuthority.definitionDigest ||
    authority.status !== "versioned" ||
    authority.recordSchema !== COWORK_WORKFLOW_RECORD_SCHEMA ||
    authority.definitionSchema !== definitionAuthority.schema ||
    authority.definitionDigest !== definitionDigest ||
    value.executionLocation.authoritySchema !==
      EXECUTION_LOCATION_AUTHORITY_SCHEMA ||
    !["verified-session-start", "verified-session-location-handoff"].includes(
      value.executionLocation.authority,
    ) ||
    value.executionLocation.bindingSchema !==
      EXECUTION_LOCATION_BINDING_SCHEMA ||
    typeof value.executionLocation.location !== "string" ||
    value.executionLocation.location.trim() !==
      value.executionLocation.location ||
    value.executionLocation.location.length === 0 ||
    typeof session.sessionId !== "string" ||
    session.sessionId.trim() !== session.sessionId ||
    session.sessionId.length === 0 ||
    !/^[a-f0-9]{64}$/u.test(session.headHash) ||
    !Number.isSafeInteger(session.eventCount) ||
    session.eventCount < 1 ||
    typeof executionPolicy.cwd !== "string" ||
    executionPolicy.cwd.length === 0 ||
    hasControlCharacters(executionPolicy.cwd) ||
    typeof executionPolicy.continueOnError !== "boolean" ||
    typeof executionPolicy.pipeline !== "boolean" ||
    !validOptionalString(executionPolicy.provider) ||
    !validOptionalString(executionPolicy.model) ||
    executionPolicy.cwd !== execution.cwd ||
    executionPolicy.continueOnError !== execution.continueOnError ||
    executionPolicy.pipeline !== execution.pipeline ||
    executionPolicy.provider !== execution.llmOptions.provider ||
    executionPolicy.model !== execution.llmOptions.model ||
    !Number.isSafeInteger(maxParallel) ||
    maxParallel < 1 ||
    maxParallel > 64 ||
    value.maxParallel !== maxParallel ||
    value.credentialValuesTransferred !== false
  ) {
    throw runAdmissionError(
      "run admission does not match the workflow definition or execution options",
    );
  }

  const normalized = Object.freeze({
    schema: DYNAMIC_WORKFLOW_RUN_ADMISSION_SCHEMA,
    definition: Object.freeze({
      schema: definitionAuthority.schema,
      definitionDigest,
      authority: Object.freeze({
        status: "versioned",
        recordSchema: COWORK_WORKFLOW_RECORD_SCHEMA,
        definitionSchema: definitionAuthority.schema,
        definitionDigest,
      }),
    }),
    executionLocation: Object.freeze({
      authoritySchema: EXECUTION_LOCATION_AUTHORITY_SCHEMA,
      authority: value.executionLocation.authority,
      session: Object.freeze({
        sessionId: session.sessionId,
        headHash: session.headHash,
        eventCount: session.eventCount,
      }),
      bindingSchema: EXECUTION_LOCATION_BINDING_SCHEMA,
      location: value.executionLocation.location,
    }),
    executionPolicy: Object.freeze({
      cwd: executionPolicy.cwd,
      continueOnError: executionPolicy.continueOnError,
      pipeline: executionPolicy.pipeline,
      provider: executionPolicy.provider,
      model: executionPolicy.model,
    }),
    definitionDigest,
    executionLocationDigest,
    preflightDigest,
    maxParallel,
    credentialValuesTransferred: false,
  });
  if (admissionDigest(normalized) !== declaredAdmissionDigest) {
    throw runAdmissionError("run admission digest does not match its material");
  }
  return Object.freeze({
    ...normalized,
    admissionDigest: declaredAdmissionDigest,
  });
}

export const _deps = {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  unlinkSync,
  appendFileSync,
  renameSync,
  lstatSync,
  openSync,
  fstatSync,
  closeSync,
  realpathSync,
  fsConstants,
  now: () => Date.now(),
  runTask: null, // injected by CLI
  // Timer seams (injectable for deterministic retry/timeout tests).
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (t) => clearTimeout(t),
};

/**
 * Atomically write a JSON file via _deps. A saved workflow definition is
 * persistent user state; a crash mid-write truncates <id>.json and getWorkflow
 * then fails to parse it. Temp sibling + rename (atomic within a filesystem).
 * Graceful-degrade to a direct write when the injected fs lacks renameSync — the
 * real fs always has it, so production is always atomic.
 */
function _atomicWriteJson(file, data) {
  if (typeof _deps.renameSync !== "function") {
    _deps.writeFileSync(file, data, "utf-8");
    return;
  }
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  try {
    _deps.writeFileSync(tmp, data, "utf-8");
    _deps.renameSync(tmp, file);
  } catch (err) {
    try {
      if (_deps.existsSync(tmp) && _deps.unlinkSync) _deps.unlinkSync(tmp);
    } catch {
      /* best-effort temp cleanup */
    }
    throw err;
  }
}

function _parseBoundedWorkflowJson(raw) {
  const text =
    typeof raw === "string" ? raw : Buffer.from(raw).toString("utf8");
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes <= 0 || bytes > MAX_WORKFLOW_DEFINITION_BYTES) {
    throw new Error(
      `workflow record must be 1..${MAX_WORKFLOW_DEFINITION_BYTES} bytes`,
    );
  }
  return JSON.parse(text);
}

function _pathIsInside(root, candidate) {
  const offset = relative(root, candidate);
  return offset === "" || (!offset.startsWith("..") && !isAbsolute(offset));
}

function _canonicalWorkflowStoragePath(candidate, runtimeRealpath) {
  const nativeRealpath = runtimeRealpath?.native;
  return typeof nativeRealpath === "function"
    ? nativeRealpath(candidate)
    : runtimeRealpath(candidate);
}

export function workflowStoragePathIsContained(
  cwd,
  candidate,
  runtimeRealpath = realpathSync,
) {
  const realRoot = _canonicalWorkflowStoragePath(cwd, runtimeRealpath);
  const realCandidate = _canonicalWorkflowStoragePath(
    candidate,
    runtimeRealpath,
  );
  return _pathIsInside(realRoot, realCandidate);
}

function _assertWorkflowStoragePath(cwd, candidate) {
  const usingRuntimeFs =
    _deps.readFileSync === readFileSync &&
    _deps.realpathSync === realpathSync &&
    _deps.lstatSync === lstatSync;
  if (!usingRuntimeFs) return;
  // Canonicalize both sides through the same native API. Windows hosted
  // runners can expose cwd through an 8.3 alias while a trusted-parent read
  // returns the expanded path; mixing legacy/native realpath projections can
  // otherwise misclassify the same directory as an escape.
  if (!workflowStoragePathIsContained(cwd, candidate, _deps.realpathSync)) {
    throw new Error("workflow storage path escapes the working directory");
  }
}

function _assertWorkflowStorageDirectory(cwd, directory) {
  _assertWorkflowStoragePath(cwd, directory);
  if (
    _deps.readFileSync === readFileSync &&
    _deps.lstatSync === lstatSync &&
    _deps.realpathSync === realpathSync
  ) {
    const stat = _deps.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error("workflow storage directory must not be a symlink");
    }
  }
}

function _readBoundedWorkflowJson(cwd, file) {
  const usingRuntimeFs =
    _deps.readFileSync === readFileSync &&
    _deps.lstatSync === lstatSync &&
    _deps.openSync === openSync &&
    _deps.fstatSync === fstatSync &&
    _deps.closeSync === closeSync &&
    _deps.realpathSync === realpathSync;
  if (!usingRuntimeFs) {
    return _parseBoundedWorkflowJson(_deps.readFileSync(file, "utf8"));
  }

  _assertWorkflowStoragePath(cwd, file);
  return withTrustedFileParentSync(
    fs,
    file,
    ({ canonicalPath, parentDevice }) => {
      _assertWorkflowStoragePath(cwd, canonicalPath);
      const before = _deps.lstatSync(canonicalPath, { bigint: true });
      if (
        !before.isFile() ||
        before.isSymbolicLink() ||
        Number(before.nlink) !== 1
      ) {
        throw new Error("workflow record must be a regular, single-link file");
      }
      if (
        Number(before.size) <= 0 ||
        Number(before.size) > MAX_WORKFLOW_DEFINITION_BYTES
      ) {
        throw new Error(
          `workflow record must be 1..${MAX_WORKFLOW_DEFINITION_BYTES} bytes`,
        );
      }

      let descriptor;
      try {
        let flags = Number(_deps.fsConstants.O_RDONLY || 0);
        if (typeof _deps.fsConstants.O_NOFOLLOW === "number") {
          flags |= _deps.fsConstants.O_NOFOLLOW;
        }
        descriptor = _deps.openSync(canonicalPath, flags);
        const opened = _deps.fstatSync(descriptor, { bigint: true });
        if (
          !opened.isFile() ||
          Number(opened.nlink) !== 1 ||
          !samePathHandleFileIdentity(before, opened, parentDevice)
        ) {
          throw new Error("workflow record identity changed while opening");
        }
        const value = _parseBoundedWorkflowJson(
          _deps.readFileSync(descriptor, "utf8"),
        );
        const after = _deps.fstatSync(descriptor, { bigint: true });
        if (!sameFileStatIdentity(opened, after)) {
          throw new Error("workflow record changed while being read");
        }
        return value;
      } finally {
        if (descriptor !== undefined) _deps.closeSync(descriptor);
      }
    },
  );
}

// ─── Paths ───────────────────────────────────────────────────────────────────

function workflowsDir(cwd) {
  return join(cwd, ".chainlesschain", "cowork", "workflows");
}

function assertWorkflowId(id) {
  if (
    typeof id !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(id) ||
    id.includes("..")
  ) {
    throw new TypeError(
      "workflow id must be 1..128 safe filename characters without '..'",
    );
  }
  return id;
}

function workflowFile(cwd, id) {
  return join(workflowsDir(cwd), `${assertWorkflowId(id)}.json`);
}

function workflowVersionsDir(cwd, id) {
  return join(
    cwd,
    ".chainlesschain",
    "cowork",
    "workflow-versions",
    assertWorkflowId(id),
  );
}

function workflowVersionFile(cwd, id, definitionDigest) {
  const digest = normalizeWorkflowDefinitionDigest(definitionDigest);
  if (!digest) throw new TypeError("workflow definition digest is invalid");
  return join(workflowVersionsDir(cwd, id), `${digest.slice(7)}.json`);
}

function historyFile(cwd) {
  return join(cwd, ".chainlesschain", "cowork", "workflow-history.jsonl");
}

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Validate a workflow definition. Returns `{ valid, errors }`.
 */
export function validateWorkflow(wf) {
  const errors = [];
  if (!wf || typeof wf !== "object") {
    return { valid: false, errors: ["workflow must be an object"] };
  }
  if (!wf.id || typeof wf.id !== "string") {
    errors.push("id required");
  } else {
    try {
      assertWorkflowId(wf.id);
    } catch (error) {
      errors.push(error.message);
    }
  }
  if (!wf.name || typeof wf.name !== "string") errors.push("name required");
  if (!Array.isArray(wf.steps) || wf.steps.length === 0) {
    errors.push("steps must be a non-empty array");
  } else {
    const ids = new Set();
    for (const [i, s] of wf.steps.entries()) {
      if (!s.id || typeof s.id !== "string") {
        errors.push(`steps[${i}].id required`);
        continue;
      }
      if (ids.has(s.id)) errors.push(`duplicate step id '${s.id}'`);
      ids.add(s.id);
      if (!s.message || typeof s.message !== "string") {
        errors.push(`steps[${i}].message required`);
      }
      if (s.dependsOn && !Array.isArray(s.dependsOn)) {
        errors.push(`steps[${i}].dependsOn must be an array`);
      }
      if (s.when !== undefined && typeof s.when !== "string") {
        errors.push(`steps[${i}].when must be a string expression`);
      }
      if (s.forEach !== undefined) {
        const f = s.forEach;
        const ok =
          Array.isArray(f) || (typeof f === "string" && f.trim().length > 0);
        if (!ok) {
          errors.push(
            `steps[${i}].forEach must be an array or reference string`,
          );
        }
      }
      if (
        s.retries !== undefined &&
        (typeof s.retries !== "number" ||
          !Number.isInteger(s.retries) ||
          s.retries < 0)
      ) {
        errors.push(`steps[${i}].retries must be a non-negative integer`);
      }
      if (
        s.timeoutMs !== undefined &&
        (typeof s.timeoutMs !== "number" ||
          !Number.isFinite(s.timeoutMs) ||
          s.timeoutMs <= 0)
      ) {
        errors.push(`steps[${i}].timeoutMs must be a positive number`);
      }
      if (
        s.retryDelayMs !== undefined &&
        (typeof s.retryDelayMs !== "number" ||
          !Number.isFinite(s.retryDelayMs) ||
          s.retryDelayMs < 0)
      ) {
        errors.push(`steps[${i}].retryDelayMs must be a non-negative number`);
      }
      if (
        s.retryBackoff !== undefined &&
        s.retryBackoff !== "fixed" &&
        s.retryBackoff !== "exponential"
      ) {
        errors.push(
          `steps[${i}].retryBackoff must be "fixed" or "exponential"`,
        );
      }
      const hasWhile = s.loopWhile !== undefined;
      const hasUntil = s.loopUntil !== undefined;
      if (hasWhile && typeof s.loopWhile !== "string") {
        errors.push(`steps[${i}].loopWhile must be a string expression`);
      }
      if (hasUntil && typeof s.loopUntil !== "string") {
        errors.push(`steps[${i}].loopUntil must be a string expression`);
      }
      if (hasWhile && hasUntil) {
        errors.push(`steps[${i}] cannot set both loopWhile and loopUntil`);
      }
      if ((hasWhile || hasUntil) && s.forEach !== undefined) {
        errors.push(`steps[${i}] cannot combine a loop with forEach`);
      }
      if (
        s.maxIterations !== undefined &&
        (typeof s.maxIterations !== "number" ||
          !Number.isInteger(s.maxIterations) ||
          s.maxIterations <= 0)
      ) {
        errors.push(`steps[${i}].maxIterations must be a positive integer`);
      }
    }
    // Check dependsOn references exist
    for (const s of wf.steps) {
      for (const dep of s.dependsOn || []) {
        if (!ids.has(dep)) {
          errors.push(`step '${s.id}' dependsOn unknown step '${dep}'`);
        }
      }
    }
    // Detect cycles via topo-sort
    if (errors.length === 0) {
      try {
        topoSort(wf.steps);
      } catch (e) {
        errors.push(e.message);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

// ─── Topological sort ────────────────────────────────────────────────────────

/**
 * Return steps in execution order (Kahn's algorithm). Throws on cycle.
 * The result is a flat array; independent steps appear adjacently but the
 * executor separately groups them into parallel batches.
 */
export function topoSort(steps) {
  const incoming = new Map();
  const outgoing = new Map();
  for (const s of steps) {
    incoming.set(s.id, new Set(s.dependsOn || []));
    outgoing.set(s.id, []);
  }
  for (const s of steps) {
    for (const dep of s.dependsOn || []) {
      if (outgoing.has(dep)) outgoing.get(dep).push(s.id);
    }
  }

  const ready = [];
  for (const [id, incs] of incoming) {
    if (incs.size === 0) ready.push(id);
  }

  const order = [];
  const byId = new Map(steps.map((s) => [s.id, s]));
  while (ready.length > 0) {
    const id = ready.shift();
    order.push(byId.get(id));
    for (const next of outgoing.get(id)) {
      const incs = incoming.get(next);
      incs.delete(id);
      if (incs.size === 0) ready.push(next);
    }
  }

  if (order.length !== steps.length) {
    throw new Error("workflow contains a cycle");
  }
  return order;
}

/**
 * Group steps into parallel batches based on dependencies. Within a batch,
 * all steps are independent and can run concurrently.
 */
export function planBatches(steps) {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const done = new Set();
  const batches = [];
  const remaining = new Set(steps.map((s) => s.id));

  while (remaining.size > 0) {
    const batch = [];
    for (const id of remaining) {
      const s = byId.get(id);
      const deps = s.dependsOn || [];
      if (deps.every((d) => done.has(d))) batch.push(s);
    }
    if (batch.length === 0) throw new Error("workflow contains a cycle");
    batches.push(batch);
    for (const s of batch) {
      done.add(s.id);
      remaining.delete(s.id);
    }
  }
  return batches;
}

// ─── forEach expansion ───────────────────────────────────────────────────────

/**
 * Resolve the array source for a `forEach` step. Accepts either:
 *   - an array literal (returned verbatim)
 *   - a `${...}` reference string resolving to an array on a prior step result
 *
 * Throws if the resolved value isn't an array or exceeds MAX_FAN_OUT.
 */
export function resolveForEachItems(forEach, resultsById) {
  if (Array.isArray(forEach)) {
    if (forEach.length > MAX_FAN_OUT) {
      throw new Error(
        `forEach array exceeds MAX_FAN_OUT=${MAX_FAN_OUT} (got ${forEach.length})`,
      );
    }
    return forEach;
  }
  if (typeof forEach === "string") {
    const trimmed = forEach.trim();
    // Accept bare `${...}` wrapper; resolve inner ref.
    const m = trimmed.match(/^\$\{(.+)\}$/);
    if (!m) {
      throw new Error(`forEach ref must be wrapped in \${...}: ${trimmed}`);
    }
    const value = resolveReference(m[1].trim(), { step: resultsById });
    if (!Array.isArray(value)) {
      throw new Error(
        `forEach ref did not resolve to an array: ${trimmed} (got ${typeof value})`,
      );
    }
    if (value.length > MAX_FAN_OUT) {
      throw new Error(
        `forEach expansion exceeds MAX_FAN_OUT=${MAX_FAN_OUT} (got ${value.length})`,
      );
    }
    return value;
  }
  throw new Error("forEach must be an array or reference string");
}

/** Substitute `${item}` tokens in a template string. Non-string → stringify. */
export function substituteItem(template, item) {
  if (typeof template !== "string") return template;
  const repl = typeof item === "string" ? item : JSON.stringify(item);
  // Insert via a function so $-sequences in the item ($&, $`, $', $$ — common in
  // JSON values / shell snippets) are placed literally rather than interpreted
  // as String.replace patterns, which would corrupt the substituted value.
  return template.replace(/\$\{item\}/g, () => repl);
}

/** Evaluate a step's `when` expression. Missing expression → always true. */
export function shouldRunStep(step, resultsById) {
  if (!step.when) return true;
  try {
    return evalExpr(step.when, { step: resultsById });
  } catch (err) {
    throw new Error(`invalid when on step '${step.id}': ${err.message}`);
  }
}

// ─── Placeholder substitution ────────────────────────────────────────────────

/**
 * Replace `${step.<id>.<field>}` tokens in `template` using the map of
 * completed step results. Missing tokens resolve to an empty string.
 *
 * Supported fields: `summary`, `status`, `taskId`, `tokenCount`,
 * `iterationCount`.
 */
export function substitutePlaceholders(template, resultsById) {
  if (typeof template !== "string") return template;
  return template.replace(
    /\$\{step\.([\w-]+)\.([\w-]+)\}/g,
    (_, stepId, field) => {
      const entry = resultsById.get(stepId);
      if (!entry) return "";
      if (field === "summary") return entry.result?.summary ?? "";
      if (field === "status") return entry.status ?? "";
      if (field === "taskId") return entry.taskId ?? "";
      if (field === "tokenCount") return String(entry.result?.tokenCount ?? 0);
      if (field === "iterationCount")
        return String(entry.result?.iterationCount ?? 0);
      return "";
    },
  );
}

// ─── Persistence ─────────────────────────────────────────────────────────────

function _storedWorkflowError(message) {
  const error = new Error(message);
  error.code = "WORKFLOW_DEFINITION_INTEGRITY";
  return error;
}

function _readStoredWorkflowRecord(
  cwd,
  file,
  { allowLegacy = true, expectedId, expectedDigest } = {},
) {
  const record = verifyCoworkWorkflowRecord(
    _readBoundedWorkflowJson(cwd, file),
    {
      allowLegacy,
    },
  );
  const validation = validateWorkflow(record.definition);
  if (!validation.valid) {
    throw _storedWorkflowError(
      `stored workflow is invalid: ${validation.errors.join("; ")}`,
    );
  }
  if (expectedId && record.definition.id !== expectedId) {
    throw _storedWorkflowError("stored workflow id does not match its path");
  }
  if (expectedDigest && record.definitionDigest !== expectedDigest) {
    throw _storedWorkflowError(
      "stored workflow digest does not match its version path",
    );
  }
  return record;
}

export function listWorkflows(cwd) {
  const dir = workflowsDir(cwd);
  if (!_deps.existsSync(dir)) return [];
  const entries = _deps.readdirSync(dir) || [];
  const out = [];
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    try {
      const id = name.slice(0, -5);
      const record = _readStoredWorkflowRecord(cwd, join(dir, name), {
        expectedId: id,
      });
      out.push(record.definition);
    } catch {
      // skip malformed files
    }
  }
  return out;
}

export function getWorkflowRecord(cwd, id) {
  const file = workflowFile(cwd, id);
  if (!_deps.existsSync(file)) return null;
  return _readStoredWorkflowRecord(cwd, file, { expectedId: id });
}

export function getWorkflow(cwd, id) {
  try {
    return getWorkflowRecord(cwd, id)?.definition || null;
  } catch {
    return null;
  }
}

export function saveWorkflow(cwd, wf) {
  const { valid, errors } = validateWorkflow(wf);
  if (!valid) throw new Error(`Invalid workflow: ${errors.join("; ")}`);
  const record = createCoworkWorkflowRecord(wf);
  const serialized = JSON.stringify(record, null, 2);
  const dir = workflowsDir(cwd);
  _deps.mkdirSync(dir, { recursive: true });
  _assertWorkflowStorageDirectory(cwd, dir);
  const versionDir = workflowVersionsDir(cwd, wf.id);
  _deps.mkdirSync(versionDir, { recursive: true });
  _assertWorkflowStorageDirectory(cwd, versionDir);
  const versionFile = workflowVersionFile(cwd, wf.id, record.definitionDigest);
  if (_deps.existsSync(versionFile)) {
    _readStoredWorkflowRecord(cwd, versionFile, {
      allowLegacy: false,
      expectedId: wf.id,
      expectedDigest: record.definitionDigest,
    });
  } else {
    _atomicWriteJson(versionFile, serialized);
  }
  const currentFile = workflowFile(cwd, wf.id);
  if (_deps.existsSync(currentFile)) {
    _readStoredWorkflowRecord(cwd, currentFile, {
      expectedId: wf.id,
    });
  }
  _atomicWriteJson(currentFile, serialized);
  return wf;
}

export function getWorkflowVersion(cwd, id, definitionDigest) {
  const digest = normalizeWorkflowDefinitionDigest(definitionDigest);
  if (!digest) throw new TypeError("workflow definition digest is invalid");
  const file = workflowVersionFile(cwd, id, digest);
  if (!_deps.existsSync(file)) return null;
  return _readStoredWorkflowRecord(cwd, file, {
    allowLegacy: false,
    expectedId: id,
    expectedDigest: digest,
  });
}

export function listWorkflowVersions(cwd, id) {
  const dir = workflowVersionsDir(cwd, id);
  if (!_deps.existsSync(dir)) return [];
  const versions = [];
  for (const name of _deps.readdirSync(dir) || []) {
    const match = /^([a-f0-9]{64})\.json$/u.exec(name);
    if (!match) continue;
    const digest = `sha256:${match[1]}`;
    const record = _readStoredWorkflowRecord(cwd, join(dir, name), {
      allowLegacy: false,
      expectedId: id,
      expectedDigest: digest,
    });
    versions.push(
      Object.freeze({
        status: record.status,
        recordSchema: record.recordSchema,
        definitionSchema: record.definitionSchema,
        definitionDigest: record.definitionDigest,
        id: record.definition.id,
        name: record.definition.name,
      }),
    );
  }
  return versions.sort((left, right) =>
    left.definitionDigest.localeCompare(right.definitionDigest),
  );
}

export function removeWorkflow(cwd, id) {
  let file;
  try {
    file = workflowFile(cwd, id);
  } catch {
    return false;
  }
  if (!_deps.existsSync(file)) return false;
  _deps.unlinkSync(file);
  return true;
}

// ─── Per-step retry / timeout ─────────────────────────────────────────────────

/**
 * Compute the delay (ms) to wait BEFORE a retry, given the just-failed attempt
 * number (1-based). `fixed` returns `retryDelayMs` verbatim; `exponential`
 * doubles it per prior attempt (delay = base · 2^(attempt-1)).
 */
export function retryDelayFor(step, attempt) {
  const base = Number(step.retryDelayMs) || 0;
  if (base <= 0) return 0;
  if (step.retryBackoff === "exponential") {
    return base * Math.pow(2, attempt - 1);
  }
  return base;
}

/**
 * Race a promise (produced by `factory`) against a per-attempt timeout.
 * Resolves/rejects with the promise when it settles first; rejects with a
 * "timed out" error if the timer fires first. The timer is always cleared, and
 * a late rejection from the losing promise is swallowed to avoid an unhandled
 * rejection (the underlying task is best-effort abandoned — runTask has no
 * cancellation contract).
 */
export async function withTimeout(factory, timeoutMs) {
  if (!timeoutMs || timeoutMs <= 0) return factory();
  const p = Promise.resolve().then(factory);
  let timer = null;
  const timeout = new Promise((_resolve, reject) => {
    timer = _deps.setTimeout(() => {
      const error = new Error(`step timed out after ${timeoutMs}ms`);
      error.code = STEP_TIMEOUT_CODE;
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer != null) _deps.clearTimeout(timer);
    p.catch(() => {}); // guard a late rejection from the abandoned task
  }
}

function createWorkflowTaskSemaphore(limit) {
  let active = 0;
  const waiters = [];
  return Object.freeze({
    acquire() {
      return new Promise((resolve) => {
        const grant = () => {
          active += 1;
          let released = false;
          resolve(() => {
            if (released) return;
            released = true;
            active -= 1;
            const next = waiters.shift();
            if (next) next();
          });
        };
        if (active < limit) grant();
        else waiters.push(grant);
      });
    },
  });
}

/**
 * Run one step's task with optional `timeoutMs` and `retries` (with `fixed` or
 * `exponential` `retryDelayMs` backoff). An attempt counts as a failure if the
 * task throws, times out, or returns a non-`completed` status. Returns
 * `{ ok, entry?, error?, attempts }`. `attempts` is the total number of tries.
 */
export async function runStepWithRetry({
  step,
  message,
  cwd,
  llmOptions,
  taskSemaphore,
  runTask = _deps.runTask,
  recordId = step.id,
  iteration = 1,
  onTaskStart,
  admitted = false,
}) {
  const maxRetries = Math.max(0, Math.floor(Number(step.retries) || 0));
  const timeoutMs = Number(step.timeoutMs) || 0;
  let lastEntry = null;
  let lastErr = null;
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    let taskPromise = null;
    let abortController = null;
    let release = null;
    try {
      release = taskSemaphore ? await taskSemaphore.acquire() : () => {};
      if (admitted && timeoutMs > 0) abortController = new AbortController();
      if (attempt === 1) {
        notifyWorkflowCallback(
          onTaskStart,
          Object.freeze({ stepId: recordId, message }),
          admitted,
          "step start",
        );
      }
      taskPromise = Promise.resolve().then(() =>
        runTask({
          templateId: step.templateId || null,
          userMessage: message,
          files: step.files || [],
          cwd,
          llmOptions,
          workflowEffect: Object.freeze({
            stepId: recordId,
            iteration,
            attempt,
            timeoutMs,
          }),
          ...(abortController ? { signal: abortController.signal } : {}),
        }),
      );
      // A timeout abandons only the caller's wait. Keep the physical task's
      // permit until its promise really settles; retries and parallel children
      // must queue behind that late task instead of exceeding maxParallel.
      taskPromise.then(release, release);
      release = null; // the physical task now owns the permit
      const rawEntry = await withTimeout(() => taskPromise, timeoutMs);
      const entry = admitted ? normalizeAdmittedTaskEntry(rawEntry) : rawEntry;
      if (entry && entry.status === "completed") {
        return { ok: true, entry, attempts: attempt };
      }
      lastEntry = entry; // ran but not completed → retry-eligible
      lastErr = null;
    } catch (err) {
      if (release) release();
      if (err?.code === COWORK_WORKFLOW_CONTROL_SIGNAL_CODE) throw err;
      if (err?.code === COWORK_WORKFLOW_RUN_RESULT_INVALID_CODE) throw err;
      if (admitted && err?.code === STEP_TIMEOUT_CODE && taskPromise != null) {
        abortController.abort(err);
        // A terminal admitted record must never be written while the physical
        // task can still produce side effects. Confirm settlement before a
        // retry or final failure; a runner that ignores abort safely blocks.
        // A late completed result is authoritative and must not be replayed.
        try {
          const lateRawEntry = await taskPromise;
          const lateEntry = normalizeAdmittedTaskEntry(lateRawEntry);
          if (lateEntry.status === "completed") {
            return { ok: true, entry: lateEntry, attempts: attempt };
          }
          lastEntry = lateEntry;
          lastErr = null;
        } catch (lateError) {
          if (
            lateError?.code === COWORK_WORKFLOW_CONTROL_SIGNAL_CODE ||
            lateError?.code === COWORK_WORKFLOW_RUN_RESULT_INVALID_CODE
          ) {
            throw lateError;
          }
          // The timeout remains the attempt's externally visible failure when
          // a non-authoritative runner error arrives after the deadline.
          lastErr = err;
          lastEntry = null;
        }
      } else {
        lastErr = err; // threw or timed out → retry-eligible
        lastEntry = null;
      }
    }
    if (attempt <= maxRetries) {
      const delay = retryDelayFor(step, attempt);
      if (delay > 0) await _deps.sleep(delay);
    }
  }
  const attempts = maxRetries + 1;
  if (lastEntry) return { ok: false, entry: lastEntry, attempts };
  return { ok: false, error: lastErr, attempts };
}

/** Attach an `attempts` field only when more than one try occurred (keeps the
 * single-attempt result shape byte-identical to the pre-retry behavior). */
function _withAttempts(result, attempts) {
  if (attempts > 1) return { ...(result || {}), attempts };
  return result;
}

/** Build a single-step outcome object from a `runStepWithRetry` result. */
function outcomeFromRetry(recordId, r, admitted = false) {
  let outcome;
  if (r.ok || r.entry) {
    outcome = {
      id: recordId,
      status: r.entry.status,
      taskId: r.entry.taskId,
      result: _withAttempts(r.entry.result, r.attempts),
    };
  } else {
    outcome = {
      id: recordId,
      status: "failed",
      taskId: null,
      result: _withAttempts(
        { summary: `Step threw: ${safeRunErrorMessage(r.error)}` },
        r.attempts,
      ),
    };
  }
  return admitted ? normalizeAdmittedOutcome(outcome) : outcome;
}

// ─── while / until loop nodes ──────────────────────────────────────────────────

/** True when a step is a loop node (`loopWhile` or `loopUntil`). */
export function isLoopStep(step) {
  return step.loopWhile !== undefined || step.loopUntil !== undefined;
}

/** Resolve a loop step's iteration cap, clamped to MAX_LOOP_ITERATIONS. */
export function loopIterationCap(step) {
  const m = Number(step.maxIterations);
  if (Number.isFinite(m) && m > 0) {
    return Math.min(Math.floor(m), MAX_LOOP_ITERATIONS);
  }
  return MAX_LOOP_ITERATIONS;
}

/**
 * Substitute loop-local tokens in a message template: `${iter}` → the 1-based
 * iteration number, `${self.<field>}` → the step's own most-recent iteration
 * result (empty on the first iteration). Other `${step.<id>.<field>}` tokens
 * are left for `substitutePlaceholders`.
 */
export function substituteLoopVars(template, { stepId, iter, resultsById }) {
  if (typeof template !== "string") return template;
  let out = template.replace(/\$\{iter\}/g, String(iter));
  out = out.replace(/\$\{self\.([\w-]+)\}/g, (_, field) => {
    const entry = resultsById?.get?.(stepId);
    if (!entry) return "";
    if (field === "summary") return entry.result?.summary ?? "";
    if (field === "status") return entry.status ?? "";
    if (field === "taskId") return entry.taskId ?? "";
    if (field === "iterations") return String(entry.result?.iterations ?? 0);
    if (field === "tokenCount") return String(entry.result?.tokenCount ?? 0);
    const v = entry.result?.[field];
    return v == null ? "" : String(v);
  });
  return out;
}

/**
 * Evaluate whether a loop step should run another iteration (post-test). The
 * condition may reference `${self.<field>}` (the just-stored iteration result)
 * and `${iter}`. `loopWhile` continues while the expression is true; `loopUntil`
 * continues until it becomes true. Throws on a malformed expression.
 */
export function evalLoopContinue(step, { stepId, iter, resultsById }) {
  const isWhile = step.loopWhile !== undefined;
  const expr = isWhile ? step.loopWhile : step.loopUntil;
  const subst = String(expr)
    .replace(/\$\{iter\}/g, String(iter))
    .replace(/\$\{self\.([\w-]+)\}/g, (_, f) => `\${step.${stepId}.${f}}`);
  const val = evalExpr(subst, { step: resultsById });
  return isWhile ? val === true : val !== true;
}

/**
 * Run a loop step: repeat its task until the `loopWhile`/`loopUntil` condition
 * says to stop, a failing iteration aborts it, or the iteration cap is hit.
 * Each iteration inherits the step's retry/timeout config. The final result
 * carries `iterations`, `loopExhausted`, and `loopStop` (`condition`|`cap`|
 * `failed`|`bad-condition`).
 */
export async function runLoopStep({
  step,
  recordId,
  cwd,
  llmOptions,
  resultsById,
  taskSemaphore,
  runTask = _deps.runTask,
  onStepStart,
  admitted = false,
}) {
  const cap = loopIterationCap(step);
  let last = null;
  let iterations = 0;
  let stopReason = "cap";
  let startAnnounced = false;
  for (let iter = 1; iter <= cap; iter++) {
    iterations = iter;
    const withSelf = substituteLoopVars(step.message, {
      stepId: recordId,
      iter,
      resultsById,
    });
    const message = substitutePlaceholders(withSelf, resultsById);
    const r = await runStepWithRetry({
      step,
      message,
      cwd,
      llmOptions,
      taskSemaphore,
      runTask,
      recordId,
      iteration: iter,
      onTaskStart: (event) => {
        if (startAnnounced) return;
        startAnnounced = true;
        notifyWorkflowCallback(onStepStart, event, admitted, "step start");
      },
      admitted,
    });
    last = outcomeFromRetry(recordId, r, admitted);
    resultsById.set(recordId, last);
    if (last.status === "failed") {
      stopReason = "failed";
      break;
    }
    let cont;
    try {
      cont = evalLoopContinue(step, { stepId: recordId, iter, resultsById });
    } catch (err) {
      last = {
        id: recordId,
        status: "failed",
        taskId: null,
        result: {
          summary: `invalid loop condition on '${recordId}': ${err.message}`,
        },
      };
      resultsById.set(recordId, last);
      stopReason = "bad-condition";
      break;
    }
    if (!cont) {
      stopReason = "condition";
      break;
    }
  }
  const outcome = {
    id: recordId,
    status: last ? last.status : "skipped",
    taskId: last?.taskId ?? null,
    result: {
      ...(last?.result || {}),
      iterations,
      loopExhausted: stopReason === "cap",
      loopStop: stopReason,
    },
  };
  return admitted ? normalizeAdmittedOutcome(outcome) : outcome;
}

// ─── Step node + no-barrier pipeline ──────────────────────────────────────────

/**
 * Run a single step to completion, resolving its when-gate / loop / forEach /
 * plain task exactly as the batch executor does, and storing results (including
 * a forEach parent aggregate) in `resultsById`. Returns `{ outcomes, failed }`:
 * `outcomes` are the entries to add to the run's step list (forEach contributes
 * its children, not the parent); `failed` is true when any non-skipped outcome
 * is not "completed". Used by the no-barrier pipeline scheduler.
 */
export async function runStepNode(step, ctx) {
  const {
    resultsById,
    cwd,
    llmOptions,
    onStepStart,
    onStepComplete,
    taskSemaphore,
    runTask,
    admitted = false,
  } = ctx;
  const recordId = step.id;
  const single = (status, summary) => {
    const o = { id: recordId, status, taskId: null, result: { summary } };
    resultsById.set(recordId, o);
    return {
      outcomes: [o],
      failed: status !== "completed" && status !== "skipped",
    };
  };

  let runThis;
  try {
    runThis = shouldRunStep(step, resultsById);
  } catch (err) {
    return single("failed", err.message);
  }
  if (!runThis) return single("skipped", "when-condition false");

  if (isLoopStep(step)) {
    const o = await runLoopStep({
      step,
      recordId,
      cwd,
      llmOptions,
      resultsById,
      taskSemaphore,
      runTask,
      onStepStart,
      admitted,
    });
    resultsById.set(recordId, o);
    notifyWorkflowCallback(onStepComplete, o, admitted, "step complete");
    return {
      outcomes: [o],
      failed: o.status !== "completed" && o.status !== "skipped",
    };
  }

  if (step.forEach !== undefined) {
    let items;
    try {
      items = resolveForEachItems(step.forEach, resultsById);
    } catch (err) {
      return single("failed", err.message);
    }
    if (items.length === 0) return single("skipped", "forEach items empty");
    const children = await Promise.all(
      items.map(async (item, k) => {
        const childId = `${recordId}[${k}]`;
        const withItem = substituteItem(step.message, item);
        const msg = substitutePlaceholders(withItem, resultsById);
        const r = await runStepWithRetry({
          step,
          message: msg,
          cwd,
          llmOptions,
          taskSemaphore,
          runTask,
          recordId: childId,
          onTaskStart: onStepStart,
          admitted,
        });
        const co = outcomeFromRetry(childId, r, admitted);
        resultsById.set(childId, co);
        notifyWorkflowCallback(onStepComplete, co, admitted, "step complete");
        return co;
      }),
    );
    const allOk = children.every((c) => c.status === "completed");
    const anyOk = children.some((c) => c.status === "completed");
    resultsById.set(recordId, {
      id: recordId,
      status: allOk ? "completed" : anyOk ? "partial" : "failed",
      taskId: null,
      result: {
        summary: children.map((c) => c.result?.summary ?? "").join("\n"),
        children: children.length,
      },
    });
    return {
      outcomes: children,
      failed: children.some((c) => c.status !== "completed"),
    };
  }

  const message = substitutePlaceholders(step.message, resultsById);
  const r = await runStepWithRetry({
    step,
    message,
    cwd,
    llmOptions,
    taskSemaphore,
    runTask,
    recordId,
    onTaskStart: onStepStart,
    admitted,
  });
  const o = outcomeFromRetry(recordId, r, admitted);
  resultsById.set(recordId, o);
  notifyWorkflowCallback(onStepComplete, o, admitted, "step complete");
  return { outcomes: [o], failed: o.status !== "completed" };
}

/**
 * No-barrier pipeline scheduler: start each step the instant *its own*
 * dependencies finish, rather than waiting for the whole dependency level.
 * Up to `maxParallel` step nodes run concurrently. On failure with
 * `continueOnError` off, no new steps are scheduled (in-flight ones finish) and
 * the rest are marked skipped. Produces the same outcome set as the batch
 * executor — only the wall-clock idle between levels is removed.
 */
export async function runPipeline({
  steps,
  resultsById,
  maxParallel = 4,
  continueOnError = false,
  cwd,
  llmOptions = {},
  onStepStart,
  onStepComplete,
  taskSemaphore,
  runTask = _deps.runTask,
  admitted = false,
}) {
  const limit = Math.max(1, Math.floor(maxParallel) || 1);
  const remainingDeps = new Map(
    steps.map((s) => [s.id, new Set(s.dependsOn || [])]),
  );
  const dependents = new Map(steps.map((s) => [s.id, []]));
  for (const s of steps) {
    for (const d of s.dependsOn || []) {
      if (dependents.has(d)) dependents.get(d).push(s.id);
    }
  }
  const scheduled = new Set();
  const stepOutcomes = [];
  let anyFailure = false;
  let halted = false;
  let active = 0;
  let fatalError = null;

  await new Promise((resolve, reject) => {
    function pump() {
      if (!halted) {
        for (const s of steps) {
          if (active >= limit) break;
          if (scheduled.has(s.id)) continue;
          if (remainingDeps.get(s.id).size !== 0) continue;
          scheduled.add(s.id);
          active++;
          launch(s);
        }
      }
      if (active === 0 && (halted || scheduled.size === steps.length)) {
        if (fatalError) {
          reject(fatalError);
          return;
        }
        for (const s of steps) {
          if (scheduled.has(s.id)) continue;
          const o = {
            id: s.id,
            status: "skipped",
            taskId: null,
            result: { summary: "skipped due to earlier failure" },
          };
          resultsById.set(s.id, o);
          stepOutcomes.push(o);
          scheduled.add(s.id);
        }
        resolve();
      }
    }

    async function launch(step) {
      let res;
      try {
        res = await runStepNode(step, {
          resultsById,
          cwd,
          llmOptions,
          onStepStart,
          onStepComplete,
          taskSemaphore,
          runTask,
          admitted,
        });
      } catch (err) {
        if (
          err?.code === COWORK_WORKFLOW_RUN_RESULT_INVALID_CODE ||
          err?.code === COWORK_WORKFLOW_CONTROL_SIGNAL_CODE
        ) {
          fatalError ||= err;
          halted = true;
          active--;
          pump();
          return;
        }
        const o = {
          id: step.id,
          status: "failed",
          taskId: null,
          result: { summary: `Step threw: ${safeRunErrorMessage(err)}` },
        };
        resultsById.set(step.id, o);
        res = { outcomes: [o], failed: true };
      }
      stepOutcomes.push(...res.outcomes);
      active--;
      if (res.failed) {
        anyFailure = true;
        if (!continueOnError) halted = true;
      }
      for (const depId of dependents.get(step.id) || []) {
        remainingDeps.get(depId).delete(step.id);
      }
      pump();
    }

    pump();
  });

  return { stepOutcomes, anyFailure };
}

// ─── Execution ───────────────────────────────────────────────────────────────

function normalizeAdmittedRunRecord(
  value,
  runtimeWorkflow,
  definitionAuthority,
  runAdmission,
) {
  const record = snapshotAdmittedCanonicalValue(value, "workflow run record");
  const expectedFields = new Set([
    "schema",
    "workflowId",
    "workflowName",
    "definitionSchema",
    "definitionDigest",
    "runAdmission",
    "status",
    "steps",
    "startedAt",
    "finishedAt",
  ]);
  if (
    !record ||
    typeof record !== "object" ||
    Array.isArray(record) ||
    Reflect.ownKeys(record).length !== expectedFields.size ||
    Reflect.ownKeys(record).some(
      (field) => typeof field !== "string" || !expectedFields.has(field),
    ) ||
    record.schema !== COWORK_WORKFLOW_RUN_RECORD_SCHEMA ||
    record.workflowId !== runtimeWorkflow.id ||
    record.workflowName !== runtimeWorkflow.name ||
    record.definitionSchema !== definitionAuthority.schema ||
    record.definitionDigest !== definitionAuthority.definitionDigest ||
    !["completed", "failed", "partial"].includes(record.status) ||
    !Array.isArray(record.steps) ||
    record.steps.length === 0 ||
    record.steps.length > MAX_ADMITTED_RUN_STEPS ||
    typeof record.startedAt !== "string" ||
    typeof record.finishedAt !== "string" ||
    !Number.isFinite(Date.parse(record.startedAt)) ||
    !Number.isFinite(Date.parse(record.finishedAt)) ||
    new Date(record.startedAt).toISOString() !== record.startedAt ||
    new Date(record.finishedAt).toISOString() !== record.finishedAt ||
    Date.parse(record.finishedAt) < Date.parse(record.startedAt) ||
    canonicalJson(record.runAdmission, "recordRunAdmission") !==
      canonicalJson(runAdmission, "admittedRunAdmission")
  ) {
    throw runResultError("workflow run record has an invalid schema");
  }

  const outcomeIds = new Set();
  for (const [index, outcome] of record.steps.entries()) {
    normalizeAdmittedOutcome(outcome, `workflow run record step ${index}`);
    if (outcomeIds.has(outcome.id)) {
      throw runResultError("workflow run record contains duplicate step ids");
    }
    outcomeIds.add(outcome.id);
  }

  for (const step of runtimeWorkflow.steps) {
    if (step.forEach === undefined) {
      if (!outcomeIds.has(step.id)) {
        throw runResultError("workflow run record is missing a step outcome");
      }
      continue;
    }
    const childPrefix = `${step.id}[`;
    if (
      !outcomeIds.has(step.id) &&
      ![...outcomeIds].some(
        (outcomeId) =>
          outcomeId.startsWith(childPrefix) && outcomeId.endsWith("]"),
      )
    ) {
      throw runResultError("workflow run record is missing a forEach outcome");
    }
  }

  const expectedStatus = record.steps.every(
    (outcome) => outcome.status === "completed",
  )
    ? "completed"
    : record.steps.some((outcome) => outcome.status === "completed")
      ? "partial"
      : "failed";
  if (record.status !== expectedStatus) {
    throw runResultError(
      "workflow run record status does not match its step outcomes",
    );
  }
  return record;
}

/**
 * Execute a workflow. The runner for individual tasks must be injected via
 * `_deps.runTask` (signature matches `runCoworkTask`).
 *
 * Per-step robustness fields (all optional): `retries` (extra attempts after
 * the first; non-negative integer), `timeoutMs` (per-attempt timeout, positive
 * number), `retryDelayMs` (base delay before each retry, non-negative number),
 * `retryBackoff` (`"fixed"` (default) or `"exponential"`).
 *
 * Loop nodes (optional, mutually exclusive with `forEach`): `loopWhile` /
 * `loopUntil` (a `workflow-expr` condition that may reference `${self.<field>}`
 * — the step's own latest iteration result — and `${iter}`) repeat the step's
 * task (post-test) until the condition stops it, an iteration fails, or
 * `maxIterations` (≤ MAX_LOOP_ITERATIONS) is hit. Each iteration inherits the
 * step's retry/timeout config.
 *
 * @param {object} options
 * @param {object} options.workflow - Workflow definition
 * @param {string} [options.definitionDigest] - Exact definition digest to bind
 * @param {string} [options.cwd] - Working directory for history
 * @param {number} [options.maxParallel] - Max parallel steps (per batch, or
 *   concurrent step nodes in pipeline mode)
 * @param {boolean} [options.continueOnError] - Keep running after a failure
 * @param {boolean} [options.pipeline] - No-barrier scheduling: start each step
 *   as soon as its own deps finish instead of waiting for the dependency level.
 *   Defaults to `workflow.pipeline ?? false`. Same outcomes, less idle wait.
 * @param {object} [options.llmOptions] - Forwarded to each task
 * @param {function} [options.onStepStart]
 * @param {function} [options.onStepComplete]
 * @param {object} [options.runAdmission] - Secret-free, digest-bound dynamic
 *   workflow admission. Production entry points require this even though the
 *   low-level executor keeps it optional for existing library callers.
 * @returns {Promise<{
 *   workflowId: string,
 *   status: "completed"|"failed"|"partial",
 *   steps: Array<{ id, status, taskId, result }>,
 *   startedAt: string,
 *   finishedAt: string,
 * }>}
 */
export async function executeWorkflow(options = {}) {
  const {
    workflow,
    definitionDigest: requestedDefinitionDigest,
    cwd = process.cwd(),
    maxParallel = 4,
    continueOnError = false,
    llmOptions = {},
    onStepStart,
    onStepComplete,
    pipeline,
    runAdmission,
    runTask: requestedRunTask,
  } = options;

  const definitionAuthority = createWorkflowDefinitionAuthority(workflow);
  const runtimeWorkflow = definitionAuthority.definition;
  const { valid, errors } = validateWorkflow(runtimeWorkflow);
  if (!valid) throw new Error(`Invalid workflow: ${errors.join("; ")}`);
  const numericMaxParallel = Number(maxParallel);
  const concurrencyLimit =
    Number.isSafeInteger(numericMaxParallel) && numericMaxParallel > 0
      ? numericMaxParallel
      : 1;
  const usePipeline = pipeline ?? runtimeWorkflow.pipeline ?? false;
  const runtimeLlmOptions =
    runAdmission == null ? llmOptions : normalizeAdmittedLlmOptions(llmOptions);
  if (requestedDefinitionDigest != null) {
    const normalizedDigest = normalizeWorkflowDefinitionDigest(
      requestedDefinitionDigest,
    );
    if (!normalizedDigest) {
      throw new Error("workflow definition digest is invalid");
    }
    if (normalizedDigest !== definitionAuthority.definitionDigest) {
      throw new Error("workflow definition digest mismatch");
    }
  }
  const verifiedRunAdmission =
    runAdmission == null
      ? null
      : normalizeWorkflowRunAdmission(
          runAdmission,
          definitionAuthority,
          concurrencyLimit,
          {
            cwd,
            continueOnError,
            pipeline: usePipeline,
            llmOptions: runtimeLlmOptions,
          },
        );
  const runtimeRunTask = requestedRunTask ?? _deps.runTask;
  if (typeof runtimeRunTask !== "function") {
    throw new Error(
      "cowork-workflow: runTask is not available (wire runCoworkTask before executing)",
    );
  }

  const taskSemaphore = createWorkflowTaskSemaphore(concurrencyLimit);
  const resultsById = new Map();
  const startedAt = new Date(_deps.now()).toISOString();
  let stepOutcomes;
  let anyFailure;

  if (usePipeline) {
    ({ stepOutcomes, anyFailure } = await runPipeline({
      steps: runtimeWorkflow.steps,
      resultsById,
      maxParallel: concurrencyLimit,
      continueOnError,
      cwd,
      llmOptions: runtimeLlmOptions,
      onStepStart,
      onStepComplete,
      taskSemaphore,
      runTask: runtimeRunTask,
      admitted: verifiedRunAdmission != null,
    }));
  } else {
    stepOutcomes = [];
    anyFailure = false;
    const batches = planBatches(runtimeWorkflow.steps);
    for (const batch of batches) {
      // Respect maxParallel by slicing batch into chunks
      const chunks = [];
      for (let i = 0; i < batch.length; i += concurrencyLimit) {
        chunks.push(batch.slice(i, i + concurrencyLimit));
      }

      for (const chunk of chunks) {
        // Expand forEach / when into concrete tasks for this chunk
        const runnable = []; // { step, message, recordId, parentId }
        const preOutcomes = []; // outcomes produced synchronously (skipped)
        for (const step of chunk) {
          if (anyFailure && !continueOnError) {
            const outcome = {
              id: step.id,
              status: "skipped",
              taskId: null,
              result: { summary: "skipped due to earlier failure" },
            };
            resultsById.set(step.id, outcome);
            preOutcomes.push(outcome);
            continue;
          }
          // when-gate
          let runThis = true;
          try {
            runThis = shouldRunStep(step, resultsById);
          } catch (err) {
            anyFailure = true;
            const outcome = {
              id: step.id,
              status: "failed",
              taskId: null,
              result: { summary: err.message },
            };
            resultsById.set(step.id, outcome);
            preOutcomes.push(outcome);
            continue;
          }
          if (!runThis) {
            const outcome = {
              id: step.id,
              status: "skipped",
              taskId: null,
              result: { summary: "when-condition false" },
            };
            resultsById.set(step.id, outcome);
            preOutcomes.push(outcome);
            continue;
          }
          // loop node — runs its body repeatedly; per-iteration substitution
          // happens inside runLoopStep, so push the raw template.
          if (isLoopStep(step)) {
            runnable.push({
              step,
              message: step.message,
              recordId: step.id,
              parentId: null,
              isLoop: true,
            });
            continue;
          }
          // forEach-expansion
          if (step.forEach !== undefined) {
            let items;
            try {
              items = resolveForEachItems(step.forEach, resultsById);
            } catch (err) {
              anyFailure = true;
              const outcome = {
                id: step.id,
                status: "failed",
                taskId: null,
                result: { summary: err.message },
              };
              resultsById.set(step.id, outcome);
              preOutcomes.push(outcome);
              continue;
            }
            if (items.length === 0) {
              const outcome = {
                id: step.id,
                status: "skipped",
                taskId: null,
                result: { summary: "forEach items empty" },
              };
              resultsById.set(step.id, outcome);
              preOutcomes.push(outcome);
              continue;
            }
            for (let k = 0; k < items.length; k++) {
              const childId = `${step.id}[${k}]`;
              const withItem = substituteItem(step.message, items[k]);
              const msg = substitutePlaceholders(withItem, resultsById);
              runnable.push({
                step,
                message: msg,
                recordId: childId,
                parentId: step.id,
              });
            }
            continue;
          }
          const message = substitutePlaceholders(step.message, resultsById);
          runnable.push({ step, message, recordId: step.id, parentId: null });
        }

        const promises = runnable.map(
          async ({ step, message, recordId, isLoop }) => {
            let outcome;
            if (isLoop) {
              outcome = await runLoopStep({
                step,
                recordId,
                cwd,
                llmOptions: runtimeLlmOptions,
                resultsById,
                taskSemaphore,
                runTask: runtimeRunTask,
                onStepStart,
                admitted: verifiedRunAdmission != null,
              });
            } else {
              const r = await runStepWithRetry({
                step,
                message,
                cwd,
                llmOptions: runtimeLlmOptions,
                taskSemaphore,
                runTask: runtimeRunTask,
                recordId,
                onTaskStart: onStepStart,
                admitted: verifiedRunAdmission != null,
              });
              outcome = outcomeFromRetry(
                recordId,
                r,
                verifiedRunAdmission != null,
              );
            }
            if (outcome.status !== "completed") anyFailure = true;
            resultsById.set(recordId, outcome);
            notifyWorkflowCallback(
              onStepComplete,
              outcome,
              verifiedRunAdmission != null,
              "step complete",
            );
            return outcome;
          },
        );

        const settledResults = await Promise.allSettled(promises);
        const rejected = settledResults.find(
          (settled) => settled.status === "rejected",
        );
        if (rejected) throw rejected.reason;
        const results = settledResults.map((settled) => settled.value);
        stepOutcomes.push(...preOutcomes, ...results);

        // Aggregate forEach children into a parent entry so downstream
        // `${step.<parent>.summary}` references still work.
        const byParent = new Map();
        for (let k = 0; k < runnable.length; k++) {
          const r = runnable[k];
          if (!r.parentId) continue;
          if (!byParent.has(r.parentId)) byParent.set(r.parentId, []);
          byParent.get(r.parentId).push(results[k]);
        }
        for (const [parentId, children] of byParent) {
          const allOk = children.every((c) => c.status === "completed");
          const anyOk = children.some((c) => c.status === "completed");
          const status = allOk ? "completed" : anyOk ? "partial" : "failed";
          resultsById.set(parentId, {
            id: parentId,
            status,
            taskId: null,
            result: {
              summary: children.map((c) => c.result?.summary ?? "").join("\n"),
              children: children.length,
            },
          });
        }
      }
    }
  }

  const finishedAt = new Date(_deps.now()).toISOString();
  const allCompleted = stepOutcomes.every((s) => s.status === "completed");
  const status = allCompleted
    ? "completed"
    : stepOutcomes.some((s) => s.status === "completed")
      ? "partial"
      : "failed";

  const record = {
    schema: COWORK_WORKFLOW_RUN_RECORD_SCHEMA,
    workflowId: runtimeWorkflow.id,
    workflowName: runtimeWorkflow.name,
    definitionSchema: definitionAuthority.schema,
    definitionDigest: definitionAuthority.definitionDigest,
    ...(verifiedRunAdmission ? { runAdmission: verifiedRunAdmission } : {}),
    status,
    steps: stepOutcomes,
    startedAt,
    finishedAt,
  };
  const finalRecord = verifiedRunAdmission
    ? normalizeAdmittedRunRecord(
        record,
        runtimeWorkflow,
        definitionAuthority,
        verifiedRunAdmission,
      )
    : record;
  _appendHistory(cwd, finalRecord);
  return finalRecord;
}

function _appendHistory(cwd, record) {
  try {
    const dir = join(cwd, ".chainlesschain", "cowork");
    _deps.mkdirSync(dir, { recursive: true });
    _deps.appendFileSync(
      historyFile(cwd),
      JSON.stringify(record) + "\n",
      "utf-8",
    );
  } catch {
    // best-effort
  }
}

// =====================================================================
// cowork-workflow V2 governance overlay (iter17)
// =====================================================================
export const CWWF_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  PAUSED: "paused",
  ARCHIVED: "archived",
});
export const CWWF_STEP_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _cwwfPTrans = new Map([
  [
    CWWF_PROFILE_MATURITY_V2.PENDING,
    new Set([
      CWWF_PROFILE_MATURITY_V2.ACTIVE,
      CWWF_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    CWWF_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      CWWF_PROFILE_MATURITY_V2.PAUSED,
      CWWF_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    CWWF_PROFILE_MATURITY_V2.PAUSED,
    new Set([
      CWWF_PROFILE_MATURITY_V2.ACTIVE,
      CWWF_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [CWWF_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _cwwfPTerminal = new Set([CWWF_PROFILE_MATURITY_V2.ARCHIVED]);
const _cwwfJTrans = new Map([
  [
    CWWF_STEP_LIFECYCLE_V2.QUEUED,
    new Set([CWWF_STEP_LIFECYCLE_V2.RUNNING, CWWF_STEP_LIFECYCLE_V2.CANCELLED]),
  ],
  [
    CWWF_STEP_LIFECYCLE_V2.RUNNING,
    new Set([
      CWWF_STEP_LIFECYCLE_V2.COMPLETED,
      CWWF_STEP_LIFECYCLE_V2.FAILED,
      CWWF_STEP_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [CWWF_STEP_LIFECYCLE_V2.COMPLETED, new Set()],
  [CWWF_STEP_LIFECYCLE_V2.FAILED, new Set()],
  [CWWF_STEP_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _cwwfPsV2 = new Map();
const _cwwfJsV2 = new Map();
let _cwwfMaxActive = 8,
  _cwwfMaxPending = 20,
  _cwwfIdleMs = 30 * 24 * 60 * 60 * 1000,
  _cwwfStuckMs = 60 * 1000;
function _cwwfPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _cwwfCheckP(from, to) {
  const a = _cwwfPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid cwwf profile transition ${from} → ${to}`);
}
function _cwwfCheckJ(from, to) {
  const a = _cwwfJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid cwwf step transition ${from} → ${to}`);
}
function _cwwfCountActive(owner) {
  let c = 0;
  for (const p of _cwwfPsV2.values())
    if (p.owner === owner && p.status === CWWF_PROFILE_MATURITY_V2.ACTIVE) c++;
  return c;
}
function _cwwfCountPending(profileId) {
  let c = 0;
  for (const j of _cwwfJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === CWWF_STEP_LIFECYCLE_V2.QUEUED ||
        j.status === CWWF_STEP_LIFECYCLE_V2.RUNNING)
    )
      c++;
  return c;
}
export function setMaxActiveCwwfProfilesPerOwnerV2(n) {
  _cwwfMaxActive = _cwwfPos(n, "maxActiveCwwfProfilesPerOwner");
}
export function getMaxActiveCwwfProfilesPerOwnerV2() {
  return _cwwfMaxActive;
}
export function setMaxPendingCwwfStepsPerProfileV2(n) {
  _cwwfMaxPending = _cwwfPos(n, "maxPendingCwwfStepsPerProfile");
}
export function getMaxPendingCwwfStepsPerProfileV2() {
  return _cwwfMaxPending;
}
export function setCwwfProfileIdleMsV2(n) {
  _cwwfIdleMs = _cwwfPos(n, "cwwfProfileIdleMs");
}
export function getCwwfProfileIdleMsV2() {
  return _cwwfIdleMs;
}
export function setCwwfStepStuckMsV2(n) {
  _cwwfStuckMs = _cwwfPos(n, "cwwfStepStuckMs");
}
export function getCwwfStepStuckMsV2() {
  return _cwwfStuckMs;
}
export function _resetStateCoworkWorkflowV2() {
  _cwwfPsV2.clear();
  _cwwfJsV2.clear();
  _cwwfMaxActive = 8;
  _cwwfMaxPending = 20;
  _cwwfIdleMs = 30 * 24 * 60 * 60 * 1000;
  _cwwfStuckMs = 60 * 1000;
}
export function registerCwwfProfileV2({ id, owner, mode, metadata } = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_cwwfPsV2.has(id)) throw new Error(`cwwf profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    mode: mode || "sequential",
    status: CWWF_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _cwwfPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateCwwfProfileV2(id) {
  const p = _cwwfPsV2.get(id);
  if (!p) throw new Error(`cwwf profile ${id} not found`);
  const isInitial = p.status === CWWF_PROFILE_MATURITY_V2.PENDING;
  _cwwfCheckP(p.status, CWWF_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _cwwfCountActive(p.owner) >= _cwwfMaxActive)
    throw new Error(`max active cwwf profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = CWWF_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function pauseCwwfProfileV2(id) {
  const p = _cwwfPsV2.get(id);
  if (!p) throw new Error(`cwwf profile ${id} not found`);
  _cwwfCheckP(p.status, CWWF_PROFILE_MATURITY_V2.PAUSED);
  p.status = CWWF_PROFILE_MATURITY_V2.PAUSED;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveCwwfProfileV2(id) {
  const p = _cwwfPsV2.get(id);
  if (!p) throw new Error(`cwwf profile ${id} not found`);
  _cwwfCheckP(p.status, CWWF_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = CWWF_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchCwwfProfileV2(id) {
  const p = _cwwfPsV2.get(id);
  if (!p) throw new Error(`cwwf profile ${id} not found`);
  if (_cwwfPTerminal.has(p.status))
    throw new Error(`cannot touch terminal cwwf profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getCwwfProfileV2(id) {
  const p = _cwwfPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listCwwfProfilesV2() {
  return [..._cwwfPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createCwwfStepV2({ id, profileId, task, metadata } = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_cwwfJsV2.has(id)) throw new Error(`cwwf step ${id} already exists`);
  if (!_cwwfPsV2.has(profileId))
    throw new Error(`cwwf profile ${profileId} not found`);
  if (_cwwfCountPending(profileId) >= _cwwfMaxPending)
    throw new Error(`max pending cwwf steps for profile ${profileId} reached`);
  const now = Date.now();
  const j = {
    id,
    profileId,
    task: task || "",
    status: CWWF_STEP_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _cwwfJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function runningCwwfStepV2(id) {
  const j = _cwwfJsV2.get(id);
  if (!j) throw new Error(`cwwf step ${id} not found`);
  _cwwfCheckJ(j.status, CWWF_STEP_LIFECYCLE_V2.RUNNING);
  const now = Date.now();
  j.status = CWWF_STEP_LIFECYCLE_V2.RUNNING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeStepCwwfV2(id) {
  const j = _cwwfJsV2.get(id);
  if (!j) throw new Error(`cwwf step ${id} not found`);
  _cwwfCheckJ(j.status, CWWF_STEP_LIFECYCLE_V2.COMPLETED);
  const now = Date.now();
  j.status = CWWF_STEP_LIFECYCLE_V2.COMPLETED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failCwwfStepV2(id, reason) {
  const j = _cwwfJsV2.get(id);
  if (!j) throw new Error(`cwwf step ${id} not found`);
  _cwwfCheckJ(j.status, CWWF_STEP_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = CWWF_STEP_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelCwwfStepV2(id, reason) {
  const j = _cwwfJsV2.get(id);
  if (!j) throw new Error(`cwwf step ${id} not found`);
  _cwwfCheckJ(j.status, CWWF_STEP_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = CWWF_STEP_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getCwwfStepV2(id) {
  const j = _cwwfJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listCwwfStepsV2() {
  return [..._cwwfJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoPauseIdleCwwfProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _cwwfPsV2.values())
    if (
      p.status === CWWF_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _cwwfIdleMs
    ) {
      p.status = CWWF_PROFILE_MATURITY_V2.PAUSED;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckCwwfStepsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _cwwfJsV2.values())
    if (
      j.status === CWWF_STEP_LIFECYCLE_V2.RUNNING &&
      j.startedAt != null &&
      t - j.startedAt >= _cwwfStuckMs
    ) {
      j.status = CWWF_STEP_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getCoworkWorkflowGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(CWWF_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _cwwfPsV2.values()) profilesByStatus[p.status]++;
  const stepsByStatus = {};
  for (const v of Object.values(CWWF_STEP_LIFECYCLE_V2)) stepsByStatus[v] = 0;
  for (const j of _cwwfJsV2.values()) stepsByStatus[j.status]++;
  return {
    totalCwwfProfilesV2: _cwwfPsV2.size,
    totalCwwfStepsV2: _cwwfJsV2.size,
    maxActiveCwwfProfilesPerOwner: _cwwfMaxActive,
    maxPendingCwwfStepsPerProfile: _cwwfMaxPending,
    cwwfProfileIdleMs: _cwwfIdleMs,
    cwwfStepStuckMs: _cwwfStuckMs,
    profilesByStatus,
    stepsByStatus,
  };
}

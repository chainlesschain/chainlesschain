import { createHash } from "node:crypto";
import { posix as posixPath, win32 as win32Path } from "node:path";
import { types as utilTypes } from "node:util";
import {
  COWORK_WORKFLOW_RUN_RECORD_SCHEMA,
  MAX_FAN_OUT,
  executeWorkflow as executeCoworkWorkflow,
  loopIterationCap,
  planBatches,
  resolveForEachItems,
  shouldRunStep,
  validateWorkflow,
} from "./cowork-workflow.js";
import {
  EXECUTION_LOCATION,
  normalizeExecutionLocation,
  redactCredentialRefs,
} from "./execution-location.js";
import { normalizeExecutionLocationBinding } from "./execution-location-contract.js";
import {
  COWORK_WORKFLOW_RECORD_SCHEMA,
  WORKFLOW_DEFINITION_SCHEMA,
  createWorkflowDefinitionAuthority,
  normalizeWorkflowDefinitionDigest,
} from "./workflow-definition-contract.js";
import { canonicalJson } from "./scheduler-kernel/contract.js";

export const DYNAMIC_WORKFLOW_DEFINITION_SCHEMA = WORKFLOW_DEFINITION_SCHEMA;
export const DYNAMIC_WORKFLOW_PREFLIGHT_SCHEMA =
  "cc-dynamic-workflow-preflight/v1";
export const DYNAMIC_WORKFLOW_RUN_ADMISSION_SCHEMA =
  "cc-dynamic-workflow-run-admission/v1";
export const SESSION_EXECUTION_LOCATION_AUTHORITY_SCHEMA =
  "cc-session-execution-location-authority/v1";
export const DYNAMIC_WORKFLOW_PREFLIGHT_BLOCKED_CODE =
  "CC_DYNAMIC_WORKFLOW_PREFLIGHT_BLOCKED";
export const DYNAMIC_WORKFLOW_EXECUTION_AUTHORITY_INVALID_CODE =
  "CC_DYNAMIC_WORKFLOW_EXECUTION_AUTHORITY_INVALID";
export const DYNAMIC_WORKFLOW_DEFINITION_AUTHORITY_INVALID_CODE =
  "CC_DYNAMIC_WORKFLOW_DEFINITION_AUTHORITY_INVALID";
export const DYNAMIC_WORKFLOW_EXECUTION_OPTIONS_INVALID_CODE =
  "CC_DYNAMIC_WORKFLOW_EXECUTION_OPTIONS_INVALID";
export const DYNAMIC_WORKFLOW_EXECUTION_RESULT_INVALID_CODE =
  "CC_DYNAMIC_WORKFLOW_EXECUTION_RESULT_INVALID";

export const DYNAMIC_WORKFLOW_ENGINE_CAPABILITIES = Object.freeze([
  "condition",
  "cowork-task",
  "dag",
  "for-each",
  "loop",
  "parallel",
  "pipeline",
  "retry",
  "timeout",
  "variables",
]);

const CAPABILITY_SET = new Set(DYNAMIC_WORKFLOW_ENGINE_CAPABILITIES);
const FORBIDDEN_CREDENTIAL_KEYS = new Set([
  "accesstoken",
  "apikey",
  "authorization",
  "bearer",
  "clientsecret",
  "credentialvalue",
  "key",
  "password",
  "privatekey",
  "secret",
  "token",
  "value",
]);
const CREDENTIAL_SOURCES = new Set([
  "config",
  "env",
  "environment",
  "keychain",
  "local-provider",
  "managed-secret",
  "none",
  "not-observed",
  "unknown",
]);
const DATA_BOUNDARY_KINDS = new Set([
  "declared",
  "repository",
  "working-directory",
]);
const SANDBOX_RANK = Object.freeze({ none: 0, partial: 1, strong: 2 });
const DEFAULT_SOFT_TASK_GUIDELINE = 16;
const DEFAULT_HARD_TASK_LIMIT = 64;
const MAX_AUTHORITY_SNAPSHOT_NODES = 25_000;
const MAX_CANONICAL_SNAPSHOT_BYTES = 1024 * 1024;
const MAX_RUN_RECORD_STEPS = DEFAULT_HARD_TASK_LIMIT;
const RUN_INPUT_FIELDS = new Set([
  "definitionAuthority",
  "executionAuthoritySessionId",
  "maxParallel",
  "execution",
  "onAdmitted",
]);
const RUN_DEPENDENCY_FIELDS = new Set(["executeWorkflow", "verifyAuthorities"]);
const VERIFIED_AUTHORITIES_FIELDS = new Set([
  "definitionAuthority",
  "executionLocationAuthority",
]);
const VERIFIED_SESSION_AUTHORITY_FIELDS = new Set([
  "schema",
  "authority",
  "sessionId",
  "headHash",
  "eventCount",
  "binding",
]);
const DEFINITION_AUTHORITY_FIELDS = new Set([
  "status",
  "recordSchema",
  "definitionSchema",
  "definitionDigest",
  "definition",
]);
const EXECUTION_OPTION_FIELDS = new Set([
  "cwd",
  "continueOnError",
  "pipeline",
  "provider",
  "model",
  "llmOptions",
  "onStepStart",
  "onStepComplete",
]);
const RUN_RECORD_FIELDS = new Set([
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
const RUN_RECORD_STATUSES = new Set(["completed", "failed", "partial"]);
const RUN_RECORD_STEP_FIELDS = new Set(["id", "status", "taskId", "result"]);
const RUN_RECORD_STEP_STATUSES = new Set([
  "completed",
  "failed",
  "partial",
  "skipped",
]);

export class DynamicWorkflowAdmissionError extends Error {
  constructor(code, message, details = undefined, options = {}) {
    super(message);
    this.name = "DynamicWorkflowAdmissionError";
    this.code = code;
    this.record = null;
    this.executionStarted = options.executionStarted === true;
    if (details !== undefined) this.details = details;
  }
}

function admissionError(code, message, details, options) {
  return new DynamicWorkflowAdmissionError(code, message, details, options);
}

function snapshotObjectFields(
  value,
  fields,
  code,
  field,
  { exact = true } = {},
) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value)
  ) {
    throw admissionError(code, `${field} must be a non-proxy plain object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw admissionError(code, `${field} must be a plain object`);
  }

  const keys = Reflect.ownKeys(value);
  if (
    (exact && keys.length !== fields.size) ||
    keys.some((key) => typeof key !== "string" || !fields.has(key))
  ) {
    throw admissionError(code, `${field} contains missing or unknown fields`);
  }

  const snapshot = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      !descriptor ||
      descriptor.enumerable !== true ||
      !Object.hasOwn(descriptor, "value")
    ) {
      throw admissionError(
        code,
        `${field}.${key} must be an enumerable data property`,
      );
    }
    Object.defineProperty(snapshot, key, {
      configurable: true,
      enumerable: true,
      writable: true,
      value: descriptor.value,
    });
  }
  return Object.freeze(snapshot);
}

function snapshotCanonicalValue(
  value,
  code,
  field,
  {
    maxBytes = MAX_CANONICAL_SNAPSHOT_BYTES,
    maxNodes = MAX_AUTHORITY_SNAPSHOT_NODES,
  } = {},
) {
  const seen = new WeakSet();
  let nodes = 0;
  let roughCharacters = 0;

  const invalid = (reason) => {
    throw admissionError(code, `${field} ${reason}`);
  };
  const account = (count = 1) => {
    nodes += 1;
    roughCharacters += count;
    if (nodes > maxNodes || roughCharacters > maxBytes) {
      invalid("exceeds snapshot limits");
    }
  };
  const accountCharacters = (count) => {
    roughCharacters += count;
    if (roughCharacters > maxBytes) invalid("exceeds snapshot limits");
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
        const key = String(index);
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (
          !descriptor ||
          descriptor.enumerable !== true ||
          !Object.hasOwn(descriptor, "value")
        ) {
          invalid("contains an accessor or sparse array entry");
        }
        output.push(visit(descriptor.value, depth + 1));
      }
      if (
        keys.some(
          (key) =>
            key !== "length" &&
            (typeof key !== "string" ||
              !/^(0|[1-9][0-9]*)$/u.test(key) ||
              Number(key) >= current.length),
        )
      ) {
        invalid("contains an extended array");
      }
      return Object.freeze(output);
    }

    const prototype = Object.getPrototypeOf(current);
    if (prototype !== Object.prototype && prototype !== null) {
      invalid("contains a non-plain object");
    }
    const keys = Reflect.ownKeys(current);
    if (keys.length > maxNodes) invalid("contains an oversized object");
    const output = {};
    for (const key of keys) {
      if (typeof key !== "string") invalid("contains a symbol property");
      accountCharacters(key.length);
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (
        !descriptor ||
        descriptor.enumerable !== true ||
        !Object.hasOwn(descriptor, "value")
      ) {
        invalid("contains an accessor or non-enumerable property");
      }
      Object.defineProperty(output, key, {
        configurable: false,
        enumerable: true,
        writable: false,
        value: visit(descriptor.value, depth + 1),
      });
    }
    return Object.freeze(output);
  };

  const snapshot = visit(value, 0);
  let encoded;
  try {
    encoded = canonicalJson(snapshot, field);
  } catch {
    invalid("is not canonical JSON");
  }
  if (Buffer.byteLength(encoded, "utf8") > maxBytes) {
    invalid("exceeds encoded byte limits");
  }
  return snapshot;
}

function domainSeparatedDigest(domain, value, field) {
  return `sha256:${createHash("sha256")
    .update(domain, "utf8")
    .update(canonicalJson(value, field), "utf8")
    .digest("hex")}`;
}

function safeString(value, max = 256) {
  if (typeof value !== "string") return null;
  const output = value.trim();
  let containsControlCharacter = false;
  for (let index = 0; index < output.length; index += 1) {
    const code = output.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) {
      containsControlCharacter = true;
      break;
    }
  }
  if (!output || output.length > max || containsControlCharacter) {
    return null;
  }
  return output;
}

function finiteNumber(value, { integer = false, min = 0 } = {}) {
  const output =
    typeof value === "number"
      ? value
      : typeof value === "string" &&
          /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/u.test(value)
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(output) || output < min) return null;
  if (integer && !Number.isSafeInteger(output)) return null;
  return output;
}

function uniqueNames(values) {
  const output = [];
  for (const value of Array.isArray(values) ? values : []) {
    const name = safeString(value, 64)?.toLowerCase();
    if (name && /^[a-z0-9_.:-]+$/u.test(name) && !output.includes(name)) {
      output.push(name);
    }
  }
  return output.sort();
}

function usedCapabilities(workflow, batches) {
  const capabilities = new Set(["cowork-task", "dag", "variables"]);
  if (batches.some((batch) => batch.steps.length > 1)) {
    capabilities.add("parallel");
  }
  if (workflow.pipeline === true) capabilities.add("pipeline");
  for (const step of workflow.steps) {
    if (step.when != null) capabilities.add("condition");
    if (step.forEach != null) {
      capabilities.add("for-each");
      capabilities.add("parallel");
    }
    if (step.loopWhile != null || step.loopUntil != null)
      capabilities.add("loop");
    if (Number(step.retries) > 0) capabilities.add("retry");
    if (Number(step.timeoutMs) > 0) capabilities.add("timeout");
  }
  return [...capabilities].sort();
}

function stepProjection(step) {
  const retries =
    step.retries == null
      ? 0
      : finiteNumber(step.retries, { integer: true, min: 0 });
  if (retries == null || retries >= Number.MAX_SAFE_INTEGER) {
    throw new TypeError(
      `workflow step '${step.id}' retries exceed safe projection limits`,
    );
  }
  const attempts = retries + 1;
  let expansion = 1;
  let expansionKnown = true;
  let expansionSource = "single";
  if (Array.isArray(step.forEach)) {
    if (step.forEach.length > MAX_FAN_OUT) {
      throw new TypeError(
        `workflow step '${step.id}' exceeds MAX_FAN_OUT=${MAX_FAN_OUT}`,
      );
    }
    expansion = step.forEach.length;
    expansionSource = "literal-for-each";
  } else if (typeof step.forEach === "string") {
    expansion = null;
    expansionKnown = false;
    expansionSource = "runtime-for-each";
  } else if (step.loopWhile != null || step.loopUntil != null) {
    expansion = loopIterationCap(step);
    expansionSource = "loop-cap";
  }
  return Object.freeze({
    id: step.id,
    dependencies: Object.freeze([...(step.dependsOn || [])].sort()),
    attemptsPerTask: attempts,
    expansion,
    expansionKnown,
    expansionSource,
    worstCaseTaskCalls: expansionKnown ? expansion * attempts : null,
    worstCaseDurationSlots: expansionKnown
      ? expansionSource === "literal-for-each"
        ? expansion === 0
          ? 0
          : attempts
        : expansion * attempts
      : null,
  });
}

function containsCredentialValue(value, seen = new Set()) {
  if (!value || typeof value !== "object") return false;
  if (seen.has(value)) return true;
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/gu, "");
    if (FORBIDDEN_CREDENTIAL_KEYS.has(normalizedKey) && child != null) {
      return true;
    }
    if (containsCredentialValue(child, seen)) return true;
  }
  return false;
}

function normalizeGovernance(workflow) {
  const facade =
    workflow.facade && typeof workflow.facade === "object"
      ? workflow.facade
      : {};
  const requirements =
    facade.requirements && typeof facade.requirements === "object"
      ? facade.requirements
      : {};
  const rawCredentials = Array.isArray(requirements.credentials)
    ? requirements.credentials
    : [];
  const credentialValuePresent = containsCredentialValue(rawCredentials);
  const redactedCredentials = credentialValuePresent
    ? []
    : redactCredentialRefs(rawCredentials).map((credential) => {
        const source = safeString(credential.source)?.toLowerCase();
        return Object.freeze({
          name: safeString(credential.name),
          source: CREDENTIAL_SOURCES.has(source) ? source : "unknown",
          scope: safeString(credential.scope),
        });
      });
  const credentialKeys = redactedCredentials.map(
    (credential) =>
      `${credential.name || ""}\u0000${credential.source}\u0000${credential.scope || ""}`,
  );
  const credentialDeclarationInvalid =
    !credentialValuePresent &&
    (redactedCredentials.length !== rawCredentials.length ||
      redactedCredentials.some(
        (credential) =>
          !credential.name ||
          ["none", "not-observed", "unknown"].includes(credential.source),
      ) ||
      new Set(credentialKeys).size !== credentialKeys.length);
  const credentials = credentialDeclarationInvalid ? [] : redactedCredentials;
  const rawCapabilities = Array.isArray(requirements.capabilities)
    ? requirements.capabilities
    : [];
  const capabilities = uniqueNames(rawCapabilities);
  const rawLocations = Array.isArray(requirements.executionLocations)
    ? requirements.executionLocations
    : [];
  const executionLocations = [
    ...new Set(
      uniqueNames(rawLocations)
        .map(normalizeExecutionLocation)
        .filter((location) => location !== EXECUTION_LOCATION.UNKNOWN),
    ),
  ].sort();
  const permissionInput =
    requirements.permissions && typeof requirements.permissions === "object"
      ? requirements.permissions
      : null;
  const permissionDeclarationInvalid =
    permissionInput != null &&
    (!Object.hasOwn(permissionInput, "file") ||
      !["none", "read", "write"].includes(permissionInput.file) ||
      ["shell", "network", "mcp", "externalSystems"].some(
        (key) =>
          Object.hasOwn(permissionInput, key) &&
          typeof permissionInput[key] !== "boolean",
      ));
  const permissions = permissionInput
    ? Object.freeze({
        file: ["none", "read", "write"].includes(permissionInput.file)
          ? permissionInput.file
          : null,
        shell: permissionInput.shell === true,
        network: permissionInput.network === true,
        mcp: permissionInput.mcp === true,
        externalSystems: permissionInput.externalSystems === true,
      })
    : null;
  const sandbox = ["none", "partial", "strong"].includes(requirements.sandbox)
    ? requirements.sandbox
    : null;
  const estimatesInput =
    facade.estimates && typeof facade.estimates === "object"
      ? facade.estimates
      : {};
  const budgetInput =
    facade.budget && typeof facade.budget === "object" ? facade.budget : {};
  return Object.freeze({
    requirements: Object.freeze({
      capabilities: Object.freeze(capabilities),
      capabilityDeclarationInvalid:
        rawCapabilities.length !== capabilities.length,
      executionLocations: Object.freeze(executionLocations),
      executionLocationDeclarationInvalid:
        rawLocations.length !== executionLocations.length,
      permissions,
      permissionDeclarationInvalid,
      sandbox,
      dataBoundary: DATA_BOUNDARY_KINDS.has(requirements.dataBoundary)
        ? requirements.dataBoundary
        : null,
      credentials: Object.freeze(credentials),
      credentialValuePresent,
      credentialDeclarationInvalid,
    }),
    estimates: Object.freeze({
      tokensPerTask: finiteNumber(estimatesInput.tokensPerTask, {
        integer: true,
        min: 1,
      }),
      usdPerTask: finiteNumber(estimatesInput.usdPerTask, { min: 0 }),
      durationMsPerTask: finiteNumber(estimatesInput.durationMsPerTask, {
        integer: true,
        min: 1,
      }),
    }),
    budget: Object.freeze({
      maxExpandedTasks: finiteNumber(budgetInput.maxExpandedTasks, {
        integer: true,
        min: 1,
      }),
      maxParallel: finiteNumber(budgetInput.maxParallel, {
        integer: true,
        min: 1,
      }),
      maxTokens: finiteNumber(budgetInput.maxTokens, {
        integer: true,
        min: 1,
      }),
      maxUsd: finiteNumber(budgetInput.maxUsd, { min: 0 }),
      maxDurationMs: finiteNumber(budgetInput.maxDurationMs, {
        integer: true,
        min: 1,
      }),
    }),
  });
}

export function createDynamicWorkflowManifest(workflow) {
  const validation = validateWorkflow(workflow);
  if (!validation.valid) {
    throw new TypeError(`Invalid workflow: ${validation.errors.join("; ")}`);
  }
  const governance = normalizeGovernance(workflow);
  if (governance.requirements.credentialValuePresent) {
    throw new TypeError(
      "workflow credential requirements must not contain values",
    );
  }
  const authority = createWorkflowDefinitionAuthority(workflow);
  const definition = authority.definition;
  const batches = planBatches(workflow.steps).map((batch, index) =>
    Object.freeze({
      index,
      steps: Object.freeze(batch.map((step) => step.id)),
    }),
  );
  const steps = workflow.steps.map(stepProjection);
  const expansionKnown = steps.every((step) => step.expansionKnown);
  const worstCaseTaskCalls = expansionKnown
    ? steps.reduce((total, step) => total + step.worstCaseTaskCalls, 0)
    : null;
  if (worstCaseTaskCalls != null && !Number.isSafeInteger(worstCaseTaskCalls)) {
    throw new TypeError("workflow task-call projection exceeds safe limits");
  }
  return Object.freeze({
    schema: DYNAMIC_WORKFLOW_DEFINITION_SCHEMA,
    adapter: "cowork-workflow",
    definitionDigest: authority.definitionDigest,
    definition,
    engineCapabilities: DYNAMIC_WORKFLOW_ENGINE_CAPABILITIES,
    usedCapabilities: Object.freeze(usedCapabilities(workflow, batches)),
    plan: Object.freeze({
      mode: workflow.pipeline === true ? "pipeline" : "batched-dag",
      batches: Object.freeze(batches),
      steps: Object.freeze(steps),
      expansionKnown,
      worstCaseTaskCalls,
    }),
    governance,
    runtimeClaims: Object.freeze({
      durablePauseResume: false,
      exactlyOnceAfterResume: false,
      historyDurability: "best-effort",
      needsInputBetweenStages: false,
    }),
  });
}

function addUnique(output, value) {
  if (!output.includes(value)) output.push(value);
}

function permissionsCover(actual, required) {
  if (!actual || !required) return false;
  const fileRank = { none: 0, read: 1, write: 2 };
  if ((fileRank[actual.file] ?? -1) < (fileRank[required.file] ?? -1)) {
    return false;
  }
  for (const key of ["shell", "network", "mcp", "externalSystems"]) {
    if (required[key] === true && actual[key] !== true) return false;
  }
  return true;
}

function credentialsCover(actual, required) {
  const available = Array.isArray(actual) ? actual : [];
  return required.filter(
    (credential) =>
      !available.some(
        (candidate) =>
          candidate.name === credential.name &&
          candidate.source === credential.source &&
          (credential.scope == null || candidate.scope === credential.scope),
      ),
  );
}

function projectedDurationSlots(plan, requestedParallel) {
  if (!plan.expansionKnown || requestedParallel == null) return null;
  const byId = new Map(plan.steps.map((step) => [step.id, step]));
  let total = 0;
  for (const batch of plan.batches) {
    const steps = batch.steps.map((id) => byId.get(id));
    const taskCalls = steps.reduce(
      (sum, step) => sum + (step?.worstCaseTaskCalls ?? 0),
      0,
    );
    if (!Number.isSafeInteger(taskCalls)) return null;
    const criticalPath = Math.max(
      0,
      ...steps.map((step) => step?.worstCaseDurationSlots ?? 0),
    );
    const scheduledSlots = Math.ceil(taskCalls / requestedParallel);
    total += Math.max(criticalPath, scheduledSlots);
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}

function multiplyProjection(...values) {
  if (values.some((value) => value == null)) return null;
  const product = values.reduce((total, value) => total * value, 1);
  return Number.isFinite(product) && product <= Number.MAX_SAFE_INTEGER
    ? product
    : null;
}

function normalizeDefinitionAuthorityForRun(value) {
  const code = DYNAMIC_WORKFLOW_DEFINITION_AUTHORITY_INVALID_CODE;
  const authority = snapshotObjectFields(
    value,
    DEFINITION_AUTHORITY_FIELDS,
    code,
    "definitionAuthority",
  );
  if (!new Set(["versioned", "legacy-unversioned"]).has(authority.status)) {
    throw admissionError(code, "definitionAuthority status is invalid");
  }
  if (
    authority.definitionSchema !== WORKFLOW_DEFINITION_SCHEMA ||
    (authority.status === "versioned"
      ? authority.recordSchema !== COWORK_WORKFLOW_RECORD_SCHEMA
      : authority.recordSchema !== null)
  ) {
    throw admissionError(code, "definitionAuthority schema is invalid");
  }
  const declaredDigest = normalizeWorkflowDefinitionDigest(
    authority.definitionDigest,
  );
  if (!declaredDigest || declaredDigest !== authority.definitionDigest) {
    throw admissionError(code, "definitionAuthority digest is invalid");
  }
  let computed;
  try {
    computed = createWorkflowDefinitionAuthority(
      snapshotCanonicalValue(
        authority.definition,
        code,
        "definitionAuthority.definition",
      ),
    );
  } catch {
    throw admissionError(code, "definitionAuthority definition is invalid");
  }
  if (computed.definitionDigest !== declaredDigest) {
    throw admissionError(code, "definitionAuthority digest does not match");
  }
  return Object.freeze({
    status: authority.status,
    recordSchema: authority.recordSchema,
    definitionSchema: computed.schema,
    definitionDigest: computed.definitionDigest,
    definition: computed.definition,
  });
}

function canonicalObservedAt(value) {
  if (typeof value !== "string") return false;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) && new Date(epoch).toISOString() === value;
}

export function normalizeSessionExecutionLocationAuthority(value) {
  const code = DYNAMIC_WORKFLOW_EXECUTION_AUTHORITY_INVALID_CODE;
  const authority = snapshotObjectFields(
    value,
    VERIFIED_SESSION_AUTHORITY_FIELDS,
    code,
    "executionLocationAuthority",
  );
  if (authority.schema !== SESSION_EXECUTION_LOCATION_AUTHORITY_SCHEMA) {
    throw admissionError(
      code,
      `executionLocationAuthority must use ${SESSION_EXECUTION_LOCATION_AUTHORITY_SCHEMA}`,
    );
  }
  const verified = new Set([
    "verified-session-start",
    "verified-session-location-handoff",
  ]).has(authority.authority);
  if (!verified) {
    throw admissionError(
      code,
      "executionLocationAuthority must be a verified session location authority",
    );
  }
  let binding;
  try {
    const bindingSnapshot = snapshotCanonicalValue(
      authority.binding,
      code,
      "executionLocationAuthority.binding",
    );
    binding = normalizeExecutionLocationBinding(bindingSnapshot);
    if (
      canonicalJson(bindingSnapshot, "executionLocationAuthority.binding") !==
      canonicalJson(binding, "executionLocationAuthority.binding")
    ) {
      throw new TypeError("binding is not canonical");
    }
  } catch {
    throw admissionError(
      code,
      "executionLocationAuthority binding is invalid or non-canonical",
    );
  }
  if (binding.observed !== true || !canonicalObservedAt(binding.observedAt)) {
    throw admissionError(
      code,
      "executionLocationAuthority binding is not an observed instant",
    );
  }

  const sessionId = safeString(authority.sessionId);
  if (
    sessionId !== authority.sessionId ||
    !/^[a-f0-9]{64}$/u.test(authority.headHash) ||
    !Number.isSafeInteger(authority.eventCount) ||
    authority.eventCount < 1
  ) {
    throw admissionError(
      code,
      "executionLocationAuthority session proof is invalid",
    );
  }
  return Object.freeze({
    schema: SESSION_EXECUTION_LOCATION_AUTHORITY_SCHEMA,
    authority: authority.authority,
    sessionId,
    headHash: authority.headHash,
    eventCount: authority.eventCount,
    binding,
  });
}

function pathWithinDataBoundary(cwd, boundary) {
  const root = boundary?.root;
  if (typeof cwd !== "string" || typeof root !== "string") return false;
  const windowsPath =
    /^[A-Za-z]:[\\/]/u.test(root) ||
    root.startsWith("\\\\") ||
    /^[A-Za-z]:[\\/]/u.test(cwd) ||
    cwd.startsWith("\\\\");
  const paths = windowsPath ? win32Path : posixPath;
  if (!paths.isAbsolute(root) || !paths.isAbsolute(cwd)) return false;
  const relative = paths.relative(paths.normalize(root), paths.normalize(cwd));
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${paths.sep}`) &&
      !paths.isAbsolute(relative))
  );
}

function normalizeExecutionOptions(value, definition, executionAuthority) {
  const code = DYNAMIC_WORKFLOW_EXECUTION_OPTIONS_INVALID_CODE;
  const execution =
    value == null
      ? Object.freeze({})
      : snapshotObjectFields(
          value,
          EXECUTION_OPTION_FIELDS,
          code,
          "execution",
          { exact: false },
        );
  if (Object.hasOwn(execution, "llmOptions")) {
    throw admissionError(
      code,
      "execution.llmOptions is not admitted; use the verified model binding",
    );
  }

  for (const callback of ["onStepStart", "onStepComplete"]) {
    if (
      Object.hasOwn(execution, callback) &&
      (typeof execution[callback] !== "function" ||
        utilTypes.isProxy(execution[callback]))
    ) {
      throw admissionError(code, `execution.${callback} must be a function`);
    }
  }
  if (
    Object.hasOwn(execution, "continueOnError") &&
    typeof execution.continueOnError !== "boolean"
  ) {
    throw admissionError(code, "execution.continueOnError must be a boolean");
  }

  const binding = executionAuthority.binding;
  const cwd = binding.source.cwd;
  const dataBoundary = binding.policy.dataBoundary;
  if (!pathWithinDataBoundary(cwd, dataBoundary)) {
    throw admissionError(
      DYNAMIC_WORKFLOW_EXECUTION_AUTHORITY_INVALID_CODE,
      "verified execution cwd is outside its data boundary",
    );
  }
  const policy = Object.freeze({
    cwd,
    continueOnError: execution.continueOnError ?? false,
    pipeline: definition.pipeline === true,
    provider: binding.model.provider,
    model: binding.model.name,
  });
  for (const field of ["cwd", "pipeline", "provider", "model"]) {
    if (Object.hasOwn(execution, field) && execution[field] !== policy[field]) {
      throw admissionError(
        code,
        `execution.${field} does not match verified authority`,
      );
    }
  }

  return Object.freeze({
    policy,
    onStepStart: execution.onStepStart,
    onStepComplete: execution.onStepComplete,
  });
}

function normalizeRunInput(input) {
  const code = DYNAMIC_WORKFLOW_EXECUTION_AUTHORITY_INVALID_CODE;
  const snapshot = snapshotObjectFields(
    input,
    RUN_INPUT_FIELDS,
    code,
    "dynamicWorkflowRun",
    { exact: false },
  );
  if (
    !Object.hasOwn(snapshot, "definitionAuthority") ||
    !Object.hasOwn(snapshot, "executionAuthoritySessionId")
  ) {
    throw admissionError(
      code,
      "definitionAuthority and executionAuthoritySessionId are required",
    );
  }
  const executionAuthoritySessionId = safeString(
    snapshot.executionAuthoritySessionId,
  );
  if (executionAuthoritySessionId !== snapshot.executionAuthoritySessionId) {
    throw admissionError(code, "executionAuthoritySessionId is invalid");
  }
  if (
    Object.hasOwn(snapshot, "onAdmitted") &&
    (typeof snapshot.onAdmitted !== "function" ||
      utilTypes.isProxy(snapshot.onAdmitted))
  ) {
    throw admissionError(
      DYNAMIC_WORKFLOW_EXECUTION_OPTIONS_INVALID_CODE,
      "onAdmitted must be a function",
    );
  }
  const definitionAuthority = normalizeDefinitionAuthorityForRun(
    snapshot.definitionAuthority,
  );
  return Object.freeze({
    definitionAuthority,
    executionAuthoritySessionId,
    maxParallel: snapshot.maxParallel,
    execution: snapshot.execution,
    onAdmitted: snapshot.onAdmitted,
  });
}

function normalizeRunDependencies(deps) {
  const code = DYNAMIC_WORKFLOW_EXECUTION_AUTHORITY_INVALID_CODE;
  const snapshot = snapshotObjectFields(
    deps,
    RUN_DEPENDENCY_FIELDS,
    code,
    "dynamicWorkflowRunDependencies",
    { exact: false },
  );
  if (
    typeof snapshot.verifyAuthorities !== "function" ||
    utilTypes.isProxy(snapshot.verifyAuthorities)
  ) {
    throw admissionError(code, "verifyAuthorities dependency is required");
  }
  if (
    Object.hasOwn(snapshot, "executeWorkflow") &&
    (typeof snapshot.executeWorkflow !== "function" ||
      utilTypes.isProxy(snapshot.executeWorkflow))
  ) {
    throw admissionError(
      DYNAMIC_WORKFLOW_EXECUTION_OPTIONS_INVALID_CODE,
      "executeWorkflow dependency must be a function",
    );
  }
  return snapshot;
}

function authorityLookup(runInput) {
  return Object.freeze({
    workflowId: runInput.definitionAuthority.definition.id,
    definitionDigest: runInput.definitionAuthority.definitionDigest,
    executionAuthoritySessionId: runInput.executionAuthoritySessionId,
  });
}

function normalizeVerifiedAuthorities(value, runInput) {
  const code = DYNAMIC_WORKFLOW_EXECUTION_AUTHORITY_INVALID_CODE;
  const snapshot = snapshotObjectFields(
    value,
    VERIFIED_AUTHORITIES_FIELDS,
    code,
    "verifiedAuthorities",
  );
  const definitionAuthority = normalizeDefinitionAuthorityForRun(
    snapshot.definitionAuthority,
  );
  const executionLocationAuthority = normalizeSessionExecutionLocationAuthority(
    snapshot.executionLocationAuthority,
  );
  if (
    canonicalJson(definitionAuthority, "verifiedDefinitionAuthority") !==
    canonicalJson(runInput.definitionAuthority, "inputDefinitionAuthority")
  ) {
    throw admissionError(
      code,
      "verified definition authority does not exactly match the requested record",
    );
  }
  if (
    executionLocationAuthority.sessionId !==
    runInput.executionAuthoritySessionId
  ) {
    throw admissionError(
      code,
      "verified execution authority does not match the requested session",
    );
  }
  return Object.freeze({ definitionAuthority, executionLocationAuthority });
}

function verifyAuthoritiesSynchronously(verifier, lookup, runInput) {
  let verified;
  try {
    verified = verifier(lookup);
  } catch {
    throw admissionError(
      DYNAMIC_WORKFLOW_EXECUTION_AUTHORITY_INVALID_CODE,
      "authority verification failed",
    );
  }
  if (utilTypes.isPromise(verified)) {
    throw admissionError(
      DYNAMIC_WORKFLOW_EXECUTION_AUTHORITY_INVALID_CODE,
      "buildDynamicWorkflowRunAdmission requires a synchronous authority verifier",
    );
  }
  return normalizeVerifiedAuthorities(verified, runInput);
}

async function verifyAuthoritiesAsynchronously(verifier, lookup, runInput) {
  let verified;
  try {
    verified = await verifier(lookup);
  } catch {
    throw admissionError(
      DYNAMIC_WORKFLOW_EXECUTION_AUTHORITY_INVALID_CODE,
      "authority verification failed",
    );
  }
  return normalizeVerifiedAuthorities(verified, runInput);
}

function authoritiesExactlyMatch(left, right) {
  return (
    canonicalJson(left, "firstVerifiedAuthorities") ===
    canonicalJson(right, "finalVerifiedAuthorities")
  );
}

function blockedError(preflight) {
  return Object.freeze({
    name: "DynamicWorkflowAdmissionError",
    code: DYNAMIC_WORKFLOW_PREFLIGHT_BLOCKED_CODE,
    message: "dynamic workflow execution was blocked by preflight",
    details: Object.freeze({ blockers: preflight.blockers }),
  });
}

function prepareDynamicWorkflowRun(runInput, verifiedAuthorities, execution) {
  const { definitionAuthority, executionLocationAuthority } =
    verifiedAuthorities;
  const workflow = definitionAuthority.definition;
  const preflight = buildDynamicWorkflowPreflight({
    workflow,
    definitionAuthority,
    executionLocation: executionLocationAuthority.binding,
    maxParallel: runInput.maxParallel,
    requireDefinitionAuthority: true,
  });
  const executionLocationDigest = domainSeparatedDigest(
    "chainlesschain.dynamic-workflow.execution-location.v1\0",
    executionLocationAuthority,
    "executionLocationAuthority",
  );
  const preflightDigest = domainSeparatedDigest(
    "chainlesschain.dynamic-workflow.preflight.v1\0",
    preflight,
    "dynamicWorkflowPreflight",
  );

  if (!preflight.allowed) {
    return Object.freeze({
      workflow: definitionAuthority.definition,
      outcome: Object.freeze({
        allowed: false,
        admission: null,
        preflight,
        definitionDigest: preflight.definition.definitionDigest,
        executionLocationDigest,
        preflightDigest,
        admissionDigest: null,
        authorityVerified: true,
        error: blockedError(preflight),
      }),
    });
  }

  const admissionMaterial = Object.freeze({
    schema: DYNAMIC_WORKFLOW_RUN_ADMISSION_SCHEMA,
    definition: Object.freeze({
      schema: preflight.definition.schema,
      definitionDigest: preflight.definition.definitionDigest,
      authority: preflight.definition.authority,
    }),
    executionLocation: Object.freeze({
      authoritySchema: executionLocationAuthority.schema,
      authority: executionLocationAuthority.authority,
      session: Object.freeze({
        sessionId: executionLocationAuthority.sessionId,
        headHash: executionLocationAuthority.headHash,
        eventCount: executionLocationAuthority.eventCount,
      }),
      bindingSchema: executionLocationAuthority.binding.schema,
      location: executionLocationAuthority.binding.location,
    }),
    definitionDigest: preflight.definition.definitionDigest,
    executionLocationDigest,
    preflightDigest,
    maxParallel: preflight.scale.requestedParallel,
    executionPolicy: execution.policy,
    credentialValuesTransferred: false,
  });
  const admissionDigest = domainSeparatedDigest(
    "chainlesschain.dynamic-workflow.admission.v1\0",
    admissionMaterial,
    "dynamicWorkflowAdmission",
  );
  const admission = Object.freeze({
    ...admissionMaterial,
    admissionDigest,
  });

  return Object.freeze({
    workflow: definitionAuthority.definition,
    outcome: Object.freeze({
      allowed: true,
      admission,
      preflight,
      definitionDigest: admission.definitionDigest,
      executionLocationDigest,
      preflightDigest,
      admissionDigest,
      authorityVerified: true,
      error: null,
    }),
  });
}

export function buildDynamicWorkflowRunAdmission(input = {}, deps = {}) {
  const runInput = normalizeRunInput(input);
  const dependencies = normalizeRunDependencies(deps);
  const verifiedAuthorities = verifyAuthoritiesSynchronously(
    dependencies.verifyAuthorities,
    authorityLookup(runInput),
    runInput,
  );
  const execution = normalizeExecutionOptions(
    runInput.execution,
    verifiedAuthorities.definitionAuthority.definition,
    verifiedAuthorities.executionLocationAuthority,
  );
  return prepareDynamicWorkflowRun(runInput, verifiedAuthorities, execution)
    .outcome;
}

function canonicalTimestamp(value) {
  if (typeof value !== "string") return false;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) && new Date(epoch).toISOString() === value;
}

function declaredDependencyIds(step, stepsById) {
  const dependencies = new Set();
  const pending = [...(step.dependsOn || [])];
  while (pending.length > 0) {
    const dependencyId = pending.pop();
    if (dependencies.has(dependencyId)) continue;
    dependencies.add(dependencyId);
    const dependency = stepsById.get(dependencyId);
    if (dependency) pending.push(...(dependency.dependsOn || []));
  }
  return dependencies;
}

function runtimeForEachSourceId(value) {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^\$\{step\.([^.{}]+)\.[^.{}]+\}$/u);
  return match?.[1] || null;
}

function assertCompletedRecordCoverage(record, workflow, code) {
  const outcomesById = new Map(record.steps.map((step) => [step.id, step]));
  const expectedOutcomeIds = new Set();
  const resultsById = new Map();
  const stepsById = new Map(workflow.steps.map((step) => [step.id, step]));

  const requireOutcome = (id) => {
    if (expectedOutcomeIds.has(id)) {
      throw admissionError(
        code,
        "completed workflow definition produces colliding outcome ids",
      );
    }
    const outcome = outcomesById.get(id);
    if (!outcome) {
      throw admissionError(
        code,
        `completed workflow record is missing outcome '${id}'`,
      );
    }
    expectedOutcomeIds.add(id);
    return outcome;
  };

  for (const batch of planBatches(workflow.steps)) {
    // Outcomes from independent steps in the same batch are not authoritative
    // inputs to one another. Publish only parent outcomes after the whole batch
    // has been reconstructed.
    const batchResults = [];
    for (const step of batch) {
      if (!shouldRunStep(step, resultsById)) {
        throw admissionError(
          code,
          `completed workflow record includes non-runnable step '${step.id}'`,
        );
      }

      if (step.forEach === undefined) {
        batchResults.push([step.id, requireOutcome(step.id)]);
        continue;
      }

      if (typeof step.forEach === "string") {
        const sourceId = runtimeForEachSourceId(step.forEach);
        if (
          !sourceId ||
          !declaredDependencyIds(step, stepsById).has(sourceId)
        ) {
          throw admissionError(
            code,
            `runtime forEach on '${step.id}' is not bound to a declared dependency`,
          );
        }
      }

      const items = resolveForEachItems(step.forEach, resultsById);
      if (items.length === 0) {
        throw admissionError(
          code,
          `completed workflow record cannot cover empty forEach '${step.id}'`,
        );
      }
      const children = [];
      for (let index = 0; index < items.length; index += 1) {
        children.push(requireOutcome(`${step.id}[${index}]`));
      }
      batchResults.push([
        step.id,
        Object.freeze({
          id: step.id,
          status: "completed",
          taskId: null,
          result: Object.freeze({
            summary: children
              .map((child) => child.result?.summary ?? "")
              .join("\n"),
            children: children.length,
          }),
        }),
      ]);
    }
    for (const [stepId, outcome] of batchResults) {
      resultsById.set(stepId, outcome);
    }
  }

  if (
    expectedOutcomeIds.size !== record.steps.length ||
    record.steps.some((step) => !expectedOutcomeIds.has(step.id))
  ) {
    throw admissionError(
      code,
      "completed workflow record contains outcomes outside its definition",
    );
  }
}

function normalizeExecutionRecord(value, prepared) {
  const code = DYNAMIC_WORKFLOW_EXECUTION_RESULT_INVALID_CODE;
  try {
    const fields = snapshotObjectFields(
      value,
      RUN_RECORD_FIELDS,
      code,
      "executeWorkflowRecord",
    );
    if (
      !Array.isArray(fields.steps) ||
      utilTypes.isProxy(fields.steps) ||
      fields.steps.length > MAX_RUN_RECORD_STEPS
    ) {
      throw admissionError(code, "executeWorkflowRecord steps are invalid");
    }
    const record = snapshotCanonicalValue(
      fields,
      code,
      "executeWorkflowRecord",
    );
    const admission = prepared.outcome.admission;
    const workflow = prepared.workflow;
    if (
      record.schema !== COWORK_WORKFLOW_RUN_RECORD_SCHEMA ||
      record.workflowId !== workflow.id ||
      record.workflowName !== workflow.name ||
      record.definitionSchema !== WORKFLOW_DEFINITION_SCHEMA ||
      record.definitionDigest !== admission.definitionDigest ||
      !RUN_RECORD_STATUSES.has(record.status) ||
      !canonicalTimestamp(record.startedAt) ||
      !canonicalTimestamp(record.finishedAt) ||
      Date.parse(record.finishedAt) < Date.parse(record.startedAt)
    ) {
      throw admissionError(
        code,
        "executeWorkflowRecord does not match the admitted workflow",
      );
    }
    if (
      !record.runAdmission ||
      record.runAdmission.admissionDigest !== admission.admissionDigest ||
      canonicalJson(record.runAdmission, "recordRunAdmission") !==
        canonicalJson(admission, "admittedRunAdmission")
    ) {
      throw admissionError(
        code,
        "executeWorkflowRecord run admission does not match",
      );
    }

    const stepIds = new Set();
    for (const [index, step] of record.steps.entries()) {
      const normalizedStep = snapshotObjectFields(
        step,
        RUN_RECORD_STEP_FIELDS,
        code,
        `executeWorkflowRecord.steps[${index}]`,
      );
      const id = safeString(normalizedStep.id, 512);
      if (
        id !== normalizedStep.id ||
        stepIds.has(id) ||
        !RUN_RECORD_STEP_STATUSES.has(normalizedStep.status) ||
        (normalizedStep.taskId !== null &&
          safeString(normalizedStep.taskId, 512) !== normalizedStep.taskId)
      ) {
        throw admissionError(
          code,
          "executeWorkflowRecord contains an invalid step outcome",
        );
      }
      stepIds.add(id);
    }
    const expectedStatus = record.steps.every(
      (step) => step.status === "completed",
    )
      ? "completed"
      : record.steps.some((step) => step.status === "completed")
        ? "partial"
        : "failed";
    if (record.status !== expectedStatus) {
      throw admissionError(
        code,
        "executeWorkflowRecord status does not match its step outcomes",
      );
    }
    if (record.status === "completed") {
      assertCompletedRecordCoverage(record, workflow, code);
    }
    return Object.freeze({ ...record, runAdmission: admission });
  } catch {
    throw admissionError(
      code,
      "executeWorkflow returned an invalid admitted run record",
      Object.freeze({
        expectedDefinitionDigest: prepared.outcome.admission.definitionDigest,
        expectedAdmissionDigest: prepared.outcome.admission.admissionDigest,
      }),
      { executionStarted: true },
    );
  }
}

export async function executeDynamicWorkflowWithAdmission(
  input = {},
  deps = {},
) {
  const runInput = normalizeRunInput(input);
  const dependencies = normalizeRunDependencies(deps);
  const executor = Object.hasOwn(dependencies, "executeWorkflow")
    ? dependencies.executeWorkflow
    : executeCoworkWorkflow;
  const lookup = authorityLookup(runInput);
  const verifiedAuthorities = await verifyAuthoritiesAsynchronously(
    dependencies.verifyAuthorities,
    lookup,
    runInput,
  );
  const execution = normalizeExecutionOptions(
    runInput.execution,
    verifiedAuthorities.definitionAuthority.definition,
    verifiedAuthorities.executionLocationAuthority,
  );
  const prepared = prepareDynamicWorkflowRun(
    runInput,
    verifiedAuthorities,
    execution,
  );
  if (!prepared.outcome.allowed) {
    return Object.freeze({
      ...prepared.outcome,
      record: null,
      executionStarted: false,
    });
  }

  const finalAuthorities = await verifyAuthoritiesAsynchronously(
    dependencies.verifyAuthorities,
    lookup,
    runInput,
  );
  if (!authoritiesExactlyMatch(verifiedAuthorities, finalAuthorities)) {
    throw admissionError(
      DYNAMIC_WORKFLOW_EXECUTION_AUTHORITY_INVALID_CODE,
      "verified authorities changed during run admission",
    );
  }
  if (runInput.onAdmitted) {
    await runInput.onAdmitted(
      prepared.outcome.admission,
      prepared.outcome.preflight,
    );
  }
  const policy = prepared.outcome.admission.executionPolicy;
  const record = await executor({
    cwd: policy.cwd,
    continueOnError: policy.continueOnError,
    pipeline: policy.pipeline,
    llmOptions: Object.freeze({
      provider: policy.provider,
      model: policy.model,
    }),
    onStepStart: execution.onStepStart,
    onStepComplete: execution.onStepComplete,
    workflow: prepared.workflow,
    definitionDigest: prepared.outcome.admission.definitionDigest,
    maxParallel: prepared.outcome.admission.maxParallel,
    runAdmission: prepared.outcome.admission,
  });
  const normalizedRecord = normalizeExecutionRecord(record, prepared);

  return Object.freeze({
    ...prepared.outcome,
    record: normalizedRecord,
    executionStarted: true,
  });
}

export function buildDynamicWorkflowPreflight(input = {}) {
  const suppliedManifest =
    input.manifest?.schema === DYNAMIC_WORKFLOW_DEFINITION_SCHEMA
      ? input.manifest
      : null;
  const manifest = createDynamicWorkflowManifest(
    input.workflow || suppliedManifest?.definition,
  );
  const binding = normalizeExecutionLocationBinding(input.executionLocation);
  const governance = manifest.governance;
  const requirements = governance.requirements;
  const estimates = governance.estimates;
  const budget = governance.budget;
  const blockers = [];
  const warnings = [];
  const definitionAuthority = input.definitionAuthority
    ? Object.freeze({
        status:
          input.definitionAuthority.status === "versioned"
            ? "versioned"
            : "legacy-unversioned",
        recordSchema: safeString(input.definitionAuthority.recordSchema),
        definitionSchema: safeString(
          input.definitionAuthority.definitionSchema,
        ),
        definitionDigest: normalizeWorkflowDefinitionDigest(
          input.definitionAuthority.definitionDigest,
        ),
      })
    : null;

  if (input.requireDefinitionAuthority === true && !definitionAuthority) {
    addUnique(blockers, "definition-authority-missing");
  }

  if (
    suppliedManifest &&
    suppliedManifest.definitionDigest !== manifest.definitionDigest
  ) {
    addUnique(blockers, "definition-digest-mismatch");
  }
  if (definitionAuthority) {
    if (definitionAuthority.status !== "versioned") {
      addUnique(blockers, "definition-authority-unversioned");
    }
    if (
      definitionAuthority.recordSchema !== COWORK_WORKFLOW_RECORD_SCHEMA ||
      definitionAuthority.definitionSchema !== manifest.schema ||
      definitionAuthority.definitionDigest !== manifest.definitionDigest
    ) {
      addUnique(blockers, "definition-authority-mismatch");
    }
  }

  if (requirements.capabilities.length === 0) {
    addUnique(blockers, "required-capabilities-missing");
  }
  if (requirements.capabilityDeclarationInvalid) {
    addUnique(blockers, "capability-declaration-invalid");
  }
  for (const capability of requirements.capabilities) {
    if (!CAPABILITY_SET.has(capability)) {
      addUnique(blockers, `unsupported-capability:${capability}`);
    }
  }
  for (const capability of manifest.usedCapabilities) {
    if (!requirements.capabilities.includes(capability)) {
      addUnique(blockers, `undeclared-capability:${capability}`);
    }
  }
  if (requirements.executionLocations.length === 0) {
    addUnique(blockers, "execution-locations-missing");
  } else if (requirements.executionLocationDeclarationInvalid) {
    addUnique(blockers, "execution-location-declaration-invalid");
  } else if (!requirements.executionLocations.includes(binding.location)) {
    addUnique(blockers, `execution-location-not-allowed:${binding.location}`);
  }
  if (!requirements.permissions) {
    addUnique(blockers, "permission-requirements-missing");
  } else if (requirements.permissionDeclarationInvalid) {
    addUnique(blockers, "permission-requirements-invalid");
  } else if (binding.permissions.status !== "declared") {
    addUnique(blockers, "environment-permissions-not-observed");
  } else if (!permissionsCover(binding.permissions, requirements.permissions)) {
    addUnique(blockers, "environment-permissions-insufficient");
  }
  if (requirements.permissions?.network === true) {
    if (binding.policy.network === "unknown") {
      addUnique(blockers, "environment-network-policy-unknown");
    } else if (binding.policy.network === "offline") {
      addUnique(blockers, "environment-network-policy-insufficient");
    }
  }
  if (!requirements.sandbox) {
    addUnique(blockers, "sandbox-requirement-missing");
  } else if (!(binding.policy.sandbox in SANDBOX_RANK)) {
    addUnique(blockers, "environment-sandbox-unknown");
  } else if (
    SANDBOX_RANK[binding.policy.sandbox] < SANDBOX_RANK[requirements.sandbox]
  ) {
    addUnique(blockers, "environment-sandbox-insufficient");
  }
  if (requirements.credentialValuePresent) {
    addUnique(blockers, "credential-value-present");
  }
  if (requirements.credentialDeclarationInvalid) {
    addUnique(blockers, "credential-declaration-invalid");
  } else {
    for (const credential of credentialsCover(
      binding.credentials,
      requirements.credentials,
    )) {
      addUnique(blockers, `environment-credential-missing:${credential.name}`);
    }
  }
  if (!requirements.dataBoundary) {
    addUnique(blockers, "data-boundary-requirement-missing");
  } else if (binding.policy.dataBoundary.kind === "unknown") {
    addUnique(blockers, "environment-data-boundary-unknown");
  } else if (binding.policy.dataBoundary.kind !== requirements.dataBoundary) {
    addUnique(blockers, "environment-data-boundary-mismatch");
  }

  if (!manifest.plan.expansionKnown) {
    addUnique(blockers, "runtime-expansion-unknown");
  }
  const taskCalls = manifest.plan.worstCaseTaskCalls;
  const hardLimit = Math.min(
    budget.maxExpandedTasks ?? DEFAULT_HARD_TASK_LIMIT,
    DEFAULT_HARD_TASK_LIMIT,
  );
  if (budget.maxExpandedTasks > DEFAULT_HARD_TASK_LIMIT) {
    addUnique(blockers, "expanded-task-budget-exceeds-engine-limit");
  }
  if (taskCalls != null && taskCalls > hardLimit) {
    addUnique(blockers, "expanded-task-budget-exceeded");
  } else if (taskCalls != null && taskCalls > DEFAULT_SOFT_TASK_GUIDELINE) {
    warnings.push("expanded task count exceeds the soft size guideline");
  }
  const requestedParallel = finiteNumber(input.maxParallel ?? 4, {
    integer: true,
    min: 1,
  });
  if (requestedParallel == null) {
    addUnique(blockers, "requested-parallel-invalid");
  } else if (requestedParallel > DEFAULT_HARD_TASK_LIMIT) {
    addUnique(blockers, "requested-parallel-exceeds-engine-limit");
  }
  if (budget.maxParallel == null) {
    addUnique(blockers, "parallel-budget-missing");
  } else if (
    requestedParallel != null &&
    requestedParallel > budget.maxParallel
  ) {
    addUnique(blockers, "parallel-budget-exceeded");
  }

  const durationSlots = projectedDurationSlots(
    manifest.plan,
    requestedParallel,
  );
  const projectedTokens = multiplyProjection(
    taskCalls,
    estimates.tokensPerTask,
  );
  const projectedUsd = multiplyProjection(taskCalls, estimates.usdPerTask);
  const projectedDurationMs = multiplyProjection(
    durationSlots,
    estimates.durationMsPerTask,
  );
  for (const [name, projected, maximum] of [
    ["token", projectedTokens, budget.maxTokens],
    ["usd", projectedUsd, budget.maxUsd],
    ["duration", projectedDurationMs, budget.maxDurationMs],
  ]) {
    if (projected == null || maximum == null) {
      addUnique(blockers, `${name}-budget-unevaluable`);
    } else if (projected > maximum) {
      addUnique(blockers, `${name}-budget-exceeded`);
    }
  }

  return Object.freeze({
    schema: DYNAMIC_WORKFLOW_PREFLIGHT_SCHEMA,
    allowed: blockers.length === 0,
    definition: Object.freeze({
      schema: manifest.schema,
      adapter: manifest.adapter,
      id: manifest.definition.id,
      name: manifest.definition.name,
      definitionDigest: manifest.definitionDigest,
      authority: definitionAuthority,
    }),
    executionLocation: Object.freeze({
      schema: binding.schema,
      location: binding.location,
      source: binding.source,
      permissions: binding.permissions,
      policy: binding.policy,
    }),
    capabilities: Object.freeze({
      engine: manifest.engineCapabilities,
      used: manifest.usedCapabilities,
      required: requirements.capabilities,
    }),
    permissions: Object.freeze({
      required: requirements.permissions,
      credentialRefs: requirements.credentials,
      credentialValuesTransferred: false,
    }),
    scale: Object.freeze({
      expansionKnown: manifest.plan.expansionKnown,
      worstCaseTaskCalls: taskCalls,
      softTaskGuideline: DEFAULT_SOFT_TASK_GUIDELINE,
      hardTaskLimit: hardLimit,
      requestedParallel,
    }),
    cost: Object.freeze({
      projectedTokens,
      projectedUsd,
      projectedDurationMs,
      projectedDurationSlots: durationSlots,
      budget,
    }),
    runtimeClaims: manifest.runtimeClaims,
    blockers: Object.freeze(blockers),
    warnings: Object.freeze(warnings),
  });
}

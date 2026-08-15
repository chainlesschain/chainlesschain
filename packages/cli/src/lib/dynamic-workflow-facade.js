import { createHash } from "node:crypto";
import {
  MAX_FAN_OUT,
  loopIterationCap,
  planBatches,
  validateWorkflow,
} from "./cowork-workflow.js";
import {
  EXECUTION_LOCATION,
  normalizeExecutionLocation,
  redactCredentialRefs,
} from "./execution-location.js";
import { normalizeExecutionLocationBinding } from "./execution-location-contract.js";

export const DYNAMIC_WORKFLOW_DEFINITION_SCHEMA =
  "cc-dynamic-workflow-definition/v1";
export const DYNAMIC_WORKFLOW_PREFLIGHT_SCHEMA =
  "cc-dynamic-workflow-preflight/v1";

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

function safeString(value, max = 256) {
  if (typeof value !== "string") return null;
  const output = value.trim();
  if (!output || output.length > max || /[\u0000-\u001f\u007f]/u.test(output)) {
    return null;
  }
  return output;
}

function finiteNumber(value, { integer = false, min = 0 } = {}) {
  const output = Number(value);
  if (!Number.isFinite(output) || output < min) return null;
  if (integer && !Number.isSafeInteger(output)) return null;
  return output;
}

function stableJsonValue(value, state = { nodes: 0, depth: 0 }) {
  state.nodes += 1;
  if (state.nodes > 20_000 || state.depth > 32) {
    throw new TypeError("workflow definition exceeds canonicalization limits");
  }
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("workflow definition contains a non-finite number");
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    const childState = { ...state, depth: state.depth + 1 };
    const output = value.map((item) => stableJsonValue(item, childState));
    state.nodes = childState.nodes;
    return output;
  }
  if (value && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(
        "workflow definition must contain plain JSON objects",
      );
    }
    const childState = { ...state, depth: state.depth + 1 };
    const output = {};
    for (const key of Object.keys(value).sort()) {
      const child = value[key];
      if (child === undefined) continue;
      if (["function", "symbol", "bigint"].includes(typeof child)) {
        throw new TypeError("workflow definition contains a non-JSON value");
      }
      output[key] = stableJsonValue(child, childState);
    }
    state.nodes = childState.nodes;
    return output;
  }
  throw new TypeError("workflow definition contains a non-JSON value");
}

function stableJson(value) {
  return JSON.stringify(stableJsonValue(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function digestJson(value) {
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
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
  if (batches.some((batch) => batch.length > 1)) capabilities.add("parallel");
  if (workflow.pipeline === true) capabilities.add("pipeline");
  for (const step of workflow.steps) {
    if (step.when != null) capabilities.add("condition");
    if (step.forEach != null) capabilities.add("for-each");
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
  const definition = deepFreeze(stableJsonValue(workflow));
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
    definitionDigest: digestJson(definition),
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
    for (
      let index = 0;
      index < batch.steps.length;
      index += requestedParallel
    ) {
      const chunk = batch.steps.slice(index, index + requestedParallel);
      const chunkDuration = Math.max(
        0,
        ...chunk.map((id) => byId.get(id)?.worstCaseDurationSlots ?? 0),
      );
      total += chunkDuration;
      if (!Number.isSafeInteger(total)) return null;
    }
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

  if (
    suppliedManifest &&
    suppliedManifest.definitionDigest !== manifest.definitionDigest
  ) {
    addUnique(blockers, "definition-digest-mismatch");
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

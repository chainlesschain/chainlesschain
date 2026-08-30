import { createHash } from "node:crypto";
import { createRecordedSkillNetworkPolicy } from "./browser-target-policy.js";

const SAFE_ACTION_CAPABILITIES = Object.freeze({
  observe: "ui.observe",
  click: "ui.interact",
  type: "ui.interact",
  select: "ui.interact",
  assert: "ui.observe",
});
const SECRET_PATTERNS = Object.freeze([
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /\bbearer\s+[A-Za-z0-9._~+/-]{6,}/iu,
  /\b(?:bearer|token|password|passwd|secret|api[_-]?key)\s*[:=]\s*[^\s]{6,}/iu,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /\b(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{16,}\b/u,
]);
const PII_PATTERNS = Object.freeze([
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu,
  /(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)/u,
  /\b\d{3}-\d{2}-\d{4}\b/u,
]);
const VOLATILE_PATTERNS = Object.freeze([
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/iu,
  /\b20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/u,
  /(?:^|[\\/])(?:tmp|temp)(?:[\\/]|$)/iu,
]);
const PARAMETER_PATTERN = /^\$\{parameter\.([A-Za-z][A-Za-z0-9_]*)\}$/u;
const EMBEDDED_PARAMETER_PATTERN = /\$\{parameter\.([A-Za-z][A-Za-z0-9_]*)\}/gu;
const DRAFT_SCHEMA = "chainlesschain.recorded-skill-draft/v1";
const REPORT_SCHEMA = "chainlesschain.recorded-skill-replay/v1";
const MAX_ACTIONS = 256;
const MAX_FAILURE_CONDITIONS = 64;
const MAX_EVIDENCE_BYTES = 256 * 1024;
const ACTION_KEYS = Object.freeze({
  observe: Object.freeze(new Set(["kind", "target"])),
  click: Object.freeze(new Set(["kind", "target"])),
  type: Object.freeze(new Set(["kind", "target", "value"])),
  select: Object.freeze(new Set(["kind", "target", "value"])),
  assert: Object.freeze(new Set(["kind", "target", "value"])),
});

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalValue(value[key])]),
  );
}

function digest(value, domain) {
  return `sha256:${createHash("sha256")
    .update(domain)
    .update("\0")
    .update(JSON.stringify(canonicalValue(value)))
    .digest("hex")}`;
}

function clone(value, label = "value") {
  if (value == null) return value;
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw recorderError(
      "CC_REPLAY_INVALID_ARGUMENT",
      `${label} must be JSON serializable`,
    );
  }
  if (serialized === undefined) {
    throw recorderError(
      "CC_REPLAY_INVALID_ARGUMENT",
      `${label} must be JSON serializable`,
    );
  }
  return JSON.parse(serialized);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw recorderError(
      "CC_REPLAY_INVALID_ARGUMENT",
      `${label} must be a JSON object`,
    );
  }
  return value;
}

function assertExactKeys(value, allowed, code, label) {
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    throw recorderError(code, `${label} contains unsupported fields`);
  }
}

function recorderError(code, message, details = {}) {
  const error = new Error(message);
  error.name = "RecordReplayError";
  error.code = code;
  Object.assign(error, details);
  return error;
}

function walkStrings(value, visit, path = "#") {
  if (typeof value === "string") {
    visit(value, path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      walkStrings(item, visit, `${path}/${index}`),
    );
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    walkStrings(child, visit, `${path}/${key}`);
  }
}

function substituteCaptured(value, bindings) {
  if (typeof value === "string") {
    return [...bindings]
      .sort((left, right) => right.value.length - left.value.length)
      .reduce(
        (current, binding) =>
          current.split(binding.value).join(`\${parameter.${binding.name}}`),
        value,
      );
  }
  if (Array.isArray(value)) {
    return value.map((item) => substituteCaptured(item, bindings));
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      substituteCaptured(child, bindings),
    ]),
  );
}

export function scanRecordedValue(value) {
  const findings = [];
  walkStrings(value, (text, path) => {
    if (PARAMETER_PATTERN.test(text)) return;
    if (SECRET_PATTERNS.some((pattern) => pattern.test(text))) {
      findings.push({ path, category: "secret" });
    } else if (PII_PATTERNS.some((pattern) => pattern.test(text))) {
      findings.push({ path, category: "pii" });
    } else if (VOLATILE_PATTERNS.some((pattern) => pattern.test(text))) {
      findings.push({ path, category: "volatile" });
    }
  });
  return findings;
}

function environmentBinding(environment) {
  const value = canonicalValue(environment || {});
  assertPlainObject(value, "environment");
  return deepFreeze({
    requirements: clone(value, "environment"),
    digest: digest(value, "cc.record-replay.environment/v1"),
  });
}

function assertIdentifier(value, label) {
  const text = String(value || "").trim();
  if (!/^[A-Za-z][A-Za-z0-9._-]{0,127}$/u.test(text)) {
    throw recorderError("CC_REPLAY_INVALID_ARGUMENT", `${label} is invalid`);
  }
  return text;
}

function normalizeDescription(value) {
  if (typeof value !== "string") {
    throw recorderError(
      "CC_REPLAY_INVALID_ARGUMENT",
      "description must be a string",
    );
  }
  return value.slice(0, 2048);
}

function normalizeFailureConditions(values) {
  if (!Array.isArray(values) || values.length > MAX_FAILURE_CONDITIONS) {
    throw recorderError(
      "CC_REPLAY_INVALID_ARGUMENT",
      `failureConditions must contain at most ${MAX_FAILURE_CONDITIONS} entries`,
    );
  }
  return values.map((value) => {
    if (typeof value !== "string" || !value.trim()) {
      throw recorderError(
        "CC_REPLAY_INVALID_ARGUMENT",
        "failure conditions must be non-empty strings",
      );
    }
    return value.slice(0, 512);
  });
}

function normalizeAction(action, index) {
  assertPlainObject(action, `action ${index}`);
  const kind = String(action.kind || "");
  const capability = SAFE_ACTION_CAPABILITIES[kind];
  if (!capability) {
    throw recorderError(
      "CC_REPLAY_UNSAFE_ACTION",
      `recorded action kind is not in the low-risk allowlist: ${kind}`,
    );
  }
  assertExactKeys(
    action,
    ACTION_KEYS[kind],
    "CC_REPLAY_UNSAFE_ACTION",
    `action ${index}`,
  );
  if (
    typeof action.target !== "string" ||
    !action.target ||
    action.target.length > 1_024
  ) {
    throw recorderError(
      "CC_REPLAY_INVALID_ARGUMENT",
      `action ${index} target must be a non-empty string no longer than 1024 characters`,
    );
  }
  if (["type", "select"].includes(kind) && typeof action.value !== "string") {
    throw recorderError(
      "CC_REPLAY_INVALID_ARGUMENT",
      `action ${index} ${kind} value must be a string`,
    );
  }
  if (kind === "type" && action.value.length > 8_192) {
    throw recorderError(
      "CC_REPLAY_INVALID_ARGUMENT",
      `action ${index} type value exceeds 8192 characters`,
    );
  }
  if (kind === "select" && action.value.length > 1_024) {
    throw recorderError(
      "CC_REPLAY_INVALID_ARGUMENT",
      `action ${index} select value exceeds 1024 characters`,
    );
  }
  if (
    kind === "assert" &&
    "value" in action &&
    typeof action.value !== "string"
  ) {
    throw recorderError(
      "CC_REPLAY_INVALID_ARGUMENT",
      `action ${index} assert value must be a string`,
    );
  }
  return {
    id: `action-${index + 1}`,
    ...action,
    kind,
    requiredCapability: capability,
  };
}

function parameterNamesIn(value) {
  const names = new Set();
  walkStrings(value, (text) => {
    EMBEDDED_PARAMETER_PATTERN.lastIndex = 0;
    for (const match of text.matchAll(EMBEDDED_PARAMETER_PATTERN)) {
      names.add(match[1]);
    }
  });
  return names;
}

function draftBodyFrom(value) {
  return {
    schema: value.schema,
    name: value.name,
    description: value.description,
    status: "draft",
    actions: value.actions,
    parameters: value.parameters,
    capabilityManifest: value.capabilityManifest,
    failureConditions: value.failureConditions,
    environment: value.environment,
  };
}

function integrityError(code, message) {
  return recorderError(code, message);
}

/**
 * Validate and re-materialize a draft received from an external or persisted
 * boundary. Every digest and derived field is recomputed; callers never trust
 * a deserialized object's frozen state.
 */
export function validateRecordedSkillDraft(value) {
  assertPlainObject(value, "recorded skill draft");
  assertExactKeys(
    value,
    new Set([
      "schema",
      "name",
      "description",
      "status",
      "actions",
      "parameters",
      "capabilityManifest",
      "failureConditions",
      "environment",
      "draftDigest",
    ]),
    "CC_REPLAY_DRAFT_INVALID",
    "recorded skill draft",
  );
  if (value.schema !== DRAFT_SCHEMA || value.status !== "draft") {
    throw integrityError(
      "CC_REPLAY_DRAFT_INVALID",
      "recorded skill draft schema or status is invalid",
    );
  }
  const name = assertIdentifier(value.name, "skill name");
  const description = normalizeDescription(value.description);
  if (
    !Array.isArray(value.actions) ||
    value.actions.length < 1 ||
    value.actions.length > MAX_ACTIONS
  ) {
    throw integrityError(
      "CC_REPLAY_DRAFT_INVALID",
      `recorded skill draft must contain between 1 and ${MAX_ACTIONS} actions`,
    );
  }
  const actions = value.actions.map((action, index) => {
    assertPlainObject(action, `action ${index}`);
    assertExactKeys(
      action,
      new Set(["id", "kind", "target", "value", "requiredCapability"]),
      "CC_REPLAY_DRAFT_INVALID",
      `action ${index}`,
    );
    const { id, requiredCapability, ...source } = action;
    const normalized = normalizeAction(source, index);
    if (
      id !== normalized.id ||
      requiredCapability !== normalized.requiredCapability
    ) {
      throw integrityError(
        "CC_REPLAY_DRAFT_INTEGRITY",
        "recorded skill action identity or capability was modified",
      );
    }
    return normalized;
  });
  if (!Array.isArray(value.parameters)) {
    throw integrityError(
      "CC_REPLAY_DRAFT_INVALID",
      "recorded skill parameters must be an array",
    );
  }
  const parameterNames = new Set();
  const parameters = value.parameters.map((parameter) => {
    assertPlainObject(parameter, "recorded skill parameter");
    assertExactKeys(
      parameter,
      new Set(["name", "sensitive", "required"]),
      "CC_REPLAY_DRAFT_INVALID",
      "recorded skill parameter",
    );
    const parameterName = assertIdentifier(parameter.name, "parameter name");
    if (parameterNames.has(parameterName)) {
      throw integrityError(
        "CC_REPLAY_DRAFT_INVALID",
        "recorded skill parameter names must be unique",
      );
    }
    parameterNames.add(parameterName);
    if (
      typeof parameter.sensitive !== "boolean" ||
      typeof parameter.required !== "boolean"
    ) {
      throw integrityError(
        "CC_REPLAY_DRAFT_INVALID",
        "recorded skill parameter flags must be boolean",
      );
    }
    return {
      name: parameterName,
      sensitive: parameter.sensitive,
      required: parameter.required,
    };
  });
  const referencedParameters = parameterNamesIn(actions);
  if (
    [...referencedParameters].some((name) => !parameterNames.has(name)) ||
    [...parameterNames].some((name) => !referencedParameters.has(name))
  ) {
    throw integrityError(
      "CC_REPLAY_DRAFT_INVALID",
      "recorded skill parameters must exactly match action placeholders",
    );
  }
  const expectedCapabilities = [
    ...new Set(actions.map((action) => action.requiredCapability)),
  ].sort();
  if (
    !Array.isArray(value.capabilityManifest) ||
    JSON.stringify(value.capabilityManifest) !==
      JSON.stringify(expectedCapabilities)
  ) {
    throw integrityError(
      "CC_REPLAY_DRAFT_INTEGRITY",
      "recorded skill capability manifest was modified",
    );
  }
  const failureConditions = normalizeFailureConditions(value.failureConditions);
  assertPlainObject(value.environment, "recorded skill environment binding");
  assertExactKeys(
    value.environment,
    new Set(["requirements", "digest"]),
    "CC_REPLAY_DRAFT_INVALID",
    "recorded skill environment binding",
  );
  const environment = environmentBinding(value.environment.requirements);
  if (environment.digest !== value.environment.digest) {
    throw integrityError(
      "CC_REPLAY_DRAFT_INTEGRITY",
      "recorded skill environment binding was modified",
    );
  }
  const scanned = { description, actions, failureConditions, environment };
  const findings = scanRecordedValue(scanned);
  if (findings.length > 0) {
    throw recorderError(
      "CC_REPLAY_SENSITIVE_OR_VOLATILE_DATA",
      "recording contains secret, PII, or volatile data that must be parameterized",
      { findings },
    );
  }
  const body = {
    schema: DRAFT_SCHEMA,
    name,
    description,
    status: "draft",
    actions,
    parameters,
    capabilityManifest: expectedCapabilities,
    failureConditions,
    environment,
  };
  const expectedDigest = digest(body, "cc.record-replay.skill-draft/v1");
  if (value.draftDigest !== expectedDigest) {
    throw integrityError(
      "CC_REPLAY_DRAFT_INTEGRITY",
      "recorded skill draft digest does not match its reviewed content",
    );
  }
  return deepFreeze({ ...clone(body), draftDigest: expectedDigest });
}

/** Validate an approved skill and re-bind approval to the verified draft. */
export function validateReviewedRecordedSkill(value) {
  assertPlainObject(value, "reviewed recorded skill");
  assertExactKeys(
    value,
    new Set([
      "schema",
      "name",
      "description",
      "status",
      "actions",
      "parameters",
      "capabilityManifest",
      "failureConditions",
      "environment",
      "draftDigest",
      "review",
      "approvalDigest",
    ]),
    "CC_REPLAY_APPROVAL_INVALID",
    "reviewed recorded skill",
  );
  if (value.status !== "approved") {
    throw integrityError(
      "CC_REPLAY_APPROVAL_INVALID",
      "recorded skill is not approved",
    );
  }
  const verifiedDraft = validateRecordedSkillDraft({
    ...draftBodyFrom(value),
    draftDigest: value.draftDigest,
  });
  assertPlainObject(value.review, "recorded skill review");
  assertExactKeys(
    value.review,
    new Set([
      "reviewerId",
      "draftDigest",
      "approvedCapabilities",
      "acceptedFailureConditions",
    ]),
    "CC_REPLAY_APPROVAL_INVALID",
    "recorded skill review",
  );
  const review = {
    reviewerId: assertIdentifier(value.review.reviewerId, "reviewerId"),
    draftDigest: value.review.draftDigest,
    approvedCapabilities: [
      ...new Set(value.review.approvedCapabilities || []),
    ].sort(),
    acceptedFailureConditions: value.review.acceptedFailureConditions,
  };
  if (
    review.draftDigest !== verifiedDraft.draftDigest ||
    review.acceptedFailureConditions !== true ||
    JSON.stringify(review.approvedCapabilities) !==
      JSON.stringify(verifiedDraft.capabilityManifest)
  ) {
    throw integrityError(
      "CC_REPLAY_APPROVAL_INVALID",
      "recorded skill approval does not match the verified draft",
    );
  }
  const approvalDigest = digest(review, "cc.record-replay.review/v1");
  if (value.approvalDigest !== approvalDigest) {
    throw integrityError(
      "CC_REPLAY_APPROVAL_INVALID",
      "recorded skill approval digest was modified",
    );
  }
  return deepFreeze({
    ...clone(verifiedDraft),
    status: "approved",
    review,
    approvalDigest,
  });
}

/** Validate a persisted replay report and optionally bind it to one skill. */
export function validateRecordedSkillReplayReport(value, { skill } = {}) {
  assertPlainObject(value, "recorded skill replay report");
  assertExactKeys(
    value,
    new Set([
      "schema",
      "skillDigest",
      "environmentDigest",
      "status",
      "receipts",
      "replayDigest",
    ]),
    "CC_REPLAY_REPORT_INVALID",
    "recorded skill replay report",
  );
  if (value.schema !== REPORT_SCHEMA || value.status !== "succeeded") {
    throw integrityError(
      "CC_REPLAY_REPORT_INVALID",
      "recorded skill replay report schema or status is invalid",
    );
  }
  if (!Array.isArray(value.receipts) || value.receipts.length > MAX_ACTIONS) {
    throw integrityError(
      "CC_REPLAY_REPORT_INVALID",
      "recorded skill replay receipts are invalid",
    );
  }
  const receipts = value.receipts.map((receipt, index) => {
    assertPlainObject(receipt, "recorded skill replay receipt");
    assertExactKeys(
      receipt,
      new Set(["actionId", "evidenceDigest"]),
      "CC_REPLAY_REPORT_INVALID",
      "recorded skill replay receipt",
    );
    if (
      receipt.actionId !== `action-${index + 1}` ||
      !/^sha256:[a-f0-9]{64}$/u.test(String(receipt.evidenceDigest || ""))
    ) {
      throw integrityError(
        "CC_REPLAY_REPORT_INVALID",
        "recorded skill replay receipt identity or digest is invalid",
      );
    }
    return {
      actionId: receipt.actionId,
      evidenceDigest: receipt.evidenceDigest,
    };
  });
  const report = {
    schema: REPORT_SCHEMA,
    skillDigest: String(value.skillDigest || ""),
    environmentDigest: String(value.environmentDigest || ""),
    status: "succeeded",
    receipts,
  };
  const replayDigest = digest(report, "cc.record-replay.report/v1");
  if (
    value.replayDigest !== replayDigest ||
    !/^sha256:[a-f0-9]{64}$/u.test(report.skillDigest) ||
    !/^sha256:[a-f0-9]{64}$/u.test(report.environmentDigest)
  ) {
    throw integrityError(
      "CC_REPLAY_REPORT_INVALID",
      "recorded skill replay report digest is invalid",
    );
  }
  if (skill) {
    const verifiedSkill = validateReviewedRecordedSkill(skill);
    if (
      report.skillDigest !== verifiedSkill.draftDigest ||
      report.environmentDigest !== verifiedSkill.environment.digest ||
      receipts.length !== verifiedSkill.actions.length
    ) {
      throw integrityError(
        "CC_REPLAY_REPORT_INVALID",
        "recorded skill replay report does not match the approved skill",
      );
    }
  }
  return deepFreeze({ ...report, replayDigest });
}

export function createRecordedSkillDraft({
  name,
  description = "",
  actions,
  parameterBindings = [],
  environment = {},
  failureConditions = [],
} = {}) {
  const safeName = assertIdentifier(name, "skill name");
  if (
    !Array.isArray(actions) ||
    actions.length === 0 ||
    actions.length > MAX_ACTIONS
  ) {
    throw recorderError(
      "CC_REPLAY_INVALID_ARGUMENT",
      `recording requires between 1 and ${MAX_ACTIONS} actions`,
    );
  }
  const safeDescription = normalizeDescription(description);
  const safeFailureConditions = normalizeFailureConditions(failureConditions);
  const safeEnvironment = clone(environment, "environment");
  assertPlainObject(safeEnvironment, "environment");
  const names = new Set();
  const bindings = parameterBindings.map((binding) => {
    assertPlainObject(binding, "parameter binding");
    assertExactKeys(
      binding,
      new Set(["name", "value", "sensitive", "required"]),
      "CC_REPLAY_INVALID_ARGUMENT",
      "parameter binding",
    );
    const parameterName = assertIdentifier(binding?.name, "parameter name");
    if (names.has(parameterName)) {
      throw recorderError(
        "CC_REPLAY_INVALID_ARGUMENT",
        `duplicate parameter: ${parameterName}`,
      );
    }
    names.add(parameterName);
    if (typeof binding?.value !== "string" || !binding.value) {
      throw recorderError(
        "CC_REPLAY_INVALID_ARGUMENT",
        `parameter ${parameterName} requires a captured value`,
      );
    }
    return {
      name: parameterName,
      value: binding.value,
      sensitive: binding.sensitive === true,
      required: binding.required !== false,
    };
  });
  const sanitizedActions = substituteCaptured(
    clone(actions, "actions"),
    bindings,
  );
  const findings = scanRecordedValue({
    description: safeDescription,
    actions: sanitizedActions,
    environment: safeEnvironment,
    failureConditions: safeFailureConditions,
  });
  if (findings.length) {
    throw recorderError(
      "CC_REPLAY_SENSITIVE_OR_VOLATILE_DATA",
      "recording contains secret, PII, or volatile data that must be parameterized",
      { findings },
    );
  }
  const requiredCapabilities = new Set();
  const normalizedActions = sanitizedActions.map((action, index) => {
    const normalized = normalizeAction(action, index);
    requiredCapabilities.add(normalized.requiredCapability);
    return normalized;
  });
  const referencedParameters = parameterNamesIn(normalizedActions);
  if (
    [...names].some((parameterName) => !referencedParameters.has(parameterName))
  ) {
    throw recorderError(
      "CC_REPLAY_INVALID_ARGUMENT",
      "every parameter binding must replace at least one recorded action value",
    );
  }
  const body = {
    schema: DRAFT_SCHEMA,
    name: safeName,
    description: safeDescription,
    status: "draft",
    actions: normalizedActions,
    parameters: bindings.map(
      ({ name: parameterName, sensitive, required }) => ({
        name: parameterName,
        sensitive,
        required,
      }),
    ),
    capabilityManifest: [...requiredCapabilities].sort(),
    failureConditions: safeFailureConditions,
    environment: environmentBinding(safeEnvironment),
  };
  return deepFreeze({
    ...clone(body, "recorded skill draft"),
    draftDigest: digest(body, "cc.record-replay.skill-draft/v1"),
  });
}

export function reviewRecordedSkillDraft(
  draft,
  { reviewerId, approvedCapabilities, acceptedFailureConditions = false } = {},
) {
  const verifiedDraft = validateRecordedSkillDraft(draft);
  const reviewer = assertIdentifier(reviewerId, "reviewerId");
  const approved = [...new Set(approvedCapabilities || [])].sort();
  if (
    JSON.stringify(approved) !==
      JSON.stringify([...verifiedDraft.capabilityManifest].sort()) ||
    acceptedFailureConditions !== true
  ) {
    throw recorderError(
      "CC_REPLAY_REVIEW_INCOMPLETE",
      "review must approve the exact capability manifest and failure conditions",
    );
  }
  const review = {
    reviewerId: reviewer,
    draftDigest: verifiedDraft.draftDigest,
    approvedCapabilities: approved,
    acceptedFailureConditions: true,
  };
  return deepFreeze({
    ...clone(verifiedDraft, "recorded skill draft"),
    status: "approved",
    review,
    approvalDigest: digest(review, "cc.record-replay.review/v1"),
  });
}

function expandParameters(value, inputs, definitions) {
  if (typeof value === "string") {
    const match = PARAMETER_PATTERN.exec(value);
    if (match) {
      const definition = definitions.get(match[1]);
      if (!definition || !(match[1] in inputs)) {
        throw recorderError(
          "CC_REPLAY_PARAMETER_MISSING",
          `required replay parameter is missing: ${match[1]}`,
        );
      }
      return inputs[match[1]];
    }
    return value.replace(
      /\$\{parameter\.([A-Za-z][A-Za-z0-9_]*)\}/gu,
      (_placeholder, name) => {
        if (!definitions.has(name) || !(name in inputs)) {
          throw recorderError(
            "CC_REPLAY_PARAMETER_MISSING",
            `required replay parameter is missing: ${name}`,
          );
        }
        if (typeof inputs[name] !== "string") {
          throw recorderError(
            "CC_REPLAY_PARAMETER_INVALID",
            `embedded replay parameter must be a string: ${name}`,
          );
        }
        return inputs[name];
      },
    );
  }
  if (Array.isArray(value)) {
    return value.map((item) => expandParameters(item, inputs, definitions));
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      expandParameters(child, inputs, definitions),
    ]),
  );
}

export async function replayRecordedSkill(
  skill,
  {
    inputs = {},
    environment = {},
    isolation = { sandboxed: true, network: "deny" },
    executor,
  } = {},
) {
  if (skill?.status !== "approved" || !skill?.approvalDigest) {
    throw recorderError(
      "CC_REPLAY_NOT_APPROVED",
      "recorded skill must be explicitly reviewed before replay",
    );
  }
  const verifiedSkill = validateReviewedRecordedSkill(skill);
  let replayNetworkPolicy;
  let reviewedNetworkPolicy;
  try {
    replayNetworkPolicy = createRecordedSkillNetworkPolicy({
      mode: isolation?.network,
      allowedOrigins: isolation?.allowedOrigins || [],
    });
    const reviewed = verifiedSkill.environment.requirements.networkPolicy;
    reviewedNetworkPolicy = reviewed
      ? createRecordedSkillNetworkPolicy({
          mode: reviewed.mode,
          allowedOrigins: reviewed.allowedOrigins || [],
        })
      : createRecordedSkillNetworkPolicy({ mode: "deny" });
  } catch {
    replayNetworkPolicy = null;
    reviewedNetworkPolicy = null;
  }
  if (
    isolation?.sandboxed !== true ||
    !replayNetworkPolicy ||
    replayNetworkPolicy.digest !== reviewedNetworkPolicy?.digest
  ) {
    throw recorderError(
      "CC_REPLAY_ISOLATION_REQUIRED",
      "recorded skill replay requires the exact reviewed browser network policy",
    );
  }
  if (
    environmentBinding(environment).digest !== verifiedSkill.environment.digest
  ) {
    throw recorderError(
      "CC_REPLAY_ENVIRONMENT_DRIFT",
      "replay environment does not match the reviewed recording",
    );
  }
  assertPlainObject(inputs, "replay inputs");
  if (typeof executor?.execute !== "function") {
    throw recorderError(
      "CC_REPLAY_EXECUTOR_INVALID",
      "a replay executor is required",
    );
  }
  if (
    replayNetworkPolicy.mode === "allowlist" &&
    executor.networkPolicyDigest !== replayNetworkPolicy.digest
  ) {
    throw recorderError(
      "CC_REPLAY_ISOLATION_REQUIRED",
      "allowlisted browser replay requires an executor bound to the reviewed network policy",
    );
  }
  const executorCapabilities = new Set(executor.capabilities || []);
  for (const capability of verifiedSkill.capabilityManifest) {
    if (!executorCapabilities.has(capability)) {
      throw recorderError(
        "CC_REPLAY_CAPABILITY_DENIED",
        `replay executor did not grant capability: ${capability}`,
      );
    }
  }
  const definitions = new Map(
    verifiedSkill.parameters.map((parameter) => [parameter.name, parameter]),
  );
  for (const parameter of verifiedSkill.parameters) {
    if (parameter.required && !(parameter.name in inputs)) {
      throw recorderError(
        "CC_REPLAY_PARAMETER_MISSING",
        `required replay parameter is missing: ${parameter.name}`,
      );
    }
  }
  const receipts = [];
  for (const action of verifiedSkill.actions) {
    const expanded = expandParameters(action, inputs, definitions);
    const result = await executor.execute(expanded, {
      isolation: clone(isolation),
      capability: action.requiredCapability,
    });
    if (!result || result.ok !== true || !result.evidence) {
      throw recorderError(
        "CC_REPLAY_ACTION_FAILED",
        `replay action failed without terminal evidence: ${action.id}`,
        { actionId: action.id },
      );
    }
    let serializedEvidence;
    try {
      serializedEvidence = JSON.stringify(canonicalValue(result.evidence));
    } catch {
      throw recorderError(
        "CC_REPLAY_ACTION_FAILED",
        `replay action returned invalid terminal evidence: ${action.id}`,
        { actionId: action.id },
      );
    }
    if (
      typeof serializedEvidence !== "string" ||
      Buffer.byteLength(serializedEvidence, "utf8") > MAX_EVIDENCE_BYTES
    ) {
      throw recorderError(
        "CC_REPLAY_ACTION_FAILED",
        `replay action returned oversized terminal evidence: ${action.id}`,
        { actionId: action.id },
      );
    }
    receipts.push({
      actionId: action.id,
      evidenceDigest: digest(result.evidence, "cc.record-replay.evidence/v1"),
    });
  }
  const report = {
    schema: REPORT_SCHEMA,
    skillDigest: verifiedSkill.draftDigest,
    environmentDigest: verifiedSkill.environment.digest,
    status: "succeeded",
    receipts,
  };
  return deepFreeze({
    ...report,
    replayDigest: digest(report, "cc.record-replay.report/v1"),
  });
}

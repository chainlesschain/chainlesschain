import { createHash } from "node:crypto";

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

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
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
    return bindings.reduce(
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

function scanRecordedValue(value) {
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
  return Object.freeze({
    requirements: Object.freeze(clone(value)),
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

export function createRecordedSkillDraft({
  name,
  description = "",
  actions,
  parameterBindings = [],
  environment = {},
  failureConditions = [],
} = {}) {
  const safeName = assertIdentifier(name, "skill name");
  if (!Array.isArray(actions) || actions.length === 0 || actions.length > 256) {
    throw recorderError(
      "CC_REPLAY_INVALID_ARGUMENT",
      "recording requires between 1 and 256 actions",
    );
  }
  const names = new Set();
  const bindings = parameterBindings.map((binding) => {
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
  const sanitizedActions = substituteCaptured(clone(actions), bindings);
  const findings = scanRecordedValue(sanitizedActions);
  if (findings.length) {
    throw recorderError(
      "CC_REPLAY_SENSITIVE_OR_VOLATILE_DATA",
      "recording contains secret, PII, or volatile data that must be parameterized",
      { findings },
    );
  }
  const requiredCapabilities = new Set();
  const normalizedActions = sanitizedActions.map((action, index) => {
    if (!action || typeof action !== "object" || Array.isArray(action)) {
      throw recorderError(
        "CC_REPLAY_INVALID_ARGUMENT",
        `action ${index} must be an object`,
      );
    }
    const kind = String(action.kind || "");
    const capability = SAFE_ACTION_CAPABILITIES[kind];
    if (!capability) {
      throw recorderError(
        "CC_REPLAY_UNSAFE_ACTION",
        `recorded action kind is not in the low-risk prototype allowlist: ${kind}`,
      );
    }
    requiredCapabilities.add(capability);
    return {
      id: `action-${index + 1}`,
      ...action,
      kind,
      requiredCapability: capability,
    };
  });
  const body = {
    schema: "chainlesschain.recorded-skill-draft/v1",
    name: safeName,
    description: String(description).slice(0, 2048),
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
    failureConditions: failureConditions.map((value) =>
      String(value).slice(0, 512),
    ),
    environment: environmentBinding(environment),
  };
  return Object.freeze({
    ...clone(body),
    draftDigest: digest(body, "cc.record-replay.skill-draft/v1"),
  });
}

export function reviewRecordedSkillDraft(
  draft,
  { reviewerId, approvedCapabilities, acceptedFailureConditions = false } = {},
) {
  if (draft?.status !== "draft" || !draft?.draftDigest) {
    throw recorderError(
      "CC_REPLAY_DRAFT_INVALID",
      "a valid skill draft is required",
    );
  }
  const reviewer = assertIdentifier(reviewerId, "reviewerId");
  const approved = [...new Set(approvedCapabilities || [])].sort();
  if (
    JSON.stringify(approved) !==
      JSON.stringify([...draft.capabilityManifest].sort()) ||
    acceptedFailureConditions !== true
  ) {
    throw recorderError(
      "CC_REPLAY_REVIEW_INCOMPLETE",
      "review must approve the exact capability manifest and failure conditions",
    );
  }
  const review = {
    reviewerId: reviewer,
    draftDigest: draft.draftDigest,
    approvedCapabilities: approved,
    acceptedFailureConditions: true,
  };
  return Object.freeze({
    ...clone(draft),
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
  if (isolation?.sandboxed !== true || isolation?.network !== "deny") {
    throw recorderError(
      "CC_REPLAY_ISOLATION_REQUIRED",
      "recorded skill replay requires a sandbox with network denied",
    );
  }
  if (environmentBinding(environment).digest !== skill.environment.digest) {
    throw recorderError(
      "CC_REPLAY_ENVIRONMENT_DRIFT",
      "replay environment does not match the reviewed recording",
    );
  }
  if (typeof executor?.execute !== "function") {
    throw recorderError(
      "CC_REPLAY_EXECUTOR_INVALID",
      "a replay executor is required",
    );
  }
  const executorCapabilities = new Set(executor.capabilities || []);
  for (const capability of skill.capabilityManifest) {
    if (!executorCapabilities.has(capability)) {
      throw recorderError(
        "CC_REPLAY_CAPABILITY_DENIED",
        `replay executor did not grant capability: ${capability}`,
      );
    }
  }
  const definitions = new Map(
    skill.parameters.map((parameter) => [parameter.name, parameter]),
  );
  for (const parameter of skill.parameters) {
    if (parameter.required && !(parameter.name in inputs)) {
      throw recorderError(
        "CC_REPLAY_PARAMETER_MISSING",
        `required replay parameter is missing: ${parameter.name}`,
      );
    }
  }
  const receipts = [];
  for (const action of skill.actions) {
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
    receipts.push({
      actionId: action.id,
      evidenceDigest: digest(result.evidence, "cc.record-replay.evidence/v1"),
    });
  }
  const report = {
    schema: "chainlesschain.recorded-skill-replay/v1",
    skillDigest: skill.draftDigest,
    environmentDigest: skill.environment.digest,
    status: "succeeded",
    receipts,
  };
  return Object.freeze({
    ...report,
    replayDigest: digest(report, "cc.record-replay.report/v1"),
  });
}

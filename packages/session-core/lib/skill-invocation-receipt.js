const crypto = require("node:crypto");
const { isProxy } = require("node:util").types;

const LEGACY_SKILL_INVOCATION_RECEIPT_SCHEMA =
  "chainlesschain.skill-invocation-receipt/v1";
const SKILL_INVOCATION_RECEIPT_SCHEMA =
  "chainlesschain.skill-invocation-receipt/v2";
const SKILL_INVOCATION_RECEIPT_COMPATIBILITY_SCHEMA =
  "chainlesschain.skill-invocation-receipt-compatibility/v1";
const SKILL_INVOCATION_RECEIPT_CONSUMPTION = Object.freeze({
  HISTORICAL_READ: "historical-read",
  ENVIRONMENT_BOUND_ATTRIBUTION: "environment-bound-attribution",
  CURRENT_ENVIRONMENT_EVIDENCE: "current-environment-evidence",
});
const LEGACY_REQUIRED_ATTRIBUTION_FIELDS = Object.freeze([
  "evolutionRunId",
  "traceId",
  "trajectorySegmentId",
  "providerModelVersion",
  "toolSetDigest",
  "osSandboxPermissionPolicyDigest",
  "taskCohort",
]);
const REQUIRED_ATTRIBUTION_FIELDS = Object.freeze([
  ...LEGACY_REQUIRED_ATTRIBUTION_FIELDS,
  "environmentDigest",
]);
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
function receiptKeys(requiredAttributionFields) {
  return Object.freeze(
    [
      "schema",
      "receiptId",
      ...requiredAttributionFields,
      "selectedSkillDigests",
      "routerCandidates",
      "attributionStatus",
      "attributionEligible",
      "missingAttribution",
      "executionStatus",
      "graderReceipts",
      "userCorrectionRef",
      "tokenCostLatency",
      "startedAt",
      "completedAt",
      "receiptDigest",
    ].sort(),
  );
}
const LEGACY_RECEIPT_KEYS = receiptKeys(LEGACY_REQUIRED_ATTRIBUTION_FIELDS);
const RECEIPT_KEYS = receiptKeys(REQUIRED_ATTRIBUTION_FIELDS);

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function normalizeDigest(value, field) {
  const text = typeof value === "string" ? value.trim() : "";
  const normalized = /^[a-f0-9]{64}$/u.test(text) ? `sha256:${text}` : text;
  if (!/^sha256:[a-f0-9]{64}$/u.test(normalized)) {
    throw new TypeError(`${field} must be a sha256 digest`);
  }
  return normalized;
}

function bounded(value, field, { nullable = false, max = 256 } = {}) {
  if (value == null && nullable) return null;
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > max) {
    throw new TypeError(`${field} must be a bounded non-empty string`);
  }
  return text;
}

function nonNegative(value, field) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) {
    throw new TypeError(`${field} must be a non-negative number`);
  }
  return number;
}

function isPlainRecord(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    isProxy(value)
  ) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, keys) {
  if (!isPlainRecord(value)) return false;
  const actual = Reflect.ownKeys(value);
  return (
    actual.length === keys.length &&
    actual.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return (
        typeof key === "string" &&
        keys.includes(key) &&
        descriptor?.enumerable === true &&
        "value" in descriptor
      );
    })
  );
}

function isBoundedString(value, max = 256) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= max &&
    value.trim() === value
  );
}

function isNonNegativeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isCanonicalInstant(value) {
  if (!isBoundedString(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function assertCommonReceiptStructure(value) {
  const schemaDescriptor = isPlainRecord(value)
    ? Object.getOwnPropertyDescriptor(value, "schema")
    : null;
  const legacy =
    schemaDescriptor &&
    "value" in schemaDescriptor &&
    schemaDescriptor.value === LEGACY_SKILL_INVOCATION_RECEIPT_SCHEMA;
  const requiredAttributionFields = legacy
    ? LEGACY_REQUIRED_ATTRIBUTION_FIELDS
    : REQUIRED_ATTRIBUTION_FIELDS;
  if (
    !hasExactKeys(value, legacy ? LEGACY_RECEIPT_KEYS : RECEIPT_KEYS) ||
    ![
      LEGACY_SKILL_INVOCATION_RECEIPT_SCHEMA,
      SKILL_INVOCATION_RECEIPT_SCHEMA,
    ].includes(value.schema) ||
    !isBoundedString(value.receiptId) ||
    !Array.isArray(value.selectedSkillDigests) ||
    value.selectedSkillDigests.length !== 1 ||
    !DIGEST.test(value.selectedSkillDigests[0] || "") ||
    !Array.isArray(value.routerCandidates) ||
    value.routerCandidates.length < 1 ||
    value.routerCandidates.length > 64 ||
    new Set(value.routerCandidates.map((candidate) => candidate?.digest))
      .size !== value.routerCandidates.length ||
    !value.routerCandidates.some(
      (candidate) => candidate?.digest === value.selectedSkillDigests[0],
    ) ||
    value.routerCandidates.some(
      (candidate) =>
        !hasExactKeys(candidate, ["digest", "reason", "score"]) ||
        !DIGEST.test(candidate.digest || "") ||
        !isNonNegativeNumber(candidate.score) ||
        !isBoundedString(candidate.reason, 512),
    ) ||
    !Array.isArray(value.missingAttribution)
  ) {
    throw new TypeError("Skill invocation receipt structure is invalid");
  }

  const missingAttribution = requiredAttributionFields.filter(
    (field) => value[field] === null,
  );
  for (const field of requiredAttributionFields) {
    if (value[field] !== null && !isBoundedString(value[field])) {
      throw new TypeError("Skill invocation receipt attribution is invalid");
    }
  }
  if (
    (value.toolSetDigest !== null && !DIGEST.test(value.toolSetDigest)) ||
    (value.osSandboxPermissionPolicyDigest !== null &&
      !DIGEST.test(value.osSandboxPermissionPolicyDigest)) ||
    (!legacy &&
      value.environmentDigest !== null &&
      !DIGEST.test(value.environmentDigest)) ||
    value.missingAttribution.length !== missingAttribution.length ||
    value.missingAttribution.some(
      (field, index) => field !== missingAttribution[index],
    ) ||
    value.attributionStatus !==
      (missingAttribution.length === 0 ? "complete" : "incomplete") ||
    value.attributionEligible !== (missingAttribution.length === 0) ||
    !isCanonicalInstant(value.startedAt)
  ) {
    throw new TypeError("Skill invocation receipt attribution is invalid");
  }
}

function assertStartedReceiptStructure(value) {
  assertCommonReceiptStructure(value);
  if (
    value.executionStatus !== "started" ||
    !Array.isArray(value.graderReceipts) ||
    value.graderReceipts.length !== 0 ||
    value.userCorrectionRef !== null ||
    value.tokenCostLatency !== null ||
    value.completedAt !== null ||
    value.receiptDigest !== null
  ) {
    throw new TypeError("a started Skill invocation receipt is required");
  }
}

function assertSettledReceiptStructure(value) {
  assertCommonReceiptStructure(value);
  if (
    !["completed", "failed", "blocked"].includes(value.executionStatus) ||
    !Array.isArray(value.graderReceipts) ||
    value.graderReceipts.length > 64 ||
    new Set(value.graderReceipts).size !== value.graderReceipts.length ||
    value.graderReceipts.some((entry) => !DIGEST.test(entry || "")) ||
    (value.userCorrectionRef !== null &&
      !isBoundedString(value.userCorrectionRef)) ||
    !hasExactKeys(value.tokenCostLatency, [
      "costUsd",
      "latencyMs",
      "tokensInput",
      "tokensOutput",
    ]) ||
    Object.values(value.tokenCostLatency).some(
      (entry) => !isNonNegativeNumber(entry),
    ) ||
    !Number.isSafeInteger(value.tokenCostLatency.tokensInput) ||
    !Number.isSafeInteger(value.tokenCostLatency.tokensOutput) ||
    !isCanonicalInstant(value.completedAt) ||
    Date.parse(value.completedAt) < Date.parse(value.startedAt) ||
    !DIGEST.test(value.receiptDigest || "")
  ) {
    throw new TypeError("settled Skill invocation receipt is invalid");
  }
}

function startSkillInvocation(input, options = {}) {
  const clock = options.clock || (() => new Date().toISOString());
  const randomUUID = options.randomUUID || crypto.randomUUID;
  const selectedSkillDigest = normalizeDigest(
    input.selectedSkillDigest,
    "selectedSkillDigest",
  );
  const routerCandidates = (input.routerCandidates || []).map(
    (candidate, index) =>
      Object.freeze({
        digest: normalizeDigest(candidate.digest, `routerCandidates[${index}]`),
        score: nonNegative(candidate.score, `routerCandidates[${index}].score`),
        reason: bounded(candidate.reason, `routerCandidates[${index}].reason`, {
          max: 512,
        }),
      }),
  );
  if (
    routerCandidates.length === 0 ||
    routerCandidates.length > 64 ||
    new Set(routerCandidates.map(({ digest: value }) => value)).size !==
      routerCandidates.length ||
    !routerCandidates.some(({ digest: value }) => value === selectedSkillDigest)
  ) {
    throw new TypeError(
      "routerCandidates must contain the selected Skill digest",
    );
  }
  const optionalAttribution = Object.fromEntries(
    REQUIRED_ATTRIBUTION_FIELDS.map((field) => [
      field,
      typeof input[field] === "string" && input[field].trim()
        ? bounded(input[field], field)
        : null,
    ]),
  );
  for (const field of [
    "toolSetDigest",
    "osSandboxPermissionPolicyDigest",
    "environmentDigest",
  ]) {
    if (optionalAttribution[field] !== null) {
      optionalAttribution[field] = normalizeDigest(
        optionalAttribution[field],
        field,
      );
    }
  }
  const missingAttribution = REQUIRED_ATTRIBUTION_FIELDS.filter(
    (field) => optionalAttribution[field] === null,
  );
  if (input.attributionRequired === true && missingAttribution.length > 0) {
    const error = new Error(
      `Skill attribution is incomplete: ${missingAttribution.join(", ")}`,
    );
    error.code = "CC_SKILL_ATTRIBUTION_REQUIRED";
    error.missingAttribution = Object.freeze([...missingAttribution]);
    throw error;
  }
  const startedAt = bounded(clock(), "startedAt");
  if (!isCanonicalInstant(startedAt)) {
    throw new TypeError("startedAt must be a canonical ISO instant");
  }
  return Object.freeze({
    schema: SKILL_INVOCATION_RECEIPT_SCHEMA,
    receiptId: bounded(
      input.receiptId || `skill-invocation:${randomUUID()}`,
      "receiptId",
    ),
    ...optionalAttribution,
    selectedSkillDigests: Object.freeze([selectedSkillDigest]),
    routerCandidates: Object.freeze(routerCandidates),
    attributionStatus:
      missingAttribution.length === 0 ? "complete" : "incomplete",
    attributionEligible: missingAttribution.length === 0,
    missingAttribution: Object.freeze(missingAttribution),
    executionStatus: "started",
    graderReceipts: Object.freeze([]),
    userCorrectionRef: null,
    tokenCostLatency: null,
    startedAt,
    completedAt: null,
    receiptDigest: null,
  });
}

function settleSkillInvocation(start, outcome, options = {}) {
  assertStartedReceiptStructure(start);
  const status = bounded(outcome.executionStatus, "executionStatus");
  if (!new Set(["completed", "failed", "blocked"]).has(status)) {
    throw new TypeError("executionStatus is invalid");
  }
  const graderReceipts = (outcome.graderReceipts || []).map((value, index) =>
    normalizeDigest(value, `graderReceipts[${index}]`),
  );
  if (graderReceipts.length > 64) {
    throw new TypeError("graderReceipts exceeds 64 entries");
  }
  if (new Set(graderReceipts).size !== graderReceipts.length) {
    throw new TypeError("graderReceipts contains duplicate entries");
  }
  const clock = options.clock || (() => new Date().toISOString());
  const completedAt = bounded(clock(), "completedAt");
  if (
    !isCanonicalInstant(completedAt) ||
    Date.parse(completedAt) < Date.parse(start.startedAt)
  ) {
    throw new TypeError(
      "completedAt must be a canonical ISO instant at or after startedAt",
    );
  }
  const tokensInput = nonNegative(outcome.tokensInput, "tokensInput");
  const tokensOutput = nonNegative(outcome.tokensOutput, "tokensOutput");
  if (
    !Number.isSafeInteger(tokensInput) ||
    !Number.isSafeInteger(tokensOutput)
  ) {
    throw new TypeError("token counts must be non-negative safe integers");
  }
  const core = {
    ...start,
    executionStatus: status,
    graderReceipts: Object.freeze(graderReceipts),
    userCorrectionRef:
      outcome.userCorrectionRef == null
        ? null
        : bounded(outcome.userCorrectionRef, "userCorrectionRef"),
    tokenCostLatency: Object.freeze({
      tokensInput,
      tokensOutput,
      costUsd: nonNegative(outcome.costUsd, "costUsd"),
      latencyMs: nonNegative(outcome.latencyMs, "latencyMs"),
    }),
    completedAt,
  };
  delete core.receiptDigest;
  return Object.freeze({
    ...core,
    receiptDigest: digest(`${start.schema}\0${canonicalJson(core)}`),
  });
}

function verifySkillInvocationReceipt(value) {
  assertSettledReceiptStructure(value);
  const core = { ...value };
  delete core.receiptDigest;
  const expected = digest(`${value.schema}\0${canonicalJson(core)}`);
  if (value.receiptDigest !== expected) {
    throw new TypeError("Skill invocation receipt digest is invalid");
  }
  return value;
}

function skillInvocationReceiptCompatibilityError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function inspectSkillInvocationReceiptCompatibility(value, options = {}) {
  const optionKeys = isPlainRecord(options) ? Reflect.ownKeys(options) : [];
  if (
    !isPlainRecord(options) ||
    optionKeys.some(
      (key) =>
        key !== "expectedEnvironmentDigest" ||
        !Object.prototype.hasOwnProperty.call(options, key) ||
        !Object.getOwnPropertyDescriptor(options, key)?.enumerable ||
        !("value" in Object.getOwnPropertyDescriptor(options, key)),
    )
  ) {
    throw new TypeError(
      "Skill invocation receipt compatibility options are invalid",
    );
  }
  const expectedEnvironmentDescriptor = Object.getOwnPropertyDescriptor(
    options,
    "expectedEnvironmentDigest",
  );
  const expectedEnvironmentInput = expectedEnvironmentDescriptor?.value;
  const receipt = verifySkillInvocationReceipt(value);
  const expectedEnvironmentDigest =
    expectedEnvironmentInput == null
      ? null
      : normalizeDigest(expectedEnvironmentInput, "expectedEnvironmentDigest");
  const legacy = receipt.schema === LEGACY_SKILL_INVOCATION_RECEIPT_SCHEMA;
  const environmentBound =
    !legacy && DIGEST.test(receipt.environmentDigest || "");
  const environmentBoundAttributionEligible =
    environmentBound && receipt.attributionEligible === true;
  const expectedEnvironmentChecked = expectedEnvironmentDigest !== null;
  const environmentStatus = legacy
    ? "legacy-unbound"
    : !environmentBound
      ? "missing"
      : !expectedEnvironmentChecked
        ? "bound-unchecked"
        : receipt.environmentDigest === expectedEnvironmentDigest
          ? "current"
          : "stale";
  return Object.freeze({
    schema: SKILL_INVOCATION_RECEIPT_COMPATIBILITY_SCHEMA,
    receiptSchema: receipt.schema,
    historicalReadable: true,
    legacyEnvironmentUnbound: legacy,
    environmentBound,
    environmentBoundAttributionEligible,
    expectedEnvironmentChecked,
    currentEnvironmentEligible:
      environmentBoundAttributionEligible && environmentStatus === "current",
    environmentStatus,
  });
}

function verifySkillInvocationReceiptForConsumption(
  value,
  consumption,
  options = {},
) {
  if (
    !Object.values(SKILL_INVOCATION_RECEIPT_CONSUMPTION).includes(consumption)
  ) {
    throw new TypeError("Skill invocation receipt consumption is invalid");
  }
  const compatibility = inspectSkillInvocationReceiptCompatibility(
    value,
    options,
  );
  if (consumption === SKILL_INVOCATION_RECEIPT_CONSUMPTION.HISTORICAL_READ) {
    return value;
  }
  if (!compatibility.environmentBoundAttributionEligible) {
    throw skillInvocationReceiptCompatibilityError(
      compatibility.legacyEnvironmentUnbound
        ? "Legacy Skill invocation receipts are not environment-bound evidence"
        : "Skill invocation receipt lacks complete environment-bound attribution",
      compatibility.legacyEnvironmentUnbound
        ? "CC_SKILL_INVOCATION_RECEIPT_LEGACY_UNBOUND"
        : "CC_SKILL_INVOCATION_RECEIPT_ATTRIBUTION_INCOMPLETE",
    );
  }
  if (
    consumption ===
    SKILL_INVOCATION_RECEIPT_CONSUMPTION.CURRENT_ENVIRONMENT_EVIDENCE
  ) {
    if (!compatibility.expectedEnvironmentChecked) {
      throw skillInvocationReceiptCompatibilityError(
        "Current-environment evidence requires an expected environment digest",
        "CC_SKILL_INVOCATION_RECEIPT_ENVIRONMENT_REQUIRED",
      );
    }
    if (!compatibility.currentEnvironmentEligible) {
      throw skillInvocationReceiptCompatibilityError(
        "Skill invocation receipt belongs to a stale environment",
        "CC_SKILL_INVOCATION_RECEIPT_ENVIRONMENT_STALE",
      );
    }
  }
  return value;
}

function buildSkillInvocationTraceProjection(receipts, traceId) {
  const expectedTraceId = bounded(traceId, "traceId");
  const verified = (receipts || [])
    .map(verifySkillInvocationReceipt)
    .filter((receipt) => receipt.traceId === expectedTraceId)
    .sort(
      (left, right) =>
        left.startedAt.localeCompare(right.startedAt) ||
        left.receiptId.localeCompare(right.receiptId),
    );
  const totals = verified.reduce(
    (result, receipt) => ({
      tokensInput: result.tokensInput + receipt.tokenCostLatency.tokensInput,
      tokensOutput: result.tokensOutput + receipt.tokenCostLatency.tokensOutput,
      costUsd: result.costUsd + receipt.tokenCostLatency.costUsd,
      latencyMs: result.latencyMs + receipt.tokenCostLatency.latencyMs,
    }),
    { tokensInput: 0, tokensOutput: 0, costUsd: 0, latencyMs: 0 },
  );
  return Object.freeze({
    schema: "chainlesschain.skill-invocation-trace-projection/v2",
    traceId: expectedTraceId,
    complete: verified.every(
      (receipt) =>
        receipt.schema === SKILL_INVOCATION_RECEIPT_SCHEMA &&
        receipt.attributionEligible === true,
    ),
    environmentBound: verified.every(
      (receipt) =>
        receipt.schema === SKILL_INVOCATION_RECEIPT_SCHEMA &&
        DIGEST.test(receipt.environmentDigest || ""),
    ),
    receiptCount: verified.length,
    invocations: Object.freeze(
      verified.map((receipt) =>
        Object.freeze({
          receiptId: receipt.receiptId,
          receiptDigest: receipt.receiptDigest,
          trajectorySegmentId: receipt.trajectorySegmentId,
          selectedSkillDigests: receipt.selectedSkillDigests,
          routerCandidates: receipt.routerCandidates,
          providerModelVersion: receipt.providerModelVersion,
          toolSetDigest: receipt.toolSetDigest,
          osSandboxPermissionPolicyDigest:
            receipt.osSandboxPermissionPolicyDigest,
          environmentDigest: receipt.environmentDigest ?? null,
          legacyEnvironmentUnbound:
            receipt.schema === LEGACY_SKILL_INVOCATION_RECEIPT_SCHEMA,
          taskCohort: receipt.taskCohort,
          executionStatus: receipt.executionStatus,
          graderReceipts: receipt.graderReceipts,
          userCorrectionRef: receipt.userCorrectionRef,
          tokenCostLatency: receipt.tokenCostLatency,
        }),
      ),
    ),
    totals: Object.freeze(totals),
  });
}

module.exports = {
  LEGACY_SKILL_INVOCATION_RECEIPT_SCHEMA,
  SKILL_INVOCATION_RECEIPT_SCHEMA,
  SKILL_INVOCATION_RECEIPT_COMPATIBILITY_SCHEMA,
  SKILL_INVOCATION_RECEIPT_CONSUMPTION,
  REQUIRED_ATTRIBUTION_FIELDS,
  startSkillInvocation,
  settleSkillInvocation,
  verifySkillInvocationReceipt,
  inspectSkillInvocationReceiptCompatibility,
  verifySkillInvocationReceiptForConsumption,
  buildSkillInvocationTraceProjection,
};

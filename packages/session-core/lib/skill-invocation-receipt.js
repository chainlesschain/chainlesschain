const crypto = require("node:crypto");

const SKILL_INVOCATION_RECEIPT_SCHEMA =
  "chainlesschain.skill-invocation-receipt/v1";
const REQUIRED_ATTRIBUTION_FIELDS = Object.freeze([
  "evolutionRunId",
  "traceId",
  "trajectorySegmentId",
  "providerModelVersion",
  "toolSetDigest",
  "osSandboxPermissionPolicyDigest",
  "taskCohort",
]);

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
  for (const field of ["toolSetDigest", "osSandboxPermissionPolicyDigest"]) {
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
    startedAt: bounded(clock(), "startedAt"),
    completedAt: null,
    receiptDigest: null,
  });
}

function settleSkillInvocation(start, outcome, options = {}) {
  if (
    !start ||
    start.schema !== SKILL_INVOCATION_RECEIPT_SCHEMA ||
    start.executionStatus !== "started"
  ) {
    throw new TypeError("a started Skill invocation receipt is required");
  }
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
  const clock = options.clock || (() => new Date().toISOString());
  const core = {
    ...start,
    executionStatus: status,
    graderReceipts: Object.freeze(graderReceipts),
    userCorrectionRef:
      outcome.userCorrectionRef == null
        ? null
        : bounded(outcome.userCorrectionRef, "userCorrectionRef"),
    tokenCostLatency: Object.freeze({
      tokensInput: nonNegative(outcome.tokensInput, "tokensInput"),
      tokensOutput: nonNegative(outcome.tokensOutput, "tokensOutput"),
      costUsd: nonNegative(outcome.costUsd, "costUsd"),
      latencyMs: nonNegative(outcome.latencyMs, "latencyMs"),
    }),
    completedAt: bounded(clock(), "completedAt"),
  };
  delete core.receiptDigest;
  return Object.freeze({
    ...core,
    receiptDigest: digest(
      `${SKILL_INVOCATION_RECEIPT_SCHEMA}\0${canonicalJson(core)}`,
    ),
  });
}

function verifySkillInvocationReceipt(value) {
  if (
    !value ||
    value.schema !== SKILL_INVOCATION_RECEIPT_SCHEMA ||
    !["completed", "failed", "blocked"].includes(value.executionStatus)
  ) {
    throw new TypeError("settled Skill invocation receipt is invalid");
  }
  const core = { ...value };
  delete core.receiptDigest;
  const expected = digest(
    `${SKILL_INVOCATION_RECEIPT_SCHEMA}\0${canonicalJson(core)}`,
  );
  if (value.receiptDigest !== expected) {
    throw new TypeError("Skill invocation receipt digest is invalid");
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
    schema: "chainlesschain.skill-invocation-trace-projection/v1",
    traceId: expectedTraceId,
    complete: verified.every((receipt) => receipt.attributionEligible === true),
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
  SKILL_INVOCATION_RECEIPT_SCHEMA,
  REQUIRED_ATTRIBUTION_FIELDS,
  startSkillInvocation,
  settleSkillInvocation,
  verifySkillInvocationReceipt,
  buildSkillInvocationTraceProjection,
};

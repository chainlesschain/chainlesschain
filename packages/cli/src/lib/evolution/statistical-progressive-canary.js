import { createHash } from "node:crypto";

export const PROGRESSIVE_CANARY_PLAN_SCHEMA =
  "chainlesschain.progressive-canary-plan/v2";
export const PROGRESSIVE_CANARY_ASSIGNMENT_SCHEMA =
  "chainlesschain.progressive-canary-assignment/v2";
export const PROGRESSIVE_CANARY_GATE_REPORT_SCHEMA =
  "chainlesschain.progressive-canary-gate-report/v2";
export const PROGRESSIVE_CANARY_GATE_RECEIPT_SCHEMA =
  "chainlesschain.progressive-canary-gate-receipt/v1";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const RISK_TIERS = new Set(["low", "medium", "high"]);
const AUTHORITIES = new WeakSet();
const GATE_AUTHORITIES = new WeakSet();

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

function exact(value, keys, name) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(`${name} must be an object`);
  if (canonical(Object.keys(value).sort()) !== canonical([...keys].sort()))
    throw new TypeError(`${name} has unexpected or missing fields`);
}

function id(value, name) {
  if (typeof value !== "string" || !SAFE_ID.test(value))
    throw new TypeError(`${name} is invalid`);
  return value;
}

function sha(value, name) {
  if (!DIGEST.test(value ?? ""))
    throw new TypeError(`${name} must be a sha256 digest`);
  return value;
}

function integer(value, name, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new TypeError(`${name} is out of range`);
  return value;
}

function finite(value, name, { min = -Infinity, max = Infinity } = {}) {
  if (!Number.isFinite(value) || value < min || value > max)
    throw new TypeError(`${name} is out of range`);
  return value;
}

function verifyPlan(plan) {
  if (!plan || plan.schema !== PROGRESSIVE_CANARY_PLAN_SCHEMA)
    throw new TypeError("a canonical progressive Canary plan is required");
  const core = structuredClone(plan);
  delete core.planDigest;
  if (hash(PROGRESSIVE_CANARY_PLAN_SCHEMA, core) !== plan.planDigest)
    throw new Error("progressive Canary plan digest mismatch");
  return plan;
}

export function verifyProgressiveCanaryPlan(plan) {
  return verifyPlan(plan);
}

function normalizeSteps(steps) {
  if (!Array.isArray(steps) || steps.length < 3 || steps.length > 16)
    throw new TypeError("progressive Canary plan requires 3..16 steps");
  const ids = new Set();
  const normalized = steps.map((step, index) => {
    exact(
      step,
      [
        "id",
        "stage",
        "trafficPercent",
        "minSamples",
        "minWindowMs",
        "maxWindowMs",
      ],
      `Canary step ${index}`,
    );
    const stepId = id(step.id, `Canary step ${index} id`);
    if (ids.has(stepId))
      throw new TypeError(`duplicate Canary step: ${stepId}`);
    ids.add(stepId);
    if (!new Set(["shadow", "canary", "active-probation"]).has(step.stage))
      throw new TypeError(`Canary step ${index} stage is invalid`);
    const result = {
      id: stepId,
      stage: step.stage,
      trafficPercent: finite(
        step.trafficPercent,
        `Canary step ${index} trafficPercent`,
        {
          min: 0,
          max: 100,
        },
      ),
      minSamples: integer(step.minSamples, `Canary step ${index} minSamples`, {
        min: 1,
        max: 1_000_000,
      }),
      minWindowMs: integer(
        step.minWindowMs,
        `Canary step ${index} minWindowMs`,
        {
          min: 1,
        },
      ),
      maxWindowMs: integer(
        step.maxWindowMs,
        `Canary step ${index} maxWindowMs`,
        {
          min: 1,
        },
      ),
    };
    if (result.maxWindowMs < result.minWindowMs)
      throw new TypeError(`Canary step ${index} window is invalid`);
    return Object.freeze(result);
  });
  if (
    normalized[0].stage !== "shadow" ||
    normalized[0].trafficPercent !== 0 ||
    normalized.at(-1).stage !== "active-probation" ||
    normalized.at(-1).trafficPercent !== 100 ||
    normalized.slice(1, -1).some((step) => step.stage !== "canary")
  )
    throw new TypeError(
      "progressive Canary steps must be shadow, Canary steps, then active-probation",
    );
  for (let index = 1; index < normalized.length; index += 1) {
    if (
      normalized[index].trafficPercent <= normalized[index - 1].trafficPercent
    )
      throw new TypeError(
        "progressive Canary traffic must increase monotonically",
      );
  }
  return Object.freeze(normalized);
}

export function createProgressiveCanaryPlan(input = {}) {
  exact(
    input,
    [
      "tenantId",
      "pilotId",
      "skillName",
      "candidateDigest",
      "baselineDigest",
      "riskTier",
      "assignmentSaltDigest",
      "assignmentAuthority",
      "gateAuthority",
      "steps",
      "thresholds",
    ],
    "progressive Canary plan",
  );
  if (!RISK_TIERS.has(input.riskTier))
    throw new TypeError("progressive Canary riskTier is invalid");
  exact(
    input.assignmentAuthority,
    ["id", "revision", "handlerDigest"],
    "assignmentAuthority",
  );
  exact(
    input.gateAuthority,
    ["id", "revision", "handlerDigest"],
    "gateAuthority",
  );
  exact(
    input.thresholds,
    [
      "confidence",
      "bootstrapSamples",
      "minQualityDeltaLowerBound",
      "maxMeanCostDelta",
      "maxP95LatencyRatio",
      "maxP99LatencyRatio",
      "maxMeanToolCallDelta",
    ],
    "Canary thresholds",
  );
  if (input.thresholds.bootstrapSamples !== 1_000)
    throw new TypeError("Canary bootstrapSamples must equal 1000");
  const core = {
    schema: PROGRESSIVE_CANARY_PLAN_SCHEMA,
    tenantId: id(input.tenantId, "tenantId"),
    pilotId: id(input.pilotId, "pilotId"),
    skillName: id(input.skillName, "skillName"),
    candidateDigest: sha(input.candidateDigest, "candidateDigest"),
    baselineDigest: sha(input.baselineDigest, "baselineDigest"),
    riskTier: input.riskTier,
    assignmentSaltDigest: sha(
      input.assignmentSaltDigest,
      "assignmentSaltDigest",
    ),
    assignmentAuthority: Object.freeze({
      id: id(input.assignmentAuthority.id, "assignmentAuthority.id"),
      revision: integer(
        input.assignmentAuthority.revision,
        "assignmentAuthority.revision",
        { min: 1 },
      ),
      handlerDigest: sha(
        input.assignmentAuthority.handlerDigest,
        "assignmentAuthority.handlerDigest",
      ),
    }),
    gateAuthority: Object.freeze({
      id: id(input.gateAuthority.id, "gateAuthority.id"),
      revision: integer(
        input.gateAuthority.revision,
        "gateAuthority.revision",
        {
          min: 1,
        },
      ),
      handlerDigest: sha(
        input.gateAuthority.handlerDigest,
        "gateAuthority.handlerDigest",
      ),
    }),
    steps: normalizeSteps(input.steps),
    thresholds: Object.freeze({
      confidence: finite(input.thresholds.confidence, "confidence", {
        min: 0.9,
        max: 0.999,
      }),
      bootstrapSamples: 1_000,
      minQualityDeltaLowerBound: finite(
        input.thresholds.minQualityDeltaLowerBound,
        "minQualityDeltaLowerBound",
        { min: -1, max: 1 },
      ),
      maxMeanCostDelta: finite(
        input.thresholds.maxMeanCostDelta,
        "maxMeanCostDelta",
      ),
      maxP95LatencyRatio: finite(
        input.thresholds.maxP95LatencyRatio,
        "maxP95LatencyRatio",
        { min: 0 },
      ),
      maxP99LatencyRatio: finite(
        input.thresholds.maxP99LatencyRatio,
        "maxP99LatencyRatio",
        { min: 0 },
      ),
      maxMeanToolCallDelta: finite(
        input.thresholds.maxMeanToolCallDelta,
        "maxMeanToolCallDelta",
      ),
    }),
  };
  return Object.freeze({
    ...core,
    planDigest: hash(PROGRESSIVE_CANARY_PLAN_SCHEMA, core),
  });
}

function bucket(plan, subjectDigest) {
  const digest = hash(PROGRESSIVE_CANARY_ASSIGNMENT_SCHEMA, {
    planDigest: plan.planDigest,
    assignmentSaltDigest: plan.assignmentSaltDigest,
    subjectDigest,
  });
  return Number.parseInt(digest.slice(7, 15), 16) % 10_000;
}

export function createProgressiveCanaryAssignmentAuthority({
  plan: planInput,
  attestor,
  verifier,
  now = Date.now,
} = {}) {
  const plan = verifyPlan(planInput);
  if (typeof attestor !== "function" || typeof verifier !== "function")
    throw new TypeError("Canary assignment attestor and verifier are required");
  if (typeof now !== "function")
    throw new TypeError("Canary authority clock is required");

  async function verifyReceipt(receipt, { stepId, subjectDigest } = {}) {
    exact(
      receipt,
      [
        "schema",
        "planDigest",
        "tenantId",
        "pilotId",
        "stepId",
        "subjectDigest",
        "bucket",
        "assigned",
        "authorityId",
        "authorityRevision",
        "handlerDigest",
        "issuedAt",
        "expiresAt",
        "signature",
        "receiptDigest",
      ],
      "Canary assignment receipt",
    );
    if (
      receipt?.schema !== PROGRESSIVE_CANARY_ASSIGNMENT_SCHEMA ||
      receipt.planDigest !== plan.planDigest ||
      receipt.tenantId !== plan.tenantId ||
      receipt.pilotId !== plan.pilotId ||
      receipt.stepId !== stepId ||
      receipt.subjectDigest !== subjectDigest ||
      !DIGEST.test(receipt.receiptDigest ?? "")
    )
      throw new Error("Canary assignment receipt binding is invalid");
    const core = structuredClone(receipt);
    delete core.receiptDigest;
    if (
      hash(PROGRESSIVE_CANARY_ASSIGNMENT_SCHEMA, core) !== receipt.receiptDigest
    )
      throw new Error("Canary assignment receipt digest mismatch");
    const step = plan.steps.find(({ id: value }) => value === stepId);
    if (!step || receipt.bucket !== bucket(plan, subjectDigest))
      throw new Error("Canary assignment bucket is invalid");
    const expectedAssigned =
      step.stage !== "canary" || receipt.bucket < step.trafficPercent * 100;
    if (receipt.assigned !== expectedAssigned)
      throw new Error("Canary assignment decision is invalid");
    if (
      receipt.authorityId !== plan.assignmentAuthority.id ||
      receipt.authorityRevision !== plan.assignmentAuthority.revision ||
      receipt.handlerDigest !== plan.assignmentAuthority.handlerDigest ||
      typeof receipt.issuedAt !== "string" ||
      typeof receipt.expiresAt !== "string" ||
      !Number.isFinite(Date.parse(receipt.issuedAt)) ||
      !Number.isFinite(Date.parse(receipt.expiresAt)) ||
      Date.parse(receipt.issuedAt) > Number(now()) ||
      Date.parse(receipt.expiresAt) < Number(now()) ||
      typeof receipt.signature !== "string" ||
      receipt.signature.length < 32
    )
      throw new Error("Canary assignment attestation is invalid or expired");
    const payload = structuredClone(core);
    delete payload.signature;
    if (!(await verifier({ payload, signature: receipt.signature })))
      throw new Error("Canary assignment signature rejected");
    return Object.freeze(structuredClone(receipt));
  }

  const authority = Object.freeze({
    planDigest: plan.planDigest,
    tenantId: plan.tenantId,
    pilotId: plan.pilotId,
    async assign({ stepId, subjectDigest: subjectDigestInput } = {}) {
      const step = plan.steps.find(({ id: value }) => value === stepId);
      if (!step) throw new TypeError("Canary assignment step is invalid");
      const subjectDigest = sha(subjectDigestInput, "subjectDigest");
      const assignedBucket = bucket(plan, subjectDigest);
      const payload = {
        schema: PROGRESSIVE_CANARY_ASSIGNMENT_SCHEMA,
        planDigest: plan.planDigest,
        tenantId: plan.tenantId,
        pilotId: plan.pilotId,
        stepId,
        subjectDigest,
        bucket: assignedBucket,
        assigned:
          step.stage !== "canary" || assignedBucket < step.trafficPercent * 100,
        authorityId: plan.assignmentAuthority.id,
        authorityRevision: plan.assignmentAuthority.revision,
        handlerDigest: plan.assignmentAuthority.handlerDigest,
      };
      const attestation = await attestor(
        Object.freeze(structuredClone(payload)),
      );
      exact(
        attestation,
        ["issuedAt", "expiresAt", "signature"],
        "assignment attestation",
      );
      const core = { ...payload, ...attestation };
      return verifyReceipt(
        Object.freeze({
          ...core,
          receiptDigest: hash(PROGRESSIVE_CANARY_ASSIGNMENT_SCHEMA, core),
        }),
        { stepId, subjectDigest },
      );
    },
    verify: verifyReceipt,
  });
  AUTHORITIES.add(authority);
  return authority;
}

function percentile(sorted, probability) {
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return (
    sorted[lower] * (1 - (position - lower)) +
    sorted[upper] * (position - lower)
  );
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function ratio(candidate, baseline) {
  if (baseline === 0) return candidate === 0 ? 1 : Number.MAX_VALUE;
  return candidate / baseline;
}

function randomFrom(value) {
  let state = Number.parseInt(value.slice(7, 15), 16) || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function verifyGateReport(report, plan) {
  if (
    report?.schema !== PROGRESSIVE_CANARY_GATE_REPORT_SCHEMA ||
    report.planDigest !== plan.planDigest ||
    !DIGEST.test(report.reportDigest ?? "")
  )
    throw new Error("progressive Canary gate report is invalid");
  const core = structuredClone(report);
  delete core.reportDigest;
  if (hash(PROGRESSIVE_CANARY_GATE_REPORT_SCHEMA, core) !== report.reportDigest)
    throw new Error("progressive Canary gate report digest mismatch");
  return report;
}

export function createProgressiveCanaryGateAuthority({
  plan: planInput,
  assignmentAuthority,
  attestor,
  verifier,
  now = Date.now,
} = {}) {
  const plan = verifyPlan(planInput);
  if (!AUTHORITIES.has(assignmentAuthority))
    throw new TypeError("a branded Canary assignment authority is required");
  if (
    assignmentAuthority.planDigest !== plan.planDigest ||
    assignmentAuthority.tenantId !== plan.tenantId ||
    assignmentAuthority.pilotId !== plan.pilotId
  )
    throw new TypeError("Canary assignment authority belongs to another plan");
  if (typeof attestor !== "function" || typeof verifier !== "function")
    throw new TypeError("Canary gate attestor and verifier are required");
  if (typeof now !== "function")
    throw new TypeError("Canary gate authority clock is required");

  async function verifyReceipt(receipt, { stepId } = {}) {
    exact(
      receipt,
      [
        "schema",
        "planDigest",
        "tenantId",
        "pilotId",
        "stepId",
        "report",
        "reportDigest",
        "authorityId",
        "authorityRevision",
        "handlerDigest",
        "issuedAt",
        "expiresAt",
        "signature",
        "receiptDigest",
      ],
      "Canary gate receipt",
    );
    const report = verifyGateReport(receipt.report, plan);
    if (
      receipt.schema !== PROGRESSIVE_CANARY_GATE_RECEIPT_SCHEMA ||
      receipt.planDigest !== plan.planDigest ||
      receipt.tenantId !== plan.tenantId ||
      receipt.pilotId !== plan.pilotId ||
      receipt.stepId !== stepId ||
      report.stepId !== stepId ||
      receipt.reportDigest !== report.reportDigest ||
      receipt.authorityId !== plan.gateAuthority.id ||
      receipt.authorityRevision !== plan.gateAuthority.revision ||
      receipt.handlerDigest !== plan.gateAuthority.handlerDigest ||
      typeof receipt.issuedAt !== "string" ||
      typeof receipt.expiresAt !== "string" ||
      !Number.isFinite(Date.parse(receipt.issuedAt)) ||
      !Number.isFinite(Date.parse(receipt.expiresAt)) ||
      Date.parse(receipt.issuedAt) > Number(now()) ||
      Date.parse(receipt.expiresAt) < Number(now()) ||
      typeof receipt.signature !== "string" ||
      receipt.signature.length < 32 ||
      !DIGEST.test(receipt.receiptDigest ?? "")
    )
      throw new Error("Canary gate receipt binding is invalid or expired");
    const core = structuredClone(receipt);
    delete core.receiptDigest;
    if (
      hash(PROGRESSIVE_CANARY_GATE_RECEIPT_SCHEMA, core) !==
      receipt.receiptDigest
    )
      throw new Error("Canary gate receipt digest mismatch");
    const payload = structuredClone(core);
    delete payload.signature;
    if (!(await verifier({ payload, signature: receipt.signature })))
      throw new Error("Canary gate receipt signature rejected");
    return Object.freeze(structuredClone(receipt));
  }

  const authority = Object.freeze({
    planDigest: plan.planDigest,
    tenantId: plan.tenantId,
    pilotId: plan.pilotId,
    async evaluate(input = {}) {
      const report = await evaluateProgressiveCanaryGate({
        ...input,
        plan,
        assignmentAuthority,
      });
      const payload = {
        schema: PROGRESSIVE_CANARY_GATE_RECEIPT_SCHEMA,
        planDigest: plan.planDigest,
        tenantId: plan.tenantId,
        pilotId: plan.pilotId,
        stepId: report.stepId,
        report,
        reportDigest: report.reportDigest,
        authorityId: plan.gateAuthority.id,
        authorityRevision: plan.gateAuthority.revision,
        handlerDigest: plan.gateAuthority.handlerDigest,
      };
      const attestation = await attestor(
        Object.freeze(structuredClone(payload)),
      );
      exact(
        attestation,
        ["issuedAt", "expiresAt", "signature"],
        "gate attestation",
      );
      const core = { ...payload, ...attestation };
      return verifyReceipt(
        Object.freeze({
          ...core,
          receiptDigest: hash(PROGRESSIVE_CANARY_GATE_RECEIPT_SCHEMA, core),
        }),
        { stepId: report.stepId },
      );
    },
    verify: verifyReceipt,
  });
  GATE_AUTHORITIES.add(authority);
  return authority;
}

export function isProgressiveCanaryGateAuthority(value) {
  return GATE_AUTHORITIES.has(value);
}

export function isProgressiveCanaryAssignmentAuthority(value) {
  return AUTHORITIES.has(value);
}

export async function evaluateProgressiveCanaryGate({
  plan: planInput,
  stepId,
  stepStartedAt,
  observedAt,
  observations,
  assignmentAuthority,
} = {}) {
  const plan = verifyPlan(planInput);
  if (!AUTHORITIES.has(assignmentAuthority))
    throw new TypeError("a branded Canary assignment authority is required");
  const step = plan.steps.find(({ id: value }) => value === stepId);
  if (!step) throw new TypeError("progressive Canary step is invalid");
  integer(stepStartedAt, "stepStartedAt");
  integer(observedAt, "observedAt", { min: stepStartedAt });
  if (!Array.isArray(observations) || observations.length > 1_000_000)
    throw new TypeError("Canary observations must be a bounded array");
  const subjects = new Set();
  const normalized = [];
  for (let index = 0; index < observations.length; index += 1) {
    const item = observations[index];
    exact(
      item,
      [
        "subjectDigest",
        "assignmentReceipt",
        "outcomeReceiptDigest",
        "observedAt",
        "baselineSuccess",
        "candidateSuccess",
        "baselineCost",
        "candidateCost",
        "baselineLatencyMs",
        "candidateLatencyMs",
        "baselineToolCalls",
        "candidateToolCalls",
        "securityEvents",
        "permissionEvents",
      ],
      `Canary observation ${index}`,
    );
    const subjectDigest = sha(
      item.subjectDigest,
      `observation ${index} subjectDigest`,
    );
    if (subjects.has(subjectDigest))
      throw new TypeError("Canary observations contain a duplicate subject");
    subjects.add(subjectDigest);
    const assignment = await assignmentAuthority.verify(
      item.assignmentReceipt,
      {
        stepId,
        subjectDigest,
      },
    );
    if (!assignment.assigned)
      throw new Error("non-assigned traffic cannot enter Canary evidence");
    integer(item.observedAt, `observation ${index} observedAt`, {
      min: stepStartedAt,
      max: observedAt,
    });
    if (
      typeof item.baselineSuccess !== "boolean" ||
      typeof item.candidateSuccess !== "boolean"
    )
      throw new TypeError(`observation ${index} paired outcome is invalid`);
    normalized.push(
      Object.freeze({
        subjectDigest,
        assignmentReceiptDigest: assignment.receiptDigest,
        outcomeReceiptDigest: sha(
          item.outcomeReceiptDigest,
          `observation ${index} outcomeReceiptDigest`,
        ),
        observedAt: item.observedAt,
        baselineSuccess: item.baselineSuccess,
        candidateSuccess: item.candidateSuccess,
        baselineCost: finite(
          item.baselineCost,
          `observation ${index} baselineCost`,
          {
            min: 0,
          },
        ),
        candidateCost: finite(
          item.candidateCost,
          `observation ${index} candidateCost`,
          {
            min: 0,
          },
        ),
        baselineLatencyMs: finite(
          item.baselineLatencyMs,
          `observation ${index} baselineLatencyMs`,
          { min: 0 },
        ),
        candidateLatencyMs: finite(
          item.candidateLatencyMs,
          `observation ${index} candidateLatencyMs`,
          { min: 0 },
        ),
        baselineToolCalls: integer(
          item.baselineToolCalls,
          `observation ${index} baselineToolCalls`,
        ),
        candidateToolCalls: integer(
          item.candidateToolCalls,
          `observation ${index} candidateToolCalls`,
        ),
        securityEvents: integer(
          item.securityEvents,
          `observation ${index} securityEvents`,
        ),
        permissionEvents: integer(
          item.permissionEvents,
          `observation ${index} permissionEvents`,
        ),
      }),
    );
  }
  normalized.sort((left, right) =>
    left.subjectDigest.localeCompare(right.subjectDigest),
  );
  const elapsedMs = observedAt - stepStartedAt;
  const failures = [];
  if (normalized.length < step.minSamples) failures.push("min_samples");
  if (elapsedMs < step.minWindowMs) failures.push("min_window");
  if (elapsedMs > step.maxWindowMs) failures.push("max_window");
  const securityEvents = normalized.reduce(
    (sum, item) => sum + item.securityEvents,
    0,
  );
  const permissionEvents = normalized.reduce(
    (sum, item) => sum + item.permissionEvents,
    0,
  );
  if (securityEvents > 0) failures.push("security_events");
  if (permissionEvents > 0) failures.push("permission_events");

  let metrics = null;
  if (normalized.length > 0) {
    const qualityDeltas = normalized.map(
      (item) => Number(item.candidateSuccess) - Number(item.baselineSuccess),
    );
    const seedDigest = hash(PROGRESSIVE_CANARY_GATE_REPORT_SCHEMA, {
      planDigest: plan.planDigest,
      stepId,
      receipts: normalized.map((item) => item.outcomeReceiptDigest),
    });
    const random = randomFrom(seedDigest);
    const bootstrap = Array.from(
      { length: plan.thresholds.bootstrapSamples },
      () =>
        mean(
          Array.from(
            { length: qualityDeltas.length },
            () => qualityDeltas[Math.floor(random() * qualityDeltas.length)],
          ),
        ),
    ).sort((left, right) => left - right);
    const alpha = 1 - plan.thresholds.confidence;
    const baselineLatencies = normalized
      .map((item) => item.baselineLatencyMs)
      .sort((left, right) => left - right);
    const candidateLatencies = normalized
      .map((item) => item.candidateLatencyMs)
      .sort((left, right) => left - right);
    metrics = Object.freeze({
      samples: normalized.length,
      qualityDelta: mean(qualityDeltas),
      qualityDeltaConfidenceInterval: Object.freeze([
        percentile(bootstrap, alpha / 2),
        percentile(bootstrap, 1 - alpha / 2),
      ]),
      meanCostDelta: mean(
        normalized.map((item) => item.candidateCost - item.baselineCost),
      ),
      p95LatencyRatio: ratio(
        percentile(candidateLatencies, 0.95),
        percentile(baselineLatencies, 0.95),
      ),
      p99LatencyRatio: ratio(
        percentile(candidateLatencies, 0.99),
        percentile(baselineLatencies, 0.99),
      ),
      meanToolCallDelta: mean(
        normalized.map(
          (item) => item.candidateToolCalls - item.baselineToolCalls,
        ),
      ),
      securityEvents,
      permissionEvents,
    });
    if (
      metrics.qualityDeltaConfidenceInterval[0] <
      plan.thresholds.minQualityDeltaLowerBound
    )
      failures.push("quality_confidence_lower_bound");
    if (metrics.meanCostDelta > plan.thresholds.maxMeanCostDelta)
      failures.push("mean_cost_delta");
    if (metrics.p95LatencyRatio > plan.thresholds.maxP95LatencyRatio)
      failures.push("p95_latency_ratio");
    if (metrics.p99LatencyRatio > plan.thresholds.maxP99LatencyRatio)
      failures.push("p99_latency_ratio");
    if (metrics.meanToolCallDelta > plan.thresholds.maxMeanToolCallDelta)
      failures.push("mean_tool_call_delta");
  }
  const core = {
    schema: PROGRESSIVE_CANARY_GATE_REPORT_SCHEMA,
    planDigest: plan.planDigest,
    stepId,
    stage: step.stage,
    trafficPercent: step.trafficPercent,
    stepStartedAt,
    observedAt,
    elapsedMs,
    observationRootDigest: hash(
      PROGRESSIVE_CANARY_GATE_REPORT_SCHEMA,
      normalized,
    ),
    metrics,
    failures: Object.freeze([...new Set(failures)]),
    passed: failures.length === 0,
  };
  return Object.freeze({
    ...core,
    reportDigest: hash(PROGRESSIVE_CANARY_GATE_REPORT_SCHEMA, core),
  });
}

export function nextProgressiveCanaryStage({
  plan: planInput,
  currentStepId,
  gateReport,
} = {}) {
  const plan = verifyPlan(planInput);
  const report = verifyGateReport(gateReport, plan);
  const index = plan.steps.findIndex(
    ({ id: value }) => value === currentStepId,
  );
  if (index < 0 || report.stepId !== currentStepId)
    throw new Error("progressive Canary gate report is bound to another step");
  if (!report.passed) throw new Error("progressive Canary gate did not pass");
  if (index === plan.steps.length - 1) {
    return Object.freeze({
      stage: "stable",
      stepId: null,
      priorReportDigest: report.reportDigest,
    });
  }
  const next = plan.steps[index + 1];
  return Object.freeze({
    stage: next.stage,
    stepId: next.id,
    trafficPercent: next.trafficPercent,
    priorReportDigest: report.reportDigest,
  });
}

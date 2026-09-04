import { createHash } from "node:crypto";

export const EVOLUTION_PLAN_SCHEMA = "chainlesschain.evolution-plan/v1";
export const EVOLUTION_TRAIN_RECEIPT_SCHEMA =
  "chainlesschain.evolution-train-stage-receipt/v1";
export const EVOLUTION_TRAIN_STATE_SCHEMA =
  "chainlesschain.evolution-release-train-state/v1";

export const EVOLUTION_RELEASE_TRAIN_STAGES = Object.freeze([
  "wiki-maintain",
  "propose",
  "candidate",
  "eval",
  "review",
  "pilot",
  "promotion",
  "wiki-impact",
]);

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{40}$/u;
const NOISE_FAILURES = new Set([
  "provider",
  "mcp",
  "sandbox",
  "permission",
  "policy",
  "infrastructure",
]);
const TRIGGER_KINDS = new Set([
  "procedure-failure",
  "success-pattern",
  "user-correction",
]);
const STORE_BRAND = new WeakSet();
const TRAIN_BRAND = new WeakSet();

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

function exactKeys(value, keys, name) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(`${name} must be an object`);
  if (canonical(Object.keys(value).sort()) !== canonical([...keys].sort()))
    throw new TypeError(`${name} has unexpected or missing fields`);
}

function text(value, name) {
  if (typeof value !== "string" || value.trim() === "")
    throw new TypeError(`${name} must be a non-empty string`);
  return value;
}

function sha(value, name) {
  if (!DIGEST.test(value ?? ""))
    throw new TypeError(`${name} must be a sha256 digest`);
  return value;
}

function bounded(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0)
    throw new TypeError(`${name} must be a finite non-negative number`);
  return number;
}

function normalizeBudget(value, name = "rootBudget") {
  exactKeys(value, ["tokens", "cost", "timeMs", "turns"], name);
  return Object.freeze({
    tokens: bounded(value.tokens, `${name}.tokens`),
    cost: bounded(value.cost, `${name}.cost`),
    timeMs: bounded(value.timeMs, `${name}.timeMs`),
    turns: bounded(value.turns, `${name}.turns`),
  });
}

function validatePlan(plan) {
  if (!plan || plan.schema !== EVOLUTION_PLAN_SCHEMA)
    throw new TypeError("a canonical EvolutionPlan is required");
  const core = Object.fromEntries(
    Object.entries(plan).filter(([key]) => key !== "planDigest"),
  );
  if (hash(EVOLUTION_PLAN_SCHEMA, core) !== plan.planDigest)
    throw new Error("EvolutionPlan digest mismatch");
  return plan;
}

export function createEvolutionPlan(input = {}) {
  exactKeys(
    input,
    [
      "tenantId",
      "skillId",
      "gitCommit",
      "baselineReleaseDigest",
      "candidateDigest",
      "wikiRevisionDigest",
      "evalSuiteDigest",
      "targetMatrixDigest",
      "riskTier",
      "rolloutPolicyDigest",
      "metricPolicyDigest",
      "permissionManifestDigest",
      "policyDigest",
      "requestedCapabilityDigests",
      "baselineCapabilityDigests",
      "rootBudget",
      "expiresAt",
      "triggerDigest",
    ],
    "EvolutionPlan",
  );
  const requestedCapabilityDigests = input.requestedCapabilityDigests.map(
    (value, index) => sha(value, `requestedCapabilityDigests ${index}`),
  );
  const baselineCapabilityDigests = input.baselineCapabilityDigests.map(
    (value, index) => sha(value, `baselineCapabilityDigests ${index}`),
  );
  if (
    new Set(requestedCapabilityDigests).size !==
      requestedCapabilityDigests.length ||
    new Set(baselineCapabilityDigests).size !== baselineCapabilityDigests.length
  )
    throw new TypeError("EvolutionPlan capability digests must be unique");
  const baseline = new Set(baselineCapabilityDigests);
  if (requestedCapabilityDigests.some((value) => !baseline.has(value)))
    throw new Error("EvolutionPlan cannot increase Skill capabilities");
  const expiresAt = Date.parse(input.expiresAt);
  if (!Number.isFinite(expiresAt))
    throw new TypeError("expiresAt must be an ISO timestamp");
  const gitCommit = text(input.gitCommit, "gitCommit");
  if (!COMMIT.test(gitCommit))
    throw new TypeError("gitCommit must be a full commit SHA");
  const core = {
    schema: EVOLUTION_PLAN_SCHEMA,
    tenantId: text(input.tenantId, "tenantId"),
    skillId: text(input.skillId, "skillId"),
    gitCommit,
    baselineReleaseDigest: sha(
      input.baselineReleaseDigest,
      "baselineReleaseDigest",
    ),
    candidateDigest: sha(input.candidateDigest, "candidateDigest"),
    wikiRevisionDigest: sha(input.wikiRevisionDigest, "wikiRevisionDigest"),
    evalSuiteDigest: sha(input.evalSuiteDigest, "evalSuiteDigest"),
    targetMatrixDigest: sha(input.targetMatrixDigest, "targetMatrixDigest"),
    riskTier: text(input.riskTier, "riskTier"),
    rolloutPolicyDigest: sha(input.rolloutPolicyDigest, "rolloutPolicyDigest"),
    metricPolicyDigest: sha(input.metricPolicyDigest, "metricPolicyDigest"),
    permissionManifestDigest: sha(
      input.permissionManifestDigest,
      "permissionManifestDigest",
    ),
    policyDigest: sha(input.policyDigest, "policyDigest"),
    requestedCapabilityDigests: Object.freeze(requestedCapabilityDigests),
    baselineCapabilityDigests: Object.freeze(baselineCapabilityDigests),
    rootBudget: normalizeBudget(input.rootBudget),
    expiresAt: new Date(expiresAt).toISOString(),
    triggerDigest: sha(input.triggerDigest, "triggerDigest"),
  };
  return Object.freeze({
    ...core,
    planDigest: hash(EVOLUTION_PLAN_SCHEMA, core),
  });
}

export function assessEvolutionCandidateTrigger({
  events,
  minimums = { procedureFailure: 3, successPattern: 3, userCorrection: 1 },
} = {}) {
  exactKeys(
    minimums,
    ["procedureFailure", "successPattern", "userCorrection"],
    "trigger minimums",
  );
  const thresholds = {
    "procedure-failure": bounded(
      minimums.procedureFailure,
      "procedureFailure minimum",
    ),
    "success-pattern": bounded(
      minimums.successPattern,
      "successPattern minimum",
    ),
    "user-correction": bounded(
      minimums.userCorrection,
      "userCorrection minimum",
    ),
  };
  if (
    Object.values(thresholds).some(
      (value) => !Number.isSafeInteger(value) || value < 1,
    )
  )
    throw new TypeError("trigger minimums must be positive safe integers");
  if (!Array.isArray(events) || events.length === 0)
    return Object.freeze({
      eligible: false,
      reason: "needs-evidence",
      skillId: null,
      evidenceDigest: null,
      evidenceIds: Object.freeze([]),
    });
  const ids = new Set();
  const normalized = events.map((event, index) => {
    exactKeys(
      event,
      [
        "eventId",
        "skillId",
        "kind",
        "failureClass",
        "attributionReceiptDigest",
      ],
      `trigger event ${index}`,
    );
    const eventId = text(event.eventId, `trigger event ${index} eventId`);
    if (ids.has(eventId))
      throw new TypeError(`duplicate trigger event: ${eventId}`);
    ids.add(eventId);
    if (!TRIGGER_KINDS.has(event.kind))
      throw new TypeError(`trigger event ${index} kind is invalid`);
    return Object.freeze({
      eventId,
      skillId: text(event.skillId, `trigger event ${index} skillId`),
      kind: event.kind,
      failureClass:
        event.failureClass === null
          ? null
          : text(event.failureClass, `trigger event ${index} failureClass`),
      attributionReceiptDigest: sha(
        event.attributionReceiptDigest,
        `trigger event ${index} attributionReceiptDigest`,
      ),
    });
  });
  const skillIds = new Set(normalized.map((event) => event.skillId));
  if (skillIds.size !== 1)
    return Object.freeze({
      eligible: false,
      reason: "multiple-skills",
      skillId: null,
      evidenceDigest: null,
      evidenceIds: Object.freeze([]),
    });
  const attributable = normalized.filter(
    (event) =>
      event.kind !== "procedure-failure" ||
      !NOISE_FAILURES.has(event.failureClass),
  );
  const acceptedKind = [...TRIGGER_KINDS].find(
    (kind) =>
      attributable.filter((event) => event.kind === kind).length >=
      thresholds[kind],
  );
  if (!acceptedKind)
    return Object.freeze({
      eligible: false,
      reason: "needs-evidence",
      skillId: [...skillIds][0],
      evidenceDigest: null,
      evidenceIds: Object.freeze([]),
    });
  const accepted = attributable
    .filter((event) => event.kind === acceptedKind)
    .sort((left, right) => left.eventId.localeCompare(right.eventId));
  const evidenceCore = accepted.map((event) => ({
    eventId: event.eventId,
    attributionReceiptDigest: event.attributionReceiptDigest,
  }));
  return Object.freeze({
    eligible: true,
    reason: acceptedKind,
    skillId: [...skillIds][0],
    evidenceDigest: hash(EVOLUTION_PLAN_SCHEMA, evidenceCore),
    evidenceIds: Object.freeze(accepted.map((event) => event.eventId)),
  });
}

export function createEvolutionTrainStageReceipt(input = {}) {
  exactKeys(
    input,
    [
      "planDigest",
      "stage",
      "operationKey",
      "inputDigest",
      "outputDigest",
      "accepted",
      "durable",
      "usage",
    ],
    "stage receipt",
  );
  if (!EVOLUTION_RELEASE_TRAIN_STAGES.includes(input.stage))
    throw new TypeError("stage receipt stage is invalid");
  if (input.accepted !== true || input.durable !== true)
    throw new Error("stage receipt must be accepted and durable");
  const core = {
    schema: EVOLUTION_TRAIN_RECEIPT_SCHEMA,
    planDigest: sha(input.planDigest, "stage receipt planDigest"),
    stage: input.stage,
    operationKey: sha(input.operationKey, "stage receipt operationKey"),
    inputDigest: sha(input.inputDigest, "stage receipt inputDigest"),
    outputDigest: sha(input.outputDigest, "stage receipt outputDigest"),
    accepted: true,
    durable: true,
    usage: normalizeBudget(input.usage, "stage receipt usage"),
  };
  return Object.freeze({
    ...core,
    receiptDigest: hash(EVOLUTION_TRAIN_RECEIPT_SCHEMA, core),
  });
}

export function verifyEvolutionTrainStageReceipt(receipt) {
  if (!receipt || receipt.schema !== EVOLUTION_TRAIN_RECEIPT_SCHEMA)
    throw new Error("value is not a canonical release train stage receipt");
  const core = Object.fromEntries(
    Object.entries(receipt).filter(([key]) => key !== "receiptDigest"),
  );
  if (hash(EVOLUTION_TRAIN_RECEIPT_SCHEMA, core) !== receipt.receiptDigest)
    throw new Error("release train stage receipt digest mismatch");
  if (!EVOLUTION_RELEASE_TRAIN_STAGES.includes(receipt.stage))
    throw new Error("release train stage receipt stage is invalid");
  if (receipt.accepted !== true || receipt.durable !== true)
    throw new Error("release train stage receipt is not accepted and durable");
  normalizeBudget(receipt.usage, "release train stage receipt usage");
  return receipt;
}

function validateReceipt(receipt, expected) {
  try {
    verifyEvolutionTrainStageReceipt(receipt);
  } catch (error) {
    throw new Error(`${expected.stage} did not return a canonical receipt`, {
      cause: error,
    });
  }
  for (const field of ["planDigest", "stage", "operationKey", "inputDigest"]) {
    if (receipt[field] !== expected[field])
      throw new Error(`${expected.stage} receipt ${field} mismatch`);
  }
  if (receipt.accepted !== true || receipt.durable !== true)
    throw new Error(`${expected.stage} receipt is not accepted and durable`);
  return receipt;
}

function makeState({ planDigest, receipts }) {
  const usage = receipts.reduce(
    (total, receipt) => ({
      tokens: total.tokens + receipt.usage.tokens,
      cost: total.cost + receipt.usage.cost,
      timeMs: total.timeMs + receipt.usage.timeMs,
      turns: total.turns + receipt.usage.turns,
    }),
    { tokens: 0, cost: 0, timeMs: 0, turns: 0 },
  );
  const core = {
    schema: EVOLUTION_TRAIN_STATE_SCHEMA,
    planDigest,
    stageIndex: receipts.length,
    status:
      receipts.length === EVOLUTION_RELEASE_TRAIN_STAGES.length
        ? "complete"
        : "running",
    receiptDigests: Object.freeze(
      receipts.map((receipt) => receipt.receiptDigest),
    ),
    outputDigests: Object.freeze(
      receipts.map((receipt) => receipt.outputDigest),
    ),
    usage: Object.freeze(usage),
  };
  return Object.freeze({
    ...core,
    stateDigest: hash(EVOLUTION_TRAIN_STATE_SCHEMA, core),
  });
}

export function verifyEvolutionReleaseTrainState(
  state,
  { planDigest = null, allowNull = false } = {},
) {
  if (state === null && allowNull) return null;
  if (state === null) throw new Error("release train state is invalid");
  if (
    !state ||
    state.schema !== EVOLUTION_TRAIN_STATE_SCHEMA ||
    !DIGEST.test(state.planDigest ?? "") ||
    (planDigest !== null && state.planDigest !== planDigest)
  )
    throw new Error("release train state is invalid");
  const core = Object.fromEntries(
    Object.entries(state).filter(([key]) => key !== "stateDigest"),
  );
  if (hash(EVOLUTION_TRAIN_STATE_SCHEMA, core) !== state.stateDigest)
    throw new Error("release train state digest mismatch");
  if (
    !Number.isSafeInteger(state.stageIndex) ||
    state.stageIndex < 0 ||
    state.stageIndex > EVOLUTION_RELEASE_TRAIN_STAGES.length ||
    state.receiptDigests.length !== state.stageIndex ||
    state.outputDigests.length !== state.stageIndex
  )
    throw new Error("release train state progression is invalid");
  normalizeBudget(state.usage, "release train state usage");
  return state;
}

function assertBudget(plan, usage) {
  for (const field of ["tokens", "cost", "timeMs", "turns"]) {
    if (usage[field] > plan.rootBudget[field])
      throw new Error(`EvolutionPlan root budget exceeded: ${field}`);
  }
}

export function createEvolutionReleaseTrainStateStore({
  load,
  loadReceipt,
  compareAndSet,
} = {}) {
  if (
    typeof load !== "function" ||
    typeof loadReceipt !== "function" ||
    typeof compareAndSet !== "function"
  )
    throw new TypeError(
      "release train state store requires load, loadReceipt and compareAndSet",
    );
  const store = Object.freeze({ load, loadReceipt, compareAndSet });
  STORE_BRAND.add(store);
  return store;
}

export function createEvolutionReleaseTrain({
  plan,
  stateStore,
  stages,
  clock = Date.now,
} = {}) {
  validatePlan(plan);
  if (!STORE_BRAND.has(stateStore))
    throw new TypeError("a branded release train state store is required");
  exactKeys(stages, EVOLUTION_RELEASE_TRAIN_STAGES, "release train stages");
  for (const stage of EVOLUTION_RELEASE_TRAIN_STAGES) {
    if (typeof stages[stage] !== "function")
      throw new TypeError(`release train stage ${stage} must be a function`);
  }
  if (typeof clock !== "function")
    throw new TypeError("clock must be a function");

  const train = Object.freeze({
    planDigest: plan.planDigest,
    async run() {
      if (Number(clock()) >= Date.parse(plan.expiresAt))
        throw new Error("EvolutionPlan has expired");
      let state = verifyEvolutionReleaseTrainState(
        await stateStore.load(plan.planDigest),
        { planDigest: plan.planDigest, allowNull: true },
      );
      const receipts = [];
      if (state) {
        for (let index = 0; index < state.stageIndex; index += 1) {
          const receipt = await stateStore.loadReceipt(
            state.receiptDigests[index],
          );
          receipts.push(
            validateReceipt(receipt, {
              planDigest: plan.planDigest,
              stage: EVOLUTION_RELEASE_TRAIN_STAGES[index],
              operationKey: hash(EVOLUTION_PLAN_SCHEMA, {
                planDigest: plan.planDigest,
                stage: EVOLUTION_RELEASE_TRAIN_STAGES[index],
              }),
              inputDigest:
                index === 0
                  ? plan.planDigest
                  : receipts[index - 1].outputDigest,
            }),
          );
        }
        assertBudget(plan, state.usage);
      }
      while (receipts.length < EVOLUTION_RELEASE_TRAIN_STAGES.length) {
        const stage = EVOLUTION_RELEASE_TRAIN_STAGES[receipts.length];
        const operationKey = hash(EVOLUTION_PLAN_SCHEMA, {
          planDigest: plan.planDigest,
          stage,
        });
        const inputDigest =
          receipts.length === 0
            ? plan.planDigest
            : receipts[receipts.length - 1].outputDigest;
        const receipt = validateReceipt(
          await stages[stage](
            Object.freeze({ plan, stage, operationKey, inputDigest }),
          ),
          { planDigest: plan.planDigest, stage, operationKey, inputDigest },
        );
        const nextReceipts = [...receipts, receipt];
        const nextState = makeState({
          planDigest: plan.planDigest,
          receipts: nextReceipts,
        });
        assertBudget(plan, nextState.usage);
        const acknowledgement = await stateStore.compareAndSet({
          planDigest: plan.planDigest,
          expectedStateDigest: state?.stateDigest ?? null,
          receipt,
          nextState,
        });
        if (
          acknowledgement?.durable !== true ||
          acknowledgement?.stateDigest !== nextState.stateDigest ||
          acknowledgement?.receiptDigest !== receipt.receiptDigest
        )
          throw new Error(`${stage} state was not durably acknowledged`);
        receipts.push(receipt);
        state = nextState;
      }
      return Object.freeze({ state, receipts: Object.freeze(receipts) });
    },
  });
  TRAIN_BRAND.add(train);
  return train;
}

export function captureEvolutionReleaseTrain(value) {
  if (!TRAIN_BRAND.has(value)) {
    throw new TypeError("a branded Evolution release train is required");
  }
  return value;
}

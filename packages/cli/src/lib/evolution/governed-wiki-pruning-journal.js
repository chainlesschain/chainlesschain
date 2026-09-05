import { createHash } from "node:crypto";
import { types } from "node:util";
export const GOVERNED_WIKI_PRUNING_PLAN_SCHEMA =
  "chainlesschain.governed-wiki-pruning-plan/v2";
export const GOVERNED_WIKI_PRUNING_POLICY_SCHEMA =
  "chainlesschain.governed-wiki-pruning-policy/v1";

export const WIKI_PRUNING_JOURNAL_SCHEMA =
  "chainlesschain.governed-wiki-pruning-journal/v1";
export const WIKI_PRUNING_JOURNAL_MAX_BYTES = 1024 * 1024;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const PLAN_KEYS = [
  "schema",
  "tenantId",
  "wikiStateDigest",
  "policyDigest",
  "effectiveAt",
  "patternActions",
  "retrievalRemovals",
  "dependencyDispositions",
  "deletions",
  "auditPolicy",
  "planDigest",
];
const JOURNAL_KEYS = [
  "schema",
  "tenantId",
  "revision",
  "previousJournalDigest",
  "plan",
  "phase",
  "operationReceipts",
  "journalDigest",
];

export function pruningCanonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(pruningCanonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${pruningCanonical(value[key])}`)
    .join(",")}}`;
}

export function pruningDigest(domain, value) {
  return `sha256:${createHash("sha256").update(domain).update("\0").update(pruningCanonical(value)).digest("hex")}`;
}

function exact(value, keys, label) {
  if (
    !value ||
    Array.isArray(value) ||
    typeof value !== "object" ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    throw new TypeError(`${label} fields are invalid`);
}

// Capture before any await. Never invoke accessors, proxy traps or toJSON;
// bound traversal as well as the resulting canonical bytes.
function snapshot(input) {
  let nodes = 0;
  let textBytes = 0;
  const seen = new WeakSet();
  const copy = (value, depth = 0) => {
    if (++nodes > 40_000 || depth > 24)
      throw new TypeError("pruning journal graph exceeds its budget");
    if (typeof value === "string") {
      textBytes += Buffer.byteLength(value, "utf8");
      if (textBytes > WIKI_PRUNING_JOURNAL_MAX_BYTES)
        throw new TypeError("pruning journal text exceeds its budget");
      return value;
    }
    if (
      value === null ||
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))
    )
      return value;
    if (typeof value !== "object" || types.isProxy(value) || seen.has(value))
      throw new TypeError("pruning journal requires acyclic plain data");
    const array = Array.isArray(value);
    if (
      ![array ? Array.prototype : Object.prototype, null].includes(
        Object.getPrototypeOf(value),
      )
    )
      throw new TypeError("pruning journal prototype is invalid");
    seen.add(value);
    const properties = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(properties);
    const length = array ? properties.length?.value : 0;
    if (
      array &&
      (!Number.isSafeInteger(length) ||
        length < 0 ||
        length > 8192 ||
        keys.length !== length + 1)
    )
      throw new TypeError("pruning journal array is invalid");
    const result = array ? [] : {};
    for (const key of keys) {
      if (array && key === "length") continue;
      const property = properties[key];
      if (
        typeof key !== "string" ||
        !("value" in property) ||
        !property.enumerable ||
        (array && (!/^(0|[1-9][0-9]*)$/u.test(key) || Number(key) >= length))
      )
        throw new TypeError("pruning journal properties are unsafe");
      textBytes += Buffer.byteLength(key, "utf8");
      Object.defineProperty(result, key, {
        value: copy(property.value, depth + 1),
        enumerable: true,
      });
    }
    seen.delete(value);
    return Object.freeze(result);
  };
  const result = copy(input);
  if (
    Buffer.byteLength(pruningCanonical(result), "utf8") >
    WIKI_PRUNING_JOURNAL_MAX_BYTES
  )
    throw new TypeError("pruning journal exceeds its byte budget");
  return result;
}

export function verifyPruningJournalPlan(input, tenantId) {
  const plan = snapshot(input);
  exact(plan, PLAN_KEYS, "pruning plan");
  if (typeof tenantId !== "string" || !tenantId.trim())
    throw new TypeError("pruning plan tenant is invalid");
  const { planDigest, ...core } = plan;
  if (
    plan.schema !== GOVERNED_WIKI_PRUNING_PLAN_SCHEMA ||
    plan.tenantId !== tenantId ||
    !DIGEST.test(plan.wikiStateDigest) ||
    !DIGEST.test(plan.policyDigest) ||
    !DIGEST.test(planDigest) ||
    typeof plan.effectiveAt !== "string" ||
    !Number.isFinite(Date.parse(plan.effectiveAt)) ||
    pruningDigest(GOVERNED_WIKI_PRUNING_PLAN_SCHEMA, core) !== planDigest
  )
    throw new TypeError("pruning plan binding is invalid");
  for (const key of [
    "patternActions",
    "retrievalRemovals",
    "dependencyDispositions",
    "deletions",
  ])
    if (!Array.isArray(plan[key]) || plan[key].length > 4096)
      throw new TypeError("pruning plan actions are invalid");
  return plan;
}

export function capturePruningData(input) {
  return snapshot(input);
}

export function pruningOperationCalls(plan) {
  const steps = [
    ["dependency-dispositions", plan.dependencyDispositions],
    ["wiki-revision", plan.patternActions],
    ...plan.deletions.map((deletion) => ["crypto-shred", deletion]),
    ["retrieval-projection", { removals: plan.retrievalRemovals }],
  ];
  return steps.map(([operation, payload]) => {
    const request = snapshot({
      tenantId: plan.tenantId,
      planDigest: plan.planDigest,
      wikiStateDigest: plan.wikiStateDigest,
      operation,
      payload,
    });
    return Object.freeze({
      request,
      requestDigest: pruningDigest(
        "chainlesschain.governed-wiki-pruning-operation/v1",
        request,
      ),
    });
  });
}

export function verifyWikiPruningJournal(input, tenantId) {
  const state = snapshot(input);
  exact(state, JOURNAL_KEYS, "pruning journal");
  const { journalDigest, ...core } = state;
  if (
    state.schema !== WIKI_PRUNING_JOURNAL_SCHEMA ||
    state.tenantId !== tenantId ||
    !Number.isSafeInteger(state.revision) ||
    state.revision < 1 ||
    (state.previousJournalDigest !== null &&
      !DIGEST.test(state.previousJournalDigest)) ||
    !DIGEST.test(journalDigest) ||
    pruningDigest(WIKI_PRUNING_JOURNAL_SCHEMA, core) !== journalDigest
  )
    throw new TypeError("pruning journal binding is invalid");
  const plan = verifyPruningJournalPlan(state.plan, tenantId);
  const calls = pruningOperationCalls(plan);
  if (
    !Array.isArray(state.operationReceipts) ||
    state.operationReceipts.length > calls.length ||
    !["prepared", "running", "finalized"].includes(state.phase) ||
    (state.phase === "prepared" && state.operationReceipts.length !== 0) ||
    (state.phase === "running" && state.operationReceipts.length === 0) ||
    (state.phase === "finalized" &&
      state.operationReceipts.length !== calls.length)
  )
    throw new TypeError("pruning journal progress is invalid");
  state.operationReceipts.forEach((receipt, index) => {
    if (
      receipt?.authenticated !== true ||
      receipt.durable !== true ||
      receipt.requestDigest !== calls[index].requestDigest ||
      !DIGEST.test(receipt.receiptDigest)
    )
      throw new TypeError("pruning operation receipt is not exactly bound");
  });
  return state;
}

export function assertPruningJournalTransition(previous, next) {
  if (
    next.revision !== (previous?.revision ?? 0) + 1 ||
    next.previousJournalDigest !== (previous?.journalDigest ?? null)
  )
    throw new Error("pruning journal does not extend its exact predecessor");
  if (!previous || previous.plan.planDigest !== next.plan.planDigest) {
    if (
      (previous && previous.phase !== "finalized") ||
      next.phase !== "prepared"
    )
      throw new Error("pruning journal cannot replace an unfinished plan");
    return;
  }
  if (
    previous.phase === "finalized" ||
    pruningCanonical(previous.plan) !== pruningCanonical(next.plan)
  )
    throw new Error("pruning journal plan cannot be rewritten or restarted");
  const count = previous.operationReceipts.length;
  if (
    pruningCanonical(next.operationReceipts.slice(0, count)) !==
      pruningCanonical(previous.operationReceipts) ||
    (next.phase === "running" && next.operationReceipts.length !== count + 1) ||
    (next.phase === "finalized" && next.operationReceipts.length !== count) ||
    next.phase === "prepared"
  )
    throw new Error(
      "pruning journal must retain receipts and advance one step at a time",
    );
}

export function buildWikiPruningJournal({
  plan: input,
  previous = null,
  receipt = null,
  finalize = false,
}) {
  if (typeof finalize !== "boolean")
    throw new TypeError("pruning journal finalize flag is invalid");
  const capturedPlan = snapshot(input);
  const plan = verifyPruningJournalPlan(capturedPlan, capturedPlan.tenantId);
  const capturedReceipt = receipt === null ? null : snapshot(receipt);
  const prior =
    previous === null
      ? null
      : verifyWikiPruningJournal(previous, plan.tenantId);
  const samePlan = prior?.plan.planDigest === plan.planDigest;
  if (
    (!samePlan && (receipt !== null || finalize)) ||
    (receipt !== null && finalize)
  )
    throw new Error("pruning journal must prepare before progress");
  const core = {
    schema: WIKI_PRUNING_JOURNAL_SCHEMA,
    tenantId: plan.tenantId,
    revision: (prior?.revision ?? 0) + 1,
    previousJournalDigest: prior?.journalDigest ?? null,
    plan,
    phase: !samePlan ? "prepared" : finalize ? "finalized" : "running",
    operationReceipts: !samePlan
      ? []
      : receipt === null
        ? prior.operationReceipts
        : [...prior.operationReceipts, capturedReceipt],
  };
  const next = verifyWikiPruningJournal(
    {
      ...core,
      journalDigest: pruningDigest(WIKI_PRUNING_JOURNAL_SCHEMA, core),
    },
    plan.tenantId,
  );
  assertPruningJournalTransition(prior, next);
  return next;
}

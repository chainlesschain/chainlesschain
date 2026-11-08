import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { raceWithAbort, throwIfAborted } from "./abort-utils.js";

const storage = new AsyncLocalStorage();
export const MODEL_INPUT_PLAN = Symbol("modelInputPlan");
export const MODEL_INPUT_USAGE_CALL = Symbol("modelInputUsageCall");
const safeCount = (value) =>
  Number.isSafeInteger(value) && value >= 0 ? value : null;
const hash = (text) => createHash("sha256").update(text).digest("hex");
const digest = (value) =>
  typeof value === "string" && /^(?:sha256:)?[a-f0-9]{64}$/u.test(value)
    ? value
    : null;
const reasons = new Set([
  "expired",
  "scope_denied",
  "sink_denied",
  "untrusted_system_policy",
  "input_budget",
  "partition_ceiling",
]);
const roles = new Set(["system", "developer", "user", "assistant", "tool"]);
const sourceKinds = new Set([
  "system-policy",
  "tool-schema",
  "skill",
  "task-state",
  "message",
  "tool-evidence",
  "memory",
  "project-rule",
  "artifact-ref",
]);
function sourceDiagnostics(plan) {
  const selected = Array.isArray(plan?.selected) ? plan.selected : [];
  const excluded = Array.isArray(plan?.dropped) ? plan.dropped : [];
  const sourceCount = selected.length + excluded.length;
  const sources = [];
  const add = (item, disposition) => {
    const kind = item?.kind;
    const reason = item?.reason;
    sources.push(
      Object.freeze({
        ordinal: sources.length,
        digest: digest(item?.digest),
        kind: sourceKinds.has(kind) ? kind : "unknown",
        disposition,
        reason:
          disposition === "selected"
            ? null
            : reasons.has(reason)
              ? reason
              : "unknown",
      }),
    );
  };
  for (const item of excluded.slice(0, 512)) add(item, "excluded");
  for (const item of selected.slice(0, 512 - sources.length))
    add(item, "selected");
  return {
    sourceDetailsCovered:
      !!plan && Array.isArray(plan.selected) && Array.isArray(plan.dropped),
    sourceCount,
    sourcesTruncated: sourceCount > sources.length,
    sources: Object.freeze(sources),
  };
}

function combineSignals(...values) {
  const signals = [...new Set(values.filter(Boolean))];
  return signals.length > 1 ? AbortSignal.any(signals) : signals[0];
}

async function emit(fields, signal) {
  const state = storage.getStore();
  if (!state) return;
  signal = combineSignals(state.signal, signal);
  throwIfAborted(signal);
  const event = Object.freeze({
    schema: "chainlesschain.model-input-diagnostic/v1",
    requestId: state.requestId,
    usageCallId: state.usageCallId,
    billingVerified: false,
    ...fields,
  });
  const observed = Promise.resolve().then(() => {
    throwIfAborted(signal);
    return state.observer(event);
  });
  // The observer may ignore cancellation and settle later. Keep its result
  // observed while Stop releases the caller; it cannot resume dispatch.
  observed.catch(() => {});
  await raceWithAbort(observed, signal);
  throwIfAborted(signal);
}

export function withModelInputDiagnostics(options, operation) {
  if (options.onModelInputDiagnostic == null)
    return storage.run(null, operation);
  if (typeof options.onModelInputDiagnostic !== "function")
    throw new TypeError("Model input diagnostic observer must be a function");
  return storage.run(
    {
      observer: options.onModelInputDiagnostic,
      requestId: randomUUID(),
      usageCallId: options[MODEL_INPUT_USAGE_CALL] || null,
      attempts: 0,
      signal: options.signal || null,
    },
    operation,
  );
}

export async function recordLogicalModelInput({
  messages,
  tools,
  plan,
  receipt,
}) {
  if (!storage.getStore()) return { messages, tools };
  const dropped = {};
  for (const item of plan?.dropped || []) {
    const reason = reasons.has(item.reason) ? item.reason : "unknown";
    dropped[reason] = (dropped[reason] || 0) + 1;
  }
  const serialized = JSON.stringify({ messages, tools });
  const snapshot = JSON.parse(serialized);
  messages = snapshot.messages;
  tools = snapshot.tools;
  await emit({
    phase: "logical-input",
    logicalDigest: hash(serialized),
    bytes: Buffer.byteLength(serialized),
    messageCount: messages.length,
    messages: Object.freeze(
      messages.slice(0, 4096).map((message) =>
        Object.freeze({
          role: roles.has(message.role) ? message.role : "unknown",
          digest: hash(JSON.stringify(message)),
          bytes: Buffer.byteLength(JSON.stringify(message)),
        }),
      ),
    ),
    toolCount: tools.length,
    planning: Object.freeze({
      covered: !!plan,
      digest: digest(plan?.digest),
      selectedCount: plan?.selectedItemIds?.length ?? null,
      dropped: Object.freeze(dropped),
      ...sourceDiagnostics(plan),
    }),
    projection: Object.freeze({
      covered: !!receipt,
      manifestDigest: digest(receipt?.manifestDigest),
      projectionDigest: digest(receipt?.projectionDigest),
      rulesetDigest: digest(receipt?.rulesetDigest),
      redactionCount: safeCount(receipt?.redactionCount),
      injectionCount: safeCount(receipt?.injectionCount),
    }),
  });
  return snapshot;
}

// One async scope per physical fetch keeps concurrent calls and retry attempts
// separate. A governed transport can reserialize and records its own final body.
export function withModelInputAttempt(
  init,
  governed,
  operation,
  controls = {},
) {
  const state = storage.getStore();
  if (!state) return operation(init);
  const snapshot = { ...init };
  const signal = combineSignals(state.signal, snapshot.signal, controls.signal);
  return storage.run(
    { ...state, signal, attempt: ++state.attempts },
    async () => {
      await recordModelInputBody(
        snapshot.body,
        governed ? "adapter-body" : "fetch-body",
      );
      throwIfAborted(signal);
      return operation(snapshot);
    },
  );
}

export async function recordModelInputBody(body, stage, controls = {}) {
  if (!storage.getStore()) return;
  await emit(
    {
      phase: "body-prepared",
      attempt: storage.getStore().attempt ?? null,
      stage,
      bodyCovered: typeof body === "string",
      bodyDigest: typeof body === "string" ? hash(body) : null,
      bytes: typeof body === "string" ? Buffer.byteLength(body) : null,
      // This is a prepared request, not a provider acceptance or usage receipt.
      providerAcceptanceVerified: false,
    },
    controls.signal,
  );
}

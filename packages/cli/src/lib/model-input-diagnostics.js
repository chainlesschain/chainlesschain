import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";

const storage = new AsyncLocalStorage();
export const MODEL_INPUT_PLAN = Symbol("modelInputPlan");
export const MODEL_INPUT_USAGE_CALL = Symbol("modelInputUsageCall");
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

async function emit(fields) {
  const state = storage.getStore();
  if (!state) return;
  await state.observer(
    Object.freeze({
      schema: "chainlesschain.model-input-diagnostic/v1",
      requestId: state.requestId,
      usageCallId: state.usageCallId,
      billingVerified: false,
      ...fields,
    }),
  );
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
    }),
    projection: Object.freeze({
      covered: !!receipt,
      manifestDigest: digest(receipt?.manifestDigest),
      projectionDigest: digest(receipt?.projectionDigest),
      rulesetDigest: digest(receipt?.rulesetDigest),
    }),
  });
  return snapshot;
}

// One async scope per physical fetch keeps concurrent calls and retry attempts
// separate. A governed transport can reserialize and records its own final body.
export function withModelInputAttempt(init, governed, operation) {
  const state = storage.getStore();
  if (!state) return operation(init);
  const snapshot = { ...init };
  return storage.run({ ...state, attempt: ++state.attempts }, async () => {
    await recordModelInputBody(
      snapshot.body,
      governed ? "adapter-body" : "fetch-body",
    );
    return operation(snapshot);
  });
}

export async function recordModelInputBody(body, stage) {
  if (!storage.getStore()) return;
  await emit({
    phase: "body-prepared",
    attempt: storage.getStore().attempt ?? null,
    stage,
    bodyCovered: typeof body === "string",
    bodyDigest: typeof body === "string" ? hash(body) : null,
    bytes: typeof body === "string" ? Buffer.byteLength(body) : null,
    // This is a prepared request, not a provider acceptance or usage receipt.
    providerAcceptanceVerified: false,
  });
}

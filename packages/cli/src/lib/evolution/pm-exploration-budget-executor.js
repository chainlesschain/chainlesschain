import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { isProxy } from "node:util/types";

export const PM_EXPLORATION_BUDGET_OUTCOME_SCHEMA =
  "chainlesschain.pm-exploration-budget-outcome/v1";

const TOOL_ID = /^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/u;

function exact(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length ||
    actual.some((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return (
        typeof key !== "string" ||
        !keys.includes(key) ||
        !descriptor ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      );
    })
  ) {
    throw new TypeError(`${label} has unexpected or accessor fields`);
  }
}

function integer(value, label) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new TypeError(`${label} must be a non-negative safe integer`);
  return value;
}

function copyJson(
  value,
  label,
  context = { bytes: 0, nodes: 0, seen: new WeakSet() },
) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    context.bytes += Buffer.byteLength(JSON.stringify(value));
    if (context.bytes > 1024 * 1024)
      throw new TypeError(`${label} exceeds its byte bound`);
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (
    !value ||
    typeof value !== "object" ||
    isProxy(value) ||
    context.seen.has(value) ||
    context.nodes >= 20_000
  ) {
    throw new TypeError(`${label} must be bounded acyclic JSON data`);
  }
  context.seen.add(value);
  context.nodes += 1;
  if (Array.isArray(value)) {
    if (
      Object.getPrototypeOf(value) !== Array.prototype ||
      Reflect.ownKeys(value).length !== value.length + 1
    ) {
      throw new TypeError(`${label} must be a dense plain array`);
    }
    const result = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor))
        throw new TypeError(`${label} contains a hole or accessor`);
      result.push(copyJson(descriptor.value, label, context));
    }
    context.seen.delete(value);
    return result;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype)
    throw new TypeError(`${label} must use the default object prototype`);
  const result = {};
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== "string" ||
      !descriptor ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    ) {
      throw new TypeError(`${label} contains a symbol or accessor`);
    }
    context.bytes += Buffer.byteLength(key);
    if (context.bytes > 1024 * 1024)
      throw new TypeError(`${label} exceeds its byte bound`);
    Object.defineProperty(result, key, {
      value: copyJson(descriptor.value, label, context),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  context.seen.delete(value);
  return result;
}

function traceDigest(reason, failureClass) {
  return `sha256:${createHash("sha256")
    .update(PM_EXPLORATION_BUDGET_OUTCOME_SCHEMA)
    .update("\0")
    .update(reason)
    .update("\0")
    .update(failureClass)
    .digest("hex")}`;
}

function abortReason(signal) {
  const reason = signal?.reason;
  if (reason instanceof PmExplorationBudgetError) return reason.reason;
  return "parent-aborted";
}

export class PmExplorationBudgetError extends Error {
  constructor(reason) {
    super(`PM exploration execution stopped: ${reason}`);
    this.name = "AbortError";
    this.code = "CC_PM_EXPLORATION_BUDGET_EXHAUSTED";
    this.reason = reason;
  }
}

export async function executePmExplorationBudgetedOperation({
  limits,
  operation,
  allowedToolIds = [],
  invokeTool = null,
  parentSignal = null,
  now = performance.now.bind(performance),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  exact(
    limits,
    ["maxTokens", "maxToolCalls", "maxWallClockMs"],
    "PM exploration budget limits",
  );
  const maximum = Object.freeze({
    tokens: integer(limits.maxTokens, "maxTokens"),
    toolCalls: integer(limits.maxToolCalls, "maxToolCalls"),
    wallClockMs: integer(limits.maxWallClockMs, "maxWallClockMs"),
  });
  if (typeof operation !== "function" || isProxy(operation))
    throw new TypeError(
      "PM exploration budget operation must be a direct function",
    );
  if (
    invokeTool !== null &&
    (typeof invokeTool !== "function" || isProxy(invokeTool))
  )
    throw new TypeError("PM exploration tool broker must be a direct function");
  if (!Array.isArray(allowedToolIds) || isProxy(allowedToolIds))
    throw new TypeError("allowedToolIds must be an array");
  const toolIds = new Set();
  for (const toolId of allowedToolIds) {
    if (
      typeof toolId !== "string" ||
      toolId.length > 256 ||
      !TOOL_ID.test(toolId) ||
      toolIds.has(toolId)
    ) {
      throw new TypeError("allowedToolIds contains an invalid or duplicate ID");
    }
    toolIds.add(toolId);
  }
  if (
    (parentSignal !== null && !(parentSignal instanceof AbortSignal)) ||
    typeof now !== "function" ||
    typeof setTimer !== "function" ||
    typeof clearTimer !== "function"
  ) {
    throw new TypeError(
      "PM exploration budget runtime dependencies are invalid",
    );
  }

  const controller = new AbortController();
  const totals = { tokens: 0, toolCalls: 0 };
  let activeTools = 0;
  let closed = false;
  let stoppedReason = null;
  const startedAt = Number(now());
  if (!Number.isFinite(startedAt))
    throw new TypeError("PM exploration monotonic clock is invalid");

  const stop = (reason) => {
    if (stoppedReason === null) stoppedReason = reason;
    if (!controller.signal.aborted)
      controller.abort(new PmExplorationBudgetError(stoppedReason));
  };
  const assertOpen = () => {
    if (closed) throw new Error("PM exploration budget runtime is closed");
    if (controller.signal.aborted)
      throw (
        controller.signal.reason ?? new PmExplorationBudgetError(stoppedReason)
      );
  };

  const runtime = Object.freeze({
    signal: controller.signal,
    recordTokens(count) {
      assertOpen();
      const delta = integer(count, "token count");
      if (!Number.isSafeInteger(totals.tokens + delta))
        throw new TypeError("token total exceeds the safe integer range");
      totals.tokens += delta;
      if (totals.tokens > maximum.tokens) {
        stop("max-tokens");
        throw controller.signal.reason;
      }
      return totals.tokens;
    },
    async invokeTool(toolId, input) {
      assertOpen();
      if (!toolIds.has(toolId)) {
        stop("tool-not-allowed");
        throw controller.signal.reason;
      }
      totals.toolCalls += 1;
      if (totals.toolCalls > maximum.toolCalls) {
        stop("max-tool-calls");
        throw controller.signal.reason;
      }
      if (invokeTool === null) {
        stop("tool-broker-unavailable");
        throw controller.signal.reason;
      }
      const safeInput = copyJson(input, "tool input");
      activeTools += 1;
      try {
        const output = await invokeTool(
          Object.freeze({
            toolId,
            input: safeInput,
            signal: controller.signal,
          }),
        );
        assertOpen();
        return copyJson(output, "tool output");
      } finally {
        activeTools -= 1;
      }
    },
    snapshot() {
      const current = Number(now());
      if (!Number.isFinite(current) || current < startedAt)
        throw new TypeError("PM exploration monotonic clock moved backwards");
      return Object.freeze({
        tokens: totals.tokens,
        toolCalls: totals.toolCalls,
        wallClockMs: Math.ceil(current - startedAt),
      });
    },
  });

  const parentAbort = () => stop(abortReason(parentSignal));
  if (parentSignal) {
    if (parentSignal.aborted) parentAbort();
    else parentSignal.addEventListener("abort", parentAbort, { once: true });
  }
  if (maximum.wallClockMs === 0) stop("max-wall-clock-ms");

  let timer = null;
  const timeout = new Promise((resolve) => {
    timer = setTimer(() => {
      stop("max-wall-clock-ms");
      resolve(Object.freeze({ kind: "stopped" }));
    }, maximum.wallClockMs);
  });
  const attempted = Promise.resolve()
    .then(() => {
      if (controller.signal.aborted)
        throw (
          controller.signal.reason ??
          new PmExplorationBudgetError(stoppedReason)
        );
      return operation(runtime);
    })
    .then(
      (value) => Object.freeze({ kind: "value", value }),
      () => Object.freeze({ kind: "error" }),
    );
  const winner = controller.signal.aborted
    ? Object.freeze({ kind: "stopped" })
    : await Promise.race([attempted, timeout]);

  if (timer !== null) clearTimer(timer);
  if (parentSignal && !parentSignal.aborted)
    parentSignal.removeEventListener("abort", parentAbort);
  let current = Number(now());
  if (!Number.isFinite(current) || current < startedAt) current = startedAt;
  const wallClockMs = Math.ceil(current - startedAt);
  if (wallClockMs > maximum.wallClockMs) stop("max-wall-clock-ms");
  if (activeTools !== 0) stop("unsettled-tools");
  closed = true;

  const metrics = Object.freeze({
    tokens: totals.tokens,
    toolCalls: totals.toolCalls,
    wallClockMs,
  });
  let status;
  let failureClass;
  let reason;
  let value = null;
  if (stoppedReason !== null || winner.kind === "stopped") {
    status = "aborted";
    reason = stoppedReason ?? "parent-aborted";
    failureClass = reason.startsWith("max-") ? "budget" : "sandbox";
  } else if (winner.kind === "error") {
    status = "failed";
    reason = "operation-failed";
    failureClass = "infrastructure";
  } else {
    status = "succeeded";
    reason = "completed";
    failureClass = "none";
    value = winner.value;
  }
  return Object.freeze({
    schema: PM_EXPLORATION_BUDGET_OUTCOME_SCHEMA,
    status,
    failureClass,
    reason,
    metrics,
    traceDigest: traceDigest(reason, failureClass),
    value,
  });
}

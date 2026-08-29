import { randomUUID } from "node:crypto";
import {
  markRuntimeLedgerPersistenceError,
  projectRuntimeTokenUsage,
  projectRuntimeUsageBoundary,
  runtimeUsageEventType,
} from "./runtime-usage-ledger.js";
import { sessionBudgetAdmissionError } from "./session-budget-production-root.js";
import {
  beginSessionBudgetUsage,
  markSessionBudgetUsageUnknown,
  recordSessionBudgetUsage,
  rejectSessionBudgetUsageUnknown,
} from "./session-budget-usage.js";

function asRuntimeLedgerPersistenceError(error) {
  if (error && (typeof error === "object" || typeof error === "function")) {
    try {
      const marked = markRuntimeLedgerPersistenceError(error);
      if (marked?.runtimeLedgerPersistence === true) return marked;
    } catch {
      // Frozen/non-extensible errors are wrapped below.
    }
  }
  const wrapped = new Error("runtime usage ledger persistence failed", {
    cause: error,
  });
  return markRuntimeLedgerPersistenceError(wrapped);
}

async function persistUsageEvent(persist, type, event) {
  try {
    await persist(type, event);
  } catch (error) {
    throw asRuntimeLedgerPersistenceError(error);
  }
}

function unknownUsageEvent({
  callId,
  provider,
  model,
  source,
  operationId,
  code,
}) {
  return projectRuntimeUsageBoundary(
    { callId, provider, model, source, operationId, code },
    "unknown",
  );
}

/**
 * Meter one direct provider call that runs outside agentLoop. The started row is
 * durable before the callback resumes into provider work; every outcome then
 * settles known or unknown without persisting prompts, responses, or errors.
 */
export async function runMeteredDirectModelCall({
  sessionId,
  persist,
  provider,
  model,
  source = "model",
  operationId = undefined,
  sessionBudget = null,
  call,
}) {
  if (typeof call !== "function") {
    throw new TypeError("metered direct model call requires a callback");
  }
  const callId = `direct-${randomUUID()}`;
  if (typeof sessionBudget?.consumeTurn === "function") {
    const admission = sessionBudget.consumeTurn({ id: callId });
    if (!admission?.ok) {
      throw sessionBudgetAdmissionError(
        admission?.reason,
        `direct model call ${source}`,
      );
    }
  }
  if (!sessionId) return call();
  if (typeof persist !== "function") {
    throw new TypeError("metered direct model call requires persistence");
  }
  await persistUsageEvent(
    persist,
    runtimeUsageEventType("started"),
    projectRuntimeUsageBoundary(
      { callId, provider, model, source, operationId },
      "started",
    ),
  );
  beginSessionBudgetUsage(
    sessionBudget,
    { callId, provider, model, source, operationId },
    `direct model call ${source}`,
  );
  let result;
  try {
    result = await call();
  } catch (error) {
    const unknown = unknownUsageEvent({
      callId,
      provider,
      model,
      source,
      operationId,
      code: "provider_call_failed",
    });
    await persistUsageEvent(persist, runtimeUsageEventType("unknown"), unknown);
    markSessionBudgetUsageUnknown(sessionBudget, unknown);
    throw error;
  }
  if (result?.usage && typeof result.usage === "object") {
    let event;
    try {
      event = projectRuntimeTokenUsage({
        callId,
        provider,
        model,
        source,
        operationId,
        usage: result.usage,
      });
    } catch {
      const unknown = unknownUsageEvent({
        callId,
        provider,
        model,
        source,
        operationId,
        code: "provider_usage_missing",
      });
      await persistUsageEvent(
        persist,
        runtimeUsageEventType("unknown"),
        unknown,
      );
      if (markSessionBudgetUsageUnknown(sessionBudget, unknown)) {
        rejectSessionBudgetUsageUnknown(unknown, `direct model call ${source}`);
      }
      return result;
    }
    await persistUsageEvent(persist, "token_usage", event);
    recordSessionBudgetUsage(
      sessionBudget,
      event,
      `direct model call ${source} usage settlement`,
    );
  } else {
    const unknown = unknownUsageEvent({
      callId,
      provider,
      model,
      source,
      operationId,
      code: "provider_usage_missing",
    });
    await persistUsageEvent(persist, runtimeUsageEventType("unknown"), unknown);
    if (markSessionBudgetUsageUnknown(sessionBudget, unknown)) {
      rejectSessionBudgetUsageUnknown(unknown, `direct model call ${source}`);
    }
  }
  return result;
}

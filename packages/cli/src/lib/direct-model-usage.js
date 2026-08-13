import { randomUUID } from "node:crypto";
import {
  markRuntimeLedgerPersistenceError,
  projectRuntimeTokenUsage,
  projectRuntimeUsageBoundary,
  runtimeUsageEventType,
} from "./runtime-usage-ledger.js";

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

function unknownUsageEvent({ callId, provider, model, source, code }) {
  return projectRuntimeUsageBoundary(
    { callId, provider, model, source, code },
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
  call,
}) {
  if (typeof call !== "function") {
    throw new TypeError("metered direct model call requires a callback");
  }
  if (!sessionId) return call();
  if (typeof persist !== "function") {
    throw new TypeError("metered direct model call requires persistence");
  }
  const callId = `direct-${randomUUID()}`;
  await persistUsageEvent(
    persist,
    runtimeUsageEventType("started"),
    projectRuntimeUsageBoundary({ callId, provider, model, source }, "started"),
  );
  let result;
  try {
    result = await call();
  } catch (error) {
    await persistUsageEvent(
      persist,
      runtimeUsageEventType("unknown"),
      unknownUsageEvent({
        callId,
        provider,
        model,
        source,
        code: "provider_call_failed",
      }),
    );
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
        usage: result.usage,
      });
    } catch {
      await persistUsageEvent(
        persist,
        runtimeUsageEventType("unknown"),
        unknownUsageEvent({
          callId,
          provider,
          model,
          source,
          code: "provider_usage_missing",
        }),
      );
      return result;
    }
    await persistUsageEvent(persist, "token_usage", event);
  } else {
    await persistUsageEvent(
      persist,
      runtimeUsageEventType("unknown"),
      unknownUsageEvent({
        callId,
        provider,
        model,
        source,
        code: "provider_usage_missing",
      }),
    );
  }
  return result;
}

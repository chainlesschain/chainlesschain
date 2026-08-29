"use strict";

/**
 * CommonJS compatibility helpers for canonical settings Hook events.
 *
 * This module deliberately contains no Hook executor. Legacy CJS consumers
 * delegate to settings-hook-events.js, where settings definitions are compiled
 * by the Hooks v2 adapter and scheduled by the one canonical runtime.
 */

const { buildHookEnvelope } = require("./hook-event-bus.cjs");
const hookEventLog = require("./hook-event-log.cjs");

function withDeliveryId(event, payload, { sessionId, traceId, parentId } = {}) {
  const envelope = buildHookEnvelope({
    eventType: event,
    data: payload,
    sessionId: sessionId || payload.session_id || null,
    traceId: traceId || null,
    parentId: parentId || null,
  });
  if (hookEventLog.isHookEventLogEnabled()) {
    try {
      hookEventLog.appendHookEvent(envelope);
    } catch {
      // The event replay log is optional. Mandatory execution audit is handled
      // separately by the canonical Hook audit store.
    }
  }
  return {
    ...payload,
    event_id: envelope.event_id,
    ...(envelope.trace_id ? { trace_id: envelope.trace_id } : {}),
    ...(envelope.parent_id ? { parent_id: envelope.parent_id } : {}),
  };
}

function partitionAsyncHooks(hooks) {
  const sync = [];
  const asyncHooks = [];
  for (const hook of hooks || []) {
    if (hook?.async === true) asyncHooks.push(hook);
    else sync.push(hook);
  }
  return { sync, async: asyncHooks };
}

function aggregateContext(results) {
  const parts = [];
  for (const result of results || []) {
    if (result?.additionalContext) {
      parts.push(String(result.additionalContext));
    } else if (result?.exitCode === 0 && result.stdout) {
      const text = String(result.stdout).trim();
      if (text && text[0] !== "{") parts.push(text);
    }
  }
  return parts.length > 0 ? parts.join("\n") : null;
}

async function canonicalCall(name, args) {
  const canonical = await import("./settings-hook-events.js");
  return canonical[name](...args);
}

module.exports = {
  withDeliveryId,
  aggregateContext,
  partitionAsyncHooks,
  // Async definitions are already scheduled exactly once by Hooks v2.
  dispatchAsyncHooks: () => [],
  runUserPromptSubmitHooks: (...args) =>
    canonicalCall("runUserPromptSubmitHooks", args),
  runSessionStartHooks: (...args) =>
    canonicalCall("runSessionStartHooks", args),
  runCwdChangedHooks: (...args) => canonicalCall("runCwdChangedHooks", args),
  runWorktreeCreateHooks: (...args) =>
    canonicalCall("runWorktreeCreateHooks", args),
  runWorktreeRemoveHooks: (...args) =>
    canonicalCall("runWorktreeRemoveHooks", args),
  runInstructionsLoadedHooks: (...args) =>
    canonicalCall("runInstructionsLoadedHooks", args),
  runObserveHooks: (...args) => canonicalCall("runObserveHooks", args),
};

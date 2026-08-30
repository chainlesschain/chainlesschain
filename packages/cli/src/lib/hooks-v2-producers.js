/**
 * Canonical bridge from real runtime producers to Hooks v2. Decision-capable
 * callers await and enforce the result; observation-only callers may emit in
 * the background.
 *
 * A headless host may subscribe to a particular session to project a small,
 * machine-readable lifecycle stream.  The projection deliberately excludes
 * hook command lines, input, output, and error text: hooks often handle
 * credentials, paths, and user content.  The observer is diagnostic only and
 * is never allowed to affect a hook decision.
 */
import { collectCanonicalAdapterHooks } from "./hook-runtime-adapters.js";
import path from "node:path";
import { runWithHostHooksV2Workspace } from "./hooks-v2-workspace-context.js";

const sessionObservers = new Map();

function safeId(value, max = 160) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function observerSetFor(context = {}) {
  const sessionId = safeId(context.session_id ?? context.sessionId);
  return sessionId ? sessionObservers.get(sessionId) || null : null;
}

function projectLifecycle(eventName, context = {}, phase, outcome = null) {
  const projected = {
    type: phase,
    schema_version: 1,
    hook_event: safeId(eventName, 96) || "unknown",
  };
  const sessionId = safeId(context.session_id ?? context.sessionId);
  const traceId = safeId(context.trace_id ?? context.traceId);
  const parentId = safeId(context.parent_id ?? context.parentId);
  const turnId = safeId(context.turn_id ?? context.turnId);
  const toolUseId = safeId(context.tool_use_id ?? context.toolUseId);
  if (sessionId) projected.session_id = sessionId;
  if (traceId) projected.trace_id = traceId;
  if (parentId) projected.parent_id = parentId;
  if (turnId) projected.turn_id = turnId;
  if (toolUseId) projected.tool_use_id = toolUseId;
  if (!outcome || typeof outcome !== "object") return projected;

  if (phase === "hook_progress") {
    projected.hook_id = safeId(outcome.hookId, 160) || null;
    projected.status = safeId(outcome.status, 32) || "unknown";
    projected.decision = safeId(outcome.decision, 32) || "continue";
    if (Number.isFinite(outcome.durationMs)) {
      projected.duration_ms = Math.max(0, Math.floor(outcome.durationMs));
    }
    return projected;
  }

  projected.decision = safeId(outcome.decision, 32) || "continue";
  projected.blocked = outcome.blocked === true;
  projected.requires_approval = outcome.requiresApproval === true;
  projected.hook_count = Array.isArray(outcome.results)
    ? outcome.results.length
    : 0;
  projected.error = outcome.error ? "hook_runtime_error" : undefined;
  return projected;
}

function notifyObservers(eventName, context, phase, outcome = null) {
  const observers = observerSetFor(context);
  if (!observers || observers.size === 0) return;
  const event = projectLifecycle(eventName, context, phase, outcome);
  for (const observer of observers) {
    try {
      observer(event);
    } catch {
      // Observability must never delay or weaken the hook boundary.
    }
  }
}

/** Register a diagnostic observer for a single canonical session id. */
export function addHooksV2EventObserver(sessionId, observer) {
  const key = safeId(sessionId);
  if (!key || typeof observer !== "function") return () => {};
  let observers = sessionObservers.get(key);
  if (!observers) {
    observers = new Set();
    sessionObservers.set(key, observers);
  }
  observers.add(observer);
  return () => {
    observers.delete(observer);
    if (observers.size === 0) sessionObservers.delete(key);
  };
}

async function dispatchHooksV2Event(eventName, context, options) {
  try {
    const { default: runtime } = await import("./hooks-v2-runtime.js");
    if (!runtime || typeof runtime.executeHooks !== "function") {
      return {
        success: options.failClosed !== true,
        blocked: options.failClosed === true,
        decision: options.failClosed === true ? "block" : "continue",
        unavailable: true,
        results: [],
      };
    }
    const adapterHooks = collectCanonicalAdapterHooks(eventName, context, {
      settingsHooks: options.settingsHooks,
      hookDb: options.hookDb,
      matchTarget:
        options.matchTarget || context.tool_name || context.tool || "",
      cwd: options.cwd || context.cwd || process.cwd(),
      settingsFailureMode:
        options.failClosed === true ? "fail-closed" : "ignore",
    });
    const runtimeOptions = {
      ...options,
      additionalHooks: [
        ...(Array.isArray(options.additionalHooks)
          ? options.additionalHooks
          : []),
        ...adapterHooks,
      ],
      auditRequired:
        options.auditRequired == null
          ? process.env.NODE_ENV !== "test"
          : options.auditRequired,
    };
    delete runtimeOptions.settingsHooks;
    delete runtimeOptions.hookDb;
    delete runtimeOptions.matchTarget;
    delete runtimeOptions.cwd;
    const workspaceRoot = path.resolve(
      options.workspaceRoot || options.cwd || process.cwd(),
    );
    delete runtimeOptions.workspaceRoot;
    const registeredHooks = runtime.hooks?.get?.(eventName);
    const hasCandidateHooks =
      (Array.isArray(registeredHooks) && registeredHooks.length > 0) ||
      runtimeOptions.additionalHooks.length > 0;
    if (!hasCandidateHooks) {
      return await runtime.executeHooks(eventName, context, runtimeOptions);
    }
    return await runWithHostHooksV2Workspace(workspaceRoot, () =>
      runtime.executeHooks(eventName, context, runtimeOptions),
    );
  } catch (error) {
    const failClosed = options.failClosed === true;
    return {
      success: !failClosed,
      blocked: failClosed,
      decision: failClosed ? "block" : "continue",
      error: error?.message || String(error),
      errorCode: error?.code || null,
      results: [],
    };
  }
}

function reportOutcome(eventName, context, outcome) {
  for (const result of Array.isArray(outcome?.results) ? outcome.results : []) {
    notifyObservers(eventName, context, "hook_progress", result);
  }
  notifyObservers(eventName, context, "hook_response", outcome);
  return outcome;
}

export function emitHooksV2Event(eventName, context = {}, options = {}) {
  notifyObservers(eventName, context, "hook_started");
  void dispatchHooksV2Event(eventName, context, options).then((outcome) =>
    reportOutcome(eventName, context, outcome),
  );
}

/**
 * Decision-capable producer bridge. Callers at a real gate (PreToolUse,
 * Setup, prompt expansion) await this result; observer producers can keep
 * using emitHooksV2Event().
 */
export async function executeHooksV2Event(
  eventName,
  context = {},
  options = {},
) {
  notifyObservers(eventName, context, "hook_started");
  return reportOutcome(
    eventName,
    context,
    await dispatchHooksV2Event(eventName, context, options),
  );
}

export function resolvePromptExpansion(prompt, outcome = {}) {
  const base = String(prompt ?? "");
  const updates = [];
  const context = [];
  for (const record of Array.isArray(outcome.results) ? outcome.results : []) {
    if (record?.status !== "success" || !record.result) continue;
    if (typeof record.result.updatedPrompt === "string") {
      updates.push(record.result.updatedPrompt);
    }
    if (typeof record.result.additionalContext === "string") {
      const value = record.result.additionalContext.trim();
      if (value) context.push(value);
    }
  }
  const distinctUpdates = [...new Set(updates)];
  if (distinctUpdates.length > 1) {
    return {
      prompt: base,
      blocked: true,
      reason: "conflicting UserPromptExpansion updatedPrompt results",
    };
  }
  let resolved = distinctUpdates[0] ?? base;
  if (context.length > 0) {
    resolved += `\n\n[hook context]\n${context.join("\n")}`;
  }
  return {
    prompt: resolved,
    blocked: outcome.blocked === true || outcome.decision === "block",
    reason:
      outcome.blockingResult?.reason || outcome.blockingResult?.message || null,
  };
}

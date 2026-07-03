"use strict";

/**
 * settings-hook-events — fire non-tool `.claude/settings.json` hooks
 * (UserPromptSubmit, SessionStart, and generic observe events) that live
 * outside the executeTool seam.
 *
 * Reuses the same loader (collectHooks) + JSON protocol (hook-runner). Tool
 * hooks (PreToolUse/PostToolUse) are dispatched inline in agent-core; this is
 * the prompt/session lifecycle half. DB-backed session hooks (session-hooks.js
 * `fireUserPromptSubmit`) stay separate + observe-only; these settings hooks
 * are decision-capable (block) and can inject `additionalContext`.
 *
 * A hook's non-block stdout becomes context to inject: a JSON
 * `{ "additionalContext": "..." }` field, or — for convenience — plain
 * (non-JSON) stdout text. Exit 2 / `{decision:block}` aborts the turn.
 */

const { collectHooks } = require("./settings-hooks.cjs");
const { runHooks } = require("./hook-runner.cjs");

/**
 * Split collected hooks into the blocking (sync) set and the fire-and-forget
 * (`async: true`) set. Only NON-decision events should dispatch async hooks —
 * an async hook can't gate a turn it no longer blocks, so a UserPromptSubmit
 * hook that must be able to `block` should stay sync. The caller decides which
 * events are eligible; this is just the partition.
 * @returns {{ sync: Array, async: Array }}
 */
function partitionAsyncHooks(hooks) {
  const sync = [];
  const asyncHooks = [];
  for (const h of hooks || []) {
    if (h && h.async === true) asyncHooks.push(h);
    else sync.push(h);
  }
  return { sync, async: asyncHooks };
}

/** Join the context emitted by the hooks that ran (additionalContext / plain stdout). */
function aggregateContext(results) {
  const parts = [];
  for (const r of results || []) {
    if (r.additionalContext) {
      parts.push(String(r.additionalContext));
    } else if (r.exitCode === 0 && r.stdout) {
      const s = String(r.stdout).trim();
      if (s && s[0] !== "{") parts.push(s); // plain stdout = context to inject
    }
  }
  return parts.length > 0 ? parts.join("\n") : null;
}

/**
 * UserPromptSubmit settings hooks. A `block`/`ask` decision aborts the turn;
 * otherwise any emitted context is returned for the caller to inject.
 * @returns {{ blocked:boolean, reason?:string, hook?:string, additionalContext:string|null }}
 */
function runUserPromptSubmitHooks(
  settingsHooks,
  { prompt, cwd, sessionId } = {},
) {
  if (!settingsHooks) return { blocked: false, additionalContext: null };
  const matched = collectHooks(settingsHooks, "UserPromptSubmit", "");
  if (matched.length === 0) return { blocked: false, additionalContext: null };
  const payload = {
    hook_event_name: "UserPromptSubmit",
    prompt: String(prompt || ""),
    cwd,
    session_id: sessionId || null,
  };
  const outcome = runHooks(matched, payload, {
    cwd,
    event: "UserPromptSubmit",
  });
  if (outcome.decision === "block" || outcome.decision === "ask") {
    return {
      blocked: true,
      reason: outcome.reason,
      hook: outcome.hook,
      additionalContext: null,
    };
  }
  return {
    blocked: false,
    additionalContext: aggregateContext(outcome.results),
  };
}

/**
 * SessionStart settings hooks (observe + context injection). The `source`
 * (startup / resume / clear) is the matcher target.
 * @returns {{ additionalContext:string|null }}
 */
function runSessionStartHooks(settingsHooks, { source, cwd, sessionId } = {}) {
  if (!settingsHooks) return { additionalContext: null };
  const matched = collectHooks(settingsHooks, "SessionStart", source || "");
  if (matched.length === 0) return { additionalContext: null };
  const payload = {
    hook_event_name: "SessionStart",
    source: source || "startup",
    cwd,
    session_id: sessionId || null,
  };
  const outcome = runHooks(matched, payload, { cwd, event: "SessionStart" });
  return { additionalContext: aggregateContext(outcome.results) };
}

/**
 * Generic observe-only fire (SessionEnd / Stop / PreCompact). Returns the raw
 * runHooks outcome so callers can read a block reason; never gates flow here.
 */
function runObserveHooks(
  settingsHooks,
  event,
  payload = {},
  { cwd, matchTarget } = {},
) {
  if (!settingsHooks) return { decision: "continue", results: [] };
  const matched = collectHooks(settingsHooks, event, matchTarget || "");
  if (matched.length === 0) return { decision: "continue", results: [] };
  return runHooks(
    matched,
    { hook_event_name: event, cwd, ...payload },
    { cwd, event },
  );
}

module.exports = {
  runUserPromptSubmitHooks,
  runSessionStartHooks,
  runObserveHooks,
  aggregateContext,
  partitionAsyncHooks,
};

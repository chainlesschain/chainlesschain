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
const { buildHookEnvelope } = require("./hook-event-bus.cjs");
const hookEventLog = require("./hook-event-log.cjs");

/**
 * Publish lifecycle events to Hooks v2 without making the legacy settings hook
 * path depend on the ESM runtime. Payloads are deliberately reduced before
 * publication: prompt text and file contents must never become durable hook
 * context merely because a lifecycle producer fired.
 */
function publishHooksV2Event(event, payload = {}) {
  const safe = { ...payload };
  delete safe.prompt;
  delete safe.content;
  delete safe.files;
  void import("./hooks-v2-producers.js")
    .then(({ emitHooksV2Event }) => {
      emitHooksV2Event(event, safe);
    })
    .catch(() => {
      // Optional producer bridge; legacy settings hooks remain authoritative.
    });
}

/**
 * Stamp a unified-bus delivery id (event_id) onto a hook payload (P2 event bus).
 * Additive — a hook that ignores it is unaffected; a hook that reads it gets a
 * stable per-delivery id for correlation / `cc hook replay`. traceId/parentId
 * are threaded when the caller provides them (else null).
 *
 * When `CC_HOOK_EVENT_LOG` is enabled, the FULL envelope is best-effort recorded
 * to the hash-chained hook event log so `cc hook replay <event-id>` has a real
 * source. Recording is opt-in and never throws, so the default firing path is
 * byte-for-byte unchanged.
 */
function withDeliveryId(event, payload, { sessionId, traceId, parentId } = {}) {
  const env = buildHookEnvelope({
    eventType: event,
    data: payload,
    sessionId: sessionId || payload.session_id || null,
    traceId: traceId || null,
    parentId: parentId || null,
  });
  if (hookEventLog.isHookEventLogEnabled()) {
    try {
      hookEventLog.appendHookEvent(env);
    } catch {
      /* best-effort — recording must not break the turn */
    }
  }
  // trace_id/parent_id are stamped onto the DELIVERED payload only when the
  // caller actually threaded them (agent-core context) — absent they are
  // omitted entirely, keeping every legacy payload byte-identical.
  return {
    ...payload,
    event_id: env.event_id,
    ...(env.trace_id ? { trace_id: env.trace_id } : {}),
    ...(env.parent_id ? { parent_id: env.parent_id } : {}),
  };
}

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
 *
 * `async: true` hooks are EXCLUDED from this blocking run — they can't gate a
 * turn they no longer block, so a fire-and-forget hook is dispatched separately
 * (see dispatchAsyncHooks). This keeps the sync/decision path unchanged while a
 * long-running check runs alongside the turn.
 * @returns {{ blocked:boolean, reason?:string, hook?:string, additionalContext:string|null }}
 */
function runUserPromptSubmitHooks(
  settingsHooks,
  { prompt, cwd, sessionId } = {},
) {
  publishHooksV2Event("UserPromptSubmit", {
    cwd: cwd || null,
    session_id: sessionId || null,
  });
  if (!settingsHooks) return { blocked: false, additionalContext: null };
  const matched = collectHooks(settingsHooks, "UserPromptSubmit", "");
  if (matched.length === 0) return { blocked: false, additionalContext: null };
  const { sync } = partitionAsyncHooks(matched);
  if (sync.length === 0) return { blocked: false, additionalContext: null };
  const payload = withDeliveryId(
    "UserPromptSubmit",
    {
      hook_event_name: "UserPromptSubmit",
      prompt: String(prompt || ""),
      cwd,
      session_id: sessionId || null,
    },
    { sessionId },
  );
  const outcome = runHooks(sync, payload, {
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
 * Dispatch the `async: true` hooks for an event fire-and-forget onto the given
 * supervisor (see async-hook-supervisor). Sync hooks are ignored here — they run
 * on the blocking path. No-op (returns []) without a supervisor or async hooks,
 * so callers can wire it unconditionally.
 *
 * @param {object} settingsHooks   merged hooks block
 * @param {string} event           UserPromptSubmit / PostToolUse / Stop / …
 * @param {object} payload         extra fields merged into the hook stdin JSON
 * @param {object} opts            { cwd, matchTarget, supervisor }
 * @returns {Array<{command:string, dispatched:boolean, reason?:string}>}
 */
function dispatchAsyncHooks(settingsHooks, event, payload = {}, opts = {}) {
  const supervisor = opts.supervisor;
  if (!settingsHooks || !supervisor) return [];
  const matched = collectHooks(settingsHooks, event, opts.matchTarget || "");
  if (matched.length === 0) return [];
  const { async: asyncHooks } = partitionAsyncHooks(matched);
  if (asyncHooks.length === 0) return [];
  return supervisor.dispatch(
    asyncHooks,
    { hook_event_name: event, cwd: opts.cwd, ...payload },
    { cwd: opts.cwd, broker: opts.broker },
  );
}

/**
 * SessionStart settings hooks (observe + context injection). The `source`
 * (startup / resume / clear) is the matcher target.
 * @returns {{ additionalContext:string|null }}
 */
function runSessionStartHooks(settingsHooks, { source, cwd, sessionId } = {}) {
  publishHooksV2Event("SessionStart", {
    source: source || "startup",
    cwd: cwd || null,
    session_id: sessionId || null,
  });
  if (!settingsHooks) return { additionalContext: null };
  const matched = collectHooks(settingsHooks, "SessionStart", source || "");
  if (matched.length === 0) return { additionalContext: null };
  const payload = withDeliveryId(
    "SessionStart",
    {
      hook_event_name: "SessionStart",
      source: source || "startup",
      cwd,
      session_id: sessionId || null,
    },
    { sessionId },
  );
  const outcome = runHooks(matched, payload, { cwd, event: "SessionStart" });
  return { additionalContext: aggregateContext(outcome.results) };
}

/**
 * CwdChanged settings hooks (observe + context injection). Fired when the
 * working directory changes mid-session (`/cd`) — a distinct lifecycle event
 * (Claude-Code-parity extension) automation can react to (re-audit trust of the
 * new dir, reload a per-dir tool config, …). Observe-only: a cwd change never
 * gates flow, so any `block` decision is ignored and only emitted context is
 * returned. No-op (byte-unchanged) without a registered CwdChanged hook.
 * @returns {{ additionalContext:string|null }}
 */
function runCwdChangedHooks(
  settingsHooks,
  { oldCwd, newCwd, cwd, sessionId } = {},
) {
  publishHooksV2Event("CwdChanged", {
    old_cwd: oldCwd || null,
    cwd: newCwd || cwd || null,
    session_id: sessionId || null,
  });
  if (!settingsHooks) return { additionalContext: null };
  const matched = collectHooks(settingsHooks, "CwdChanged", newCwd || "");
  const { sync } = partitionAsyncHooks(matched);
  if (sync.length === 0) return { additionalContext: null };
  const payload = withDeliveryId(
    "CwdChanged",
    {
      hook_event_name: "CwdChanged",
      old_cwd: oldCwd || null,
      cwd: newCwd || cwd || null,
      session_id: sessionId || null,
    },
    { sessionId },
  );
  const outcome = runHooks(sync, payload, {
    cwd: newCwd || cwd,
    event: "CwdChanged",
  });
  return { additionalContext: aggregateContext(outcome.results) };
}

/**
 * WorktreeCreate settings hooks (observe + context injection). Fired right after
 * `cc agent --worktree` carves a fresh isolated git worktree — a hook can react
 * (register the worktree with an external tracker, seed per-branch tooling,
 * warm a build cache). The matcher target is the branch name, so a regex matcher
 * can scope to a branch pattern. Observe-only: worktree setup already succeeded,
 * so a `block` decision is ignored and only emitted context is returned. No-op
 * (byte-unchanged) without a registered WorktreeCreate hook.
 * @returns {{ additionalContext:string|null }}
 */
function runWorktreeCreateHooks(
  settingsHooks,
  { worktreePath, branch, baseSha, cwd, sessionId } = {},
) {
  publishHooksV2Event("WorktreeCreate", {
    worktree_path: worktreePath || null,
    branch: branch || null,
    base_sha: baseSha || null,
    cwd: cwd || worktreePath || null,
    session_id: sessionId || null,
  });
  if (!settingsHooks) return { additionalContext: null };
  const matched = collectHooks(settingsHooks, "WorktreeCreate", branch || "");
  const { sync } = partitionAsyncHooks(matched);
  if (sync.length === 0) return { additionalContext: null };
  const payload = withDeliveryId(
    "WorktreeCreate",
    {
      hook_event_name: "WorktreeCreate",
      worktree_path: worktreePath || null,
      branch: branch || null,
      base_sha: baseSha || null,
      cwd: cwd || worktreePath || null,
      session_id: sessionId || null,
    },
    { sessionId },
  );
  const outcome = runHooks(sync, payload, {
    cwd: cwd || worktreePath,
    event: "WorktreeCreate",
  });
  return { additionalContext: aggregateContext(outcome.results) };
}

/**
 * WorktreeRemove settings hooks (observe + context injection). Fired when a
 * `cc agent --worktree` session finishes and its worktree is torn down (or when
 * a `keep` decision leaves it in place — `removed` distinguishes the two) — a
 * hook can react (unregister the worktree, prune a per-branch cache, notify CI).
 * Matcher target is the branch name. Observe-only: teardown already happened, so
 * a `block` decision is ignored and only emitted context is returned. No-op
 * (byte-unchanged) without a registered WorktreeRemove hook.
 * @returns {{ additionalContext:string|null }}
 */
function runWorktreeRemoveHooks(
  settingsHooks,
  { worktreePath, branch, removed, reason, cwd, sessionId } = {},
) {
  publishHooksV2Event("WorktreeRemove", {
    worktree_path: worktreePath || null,
    branch: branch || null,
    removed: removed === true,
    reason: reason || null,
    cwd: cwd || worktreePath || null,
    session_id: sessionId || null,
  });
  if (!settingsHooks) return { additionalContext: null };
  const matched = collectHooks(settingsHooks, "WorktreeRemove", branch || "");
  const { sync } = partitionAsyncHooks(matched);
  if (sync.length === 0) return { additionalContext: null };
  const payload = withDeliveryId(
    "WorktreeRemove",
    {
      hook_event_name: "WorktreeRemove",
      worktree_path: worktreePath || null,
      branch: branch || null,
      removed: removed === true,
      reason: reason || null,
      cwd: cwd || worktreePath || null,
      session_id: sessionId || null,
    },
    { sessionId },
  );
  const outcome = runHooks(sync, payload, {
    cwd: cwd || worktreePath,
    event: "WorktreeRemove",
  });
  return { additionalContext: aggregateContext(outcome.results) };
}

/**
 * InstructionsLoaded settings hooks (observe + context injection). Fired once at
 * session start after the project-instruction block (cc.md / CLAUDE.md / AGENTS.md
 * hierarchy + `.claude/rules/*`) is composed into the system prompt — a hook can
 * react to WHICH instruction files are authoritative this session (audit them,
 * warn on an unexpected local override, load a companion tool config). The
 * caller passes the EXACT loaded set; this producer trims each entry to
 * `{path, scope, truncated}` (never the file CONTENT — a hook that wants content
 * reads the path). Observe-only: instructions are already loaded, so a `block`
 * decision is ignored and only emitted context is returned. No-op (byte-unchanged)
 * without a registered InstructionsLoaded hook.
 * @returns {{ additionalContext:string|null }}
 */
function runInstructionsLoadedHooks(
  settingsHooks,
  { files, cwd, sessionId } = {},
) {
  publishHooksV2Event("InstructionsLoaded", {
    count: Array.isArray(files) ? files.length : 0,
    cwd: cwd || null,
    session_id: sessionId || null,
  });
  if (!settingsHooks) return { additionalContext: null };
  const matched = collectHooks(settingsHooks, "InstructionsLoaded", "");
  const { sync } = partitionAsyncHooks(matched);
  if (sync.length === 0) return { additionalContext: null };
  const list = Array.isArray(files) ? files : [];
  const payload = withDeliveryId(
    "InstructionsLoaded",
    {
      hook_event_name: "InstructionsLoaded",
      files: list.map((f) => ({
        path: f?.path || null,
        scope: f?.scope || null,
        truncated: f?.truncated === true,
      })),
      count: list.length,
      cwd: cwd || null,
      session_id: sessionId || null,
    },
    { sessionId },
  );
  const outcome = runHooks(sync, payload, {
    cwd,
    event: "InstructionsLoaded",
  });
  return { additionalContext: aggregateContext(outcome.results) };
}

/**
 * Generic observe-only fire (SessionEnd / Stop / PreCompact). Returns the raw
 * runHooks outcome so callers can read a block reason; never gates flow here.
 *
 * `async: true` hooks are EXCLUDED from this synchronous run — they are always
 * fire-and-forget and are dispatched separately (dispatchAsyncHooks), so running
 * them here too would double-execute them.
 */
function runObserveHooks(
  settingsHooks,
  event,
  payload = {},
  { cwd, matchTarget, traceId, parentId } = {},
) {
  publishHooksV2Event(event, {
    ...payload,
    cwd: cwd || payload.cwd || null,
    trace_id: traceId || payload.trace_id || null,
    parent_id: parentId || payload.parent_id || null,
  });
  if (!settingsHooks) return { decision: "continue", results: [] };
  const matched = collectHooks(settingsHooks, event, matchTarget || "");
  const { sync } = partitionAsyncHooks(matched);
  if (sync.length === 0) return { decision: "continue", results: [] };
  return runHooks(
    sync,
    withDeliveryId(
      event,
      { hook_event_name: event, cwd, ...payload },
      { traceId, parentId },
    ),
    { cwd, event },
  );
}

module.exports = {
  withDeliveryId,
  runUserPromptSubmitHooks,
  runSessionStartHooks,
  runCwdChangedHooks,
  runWorktreeCreateHooks,
  runWorktreeRemoveHooks,
  runInstructionsLoadedHooks,
  runObserveHooks,
  aggregateContext,
  partitionAsyncHooks,
  dispatchAsyncHooks,
};

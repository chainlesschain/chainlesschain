/**
 * Session-level hook firing helpers — the "三件套 +1" that complements
 * the tool-level PreToolUse/PostToolUse hooks already wired in
 * `runtime/agent-core.js`.
 *
 * Four session-level events are fired from `repl/agent-repl.js`:
 *
 *   - SessionStart       — once, after sessionId is established
 *   - UserPromptSubmit   — per user line, before agentLoop()
 *   - AssistantResponse  — per agent reply, after agentLoop() returns
 *   - SessionEnd         — once, on rl.close() before shutdown
 *
 * Semantics (matches existing PreToolUse convention):
 *   - Fire-and-forget by default: hook failures NEVER break the host flow
 *   - `fireUserPromptSubmit` / `fireAssistantResponse` are opt-in helpers
 *     that parse stdout JSON directives ({rewrittenPrompt,abort} /
 *     {rewrittenResponse,suppress}) for callers that want control flow
 *   - No-op when hookDb is null (REPL without DB)
 *   - Helper-side timeout protects against runaway hooks even if
 *     hook-manager's per-hook timeout is misconfigured
 *   - Swallowed errors are persisted to hook_execution_log when possible
 */

import { executeHooks, HookEvents } from "./hook-manager.js";

/**
 * Events this helper is allowed to fire. Guards against typos that
 * would otherwise silently no-op inside executeHooks' event filter.
 */
export const SESSION_HOOK_EVENTS = Object.freeze([
  HookEvents.SessionStart,
  HookEvents.UserPromptSubmit,
  HookEvents.AssistantResponse,
  HookEvents.SessionEnd,
]);

/**
 * Helper-side wall-clock cap. Per-hook timeout still lives in the
 * registered hook row; this is a belt-and-suspenders bound so a
 * misconfigured hook can never wedge the REPL.
 */
const HELPER_TIMEOUT_MS = Number(
  process.env.CC_SESSION_HOOK_TIMEOUT_MS || 15000,
);

/**
 * Internal deps — exposed for tests via `_deps` injection.
 * Keeping this mutable lets vitest swap out timer/log writers without
 * resorting to vi.mock (which doesn't intercept inlined CJS).
 */
export const _deps = {
  executeHooks,
  now: () => Date.now(),
  logFailure: (hookDb, eventName, err) => {
    // Best-effort persistence to hook_execution_log; never throws.
    if (!hookDb || typeof hookDb.prepare !== "function") return;
    try {
      const stmt = hookDb.prepare(
        `INSERT INTO hook_execution_log
           (hook_id, event, success, error, executed_at)
         VALUES (?, ?, ?, ?, ?)`,
      );
      stmt.run(
        null,
        eventName,
        0,
        String(err && err.message ? err.message : err),
        new Date().toISOString(),
      );
    } catch {
      /* table may not exist yet — silent */
    }
  },
};

/**
 * Fire a session-level hook. Returns the raw results from executeHooks
 * (array of {hookId, hookName, success, ...}) or an empty array if
 * hookDb is missing, event is not allowed, or execution throws.
 *
 * @param {object|null} hookDb  better-sqlite3 handle, or null to no-op
 * @param {string}      eventName  one of SESSION_HOOK_EVENTS
 * @param {object}      [context]  forwarded to hook matcher + handler env
 * @returns {Promise<Array>}
 */
export async function fireSessionHook(hookDb, eventName, context = {}) {
  if (!hookDb) return [];
  if (!SESSION_HOOK_EVENTS.includes(eventName)) {
    throw new Error(
      `fireSessionHook: event "${eventName}" is not a session hook. ` +
        `Use one of: ${SESSION_HOOK_EVENTS.join(", ")}`,
    );
  }

  try {
    const enriched = {
      timestamp: new Date().toISOString(),
      ...context,
    };
    return await withTimeout(
      _deps.executeHooks(hookDb, eventName, enriched),
      HELPER_TIMEOUT_MS,
      `${eventName} session hook`,
    );
  } catch (err) {
    // Hook failures must never break the REPL — but we record them
    _deps.logFailure(hookDb, eventName, err);
    return [];
  }
}

/**
 * Fire UserPromptSubmit with rewrite/abort support.
 *
 * A hook may control the prompt by emitting a single JSON line to stdout:
 *   {"rewrittenPrompt": "..."}   — replace the user prompt
 *   {"abort": true, "reason": "..."} — skip agentLoop entirely
 *
 * First matching directive wins (priority order from executeHooks).
 * Malformed JSON / no directive → no change (pure observation).
 *
 * @returns {Promise<{prompt: string, abort: boolean, reason?: string, results: Array}>}
 */
export async function fireUserPromptSubmit(
  hookDb,
  originalPrompt,
  context = {},
) {
  const results = await fireSessionHook(hookDb, HookEvents.UserPromptSubmit, {
    ...context,
    prompt: originalPrompt,
  });

  let prompt = originalPrompt;
  let abort = false;
  let reason;

  for (const r of results) {
    if (!r || !r.success) continue;
    const directive = extractDirective(r);
    if (!directive) continue;
    if (directive.abort) {
      abort = true;
      reason = directive.reason;
      break;
    }
    if (
      typeof directive.rewrittenPrompt === "string" &&
      directive.rewrittenPrompt.trim()
    ) {
      prompt = directive.rewrittenPrompt;
      break;
    }
  }

  return { prompt, abort, reason, results };
}

/**
 * Fire AssistantResponse with rewrite/suppress support.
 *
 * Symmetric to fireUserPromptSubmit but on the way out. A hook may emit:
 *   {"rewrittenResponse": "..."} — replace the response shown to the user
 *   {"suppress": true, "reason": "..."} — drop the response entirely
 *
 * Common use: PII / secret scrubbing, watermark injection, profanity
 * filter on the model's final string before it reaches the terminal.
 *
 * @returns {Promise<{response: string, suppress: boolean, reason?: string, results: Array}>}
 */
export async function fireAssistantResponse(
  hookDb,
  originalResponse,
  context = {},
) {
  const results = await fireSessionHook(hookDb, HookEvents.AssistantResponse, {
    ...context,
    response: originalResponse,
  });

  let response = originalResponse;
  let suppress = false;
  let reason;

  for (const r of results) {
    if (!r || !r.success) continue;
    const directive = extractDirective(r);
    if (!directive) continue;
    if (directive.suppress) {
      suppress = true;
      reason = directive.reason;
      break;
    }
    if (
      typeof directive.rewrittenResponse === "string" &&
      directive.rewrittenResponse.length > 0
    ) {
      response = directive.rewrittenResponse;
      break;
    }
  }

  return { response, suppress, reason, results };
}

function extractDirective(result) {
  const raw = result.stdout ?? result.output ?? result.result;
  if (raw == null) return null;
  if (typeof raw === "object") return raw;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function withTimeout(promise, ms, label) {
  if (!ms || ms <= 0) return promise;
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(
      () => reject(new Error(`${label} exceeded ${ms}ms helper timeout`)),
      ms,
    );
    if (typeof t.unref === "function") t.unref();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

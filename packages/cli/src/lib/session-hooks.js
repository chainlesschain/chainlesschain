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
 *   - `fireSessionHookWithRewrite` opt-in: lets a UserPromptSubmit hook
 *     return `{ rewrittenPrompt }` or `{ abort: true }` via stdout JSON
 *   - No-op when hookDb is null (REPL without DB)
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
    return await executeHooks(hookDb, eventName, enriched);
  } catch (_err) {
    // Hook failures must never break the REPL
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

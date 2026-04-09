/**
 * Session-level hook firing helpers — the "三件套" that complements
 * the tool-level PreToolUse/PostToolUse hooks already wired in
 * `runtime/agent-core.js`.
 *
 * These three events are defined in hook-manager.js but were never
 * actually fired anywhere in the CLI. This module is the canonical
 * fire site, consumed by `repl/agent-repl.js`.
 *
 *   - SessionStart      — once, after sessionId is established
 *   - UserPromptSubmit  — per user line, before agentLoop()
 *   - SessionEnd        — once, on rl.close() before shutdown
 *
 * Semantics (matches existing PreToolUse convention):
 *   - Fire-and-forget: hook failures NEVER break the host flow
 *   - Observational only: no abort, no rewrite (can be added later)
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

/**
 * session-insights — turn a JSONL session's events into an analysis report
 * (Claude-Code `/insights` parity). Pure: takes the already-read event array
 * and returns a structured summary. No new data is collected — this reads the
 * same `token_usage` / `tool_call` / message events the session already wrote,
 * and layers on top of `aggregateUsage` (session-usage.js) for tokens.
 *
 * Note: headless runs persist user/assistant/token_usage but not necessarily
 * tool_call/tool_result, so the tools section degrades gracefully to zero when
 * those events aren't present (the REPL records them).
 */

import { aggregateUsage } from "./session-usage.js";

/** Human-readable duration from milliseconds. */
export function formatDuration(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return "0s";
  const s = Math.round(n / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return rs ? `${m}m ${rs}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h}h ${rm}m` : `${h}h`;
}

/** Detect whether a tool_result event represents an error (lenient). */
function isToolError(event) {
  const r = event?.data?.result;
  return Boolean(
    event?.data?.error ||
      (r && typeof r === "object" && (r.error || r.is_error || r.isError)),
  );
}

/**
 * Analyze a session's events into a structured insights object. Pure.
 *
 * @param {object[]} events  JSONL events ({type, timestamp, data})
 * @param {string} [sessionId]
 * @returns {object}
 */
export function analyzeSession(events, sessionId) {
  const evs = Array.isArray(events) ? events : [];
  const start = evs.find((e) => e && e.type === "session_start");

  const stamps = evs
    .map((e) => Number(e?.timestamp))
    .filter((t) => Number.isFinite(t) && t > 0);
  const startedAt = stamps.length ? Math.min(...stamps) : null;
  const endedAt = stamps.length ? Math.max(...stamps) : null;
  const durationMs =
    startedAt != null && endedAt != null ? endedAt - startedAt : 0;

  let userMsgs = 0;
  let assistantMsgs = 0;
  let compactions = 0;
  let toolCalls = 0;
  let toolErrors = 0;
  const toolByName = new Map();

  const bump = (name) => {
    const t = toolByName.get(name) || { tool: name, count: 0, errors: 0 };
    toolByName.set(name, t);
    return t;
  };

  for (const e of evs) {
    if (!e || typeof e !== "object") continue;
    switch (e.type) {
      case "user_message":
        userMsgs++;
        break;
      case "assistant_message":
        assistantMsgs++;
        break;
      case "compact":
        compactions++;
        break;
      case "tool_call": {
        toolCalls++;
        bump(e.data?.tool || "?").count++;
        break;
      }
      case "tool_result": {
        if (isToolError(e)) {
          toolErrors++;
          bump(e.data?.tool || "?").errors++;
        }
        break;
      }
      default:
        break;
    }
  }

  // Headless persistence writes token_usage with only {input_tokens,
  // output_tokens} — no model/provider — so the raw aggregate can't be priced.
  // Backfill the session's recorded model/provider (from session_start) onto
  // those events so cost estimation works (cc cost lacks this, so insights cost
  // is strictly better for headless sessions).
  const sessModel = start?.data?.model || null;
  const sessProvider = start?.data?.provider || null;
  const usageEvents =
    sessModel || sessProvider
      ? evs.map((e) => {
          if (e?.type !== "token_usage") return e;
          const d = e.data || {};
          if (d.provider || d.model) return e;
          return {
            ...e,
            data: { ...d, provider: sessProvider, model: sessModel },
          };
        })
      : evs;
  const usage = aggregateUsage(usageEvents);
  const iso = (t) => (t != null ? new Date(t).toISOString() : null);

  return {
    sessionId: sessionId || null,
    meta: {
      title: start?.data?.title || null,
      model: start?.data?.model || usage.byModel[0]?.model || null,
      provider: start?.data?.provider || usage.byModel[0]?.provider || null,
      startedAt: iso(startedAt),
      endedAt: iso(endedAt),
      durationMs,
    },
    events: evs.length,
    messages: {
      user: userMsgs,
      assistant: assistantMsgs,
      total: userMsgs + assistantMsgs,
    },
    tools: {
      calls: toolCalls,
      errors: toolErrors,
      byTool: Array.from(toolByName.values()).sort((a, b) => b.count - a.count),
    },
    compactions,
    usage,
  };
}

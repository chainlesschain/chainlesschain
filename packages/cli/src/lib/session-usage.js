/**
 * Session usage aggregation — Phase I of Managed Agents parity plan.
 *
 * Scans JSONL session events for token usage (emitted either as explicit
 * `token_usage` events or embedded under `event.data.usage` on
 * `assistant_message` / `llm_call` events) and produces roll-ups by model.
 *
 * Purely functional aggregation + file-reading helpers. No state.
 */

import {
  readEvents,
  listJsonlSessions,
} from "../harness/jsonl-session-store.js";

const USAGE_EVENT_TYPES = new Set([
  "token_usage",
  "assistant_message",
  "llm_call",
  "llm_response",
]);

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Extract a normalized usage record from a single event, or null if none.
 * Accepts both snake_case (OpenAI/Anthropic) and camelCase variants.
 */
export function extractUsage(event) {
  if (!event || typeof event !== "object") return null;
  if (!USAGE_EVENT_TYPES.has(event.type)) return null;

  const d = event.data || {};
  const raw =
    event.type === "token_usage"
      ? d.usage || d
      : d.usage || d.tokenUsage || null;
  if (!raw || typeof raw !== "object") return null;

  const inputTokens = toNumber(
    raw.input_tokens ?? raw.prompt_tokens ?? raw.inputTokens ?? 0,
  );
  const outputTokens = toNumber(
    raw.output_tokens ?? raw.completion_tokens ?? raw.outputTokens ?? 0,
  );
  const totalTokens = toNumber(
    raw.total_tokens ?? raw.totalTokens ?? inputTokens + outputTokens,
  );

  if (inputTokens === 0 && outputTokens === 0 && totalTokens === 0) {
    return null;
  }

  return {
    provider: d.provider || raw.provider || null,
    model: d.model || raw.model || null,
    inputTokens,
    outputTokens,
    totalTokens,
    timestamp: event.timestamp || null,
  };
}

/**
 * Aggregate a list of events into { total, byModel[] }.
 */
export function aggregateUsage(events) {
  const byKey = new Map();
  const total = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    calls: 0,
  };

  for (const evt of events || []) {
    const u = extractUsage(evt);
    if (!u) continue;

    total.inputTokens += u.inputTokens;
    total.outputTokens += u.outputTokens;
    total.totalTokens += u.totalTokens;
    total.calls += 1;

    const key = `${u.provider || "?"}/${u.model || "?"}`;
    const entry = byKey.get(key) || {
      provider: u.provider,
      model: u.model,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      calls: 0,
    };
    entry.inputTokens += u.inputTokens;
    entry.outputTokens += u.outputTokens;
    entry.totalTokens += u.totalTokens;
    entry.calls += 1;
    byKey.set(key, entry);
  }

  return {
    total,
    byModel: Array.from(byKey.values()).sort(
      (a, b) => b.totalTokens - a.totalTokens,
    ),
  };
}

/**
 * Roll up usage for a single JSONL session.
 */
export function sessionUsage(sessionId) {
  const events = readEvents(sessionId);
  const agg = aggregateUsage(events);
  return { sessionId, ...agg };
}

/**
 * Roll up usage across every JSONL session on disk.
 */
export function allSessionsUsage({ limit = 1000 } = {}) {
  const sessions = listJsonlSessions({ limit });
  const perSession = sessions.map((s) => sessionUsage(s.id));

  const total = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    calls: 0,
  };
  const byKey = new Map();

  for (const s of perSession) {
    total.inputTokens += s.total.inputTokens;
    total.outputTokens += s.total.outputTokens;
    total.totalTokens += s.total.totalTokens;
    total.calls += s.total.calls;
    for (const row of s.byModel) {
      const key = `${row.provider || "?"}/${row.model || "?"}`;
      const entry = byKey.get(key) || {
        provider: row.provider,
        model: row.model,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        calls: 0,
      };
      entry.inputTokens += row.inputTokens;
      entry.outputTokens += row.outputTokens;
      entry.totalTokens += row.totalTokens;
      entry.calls += row.calls;
      byKey.set(key, entry);
    }
  }

  return {
    sessions: perSession,
    total,
    byModel: Array.from(byKey.values()).sort(
      (a, b) => b.totalTokens - a.totalTokens,
    ),
  };
}

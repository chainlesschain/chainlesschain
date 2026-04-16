/**
 * memory-injection — recall top-K session-core memories and format them as a
 * system-prompt block for agent-repl / chat-repl startup.
 *
 * Managed Agents parity Phase G item #5: new sessions automatically surface
 * relevant global/agent-scoped memory so the assistant has continuity across
 * runs.
 *
 * Design:
 * - Pull from global scope + (optionally) the session's agent scope.
 * - Deduplicate by memory id, sort by relevance/score, cap at `limit`.
 * - Return `null` when nothing useful was found so callers can skip the
 *   extra system message entirely.
 * - Pure formatting — caller decides where to splice it into `messages`.
 */

import { getMemoryStore } from "./session-core-singletons.js";

const DEFAULT_LIMIT = 8;
const DEFAULT_CONTENT_CHARS = 280;

export function recallStartupMemories({
  agentId = null,
  query = "",
  limit = DEFAULT_LIMIT,
  memoryStore = null,
} = {}) {
  const store = memoryStore || getMemoryStore();
  if (!store || typeof store.recall !== "function") return [];

  const pools = [];
  try {
    pools.push(store.recall({ scope: "global", query, limit }) || []);
  } catch (_e) {
    /* ignore — missing scope is not fatal */
  }
  if (agentId) {
    try {
      pools.push(
        store.recall({ scope: "agent", scopeId: agentId, query, limit }) || [],
      );
    } catch (_e) {
      /* ignore */
    }
  }

  const seen = new Set();
  const merged = [];
  for (const pool of pools) {
    for (const m of pool) {
      if (!m || !m.id || seen.has(m.id)) continue;
      seen.add(m.id);
      merged.push(m);
    }
  }

  merged.sort((a, b) => {
    const ra = Number(a.relevance ?? a.score ?? 0);
    const rb = Number(b.relevance ?? b.score ?? 0);
    return rb - ra;
  });

  return merged.slice(0, limit);
}

export function formatMemoriesAsSystemPrompt(memories, { headline } = {}) {
  if (!Array.isArray(memories) || memories.length === 0) return null;

  const title =
    headline || "Relevant memory from prior sessions (recall — do not echo):";
  const lines = [title];
  for (const m of memories) {
    const scope = m.scope || "global";
    const scopeTag = m.scopeId
      ? `${scope}:${String(m.scopeId).slice(0, 12)}`
      : scope;
    const cat = m.category ? `[${m.category}] ` : "";
    const body = String(m.content || "").slice(0, DEFAULT_CONTENT_CHARS);
    lines.push(`- (${scopeTag}) ${cat}${body}`);
  }
  return lines.join("\n");
}

export function buildMemoryInjection(options = {}) {
  const memories = recallStartupMemories(options);
  const content = formatMemoriesAsSystemPrompt(memories, {
    headline: options.headline,
  });
  return content ? { role: "system", content, count: memories.length } : null;
}

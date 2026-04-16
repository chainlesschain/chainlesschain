/**
 * session-consolidator — bridges CLI JSONL sessions into session-core
 * MemoryConsolidator.
 *
 * Managed Agents parity Phase G: `chainlesschain memory consolidate --session <id>`
 * reads the session's append-only JSONL log, projects the events into
 * `TRACE_TYPES.{MESSAGE,TOOL_CALL,TOOL_RESULT}` payloads, and runs the shared
 * MemoryConsolidator against the CLI MemoryStore singleton.
 *
 * The JSONL store holds `session_start / user_message / assistant_message /
 * tool_call / tool_result / compact` events. Only the user/assistant messages
 * and tool call/result events are carried through — `session_start` and
 * `compact` don't contribute to memory extraction.
 */

import {
  TraceStore,
  TRACE_TYPES,
  MemoryConsolidator,
} from "@chainlesschain/session-core";
import { readEvents, sessionExists } from "../harness/jsonl-session-store.js";
import { getMemoryStore } from "./session-core-singletons.js";

/**
 * Build an in-memory TraceStore populated with events from a JSONL session.
 * Used so MemoryConsolidator can run against sessions that were never live
 * in this CLI process.
 */
export function buildTraceStoreFromJsonl(sessionId, events) {
  const trace = new TraceStore();
  const source = events || readEvents(sessionId);

  for (const ev of source) {
    if (!ev || !ev.type) continue;
    const ts = ev.timestamp || Date.now();
    const d = ev.data || {};

    switch (ev.type) {
      case "user_message":
        trace.record({
          sessionId,
          type: TRACE_TYPES.MESSAGE,
          ts,
          payload: { role: "user", content: d.content || "" },
        });
        break;
      case "assistant_message":
        trace.record({
          sessionId,
          type: TRACE_TYPES.MESSAGE,
          ts,
          payload: { role: "assistant", content: d.content || "" },
        });
        break;
      case "tool_call":
        trace.record({
          sessionId,
          type: TRACE_TYPES.TOOL_CALL,
          ts,
          payload: { tool: d.tool, args: d.args },
        });
        break;
      case "tool_result": {
        const raw = d.result;
        const ok = !(raw && typeof raw === "object" && raw.error);
        const summary =
          typeof raw === "string"
            ? raw
            : raw && typeof raw === "object"
              ? raw.summary || raw.message || null
              : null;
        trace.record({
          sessionId,
          type: TRACE_TYPES.TOOL_RESULT,
          ts,
          payload: { tool: d.tool, ok, summary, result: raw },
        });
        break;
      }
      default:
        // session_start / compact / other — not memory-relevant
        break;
    }
  }

  return trace;
}

/**
 * Consolidate a JSONL session into the CLI MemoryStore.
 *
 * @param {string} sessionId
 * @param {object} options
 * @param {"session"|"agent"|"global"} [options.scope="agent"]
 * @param {string|null} [options.scopeId]
 * @param {string|null} [options.agentId] — used as SessionHandle.agentId when
 *   scope=agent and no scopeId given
 * @param {object} [options.memoryStore] — override (tests)
 * @param {Array}  [options.events] — override (tests)
 * @returns {Promise<object>} MemoryConsolidator result
 */
export async function consolidateJsonlSession(sessionId, options = {}) {
  if (!sessionId) throw new Error("sessionId required");
  if (!options.events && !sessionExists(sessionId)) {
    const err = new Error(`Session not found: ${sessionId}`);
    err.code = "SESSION_NOT_FOUND";
    throw err;
  }

  const trace = buildTraceStoreFromJsonl(sessionId, options.events);
  const memoryStore = options.memoryStore || getMemoryStore();
  const consolidator = new MemoryConsolidator({
    memoryStore,
    traceStore: trace,
    scope: options.scope || "agent",
  });

  return consolidator.consolidate(
    { sessionId, agentId: options.agentId || sessionId },
    {
      scope: options.scope,
      scopeId: options.scopeId,
    },
  );
}

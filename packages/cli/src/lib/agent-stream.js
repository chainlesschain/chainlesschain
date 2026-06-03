/**
 * agent-stream — thin wrapper over session-core StreamRouter for REPL output.
 *
 * Managed Agents parity Phase G item #2: every agent response — streaming or
 * not — goes through a uniform StreamEvent protocol. Non-streaming providers
 * are "fake-streamed" as `start → message → end` so downstream consumers
 * (REPL, WS IPC, tests) only need one event contract.
 *
 * Exports:
 *   - streamAgentResponse(source, { onEvent, onToken, noStream, writer })
 *     Returns `{ text, events, errored, error }`. When `noStream` is true,
 *     events are still collected but no per-event side effects are emitted
 *     beyond the final writer flush.
 */

import {
  StreamRouter,
  STREAM_EVENT as EVENT,
} from "@chainlesschain/session-core";

export async function streamAgentResponse(source, options = {}) {
  const {
    onEvent = null,
    onToken = null,
    noStream = false,
    writer = null,
  } = options;

  let writtenByToken = false;

  const router = new StreamRouter({
    onEvent: (ev) => {
      try {
        if (onEvent) onEvent(ev);
      } catch {
        /* swallow */
      }
      if (noStream || !writer) return;
      if (ev.type === EVENT.TOKEN && typeof ev.text === "string") {
        writer(ev.text);
        writtenByToken = true;
      }
    },
    onToken: (t) => {
      try {
        if (onToken) onToken(t);
      } catch {
        /* swallow */
      }
    },
  });

  const result = await router.collect(source);

  // Flush MESSAGE content if we haven't already written via TOKEN events.
  if (writer && !noStream && !writtenByToken && result.text) {
    writer(result.text);
  }

  return result;
}

export { EVENT };

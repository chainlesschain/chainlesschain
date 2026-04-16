/**
 * Envelope-SSE Adapter — Deep Agents Deploy Phase 5 (hosted HTTP follow-up)
 *
 * Pure-function building blocks for shipping service envelopes over an HTTP
 * Server-Sent Events stream. The adapter has no transport dependency — it
 * formats lines and orchestrates an async iterable of envelopes; the caller
 * wires it to whatever HTTP runtime (Node http, fastify, electron-net, ...)
 * already exists.
 *
 * SSE wire format (per WHATWG):
 *   id: <eventId>\n
 *   event: <type>\n
 *   data: <json-line-1>\n
 *   data: <json-line-2>\n
 *   \n
 *
 * Reference: https://html.spec.whatwg.org/multipage/server-sent-events.html
 */

const { validateEnvelope } = require("./service-envelope.js");

const SSE_HEADERS = Object.freeze({
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no", // hint nginx etc. to flush per-event
});

/** HTTP headers a server should send before piping envelopes. */
function sseResponseHeaders() {
  return { ...SSE_HEADERS };
}

/**
 * Format a single envelope as an SSE message block. Returns the full payload
 * including the trailing blank-line terminator.
 *
 * @param {object} envelope - service envelope (validated)
 * @param {object} [options]
 * @param {string|number} [options.id] - SSE id; defaults to `${type}:${ts}`
 * @returns {string}
 */
function formatEnvelopeAsSse(envelope, options = {}) {
  const errors = validateEnvelope(envelope);
  if (errors.length > 0) {
    throw new Error(
      `formatEnvelopeAsSse: invalid envelope (${errors.join("; ")})`
    );
  }
  const id =
    options.id != null ? String(options.id) : `${envelope.type}:${envelope.ts}`;
  const lines = [`id: ${id}`, `event: ${envelope.type}`];
  const json = JSON.stringify(envelope);
  for (const part of json.split("\n")) {
    lines.push(`data: ${part}`);
  }
  return `${lines.join("\n")}\n\n`;
}

/** SSE comment line — useful for keep-alive heartbeats. */
function formatSseComment(text = "") {
  return `: ${String(text).replace(/\n/g, " ")}\n\n`;
}

/**
 * Convert an async iterable of envelopes into an async iterable of SSE chunks
 * (strings). Caller decides how to write each chunk to its transport.
 *
 * Heartbeats are emitted as SSE comments to keep proxies from idling out.
 *
 * @param {AsyncIterable<object>} envelopes
 * @param {object} [options]
 * @param {number} [options.heartbeatMs=15000] - 0 disables heartbeats
 * @param {AbortSignal} [options.signal] - abort halts the stream
 * @returns {AsyncIterable<string>}
 */
async function* envelopeStreamToSse(envelopes, options = {}) {
  const heartbeatMs = options.heartbeatMs ?? 15000;
  const signal = options.signal;
  let heartbeatTimer = null;

  const armHeartbeatPromise = () => {
    if (!heartbeatMs) return new Promise(() => {});
    return new Promise((resolve) => {
      heartbeatTimer = setTimeout(() => resolve("heartbeat"), heartbeatMs);
      if (typeof heartbeatTimer.unref === "function") heartbeatTimer.unref();
    });
  };

  try {
    const iterator = envelopes[Symbol.asyncIterator]();
    while (true) {
      if (signal && signal.aborted) return;

      const heartbeatPromise = armHeartbeatPromise();
      const winner = await Promise.race([
        iterator.next().then((res) => ({ kind: "envelope", res })),
        heartbeatPromise.then(() => ({ kind: "heartbeat" })),
      ]);

      if (heartbeatTimer) {
        clearTimeout(heartbeatTimer);
        heartbeatTimer = null;
      }

      if (signal && signal.aborted) return;

      if (winner.kind === "heartbeat") {
        yield formatSseComment("keep-alive");
        continue;
      }

      const { value, done } = winner.res;
      if (done) return;
      yield formatEnvelopeAsSse(value);
    }
  } finally {
    if (heartbeatTimer) clearTimeout(heartbeatTimer);
  }
}

module.exports = {
  sseResponseHeaders,
  formatEnvelopeAsSse,
  formatSseComment,
  envelopeStreamToSse,
};

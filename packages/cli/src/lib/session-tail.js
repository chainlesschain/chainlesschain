/**
 * Session tail — Phase I of Managed Agents parity plan.
 *
 * Follows a JSONL session file and yields new events as an async iterable.
 * Uses offset-polling so it works cross-platform (fs.watch on Windows is
 * unreliable for appended-to files).
 *
 * Pure generator + helper; the CLI command just wires output.
 */

import { promises as fsp } from "node:fs";
import { existsSync, statSync } from "node:fs";
import { sessionPath } from "../harness/jsonl-session-store.js";

function parseLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

/**
 * Parse a contiguous chunk of buffered text into events. Returns {events, rest}
 * where `rest` is the unterminated trailing partial line to keep for the next
 * read.
 */
export function parseChunk(buffer) {
  const events = [];
  let rest = buffer;
  let nl = rest.indexOf("\n");
  while (nl !== -1) {
    const line = rest.slice(0, nl);
    rest = rest.slice(nl + 1);
    const evt = parseLine(line);
    if (evt) events.push(evt);
    nl = rest.indexOf("\n");
  }
  return { events, rest };
}

function matchesFilter(event, { types, sinceMs }) {
  if (types && types.length > 0 && !types.includes(event.type)) return false;
  if (sinceMs && event.timestamp && event.timestamp < sinceMs) return false;
  return true;
}

/**
 * Get the initial offset for a session:
 *   - fromStart: 0
 *   - fromEnd (default): current EOF, so only new events are yielded
 */
export function initialOffset(sessionId, { fromStart = false } = {}) {
  const p = sessionPath(sessionId);
  if (!existsSync(p)) return 0;
  if (fromStart) return 0;
  return statSync(p).size;
}

/**
 * Follow a session file. Yields {event, offset} objects as new JSONL lines
 * are appended. Caller passes an AbortSignal (or the generator runs forever).
 *
 * Options:
 *   - signal       AbortSignal — stops the loop
 *   - pollMs       polling interval (default 200)
 *   - fromStart    start from byte 0 (default false — tail from EOF)
 *   - fromOffset   explicit starting byte offset (overrides fromStart)
 *   - types        string[] of event.type to include (null = all)
 *   - sinceMs      only yield events with timestamp >= sinceMs
 *   - once         if true, stop once file is drained (no polling)
 */
export async function* followSession(sessionId, options = {}) {
  const {
    signal,
    pollMs = 200,
    fromStart = false,
    fromOffset,
    types = null,
    sinceMs = null,
    once = false,
  } = options;

  const filePath = sessionPath(sessionId);
  let offset =
    typeof fromOffset === "number"
      ? fromOffset
      : initialOffset(sessionId, { fromStart });
  let buffer = "";

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (signal?.aborted) return;

    if (existsSync(filePath)) {
      const stat = await fsp.stat(filePath);
      if (stat.size < offset) {
        // File was truncated / rotated — restart from beginning
        offset = 0;
        buffer = "";
      }
      if (stat.size > offset) {
        const fd = await fsp.open(filePath, "r");
        try {
          const length = stat.size - offset;
          const buf = Buffer.alloc(length);
          await fd.read(buf, 0, length, offset);
          offset = stat.size;
          buffer += buf.toString("utf-8");
        } finally {
          await fd.close();
        }
        const { events, rest } = parseChunk(buffer);
        buffer = rest;
        for (const evt of events) {
          if (matchesFilter(evt, { types, sinceMs })) {
            yield { event: evt, offset };
          }
        }
      }
    }

    if (once) return;
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

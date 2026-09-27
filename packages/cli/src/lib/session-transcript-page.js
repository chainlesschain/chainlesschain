import { createHash } from "node:crypto";
import {
  readVerifiedProjection,
  projectWsTurnMessages,
} from "../harness/jsonl-session-store.js";

const MAX_PAGE_BYTES = 1024 * 1024;
const MAX_TEXT_CHARS = 200000;

export function transcriptTextParts(content) {
  return typeof content === "string"
    ? [content]
    : Array.isArray(content)
      ? content.map((part) =>
          typeof part?.text === "string"
            ? part.text
            : ["image", "image_url", "input_image"].includes(part?.type)
              ? "[image]"
              : "",
        )
      : [];
}

export function displayTranscriptText(content) {
  const parts = transcriptTextParts(content);
  let text = "";
  let truncated = false;
  for (const part of parts) {
    const remaining = MAX_TEXT_CHARS - text.length;
    text += part.slice(0, remaining);
    if (part.length > remaining) truncated = true;
  }
  return { text, truncated };
}

// Escaped control characters can exceed the JSON byte budget before the
// character limit. Keep a shortened row rather than silently dropping it.
export function boundTranscriptRow(row) {
  if (Buffer.byteLength(JSON.stringify(row)) <= MAX_PAGE_BYTES) return row;
  const text = row.text;
  row.truncated = true;
  let low = 0;
  let high = text.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    row.text = text.slice(0, middle);
    if (Buffer.byteLength(JSON.stringify(row)) <= MAX_PAGE_BYTES) low = middle;
    else high = middle - 1;
  }
  row.text = text.slice(0, low);
  return row;
}

export function createSessionTranscriptPageProjection(
  sessionId,
  { limit = 50, cursor = null } = {},
) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new TypeError("transcript page limit must be 1–100");
  let before = Infinity;
  let expectedGeneration = null;
  if (cursor != null) {
    if (
      typeof cursor !== "string" ||
      cursor.length > 1024 ||
      !/^[\w-]+$/u.test(cursor)
    )
      throw new TypeError("invalid transcript cursor");
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      value.sessionId !== sessionId ||
      !Number.isSafeInteger(value.before) ||
      value.before < 0 ||
      !/^[a-f0-9]{64}$/u.test(value.generation)
    )
      throw new TypeError("invalid transcript cursor");
    before = value.before;
    expectedGeneration = value.generation;
  }
  let generation = null;
  let count = 0;
  let bytes = 0;
  let rows = [];
  const identity = (event) =>
    /^[a-f0-9]{64}$/u.test(event.hash || "")
      ? event.hash
      : createHash("sha256").update(JSON.stringify(event)).digest("hex");
  function append(message) {
    if (!["user", "assistant", "tool"].includes(message?.role)) return;
    const ordinal = count++;
    if (ordinal >= before) return;
    const content = displayTranscriptText(message.content);
    const row = boundTranscriptRow({
      id: `${generation}:${ordinal}`,
      ordinal,
      role: message.role,
      ...content,
    });
    rows.push(row);
    bytes += Buffer.byteLength(JSON.stringify(row));
    while (rows.length > limit || bytes > MAX_PAGE_BYTES)
      bytes -= Buffer.byteLength(JSON.stringify(rows.shift()));
  }
  return {
    accept(event) {
      if (!generation) generation = identity(event);
      if (
        (event.type === "compact" ||
          event.type === "checkpoint_timeline_commit") &&
        Array.isArray(event.data?.messages)
      ) {
        // Match canonical resume semantics. A rewind or replacement checkpoint
        // invalidates every old cursor; never revive discarded messages.
        generation = identity(event);
        count = 0;
        bytes = 0;
        rows = [];
        for (const message of event.data.messages) append(message);
      } else if (
        ["user_message", "assistant_message", "system"].includes(event.type)
      )
        append(event.data);
      else if (event.type === "ws_turn") {
        const pair = projectWsTurnMessages(event);
        if (pair) {
          append(pair.user);
          append(pair.assistant);
        }
      }
    },
    finish(authority) {
      if (expectedGeneration && generation !== expectedGeneration) {
        const error = new Error(
          "Transcript generation changed; reload the latest page",
        );
        error.code = "SESSION_TRANSCRIPT_CURSOR_STALE";
        throw error;
      }
      const first = rows[0]?.ordinal ?? 0;
      return {
        schema: "chainlesschain.session-transcript-page/v1",
        sessionId,
        generation,
        revision: authority.headHash,
        eventCount: authority.eventCount,
        totalMessages: count,
        messages: rows,
        nextCursor:
          first > 0
            ? Buffer.from(
                JSON.stringify({ sessionId, generation, before: first }),
              ).toString("base64url")
            : null,
        contextOnly: true,
      };
    },
  };
}

export function readSessionTranscriptPage(sessionId, options = {}) {
  return readVerifiedProjection(sessionId, () =>
    createSessionTranscriptPageProjection(sessionId, options),
  );
}

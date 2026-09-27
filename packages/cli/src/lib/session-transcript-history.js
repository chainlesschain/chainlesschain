import { canonicalDigest } from "@chainlesschain/context-memory-kernel";
import {
  readVerifiedProjection,
  projectWsTurnMessages,
} from "../harness/jsonl-session-store.js";
import { contextItemsToMessages } from "./context-memory-kernel/message-adapter.js";
import { displayTranscriptText } from "./session-transcript-page.js";
import { createSessionHistoryOrigins } from "./session-history-origins.js";

const HASH = /^[a-f0-9]{64}$/u;
const SCHEMA = "chainlesschain.session-transcript-page/v2";
const MAX_PAGE_BYTES = 1024 * 1024;
const MAX_HISTORY_RANGES = 16384;

// Enumerate all possible display sources, including replacement snapshots.
// Their physical sequence never changes when the selected history rewinds.
function eventMessages(event) {
  if (
    ["compact", "checkpoint_timeline_commit"].includes(event.type) &&
    Array.isArray(event.data?.messages)
  )
    return event.data.messages;
  if (["user_message", "assistant_message", "system"].includes(event.type))
    return [event.data];
  if (event.type === "ws_turn") {
    const pair = projectWsTurnMessages(event);
    if (pair) return [pair.user, pair.assistant];
  }
  return [];
}
const displayable = (message) =>
  ["user", "assistant", "tool"].includes(message?.role);

// compact also historically meant import, rewind or a session-end snapshot.
// Only a verified Kernel compaction payload proves this is a context update.
// A copied fork retains the source payload, so do not compare its sessionId to
// the destination namespace (the store independently verifies fork authority).
function isContextCompaction(data) {
  const canonical = data?.canonical;
  if (
    canonical?.schema !== "chainlesschain.context-compaction/v1" ||
    canonical.schemaVersion !== 1 ||
    !["committed", "degraded"].includes(canonical.status) ||
    !Array.isArray(canonical.outputItems)
  )
    return false;
  try {
    const { digest, ...body } = canonical;
    if (canonicalDigest(body, "chainlesschain.compaction-event/v1") !== digest)
      return false;
    const content = (messages) =>
      messages
        .filter((message) => message?.role !== "system")
        .map(({ role, content, tool_calls, tool_call_id }) => ({
          role,
          content,
          tool_calls,
          tool_call_id,
        }));
    return (
      canonicalDigest(
        content(contextItemsToMessages(canonical.outputItems)),
      ) === canonicalDigest(content(data.messages))
    );
  } catch {
    return false;
  }
}

function staleCursor() {
  const error = new Error("Transcript history changed; reload the latest page");
  error.code = "SESSION_TRANSCRIPT_CURSOR_STALE";
  return error;
}

export function createSessionTranscriptHistoryProjection(
  sessionId,
  { limit = 50, cursor = null } = {},
) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new TypeError("transcript page limit must be 1–100");
  let anchor = null;
  if (cursor !== null) {
    if (typeof cursor !== "string" || !/^[\w-]{1,1024}$/u.test(cursor))
      throw new TypeError("invalid transcript history cursor");
    try {
      anchor = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    } catch {
      throw new TypeError("invalid transcript history cursor");
    }
    if (
      anchor?.v !== 2 ||
      anchor.sessionId !== sessionId ||
      !HASH.test(anchor.generation) ||
      !HASH.test(anchor.revision) ||
      !Number.isSafeInteger(anchor.eventCount) ||
      anchor.eventCount < 1 ||
      !Number.isSafeInteger(anchor.before) ||
      anchor.before < 1
    )
      throw new TypeError("invalid transcript history cursor");
  }
  let generation = null;
  let eventCount = 0;
  let count = 0;
  let bytes = 0;
  let rows = [];
  let anchored = !anchor;
  let coverage = { kind: "from-origin", boundaryEvent: null, reason: null };
  const origins = createSessionHistoryOrigins();
  let physical = 0;
  let ranges = [];
  let needsReplay = false;

  function collect(message, event, index, ordinal) {
    if (anchor && ordinal >= anchor.before) return;
    const row = {
      id: `${sessionId}:${event.hash}:${index}`,
      eventId: event.hash,
      itemIndex: index,
      ordinal,
      role: message.role,
      ...displayTranscriptText(message.content),
    };
    rows.push(row);
    bytes += Buffer.byteLength(JSON.stringify(row));
    while (rows.length > limit || bytes > MAX_PAGE_BYTES)
      bytes -= Buffer.byteLength(JSON.stringify(rows.shift()));
  }
  function append(message, event, index) {
    if (!displayable(message)) return;
    if (ranges.at(-1)?.end === physical) ranges.at(-1).end += 1;
    else {
      if (ranges.length >= MAX_HISTORY_RANGES) {
        const error = new Error(
          "Transcript history has too many disjoint ranges",
        );
        error.code = "SESSION_TRANSCRIPT_HISTORY_LIMIT";
        throw error;
      }
      ranges.push({ start: physical, end: physical + 1 });
    }
    physical += 1;
    collect(message, event, index, count++);
  }
  function rewind(cutoff) {
    let remaining = cutoff;
    ranges = ranges.filter((range) => {
      if (remaining === 0) return false;
      const kept = Math.min(remaining, range.end - range.start);
      range.end = range.start + kept;
      remaining -= kept;
      return true;
    });
    count = cutoff;
    rows = [];
    bytes = 0;
    needsReplay = true;
  }
  function boundary(event, reason) {
    coverage = { kind: "snapshot-boundary", boundaryEvent: event.hash, reason };
  }
  return {
    accept(event) {
      if (!HASH.test(event.hash))
        throw new TypeError("verified event hash required");
      eventCount += 1;
      generation ||= event.hash;
      const messages = eventMessages(event);
      if (
        ["compact", "checkpoint_timeline_commit"].includes(event.type) &&
        Array.isArray(event.data?.messages)
      ) {
        const cutoff =
          event.type === "checkpoint_timeline_commit"
            ? origins.rewind(event, count)
            : null;
        if (cutoff !== null) {
          rewind(cutoff);
          generation = event.hash;
          physical += messages.filter(displayable).length;
        } else if (
          event.type === "compact" &&
          count > 0 &&
          isContextCompaction(event.data)
        ) {
          origins.compact(event.data);
          physical += messages.filter(displayable).length;
        } else {
          // Legacy or unverifiable lineage can authorize only its snapshot.
          generation = event.hash;
          count = 0;
          bytes = 0;
          rows = [];
          ranges = [];
          needsReplay = false;
          origins.snapshot(messages);
          boundary(
            event,
            event.type === "checkpoint_timeline_commit"
              ? "timeline-replacement"
              : "context-snapshot",
          );
          messages.forEach((message, index) => append(message, event, index));
        }
      } else if (event.type === "session_branch") {
        boundary(event, "branch-snapshot");
      } else {
        messages.forEach((message, index) => {
          origins.appendPersisted(message, count);
          append(message, event, index);
        });
      }
      if (anchor && eventCount === anchor.eventCount) {
        anchored =
          event.hash === anchor.revision &&
          anchor.before <= count &&
          generation === anchor.generation;
      }
    },
    finish(authority) {
      if (anchor && (!anchored || generation !== anchor.generation))
        throw staleCursor();
      if (needsReplay) {
        // Scan under the same store lock and revalidate the same exact head.
        // Even a rewind into a prefix older than the page buffer stays bounded.
        rows = [];
        bytes = 0;
        let source = 0;
        let rangeIndex = 0;
        let ordinal = 0;
        authority.replayEvents((event) => {
          eventMessages(event).forEach((message, index) => {
            if (!displayable(message)) return;
            while (ranges[rangeIndex] && source >= ranges[rangeIndex].end)
              rangeIndex += 1;
            const range = ranges[rangeIndex];
            if (range && source >= range.start)
              collect(message, event, index, ordinal++);
            source += 1;
          });
        });
        if (ordinal !== count || source !== physical)
          throw new Error(
            "Transcript history replay did not match its selection",
          );
      }
      const first = rows[0]?.ordinal ?? 0;
      return {
        schema: SCHEMA,
        sessionId,
        generation,
        revision: authority.headHash,
        eventCount: authority.eventCount,
        totalMessages: count,
        messages: rows,
        nextCursor:
          first > 0
            ? Buffer.from(
                JSON.stringify({
                  v: 2,
                  sessionId,
                  generation,
                  revision: authority.headHash,
                  eventCount: authority.eventCount,
                  before: first,
                }),
              ).toString("base64url")
            : null,
        contextOnly: false,
        coverage,
      };
    },
  };
}

export function readSessionTranscriptHistory(sessionId, options = {}) {
  return readVerifiedProjection(sessionId, () =>
    createSessionTranscriptHistoryProjection(sessionId, options),
  );
}

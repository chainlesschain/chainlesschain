import { canonicalDigest } from "@chainlesschain/context-memory-kernel";
import {
  readVerifiedProjection,
  projectWsTurnMessages,
} from "../harness/jsonl-session-store.js";
import { contextItemsToMessages } from "./context-memory-kernel/message-adapter.js";
import {
  displayTranscriptText,
  transcriptTextParts,
  boundTranscriptRow,
} from "./session-transcript-page.js";
import { createSessionHistoryOrigins } from "./session-history-origins.js";
import { getDurableSystemMessageProvenance } from "./session-message-provenance.js";
import {
  BRANCH_HISTORY_SCHEMA,
  BRANCH_HISTORY_SYSTEM_ORIGINS_SCHEMA,
  BRANCH_HISTORY_MESSAGE,
  branchContextDigest,
  withSessionBranchHistory,
  createBranchHistoryImport,
} from "./session-branch-history.js";

const HASH = /^[a-f0-9]{64}$/u;
const SCHEMA = "chainlesschain.session-transcript-page/v2";
const CHANGES_SCHEMA = "chainlesschain.session-transcript-changes/v1";
const MAX_PAGE_BYTES = 1024 * 1024;
const MAX_HISTORY_RANGES = 16384;

// Enumerate all possible display sources, including replacement snapshots.
// Their physical sequence never changes when the selected history rewinds.
function eventMessages(event, imported = null) {
  if (event.type === BRANCH_HISTORY_MESSAGE)
    return imported?.kind === "archive" ? [imported.message] : [];
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
  { limit = 50, cursor = null, after = null } = {},
  branch = null,
) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new TypeError("transcript page limit must be 1–100");
  if (cursor !== null && after !== null)
    throw new TypeError(
      "History before and after cursors are mutually exclusive",
    );
  const incremental = after !== null;
  const encodedCursor = incremental ? after : cursor;
  let anchor = null;
  if (encodedCursor !== null) {
    if (
      typeof encodedCursor !== "string" ||
      !/^[\w-]{1,1024}$/u.test(encodedCursor)
    )
      throw new TypeError("invalid transcript history cursor");
    try {
      anchor = JSON.parse(
        Buffer.from(encodedCursor, "base64url").toString("utf8"),
      );
    } catch {
      throw new TypeError("invalid transcript history cursor");
    }
    if (
      !anchor ||
      anchor.sessionId !== sessionId ||
      !HASH.test(anchor.generation) ||
      !HASH.test(anchor.revision) ||
      !Number.isSafeInteger(anchor.eventCount) ||
      anchor.eventCount < 1 ||
      (incremental
        ? anchor.v !== 1 ||
          anchor.view !== "history-sync" ||
          !Number.isSafeInteger(anchor.offset) ||
          anchor.offset < 0
        : anchor.v !== 2 ||
          !Number.isSafeInteger(anchor.before) ||
          anchor.before < 1)
    )
      throw new TypeError("invalid transcript history cursor");
  }
  let generation = null;
  let eventCount = 0;
  let count = 0;
  let bytes = 0;
  let rows = [];
  let incrementalFull = false;
  let anchored = !anchor;
  let coverage = { kind: "from-origin", boundaryEvent: null, reason: null };
  const origins = createSessionHistoryOrigins();
  const branchImport = createBranchHistoryImport();
  let physical = 0;
  let ranges = [];
  let needsReplay = false;

  function displayRow(message, event, index, ordinal) {
    return boundTranscriptRow({
      id: `${sessionId}:${event.hash}:${index}`,
      eventId: event.hash,
      itemIndex: index,
      ordinal,
      role: message.role,
      ...displayTranscriptText(message.content),
    });
  }
  function collect(message, event, index, ordinal) {
    if (incremental) {
      if (ordinal < anchor.offset || incrementalFull) return;
    } else if (anchor && ordinal >= anchor.before) return;
    const row = displayRow(message, event, index, ordinal);
    const rowBytes = Buffer.byteLength(JSON.stringify(row));
    if (
      incremental &&
      (rows.length >= limit || bytes + rowBytes > MAX_PAGE_BYTES)
    ) {
      // Keep the FIRST contiguous prefix after the cursor. Skipping an oversized
      // next row and admitting later small rows would permanently omit messages.
      incrementalFull = true;
      return;
    }
    rows.push(row);
    bytes += rowBytes;
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
    incrementalFull = false;
    needsReplay = true;
  }
  function boundary(event, reason) {
    coverage = { kind: "snapshot-boundary", boundaryEvent: event.hash, reason };
  }
  function visitSelected(authority, visit) {
    let source = 0;
    let rangeIndex = 0;
    let ordinal = 0;
    const replayImport = createBranchHistoryImport();
    authority.replayEvents((event) => {
      const imported = replayImport.accept(event);
      eventMessages(event, imported).forEach((message, index) => {
        if (!displayable(message)) return;
        while (ranges[rangeIndex] && source >= ranges[rangeIndex].end)
          rangeIndex += 1;
        const range = ranges[rangeIndex];
        if (range && source >= range.start)
          visit(message, event, index, ordinal++);
        source += 1;
      });
    });
    replayImport.finish();
    if (ordinal !== count || source !== physical)
      throw new Error("Transcript history replay did not match its selection");
  }
  return {
    accept(event) {
      if (!HASH.test(event.hash))
        throw new TypeError("verified event hash required");
      eventCount += 1;
      generation ||= event.hash;
      const imported = branchImport.accept(event);
      const messages = eventMessages(event, imported);
      if (imported?.kind === "start") {
        coverage = { ...imported.coverage };
      } else if (imported?.kind === "archive") {
        append(messages[0], event, 0);
      } else if (imported?.kind === "archive-part") {
        // A logical row may span several bounded persistence records.
      } else if (imported?.kind === "context") {
        physical += messages.filter(displayable).length;
      } else if (imported?.kind === "origin") {
        origins.appendMappedPersisted(imported.message, imported.origin);
      } else if (imported?.kind === "complete") {
        // The complete import is independently anchored in this session.
      } else if (
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
          event.type === "checkpoint_timeline_commit" &&
          origins.summarize(event)
        ) {
          // The verified rewrite changes model context only. Original rows,
          // coverage and old display cursors continue to describe the archive.
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
          incrementalFull = false;
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
          (incremental ? anchor.offset : anchor.before) <= count &&
          generation === anchor.generation;
      }
    },
    finish(authority) {
      branchImport.finish();
      if (branch) {
        const prefix = origins.branchPrefix(
          branch.messages,
          authority.headHash,
          count,
        );
        if (!prefix) return branch.consume(null);
        rewind(prefix.cutoff);
        const contextEntries = prefix.entries.filter(
          ({ message }) =>
            ["user", "assistant"].includes(message.role) ||
            (message.role === "system" &&
              getDurableSystemMessageProvenance(message)),
        );
        const contextOrigins = contextEntries.map(({ origin }) => origin);
        return withSessionBranchHistory(
          {
            parentSessionId: sessionId,
            contextDigest: branchContextDigest(branch.messages),
            contextOrigins,
            descriptor: {
              schema: contextEntries.some(
                ({ message, origin }) => message.role === "system" && origin,
              )
                ? BRANCH_HISTORY_SYSTEM_ORIGINS_SCHEMA
                : BRANCH_HISTORY_SCHEMA,
              sourceGeneration: generation,
              totalMessages: count,
              contextMessageCount: contextOrigins.length,
              coverage: { ...coverage },
            },
            visit(visitor) {
              visitSelected(authority, (message, event, index) => {
                visitor({
                  role: message.role,
                  text: transcriptTextParts(message.content).join(""),
                  sourceEventId: event.hash,
                  sourceItemIndex: index,
                });
              });
            },
          },
          branch.consume,
        );
      }
      if (anchor && (!anchored || generation !== anchor.generation))
        throw staleCursor();
      if (needsReplay) {
        // Scan under the same store lock and revalidate the same exact head.
        // Even a rewind into a prefix older than the page buffer stays bounded.
        rows = [];
        bytes = 0;
        incrementalFull = false;
        visitSelected(authority, collect);
      }
      const first = rows[0]?.ordinal ?? 0;
      const snapshot = {
        sessionId,
        generation,
        revision: authority.headHash,
        eventCount: authority.eventCount,
        totalMessages: count,
        messages: rows,
        contextOnly: false,
        coverage,
      };
      const syncCursor = (offset) =>
        Buffer.from(
          JSON.stringify({
            v: 1,
            view: "history-sync",
            sessionId,
            generation,
            revision: authority.headHash,
            eventCount: authority.eventCount,
            offset,
          }),
        ).toString("base64url");
      if (incremental) {
        const nextOffset = rows.length
          ? rows.at(-1).ordinal + 1
          : anchor.offset;
        return {
          schema: CHANGES_SCHEMA,
          ...snapshot,
          from: anchor.offset,
          nextCursor: syncCursor(nextOffset),
          hasMore: nextOffset < count,
        };
      }
      return {
        schema: SCHEMA,
        ...snapshot,
        // Only the latest page establishes an update baseline. Older navigation
        // must not advance it past messages the latest view has not received.
        syncCursor:
          !anchor && authority.eventCount > 0 ? syncCursor(count) : null,
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
      };
    },
  };
}

export function createSessionTranscriptBranchProjection(
  sessionId,
  messages,
  consume,
) {
  if (
    !Array.isArray(messages) ||
    typeof consume !== "function" ||
    consume.constructor?.name === "AsyncFunction"
  )
    throw new TypeError(
      "Branch history requires messages and a synchronous consumer",
    );
  return createSessionTranscriptHistoryProjection(
    sessionId,
    {},
    { messages, consume },
  );
}

export function readSessionTranscriptHistory(sessionId, options = {}) {
  return readVerifiedProjection(sessionId, () =>
    createSessionTranscriptHistoryProjection(sessionId, options),
  );
}

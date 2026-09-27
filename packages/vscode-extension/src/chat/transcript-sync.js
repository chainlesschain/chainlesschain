const { runCliResult } = require("./introspect-commands");

const hash = (s) =>
  typeof s === "string" && /^[a-f0-9]{64}$/u.test(s) && s.length === 64;
const integer = (n) => Number.isSafeInteger(n) && n >= 0;

function decodeSyncCursor(value, sessionId) {
  if (typeof value !== "string" || !/^[\w-]{1,1024}$/u.test(value))
    throw new Error("Invalid transcript sync cursor");
  const cursor = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  if (
    cursor?.v !== 1 ||
    cursor.view !== "history-sync" ||
    cursor.sessionId !== sessionId ||
    !hash(cursor.generation) ||
    !hash(cursor.revision) ||
    !integer(cursor.eventCount) ||
    cursor.eventCount === 0 ||
    !integer(cursor.offset)
  )
    throw new Error("Invalid transcript sync cursor");
  return cursor;
}

function validateSyncCursor(value, page, offset) {
  const cursor = decodeSyncCursor(value, page.sessionId);
  if (
    cursor.generation !== page.generation ||
    cursor.revision !== page.revision ||
    cursor.eventCount !== page.eventCount ||
    cursor.offset !== offset
  )
    throw new Error("Inconsistent transcript sync boundary");
  return cursor;
}

function resultTranscriptReferences(event, sessionId) {
  const refs = event?.transcript_refs;
  if (
    event?.type !== "result" ||
    event.session_id !== sessionId ||
    refs?.schema !== "chainlesschain.session-transcript-references/v1" ||
    refs.sessionId !== sessionId ||
    !hash(refs.assistantEventId) ||
    (refs.userEventId !== undefined && !hash(refs.userEventId)) ||
    (refs.clientMessageId !== undefined &&
      (typeof refs.clientMessageId !== "string" ||
        !/^[a-zA-Z0-9_-]{1,80}$/u.test(refs.clientMessageId) ||
        /[^a-zA-Z0-9_-]/u.test(refs.clientMessageId))) ||
    Object.keys(refs).some(
      (key) =>
        ![
          "schema",
          "sessionId",
          "assistantEventId",
          "userEventId",
          "clientMessageId",
        ].includes(key),
    )
  )
    return null;
  return refs;
}

function parseTranscriptChanges(stdout, sessionId, cursor) {
  if (typeof stdout !== "string" || Buffer.byteLength(stdout) > 2 * 1024 * 1024)
    throw new Error("Transcript update exceeds the response limit");
  const page = JSON.parse(stdout);
  const anchor = decodeSyncCursor(cursor, sessionId);
  const { validateTranscriptRows } = require("./transcript-cache");
  validateTranscriptRows(page, sessionId);
  if (
    page.schema !== "chainlesschain.session-transcript-changes/v1" ||
    page.generation !== anchor.generation ||
    page.eventCount < anchor.eventCount ||
    page.from !== anchor.offset ||
    page.totalMessages < page.from ||
    (page.messages.length
      ? page.messages[0].ordinal !== page.from
      : page.totalMessages !== page.from) ||
    typeof page.hasMore !== "boolean"
  )
    throw new Error("Invalid transcript update boundary");
  const end = page.from + page.messages.length;
  validateSyncCursor(page.nextCursor, page, end);
  if (
    page.hasMore !== end < page.totalMessages ||
    (page.eventCount === anchor.eventCount && page.revision !== anchor.revision)
  )
    throw new Error("Inconsistent transcript update boundary");
  return page;
}

async function loadTranscriptChanges({ sessionId, cursor, ...options }) {
  if (typeof sessionId !== "string" || !/^[\w.:-]{1,256}$/u.test(sessionId))
    throw new Error("Invalid session ID");
  decodeSyncCursor(cursor, sessionId);
  const result = await runCliResult({
    ...options,
    maxBufferBytes: 2 * 1024 * 1024,
    args: [
      "session",
      "show",
      "--json",
      "--history",
      "--after",
      cursor,
      "--page-size",
      "50",
      "--",
      sessionId,
    ],
  });
  if (!result.ok) {
    const error = new Error(
      (result.text || "Could not update saved conversation").slice(0, 1000),
    );
    try {
      const failure = JSON.parse(result.stdout);
      if (
        failure?.schema ===
          "chainlesschain.session-transcript-changes-error/v1" &&
        failure.sessionId === sessionId &&
        failure.code === "SESSION_TRANSCRIPT_CURSOR_STALE"
      )
        error.code = failure.code;
    } catch {
      /* Non-JSON and integrity errors are never cursor expiration. */
    }
    throw error;
  }
  return parseTranscriptChanges(result.stdout, sessionId, cursor);
}

/** Apply only verified rows. Live references are candidates, never saved rows. */
function mergeTranscript(conv, page, { baseline = false } = {}) {
  const previous = conv.transcript || [];
  const incoming = new Map(page.messages.map((row) => [row.id, row]));
  const candidates = new Map();
  for (const row of previous) {
    if (!row.id && row.eventRef && row.referenceSession === page.sessionId) {
      const key = `${row.role}:${row.eventRef}`;
      const list = candidates.get(key) || [];
      list.push(row);
      candidates.set(key, list);
    }
  }
  const replacements = new Map();
  const removed = new Set();
  const seen = new Set();
  const verified = new Map(
    (baseline ? [] : previous.filter((row) => row.id)).map((row) => [
      row.id,
      row,
    ]),
  );
  for (const saved of page.messages) verified.set(saved.id, saved);
  for (const saved of verified.values()) {
    const existing = previous.find((row) => row.id === saved.id);
    const matches = candidates.get(`${saved.role}:${saved.eventId}`) || [];
    const live =
      !existing && saved.itemIndex === 0 && matches.length > 0
        ? matches[0]
        : null;
    const old = existing || live;
    if (old) {
      replacements.set(old, { ...saved, viewId: old.viewId || saved.id });
      seen.add(saved.id);
    }
    if (saved.itemIndex === 0)
      for (const match of matches) if (match !== old) removed.add(match);
  }
  let rows = previous.flatMap((row) => {
    if (removed.has(row)) return [];
    if (replacements.has(row)) return [replacements.get(row)];
    if (row.id && baseline && !incoming.has(row.id)) return [];
    return [row];
  });
  // Replace known rows before inserting unseen predecessors, so local tool and
  // diagnostic entries stay beside the live messages that originally surrounded them.
  for (const saved of page.messages) {
    if (seen.has(saved.id) || rows.some((row) => row.id === saved.id)) continue;
    const next = rows.findIndex((row) => row.id && row.ordinal > saved.ordinal);
    rows.splice(next < 0 ? rows.length : next, 0, {
      ...saved,
      viewId: saved.id,
    });
  }
  // Queued local inputs can be displayed before the preceding turn finishes.
  // Saved rows use canonical order; unassociated live entries retain their slots.
  const durable = rows
    .filter((row) => row.id)
    .sort((a, b) => a.ordinal - b.ordinal);
  let index = 0;
  rows = rows.map((row) => (row.id ? durable[index++] : row));
  let chars = rows.reduce((sum, row) => sum + row.text.length, 0);
  while (rows.length > 100 || chars > 500000) {
    chars -= rows.shift().text.length;
    conv.transcriptTrimmed = true;
  }
  conv.transcript = rows;
  conv.transcriptSyncCursor = baseline
    ? page.syncCursor || null
    : page.nextCursor;
  const first = rows.find((row) => row.id)?.ordinal ?? page.totalMessages;
  conv.transcriptPageMetadata = {
    sessionId: page.sessionId,
    generation: page.generation,
    revision: page.revision,
    contextOnly: false,
    coverage: page.coverage,
    nextCursor:
      first > 0
        ? Buffer.from(
            JSON.stringify({
              v: 2,
              sessionId: page.sessionId,
              generation: page.generation,
              revision: page.revision,
              eventCount: page.eventCount,
              before: first,
            }),
          ).toString("base64url")
        : null,
  };
  conv.transcriptRevision = (conv.transcriptRevision || 0) + 1;
}

module.exports = {
  decodeSyncCursor,
  validateSyncCursor,
  resultTranscriptReferences,
  parseTranscriptChanges,
  loadTranscriptChanges,
  mergeTranscript,
};

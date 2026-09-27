const { runCliResult } = require("./introspect-commands");
const { randomUUID } = require("crypto");
const owners = new WeakMap();

const MAX_CHARS = 200000;
function acceptTranscriptInputReceipt(conv, event, source) {
  const receipt = event?.receipt;
  const hash = (value) =>
    typeof value === "string" &&
    value.length === 64 &&
    /^[a-f0-9]{64}$/u.test(value);
  if (
    !source ||
    event?.type !== "system" ||
    event.subtype !== "input_accepted" ||
    event.session_id !== conv.sessionId ||
    receipt?.sessionId !== conv.sessionId ||
    typeof event.client_message_id !== "string" ||
    receipt.clientMessageId !== event.client_message_id ||
    !hash(receipt.eventHash) ||
    !hash(receipt.inputDigest) ||
    typeof receipt.duplicate !== "boolean"
  )
    return;
  for (const row of conv.transcript || []) {
    if (
      row.role === "user" &&
      !row.id &&
      owners.get(row) === source &&
      row.clientMessageId === receipt.clientMessageId
    ) {
      row.eventRef = receipt.eventHash;
      row.referenceSession = conv.sessionId;
      conv.transcriptRevision = (conv.transcriptRevision || 0) + 1;
    }
  }
}
function bound(text) {
  text = String(text || "");
  return text.length <= MAX_CHARS
    ? text
    : text.slice(0, 99950) +
        "\n… [earlier content omitted] …\n" +
        text.slice(-99950);
}
function appendTranscript(conv, message, source = null) {
  if (!message) return;
  if (message.kind === "exited") {
    for (const row of conv.transcript || [])
      if (row.streaming) {
        row.streaming = false;
        conv.transcriptRevision = (conv.transcriptRevision || 0) + 1;
      }
    return;
  }
  if (!["delta", "user", "tool", "error", "turn_end"].includes(message.kind))
    return;
  conv.transcriptRevision = (conv.transcriptRevision || 0) + 1;
  const rows = conv.transcript || (conv.transcript = []);
  const last = rows.at(-1);
  let added = null;
  const append = (row) => {
    row.viewId = row.clientMessageId
      ? `input:${row.clientMessageId}`
      : `live:${randomUUID()}`;
    owners.set(row, source);
    rows.push(row);
    added = row;
    return row;
  };
  if (message.kind === "delta") {
    if (last?.streaming && owners.get(last) === source) {
      last.text = bound(last.text + message.text);
      added = last;
    } else
      append({
        role: "assistant",
        text: bound(message.text),
        streaming: true,
      });
  } else if (["user", "tool", "error"].includes(message.kind)) {
    if (last) last.streaming = false;
    append({
      role: message.kind,
      text: bound(
        message.kind === "tool"
          ? `${message.tool}: ${message.summary || ""}`
          : message.text,
      ),
      ...(message.clientMessageId
        ? { clientMessageId: message.clientMessageId }
        : {}),
    });
  } else if (message.kind === "turn_end") {
    if (last?.streaming && owners.get(last) === source) {
      if (message.finalText != null) last.text = bound(message.finalText);
      last.streaming = false;
      added = last;
    } else if (
      (message.finalText != null && message.refs) ||
      (!message.isError &&
        !message.terminalNotice &&
        (message.finalText || message.text))
    )
      append({
        role: "assistant",
        text: bound(message.finalText ?? message.text),
      });
    if (source && message.refs && added?.role === "assistant") {
      added.eventRef = message.refs.assistantEventId;
      added.referenceSession = message.refs.sessionId;
      if (message.refs.clientMessageId && message.refs.userEventId) {
        const matches = rows.filter(
          (row) =>
            row.role === "user" &&
            !row.id &&
            row.clientMessageId === message.refs.clientMessageId &&
            owners.get(row) === source,
        );
        if (matches.length === 1) {
          matches[0].eventRef = message.refs.userEventId;
          matches[0].referenceSession = message.refs.sessionId;
        }
      }
    }
    if ((message.isError || message.terminalNotice) && message.text) {
      const finalRow = added;
      append({
        role: message.isError ? "error" : "info",
        text: bound(message.text),
      });
      added = finalRow;
    }
    for (const row of rows) row.streaming = false;
  }
  let chars = rows.reduce((n, row) => n + row.text.length, 0);
  while (rows.length > 100 || chars > 500000) {
    chars -= rows.shift().text.length;
    conv.transcriptTrimmed = true;
  }
  return added;
}

async function loadTranscriptPage({ sessionId, cursor = null, ...options }) {
  if (typeof sessionId !== "string" || !/^[\w.:-]{1,256}$/u.test(sessionId))
    throw new Error("Invalid session ID");
  if (
    cursor !== null &&
    (typeof cursor !== "string" || !/^[\w-]{1,1024}$/u.test(cursor))
  )
    throw new Error("Invalid transcript cursor");
  const result = await runCliResult({
    ...options,
    maxBufferBytes: 2 * 1024 * 1024,
    args: [
      "session",
      "show",
      "--json",
      "--history",
      "--page-size",
      "50",
      ...(cursor ? ["--before", cursor] : []),
      "--",
      sessionId,
    ],
  });
  if (!result.ok)
    throw new Error(result.text || "Could not load saved conversation");
  return parseTranscriptPage(result.stdout, sessionId);
}

function parseTranscriptPage(stdout, sessionId) {
  if (typeof stdout !== "string" || Buffer.byteLength(stdout) > 2 * 1024 * 1024)
    throw new Error("Transcript page exceeds the response limit");
  const page = JSON.parse(stdout);
  validateTranscriptRows(page, sessionId);
  if (
    page.schema !== "chainlesschain.session-transcript-page/v2" ||
    (page.totalMessages > 0 && page.messages.length === 0)
  )
    throw new Error("Unsupported transcript page; update the cc CLI");
  if (page.syncCursor != null) {
    require("./transcript-sync").validateSyncCursor(
      page.syncCursor,
      page,
      page.totalMessages,
    );
    if (
      page.totalMessages > 0 &&
      page.messages.at(-1)?.ordinal !== page.totalMessages - 1
    )
      throw new Error("Invalid latest transcript boundary");
  }
  validateOlderCursor(page, sessionId);
  return page;
}

function validateTranscriptRows(page, sessionId) {
  const hash = {
    test: (s) =>
      typeof s === "string" && s.length === 64 && /^[a-f0-9]{64}$/u.test(s),
  };
  const nonnegative = (n) => Number.isSafeInteger(n) && n >= 0;
  if (
    page?.sessionId !== sessionId ||
    !nonnegative(page.eventCount) ||
    !nonnegative(page.totalMessages) ||
    (page.eventCount === 0
      ? page.generation !== null ||
        page.revision !== null ||
        page.totalMessages !== 0
      : !hash.test(page.generation) || !hash.test(page.revision)) ||
    page.contextOnly !== false ||
    !["from-origin", "snapshot-boundary"].includes(page.coverage?.kind) ||
    (page.coverage.kind === "from-origin"
      ? page.coverage.boundaryEvent !== null || page.coverage.reason !== null
      : !hash.test(page.coverage.boundaryEvent) ||
        ![
          "timeline-replacement",
          "context-snapshot",
          "branch-snapshot",
        ].includes(page.coverage.reason)) ||
    !Array.isArray(page.messages) ||
    page.messages.length > 100 ||
    page.messages.length > page.totalMessages ||
    page.messages.some(
      (m, index) =>
        !["user", "assistant", "tool"].includes(m?.role) ||
        !hash.test(m.eventId) ||
        !nonnegative(m.itemIndex) ||
        m.id !== `${sessionId}:${m.eventId}:${m.itemIndex}` ||
        !nonnegative(m.ordinal) ||
        m.ordinal >= page.totalMessages ||
        (index > 0 && m.ordinal !== page.messages[index - 1].ordinal + 1) ||
        typeof m.truncated !== "boolean" ||
        typeof m.text !== "string" ||
        m.text.length > MAX_CHARS,
    ) ||
    new Set(page.messages.map((m) => m.id)).size !== page.messages.length
  ) {
    throw new Error("Unsupported transcript page; update the cc CLI");
  }
}

function validateOlderCursor(page, sessionId) {
  if (
    page.nextCursor !== null &&
    (typeof page.nextCursor !== "string" ||
      !/^[\w-]{1,1024}$/u.test(page.nextCursor))
  )
    throw new Error("Invalid transcript page cursor");
  const first = page.messages[0]?.ordinal ?? 0;
  const hasEarlier = first > 0;
  if (hasEarlier !== (page.nextCursor !== null))
    throw new Error("Invalid transcript page boundary");
  if (page.nextCursor) {
    const next = JSON.parse(
      Buffer.from(page.nextCursor, "base64url").toString("utf8"),
    );
    if (
      next.v !== 2 ||
      next.sessionId !== sessionId ||
      next.generation !== page.generation ||
      next.revision !== page.revision ||
      next.eventCount !== page.eventCount ||
      next.before !== first
    )
      throw new Error("Invalid transcript page boundary");
  }
}

module.exports = {
  acceptTranscriptInputReceipt,
  appendTranscript,
  loadTranscriptPage,
  parseTranscriptPage,
  validateTranscriptRows,
};

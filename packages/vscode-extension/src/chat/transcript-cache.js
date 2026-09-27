const { runCliResult } = require("./introspect-commands");

const MAX_CHARS = 200000;
function bound(text) {
  text = String(text || "");
  return text.length <= MAX_CHARS
    ? text
    : text.slice(0, 99950) +
        "\n… [earlier content omitted] …\n" +
        text.slice(-99950);
}
function appendTranscript(conv, message) {
  if (!message) return;
  conv.transcriptRevision = (conv.transcriptRevision || 0) + 1;
  const rows = conv.transcript || (conv.transcript = []);
  const last = rows.at(-1);
  if (message.kind === "delta") {
    if (last?.streaming) last.text = bound(last.text + message.text);
    else
      rows.push({
        role: "assistant",
        text: bound(message.text),
        streaming: true,
      });
  } else if (message.kind === "user" || message.kind === "tool") {
    if (last) last.streaming = false;
    rows.push({
      role: message.kind,
      text: bound(message.text || `${message.tool}: ${message.summary || ""}`),
    });
  } else if (message.kind === "turn_end") {
    if (last?.streaming) {
      if (message.finalText != null) last.text = bound(message.finalText);
      last.streaming = false;
    } else if (!message.isError && (message.finalText || message.text))
      rows.push({
        role: "assistant",
        text: bound(message.finalText || message.text),
      });
    if (message.isError && message.text)
      rows.push({ role: "error", text: bound(message.text) });
  }
  let chars = rows.reduce((n, row) => n + row.text.length, 0);
  while (rows.length > 100 || chars > 500000) {
    chars -= rows.shift().text.length;
    conv.transcriptTrimmed = true;
  }
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
  const hash = /^[a-f0-9]{64}$/u;
  const nonnegative = (n) => Number.isSafeInteger(n) && n >= 0;
  if (
    page?.schema !== "chainlesschain.session-transcript-page/v2" ||
    page.sessionId !== sessionId ||
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
    (page.totalMessages > 0 && page.messages.length === 0) ||
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
  return page;
}

module.exports = { appendTranscript, loadTranscriptPage, parseTranscriptPage };

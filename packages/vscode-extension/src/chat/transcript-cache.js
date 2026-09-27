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
      "--page-size",
      "50",
      ...(cursor ? ["--before", cursor] : []),
      "--",
      sessionId,
    ],
  });
  if (!result.ok)
    throw new Error(result.text || "Could not load saved conversation");
  const page = JSON.parse(result.stdout);
  if (
    page?.schema !== "chainlesschain.session-transcript-page/v1" ||
    page.sessionId !== sessionId ||
    !Array.isArray(page.messages) ||
    page.messages.length > 100 ||
    page.messages.some(
      (m) =>
        !["user", "assistant", "tool"].includes(m?.role) ||
        typeof m.text !== "string" ||
        m.text.length > MAX_CHARS,
    )
  ) {
    throw new Error("Unsupported transcript page; update the cc CLI");
  }
  if (
    page.nextCursor !== null &&
    (typeof page.nextCursor !== "string" ||
      !/^[\w-]{1,1024}$/u.test(page.nextCursor))
  )
    throw new Error("Invalid transcript page cursor");
  return page;
}

module.exports = { appendTranscript, loadTranscriptPage };

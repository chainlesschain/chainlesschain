"use strict";
// Passive diagnostic observer only: no fetch wrapper, dispatcher, or retries.
const fs = require("node:fs");
const dc = require("node:diagnostics_channel");
const { performance } = require("node:perf_hooks");
const file = process.env.CC_TURN_DIAGNOSTIC_CHILD_FILE;
let brokerOrigin = null;
try {
  const url = new URL(process.env.CC_TURN_DIAGNOSTIC_BROKER_ORIGIN);
  if (url.protocol === "http:" && url.hostname === "127.0.0.1") {
    brokerOrigin = url.origin;
  }
} catch {
  // Missing coordinates must not broaden observation to other providers.
}
if (file && brokerOrigin) {
  let fd;
  let count = 0;
  let bytes = 0;
  let stopped = false;
  const started = performance.now();
  const requestIds = new WeakMap();
  let requestCount = 0;
  const errors = new Set([
    "UND_ERR_SOCKET",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_HEADERS_TIMEOUT",
    "UND_ERR_BODY_TIMEOUT",
    "UND_ERR_ABORTED",
    "ECONNRESET",
    "ECONNREFUSED",
    "ETIMEDOUT",
    "EPIPE",
    "ABORT_ERR",
  ]);
  try {
    fd = fs.openSync(file, "wx", 0o600);
  } catch {
    stopped = true;
  }
  function append(event, extra = {}) {
    if (stopped) return;
    try {
      const limited = count >= 2047 || bytes >= 1024 * 1024 - 1024;
      const cpu = process.cpuUsage();
      const line = Buffer.from(
        JSON.stringify({
          schema: "chainlesschain.duplex-turn-child-diagnostic/v1",
          sequence: count++,
          at: new Date().toISOString(),
          elapsedMs: performance.now() - started,
          event: limited ? "truncated" : event,
          cpuUserMicros: cpu.user,
          cpuSystemMicros: cpu.system,
          rssBytes: process.memoryUsage.rss(),
          ...(limited ? {} : extra),
        }) + "\n",
      );
      let offset = 0;
      while (offset < line.length) {
        const written = fs.writeSync(fd, line, offset, line.length - offset);
        if (!written) throw new Error("diagnostic-write-failed");
        offset += written;
      }
      bytes += line.length;
      if (limited) stopped = true;
    } catch {
      stopped = true;
    }
  }
  append("enabled", { passive: true, maxRecords: 2048, maxBytes: 1024 * 1024 });
  for (const name of [
    "undici:request:create",
    "undici:request:bodySent",
    "undici:request:headers",
    "undici:request:trailers",
    "undici:request:error",
  ]) {
    dc.channel(name).subscribe((message) => {
      try {
        const request = message.request;
        if (!request || new URL(request.origin).origin !== brokerOrigin) return;
        if (!requestIds.has(request)) requestIds.set(request, ++requestCount);
        append(name, {
          request: requestIds.get(request),
          ...(name === "undici:request:headers"
            ? {
                statusCode: Number.isSafeInteger(message.response?.statusCode)
                  ? message.response.statusCode
                  : null,
              }
            : {}),
          ...(name === "undici:request:error"
            ? {
                errorCode: errors.has(message.error?.code)
                  ? message.error.code
                  : "OTHER",
              }
            : {}),
        });
      } catch {
        /* Observability cannot alter the request. */
      }
    });
  }
  const heartbeat = setInterval(() => append("heartbeat"), 1000);
  heartbeat.unref();
  process.once("exit", () => {
    append("exit");
    clearInterval(heartbeat);
    try {
      if (fd !== undefined) fs.closeSync(fd);
    } catch {
      /* Diagnostic only. */
    }
  });
}

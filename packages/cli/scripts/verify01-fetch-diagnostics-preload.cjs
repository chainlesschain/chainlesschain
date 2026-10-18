"use strict";
// Operator-only passive telemetry. Never wraps fetch or changes a dispatcher.
const file = process.env.CC_VERIFY01_FETCH_DIAGNOSTICS_FILE;
if (file) {
  const fs = require("node:fs");
  const dc = require("node:diagnostics_channel");
  const names = new Set([
    "Error",
    "TypeError",
    "AbortError",
    "TimeoutError",
    "AggregateError",
    "ConnectTimeoutError",
    "HeadersTimeoutError",
    "BodyTimeoutError",
    "SocketError",
    "RequestAbortedError",
    "ClientDestroyedError",
    "ClientClosedError",
  ]);
  const codes = new Set([
    "ECONNRESET",
    "ECONNREFUSED",
    "ENOTFOUND",
    "EAI_AGAIN",
    "ETIMEDOUT",
    "EHOSTUNREACH",
    "ENETUNREACH",
    "EPIPE",
    "ERR_TLS_CERT_ALTNAME_INVALID",
    "DEPTH_ZERO_SELF_SIGNED_CERT",
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    "CERT_HAS_EXPIRED",
    "ERR_INVALID_URL",
    "ABORT_ERR",
    "UND_ERR_SOCKET",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_HEADERS_TIMEOUT",
    "UND_ERR_BODY_TIMEOUT",
    "UND_ERR_ABORTED",
    "UND_ERR_DESTROYED",
    "UND_ERR_CLOSED",
    "UND_ERR_REQ_CONTENT_LENGTH_MISMATCH",
    "UND_ERR_RES_CONTENT_LENGTH_MISMATCH",
    "UND_ERR_INVALID_ARG",
    "UND_ERR_INVALID_RETURN_VALUE",
  ]);
  let fd,
    sequence = 0,
    stored = 0,
    stopped = false;
  let brokerOrigin = null;
  try {
    const u = new URL(process.env.CC_VERIFY01_FETCH_BROKER_ORIGIN);
    if (
      u.protocol === "http:" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)
    )
      brokerOrigin = u.origin;
  } catch {
    /* Unknown endpoint remains unknown. */
  }
  try {
    fd = fs.openSync(file, "wx", 0o600);
  } catch {
    stopped = true;
  }
  function endpoint(message) {
    try {
      const value = message.request?.origin ?? message.connectParams?.origin;
      if (typeof value !== "string" && !(value instanceof URL))
        return "unknown";
      const u = new URL(value);
      if (!["http:", "https:"].includes(u.protocol)) return "unknown";
      return brokerOrigin && u.origin === brokerOrigin
        ? "loopback-broker"
        : "other";
    } catch {
      return "unknown";
    }
  }
  function append(event, extra = {}) {
    if (stopped) return;
    const line = Buffer.from(
      JSON.stringify({
        schema: "chainlesschain.fetch-diagnostics/v1",
        sequence: sequence++,
        at: new Date().toISOString(),
        event,
        ...extra,
      }) + "\n",
    );
    if (stored + line.length > 65536) {
      stopped = true;
      return;
    }
    const before = stored;
    try {
      let offset = 0;
      while (offset < line.length) {
        const n = fs.writeSync(fd, line, offset, line.length - offset);
        if (!n) throw new Error("diagnostic write failed");
        offset += n;
      }
      stored += line.length;
    } catch {
      stopped = true;
      try {
        fs.ftruncateSync(fd, before);
      } catch {
        /* Preserve original error. */
      }
    }
  }
  append("enabled", { passive: true, maxRecords: 128, maxBytes: 65536 });
  for (const event of ["undici:request:error", "undici:client:connectError"]) {
    dc.channel(event).subscribe((message) => {
      try {
        if (stopped) return;
        if (sequence >= 127) {
          append("truncated", { reason: "record-limit" });
          stopped = true;
          return;
        }
        const error = message.error;
        const name = error?.name,
          code = error?.code,
          causeCode = error?.cause?.code;
        append(event, {
          endpoint: endpoint(message),
          error: {
            name: names.has(name) ? name : null,
            code: codes.has(code) ? code : null,
            causeCode: codes.has(causeCode) ? causeCode : null,
          },
        });
      } catch {
        /* A hostile getter or failed sink must not alter application behavior. */
      }
    });
  }
  process.once("exit", () => {
    if (fd !== undefined)
      try {
        fs.closeSync(fd);
      } catch {
        /* Diagnostic only. */
      }
  });
}

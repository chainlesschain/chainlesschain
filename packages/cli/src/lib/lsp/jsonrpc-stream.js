/**
 * LSP transport framing — `Content-Length` header framing for JSON-RPC 2.0
 * over a byte stream (LSP base protocol).
 *
 * The Language Server Protocol frames each JSON-RPC message as:
 *
 *   Content-Length: <N>\r\n
 *   \r\n
 *   <N bytes of UTF-8 JSON>
 *
 * (an optional `Content-Type` header may also appear and is ignored). This
 * module is pure: `encodeMessage` serializes one message, and `MessageBuffer`
 * accumulates arbitrary byte chunks and emits complete decoded messages. No
 * child-process or IO here so it is fully unit-testable.
 */

const HEADER_SEPARATOR = "\r\n\r\n";

/**
 * Serialize a JSON-RPC message object to a framed Buffer ready to write to a
 * language server's stdin. Length is measured in BYTES (UTF-8), not characters
 * — a message with multibyte content otherwise under-reports its length and
 * corrupts the stream.
 */
export function encodeMessage(message) {
  const json = JSON.stringify(message);
  const body = Buffer.from(json, "utf8");
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii");
  return Buffer.concat([header, body]);
}

/**
 * Incremental decoder. Feed it byte chunks (Buffer or string) as they arrive on
 * stdout; call `read()` (or iterate `readAll()`) to pull out every complete
 * message decoded so far. Partial frames are retained until the rest arrives.
 *
 * Robust against: headers and body split across chunks, multiple messages in
 * one chunk, LF-only line endings from lenient servers, and unknown extra
 * headers (e.g. Content-Type).
 */
export class MessageBuffer {
  constructor() {
    /** @type {Buffer} */
    this._buffer = Buffer.alloc(0);
    /** @type {object[]} */
    this._pending = [];
  }

  /** Append a raw chunk (Buffer or utf8 string) and parse what is now complete. */
  append(chunk) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8");
    this._buffer = this._buffer.length
      ? Buffer.concat([this._buffer, buf])
      : buf;
    this._drain();
    return this;
  }

  /** Pull the next decoded message, or null if none are ready. */
  read() {
    return this._pending.length ? this._pending.shift() : null;
  }

  /** Pull every decoded message ready so far (may be empty). */
  readAll() {
    const out = this._pending;
    this._pending = [];
    return out;
  }

  /** True if a partial (undecoded) frame remains in the buffer. */
  get hasPartial() {
    return this._buffer.length > 0;
  }

  _drain() {
    // Loop because a single append can complete several queued frames.
    for (;;) {
      const headerEnd = this._findHeaderEnd();
      if (headerEnd < 0) return; // headers incomplete — wait for more bytes

      const headerText = this._buffer
        .slice(0, headerEnd.index)
        .toString("ascii");
      const contentLength = parseContentLength(headerText);
      if (contentLength == null) {
        // Malformed header block with no Content-Length. Rather than loop
        // forever, drop up to and including the separator and keep going; a
        // conformant server never does this, but a corrupted stream shouldn't
        // deadlock the client.
        this._buffer = this._buffer.slice(headerEnd.bodyStart);
        continue;
      }

      const bodyStart = headerEnd.bodyStart;
      const bodyEnd = bodyStart + contentLength;
      if (this._buffer.length < bodyEnd) return; // body incomplete — wait

      const body = this._buffer.slice(bodyStart, bodyEnd).toString("utf8");
      this._buffer = this._buffer.slice(bodyEnd);
      try {
        this._pending.push(JSON.parse(body));
      } catch {
        // A body that isn't valid JSON is unrecoverable for this frame, but the
        // stream position is now known (we consumed exactly Content-Length
        // bytes) so subsequent frames stay aligned. Skip the bad frame.
      }
    }
  }

  /**
   * Locate the end of the header block. Supports both `\r\n\r\n` (spec) and
   * `\n\n` (lenient servers). Returns `{ index, bodyStart }` where `index` is
   * where the header text ends and `bodyStart` is where the body begins, or -1
   * if the separator hasn't arrived yet.
   */
  _findHeaderEnd() {
    const crlf = this._buffer.indexOf(HEADER_SEPARATOR);
    const lf = this._buffer.indexOf("\n\n");
    if (crlf < 0 && lf < 0) return -1;
    // Pick whichever separator appears first in the stream.
    if (crlf >= 0 && (lf < 0 || crlf <= lf)) {
      return { index: crlf, bodyStart: crlf + HEADER_SEPARATOR.length };
    }
    return { index: lf, bodyStart: lf + 2 };
  }
}

/** Parse the `Content-Length` value from a header block; null if absent/invalid. */
export function parseContentLength(headerText) {
  for (const line of headerText.split(/\r?\n/)) {
    const m = /^content-length:\s*(\d+)\s*$/i.exec(line);
    if (m) {
      const n = Number.parseInt(m[1], 10);
      return Number.isFinite(n) && n >= 0 ? n : null;
    }
  }
  return null;
}

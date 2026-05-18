/**
 * RingBuffer — bounded byte-aware FIFO for PTY stdout chunks.
 *
 * ESM mirror of `desktop-app-vue/src/main/terminal/RingBuffer.js`. Both
 * shells (Electron web-shell + `cc ui`) ship their own copy because the
 * runtime module systems are incompatible (CJS vs ESM). Keep them in
 * sync — future consolidation goes into a workspace package once the
 * surface stabilises.
 */

export class RingBuffer {
  constructor(opts = {}) {
    const maxBytes = opts.maxBytes ?? 256 * 1024;
    if (typeof maxBytes !== "number" || maxBytes <= 0) {
      throw new TypeError("RingBuffer: maxBytes must be a positive number");
    }
    this.maxBytes = maxBytes;
    this._entries = [];
    this._totalBytes = 0;
    this._lastSeq = 0;
    this._firstRetainedSeq = 1;
  }

  push(data) {
    const buf = Buffer.isBuffer(data)
      ? data
      : typeof data === "string"
        ? Buffer.from(data, "utf-8")
        : Buffer.from(data);
    this._lastSeq += 1;
    const seq = this._lastSeq;
    this._entries.push({ seq, data: buf });
    this._totalBytes += buf.byteLength;
    this._evictUntilUnderCap();
    return seq;
  }

  _evictUntilUnderCap() {
    while (this._totalBytes > this.maxBytes && this._entries.length > 0) {
      const evicted = this._entries.shift();
      this._totalBytes -= evicted.data.byteLength;
      this._firstRetainedSeq = evicted.seq + 1;
    }
  }

  since(fromSeq = 0) {
    const truncated = fromSeq > 0 && fromSeq < this._firstRetainedSeq;
    const chunks = this._entries.filter((e) => e.seq >= fromSeq);
    return { chunks, truncated };
  }

  get lastSeq() {
    return this._lastSeq;
  }
  get totalBytes() {
    return this._totalBytes;
  }
  get size() {
    return this._entries.length;
  }
}

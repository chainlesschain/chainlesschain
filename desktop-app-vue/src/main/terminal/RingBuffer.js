/**
 * RingBuffer — bounded byte-aware FIFO for PTY stdout chunks.
 *
 * Each `push(data)` records `{ seq, data }`. When `totalBytes` exceeds
 * `maxBytes`, the oldest entries are dropped until under the cap. `since(fromSeq)`
 * returns all retained entries with `seq >= fromSeq`, plus a flag indicating
 * whether earlier entries were already evicted (so callers can show a
 * "history truncated" UI without guessing).
 *
 * No persistence to disk — terminal stdout commonly contains secrets
 * (API key echoes, git diffs of .env, password mistypes), so the trade-off
 * is "safety > durability". Process restart = empty buffer.
 *
 * `data` is stored as a Node Buffer; `byteLength` derives total cost so
 * UTF-8 multi-byte sequences and ANSI escape blocks aren't undercounted.
 */

class RingBuffer {
  /**
   * @param {object} [opts]
   * @param {number} [opts.maxBytes=262144] byte cap (default 256 KiB)
   */
  constructor(opts = {}) {
    const maxBytes = opts.maxBytes ?? 256 * 1024;
    if (typeof maxBytes !== "number" || maxBytes <= 0) {
      throw new TypeError("RingBuffer: maxBytes must be a positive number");
    }
    this.maxBytes = maxBytes;
    /** @type {Array<{ seq: number, data: Buffer }>} */
    this._entries = [];
    this._totalBytes = 0;
    this._lastSeq = 0;
    // First seq retained AFTER any eviction. Starts at 1 (the seq of the
    // first push that will ever happen). Bumped past evicted entries so
    // `since(fromSeq < _firstRetainedSeq)` knows to set `truncated: true`.
    this._firstRetainedSeq = 1;
  }

  /**
   * Append a chunk. Returns the assigned seq.
   * @param {Buffer | Uint8Array | string} data
   * @returns {number} seq
   */
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

  /**
   * Return all entries with seq >= fromSeq, plus `truncated` indicating
   * whether earlier entries existed but were evicted.
   *
   * @param {number} fromSeq seq inclusive lower bound (fromSeq=0 → from the start)
   * @returns {{ chunks: Array<{ seq: number, data: Buffer }>, truncated: boolean }}
   */
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

module.exports = { RingBuffer };

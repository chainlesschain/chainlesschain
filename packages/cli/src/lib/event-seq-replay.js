/**
 * Event-stream gap-detection + replay primitives — the server→client (event)
 * counterpart to the client→server RemoteCommandLedger (harness/
 * remote-command-ledger.js). Both give a reconnecting peer an at-most-once,
 * totally-ordered view over a lossy transport; the ledger orders *commands*,
 * this orders *events*.
 *
 * A producer keeps a bounded buffer of recently emitted, seq-stamped frames
 * (EventReplayBuffer); a reconnecting consumer reports its last-seen seq and
 * gets the tail re-sent, or is told to full-resync when the missed range has
 * already been evicted. A consumer detects holes with SeqGapTracker.
 *
 * Pure + deterministic: no I/O, no timers, no globals. The `seq` it stamps is
 * the same additive protocol-v1 notion used on the stream-json surface
 * (agent-sdk docs/PROTOCOL.md §1.2.1) — 1-based, monotonic, per producer
 * instance; consumers MUST tolerate its absence and MUST NOT require gap-free
 * numbering across a producer restart (a fresh instance rewinds to 1).
 */

const DEFAULT_MAX_EVENTS = 512;
const DEFAULT_MAX_BYTES = 1 << 20; // 1 MiB — bound memory on a chatty session

/** Best-effort byte size of a frame (overridable for deterministic tests). */
function approxBytes(frame) {
  try {
    return Buffer.byteLength(JSON.stringify(frame));
  } catch {
    return 0; // circular / unserializable — don't let sizing throw
  }
}

/**
 * Producer-side bounded replay buffer. `record(frame)` stamps the next `seq`
 * onto a shallow copy, retains it (evicting the oldest beyond count/byte
 * bounds), and returns the stamped frame ready to send. `replaySince(cursor)`
 * returns the frames a consumer with last-seen seq `cursor` still needs.
 */
export class EventReplayBuffer {
  constructor({
    maxEvents = DEFAULT_MAX_EVENTS,
    maxBytes = DEFAULT_MAX_BYTES,
    sizeOf,
  } = {}) {
    this._max = Math.max(1, Math.floor(maxEvents) || DEFAULT_MAX_EVENTS);
    this._maxBytes = Math.max(0, Math.floor(maxBytes) || 0);
    this._sizeOf = typeof sizeOf === "function" ? sizeOf : approxBytes;
    this._buf = []; // [{ seq, frame, bytes }] oldest → newest
    this._seq = 0;
    this._bytes = 0;
  }

  /** Highest seq stamped so far (0 before anything is recorded). */
  get latestSeq() {
    return this._seq;
  }

  /** Oldest seq still retained (== latestSeq when the buffer is empty). */
  get oldestSeq() {
    return this._buf.length ? this._buf[0].seq : this._seq;
  }

  /** Number of frames currently retained. */
  get size() {
    return this._buf.length;
  }

  /**
   * Stamp the next seq onto `frame` (shallow copy), retain it, evict overflow.
   * @returns the stamped frame (`{ ...frame, seq }`) to hand straight to send.
   */
  record(frame) {
    const seq = ++this._seq;
    const stamped = { ...frame, seq };
    const bytes = this._sizeOf(stamped) || 0;
    this._buf.push({ seq, frame: stamped, bytes });
    this._bytes += bytes;
    this._evict();
    return stamped;
  }

  _evict() {
    // Always keep at least the newest frame even if it alone exceeds maxBytes.
    while (
      this._buf.length > this._max ||
      (this._maxBytes > 0 &&
        this._bytes > this._maxBytes &&
        this._buf.length > 1)
    ) {
      const dropped = this._buf.shift();
      this._bytes -= dropped.bytes;
    }
  }

  /**
   * Frames a consumer whose last-seen seq is `cursor` still needs.
   *  - `cursor >= latestSeq` → nothing missed → `{ frames: [], truncated: false }`.
   *  - `cursor` still within the retained window → the exact tail after it.
   *  - `cursor` older than what's retained → the gap was evicted →
   *    `truncated: true` (consumer MUST full-resync; the returned frames are
   *    only the retained suffix, not the whole hole).
   * @param {number} cursor last seq the consumer acknowledged (default 0 = all)
   */
  replaySince(cursor = 0) {
    const c = Number.isFinite(cursor) ? cursor : 0;
    if (c >= this._seq) {
      return { frames: [], truncated: false, from: c, to: this._seq };
    }
    // The lowest cursor we can honor without a hole is (oldest retained − 1).
    const floor = this._buf.length ? this._buf[0].seq - 1 : this._seq;
    const truncated = c < floor;
    const frames = this._buf.filter((e) => e.seq > c).map((e) => e.frame);
    return { frames, truncated, from: c, to: this._seq };
  }
}

const OK = Object.freeze({ status: "ok" });

/**
 * Consumer-side sequence tracker. Feed it each received frame's `seq`; it
 * reports contiguity so the consumer can request a replay on a hole and drop
 * duplicates a reconnect re-sent. One tracker per producer epoch — reset it
 * when the transport hands you a fresh producer instance (e.g. a non-reattach
 * bg-attach reply), since a fresh producer rewinds seq to 1.
 */
export class SeqGapTracker {
  constructor() {
    this._last = 0;
    this._started = false;
  }

  /** Last contiguous seq accepted (0 before the first frame). */
  get lastSeq() {
    return this._last;
  }

  /**
   * @param {number} seq the received frame's seq (absent/NaN on older
   *   producers that don't stamp — treated as always-ok, never a gap).
   * @returns {{status:"ok"}|{status:"duplicate"}|{status:"gap",from:number,to:number}}
   *   - `ok`: contiguous (or the first frame, or an unstamped frame).
   *   - `duplicate`: `seq <= lastSeq` — already seen; drop it.
   *   - `gap`: `seq > lastSeq + 1` — frames `(from, to)` were missed; ask the
   *     producer for `replaySince(from)`. The tracker adopts `to` as current.
   */
  observe(seq) {
    if (!Number.isFinite(seq)) return OK; // unstamped producer — tolerate
    if (!this._started) {
      this._started = true;
      this._last = seq;
      return OK;
    }
    if (seq === this._last + 1) {
      this._last = seq;
      return OK;
    }
    if (seq <= this._last) return { status: "duplicate" };
    const from = this._last;
    this._last = seq; // adopt new position; caller replays the (from, to) hole
    return { status: "gap", from, to: seq };
  }

  /** Forget all history (call when attaching to a fresh producer instance). */
  reset() {
    this._last = 0;
    this._started = false;
  }
}

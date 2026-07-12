/**
 * Outbound backpressure policy — bounds server→client buffering when a
 * consumer drains too slowly, so a stuck WS client can't grow the sender's
 * memory without limit (the classic slow-consumer blowup) and the UI degrades
 * explicitly instead of freezing.
 *
 * Pure + deterministic (no transport, no timers): the caller feeds the
 * transport's current queued-byte count (e.g. `ws.bufferedAmount`) and a frame
 * class; the policy decides send-vs-drop with hysteresis and reports the
 * lag-episode transitions the caller turns into a notice.
 *
 * Designed to compose with EventReplayBuffer (event-seq-replay.js): a dropped
 * *droppable* frame should still be RECORDED (it gets a seq and stays in the
 * bounded replay buffer), just not sent. The seq gap on the next *sent* frame
 * then trips the consumer's SeqGapTracker, which requests replaySince — so the
 * dropped frames are recovered once the consumer catches up (or a truncated
 * replay tells it to full-resync). Critical frames are never dropped.
 */

const DEFAULT_HIGH_WATER_BYTES = 4 << 20; // 4 MiB queued → consumer is behind
const DEFAULT_LOW_WATER_BYTES = 1 << 20; // 1 MiB → considered caught up again

/** A frame that must always be delivered (lifecycle, errors, acks). */
export const CRITICAL = "critical";
/** A frame safe to drop under pressure and recover via replay/resync. */
export const DROPPABLE = "droppable";

export class BackpressurePolicy {
  constructor({
    highWaterBytes = DEFAULT_HIGH_WATER_BYTES,
    lowWaterBytes = DEFAULT_LOW_WATER_BYTES,
  } = {}) {
    const high = Math.max(
      1,
      Math.floor(highWaterBytes) || DEFAULT_HIGH_WATER_BYTES,
    );
    // Low water must sit below high water or hysteresis collapses to a flapping
    // single threshold; clamp it to at most high-1.
    const low = Math.min(Math.max(0, Math.floor(lowWaterBytes) || 0), high - 1);
    this._high = high;
    this._low = low;
    this._lagging = false;
    this._dropped = 0; // dropped since the CURRENT lag episode started
    this._droppedTotal = 0; // dropped across the whole connection
  }

  /** True while the consumer is behind (buffered ≥ high, until it drains ≤ low). */
  get lagging() {
    return this._lagging;
  }

  /** Frames dropped across the whole connection. */
  get droppedTotal() {
    return this._droppedTotal;
  }

  /**
   * Decide what to do with one outbound frame.
   * @param {number} bufferedBytes transport's currently-queued bytes
   *   (`ws.bufferedAmount`); non-finite → treated as 0 (never lags).
   * @param {"critical"|"droppable"} frameClass
   * @returns {{send:boolean, drop:boolean, lagStarted:boolean, lagEnded:boolean,
   *   dropped:number}} `dropped` = count dropped in the episode that just
   *   started/ended (for the caller's notice); `send:false` only ever for a
   *   droppable frame while lagging.
   */
  evaluate(bufferedBytes, frameClass) {
    const b = Number.isFinite(bufferedBytes) ? bufferedBytes : 0;
    let lagStarted = false;
    let lagEnded = false;

    if (!this._lagging && b >= this._high) {
      this._lagging = true;
      this._dropped = 0;
      lagStarted = true;
    } else if (this._lagging && b <= this._low) {
      this._lagging = false;
      lagEnded = true;
    }

    // While lagging, shed droppable frames to let the buffer drain; critical
    // frames (and everything while not lagging) always go out.
    if (this._lagging && frameClass === DROPPABLE) {
      this._dropped += 1;
      this._droppedTotal += 1;
      return {
        send: false,
        drop: true,
        lagStarted,
        lagEnded,
        dropped: this._dropped,
      };
    }

    // `dropped` carries the episode's running count so a lag-end notice can
    // report how many droppable frames were shed.
    return {
      send: true,
      drop: false,
      lagStarted,
      lagEnded,
      dropped: this._dropped,
    };
  }
}

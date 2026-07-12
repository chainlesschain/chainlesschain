/**
 * Outbound backpressure policy (src/lib/backpressure-policy.js): hysteresis
 * send/drop decisions that bound server→client buffering. Pure + deterministic
 * — the caller feeds a buffered-byte count + frame class. Composes with
 * EventReplayBuffer (dropped droppable frames are still recorded, so the seq
 * gap recovers them). Critical frames are never dropped.
 */
import { describe, it, expect } from "vitest";
import {
  BackpressurePolicy,
  CRITICAL,
  DROPPABLE,
} from "../../src/lib/backpressure-policy.js";

const policy = () =>
  new BackpressurePolicy({ highWaterBytes: 1000, lowWaterBytes: 100 });

describe("BackpressurePolicy — normal (below high water)", () => {
  it("sends every frame and never lags when buffered stays low", () => {
    const p = policy();
    expect(p.evaluate(0, DROPPABLE)).toMatchObject({ send: true, drop: false });
    expect(p.evaluate(999, DROPPABLE)).toMatchObject({
      send: true,
      drop: false,
    });
    expect(p.evaluate(500, CRITICAL)).toMatchObject({
      send: true,
      drop: false,
    });
    expect(p.lagging).toBe(false);
    expect(p.droppedTotal).toBe(0);
  });

  it("treats a non-finite buffered count as 0 (never lags)", () => {
    const p = policy();
    expect(p.evaluate(undefined, DROPPABLE)).toMatchObject({ send: true });
    expect(p.evaluate(NaN, DROPPABLE)).toMatchObject({ send: true });
    expect(p.lagging).toBe(false);
  });
});

describe("BackpressurePolicy — lagging (at/above high water)", () => {
  it("enters lag on the crossing frame and reports lagStarted once", () => {
    const p = policy();
    const first = p.evaluate(1000, CRITICAL); // crosses high water
    expect(first).toMatchObject({ lagStarted: true, send: true }); // critical still sent
    expect(p.lagging).toBe(true);
    const second = p.evaluate(1200, CRITICAL);
    expect(second.lagStarted).toBe(false); // only once per episode
  });

  it("drops droppable frames while lagging but keeps recording seqs upstream", () => {
    const p = policy();
    p.evaluate(2000, CRITICAL); // enter lag
    const d1 = p.evaluate(2000, DROPPABLE);
    const d2 = p.evaluate(2000, DROPPABLE);
    expect(d1).toMatchObject({ send: false, drop: true, dropped: 1 });
    expect(d2).toMatchObject({ send: false, drop: true, dropped: 2 });
    expect(p.droppedTotal).toBe(2);
  });

  it("NEVER drops critical frames even while lagging", () => {
    const p = policy();
    p.evaluate(5000, DROPPABLE); // enter lag (this droppable frame is dropped)
    const crit = p.evaluate(5000, CRITICAL);
    expect(crit).toMatchObject({ send: true, drop: false });
  });
});

describe("BackpressurePolicy — hysteresis recovery", () => {
  it("stays lagging between low and high water (no flapping)", () => {
    const p = policy();
    p.evaluate(1000, CRITICAL); // enter lag
    // 500 is above low(100), below high(1000) → still lagging, still dropping
    expect(p.evaluate(500, DROPPABLE)).toMatchObject({ drop: true });
    expect(p.lagging).toBe(true);
  });

  it("exits lag only when buffered falls to/below low water, reporting the tally", () => {
    const p = policy();
    p.evaluate(2000, CRITICAL); // enter lag
    p.evaluate(2000, DROPPABLE); // drop 1
    p.evaluate(2000, DROPPABLE); // drop 2
    const recovered = p.evaluate(100, CRITICAL); // drains to low water → exit
    expect(recovered).toMatchObject({ lagEnded: true, send: true, dropped: 2 });
    expect(p.lagging).toBe(false);
    // A subsequent lag episode counts fresh.
    p.evaluate(2000, CRITICAL); // re-enter
    expect(p.evaluate(2000, DROPPABLE)).toMatchObject({ dropped: 1 });
    expect(p.droppedTotal).toBe(3); // cumulative across episodes
  });

  it("a droppable frame arriving exactly at low water exits lag AND sends", () => {
    const p = policy();
    p.evaluate(2000, CRITICAL); // enter lag
    const f = p.evaluate(100, DROPPABLE); // at low water → exit, so send it
    expect(f).toMatchObject({ lagEnded: true, send: true, drop: false });
  });
});

describe("BackpressurePolicy — config guards", () => {
  it("clamps low water below high water so hysteresis can't collapse", () => {
    const p = new BackpressurePolicy({
      highWaterBytes: 100,
      lowWaterBytes: 500,
    });
    p.evaluate(100, CRITICAL); // enter lag at high water
    // With low clamped to 99, a 100-byte frame stays lagging (not ≤ low).
    expect(p.evaluate(100, DROPPABLE)).toMatchObject({ drop: true });
    expect(p.evaluate(99, DROPPABLE)).toMatchObject({ lagEnded: true });
  });
});

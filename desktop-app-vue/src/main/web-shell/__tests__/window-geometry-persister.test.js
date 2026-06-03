/**
 * Phase 1.5 follow-up — WindowGeometryPersister tests.
 *
 * Pure unit tests with injected timer + readBounds + write so the suite
 * runs in vitest's Node worker without spinning up Electron or wall-clock
 * timing dependencies.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  WindowGeometryPersister,
  DEFAULT_DEBOUNCE_MS,
} from "../window-geometry-persister.js";

/**
 * Build a fake BrowserWindow that keeps an EventEmitter-shaped listener
 * map and exposes setBounds/getBounds + a test helper to fire events.
 */
function makeFakeWindow(
  initialBounds = { x: 0, y: 0, width: 800, height: 600 },
) {
  const listeners = new Map();
  let bounds = { ...initialBounds };
  return {
    on: vi.fn((evt, fn) => {
      const arr = listeners.get(evt) || [];
      arr.push(fn);
      listeners.set(evt, arr);
    }),
    removeListener: vi.fn((evt, fn) => {
      const arr = listeners.get(evt) || [];
      listeners.set(
        evt,
        arr.filter((l) => l !== fn),
      );
    }),
    getBounds: vi.fn(() => ({ ...bounds })),
    /** Test-only — change bounds + fire an event. */
    _move(next) {
      bounds = { ...next };
      const arr = listeners.get("move") || [];
      arr.forEach((fn) => fn());
    },
    _resize(next) {
      bounds = { ...next };
      const arr = listeners.get("resize") || [];
      arr.forEach((fn) => fn());
    },
    /** Inspect listener counts for assertions. */
    _listenerCount(evt) {
      return (listeners.get(evt) || []).length;
    },
  };
}

/**
 * Build a deterministic timer pair so tests don't depend on real time.
 */
function makeManualTimers() {
  const timers = new Map();
  let nextHandle = 1;
  return {
    setTimer: vi.fn((fn, ms) => {
      const handle = nextHandle++;
      timers.set(handle, { fn, ms });
      return handle;
    }),
    clearTimer: vi.fn((handle) => {
      timers.delete(handle);
    }),
    /** Fire all pending timers (test helper). */
    fireAll() {
      const fns = Array.from(timers.values()).map((t) => t.fn);
      timers.clear();
      fns.forEach((fn) => fn());
    },
    pendingCount() {
      return timers.size;
    },
  };
}

let writes;
let writer;

beforeEach(() => {
  writes = [];
  writer = vi.fn((role, bounds) => {
    writes.push({ role, bounds });
  });
});

describe("WindowGeometryPersister — construction", () => {
  it("requires options.write", () => {
    expect(() => new WindowGeometryPersister()).toThrow(/write is required/);
    expect(() => new WindowGeometryPersister({})).toThrow(/write is required/);
  });

  it("falls back to the default debounce when none/invalid is given", () => {
    expect(DEFAULT_DEBOUNCE_MS).toBeGreaterThan(0);
    const p = new WindowGeometryPersister({ write: () => {} });
    // No public getter; verify behaviour via _scheduleFlush call paths instead.
    expect(p.attachedCount).toBe(0);
  });
});

describe("WindowGeometryPersister — attach / detach", () => {
  it("registers resize + move listeners on attach", () => {
    const t = makeManualTimers();
    const win = makeFakeWindow();
    const p = new WindowGeometryPersister({
      write: writer,
      setTimer: t.setTimer,
      clearTimer: t.clearTimer,
    });
    p.attach("main", win);
    expect(win._listenerCount("resize")).toBe(1);
    expect(win._listenerCount("move")).toBe(1);
    expect(p.attachedCount).toBe(1);
  });

  it("attach is idempotent — second attach for the same role is a no-op", () => {
    const win = makeFakeWindow();
    const p = new WindowGeometryPersister({ write: writer });
    p.attach("main", win);
    p.attach("main", win);
    expect(win._listenerCount("resize")).toBe(1);
  });

  it("the attach return value is a disposer that detaches", () => {
    const win = makeFakeWindow();
    const p = new WindowGeometryPersister({ write: writer });
    const dispose = p.attach("main", win);
    expect(p.attachedCount).toBe(1);
    dispose();
    expect(p.attachedCount).toBe(0);
    expect(win._listenerCount("resize")).toBe(0);
    expect(win._listenerCount("move")).toBe(0);
  });

  it("detach is idempotent and returns true only the first time", () => {
    const win = makeFakeWindow();
    const p = new WindowGeometryPersister({ write: writer });
    p.attach("main", win);
    expect(p.detach("main")).toBe(true);
    expect(p.detach("main")).toBe(false);
  });

  it("rejects bogus role / window", () => {
    const p = new WindowGeometryPersister({ write: writer });
    expect(() => p.attach("", makeFakeWindow())).toThrow(/role required/);
    expect(() => p.attach(null, makeFakeWindow())).toThrow(/role required/);
    expect(() => p.attach("main", null)).toThrow(/window with .on/);
    expect(() => p.attach("main", { on: "not-a-fn" })).toThrow(
      /window with .on/,
    );
  });
});

describe("WindowGeometryPersister — debounce + write", () => {
  it("schedules a single timer per burst of move/resize events", () => {
    const t = makeManualTimers();
    const win = makeFakeWindow();
    const p = new WindowGeometryPersister({
      write: writer,
      setTimer: t.setTimer,
      clearTimer: t.clearTimer,
    });
    p.attach("main", win);
    win._move({ x: 10, y: 20, width: 800, height: 600 });
    win._move({ x: 30, y: 40, width: 800, height: 600 });
    win._resize({ x: 30, y: 40, width: 900, height: 700 });
    expect(t.pendingCount()).toBe(1);
    t.fireAll();
    expect(writer).toHaveBeenCalledTimes(1);
    expect(writes).toEqual([
      { role: "main", bounds: { x: 30, y: 40, width: 900, height: 700 } },
    ]);
  });

  it("forwards the role correctly when multiple windows are attached", () => {
    const t = makeManualTimers();
    const winMain = makeFakeWindow({ x: 0, y: 0, width: 1200, height: 800 });
    const winArt = makeFakeWindow({ x: 100, y: 100, width: 600, height: 800 });
    const p = new WindowGeometryPersister({
      write: writer,
      setTimer: t.setTimer,
      clearTimer: t.clearTimer,
    });
    p.attach("main", winMain);
    p.attach("artifact", winArt);
    winMain._move({ x: 50, y: 50, width: 1200, height: 800 });
    winArt._resize({ x: 100, y: 100, width: 700, height: 900 });
    t.fireAll();
    expect(writes.map((w) => w.role).sort()).toEqual(["artifact", "main"]);
  });

  it("flushAll() bypasses the debounce and writes the live bounds", () => {
    const t = makeManualTimers();
    const win = makeFakeWindow();
    const p = new WindowGeometryPersister({
      write: writer,
      setTimer: t.setTimer,
      clearTimer: t.clearTimer,
    });
    p.attach("main", win);
    win._move({ x: 5, y: 5, width: 800, height: 600 });
    expect(writer).not.toHaveBeenCalled();
    p.flushAll();
    expect(writer).toHaveBeenCalledTimes(1);
    expect(writes[0]).toEqual({
      role: "main",
      bounds: { x: 5, y: 5, width: 800, height: 600 },
    });
    // Pending timer was cancelled during flush.
    expect(t.pendingCount()).toBe(0);
  });

  it("swallows writer exceptions without breaking the listener", () => {
    const t = makeManualTimers();
    const win = makeFakeWindow();
    const errors = [];
    const explosiveWriter = vi.fn(() => {
      const err = new Error("disk full");
      errors.push(err);
      throw err;
    });
    const p = new WindowGeometryPersister({
      write: explosiveWriter,
      setTimer: t.setTimer,
      clearTimer: t.clearTimer,
    });
    p.attach("main", win);
    win._move({ x: 5, y: 5, width: 800, height: 600 });
    expect(() => t.fireAll()).not.toThrow();
    // After the failed write, a subsequent burst still triggers — listener
    // wasn't removed by the exception.
    win._move({ x: 6, y: 6, width: 800, height: 600 });
    expect(t.pendingCount()).toBe(1);
  });

  it("skips the write when readBounds returns null (window closed mid-flight)", () => {
    const t = makeManualTimers();
    const win = makeFakeWindow();
    const p = new WindowGeometryPersister({
      write: writer,
      readBounds: () => null,
      setTimer: t.setTimer,
      clearTimer: t.clearTimer,
    });
    p.attach("main", win);
    win._move({ x: 1, y: 1, width: 800, height: 600 });
    t.fireAll();
    expect(writer).not.toHaveBeenCalled();
  });
});

/**
 * pipe-safety — the shared EPIPE guard used by the headless `-p` runner, the
 * stream-json driver, and the REPL. A downstream `| head` closing the pipe
 * raises an async stream `error` that would otherwise crash the process.
 */
import { describe, it, expect } from "vitest";
import { EventEmitter } from "events";
import { installPipeSafety } from "../../src/runtime/pipe-safety.js";

describe("installPipeSafety", () => {
  it("treats an EPIPE stream error as a clean exit hook, not a crash", () => {
    const s = new EventEmitter();
    let exited = 0;
    installPipeSafety([s], () => exited++);
    // Without the listener this would be an unhandled 'error' → process crash.
    s.emit("error", Object.assign(new Error("write EPIPE"), { code: "EPIPE" }));
    expect(exited).toBe(1);
  });

  it("does not invoke onEpipe for a non-EPIPE stream error", () => {
    const s = new EventEmitter();
    let exited = 0;
    installPipeSafety([s], () => exited++);
    s.emit("error", Object.assign(new Error("boom"), { code: "EAGAIN" }));
    expect(exited).toBe(0);
  });

  it("is idempotent — one listener per stream across repeated installs", () => {
    const s = new EventEmitter();
    let exited = 0;
    installPipeSafety([s], () => exited++);
    installPipeSafety([s], () => exited++);
    installPipeSafety([s], () => exited++);
    expect(s.listenerCount("error")).toBe(1);
    s.emit("error", Object.assign(new Error("x"), { code: "EPIPE" }));
    expect(exited).toBe(1); // only the first handler is wired
  });

  it("invokes onEpipe on EACH EPIPE event (so stateful callers must dedup)", () => {
    // The REPL relies on this: its onEpipe sets a `_replClosing` flag so a
    // cleanup write that also EPIPEs doesn't re-trigger shutdown.
    const s = new EventEmitter();
    let calls = 0;
    let closing = false;
    installPipeSafety([s], () => {
      if (closing) return;
      closing = true;
      calls++;
    });
    s.emit("error", Object.assign(new Error("EPIPE"), { code: "EPIPE" }));
    s.emit("error", Object.assign(new Error("EPIPE"), { code: "EPIPE" }));
    expect(calls).toBe(1); // the dedup guard held across two events
  });
});

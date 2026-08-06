/**
 * pipe-safety — the shared EPIPE guard used by the headless `-p` runner, the
 * stream-json driver, and the REPL. A downstream `| head` closing the pipe
 * raises an async stream `error` that would otherwise crash the process.
 */
import { describe, it, expect, vi } from "vitest";
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
    let stale = 0;
    let current = 0;
    installPipeSafety([s], () => stale++);
    installPipeSafety([s], () => current++);
    expect(s.listenerCount("error")).toBe(1);
    s.emit("error", Object.assign(new Error("x"), { code: "EPIPE" }));
    expect(stale).toBe(0);
    expect(current).toBe(1);
  });

  it("deduplicates EPIPE across stdout/stderr for one installation", () => {
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    let calls = 0;
    installPipeSafety([stdout, stderr], () => calls++);
    stdout.emit("error", Object.assign(new Error("EPIPE"), { code: "EPIPE" }));
    stderr.emit("error", Object.assign(new Error("EPIPE"), { code: "EPIPE" }));
    expect(calls).toBe(1);
  });

  it("disposes only its own active callback without removing the guard", () => {
    const s = new EventEmitter();
    let calls = 0;
    const dispose = installPipeSafety([s], () => calls++);
    dispose();
    s.emit("error", Object.assign(new Error("EPIPE"), { code: "EPIPE" }));
    expect(calls).toBe(0);
    expect(s.listenerCount("error")).toBe(1);
  });

  it("defaults to a clean exitCode without calling process.exit", () => {
    const previousExitCode = process.exitCode;
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined);
    try {
      process.exitCode = undefined;
      const s = new EventEmitter();
      installPipeSafety([s]);
      s.emit("error", Object.assign(new Error("EPIPE"), { code: "EPIPE" }));
      expect(exit).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(0);
    } finally {
      exit.mockRestore();
      process.exitCode = previousExitCode;
    }
  });
});

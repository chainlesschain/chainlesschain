import { describe, it, expect, vi } from "vitest";
import {
  createAbortError,
  isAbortError,
  raceWithAbort,
  throwIfAborted,
} from "../../src/lib/abort-utils.js";

describe("createAbortError", () => {
  it("returns an Error named AbortError with the default message", () => {
    const e = createAbortError();
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("AbortError");
    expect(e.message).toBe("Agent loop interrupted");
  });

  it("uses a custom message when given", () => {
    expect(createAbortError("stopped by user").message).toBe("stopped by user");
  });

  it("is detected by isAbortError (round-trip)", () => {
    expect(isAbortError(createAbortError())).toBe(true);
  });
});

describe("isAbortError", () => {
  it("matches by name === AbortError", () => {
    expect(isAbortError({ name: "AbortError" })).toBe(true);
  });

  it("matches by code === ABORT_ERR", () => {
    expect(isAbortError({ code: "ABORT_ERR" })).toBe(true);
  });

  it("matches by message containing aborted/interrupted (case-insensitive)", () => {
    expect(isAbortError({ message: "The operation was aborted" })).toBe(true);
    expect(isAbortError({ message: "ABORTED" })).toBe(true);
    expect(isAbortError({ message: "Agent loop interrupted" })).toBe(true);
    expect(isAbortError({ message: "Stream Interrupted by signal" })).toBe(
      true,
    );
  });

  it("returns false for unrelated errors", () => {
    expect(isAbortError(new TypeError("x is undefined"))).toBe(false);
    expect(isAbortError({ name: "Error", message: "network timeout" })).toBe(
      false,
    );
  });

  it("returns false for null/undefined/non-objects (no throw)", () => {
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
    expect(isAbortError(42)).toBe(false);
  });

  it("detects a real AbortController abort error", () => {
    const ac = new AbortController();
    ac.abort();
    expect(isAbortError(ac.signal.reason)).toBe(true);
  });
});

describe("throwIfAborted", () => {
  it("does not throw when the signal is not aborted", () => {
    const ac = new AbortController();
    expect(() => throwIfAborted(ac.signal)).not.toThrow();
  });

  it("does not throw when signal is null/undefined", () => {
    expect(() => throwIfAborted(null)).not.toThrow();
    expect(() => throwIfAborted(undefined)).not.toThrow();
  });

  it("throws the signal.reason when present", () => {
    const reason = new Error("custom reason");
    const signal = { aborted: true, reason };
    expect(() => throwIfAborted(signal)).toThrow(reason);
  });

  it("throws an AbortError with the message when aborted and no reason", () => {
    const signal = { aborted: true, reason: undefined };
    try {
      throwIfAborted(signal, "loop cancelled");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e.name).toBe("AbortError");
      expect(e.message).toBe("loop cancelled");
    }
  });

  it("throws on a real aborted AbortController signal", () => {
    const ac = new AbortController();
    ac.abort();
    expect(() => throwIfAborted(ac.signal)).toThrow();
  });
});

describe("raceWithAbort", () => {
  it("returns an already-settled value and removes its listener", async () => {
    const listeners = new EventTarget();
    const signal = {
      aborted: false,
      addEventListener: vi.fn((...args) => listeners.addEventListener(...args)),
      removeEventListener: vi.fn((...args) =>
        listeners.removeEventListener(...args),
      ),
    };

    await expect(raceWithAbort("done", signal)).resolves.toBe("done");
    expect(signal.addEventListener).toHaveBeenCalledOnce();
    expect(signal.removeEventListener).toHaveBeenCalledOnce();
  });

  it("rejects promptly with the exact abort reason", async () => {
    const controller = new AbortController();
    let resolveSource;
    const source = new Promise((resolve) => {
      resolveSource = resolve;
    });
    const waiting = raceWithAbort(source, controller.signal);
    const reason = createAbortError("parent stopped");

    controller.abort(reason);
    await expect(waiting).rejects.toBe(reason);
    // A late success is observed but cannot replace the cancelled settlement.
    resolveSource("late success");
    await Promise.resolve();
    await expect(waiting).rejects.toBe(reason);
  });

  it("does not inspect a thenable after pre-cancellation", async () => {
    const controller = new AbortController();
    controller.abort(createAbortError("already stopped"));
    const then = vi.fn();

    await expect(raceWithAbort({ then }, controller.signal)).rejects.toThrow(
      "already stopped",
    );
    expect(then).not.toHaveBeenCalled();
  });

  it("closes an abort race that fires immediately before listener attachment", async () => {
    const reason = createAbortError("registration race stopped");
    const signal = {
      aborted: false,
      reason: undefined,
      addEventListener: vi.fn(function () {
        this.aborted = true;
        this.reason = reason;
      }),
      removeEventListener: vi.fn(),
    };

    await expect(
      raceWithAbort(Promise.resolve("too late"), signal),
    ).rejects.toBe(reason);
    expect(signal.removeEventListener).toHaveBeenCalledOnce();
  });
});

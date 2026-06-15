import { describe, it, expect } from "vitest";
import {
  createAbortError,
  isAbortError,
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

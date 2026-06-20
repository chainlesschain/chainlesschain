import { describe, it, expect, vi } from "vitest";
import {
  reportFatal,
  installGlobalErrorHandlers,
} from "../../src/lib/fatal-handler.js";

function fakeStderr() {
  const out = [];
  return { out, write: (s) => out.push(s) };
}

describe("reportFatal", () => {
  it("prints a clean one-line error and exits 1 (non-verbose)", () => {
    const stderr = fakeStderr();
    const exit = vi.fn();
    reportFatal(new Error("boom"), { stderr, exit, argv: [], env: {} });
    expect(stderr.out.join("")).toBe("error: boom\n");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("prints the full stack under --verbose", () => {
    const stderr = fakeStderr();
    const exit = vi.fn();
    const err = new Error("boom");
    err.stack = "Error: boom\n    at x";
    reportFatal(err, { stderr, exit, argv: ["--verbose"], env: {} });
    expect(stderr.out.join("")).toContain("at x");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("prints the stack under CC_DEBUG / DEBUG", () => {
    for (const env of [{ CC_DEBUG: "1" }, { DEBUG: "1" }]) {
      const stderr = fakeStderr();
      const exit = vi.fn();
      const err = new Error("boom");
      err.stack = "Error: boom\n    at y";
      reportFatal(err, { stderr, exit, argv: [], env });
      expect(stderr.out.join("")).toContain("at y");
    }
  });

  it("stringifies a non-Error rejection reason", () => {
    const stderr = fakeStderr();
    const exit = vi.fn();
    reportFatal("plain string", { stderr, exit, argv: [], env: {} });
    expect(stderr.out.join("")).toBe("error: plain string\n");
    expect(exit).toHaveBeenCalledWith(1);
  });
});

describe("installGlobalErrorHandlers", () => {
  it("registers unhandledRejection + uncaughtException and routes both to report", () => {
    const handlers = {};
    const proc = { on: (ev, fn) => (handlers[ev] = fn) };
    const report = vi.fn();
    installGlobalErrorHandlers(proc, report);

    expect(typeof handlers.unhandledRejection).toBe("function");
    expect(typeof handlers.uncaughtException).toBe("function");

    // A rejection with a real Error is passed through as-is.
    const err = new Error("reject");
    handlers.unhandledRejection(err);
    expect(report).toHaveBeenCalledWith(err);

    // A non-Error rejection reason is wrapped in an Error (so reportFatal can
    // format .message and a stack exists for --verbose).
    report.mockClear();
    handlers.unhandledRejection("oops");
    expect(report).toHaveBeenCalledTimes(1);
    const wrapped = report.mock.calls[0][0];
    expect(wrapped).toBeInstanceOf(Error);
    expect(wrapped.message).toBe("oops");

    // uncaughtException routes through too.
    report.mockClear();
    const ue = new Error("uncaught");
    handlers.uncaughtException(ue);
    expect(report).toHaveBeenCalledWith(ue);
  });
});

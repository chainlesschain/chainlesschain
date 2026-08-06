import { describe, expect, it, vi } from "vitest";
import {
  cleanupDeadlineError,
  createCleanupDeadline,
  MAX_CLI_CLEANUP_DEADLINE_MS,
  normalizeCleanupDeadlineMs,
} from "../../src/runtime/cleanup-deadline.js";

describe("cleanup deadline", () => {
  it("uses a host ceiling that ordinary configuration can only tighten", () => {
    expect(normalizeCleanupDeadlineMs(undefined)).toBe(
      MAX_CLI_CLEANUP_DEADLINE_MS,
    );
    expect(normalizeCleanupDeadlineMs(25)).toBe(25);
    expect(normalizeCleanupDeadlineMs(0)).toBe(MAX_CLI_CLEANUP_DEADLINE_MS);
    expect(normalizeCleanupDeadlineMs(Number.MAX_SAFE_INTEGER)).toBe(
      MAX_CLI_CLEANUP_DEADLINE_MS,
    );
  });

  it("bounds a hung disposer and still invokes every later cleanup step", async () => {
    const later = vi.fn(async () => {});
    const deadline = createCleanupDeadline({ timeoutMs: 15, label: "test" });

    await deadline.run("hung", () => new Promise(() => {}));
    await deadline.run("later", later);
    const report = deadline.report();

    expect(later).toHaveBeenCalledOnce();
    expect(report).toMatchObject({
      label: "test",
      timeoutMs: 15,
      timedOut: true,
      completed: false,
      steps: [
        expect.objectContaining({ name: "hung", status: "timeout" }),
        expect.objectContaining({ name: "later", status: "timeout" }),
      ],
    });
    expect(cleanupDeadlineError(report)).toMatchObject({
      code: "CC_CLEANUP_DEADLINE_EXCEEDED",
      timeoutMs: 15,
      timedOutSteps: ["hung", "later"],
    });
  });

  it("records disposer errors without preventing later cleanup", async () => {
    const deadline = createCleanupDeadline({ timeoutMs: 100 });
    await deadline.run("broken", () => {
      throw Object.assign(new Error("failed"), { code: "EFAIL" });
    });
    await deadline.run("healthy", async () => {});

    expect(deadline.report()).toMatchObject({
      timedOut: false,
      completed: true,
      steps: [
        expect.objectContaining({ status: "error", errorCode: "EFAIL" }),
        expect.objectContaining({ status: "completed" }),
      ],
    });
  });

  it("does not expose arbitrary adapter error codes in reports", async () => {
    const deadline = createCleanupDeadline({ timeoutMs: 100 });
    await deadline.run("adapter", () => {
      throw Object.assign(new Error("private body"), {
        code: "C:/private/session.jsonl",
      });
    });

    expect(deadline.report().steps[0]).toMatchObject({
      name: "adapter",
      status: "error",
      errorCode: "CC_CLEANUP_STEP_FAILED",
    });
    expect(JSON.stringify(deadline.report())).not.toContain("private");
  });

  it("uses one absolute budget rather than resetting it for each step", async () => {
    let clock = 0;
    const later = vi.fn();
    const deadline = createCleanupDeadline(
      { timeoutMs: 10 },
      {
        now: () => clock,
        setTimeout: (callback, delay) => {
          clock += delay;
          callback();
          return 1;
        },
        clearTimeout: vi.fn(),
      },
    );

    await deadline.run("first", () => new Promise(() => {}));
    await deadline.run("later", later);

    expect(later).toHaveBeenCalledOnce();
    expect(deadline.report().elapsedMs).toBe(10);
    expect(deadline.report().steps.map((step) => step.status)).toEqual([
      "timeout",
      "timeout",
    ]);
  });

  it("latches exhaustion when a platform timer fires before the monotonic deadline", async () => {
    const later = vi.fn();
    const deadline = createCleanupDeadline(
      { timeoutMs: 10 },
      {
        now: () => 0,
        setTimeout: (callback) => {
          callback();
          return 1;
        },
        clearTimeout: vi.fn(),
      },
    );

    await deadline.run("first", () => new Promise(() => {}));
    await deadline.run("later", later);

    expect(later).toHaveBeenCalledOnce();
    expect(deadline.report().steps.map((step) => step.status)).toEqual([
      "timeout",
      "timeout",
    ]);
  });
});

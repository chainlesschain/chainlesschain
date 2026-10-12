import { afterEach, describe, expect, it, vi } from "vitest";
import { assertVerify01ExecutionWindow } from "../../src/lib/eval/verify01-execution-window.js";

const start = Date.parse("2026-10-05T00:00:00.000Z");
const end = Date.parse("2026-10-12T00:00:00.000Z");
const plan = Object.freeze({
  window: Object.freeze({
    start: "2026-10-05T00:00:00.000Z",
    end: "2026-10-12T00:00:00.000Z",
  }),
});

function expectCode(fn, code) {
  let failure;
  try {
    fn();
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(Error);
  expect(failure.code).toBe(code);
}

afterEach(() => vi.useRealTimers());

describe("VERIFY-01 admission before formal execution", () => {
  it("allows the start instant, preserves its exact clock value, and does not mutate the plan", () => {
    const before = JSON.stringify(plan);
    expect(assertVerify01ExecutionWindow(plan, { now: start })).toEqual({
      startedAt: start,
      windowEndMs: end,
    });
    expect(JSON.stringify(plan)).toBe(before);
  });

  it("rejects a task before the frozen window starts", () => {
    expectCode(
      () => assertVerify01ExecutionWindow(plan, { now: start - 1 }),
      "CC_VERIFY01_WINDOW_NOT_STARTED",
    );
  });

  it.each([end, end + 1, Date.parse("2026-10-12T12:00:00Z")])(
    "rejects expired admission at %s, even with zero required time",
    (now) => {
      expectCode(
        () => assertVerify01ExecutionWindow(plan, { now }),
        "CC_VERIFY01_WINDOW_EXPIRED",
      );
    },
  );

  it("fits a full task exactly, but rejects a one-millisecond shortfall", () => {
    const requiredTimeMs = 20 * 60_000;
    expect(
      assertVerify01ExecutionWindow(plan, {
        now: end - requiredTimeMs,
        requiredTimeMs,
      }),
    ).toEqual({ startedAt: end - requiredTimeMs, windowEndMs: end });
    expectCode(
      () =>
        assertVerify01ExecutionWindow(plan, {
          now: end - requiredTimeMs + 1,
          requiredTimeMs,
        }),
      "CC_VERIFY01_WINDOW_INSUFFICIENT_TIME",
    );
  });

  it("rechecks the current clock instead of reusing earlier successful admission", () => {
    vi.useFakeTimers();
    vi.setSystemTime(end - 60_000);
    expect(
      assertVerify01ExecutionWindow(plan, { requiredTimeMs: 60_000 }),
    ).toEqual({
      startedAt: end - 60_000,
      windowEndMs: end,
    });
    vi.setSystemTime(end);
    expectCode(
      () => assertVerify01ExecutionWindow(plan),
      "CC_VERIFY01_WINDOW_EXPIRED",
    );
  });

  it.each([-1, NaN, Infinity, -Infinity, "1000", null])(
    "rejects invalid required duration %s",
    (requiredTimeMs) => {
      expectCode(
        () =>
          assertVerify01ExecutionWindow(plan, { now: start, requiredTimeMs }),
        "CC_VERIFY01_WINDOW_INVALID",
      );
    },
  );

  it("rejects a huge finite task budget without overflowing into admission", () => {
    expectCode(
      () =>
        assertVerify01ExecutionWindow(plan, {
          now: start,
          requiredTimeMs: Number.MAX_VALUE,
        }),
      "CC_VERIFY01_WINDOW_INSUFFICIENT_TIME",
    );
  });

  it.each([NaN, Infinity, -Infinity, "2026-10-06", null])(
    "rejects invalid current time %s",
    (now) => {
      expectCode(
        () => assertVerify01ExecutionWindow(plan, { now }),
        "CC_VERIFY01_WINDOW_INVALID",
      );
    },
  );

  it.each([
    undefined,
    {},
    { start: plan.window.start },
    { start: plan.window.start, end: plan.window.start },
    { start: plan.window.end, end: plan.window.start },
    { start: "2026-02-30T00:00:00Z", end: plan.window.end },
    { start: "2026-10-05T24:00:00Z", end: plan.window.end },
    { start: "2026-10-05T00:00:00", end: plan.window.end },
    { start: "2026-10-05", end: plan.window.end },
    { start: 0, end: plan.window.end },
    { start: "0", end: plan.window.end },
    { start: "2026-10-05T00:00:00+25:00", end: plan.window.end },
    { start: "2026-10-05T00:00:00.0001Z", end: plan.window.end },
  ])("rejects malformed or unordered window %j", (window) => {
    expectCode(
      () => assertVerify01ExecutionWindow({ window }, { now: start }),
      "CC_VERIFY01_WINDOW_INVALID",
    );
  });

  it("accepts explicit ISO timezone offsets and optional fractional seconds", () => {
    expect(
      assertVerify01ExecutionWindow(
        {
          window: {
            start: "2026-10-05T08:00:00+08:00",
            end: "2026-10-12T08:00:00.0+08:00",
          },
        },
        { now: start },
      ),
    ).toEqual({ startedAt: start, windowEndMs: end });
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  attachStreamRetryMetadata,
  captureStreamRetryMetadata,
  isRetryableStreamError,
  resolveStreamRetryDelay,
  STREAM_RETRY_MAX_DELAY_MS,
  waitForStreamRetry,
} from "../../src/lib/stream-retry.js";

const now = Date.parse("Mon, 12 Oct 2026 10:00:00 GMT");
const drop = () =>
  Object.assign(new Error("terminated"), { code: "ECONNRESET" });

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Retry-After response metadata", () => {
  it.each([
    new Headers({ "Retry-After": "3" }),
    { "Retry-After": "3" },
    { "rEtRy-AfTeR": " 3 " },
    { "retry-after": "0003" },
  ])("captures seconds from headers %j at receipt time", (headers) => {
    expect(captureStreamRetryMetadata({ status: 200, headers }, now)).toEqual({
      status: 200,
      retryAfterAt: now + 3000,
    });
  });

  it.each([
    "Mon, 12 Oct 2026 10:00:03 GMT",
    "Monday, 12-Oct-26 10:00:03 GMT",
    "Mon Oct 12 10:00:03 2026",
  ])("accepts the HTTP-date format %s", (header) => {
    expect(
      captureStreamRetryMetadata({ headers: { "retry-after": header } }, now),
    ).toEqual({ retryAfterAt: now + 3000 });
  });

  it("accepts asctime single-digit days and the RFC850 previous-century rule", () => {
    const expected = Date.parse("Sun, 06 Nov 1994 08:49:37 GMT");
    for (const value of [
      "Sun Nov  6 08:49:37 1994",
      "Sunday, 06-Nov-94 08:49:37 GMT",
    ]) {
      expect(
        captureStreamRetryMetadata({ headers: { "retry-after": value } }, now),
      ).toEqual({ retryAfterAt: expected });
    }
  });

  it.each([
    "",
    "-1",
    "+1",
    "1.5",
    "1e3",
    "0x10",
    "Infinity",
    "NaN",
    "1, 2",
    "2026-10-12",
    "12 Oct 2026 10:00:03 GMT",
    "Mon, 12 Oct 2026 10:00:03 +0000",
    "Tue, 12 Oct 2026 10:00:03 GMT",
    "Mon, 31 Feb 2026 10:00:03 GMT",
    "Mon, 12 Oct 2026 24:00:03 GMT",
    ["3", "4"],
  ])("rejects malformed or ambiguous header %j", (header) => {
    expect(
      captureStreamRetryMetadata(
        { status: 503, headers: { "retry-after": header } },
        now,
      ),
    ).toEqual({ status: 503 });
  });

  it("ignores ambiguous differently cased object fields", () => {
    expect(
      captureStreamRetryMetadata(
        { headers: { "Retry-After": "3", "retry-after": "4" } },
        now,
      ),
    ).toEqual({});
  });

  it("handles absent headers and records no raw headers or credentials", () => {
    expect(captureStreamRetryMetadata({ status: 200 }, now)).toEqual({
      status: 200,
    });
    expect(captureStreamRetryMetadata(undefined, now)).toEqual({});
    expect(
      captureStreamRetryMetadata(
        {
          status: 503,
          headers: { "retry-after": "4", authorization: "secret" },
        },
        now,
      ),
    ).toEqual({ status: 503, retryAfterAt: now + 4000 });
  });

  it.each(["9007199254740993", "9".repeat(400)])(
    "retains an unrepresentably large valid delay as a refusal to retry: %s",
    (header) => {
      const metadata = captureStreamRetryMetadata(
        { headers: { "retry-after": header } },
        now,
      );
      expect(metadata.retryAfterAt).toBe(Infinity);
      expect(resolveStreamRetryDelay(metadata, 1, { now })).toBeNull();
    },
  );
});

describe("error metadata and replay eligibility stay separate", () => {
  it("keeps error identity, code and message while retaining the later deadline", () => {
    const error = Object.assign(drop(), {
      retryAfterAt: now + 3000,
      cause: { retryAfterAt: now + 5000 },
    });
    expect(
      attachStreamRetryMetadata(error, {
        status: 200,
        retryAfterAt: now + 1000,
      }),
    ).toBe(error);
    expect(error).toMatchObject({
      message: "terminated",
      code: "ECONNRESET",
      status: 200,
      retryAfterAt: now + 5000,
    });
    expect(isRetryableStreamError(error)).toBe(true);
  });

  it.each([
    { status: 429 },
    { statusCode: 503 },
    { cause: { status: 504 } },
    { cause: { statusCode: 500 } },
  ])("does not replace an existing HTTP failure with 2xx: %j", (metadata) => {
    const error = Object.assign(drop(), metadata);
    attachStreamRetryMetadata(error, { status: 200, retryAfterAt: now + 3000 });
    expect(error).toMatchObject(metadata);
    expect(error.status).not.toBe(200);
    expect(isRetryableStreamError(error)).toBe(false);
  });

  it.each([400, 401, 403, 429, 500, 503, 504])(
    "does not grant retries to HTTP %s with valid Retry-After",
    (status) => {
      const error = attachStreamRetryMetadata(
        drop(),
        captureStreamRetryMetadata(
          { status, headers: new Headers({ "Retry-After": "1" }) },
          now,
        ),
      );
      expect(error.status).toBe(status);
      expect(error.retryAfterAt).toBe(now + 1000);
      expect(isRetryableStreamError(error)).toBe(false);
    },
  );

  it.each(["noReplay", "streamOutputVisible", "isOutputBackpressureFailure"])(
    "honors the %s marker over connection error wording/code",
    (marker) => {
      for (const metadata of [
        { [marker]: true },
        { cause: { [marker]: true } },
      ]) {
        expect(isRetryableStreamError(Object.assign(drop(), metadata))).toBe(
          false,
        );
      }
    },
  );

  it("preserves the Responses terminal code when attaching successful headers", () => {
    const error = Object.assign(new Error("network error"), {
      code: "CC_OPENAI_RESPONSES_FAILED",
    });
    attachStreamRetryMetadata(error, { status: 200, retryAfterAt: now + 3000 });
    expect(isRetryableStreamError(error)).toBe(false);
  });
});

describe("bounded delay resolution", () => {
  it("uses the receipt deadline rather than restarting the full server delay", () => {
    const error = attachStreamRetryMetadata(
      drop(),
      captureStreamRetryMetadata({ headers: { "retry-after": "3" } }, now),
    );
    expect(resolveStreamRetryDelay(error, 1, { now: now + 1000 })).toBe(2000);
    expect(resolveStreamRetryDelay(error, 1, { now: now + 2999.1 })).toBe(400);
    expect(
      resolveStreamRetryDelay(error, 1, { now: now + 2999.1, baseDelayMs: 0 }),
    ).toBe(1);
  });

  it("retains exponential backoff for missing, zero and expired hints", () => {
    for (const error of [
      {},
      { retryAfterAt: now },
      { retryAfterAt: now - 5000 },
    ]) {
      expect(resolveStreamRetryDelay(error, 1, { now })).toBe(400);
      expect(resolveStreamRetryDelay(error, 2, { now })).toBe(800);
    }
    expect(resolveStreamRetryDelay({}, 2, { now, baseDelayMs: 20 })).toBe(40);
  });

  it("uses the later deadline in a cause chain", () => {
    expect(
      resolveStreamRetryDelay(
        { retryAfterAt: now + 1000, cause: { retryAfterAt: now + 3000 } },
        1,
        { now },
      ),
    ).toBe(3000);
  });

  it("rejects waits past the cap without clamping the provider deadline", () => {
    expect(STREAM_RETRY_MAX_DELAY_MS).toBe(60_000);
    expect(
      resolveStreamRetryDelay({ retryAfterAt: now + 60_000 }, 1, { now }),
    ).toBe(60_000);
    expect(
      resolveStreamRetryDelay({ retryAfterAt: now + 60_001 }, 1, { now }),
    ).toBeNull();
    expect(resolveStreamRetryDelay({}, 9, { now })).toBeNull();
    expect(
      resolveStreamRetryDelay({ retryAfterAt: now + 3000 }, 1, {
        now,
        maxDelayMs: 2000,
      }),
    ).toBeNull();
  });

  it("never feeds overflowing or invalid delays to Node timers", () => {
    expect(resolveStreamRetryDelay({}, 2000, { now })).toBeNull();
    expect(
      resolveStreamRetryDelay({}, 30, { now, maxDelayMs: Number.MAX_VALUE }),
    ).toBeNull();
    expect(resolveStreamRetryDelay({}, 0, { now })).toBeNull();
    expect(resolveStreamRetryDelay({}, 1, { now, baseDelayMs: -1 })).toBeNull();
    expect(
      resolveStreamRetryDelay({}, 1, { now, maxDelayMs: Infinity }),
    ).toBeNull();
  });
});

describe("cancelable retry waits", () => {
  it("waits until the deadline and removes the abort listener after success", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const settled = vi.fn();
    const promise = waitForStreamRetry(3000, controller.signal).then(settled);
    await vi.advanceTimersByTimeAsync(2999);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await promise;
    expect(settled).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts a long wait immediately and clears its timer/listener", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const reason = new Error("cancelled by user");
    const promise = waitForStreamRetry(60_000, controller.signal);
    const rejection = expect(promise).rejects.toBe(reason);
    controller.abort(reason);
    await rejection;
    expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("does not start a timer or custom sleep for an already cancelled signal", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    controller.abort();
    const sleep = vi.fn();
    await expect(
      waitForStreamRetry(5000, controller.signal),
    ).rejects.toMatchObject({
      name: "AbortError",
    });
    await expect(
      waitForStreamRetry(5000, controller.signal, { sleep }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(sleep).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("observes a custom sleep that rejects after cancellation", async () => {
    const controller = new AbortController();
    let rejectSleep;
    const sleep = vi.fn(
      () =>
        new Promise((_, reject) => {
          rejectSleep = reject;
        }),
    );
    const promise = waitForStreamRetry(5000, controller.signal, { sleep });
    const rejection = expect(promise).rejects.toMatchObject({
      name: "AbortError",
    });
    await Promise.resolve();
    expect(sleep).toHaveBeenCalledWith(5000);
    controller.abort();
    await rejection;
    rejectSleep(new Error("late sleep failure"));
    await new Promise((resolve) => setImmediate(resolve));
  });

  it("propagates a custom sleep failure without cancellation", async () => {
    const failure = new Error("sleep failed");
    await expect(
      waitForStreamRetry(5, undefined, {
        sleep: () => Promise.reject(failure),
      }),
    ).rejects.toBe(failure);
  });

  it("handles cancellation inside the custom sleep before it settles", async () => {
    const controller = new AbortController();
    const sleep = vi.fn(() => {
      controller.abort();
      return Promise.resolve();
    });
    await expect(
      waitForStreamRetry(5, controller.signal, { sleep }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it.each([-1, Infinity, NaN, 2_147_483_648])(
    "rejects unsafe timer input %s",
    async (delay) => {
      vi.useFakeTimers();
      await expect(waitForStreamRetry(delay)).rejects.toBeInstanceOf(
        RangeError,
      );
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});

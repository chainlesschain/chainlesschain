/**
 * stream-retry — shared retryable-connection-drop classifier used by both the
 * agent (agent-core) and chat (chat-core) streaming paths.
 */
import { describe, it, expect } from "vitest";
import {
  isRetryableStreamError,
  STREAM_RETRY_MAX,
  STREAM_RETRY_BASE_MS,
} from "../../src/lib/stream-retry.js";

describe("isRetryableStreamError", () => {
  it("retries genuine connection drops (by code and by message)", () => {
    for (const code of ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EPIPE"]) {
      expect(
        isRetryableStreamError(Object.assign(new Error("x"), { code })),
      ).toBe(true);
    }
    expect(isRetryableStreamError(new TypeError("fetch failed"))).toBe(true);
    expect(isRetryableStreamError(new Error("socket hang up"))).toBe(true);
    expect(isRetryableStreamError(new Error("terminated"))).toBe(true);
    // undici nests the real code under .cause
    const undici = Object.assign(new TypeError("fetch failed"), {
      cause: { code: "UND_ERR_SOCKET" },
    });
    expect(isRetryableStreamError(undici)).toBe(true);
  });

  it("does NOT retry user aborts", () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    expect(isRetryableStreamError(abort)).toBe(false);
    const ctrl = new AbortController();
    ctrl.abort();
    expect(isRetryableStreamError(new Error("ECONNRESET"), ctrl.signal)).toBe(
      false,
    );
  });

  it("does NOT retry HTTP/auth/server errors or stall aborts", () => {
    expect(isRetryableStreamError(new Error("API error: HTTP 401"))).toBe(
      false,
    );
    expect(isRetryableStreamError(new Error("API error: HTTP 500"))).toBe(
      false,
    );
    expect(
      isRetryableStreamError(
        new Error("Ollama stream stalled (no data in 180s)"),
      ),
    ).toBe(false);
    expect(isRetryableStreamError(null)).toBe(false);
    expect(isRetryableStreamError(undefined)).toBe(false);
  });

  it("exposes a bounded, sane retry budget", () => {
    expect(STREAM_RETRY_MAX).toBeGreaterThanOrEqual(1);
    expect(STREAM_RETRY_BASE_MS).toBeGreaterThan(0);
  });
});

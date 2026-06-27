/**
 * stream-retry — shared retryable-connection-drop classifier used by both the
 * agent (agent-core) and chat (chat-core) streaming paths.
 */
import { describe, it, expect } from "vitest";
import {
  isRetryableStreamError,
  STREAM_RETRY_MAX,
  STREAM_RETRY_BASE_MS,
  STREAM_RETRY_MAX_CAP,
  resolveStreamRetryMax,
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

describe("resolveStreamRetryMax (CC_MAX_RETRIES / CLAUDE_CODE_MAX_RETRIES)", () => {
  it("defaults to STREAM_RETRY_MAX when unset / blank / non-numeric", () => {
    expect(resolveStreamRetryMax({})).toBe(STREAM_RETRY_MAX);
    expect(resolveStreamRetryMax({ CC_MAX_RETRIES: "" })).toBe(
      STREAM_RETRY_MAX,
    );
    expect(resolveStreamRetryMax({ CC_MAX_RETRIES: "  " })).toBe(
      STREAM_RETRY_MAX,
    );
    expect(resolveStreamRetryMax({ CC_MAX_RETRIES: "abc" })).toBe(
      STREAM_RETRY_MAX,
    );
  });

  it("honors an explicit numeric value", () => {
    expect(resolveStreamRetryMax({ CC_MAX_RETRIES: "5" })).toBe(5);
    expect(resolveStreamRetryMax({ CC_MAX_RETRIES: " 7 " })).toBe(7);
    expect(resolveStreamRetryMax({ CLAUDE_CODE_MAX_RETRIES: "4" })).toBe(4);
  });

  it("caps at STREAM_RETRY_MAX_CAP (15) and clamps negatives to 0", () => {
    expect(resolveStreamRetryMax({ CC_MAX_RETRIES: "999" })).toBe(
      STREAM_RETRY_MAX_CAP,
    );
    expect(STREAM_RETRY_MAX_CAP).toBe(15);
    expect(resolveStreamRetryMax({ CC_MAX_RETRIES: "-3" })).toBe(0);
    expect(resolveStreamRetryMax({ CC_MAX_RETRIES: "0" })).toBe(0);
  });

  it("CC_MAX_RETRIES wins over CLAUDE_CODE_MAX_RETRIES when both set", () => {
    expect(
      resolveStreamRetryMax({
        CC_MAX_RETRIES: "6",
        CLAUDE_CODE_MAX_RETRIES: "9",
      }),
    ).toBe(6);
  });
});

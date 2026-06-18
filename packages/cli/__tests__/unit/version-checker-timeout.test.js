/**
 * version-checker fetch timeout.
 *
 * `cc update` / `cc vcheck` fetch GitHub + npm metadata. A stalled registry must
 * not hang the command forever — each fetch is bounded by a timeout, and
 * checkForUpdates degrades gracefully to the "unavailable" result.
 *
 * CC_VERSION_CHECK_TIMEOUT_MS is set before importing so the module-level
 * timeout picks up a tiny value (vitest isolates modules per file).
 */

import { describe, it, expect, vi, afterEach } from "vitest";

process.env.CC_VERSION_CHECK_TIMEOUT_MS = "60";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("version-checker fetch timeout", () => {
  it("degrades to 'unavailable' instead of hanging when both endpoints stall", async () => {
    // fetch never resolves but honours the abort signal → the timeout fires.
    vi.stubGlobal(
      "fetch",
      (url, opts) =>
        new Promise((_resolve, reject) => {
          opts.signal?.addEventListener("abort", () => {
            const e = new Error("aborted");
            e.name = "AbortError";
            reject(e);
          });
        }),
    );
    const { checkForUpdates } =
      await import("../../src/lib/version-checker.js");
    const result = await checkForUpdates({ currentVersion: "0.1.0" });
    expect(result.updateAvailable).toBe(false);
    expect(result.error).toMatch(/unable to check/i);
  });
});

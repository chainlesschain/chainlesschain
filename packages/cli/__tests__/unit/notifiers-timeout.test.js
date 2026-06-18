/**
 * Webhook-notifier fetch timeout.
 *
 * A notification POST (DingTalk / Feishu / Telegram / WeCom) must not hang
 * forever on a slow / dead webhook endpoint. The shared fetchWithTimeout aborts
 * after NOTIFIER_TIMEOUT_MS; each notifier's send() already try/catches, so a
 * timeout surfaces as a clean { ok: false, reason } instead of a hang.
 *
 * CC_NOTIFIER_TIMEOUT_MS is set before importing so the module-level timeout
 * picks up a tiny value (vitest isolates modules per file).
 */

import { describe, it, expect, afterEach, vi } from "vitest";

process.env.CC_NOTIFIER_TIMEOUT_MS = "60";
const { DingTalkNotifier } =
  await import("../../src/lib/notifiers/dingtalk.js");
const { FeishuNotifier } = await import("../../src/lib/notifiers/feishu.js");
const { NOTIFIER_TIMEOUT_MS } =
  await import("../../src/lib/notifiers/_http.js");

afterEach(() => {
  vi.unstubAllGlobals();
});

function hangingFetch() {
  return (url, opts) =>
    new Promise((_resolve, reject) => {
      opts.signal?.addEventListener("abort", () => {
        const e = new Error("aborted");
        e.name = "AbortError";
        reject(e);
      });
    });
}

describe("notifier fetch timeout", () => {
  it("picks up CC_NOTIFIER_TIMEOUT_MS", () => {
    expect(NOTIFIER_TIMEOUT_MS).toBe(60);
  });

  it("DingTalk send() returns a clean failure on a hung webhook (no hang)", async () => {
    vi.stubGlobal("fetch", hangingFetch());
    const n = new DingTalkNotifier({ webhookUrl: "https://example.com/hook" });
    const result = await n.send("title", "body");
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/timed out/i);
  });

  it("Feishu send() returns a clean failure on a hung webhook", async () => {
    vi.stubGlobal("fetch", hangingFetch());
    const n = new FeishuNotifier({ webhookUrl: "https://example.com/hook" });
    const result = await n.send("title", ["body line"]);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/timed out/i);
  });
});

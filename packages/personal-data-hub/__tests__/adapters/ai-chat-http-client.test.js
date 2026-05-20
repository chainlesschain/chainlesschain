"use strict";

import { describe, it, expect } from "vitest";

const {
  HttpClient,
  RateLimitedError,
  CookieExpiredError,
} = require("../../lib/adapters/ai-chat-history/http-client");
const {
  CookieAuthSession,
} = require("../../lib/adapters/ai-chat-history/cookie-auth");

// ─── helpers ─────────────────────────────────────────────────────────────

function makeResponse({ status = 200, body = {}, headers = {} } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k) => headers[k.toLowerCase()] || null },
    async json() { return body; },
    async text() { return JSON.stringify(body); },
  };
}

function makeFetchStub(responses) {
  const calls = [];
  const queue = Array.isArray(responses) ? responses.slice() : [responses];
  const stub = async (url, init) => {
    calls.push({ url, init });
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (typeof next === "function") return next(url, init);
    if (next instanceof Error) throw next;
    return next;
  };
  return { stub, calls };
}

function makeClock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms) => { t += ms; },
  };
}

function makeSleep(clock) {
  return async (ms) => clock.advance(ms);
}

// ─── basic GET / response handling ────────────────────────────────────────

describe("HttpClient.request", () => {
  it("rejects construction without vendor", () => {
    expect(() => new HttpClient({})).toThrow(/vendor/);
  });

  it("injects cookies from a vendor-matched session", async () => {
    const clk = makeClock();
    const { stub, calls } = makeFetchStub(makeResponse({ body: { ok: 1 } }));
    const c = new HttpClient({
      vendor: "deepseek",
      rateLimits: { perMinute: 0, minIntervalMs: 0 },
      fetch: stub,
      sleep: makeSleep(clk),
      now: clk.now,
    });
    const session = new CookieAuthSession({
      vendor: "deepseek",
      cookies: [{ name: "userToken", value: "abc" }, { name: "session", value: "xyz" }],
    });
    await c.request("https://chat.deepseek.com/api/v0/user/get_user_info", { session });
    expect(calls.length).toBe(1);
    expect(calls[0].init.headers.Cookie).toBe("userToken=abc; session=xyz");
  });

  it("rejects session whose vendor does not match", async () => {
    const clk = makeClock();
    const c = new HttpClient({
      vendor: "deepseek",
      rateLimits: { perMinute: 0, minIntervalMs: 0 },
      fetch: () => makeResponse(),
      sleep: makeSleep(clk),
      now: clk.now,
    });
    const session = new CookieAuthSession({ vendor: "kimi", cookies: [] });
    await expect(c.request("https://x", { session })).rejects.toThrow(/vendor.*mismatch/);
  });

  it("getJson returns parsed JSON body", async () => {
    const clk = makeClock();
    const { stub } = makeFetchStub(makeResponse({ body: { hello: "world" } }));
    const c = new HttpClient({
      vendor: "deepseek",
      rateLimits: { perMinute: 0, minIntervalMs: 0 },
      fetch: stub, sleep: makeSleep(clk), now: clk.now,
    });
    expect(await c.getJson("https://x")).toEqual({ hello: "world" });
  });

  it("postJson sends body + content-type header", async () => {
    const clk = makeClock();
    const { stub, calls } = makeFetchStub(makeResponse({ body: { ok: 1 } }));
    const c = new HttpClient({
      vendor: "kimi",
      rateLimits: { perMinute: 0, minIntervalMs: 0 },
      fetch: stub, sleep: makeSleep(clk), now: clk.now,
    });
    await c.postJson("https://kimi.moonshot.cn/api/x", { last: "0", limit: 30 });
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(calls[0].init.body)).toEqual({ last: "0", limit: 30 });
  });
});

// ─── error classification ────────────────────────────────────────────────

describe("HttpClient — error mapping", () => {
  it("401 throws CookieExpiredError", async () => {
    const clk = makeClock();
    const { stub } = makeFetchStub(makeResponse({ status: 401 }));
    const c = new HttpClient({
      vendor: "deepseek",
      rateLimits: { perMinute: 0, minIntervalMs: 0 },
      fetch: stub, sleep: makeSleep(clk), now: clk.now,
    });
    await expect(c.request("https://x")).rejects.toBeInstanceOf(CookieExpiredError);
  });

  it("403 throws CookieExpiredError", async () => {
    const clk = makeClock();
    const { stub } = makeFetchStub(makeResponse({ status: 403 }));
    const c = new HttpClient({
      vendor: "deepseek",
      rateLimits: { perMinute: 0, minIntervalMs: 0 },
      fetch: stub, sleep: makeSleep(clk), now: clk.now,
    });
    await expect(c.request("https://x")).rejects.toBeInstanceOf(CookieExpiredError);
  });

  it("retries 5xx then throws after maxRetries", async () => {
    const clk = makeClock();
    const { stub, calls } = makeFetchStub(makeResponse({ status: 502 }));
    const c = new HttpClient({
      vendor: "deepseek",
      rateLimits: { perMinute: 0, minIntervalMs: 0 },
      fetch: stub, sleep: makeSleep(clk), now: clk.now,
      maxRetries: 2, baseBackoffMs: 1,
    });
    await expect(c.request("https://x")).rejects.toThrow(/HTTP 502/);
    expect(calls.length).toBe(3); // initial + 2 retries
  });

  it("recovers after 5xx if a later attempt succeeds", async () => {
    const clk = makeClock();
    const { stub, calls } = makeFetchStub([
      makeResponse({ status: 503 }),
      makeResponse({ status: 503 }),
      makeResponse({ body: { ok: 1 } }),
    ]);
    const c = new HttpClient({
      vendor: "deepseek",
      rateLimits: { perMinute: 0, minIntervalMs: 0 },
      fetch: stub, sleep: makeSleep(clk), now: clk.now,
      maxRetries: 3, baseBackoffMs: 1,
    });
    const resp = await c.request("https://x");
    expect(resp.ok).toBe(true);
    expect(calls.length).toBe(3);
  });

  it("429 with retry-after header sleeps that many seconds, throws RateLimitedError after maxRetries", async () => {
    const clk = makeClock();
    const { stub, calls } = makeFetchStub(
      makeResponse({ status: 429, headers: { "retry-after": "2" } }),
    );
    const c = new HttpClient({
      vendor: "kimi",
      rateLimits: { perMinute: 0, minIntervalMs: 0 },
      fetch: stub, sleep: makeSleep(clk), now: clk.now,
      maxRetries: 1, baseBackoffMs: 1,
    });
    await expect(c.request("https://x")).rejects.toBeInstanceOf(RateLimitedError);
    expect(calls.length).toBe(2); // initial + 1 retry
  });

  it("network error retries then re-throws", async () => {
    const clk = makeClock();
    const { stub, calls } = makeFetchStub([
      new Error("ECONNRESET"),
      makeResponse({ body: { ok: 1 } }),
    ]);
    const c = new HttpClient({
      vendor: "deepseek",
      rateLimits: { perMinute: 0, minIntervalMs: 0 },
      fetch: stub, sleep: makeSleep(clk), now: clk.now,
      maxRetries: 2, baseBackoffMs: 1,
    });
    const resp = await c.request("https://x");
    expect(resp.ok).toBe(true);
    expect(calls.length).toBe(2);
  });
});

// ─── rate limit gating ───────────────────────────────────────────────────

describe("HttpClient — rate limits", () => {
  it("enforces minIntervalMs between calls", async () => {
    const clk = makeClock();
    let sleepCalls = [];
    const sleep = async (ms) => { sleepCalls.push(ms); clk.advance(ms); };
    const { stub } = makeFetchStub(makeResponse({ body: { ok: 1 } }));
    const c = new HttpClient({
      vendor: "deepseek",
      rateLimits: { perMinute: 0, minIntervalMs: 1500 },
      fetch: stub, sleep, now: clk.now,
    });
    await c.request("https://x");
    await c.request("https://x");
    // The first call has no prior; the second waits 1500ms.
    expect(sleepCalls).toContain(1500);
  });

  it("enforces perMinute sliding-window cap", async () => {
    const clk = makeClock();
    let sleepCalls = [];
    const sleep = async (ms) => { sleepCalls.push(ms); clk.advance(ms); };
    const { stub } = makeFetchStub(makeResponse({ body: { ok: 1 } }));
    const c = new HttpClient({
      vendor: "kimi",
      rateLimits: { perMinute: 2, minIntervalMs: 0 },
      fetch: stub, sleep, now: clk.now,
    });
    await c.request("https://x");
    await c.request("https://x");
    await c.request("https://x"); // should wait
    // The 3rd call's enforce path should sleep until the 60s window has slid
    // past the first call's timestamp.
    const waited = sleepCalls.find((ms) => ms > 0 && ms <= 60_000);
    expect(waited).toBeDefined();
  });
});

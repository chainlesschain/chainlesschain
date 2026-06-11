"use strict";

import { describe, it, expect, vi } from "vitest";

const {
  ToutiaoApiClient,
  _internals,
} = require("../../lib/adapters/social-toutiao-adb/api-client");
const { NULL_SIGN_PROVIDER } = require("../../lib/sign-providers");

function makeFakeFetch(responses) {
  const calls = [];
  const fakeFetch = async (urlStr, opts) => {
    calls.push({ url: urlStr, opts });
    for (const [pattern, payload] of responses) {
      if (urlStr.includes(pattern)) {
        const resolved =
          typeof payload === "function" ? await payload(urlStr, opts) : payload;
        return {
          ok: resolved.status == null || resolved.status === 200,
          status: resolved.status || 200,
          text: async () => resolved.body,
        };
      }
    }
    throw new Error("fake fetch: no response for " + urlStr);
  };
  return { fakeFetch, calls };
}

describe("ToutiaoApiClient — extractUid", () => {
  it("prefers passport_uid", () => {
    const c = new ToutiaoApiClient({ fetch: () => {} });
    expect(c.extractUid("passport_uid=12345; sessionid=abc")).toBe("12345");
    expect(c.lastErrorCode).toBe(0);
  });

  it("falls back to multi_sids first segment", () => {
    const c = new ToutiaoApiClient({ fetch: () => {} });
    expect(c.extractUid("multi_sids=67890:abcd;11111:efgh")).toBe("67890");
  });

  it("falls back to __ac_uid", () => {
    const c = new ToutiaoApiClient({ fetch: () => {} });
    expect(c.extractUid("__ac_uid=555")).toBe("555");
  });

  it("falls back to tt_uid legacy", () => {
    const c = new ToutiaoApiClient({ fetch: () => {} });
    expect(c.extractUid("tt_uid=777")).toBe("777");
  });

  it("returns null on empty cookie", () => {
    const c = new ToutiaoApiClient({ fetch: () => {} });
    expect(c.extractUid("")).toBe(null);
    expect(c.lastErrorCode).toBe(-1);
  });

  it("returns null on '0' sentinels (anonymous)", () => {
    const c = new ToutiaoApiClient({ fetch: () => {} });
    expect(c.extractUid("passport_uid=0; __ac_uid=0")).toBe(null);
    expect(c.lastErrorCode).toBe(-7);
  });

  it("returns null when no uid candidate present", () => {
    const c = new ToutiaoApiClient({ fetch: () => {} });
    expect(c.extractUid("sessionid=abc; ttwid=def")).toBe(null);
    expect(c.lastErrorCode).toBe(-7);
  });
});

describe("ToutiaoApiClient — signProvider injection", () => {
  it("defaults to NULL_SIGN_PROVIDER", () => {
    const c = new ToutiaoApiClient({ fetch: () => {} });
    expect(c.signProvider).toBe(NULL_SIGN_PROVIDER);
  });

  it("uses opts.signProvider verbatim", () => {
    const fake = { signUrl: vi.fn(async () => null) };
    const c = new ToutiaoApiClient({ fetch: () => {}, signProvider: fake });
    expect(c.signProvider).toBe(fake);
  });

  it("fetchProfile does NOT call signUrl (no _sig required)", async () => {
    const { fakeFetch } = makeFakeFetch([
      [
        "passport/account/info/v2",
        {
          body: JSON.stringify({
            status_code: 0,
            data: { user_id: "12345", screen_name: "Alice" },
          }),
        },
      ],
    ]);
    const sign = { signUrl: vi.fn(async () => null) };
    const c = new ToutiaoApiClient({
      fetch: fakeFetch,
      signProvider: sign,
    });
    await c.fetchProfile("sessionid=abc");
    expect(sign.signUrl).not.toHaveBeenCalled();
  });

  it("3 signed endpoints SHORT-CIRCUIT (-99) when NullSignProvider", async () => {
    const { fakeFetch, calls } = makeFakeFetch([]);
    const c = new ToutiaoApiClient({ fetch: fakeFetch });
    const f = await c.fetchFeed("sessionid=abc");
    const co = await c.fetchCollection("sessionid=abc");
    const s = await c.fetchSearchHistory("sessionid=abc");
    expect(f).toEqual([]);
    expect(co).toEqual([]);
    expect(s).toEqual([]);
    expect(c.lastErrorCode).toBe(-99);
    expect(c._fallbackHits).toBe(3);
    expect(c._bridgeHits).toBe(0);
    // Critical: NO HTTP requests went out (signed endpoints short-
    // circuit BEFORE calling fetch — saves bandwidth on cold bridge).
    expect(calls).toHaveLength(0);
  });

  it("signed endpoint sends mutated URL when signProvider returns one", async () => {
    const { fakeFetch, calls } = makeFakeFetch([
      [
        "api/news/feed/v90",
        {
          body: JSON.stringify({
            data: [
              {
                group_id: "G1",
                title: "T",
                behot_time: 1700000000,
                category: "tech",
              },
            ],
          }),
        },
      ],
    ]);
    const sign = {
      signUrl: vi.fn(async (url) => {
        const u = new URL(String(url));
        u.searchParams.set("_signature", "BRIDGE_SIG_123");
        return u;
      }),
    };
    const c = new ToutiaoApiClient({ fetch: fakeFetch, signProvider: sign });
    const items = await c.fetchFeed("sessionid=abc", { limit: 5 });
    expect(items).toHaveLength(1);
    expect(items[0].itemId).toBe("G1");
    expect(sign.signUrl).toHaveBeenCalledOnce();
    expect(calls[0].url).toContain("_signature=BRIDGE_SIG_123");
    expect(c._bridgeHits).toBe(1);
    expect(c._fallbackHits).toBe(0);
  });

  it("forwards purpose string to signUrl", async () => {
    const { fakeFetch } = makeFakeFetch([
      ["api/news/feed/v90", { body: JSON.stringify({ data: [] }) }],
      ["article/v2/tab_comments", { body: JSON.stringify({ data: [] }) }],
      ["api/search/content", { body: JSON.stringify({ data: {} }) }],
    ]);
    const sign = {
      signUrl: vi.fn(async (url) => {
        const u = new URL(String(url));
        u.searchParams.set("_signature", "X");
        return u;
      }),
    };
    const c = new ToutiaoApiClient({ fetch: fakeFetch, signProvider: sign });
    await c.fetchFeed("sessionid=abc");
    await c.fetchCollection("sessionid=abc");
    await c.fetchSearchHistory("sessionid=abc");
    expect(sign.signUrl.mock.calls[0][1]).toBe("feed");
    expect(sign.signUrl.mock.calls[1][1]).toBe("comments");
    expect(sign.signUrl.mock.calls[2][1]).toBe("search");
  });
});

describe("ToutiaoApiClient — fetchProfile", () => {
  it("parses status_code=0 + data.user_id (string)", async () => {
    const { fakeFetch, calls } = makeFakeFetch([
      [
        "passport/account/info/v2",
        {
          body: JSON.stringify({
            status_code: 0,
            data: {
              user_id: "12345",
              screen_name: "Alice",
              avatar_url: "https://a/x.jpg",
              mobile: "138****",
              description: "bio",
              following_count: 10,
              followers_count: 99,
              media_id: "5678",
            },
          }),
        },
      ],
    ]);
    const c = new ToutiaoApiClient({ fetch: fakeFetch });
    const p = await c.fetchProfile("sessionid=abc");
    expect(p).toMatchObject({
      uid: "12345",
      nickname: "Alice",
      avatarUrl: "https://a/x.jpg",
      mobile: "138****",
      description: "bio",
      followingCount: 10,
      followerCount: 99,
      mediaId: "5678",
    });
    // aid=24 is in the URL
    expect(calls[0].url).toContain("aid=24");
  });

  it("returns null on status_code != 0", async () => {
    const { fakeFetch } = makeFakeFetch([
      [
        "passport/account/info/v2",
        {
          body: JSON.stringify({
            status_code: 1,
            status_msg: "token expired",
          }),
        },
      ],
    ]);
    const c = new ToutiaoApiClient({ fetch: fakeFetch });
    const p = await c.fetchProfile("sessionid=abc");
    expect(p).toBe(null);
    expect(c.lastErrorCode).toBe(1);
    expect(c.lastErrorMessage).toBe("token expired");
  });

  it("returns null on missing data object", async () => {
    const { fakeFetch } = makeFakeFetch([
      [
        "passport/account/info/v2",
        { body: JSON.stringify({ status_code: 0 }) },
      ],
    ]);
    const c = new ToutiaoApiClient({ fetch: fakeFetch });
    expect(await c.fetchProfile("sessionid=abc")).toBe(null);
    expect(c.lastErrorCode).toBe(-6);
  });

  it("returns null on missing user_id in data", async () => {
    const { fakeFetch } = makeFakeFetch([
      [
        "passport/account/info/v2",
        {
          body: JSON.stringify({
            status_code: 0,
            data: { screen_name: "noUidShown" },
          }),
        },
      ],
    ]);
    const c = new ToutiaoApiClient({ fetch: fakeFetch });
    expect(await c.fetchProfile("sessionid=abc")).toBe(null);
    expect(c.lastErrorCode).toBe(-7);
  });

  it("HTTP 412 anti-bot returns null with status code", async () => {
    const { fakeFetch } = makeFakeFetch([
      ["passport/account/info/v2", { status: 412, body: "<html>blocked" }],
    ]);
    const c = new ToutiaoApiClient({ fetch: fakeFetch });
    expect(await c.fetchProfile("sessionid=abc")).toBe(null);
    expect(c.lastErrorCode).toBe(412);
  });

  it("non-JSON response returns null with -4", async () => {
    const { fakeFetch } = makeFakeFetch([
      ["passport/account/info/v2", { body: "<html>login redirect" }],
    ]);
    const c = new ToutiaoApiClient({ fetch: fakeFetch });
    expect(await c.fetchProfile("sessionid=abc")).toBe(null);
    expect(c.lastErrorCode).toBe(-4);
  });

  // ── passport v2 envelope (real-device 2026-06-11, no status_code) ──
  it("parses passport-v2 success envelope { message:'success', data } (no status_code)", async () => {
    const { fakeFetch } = makeFakeFetch([
      [
        "passport/account/info/v2",
        {
          body: JSON.stringify({
            message: "success",
            data: { user_id: "555", screen_name: "v2user" },
          }),
        },
      ],
    ]);
    const c = new ToutiaoApiClient({ fetch: fakeFetch });
    const p = await c.fetchProfile("sessionid=abc");
    expect(p).not.toBe(null);
    expect(p.uid).toBe("555");
    expect(p.nickname).toBe("v2user");
  });

  it("surfaces passport-v2 error envelope error_code + 中文 description (error_code 16 该应用无权限)", async () => {
    // Verified on device 5lhyaqu8lbwstc6x with a fully logged-in Toutiao:
    // the endpoint now returns this even with valid sessionid cookies. The
    // old code mis-reported it as "missing status_code".
    const { fakeFetch } = makeFakeFetch([
      [
        "passport/account/info/v2",
        {
          body: JSON.stringify({
            message: "error",
            data: { error_code: 16, description: "该应用无权限", captcha: "" },
          }),
        },
      ],
    ]);
    const c = new ToutiaoApiClient({ fetch: fakeFetch });
    expect(await c.fetchProfile("sessionid=abc")).toBe(null);
    expect(c.lastErrorCode).toBe(16);
    expect(c.lastErrorMessage).toBe("该应用无权限");
  });

  it("unrecognized envelope (no status_code, no message) → -5 with key list", async () => {
    const { fakeFetch } = makeFakeFetch([
      ["passport/account/info/v2", { body: JSON.stringify({ foo: "bar" }) }],
    ]);
    const c = new ToutiaoApiClient({ fetch: fakeFetch });
    expect(await c.fetchProfile("sessionid=abc")).toBe(null);
    expect(c.lastErrorCode).toBe(-5);
  });
});

describe("ToutiaoApiClient — fetchFeed", () => {
  it("parses items + top-level raw fields", async () => {
    const { fakeFetch } = makeFakeFetch([
      [
        "api/news/feed/v90",
        {
          body: JSON.stringify({
            data: [
              {
                group_id: "G1",
                title: "Title 1",
                category: "tech",
                source: "WeRead",
                behot_time: 1700000000, // seconds → ms via normalizeMs
                read_duration: 30,
              },
            ],
          }),
        },
      ],
    ]);
    const sign = {
      signUrl: vi.fn(async (url) => {
        const u = new URL(String(url));
        u.searchParams.set("_signature", "X");
        return u;
      }),
    };
    const c = new ToutiaoApiClient({ fetch: fakeFetch, signProvider: sign });
    const items = await c.fetchFeed("sessionid=abc");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      itemId: "G1",
      title: "Title 1",
      category: "tech",
      readDuration: 30,
    });
    expect(items[0].publishedAt).toBe(1700000000 * 1000);
  });

  it("decodes nested raw_data JSON string", async () => {
    const { fakeFetch } = makeFakeFetch([
      [
        "api/news/feed/v90",
        {
          body: JSON.stringify({
            data: [
              {
                category: "outer-cat",
                raw_data: JSON.stringify({
                  group_id: "INNER1",
                  title: "From nested",
                  behot_time: 1700000000,
                }),
              },
            ],
          }),
        },
      ],
    ]);
    const sign = {
      signUrl: vi.fn(async (url) => {
        const u = new URL(String(url));
        u.searchParams.set("_signature", "X");
        return u;
      }),
    };
    const c = new ToutiaoApiClient({ fetch: fakeFetch, signProvider: sign });
    const items = await c.fetchFeed("sessionid=abc");
    expect(items[0].itemId).toBe("INNER1");
    expect(items[0].title).toBe("From nested");
  });

  it("falls back to outer category when nested item lacks one", async () => {
    const { fakeFetch } = makeFakeFetch([
      [
        "api/news/feed/v90",
        {
          body: JSON.stringify({
            data: [
              {
                category: "outer-cat",
                raw_data: JSON.stringify({ group_id: "G", title: "T" }),
              },
            ],
          }),
        },
      ],
    ]);
    const sign = {
      signUrl: vi.fn(async (url) => {
        const u = new URL(String(url));
        u.searchParams.set("_signature", "X");
        return u;
      }),
    };
    const c = new ToutiaoApiClient({ fetch: fakeFetch, signProvider: sign });
    const items = await c.fetchFeed("sessionid=abc");
    expect(items[0].category).toBe("outer-cat");
  });

  it("returns [] on empty data array", async () => {
    const { fakeFetch } = makeFakeFetch([
      ["api/news/feed/v90", { body: JSON.stringify({ data: [] }) }],
    ]);
    const sign = {
      signUrl: vi.fn(async (url) => {
        const u = new URL(String(url));
        u.searchParams.set("_signature", "X");
        return u;
      }),
    };
    const c = new ToutiaoApiClient({ fetch: fakeFetch, signProvider: sign });
    expect(await c.fetchFeed("sessionid=abc")).toEqual([]);
  });
});

describe("ToutiaoApiClient — fetchCollection", () => {
  it("parses saved articles", async () => {
    const { fakeFetch } = makeFakeFetch([
      [
        "article/v2/tab_comments",
        {
          body: JSON.stringify({
            data: [
              {
                group_id: "C1",
                title: "Saved 1",
                category: "news",
                behot_time: 1700000000,
              },
            ],
          }),
        },
      ],
    ]);
    const sign = {
      signUrl: vi.fn(async (url) => {
        const u = new URL(String(url));
        u.searchParams.set("_signature", "X");
        return u;
      }),
    };
    const c = new ToutiaoApiClient({ fetch: fakeFetch, signProvider: sign });
    const items = await c.fetchCollection("sessionid=abc");
    expect(items[0]).toMatchObject({
      itemId: "C1",
      title: "Saved 1",
      category: "news",
    });
    expect(items[0].savedAt).toBe(1700000000 * 1000);
  });
});

describe("ToutiaoApiClient — fetchSearchHistory", () => {
  it("parses object-shape history with timestamps", async () => {
    const { fakeFetch } = makeFakeFetch([
      [
        "api/search/content",
        {
          body: JSON.stringify({
            data: {
              user_search_history: [
                { keyword: "AI", time: 1700000000 },
                { keyword: "rust", time: 1700001000 },
              ],
            },
          }),
        },
      ],
    ]);
    const sign = {
      signUrl: vi.fn(async (url) => {
        const u = new URL(String(url));
        u.searchParams.set("_signature", "X");
        return u;
      }),
    };
    const c = new ToutiaoApiClient({ fetch: fakeFetch, signProvider: sign });
    const items = await c.fetchSearchHistory("sessionid=abc");
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({ keyword: "AI", searchedAt: 1700000000 * 1000 });
  });

  it("parses bare-string legacy history (no timestamps)", async () => {
    const { fakeFetch } = makeFakeFetch([
      [
        "api/search/content",
        {
          body: JSON.stringify({
            data: { user_search_history: ["AI", "rust", "kotlin"] },
          }),
        },
      ],
    ]);
    const sign = {
      signUrl: vi.fn(async (url) => {
        const u = new URL(String(url));
        u.searchParams.set("_signature", "X");
        return u;
      }),
    };
    const fixedNow = () => 1716383021000;
    const c = new ToutiaoApiClient({
      fetch: fakeFetch,
      signProvider: sign,
      now: fixedNow,
    });
    const items = await c.fetchSearchHistory("sessionid=abc");
    expect(items).toHaveLength(3);
    // Latest first ordering — index 0 gets fixedNow
    expect(items[0]).toEqual({ keyword: "AI", searchedAt: 1716383021000 });
  });

  it("falls back to data.search_history shape", async () => {
    const { fakeFetch } = makeFakeFetch([
      [
        "api/search/content",
        {
          body: JSON.stringify({
            data: { search_history: [{ keyword: "fallback", time: 1 }] },
          }),
        },
      ],
    ]);
    const sign = {
      signUrl: vi.fn(async (url) => {
        const u = new URL(String(url));
        u.searchParams.set("_signature", "X");
        return u;
      }),
    };
    const c = new ToutiaoApiClient({ fetch: fakeFetch, signProvider: sign });
    const items = await c.fetchSearchHistory("sessionid=abc");
    expect(items[0].keyword).toBe("fallback");
  });
});

describe("normalizeMs", () => {
  it("passes through ms (>1e12)", () => {
    expect(_internals.normalizeMs(1700000000000)).toBe(1700000000000);
  });

  it("multiplies seconds (<1e12) by 1000", () => {
    expect(_internals.normalizeMs(1700000000)).toBe(1700000000 * 1000);
  });

  it("returns 0 for invalid / negative", () => {
    expect(_internals.normalizeMs(0)).toBe(0);
    expect(_internals.normalizeMs(-1)).toBe(0);
    expect(_internals.normalizeMs(NaN)).toBe(0);
  });
});

describe("err_no surfacing (HTTP 200 + err_no!=0 must NOT mask as empty)", () => {
  it("fetchCollection: {err_no:1,'params illegal',data:[]} → [] + lastErrorCode 1", async () => {
    // Real-device 2026-06-11: tab_comments returned this; the old code saw
    // data:[] and reported 0 results with errCode 0, hiding the real failure.
    const { fakeFetch } = makeFakeFetch([
      [
        "article/v2/tab_comments",
        { body: JSON.stringify({ message: "params illegal", err_no: 1, data: [] }) },
      ],
    ]);
    const sign = {
      signUrl: vi.fn(async (url) => {
        const u = new URL(String(url));
        u.searchParams.set("_signature", "X");
        return u;
      }),
    };
    const c = new ToutiaoApiClient({ fetch: fakeFetch, signProvider: sign });
    const items = await c.fetchCollection("sessionid=abc");
    expect(items).toEqual([]);
    expect(c.lastErrorCode).toBe(1);
    expect(c.lastErrorMessage).toBe("params illegal");
  });

  it("err_no:0 is treated as success (not masked)", async () => {
    const { fakeFetch } = makeFakeFetch([
      [
        "article/v2/tab_comments",
        { body: JSON.stringify({ err_no: 0, data: [{ group_id: "C1", title: "Saved", behot_time: 1700000000 }] }) },
      ],
    ]);
    const sign = { signUrl: vi.fn(async (url) => { const u = new URL(String(url)); u.searchParams.set("_signature", "X"); return u; }) };
    const c = new ToutiaoApiClient({ fetch: fakeFetch, signProvider: sign });
    const items = await c.fetchCollection("sessionid=abc");
    expect(items).toHaveLength(1);
    expect(items[0].itemId).toBe("C1");
  });
});

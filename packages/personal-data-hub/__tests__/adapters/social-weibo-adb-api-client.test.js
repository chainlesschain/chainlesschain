"use strict";

/**
 * Phase 3a — Weibo Node API client unit cover.
 *
 * Same fake-fetch pattern as social-bilibili-adb-api-client.test.js.
 * Byte-parity check against WeiboApiClient.kt (Kotlin) is in
 * `android-app/.../WeiboApiClient*Test.kt`.
 */

import { describe, it, expect, vi } from "vitest";

const { WeiboApiClient, _internals } = require(
  "../../lib/adapters/social-weibo-adb/api-client",
);

function makeClient(responses) {
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
          json: async () => JSON.parse(resolved.body),
        };
      }
    }
    throw new Error("fake fetch: no scripted response for " + urlStr);
  };
  return { client: new WeiboApiClient({ fetch: fakeFetch }), calls };
}

const FAKE_COOKIE = "SUB=abc; SUBP=def; _T_WM=tw1; MLOGIN=1";

// ─── _internals.parseWeiboTime ──────────────────────────────────────────

describe("parseWeiboTime", () => {
  it("parses 'EEE MMM dd HH:mm:ss Z yyyy' format", () => {
    const t = _internals.parseWeiboTime("Sun Jan 12 13:45:00 +0800 2026");
    // Sunday 2026-01-12 13:45:00 +0800 = 2026-01-12 05:45:00 UTC
    expect(t).toBeGreaterThan(0);
    const d = new Date(t);
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(0);
    expect(d.getUTCDate()).toBe(12);
    expect(d.getUTCHours()).toBe(5);
    expect(d.getUTCMinutes()).toBe(45);
  });

  it("digits-only treated as unix-seconds (< 1e12)", () => {
    expect(_internals.parseWeiboTime("1716383021")).toBe(1716383021000);
  });

  it("digits-only treated as ms (> 1e12)", () => {
    expect(_internals.parseWeiboTime("1716383021000")).toBe(1716383021000);
  });

  it("returns 0 for empty / null / unparseable", () => {
    expect(_internals.parseWeiboTime("")).toBe(0);
    expect(_internals.parseWeiboTime(null)).toBe(0);
    expect(_internals.parseWeiboTime(undefined)).toBe(0);
    expect(_internals.parseWeiboTime("not a date")).toBe(0);
  });
});

// ─── _internals.stripHtml ───────────────────────────────────────────────

describe("stripHtml", () => {
  it("strips <a> / <span> tags", () => {
    expect(
      _internals.stripHtml(
        '<a href="x">hello</a> <span class="y">world</span>',
      ),
    ).toBe("hello world");
  });

  it("decodes &nbsp; / &amp; / &lt; / &gt; / &quot;", () => {
    expect(_internals.stripHtml("a&nbsp;b&amp;c&lt;d&gt;e&quot;f")).toBe(
      'a b&c<d>e"f',
    );
  });

  it("handles Chinese + emoji", () => {
    expect(_internals.stripHtml("<p>你好 👋</p>")).toBe("你好 👋");
  });

  it("returns empty for null / empty", () => {
    expect(_internals.stripHtml("")).toBe("");
    expect(_internals.stripHtml(null)).toBe("");
  });
});

// ─── fetchUid ──────────────────────────────────────────────────────────

describe("WeiboApiClient.fetchUid", () => {
  it("returns numeric UID when login=true", async () => {
    const { client } = makeClient([
      [
        "api/config",
        { body: JSON.stringify({ ok: 1, data: { login: true, uid: "1234567890" } }) },
      ],
    ]);
    const uid = await client.fetchUid(FAKE_COOKIE);
    expect(uid).toBe(1234567890);
  });

  it("returns null when login=false", async () => {
    const { client } = makeClient([
      [
        "api/config",
        { body: JSON.stringify({ ok: 1, data: { login: false } }) },
      ],
    ]);
    expect(await client.fetchUid(FAKE_COOKIE)).toBe(null);
  });

  it("returns null on non-JSON (cookie expired login redirect)", async () => {
    const { client } = makeClient([
      ["api/config", { body: "<html>login redirect</html>" }],
    ]);
    expect(await client.fetchUid(FAKE_COOKIE)).toBe(null);
    expect(client.lastErrorCode).toBe(-4);
  });

  it("returns null on HTTP error", async () => {
    const { client } = makeClient([
      ["api/config", { status: 503, body: "Service Unavailable" }],
    ]);
    expect(await client.fetchUid(FAKE_COOKIE)).toBe(null);
    expect(client.lastErrorCode).toBe(503);
  });

  it("sends required browser headers", async () => {
    const { client, calls } = makeClient([
      [
        "api/config",
        { body: JSON.stringify({ ok: 1, data: { login: true, uid: "1" } }) },
      ],
    ]);
    await client.fetchUid(FAKE_COOKIE);
    const h = calls[0].opts.headers;
    expect(h["User-Agent"]).toContain("Mozilla");
    expect(h.Referer).toBe("https://m.weibo.cn/");
    expect(h["X-Requested-With"]).toBe("XMLHttpRequest");
    expect(h["MWeibo-Pwa"]).toBe("1");
    expect(h.Cookie).toBe(FAKE_COOKIE);
  });
});

// ─── fetchPosts ────────────────────────────────────────────────────────

describe("WeiboApiClient.fetchPosts", () => {
  it("parses card_type=9 mblog cards", async () => {
    const { client } = makeClient([
      [
        "api/container/getIndex",
        {
          body: JSON.stringify({
            ok: 1,
            data: {
              cards: [
                {
                  card_type: 9,
                  mblog: {
                    mid: "MBLOG_001",
                    text: '<a href="/user/x">@friend</a> hello 你好',
                    created_at: "Sun Jan 12 13:45:00 +0800 2026",
                    source: '<a href="x">iPhone 16</a>',
                    reposts_count: 5,
                    comments_count: 10,
                    attitudes_count: 100,
                    pic_num: 2,
                  },
                },
                { card_type: 11 /* banner — should skip */ },
                {
                  card_type: 9,
                  mblog: {
                    id: 12345, // alt id field
                    text: "second post",
                    created_at: "1716383021",
                  },
                },
              ],
            },
          }),
        },
      ],
    ]);
    const posts = await client.fetchPosts(FAKE_COOKIE, 1234567890);
    expect(posts).toHaveLength(2);
    expect(posts[0]).toMatchObject({
      mid: "MBLOG_001",
      text: "@friend hello 你好",
      // source field preserves raw HTML (Kotlin byte-parity — WeiboApiClient.kt
      // doesn't strip it; UI can strip if it wants)
      source: '<a href="x">iPhone 16</a>',
      repostsCount: 5,
      commentsCount: 10,
      likesCount: 100,
      picCount: 2,
    });
    expect(posts[1].mid).toBe("12345");
    expect(posts[1].text).toBe("second post");
  });

  it("respects limit", async () => {
    const items = Array.from({ length: 100 }, (_, i) => ({
      card_type: 9,
      mblog: { mid: `M${i}`, text: `t${i}`, created_at: "1716383021" },
    }));
    const { client } = makeClient([
      [
        "api/container/getIndex",
        { body: JSON.stringify({ ok: 1, data: { cards: items } }) },
      ],
    ]);
    const posts = await client.fetchPosts(FAKE_COOKIE, 1, { limit: 5 });
    expect(posts).toHaveLength(5);
  });

  it("uses containerid=107603<uid>", async () => {
    const { client, calls } = makeClient([
      [
        "api/container/getIndex",
        { body: JSON.stringify({ ok: 1, data: { cards: [] } }) },
      ],
    ]);
    await client.fetchPosts(FAKE_COOKIE, 99);
    expect(calls[0].url).toContain("containerid=10760399");
  });
});

// ─── fetchFavourites ───────────────────────────────────────────────────

describe("WeiboApiClient.fetchFavourites", () => {
  it("parses status nested rows", async () => {
    const { client } = makeClient([
      [
        "api/favorites",
        {
          body: JSON.stringify({
            ok: 1,
            data: {
              favorites: [
                {
                  favorited_time: "Sun Jan 12 14:00:00 +0800 2026",
                  status: {
                    mid: "FAV_001",
                    text: "interesting <em>thing</em>",
                    user: { screen_name: "@famous" },
                  },
                },
              ],
            },
          }),
        },
      ],
    ]);
    const favs = await client.fetchFavourites(FAKE_COOKIE);
    expect(favs).toHaveLength(1);
    expect(favs[0]).toMatchObject({
      mid: "FAV_001",
      text: "interesting thing",
      authorScreenName: "@famous",
    });
    expect(favs[0].favAt).toBeGreaterThan(0);
  });

  it("falls back to status.created_at when favorited_time absent", async () => {
    const { client } = makeClient([
      [
        "api/favorites",
        {
          body: JSON.stringify({
            ok: 1,
            data: {
              favorites: [
                {
                  status: {
                    mid: "X",
                    text: "y",
                    created_at: "Sun Jan 12 13:45:00 +0800 2026",
                  },
                },
              ],
            },
          }),
        },
      ],
    ]);
    const favs = await client.fetchFavourites(FAKE_COOKIE);
    expect(favs[0].favAt).toBeGreaterThan(0);
  });
});

// ─── fetchFollows ──────────────────────────────────────────────────────

describe("WeiboApiClient.fetchFollows", () => {
  it("parses users list", async () => {
    const { client } = makeClient([
      [
        "api/friendships/friends",
        {
          body: JSON.stringify({
            ok: 1,
            data: {
              users: [
                {
                  id: 42,
                  screen_name: "Friend1",
                  description: "hi",
                  profile_image_url: "https://x.png",
                },
                { id: 0, screen_name: "Ghost" }, // skip
                { id: 99, screen_name: "Friend2" },
              ],
            },
          }),
        },
      ],
    ]);
    const fols = await client.fetchFollows(FAKE_COOKIE, 1234);
    expect(fols).toHaveLength(2);
    expect(fols[0].uid).toBe(42);
    expect(fols[1].uid).toBe(99);
    expect(fols[0].screenName).toBe("Friend1");
  });

  it("uid sent as vmid query param", async () => {
    const { client, calls } = makeClient([
      [
        "api/friendships/friends",
        { body: JSON.stringify({ ok: 1, data: { users: [] } }) },
      ],
    ]);
    await client.fetchFollows(FAKE_COOKIE, 9999);
    expect(calls[0].url).toContain("uid=9999");
  });
});

// ─── error code propagation ─────────────────────────────────────────────

describe("WeiboApiClient — error propagation", () => {
  it("ok != 1 → returns [] + sets lastError", async () => {
    const { client } = makeClient([
      [
        "api/container/getIndex",
        { body: JSON.stringify({ ok: -100, msg: "anti-bot" }) },
      ],
    ]);
    const r = await client.fetchPosts(FAKE_COOKIE, 1);
    expect(r).toEqual([]);
    expect(client.lastErrorCode).toBe(-100);
    expect(client.lastErrorMessage).toBe("anti-bot");
  });
});

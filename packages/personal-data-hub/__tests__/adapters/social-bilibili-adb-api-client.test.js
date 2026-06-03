"use strict";

/**
 * Phase 1b — unit cover for BilibiliApiClient (Node port).
 *
 * Strategy: inject a fake `fetch` that returns canned responses per-URL.
 * We don't actually hit api.bilibili.com — the goal is byte-parity with
 * the Android Kotlin version, not real network testing.
 *
 * What we cover:
 *  - WBI signature: md5 stable across calls + sort order + forbidden-char
 *    strip + wts derivation from injected now()
 *  - buvid3 mint + substitution (existing buvid3 stripped, last-wins)
 *  - extractWbiKeyFromUrl edge cases
 *  - extractUid edge cases
 *  - 4 endpoint parse — happy-path response shapes mirroring Bilibili's
 *  - Partial-failure: any endpoint returns [] on transport / code-non-zero
 *  - lastErrorCode / lastErrorMessage set on failure
 *  - Endpoint URL contracts: required query params present
 */

import { describe, it, expect, beforeEach } from "vitest";

const {
  BilibiliApiClient,
  extractUid,
  _internals,
} = require("../../lib/adapters/social-bilibili-adb/api-client");
const {
  extractWbiKeyFromUrl,
  substituteBuvid3,
  md5Hex,
  stripForbiddenChars,
  signUrl,
  WBI_MIXIN_KEY_TABLE,
} = _internals;

// ─── Pure helpers ───────────────────────────────────────────────────────

describe("extractWbiKeyFromUrl", () => {
  it("extracts hex from CDN URL", () => {
    expect(
      extractWbiKeyFromUrl("https://i0.hdslb.com/bfs/wbi/abc123.png"),
    ).toBe("abc123");
  });

  it("handles missing extension → null", () => {
    expect(extractWbiKeyFromUrl("https://i0.hdslb.com/bfs/wbi/abc123")).toBe(null);
  });

  it("handles missing slash → null (no path component)", () => {
    expect(extractWbiKeyFromUrl("abc123.png")).toBe(null);
  });

  it("rejects empty / null", () => {
    expect(extractWbiKeyFromUrl("")).toBe(null);
    expect(extractWbiKeyFromUrl(null)).toBe(null);
    expect(extractWbiKeyFromUrl(undefined)).toBe(null);
  });
});

describe("substituteBuvid3", () => {
  it("appends buvid3 when cookie has none", () => {
    expect(substituteBuvid3("SESSDATA=abc; bili_jct=csrf", "newB3")).toBe(
      "SESSDATA=abc; bili_jct=csrf; buvid3=newB3",
    );
  });

  it("replaces existing buvid3 (last-wins)", () => {
    expect(
      substituteBuvid3("SESSDATA=abc; buvid3=oldB3; bili_jct=csrf", "newB3"),
    ).toBe("SESSDATA=abc; bili_jct=csrf; buvid3=newB3");
  });

  it("handles cookie with only buvid3", () => {
    expect(substituteBuvid3("buvid3=oldB3", "newB3")).toBe("buvid3=newB3");
  });

  it("handles empty cookie", () => {
    expect(substituteBuvid3("", "newB3")).toBe("buvid3=newB3");
  });
});

describe("stripForbiddenChars", () => {
  it("strips !'()*", () => {
    expect(stripForbiddenChars("hello!world'(test)*end")).toBe(
      "helloworldtestend",
    );
  });

  it("preserves other chars", () => {
    expect(stripForbiddenChars("normal text 123 中文")).toBe(
      "normal text 123 中文",
    );
  });

  it("handles non-string", () => {
    expect(stripForbiddenChars(42)).toBe("42");
  });
});

describe("md5Hex", () => {
  it("returns stable digest for known input", () => {
    expect(md5Hex("hello")).toBe("5d41402abc4b2a76b9719d911017c592");
    expect(md5Hex("")).toBe("d41d8cd98f00b204e9800998ecf8427e");
  });

  it("handles utf-8 chars", () => {
    expect(md5Hex("中文")).toBe(md5Hex("中文")); // stable
  });
});

// ─── signUrl ────────────────────────────────────────────────────────────

describe("signUrl", () => {
  it("appends wts + w_rid + preserves existing params", () => {
    const url = new URL("https://api.bilibili.com/x/foo");
    url.searchParams.set("ps", "30");
    url.searchParams.set("type", "archive");
    const signed = signUrl(url, "MIXIN_KEY_32_CHARS_LONG_AAAAAAA12", {
      now: () => 1716383021000,
    });
    expect(signed.searchParams.get("wts")).toBe("1716383021");
    expect(signed.searchParams.get("w_rid")).toMatch(/^[0-9a-f]{32}$/);
    expect(signed.searchParams.get("ps")).toBe("30");
    expect(signed.searchParams.get("type")).toBe("archive");
  });

  it("sorts existing params + wts alphabetically before md5", () => {
    // Same params, different insertion order → same w_rid
    const u1 = new URL("https://api.bilibili.com/x/foo");
    u1.searchParams.set("z", "1");
    u1.searchParams.set("a", "2");
    const u2 = new URL("https://api.bilibili.com/x/foo");
    u2.searchParams.set("a", "2");
    u2.searchParams.set("z", "1");
    const mixin = "M".repeat(32);
    const now = () => 1716383021000;
    const s1 = signUrl(u1, mixin, { now });
    const s2 = signUrl(u2, mixin, { now });
    expect(s1.searchParams.get("w_rid")).toBe(s2.searchParams.get("w_rid"));
  });

  it("strips forbidden chars from values before signing", () => {
    const u1 = new URL("https://api.bilibili.com/x/foo");
    u1.searchParams.set("title", "hello!world");
    const u2 = new URL("https://api.bilibili.com/x/foo");
    u2.searchParams.set("title", "helloworld");
    const mixin = "M".repeat(32);
    const now = () => 1716383021000;
    const s1 = signUrl(u1, mixin, { now });
    const s2 = signUrl(u2, mixin, { now });
    // After stripping `!`, the signature input should match
    expect(s1.searchParams.get("w_rid")).toBe(s2.searchParams.get("w_rid"));
  });

  it("uses Math.floor(now/1000) as wts", () => {
    const url = new URL("https://api.bilibili.com/x/foo");
    const signed = signUrl(url, "M".repeat(32), {
      now: () => 1716383021999, // .999 ms — should still floor to 1716383021
    });
    expect(signed.searchParams.get("wts")).toBe("1716383021");
  });
});

// ─── extractUid ─────────────────────────────────────────────────────────

describe("extractUid", () => {
  it("extracts from full Bilibili cookie", () => {
    expect(
      extractUid(
        "SESSDATA=abc; bili_jct=csrf; DedeUserID=1234567890; DedeUserID__ckMd5=xx; buvid3=b3",
      ),
    ).toBe(1234567890);
  });

  it("returns null when DedeUserID missing", () => {
    expect(extractUid("SESSDATA=abc; bili_jct=csrf")).toBe(null);
  });

  it("returns null when DedeUserID=0 (mid-logout)", () => {
    expect(extractUid("DedeUserID=0; SESSDATA=abc")).toBe(null);
  });

  it("handles whitespace around values", () => {
    expect(extractUid("SESSDATA=abc;   DedeUserID=42; ")).toBe(42);
  });

  it("rejects non-string", () => {
    expect(extractUid(null)).toBe(null);
    expect(extractUid(undefined)).toBe(null);
    expect(extractUid({})).toBe(null);
  });
});

// ─── BilibiliApiClient ──────────────────────────────────────────────────

function makeClient(responses) {
  /**
   * Fake fetch matches requests by URL substring → returns Response-like
   * object with text() + json() + ok + status. `responses` is an array
   * of [substring, payload] tuples.
   */
  const calls = [];
  const fakeFetch = async (urlStr, opts) => {
    calls.push({ url: urlStr, opts });
    for (const [pattern, payload] of responses) {
      if (urlStr.includes(pattern)) {
        const resolved = typeof payload === "function" ? await payload(urlStr, opts) : payload;
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
  const client = new BilibiliApiClient({
    fetch: fakeFetch,
    now: () => 1716383021000,
  });
  return { client, calls };
}

const FAKE_COOKIE = "SESSDATA=abc; bili_jct=csrf; DedeUserID=1234567890; DedeUserID__ckMd5=cm; buvid3=oldB3";

const NAV_RESPONSE_BODY = JSON.stringify({
  code: -101,
  data: {
    wbi_img: {
      img_url: "https://i0.hdslb.com/bfs/wbi/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png",
      sub_url: "https://i0.hdslb.com/bfs/wbi/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png",
    },
  },
});

const SPI_RESPONSE_BODY = JSON.stringify({
  code: 0,
  data: { b_3: "MINTED_BUVID3" },
});

describe("BilibiliApiClient — bootstrap (mint + nav)", () => {
  it("mints buvid3 once and caches", async () => {
    const { client, calls } = makeClient([
      ["finger/spi", { body: SPI_RESPONSE_BODY }],
      ["web-interface/nav", { body: NAV_RESPONSE_BODY }],
      ["history/cursor", { body: JSON.stringify({ code: 0, data: { list: [] } }) }],
    ]);
    await client.fetchHistory(FAKE_COOKIE);
    await client.fetchHistory(FAKE_COOKIE);
    const spiCalls = calls.filter((c) => c.url.includes("finger/spi"));
    expect(spiCalls).toHaveLength(1); // cached
  });

  it("derives mixin key from img+sub keys", async () => {
    const { client } = makeClient([
      ["finger/spi", { body: SPI_RESPONSE_BODY }],
      ["web-interface/nav", { body: NAV_RESPONSE_BODY }],
    ]);
    const mixin = await client._ensureWbiMixinKey();
    expect(mixin).toBeTruthy();
    expect(mixin).toHaveLength(32);
  });

  it("substitutes minted buvid3 into outgoing Cookie header", async () => {
    const { client, calls } = makeClient([
      ["finger/spi", { body: SPI_RESPONSE_BODY }],
      ["web-interface/nav", { body: NAV_RESPONSE_BODY }],
      ["history/cursor", { body: JSON.stringify({ code: 0, data: { list: [] } }) }],
    ]);
    await client.fetchHistory(FAKE_COOKIE);
    const histCall = calls.find((c) => c.url.includes("history/cursor"));
    expect(histCall).toBeTruthy();
    const sentCookie = histCall.opts.headers.Cookie;
    expect(sentCookie).toContain("buvid3=MINTED_BUVID3");
    expect(sentCookie).not.toContain("buvid3=oldB3");
  });

  it("signs URLs with wts + w_rid", async () => {
    const { client, calls } = makeClient([
      ["finger/spi", { body: SPI_RESPONSE_BODY }],
      ["web-interface/nav", { body: NAV_RESPONSE_BODY }],
      ["history/cursor", { body: JSON.stringify({ code: 0, data: { list: [] } }) }],
    ]);
    await client.fetchHistory(FAKE_COOKIE);
    const histCall = calls.find((c) => c.url.includes("history/cursor"));
    expect(histCall.url).toMatch(/wts=\d+/);
    expect(histCall.url).toMatch(/w_rid=[0-9a-f]{32}/);
  });

  it("degrades gracefully when nav fails", async () => {
    const { client, calls } = makeClient([
      ["finger/spi", { body: SPI_RESPONSE_BODY }],
      ["web-interface/nav", { status: 500, body: "Internal Error" }],
      ["history/cursor", { body: JSON.stringify({ code: 0, data: { list: [] } }) }],
    ]);
    const result = await client.fetchHistory(FAKE_COOKIE);
    expect(result).toEqual([]); // succeeds but with unsigned URL → server might 412
    const histCall = calls.find((c) => c.url.includes("history/cursor"));
    expect(histCall.url).not.toMatch(/w_rid=/); // no signature when nav failed
  });
});

// ─── fetchHistory ───────────────────────────────────────────────────────

describe("BilibiliApiClient.fetchHistory", () => {
  it("parses history response", async () => {
    const { client } = makeClient([
      ["finger/spi", { body: SPI_RESPONSE_BODY }],
      ["web-interface/nav", { body: NAV_RESPONSE_BODY }],
      [
        "history/cursor",
        {
          body: JSON.stringify({
            code: 0,
            data: {
              list: [
                {
                  history: { bvid: "BV1xx", oid: 100 },
                  title: "Test Video 1",
                  view_at: 1716383021,
                  duration: 300,
                  owner: { name: "uploader1", mid: 999 },
                  part: "Part 1",
                },
                {
                  history: { bvid: "BV2yy" },
                  title: "Test Video 2",
                  view_at: 1716383022,
                },
              ],
            },
          }),
        },
      ],
    ]);
    const history = await client.fetchHistory(FAKE_COOKIE);
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({
      bvid: "BV1xx",
      avid: 100,
      title: "Test Video 1",
      viewAt: 1716383021,
      duration: 300,
      uploader: "uploader1",
      uploaderMid: 999,
      part: "Part 1",
    });
    expect(history[1].bvid).toBe("BV2yy");
    expect(history[1].uploader).toBe(null);
  });

  it("respects limit", async () => {
    const items = Array.from({ length: 100 }, (_, i) => ({
      history: { bvid: `BV${i}` },
      title: "T",
      view_at: 1,
    }));
    const { client } = makeClient([
      ["finger/spi", { body: SPI_RESPONSE_BODY }],
      ["web-interface/nav", { body: NAV_RESPONSE_BODY }],
      ["history/cursor", { body: JSON.stringify({ code: 0, data: { list: items } }) }],
    ]);
    const history = await client.fetchHistory(FAKE_COOKIE, { limit: 5 });
    expect(history).toHaveLength(5);
  });

  it("returns [] when code != 0 + sets lastError", async () => {
    const { client } = makeClient([
      ["finger/spi", { body: SPI_RESPONSE_BODY }],
      ["web-interface/nav", { body: NAV_RESPONSE_BODY }],
      [
        "history/cursor",
        { body: JSON.stringify({ code: -412, message: "anti-spider" }) },
      ],
    ]);
    const history = await client.fetchHistory(FAKE_COOKIE);
    expect(history).toEqual([]);
    expect(client.lastErrorCode).toBe(-412);
    expect(client.lastErrorMessage).toBe("anti-spider");
  });

  it("returns [] on HTTP error + sets lastError", async () => {
    const { client } = makeClient([
      ["finger/spi", { body: SPI_RESPONSE_BODY }],
      ["web-interface/nav", { body: NAV_RESPONSE_BODY }],
      ["history/cursor", { status: 503, body: "Service Unavailable" }],
    ]);
    const history = await client.fetchHistory(FAKE_COOKIE);
    expect(history).toEqual([]);
    expect(client.lastErrorCode).toBe(503);
  });

  it("includes required query params (type=archive, ps=30)", async () => {
    const { client, calls } = makeClient([
      ["finger/spi", { body: SPI_RESPONSE_BODY }],
      ["web-interface/nav", { body: NAV_RESPONSE_BODY }],
      ["history/cursor", { body: JSON.stringify({ code: 0, data: { list: [] } }) }],
    ]);
    await client.fetchHistory(FAKE_COOKIE);
    const histCall = calls.find((c) => c.url.includes("history/cursor"));
    expect(histCall.url).toContain("type=archive");
    expect(histCall.url).toContain("ps=30");
  });
});

// ─── fetchFavourites ────────────────────────────────────────────────────

describe("BilibiliApiClient.fetchFavourites", () => {
  it("walks each folder and aggregates items", async () => {
    const { client } = makeClient([
      ["finger/spi", { body: SPI_RESPONSE_BODY }],
      ["web-interface/nav", { body: NAV_RESPONSE_BODY }],
      [
        "fav/folder/created/list-all",
        {
          body: JSON.stringify({
            code: 0,
            data: { list: [{ id: 101, title: "Folder A" }, { id: 102, title: "Folder B" }] },
          }),
        },
      ],
      [
        "fav/resource/list",
        async (url) => {
          if (url.includes("media_id=101")) {
            return {
              body: JSON.stringify({
                code: 0,
                data: {
                  medias: [
                    {
                      bvid: "BVf1",
                      title: "Fav in A",
                      fav_time: 1716383021,
                      upper: { name: "upA" },
                    },
                  ],
                },
              }),
            };
          }
          return {
            body: JSON.stringify({
              code: 0,
              data: {
                medias: [
                  { bvid: "BVf2", title: "Fav in B", fav_time: 1716383022, upper: { name: "upB" } },
                ],
              },
            }),
          };
        },
      ],
    ]);
    const favs = await client.fetchFavourites(FAKE_COOKIE, 1234567890);
    expect(favs).toHaveLength(2);
    expect(favs[0].folderName).toBe("Folder A");
    expect(favs[1].folderName).toBe("Folder B");
    // fav_time is unix seconds → savedAt is unix ms
    expect(favs[0].savedAt).toBe(1716383021000);
  });

  it("returns [] when folders endpoint fails", async () => {
    const { client } = makeClient([
      ["finger/spi", { body: SPI_RESPONSE_BODY }],
      ["web-interface/nav", { body: NAV_RESPONSE_BODY }],
      [
        "fav/folder/created/list-all",
        { body: JSON.stringify({ code: -400, message: "bad request" }) },
      ],
    ]);
    const favs = await client.fetchFavourites(FAKE_COOKIE, 1234567890);
    expect(favs).toEqual([]);
  });

  it("includes platform=web on per-folder items request", async () => {
    const { client, calls } = makeClient([
      ["finger/spi", { body: SPI_RESPONSE_BODY }],
      ["web-interface/nav", { body: NAV_RESPONSE_BODY }],
      [
        "fav/folder/created/list-all",
        {
          body: JSON.stringify({
            code: 0,
            data: { list: [{ id: 101, title: "F" }] },
          }),
        },
      ],
      [
        "fav/resource/list",
        { body: JSON.stringify({ code: 0, data: { medias: [] } }) },
      ],
    ]);
    await client.fetchFavourites(FAKE_COOKIE, 1234567890);
    const itemsCall = calls.find((c) => c.url.includes("fav/resource/list"));
    expect(itemsCall.url).toContain("platform=web");
  });
});

// ─── fetchDynamics ──────────────────────────────────────────────────────

describe("BilibiliApiClient.fetchDynamics", () => {
  it("parses dynamic feed", async () => {
    const { client } = makeClient([
      ["finger/spi", { body: SPI_RESPONSE_BODY }],
      ["web-interface/nav", { body: NAV_RESPONSE_BODY }],
      [
        "web-dynamic/v1/feed/all",
        {
          body: JSON.stringify({
            code: 0,
            data: {
              items: [
                {
                  id_str: "dyn-1",
                  type: "DYNAMIC_TYPE_AV",
                  modules: {
                    module_author: {
                      mid: 999,
                      name: "author-x",
                      pub_ts: 1716383021,
                    },
                    module_dynamic: {
                      desc: { text: "hello world" },
                    },
                  },
                },
              ],
            },
          }),
        },
      ],
    ]);
    const dyns = await client.fetchDynamics(FAKE_COOKIE);
    expect(dyns).toHaveLength(1);
    expect(dyns[0]).toMatchObject({
      rid: "dyn-1",
      summary: "hello world",
      dynamicType: "av",
      publishedAt: 1716383021000,
      authorMid: 999,
      authorName: "author-x",
    });
  });

  it("falls back to archive.title when desc.text missing", async () => {
    const { client } = makeClient([
      ["finger/spi", { body: SPI_RESPONSE_BODY }],
      ["web-interface/nav", { body: NAV_RESPONSE_BODY }],
      [
        "web-dynamic/v1/feed/all",
        {
          body: JSON.stringify({
            code: 0,
            data: {
              items: [
                {
                  id_str: "dyn-2",
                  type: "DYNAMIC_TYPE_AV",
                  modules: {
                    module_author: { mid: 1, name: "x", pub_ts: 1 },
                    module_dynamic: { major: { archive: { title: "Archive Title" } } },
                  },
                },
              ],
            },
          }),
        },
      ],
    ]);
    const dyns = await client.fetchDynamics(FAKE_COOKIE);
    expect(dyns[0].summary).toBe("Archive Title");
  });

  it("includes timezone_offset=-480", async () => {
    const { client, calls } = makeClient([
      ["finger/spi", { body: SPI_RESPONSE_BODY }],
      ["web-interface/nav", { body: NAV_RESPONSE_BODY }],
      [
        "web-dynamic/v1/feed/all",
        { body: JSON.stringify({ code: 0, data: { items: [] } }) },
      ],
    ]);
    await client.fetchDynamics(FAKE_COOKIE);
    const dynCall = calls.find((c) => c.url.includes("web-dynamic"));
    expect(decodeURIComponent(dynCall.url)).toContain("timezone_offset=-480");
  });
});

// ─── fetchFollows ───────────────────────────────────────────────────────

describe("BilibiliApiClient.fetchFollows", () => {
  it("parses following list", async () => {
    const { client } = makeClient([
      ["finger/spi", { body: SPI_RESPONSE_BODY }],
      ["web-interface/nav", { body: NAV_RESPONSE_BODY }],
      [
        "relation/followings",
        {
          body: JSON.stringify({
            code: 0,
            data: {
              list: [
                {
                  mid: 42,
                  uname: "Friend1",
                  face: "https://face.png",
                  sign: "hi",
                  mtime: 1716383021,
                },
              ],
            },
          }),
        },
      ],
    ]);
    const fols = await client.fetchFollows(FAKE_COOKIE, 1234567890);
    expect(fols).toHaveLength(1);
    expect(fols[0]).toMatchObject({
      mid: 42,
      uname: "Friend1",
      face: "https://face.png",
      sign: "hi",
      followedAt: 1716383021000,
    });
  });

  it("skips mid=0 entries", async () => {
    const { client } = makeClient([
      ["finger/spi", { body: SPI_RESPONSE_BODY }],
      ["web-interface/nav", { body: NAV_RESPONSE_BODY }],
      [
        "relation/followings",
        {
          body: JSON.stringify({
            code: 0,
            data: {
              list: [
                { mid: 0, uname: "Ghost" },
                { mid: 1, uname: "Real" },
              ],
            },
          }),
        },
      ],
    ]);
    const fols = await client.fetchFollows(FAKE_COOKIE, 1234567890);
    expect(fols).toHaveLength(1);
    expect(fols[0].uname).toBe("Real");
  });

  it("includes vmid + order params", async () => {
    const { client, calls } = makeClient([
      ["finger/spi", { body: SPI_RESPONSE_BODY }],
      ["web-interface/nav", { body: NAV_RESPONSE_BODY }],
      [
        "relation/followings",
        { body: JSON.stringify({ code: 0, data: { list: [] } }) },
      ],
    ]);
    await client.fetchFollows(FAKE_COOKIE, 1234567890);
    const followsCall = calls.find((c) => c.url.includes("relation/followings"));
    expect(followsCall.url).toContain("vmid=1234567890");
    expect(followsCall.url).toContain("order=desc");
    expect(followsCall.url).toContain("order_type=attention");
  });
});

// ─── test seams ─────────────────────────────────────────────────────────

describe("BilibiliApiClient — test seams", () => {
  it("setMintedBuvid3ForTest bypasses /spi network call", async () => {
    const { client, calls } = makeClient([
      ["finger/spi", () => {
        throw new Error("should not call /spi");
      }],
      ["web-interface/nav", { body: NAV_RESPONSE_BODY }],
      ["history/cursor", { body: JSON.stringify({ code: 0, data: { list: [] } }) }],
    ]);
    client.setMintedBuvid3ForTest("PRE_SEEDED_B3");
    await client.fetchHistory(FAKE_COOKIE);
    const histCall = calls.find((c) => c.url.includes("history/cursor"));
    expect(histCall.opts.headers.Cookie).toContain("buvid3=PRE_SEEDED_B3");
  });

  it("setWbiMixinKeyForTest bypasses /nav network call", async () => {
    const { client, calls } = makeClient([
      ["finger/spi", { body: SPI_RESPONSE_BODY }],
      ["web-interface/nav", () => {
        throw new Error("should not call /nav");
      }],
      ["history/cursor", { body: JSON.stringify({ code: 0, data: { list: [] } }) }],
    ]);
    client.setWbiMixinKeyForTest("M".repeat(32));
    await client.fetchHistory(FAKE_COOKIE);
    const histCall = calls.find((c) => c.url.includes("history/cursor"));
    expect(histCall.url).toMatch(/w_rid=[0-9a-f]{32}/);
  });
});

// ─── WBI table contract ─────────────────────────────────────────────────

describe("WBI_MIXIN_KEY_TABLE", () => {
  it("is frozen", () => {
    expect(Object.isFrozen(WBI_MIXIN_KEY_TABLE)).toBe(true);
  });

  it("has exactly 64 entries", () => {
    expect(WBI_MIXIN_KEY_TABLE.length).toBe(64);
  });

  it("all indexes are in [0, 63]", () => {
    for (const i of WBI_MIXIN_KEY_TABLE) {
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThanOrEqual(63);
    }
  });
});
